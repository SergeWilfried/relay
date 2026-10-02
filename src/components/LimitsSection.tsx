import { useT } from '../i18n';
import { fmtInt } from '../lib/format';
import { useLimits, type Usage } from '../lib/limits';
import { useApp } from '../state/app';

function Meter({ label, u, resets }: { label: string; u: Usage; resets: string }) {
  const { t } = useT();
  const level = u.pct >= 100 ? 'full' : u.pct >= 80 ? 'high' : '';
  return (
    <div className="field limit">
      <div className="limit-top">
        <div className="limit-l">{label}</div>
        <div className="limit-v num">{t('{used} / {limit} FCFA', { used: fmtInt(u.used), limit: fmtInt(u.limit) })}</div>
      </div>
      <div className={`limit-bar ${level}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={u.limit} aria-valuenow={Math.min(u.used, u.limit)}>
        <i style={{ width: `${u.pct}%` }} />
      </div>
      <div className="limit-s">{t('{amount} FCFA left · {resets}', { amount: fmtInt(u.remaining), resets })}</div>
    </div>
  );
}

/** Transaction limits for the Account card: per-transaction cap plus daily and monthly usage. */
export function LimitsSection() {
  const { t, locale } = useT();
  const { kyc } = useApp();
  const l = useLimits();
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });
  return (
    <section aria-label={t('Transaction limits')}>
      <div className="row-between" style={{ marginTop: 18, marginBottom: 8 }}>
        <div className="sec-label" style={{ margin: 0 }}>{t('Transaction limits')}</div>
        <span className={`tag-s ${kyc === 'verified' ? 'ok' : ''}`} style={{ marginLeft: 0 }}>{kyc === 'verified' ? t('Verified') : t('After verification')}</span>
      </div>
      <div className="field" style={{ marginTop: 0 }}>
        <div><div className="field-l">{t('Per transaction')}</div><div className="field-v num" style={{ fontFamily: 'inherit' }}>{t('{amount} FCFA max', { amount: fmtInt(l.perTx) })}</div></div>
      </div>
      <Meter label={t('Today')} u={l.daily} resets={t('resets at midnight')} />
      <Meter label={t('This month')} u={l.monthly} resets={t('resets on {date}', { date: date.format(l.monthResetsAt) })} />
      {kyc !== 'verified' && <div className="note" style={{ textAlign: 'left', marginTop: 8 }}>{t('Verify your identity to start trading. These limits apply once you are verified.')}</div>}
    </section>
  );
}
