import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { shortAddr } from '../lib/quote';
import { LangSwitch } from '../components/LangSwitch';
import { LimitsSection } from '../components/LimitsSection';
import { useT } from '../i18n';
import { useApp } from '../state/app';
import { useTheme } from '../state/theme';

function WalletRow({ net, address, status, error }: { net: 'Ethereum' | 'Solana'; address?: string; status: 'ready' | 'creating' | 'error'; error?: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); } catch { /* clipboard blocked */ }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="field">
      <div style={{ minWidth: 0 }}>
        <div className="field-l">{t('{net} wallet', { net })}</div>
        <div className="field-v" style={{ fontSize: 11.5, color: address ? undefined : 'var(--fnt)' }}>
          {address ? (
            // phones show 0x8f3C…0c21; wider screens show the full address (Copy always copies the full one)
            <><span className="addr-short" title={address}>{shortAddr(address)}</span><span className="addr-full">{address}</span></>
          ) : (status === 'creating' ? t('Setting up…') : error ? t("Couldn't be created") : t('Not set up'))}
        </div>
      </div>
      {address && <button className="copy" onClick={copy}>{copied ? t('Copied ✓') : t('Copy')}</button>}
    </div>
  );
}

export default function Account() {
  const { kyc, kycInfo } = useApp();
  const { theme, setTheme } = useTheme();
  const auth = useAuth();
  const { t } = useT();
  const [out, setOut] = useState(false);
  return (
    <div className="page">
      <div className="card">
        <div className="card-t" style={{ marginBottom: 12 }}>{t('Account')}</div>
        {auth.mode === 'demo' && (
          <div className="notice warn">{t('Demo mode: sign-in is off and wallets are placeholders. Set')} <b>VITE_PRIVY_APP_ID</b> {t('to use Privy.')}</div>
        )}
        {auth.email && <div className="field"><div><div className="field-l">{t('Signed in as')}</div><div className="field-v ellipsis" style={{ fontFamily: 'inherit' }}>{auth.email}</div></div></div>}
        <WalletRow net="Ethereum" address={auth.wallets.Ethereum} status={auth.walletStatus} error={auth.walletErrors.Ethereum} />
        <WalletRow net="Solana" address={auth.wallets.Solana} status={auth.walletStatus} error={auth.walletErrors.Solana} />
        {auth.walletStatus === 'error' && (
          <div className="notice warn" role="alert" style={{ marginTop: 8 }}>
            <b>{t("We couldn't set up your wallet.")}</b>
            {Object.entries(auth.walletErrors).map(([c, m]) => <div key={c} style={{ marginTop: 4 }}>{c}: {m}</div>)}
            <div><button className="notice-act" onClick={auth.retryWallets}>{t('Try again')}</button></div>
          </div>
        )}
        <div className="field"><div><div className="field-l">{t('Identity')}</div><div className="field-v" style={{ fontFamily: 'inherit' }}>{kyc === 'verified' ? `✓ ${t('Verified')}` : kycInfo?.status === 'pending' ? t('Under review') : kycInfo?.status === 'rejected' ? t('Could not be verified') : t('Not verified yet')}</div></div></div>
        <LimitsSection />
        <div className="sec-label">{t('Appearance')}</div>
        <div className="seg" style={{ width: 'fit-content' }} role="group" aria-label={t('Theme')}>
          <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>{t('Light')}</button>
          <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>{t('Dark')}</button>
        </div>
        <div className="sec-label">{t('Language')}</div>
        <LangSwitch />
        {auth.mode === 'privy' && (
          <button className="btn sec" style={{ marginTop: 18 }} disabled={out} onClick={async () => { setOut(true); await auth.logout(); }}>
            {out ? t('Signing out…') : t('Sign out')}
          </button>
        )}
      </div>
    </div>
  );
}
