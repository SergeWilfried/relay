import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { FEES_30D } from '../../lib/data';
import { usePools } from '../../lib/pools';
import { useFcfaAvatar } from '../../lib/geo';
import { fmtInt, lenStep } from '../../lib/format';
import { useApp } from '../../state/app';
import { AssetIcon } from '../../components/AssetIcon';
import { Stats } from './PoolLayout';

export default function PoolList() {
  const nav = useNavigate();
  const { position } = useApp();
  const joined = position > 0;
  const { state, retry } = usePools();
  const fcfaAvatar = useFcfaAvatar();
  const pools = state.status === 'ready' ? state.pools : [];
  // offer "Start earning" only to users with no position, and only when there is a pool to join
  const canStart = !joined && state.status === 'ready' && pools.length > 0;
  const start = () => nav(joined ? '/pool/add' : '/pool/risk');
  return (
    <>
      <Stats empty={state.status !== 'ready' || pools.length === 0} />
      {canStart && (
        <div className="promo">
          <h2>Earn on your FCFA</h2>
          <p>Fund the mobile money float that powers instant buys and cash-outs. Fees from every transaction flow to liquidity providers — withdraw anytime.</p>
          <div className="apy">8.4% APY · paid daily · no price exposure</div>
          <button className="btn acc" onClick={start}>Start earning</button>
        </div>
      )}
      {joined && (
        <div className="card">
          <div className="pos-top"><div className="card-t">Your position</div><span className="earning">Earning</span></div>
          <div className="pos-mid">
            <div><div className="pos-big num" data-len={lenStep(fmtInt(position), 9, 12)}>{fmtInt(position)}</div><div className="sub">FCFA · rail pool · via Orange Money</div></div>
            <div style={{ textAlign: 'right' }}>
              {FEES_30D > 0
                ? <><div style={{ fontWeight: 800, fontSize: 15, color: 'var(--acct)' }}>+{fmtInt(FEES_30D)}</div><div style={{ fontSize: 11.5, color: 'var(--mut)' }}>fees earned · 30d</div></>
                : <><div style={{ fontWeight: 700, fontSize: 13, color: 'var(--mut)' }}>No fees yet</div><div style={{ fontSize: 11.5, color: 'var(--fnt)' }}>first payout in ~24h</div></>}
            </div>
          </div>
          <div className="pos-btns">
            <button className="btn" onClick={start}>Add liquidity</button>
            <button className="btn sec" style={{ padding: '12px 0', fontSize: 13.5 }} onClick={() => nav('/pool/withdraw')}>Withdraw</button>
          </div>
          <div className="links"><Link to="/pool/earnings" style={{ textDecoration: 'none' }}>Earnings</Link><span className="sep">·</span><Link to="/pool/activity" style={{ textDecoration: 'none' }}>Activity</Link></div>
        </div>
      )}
      <div className="card">
        <div className="card-t">Pools</div>
        {state.status === 'loading' && <div className="empty-b" style={{ padding: '18px 0', textAlign: 'center', margin: '0 auto' }} role="status">Loading pools…</div>}
        {state.status === 'error' && (
          <EmptyState icon="!" title="Couldn't load pools" body="Check your connection and try again."
            action={<button className="btn sec fit" onClick={retry}>Retry</button>} />
        )}
        {state.status === 'ready' && pools.length === 0 && (
          <EmptyState icon="◌" title="No pools available yet" body="Liquidity pools aren't open right now. We'll show them here as soon as they are." />
        )}
        <div className="pools">
          {pools.map((p) => (
            <Link key={p.id} to={`/pool/${p.id}`} className="pool-row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <AssetIcon char={p.char} color={p.color} logo={p.id === 'fcfa' ? fcfaAvatar.logo : p.logo} />
              <div className="pool-main">
                <div className="pool-n">{p.name}</div><div className="pool-b" data-len={lenStep(p.blurb, 34, 44)}>{p.blurb}</div>
                <div className="util"><i style={{ width: `${p.util}%` }} /></div>
              </div>
              <div className="pool-r"><div className="pool-apy" data-len={lenStep(p.apy, 5, 7)}>{p.apy}</div><div className="pool-u">{p.util}% used</div></div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
