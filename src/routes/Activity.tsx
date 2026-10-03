import { Link } from 'react-router-dom';
import { AssetIcon } from '../components/AssetIcon';
import { EmptyState } from '../components/EmptyState';
import { locale, tr, useT } from '../i18n';
import { useNow } from '../lib/net';
import { deriveProgress, inFlight, type Order } from '../lib/orders';
import { useApp } from '../state/app';

const clock = (t: number) => new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const dayKey = (t: number) => new Date(t).toDateString();
/** "Today", "Yesterday", then the date: rows below it only need a time. */
const dayLabel = (t: number) => {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return tr('Today');
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return tr('Yesterday');
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};
/** What the customer did, in a noun: "Cash-out", "Purchase", "Swap ETH → SOL". */
const kindTitle = (o: Order) => o.tab === 'swap' ? `${tr('Swap')} ${o.from.sym} → ${o.to.sym}` : `${tr(o.tab === 'sell' ? 'Sale' : 'Purchase')}${o.provider ? ` · ${o.provider.name}` : ''}`;
const DIRECTION = { sell: '↑', buy: '↓', swap: '⇄' } as const; // out of the wallet, into it, between assets

function Tag({ o, now }: { o: Order; now: number }) {
  const { phase } = deriveProgress(o, now);
  if (phase === 'done') return <span className="tag-s ok">{tr('Completed')}</span>;
  if (phase === 'failed') return <span className="tag-s bad">{tr('Failed')}</span>;
  if (phase === 'awaiting_deposit') return <span className="tag-s">{tr('Awaiting deposit')}</span>;
  return <span className="tag-s">{phase === 'stalled' ? tr('Delayed') : tr('Processing')}</span>;
}

export default function Activity() {
  const { t } = useT();
  const { orders } = useApp();
  const list = orders.filter((o) => o.submitted);
  const now = useNow(list.some((o) => inFlight(o, Date.now())));
  return (
    <div className="page">
      <div className="card">
        <div className="card-t" style={{ marginBottom: 6 }}>{t('Activity')}</div>
        {list.length === 0 && (
          <EmptyState icon="⇄" title={t('No transactions yet')} body={t('Your swaps, purchases and cash-outs will appear here.')}
            action={<Link to="/trade/sell" className="btn sec fit" style={{ textDecoration: 'none', marginTop: 14 }}>{t('Make your first trade')}</Link>} />
        )}
        {list.map((o, i) => (
          <div key={o.id}>
            {(i === 0 || dayKey(o.createdAt) !== dayKey(list[i - 1]!.createdAt)) && <div className="hist-day">{dayLabel(o.createdAt)}</div>}
            <Link to={deriveProgress(o, now).phase === 'awaiting_deposit' ? `/trade/deposit/${o.id}` : `/trade/status/${o.id}`} className="hist-r row-link">
              <span className="hist-av" aria-hidden>
                <AssetIcon char={o.from.char} color={o.from.color} logo={o.from.logo} size={40} />
                <span className={`hist-dir ${o.tab}`}>{DIRECTION[o.tab]}</span>
              </span>
              <div className="hist-main">
                <div className="hist-title">{kindTitle(o)}</div>
                <div className="hist-meta"><Tag o={o} now={now} /><span>{clock(o.createdAt)}</span></div>
              </div>
              <div className="hist-amt num">
                {/* what the customer gets, over what they gave */}
                <div><div className="hist-to">{o.quote.summaryTo}</div><div className="hist-from">{o.quote.summaryFrom}</div></div>
                <span className="hist-chev" aria-hidden>›</span>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
