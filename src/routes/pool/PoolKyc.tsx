import { useLocation, useNavigate } from 'react-router-dom';
import { KycIntro } from '../../components/Kyc';

export default function PoolKyc() {
  const nav = useNavigate();
  const { state } = useLocation();
  return <div className="card"><KycIntro compact title="Verify to start earning" onBack={() => nav('/pool/add')} onStart={() => nav('/pool/verify', { state })} /></div>;
}
