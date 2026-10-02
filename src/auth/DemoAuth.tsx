import type { ReactNode } from 'react';
import { DEMO_WALLETS } from '../lib/wallet';
import { AuthCtx, type AuthState } from './AuthContext';

const demo: AuthState = {
  mode: 'demo', ready: true, authenticated: true, userId: 'demo', email: null,
  wallets: DEMO_WALLETS, walletStatus: 'ready', walletErrors: {}, retryWallets: () => {},
  openLogin: () => {}, logout: async () => {}, getAccessToken: async () => null,
};

/** No Privy app ID configured: run as a signed-in demo user with placeholder wallets. */
export const DemoAuth = ({ children }: { children: ReactNode }) => <AuthCtx.Provider value={demo}>{children}</AuthCtx.Provider>;
