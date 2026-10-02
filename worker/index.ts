import { handleEvent, parseEvent } from './privy';
import { verifySvix, WebhookVerificationError } from './svix';

// Static assets are served by Cloudflare; this Worker only runs for /api/* (see run_worker_first in wrangler.jsonc).

const MAX_BODY_BYTES = 256 * 1024;
const DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60; // Privy retries for about a day; keep ids longer than that

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function privyWebhook(request: Request, env: Env): Promise<Response> {
	if (!env.PRIVY_WEBHOOK_SIGNING_SECRET) {
		console.error(JSON.stringify({ msg: 'PRIVY_WEBHOOK_SIGNING_SECRET is not set' }));
		return json({ error: 'Webhook not configured' }, 500);
	}

	// the signature covers the raw bytes, so read the body once as text and verify before parsing
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
	const body = await request.text();
	if (body.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);

	let eventId: string;
	try {
		eventId = await verifySvix({ body, headers: request.headers, secret: env.PRIVY_WEBHOOK_SIGNING_SECRET });
	} catch (e) {
		if (e instanceof WebhookVerificationError) {
			console.warn(JSON.stringify({ msg: 'privy.webhook.rejected', reason: e.message }));
			return json({ error: 'Invalid signature' }, 401);
		}
		throw e;
	}

	const event = parseEvent(body);
	if (!event) return json({ error: 'Invalid payload' }, 400);

	// Privy delivers at-least-once: skip events we've already processed
	const seenKey = `evt:${eventId}`;
	if (await env.EVENTS.get(seenKey)) return json({ ok: true, duplicate: true });

	// A thrown error becomes a 500 so Privy retries; the event is only marked processed after it succeeds.
	await handleEvent(env, event, eventId);
	await env.EVENTS.put(seenKey, String(Date.now()), { expirationTtl: DEDUPE_TTL_SECONDS });
	return json({ ok: true });
}

export default {
	async fetch(request, env): Promise<Response> {
		const { pathname } = new URL(request.url);
		try {
			if (pathname === '/api/health') return json({ ok: true });
			if (pathname === '/api/webhooks/privy') {
				if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
				return await privyWebhook(request, env);
			}
			if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
			return new Response(null, { status: 404 });
		} catch (e) {
			console.error(JSON.stringify({ msg: 'unhandled', path: pathname, error: e instanceof Error ? e.message : String(e) }));
			return json({ error: 'Internal error' }, 500);
		}
	},
} satisfies ExportedHandler<Env>;
