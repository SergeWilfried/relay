import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, Provider, Tab } from './data';
import { parseAmount } from './format';
import { mockFlag } from './mock';
import { getQuote, type Quote } from './quote';
import { useDebounced } from './useDebounced';
import { quoteSwapLive } from './swapLive';
import { tr, useT } from '../i18n';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface QuoteParams { tab: Tab; from: Asset; to: Asset; provider: Provider | null; wallet: string; balance?: number | null; /** a signed-in live user: swaps are quoted by the server (Privy), not by the local model */ live?: boolean }

/** Quote API stand-in: replace the body with a real request. `refresh` = re-quote of a locked order. */
export async function fetchQuote(p: QuoteParams, amount: number, opts: { refresh?: boolean } = {}): Promise<Quote> {
  if (p.live && p.tab === 'swap') return quoteSwapLive(p, amount);
  await delay(opts.refresh ? 500 : 180);
  const f = mockFlag('quote');
  if (f === 'error') throw new Error('Quote unavailable');
  const mult = opts.refresh && f === 'drift' ? 0.994 : 1;
  return getQuote({ tab: p.tab, amount, from: p.from, to: p.to, balance: p.balance }, p.provider, p.wallet, mult);
}

/** Order / pool submission stand-in. Rejects with a user-facing message. */
export async function submitApi(): Promise<void> {
  await delay(700);
  if (mockFlag('submit') === 'error') throw new Error(tr("We couldn't submit that. Nothing was charged — please try again."));
}

export type QuoteStatus = 'loading' | 'ready' | 'error';

/**
 * Live quote for the form: debounced, fetched from the quote API, with loading and error states.
 * While a request is in flight (or after a failure) it keeps showing the local estimate rather than blanking.
 */
export function useQuote(p: QuoteParams, rawAmount: string) {
  const { lang } = useT(); // quote strings are generated in the active language
  const debounced = useDebounced(rawAmount, 250);
  const [nonce, setNonce] = useState(0);
  const key = `${p.tab}|${p.from.sym}|${p.to.sym}|${p.provider?.id ?? ''}|${p.wallet}|${p.balance ?? 'x'}|${debounced}|${nonce}|${lang}|${p.live ? 'live' : ''}`;
  const local = useMemo(() => getQuote({ tab: p.tab, amount: parseAmount(debounced), from: p.from, to: p.to, balance: p.balance }, p.provider, p.wallet),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.tab, p.from, p.to, p.provider, p.wallet, p.balance, debounced, lang]);
  const [res, setRes] = useState<{ key: string; quote: Quote | null }>({ key: '', quote: null });
  const latest = useRef(key);
  latest.current = key;

  useEffect(() => {
    const amount = parseAmount(debounced);
    if (amount <= 0) { setRes({ key, quote: local }); return; }
    let live = true;
    fetchQuote(p, amount).then(
      (quote) => live && setRes({ key, quote }),
      () => live && setRes({ key, quote: null }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const settled = res.key === key;
  const status: QuoteStatus = !settled ? 'loading' : res.quote ? 'ready' : 'error';
  const quote = settled && res.quote ? res.quote : local;
  const stale = status === 'loading' || debounced !== rawAmount;
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { quote, status, stale, retry };
}

/** Guards a one-shot async action: ignores re-entry while running and surfaces a failure message. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : tr('Something went wrong. Please try again.')); }
    finally { running.current = false; setBusy(false); }
  }, []);
  return { run, busy, error, clearError: () => setError(null) };
}
