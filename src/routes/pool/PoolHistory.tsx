import { BackHeader } from '../../components/BackHeader';
import { EmptyState } from '../../components/EmptyState';
import { locale, useT } from '../../i18n';
import { POOLS, poolAsset } from '../../lib/data';
import { fmtCrypto } from '../../lib/format';
import { useApp } from '../../state/app';

const when = (t: number) => new Date(t).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function PoolHistory() {
  const { t } = useT();
  const { poolEvents } = useApp();
  return (
    <div className="card">
      <BackHeader title={t('Activity')} to="/pool" tight />
      {poolEvents.length === 0 ? (
        <EmptyState icon="↕" title={t('No activity yet')} body={t('Deposits, withdrawals and daily fee payouts will show up here.')} />
      ) : poolEvents.map((e) => {
        const pool = POOLS.find((p) => p.id === e.pool);
        return (
          <div className="hist-r" key={e.id}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{e.type === 'deposit' ? t('Deposit') : t('Withdrawal')}{pool ? ` · ${t('{name} pool', { name: pool.name })}` : ''}</div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)' }}>{when(e.at)} · {e.type === 'deposit' ? t('from your Relay wallet') : t('to your Relay wallet')}</div>
            </div>
            <div className="num" style={{ fontWeight: 800, fontSize: 13 }}>{e.type === 'deposit' ? '+' : '−'}{pool ? `${fmtCrypto(e.amount, 2, poolAsset(pool).dec)} ${pool.sym}` : e.amount}</div>
          </div>
        );
      })}
    </div>
  );
}
