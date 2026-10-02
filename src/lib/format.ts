const nf = (min: number, max: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });

export const fmtInt = (n: number) => nf(0, 0).format(Math.round(n));
export const fmtCrypto = (n: number, min = 2, max = 4) => nf(min, max).format(n);
/** Parse a user-typed amount ("1,500,000", "1.5") to a number. */
export const parseAmount = (s: string) => {
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
/** Keep digits and a single decimal point. */
export const sanitizeAmount = (s: string, decimals: boolean) => {
  let out = s.replace(/,/g, '').replace(decimals ? /[^\d.]/g : /[^\d]/g, '');
  const i = out.indexOf('.');
  if (i >= 0) out = out.slice(0, i + 1) + out.slice(i + 1).replace(/\./g, '');
  return out;
};
/** Rates and received amounts: 2 decimals at >= 1 (matches the design), 4 below so small values keep precision. */
export const fmtRate = (n: number) => (n >= 1 ? fmtCrypto(n, 2, 2) : n >= 0.01 ? fmtCrypto(n, 4, 4) : fmtCrypto(n, 6, 6));

/** Length bucket used for phone-only font stepping (see `[data-len]` rules in app.css). */
export const lenStep = (text: string, medium: number, large: number): 'm' | 'l' | 'xl' =>
  text.length <= medium ? 'm' : text.length <= large ? 'l' : 'xl';
