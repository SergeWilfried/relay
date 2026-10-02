import { fmtInt, lenStep, parseAmount, sanitizeAmount } from '../../lib/format';

export function BigAmount({ label, value, onChange, unit = 'FCFA', sub }: { label: string; value: string; onChange: (v: string) => void; unit?: string; sub: string }) {
  const shown = value === '' ? '' : fmtInt(parseAmount(value));
  return (
    <label className="big" style={{ display: 'block' }}>
      <div style={{ fontWeight: 700, fontSize: 12.5 }}>{label}</div>
      <div className="big-v" data-len={lenStep(shown, 9, 11)}>
        {/* hidden mirror sizes the input to its text so the amount + unit centre exactly */}
        <span className="auto" data-v={shown || '0'}>
          <input inputMode="numeric" autoComplete="off" placeholder="0" aria-label={label} value={shown}
            onChange={(e) => onChange(sanitizeAmount(e.target.value, false))} />
        </span>
        <span className="unit" style={{ marginLeft: 6 }}>{unit}</span>
      </div>
      <div className="big-s">{sub}</div>
    </label>
  );
}
