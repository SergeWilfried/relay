/** A way to pay for a purchase, as the payment provider says it works (read from its live configuration). */
export interface DepositMethod {
	/** provider code, e.g. ORANGE_CIV */
	code: string;
	/** PROVIDER_AUTH = approve with a PIN on the phone; REDIRECT_AUTH = the customer is sent to the provider's app (Wave); PREAUTH = the customer first gets a one-time code (Orange Burkina Faso) */
	authType: 'PROVIDER_AUTH' | 'REDIRECT_AUTH' | 'PREAUTH' | string;
	status: string;
	min: number;
	max: number;
	/** PROVIDER_AUTH: steps to approve the payment if the prompt doesn't appear by itself (USSD), per language */
	instructions: { en: string[]; fr: string[] } | null;
	/** PREAUTH: steps to get the one-time code, per language */
	codeInstructions: { en: string[]; fr: string[] } | null;
}

export type DepositInit =
	| { state: 'accepted'; depositId: string; nextStep: string | null; authUrl: string | null }
	/** definitively not started (nothing was charged) */
	| { state: 'rejected'; error: string; detail: string; code: string | null };

export type DepositStatus =
	| { state: 'completed' }
	| { state: 'pending'; nextStep: string | null; authUrl: string | null }
	| { state: 'failed'; error: string; detail: string }
	| { state: 'not_found' };

export interface DepositRequest {
	/** our buy order id: the idempotency key (turned into a deterministic UUIDv4) */
	reference: string;
	amountFcfa: number;
	/** E.164 */
	phone: string;
	operator: string;
	/** PREAUTH only: the one-time code the customer was given */
	preAuthCode?: string;
	/** REDIRECT_AUTH only: where the provider sends the customer afterwards */
	successUrl?: string;
	failedUrl?: string;
}

export interface DepositEvent { reference: string; state: 'completed' | 'failed' | 'ignore'; error?: string }

export interface DepositProvider {
	readonly name: string;
	/** How this operator takes payment in this number's country, or null when it can't (unmapped, not enabled on the account, closed). */
	method(operator: string, phone: string): Promise<DepositMethod | null>;
	/** Throws only when the outcome is unknown (the request may have reached the provider). */
	initiate(req: DepositRequest): Promise<DepositInit>;
	status(reference: string): Promise<DepositStatus>;
	parseWebhook(body: string, headers: Headers, url: URL): Promise<DepositEvent | null>;
}
