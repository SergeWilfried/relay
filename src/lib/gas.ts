/** Keep a little native token back so the wallet can still pay network fees when the user taps Max. */
const GAS_RESERVE: Record<string, number> = { ETH: 0.002, SOL: 0.01 };

export const maxSpend = (sym: string, balance: number) => Math.max(0, balance - (GAS_RESERVE[sym] ?? 0));
