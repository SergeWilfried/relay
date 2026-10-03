import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorNote } from '../../components/ActionButton';
import * as api from './api';
import type { AdminKyc } from './api';

type Tab = 'attention' | 'pending' | 'approved' | 'all';
const TABS: { id: Tab; label: string; match: (k: AdminKyc) => boolean }[] = [
  { id: 'attention', label: 'Needs attention', match: (k) => k.status === 'rejected' || k.status === 'retry' },
  { id: 'pending', label: 'In review', match: (k) => k.status === 'pending' },
  { id: 'approved', label: 'Approved', match: (k) => k.status === 'approved' },
  { id: 'all', label: 'All', match: () => true },
];
const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const tone = (s: AdminKyc['status']) => (s === 'approved' ? 'ok' : s === 'rejected' ? 'bad' : '');

/** Identity checks (Sumsub, see worker/kyc.ts). The webhook drives the state; "Re-sync" pulls it from Sumsub for a stuck case. */
export default function Kyc({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<AdminKyc[] | null>(null);
  const [tab, setTab] = useState<Tab>('attention');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.listKyc()); setError(null); }
    catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not load identity checks'); }
  }, [onAuthError]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15000); return () => clearInterval(t); }, [load]);

  const resync = async (id: string) => {
    setBusy(id);
    try { await api.syncKycUser(id); await load(); }
    catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not re-sync'); }
    finally { setBusy(null); }
  };

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, (rows ?? []).filter(t.match).length])) as Record<Tab, number>, [rows]);
  const visible = useMemo(() => (rows ?? []).filter(TABS.find((t) => t.id === tab)!.match), [rows, tab]);

  return (
    <>
      <div className="admin-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`admin-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{counts[t.id] > 0 && <span className={`admin-n${t.id === 'attention' ? ' hot' : ''}`}>{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="card" style={{ padding: 8, marginTop: 12 }}>
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && visible.length === 0 && <div className="empty">{tab === 'attention' ? 'No identity checks need attention.' : 'Nothing here.'}</div>}
        {visible.map((k) => (
          <div className="admin-row" key={k.user_id}>
            <div className="admin-main">
              <div style={{ fontWeight: 800, fontSize: 15 }}>{[k.first_name, k.last_name].filter(Boolean).join(' ') || 'Name not shared yet'} <span className={`tag-s ${tone(k.status)}`}>{k.status === 'retry' ? 'Resubmit requested' : k.status}</span></div>
              <div className="sub mono">{k.user_id}</div>
              <div className="sub">{k.level} · {k.country ?? 'country unknown'} · {when(k.updated_at)}{k.applicant_id ? ` · applicant ${k.applicant_id.slice(0, 8)}…` : ''}</div>
              {k.reject_labels.length > 0 && <div className="sub" style={{ color: '#C43232' }}>{k.reject_type ?? ''} {k.reject_labels.join(', ')}</div>}
            </div>
            <div className="admin-act"><button className="btn sec sm fit" disabled={busy === k.user_id} onClick={() => void resync(k.user_id)}>{busy === k.user_id ? 'Syncing…' : 'Re-sync'}</button></div>
          </div>
        ))}
      </div>
    </>
  );
}
