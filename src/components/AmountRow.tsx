import { useRef, useState, type ReactNode } from 'react';
import { AssetChip } from './AssetChip';
import { decimalSep, fmtInt, parseAmount, sanitizeAmount } from '../lib/format';
import { locale, useT } from '../i18n';

interface Chip { sym: string; net: string; char: string; color: string; logo?: string; badge?: string; onClick?: () => void }

interface Props {
  label: string;
  chip: Chip;
  sub: ReactNode;
  subError?: boolean;
  /** read-only (receive) row */
  display?: string;
  busy?: boolean;
  /** editable (send) row */
  value?: string;
  onChange?: (v: string) => void;
  decimals?: boolean;
}

export function AmountRow({ label, chip, sub, subError, display, busy, value, onChange, decimals = true }: Props) {
  useT(); // re-render (number format) when the language changes
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const editable = value !== undefined && !!onChange;
  const shown = !editable ? '' : focused ? value.replace('.', decimalSep()) : value === '' ? '' : decimals ? tidy(value) : fmtInt(parseAmount(value));
  return (
    <div
      className={`amt${editable ? ' edit' : ''}`}
      // the whole row focuses the field (the digits alone are a small target), but not the asset chip or links inside it
      onClick={editable ? (e) => { if (!(e.target as HTMLElement).closest('button, a, input')) input.current?.focus(); } : undefined}
    >
      <div className="amt-main">
        <label className="amt-label" htmlFor={editable ? 'amt-in' : undefined}>{label}</label>
        {editable ? (
          <input
            ref={input} id="amt-in" className="amt-val" inputMode="decimal" autoComplete="off" placeholder="0"
            value={shown}
            onChange={(e) => onChange(sanitizeAmount(e.target.value, decimals))}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          />
        ) : (
          <div className={`amt-val${busy ? ' busy' : ''}`} aria-live="polite">{display}</div>
        )}
        <div className={`amt-sub${subError ? ' err' : ''}`}>{sub}</div>
      </div>
      <AssetChip {...chip} />
    </div>
  );
}

/** "1.5" → "1.50" while keeping extra precision the user typed. */
function tidy(v: string) {
  const n = parseAmount(v);
  if (!v) return '';
  const [, d = ''] = v.split('.');
  const dec = Math.min(Math.max(2, d.length), 6);
  return n.toLocaleString(locale(), { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
