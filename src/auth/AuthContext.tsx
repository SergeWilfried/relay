import { createContext, useContext } from 'react';

export type Network = 'Ethereum' | 'Solana' | 'Bitcoin';

export interface AuthState {
  /** 'privy' when VITE_PRIVY_APP_ID is set, otherwise a local demo user. */
  mode: 'privy' | 'demo';
  ready: boolean;
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  /** The user's own wallets, keyed by network. Bitcoin isn't provisioned (users paste an address). */
  wallets: Partial<Record<Network, string>>;
  /** Embedded wallet provisioning after sign-in. */
  walletStatus: 'ready' | 'creating' | 'error';
  walletErrors: Partial<Record<'Ethereum' | 'Solana', string>>;
  retryWallets: () => void;
  /** Can this asset be sent from the user's Relay wallet? (false for BTC, or when the wallet doesn't exist yet) */
  canSend: (sym: string) => boolean;
  /** Sends `amount` of `sym` from the Relay wallet to `to`. Resolves with the transaction hash / signature. */
  sendAsset: (sym: string, to: string, amount: number) => Promise<string>;
  /** Opens Privy's full login modal (passkey, social, SMS/WhatsApp and wallet, as enabled in the dashboard). */
  openLogin: () => void;
  logout: () => Promise<void>;
  /** JWT to send to your API as `Authorization: Bearer …`; verify it server-side with Privy. */
  getAccessToken: () => Promise<string | null>;
}

export const AuthCtx = createContext<AuthState | null>(null);

export const useAuth = () => {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
};

export const initials = (email: string | null) => (email ? email.slice(0, 2).toUpperCase() : '0x');
