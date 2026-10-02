import { useEffect, useRef, useState } from 'react';
import { useLoginWithEmail } from '@privy-io/react-auth';
import { ActionButton, ErrorNote } from '../components/ActionButton';
import { tr, useT } from '../i18n';
import { useAuth } from './AuthContext';

const RESEND_SECONDS = 30;
// Privy's own error messages are English; anything unexpected falls back to our translated text
const message = (e: unknown) => (e instanceof Error && e.message ? e.message : tr('Something went wrong. Please try again.'));

/** Email one-time-code login using Privy's headless hook, so it matches the app's own UI. */
export default function PrivyLogin() {
  const { openLogin } = useAuth();
  const { t } = useT();
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sending = state.status === 'sending-code';
  const verifying = state.status === 'submitting-code';
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const send = async () => {
    setError(null);
    try { await sendCode({ email: email.trim() }); setStep('code'); setCode(''); setCooldown(RESEND_SECONDS); }
    catch (e) { setError(message(e)); }
  };

  const verify = async (c: string) => {
    if (submitting.current) return;
    submitting.current = true; setError(null);
    try { await loginWithCode({ code: c }); } // on success `authenticated` flips and the route redirects
    catch (e) { setError(message(e)); setCode(''); }
    finally { submitting.current = false; }
  };

  if (step === 'code') {
    return (
      <>
        <h1 className="login-t">{t('Check your email')}</h1>
        <p className="login-s">{t('We sent a 6-digit code to')} <b>{email.trim()}</b>.</p>
        <input
          className="login-in code mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
          placeholder="••••••" aria-label={t('6-digit code')} value={code} disabled={verifying}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) verify(v); }}
        />
        <ErrorNote>{error}</ErrorNote>
        <ActionButton busy={verifying} busyLabel={t('Verifying…')} disabled={code.length !== 6} onClick={() => verify(code)} style={{ marginTop: 12 }}>{t('Verify')}</ActionButton>
        <div className="login-links">
          <button className="qlink" disabled={cooldown > 0 || sending} onClick={send}>{cooldown > 0 ? t('Resend code in {s}s', { s: cooldown }) : t('Resend code')}</button>
          <button className="qlink" onClick={() => { setStep('email'); setError(null); }}>{t('Use a different email')}</button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="login-t">{t('Welcome to Relay')}</h1>
      <p className="login-s">{t('Swap crypto and cash out to mobile money. Sign in to get your wallet.')}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (validEmail && !sending) send(); }}>
        <input className="login-in" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false}
          placeholder={t('you@example.com')} aria-label={t('Email address')} value={email} onChange={(e) => setEmail(e.target.value)} />
        <ErrorNote>{error}</ErrorNote>
        <ActionButton type="submit" busy={sending} busyLabel={t('Sending code…')} disabled={!validEmail} style={{ marginTop: 12 }}>{t('Continue with email')}</ActionButton>
      </form>
      <div className="login-or"><span>{t('or')}</span></div>
      <button className="btn sec" onClick={openLogin}>{t('More sign-in options')}</button>
    </>
  );
}
