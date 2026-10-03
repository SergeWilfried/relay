import { notify } from './notify';
import { ENQUEUE_SWEEPS_SQL } from './sweepSql';
import { SELL_ASSETS } from './assets';
import { classifyResponse, erc20TransferData, SOL_FEE_LAMPORTS, solanaTransferTx, toHex, type Sent } from './sweepTx';

/**
 * Forwards each confirmed deposit from its per-order Privy wallet to the treasury. The wallet policies
 * (scripts/privy-policy-defs.mjs) only allow exactly this transfer, so a bug or a stolen API key can't send elsewhere.
 *
 * Runs from a cron trigger (and POST /api/admin/sweeps/run). One sweep per order; every transition is a conditional
 * UPDATE, so overlapping runs can't send twice. Ambiguous outcomes (network error, 5xx) are parked as 'unknown' for a
 * person: money may have moved, so they are never retried automatically.
 */
export type SweepStatus = 'pending' | 'sending' | 'submitted' | 'failed' | 'unknown';
export interface SweepRow {
	order_id: string; wallet_id: string | null; chain: 'ethereum' | 'solana'; asset: string; amount_units: string;
	status: SweepStatus; attempts: number; tx_hash: string | null; tx_id: string | null; error: string | null; created_at: number; updated_at: number;
}

export class SweepConflict extends Error {}

const EVM_CAIP2 = 'eip155:1';
const SOL_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'; // Solana mainnet-beta
const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const MAX_PER_RUN = 10;
const MAX_ATTEMPTS = 3; // only counts rate-limit (429) retries: those are known not to have been processed

const live = (env: Env) => (env.LIVE as string) === 'true';
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...extra }));

async function transition(env: Env, orderId: string, from: SweepStatus[], set: string, ...binds: unknown[]): Promise<boolean> {
	const marks = from.map(() => '?').join(',');
	const res = await env.DB.prepare(`UPDATE sweeps SET ${set}, updated_at = ? WHERE order_id = ? AND status IN (${marks})`).bind(...binds, Date.now(), orderId, ...from).run();
	return res.meta.changes > 0;
}

export const listSweeps = async (env: Env, status?: string) =>
	(await (status ? env.DB.prepare('SELECT * FROM sweeps WHERE status = ? ORDER BY created_at LIMIT 200').bind(status) : env.DB.prepare('SELECT * FROM sweeps ORDER BY created_at DESC LIMIT 200')).all<SweepRow>()).results;

/** Queues a sweep for every confirmed deposit that doesn't have one yet. */
export async function enqueueSweeps(env: Env): Promise<number> {
	const now = Date.now();
	// An underpaid deposit is only forwarded to the treasury once a refund of it is APPROVED: the treasury is where the refund is sent from.
	const res = await env.DB.prepare(ENQUEUE_SWEEPS_SQL)
		.bind(now, live(env) ? 1 : 0).run();
	return res.meta.changes;
}


