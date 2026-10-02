import { BackHeader } from '../../components/BackHeader';
import { EmptyState } from '../../components/EmptyState';
import { fmtInt } from '../../lib/format';
import { useApp } from '../../state/app';

const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function PoolHistory() {
  const { poolEvents } = useApp();
  return (
    <div className="card">
      <BackHeader title="Activity" to="/pool" tight />
      {poolEvents.length === 0 ? (
        <EmptyState icon="↕" title="No activity yet" body="Deposits, withdrawals and daily fee payouts will show up here." />
      ) : poolEvents.map((e) => (
        <div className="hist-r" key={e.id}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{e.type === 'deposit' ? 'Deposit' : 'Withdrawal'}</div>
            <div style={{ fontSize: 11.5, color: 'var(--mut)' }}>{when(e.at)} · {e.type === 'deposit' ? 'Orange Money' : 'to Orange Money'}</div>
          </div>
          <div className="num" style={{ fontWeight: 800, fontSize: 13 }}>{e.type === 'deposit' ? '+' : '−'}{fmtInt(e.amount)}</div>
        </div>
      ))}
    </div>
  );
}
