import { Navigate, useNavigate } from 'react-router-dom';
import { KycSdk } from '../../components/Kyc';
import { useApp } from '../../state/app';
import { useTrade } from '../../state/trade';

export default function VerifySdk() {
  const nav = useNavigate();
  const { setVerified } = useApp();
  const { draft } = useTrade();
  if (!draft) return <Navigate to="/trade/swap" replace />;
  // back to the review screen, which submits the order (it owns the quote timer and the error handling)
  return <KycSdk onApproved={() => { setVerified(); nav('/trade/review', { replace: true, state: { confirm: true } }); }} />;
}
