import { useLocation } from 'react-router-dom';
import { fmtInt } from '../../lib/format';
import { useT } from '../../i18n';
import { Done } from './PoolDone';

export default function PoolWithdrawn() {
  const { t } = useT();
  const { state } = useLocation() as { state: { amount?: number } | null };
  return <Done title={t('Withdrawal sent')} sub={t('{amount} FCFA → Orange Money · 1–2 min', { amount: fmtInt(state?.amount ?? 0) })} />;
}
