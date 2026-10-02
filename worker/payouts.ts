import { notify } from './notify';
import { holdActive } from './orders';
import { getProvider } from './payout';

export type PayoutStatus = 'pending_approval' | 'approved' | 'sending' | 'paid' | 'failed' | 'rejected';

export interface PayoutRow {
	id: string; order_id: string; user_id: string; provider: string; phone: string | null; operator: string | null;
	amount_fcfa: number; status: PayoutStatus; provider_ref: string | null; attempts: number; error: string | null;
	approved_at: number | null; paid_at: number | null; created_at: number; updated_at: number;
}

/** Payout plus the order context an approver needs to see. */
export interface AdminPayoutRow extends PayoutRow { asset: string; order_amount: string; network: string; deposit_tx: string | null; order_note: string | null;
	hold_rules: string | null; hold_message: string | null; hold_until: number | null; hold_released_at: number | null }

export class Conflict extends Error {}

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...extra }));

export const getPayout = (env: Env, id: string) => env.DB.prepare('SELECT * FROM payouts WHERE id = ?').bind(id).first<PayoutRow>();

const ADMIN_SELECT = `SELECT p.*, o.asset, o.amount AS order_amount, o.network, o.deposit_tx, o.note AS order_note,
	o.hold_rules, o.hold_message, o.hold_until, o.hold_released_at
	FROM payouts p JOIN orders o ON o.id = p.order_id`;

export async function listPayouts(env: Env, status?: string): Promise<AdminPayoutRow[]> {
	const q = status
		? env.DB.prepare(`${ADMIN_SELECT} WHERE p.status = ? ORDER BY p.created_at LIMIT 200`).bind(status)
		: env.DB.prepare(`${ADMIN_SELECT} ORDER BY p.created_at DESC LIMIT 200`);
	return (await q.all<AdminPayoutRow>()).results;
}

/** Every transition is a conditional UPDATE: only the expected current status can move, so double clicks and retries are harmless. */
async function transition(env: Env, id: string, from: PayoutStatus[], set: string, ...binds: unknown[]): Promise<boolean> {
	const marks = from.map(() => '?').join(',');
	const res = await env.DB.prepare(`UPDATE payouts SET ${set}, updated_at = ? WHERE id = ? AND status IN (${marks})`)
		.bind(...binds, Date.now(), id, ...from).run();
	return res.meta.changes > 0;
}

export async function approvePayout(env: Env, id: string, admin: string): Promise<PayoutRow> {
	const now = Date.now();
	// a payout on hold can't be approved until the hold runs out or an analyst releases it (see releaseHold)
	const h = await env.DB.prepare(`SELECT o.hold_rules, o.hold_until, o.hold_released_at FROM payouts p JOIN orders o ON o.id = p.order_id WHERE p.id = ?`)
		.bind(id).first<{ hold_rules: string | null; hold_until: number | null; hold_released_at: number | null }>();
	if (h && holdActive(h, now)) throw new Conflict(`Payout is on hold (${h.hold_rules}). Release the hold first.`);
	if (!(await transition(env, id, ['pending_approval'], `status = 'approved', approved_at = ?, error = NULL`, now))) throw new Conflict('Payout is not awaiting approval');
	log('payout.approved', { id, admin });
	return executePayout(env, id);
}

/** An analyst clears the hold (the matrix's "release: analyst review" / "automatic, or earlier after MFA"). Idempotent. */
export async function releaseHold(env: Env, id: string, admin: string, note: string): Promise<PayoutRow> {
	const res = await env.DB.prepare(`UPDATE orders SET hold_released_at = ?, updated_at = ? WHERE id = (SELECT order_id FROM payouts WHERE id = ?) AND hold_rules IS NOT NULL AND hold_released_at IS NULL`)
		.bind(Date.now(), Date.now(), id).run();
	if (res.meta.changes === 0) throw new Conflict('This payout has no hold to release');
	log('payout.hold_released', { id, admin, note });
	return (await getPayout(env, id))!;
}