async function privyRpc(env: Env, walletId: string, body: unknown, idemKey: string): Promise<Sent> {
	let res: Response;
	try {
		res = await fetch(`https://api.privy.io/v1/wallets/${encodeURIComponent(walletId)}/rpc`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'privy-app-id': env.PRIVY_APP_ID, authorization: `Basic ${btoa(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`)}`, 'privy-idempotency-key': idemKey },
			body: JSON.stringify(body),
		});
	} catch (e) { return { state: 'unknown', error: `Network error after sending: ${e instanceof Error ? e.message : String(e)}` }; }
	return classifyResponse(res.status, await res.text());
}

async function latestBlockhash(env: Env): Promise<string> {
	const res = await fetch((env.SOLANA_RPC_URL as string | undefined) || DEFAULT_SOLANA_RPC, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [{ commitment: 'finalized' }] }),
	});
	const j = (await res.json()) as { result?: { value?: { blockhash?: string } } };
	const h = j.result?.value?.blockhash;
	if (!res.ok || !h) throw new Error('Could not get a recent Solana blockhash');
	return h;
}

/** Sends one sweep. A thrown error here means NOTHING was sent (it happens before the Privy call), so it is safe to retry. */
async function send(env: Env, s: SweepRow & { deposit_address: string }, address = s.deposit_address): Promise<Sent> {
	const asset = SELL_ASSETS[s.asset];
	if (!asset) return { state: 'failed', error: `Unknown asset ${s.asset}` };
	if (!live(env)) return { state: 'submitted', txHash: `sandbox-sweep-${s.order_id}`, txId: null }; // pretends; never runs with LIVE=true
	if (!s.wallet_id) return { state: 'failed', error: 'Order has no deposit wallet' };
	const amount = BigInt(s.amount_units);
	// a new key per attempt: Privy replays a cached 4xx/5xx for the same key. Attempts only grow after a definite "not processed" (429).
	const idem = `sweep-${s.order_id}-${s.attempts}`;

	if (asset.chainType === 'ethereum') {
		const treasury = env.TREASURY_EVM;
		if (!treasury) return { state: 'failed', error: 'TREASURY_EVM is not set' };
		// Gas is sponsored by Privy (the deposit wallet holds only the deposit, so a token sweep has no ETH to pay gas).
		// Enable gas sponsorship for Ethereum in the Privy dashboard first.
		const tx = asset.token
			? { to: asset.token, value: '0x0', data: erc20TransferData(treasury, amount), chain_id: 1 }
			: { to: treasury, value: toHex(amount), chain_id: 1 };
		return privyRpc(env, s.wallet_id, { method: 'eth_sendTransaction', caip2: EVM_CAIP2, chain_type: 'ethereum', sponsor: true, params: { transaction: tx }, reference_id: `sweep-${s.order_id}` }, idem);
	}

	const treasury = env.TREASURY_SOL;
	if (!treasury) return { state: 'failed', error: 'TREASURY_SOL is not set' };
	// the wallet pays the network fee itself, so send the deposit minus the fee
	const tx = solanaTransferTx(address, treasury, amount - SOL_FEE_LAMPORTS, await latestBlockhash(env));
	return privyRpc(env, s.wallet_id, { method: 'signAndSendTransaction', caip2: SOL_CAIP2, params: { transaction: tx, encoding: 'base64' }, reference_id: `sweep-${s.order_id}` }, idem);
}

export async function processSweep(env: Env, orderId: string): Promise<SweepRow | null> {
	// claim: only one caller can move pending -> sending
	if (!(await transition(env, orderId, ['pending'], `status = 'sending'`))) return env.DB.prepare('SELECT * FROM sweeps WHERE order_id = ?').bind(orderId).first<SweepRow>();
	const s = (await env.DB.prepare('SELECT s.*, o.deposit_address FROM sweeps s JOIN orders o ON o.id = s.order_id WHERE s.order_id = ?').bind(orderId).first<SweepRow & { deposit_address: string }>())!;
	let out: Sent;
	try { out = await send(env, s); }
	catch (e) {
		// thrown before any Privy call (blockhash lookup, bad address): nothing was sent, so back to pending for the next run
		await transition(env, orderId, ['sending'], `status = 'pending', error = ?`, e instanceof Error ? e.message : String(e));
		return env.DB.prepare('SELECT * FROM sweeps WHERE order_id = ?').bind(orderId).first<SweepRow>();
	}
	if (out.state === 'submitted') await transition(env, orderId, ['sending'], `status = 'submitted', tx_hash = ?, tx_id = ?, error = NULL`, out.txHash, out.txId);
	else if (out.state === 'failed') await transition(env, orderId, ['sending'], `status = 'failed', error = ?`, out.error);
	else if (out.state === 'retry') {
		const giveUp = s.attempts + 1 >= MAX_ATTEMPTS;
		await transition(env, orderId, ['sending'], `status = ?, attempts = attempts + 1, error = ?`, giveUp ? 'failed' : 'pending', out.error);
	} else {
		await transition(env, orderId, ['sending'], `status = 'unknown', error = ?`, `UNKNOWN OUTCOME: ${out.error}`);
		console.error(JSON.stringify({ msg: 'sweep.unknown_outcome', order: orderId }));
	}
	log('sweep.result', { order: orderId, state: out.state });
	const now = await env.DB.prepare('SELECT status, error FROM sweeps WHERE order_id = ?').bind(orderId).first<{ status: SweepStatus; error: string | null }>();
	const details = { order: orderId, asset: s.asset, amountUnits: s.amount_units, chain: s.chain, error: now?.error };
	if (now?.status === 'unknown') await notify(env, { level: 'critical', title: 'Sweep outcome unknown: funds may have moved, check the chain', details });
	else if (now?.status === 'failed') await notify(env, { level: 'warning', title: 'Sweep failed: funds are still in the deposit wallet', details });
	return env.DB.prepare('SELECT * FROM sweeps WHERE order_id = ?').bind(orderId).first<SweepRow>();
}

export async function runSweeps(env: Env): Promise<{ queued: number; processed: number }> {
	const queued = await enqueueSweeps(env);
	const { results } = await env.DB.prepare(`SELECT order_id FROM sweeps WHERE status = 'pending' ORDER BY created_at LIMIT ?`).bind(MAX_PER_RUN).all<{ order_id: string }>();
	for (const r of results) await processSweep(env, r.order_id);
	return { queued, processed: results.length };
}

/** A person re-queues a sweep Privy definitively refused (e.g. after fixing a policy or enabling gas sponsorship). */
export async function retrySweep(env: Env, orderId: string): Promise<SweepRow | null> {
	if (!(await transition(env, orderId, ['failed'], `status = 'pending', attempts = attempts + 1, error = NULL`))) throw new SweepConflict('Only a failed sweep can be retried');
	return processSweep(env, orderId);
}

/** Human decision for an 'unknown' sweep after checking the chain. */
export async function resolveSweep(env: Env, orderId: string, outcome: 'submitted' | 'failed', note: string, txHash?: string): Promise<SweepRow | null> {
	const ok = outcome === 'submitted'
		? await transition(env, orderId, ['unknown'], `status = 'submitted', tx_hash = ?, error = ?`, txHash ?? null, `Resolved by hand: ${note}`)
		: await transition(env, orderId, ['unknown'], `status = 'failed', error = ?`, `Resolved by hand: ${note}`);
	if (!ok) throw new SweepConflict('Sweep is not in the unknown state');
	log('sweep.resolved', { order: orderId, outcome, note });
	return env.DB.prepare('SELECT * FROM sweeps WHERE order_id = ?').bind(orderId).first<SweepRow>();
}
