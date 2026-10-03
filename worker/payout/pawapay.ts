import type { FloatBalance, PayoutOutcome, PayoutProvider, PayoutRequest, PayoutStatus, PayoutWebhookEvent } from './types';

/**
 * pawaPay payouts (https://docs.pawapay.io/v2/docs/payouts): pays FCFA (XOF) to a customer's mobile money wallet.
 *  - Our payout id is the idempotency key: it is turned into a deterministic UUIDv4 (`payoutId`), so a retry can never pay twice
 *    (pawaPay answers DUPLICATE_IGNORED).
 *  - Initiation: ACCEPTED means "processing", not paid: it settles by callback (signed, RFC 9421) or by the status recheck.
 *    REJECTED is definitive (nothing was sent). A network error or HTTP 500 is NOT: we ask pawaPay for the payout's status
 *    (the documented recovery) and only then decide; if even that fails the outcome stays unknown for a person.
 *  - Callbacks: verified against pawaPay's public key. An unsigned callback is never trusted: its claim is confirmed with a status call.
 * This file imports nothing at runtime, so it is unit-tested in plain Node.
 */

// ---- provider mapping ------------------------------------------------------------------------------------------------

const COUNTRY_BY_DIAL: Record<string, string> = { '225': 'CIV', '221': 'SEN', '226': 'BFA' };
/** Relay operator -> pawaPay provider code, per country. PI-SPI isn't supported by pawaPay, and Moov isn't offered in Côte d'Ivoire. */
const PROVIDERS: Record<string, Record<string, string>> = {
	CIV: { orange: 'ORANGE_CIV', wave: 'WAVE_CIV' },
	SEN: { orange: 'ORANGE_SEN', wave: 'WAVE_SEN' },
	BFA: { orange: 'ORANGE_BFA', moov: 'MOOV_BFA' },
};

/** "+2250789458900" -> { msisdn: "2250789458900", country: "CIV" }, or null for an unsupported country. */
export function parsePhone(e164: string): { msisdn: string; country: string } | null {
	const m = /^\+(\d{8,15})$/.exec(e164);
	if (!m) return null;
	const digits = m[1]!;
	const country = COUNTRY_BY_DIAL[digits.slice(0, 3)];
	return country ? { msisdn: digits, country } : null;
}

export function providerCode(operator: string, phone: string): string | null {
	const p = parsePhone(phone);
	return p ? (PROVIDERS[p.country]?.[operator] ?? null) : null;
}

// ---- what the account can actually pay ------------------------------------------------------------------------------------

export interface ProviderConf { status: string; min: number; max: number; callbackUrl?: string }

/** Pure: reads pawaPay's active configuration (GET /v2/active-conf) into the XOF payout providers that exist on this account. */
export function parseActiveConf(body: unknown): Map<string, ProviderConf> {
	const out = new Map<string, ProviderConf>();
	const countries = (body as { countries?: unknown[] } | null)?.countries;
	for (const c of Array.isArray(countries) ? countries : []) {
		for (const p of (c as { providers?: unknown[] }).providers ?? []) {
			const prov = p as { provider?: string; currencies?: { currency?: string; operationTypes?: { PAYOUT?: { status?: string; minAmount?: string; maxAmount?: string; callbackUrl?: string } } }[] };
			const payout = prov.currencies?.find((x) => x.currency === 'XOF')?.operationTypes?.PAYOUT;
			if (prov.provider && payout) out.set(prov.provider, { status: payout.status ?? 'UNKNOWN', min: Number(payout.minAmount ?? 0), max: Number(payout.maxAmount ?? Infinity), callbackUrl: payout.callbackUrl });
		}
	}
	return out;
}

/** OPERATIONAL and DELAYED (payouts are queued) can take new payouts; CLOSED and anything unknown cannot. */
export const acceptsPayouts = (c: ProviderConf | undefined) => !!c && (c.status === 'OPERATIONAL' || c.status === 'DELAYED');

// ---- idempotency id ---------------------------------------------------------------------------------------------------

