import { Outlet } from 'react-router-dom';
import { totalTvlMillions } from '../../lib/data';
import { lenStep } from '../../lib/format';

export const PoolLayout = () => <div className="page pool"><Outlet /></div>;

function Stat({ label, value, unit, acc }: { label: string; value: string; unit: string; acc?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}</div>
      <div className={`stat-v${acc ? ' acc' : ''}`} data-len={lenStep(value, 5, 7)}>{value}</div>
      <div className="stat-u">{unit}</div>
    </div>
  );
}

export function Stats({ empty }: { empty?: boolean }) {
  const v = (x: string) => (empty ? '—' : x);
  return (
    <div className="stats">
      <Stat label="Total liquidity" value={v(`${Math.round(totalTvlMillions())}M`)} unit="FCFA" />
      <Stat label="24h volume" value={v('96M')} unit="FCFA" />
      <Stat label="Avg APY" value={v('9.2%')} unit="paid in FCFA" acc />
    </div>
  );
}
