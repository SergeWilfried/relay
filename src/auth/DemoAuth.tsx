import type { ReactNode } from 'react';
import { DEMO_WALLETS } from '../lib/wallet';
import { AuthCtx, type AuthState } from './AuthContext';

const demo: AuthState = {
  mode: 'demo', ready: true, authenticated: true, userId: 'demo', email: null,
  wallets: DEMO_WALLETS,
  // demo mode never moves funds: pretend the transfer went through
  canSend: (sym) => sym !== 'BTC',
  sendAsset: async () => { await new Promise((r) => setTimeout(r, 900)); return `0xdemo${Date.now().toString(16)}`; }, walletStatus: 'ready', walletErrors: {}, retryWallets: () => {},
  openLogin: () => {}, logout: async () => {}, getAccessToken: async () => null,
};

/** No Privy app ID configured: run as a signed-in demo user with placeholder wallets. */
export const DemoAuth = ({ children }: { children: ReactNode }) => <AuthCtx.Provider value={demo}>{children}</AuthCtx.Provider>;
