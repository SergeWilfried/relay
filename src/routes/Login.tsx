import { lazy, Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Splash } from '../auth/Splash';
import { Spinner } from '../components/Spinner';

const PrivyLogin = lazy(() => import('../auth/PrivyLogin'));

export default function Login() {
  const { ready, authenticated, mode } = useAuth();
  const { state } = useLocation() as { state: { from?: string } | null };
  if (!ready) return <Splash />;
  if (authenticated) return <Navigate to={state?.from && state.from !== '/login' ? state.from : '/trade/swap'} replace />;
  if (mode === 'demo') return <Navigate to="/trade/swap" replace />;

  return (
    <div className="login">
      <div className="login-card">
        <div className="logo" style={{ justifyContent: 'center', marginBottom: 22 }}>
          <div className="logo-mark" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 18 }}>R</div>
          <div className="logo-text" style={{ fontSize: 24 }}>Relay</div>
        </div>
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>}><PrivyLogin /></Suspense>
        <p className="login-fine">By continuing you agree to the <a href="#terms">User Agreement</a>.</p>
      </div>
    </div>
  );
}
