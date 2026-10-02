import { useNavigate } from 'react-router-dom';
import { BackHeader } from '../../components/BackHeader';
import { useT } from '../../i18n';

export default function PoolRisk() {
  const nav = useNavigate();
  const { t } = useT();
  const items = [
    ['No price exposure', 'You deposit FCFA and withdraw FCFA. This pool holds no crypto.'],
    ['Float risk', 'Your funds work inside the payment rail. At high utilization, withdrawals can take up to 24h.'],
    ['Not a bank deposit', 'Yield comes from transaction fees and is not guaranteed or state-insured.'],
  ];
  return (
    <div className="card">
      <BackHeader title={t('Before you deposit')} to="/pool" />
      <div className="risk">{items.map(([title, d]) => <div key={title}><b>{t(title!)}</b><p>{t(d!)}</p></div>)}</div>
      <button className="btn" onClick={() => nav('/pool/add', { replace: true })}>{t('I understand — continue')}</button>
    </div>
  );
}
