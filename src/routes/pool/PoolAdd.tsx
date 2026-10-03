import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { BackHeader } from '../../components/BackHeader';
import { useT } from '../../i18n';
import { submitApi, useSubmit } from '../../lib/api';
import { fmtCrypto, parseAmount } from '../../lib/format';
import { maxSpend } from '../../lib/gas';
import { useOnline } from '../../lib/net';
import { useApp } from '../../state/app';
import { useBalances } from '../../state/balances';
import { BigAmount } from './BigAmount';
import { usePoolParam } from './usePoolParam';

export default function PoolAdd() {
  const nav = useNavigate();
  const { t } = useT();
  const p = usePoolParam();
  const { state } = useLocation() as { state: { amount?: number; confirm?: boolean } | null };
  const { kyc, positions, setPosition, addPoolEvent } = useApp();
  const balances = useBalances();
  const online = useOnline();
  const { run, busy, error } = useSubmit();
  const [v, setV] = useState(state?.amount ? String(state.amount) : '');
  const auto = useRef(false);
  const n = parseAmount(v);
  const balance = p ? balances.get(p.pool.sym) : null;
  const insufficient = balance !== null && n > balance;

  const confirm = () => {
    if (!p) return;
    if (kyc !== 'verified') return nav(`/pool/kyc?pool=${p.pool.id}`, { state: { amount: n } });
    run(async () => {
      await submitApi();
      setPosition(p.pool.id, (positions[p.pool.id] ?? 0) + n);
      addPoolEvent('deposit', p.pool.id, n);
      nav(`/pool/done?pool=${p.pool.id}`, { state: { amount: n }, replace: true });
    });
  };

  // returning from identity verification: submit the deposit the user already entered
  useEffect(() => {
    if (state?.confirm && !auto.current && kyc === 'verified') { auto.current = true; confirm(); }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return <Navigate to="/pool" replace />;
  const { pool, asset } = p;
  const monthly = (n * parseFloat(pool.apy)) / 100 / 12;
  const label = !online ? t("You're offline") : insufficient ? t('Insufficient balance') : t('Confirm deposit');

  return (
    <div className="card">
      <BackHeader title={t('Add liquidity · {name}', { name: pool.name })} to={`/pool/${pool.id}`} />
      <BigAmount label={t('You deposit')} value={v} onChange={setV} unit={pool.sym} dec={asset.dec}
        sub={<>{t('From your Relay wallet')} · {t('Balance')} {balance === null ? '—' : fmtCrypto(balance, 2, asset.dec)}{' '}
          <button type="button" className="qlink" disabled={balance === null} onClick={(e) => { e.preventDefault(); setV(String(maxSpend(pool.sym, balance ?? 0))); }}>{t('Max')}</button></>} />
      <div className="kv2" style={{ paddingTop: 14 }}><div>{t('Projected earnings')}</div><div style={{ color: 'var(--acct)' }}>{t('~{amount} {sym} / month', { amount: fmtCrypto(monthly, 2, asset.dec), sym: pool.sym })}</div></div>
      <div className="kv2" style={{ paddingBottom: 16 }}><div>{t('Withdraw anytime')}</div><div>{t('1–2 min')}</div></div>
      <ActionButton busy={busy} busyLabel={t('Confirming…')} disabled={n <= 0 || !online || insufficient} onClick={confirm}>{label}</ActionButton>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
