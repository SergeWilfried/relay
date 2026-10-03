import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { AccountIcon, ActivityIcon, PoolIcon, TradeIcon } from '../components/Icons';
import { useApp } from '../state/app';
import { useTheme } from '../state/theme';
import { initials, useAuth } from '../auth/AuthContext';
import { InstallBanner } from '../components/InstallBanner';
import { useInstall } from '../lib/pwa';
import { useNow, useOnline } from '../lib/net';
import { useOrderSync } from '../lib/useOrderSync';
import { useT } from '../i18n';
import { deriveProgress, inFlight } from '../lib/orders';

const Logo = () => (
  <Link to="/trade/sell" className="logo" aria-label="Relay">
    <div className="logo-mark">R</div><div className="logo-text">Relay</div>
  </Link>
);

export function AppShell() {
  const { kyc, orders } = useApp();
  const auth = useAuth();
  const { t } = useT();
  const ethAddr = auth.wallets.Ethereum ?? auth.wallets.Solana ?? null;
  const online = useOnline();
  useOrderSync();
  const live = orders.filter((o) => inFlight(o, Date.now()));
  const now = useNow(live.length > 0);
  const active = orders.find((o) => inFlight(o, now));
  const { theme, setTheme } = useTheme();
  const { pathname } = useLocation();
  const install = useInstall(); // listens for beforeinstallprompt for the whole session, even while the banner is hidden
  const verified = kyc === 'verified';
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

  return (
    <div className="app">
      {/* mobile header */}
      <header className="hd">
        <span className="hd-btn" aria-hidden />{/* keeps the logo centered */}
        <Logo />
        <Link to="/account" className="avatar" aria-label={t('Account')}>{initials(auth.email)}{verified && <span className="avatar-badge">✓</span>}</Link>
      </header>

      {/* desktop top bar */}
      <header className="topbar">
        <div className="topbar-l">
          <Logo />
          <nav className="nav" aria-label={t('Main navigation')}>
            <NavLink to="/trade/sell" className={() => (pathname.startsWith('/trade') ? 'active' : '')}>{t('Trade')}</NavLink>
            <NavLink to="/pool" className={cls}>{t('Pool')}</NavLink>
            <NavLink to="/activity" className={cls}>{t('Activity')}</NavLink>
          </nav>
        </div>
        <div className="topbar-r">
          <div className="seg" role="group" aria-label={t('Theme')}>
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>{t('Light')}</button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>{t('Dark')}</button>
          </div>
          <span className="pill net"><i className="dot" />Ethereum</span>
          {verified && <span className="pill acc">✓ {t('Verified')}</span>}
          {ethAddr && (
            <Link to="/account" className="pill mono" style={{ textDecoration: 'none' }}>
              {ethAddr.slice(0, 5)}…{ethAddr.slice(-3)}{auth.mode === 'demo' ? ' · 2.84 ETH' : ''}
            </Link>
          )}
          {!ethAddr && auth.email && <Link to="/account" className="pill" style={{ textDecoration: 'none' }}>{auth.email}</Link>}
        </div>
      </header>

      <main className="scroll">
        {/* stay out of the way mid-transaction */}
        {!online && <div className="banner offline" role="status">{t("You're offline. Quotes and new orders are paused until you reconnect.")}</div>}
        {active && !/^\/trade\/(deposit|pay|status)/.test(pathname) && (
          <Link className="banner live" to={deriveProgress(active, now).phase === 'awaiting_deposit' ? (active.tab === 'buy' ? `/trade/pay/${active.id}` : `/trade/deposit/${active.id}`) : `/trade/status/${active.id}`}>
            <span>{deriveProgress(active, now).phase === 'awaiting_deposit' ? (active.tab === 'buy' ? t('Waiting for your payment') : t('Waiting for your deposit')) : t('Transaction in progress')} · {active.quote.summaryFrom} → {active.quote.summaryTo}</span><span aria-hidden>›</span>
          </Link>
        )}
        {!/^\/trade\/(review|verify|deposit|pay|status)/.test(pathname) && <InstallBanner {...install} />}
        <Outlet />
      </main>

      <nav className="tabbar" aria-label={t('Main navigation')}>
        <NavLink to="/trade/sell" className={() => (pathname.startsWith('/trade') ? 'active' : '')}><span className="bar" /><TradeIcon />{t('Trade')}</NavLink>
        <NavLink to="/pool" className={cls}><span className="bar" /><PoolIcon />{t('Pool')}</NavLink>
        <NavLink to="/activity" className={cls}><span className="bar" /><ActivityIcon />{t('Activity')}</NavLink>
        <NavLink to="/account" className={cls}><span className="bar" /><AccountIcon />{t('Account')}</NavLink>
      </nav>
    </div>
  );
}
