import { assertSafeBase, normalizeBase, parsePhone, providerCode, SANDBOX_URL, verifyCallback, type KeyFetcher } from '../payout/pawapay.ts';
import type { DepositEvent, DepositInit, DepositMethod, DepositProvider, DepositRequest, DepositStatus } from './types.ts';

/**
 * pawaPay deposits (https://docs.pawapay.io/v2/docs/deposits): collects FCFA (XOF) from a customer's mobile money, the buy flow.
 * Three authentication flows, chosen per provider from its live configuration (`authType`):
 *  - PROVIDER_AUTH : the customer approves with a PIN (a prompt on the phone, or USSD instructions if it doesn't appear)
 *  - REDIRECT_AUTH : Wave. We pass successfulUrl / failedUrl; pawaPay returns an authorizationUrl to send the customer to
 *  - PREAUTH       : Orange Burkina Faso. The customer first generates a one-time code (USSD) and we send it as preAuthorisationCode
 * The order id is the idempotency key (a deterministic UUIDv4), so a retry can never charge twice. ACCEPTED means "started", not paid:
 * the result comes by signed callback or by asking for the deposit's status. This file imports only the import-free pawaPay helpers,
 * so it is unit-tested in plain Node.
 */

export async function depositUuid(reference: string): Promise<string> {
	const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`relay-deposit:${reference}`))).slice(0, 16);
	h[6] = (h[6]! & 0x0f) | 0x40;
	h[8] = (h[8]! & 0x3f) | 0x80;
	const x = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
	return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** What a customer may see for a deposit failure. */
export function friendlyDepositFailure(code: string | undefined): string {
	const c = code ?? '';
	if (c === 'PAYER_NOT_FOUND' || c === 'INVALID_PHONE_NUMBER') return 'This number is not registered with the selected mobile money provider';
	if (c === 'PAYMENT_NOT_APPROVED') return 'The payment was not approved on your phone';
	if (c === 'INSUFFICIENT_BALANCE') return 'Your mobile money balance is too low';
	if (c === 'PAYER_LIMIT_REACHED' || c === 'WALLET_LIMIT_REACHED') return 'A mobile money limit was reached';
	if (c === 'PAYMENT_IN_PROGRESS') return 'Another payment is already waiting on this number';
	if (/AUTH/.test(c) && /CODE|TOKEN|PRE/.test(c)) return 'The code is wrong or has expired';
	if (c === 'AMOUNT_OUT_OF_BOUNDS' || c === 'INVALID_AMOUNT') return 'This amount is outside the provider limits';
	if (c === 'PROVIDER_TEMPORARILY_UNAVAILABLE') return 'Mobile money is temporarily unavailable';
	return 'The payment could not be completed';
}

type Failure = { failureCode?: string; failureMessage?: string } | undefined;
const detailOf = (f: Failure) => [f?.failureCode, f?.failureMessage].filter(Boolean).join(': ') || 'no reason given';

/** Finds `instructions: { en: [{text}], fr: [{text}] }` anywhere inside a configuration fragment (its exact nesting differs per flow). */
export function extractInstructions(node: unknown): { en: string[]; fr: string[] } | null {
	if (!node || typeof node !== 'object') return null;
	const o = node as Record<string, unknown>;
	const ins = o.instructions as Record<string, unknown> | undefined;
	if (ins && typeof ins === 'object' && (Array.isArray(ins.en) || Array.isArray(ins.fr))) {
		const lines = (v: unknown) => (Array.isArray(v) ? v.flatMap((x) => (typeof (x as { text?: unknown })?.text === 'string' ? [(x as { text: string }).text] : typeof x === 'string' ? [x] : [])) : []);
		const en = lines(ins.en), fr = lines(ins.fr);
		return { en: en.length ? en : fr, fr: fr.length ? fr : en };
	}
	for (const v of Object.values(o)) { const r = extractInstructions(v); if (r) return r; }
	return null;
}

