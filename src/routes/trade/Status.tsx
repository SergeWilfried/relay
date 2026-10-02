import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Spinner } from '../../components/Spinner';
import { StepList } from '../../components/StepList';
import { SUPPORT_EMAIL } from '../../lib/data';
import { useNow, useOnline } from '../../lib/net';
import { deriveProgress, inFlight } from '../../lib/orders';
import { useApp } from '../../state/app';

export default function Status() {
  const { id } = useParams();
  const nav = useNavigate();
  const { orders } = useApp();
  const online = useOnline();
  const order = orders.find((o) => o.id === id);
  const now = useNow(!!order && inFlight(order, Date.now()), 500);

  if (!order || !order.submitted) return <Navigate to="/activity" replace />;
  const { phase, step } = deriveProgress(order, now);
  if (phase === 'awaiting_deposit') return <Navigate to={`/trade/deposit/${order.id}`} replace />;

  const done = phase === 'done';
  const failed = phase === 'failed';
  const stalled = phase === 'stalled';
  const explorer = order.from.explorer + order.hash.replace('…', '');
  const refundNote = order.tab === 'sell'
    ? `Your ${order.from.sym} is safe. If it was received, it will be returned to the sending address within 24 hours.`
    : order.tab === 'buy'
      ? 'If you were debited, the money will be returned to your mobile money account within 24 hours.'
      : `Your ${order.from.sym} is safe. Anything already converted is reversed automatically within 24 hours.`;

  return (
    <>
      {!online && !done && !failed && (
        <div className="notice warn" role="status">You're offline. Your order keeps processing — we'll update this screen when you're back.</div>
      )}
      <div className="status-top" aria-live="polite">
        {done ? <div className="check">✓</div> : failed ? <div className="check bad">✕</div> : <Spinner large />}
        <div className="status-t">{done ? order.doneTitle : failed ? "This didn't go through" : order.title}</div>
        <div className="status-s">
          {done ? order.doneSub : failed ? `Step ${step + 1} of 3 didn't complete · ${order.quote.summaryFrom}` : order.sub}
        </div>
      </div>

      <StepList steps={order.steps} step={step} done={done} failedAt={failed ? step : undefined} />

      {stalled && (
        <div className="notice" role="status">
          <b>Taking longer than usual.</b> You can leave this page — we'll keep processing and it will show in Activity.
          <div><Link to="/activity" className="notice-act">Go to Activity</Link></div>
        </div>
      )}
      {failed && <div className="notice warn" role="alert">{refundNote}</div>}

      <div className="hash">{order.hash} · <a href={explorer} target="_blank" rel="noreferrer">view on explorer</a></div>

      {done && <button className="btn sec" onClick={() => nav(`/trade/${order.tab}`, { replace: true })}>Start another</button>}
      {failed && (
        <div className="status-actions">
          <button className="btn" onClick={() => nav(`/trade/${order.tab}`, { replace: true })}>Try again</button>
          <a className="btn sec" style={{ textDecoration: 'none' }} href={`mailto:${SUPPORT_EMAIL}?subject=Relay order ${order.id}`}>Contact support</a>
        </div>
      )}
    </>
  );
}
