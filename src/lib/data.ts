// Mock reference data. Replace with API responses.
export type Tab = 'swap' | 'buy' | 'sell';

export interface Asset {
  sym: string;
  net: string;
  char: string;
  color: string;
  fcfa: number; // FCFA per 1 unit
  balance: number;
  explorer: string;
  /** decimals shown for amounts of this asset */
  dec: number;
  /** logo under /public/tokens; falls back to the lettered circle */
  logo?: string;
  /** placeholder deposit address (production: per-order address from the API) */
  deposit: string;
}

const EVM_ADDR = '0x8f3C4a92eE71B2d5C1f0A6b39C21d4E87a550c21';
export const ETH: Asset = { sym: 'ETH', net: 'Ethereum', char: 'E', color: '#627EEA', fcfa: 1_652_400, balance: 2.84, dec: 4, logo: '/tokens/eth.png', explorer: 'https://etherscan.io/tx/', deposit: EVM_ADDR };
export const SOL: Asset = { sym: 'SOL', net: 'Solana', char: 'S', color: '#9945FF', fcfa: 1_652_400 / 19.67, balance: 41.2, dec: 4, logo: '/tokens/sol.png', explorer: 'https://solscan.io/tx/', deposit: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' };
export const BTC: Asset = { sym: 'BTC', net: 'Bitcoin', char: 'B', color: '#F7931A', fcfa: 54_000_000, balance: 0.085, dec: 6, logo: '/tokens/btc.png', explorer: 'https://mempool.space/tx/', deposit: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' };
export const USDT: Asset = { sym: 'USDT', net: 'Ethereum', char: 'T', color: '#26A17B', fcfa: 600, balance: 1250, dec: 2, logo: '/tokens/usdt.png', explorer: 'https://etherscan.io/tx/', deposit: EVM_ADDR };
export const USDC: Asset = { sym: 'USDC', net: 'Ethereum', char: 'U', color: '#2775CA', fcfa: 600, balance: 480, dec: 2, logo: '/tokens/usdc.png', explorer: 'https://etherscan.io/tx/', deposit: EVM_ADDR };
/** Logo of the chain an asset lives on (shown as the corner badge on the token chip). */
export const NETWORK_LOGO: Record<string, string> = { Ethereum: '/tokens/eth.png', Solana: '/tokens/sol.png', Bitcoin: '/tokens/btc.png' };

export const ASSETS: Asset[] = [ETH, SOL, BTC, USDT, USDC];
export const FCFA_COLOR = '#3C9A5F';

export interface Provider {
  id: string;
  name: string;
  char: string;
  color: string;
  fg: string;
  number: string;
  /** logo under /public/providers; falls back to the lettered circle */
  logo?: string;
}

export const PROVIDERS: Provider[] = [
  { id: 'orange', name: 'Orange Money', char: 'O', color: '#FF7900', fg: '#fff', number: '+225 07 89 45 89', logo: '/providers/orange.png' },
  { id: 'wave', name: 'Wave', char: 'W', color: '#1DC8FF', fg: '#fff', number: '+225 05 55 01 22', logo: '/providers/wave-logo.png' },
  { id: 'pispi', name: 'PI-SPI', char: 'π', color: '#FAB900', fg: '#1a1a1a', number: '+225 07 12 34 56', logo: '/providers/pispi.png' },
  { id: 'moov', name: 'Moov Money', char: 'M', color: '#0066B3', fg: '#fff', number: '+225 01 02 33 48', logo: '/providers/moov.png' },
];

export const WALLET = '0x8f3C4a92eE71B2d5C1f0A6b39C21d4E87a550c21';
export const WALLET_SHORT = '0x8f3C…9c21';

export interface Pool {
  id: string;
  /** the coin deposited into / withdrawn from this pool */
  sym: string;
  name: string;
  char: string;
  color: string;
  blurb: string;
  tvl: string;
  apy: string;
  util: number;
  feeRate: string;
  volume: string;
  logo?: string;
}

export const POOLS: Pool[] = [
  { id: 'eth', sym: 'ETH', name: 'ETH', char: 'E', color: ETH.color, logo: ETH.logo, blurb: '0.25% fee · TVL 198M', tvl: '198M FCFA', apy: '6.1%', util: 54, feeRate: '0.25%', volume: '31M FCFA' },
  { id: 'sol', sym: 'SOL', name: 'SOL', char: 'S', color: SOL.color, logo: SOL.logo, blurb: '0% fee · TVL 132M', tvl: '132M FCFA', apy: '7.3%', util: 61, feeRate: '0.25%', volume: '22M FCFA' },
  { id: 'usdt', sym: 'USDT', name: 'USDT', char: USDT.char, color: USDT.color, logo: USDT.logo, blurb: '0% fee · TVL 74M', tvl: '74M FCFA', apy: '5.2%', util: 48, feeRate: '0.25%', volume: '14M FCFA' },
  { id: 'usdc', sym: 'USDC', name: 'USDC', char: USDC.char, color: USDC.color, logo: USDC.logo, blurb: '0% fee · TVL 61M', tvl: '61M FCFA', apy: '4.9%', util: 43, feeRate: '0.25%', volume: '11M FCFA' },
];

export const poolAsset = (p: Pool): Asset => ASSETS.find((a) => a.sym === p.sym)!;

/** Total value locked across pools, in millions of FCFA (parsed from each pool's `tvl`). */
export const totalTvlMillions = () => POOLS.reduce((n, p) => n + (parseFloat(p.tvl) || 0), 0);
/** 24h volume across pools, millions of FCFA. */
export const totalVolumeMillions = () => POOLS.reduce((n, p) => n + (parseFloat(p.volume) || 0), 0);
/** Simple average APY across pools, as a percent number. */
export const avgApy = () => POOLS.reduce((n, p) => n + (parseFloat(p.apy) || 0), 0) / Math.max(1, POOLS.length);

/**
 * Stand-ins for the pool earnings API. Empty until the backend reports payouts,
 * so a new provider sees empty states rather than invented history.
 */
export const FEES_30D = 0;
export const DAILY_FEES: number[] = []; // last 7 days, FCFA
export const FEES_BY_POOL: { name: string; amount: number }[] = [];

/** Placeholder: replace with the real support address. */
export const SUPPORT_EMAIL = 'support@relay.example';
