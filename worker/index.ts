import { AuthError, authenticate } from './auth';
import { BadRequest, createSellOrder, getOrder, listOrders } from './orders';
import { approvePayout, Conflict, listPayouts, rejectPayout, resolvePayout, retryPayout, settleFromWebhook } from './payouts';
import { getProvider } from './payout';
import { handleEvent, parseEvent } from './privy';
import { safeEqual, verifySvix, WebhookVerificationError } from './svix';

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

const MAX_JSON_BYTES = 16 * 1024;

/** Back-office endpoints for releasing payouts. Protected by the ADMIN_API_KEY secret (use a long random value). */
async function adminApi(request: Request, env: Env, pathname: string, url: URL): Promise<Response> {
	const key = /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
	if (!env.ADMIN_API_KEY || env.ADMIN_API_KEY.length < 16) return json({ error: 'Admin API is not configured' }, 503);
	if (!safeEqual(key, env.ADMIN_API_KEY)) return json({ error: 'Unauthorized' }, 401);

	if (pathname === '/api/admin/payouts' && request.method === 'GET') return json({ payouts: await listPayouts(env, url.searchParams.get('status') ?? undefined) });

	const m = /^\/api\/admin\/payouts\/([A-Za-z0-9]+)\/(approve|reject|retry|resolve)$/.exec(pathname);
	if (!m || request.method !== 'POST') return json({ error: 'Not found' }, 404);
	const [, id, action] = m as unknown as [string, string, string];
	let body: { reason?: unknown; outcome?: unknown; note?: unknown } = {};
	try { body = (await request.json()) as typeof body; } catch { /* body is optional for approve/retry */ }
	try {
		if (action === 'approve') return json(await approvePayout(env, id, 'admin'));
		if (action === 'retry') return json(await retryPayout(env, id));
		if (action === 'reject') {
			if (typeof body.reason !== 'string' || !body.reason) return json({ error: 'reason is required' }, 400);
			return json(await rejectPayout(env, id, body.reason));
		}
		if ((body.outcome !== 'paid' && body.outcome !== 'failed') || typeof body.note !== 'string' || !body.note) return json({ error: 'outcome (paid|failed) and note are required' }, 400);
		return json(await resolvePayout(env, id, body.outcome, body.note));
	} catch (e) {
		if (e instanceof Conflict) return json({ error: e.message }, 409);
		throw e;
	}
}

/** Payout status callbacks from the provider (signature check is provider-specific, see worker/payout). */
async function payoutWebhook(request: Request, env: Env): Promise<Response> {
	const body = await request.text();
	if (body.length > MAX_JSON_BYTES) return json({ error: 'Payload too large' }, 413);
	const event = await getProvider(env).parseWebhook(body, request.headers, env);
	if (!event) return json({ error: 'Invalid signature' }, 401);
	await settleFromWebhook(env, event.reference, event.state, event.error);
	return json({ ok: true });
}

/** Authenticated order API. Orders are only ever visible to the user that created them. */
async function ordersApi(request: Request, env: Env, pathname: string): Promise<Response> {
	let userId: string;
	try { userId = await authenticate(request, env); }
	catch (e) {
		if (e instanceof AuthError) return json({ error: e.message }, 401);
		console.error(JSON.stringify({ msg: 'auth.misconfigured', error: e instanceof Error ? e.message : String(e) }));
		return json({ error: 'Authentication is not configured' }, 500);
	}

	if (pathname === '/api/orders' && request.method === 'POST') {
		if (Number(request.headers.get('content-length') ?? 0) > MAX_JSON_BYTES) return json({ error: 'Payload too large' }, 413);
		let input: unknown;
		try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
		if (!input || typeof input !== 'object') return json({ error: 'Invalid JSON' }, 400);
		try { return json(await createSellOrder(env, userId, input as Record<string, unknown> as never), 201); }
		catch (e) { if (e instanceof BadRequest) return json({ error: e.message }, 400); throw e; }
	}

	if (pathname === '/api/orders' && request.method === 'GET') return json({ orders: await listOrders(env, userId) });

	const m = /^\/api\/orders\/([a-z0-9]{6,32})$/.exec(pathname);
	if (m && request.method === 'GET') {
		const order = await getOrder(env, userId, m[1]!);
		return order ? json(order) : json({ error: 'Not found' }, 404);
	}
	return json({ error: 'Not found' }, 404);
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
			if (pathname.startsWith('/api/admin/')) return await adminApi(request, env, pathname, new URL(request.url));
			if (pathname === '/api/webhooks/payout') return request.method === 'POST' ? await payoutWebhook(request, env) : json({ error: 'Method not allowed' }, 405);
			if (pathname === '/api/orders' || pathname.startsWith('/api/orders/')) return await ordersApi(request, env, pathname);
			if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
			return new Response(null, { status: 404 });
		} catch (e) {
			console.error(JSON.stringify({ msg: 'unhandled', path: pathname, error: e instanceof Error ? e.message : String(e) }));
			return json({ error: 'Internal error' }, 500);
		}
	},
} satisfies ExportedHandler<Env>;