/** Pure: pawaPay's active configuration (operationType DEPOSIT) -> the XOF deposit methods on this account. */
export function parseDepositConf(body: unknown): Map<string, DepositMethod> {
	const out = new Map<string, DepositMethod>();
	const countries = (body as { countries?: unknown[] } | null)?.countries;
	for (const c of Array.isArray(countries) ? countries : []) {
		for (const p of (c as { providers?: unknown[] }).providers ?? []) {
			const prov = p as { provider?: string; currencies?: { currency?: string; operationTypes?: { DEPOSIT?: Record<string, unknown> } }[] };
			const d = prov.currencies?.find((x) => x.currency === 'XOF')?.operationTypes?.DEPOSIT;
			if (!prov.provider || !d) continue;
			const authType = typeof d.authType === 'string' ? d.authType : 'PROVIDER_AUTH';
			out.set(prov.provider, {
				code: prov.provider, authType, status: typeof d.status === 'string' ? d.status : 'UNKNOWN',
				min: Number(d.minAmount ?? 0), max: Number(d.maxAmount ?? Infinity),
				instructions: extractInstructions(d.pinPromptInstructions),
				codeInstructions: extractInstructions(d.authTokenInstructions) ?? (authType === 'PREAUTH' ? extractInstructions(d) : null),
			});
		}
	}
	return out;
}

/** OPERATIONAL and DELAYED providers take new payments. */
export const takesDeposits = (m: DepositMethod | undefined): m is DepositMethod => !!m && (m.status === 'OPERATIONAL' || m.status === 'DELAYED');

/** Pure: a check-status answer -> what we know. */
export function classifyDeposit(body: unknown): DepositStatus {
	const b = body as { status?: string; data?: { status?: string; nextStep?: string; authorizationUrl?: string; failureReason?: Failure } } | null;
	if (b?.status === 'NOT_FOUND') return { state: 'not_found' };
	const d = b?.data;
	if (b?.status !== 'FOUND' || !d?.status) return { state: 'pending', nextStep: null, authUrl: null };
	if (d.status === 'COMPLETED') return { state: 'completed' };
	if (d.status === 'FAILED') return { state: 'failed', error: friendlyDepositFailure(d.failureReason?.failureCode), detail: detailOf(d.failureReason) };
	return { state: 'pending', nextStep: d.nextStep ?? null, authUrl: typeof d.authorizationUrl === 'string' ? d.authorizationUrl : null };
}

export interface DepositDeps { fetch?: typeof fetch; cache?: { get(k: string): Promise<string | null>; put(k: string, v: string, o: { expirationTtl: number }): Promise<void> } }

