/**
 * What a customer pays on every order, as a share of its FCFA value: 2.5% platform fee (Relay's revenue) plus 2.5% payment
 * service provider (PSP) fee, 5% in total. worker/pricing.ts holds the same numbers (a test keeps them equal), because the
 * server decides what is actually paid out.
 */
export const PLATFORM_FEE = 0.025;
export const PSP_FEE = 0.025;
export const TOTAL_FEE = PLATFORM_FEE + PSP_FEE;

/** Fee amounts for a gross FCFA value (unrounded: the quote screens round when they display). */
export const feesOn = (gross: number) => ({ platform: gross * PLATFORM_FEE, psp: gross * PSP_FEE, total: gross * TOTAL_FEE });

/** The customer's payout is rounded DOWN to whole 100 FCFA (the server does the same), so rounding never costs Relay money. */
export const floor100 = (n: number) => Math.floor(n / 100) * 100;