/** Deterministic UUIDv4-shaped id from our payout id (pawaPay requires a UUIDv4): the same payout always maps to the same id. */
export async function payoutUuid(reference: string): Promise<string> {
	const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`relay-payout:${reference}`))).slice(0, 16);
	h[6] = (h[6]! & 0x0f) | 0x40; // version 4
	h[8] = (h[8]! & 0x3f) | 0x80; // variant 10xx
	const x = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
	return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// ---- messages ----------------------------------------------------------------------------------------------------------

/** What a customer may see. The raw pawaPay code stays in logs and alerts: some codes (our own wallet is empty) are not the customer's business. */
export function friendlyFailure(code: string | undefined): string {
	switch (code) {
		case 'RECIPIENT_NOT_FOUND': case 'INVALID_PHONE_NUMBER': return 'This number is not registered with the selected mobile money provider';
		case 'WALLET_LIMIT_REACHED': return 'The recipient has reached a mobile money limit';
		case 'AMOUNT_OUT_OF_BOUNDS': case 'INVALID_AMOUNT': return 'This amount is outside the provider limits';
		case 'PAWAPAY_WALLET_OUT_OF_FUNDS': case 'PROVIDER_TEMPORARILY_UNAVAILABLE': return 'Payouts are temporarily unavailable';
		default: return 'The payout could not be completed';
	}
}

type Failure = { failureCode?: string; failureMessage?: string } | undefined;
const detailOf = (f: Failure) => [f?.failureCode, f?.failureMessage].filter(Boolean).join(': ') || 'no reason given';

/** Pure: pawaPay's check-status answer -> what we know. */
export function classifyStatus(body: unknown): PayoutStatus {
	const b = body as { status?: string; data?: { status?: string; failureReason?: Failure } } | null;
	if (b?.status === 'NOT_FOUND') return { state: 'not_found', error: 'pawaPay did not receive this payout' };
	const d = b?.data;
	if (b?.status !== 'FOUND' || !d?.status) return { state: 'pending' };
	if (d.status === 'COMPLETED') return { state: 'paid' };
	if (d.status === 'FAILED') return { state: 'failed', error: friendlyFailure(d.failureReason?.failureCode) };
	return { state: 'pending' }; // ACCEPTED, ENQUEUED, PROCESSING, IN_RECONCILIATION: still moving
}

// ---- callback signature (RFC 9421) ---------------------------------------------------------------------------------------

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const B64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const eq = (a: string, b: string) => { // constant time
	const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
	let d = x.length ^ y.length;
	for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return d === 0;
};

export interface SigParams { label: string; components: string[]; raw: string; alg: string; keyid: string; created: number; expires?: number }

