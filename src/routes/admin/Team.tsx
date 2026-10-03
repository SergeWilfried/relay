import { useCallback, useEffect, useState } from 'react';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { Sheet } from '../../components/Sheet';
import { useSubmit } from '../../lib/api';
import * as api from './api';
import type { AdminUser } from './api';

const when = (t: number | null) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');
const ROLES: { id: AdminUser['role']; label: string; help: string }[] = [
  { id: 'viewer', label: 'Viewer', help: 'Can read everything, changes nothing.' },
  { id: 'operator', label: 'Operator', help: 'Approves and rejects payouts, handles refunds, deliveries and sweeps.' },
  { id: 'owner', label: 'Owner', help: 'Everything an operator can do, plus rules, account status, denylists and this team.' },
];

/** A key is shown once, here. Only its hash is stored, so it cannot be shown again: rotate it if it is lost. */
function KeySheet({ title, who, secret, onClose }: { title: string; who: string; secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="note" style={{ textAlign: 'left' }}>Give this key to <b>{who}</b> through a private channel. It is shown only now and cannot be recovered; if it is lost, rotate it.</div>
      <div className="tile mono" style={{ padding: 14, wordBreak: 'break-all', marginTop: 10 }}>{secret}</div>
      <button className="btn acc" style={{ marginTop: 12 }} onClick={() => { void navigator.clipboard?.writeText(secret).then(() => setCopied(true)).catch(() => null); }}>{copied ? 'Copied' : 'Copy key'}</button>
      <button className="btn sec" style={{ marginTop: 8 }} onClick={onClose}>I have given it to them</button>
    </Sheet>
  );
}

/** The back-office team: one named account per person, each with their own key. Owners and the root key only. */
export default function Team({ onAuthError, me }: { onAuthError: () => void; me: api.Me }) {
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<AdminUser['role']>('operator');
  const [shown, setShown] = useState<{ title: string; who: string; secret: string } | null>(null);
  const { run, busy, error: formError } = useSubmit();

  const load = useCallback(async () => {
    try { setRows(await api.listAdmins()); setError(null); }
    catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not load the team'); }
  }, [onAuthError]);
  useEffect(() => { void load(); }, [load]);

  const act = async (f: () => Promise<unknown>) => { setError(null); try { await f(); await load(); } catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Failed'); } };

  const add = () => run(async () => {
    const r = await api.createAdmin(name.trim(), role);
    setShown({ title: 'New key', who: r.admin.name, secret: r.key });
    setName(''); await load();
  });

  return (
    <>
      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ fontWeight: 800 }}>Add a person</div>
        <div className="sub">Everyone has their own key. Approvals and refunds are recorded under their name, and the same person can never give both approvals.</div>
        <input className="login-in" style={{ marginTop: 10 }} placeholder="Name or email (e.g. amy@relay.io)" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="seg" style={{ width: 'fit-content', margin: '10px 0' }} role="group" aria-label="Role">
          {ROLES.map((r) => <button key={r.id} className={role === r.id ? 'on' : ''} onClick={() => setRole(r.id)}>{r.label}</button>)}
        </div>
        <div className="sub">{ROLES.find((r) => r.id === role)!.help}</div>
        <ErrorNote>{formError}</ErrorNote>
        <ActionButton style={{ marginTop: 12 }} className="btn acc" busy={busy} busyLabel="Creating…" disabled={name.trim().length < 3} onClick={add}>Create and show the key</ActionButton>
      </div>

      <ErrorNote>{error}</ErrorNote>
      <div className="card" style={{ padding: 8, marginTop: 12 }}>
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && rows.length === 0 && <div className="empty">Nobody yet. Add the first owner above, then sign in with their key.</div>}
        {(rows ?? []).map((a) => (
          <div className="admin-row" key={a.id}>
            <div className="admin-main">
              <div style={{ fontWeight: 800, fontSize: 15 }}>{a.name} <span className={`tag-s ${a.active ? '' : 'bad'}`}>{a.active ? a.role : `${a.role} · disabled`}</span>{a.name === me.name && <span className="tag-s ok" style={{ marginLeft: 6 }}>you</span>}</div>
              <div className="sub">added by {a.created_by} · {when(a.created_at)} · last used {when(a.last_used_at)}{a.disabled_at ? ` · disabled ${when(a.disabled_at)} by ${a.disabled_by}` : ''}</div>
            </div>
            <div className="admin-act">
              {a.active === 1 && <button className="btn sec sm fit" onClick={() => void act(async () => { const r = await api.rotateAdminKey(a.id); setShown({ title: 'New key', who: a.name, secret: r.key }); })}>New key</button>}
              {a.name !== me.name && a.active === 1 && (
                <select aria-label={`Role of ${a.name}`} value={a.role} onChange={(e) => void act(() => api.setAdminRole(a.id, e.target.value as AdminUser['role']))}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
              )}
              {a.name !== me.name && <button className="btn sec sm fit" onClick={() => void act(() => api.setAdminActive(a.id, !a.active))}>{a.active ? 'Disable' : 'Enable'}</button>}
            </div>
          </div>
        ))}
      </div>
      {shown && <KeySheet {...shown} onClose={() => setShown(null)} />}
    </>
  );
}
