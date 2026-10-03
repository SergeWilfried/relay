import { signAuthorization } from '../privySign.ts';
import type { SwapWallets } from '../swapPlan.ts';

/**
 * Privy's swap wallet action over REST: quote, execute (signed by Relay's signer key, which the customer authorised on their wallet)
 * and the action's status. Docs: https://docs.privy.io/wallets/actions/swap/overview. Import-light so it is unit-tested in plain Node.
 */
const DEFAULT_API = 'https://api.privy.io';

export interface FeeLine { type: string; amount: string }
export interface SwapQuote {
	estOutputAmount: string; minimumOutputAmount: string; inputAmount: string;
	/** native-token base units, an estimate (sponsored by Privy, so the customer doesn't pay it) */
	gasEstimate: string;
	/** cross-chain only: relayer and Privy fees, in USD */
	estimatedFees: FeeLine[];
	/** cross-chain only: unix seconds */
	expiresAt: number | null;
}
export type ActionStatus = 'pending' | 'succeeded' | 'rejected' | 'failed';
export interface SwapAction {
	id: string; status: ActionStatus; inputAmount: string | null; outputAmount: string | null;
	failureReason: string | null; txHash: string | null; referenceId: string | null;
}

export class PrivySwapError extends Error {
	status: number; detail: string; code: 'config' | 'balance' | 'route' | 'rate' | 'other';
	constructor(message: string, status: number, detail: string, code: PrivySwapError['code']) { super(message); this.status = status; this.detail = detail; this.code = code; }
}

/** Privy's documented swap errors -> what a customer may see. The raw text stays in `detail` for logs and alerts. */
export function mapSwapError(status: number, text: string): PrivySwapError {
	const t = text.toLowerCase();
	const detail = text.slice(0, 300);
	if (status === 403 && /not enabled/.test(t)) return new PrivySwapError('Swaps are not available yet', status, detail, 'config');
	if (/gas sponsorship/.test(t)) return new PrivySwapError('Swaps are temporarily unavailable', status, detail, 'config');
	if (/insufficient/.test(t)) return new PrivySwapError('Your balance is too low for this swap', status, detail, 'balance');
	if (/no quotes|route/.test(t) || status === 404) return new PrivySwapError('No route is available for this swap', status, detail, 'route');
	if (status === 429) return new PrivySwapError('Too many requests: try again in a moment', status, detail, 'rate');
	return new PrivySwapError('This swap could not be completed', status, detail, 'other');
}

const bytes = (a: unknown): a is string => typeof a === 'string' && a.length > 0;

export function parseQuote(j: unknown): SwapQuote {
	const q = j as Record<string, unknown>;
	if (!bytes(q?.est_output_amount) || !bytes(q?.minimum_output_amount)) throw new Error('Unexpected swap quote from Privy');
	return {
		estOutputAmount: q.est_output_amount, minimumOutputAmount: q.minimum_output_amount, inputAmount: String(q.input_amount ?? ''),
		gasEstimate: String(q.gas_estimate ?? ''),
		estimatedFees: Array.isArray(q.estimated_fees) ? (q.estimated_fees as { type?: unknown; amount?: unknown }[]).map((f) => ({ type: String(f.type), amount: String(f.amount) })) : [],
		expiresAt: typeof q.expires_at === 'number' ? q.expires_at : null,
	};
}

/** The transaction hash of an action's last on-chain step (EVM `transaction_hash`, Solana `signature`). */
export function txHashOf(steps: unknown): string | null {
	if (!Array.isArray(steps)) return null;
	for (const s of [...steps].reverse()) {
		const st = s as { transaction_hash?: unknown; signature?: unknown };
		if (bytes(st.transaction_hash)) return st.transaction_hash;
		if (bytes(st.signature)) return st.signature;
	}
	return null;
}

export function parseAction(j: unknown): SwapAction {
	const a = j as Record<string, unknown>;
	const status = a?.status;
	if (!bytes(a?.id) || (status !== 'pending' && status !== 'succeeded' && status !== 'rejected' && status !== 'failed')) throw new Error('Unexpected wallet action from Privy');
	const fr = a.failure_reason as { message?: unknown } | undefined;
	return {
		id: a.id, status, inputAmount: typeof a.input_amount === 'string' ? a.input_amount : null, outputAmount: typeof a.output_amount === 'string' ? a.output_amount : null,
		failureReason: bytes(fr?.message) ? fr.message : null, txHash: txHashOf(a.steps), referenceId: typeof a.reference_id === 'string' ? a.reference_id : null,
	};
}

