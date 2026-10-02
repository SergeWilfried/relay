import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { BackHeader } from '../../components/BackHeader';
import { submitApi, useSubmit } from '../../lib/api';
import { fmtInt, parseAmount } from '../../lib/format';
import { useOnline } from '../../lib/net';
import { useApp } from '../../state/app';
import { BigAmount } from './BigAmount';

export default function PoolAdd() {
  const nav = useNavigate();
  const { state } = useLocation() as { state: { amount?: number; confirm?: boolean } | null };
  const { kyc, position, setPosition, addPoolEvent } = useApp();
  const online = useOnline();
  const { run, busy, error } = useSubmit();
  const [v, setV] = useState(String(state?.amount ?? 2_000_000));
  const auto = useRef(false);
  const n = parseAmount(v);

  const confirm = () => {
    if (kyc !== 'verified') return nav('/pool/kyc', { state: { amount: n } });
    run(async () => {
      await submitApi();
      setPosition(position + n);
      addPoolEvent('deposit', n);
      nav('/pool/done', { state: { amount: n }, replace: true });
    });
  };

  // returning from identity verification: submit the deposit the user already entered
  useEffect(() => {
    if (state?.confirm && !auto.current && kyc === 'verified') { auto.current = true; confirm(); }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <BackHeader title="Add liquidity · FCFA rail" to="/pool" />
      <BigAmount label="You deposit" value={v} onChange={setV} sub="From Orange Money +225 07 ·· 89" />
      <div className="kv2" style={{ paddingTop: 14 }}><div>Projected earnings</div><div style={{ color: 'var(--acct)' }}>~{fmtInt(Math.round((n * 0.084) / 12 / 100) * 100)} FCFA / month</div></div>
      <div className="kv2" style={{ paddingBottom: 16 }}><div>Withdraw anytime</div><div>1–2 min to mobile money</div></div>
      <ActionButton busy={busy} busyLabel="Confirming…" disabled={n <= 0 || !online} onClick={confirm}>{online ? 'Confirm deposit' : "You're offline"}</ActionButton>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
