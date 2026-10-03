import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TradeProvider, useTrade } from '../../state/trade';
import type { Tab } from '../../lib/data';
import { useT } from '../../i18n';

const TABS: [Tab, string][] = [['sell', 'Sell'], ['buy', 'Buy'], ['swap', 'Swap']];

function Card() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { tab } = useTrade();
  const { t: tl } = useT();
  const isForm = /^\/trade\/(swap|buy|sell)$/.test(pathname);
  return (
    <div className="page trade">
      <div className="shell">
        {isForm && <h1 className="sr-only">{tl(TABS.find(([t]) => t === tab)?.[1] ?? 'Trade')}</h1>}
        {isForm && (
          <div className="ftabs" role="tablist" aria-label={tl('Trade type')}>
            {TABS.map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`ftab${tab === t ? ' on' : ''}`} onClick={() => nav(`/trade/${t}`)}>{tl(label)}</button>
            ))}
          </div>
        )}
        <div className={`body${isForm ? ` ${tab}` : ''}`}><Outlet /></div>
      </div>
    </div>
  );
}

export const TradeLayout = () => <TradeProvider><Card /></TradeProvider>;
