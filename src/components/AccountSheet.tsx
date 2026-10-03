import { useState } from 'react';
import { normalizeAlias, normalizePhone, validAlias, validPhone } from '../lib/account';
import { useT } from '../i18n';
import { ActionButton } from './ActionButton';
import { Sheet } from './Sheet';

/**
 * Where the FCFA goes to / comes from: the customer's own mobile money number (with country code), or for an alias-based provider
 * (PI-SPI) their alias.
 */
export function AccountSheet({ operator, alias, current, onSave, onClose }: { operator: string; alias: boolean; current: string | null; onSave: (v: string) => void; onClose: () => void }) {
  const { t } = useT();
  const [v, setV] = useState(current ?? '');
  const ok = alias ? validAlias(v) : validPhone(v);
  const showErr = v.trim().length > (alias ? 1 : 4) && !ok;
  return (
    <Sheet title={alias ? t('{operator} alias', { operator }) : t('{operator} number', { operator })} onClose={onClose}>
      <div className="amt edit" style={{ padding: '12px 14px' }}>
        <input className="mono" style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontSize: 16 }}
          {...(alias
            ? { type: 'text', inputMode: 'text' as const, autoComplete: 'off', autoCapitalize: 'none', spellCheck: false, placeholder: 'mon.alias', 'aria-label': t('PI-SPI alias') }
            : { type: 'tel', inputMode: 'tel' as const, autoComplete: 'tel', placeholder: '+225 07 89 45 89', 'aria-label': t('Mobile money number') })}
          aria-invalid={showErr} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      </div>
      {showErr && <div className="note" style={{ color: 'var(--err)', margin: '6px 0 0', textAlign: 'left' }}>{alias ? t('Use 3 to 64 letters, digits or . _ @ + - with no spaces.') : t('Include the country code, for example +225 07 89 45 89.')}</div>}
      <div className="note" style={{ textAlign: 'left' }}>{alias ? t("We'll use this alias for your payment. Double-check it: payouts can't be reversed.") : t("We'll send your FCFA to this number. Double-check it: payouts can't be reversed.")}</div>
      <ActionButton style={{ marginTop: 14 }} disabled={!ok} onClick={() => { onSave(alias ? normalizeAlias(v) : normalizePhone(v)); onClose(); }}>{alias ? t('Save alias') : t('Save number')}</ActionButton>
    </Sheet>
  );
}
