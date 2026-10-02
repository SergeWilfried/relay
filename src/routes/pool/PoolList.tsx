import { Link, useNavigate } from 'react-router-dom';
import { AssetIcon } from '../../components/AssetIcon';
import { EmptyState } from '../../components/EmptyState';
import { useT } from '../../i18n';
import { FEES_30D, POOLS, poolAsset } from '../../lib/data';
import { fmtCrypto, fmtInt, lenStep, localizePct } from '../../lib/format';
import { usePools } from '../../lib/pools';
import { useApp } from '../../state/app';
import { Stats } from './PoolLayout';

export default function PoolList() {
  const nav = useNavigate();
  const { t } = useT();
  const { positions } = useApp();
  const { state, retry } = usePools();
  const pools = state.status === 'ready' ? state.pools : [];
  const held = pools.filter((p) => (positions[p.id] ?? 0) > 0);
  const joined = held.length > 0;
  // offer "Start earning" only to users with no position, and only when there is a pool to join
  const canStart = !joined && state.status === 'ready' && pools.length > 0;
  const best = [...POOLS].sort((a, b) => parseFloat(b.apy) - parseFloat(a.apy))[0]!;
  const value = (p: (typeof POOLS)[number]) => (positions[p.id] ?? 0) * poolAsset(p).fcfa;
  const total = held.reduce((n, p) => n + value(p), 0);

  return (
    <>
      <Stats empty={state.status !== 'ready' || pools.length === 0} />
      {canStart && (
        <div className="promo">
          <h2>{t('Earn on your crypto')}</h2>
          <p>{t('Lend your crypto to the pools that power instant swaps and cash-outs. Fees from every transaction flow to liquidity providers — withdraw anytime.')}</p>
          <div className="apy">{t('Up to {apy} APY · paid daily', { apy: localizePct(best.apy) })}</div>
          {/* the best-paying pool is a sensible default; the user can pick any pool below */}
          <button className="btn acc" onClick={() => nav(`/pool/${best.id}`)}>{t('Start earning')}</button>
        </div>
      )}
      {joined && (
        <div className="card">
          <div className="pos-top"><div className="card-t">{t('Your positions')}</div><span className="earning">{t('Earning')}</span></div>
          <div className="pos-mid">
            <div><div className="pos-big num" data-len={lenStep(fmtInt(total), 9, 12)}>≈ {fmtInt(total)}</div><div className="sub">{held.length === 1 ? t('FCFA · in 1 pool') : t('FCFA · across {n} pools', { n: held.length })}</div></div>
            <div style={{ textAlign: 'right' }}>
              {FEES_30D > 0
                ? <><div style={{ fontWeight: 800, fontSize: 15, color: 'var(--acct)' }}>+{fmtInt(FEES_30D)}</div><div style={{ fontSize: 11.5, color: 'var(--mut)' }}>{t('fees earned · 30d')}</div></>
                : <><div style={{ fontWeight: 700, fontSize: 13, color: 'var(--mut)' }}>{t('No fees yet')}</div><div style={{ fontSize: 11.5, color: 'var(--fnt)' }}>{t('first payout in ~24h')}</div></>}
            </div>
          </div>
          <div className="pools" style={{ marginTop: 12 }}>
            {held.map((p) => {
              const a = poolAsset(p);
              return (
                <Link key={p.id} to={`/pool/${p.id}`} className="pool-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <AssetIcon char={p.char} color={p.color} logo={p.logo} />
                  <div className="pool-main"><div className="pool-n num">{fmtCrypto(positions[p.id]!, 2, a.dec)} {p.sym}</div><div className="pool-b">{t('≈ {amount} FCFA', { amount: fmtInt(value(p)) })}</div></div>
                  <div className="pool-r"><div className="pool-apy">{localizePct(p.apy)}</div><div className="pool-u">APY</div></div>
                </Link>
              );
            })}
          </div>
          <div className="links"><Link to="/pool/earnings" style={{ textDecoration: 'none' }}>{t('Earnings')}</Link><span className="sep">·</span><Link to="/pool/activity" style={{ textDecoration: 'none' }}>{t('Activity')}</Link></div>
        </div>
      )}
      <div className="card">
        <div className="card-t">{t('Pools')}</div>
        {state.status === 'loading' && <div className="empty-b" style={{ padding: '18px 0', textAlign: 'center', margin: '0 auto' }} role="status">{t('Loading pools…')}</div>}
        {state.status === 'error' && (
          <EmptyState icon="!" title={t("Couldn't load pools")} body={t('Check your connection and try again.')}
            action={<button className="btn sec fit" onClick={retry}>{t('Retry')}</button>} />
        )}
        {state.status === 'ready' && pools.length === 0 && (
          <EmptyState icon="◌" title={t('No pools available yet')} body={t("Liquidity pools aren't open right now. We'll show them here as soon as they are.")} />
        )}
        <div className="pools">
          {pools.map((p) => (
            <Link key={p.id} to={`/pool/${p.id}`} className="pool-row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <AssetIcon char={p.char} color={p.color} logo={p.logo} />
              <div className="pool-main">
                <div className="pool-n">{t(p.name)}</div><div className="pool-b" data-len={lenStep(p.blurb, 34, 44)}>{t(p.blurb)}</div>
                <div className="util"><i style={{ width: `${p.util}%` }} /></div>
              </div>
              <div className="pool-r"><div className="pool-apy" data-len={lenStep(p.apy, 5, 7)}>{localizePct(p.apy)}</div><div className="pool-u">{t('{n}% used', { n: p.util })}</div></div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
