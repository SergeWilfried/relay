// Privy policy definitions for Relay's per-order deposit wallets. Pure (no I/O) so test/policies.test.ts can check them.
// Docs: https://docs.privy.io/api-reference/policies/create  (examples: https://docs.privy.io/controls/policies/example-policies)
//
// Each rule pins the chain, the asset (token contract) and a maximum amount. When a treasury address is given
// (TREASURY_EVM / TREASURY_SOL) it also pins the DESTINATION, so a compromised signer can only send to the treasury.
// How Privy combines rules (this shapes everything below):
//  - a request no ALLOW rule matches is denied, and a matching DENY always wins;
//  - several ALLOW rules for one method are OR-ed, so a loose ALLOW "overrides" a strict one. Every restriction must
//    therefore live INSIDE the ALLOW rule's own conditions (AND), never in a separate ALLOW rule.
//
// Caps are DERIVED from the limits in worker/limits.ts (the single source of truth): DEPOSIT_HEADROOM times the verified per-transaction
// limit, converted at the reference rates in worker/pricing.ts, so rate drift never blocks a legitimate sweep. A deposit wallet only
// ever holds one order's deposit. Change a limit there and these follow (re-run this script with --apply to push them to Privy).
import { DEPOSIT_HEADROOM, LIMITS } from '../worker/limits.ts';
import { FCFA_PER_UNIT } from '../worker/pricing.ts';

export const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const DEPOSIT_CAP_FCFA = BigInt(Math.ceil(LIMITS.verified.perTx * DEPOSIT_HEADROOM));
/** FCFA -> base units of an asset at its reference rate, rounded up (a cap is never tighter than the limit it protects). */
const fcfaToUnits = (fcfa, rate, decimals) => {
  const r = BigInt(Math.round(rate * 1000)); // keep 3 decimals of the rate
  return ((fcfa * 10n ** BigInt(decimals) * 1000n + r - 1n) / r).toString();
};
export const CAPS = {
  ethWei: fcfaToUnits(DEPOSIT_CAP_FCFA, FCFA_PER_UNIT.ETH, 18),
  stableUnits: fcfaToUnits(DEPOSIT_CAP_FCFA, FCFA_PER_UNIT.USDT, 6),   // USDT and USDC share one rate
  solLamports: fcfaToUnits(DEPOSIT_CAP_FCFA, FCFA_PER_UNIT.SOL, 9),
};

const ERC20_TRANSFER_ABI = [{
  type: 'function', name: 'transfer', stateMutability: 'nonpayable',
  inputs: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}];

export const isEvmAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a ?? '');
export const isSolAddress = (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a ?? '');

const tx = (field, operator, value) => ({ field_source: 'ethereum_transaction', field, operator, value });

/** Ethereum mainnet only (chain id 1). */
const mainnet = tx('chain_id', 'eq', '1');

/** Accept the address as given and lowercased: Privy's address comparison may or may not be case-insensitive. */
const dest = (field_source, field, treasury, abi) => ({ field_source, field, ...(abi ? { abi } : {}), operator: 'in', value: [...new Set([treasury, treasury.toLowerCase()])] });

const stableTransfer = (name, token, treasury) => ({
  name,
  method: 'eth_sendTransaction',
  conditions: [
    mainnet,
    tx('to', 'eq', token),                // only this token contract
    tx('value', 'eq', '0'),               // a token transfer must not carry ETH along
    { field_source: 'ethereum_calldata', field: 'function_name', abi: ERC20_TRANSFER_ABI, operator: 'eq', value: 'transfer' },
    { field_source: 'ethereum_calldata', field: 'transfer.amount', abi: ERC20_TRANSFER_ABI, operator: 'lte', value: CAPS.stableUnits },
    ...(treasury ? [dest('ethereum_calldata', 'transfer.recipient', treasury, ERC20_TRANSFER_ABI)] : []),
  ],
  action: 'ALLOW',
});

