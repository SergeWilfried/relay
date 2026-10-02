import { useState } from 'react';
import { PROVIDERS } from '../lib/data';

export function ProviderGrid({ label, selected, onPick }: { label: string; selected: string | null; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const cur = PROVIDERS.find((p) => p.id === selected);
  // once chosen, collapse to a single row; tap to change
  if (cur && !open) {
    return (
      <div>
        <div className="sec-label">{label}</div>
        <button type="button" className="prov on" style={{ width: '100%' }} aria-expanded={false} onClick={() => setOpen(true)}>
          <div className="prov-dot" style={{ background: cur.color, color: cur.fg }}>{cur.char}</div>
          <div className="prov-name">{cur.name}</div>
          <div className="prov-mark" style={{ color: 'var(--mut)' }}>Change ›</div>
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="sec-label">{label}</div>
      <div className="grid2" role="radiogroup" aria-label={label}>
        {PROVIDERS.map((p) => {
          const on = selected === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} className={`prov${on ? ' on' : ''}`} onClick={() => { onPick(p.id); setOpen(false); }}>
              <div className="prov-dot" style={{ background: p.color, color: p.fg }}>{p.char}</div>
              <div className="prov-name">{p.name}</div>
              <div className="prov-mark">{on ? '✓' : ''}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
