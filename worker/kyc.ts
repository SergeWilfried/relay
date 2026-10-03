/**
 * Identity verification with Sumsub. The server is the source of truth: the browser only runs Sumsub's SDK, and the
 * result reaches us through a signed webhook (which is re-checked against Sumsub's API before it grants anything).
 * Orders above KYC_THRESHOLD_FCFA need an approved check (rule K-01 in worker/rules.ts).
 */
import { alert } from './alerts';
import { KYC_THRESHOLD_FCFA } from './rules';
import { createSumsubClient, levelOf, sumsubConfigured, SumsubError, type SumsubApplicant, type SumsubClient } from './kyc/sumsub';
import { eventTime, statusFromEvent, verifyWebhook, type KycStatus, type SumsubEvent } from './kyc/sumsubSign';

export { SumsubError };
export type { KycStatus };

export interface KycView {
	configured: boolean; status: KycStatus; approved: boolean;
	/** orders above this FCFA amount need an approved check */
	thresholdFcfa: number;
	/** customer-safe reason when a check was sent back or refused */
	message: string | null;
}

interface Row { user_id: string; applicant_id: string | null; level: string; status: KycStatus; reject_type: string | null; reject_labels: string | null; first_name: string | null; last_name: string | null; country: string | null; event_at: number; created_at: number; updated_at: number }


/** Labels that mean we should never explain the refusal to the customer (fraud / compliance), and that ops should see. */
const SENSITIVE = ['FORGERY', 'FRAUDULENT_PATTERNS', 'FRAUDULENT_LIVENESS', 'BLOCKLIST', 'COMPROMISED_PERSONS', 'SANCTIONS', 'PEP', 'ADVERSE_MEDIA', 'CRIMINAL', 'SPAM', 'AGE_REQUIREMENT_MISMATCH', 'DUPLICATE'];

const RETRY_MESSAGES: Record<string, string> = {
	BAD_PHOTO_EDITOR: 'Please retake your photos without editing.', UNSATISFACTORY_PHOTOS: 'Please retake clear photos of your document.',
	SELFIE_MISMATCH: 'Your selfie did not match your document. Please try again.', BAD_FACE_MATCHING: 'Your selfie did not match your document. Please try again.',
	DOCUMENT_DAMAGED: 'Your document looked damaged. Please use another one.', DOCUMENT_PAGE_MISSING: 'A page of your document was missing. Please include every page.',
	EXPIRATION_DATE: 'Your document has expired. Please use a valid one.', ID_INVALID: 'We could not read your document. Please try another one.',
};

