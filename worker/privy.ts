/**
 * Privy webhook event handling. Event names: https://docs.privy.io/api-reference/webhooks/overview
 * Privy does not document every payload field, so the accessors below are defensive: unknown shapes are
 * logged (without secrets) and acknowledged rather than failing, because a non-2xx makes Privy retry.
 */
import { applyDeposit } from './orders';
import { settleSwap } from './swaps';
import { txHashOf } from './swap/privy';

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export interface PrivyEvent { type: string; [k: string]: unknown }

export function parseEvent(raw: string): PrivyEvent | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof obj(v).type === 'string' ? (v as PrivyEvent) : null;
  } catch { return null; }
}

interface WalletRef { address: string; chain: string | undefined }

/** Pulls wallet addresses out of a Privy `user` object (linked_accounts of type wallet). */
function walletsOf(user: Json): WalletRef[] {
  const accounts = Array.isArray(user.linked_accounts) ? user.linked_accounts : [];
  return accounts.flatMap((a) => {
    const acc = obj(a);
    const address = str(acc.address);
    return acc.type === 'wallet' && address ? [{ address, chain: str(acc.chain_type) }] : [];
  });
}

async function indexWallets(env: Env, userId: string, wallets: WalletRef[]): Promise<void> {
  if (wallets.length === 0) return;
  await Promise.all([
    env.EVENTS.put(`user:${userId}`, JSON.stringify({ userId, wallets, updatedAt: Date.now() })),
    // reverse lookup: address -> user, used to attribute deposits / transactions to a user
    ...wallets.map((w) => env.EVENTS.put(`wallet:${w.address.toLowerCase()}`, userId)),
  ]);
}

const log = (level: 'info' | 'warn', msg: string, extra: Json = {}) => console[level](JSON.stringify({ msg, ...extra }));

/** Handles one verified event. Throw to make Privy retry; return normally to acknowledge. */
export async function handleEvent(env: Env, event: PrivyEvent, eventId: string): Promise<void> {
  switch (event.type) {
    case 'user.created': {
      const user = obj(event.user);
      const userId = str(user.id);
      log('info', 'privy.user.created', { eventId, userId });
      if (userId) await indexWallets(env, userId, walletsOf(user));
      return;
    }
    case 'user.wallet_created': {
      const user = obj(event.user);
      const wallet = obj(event.wallet);
      const userId = str(user.id);
      const address = str(wallet.address);
      log('info', 'privy.user.wallet_created', { eventId, userId, chain: str(wallet.chain_type), address });
      if (userId && address) await indexWallets(env, userId, [{ address, chain: str(wallet.chain_type) }]);
      return;
    }
    case 'wallet.funds_deposited': {
      // A transfer into one of our wallets. If the receiving address is a sell order's deposit address, advance that order.
      const recipient = str(event.recipient) ?? str(obj(event.wallet).address);
      const asset = obj(event.asset);
      const amount = str(event.amount);
      const parsed = recipient && amount && /^\d+$/.test(amount) ? amount : null;
      if (!recipient || !parsed) {
        // shape we don't recognise: log the keys (not values) so it can be fixed, and acknowledge
        log('warn', 'privy.wallet.funds_deposited.unparsed', { eventId, keys: Object.keys(event) });
        return;
      }
      const type = str(asset.type) ?? (typeof event.asset === 'string' ? event.asset : undefined);
      const out = await applyDeposit(env, {
        recipient,
        caip2: str(event.caip2),
        assetAddress: str(asset.address),
        isNative: !str(asset.address) && (!type || /native|eth|sol/i.test(type)),
        amountUnits: BigInt(parsed),
        txHash: str(event.transaction_hash),
        // the sender isn't in Privy's documented payload; accept the likely names and log when none is present, so a silent gap is visible
        sender: str(event.sender) ?? str(event.from) ?? str(event.source),
      });
      log('info', 'privy.wallet.funds_deposited', { eventId, result: out.result, orderId: out.orderId, tx: str(event.transaction_hash) });
      if (out.result === 'advanced' && !(str(event.sender) ?? str(event.from) ?? str(event.source))) log('warn', 'deposit.sender_unknown', { eventId, orderId: out.orderId }); // the denylist source check (A-01) could not run
      return;
    }
    case 'wallet_action.swap.succeeded':
    case 'wallet_action.swap.failed':
    case 'wallet_action.swap.rejected': {
      // Privy finished a swap we submitted: settle it by our own reference id (or the action id)
      const status = event.type.endsWith('succeeded') ? 'succeeded' : event.type.endsWith('rejected') ? 'rejected' : 'failed';
      const settled = await settleSwap(env, {
        referenceId: str(event.reference_id) ?? null, actionId: str(event.wallet_action_id) ?? null, status,
        outputUnits: str(event.output_amount) ?? null, txHash: txHashOf(event.steps), failure: str(obj(event.failure_reason).message) ?? null,
      });
      log('info', `privy.${event.type}`, { eventId, action: str(event.wallet_action_id), ref: str(event.reference_id), settled });
      return;
    }
    case 'wallet_action.swap.created':
      log('info', 'privy.wallet_action.swap.created', { eventId, action: str(event.wallet_action_id), ref: str(event.reference_id) });
      return;
    case 'transaction.confirmed':
    case 'transaction.failed':
    case 'transaction.execution_reverted':
    case 'transaction.replaced':
    case 'transaction.provider_error':
    case 'transaction.broadcasted':
    case 'transaction.still_pending': {
      // TODO(orders): update the matching order (by `transaction_hash`) once orders are stored server-side.
      log('info', `privy.${event.type}`, { eventId, tx: str(event.transaction_hash), walletId: str(event.wallet_id) });
      return;
    }
    default:
      // acknowledged but not acted on (user.authenticated, mfa.*, wallet.* export events, ...)
      log('info', 'privy.event.ignored', { eventId, type: event.type });
  }
}
