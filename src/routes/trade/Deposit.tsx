import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { BackHeader } from '../../components/BackHeader';
import { Spinner } from '../../components/Spinner';
import { submitApi, useSubmit } from '../../lib/api';
import { fetchServerOrder } from '../../lib/serverOrders';
import { mmss, useNow } from '../../lib/net';
import { fmtCrypto } from '../../lib/format';
import { useAuth } from '../../auth/AuthContext';
import { useApp } from '../../state/app';
import { useBalances } from '../../state/balances';

export default function Deposit() {
  const { id } = useParams();
  const nav = useNavigate();
  const { orders, updateOrder, removeOrder } = useApp();
  const order = orders.find((o) => o.id === id);
  const { run, busy, error } = useSubmit();
  const auth = useAuth();
  const balances = useBalances();
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const now = useNow(!!order?.awaitingDeposit);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const synced = !!order?.synced;

  const addr = order?.depositAddress ?? order?.from.deposit ?? '';
  useEffect(() => { if (addr) QRCode.toDataURL(addr, { margin: 0, width: 296, errorCorrectionLevel: 'M' }).then(setQr); }, [addr]);

  // Live orders: ask the server whether the deposit has landed. The server advances the order from Privy's
  // wallet.funds_deposited webhook, so there's nothing for the user to click.
  const poll = useCallback(async () => {
    if (!order || !order.synced || !order.awaitingDeposit) return;
    setChecking(true);
    try {
      const s = await fetchServerOrder(order.id);
      if (!s) return;
      if (s.status === 'processing') updateOrder(order.id, { awaitingDeposit: false, startedAt: s.startedAt ?? Date.now(), depositTx: s.depositTx ?? order.depositTx });
      else if (s.status === 'underpaid') setServerNote(s.note ?? "We received a deposit that doesn't match your order.");
    } catch { /* offline or transient: the next poll retries */ } finally { setChecking(false); }
  }, [order, updateOrder]);
  useEffect(() => {
    if (!synced || !order?.awaitingDeposit) return;
    void poll();
    const t = setInterval(() => void poll(), 4000);
    return () => clearInterval(t);
  }, [synced, order?.awaitingDeposit, poll]);

  if (!order) return <Navigate to="/trade/sell" replace />;
  if (!order.awaitingDeposit) return <Navigate to={`/trade/status/${order.id}`} replace />;

  const left = Math.max(0, (order.depositExpiresAt ?? 0) - now);
  const expired = left === 0;

  const copy = async () => {
    try { await navigator.clipboard.writeText(addr); } catch { /* clipboard blocked */ }
    setCopied(true);
  };
  // production: auto-advance when the chain watcher sees the deposit
  const sent = () => run(async () => {
    await submitApi();
    updateOrder(order.id, { awaitingDeposit: false, startedAt: Date.now() });
    nav(`/trade/status/${order.id}`, { replace: true });
  });
  // Real funds only ever go to a configured (live) deposit address; the placeholder would lose them.
  const unsafe = auth.mode === 'privy' && !order.depositLive;
  const balance = balances.get(order.from.sym);
  const short = balance !== null && balance < order.amount;
  const canSendInApp = auth.canSend(order.from.sym) && !unsafe;
  const sendFromWallet = () => run(async () => {
    const hash = await auth.sendAsset(order.from.sym, addr, order.amount);
    if (order.synced) { updateOrder(order.id, { depositTx: hash }); void poll(); return; } // wait for the server to see it
    updateOrder(order.id, { awaitingDeposit: false, startedAt: Date.now(), depositTx: hash });
    nav(`/trade/status/${order.id}`, { replace: true });
  });
  const cancel = () => { removeOrder(order.id); nav('/trade/sell', { replace: true }); };

  return (
    <>
      <BackHeader title={`Send your ${order.from.sym}`} to="/activity" />
      {expired ? (
        <>
          <div className="qrwrap" role="alert">
            <div className="check bad" style={{ background: '#D14343' }}>!</div>
            <div className="status-t">Quote expired</div>
            <div className="status-s" style={{ maxWidth: 280, textAlign: 'center', lineHeight: 1.5 }}>
              The 15-minute window for {order.quote.summaryFrom} at this rate has ended. If you've already sent it, it will be converted at the current rate instead.
            </div>
          </div>
          <div className="status-actions" style={{ marginTop: 14 }}>
            <button className="btn" onClick={cancel}>Get a new quote</button>
            <ActionButton className="btn sec" busy={busy} busyLabel="Checking…" onClick={sent}>I've already sent it</ActionButton>
          </div>
          <ErrorNote>{error}</ErrorNote>
        </>
      ) : (
        <>
          <div className="qrwrap">
            <div className="qr">{qr ? <img src={qr} alt={`QR code for ${addr}`} /> : <span style={{ font: '600 11px Figtree', color: '#8A8794' }}>QR…</span>}</div>
            <div style={{ marginTop: 14, fontWeight: 800, fontSize: 15 }}>Send exactly {order.quote.summaryFrom}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: left < 60_000 ? '#C43232' : 'var(--mut)' }} role="timer" aria-live="off">
              {order.from.net} network only · quote locked {mmss(left)}
            </div>
          </div>
          <div className="field" style={{ marginTop: 8, padding: '12px 16px' }}>
            <div style={{ minWidth: 0 }}>
              <div className="field-l">Deposit address</div>
              <div className="field-v" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>{addr}</div>
            </div>
            <button className="copy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
          {unsafe && (
            <div className="notice warn" role="alert" style={{ marginTop: 12 }}>
              <b>Deposit address not configured.</b> This is a placeholder, so don't send real funds. Set <b>VITE_DEPOSIT_ADDR_{order.from.net === 'Solana' ? 'SOL' : order.from.net === 'Bitcoin' ? 'BTC' : 'ETH'}</b> (or return a per-order address from your API).
            </div>
          )}
          {serverNote && (
            <div className="notice warn" role="alert" style={{ marginTop: 12 }}>
              <b>We received a deposit, but it doesn't match.</b> {serverNote} Contact support with order {order.id}.
            </div>
          )}
          {synced && order.depositTx ? (
            // sent from the Relay wallet: nothing left to click, the server confirms it from the chain
            <div className="wait" style={{ marginTop: 14 }} role="status"><Spinner /><span>Sent. Waiting for the network to confirm your deposit…</span></div>
          ) : canSendInApp ? (
            <>
              <ActionButton style={{ marginTop: 12 }} busy={busy} busyLabel="Waiting for confirmation…" disabled={short} onClick={sendFromWallet}>
                Send {order.quote.summaryFrom} from your Relay wallet
              </ActionButton>
              {short && <div className="note" style={{ color: '#C43232' }}>Your Relay wallet has {balance === null ? '—' : fmtCrypto(balance, 2, order.from.dec)} {order.from.sym}. Add funds or send from another wallet.</div>}
              <div className="wait" style={{ marginBottom: 6 }}><Spinner /><span>Or send it yourself · we'll detect your deposit</span></div>
              {synced
                ? <ActionButton className="btn sec" busy={checking} busyLabel="Checking…" onClick={() => void poll()} disabled={busy}>Check for my deposit</ActionButton>
                : <ActionButton className="btn sec" busy={false} onClick={sent} disabled={busy}>I've sent it from another wallet</ActionButton>}
            </>
          ) : (
            <>
              <div className="wait"><Spinner /><span>Waiting for your deposit…</span></div>
              {synced
                ? <ActionButton className="btn sec" busy={checking} busyLabel="Checking…" onClick={() => void poll()}>Check for my deposit</ActionButton>
                : <ActionButton busy={busy} busyLabel="Checking…" onClick={sent}>I've sent it</ActionButton>}
            </>
          )}
          <ErrorNote>{error}</ErrorNote>
          <div className="note"><button className="qlink" onClick={cancel}>Cancel order</button></div>
        </>
      )}
    </>
  );
}
