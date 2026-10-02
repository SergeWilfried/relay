/**
 * Privy webhook event handling. Event names: https://docs.privy.io/api-reference/webhooks/overview
 * Privy does not document every payload field, so the accessors below are defensive: unknown shapes are
 * logged (without secrets) and acknowledged rather than failing, because a non-2xx makes Privy retry.
 */
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
      // A deposit to one of our users' wallets. Use `wallet:<address>` to find the user.
      // TODO(orders): when a database exists, match this to an awaiting-deposit order and advance it.
      const to = str(event.recipient) ?? str(obj(event.wallet).address);
      const user = to ? await env.EVENTS.get(`wallet:${to.toLowerCase()}`) : null;
      log('info', 'privy.wallet.funds_deposited', { eventId, userId: user, tx: str(event.transaction_hash), asset: str(event.asset) });
      return;
    }
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
