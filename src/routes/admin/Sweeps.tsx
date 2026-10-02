import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { Sheet } from '../../components/Sheet';
import { useSubmit } from '../../lib/api';
import * as api from './api';
import type { AdminSweep } from './api';

type Tab = 'attention' | 'progress' | 'done' | 'all';
const TABS: { id: Tab; label: string; match: (s: AdminSweep) => boolean }[] = [
  { id: 'attention', label: 'Needs attention', match: (s) => s.status === 'failed' || s.status === 'unknown' },
  { id: 'progress', label: 'In progress', match: (s) => s.status === 'pending' || s.status === 'sending' },
  { id: 'done', label: 'Sent', match: (s) => s.status === 'submitted' },
  { id: 'all', label: 'All', match: () => true },
];

const DECIMALS: Record<string, number> = { ETH: 18, SOL: 9, USDT: 6, USDC: 6 };
const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const tone = (s: AdminSweep['status']) => (s === 'submitted' ? 'ok' : s === 'failed' || s === 'unknown' ? 'bad' : '');

/** Base units -> "1.5" without float error (the amounts are bigints as strings). */
export function fmtUnits(units: string, decimals: number): string {
  try {
    const n = BigInt(units);
    const base = 10n ** BigInt(decimals);
    const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${n / base}${frac ? `.${frac}` : ''}`;
  } catch { return units; }
}

const explorer = (s: AdminSweep) => (!s.tx_hash || s.tx_hash.startsWith('sandbox-') ? null : s.chain === 'solana' ? `https://solscan.io/tx/${s.tx_hash}` : `https://etherscan.io/tx/${s.tx_hash}`);
const short = (h: string) => (h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);

type Action = { kind: 'retry' | 'resolve'; s: AdminSweep };

function ActionSheet({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const { s, kind } = action;
  const { run, busy, error } = useSubmit();
  const [outcome, setOutcome] = useState<'submitted' | 'failed'>('submitted');
  const [note, setNote] = useState('');
  const [hash, setHash] = useState('');
  const amount = `${fmtUnits(s.amount_units, DECIMALS[s.asset] ?? 0)} ${s.asset}`;

  const submit = () => run(async () => {
    if (kind === 'retry') await api.retrySweep(s.order_id);
    else await api.resolveSweep(s.order_id, outcome, note.trim(), hash.trim() || undefined);
    onDone();
  });

  return (
    <Sheet title={kind === 'retry' ? 'Retry sweep' : 'Resolve sweep'} onClose={onClose}>
      <div className="tile" style={{ padding: 16, textAlign: 'left' }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>{amount}</div>
        <div className="sub">to the treasury ({s.chain}) · order {s.order_id}</div>
        {s.error && <div className="sub" style={{ color: '#C43232' }}>{s.error}</div>}
      </div>
      {kind === 'retry' && <div className="note" style={{ textAlign: 'left' }}>Privy refused this transfer, so nothing was sent. Fix the cause first (for example the wallet policy, or gas sponsorship in the Privy dashboard), then retry.</div>}
      {kind === 'resolve' && (
        <>
          <div className="note" style={{ textAlign: 'left' }}>The outcome is unknown, so funds may already have moved. Look up the deposit wallet on a block explorer, then record what you found. "Not sent" lets you retry it afterwards.</div>
          <div className="seg" style={{ width: 'fit-content', margin: '10px 0' }} role="group" aria-label="Outcome">
            <button className={outcome === 'submitted' ? 'on' : ''} onClick={() => setOutcome('submitted')}>It was sent</button>
            <button className={outcome === 'failed' ? 'on' : ''} onClick={() => setOutcome('failed')}>It was not sent</button>
          </div>
          <input className="login-in" placeholder="What you checked (kept in the log)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          {outcome === 'submitted' && <input className="login-in mono" style={{ marginTop: 8 }} placeholder="Transaction hash (optional)" aria-label="Transaction hash" value={hash} onChange={(e) => setHash(e.target.value)} />}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      <ActionButton style={{ marginTop: 14 }} className="btn acc" busy={busy} busyLabel="Working…" disabled={kind === 'resolve' && note.trim().length < 3} onClick={submit}>
        {kind === 'retry' ? 'Retry now' : 'Record outcome'}
      </ActionButton>
    </Sheet>
  );
}

/** Deposit sweeps to the treasury (see worker/sweep.ts). Auth failures are reported to the parent, which shows the login. */
export default function Sweeps({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<AdminSweep[] | null>(null);
  const [tab, setTab] = useState<Tab>('attention');
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api.listSweeps()); setError(null); }
    catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not load sweeps'); }
  }, [onAuthError]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const runNow = async () => {
    setRunning(true); setInfo(null);
    try { const r = await api.runSweeps(); setInfo(`Queued ${r.queued} new, processed ${r.processed}.`); await load(); }
    catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not run sweeps'); }
    finally { setRunning(false); }
  };

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, (rows ?? []).filter(t.match).length])) as Record<Tab, number>, [rows]);
  const visible = useMemo(() => (rows ?? []).filter(TABS.find((t) => t.id === tab)!.match), [rows, tab]);

  return (
    <>
      <div className="admin-tabs" role="tablist" style={{ alignItems: 'center' }}>
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`admin-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{counts[t.id] > 0 && <span className={`admin-n${t.id === 'attention' ? ' hot' : ''}`}>{counts[t.id]}</span>}
          </button>
        ))}
        <button className="pill" style={{ marginLeft: 'auto' }} disabled={running} onClick={() => void runNow()}>{running ? 'Running…' : 'Run sweeps now'}</button>
      </div>

      <ErrorNote>{error}</ErrorNote>
      {info && <div className="note" role="status" style={{ marginTop: 8 }}>{info}</div>}
      <div className="card" style={{ padding: 8, marginTop: 12 }}>
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && visible.length === 0 && <div className="empty">{tab === 'attention' ? 'No sweeps need attention.' : 'Nothing here.'}</div>}
        {visible.map((s) => {
          const link = explorer(s);
          return (
            <div className="admin-row" key={s.order_id}>
              <div className="admin-main">
                <div style={{ fontWeight: 800, fontSize: 15 }}>{fmtUnits(s.amount_units, DECIMALS[s.asset] ?? 0)} {s.asset} <span className={`tag-s ${tone(s.status)}`}>{s.status === 'unknown' ? 'Unknown outcome' : s.status}</span></div>
                <div className="sub">{s.chain} → treasury · {when(s.updated_at)} · order {s.order_id} · attempts {s.attempts}</div>
                {s.tx_hash && <div className="sub mono">{link ? <a href={link} target="_blank" rel="noreferrer">{short(s.tx_hash)}</a> : short(s.tx_hash)}</div>}
                {s.error && <div className="sub" style={{ color: '#C43232' }}>{s.error}</div>}
              </div>
              <div className="admin-act">
                {s.status === 'failed' && <button className="btn sec sm fit" onClick={() => setAction({ kind: 'retry', s })}>Retry</button>}
                {s.status === 'unknown' && <button className="btn sec sm fit" onClick={() => setAction({ kind: 'resolve', s })}>Resolve</button>}
              </div>
            </div>
          );
        })}
      </div>

      {action && <ActionSheet action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); void load(); }} />}
    </>
  );
}
