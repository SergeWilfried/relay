import { WALLET } from './data';

export interface Wallet {
  address: string;
  /** a pasted address (vs. the user's own wallet) */
  custom: boolean;
  /** no wallet on this network yet (e.g. Bitcoin): the user must add an address */
  missing?: boolean;
}

// Placeholder wallets used in demo mode (no Privy app ID).
export const DEMO_WALLETS: Record<string, string> = {
  Ethereum: WALLET,
  Solana: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  Bitcoin: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
};

/** Basic format check per network. Real validation (checksum, ENS) belongs server-side too. */
export function validAddress(net: string, a: string) {
  if (net === 'Bitcoin') return /^(bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a);
  if (net === 'Solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}

const KEY = 'relay-provider';
export const loadProvider = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const saveProvider = (id: string) => { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } };
