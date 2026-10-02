import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppProvider } from '../state/app';
import { setPersistScope } from '../lib/persist';
import { useAuth } from './AuthContext';
import { Splash } from './Splash';

/** Gate for the signed-in app. App state is stored per user, so switching accounts never leaks KYC, orders or positions. */
export function RequireAuth() {
  const { ready, authenticated, userId } = useAuth();
  const loc = useLocation();
  if (!ready) return <Splash />;
  if (!authenticated || !userId) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  setPersistScope(userId); // before any child reads persisted state
  return <AppProvider key={userId}><Outlet /></AppProvider>;
}
