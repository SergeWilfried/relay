import { useState } from 'react';
import { decimalSep, fmtCrypto, fmtInt, lenStep, parseAmount, sanitizeAmount } from '../../lib/format';

/** Large centred amount input. `dec` > 0 allows a decimal part (coins); 0 = whole numbers. */
export function BigAmount({ label, value, onChange, unit, sub, dec = 0 }: { label: string; value: string; onChange: (v: string) => void; unit: string; sub: React.ReactNode; dec?: number }) {
  const [focused, setFocused] = useState(false);
  // while typing show exactly what was typed; otherwise a tidy grouped number
  const shown = value === '' ? '' : focused ? value.replace('.', decimalSep()) : dec > 0 ? fmtCrypto(parseAmount(value), 0, Math.min(dec, 8)) : fmtInt(parseAmount(value));
  return (
    <label className="big" style={{ display: 'block' }}>
      <div style={{ fontWeight: 700, fontSize: 12.5 }}>{label}</div>
      <div className="big-v" data-len={lenStep(shown, 9, 11)}>
        {/* hidden mirror sizes the input to its text so the amount + unit centre exactly */}
        <span className="auto" data-v={shown || '0'}>
          <input inputMode={dec > 0 ? 'decimal' : 'numeric'} autoComplete="off" placeholder="0" aria-label={label} value={shown}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onChange={(e) => onChange(sanitizeAmount(e.target.value, dec > 0))} />
        </span>
        <span className="unit" style={{ marginLeft: 6 }}>{unit}</span>
      </div>
      <div className="big-s">{sub}</div>
    </label>
  );
}
