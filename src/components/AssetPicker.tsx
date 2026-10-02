import { ASSETS, NETWORK_LOGO, type Asset } from '../lib/data';
import { fmtCrypto } from '../lib/format';
import { useBalances } from '../state/balances';
import { AssetChip } from './AssetChip';
import { Sheet } from './Sheet';

export function AssetPicker({ selected, onPick, onClose }: { selected: string; onPick: (a: Asset) => void; onClose: () => void }) {
  const balances = useBalances();
  return (
    <Sheet title="Select asset" onClose={onClose}>
      {ASSETS.map((a) => {
        const bal = balances.get(a.sym);
        return (
          <button key={a.sym} type="button" className={`opt${a.sym === selected ? ' on' : ''}`} aria-label={`${a.sym} on ${a.net}`} onClick={() => { onPick(a); onClose(); }}>
            {/* the same compact chip as the selector: logo + chain badge + symbol */}
            <AssetChip compact sym={a.sym} net={a.net} char={a.char} color={a.color} logo={a.logo} badge={NETWORK_LOGO[a.net]} />
            <div style={{ flex: 1 }} />
            <div style={{ textAlign: 'right' }}>
              <div className="num" style={{ fontWeight: 700, fontSize: 14 }}>{bal === null ? '—' : fmtCrypto(bal, 2, a.dec)}</div>
              <div className="chip-n">{a.net}</div>
            </div>
          </button>
        );
      })}
    </Sheet>
  );
}
