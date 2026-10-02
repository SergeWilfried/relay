import { useT } from '../i18n';
import { BackHeader } from './BackHeader';

/** Intro screen shown before the partner SDK. `compact` = pool variant. */
export function KycIntro({ onBack, onStart, title, compact }: { onBack: () => void; onStart: () => void; title?: string; compact?: boolean }) {
  const { t } = useT();
  return (
    <>
      <BackHeader title={title ?? t('Verify your identity')} onBack={onBack} />
      <div className="infobox">
        {compact
          ? t('A one-time check is required before your first deposit: government ID + selfie, about 2 minutes, handled by our verification partner.')
          : t('A one-time check is required before your first transaction. It is handled by our verification partner — Relay never sees or stores your documents.')}
      </div>
      {!compact && (
        <div className="steps" style={{ margin: '18px 6px' }}>
          {[['Government ID', "National ID, passport or driver's licence"], ['Selfie', 'Quick face match — no video call'], ['~2 minutes', 'Most checks clear instantly']].map(([title, d], i) => (
            <div className="step" key={title}><div className="step-n">{i + 1}</div><div><div className="step-t">{t(title!)}</div><div className="step-d">{t(d!)}</div></div></div>
          ))}
        </div>
      )}
      <button className="btn acc" style={compact ? { marginTop: 14 } : undefined} onClick={onStart}>{t('Verify my identity')}</button>
      {!compact && <div className="note">{t('Required once · your quote stays locked')}</div>}
    </>
  );
}

/**
 * Slot for the KYC vendor's web SDK. Mount it in the dashed box and call
 * `onApproved` from the vendor's success callback.
 */
export function KycSdk({ onApproved }: { onApproved: () => void }) {
  const { t } = useT();
  return (
    <>
      <div className="row-between"><h1 className="bh-title" style={{ margin: 0 }}>{t('Identity check')}</h1><span className="tag">{t('Verification partner')}</span></div>
      <div className="sdk" id="kyc-sdk-root">
        <b>{t('Provider SDK mounts here')}</b>
        <p>{t('Document capture → selfie → liveness,')}<br />{t("inside the partner's embedded widget")}</p>
      </div>
      <button className="btn" style={{ marginTop: 14 }} onClick={onApproved}>{t('Simulate approval')}</button>
      <div className="note">{t("Prototype only — wire the provider's success callback to this step")}</div>
    </>
  );
}
