import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { BackHeader } from '../../components/BackHeader';
import { Spinner } from '../../components/Spinner';
import { submitApi, useSubmit } from '../../lib/api';
import { mmss, useNow } from '../../lib/net';
import { useApp } from '../../state/app';

export default function Deposit() {
  const { id } = useParams();
  const nav = useNavigate();
  const { orders, updateOrder, removeOrder } = useApp();
  const order = orders.find((o) => o.id === id);
  const { run, busy, error } = useSubmit();
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const now = useNow(!!order?.awaitingDeposit);

  // Placeholder: in production this is the per-order deposit address returned by the API.
  const addr = order?.from.deposit ?? '';
  useEffect(() => { if (addr) QRCode.toDataURL(addr, { margin: 0, width: 296, errorCorrectionLevel: 'M' }).then(setQr); }, [addr]);

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
          <div className="wait"><Spinner /><span>Waiting for your deposit…</span></div>
          <ActionButton busy={busy} busyLabel="Checking…" onClick={sent}>I've sent it</ActionButton>
          <ErrorNote>{error}</ErrorNote>
          <div className="note"><button className="qlink" onClick={cancel}>Cancel order</button></div>
        </>
      )}
    </>
  );
}
