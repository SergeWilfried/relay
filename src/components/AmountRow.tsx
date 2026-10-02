import { useState, type ReactNode } from 'react';
import { AssetChip } from './AssetChip';
import { fmtInt, parseAmount, sanitizeAmount } from '../lib/format';

interface Chip { sym: string; net: string; char: string; color: string; logo?: string; onClick?: () => void }

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
  const [focused, setFocused] = useState(false);
  const editable = value !== undefined && !!onChange;
  const shown = !editable ? '' : focused ? value : value === '' ? '' : decimals ? tidy(value) : fmtInt(parseAmount(value));
  return (
    <div className={`amt${editable ? ' edit' : ''}`}>
      <div className="amt-main">
        <label className="amt-label" htmlFor={editable ? 'amt-in' : undefined}>{label}</label>
        {editable ? (
          <input
            id="amt-in" className="amt-val" inputMode="decimal" autoComplete="off" placeholder="0"
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
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
