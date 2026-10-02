import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AssetIcon } from '../../components/AssetIcon';
import { BackHeader } from '../../components/BackHeader';
import { useT } from '../../i18n';
import { POOLS, poolAsset } from '../../lib/data';
import { fmtCrypto, fmtInt, localizePct } from '../../lib/format';
import { useApp } from '../../state/app';

export default function PoolDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t } = useT();
  const { positions } = useApp();
  const pool = POOLS.find((p) => p.id === id);
  if (!pool) return <Navigate to="/pool" replace />;
  const asset = poolAsset(pool);
  const held = positions[pool.id] ?? 0;
  const cells: [string, string, boolean?][] = [[t('Fee rate'), localizePct(pool.feeRate)], [t('24h volume'), pool.volume], [t('TVL'), pool.tvl], [t('Utilization'), localizePct(`${pool.util}%`), true]];
  return (
    <div className="card">
      <BackHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><AssetIcon char={pool.char} color={pool.color} logo={pool.logo} size={26} />{t('{name} pool', { name: t(pool.name) })}</span>} to="/pool" />
      {held > 0 && (
        <div className="field" style={{ marginTop: 0, marginBottom: 8 }}>
          <div>
            <div className="field-l">{t('Your position')}</div>
            <div className="field-v num" style={{ fontFamily: 'inherit', fontSize: 15 }}>{fmtCrypto(held, 2, asset.dec)} {pool.sym}</div>
          </div>
          <div className="field-h num">{t('≈ {amount} FCFA', { amount: fmtInt(held * asset.fcfa) })}</div>
        </div>
      )}
      <div className="grid2">
        <div className="mini"><div style={{ fontWeight: 500, fontSize: 12, color: 'var(--mut)' }}>APY</div><div className="mini-v" style={{ color: 'var(--acct)' }}>{localizePct(pool.apy)}</div></div>
        {cells.map(([k, v, acc]) => (
          <div className="mini" key={k}><div style={{ fontWeight: 500, fontSize: 12, color: 'var(--mut)' }}>{k}</div><div className="mini-v" style={acc ? { color: 'var(--acct)' } : undefined}>{v}</div></div>
        ))}
      </div>
      <div style={{ margin: '16px 2px 4px', fontWeight: 800, fontSize: 13 }}>{t('How it earns')}</div>
      <div className="risk" style={{ gap: 8, margin: '8px 2px 0' }}>
        <p>{t('Swaps routed through the fiat rail draw {name} from this pool.', { name: pool.name })}</p>
        <p>{t('Every transaction pays the {rate} rail fee.', { rate: localizePct(pool.feeRate) })}</p>
        <p>{t('Fees accrue to providers in proportion to their share, daily.')}</p>
      </div>
      <div className="pos-btns" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => nav(held > 0 ? `/pool/add?pool=${pool.id}` : `/pool/risk?pool=${pool.id}`)}>{t('Add liquidity')}</button>
        {held > 0 && <button className="btn sec" style={{ padding: '12px 0', fontSize: 13.5 }} onClick={() => nav(`/pool/withdraw?pool=${pool.id}`)}>{t('Withdraw')}</button>}
      </div>
    </div>
  );
}
