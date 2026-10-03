import { Navigate, useNavigate } from 'react-router-dom';
import { KycIntro } from '../../components/Kyc';
import { useNeedsKyc } from '../../lib/limits';
import { useTrade } from '../../state/trade';

export default function Verify() {
  const nav = useNavigate();
  const { draft } = useTrade();
  const needsKyc = useNeedsKyc();
  if (!draft) return <Navigate to="/trade/sell" replace />;
  // already verified, or the order is small enough not to need a check
  if (!needsKyc(draft.tab === 'buy' ? draft.amount : draft.quote.fcfaGross)) return <Navigate to="/trade/review" replace />;
  return <KycIntro onBack={() => nav('/trade/review')} onStart={() => nav('/trade/verify/sdk')} />;
}
