import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ETH_CAIP2, fromBaseUnits, planSwap, SOL_CAIP2, SWAP_ASSETS, toBaseUnits } from '../worker/swapPlan.ts';

const wallets = { ethereum: { id: 'w-eth', address: '0xaaa' }, solana: { id: 'w-sol', address: 'SoLaddr111' } };
const plan = (over: Record<string, unknown> = {}) => planSwap({ from: 'ETH', to: 'USDC', amount: '0.5', wallets, ...over } as never);

test('amounts become exact base units; anything else is refused', () => {
  assert.equal(toBaseUnits('0.5', 18), '500000000000000000');
  assert.equal(toBaseUnits('1', 6), '1000000');
  assert.equal(toBaseUnits('0.000001', 6), '1');
  assert.equal(toBaseUnits('0.0000001', 6), null, 'more places than the token has');
  for (const bad of ['0', '0.0', '-1', '1e3', '', ' ', 'abc', '1.', '.5', '1,5']) assert.equal(toBaseUnits(bad, 18), null, bad);
  assert.equal(toBaseUnits('123456789012345678.123456789012345678', 18)?.length, 36);
});

test('a same-chain swap signs with the wallet on that chain and has no destination address', () => {
  const p = plan({ from: 'ETH', to: 'USDC' });
  assert.ok(p.ok);
  assert.equal(p.req.walletId, 'w-eth');
  assert.equal(p.req.crossChain, false);
  assert.deepEqual(p.req.body, { source: { caip2: ETH_CAIP2, asset_address: 'native' }, destination: { asset_address: SWAP_ASSETS.USDC!.address, caip2: ETH_CAIP2 }, base_amount: '500000000000000000', amount_type: 'exact_input' });
});

test('token swaps use the contract address; USDT -> USDC works in one chain', () => {
  const p = plan({ from: 'USDT', to: 'USDC', amount: '50' });
  assert.ok(p.ok && p.req.body.source.asset_address === SWAP_ASSETS.USDT!.address && p.req.body.base_amount === '50000000');
});

test('a cross-chain swap always pays out to the customer\'s OWN wallet on the other chain', () => {
  const p = plan({ from: 'ETH', to: 'SOL' });
  assert.ok(p.ok && p.req.crossChain);
  assert.equal(p.req.walletId, 'w-eth');
  assert.deepEqual(p.req.body.destination, { asset_address: 'native', caip2: SOL_CAIP2, destination_address: 'SoLaddr111' });
  const back = plan({ from: 'SOL', to: 'USDC', amount: '2' });
  assert.ok(back.ok && back.req.walletId === 'w-sol' && back.req.body.destination.destination_address === '0xaaa');
});

test('a destination address can never come from the request', () => {
  const p = planSwap({ from: 'ETH', to: 'SOL', amount: '1', wallets, destination_address: 'ATTACKER', destination: { destination_address: 'ATTACKER' } } as never);
  assert.ok(p.ok && p.req.body.destination.destination_address === 'SoLaddr111');
});

test('refusals: unknown or same assets, BTC, bad amount, missing wallets, bad slippage', () => {
  const err = (r: ReturnType<typeof plan>) => (r.ok ? 'ok' : r.error);
  assert.match(err(plan({ from: 'BTC' })), /can’t be swapped/);
  assert.match(err(plan({ to: 'DOGE' })), /can’t be swapped/);
  assert.match(err(plan({ from: 'ETH', to: 'ETH' })), /two different/);
  assert.match(err(plan({ amount: '0' })), /valid amount/);
  assert.match(err(plan({ amount: 5 })), /valid amount/);
  assert.match(err(planSwap({ from: 'SOL', to: 'USDC', amount: '1', wallets: { ethereum: wallets.ethereum } })), /wallet on this network/);
  assert.match(err(planSwap({ from: 'ETH', to: 'SOL', amount: '1', wallets: { ethereum: wallets.ethereum } })), /destination network/);
  assert.match(err(plan({ slippageBps: 5 })), /Slippage/);
  assert.match(err(plan({ slippageBps: 301 })), /Slippage/);
  assert.match(err(plan({ slippageBps: 1.5 })), /Slippage/);
});

test('slippage is passed through only when given and valid', () => {
  assert.equal((plan() as { req: { body: { slippage_bps?: number } } }).req.body.slippage_bps, undefined);
  assert.equal((plan({ slippageBps: 50 }) as { req: { body: { slippage_bps?: number } } }).req.body.slippage_bps, 50);
});

test('base units go back to decimals exactly', () => {
  assert.equal(fromBaseUnits('26826096', 6), '26.826096');
  assert.equal(fromBaseUnits('18631778936939323', 18), '0.018631778936939323');
  assert.equal(fromBaseUnits('1000000', 6), '1');
  assert.equal(fromBaseUnits('x', 6), 'x');
});
