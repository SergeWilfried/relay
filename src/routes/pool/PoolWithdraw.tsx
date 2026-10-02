import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { BackHeader } from '../../components/BackHeader';
import { submitApi, useSubmit } from '../../lib/api';
import { fmtInt, parseAmount } from '../../lib/format';
import { useOnline } from '../../lib/net';
import { useT } from '../../i18n';
import { useApp } from '../../state/app';
import { BigAmount } from './BigAmount';

export default function PoolWithdraw() {
  const nav = useNavigate();
  const { position, setPosition, addPoolEvent } = useApp();
  const { t } = useT();
  const online = useOnline();
  const { run, busy, error } = useSubmit();
  const [v, setV] = useState(String(Math.floor(position / 2)));
  const [sent, setSent] = useState(false); // a full withdrawal zeroes the position; don't bounce to /pool before the receipt
  if (position <= 0 && !sent) return <Navigate to="/pool" replace />;
  const n = parseAmount(v);
  const bad = n <= 0 || n > position;
  const confirm = () => run(async () => {
    await submitApi();
    setSent(true); setPosition(position - n); addPoolEvent('withdrawal', n);
    nav('/pool/withdrawn', { state: { amount: n }, replace: true });
  });
  return (
    <div className="card">
      <BackHeader title={t('Withdraw')} to="/pool" />
      <BigAmount label={t('You withdraw')} value={v} onChange={setV} sub={t('To {provider} {phone} · arrives 1–2 min', { provider: 'Orange Money', phone: '+225 07 ·· 89' })} />
      <div className="kv2" style={{ padding: '14px 4px 16px' }}><div>{t('Remaining position')}</div><div>{fmtInt(Math.max(0, position - n))} FCFA</div></div>
      <ActionButton busy={busy} busyLabel={t('Confirming…')} disabled={bad || !online} onClick={confirm}>
        {!online ? t("You're offline") : n > position ? t('Exceeds your position') : t('Confirm withdrawal')}
      </ActionButton>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
