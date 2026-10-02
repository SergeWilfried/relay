import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { useNow } from '../lib/net';
import { deriveProgress, inFlight, type Order } from '../lib/orders';
import { useApp } from '../state/app';

const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Tag({ o, now }: { o: Order; now: number }) {
  const { phase } = deriveProgress(o, now);
  if (phase === 'done') return <span className="tag-s ok">Completed</span>;
  if (phase === 'failed') return <span className="tag-s bad">Failed</span>;
  if (phase === 'awaiting_deposit') return <span className="tag-s">Awaiting deposit</span>;
  return <span className="tag-s">{phase === 'stalled' ? 'Delayed' : 'Processing'}</span>;
}

export default function Activity() {
  const { orders } = useApp();
  const list = orders.filter((o) => o.submitted);
  const now = useNow(list.some((o) => inFlight(o, Date.now())));
  return (
    <div className="page">
      <div className="card">
        <div className="card-t" style={{ marginBottom: 6 }}>Activity</div>
        {list.length === 0 && (
          <EmptyState icon="⇄" title="No transactions yet" body="Your swaps, purchases and cash-outs will appear here."
            action={<Link to="/trade/swap" className="btn sec fit" style={{ textDecoration: 'none', marginTop: 14 }}>Make your first trade</Link>} />
        )}
        {list.map((o) => (
          <Link key={o.id} to={deriveProgress(o, now).phase === 'awaiting_deposit' ? `/trade/deposit/${o.id}` : `/trade/status/${o.id}`} className="hist-r row-link" style={{ gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'capitalize' }}>{o.tab}{o.provider ? ` · ${o.provider.name}` : ''}<Tag o={o} now={now} /></div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)' }}>{when(o.createdAt)}</div>
            </div>
            <div className="num" style={{ flex: 'none', fontWeight: 800, fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap' }}>{o.quote.summaryFrom} → {o.quote.summaryTo}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
