import { signRequest } from './sumsubSign';

export const SUMSUB_BASE = 'https://api.sumsub.com';
/** Level used for the identity check (ID document + liveness). Override with the SUMSUB_LEVEL var. */
export const DEFAULT_LEVEL = 'id-and-liveness';

export class SumsubError extends Error {
	status: number;
	constructor(message: string, status: number) { super(message); this.status = status; }
}

export interface SumsubApplicant {
	id: string; externalUserId: string;
	review?: { reviewStatus?: string; reviewResult?: { reviewAnswer?: string; reviewRejectType?: string; rejectLabels?: string[] } };
	info?: { firstName?: string; lastName?: string; country?: string };
}

export interface SumsubClient {
	/** Short-lived token the web SDK uses to run the check for this user (it also creates the applicant on first use). */
	accessToken(userId: string, level: string, ttlSeconds?: number): Promise<{ token: string; userId: string }>;
	applicantByExternalId(userId: string): Promise<SumsubApplicant | null>;
	applicant(applicantId: string): Promise<SumsubApplicant | null>;
}

export const levelOf = (env: Env) => ((env as { SUMSUB_LEVEL?: string }).SUMSUB_LEVEL || DEFAULT_LEVEL);
export const sumsubConfigured = (env: Env) => !!(env.SUMSUB_TOKEN && env.SUMSUB_SECRET);

export function createSumsubClient(env: Env, deps: { fetch?: typeof fetch; now?: () => number } = {}): SumsubClient {
	const f = deps.fetch ?? fetch;
	const now = deps.now ?? (() => Date.now());
	const base = ((env as { SUMSUB_API_URL?: string }).SUMSUB_API_URL || SUMSUB_BASE).replace(/\/+$/, '');
	if (!sumsubConfigured(env)) throw new SumsubError('Identity verification is not configured', 503);

	async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, allow404 = false): Promise<T | null> {
		const raw = body === undefined ? '' : JSON.stringify(body);
		const headers = await signRequest(env.SUMSUB_TOKEN, env.SUMSUB_SECRET, method, path, raw, Math.floor(now() / 1000));
		const res = await f(`${base}${path}`, { method, headers: { ...headers, accept: 'application/json', ...(raw ? { 'content-type': 'application/json' } : {}) }, body: raw || undefined });
		if (allow404 && res.status === 404) return null;
		if (!res.ok) {
			// never echo the response body to callers: it can name the app token or internal ids
			console.warn(JSON.stringify({ msg: 'sumsub.error', method, path: path.split('?')[0], status: res.status }));
			throw new SumsubError(res.status === 401 || res.status === 403 ? 'Identity verification is misconfigured' : 'Identity verification is unavailable', res.status === 429 ? 429 : 502);
		}
		return (await res.json()) as T;
	}

	return {
		async accessToken(userId, level, ttlSeconds = 900) {
			const r = await call<{ token: string; userId: string }>('POST', '/resources/accessTokens/sdk', { userId, levelName: level, ttlInSecs: ttlSeconds });
			if (!r?.token) throw new SumsubError('Identity verification is unavailable', 502);
			return r;
		},
		applicantByExternalId: (userId) => call<SumsubApplicant>('GET', `/resources/applicants/-;externalUserId=${encodeURIComponent(userId)}/one`, undefined, true),
		applicant: (id) => call<SumsubApplicant>('GET', `/resources/applicants/${encodeURIComponent(id)}/one`, undefined, true),
	};
}
