import { Outlet } from 'react-router-dom';
import { avgApy, totalTvlMillions, totalVolumeMillions } from '../../lib/data';
import { lenStep, localizePct } from '../../lib/format';
import { useT } from '../../i18n';

export const PoolLayout = () => <div className="page pool"><Outlet /></div>;

function Stat({ label, value, unit, acc }: { label: string; value: string; unit: string; acc?: boolean }) {
  const { t } = useT();
  return (
    <div className="stat">
      <div className="stat-l">{t(label)}</div>
      <div className={`stat-v${acc ? ' acc' : ''}`} data-len={lenStep(value, 5, 7)}>{value}</div>
      <div className="stat-u">{t(unit)}</div>
    </div>
  );
}

export function Stats({ empty }: { empty?: boolean }) {
  const v = (x: string) => (empty ? '—' : x);
  return (
    <div className="stats">
      <Stat label="Total liquidity" value={v(`${Math.round(totalTvlMillions())}M`)} unit="FCFA" />
      <Stat label="24h volume" value={v(`${Math.round(totalVolumeMillions())}M`)} unit="FCFA" />
      <Stat label="Avg APY" value={v(localizePct(`${avgApy().toFixed(1)}%`))} unit="paid in the pool asset" acc />
    </div>
  );
}
