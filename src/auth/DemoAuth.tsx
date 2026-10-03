import type { ReactNode } from 'react';
import { DEMO_WALLETS } from '../lib/wallet';
import { setTokenGetter } from '../lib/http';
import { AuthCtx, type AuthState } from './AuthContext';
// TEMPORARY TEST PATCH (not to be committed)
const TEST_TOKEN = typeof localStorage !== 'undefined' ? localStorage.getItem('relay-test-token') : null;
if (TEST_TOKEN) setTokenGetter(async () => localStorage.getItem('relay-test-token'));

const demo: AuthState = {
  mode: TEST_TOKEN ? 'privy' : 'demo', ready: true, authenticated: true, userId: 'demo', email: null,
  wallets: DEMO_WALLETS,
  // demo mode never moves funds: pretend the transfer went through
  canSend: (sym) => sym !== 'BTC',
  sendAsset: async () => { await new Promise((r) => setTimeout(r, 900)); return `0xdemo${Date.now().toString(16)}`; }, walletStatus: 'ready', walletErrors: {}, retryWallets: () => {},
  swapReady: () => (TEST_TOKEN ? localStorage.getItem('swap-ready') === '1' : true),
  enableSwaps: async () => { await new Promise((r) => setTimeout(r, 500)); await fetch('http://localhost:5991/_control?delegated=1', { mode: 'no-cors' }); localStorage.setItem('swap-ready', '1'); },
  openLogin: () => {}, logout: async () => {}, getAccessToken: async () => null,
};

/** No Privy app ID configured: run as a signed-in demo user with placeholder wallets. */
export const DemoAuth = ({ children }: { children: ReactNode }) => <AuthCtx.Provider value={demo}>{children}</AuthCtx.Provider>;
