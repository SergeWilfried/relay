import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { Sheet } from '../../components/Sheet';
import { fmtInt } from '../../lib/format';
import { useSubmit } from '../../lib/api';
import * as api from './api';
import type { AdminBuy } from './api';
import { fmtUnits } from './Sweeps';

type Tab = 'todo' | 'progress' | 'done' | 'failed';
const DECIMALS: Record<string, number> = { ETH: 18, SOL: 9, USDT: 6, USDC: 6 };
const crypto = (b: AdminBuy) => `${fmtUnits(b.amount_units, DECIMALS[b.asset] ?? 0)} ${b.asset}`;
const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const holdOf = (b: AdminBuy) => (b.hold_rules && b.hold_released_at === null && (b.hold_until === null || Date.now() < b.hold_until) ? b : null);
const explorer = (b: AdminBuy) => (b.tx_hash ? (b.network === 'Solana' ? `https://solscan.io/tx/${b.tx_hash}` : `https://etherscan.io/tx/${b.tx_hash}`) : null);
const tone = (s: AdminBuy['status']) => (s === 'delivered' ? 'ok' : s === 'failed' || s === 'expired' ? 'bad' : '');

const TABS: { id: Tab; label: string; match: (b: AdminBuy) => boolean }[] = [
  { id: 'todo', label: 'Send crypto', match: (b) => b.status === 'collected' },
  { id: 'progress', label: 'Customer paying', match: (b) => b.status === 'created' || b.status === 'collecting' },
  { id: 'done', label: 'Delivered', match: (b) => b.status === 'delivered' },
  { id: 'failed', label: 'Not completed', match: (b) => b.status === 'failed' || b.status === 'expired' || b.status === 'cancelled' },
];

type Action = { kind: 'deliver' | 'release'; b: AdminBuy };

function ActionSheet({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const { b, kind } = action;
  const { run, busy, error } = useSubmit();
  const [text, setText] = useState('');
  const ready = text.trim().length >= 3;
  const submit = () => run(async () => {
    if (kind === 'deliver') await api.markDelivered(b.id, text.trim());
    else await api.releaseBuyHold(b.id, text.trim());
    onDone();
  });
  return (
    <Sheet title={kind === 'deliver' ? 'Record delivery' : 'Release hold'} onClose={onClose}>
      <div className="tile" style={{ padding: 16, textAlign: 'left' }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>{crypto(b)}</div>
        <div className="sub">paid {fmtInt(b.fcfa)} FCFA · order {b.id}</div>
        <div className="sub mono" style={{ wordBreak: 'break-all' }}>to {b.destination}</div>
      </div>
      {kind === 'deliver'
        ? <div className="note" style={{ textAlign: 'left' }}>The customer's payment was confirmed. Send {crypto(b)} from the treasury to the address above, then paste the transaction hash. Relay has no treasury key, so it can't send it for you.</div>
        : <div className="note" style={{ textAlign: 'left' }}>Held by {JSON.parse(b.hold_rules ?? '[]').join(', ')}. The customer was told: “{b.hold_message}” Only release it after checking them.</div>}
      <input className={`login-in${kind === 'deliver' ? ' mono' : ''}`} style={{ marginTop: 8 }} placeholder={kind === 'deliver' ? 'Transaction hash' : 'What you checked (kept in the log)'} aria-label={kind === 'deliver' ? 'Transaction hash' : 'Note'} value={text} onChange={(e) => setText(e.target.value)} />
      <ErrorNote>{error}</ErrorNote>
      <ActionButton style={{ marginTop: 14 }} className="btn acc" busy={busy} busyLabel="Working…" disabled={!ready} onClick={submit}>{kind === 'deliver' ? 'Record as delivered' : 'Release hold'}</ActionButton>
    </Sheet>
  );
}

/** Purchases: a person sends the crypto from the treasury once the customer's mobile money payment is confirmed (see worker/buys.ts). */
export default function Deliveries({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<AdminBuy[] | null>(null);
  const [tab, setTab] = useState<Tab>('todo');
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.listBuys()); setError(null); }
    catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not load purchases'); }
  }, [onAuthError]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 10000); return () => clearInterval(t); }, [load]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, (rows ?? []).filter(t.match).length])) as Record<Tab, number>, [rows]);
  const visible = useMemo(() => {
    const list = (rows ?? []).filter(TABS.find((t) => t.id === tab)!.match);
    return tab === 'todo' ? [...list].sort((a, b) => (a.collected_at ?? 0) - (b.collected_at ?? 0)) : list; // longest-waiting customer first
  }, [rows, tab]);

  return (
    <>
      <div className="admin-tabs" role="tablist" aria-label="Purchases">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`admin-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{counts[t.id] > 0 && <span className={`admin-n${t.id === 'todo' ? ' hot' : ''}`}>{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="card" style={{ padding: 8, marginTop: 12 }}>
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && visible.length === 0 && <div className="empty">{tab === 'todo' ? 'No customer is waiting for crypto.' : 'Nothing here.'}</div>}
        {visible.map((b) => {
          const link = explorer(b), held = holdOf(b);
          return (
            <div className="admin-row" key={b.id}>
              <div className="admin-main">
                <div style={{ fontWeight: 800, fontSize: 15 }}>{crypto(b)} <span className={`tag-s ${tone(b.status)}`}>{b.status}</span></div>
                <div className="sub">{b.status === 'collected' || b.status === 'delivered' ? 'paid' : 'for'} {fmtInt(b.fcfa)} FCFA via {b.operator} · order {b.id}{b.collected_at ? ` · paid ${ago(b.collected_at)}` : ` · ${when(b.created_at)}`}</div>
                <div className="sub mono" style={{ wordBreak: 'break-all' }}>to {b.destination}</div>
                {held && <div className="sub" style={{ color: '#B7791F' }}>On hold ({JSON.parse(b.hold_rules ?? '[]').join(', ')}) {held.hold_until ? `until ${when(held.hold_until)}` : 'until released'}</div>}
                {b.tx_hash && <div className="sub mono">{link ? <a href={link} target="_blank" rel="noreferrer">{b.tx_hash.slice(0, 10)}…{b.tx_hash.slice(-6)}</a> : b.tx_hash}{b.delivered_by ? ` · by ${b.delivered_by}` : ''}</div>}
                {b.failure && <div className="sub" style={{ color: '#C43232' }}>{b.failure}{b.failure_detail ? ` (${b.failure_detail})` : ''}</div>}
              </div>
              <div className="admin-act">
                {b.status === 'collected' && (held
                  ? <button className="btn acc sm fit" onClick={() => setAction({ kind: 'release', b })}>Release hold</button>
                  : <button className="btn acc sm fit" onClick={() => setAction({ kind: 'deliver', b })}>Mark delivered</button>)}
              </div>
            </div>
          );
        })}
      </div>
      {action && <ActionSheet action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); void load(); }} />}
    </>
  );
}
