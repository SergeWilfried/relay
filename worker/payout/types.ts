export interface PayoutRequest {
	/** Our payout id. Providers must treat it as an idempotency key: the same reference never pays twice. */
	reference: string;
	amountFcfa: number;
	/** E.164 */
	phone: string;
	operator: string;
}

export type PayoutOutcome =
	| { state: 'paid'; providerRef: string }
	/** accepted but not final; the provider will call our webhook (or the status recheck settles it) */
	| { state: 'pending'; providerRef: string }
	/** definitively not sent (safe to retry). `error` is what the customer may see; `detail` is for logs and alerts only. */
	| { state: 'failed'; error: string; detail?: string };

/** `ignore` = a genuine event that needs no action (not final yet, or not a payout). */
export interface PayoutWebhookEvent { reference: string; state: 'paid' | 'failed' | 'ignore'; error?: string }

/** What the provider says about a payout we already sent. `not_found` = the provider never received it. */
export type PayoutStatus = { state: 'paid' } | { state: 'pending' } | { state: 'failed'; error: string } | { state: 'not_found'; error: string };

export interface FloatBalance { country: string; currency: string; balance: number }

export interface PayoutProvider {
	readonly name: string;
	/** Throws on network/timeouts: the outcome is then UNKNOWN and must not be retried automatically. */
	send(req: PayoutRequest): Promise<PayoutOutcome>;
	/** Verifies and parses the provider's status webhook; null = reject. `url` is the URL the provider called (signatures cover the host and path). */
	parseWebhook(body: string, headers: Headers, env: Env, url: URL): Promise<PayoutWebhookEvent | null>;
	/** Whether this provider can pay this operator in this number's country, and an amount this size (checked when an order is created, before the customer sends anything). `true` or the reason it can't, in words a customer may read. */
	supports?(operator: string, phone: string, amountFcfa?: number): Promise<true | string>;
	/** Our prepaid balance with the provider, per country: a payout fails when the wallet of its country is empty. */
	balances?(): Promise<FloatBalance[]>;
	/** Asks the provider for the real state of a payout, to settle missed callbacks and unknown outcomes. */
	status?(reference: string): Promise<PayoutStatus>;
}
