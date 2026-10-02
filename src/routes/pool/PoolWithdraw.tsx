import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { BackHeader } from '../../components/BackHeader';
import { useT } from '../../i18n';
import { submitApi, useSubmit } from '../../lib/api';
import { fmtCrypto, parseAmount } from '../../lib/format';
import { useOnline } from '../../lib/net';
import { useApp } from '../../state/app';
import { BigAmount } from './BigAmount';
import { usePoolParam } from './usePoolParam';

export default function PoolWithdraw() {
  const nav = useNavigate();
  const { t } = useT();
  const p = usePoolParam();
  const { positions, setPosition, addPoolEvent } = useApp();
  const online = useOnline();
  const { run, busy, error } = useSubmit();
  const position = p ? positions[p.pool.id] ?? 0 : 0;
  const [v, setV] = useState(() => (position > 0 ? String(position / 2) : ''));
  const [sent, setSent] = useState(false); // a full withdrawal zeroes the position; don't bounce to /pool before the receipt
  if (!p || (position <= 0 && !sent)) return <Navigate to="/pool" replace />;
  const { pool, asset } = p;
  const n = parseAmount(v);
  const bad = n <= 0 || n > position;
  const confirm = () => run(async () => {
    await submitApi();
    setSent(true); setPosition(pool.id, position - n); addPoolEvent('withdrawal', pool.id, n);
    nav(`/pool/withdrawn?pool=${pool.id}`, { state: { amount: n }, replace: true });
  });
  return (
    <div className="card">
      <BackHeader title={t('Withdraw · {name}', { name: pool.name })} to={`/pool/${pool.id}`} />
      <BigAmount label={t('You withdraw')} value={v} onChange={setV} unit={pool.sym} dec={asset.dec}
        sub={<>{t('To your Relay wallet · arrives 1–2 min')}{' '}<button type="button" className="qlink" onClick={(e) => { e.preventDefault(); setV(String(position)); }}>{t('Max')}</button></>} />
      <div className="kv2" style={{ padding: '14px 4px 16px' }}><div>{t('Remaining position')}</div><div>{fmtCrypto(Math.max(0, position - n), 2, asset.dec)} {pool.sym}</div></div>
      <ActionButton busy={busy} busyLabel={t('Confirming…')} disabled={bad || !online} onClick={confirm}>
        {!online ? t("You're offline") : n > position ? t('Exceeds your position') : t('Confirm withdrawal')}
      </ActionButton>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
