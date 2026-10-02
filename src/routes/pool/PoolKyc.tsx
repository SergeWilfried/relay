import { useLocation, useNavigate } from 'react-router-dom';
import { KycIntro } from '../../components/Kyc';
import { useT } from '../../i18n';

export default function PoolKyc() {
  const nav = useNavigate();
  const { t } = useT();
  const { state } = useLocation();
  return <div className="card"><KycIntro compact title={t('Verify to start earning')} onBack={() => nav('/pool/add')} onStart={() => nav('/pool/verify', { state })} /></div>;
}
