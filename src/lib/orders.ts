import { type Asset, type Provider, type Tab } from './data';
import { fmtCrypto, fmtInt } from './format';
import type { Quote } from './quote';
import { mockFlag } from './mock';
import { depositTargetFor } from './deposit';

export const QUOTE_TTL_MS = 30_000;
export const DEPOSIT_TTL_MS = 15 * 60_000;
export const SETTLE_MS = 1600; // prototype: one step per tick. Production: status comes from the order API.
export const STALL_AFTER_MS = 8_000;

export type Outcome = 'ok' | 'fail' | 'stall';

export interface Order {
  id: string;
  tab: Tab;
  from: Asset;
  to: Asset;
  provider: Provider | null;
  wallet: string;
  quote: Quote;
  amount: number;
  hash: string;
  title: string;
  doneTitle: string;
  sub: string;
  doneSub: string;
  steps: [string, string][];
  createdAt: number;
  /** drafts only: absolute time the locked quote stops being valid */
  quoteExpiresAt: number;
  /* lifecycle: set when the order is submitted */
  submitted: boolean;
  awaitingDeposit: boolean;
  depositExpiresAt: number | null;
  startedAt: number | null;
  outcome: Outcome;
  /* sell orders: where to send the crypto, and the tx hash if sent from the Relay wallet */
  depositAddress: string | null;
  depositLive: boolean;
  depositTx: string | null;
  /** true once the order exists on the server (live mode); the server then reports deposit progress */
  synced: boolean;
  /** sell orders: mobile money number the payout goes to (E.164) */
  phone: string | null;
  /** latest status reported by the server for synced orders (null until the first sync) */
  server: { status: 'awaiting_deposit' | 'processing' | 'underpaid'; payout: string | null; payoutError: string | null; note: string | null } | null;
}

const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-3)}`;

export function buildOrder(tab: Tab, from: Asset, to: Asset, provider: Provider | null, quote: Quote, amount: number, wallet: string, keep?: { id: string; createdAt: number }, opts?: { phone?: string | null }): Order {
  const id = keep?.id ?? Date.now().toString(36);
  const now = Date.now();
  const hash = '0x4c9a…e2f7';
  const base = {
    id, tab, from, to, provider: tab === 'swap' ? null : provider, wallet, quote, amount, hash,
    createdAt: keep?.createdAt ?? now, quoteExpiresAt: now + QUOTE_TTL_MS,
    submitted: false, awaitingDeposit: false, depositExpiresAt: null, startedAt: null, outcome: 'ok' as Outcome,
    depositAddress: null as string | null, depositLive: false, depositTx: null as string | null, synced: false, phone: (opts?.phone ?? null) as string | null, server: null as Order['server'],
  };
  const gross = fmtInt(Math.round(quote.fcfaGross / 100) * 100);
  if (tab === 'swap') {
    return { ...base,
      title: 'Routing through the fiat rail…', doneTitle: 'Swap complete', sub: `${from.sym} → FCFA → ${to.sym}`,
      doneSub: `${quote.summaryTo} delivered · 42s`,
      steps: [[`Sold ${quote.summaryFrom}`, `${gross} FCFA onto the fiat rail`], ['FCFA settled', 'Instant clearing'], [`Bought ${quote.summaryTo}`, 'Delivered to your wallet']] };
  }
  const p = provider!;
  const number = opts?.phone ?? p.number; // the number the user entered, else the placeholder (demo)
  if (tab === 'buy') {
    return { ...base,
      title: 'Processing purchase…', doneTitle: `${from.sym} delivered`, sub: `FCFA → ${from.sym}`,
      doneSub: `${quote.summaryTo} in your wallet`,
      steps: [[`${p.name} debited`, `${fmtInt(amount)} FCFA · ${p.number}`], ['FCFA settled', 'Instant clearing'], [`${from.sym} delivered`, `${fmtCrypto(quote.toValue, from.dec, from.dec)} ${from.sym} to ${short(wallet)}`]] };
  }
  const quoteWithNumber = { ...quote, rows: quote.rows.map((r): [string, string] => (r[0] === 'Payout account' ? ['Payout account', `${p.name} ${number}`] : r)) };
  return { ...base, quote: quoteWithNumber,
    title: 'Cashing out…', doneTitle: 'Cash out sent', sub: `${from.sym} → FCFA`,
    doneSub: `${quote.summaryTo} on the way to ${p.name}`,
    steps: [['Deposit received', `${quote.summaryFrom} confirmed on-chain`], ['Sold at market', `${gross} FCFA settled`], [`Sent to ${p.name}`, number]] };
}

/** Turn a locked draft into a live order. Sell orders wait for the on-chain deposit first. */
export function submitDraft(d: Order): Order {
  const now = Date.now();
  const f = mockFlag('order');
  const outcome: Outcome = f === 'fail' ? 'fail' : f === 'stall' ? 'stall' : 'ok';
  const target = d.tab === 'sell' ? depositTargetFor(d.from) : null;
  return { ...d, submitted: true, outcome,
    depositAddress: target?.address ?? null, depositLive: target?.live ?? false,
    awaitingDeposit: d.tab === 'sell',
    depositExpiresAt: d.tab === 'sell' ? now + DEPOSIT_TTL_MS : null,
    startedAt: d.tab === 'sell' ? null : now };
}

export type Phase = 'awaiting_deposit' | 'processing' | 'stalled' | 'done' | 'failed';
export interface Progress { phase: Phase; /** index of the active step (3 = all done) */ step: number }

/** Order progress is a pure function of time, so it survives reloads and leaving the screen. */
export function deriveProgress(o: Order, now: number): Progress {
  // Orders registered with the server follow the server's payout status, not a timer.
  if (o.synced) {
    const s = o.server;
    if (!s || s.status === 'awaiting_deposit') return { phase: 'awaiting_deposit', step: 0 };
    if (s.status === 'underpaid') return { phase: 'failed', step: 0 };
    if (s.payout === 'paid') return { phase: 'done', step: 3 };
    if (s.payout === 'rejected') return { phase: 'failed', step: 1 };
    if (s.payout === 'failed') return { phase: 'failed', step: 2 };
    if (s.payout === 'approved' || s.payout === 'sending') return { phase: 'processing', step: 2 };
    return { phase: 'processing', step: 1 }; // deposit confirmed, payout waiting for approval
  }
  if (o.awaitingDeposit || o.startedAt === null) return { phase: 'awaiting_deposit', step: 0 };
  const elapsed = now - o.startedAt;
  const raw = Math.min(3, Math.floor(elapsed / SETTLE_MS));
  if (o.outcome === 'fail' && raw >= 1) return { phase: 'failed', step: 1 };
  if (o.outcome === 'stall' && raw >= 1) return { phase: elapsed > STALL_AFTER_MS ? 'stalled' : 'processing', step: 1 };
  return { phase: raw >= 3 ? 'done' : 'processing', step: raw };
}

export const inFlight = (o: Order, now: number) => {
  if (!o.submitted) return false;
  const p = deriveProgress(o, now).phase;
  return p === 'awaiting_deposit' || p === 'processing' || p === 'stalled';
};
