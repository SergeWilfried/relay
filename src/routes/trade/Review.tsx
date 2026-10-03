import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { BackHeader } from '../../components/BackHeader';
import { fetchQuote, submitApi, useSubmit } from '../../lib/api';
import { lenStep } from '../../lib/format';
import { mmss, useNow, useOnline } from '../../lib/net';
import { QUOTE_TTL_MS, submitDraft } from '../../lib/orders';
import { useAuth } from '../../auth/AuthContext';
import { createServerBuy, createServerOrder } from '../../lib/serverOrders';
import { createServerSwap } from '../../lib/swapLive';
import { useT } from '../../i18n';
import { kycRequiredMessage } from '../../lib/kycLive';
import { useApp } from '../../state/app';
import { useTrade } from '../../state/trade';

type Phase = 'live' | 'refreshing' | 'error';

export default function Review() {
  const nav = useNavigate();
  const { t } = useT();
  const { state } = useLocation() as { state: { confirm?: boolean } | null };
  const { draft, requoteDraft, clearDraft } = useTrade();
  const { needsKyc, addOrder } = useApp();
  const online = useOnline();
  const auth = useAuth();
  const now = useNow(!!draft, 500);
  const { run, busy, error } = useSubmit();
  const [phase, setPhase] = useState<Phase>('live');
  const [moved, setMoved] = useState<{ before: string; after: string } | null>(null);
  const leaving = useRef(false);
  const autoDone = useRef(false);

  const remaining = draft ? Math.max(0, draft.quoteExpiresAt - now) : 0;
  const expired = !!draft && remaining === 0;

  /** Re-quote the locked order. If the price moved, tell the user and make them re-confirm the new numbers. */
  const refresh = useCallback(async () => {
    if (!draft) return;
    setPhase('refreshing');
    try {
      const q = await fetchQuote({ tab: draft.tab, from: draft.from, to: draft.to, provider: draft.provider, wallet: draft.wallet }, draft.amount, { refresh: true });
      if (q.summaryTo !== draft.quote.summaryTo) setMoved({ before: draft.quote.summaryTo, after: q.summaryTo });
      requoteDraft(q);
      setPhase('live');
    } catch { setMoved(null); setPhase('error'); }
  }, [draft, requoteDraft]);

  // auto-refresh at expiry (waits for the network to come back)
  useEffect(() => { if (expired && phase === 'live' && online) refresh(); }, [expired, phase, online, refresh]);

  // swaps run from the customer's own wallet: they authorise Relay's server (a signer) once per wallet before the first swap
  const swapNet = draft?.from.net === 'Solana' ? 'Solana' : 'Ethereum';
  const needsSigner = auth.mode === 'privy' && draft?.tab === 'swap' && !auth.swapReady(swapNet);
  const enable = () => run(async () => { await auth.enableSwaps(swapNet); });
  // identity check: only for orders above the threshold (the server enforces it too)
  const kycNeeded = !!draft && needsKyc(draft.tab === 'buy' ? draft.amount : draft.quote.fcfaGross);
  const canConfirm = !!draft && !expired && phase === 'live' && online && !busy;

  const confirm = () => {
    if (!draft || !canConfirm) return;
    if (kycNeeded) { nav('/trade/verify'); return; }
    run(async () => {
      try {
      await submitApi();
      let order = submitDraft(draft);
      // live mode: the server owns sell orders. It issues the deposit address and later advances the order
      // from the chain's deposit webhook. If it can't, nothing is created locally and the user can retry.
      if (auth.mode === 'privy' && order.tab === 'sell') {
        const s = await createServerOrder(order);
        order = { ...order, synced: true, depositAddress: s.depositAddress, depositLive: s.depositLive, depositExpiresAt: s.expiresAt };
      }
      // swaps: the server runs the rules, then Privy executes the swap from the customer's own wallet
      if (auth.mode === 'privy' && order.tab === 'swap') {
        let w;
        try { w = await createServerSwap(order); }
        catch (e) {
          // the signer was removed or never added: ask for the consent again instead of failing
          if ((e as { code?: string }).code === 'signer_required') await auth.enableSwaps(swapNet).then(async () => { w = await createServerSwap(order); });
          else throw e;
        }
        order = { ...order, synced: true, swap: w ?? null, startedAt: Date.now() };
      }
      // purchases: the server fixes the quote and the payment method; the customer then pays from the Pay screen
      if (auth.mode === 'privy' && order.tab === 'buy') {
        const b = await createServerBuy(order);
        order = { ...order, synced: true, buy: b, startedAt: null };
      }
      leaving.current = true;
      addOrder(order);
      nav(order.tab === 'sell' ? `/trade/deposit/${order.id}` : order.tab === 'buy' && order.synced ? `/trade/pay/${order.id}` : `/trade/status/${order.id}`, { replace: true });
      clearDraft();
      } catch (e) {
        // the server decides who needs the identity check: send the user there instead of showing a dead end
        if (e instanceof Error && e.message === kycRequiredMessage()) { nav('/trade/verify'); return; }
        throw e;
      }
    });
  };

  // returning from identity verification: confirm straight away, but only if the quote is still the one they saw
  useEffect(() => {
    if (state?.confirm && !autoDone.current && draft && canConfirm && !moved && !kycNeeded) { autoDone.current = true; confirm(); }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) return leaving.current ? null : <Navigate to="/trade/swap" replace />;
  const q = draft.quote;
  const sum = `${q.summaryFrom} → ${q.summaryTo}`;
  const low = remaining > 0 && remaining <= 8000;

  return (
    <>
      <BackHeader title={t('Review order')} to={`/trade/${draft.tab}`} />
      {moved && (
        <div className="notice warn" role="status">
          <b>{t('Rate updated.')}</b> {t("You'll now get {after} instead of {before}. Please review before confirming.", { after: moved.after, before: moved.before })}
        </div>
      )}
      <div className="tile">
        {/* font steps down with text length on phones so long amounts stay on one line */}
        <div className="sum" data-len={lenStep(sum, 20, 26)}>{sum}</div>
      </div>
      <div className="kv">
        {q.rows.map(([k, v]) => <div className="kv-r" key={k}><div>{k}</div><div>{v}</div></div>)}
      </div>

      {needsSigner && (
        <div className="notice" role="status">
          <b>{t('Allow swaps from your wallet.')}</b> {t('You approve this once. Relay can then run swaps for you, and only swaps: your funds stay in your wallet.')}
        </div>
      )}
      <ActionButton onClick={needsSigner ? enable : confirm} busy={busy} busyLabel={needsSigner ? t('Waiting for your approval…') : t('Confirming…')} disabled={needsSigner ? !online || expired || phase !== 'live' : !canConfirm && !busy}>
        {phase === 'refreshing' ? t('Refreshing quote…') : !online ? t("You're offline") : phase === 'error' ? t('Quote expired') : needsSigner ? t('Enable swaps') : t('Confirm')}
      </ActionButton>
      <ErrorNote>{error}</ErrorNote>

      {phase === 'error' && (
        <div className="notice warn" style={{ marginTop: 10 }} role="alert">
          <b>{t("Couldn't refresh your quote.")}</b> {t('Nothing has been charged.')}
          <div><button className="notice-act" onClick={refresh}>{t('Try again')}</button></div>
        </div>
      )}
      {!online && phase !== 'error' && <div className="note">{t("Reconnect to continue. We'll refresh your quote automatically.")}</div>}

      {phase === 'refreshing' ? (
        <div className="timer" role="status">{t('Getting a fresh quote…')}</div>
      ) : phase === 'live' && online && (
        <div className={`timer${low ? ' low' : ''}`} role="timer" aria-live="off">
          {t('Quote locked · {time} · refreshes automatically', { time: mmss(remaining) })}
          <div className="bar"><i style={{ width: `${Math.min(100, (remaining / QUOTE_TTL_MS) * 100)}%` }} /></div>
        </div>
      )}
    </>
  );
}
