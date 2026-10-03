import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { Sheet } from '../../components/Sheet';
import { useSubmit } from '../../lib/api';
import * as api from './api';
import type { AdminRefund, EligibleOrder } from './api';
import { fmtUnits } from './Sweeps';

type Tab = 'todo' | 'sent' | 'all';
const DECIMALS: Record<string, number> = { ETH: 18, SOL: 9, USDT: 6, USDC: 6 };
const amountOf = (asset: string, units: string) => `${fmtUnits(units, DECIMALS[asset] ?? 0)} ${asset}`;
const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const short = (a: string) => (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const tone = (s: AdminRefund['status']) => (s === 'sent' ? 'ok' : s === 'cancelled' ? 'bad' : '');
const explorer = (r: AdminRefund) => (r.tx_hash ? (r.network === 'Solana' ? `https://solscan.io/tx/${r.tx_hash}` : `https://etherscan.io/tx/${r.tx_hash}`) : null);

type Action = { kind: 'start'; o: EligibleOrder } | { kind: 'approve' | 'sent' | 'cancel'; r: AdminRefund };

/** One sheet for every step. Each asks for the analyst's name: it goes in the audit log (and the approver must differ from the requester). */
function ActionSheet({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const { run, busy, error } = useSubmit();
  const [name, setName] = useState(api.getName());
  const [text, setText] = useState(action.kind === 'start' ? (action.o.suggestedDestination ?? '') : '');
  const [reason, setReason] = useState('');
  const title = { start: 'Start a refund', approve: 'Approve refund', sent: 'Record refund sent', cancel: 'Cancel refund' }[action.kind];
  const needsReason = action.kind === 'start' || action.kind === 'cancel';
  const nameOk = name.trim().length >= 2;
  const ready = nameOk && (action.kind === 'approve'
    || (action.kind === 'start' && text.trim().length >= 3 && reason.trim().length >= 5)
    || (action.kind === 'sent' && text.trim().length >= 3)
    || (action.kind === 'cancel' && reason.trim().length >= 3));

  const submit = () => run(async () => {
    api.setName(name.trim());
    if (action.kind === 'start') await api.createRefund({ orderId: action.o.orderId, destination: text.trim(), reason: reason.trim(), by: name.trim() });
    else if (action.kind === 'approve') await api.approveRefund(action.r.id, name.trim());
    else if (action.kind === 'sent') await api.markRefundSent(action.r.id, name.trim(), text.trim());
    else await api.cancelRefund(action.r.id, name.trim(), reason.trim());
    onDone();
  });

  const subject = action.kind === 'start' ? { asset: action.o.asset, units: action.o.depositAmountUnits, id: action.o.orderId, note: action.o.reason } : { asset: action.r.asset, units: action.r.amount_units, id: action.r.order_id, note: action.r.reason };
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="tile" style={{ padding: 16, textAlign: 'left' }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>{amountOf(subject.asset, subject.units)}</div>
        <div className="sub">order {subject.id} · {subject.note}</div>
        {action.kind !== 'start' && <div className="sub mono" style={{ wordBreak: 'break-all' }}>to {action.r.destination}</div>}
      </div>
      {action.kind === 'start' && <div className="note" style={{ textAlign: 'left' }}>Relay holds no treasury key: after a second person approves, you send this from the treasury and record the transaction here. The customer sees the refund on their order.</div>}
      {action.kind === 'approve' && <div className="note" style={{ textAlign: 'left' }}>Check the destination and the amount. You must be a different person from {action.r.requested_by}, who requested it.</div>}
      {action.kind === 'sent' && <div className="note" style={{ textAlign: 'left' }}>Send {amountOf(action.r.asset, action.r.amount_units)} from the treasury to the address above, then paste the transaction hash.</div>}
      <input className="login-in" style={{ marginTop: 10 }} placeholder="Your name (kept in the audit log)" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      {action.kind === 'start' && <input className="login-in mono" style={{ marginTop: 8 }} placeholder="Refund to this address" aria-label="Destination address" value={text} onChange={(e) => setText(e.target.value)} />}
      {action.kind === 'sent' && <input className="login-in mono" style={{ marginTop: 8 }} placeholder="Transaction hash" aria-label="Transaction hash" value={text} onChange={(e) => setText(e.target.value)} />}
      {needsReason && <input className="login-in" style={{ marginTop: 8 }} placeholder={action.kind === 'start' ? 'Why is this being refunded?' : 'Why is it cancelled?'} aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <ErrorNote>{error}</ErrorNote>
      <ActionButton style={{ marginTop: 14 }} className="btn acc" busy={busy} busyLabel="Working…" disabled={!ready} onClick={submit}>
        {{ start: 'Request refund', approve: 'Approve refund', sent: 'Record as sent', cancel: 'Cancel refund' }[action.kind]}
      </ActionButton>
    </Sheet>
  );
}

/** Crypto refunds for sells that can't be paid out (see worker/refunds.ts). */
export default function Refunds({ onAuthError }: { onAuthError: () => void }) {
  const [refunds, setRefunds] = useState<AdminRefund[] | null>(null);
  const [eligible, setEligible] = useState<EligibleOrder[]>([]);
  const [tab, setTab] = useState<Tab>('todo');
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [r, e] = await Promise.all([api.listRefunds(), api.listEligible()]); setRefunds(r); setEligible(e); setError(null); }
    catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not load refunds'); }
  }, [onAuthError]);

  useEffect(() => { void load(); const t = setInterval(() => void load(), 20000); return () => clearInterval(t); }, [load]);

  const open = useMemo(() => (refunds ?? []).filter((r) => r.status === 'requested' || r.status === 'approved'), [refunds]);
  const sent = useMemo(() => (refunds ?? []).filter((r) => r.status === 'sent'), [refunds]);
  const shown = tab === 'todo' ? open : tab === 'sent' ? sent : refunds ?? [];

  return (
    <>
      <div className="admin-tabs" role="tablist" aria-label="Refunds">
        {([['todo', 'In progress', open.length + eligible.length], ['sent', 'Sent', 0], ['all', 'All', 0]] as const).map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`admin-tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>{label}{n > 0 && <span className="admin-n hot">{n}</span>}</button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>

      {tab === 'todo' && eligible.length > 0 && (
        <div className="card" style={{ padding: 8, marginTop: 12 }}>
          <div style={{ fontWeight: 800, padding: '4px 8px' }}>Orders that can be refunded</div>
          {eligible.map((o) => (
            <div className="admin-row" key={o.orderId}>
              <div className="admin-main">
                <div style={{ fontWeight: 800, fontSize: 15 }}>{amountOf(o.asset, o.depositAmountUnits)} <span className="tag-s bad">{o.reason}</span></div>
                <div className="sub">order {o.orderId} · {when(o.createdAt)}</div>
                {o.payoutError && <div className="sub" style={{ color: '#C43232' }}>{o.payoutError}</div>}
              </div>
              <div className="admin-act"><button className="btn sec sm fit" onClick={() => setAction({ kind: 'start', o })}>Start refund</button></div>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 8, marginTop: 12 }}>
        {refunds === null && <div className="empty">Loading…</div>}
        {refunds !== null && shown.length === 0 && <div className="empty">{tab === 'todo' ? (eligible.length ? 'No refund started yet.' : 'Nothing to refund.') : 'Nothing here.'}</div>}
        {shown.map((r) => {
          const link = explorer(r);
          return (
            <div className="admin-row" key={r.id}>
              <div className="admin-main">
                <div style={{ fontWeight: 800, fontSize: 15 }}>{amountOf(r.asset, r.amount_units)} <span className={`tag-s ${tone(r.status)}`}>{r.status}</span></div>
                <div className="sub">order {r.order_id} · {r.reason}</div>
                <div className="sub mono" style={{ wordBreak: 'break-all' }}>to {short(r.destination)}</div>
                {r.tx_hash && <div className="sub mono">{link ? <a href={link} target="_blank" rel="noreferrer">{short(r.tx_hash)}</a> : short(r.tx_hash)}</div>}
                <div className="sub">{r.events.map((e) => `${e.action} by ${e.by_name} (${when(e.created_at)})`).join(' → ')}</div>
              </div>
              <div className="admin-act">
                {r.status === 'requested' && <button className="btn acc sm fit" onClick={() => setAction({ kind: 'approve', r })}>Approve</button>}
                {r.status === 'approved' && <button className="btn acc sm fit" onClick={() => setAction({ kind: 'sent', r })}>Mark sent</button>}
                {(r.status === 'requested' || r.status === 'approved') && <button className="btn sec sm fit" onClick={() => setAction({ kind: 'cancel', r })}>Cancel</button>}
              </div>
            </div>
          );
        })}
      </div>
      {action && <ActionSheet action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); void load(); }} />}
    </>
  );
}
