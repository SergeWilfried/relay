import { createPawapayProvider } from './pawapay';
import { sandboxProvider } from './sandbox';
import type { PayoutProvider } from './types';

/** Picks the payout provider from the PAYOUT_PROVIDER var. Add real adapters here. */
export function getProvider(env: Env): PayoutProvider {
	const name = (env.PAYOUT_PROVIDER as string | undefined) ?? 'sandbox';
	// the sandbox pretends to pay: never let it run against real deposits
	if (name === 'sandbox' && (env.LIVE as string) === 'true') throw new Error('PAYOUT_PROVIDER=sandbox cannot be used with LIVE=true');
	if (name === 'sandbox') return sandboxProvider;
	// pawaPay refuses unsafe combinations itself (sandbox URL with LIVE=true, production URL without it)
	if (name === 'pawapay') return createPawapayProvider(env, { keyCache: env.EVENTS });
	throw new Error(`Unknown PAYOUT_PROVIDER "${name}"`);
}
