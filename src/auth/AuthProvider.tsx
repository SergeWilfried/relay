import { lazy, Suspense, type ReactNode } from 'react';
import { DemoAuth } from './DemoAuth';
import { Splash } from './Splash';

export const PRIVY_APP_ID = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim() || '';

// the Privy SDK is only downloaded when an app ID is configured
const PrivyAuth = lazy(() => import('./PrivyAuth'));

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <DemoAuth>{children}</DemoAuth>;
  return <Suspense fallback={<Splash />}><PrivyAuth appId={PRIVY_APP_ID}>{children}</PrivyAuth></Suspense>;
}