/** A user's embedded wallets, from Privy's user record: id, address, and whether Relay's signer was added ("delegated"). */
export function parseUserWallets(j: unknown): { wallets: SwapWallets; delegated: { ethereum: boolean; solana: boolean } } {
	const out: { wallets: SwapWallets; delegated: { ethereum: boolean; solana: boolean } } = { wallets: {}, delegated: { ethereum: false, solana: false } };
	for (const a of ((j as { linked_accounts?: unknown[] })?.linked_accounts ?? [])) {
		const w = a as { type?: string; wallet_client_type?: string; chain_type?: string; id?: string; address?: string; delegated?: boolean };
		if (w.type !== 'wallet' || w.wallet_client_type !== 'privy' || !w.id || !w.address) continue;
		if (w.chain_type === 'ethereum' || w.chain_type === 'solana') {
			if (!out.wallets[w.chain_type]) { out.wallets[w.chain_type] = { id: w.id, address: w.address }; out.delegated[w.chain_type] = !!w.delegated; }
		}
	}
	return out;
}

export interface PrivySwapClient {
	wallets(userId: string): Promise<ReturnType<typeof parseUserWallets>>;
	quote(walletId: string, body: unknown): Promise<SwapQuote>;
	execute(walletId: string, body: unknown, o: { referenceId: string; idempotencyKey: string }): Promise<SwapAction>;
	action(walletId: string, actionId: string): Promise<SwapAction>;
}

export function createPrivySwapClient(env: Env, deps: { fetch?: typeof fetch } = {}): PrivySwapClient {
	const f = deps.fetch ?? fetch;
	const API = ((env.PRIVY_API_URL as string | undefined) || DEFAULT_API).replace(/\/$/, ''); // overridable so the whole flow can be tested against a local mock
	const base = { 'content-type': 'application/json', 'privy-app-id': env.PRIVY_APP_ID, authorization: `Basic ${btoa(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`)}` };
	const call = async (method: 'GET' | 'POST', path: string, body?: unknown, extra: Record<string, string> = {}) => {
		const res = await f(`${API}${path}`, { method, headers: { ...base, ...extra }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
		const text = await res.text();
		if (!res.ok) throw mapSwapError(res.status, text);
		return JSON.parse(text) as unknown;
	};
	/** Requests that act on a wallet with a signer carry a signature from Relay's key, covering the body and the headers we send. */
	const signed = async (method: 'GET' | 'POST', path: string, body: unknown, headers: Record<string, string>) => {
		if (!env.PRIVY_SIGNER_PRIVATE_KEY) throw new PrivySwapError('Swaps are not available yet', 500, 'PRIVY_SIGNER_PRIVATE_KEY is not set', 'config');
		const sig = await signAuthorization(env.PRIVY_SIGNER_PRIVATE_KEY, { method, url: `${API}${path}`, body, headers: { 'privy-app-id': env.PRIVY_APP_ID, ...headers } });
		return { 'privy-authorization-signature': sig, ...headers };
	};
	return {
		async wallets(userId) { return parseUserWallets(await call('GET', `/v1/users/${encodeURIComponent(userId)}`)); },
		async quote(walletId, body) { return parseQuote(await call('POST', `/v1/wallets/${encodeURIComponent(walletId)}/swap/quote`, body)); },
		async execute(walletId, body, o) {
			const path = `/v1/wallets/${encodeURIComponent(walletId)}/swap`;
			const payload = { ...(body as object), reference_id: o.referenceId };
			return parseAction(await call('POST', path, payload, await signed('POST', path, payload, { 'privy-idempotency-key': o.idempotencyKey })));
		},
		async action(walletId, actionId) {
			const path = `/v1/wallets/${encodeURIComponent(walletId)}/actions/${encodeURIComponent(actionId)}?include=steps`;
			return parseAction(await call('GET', path));
		},
	};
}
