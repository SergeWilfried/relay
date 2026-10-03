/**
 * Rate limiting with Cloudflare's Rate Limiting bindings (wrangler.jsonc "ratelimits"). Counters are per Cloudflare location and
 * eventually consistent, so these are abuse guards (cost and brute force), not exact quotas. Import-free so plain Node can test it.
 *
 *  - RL_IP     every non-webhook /api request, by client IP. Generous on purpose: mobile carriers in West Africa put many customers behind one IP.
 *  - RL_ADMIN  /api/admin/*, by client IP, BEFORE the key is compared (brute-force guard). The admin screens poll, so it is not tiny.
 *  - RL_USER   every authenticated request, by user id (set after the token is verified, so a forged id can't dodge it).
 *  - RL_QUOTE  authenticated calls that hit a paid third party (swap quotes, KYC sync), by user id.
 *  - RL_WRITE  authenticated actions that create something or cost money (order, swap, KYC token), by user id.
 * Webhooks are not limited: they are signature-verified and come from a few provider addresses.
 * A limiter that errors (or is not configured, as in plain tests) lets the request through: it must never take the API down.
 */
export type Bucket = 'read' | 'quote' | 'write';

export interface Limiters { RL_IP?: RateLimit; RL_ADMIN?: RateLimit; RL_USER?: RateLimit; RL_QUOTE?: RateLimit; RL_WRITE?: RateLimit }

export async function allow(limiter: RateLimit | undefined, key: string): Promise<boolean> {
	if (!limiter) return true;
	try { return (await limiter.limit({ key })).success; }
	catch (e) { console.warn(JSON.stringify({ msg: 'ratelimit.error', error: e instanceof Error ? e.message : String(e) })); return true; }
}

export const clientIp = (request: Request): string => request.headers.get('cf-connecting-ip') ?? 'unknown';

/** Which per-user bucket a request falls in, besides the general one. */
export function bucketOf(method: string, pathname: string): Bucket {
	if (method === 'GET' || method === 'HEAD') return 'read';
	if (pathname === '/api/swap/quote' || pathname === '/api/kyc/sync') return 'quote';
	return 'write';
}

/** True when the request may go on. Call after the user is authenticated. */
export async function allowUser(env: Limiters, userId: string, method: string, pathname: string): Promise<boolean> {
	if (!(await allow(env.RL_USER, userId))) return false;
	const b = bucketOf(method, pathname);
	if (b === 'quote') return allow(env.RL_QUOTE, userId);
	if (b === 'write') return allow(env.RL_WRITE, userId);
	return true;
}

export const tooMany = (): Response =>
	Response.json({ error: 'Too many requests. Please slow down and try again shortly.' }, { status: 429, headers: { 'retry-after': '60' } });

/** Headers for every API response: JSON is never cached or sniffed, never framed, and leaks no referrer. */
export function secureApi(res: Response): Response {
	const out = new Response(res.body, res);
	out.headers.set('cache-control', 'no-store');
	out.headers.set('x-content-type-options', 'nosniff');
	out.headers.set('referrer-policy', 'no-referrer');
	out.headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
	out.headers.set('cross-origin-resource-policy', 'same-origin');
	return out;
}
