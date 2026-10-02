import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { BackHeader } from '../../components/BackHeader';
import { fetchQuote, submitApi, useSubmit } from '../../lib/api';
import { lenStep } from '../../lib/format';
import { mmss, useNow, useOnline } from '../../lib/net';
import { QUOTE_TTL_MS, submitDraft } from '../../lib/orders';
import { useAuth } from '../../auth/AuthContext';
import { createServerOrder } from '../../lib/serverOrders';
import { useApp } from '../../state/app';
import { useTrade } from '../../state/trade';

type Phase = 'live' | 'refreshing' | 'error';

export default function Review() {
  const nav = useNavigate();
  const { state } = useLocation() as { state: { confirm?: boolean } | null };
  const { draft, requoteDraft, clearDraft } = useTrade();
  const { kyc, addOrder } = useApp();
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

  const canConfirm = !!draft && !expired && phase === 'live' && online && !busy;

  const confirm = () => {
    if (!draft || !canConfirm) return;
    if (kyc !== 'verified') { nav('/trade/verify'); return; }
    run(async () => {
      await submitApi();
      let order = submitDraft(draft);
      // live mode: the server owns sell orders. It issues the deposit address and later advances the order
      // from the chain's deposit webhook. If it can't, nothing is created locally and the user can retry.
      if (auth.mode === 'privy' && order.tab === 'sell') {
        const s = await createServerOrder(order);
        order = { ...order, synced: true, depositAddress: s.depositAddress, depositLive: s.depositLive, depositExpiresAt: s.expiresAt };
      }
      leaving.current = true;
      addOrder(order);
      nav(order.tab === 'sell' ? `/trade/deposit/${order.id}` : `/trade/status/${order.id}`, { replace: true });
      clearDraft();
    });
  };

  // returning from identity verification: confirm straight away, but only if the quote is still the one they saw
  useEffect(() => {
    if (state?.confirm && !autoDone.current && draft && canConfirm && !moved && kyc === 'verified') { autoDone.current = true; confirm(); }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) return leaving.current ? null : <Navigate to="/trade/swap" replace />;
  const q = draft.quote;
  const sum = `${q.summaryFrom} → ${q.summaryTo}`;
  const low = remaining > 0 && remaining <= 8000;

  return (
    <>
      <BackHeader title="Review order" to={`/trade/${draft.tab}`} />
      {moved && (
        <div className="notice warn" role="status">
          <b>Rate updated.</b> You'll now get {moved.after} instead of {moved.before}. Please review before confirming.
        </div>
      )}
      <div className="tile">
        {/* font steps down with text length on phones so long amounts stay on one line */}
        <div className="sum" data-len={lenStep(sum, 20, 26)}>{sum}</div>
      </div>
      <div className="kv">
        {q.rows.map(([k, v]) => <div className="kv-r" key={k}><div>{k}</div><div>{v}</div></div>)}
      </div>

      <ActionButton onClick={confirm} busy={busy} busyLabel="Confirming…" disabled={!canConfirm && !busy}>
        {phase === 'refreshing' ? 'Refreshing quote…' : !online ? "You're offline" : phase === 'error' ? 'Quote expired' : 'Confirm'}
      </ActionButton>
      <ErrorNote>{error}</ErrorNote>

      {phase === 'error' && (
        <div className="notice warn" style={{ marginTop: 10 }} role="alert">
          <b>Couldn't refresh your quote.</b> Nothing has been charged.
          <div><button className="notice-act" onClick={refresh}>Try again</button></div>
        </div>
      )}
      {!online && phase !== 'error' && <div className="note">Reconnect to continue. We'll refresh your quote automatically.</div>}

      {phase === 'refreshing' ? (
        <div className="timer" role="status">Getting a fresh quote…</div>
      ) : phase === 'live' && online && (
        <div className={`timer${low ? ' low' : ''}`} role="timer" aria-live="off">
          Quote locked · {mmss(remaining)} · refreshes automatically
          <div className="bar"><i style={{ width: `${Math.min(100, (remaining / QUOTE_TTL_MS) * 100)}%` }} /></div>
        </div>
      )}
    </>
  );
}