const parseLabels = (s: string | null): string[] => { try { const v = JSON.parse(s ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };

export function customerMessage(status: KycStatus, labels: string[]): string | null {
	if (status === 'retry') return labels.map((l) => RETRY_MESSAGES[l]).find(Boolean) ?? 'We could not complete your check. Please try again.';
	if (status === 'rejected') return 'We could not verify your identity. Please contact support.';
	return null;
}

const getRow = (env: Env, userId: string) => env.DB.prepare('SELECT * FROM kyc WHERE user_id = ?').bind(userId).first<Row>();

export async function kycStatus(env: Env, userId: string): Promise<KycView> {
	const r = await getRow(env, userId);
	const status = r?.status ?? 'none';
	return { configured: sumsubConfigured(env), status, approved: status === 'approved', thresholdFcfa: KYC_THRESHOLD_FCFA, message: customerMessage(status, parseLabels(r?.reject_labels ?? null)) };
}

/** Used by the rule engine. A missing row is "not verified". */
export async function isKycApproved(env: Env, userId: string): Promise<boolean> {
	const r = await env.DB.prepare(`SELECT 1 AS ok FROM kyc WHERE user_id = ? AND status = 'approved'`).bind(userId).first();
	return !!r;
}

/** Hands the browser a token for Sumsub's SDK. Refused once the user is approved (nothing to do) or finally rejected. */
export async function startKyc(env: Env, userId: string, deps?: { client?: SumsubClient }): Promise<{ token: string; userId: string; level: string }> {
	if (!sumsubConfigured(env) && !deps?.client) throw new SumsubError('Identity verification is not configured', 503);
	const row = await getRow(env, userId);
	if (row?.status === 'approved') throw new SumsubError('You are already verified', 409);
	if (row?.status === 'rejected') throw new SumsubError('We could not verify your identity. Please contact support.', 403);
	const level = levelOf(env);
	const client = deps?.client ?? createSumsubClient(env);
	const t = await client.accessToken(userId, level);
	const now = Date.now();
	await env.DB.prepare(`INSERT INTO kyc (user_id, level, status, created_at, updated_at) VALUES (?1, ?2, 'none', ?3, ?3) ON CONFLICT(user_id) DO NOTHING`).bind(userId, level, now).run();
	return { token: t.token, userId: t.userId, level };
}

/** Sumsub says the user finished in the SDK: pull the applicant now instead of waiting for the webhook (webhook still wins on conflicts via event_at). */
export async function syncKyc(env: Env, userId: string, deps?: { client?: SumsubClient }): Promise<KycView> {
	if (!sumsubConfigured(env) && !deps?.client) return kycStatus(env, userId);
	const client = deps?.client ?? createSumsubClient(env);
	const a = await client.applicantByExternalId(userId);
	if (a) await applyApplicant(env, userId, a, 0);
	return kycStatus(env, userId);
}

function statusOfApplicant(a: SumsubApplicant): { status: KycStatus; labels: string[]; rejectType: string | null } | null {
	const rs = a.review?.reviewStatus;
	const res = a.review?.reviewResult;
	if (rs === 'completed') {
		if (res?.reviewAnswer === 'GREEN') return { status: 'approved', labels: [], rejectType: null };
		if (res?.reviewAnswer === 'RED') return { status: res.reviewRejectType === 'RETRY' ? 'retry' : 'rejected', labels: res.rejectLabels ?? [], rejectType: res.reviewRejectType ?? null };
	}
	if (rs === 'pending' || rs === 'queued' || rs === 'onHold' || rs === 'prechecked') return { status: 'pending', labels: [], rejectType: null };
	return null;
}

/** Writes what Sumsub's API reports (the authoritative copy). `eventAt` 0 = a manual sync, which never goes back in time. */
async function applyApplicant(env: Env, userId: string, a: SumsubApplicant, eventAt: number): Promise<void> {
	const s = statusOfApplicant(a);
	if (!s) return;
	const row = await getRow(env, userId);
	if (!row) return;
	if (eventAt && eventAt < row.event_at) return;
	await env.DB.prepare(`UPDATE kyc SET applicant_id = ?2, status = ?3, reject_type = ?4, reject_labels = ?5, first_name = COALESCE(?6, first_name), last_name = COALESCE(?7, last_name), country = COALESCE(?8, country), event_at = MAX(event_at, ?9), updated_at = ?10 WHERE user_id = ?1`)
		.bind(userId, a.id, s.status, s.rejectType, JSON.stringify(s.labels), s.status === 'approved' ? a.info?.firstName ?? null : null, s.status === 'approved' ? a.info?.lastName ?? null : null, s.status === 'approved' ? a.info?.country ?? null : null, eventAt, Date.now()).run();
	if (s.status === 'rejected' && s.labels.some((l) => SENSITIVE.includes(l))) await alert(env, { level: 'warning', title: 'KYC rejected with a compliance label', details: { user: userId, labels: s.labels.join(',') } });
}

/**
 * One verified Sumsub webhook. An approval is never taken from the payload alone: it is confirmed with Sumsub's API
 * (the digest proves the sender, the API call proves the state). Throw to make Sumsub retry, return to acknowledge.
 */
export async function handleSumsubEvent(env: Env, e: SumsubEvent, deps?: { client?: SumsubClient }): Promise<{ handled: boolean; status?: KycStatus }> {
	const userId = e.externalUserId;
	if (!userId) return { handled: false };
	const row = await getRow(env, userId);
	if (!row) { console.warn(JSON.stringify({ msg: 'kyc.unknown_user', type: e.type })); return { handled: false }; }
	const at = eventTime(e);
	if (at && at < row.event_at) return { handled: false, status: row.status };
	const next = statusFromEvent(e, row.status);
	if (!next) return { handled: false, status: row.status };
	if (next === 'approved' || next === 'rejected' || next === 'retry') {
		const client = deps?.client ?? createSumsubClient(env);
		const a = e.applicantId ? await client.applicant(e.applicantId) : await client.applicantByExternalId(userId);
		// the applicant must belong to this user, and Sumsub must agree with the event
		if (!a || a.externalUserId !== userId) { console.warn(JSON.stringify({ msg: 'kyc.applicant_mismatch', type: e.type })); return { handled: false, status: row.status }; }
		const s = statusOfApplicant(a);
		// Sumsub's API may lag the webhook by a moment: fail so Sumsub redelivers instead of dropping the result
		if (!s || s.status !== next) throw new SumsubError(`kyc state not visible yet (event ${next}, api ${s?.status ?? 'none'})`, 503);
		await applyApplicant(env, userId, a, at);
	} else {
		await env.DB.prepare(`UPDATE kyc SET status = ?2, applicant_id = COALESCE(?3, applicant_id), event_at = MAX(event_at, ?4), updated_at = ?5 WHERE user_id = ?1`).bind(userId, next, e.applicantId ?? null, at, Date.now()).run();
	}
	console.log(JSON.stringify({ msg: 'kyc.status', user: userId, status: next }));
	return { handled: true, status: next };
}

export async function verifySumsubWebhook(env: Env, raw: string, headers: Headers): Promise<boolean> {
	const secret = (env as { SUMSUB_WEBHOOK_SECRET?: string }).SUMSUB_WEBHOOK_SECRET ?? '';
	return verifyWebhook(secret, raw, headers.get('x-payload-digest'), headers.get('x-payload-digest-alg'));
}

export async function listKyc(env: Env, status?: string) {
	const { results } = await (status
		? env.DB.prepare('SELECT user_id, applicant_id, level, status, reject_type, reject_labels, first_name, last_name, country, updated_at FROM kyc WHERE status = ? ORDER BY updated_at DESC LIMIT 200').bind(status)
		: env.DB.prepare('SELECT user_id, applicant_id, level, status, reject_type, reject_labels, first_name, last_name, country, updated_at FROM kyc ORDER BY updated_at DESC LIMIT 200')).all<Omit<Row, 'event_at' | 'created_at'>>();
	return results.map((r) => ({ ...r, reject_labels: parseLabels(r.reject_labels) }));
}
