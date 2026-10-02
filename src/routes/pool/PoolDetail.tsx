import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AssetIcon } from '../../components/AssetIcon';
import { BackHeader } from '../../components/BackHeader';
import { POOLS } from '../../lib/data';
import { useFcfaAvatar } from '../../lib/geo';
import { useT } from '../../i18n';
import { useApp } from '../../state/app';

export default function PoolDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t } = useT();
  const { position } = useApp();
  const fcfaAvatar = useFcfaAvatar();
  const pool = POOLS.find((p) => p.id === id);
  if (!pool) return <Navigate to="/pool" replace />;
  const isFcfa = pool.id === 'fcfa';
  const cells: [string, string, boolean?][] = [[t('Fee rate'), pool.feeRate], [t('24h volume'), pool.volume], [t('TVL'), pool.tvl], [t('Utilization'), `${pool.util}%`, true]];
  return (
    <div className="card">
      <BackHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><AssetIcon char={pool.char} color={pool.color} logo={pool.id === 'fcfa' ? fcfaAvatar.logo : pool.logo} size={26} />{t('{name} pool', { name: t(pool.name) })}</span>} to="/pool" />
      <div className="grid2">
        {cells.map(([k, v, acc]) => (
          <div className="mini" key={k}><div style={{ fontWeight: 500, fontSize: 12, color: 'var(--mut)' }}>{k}</div><div className="mini-v" style={acc ? { color: 'var(--acct)' } : undefined}>{v}</div></div>
        ))}
      </div>
      <div style={{ margin: '16px 2px 4px', fontWeight: 800, fontSize: 13 }}>{t('How it earns')}</div>
      <div className="risk" style={{ gap: 8, margin: '8px 2px 0' }}>
        <p>{isFcfa ? t("Buys and cash-outs draw FCFA from the pool's mobile money float.") : t('Swaps routed through the fiat rail draw {name} from this pool.', { name: pool.name })}</p>
        <p>{t('Every transaction pays the {rate} rail fee.', { rate: pool.feeRate })}</p>
        <p>{t('Fees accrue to providers in proportion to their share, daily.')}</p>
      </div>
      {isFcfa ? (
        <button className="btn sm" style={{ marginTop: 16 }} onClick={() => nav(position > 0 ? '/pool/add' : '/pool/risk')}>{t('Add liquidity')}</button>
      ) : (
        <div className="note" style={{ marginTop: 16 }}>{t('{name} deposits open soon', { name: pool.name })}</div>
      )}
    </div>
  );
}
