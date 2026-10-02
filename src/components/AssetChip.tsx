import { AssetIcon } from './AssetIcon';
import { Chevron } from './Icons';

interface Props { sym: string; net: string; char: string; color: string; logo?: string; /** small network / provider logo shown on the avatar corner (phones) */ badge?: string; /** force the compact pill at every width (used in the picker) */ compact?: boolean; onClick?: () => void }

/**
 * Token selector. Desktop: avatar + symbol + network name + chevron.
 * Phones (see `.chip` rules in app.css): compact pill, avatar with a network badge in its corner, symbol only.
 */
export function AssetChip({ sym, net, char, color, logo, badge, compact, onClick }: Props) {
  const inner = (
    <>
      <span className="chip-av">
        <AssetIcon char={char} color={color} logo={logo} />
        {badge && <img className="chip-badge" src={badge} alt="" width={14} height={14} draggable={false} />}
      </span>
      <div className="chip-t"><div className="chip-s">{sym}</div><div className="chip-n">{net}</div></div>
      {onClick && <Chevron />}
    </>
  );
  return onClick
    ? <button type="button" className={`chip${compact ? ' compact' : ''}`} onClick={onClick} aria-label={`Choose asset, ${sym} on ${net}`}>{inner}</button>
    : <div className={`chip${compact ? ' compact' : ''}`} aria-label={`${sym} on ${net}`}>{inner}</div>;
}
