import { useCallback, useEffect, useState } from 'react';
import { ErrorNote } from '../../components/ActionButton';
import * as api from './api';
import type { AuditRow } from './api';

const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const tone = (s: number) => (s >= 200 && s < 300 ? 'ok' : s === 403 || s === 409 || s >= 400 ? 'bad' : '');

/** Every state-changing admin action, allowed or refused, newest first. The database refuses edits and deletes. */
export default function Audit({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [actor, setActor] = useState('');
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (reset: boolean) => {
    try {
      const page = await api.listAudit({ actor: actor.trim() || undefined, before: reset ? undefined : rows?.at(-1)?.id });
      setRows(reset ? page : [...(rows ?? []), ...page]); setMore(page.length === 100); setError(null);
    } catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not load the audit log'); }
  }, [actor, rows, onAuthError]);
  useEffect(() => { void load(true); }, [actor]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <input className="login-in" style={{ marginTop: 12 }} placeholder="Filter by person (exact name)" aria-label="Filter by person" value={actor} onChange={(e) => setActor(e.target.value)} />
      <ErrorNote>{error}</ErrorNote>
      <div className="card" style={{ padding: 8, marginTop: 12 }}>
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && rows.length === 0 && <div className="empty">Nothing recorded yet.</div>}
        {(rows ?? []).map((r) => {
          const d = r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null;
          return (
            <div className="admin-row" key={r.id}>
              <div className="admin-main">
                <div style={{ fontWeight: 800, fontSize: 14 }}>{r.actor} <span className="tag-s">{r.role}</span> {r.action}{r.target ? ` · ${r.target}` : ''} <span className={`tag-s ${tone(r.status)}`}>{r.status === 403 ? 'refused' : r.status}</span></div>
                <div className="sub">{when(r.at)}{r.ip ? ` · ${r.ip}` : ''}</div>
                {d && <div className="sub mono" style={{ wordBreak: 'break-word' }}>{Object.entries(d).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</div>}
              </div>
            </div>
          );
        })}
        {more && rows && rows.length > 0 && <button className="btn sec sm" style={{ margin: 8 }} onClick={() => void load(false)}>Older</button>}
      </div>
    </>
  );
}
