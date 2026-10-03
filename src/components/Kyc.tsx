import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n';
import { fmtInt } from '../lib/format';
import { KYC_THRESHOLD_FCFA, syncKyc } from '../lib/kycLive';
import { useApp } from '../state/app';
import { BackHeader } from './BackHeader';

/** Intro screen shown before the partner SDK. `compact` = pool variant. */
export function KycIntro({ onBack, onStart, title, compact }: { onBack: () => void; onStart: () => void; title?: string; compact?: boolean }) {
  const { t } = useT();
  const { kycInfo } = useApp();
  const threshold = kycInfo?.thresholdFcfa ?? KYC_THRESHOLD_FCFA;
  return (
    <>
      <BackHeader title={title ?? t('Verify your identity')} onBack={onBack} />
      <div className="infobox">
        {compact
          ? t('A one-time check is required before your first deposit: government ID + selfie, about 2 minutes, handled by our verification partner.')
          : t('A one-time identity check is required to move more than {amount} FCFA per day. It is handled by our verification partner — Relay never sees or stores your documents.', { amount: fmtInt(threshold) })}
      </div>
      {!compact && (
        <div className="steps" style={{ margin: '18px 6px' }}>
          {[['Government ID', "National ID, passport or driver's licence"], ['Selfie', 'Quick face match — no video call']].map(([title, d], i) => (
            <div className="step" key={title}><div className="step-n">{i + 1}</div><div><div className="step-t">{t(title!)}</div><div className="step-d">{t(d!)}</div></div></div>
          ))}
        </div>
      )}
      <button className="btn" style={compact ? { marginTop: 14 } : undefined} onClick={onStart}>{t('Verify my identity')}</button>
      {!compact && <div className="note">{t('About 2 minutes, usually instant. The rate is refreshed when you come back.')}</div>}
    </>
  );
}

export const VERIFY_PATH = '/kyc/verify';

/**
 * Live mode: the identity check (ID document + liveness) runs on Sumsub's own page in a separate browser tab, so the camera
 * and the verification never depend on this page. Here we wait for the verdict: it comes from the server (Sumsub webhook),
 * and `onApproved` is called only when the server says approved.
 * Demo mode: a simulated approval, so the flow can be tried without a verification partner.
 */
export function KycSdk({ onApproved }: { onApproved: () => void }) {
  const { t } = useT();
  const auth = useAuth();
  const { refreshKyc, kycInfo } = useApp();
  const [phase, setPhase] = useState<'ready' | 'waiting'>('ready');
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const finish = useCallback(() => { if (!done.current) { done.current = true; onApproved(); } }, [onApproved]);

  // the verdict arrives on the server (Sumsub webhook): keep asking while the other tab is open. A manual sync every 4th round
  // covers a missed webhook.
  useEffect(() => {
    if (auth.mode !== 'privy' || phase !== 'waiting') return;
    let n = 0;
    const id = setInterval(() => {
      void (n++ % 4 === 3 ? syncKyc().then(() => refreshKyc()).catch(() => null) : refreshKyc()).then((k) => {
        if (k?.approved) finish();
        else if (k?.status === 'retry') { setError(t(k.message ?? 'We could not complete your check. Please try again.')); setPhase('ready'); }
        else if (k?.status === 'rejected') { setError(t(k.message ?? 'We could not verify your identity. Please contact support.')); setPhase('ready'); }
      });
    }, 3000);
    return () => clearInterval(id);
  }, [auth.mode, phase, refreshKyc, finish, t]);

  const open = () => {
    setError(null);
    // the check runs full-page in its own tab (same app, same sign-in); this page keeps waiting for the verdict
    const tab = window.open(VERIFY_PATH, '_blank');
    if (!tab) { setError(t('Your browser blocked the new tab. Allow pop-ups for this site and try again.')); return; }
    setPhase('waiting');
  };

  if (auth.mode !== 'privy') {
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
  return (
    <>
      <div className="row-between"><h1 className="bh-title" style={{ margin: 0 }}>{t('Identity check')}</h1><span className="tag">{t('Verification partner')}</span></div>
      <div className="infobox">{t('The check opens in a new tab: your ID document, then a quick selfie. Keep this page open, it continues by itself when you are verified.')}</div>
      {error && <div className="notice warn" role="alert">{error}</div>}
      {phase === 'waiting' && (
        <div className="notice" role="status">
          <b>{kycInfo?.status === 'pending' ? t('Checking your documents…') : t('Waiting for your verification…')}</b> {t('This usually takes under a minute once you finish.')}
          <div><a className="notice-act" href={VERIFY_PATH} target="_blank" rel="noreferrer">{t('Reopen the verification tab')}</a></div>
        </div>
      )}
      <button className="btn" style={{ marginTop: 14 }} onClick={open}>
        {phase === 'waiting' ? t('Open it again') : t('Open verification in a new tab')}
      </button>
    </>
  );
}
