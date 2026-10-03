import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ActionButton, ErrorNote } from '../../components/ActionButton';
import { BackHeader } from '../../components/BackHeader';
import { Spinner } from '../../components/Spinner';
import { fmtInt } from '../../lib/format';
import { fetchServerOrder, payServerBuy, patchFromServerBuy, type ServerBuy } from '../../lib/serverOrders';
import { useNow } from '../../lib/net';
import { tr, useT } from '../../i18n';
import { useApp } from '../../state/app';

const SHOW_STEPS_AFTER_MS = 12_000; // pawaPay: show the USSD steps if the prompt hasn't appeared after 10 to 15 seconds

/** The steps to follow, in the customer's language (the provider gives both). */
const steps = (ins: { en: string[]; fr: string[] } | null, lang: string) => (ins ? (lang === 'fr' ? ins.fr : ins.en) : []);

/**
 * Pays for a purchase with mobile money. How depends on the provider (read from its configuration):
 *  - PIN prompt: approve on the phone; the USSD steps appear if the prompt doesn't.
 *  - Wave: the customer is sent to Wave to approve, then comes back.
 *  - Orange Burkina Faso: the customer first generates a one-time code (USSD), types it here, then approves.
 * The page only reads state from the server; the money moves between the customer and the provider.
 */
export default function Pay() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, lang } = useT();
  const { orders, updateOrder } = useApp();
  const order = orders.find((o) => o.id === id);
  const b = order?.buy ?? null;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const [since, setSince] = useState<number | null>(null);
  const now = useNow(!!since, 1000);

  const apply = useCallback((nb: ServerBuy) => {
    if (!order) return;
    const patch = patchFromServerBuy(order, nb);
    if (patch) updateOrder(order.id, patch);
  }, [order, updateOrder]);

  const start = useCallback(async (preAuth?: string) => {
    if (!order) return;
    setBusy(true); setError(null);
    try { apply(await payServerBuy(order.id, preAuth)); setSince(Date.now()); }
    catch (e) { setError(e instanceof Error ? e.message : tr("We couldn't start the payment. Nothing was charged.")); }
    finally { setBusy(false); }
  }, [order, apply]);

  // PIN prompt and Wave start by themselves; Orange Burkina Faso waits for the code
  useEffect(() => {
    if (b?.status === 'created' && b.method && b.method.authType !== 'PREAUTH' && !started.current) { started.current = true; void start(); }
  }, [b?.status, b?.method, start]);

  // follow the payment (the sync also polls; this is quicker while the customer is looking at it)
  useEffect(() => {
    if (!order || b?.status !== 'collecting') return;
    let stop = false;
    const tick = async () => { try { const s = await fetchServerOrder(order.id); if (!stop && s?.tab === 'buy') apply(s); } catch { /* try again */ } };
    const timer = setInterval(() => void tick(), 3000);
    void tick();
    return () => { stop = true; clearInterval(timer); };
  }, [order?.id, b?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order || order.tab !== 'buy' || !order.synced) return <Navigate to="/activity" replace />;
  if (b && (b.status === 'collected' || b.status === 'delivered')) return <Navigate to={`/trade/status/${order.id}`} replace />;

  const failed = !!b && (b.status === 'failed' || b.status === 'expired' || b.status === 'cancelled');
  const method = b?.method ?? null;
  const authType = method?.authType ?? null;
  const showSteps = authType === 'PROVIDER_AUTH' && since !== null && now - since > SHOW_STEPS_AFTER_MS;
  const amount = `${fmtInt(order.amount)} FCFA`;
  const provider = order.provider?.name ?? '';

  return (
    <>
      <BackHeader title={t('Pay with {provider}', { provider })} to={`/trade/${order.tab}`} />

      {failed ? (
        <>
          <div className="status-top"><div className="check bad">✕</div>
            <div className="status-t">{t("This didn't go through")}</div>
            <div className="status-s">{b?.failure ? tr(b.failure) : b?.status === 'expired' ? t('This quote has expired. Please start the purchase again.') : t('The payment could not be completed')}</div>
          </div>
          <div className="notice" role="status">{t('Nothing was charged.')}</div>
          <button className="btn" onClick={() => nav(`/trade/${order.tab}`, { replace: true })}>{t('Start again')}</button>
        </>
      ) : authType === 'PREAUTH' && b?.status === 'created' ? (
        <>
          <div className="tile"><div className="sum">{amount} → {order.quote.summaryTo}</div></div>
          <div className="infobox">
            <b>{t('First, get your one-time code')}</b>
            <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>{steps(method?.codeInstructions ?? null, lang).map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
          <div className="amt edit" style={{ padding: '12px 14px', marginTop: 12 }}>
            <input className="mono" style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontSize: 18, letterSpacing: 2 }} inputMode="numeric" autoComplete="one-time-code"
              placeholder={t('Your one-time code')} aria-label={t('Your one-time code')} value={code} maxLength={36} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, ''))} autoFocus />
          </div>
          <ActionButton style={{ marginTop: 12 }} busy={busy} busyLabel={t('Starting payment…')} disabled={code.length < 4} onClick={() => start(code)}>{t('Pay {amount}', { amount })}</ActionButton>
          <ErrorNote>{error}</ErrorNote>
          <div className="note">{t('The code expires quickly: enter it right away.')}</div>
        </>
      ) : (
        <>
          <div className="status-top" aria-live="polite">
            <Spinner large />
            <div className="status-t">
              {authType === 'REDIRECT_AUTH' ? (b?.authUrl ? t('Continue to {provider}', { provider }) : t('Preparing {provider}…', { provider })) : t('Approve the payment on your phone')}
            </div>
            <div className="status-s">
              {authType === 'REDIRECT_AUTH' ? t("You'll approve {amount} in the {provider} app, then come back here.", { amount, provider }) : t('We asked {provider} to charge {amount}. Enter your PIN to approve it.', { provider, amount })}
            </div>
          </div>

          {authType === 'REDIRECT_AUTH' && b?.authUrl && <a className="btn" style={{ textDecoration: 'none' }} href={b.authUrl}>{t('Open {provider}', { provider })}</a>}

          {showSteps && steps(method?.instructions ?? null, lang).length > 0 && (
            <div className="infobox" style={{ marginTop: 12 }}>
              <b>{t("No prompt on your phone? Do this:")}</b>
              <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>{steps(method?.instructions ?? null, lang).map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
          )}
          <ErrorNote>{error}</ErrorNote>
          {error && <button className="btn sec" onClick={() => { started.current = false; setError(null); void start(); }}>{t('Try again')}</button>}
          <div className="note">{t('Keep this page open. It updates by itself once the payment is confirmed.')}</div>
        </>
      )}
    </>
  );
}
