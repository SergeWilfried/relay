import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorNote } from '../../components/ActionButton';
import { fmtInt } from '../../lib/format';
import * as api from './api';
import type { Revenue as RevenueData, RevenueTotals } from './api';

const RANGES: { days: number; label: string }[] = [
  { days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '1 year' }, { days: 0, label: 'All time' },
];
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
const fcfa = (n: number) => `${fmtInt(n)} FCFA`;

/** Every calendar day (UTC) in the range, with zeros where nothing was paid, so the bars show gaps honestly. */
function fillDays(daily: RevenueData['daily'], days: number): { day: string; platformFeeFcfa: number }[] {
  const by = new Map(daily.map((d) => [d.day, d.platformFeeFcfa]));
  const n = days > 0 && days <= 90 ? days : 0;
  if (!n) return daily.map((d) => ({ day: d.day, platformFeeFcfa: d.platformFeeFcfa }));
  const out: { day: string; platformFeeFcfa: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day, platformFeeFcfa: by.get(day) ?? 0 });
  }
  return out;
}

function Kpi({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="tile" style={{ padding: 16, textAlign: 'left' }}>
      <div className="sub" style={{ margin: 0 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: big ? 26 : 20, marginTop: 4, wordBreak: 'break-word' }}>{value}</div>
      {sub && <div className="sub" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: (RevenueTotals & { key: string })[] }) {
  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{title}</div>
      {rows.length === 0 && <div className="empty">Nothing paid in this period.</div>}
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--ln)' }}>
          <div><b>{r.key}</b><div className="sub">{r.count} payout{r.count === 1 ? '' : 's'} · {fcfa(r.grossFcfa)} volume</div></div>
          <div style={{ textAlign: 'right' }}><b>{fcfa(r.platformFeeFcfa)}</b><div className="sub">PSP {fcfa(r.pspFeeFcfa)}</div></div>
        </div>
      ))}
    </div>
  );
}

/** Platform and PSP fees on paid payouts (see worker/revenue.ts). Auth failures go to the parent, which shows the login. */
export default function Revenue({ onAuthError }: { onAuthError: () => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<RevenueData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.getRevenue(days)); setError(null); }
    catch (e) { if (e instanceof api.AdminAuthError) onAuthError(); else setError(e instanceof Error ? e.message : 'Could not load revenue'); }
  }, [days, onAuthError]);

  useEffect(() => {
    setData(null);
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  const bars = useMemo(() => (data ? fillDays(data.daily, data.days) : []), [data]);
  const max = Math.max(1, ...bars.map((b) => b.platformFeeFcfa));

  return (
    <>
      <div className="admin-tabs" role="tablist" aria-label="Period">
        {RANGES.map((r) => (
          <button key={r.days} role="tab" aria-selected={days === r.days} className={`admin-tab${days === r.days ? ' on' : ''}`} onClick={() => setDays(r.days)}>{r.label}</button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!data && !error && <div className="card" style={{ padding: 8, marginTop: 12 }}><div className="empty">Loading…</div></div>}

      {data && (
        <>
          <div className="sub" style={{ margin: '12px 2px 8px' }}>
            Customers pay {pct(data.feeRates.total)} of each order: {pct(data.feeRates.platform)} platform fee (Relay's revenue) + {pct(data.feeRates.psp)} payment provider fee (passed through). Recognised when the payout is paid.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 10 }}>
            <Kpi big label={`Platform revenue (${pct(data.feeRates.platform)})`} value={fcfa(data.paid.platformFeeFcfa)} sub={data.pending.platformFeeFcfa > 0 ? `+ ${fcfa(data.pending.platformFeeFcfa)} pending` : undefined} />
            <Kpi label="Volume (gross)" value={fcfa(data.paid.grossFcfa)} sub={`${data.paid.count} paid payout${data.paid.count === 1 ? '' : 's'}`} />
            <Kpi label={`PSP fees (${pct(data.feeRates.psp)})`} value={fcfa(data.paid.pspFeeFcfa)} sub="owed to payment providers" />
            <Kpi label={`Total fees (${pct(data.feeRates.total)})`} value={fcfa(data.paid.platformFeeFcfa + data.paid.pspFeeFcfa)} sub={`customers received ${fcfa(data.paid.payoutFcfa)}`} />
          </div>

          <div className="card" style={{ padding: 12, marginTop: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Platform revenue per day</div>
            {bars.length === 0 ? <div className="empty">Nothing paid in this period.</div> : (
              <div role="img" aria-label="Platform revenue per day" style={{ display: 'flex', alignItems: 'flex-end', gap: bars.length > 45 ? 1 : 3, height: 120 }}>
                {bars.map((b) => (
                  <div key={b.day} title={`${b.day}: ${fcfa(b.platformFeeFcfa)}`} style={{ flex: 1, minWidth: 2, height: `${Math.max(b.platformFeeFcfa > 0 ? 3 : 0, (b.platformFeeFcfa / max) * 100)}%`, background: 'var(--acc)', borderRadius: 2, opacity: b.platformFeeFcfa > 0 ? 1 : 0.15 }} />
                ))}
              </div>
            )}
            {bars.length > 0 && <div className="sub" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}><span>{bars[0]!.day}</span><span>{bars[bars.length - 1]!.day}</span></div>}
          </div>

          <Breakdown title="By asset sold" rows={data.byAsset} />
          <Breakdown title="By payout provider" rows={data.byOperator} />

          <div className="sub" style={{ margin: '12px 2px' }}>
            Sells only: buys and swaps aren't recorded on the server yet, so their fees aren't included. Failed and rejected payouts earn nothing.
            {data.uncountedPaid > 0 && ` ${data.uncountedPaid} older paid payout${data.uncountedPaid === 1 ? ' has' : 's have'} no fee split (made before fees were recorded) and ${data.uncountedPaid === 1 ? 'is' : 'are'} not counted.`}
          </div>
        </>
      )}
    </>
  );
}
