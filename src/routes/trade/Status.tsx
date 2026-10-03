import { useEffect } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Spinner } from '../../components/Spinner';
import { StepList } from '../../components/StepList';
import { SUPPORT_EMAIL } from '../../lib/data';
import { fmtInt } from '../../lib/format';
import { useNow, useOnline } from '../../lib/net';
import { deriveProgress, inFlight } from '../../lib/orders';
import { tr, useT } from '../../i18n';
import { useApp } from '../../state/app';
import { useBalances } from '../../state/balances';

export default function Status() {
  const { id } = useParams();
  const nav = useNavigate();
  const { orders } = useApp();
  const online = useOnline();
  const { t } = useT();
  const balances = useBalances();
  const order = orders.find((o) => o.id === id);
  const now = useNow(!!order && inFlight(order, Date.now()), 500);

  const finished = !!order && deriveProgress(order, now).phase === 'done';
  // the wallet balance changed: re-read it once the order completes
  useEffect(() => { if (finished) balances.refresh(); }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order || !order.submitted) return <Navigate to="/activity" replace />;
  const { phase, step } = deriveProgress(order, now);
  if (phase === 'awaiting_deposit') return <Navigate to={order.tab === 'buy' ? `/trade/pay/${order.id}` : `/trade/deposit/${order.id}`} replace />;

  // Server-backed sells: show the real payout stages instead of the demo timeline
  const live = order.synced && order.tab === 'sell';
  // purchases registered with the server: the customer has paid; a person sends the crypto from the treasury
  const liveBuy = order.synced && order.tab === 'buy' && !!order.buy;
  const buy = order.buy;
  const shortWallet = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
  const steps: [string, string][] = liveBuy
    ? [[t('Payment received'), `${fmtInt(order.amount)} FCFA · ${order.provider?.name ?? ''}`], [t('Preparing your {sym}', { sym: order.from.sym }), t('Our team sends it from the treasury')], [t('{sym} sent', { sym: order.from.sym }), shortWallet(order.wallet)]]
    : live
    ? [[t('Deposit received'), t('{amount} confirmed on-chain', { amount: order.quote.summaryFrom })], [t('Payout review'), t('Our team checks and approves the payout')], [t('Sent to {provider}', { provider: order.provider?.name ?? t('mobile money') }), order.phone ?? '']]
    : order.steps;
  const reviewing = live && phase === 'processing' && step === 1;
  const sendingBuy = liveBuy && phase === 'processing';
  const underpaid = live && order.server?.status === 'underpaid';
  const done = phase === 'done';
  const failed = phase === 'failed';
  const stalled = phase === 'stalled';
  // prefer the real transaction we sent from the Relay wallet
  const txHash = order.depositTx ?? order.hash.replace('…', '');
  const explorer = order.from.explorer + txHash;
  const txLabel = order.depositTx ? `${order.depositTx.slice(0, 8)}…${order.depositTx.slice(-6)}` : order.hash;
  const refundNote = order.tab === 'sell'
    ? t('Your {sym} is safe. If it was received, it will be returned to the sending address within 24 hours.', { sym: order.from.sym })
    : order.tab === 'buy'
      ? t('If you were debited, the money will be returned to your mobile money account within 24 hours.')
      : t('Your {sym} is safe. Anything already converted is reversed automatically within 24 hours.', { sym: order.from.sym });

  return (
    <>
      {!online && !done && !failed && (
        <div className="notice warn" role="status">{t("You're offline. Your order keeps processing — we'll update this screen when you're back.")}</div>
      )}
      <div className="status-top" aria-live="polite">
        {done ? <div className="check">✓</div> : failed ? <div className="check bad">✕</div> : <Spinner large />}
        <div className="status-t">{done ? order.doneTitle : failed ? (live ? t('Payout needs attention') : t("This didn't go through")) : reviewing ? t('Payout under review') : sendingBuy ? t('Sending your {sym}', { sym: order.from.sym }) : order.title}</div>
        <div className="status-s">
          {done ? order.doneSub : failed ? t("Step {n} of 3 didn't complete · {amount}", { n: step + 1, amount: order.quote.summaryFrom }) : reviewing ? t('{amount} to {provider}', { amount: order.quote.summaryTo, provider: order.provider?.name ?? '' }) : sendingBuy ? t('{amount} to your wallet', { amount: order.quote.summaryTo }) : order.sub}
        </div>
      </div>

      <StepList steps={steps} step={step} done={done} failedAt={failed ? step : undefined} />

      {order.server?.refund && (
        <div className="notice" role="status">
          <b>{order.server.refund.status === 'sent' ? t('Your refund was sent.') : t('Your refund is on its way.')}</b>{' '}
          {order.server.refund.status === 'sent'
            ? t('We returned your {sym} to your wallet.', { sym: order.from.sym })
            : t('We are returning your {sym}. You will see the transaction here once it is sent.', { sym: order.from.sym })}
          {order.server.refund.status === 'sent' && order.server.refund.txHash && (
            <div><a className="notice-act" href={order.from.explorer + order.server.refund.txHash} target="_blank" rel="noreferrer">{t('View the refund transaction')}</a></div>
          )}
        </div>
      )}
      {sendingBuy && (
        <div className="notice" role="status">
          <b>{t('We received your payment.')}</b> {t('Your {sym} will be sent to {wallet} shortly. You can leave this page.', { sym: order.from.sym, wallet: shortWallet(order.wallet) })}
          <div><Link to="/activity" className="notice-act">{t('Go to Activity')}</Link></div>
        </div>
      )}
      {liveBuy && buy?.hold && <div className="notice" role="status"><b>{t('Your purchase is being reviewed.')}</b> {tr(buy.hold.message)}</div>}
      {order.server?.hold && (
        <div className="notice" role="status"><b>{t('Your payout is on hold.')}</b> {tr(order.server.hold)}</div>
      )}
      {reviewing && (
        <div className="notice" role="status">
          <b>{t('Your payout is being reviewed.')}</b> {t("We've received your {sym}. Your FCFA will be sent to {provider} {phone} as soon as it's approved. You can leave this page.", { sym: order.from.sym, provider: order.provider?.name ?? '', phone: order.phone ?? '' })}
          <div><Link to="/activity" className="notice-act">{t('Go to Activity')}</Link></div>
        </div>
      )}
      {stalled && (
        <div className="notice" role="status">
          <b>{t('Taking longer than usual.')}</b> {t("You can leave this page — we'll keep processing and it will show in Activity.")}
          <div><Link to="/activity" className="notice-act">{t('Go to Activity')}</Link></div>
        </div>
      )}
      {failed && liveBuy && (
        <div className="notice warn" role="alert">
          <b>{t("This purchase didn't go through.")}</b> {buy?.failure ? `${tr(buy.failure)}. ` : ''}{t('Nothing was charged.')}
        </div>
      )}
      {failed && !liveBuy && (
        <div className="notice warn" role="alert">
          {live
            ? underpaid
              ? <><b>{t("Your deposit doesn't match the order.")}</b> {order.server?.note ? tr(order.server.note) : ''} {t("Contact support with order {id}: we'll fix or refund it.", { id: order.id })}</>
              : <><b>{t("We couldn't complete your payout.")}</b> {order.server?.payoutError ? `${tr(order.server.payoutError)}. ` : ''}{t("We have your {sym}: contact support with order {id} and we'll retry or refund it.", { sym: order.from.sym, id: order.id })}</>
            : refundNote}
        </div>
      )}

      {liveBuy
        ? done && buy?.txHash && <div className="hash">{buy.txHash.slice(0, 8)}…{buy.txHash.slice(-6)} · <a href={order.from.explorer + buy.txHash} target="_blank" rel="noreferrer">{t('view on explorer')}</a></div>
        : <div className="hash">{txLabel} · <a href={explorer} target="_blank" rel="noreferrer">{t('view on explorer')}</a></div>}

      {done && <button className="btn sec" onClick={() => nav(`/trade/${order.tab}`, { replace: true })}>{t('Start another')}</button>}
      {failed && (
        <div className="status-actions">
          {!live && <button className="btn" onClick={() => nav(`/trade/${order.tab}`, { replace: true })}>{t('Try again')}</button>}
          <a className={live ? 'btn' : 'btn sec'} style={{ textDecoration: 'none' }} href={`mailto:${SUPPORT_EMAIL}?subject=Relay ${order.id}`}>{t('Contact support')}</a>
        </div>
      )}
    </>
  );
}