const denyMethod = (method, name) => ({ name, method, conditions: [], action: 'DENY' });

export function buildPolicies({ treasuryEvm, treasurySol } = {}) {
  if (treasuryEvm && !isEvmAddress(treasuryEvm)) throw new Error('TREASURY_EVM must be a 0x address');
  if (treasurySol && !isSolAddress(treasurySol)) throw new Error('TREASURY_SOL must be a base58 address');
  return [
    {
      env: 'PRIVY_DEPOSIT_POLICY_EVM',
      body: {
        version: '1.0',
        name: 'Relay deposit wallet (EVM)',
        chain_type: 'ethereum',
        rules: [
          stableTransfer('USDT to treasury, mainnet, capped', USDT, treasuryEvm),
          stableTransfer('USDC to treasury, mainnet, capped', USDC, treasuryEvm),
          {
            name: 'ETH transfer, mainnet, capped',
            method: 'eth_sendTransaction',
            conditions: [mainnet, tx('value', 'lte', CAPS.ethWei), ...(treasuryEvm ? [dest('ethereum_transaction', 'to', treasuryEvm)] : [])],
            action: 'ALLOW',
          },
          // Defense in depth: already denied (no ALLOW matches), but an explicit DENY survives a future broad ALLOW.
          // (Typed-data and EIP-7702 are denied by default too; Privy rejects an explicit DENY for those methods without a condition.)
          denyMethod('exportPrivateKey', 'Never export the private key'),
          denyMethod('personal_sign', 'No message signing'),
        ],
      },
    },
    {
      env: 'PRIVY_DEPOSIT_POLICY_SOL',
      body: {
        version: '1.0',
        name: 'Relay deposit wallet (Solana)',
        chain_type: 'solana',
        rules: ['signAndSendTransaction', 'signTransaction'].map((method) => ({
          name: `SOL transfer, capped (${method})`.slice(0, 50),
          method,
          conditions: [
            { field_source: 'solana_system_program_instruction', field: 'instructionName', operator: 'eq', value: 'Transfer' },
            { field_source: 'solana_system_program_instruction', field: 'Transfer.lamports', operator: 'lte', value: CAPS.solLamports },
            ...(treasurySol ? [{ field_source: 'solana_system_program_instruction', field: 'Transfer.to', operator: 'eq', value: treasurySol }] : []),
          ],
          action: 'ALLOW',
        })),
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Static policies for USERS' own embedded wallets (matrix P-02, P-03..P-05, P-07). Not wired to wallets yet: Privy
// attaches a policy when a wallet is created or updated (PATCH /v1/wallets/{id} with policy_ids), so assigning a tier
// policy on KYC change is a server job that needs the wallet owner's authorization.
//
// Shape: ALLOW everything, then DENY what the matrix forbids. A DENY always wins, and DENY-only restrictions can't
// block swaps or other normal use (an ALLOW-based user policy would, because we have no router address to allowlist: P-01).
// Caps apply to ANY recipient: the matrix caps only "non-allowlisted" addresses, but there is no allowlist yet.
// ---------------------------------------------------------------------------------------------------------------

/** Reference prices used to turn USD caps into wei / lamports. PLACEHOLDERS from worker/pricing.ts (600 FCFA per USD):
 *  the ETH and SOL caps drift with the real price, so refresh them from a price feed before relying on them. Stablecoin caps are exact. */
export const FCFA_PER_USD = FCFA_PER_UNIT.USDT;
export const REF_USD = { ETH: Math.round(FCFA_PER_UNIT.ETH / FCFA_PER_USD), SOL: Math.round(FCFA_PER_UNIT.SOL / FCFA_PER_USD) };
/** Per-transfer USD caps by tier (P-03 unverified, P-04 verified): each tier's per-transaction limit in FCFA, rounded UP to whole USD. */
export const TIER_CAP_USD = [LIMITS.unverified.perTx, LIMITS.verified.perTx].map((fcfa) => Math.ceil(fcfa / FCFA_PER_USD));

const MAX_SAFE_APPROVAL = (2n ** 128n).toString(); // anything at or above this is an "unlimited" approval

const ERC20_APPROVE_ABI = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}];

const usdToWei = (usd) => ((BigInt(usd) * 10n ** 18n) / BigInt(REF_USD.ETH)).toString();
const usdToLamports = (usd) => ((BigInt(usd) * 10n ** 9n) / BigInt(REF_USD.SOL)).toString();

const allowAll = { name: 'Allow everything not denied below', method: '*', conditions: [], action: 'ALLOW' };

const denyOverCap = (name, token, usd) => ({
  name,
  method: 'eth_sendTransaction',
  conditions: [
    tx('to', 'eq', token),
    { field_source: 'ethereum_calldata', field: 'transfer.amount', abi: ERC20_TRANSFER_ABI, operator: 'gt', value: String(BigInt(usd) * 10n ** 6n) },
  ],
  action: 'DENY',
});

/** DENY rules that block transfers to anything in the recipient denylist (a Privy condition set kept in sync by worker/lists.ts). */
const denyListedEvm = (setId) => [
  { name: 'Deny ETH sent to a listed recipient', method: 'eth_sendTransaction', action: 'DENY',
    conditions: [tx('to', 'in_condition_set', setId)] },
  { name: 'Deny token sent to a listed recipient', method: 'eth_sendTransaction', action: 'DENY',
    conditions: [{ field_source: 'ethereum_calldata', field: 'transfer.recipient', abi: ERC20_TRANSFER_ABI, operator: 'in_condition_set', value: setId }] },
];
const denyListedSol = (setId) => ['signAndSendTransaction', 'signTransaction'].map((method) => ({
  name: `Deny SOL sent to a listed recipient (${method})`.slice(0, 50), method, action: 'DENY',
  conditions: [{ field_source: 'solana_system_program_instruction', field: 'Transfer.to', operator: 'in_condition_set', value: setId }],
}));

/** Names of the two recipient-denylist condition sets (created by scripts/privy-policies.mjs --users). */
export const DENY_SETS = [
  { env: 'PRIVY_DENY_SET_EVM', name: 'Relay recipient denylist (EVM)' },
  { env: 'PRIVY_DENY_SET_SOL', name: 'Relay recipient denylist (Solana)' },
];

export function buildUserPolicies({ denySets = {} } = {}) {
  const evmSet = denySets.evm ?? '<recipient-denylist-evm-set-id>';
  const solSet = denySets.sol ?? '<recipient-denylist-solana-set-id>';
  const tiers = TIER_CAP_USD.flatMap((usd, tier) => [
    {
      env: `PRIVY_POLICY_TIER${tier}_EVM`,
      body: {
        version: '1.0', name: `Relay user wallet, tier ${tier} (EVM)`.slice(0, 50), chain_type: 'ethereum',
        rules: [
          allowAll,
          { name: 'P-02 deny unlimited approvals', method: 'eth_sendTransaction', action: 'DENY', conditions: [
            { field_source: 'ethereum_calldata', field: 'approve.amount', abi: ERC20_APPROVE_ABI, operator: 'gte', value: MAX_SAFE_APPROVAL },
          ] },
          { name: `P-0${3 + tier} ETH transfer cap ${usd} USD`.slice(0, 50), method: 'eth_sendTransaction', action: 'DENY', conditions: [tx('value', 'gt', usdToWei(usd))] },
          denyOverCap(`P-0${3 + tier} USDT transfer cap ${usd} USD`.slice(0, 50), USDT, usd),
          denyOverCap(`P-0${3 + tier} USDC transfer cap ${usd} USD`.slice(0, 50), USDC, usd),
          ...denyListedEvm(evmSet),
        ],
      },
    },
    {
      env: `PRIVY_POLICY_TIER${tier}_SOL`,
      body: {
        version: '1.0', name: `Relay user wallet, tier ${tier} (Solana)`.slice(0, 50), chain_type: 'solana',
        rules: [
          allowAll,
          ...['signAndSendTransaction', 'signTransaction'].map((method) => ({
            name: `P-0${3 + tier} SOL cap ${usd} USD (${method})`.slice(0, 50), method, action: 'DENY',
            conditions: [
              { field_source: 'solana_system_program_instruction', field: 'instructionName', operator: 'eq', value: 'Transfer' },
              { field_source: 'solana_system_program_instruction', field: 'Transfer.lamports', operator: 'gt', value: usdToLamports(usd) },
            ],
          })),
          ...denyListedSol(solSet),
        ],
      },
    },
  ]);
  // P-07: swapped in automatically when an analyst freezes an account (sanctions hit or confirmed fraud)
  const frozen = ['ethereum', 'solana'].map((chain) => ({
    env: `PRIVY_POLICY_FROZEN_${chain === 'ethereum' ? 'EVM' : 'SOL'}`,
    body: { version: '1.0', name: `Relay frozen wallet (${chain === 'ethereum' ? 'EVM' : 'Solana'})`, chain_type: chain,
      rules: [{ name: 'P-07 deny all signing', method: '*', conditions: [], action: 'DENY' }] },
  }));
  return [...tiers, ...frozen];
}

// ---------------------------------------------------------------------------------------------------------------
// Override policy for Relay's SWAP SIGNER (the server key a customer authorises on their wallet, see scripts/privy-signer.mjs).
// The signer exists to run swaps, so what could move value OUT is denied: key export, the `transfer` wallet action (which sends tokens to
// any address; Relay never uses it), and ERC-20 `transfer` calls from the wallet (a swap approves and calls a router; it never sends a
// token to an address). Everything else is allowed, because Privy doesn't say which method a swap is evaluated as (`swap` is not a policy
// method) and an allowlist built on a guess would reject real swaps.
// NOT VERIFIED: with no funds a policy denial can't be observed (Privy checks the balance first), so whether these rules fire on swap and
// transfer actions is untested. Test one real swap AND one denied transfer on a funded test wallet before relying on this. A denied swap shows
// up as `rejected`; if that happens, drop the policy id from the app config and swaps work again.
// ---------------------------------------------------------------------------------------------------------------
export function buildSwapSignerPolicies() {
  const never = (method, name) => ({ name, method, conditions: [], action: 'DENY' });
  // the `transfer` wallet action needs at least one condition: an amount of 0 or more matches every transfer
  const noTransferAction = { name: 'No transfer action: swaps only', method: 'transfer', action: 'DENY', conditions: [{ field_source: 'action_request_body', field: 'source.amount', operator: 'gte', value: '0' }] };
  const tokenTransfer = (name, token) => ({
    name, method: 'eth_sendTransaction', action: 'DENY',
    conditions: [
      tx('to', 'eq', token),
      { field_source: 'ethereum_calldata', field: 'function_name', abi: ERC20_TRANSFER_ABI, operator: 'eq', value: 'transfer' },
    ],
  });
  return [
    {
      env: 'PRIVY_SWAP_POLICY_EVM',
      body: {
        version: '1.0', name: 'Relay swap signer (EVM)', chain_type: 'ethereum',
        rules: [
          allowAll,
          never('exportPrivateKey', 'Never export the private key'), never('exportSeedPhrase', 'Never export the seed phrase'),
          noTransferAction,
          tokenTransfer('No USDT transfer calls', USDT), tokenTransfer('No USDC transfer calls', USDC),
        ],
      },
    },
    {
      env: 'PRIVY_SWAP_POLICY_SOL',
      body: {
        version: '1.0', name: 'Relay swap signer (Solana)', chain_type: 'solana',
        rules: [
          allowAll,
          never('exportPrivateKey', 'Never export the private key'), never('exportSeedPhrase', 'Never export the seed phrase'),
          noTransferAction,
        ],
      },
    },
  ];
}
