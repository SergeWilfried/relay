import { ASSETS, NETWORK_LOGO, type Asset } from '../lib/data';
import { fmtCrypto } from '../lib/format';
import { useBalances } from '../state/balances';
import { AssetChip } from './AssetChip';
import { useT } from '../i18n';
import { Sheet } from './Sheet';

export function AssetPicker({ selected, onPick, onClose, exclude = [] }: { selected: string; onPick: (a: Asset) => void; onClose: () => void; /** symbols to leave out (e.g. BTC can't be swapped on-chain) */ exclude?: string[] }) {
  const { t } = useT();
  const balances = useBalances();
  return (
    <Sheet title={t('Select asset')} onClose={onClose}>
      {ASSETS.filter((a) => !exclude.includes(a.sym)).map((a) => {
        const bal = balances.get(a.sym);
        return (
          <button key={a.sym} type="button" className={`opt${a.sym === selected ? ' on' : ''}`} aria-label={t('{sym} on {net}', { sym: a.sym, net: a.net })} onClick={() => { onPick(a); onClose(); }}>
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
