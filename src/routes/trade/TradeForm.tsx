import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AmountRow } from '../../components/AmountRow';
import { AssetPicker } from '../../components/AssetPicker';
import { FieldRow } from '../../components/FieldRow';
import { ProviderGrid } from '../../components/ProviderGrid';
import { RateTimeline } from '../../components/RateTimeline';
import { FCFA_COLOR, type Asset, type Tab } from '../../lib/data';
import { fmtCrypto, parseAmount } from '../../lib/format';
import { useQuote } from '../../lib/api';
import { useOnline } from '../../lib/net';
import { shortAddr } from '../../lib/quote';
import { WalletSheet } from '../../components/WalletSheet';
import { useTrade } from '../../state/trade';

const isTab = (t?: string): t is Tab => t === 'swap' || t === 'buy' || t === 'sell';
// keep a little native token back so the wallet can still pay network fees
const GAS_RESERVE: Record<string, number> = { ETH: 0.002, SOL: 0.01 };
const maxSpend = (sym: string, bal: number) => Math.max(0, bal - (GAS_RESERVE[sym] ?? 0));

const CTA: Record<Tab, string> = { swap: 'Review swap', buy: 'Review purchase', sell: 'Review cash out' };

export default function TradeForm() {
  const { tab: param } = useParams();
  const t = useTrade();
  const nav = useNavigate();
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);

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
  const needWallet = tab === 'buy' && !!t.wallet.missing && t.amountOk && !!t.provider;
  const cta = !online ? "You're offline" : failed ? 'Quote unavailable' : q.insufficient && !zero ? 'Insufficient balance' : needAmt ? 'Confirm amount' : needProv ? 'Choose a provider' : needWallet ? 'Add receiving address' : CTA[tab];
  const disabled = needWallet || !online || failed || zero || stale || q.insufficient || needProv;

  const crypto = (a: Asset): { sym: string; net: string; char: string; color: string; logo?: string; onClick?: () => void } => ({ sym: a.sym, net: a.net, char: a.char, color: a.color, logo: a.logo });
  const fcfa = (net: string) => ({ sym: 'FCFA', net, char: 'F', color: FCFA_COLOR });
  const provNet = t.provider?.name ?? 'Mobile money';

  const fromChip = tab === 'buy' ? fcfa(provNet) : { ...crypto(t.from), onClick: () => setPicker('from') };
  const toChip = tab === 'sell' ? fcfa(provNet) : { ...crypto(tab === 'swap' ? t.to : t.from), onClick: () => setPicker(tab === 'swap' ? 'to' : 'from') };

  const go = () => {
    if (disabled && !needAmt) return;
    if (needAmt) { t.confirmAmount(); return; }
    t.lockDraft(q, parseAmount(t.amount));
    nav('/trade/review');
  };

  const maxBtn = tab !== 'buy' && (
    <button type="button" disabled={t.balance === null} onClick={() => t.setAmount(String(maxSpend(t.from.sym, t.balance ?? 0)))}>Max</button>
  );
  const fromSub = tab === 'sell'
    ? <>Balance {t.balance === null ? '—' : fmtCrypto(t.balance, 2, t.from.dec)} {t.from.sym} · {maxBtn}</>
    : q.fromSub;

  return (
    <>
      <AmountRow
        label={tab === 'sell' ? 'You sell' : 'You pay'}
        chip={fromChip}
        sub={tab === 'sell' ? fromSub : q.fromSub}
        subError={q.insufficient}
        value={t.amount} onChange={t.setAmount} decimals={tab !== 'buy'}
      />
      <RateTimeline rate={q.rate} fee={q.fee} />
      <AmountRow
        label={tab === 'sell' ? 'You get' : 'You receive'} chip={toChip} busy={stale && !failed}
        display={failed ? '—' : q.toAmt} subError={failed}
        sub={failed ? <>Couldn't get a quote · <button type="button" onClick={retry}>Retry</button></> : q.toSub}
      />

      {showPay && t.amountOk && (
        <ProviderGrid label={tab === 'buy' ? 'Pay with' : 'Cash out to'} selected={t.providerId} onPick={t.setProvider} />
      )}
      {showPay && t.provider && (
        <>
          <FieldRow label={tab === 'sell' ? 'Cash out to mobile money number' : 'Mobile money number'} value={t.provider.number} hint={t.provider.name} />
          {tab === 'buy' && <FieldRow label="Receiving wallet" value={t.wallet.missing ? `Add a ${t.from.net} address` : shortAddr(t.wallet.address)} hint={t.wallet.custom ? 'Custom' : t.from.net} onClick={() => setWalletOpen(true)} />}
        </>
      )}

      <div className="agree">By clicking “{CTA[tab]}”, you agree to the <a href="#terms">User Agreement</a>.</div>
      <button className="btn" disabled={disabled && !needAmt} onClick={go}>{cta}</button>

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
