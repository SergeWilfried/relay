import { useCallback, useEffect, useState } from 'react';
import { ErrorNote } from '../../components/ActionButton';
import { fmtInt } from '../../lib/format';
import * as api from './api';
import type { FloatRow, FloatView } from './api';

const NAMES: Record<string, string> = { CIV: "Côte d'Ivoire", SEN: 'Senegal', BFA: 'Burkina Faso' };
const fcfa = (n: number) => `${fmtInt(n)} FCFA`;
const tone = (s: FloatRow['status']) => (s === 'ok' ? 'ok' : 'bad');
const label = (s: FloatRow['status']) => (s === 'ok' ? 'Healthy' : s === 'low' ? 'Low' : 'Cannot cover payouts');

/** A bar from empty to twice the minimum float, with a marker at the minimum. */
function Gauge({ balance, floor, status }: { balance: number; floor: number; status: FloatRow['status'] }) {
  const pct = Math.max(0, Math.min(100, (balance / (floor * 2)) * 100));
  return (
    <div role="img" aria-label={`Balance ${fcfa(balance)}, minimum ${fcfa(floor)}`} style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--ln)', margin: '10px 0 4px' }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: status === 'ok' ? 'var(--acc)' : '#C43232' }} />
      <div title="Minimum float" style={{ position: 'absolute', left: '50%', top: -3, width: 2, height: 14, background: 'var(--ink, #888)', opacity: 0.6 }} />
    </div>
  );
}

function Card({ r }: { r: FloatRow }) {
  return (
    <div className="card" style={{ padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{NAMES[r.country] ?? r.country} <span className="sub" style={{ display: 'inline' }}>({r.country})</span></div>
        <span className={`tag-s ${tone(r.status)}`}>{label(r.status)}</span>
      </div>
      {r.balance === null ? (
        <div className="sub" style={{ marginTop: 8, color: '#C43232' }}>{r.reasons[0]}</div>
      ) : (
        <>
          <div style={{ fontWeight: 800, fontSize: 26, marginTop: 6 }}>{fcfa(r.balance)}</div>
          <Gauge balance={r.balance} floor={r.floor} status={r.status} />
          <div className="sub" style={{ display: 'flex', justifyContent: 'space-between' }}><span>0</span><span>minimum {fcfa(r.floor)}</span></div>
        </>
      )}
      {r.provider && <div className="sub" style={{ marginTop: 6 }}>Reserved for one provider: {r.provider}</div>}
      {r.reasons.length > 0 && r.balance !== null && <div className="sub" style={{ marginTop: 6, color: '#C43232' }}>{r.reasons.join(' · ')}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
        <div><div className="sub" style={{ margin: 0 }}>Committed to payouts</div><b>{fcfa(r.committedFcfa)}</b><div className="sub">{r.committedCount} waiting or in flight</div></div>
        <div><div className="sub" style={{ margin: 0 }}>Last 24 hours</div><b>{r.out24hFcfa > 0 ? `− ${fcfa(r.out24hFcfa)}` : fcfa(0)}</b><div className="sub">paid out · + {fcfa(r.in24hFcfa)} from purchases</div></div>
        <div><div className="sub" style={{ margin: 0 }}>Estimated cover</div><b>{r.coverDays === null ? 'n/a' : `${r.coverDays} day${r.coverDays === 1 ? '' : 's'}`}</b><div className="sub">{r.coverDays === null ? 'nothing paid out in 7 days' : `at ${fcfa(r.avgDailyOutFcfa)} a day`}</div></div>
      </div>
    </div>
  );
}

/** The payout float per country with the payment provider (see worker/float.ts). */
export default function Float({ onAuthError }: { onAuthError: () => void }) {
  const [view, setView] = useState<FloatView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setView(await api.getFloat()); setError(null); }
    catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not load the float'); }
  }, [onAuthError]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, [load]);

  const worst = view?.rows?.some((r) => r.status === 'critical') ? 'critical' : view?.rows?.some((r) => r.status === 'low') ? 'low' : 'ok';

  return (
    <>
      <div className="sub" style={{ margin: '12px 2px 4px' }}>
        Our prepaid wallets with the payment provider, one per country. A payout fails when the wallet of the recipient's country is empty; purchases refill it.
        {view && ` Provider: ${view.provider}. Updated ${new Date(view.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!view && !error && <div className="card" style={{ padding: 8, marginTop: 12 }}><div className="empty">Loading…</div></div>}
      {view && view.rows === null && <div className="card" style={{ padding: 8, marginTop: 12 }}><div className="empty">The "{view.provider}" payout provider doesn't hold a balance, so there is no float to show. Set PAYOUT_PROVIDER=pawapay to see it.</div></div>}
      {view?.rows && worst !== 'ok' && (
        <div className="notice warn" role="alert" style={{ marginTop: 12 }}>
          <b>{worst === 'critical' ? 'Payouts are at risk.' : 'A wallet is running low.'}</b> Top up the wallets marked below before customers' payouts start failing.
        </div>
      )}
      {view?.rows?.map((r) => <Card key={r.country} r={r} />)}

      {view?.rows && (
        <div className="infobox" style={{ marginTop: 12, textAlign: 'left' }}>
          <b>Keeping the float healthy</b>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li><b>Top up</b> in the pawaPay dashboard (<i>Top up</i>): a bank transfer with your merchant reference, per country, which takes days. Top up well before the cover runs out. <a href="https://docs.pawapay.io/dashboard/topping_up" target="_blank" rel="noreferrer">How it works</a></li>
            <li><b>Settlements</b> move money from these wallets to your bank on a schedule. Set a <i>minimum wallet balance</i> per wallet at or above the minimum shown here, so a settlement can never empty the float. <a href="https://docs.pawapay.io/dashboard/finances/settlements" target="_blank" rel="noreferrer">How it works</a></li>
            <li><b>Alerts:</b> a critical alert fires (at most every 12 hours per country) when a wallet is below the minimum or can't cover the payouts already waiting.</li>
          </ul>
        </div>
      )}
    </>
  );
}
