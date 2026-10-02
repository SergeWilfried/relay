import { useState } from 'react';
import { shortAddr } from '../lib/quote';
import { validAddress, type Wallet } from '../lib/wallet';
import { useAuth } from '../auth/AuthContext';
import { Sheet } from './Sheet';

export function WalletSheet({ net, current, onPick, onClose }: { net: string; current: Wallet; onPick: (w: Wallet) => void; onClose: () => void }) {
  const { wallets } = useAuth();
  const own = wallets[net as keyof typeof wallets];
  const [v, setV] = useState(current.custom ? current.address : '');
  const trimmed = v.trim();
  const ok = validAddress(net, trimmed);
  const showErr = trimmed.length > 0 && !ok;
  return (
    <Sheet title="Receiving wallet" onClose={onClose}>
      {own && (
        <button type="button" className={`opt${!current.custom ? ' on' : ''}`} onClick={() => { onPick({ address: own, custom: false }); onClose(); }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="chip-s">Your Relay wallet</div>
            <div className="chip-n mono">{shortAddr(own)}</div>
          </div>
          {!current.custom && <span style={{ color: 'var(--acct)', fontWeight: 800 }}>✓</span>}
        </button>
      )}
      <div className="sec-label" style={{ marginTop: 14 }}>{own ? `Or paste a ${net} address` : `Paste a ${net} address to receive to`}</div>
      <div className="amt edit" style={{ padding: '12px 14px' }}>
        <input className="mono" style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontSize: 12.5 }}
          placeholder={net === 'Solana' ? 'Solana address' : '0x…'} aria-label={`${net} address`} aria-invalid={showErr}
          value={v} onChange={(e) => setV(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </div>
      {showErr && <div className="note" style={{ color: '#D14343', margin: '6px 0 0', textAlign: 'left' }}>That doesn't look like a valid {net} address.</div>}
      <div className="note" style={{ textAlign: 'left' }}>Double-check it — crypto sent to a wrong address can't be recovered.</div>
      <button className="btn" style={{ marginTop: 14 }} disabled={!ok} onClick={() => { onPick({ address: trimmed, custom: true }); onClose(); }}>Use this address</button>
    </Sheet>
  );
}
