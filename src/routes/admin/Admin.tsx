import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { Sheet } from '../../components/Sheet';
import { fmtInt } from '../../lib/format';
import { useSubmit } from '../../lib/api';
import * as api from './api';
import Deliveries from './Deliveries';
import Refunds from './Refunds';
import Revenue from './Revenue';
import Sweeps from './Sweeps';
import type { AdminPayout } from './api';

type Tab = 'pending' | 'progress' | 'failed' | 'done' | 'all';
const TABS: { id: Tab; label: string; match: (p: AdminPayout) => boolean }[] = [
  { id: 'pending', label: 'Needs approval', match: (p) => p.status === 'pending_approval' },
  { id: 'progress', label: 'In progress', match: (p) => p.status === 'approved' || p.status === 'sending' },
  { id: 'failed', label: 'Failed', match: (p) => p.status === 'failed' },
  { id: 'done', label: 'Done', match: (p) => p.status === 'paid' || p.status === 'rejected' },
  { id: 'all', label: 'All', match: () => true },
];

const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const unknownOutcome = (p: AdminPayout) => p.status === 'sending' && !!p.error?.startsWith('UNKNOWN OUTCOME');
const tone = (s: AdminPayout['status']) => (s === 'paid' ? 'ok' : s === 'failed' || s === 'rejected' ? 'bad' : '');

/** Active while not released and not past its end time (no end time = until an analyst releases it). */
const holdOf = (p: AdminPayout) => (p.hold_rules && p.hold_released_at === null && (p.hold_until === null || Date.now() < p.hold_until) ? p : null);

type Action = { kind: 'approve' | 'reject' | 'retry' | 'resolve' | 'release'; p: AdminPayout };

function Login({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); api.setKey(v.trim());
    try { await api.listPayouts(); onDone(); } catch (x) { api.setKey(''); setErr(x instanceof Error ? x.message : 'Could not sign in'); } finally { setBusy(false); }
  };
  return (
    <div className="login"><div className="login-card">
      <h1 className="login-t">Relay admin</h1>
      <p className="login-s">Enter the admin key to review payouts.</p>
      <form onSubmit={go}>
        <input className="login-in mono" type="password" autoComplete="off" placeholder="Admin key" aria-label="Admin key" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
        <ErrorNote>{err}</ErrorNote>
        <ActionButton type="submit" busy={busy} busyLabel="Checking…" disabled={v.trim().length < 8} style={{ marginTop: 12 }}>Sign in</ActionButton>
      </form>
    </div></div>
  );
}

