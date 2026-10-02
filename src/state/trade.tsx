import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ASSETS, PROVIDERS, type Asset, type Provider, type Tab } from '../lib/data';
import { defaultAmount } from '../lib/quote';
import type { Quote } from '../lib/quote';
import { buildOrder, type Order } from '../lib/orders';
import type { QuoteParams } from '../lib/api';
import { loadProvider, saveProvider, type Wallet } from '../lib/wallet';
import { useAuth } from '../auth/AuthContext';
import { useBalances } from './balances';
import { loadState, saveState } from '../lib/persist';

interface TradeState {
  tab: Tab;
  amount: string;
  setAmount: (s: string) => void;
  from: Asset;
  to: Asset;
  setAsset: (side: 'from' | 'to', a: Asset) => void;
  providerId: string | null;
  provider: Provider | null;
  setProvider: (id: string) => void;
  wallet: Wallet;
  setWallet: (w: Wallet) => void;
  /** mobile money number for sell payouts (E.164); null = not entered yet */
  phone: string | null;
  setPhone: (p: string) => void;
  amountOk: boolean;
  confirmAmount: () => void;
  switchTab: (t: Tab) => void;
  params: QuoteParams;
  /** wallet balance of the paid asset (null = unknown) */
  balance: number | null;
  /** the quote-locked order awaiting confirmation (persisted so a reload resumes the review) */
  draft: Order | null;
  lockDraft: (quote: Quote, amount: number) => Order;
  /** re-quote of the locked draft: keeps id, restarts the 30s window */
  requoteDraft: (quote: Quote) => void;
  clearDraft: () => void;
}

const Ctx = createContext<TradeState | null>(null);
export const useTrade = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('TradeProvider missing');
  return c;
};

export function TradeProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>('swap');
  const [amount, setAmount] = useState(defaultAmount('swap'));
  const [from, setFrom] = useState<Asset>(ASSETS[0]);
  const [to, setTo] = useState<Asset>(ASSETS[1]);
  // last-used provider is preselected, which also skips the "Confirm amount" step
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const remembered = () => { const id = loadProvider(); return PROVIDERS.some((p) => p.id === id) ? id : null; };
  const [providerId, setProviderId] = useState<string | null>(remembered);
  const [amountOk, setAmountOk] = useState(() => remembered() !== null);
  // a pasted address is only valid for the network it was entered for
  const [custom, setCustom] = useState<{ address: string; net: string } | null>(null);
  // live mode never pre-fills the placeholder numbers: a payout must go to a number the user typed
  const [phone, setPhoneState] = useState<string | null>(() => loadState<string | null>('phone', null));
  const setPhone = (p: string) => { setPhoneState(p); saveState('phone', p); };
  const [draft, setDraft] = useState<Order | null>(() => loadState<Order | null>('draft', null));
  useEffect(() => { saveState('draft', draft); }, [draft]);

  const { wallets } = useAuth();
  const balances = useBalances();
  const balance = balances.get(from.sym);
  const own = wallets[from.net as keyof typeof wallets];
  const wallet: Wallet = custom && custom.net === from.net ? { address: custom.address, custom: true } : own ? { address: own, custom: false } : { address: '', custom: false, missing: true };
  const setWallet = (w: Wallet) => setCustom(w.custom ? { address: w.address, net: from.net } : null);
  const provider = PROVIDERS.find((p) => p.id === providerId) ?? null;

  const switchTab = useCallback((t: Tab) => {
    setTab(t);
    setAmount(defaultAmount(t));
    const r = remembered();
    setProviderId(r);
    setAmountOk(r !== null);
    setDraft(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAsset = (side: 'from' | 'to', a: Asset) => {
    // swap needs two distinct assets; picking the other side's asset flips them
    if (tab === 'swap') {
      if (side === 'from' && a.sym === to.sym) setTo(from);
      if (side === 'to' && a.sym === from.sym) setFrom(to);
    }
    (side === 'from' ? setFrom : setTo)(a);
  };

  const params = useMemo<QuoteParams>(() => ({ tab, from, to, provider, wallet: wallet.address, balance }), [tab, from, to, provider, wallet.address, balance]);

  const value = useMemo<TradeState>(() => ({
    tab, amount, setAmount, from, to, setAsset, providerId, provider, wallet, setWallet, phone, setPhone,
    setProvider: (id: string) => { setProviderId(id); saveProvider(id); },
    amountOk, confirmAmount: () => setAmountOk(true),
    switchTab, params, balance, draft,
    lockDraft: (quote, n) => {
      const o = buildOrder(tab, from, to, provider, quote, n, wallet.address, undefined, { phone: tab === 'sell' ? phone : null });
      setDraft(o);
      return o;
    },
    requoteDraft: (quote) => setDraft((d) => (d ? buildOrder(d.tab, d.from, d.to, d.provider, quote, d.amount, d.wallet, { id: d.id, createdAt: d.createdAt }, { phone: d.phone }) : d)),
    clearDraft: () => setDraft(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tab, amount, from, to, providerId, provider, amountOk, draft, wallet.address, wallet.custom, phone, params, balance, switchTab]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
