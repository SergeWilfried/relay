import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AmountRow } from '../../components/AmountRow';
import { AssetPicker } from '../../components/AssetPicker';
import { FieldRow } from '../../components/FieldRow';
import { ProviderGrid } from '../../components/ProviderGrid';
import { RateTimeline } from '../../components/RateTimeline';
import { FCFA_COLOR, NETWORK_LOGO, type Asset, type Tab } from '../../lib/data';
import { fmtCrypto, fmtInt, parseAmount } from '../../lib/format';
import { useQuote } from '../../lib/api';
import { useOnline } from '../../lib/net';
import { shortAddr } from '../../lib/quote';
import { WalletSheet } from '../../components/WalletSheet';
import { AccountSheet } from '../../components/AccountSheet';
import { usesAlias, validAccount } from '../../lib/account';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { useFcfaAvatar } from '../../lib/geo';
import { maxSpend } from '../../lib/gas';
import { useLimits } from '../../lib/limits';
import { useTrade } from '../../state/trade';

const isTab = (t?: string): t is Tab => t === 'swap' || t === 'buy' || t === 'sell';
const CTA_KEY: Record<Tab, string> = { swap: 'Review swap', buy: 'Review purchase', sell: 'Review cash out' };

export default function TradeForm() {
  const { tab: param } = useParams();
  const t = useTrade();
  const nav = useNavigate();
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const auth = useAuth();
  const { t: tl } = useT(); // translator (`t` above is the trade state)
  const fcfaAvatar = useFcfaAvatar();
  const limits = useLimits();

  // the URL is the source of truth for the tab; switching resets the form
  useEffect(() => { if (isTab(param) && param !== t.tab) t.switchTab(param); }, [param]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = isTab(param) && param === t.tab;

  // live quote: debounced, fetched from the quote API, with loading/error states
  const { quote: q, status, stale, retry } = useQuote(t.params, t.amount);
  const online = useOnline();
  if (!isTab(param)) return <Navigate to="/trade/swap" replace />;
  if (!ready) return null;

  const tab = t.tab;
  const failed = status === 'error';
  const showPay = tab !== 'swap';
  const needAmt = showPay && !t.amountOk;
  const needProv = showPay && t.amountOk && !t.provider;
  const zero = parseAmount(t.amount) <= 0;
  // buying to a network where the user has no wallet (e.g. Bitcoin) needs an address first
  // live payouts go to a number the user typed; demo mode falls back to the placeholder number
  const byAlias = usesAlias(t.provider);
  const needPhone = tab !== 'swap' && auth.mode === 'privy' && t.amountOk && !!t.provider && !validAccount(t.provider, t.account);
  const needWallet = tab === 'buy' && !!t.wallet.missing && t.amountOk && !!t.provider;
  // transaction limits (see lib/limits.ts): checked against the FCFA value of this order
  const breach = zero ? null : limits.check(q.fcfaGross);
  const breachText = !breach ? null
    : breach.kind === 'perTx' ? tl('Maximum per transaction: {amount} FCFA', { amount: fmtInt(breach.max) })
    : breach.kind === 'daily' ? tl('Daily limit: {amount} FCFA left today', { amount: fmtInt(breach.remaining) })
    : tl('Monthly limit: {amount} FCFA left this month', { amount: fmtInt(breach.remaining) });
  const reviewLabel = tl(CTA_KEY[tab]);
  const cta = !online ? tl("You're offline") : failed ? tl('Quote unavailable') : q.insufficient && !zero ? tl('Insufficient balance') : breach ? tl('Exceeds your limit') : needAmt ? tl('Confirm amount') : needProv ? tl('Choose a provider') : needPhone ? (byAlias ? tl('Add your PI-SPI alias') : tl('Add your mobile money number')) : needWallet ? tl('Add receiving address') : reviewLabel;
  const disabled = !!breach || needPhone || needWallet || !online || failed || zero || stale || q.insufficient || needProv;

  const crypto = (a: Asset): { sym: string; net: string; char: string; color: string; logo?: string; badge?: string; onClick?: () => void } => ({ sym: a.sym, net: a.net, char: a.char, color: a.color, logo: a.logo, badge: NETWORK_LOGO[a.net] });
  const fcfa = (net: string) => ({ sym: 'FCFA', net, char: 'F', color: FCFA_COLOR, logo: fcfaAvatar.logo, badge: t.provider?.logo });
  const provNet = t.provider?.name ?? tl('Mobile money');

  const fromChip = tab === 'buy' ? fcfa(provNet) : { ...crypto(t.from), onClick: () => setPicker('from') };
  const toChip = tab === 'sell' ? fcfa(provNet) : { ...crypto(tab === 'swap' ? t.to : t.from), onClick: () => setPicker(tab === 'swap' ? 'to' : 'from') };

  const go = () => {
    if (disabled && !needAmt) return;
    if (needAmt) { t.confirmAmount(); return; }
    t.lockDraft(q, parseAmount(t.amount));
    nav('/trade/review');
  };

  const maxBtn = tab !== 'buy' && (
    <button type="button" disabled={t.balance === null} onClick={() => t.setAmount(String(maxSpend(t.from.sym, t.balance ?? 0)))}>{tl('Max')}</button>
  );
  const fromSub = tab === 'sell'
    ? <>{tl('Balance')} {t.balance === null ? '—' : fmtCrypto(t.balance, 2, t.from.dec)} {t.from.sym} · {maxBtn}</>
    : q.fromSub;

  return (
    <>
      <AmountRow
        label={tab === 'sell' ? tl('You sell') : tl('You pay')}
        chip={fromChip}
        sub={breachText ?? (tab === 'sell' ? fromSub : q.fromSub)}
        subError={q.insufficient || !!breach}
        value={t.amount} onChange={t.setAmount} decimals={tab !== 'buy'}
      />
      <RateTimeline rate={q.rate} fee={q.fee} />
      <AmountRow
        label={tab === 'sell' ? tl('You get') : tl('You receive')} chip={toChip} busy={stale && !failed}
        display={failed ? '—' : q.toAmt} subError={failed}
        sub={failed ? <>{tl("Couldn't get a quote")} · <button type="button" onClick={retry}>{tl('Retry')}</button></> : q.toSub}
      />

      {showPay && t.amountOk && (
        <ProviderGrid label={tab === 'buy' ? tl('Pay with') : tl('Cash out to')} selected={t.providerId} onPick={t.setProvider} />
      )}
      {showPay && t.provider && (
        <>
          {tab === 'sell' ? (
            <FieldRow label={byAlias ? tl('Cash out to alias') : tl('Cash out to mobile money number')} value={t.account ?? (auth.mode === 'privy' ? (byAlias ? tl('Add your alias') : tl('Add your number')) : t.provider.number)} hint={t.provider.name} onClick={() => setPhoneOpen(true)} />
          ) : auth.mode === 'privy' ? (
            <FieldRow label={byAlias ? tl('Pay from alias') : tl('Pay from mobile money number')} value={t.account ?? (byAlias ? tl('Add your alias') : tl('Add your number'))} hint={t.provider.name} onClick={() => setPhoneOpen(true)} />
          ) : (
            <FieldRow label={byAlias ? tl('PI-SPI alias') : tl('Mobile money number')} value={t.provider.number} hint={t.provider.name} />
          )}
          {tab === 'buy' && <FieldRow label={tl('Receiving wallet')} value={t.wallet.missing ? tl('Add a {net} address', { net: t.from.net }) : shortAddr(t.wallet.address)} hint={t.wallet.custom ? tl('Custom') : t.from.net} onClick={() => setWalletOpen(true)} />}
        </>
      )}

      <div className="agree">{tl('By clicking “{action}”, you agree to the', { action: reviewLabel })} <a href="#terms">{tl('User Agreement')}</a>.</div>
      <button className="btn" disabled={disabled && !needAmt} onClick={go}>{cta}</button>

      {phoneOpen && t.provider && <AccountSheet operator={t.provider.name} alias={byAlias} current={t.account} onSave={byAlias ? t.setAlias : t.setPhone} onClose={() => setPhoneOpen(false)} />}
      {walletOpen && <WalletSheet net={t.from.net} current={t.wallet} onPick={t.setWallet} onClose={() => setWalletOpen(false)} />}
      {picker && (
        <AssetPicker
          selected={(picker === 'from' ? t.from : t.to).sym}
          onPick={(a) => t.setAsset(picker, a)}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}
