import { useLocation } from 'react-router-dom';
import { useT } from '../../i18n';
import { fmtCrypto } from '../../lib/format';
import { Done } from './PoolDone';
import { usePoolParam } from './usePoolParam';

export default function PoolWithdrawn() {
  const { t } = useT();
  const p = usePoolParam();
  const { state } = useLocation() as { state: { amount?: number } | null };
  const amount = p ? fmtCrypto(state?.amount ?? 0, 2, p.asset.dec) : '0';
  return <Done title={t('Withdrawal sent')} sub={t('{amount} {sym} → your Relay wallet · 1–2 min', { amount, sym: p?.pool.sym ?? '' })} />;
}
