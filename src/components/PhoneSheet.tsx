import { useState } from 'react';
import { Sheet } from './Sheet';
import { ActionButton } from './ActionButton';

export const normalizePhone = (s: string) => s.replace(/[\s\-()]/g, '');
export const validPhone = (s: string) => /^\+\d{8,15}$/.test(normalizePhone(s));

/** Where the FCFA payout goes: the user's own mobile money number, with country code. */
export function PhoneSheet({ operator, current, onSave, onClose }: { operator: string; current: string | null; onSave: (p: string) => void; onClose: () => void }) {
  const [v, setV] = useState(current ?? '');
  const ok = validPhone(v);
  const showErr = v.trim().length > 4 && !ok;
  return (
    <Sheet title={`${operator} number`} onClose={onClose}>
      <div className="amt edit" style={{ padding: '12px 14px' }}>
        <input className="mono" style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontSize: 16 }}
          type="tel" inputMode="tel" autoComplete="tel" placeholder="+225 07 89 45 89" aria-label="Mobile money number" aria-invalid={showErr}
          value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      </div>
      {showErr && <div className="note" style={{ color: '#C43232', margin: '6px 0 0', textAlign: 'left' }}>Include the country code, for example +225 07 89 45 89.</div>}
      <div className="note" style={{ textAlign: 'left' }}>We'll send your FCFA to this number. Double-check it: payouts can't be reversed.</div>
      <ActionButton style={{ marginTop: 14 }} disabled={!ok} onClick={() => { onSave(normalizePhone(v)); onClose(); }}>Save number</ActionButton>
    </Sheet>
  );
}
