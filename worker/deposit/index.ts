import { createPawapayDepositProvider } from './pawapay';
import type { DepositProvider } from './types';

/**
 * The provider that collects FCFA for purchases. Only pawaPay can: there is no no-money sandbox for deposits, so buying is simply
 * unavailable unless PAYOUT_PROVIDER=pawapay (with the pawaPay sandbox for testing, which moves no money). The same safety checks
 * apply as for payouts (sandbox refused with LIVE=true, production refused without it).
 */
export function getDepositProvider(env: Env): DepositProvider | null {
	if (((env.PAYOUT_PROVIDER as string | undefined) ?? 'sandbox') !== 'pawapay') return null;
	return createPawapayDepositProvider(env, { cache: env.EVENTS });
}
