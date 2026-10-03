/**
 * Where a payout goes to / a payment comes from: a mobile money NUMBER, or for PI-SPI (an alias-based instant payment system) the
 * customer's ALIAS. worker/lists.ts holds the same alias rule (test/account.test.ts keeps them equal), because the server validates too.
 * Import-free on purpose, so it is unit-tested in plain Node.
 */
export const normalizePhone = (s: string) => s.replace(/[\s\-()]/g, '');
export const validPhone = (s: string) => /^\+\d{8,15}$/.test(normalizePhone(s));

/** 3 to 64 characters: letters, digits and . _ @ + - (so e-mail-like and phone-like aliases both fit), no spaces. Not a stricter format than the scheme's own. */
export const ALIAS_RE = /^[A-Za-z0-9+][A-Za-z0-9._@+-]{2,63}$/;
export const normalizeAlias = (s: string) => s.trim();
export const validAlias = (s: string) => ALIAS_RE.test(normalizeAlias(s));

/** Does this provider identify the customer by an alias rather than a phone number? */
export const usesAlias = (p: { alias?: boolean } | null | undefined) => !!p?.alias;

/** Is `value` a usable account for this provider (an alias for PI-SPI, a number for the others)? */
export const validAccount = (p: { alias?: boolean } | null | undefined, value: string | null | undefined) =>
  !!value && (usesAlias(p) ? validAlias(value) : validPhone(value));
