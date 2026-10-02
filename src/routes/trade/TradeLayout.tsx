import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TradeProvider, useTrade } from '../../state/trade';
import type { Tab } from '../../lib/data';

const TABS: [Tab, string][] = [['swap', 'Swap'], ['buy', 'Buy'], ['sell', 'Sell']];

function Card() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { tab } = useTrade();
  const isForm = /^\/trade\/(swap|buy|sell)$/.test(pathname);
  return (
    <div className="page trade">
      <div className="shell">
        {isForm && (
          <div className="ftabs" role="tablist" aria-label="Trade type">
            {TABS.map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`ftab${tab === t ? ' on' : ''}`} onClick={() => nav(`/trade/${t}`)}>{label}</button>
            ))}
          </div>
        )}
        <div className={`body${isForm ? ` ${tab}` : ''}`}><Outlet /></div>
      </div>
    </div>
  );
}

export const TradeLayout = () => <TradeProvider><Card /></TradeProvider>;
