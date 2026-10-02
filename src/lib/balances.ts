/**
 * On-chain balance reads (read-only JSON-RPC). Override the endpoints with VITE_ETH_RPC_URL / VITE_SOL_RPC_URL;
 * the public defaults are rate-limited, so use your own provider key in production.
 */
const ETH_RPC = (import.meta.env.VITE_ETH_RPC_URL as string | undefined) || 'https://ethereum-rpc.publicnode.com';
const SOL_RPC = (import.meta.env.VITE_SOL_RPC_URL as string | undefined) || 'https://solana-rpc.publicnode.com';

// Ethereum mainnet token contracts
export const ERC20: Record<string, { address: string; decimals: number }> = {
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
};

async function rpc<T>(url: string, body: unknown): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    return (await res.json()) as T;
  } finally { clearTimeout(t); }
}

const hexToNumber = (hex: string, decimals: number) => Number(BigInt(hex || '0x0')) / 10 ** decimals;

interface RpcItem { id: number; result?: string; error?: { message: string } }

/** ETH + USDT + USDC for one address in a single batched request. */
export async function fetchEthereumBalances(address: string): Promise<Record<string, number>> {
  const pad = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const calls = [
    { jsonrpc: '2.0', id: 0, method: 'eth_getBalance', params: [address, 'latest'] },
    ...Object.values(ERC20).map((t, i) => ({
      jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [{ to: t.address, data: `0x70a08231${pad}` }, 'latest'], // balanceOf(address)
    })),
  ];
  const res = await rpc<RpcItem[]>(ETH_RPC, calls);
  const byId = new Map(res.map((r) => [r.id, r]));
  const get = (id: number, dec: number) => {
    const r = byId.get(id);
    if (!r || r.error || r.result === undefined) throw new Error(r?.error?.message ?? 'Missing RPC result');
    return hexToNumber(r.result, dec);
  };
  const out: Record<string, number> = { ETH: get(0, 18) };
  Object.entries(ERC20).forEach(([sym, t], i) => { out[sym] = get(i + 1, t.decimals); });
  return out;
}

export async function fetchSolanaBalance(address: string): Promise<number> {
  const res = await rpc<{ result?: { value: number }; error?: { message: string } }>(SOL_RPC, { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] });
  if (res.error || !res.result) throw new Error(res.error?.message ?? 'Missing RPC result');
  return res.result.value / 1e9;
}
