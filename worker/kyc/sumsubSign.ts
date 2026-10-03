/**
 * Sumsub request signing and webhook verification (Web Crypto only, no imports, so it runs under plain Node tests).
 * https://docs.sumsub.com/reference/authentication  ·  https://docs.sumsub.com/docs/webhook-manager
 */
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret: string, data: string, hash: 'SHA-1' | 'SHA-256' | 'SHA-512' = 'SHA-256'): Promise<string> {
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
	return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Constant-time compare of two hex strings. */
export const safeEqualHex = (a: string, b: string): boolean => {
	if (a.length !== b.length) return false;
	let d = 0;
	for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return d === 0;
};

/**
 * Headers for one API call. The signature covers `ts + METHOD + path-with-query + body`, where the body is the exact string sent.
 * `ts` is in seconds.
 */
export async function signRequest(token: string, secret: string, method: string, pathWithQuery: string, body: string, ts: number): Promise<Record<string, string>> {
	return {
		'X-App-Token': token,
		'X-App-Access-Ts': String(ts),
		'X-App-Access-Sig': await hmacHex(secret, `${ts}${method.toUpperCase()}${pathWithQuery}${body}`),
	};
}

const ALGS: Record<string, 'SHA-1' | 'SHA-256' | 'SHA-512'> = { HMAC_SHA1_HEX: 'SHA-1', HMAC_SHA256_HEX: 'SHA-256', HMAC_SHA512_HEX: 'SHA-512' };

/** True only when the digest header matches the raw body signed with the webhook secret. Unknown algorithms are refused. */
export async function verifyWebhook(secret: string, rawBody: string, digest: string | null, alg: string | null): Promise<boolean> {
	if (!secret || !digest) return false;
	const hash = ALGS[alg ?? 'HMAC_SHA1_HEX'];
	if (!hash) return false;
	return safeEqualHex((await hmacHex(secret, rawBody, hash)).toLowerCase(), digest.trim().toLowerCase());
}

export type KycStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'retry';

export interface SumsubEvent {
	type: string; applicantId?: string; externalUserId?: string; levelName?: string; createdAtMs?: string;
	reviewResult?: { reviewAnswer?: string; reviewRejectType?: string; rejectLabels?: string[] };
}

/** What an event means for the user's state. null = no change. Approval is only ever granted by a GREEN review. */
export function statusFromEvent(e: SumsubEvent, current: KycStatus): KycStatus | null {
	switch (e.type) {
		case 'applicantReviewed': {
			const r = e.reviewResult;
			if (r?.reviewAnswer === 'GREEN') return 'approved';
			if (r?.reviewAnswer === 'RED') return r.reviewRejectType === 'RETRY' ? 'retry' : 'rejected';
			return null;
		}
		case 'applicantPending': case 'applicantOnHold': return current === 'approved' ? null : 'pending';
		case 'applicantReset': return 'none';
		default: return null;
	}
}

/** Sumsub's event time in ms, or 0 when absent/invalid. Their format is "2026-10-03 13:25:07.123" (UTC) or epoch ms. */
export function eventTime(e: SumsubEvent): number {
	const v = e.createdAtMs;
	if (!v) return 0;
	if (/^\d{12,}$/.test(v)) return Number(v);
	const t = Date.parse(v.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'));
	return Number.isFinite(t) ? t : 0;
}
