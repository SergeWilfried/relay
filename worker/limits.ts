/**
 * The single source of truth for what a user may move, in FCFA. Everything that mentions a limit derives from here:
 *  - the rule engine (worker/rules.ts: R-02..R-05, K-01),
 *  - `GET /api/limits`, which the Account page and the trade form read,
 *  - the Privy policy builders (scripts/privy-policy-defs.mjs: per-transfer caps and the deposit-wallet caps),
 *  - Sumsub: its level (`SUMSUB_LEVEL`) is what *unlocks* the verified tier; it holds no amounts of its own.
 * test/limits.test.ts fails if the client's offline fallback (src/lib/limits.ts, src/lib/kycLive.ts) drifts from these numbers.
 * Import-free so plain Node (tests, scripts) can load it.
 */
export const MIN_FCFA = 1_000;

/** Without an approved identity check a user may move up to this much per day (and per order). Above it, K-01 asks for the check. */
export const KYC_THRESHOLD_FCFA = 200_000;

export interface TierLimits { perTx: number; daily: number; monthly: number }

export const LIMITS = {
	/** tier 0: no approved identity check. perTx = daily = the KYC threshold, so a large amount can't be split into small orders. */
	unverified: { perTx: KYC_THRESHOLD_FCFA, daily: KYC_THRESHOLD_FCFA, monthly: 10_000_000 },
	/** tier 1: an approved Sumsub check. Flat 2M per transaction and day, 10M per month (tiers beyond this are a config change). */
	verified: { perTx: 2_000_000, daily: 2_000_000, monthly: 10_000_000 },
} as const satisfies Record<string, TierLimits>;

export const tierLimits = (tier: number): TierLimits => (tier >= 1 ? LIMITS.verified : LIMITS.unverified);

/** Privy caps on deposit wallets are this multiple of the largest order, so rate drift never blocks a legitimate sweep. */
export const DEPOSIT_HEADROOM = 2;
