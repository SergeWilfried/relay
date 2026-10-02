import { ASSETS, type Asset } from '../lib/data';
import { fmtCrypto } from '../lib/format';
import { AssetIcon } from './AssetIcon';
import { useBalances } from '../state/balances';
import { Sheet } from './Sheet';

export function AssetPicker({ selected, onPick, onClose }: { selected: string; onPick: (a: Asset) => void; onClose: () => void }) {
  const balances = useBalances();
  return (
    <Sheet title="Select asset" onClose={onClose}>
      {ASSETS.map((a) => (
        <button key={a.sym} type="button" className={`opt${a.sym === selected ? ' on' : ''}`} onClick={() => { onPick(a); onClose(); }}>
          <AssetIcon char={a.char} color={a.color} logo={a.logo} />
          <div style={{ flex: 1 }}>
            <div className="chip-s">{a.sym}</div>
            <div className="chip-n">{a.net}</div>
          </div>
          <div className="num" style={{ fontSize: 12.5, color: 'var(--mut)' }}>{balances.get(a.sym) === null ? '—' : fmtCrypto(balances.get(a.sym) as number, 2, a.dec)}</div>
        </button>
      ))}
    </Sheet>
  );
}
