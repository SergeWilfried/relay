import { safeEqual } from '../svix';
import type { PayoutProvider } from './types';

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Sandbox provider: no money moves. Behaviour is driven by the last digits of the phone number so every path can be tested:
 *   ...0000  -> definitive failure           ...9999 -> accepted, settles later via webhook
 *   ...5555  -> network error (outcome unknown)        anything else -> paid immediately
 * Its webhook is signed with PAYOUT_WEBHOOK_SECRET: header `x-signature` = hex HMAC-SHA256 of the raw body.
 * Replace this file with the real provider's adapter (same interface).
 */
export const sandboxProvider: PayoutProvider = {
	name: 'sandbox',

	async send({ reference, phone }) {
		if (phone.endsWith('5555')) throw new Error('Sandbox network error');
		if (phone.endsWith('0000')) return { state: 'failed', error: 'Number is not registered for mobile money (sandbox)' };
		if (phone.endsWith('9999')) return { state: 'pending', providerRef: `sbx_${reference}` };
		return { state: 'paid', providerRef: `sbx_${reference}` };
	},

	async parseWebhook(body, headers, env) {
		const sig = headers.get('x-signature');
		if (!sig || !env.PAYOUT_WEBHOOK_SECRET) return null;
		const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PAYOUT_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
		if (!safeEqual(sig, expected)) return null;
		try {
			const v = JSON.parse(body) as { reference?: unknown; status?: unknown; error?: unknown };
			if (typeof v.reference !== 'string' || (v.status !== 'paid' && v.status !== 'failed')) return null;
			return { reference: v.reference, state: v.status, error: typeof v.error === 'string' ? v.error : undefined };
		} catch { return null; }
	},
};