export async function rejectPayout(env: Env, id: string, reason: string): Promise<PayoutRow> {
	if (!(await transition(env, id, ['pending_approval'], `status = 'rejected', error = ?`, reason))) throw new Conflict('Payout is not awaiting approval');
	log('payout.rejected', { id, reason });
	return (await getPayout(env, id))!;
}

/** Re-send a payout the provider definitively refused. Never valid for 'sending' (outcome unknown: resolve it instead). */
export async function retryPayout(env: Env, id: string): Promise<PayoutRow> {
	if (!(await transition(env, id, ['failed'], `status = 'approved', error = NULL`))) throw new Conflict('Only a failed payout can be retried');
	return executePayout(env, id);
}

/** Human decision for a payout stuck in 'sending' after checking with the provider. */
export async function resolvePayout(env: Env, id: string, outcome: 'paid' | 'failed', note: string): Promise<PayoutRow> {
	const ok = outcome === 'paid'
		? await transition(env, id, ['sending'], `status = 'paid', paid_at = ?, error = ?`, Date.now(), note)
		: await transition(env, id, ['sending'], `status = 'failed', error = ?`, note);
	if (!ok) throw new Conflict('Payout is not in the sending state');
	log('payout.resolved', { id, outcome, note });
	return (await getPayout(env, id))!;
}

/** Calls the provider for an approved payout. The provider receives our payout id as its idempotency reference. */
export async function executePayout(env: Env, id: string): Promise<PayoutRow> {
	// claim: only one caller can move approved -> sending, so the provider is never called twice concurrently
	if (!(await transition(env, id, ['approved'], `status = 'sending', attempts = attempts + 1`))) return (await getPayout(env, id))!;
	const row = (await getPayout(env, id))!;
	if (!row.phone || !row.operator) {
		await transition(env, id, ['sending'], `status = 'failed', error = ?`, 'Missing phone number or operator');
		return (await getPayout(env, id))!;
	}
	try {
		const out = await getProvider(env).send({ reference: row.id, amountFcfa: row.amount_fcfa, phone: row.phone, operator: row.operator });
		if (out.state === 'paid') await transition(env, id, ['sending'], `status = 'paid', paid_at = ?, provider_ref = ?`, Date.now(), out.providerRef);
		else if (out.state === 'pending') await transition(env, id, ['sending'], `provider_ref = ?`, out.providerRef); // stays 'sending' until the webhook
		else {
			await transition(env, id, ['sending'], `status = 'failed', error = ?`, out.error);
			await notify(env, { level: 'warning', title: 'Payout failed: the provider refused it', details: { payout: id, order: row.order_id, amountFcfa: row.amount_fcfa, error: out.error } });
		}
		log('payout.result', { id, state: out.state });
	} catch (e) {
		// Unknown outcome: money may have moved. Leave it in 'sending' for a human; do NOT retry automatically.
		await transition(env, id, ['sending'], `error = ?`, `UNKNOWN OUTCOME: ${e instanceof Error ? e.message : String(e)}`);
		console.error(JSON.stringify({ msg: 'payout.unknown_outcome', id }));
		await notify(env, { level: 'critical', title: 'Payout outcome unknown: money may have moved, check the provider', details: { payout: id, order: row.order_id, amountFcfa: row.amount_fcfa } });
	}
	return (await getPayout(env, id))!;
}

/** Provider status webhook: settles payouts that were accepted asynchronously. Idempotent. */
export async function settleFromWebhook(env: Env, reference: string, state: 'paid' | 'failed', error?: string): Promise<boolean> {
	const ok = state === 'paid'
		? await transition(env, reference, ['sending'], `status = 'paid', paid_at = ?`, Date.now())
		: await transition(env, reference, ['sending'], `status = 'failed', error = ?`, error ?? 'Rejected by provider');
	log('payout.webhook', { reference, state, applied: ok });
	if (ok && state === 'failed') await notify(env, { level: 'warning', title: 'Payout failed: the provider reported a failure', details: { payout: reference, error } });
	return ok;
}