/** Parses `Signature-Input: sig-pp=("@method" "content-digest");alg="ecdsa-p256-sha256";keyid="K";created=1;expires=2`. */
export function parseSignatureInput(header: string): SigParams | null {
	const m = /^([A-Za-z0-9_-]+)=\(([^)]*)\)((?:;[^;]+)*)$/.exec(header.trim());
	if (!m) return null;
	const params = Object.fromEntries([...m[3]!.matchAll(/;([a-z]+)=("[^"]*"|\d+)/g)].map((p) => [p[1]!, p[2]!.replace(/^"|"$/g, '')]));
	const components = [...m[2]!.matchAll(/"([^"]+)"/g)].map((c) => c[1]!);
	if (!params.alg || !params.keyid || !params.created || components.length === 0) return null;
	return { label: m[1]!, components, raw: `(${m[2]})${m[3]}`, alg: params.alg, keyid: params.keyid, created: Number(params.created), expires: params.expires ? Number(params.expires) : undefined };
}

/** The RFC 9421 signature base: one line per covered component, then the signature parameters. */
export function signatureBase(p: SigParams, req: { method: string; url: URL; headers: Headers }): string | null {
	const lines: string[] = [];
	for (const c of p.components) {
		let v: string | null;
		if (c === '@method') v = req.method.toUpperCase();
		else if (c === '@authority') v = req.url.host.toLowerCase();
		else if (c === '@path') v = req.url.pathname;
		else if (c === '@scheme') v = req.url.protocol.replace(':', '');
		else if (c === '@query') v = req.url.search || '?';
		else if (c === '@target-uri') v = req.url.href;
		else if (c.startsWith('@')) return null; // a derived component we don't implement: refuse rather than guess
		else v = req.headers.get(c);
		if (v === null) return null;
		lines.push(`"${c}": ${v.trim()}`);
	}
	lines.push(`"@signature-params": ${p.raw}`);
	return lines.join('\n');
}

const ALGS: Record<string, { import: { name: string; namedCurve: string }; verify: { name: string; hash: string } }> = {
	'ecdsa-p256-sha256': { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
	'ecdsa-p384-sha384': { import: { name: 'ECDSA', namedCurve: 'P-384' }, verify: { name: 'ECDSA', hash: 'SHA-384' } },
};

/** `Content-Digest: sha-512=:base64:` must match the body. */
export async function digestMatches(header: string | null, body: string): Promise<boolean> {
	const m = /^(sha-256|sha-512)=:([A-Za-z0-9+/=]+):$/.exec((header ?? '').trim());
	if (!m) return false;
	const h = await crypto.subtle.digest(m[1] === 'sha-512' ? 'SHA-512' : 'SHA-256', new TextEncoder().encode(body));
	return eq(B64(new Uint8Array(h)), m[2]!);
}

const pemToDer = (pem: string) => b64(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''));

export type KeyFetcher = (keyid: string) => Promise<string | null>;

/**
 * Verifies a signed pawaPay callback: body digest, covered components, algorithm, freshness, then the signature itself
 * against the public key for `keyid`. Returns false on any problem (the caller rejects with 401).
 */
export async function verifyCallback(req: { method: string; url: URL; headers: Headers; body: string }, getKey: KeyFetcher, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): Promise<boolean> {
	const sigInput = req.headers.get('signature-input'), sigHeader = req.headers.get('signature');
	if (!sigInput || !sigHeader) return false;
	const p = parseSignatureInput(sigInput);
	if (!p) return false;
	// the body must be covered, or a valid signature could be reused with a different body
	if (!p.components.includes('content-digest') || !p.components.includes('@method') || !p.components.includes('@path')) return false;
	const alg = ALGS[p.alg];
	if (!alg) return false;
	if (Math.abs(nowSeconds - p.created) > toleranceSeconds) return false; // replay protection
	if (p.expires !== undefined && nowSeconds > p.expires + 60) return false;
	if (!(await digestMatches(req.headers.get('content-digest'), req.body))) return false;
	const sm = new RegExp(`(?:^|,\\s*)${p.label}=:([A-Za-z0-9+/=]+):`).exec(sigHeader);
	if (!sm) return false;
	const base = signatureBase(p, req);
	const pem = base ? await getKey(p.keyid) : null;
	if (!base || !pem) return false;
	try {
		const key = await crypto.subtle.importKey('spki', pemToDer(pem), alg.import, false, ['verify']);
		return await crypto.subtle.verify(alg.verify, key, b64(sm[1]!), new TextEncoder().encode(base));
	} catch { return false; }
}

// ---- the provider ------------------------------------------------------------------------------------------------------

export const PRODUCTION_URL = 'https://api.pawapay.io';
export const SANDBOX_URL = 'https://api.sandbox.pawapay.io';
const KEY_TTL_SECONDS = 3600;

export interface PawapayDeps { fetch?: typeof fetch; keyCache?: { get(k: string): Promise<string | null>; put(k: string, v: string, o: { expirationTtl: number }): Promise<void> } }

/**
 * Money safety: the sandbox moves no money, so it can't be used with LIVE=true; the production API pays real money, so it
 * can't be used while LIVE=false (where deposits are simulated and nothing was actually received).
 */
/** The base URL may be given with or without the API version (https://api.pawapay.io or https://api.pawapay.io/v2). */
export const normalizeBase = (u: string) => u.trim().replace(/\/+$/, '').replace(/\/v\d+$/, '');

export function assertSafeBase(base: string, live: boolean) {
	if (live && /sandbox/i.test(base)) throw new Error('PAWAPAY_BASE_URL points at the pawaPay sandbox but LIVE=true');
	if (!live && normalizeBase(base) === PRODUCTION_URL) throw new Error('PAWAPAY_BASE_URL is pawaPay production but LIVE is not true: that would pay real money for simulated deposits');
}

export function createPawapayProvider(env: Env, deps: PawapayDeps = {}): PayoutProvider {
	const base = normalizeBase((env.PAWAPAY_BASE_URL as string | undefined) || SANDBOX_URL);
	assertSafeBase(base, (env.LIVE as string) === 'true');
	if (!env.PAWAPAY_API_TOKEN) throw new Error('PAWAPAY_API_TOKEN is not set');
	const doFetch = deps.fetch ?? fetch;
	const auth = { authorization: `Bearer ${env.PAWAPAY_API_TOKEN}`, 'content-type': 'application/json' };

	const checkStatus = async (reference: string): Promise<PayoutStatus> => {
		const res = await doFetch(`${base}/v2/payouts/${await payoutUuid(reference)}`, { headers: auth, signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new Error(`pawaPay status check failed (${res.status})`);
		return classifyStatus(await res.json());
	};

	const publicKey: KeyFetcher = async (keyid) => {
		const cached = await deps.keyCache?.get(`pawapay:key:${keyid}`);
		if (cached) return cached;
		const res = await doFetch(`${base}/v2/public-key/http`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return null;
		const keys = (await res.json()) as { id?: string; key?: string }[];
		const hit = keys.find((k) => k.id === keyid)?.key ?? null;
		if (hit) await deps.keyCache?.put(`pawapay:key:${keyid}`, hit, { expirationTtl: KEY_TTL_SECONDS });
		return hit;
	};

	return {
		name: 'pawapay',

		/**
		 * Whether this operator can be paid in this number's country, for this amount: it must be in our mapping AND active on the pawaPay account
		 * (some providers are disabled on a sandbox account), not closed, and the amount within the provider's limits. If the configuration can't be read we fall back to the
		 * mapping alone, so a pawaPay hiccup never blocks every order.
		 */
		async supports(operator, phone, amountFcfa) {
			const NOT_AVAILABLE = 'This provider is not available for your number';
			const code = providerCode(operator, phone);
			if (!code) return NOT_AVAILABLE;
			const country = parsePhone(phone)!.country;
			try {
				const key = `pawapay:conf:${country}`;
				let conf: Map<string, ProviderConf>;
				const cached = await deps.keyCache?.get(key);
				if (cached) conf = new Map(JSON.parse(cached) as [string, ProviderConf][]);
				else {
					const res = await doFetch(`${base}/v2/active-conf?country=${country}&operationType=PAYOUT`, { headers: auth, signal: AbortSignal.timeout(8_000) });
					if (!res.ok) return true;
					conf = parseActiveConf(await res.json());
					await deps.keyCache?.put(key, JSON.stringify([...conf]), { expirationTtl: 600 });
				}
				const c = conf.get(code);
				if (!acceptsPayouts(c)) return NOT_AVAILABLE;
				// the provider's own limits (Orange Senegal, for example, caps a payout far below Relay's): refused now, not after the customer has sent crypto
				if (amountFcfa !== undefined && c && (amountFcfa < c.min || amountFcfa > c.max)) return 'This amount is outside the provider limits';
				return true;
			} catch { return true; }
		},

		status: checkStatus,

		async balances() {
			const res = await doFetch(`${base}/v2/wallet-balances`, { headers: auth, signal: AbortSignal.timeout(10_000) });
			if (!res.ok) throw new Error(`pawaPay wallet balances failed (${res.status})`);
			const j = (await res.json()) as { balances?: { country?: string; currency?: string; balance?: string }[] };
			return (j.balances ?? []).flatMap((b) => (b.country && b.currency && b.balance !== undefined && Number.isFinite(Number(b.balance)) ? [{ country: b.country, currency: b.currency, balance: Number(b.balance) }] : []));
		},

		async send(req: PayoutRequest): Promise<PayoutOutcome> {
			const phone = parsePhone(req.phone);
			const code = providerCode(req.operator, req.phone);
			if (!phone || !code) return { state: 'failed', error: 'This provider is not available for your country', detail: `no pawaPay provider for ${req.operator} ${req.phone.slice(0, 4)}` };
			const payoutId = await payoutUuid(req.reference);
			const body = {
				payoutId, amount: String(req.amountFcfa), currency: 'XOF',
				recipient: { type: 'MMO', accountDetails: { phoneNumber: phone.msisdn, provider: code } },
				customerMessage: 'Relay payout', clientReferenceId: req.reference, // echoed in the callback, so we can find our payout
			};
			try {
				const res = await doFetch(`${base}/v2/payouts`, { method: 'POST', headers: auth, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
				const j = (await res.json().catch(() => null)) as { status?: string; failureReason?: Failure } | null;
				if (res.status === 200 && j?.status === 'ACCEPTED') return { state: 'pending', providerRef: payoutId };
				if (res.status === 200 && j?.status === 'DUPLICATE_IGNORED') return { state: 'pending', providerRef: payoutId }; // already accepted earlier: its callback or the recheck settles it
				if (res.status === 200 && j?.status === 'REJECTED') return { state: 'failed', error: friendlyFailure(j.failureReason?.failureCode), detail: detailOf(j.failureReason) };
				if (res.status >= 400 && res.status < 500) return { state: 'failed', error: 'The payout could not be completed', detail: `pawaPay ${res.status}: ${detailOf(j?.failureReason)}` }; // our request/credentials are wrong: nothing was sent
				// 5xx or an unreadable answer: "not safe to assume the initiation has failed" -> fall through to the status check
			} catch { /* timeout or network error: same */ }
			let s: PayoutStatus;
			try { s = await checkStatus(req.reference); } catch (e) { throw new Error(`pawaPay outcome unknown: ${e instanceof Error ? e.message : String(e)}`); }
			if (s.state === 'paid') return { state: 'paid', providerRef: payoutId };
			if (s.state === 'pending') return { state: 'pending', providerRef: payoutId };
			return { state: 'failed', error: s.state === 'not_found' ? 'The payout could not be completed' : s.error, detail: s.state === 'not_found' ? 'pawaPay never received the request (status NOT_FOUND)' : s.error };
		},

		async parseWebhook(body: string, headers: Headers, _env: Env, url: URL): Promise<PayoutWebhookEvent | null> {
			let v: { payoutId?: string; clientReferenceId?: string; status?: string; failureReason?: Failure; depositId?: string };
			try { v = JSON.parse(body); } catch { return null; }
			if (typeof v.payoutId !== 'string') return v.depositId ? { reference: '', state: 'ignore' } : null; // a deposit callback is not for us

			const signed = headers.has('signature') || headers.has('signature-input');
			if (signed) { if (!(await verifyCallback({ method: 'POST', url, headers, body }, publicKey))) return null; }

			// our payout id: echoed as clientReferenceId, otherwise recovered from the payouts still waiting for a result (the UUID is deterministic)
			const reference = typeof v.clientReferenceId === 'string' && /^[A-Za-z0-9]{3,64}$/.test(v.clientReferenceId) ? v.clientReferenceId : await findByUuid(env, v.payoutId);
			if (!reference) return null;

			if (signed) {
				if (v.status === 'COMPLETED') return { reference, state: 'paid' };
				if (v.status === 'FAILED') return { reference, state: 'failed', error: friendlyFailure(v.failureReason?.failureCode) };
				return { reference, state: 'ignore' };
			}
			// Unsigned: don't trust the body. Ask pawaPay what really happened.
			console.warn(JSON.stringify({ msg: 'pawapay.callback.unsigned', reference }));
			let s: PayoutStatus;
			try { s = await checkStatus(reference); } catch { return null; }
			if (s.state === 'paid') return { reference, state: 'paid' };
			if (s.state === 'failed') return { reference, state: 'failed', error: s.error };
			return { reference, state: 'ignore' };
		},
	};

	async function findByUuid(e: Env, uuid: string): Promise<string | null> {
		const { results } = await e.DB.prepare(`SELECT id FROM payouts WHERE status IN ('sending', 'approved')`).all<{ id: string }>();
		for (const r of results) if ((await payoutUuid(r.id)) === uuid) return r.id;
		return null;
	}
}
