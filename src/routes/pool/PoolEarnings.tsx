import { BackHeader } from '../../components/BackHeader';
import { EmptyState } from '../../components/EmptyState';
import { DAILY_FEES, FEES_30D, FEES_BY_POOL } from '../../lib/data';
import { fmtInt } from '../../lib/format';

export default function PoolEarnings() {
  const empty = FEES_30D === 0 && DAILY_FEES.length === 0;
  const max = Math.max(1, ...DAILY_FEES);
  return (
    <div className="card">
      <BackHeader title="Earnings" to="/pool" />
      <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
        <div className="num" style={{ fontWeight: 800, fontSize: 30, color: empty ? 'var(--fnt)' : 'var(--acct)' }}>{empty ? '0' : `+${fmtInt(FEES_30D)}`}</div>
        <div className="sub">FCFA · last 30 days</div>
      </div>
      {empty ? (
        <EmptyState icon="%" title="No fees earned yet" body="Fees are paid out daily and auto-compound into your position. Your first payout arrives about 24 hours after you deposit." />
      ) : (
        <>
          <div className="chart" aria-label="Earnings, last 7 days">{DAILY_FEES.map((v, i) => <i key={i} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />)}</div>
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--fnt)', marginBottom: 10 }}>last 7 days</div>
          {FEES_BY_POOL.map((r) => (
            <div className="kv2" key={r.name} style={{ padding: '10px 4px', borderTop: '1px solid var(--ln)' }}><div>{r.name}</div><div>+{fmtInt(r.amount)} FCFA</div></div>
          ))}
          <div className="note">Fees auto-compound daily into your position</div>
        </>
      )}
    </div>
  );
}
