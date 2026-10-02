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
	/** accepted but not final; the provider will call our webhook */
	| { state: 'pending'; providerRef: string }
	/** definitively not sent (safe to retry) */
	| { state: 'failed'; error: string };

export interface PayoutWebhookEvent { reference: string; state: 'paid' | 'failed'; error?: string }

export interface PayoutProvider {
	readonly name: string;
	/** Throws on network/timeouts: the outcome is then UNKNOWN and must not be retried automatically. */
	send(req: PayoutRequest): Promise<PayoutOutcome>;
	/** Verifies and parses the provider's status webhook; null = reject. */
	parseWebhook(body: string, headers: Headers, env: Env): Promise<PayoutWebhookEvent | null>;
}
