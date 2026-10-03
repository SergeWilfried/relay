import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n';
import { fmtInt } from '../lib/format';
import { fetchKycToken, KYC_THRESHOLD_FCFA, syncKyc } from '../lib/kycLive';
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
          : t('A one-time identity check is required for orders above {amount} FCFA. It is handled by our verification partner — Relay never sees or stores your documents.', { amount: fmtInt(threshold) })}
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

const SDK_URL = 'https://static.sumsub.com/idensic/static/sns-websdk-builder.js';

interface SnsBuilder { withConf(c: object): SnsBuilder; withOptions(o: object): SnsBuilder; on(e: string, cb: (p: unknown) => void): SnsBuilder; onMessage(cb: (t: string, p: unknown) => void): SnsBuilder; build(): { launch(sel: string): void; destroy?: () => void } }
declare global { interface Window { snsWebSdk?: { init(token: string, refresh: () => Promise<string>): SnsBuilder } } }

let sdkLoad: Promise<void> | null = null;
const loadSdk = () => (sdkLoad ??= new Promise<void>((resolve, reject) => {
  if (window.snsWebSdk) return resolve();
  const el = document.createElement('script');
  el.src = SDK_URL; el.async = true;
  el.onload = () => resolve();
  el.onerror = () => { sdkLoad = null; reject(new Error('sdk')); };
  document.head.appendChild(el);
}));

/**
 * Live mode: Sumsub's web SDK (ID document + liveness) inside the page. The SDK only collects the documents; the verdict comes
 * from the server (Sumsub webhook), so we poll the server and call `onApproved` only when it says approved.
 * Demo mode: a simulated approval, so the flow can be tried without a verification partner.
 */
export function KycSdk({ onApproved }: { onApproved: () => void }) {
  const { t, lang } = useT();
  const auth = useAuth();
  const { refreshKyc, kycInfo } = useApp();
  const [phase, setPhase] = useState<'loading' | 'sdk' | 'waiting' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  const finish = useCallback(() => { if (!done.current) { done.current = true; onApproved(); } }, [onApproved]);

  // after the SDK reports "submitted", the server learns the verdict from Sumsub: poll until it is final
  const waitForVerdict = useCallback(async () => {
    setPhase('waiting');
    for (let i = 0; i < 40 && !done.current; i++) {
      const k = i % 4 === 3 ? await syncKyc().catch(() => null) : await refreshKyc();
      if (k) await refreshKyc();
      if (k?.approved) return finish();
      if (k && (k.status === 'retry' || k.status === 'rejected')) { setError(t(k.message ?? 'We could not complete your check. Please try again.')); return setPhase(k.status === 'retry' ? 'sdk' : 'error'); }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }, [finish, refreshKyc, t]);

  useEffect(() => {
    if (auth.mode !== 'privy') return;
    let cancelled = false;
    (async () => {
      try {
        const first = await fetchKycToken();
        await loadSdk();
        if (cancelled || !window.snsWebSdk) return;
        window.snsWebSdk.init(first.token, async () => (await fetchKycToken()).token)
          .withConf({ lang, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' })
          .withOptions({ addViewportTag: false, adaptIframeHeight: true })
          .on('idCheck.onApplicantSubmitted', () => { void waitForVerdict(); })
          .on('idCheck.onApplicantStatusChanged', (p) => {
            const r = (p as { reviewStatus?: string } | null)?.reviewStatus;
            if (r === 'pending' || r === 'completed') void waitForVerdict();
          })
          .on('idCheck.onError', () => { /* the SDK shows its own message and lets the user retry */ })
          .build().launch('#kyc-sdk-root');
        setPhase('sdk');
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error && e.message !== 'sdk' ? e.message : t('Identity verification is unavailable right now. Please try again later.')); setPhase('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [auth.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // the verdict can also arrive while the SDK is open (reviewed by an analyst, or finished on another device): keep asking the server
  useEffect(() => {
    if (auth.mode !== 'privy') return;
    const id = setInterval(() => { void refreshKyc().then((k) => { if (k?.approved) finish(); }); }, 5000);
    return () => clearInterval(id);
  }, [auth.mode, refreshKyc, finish]);

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
      {phase === 'loading' && <div className="note" role="status">{t('Loading the verification…')}</div>}
      {phase === 'waiting' && <div className="notice" role="status"><b>{t('Checking your documents…')}</b> {t('This usually takes under a minute. You can stay on this page.')}</div>}
      {error && <div className="notice warn" role="alert">{error}</div>}
      {kycInfo?.status === 'pending' && phase === 'sdk' && <div className="note">{t('Your check is being reviewed.')}</div>}
      <div id="kyc-sdk-root" style={phase === 'error' || phase === 'waiting' ? { display: 'none' } : undefined} />
    </>
  );
}
