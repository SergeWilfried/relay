import { AssetIcon } from './AssetIcon';
import { Chevron } from './Icons';

interface Props { sym: string; net: string; char: string; color: string; logo?: string; onClick?: () => void }

export function AssetChip({ sym, net, char, color, logo, onClick }: Props) {
  const inner = (
    <>
      <AssetIcon char={char} color={color} logo={logo} />
      <div className="chip-t"><div className="chip-s">{sym}</div><div className="chip-n">{net}</div></div>
      {onClick && <Chevron />}
    </>
  );
  return onClick
    ? <button type="button" className="chip" onClick={onClick} aria-label={`Choose asset, ${sym}`}>{inner}</button>
    : <div className="chip">{inner}</div>;
}