export function createPawapayDepositProvider(env: Env, deps: DepositDeps = {}): DepositProvider {
	const base = normalizeBase((env.PAWAPAY_BASE_URL as string | undefined) || SANDBOX_URL);
	assertSafeBase(base, (env.LIVE as string) === 'true');
	if (!env.PAWAPAY_API_TOKEN) throw new Error('PAWAPAY_API_TOKEN is not set');
	const doFetch = deps.fetch ?? fetch;
	const auth = { authorization: `Bearer ${env.PAWAPAY_API_TOKEN}`, 'content-type': 'application/json' };

	const status = async (reference: string): Promise<DepositStatus> => {
		const res = await doFetch(`${base}/v2/deposits/${await depositUuid(reference)}`, { headers: auth, signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new Error(`pawaPay deposit status failed (${res.status})`);
		return classifyDeposit(await res.json());
	};

	const publicKey: KeyFetcher = async (keyid) => {
		const cached = await deps.cache?.get(`pawapay:key:${keyid}`);
		if (cached) return cached;
		const res = await doFetch(`${base}/v2/public-key/http`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return null;
		const hit = ((await res.json()) as { id?: string; key?: string }[]).find((k) => k.id === keyid)?.key ?? null;
		if (hit) await deps.cache?.put(`pawapay:key:${keyid}`, hit, { expirationTtl: 3600 });
		return hit;
	};

	return {
		name: 'pawapay',

		async method(operator, phone) {
			const code = providerCode(operator, phone);
			const phoneInfo = parsePhone(phone);
			if (!code || !phoneInfo) return null;
			try {
				const key = `pawapay:depconf:${phoneInfo.country}`;
				const cached = await deps.cache?.get(key);
				let conf: Map<string, DepositMethod>;
				if (cached) conf = new Map(JSON.parse(cached) as [string, DepositMethod][]);
				else {
					const res = await doFetch(`${base}/v2/active-conf?country=${phoneInfo.country}&operationType=DEPOSIT`, { headers: auth, signal: AbortSignal.timeout(8_000) });
					if (!res.ok) return null;
					conf = parseDepositConf(await res.json());
					await deps.cache?.put(key, JSON.stringify([...conf]), { expirationTtl: 600 });
				}
				const m = conf.get(code);
				return takesDeposits(m) ? m : null;
			} catch { return null; } // can't read the configuration: don't sell what we can't be sure we can collect
		},

		status,

		async initiate(req: DepositRequest): Promise<DepositInit> {
			const phone = parsePhone(req.phone);
			const code = providerCode(req.operator, req.phone);
			if (!phone || !code) return { state: 'rejected', error: 'This provider is not available for your number', detail: 'no pawaPay provider for this operator and number', code: null };
			const depositId = await depositUuid(req.reference);
			const body: Record<string, unknown> = {
				depositId, amount: String(req.amountFcfa), currency: 'XOF',
				payer: { type: 'MMO', accountDetails: { phoneNumber: phone.msisdn, provider: code } },
				customerMessage: 'Relay purchase', clientReferenceId: req.reference,
			};
			if (req.preAuthCode) body.preAuthorisationCode = req.preAuthCode;
			if (req.successUrl) body.successfulUrl = req.successUrl;
			if (req.failedUrl) body.failedUrl = req.failedUrl;
			try {
				const res = await doFetch(`${base}/v2/deposits`, { method: 'POST', headers: auth, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
				const j = (await res.json().catch(() => null)) as { status?: string; nextStep?: string; authorizationUrl?: string; failureReason?: Failure } | null;
				if (res.status === 200 && (j?.status === 'ACCEPTED' || j?.status === 'DUPLICATE_IGNORED'))
					return { state: 'accepted', depositId, nextStep: j.nextStep ?? null, authUrl: typeof j.authorizationUrl === 'string' ? j.authorizationUrl : null };
				if (j?.status === 'REJECTED' || (res.status >= 400 && res.status < 500))
					return { state: 'rejected', error: friendlyDepositFailure(j?.failureReason?.failureCode), detail: `${res.status} ${detailOf(j?.failureReason)}`, code: j?.failureReason?.failureCode ?? null };
				// 5xx or unreadable: not safe to assume it failed -> ask
			} catch { /* timeout or network error: same */ }
			let s: DepositStatus;
			try { s = await status(req.reference); } catch (e) { throw new Error(`pawaPay deposit outcome unknown: ${e instanceof Error ? e.message : String(e)}`); }
			if (s.state === 'not_found') return { state: 'rejected', error: 'The payment could not be started', detail: 'pawaPay never received the request (NOT_FOUND)', code: null };
			if (s.state === 'failed') return { state: 'rejected', error: s.error, detail: s.detail, code: null };
			return { state: 'accepted', depositId, nextStep: s.state === 'pending' ? s.nextStep : null, authUrl: s.state === 'pending' ? s.authUrl : null };
		},

		async parseWebhook(body: string, headers: Headers, url: URL): Promise<DepositEvent | null> {
			let v: { depositId?: string; clientReferenceId?: string; status?: string; failureReason?: Failure; payoutId?: string };
			try { v = JSON.parse(body); } catch { return null; }
			if (typeof v.depositId !== 'string') return v.payoutId ? { reference: '', state: 'ignore' } : null; // a payout callback is not for this endpoint
			const signed = headers.has('signature') || headers.has('signature-input');
			if (signed && !(await verifyCallback({ method: 'POST', url, headers, body }, publicKey))) return null;
			const reference = typeof v.clientReferenceId === 'string' && /^[A-Za-z0-9]{3,64}$/.test(v.clientReferenceId) ? v.clientReferenceId : null;
			if (!reference) return null; // buy orders always send clientReferenceId; the status call below needs it
			if (signed) {
				if (v.status === 'COMPLETED') return { reference, state: 'completed' };
				if (v.status === 'FAILED') return { reference, state: 'failed', error: friendlyDepositFailure(v.failureReason?.failureCode) };
				return { reference, state: 'ignore' };
			}
			// Unsigned: never trust the body. Ask pawaPay.
			let s: DepositStatus;
			try { s = await status(reference); } catch { return null; }
			if (s.state === 'completed') return { reference, state: 'completed' };
			if (s.state === 'failed') return { reference, state: 'failed', error: s.error };
			return { reference, state: 'ignore' };
		},
	};
}
