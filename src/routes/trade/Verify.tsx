import { Navigate, useNavigate } from 'react-router-dom';
import { KycIntro } from '../../components/Kyc';
import { useTrade } from '../../state/trade';

export default function Verify() {
  const nav = useNavigate();
  const { draft } = useTrade();
  if (!draft) return <Navigate to="/trade/swap" replace />;
  return <KycIntro onBack={() => nav('/trade/review')} onStart={() => nav('/trade/verify/sdk')} />;
}
