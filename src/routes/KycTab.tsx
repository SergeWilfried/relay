import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { fetchKycToken, syncKyc } from '../lib/kycLive';

const SDK_URL = 'https://static.sumsub.com/idensic/static/sns-websdk-builder.js';

interface SnsBuilder { withConf(c: object): SnsBuilder; withOptions(o: object): SnsBuilder; on(e: string, cb: (p: unknown) => void): SnsBuilder; build(): { launch(sel: string): void } }
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
 * The identity check, full page, opened from the app in its own tab (it shares the sign-in). The SDK only collects the documents;
 * the verdict comes from the server (Sumsub webhook), which the tab that opened this one is waiting for.
 */
export default function KycTab() {
  const { t, lang } = useT();
  const [phase, setPhase] = useState<'loading' | 'sdk' | 'sent' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice: one SDK is enough
    started.current = true;
    (async () => {
      try {
        const first = await fetchKycToken();
        await loadSdk();
        if (!window.snsWebSdk) throw new Error('sdk');
        window.snsWebSdk.init(first.token, async () => (await fetchKycToken()).token)
          .withConf({ lang, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' })
          .withOptions({ addViewportTag: false, adaptIframeHeight: true })
          .on('idCheck.onApplicantSubmitted', () => { setPhase('sent'); void syncKyc().catch(() => null); })
          .build().launch('#kyc-tab-root');
        setPhase('sdk');
      } catch (e) {
        setError(e instanceof Error && e.message !== 'sdk' ? e.message : t('Identity verification is unavailable right now. Please try again later.'));
        setPhase('error');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main style={{ maxWidth: 520, margin: '0 auto', padding: '16px 16px 48px' }}>
      <div className="row-between"><h1 className="bh-title" style={{ margin: 0 }}>{t('Identity check')}</h1><span className="tag">{t('Verification partner')}</span></div>
      {phase === 'loading' && <div className="note" role="status">{t('Loading the verification…')}</div>}
      {phase === 'error' && <div className="notice warn" role="alert">{error}</div>}
      {phase === 'sent' && (
        <div className="notice" role="status">
          <b>{t('Thank you. Your documents were sent.')}</b> {t('You can close this tab and go back to Relay: it continues by itself when you are verified.')}
          <div><button className="notice-act" onClick={() => window.close()}>{t('Close this tab')}</button></div>
        </div>
      )}
      <div id="kyc-tab-root" style={phase === 'error' ? { display: 'none' } : undefined} />
    </main>
  );
}