/** Confirmation sheet: shows exactly what will happen before any money moves. */
function ActionSheet({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const { p, kind } = action;
  const { run, busy, error } = useSubmit();
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<'paid' | 'failed'>('paid');
  const needsText = kind === 'reject' || kind === 'resolve' || kind === 'release';
  const title = { approve: 'Approve payout', reject: 'Reject payout', retry: 'Retry payout', resolve: 'Resolve payout', release: 'Release hold' }[kind];

  const submit = () => run(async () => {
    if (kind === 'approve') await api.approve(p.id);
    else if (kind === 'retry') await api.retry(p.id);
    else if (kind === 'release') await api.releaseHold(p.id, text.trim());
    else if (kind === 'reject') await api.reject(p.id, text.trim());
    else await api.resolve(p.id, outcome, text.trim());
    onDone();
  });

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="tile" style={{ padding: 16, textAlign: 'left' }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>{fmtInt(p.amount_fcfa)} FCFA</div>
        <div style={{ marginTop: 6, fontSize: 13 }}>to <b>{p.operator}</b> <span className="mono">{p.phone}</span></div>
        <div className="sub">for {p.order_amount} {p.asset} · order {p.order_id}</div>
        {p.deposit_tx && <div className="sub mono" style={{ wordBreak: 'break-all' }}>deposit {p.deposit_tx}</div>}
        {p.order_note && <div className="sub" style={{ color: '#C43232' }}>Note: {p.order_note}</div>}
      </div>
      {kind === 'approve' && <div className="note" style={{ textAlign: 'left' }}>This sends the money. Check the number and the deposit first: payouts can't be reversed.</div>}
      {kind === 'release' && <div className="note" style={{ textAlign: 'left' }}>Held by {JSON.parse(p.hold_rules ?? '[]').join(', ')}. The customer was told: “{p.hold_message}” Only release it after checking them; the payout then goes back to normal approval.</div>}
      {kind === 'retry' && <div className="note" style={{ textAlign: 'left' }}>The provider refused this payout, so it is safe to send again.</div>}
      {kind === 'resolve' && (
        <>
          <div className="note" style={{ textAlign: 'left' }}>The result of this payout is unknown. Check the provider's dashboard, then record what happened.</div>
          <div className="seg" style={{ width: 'fit-content', margin: '10px 0' }} role="group" aria-label="Outcome">
            <button className={outcome === 'paid' ? 'on' : ''} onClick={() => setOutcome('paid')}>It was paid</button>
            <button className={outcome === 'failed' ? 'on' : ''} onClick={() => setOutcome('failed')}>It was not paid</button>
          </div>
        </>
      )}
      {needsText && (
        <input className="login-in" style={{ marginTop: 10 }} placeholder={kind === 'reject' ? 'Reason (shown to the user)' : kind === 'release' ? 'What you checked (kept in the log)' : 'Note (e.g. provider reference)'} aria-label={kind === 'reject' ? 'Reason' : 'Note'}
          value={text} onChange={(e) => setText(e.target.value)} />
      )}
      <ErrorNote>{error}</ErrorNote>
      <ActionButton style={{ marginTop: 14 }} className={kind === 'reject' ? 'btn' : 'btn acc'} busy={busy} busyLabel="Working…" disabled={needsText && text.trim().length < 3} onClick={submit}>
        {{ approve: `Approve and send ${fmtInt(p.amount_fcfa)} FCFA`, reject: 'Reject payout', retry: 'Retry now', resolve: 'Record outcome', release: 'Release hold' }[kind]}
      </ActionButton>
    </Sheet>
  );
}

export default function Admin() {
  const [authed, setAuthed] = useState(() => !!api.getKey());
  const [rows, setRows] = useState<AdminPayout[] | null>(null);
  const [view, setView] = useState<'payouts' | 'deliveries' | 'sweeps' | 'refunds' | 'revenue'>('payouts');
  const [tab, setTab] = useState<Tab>('pending');
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.listPayouts()); setError(null); }
    catch (e) { if (e instanceof api.AdminAuthError) { api.setKey(''); setAuthed(false); } else setError(e instanceof Error ? e.message : 'Could not load payouts'); }
  }, []);

  useEffect(() => {
    document.title = 'Relay admin';
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow'; document.head.appendChild(m);
    return () => m.remove();
  }, []);
  useEffect(() => {
    if (!authed) return;
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [authed, load]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, (rows ?? []).filter(t.match).length])) as Record<Tab, number>, [rows]);
  const visible = useMemo(() => {
    const cur = TABS.find((t) => t.id === tab)!;
    const list = (rows ?? []).filter(cur.match);
    return tab === 'pending' || tab === 'progress' ? [...list].sort((a, b) => a.created_at - b.created_at) : list; // oldest first when work is waiting
  }, [rows, tab]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <div className="admin">
      <header className="admin-hd">
        <div className="logo"><div className="logo-mark">R</div><div className="logo-text">Relay admin</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="pill" onClick={() => void load()}>Refresh</button>
          <button className="pill" onClick={() => { api.setKey(''); setAuthed(false); setRows(null); }}>Sign out</button>
        </div>
      </header>

      <div className="admin-tabs" role="tablist" aria-label="Section" style={{ marginBottom: 4 }}>
        <button role="tab" aria-selected={view === 'payouts'} className={`admin-tab${view === 'payouts' ? ' on' : ''}`} onClick={() => setView('payouts')}>Payouts</button>
        <button role="tab" aria-selected={view === 'deliveries'} className={`admin-tab${view === 'deliveries' ? ' on' : ''}`} onClick={() => setView('deliveries')}>Deliveries</button>
        <button role="tab" aria-selected={view === 'sweeps'} className={`admin-tab${view === 'sweeps' ? ' on' : ''}`} onClick={() => setView('sweeps')}>Sweeps</button>
        <button role="tab" aria-selected={view === 'refunds'} className={`admin-tab${view === 'refunds' ? ' on' : ''}`} onClick={() => setView('refunds')}>Refunds</button>
        <button role="tab" aria-selected={view === 'revenue'} className={`admin-tab${view === 'revenue' ? ' on' : ''}`} onClick={() => setView('revenue')}>Revenue</button>
      </div>
      {view === 'deliveries' && <Deliveries onAuthError={() => { api.setKey(''); setAuthed(false); }} />}
      {view === 'sweeps' && <Sweeps onAuthError={() => { api.setKey(''); setAuthed(false); }} />}
      {view === 'refunds' && <Refunds onAuthError={() => { api.setKey(''); setAuthed(false); }} />}
      {view === 'revenue' && <Revenue onAuthError={() => { api.setKey(''); setAuthed(false); }} />}

      {view === 'payouts' && <>
      <div className="admin-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`admin-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{counts[t.id] > 0 && <span className={`admin-n${t.id === 'pending' ? ' hot' : ''}`}>{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      <ErrorNote>{error}</ErrorNote>
      <div className="card" style={{ padding: 8, marginTop: 12 }}>
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && visible.length === 0 && <div className="empty">{tab === 'pending' ? 'Nothing waiting for approval.' : 'Nothing here.'}</div>}
        {visible.map((p) => (
          <div className="admin-row" key={p.id}>
            <div className="admin-main">
              <div style={{ fontWeight: 800, fontSize: 15 }}>{fmtInt(p.amount_fcfa)} FCFA <span className={`tag-s ${tone(p.status)}`}>{unknownOutcome(p) ? 'Unknown outcome' : p.status.replace('_', ' ')}</span></div>
              <div className="sub">{p.order_amount} {p.asset} · {p.operator} <span className="mono">{p.phone}</span></div>
              <div className="sub">{when(p.created_at)} · order {p.order_id} · attempts {p.attempts}</div>
              {holdOf(p) && <div className="sub" style={{ color: '#B7791F' }}>On hold ({JSON.parse(p.hold_rules ?? '[]').join(', ')}) {p.hold_until ? `until ${when(p.hold_until)}` : 'until released'}</div>}
              {p.error && <div className="sub" style={{ color: '#C43232' }}>{p.error}</div>}
              {p.order_note && <div className="sub" style={{ color: '#C43232' }}>Order: {p.order_note}</div>}
            </div>
            <div className="admin-act">
              {p.status === 'pending_approval' && (<>
                {holdOf(p)
                  ? <button className="btn acc sm fit" onClick={() => setAction({ kind: 'release', p })}>Release hold</button>
                  : <button className="btn acc sm fit" onClick={() => setAction({ kind: 'approve', p })}>Approve</button>}
                <button className="btn sec sm fit" onClick={() => setAction({ kind: 'reject', p })}>Reject</button>
              </>)}
              {p.status === 'failed' && <button className="btn sec sm fit" onClick={() => setAction({ kind: 'retry', p })}>Retry</button>}
              {p.status === 'sending' && unknownOutcome(p) && <button className="btn sec sm fit" onClick={() => setAction({ kind: 'resolve', p })}>Resolve</button>}
            </div>
          </div>
        ))}
      </div>

      {action && <ActionSheet action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); void load(); }} />}
      </>}
    </div>
  );
}
