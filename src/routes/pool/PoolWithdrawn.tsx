import { useLocation } from 'react-router-dom';
import { fmtInt } from '../../lib/format';
import { Done } from './PoolDone';

export default function PoolWithdrawn() {
  const { state } = useLocation() as { state: { amount?: number } | null };
  return <Done title="Withdrawal sent" sub={`${fmtInt(state?.amount ?? 0)} FCFA → Orange Money · 1–2 min`} />;
}
