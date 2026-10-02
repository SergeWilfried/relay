import { getLang, locale } from '../i18n';

const nf = (min: number, max: number) => new Intl.NumberFormat(locale(), { minimumFractionDigits: min, maximumFractionDigits: max });

export const fmtInt = (n: number) => nf(0, 0).format(Math.round(n));
export const fmtCrypto = (n: number, min = 2, max = 4) => nf(min, max).format(n);

const WS = /[\s\u00A0\u202F]/g; // spaces, incl. the no-break spaces French grouping uses

/** Parse a user-typed amount ("1 500 000", "1,500,000", "1,5", "1.5") to a number. */
export const parseAmount = (s: string) => {
  let v = s.replace(WS, '');
  if (v.includes(',') && !v.includes('.') && getLang() === 'fr') v = v.replace(',', '.'); // French decimal comma
  else v = v.replace(/,/g, ''); // English grouping
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Keep digits and a single decimal point (a comma counts as the decimal point in French). */
export const sanitizeAmount = (s: string, decimals: boolean) => {
  let out = s.replace(WS, '');
  out = getLang() === 'fr' ? out.replace(/,/g, '.') : out.replace(/,/g, '');
  out = out.replace(decimals ? /[^\d.]/g : /[^\d]/g, '');
  const i = out.indexOf('.');
  if (i >= 0) out = out.slice(0, i + 1) + out.slice(i + 1).replace(/\./g, '');
  return out;
};

/** The decimal separator to show while typing. */
export const decimalSep = () => (getLang() === 'fr' ? ',' : '.');

/** Rates and received amounts: 2 decimals at >= 1 (matches the design), 4 below so small values keep precision. */
export const fmtRate = (n: number) => (n >= 1 ? fmtCrypto(n, 2, 2) : n >= 0.01 ? fmtCrypto(n, 4, 4) : fmtCrypto(n, 6, 6));

/** Length bucket used for phone-only font stepping (see `[data-len]` rules in app.css). */
export const lenStep = (text: string, medium: number, large: number): 'm' | 'l' | 'xl' =>
  text.length <= medium ? 'm' : text.length <= large ? 'l' : 'xl';

/** "8.4%" -> "8,4 %" in French (decimal comma, space before the sign); unchanged in English. */
export const localizePct = (s: string) => (getLang() === 'fr' ? s.replace('.', ',').replace(/\s*%/, '\u202F%') : s);
