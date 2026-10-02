import { Link, useLocation } from 'react-router-dom';
import { fmtInt } from '../../lib/format';

export function Done({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="done-card">
      <div className="check">✓</div>
      <div className="status-t">{title}</div>
      <div className="status-s">{sub}</div>
      <Link to="/pool" className="btn sec fit" style={{ textDecoration: 'none' }}>Back to pools</Link>
    </div>
  );
}

export default function PoolDone() {
  const { state } = useLocation() as { state: { amount?: number } | null };
  return <Done title="Liquidity added" sub={`${fmtInt(state?.amount ?? 0)} FCFA · FCFA rail pool`} />;
}
