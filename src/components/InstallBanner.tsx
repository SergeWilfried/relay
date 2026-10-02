import type { useInstall } from '../lib/pwa';
import { useT } from '../i18n';

const ShareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Partager" style={{ verticalAlign: '-2px' }}>
    <path d="M8 1.5v8M5 4.5l3-3 3 3M3.5 7.5v6h9v-6" />
  </svg>
);

export function InstallBanner({ mode, install, dismiss }: ReturnType<typeof useInstall>) {
  const { t } = useT();
  if (!mode) return null;
  return (
    <section className="install" aria-label={t('Install Relay')}>
      <div className="logo-mark" style={{ width: 36, height: 36, borderRadius: 11, fontSize: 18 }}>R</div>
      <div className="install-t">
        <div className="install-h">{t('Install Relay')}</div>
        <div className="install-s">
          {mode === 'ios'
            ? <>{t('Tap')} <ShareIcon /> {t('then “Add to Home Screen” for the full-screen app.')}</>
            : t('Add it to your home screen for faster, full-screen access.')}
        </div>
      </div>
      {mode === 'prompt' && <button className="install-btn" onClick={install}>{t('Install')}</button>}
      <button className="install-x" onClick={dismiss} aria-label={t('Dismiss install banner')}>✕</button>
    </section>
  );
}
