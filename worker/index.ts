import { AuthError, authenticate } from './auth';
import { BadRequest, createSellOrder, getOrder, listOrders } from './orders';
import { approveRefund, cancelRefund, checkStaleRefunds, createRefund, listEligible, listRefunds, markRefundSent, RefundError } from './refunds';
import { FLOAT_FLOOR_XOF, checkFloat, reconcilePayouts, approvePayout, Conflict, listPayouts, rejectPayout, releaseHold, resolvePayout, retryPayout, settleFromWebhook } from './payouts';
import { getProvider } from './payout';
import { ensureProfile, loadModes, RULES, RuleDenied, setRuleMode, setUserStatus } from './rules';
import { revenueReport } from './revenue';
import { addEntry, ListError, listEntries, removeEntry, resyncEntries } from './lists';
import { clearClefFlag, runPatternReview } from './clefBatch';
import { POINTS } from './clef';
import { listSweeps, resolveSweep, retrySweep, runSweeps, SweepConflict } from './sweep';
import { handleEvent, parseEvent } from './privy';
import { safeEqual, verifySvix, WebhookVerificationError } from './svix';

// Static assets are served by Cloudflare; this Worker only runs for /api/* (see run_worker_first in wrangler.jsonc).

const DAILY_CRON = '0 3 * * *'; // keep in sync with wrangler.jsonc triggers
const MAX_BODY_BYTES = 256 * 1024;
const DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60; // Privy retries for about a day; keep ids longer than that

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Visitor country (ISO 3166-1 alpha-2) from Cloudflare's IP geolocation. Cosmetic for the UI; the only rule that uses it is the sanctioned-country DENY (R-01), never to allow or raise a limit (VPNs). */
const countryOf = (request: Request): string | null => {
	const c = (request.cf?.country as string | undefined) ?? request.headers.get('cf-ipcountry');
	return c && /^[A-Z]{2}$/.test(c) ? c : null; // 'XX' / 'T1' (unknown / Tor) fail the regex or map to no flag on the client
};

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

	if (pathname === '/api/admin/rules' && request.method === 'GET') {
		const modes = await loadModes(env);
		return json({
			rules: RULES.map((r) => ({ id: r.id, version: r.version, phase: r.phase, description: r.description, action: r.action, configuredMode: r.mode, mode: modes[r.id] ?? r.mode })),
			clefPoints: Object.values(POINTS).map((p) => ({ id: p.id, version: p.version, model: p.model, description: p.description, configuredMode: p.mode, mode: modes[p.id] ?? p.mode, enabled: (env.CLEF_ENABLED as string) === 'true' })),
		});
	}
	const rm = /^\/api\/admin\/rules\/([A-Z]-\d{2})\/mode$/.exec(pathname);
	if (rm && request.method === 'PUT') {
		const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
		if (!(RULES.some((r) => r.id === rm[1]) || rm[1]! in POINTS) || (body.mode !== 'shadow' && body.mode !== 'enforce')) return json({ error: 'Unknown rule or mode (shadow|enforce)' }, 400);
		await setRuleMode(env, rm[1]!, body.mode);
		return json({ id: rm[1], mode: body.mode });
	}
	if (pathname === '/api/admin/clef/calls' && request.method === 'GET') {
		const point = url.searchParams.get('point');
		const { results } = await (point ? env.DB.prepare('SELECT * FROM clef_calls WHERE point = ? ORDER BY id DESC LIMIT 100').bind(point) : env.DB.prepare('SELECT * FROM clef_calls ORDER BY id DESC LIMIT 100')).all();
		return json({ calls: results });
	}
	if (pathname === '/api/admin/clef/run-review' && request.method === 'POST') return json(await runPatternReview(env));
	const cf = /^\/api\/admin\/users\/([^/]{1,200})\/clef-flag\/clear$/.exec(pathname);
	if (cf && request.method === 'POST') {
		const body = (await request.json().catch(() => ({}))) as { note?: unknown };
		if (typeof body.note !== 'string' || !body.note) return json({ error: 'note is required' }, 400);
		return json({ cleared: await clearClefFlag(env, decodeURIComponent(cf[1]!), body.note) });
	}
	const um = /^\/api\/admin\/users\/([^/]{1,200})\/status$/.exec(pathname);
	if (um && request.method === 'POST') {
		const body = (await request.json().catch(() => ({}))) as { status?: unknown; note?: unknown };
		if (!['normal', 'restricted', 'frozen'].includes(body.status as string) || typeof body.note !== 'string' || !body.note) return json({ error: 'status (normal|restricted|frozen) and note are required' }, 400);
		await setUserStatus(env, decodeURIComponent(um[1]!), body.status as 'normal' | 'restricted' | 'frozen', body.note);
		return json({ user: decodeURIComponent(um[1]!), status: body.status });
	}

	if (pathname === '/api/admin/payouts/float' && request.method === 'GET') {
		const balances = await getProvider(env).balances?.();
		return json({ provider: getProvider(env).name, balances: balances ?? null, floorXof: FLOAT_FLOOR_XOF });
	}
	if (pathname === '/api/admin/payouts/reconcile' && request.method === 'POST') return json(await reconcilePayouts(env));
	if (pathname === '/api/admin/lists' && request.method === 'GET') return json({ entries: await listEntries(env, url.searchParams.get('kind') ?? undefined) });
	if (pathname === '/api/admin/lists' && request.method === 'POST') {
		const body = (await request.json().catch(() => ({}))) as { kind?: unknown; value?: unknown; note?: unknown };
		if (typeof body.note !== 'string' || body.note.trim().length < 3) return json({ error: 'note is required (why is it listed?)' }, 400);
		try { return json(await addEntry(env, String(body.kind), body.value, body.note.trim(), 'admin'), 201); }
		catch (e) { if (e instanceof ListError) return json({ error: e.message }, 400); throw e; }
	}
	if (pathname === '/api/admin/lists/sync' && request.method === 'POST') return json(await resyncEntries(env));
	const lm = /^\/api\/admin\/lists\/(\d{1,12})$/.exec(pathname);
	if (lm && request.method === 'DELETE') {
		const r = await removeEntry(env, Number(lm[1]), 'admin');
		return r.removed ? json(r) : json({ error: r.sync && !r.sync.synced ? `Could not remove it from Privy: ${r.sync.reason}. Nothing was changed.` : 'Not found' }, r.sync ? 502 : 404);
	}
	if (pathname === '/api/admin/refunds' && request.method === 'GET') return json({ refunds: await listRefunds(env, url.searchParams.get('status') ?? undefined) });
	if (pathname === '/api/admin/refunds/eligible' && request.method === 'GET') return json({ orders: await listEligible(env) });
	if (pathname === '/api/admin/refunds' && request.method === 'POST') {
		const body = await request.json().catch(() => ({}));
		try { return json(await createRefund(env, body as never), 201); } catch (e) { if (e instanceof RefundError) return json({ error: e.message }, e.status as 400 | 404 | 409); throw e; }
	}
	const rf = /^\/api\/admin\/refunds\/(rf[a-z0-9]{6,32})\/(approve|sent|cancel)$/.exec(pathname);
	if (rf && request.method === 'POST') {
		const body = (await request.json().catch(() => ({}))) as { by?: unknown; txHash?: unknown; reason?: unknown };
		try {
			if (rf[2] === 'approve') return json(await approveRefund(env, rf[1]!, body.by));
			if (rf[2] === 'sent') return json(await markRefundSent(env, rf[1]!, body.by, body.txHash));
			return json(await cancelRefund(env, rf[1]!, body.by, body.reason));
		} catch (e) { if (e instanceof RefundError) return json({ error: e.message }, e.status as 400 | 404 | 409); throw e; }
	}
	if (pathname === '/api/admin/revenue' && request.method === 'GET') {
		const days = Number(url.searchParams.get('days') ?? 30);
		if (![0, 7, 30, 90, 365].includes(days)) return json({ error: 'days must be 0 (all), 7, 30, 90 or 365' }, 400);
		return json(await revenueReport(env, days));
	}
	if (pathname === '/api/admin/sweeps' && request.method === 'GET') return json({ sweeps: await listSweeps(env, url.searchParams.get('status') ?? undefined) });
	if (pathname === '/api/admin/sweeps/run' && request.method === 'POST') return json(await runSweeps(env));
	const sm = /^\/api\/admin\/sweeps\/([a-z0-9]{6,32})\/(retry|resolve)$/.exec(pathname);
	if (sm && request.method === 'POST') {
		const body = (await request.json().catch(() => ({}))) as { outcome?: unknown; note?: unknown; txHash?: unknown };
		try {
			if (sm[2] === 'retry') return json(await retrySweep(env, sm[1]!));
			if ((body.outcome !== 'submitted' && body.outcome !== 'failed') || typeof body.note !== 'string' || !body.note) return json({ error: 'outcome (submitted|failed) and note are required' }, 400);
			return json(await resolveSweep(env, sm[1]!, body.outcome, body.note, typeof body.txHash === 'string' ? body.txHash : undefined));
		} catch (e) { if (e instanceof SweepConflict) return json({ error: e.message }, 409); throw e; }
	}

	const m = /^\/api\/admin\/payouts\/([A-Za-z0-9]+)\/(approve|reject|retry|resolve|release-hold)$/.exec(pathname);
	if (!m || request.method !== 'POST') return json({ error: 'Not found' }, 404);
	const [, id, action] = m as unknown as [string, string, string];
	let body: { reason?: unknown; outcome?: unknown; note?: unknown } = {};
	try { body = (await request.json()) as typeof body; } catch { /* body is optional for approve/retry */ }
	try {
		if (action === 'approve') return json(await approvePayout(env, id, 'admin'));
		if (action === 'retry') return json(await retryPayout(env, id));
		if (action === 'release-hold') {
			if (typeof body.note !== 'string' || !body.note) return json({ error: 'note is required' }, 400);
			return json(await releaseHold(env, id, 'admin', body.note));
		}
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
	const event = await getProvider(env).parseWebhook(body, request.headers, env, new URL(request.url));
	if (!event) return json({ error: 'Invalid signature' }, 401);
	if (event.state !== 'ignore') await settleFromWebhook(env, event.reference, event.state, event.error);
	return json({ ok: true });
}

/** Authenticated order API. Orders are only ever visible to the user that created them. */
async function ordersApi(request: Request, env: Env, ctx: ExecutionContext, pathname: string): Promise<Response> {
	let userId: string;
	try { userId = await authenticate(request, env); }
	catch (e) {
		if (e instanceof AuthError) return json({ error: e.message }, 401);
		console.error(JSON.stringify({ msg: 'auth.misconfigured', error: e instanceof Error ? e.message : String(e) }));
		return json({ error: 'Authentication is not configured' }, 500);
	}

	await ensureProfile(env, userId, null, Date.now()); // account age starts at the first authenticated call

	if (pathname === '/api/orders' && request.method === 'POST') {
		if (Number(request.headers.get('content-length') ?? 0) > MAX_JSON_BYTES) return json({ error: 'Payload too large' }, 413);
		let input: unknown;
		try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
		if (!input || typeof input !== 'object') return json({ error: 'Invalid JSON' }, 400);
		try { return json(await createSellOrder(env, userId, input as Record<string, unknown> as never, countryOf(request), (p) => ctx.waitUntil(p)), 201); }
		catch (e) {
			if (e instanceof BadRequest) return json({ error: e.message }, 400);
			if (e instanceof RuleDenied) return json({ error: e.message, rules: e.ruleIds }, e.status as 403 | 422 | 429);
			throw e;
		}
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
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname } = new URL(request.url);
		try {
			if (pathname === '/api/health') return json({ ok: true });
			if (pathname === '/api/geo') return Response.json({ country: countryOf(request) }, { headers: { 'cache-control': 'private, max-age=3600' } });
			if (pathname === '/api/webhooks/privy') {
				if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
				return await privyWebhook(request, env);
			}
			if (pathname.startsWith('/api/admin/')) return await adminApi(request, env, pathname, new URL(request.url));
			if (pathname === '/api/webhooks/payout') return request.method === 'POST' ? await payoutWebhook(request, env) : json({ error: 'Method not allowed' }, 405);
			if (pathname === '/api/orders' || pathname.startsWith('/api/orders/')) return await ordersApi(request, env, ctx, pathname);
			if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
			return new Response(null, { status: 404 });
		} catch (e) {
			console.error(JSON.stringify({ msg: 'unhandled', path: pathname, error: e instanceof Error ? e.message : String(e) }));
			return json({ error: 'Internal error' }, 500);
		}
	},
	/** Cron trigger (wrangler.jsonc "triggers"): forwards confirmed deposits to the treasury. */
	async scheduled(event, env, ctx): Promise<void> {
		// the daily cron is Clef's activity review (C-04); the 5-minute cron is sweeps
		if (event.cron === DAILY_CRON) { ctx.waitUntil(runPatternReview(env).then((r) => console.log(JSON.stringify({ msg: 'clef.review', ...r }))).catch((e) => console.error(JSON.stringify({ msg: 'clef.review_failed', error: e instanceof Error ? e.message : String(e) })))); return; }
		ctx.waitUntil(reconcilePayouts(env).then((r) => console.log(JSON.stringify({ msg: 'payout.reconcile', ...r }))).catch((e) => console.error(JSON.stringify({ msg: 'payout.reconcile_failed', error: e instanceof Error ? e.message : String(e) }))));
		ctx.waitUntil(checkStaleRefunds(env).catch((e) => console.error(JSON.stringify({ msg: 'refund.stale_check_failed', error: e instanceof Error ? e.message : String(e) }))));
		ctx.waitUntil(checkFloat(env).catch((e) => console.error(JSON.stringify({ msg: 'payout.float_check_failed', error: e instanceof Error ? e.message : String(e) }))));
		ctx.waitUntil(runSweeps(env).then((r) => console.log(JSON.stringify({ msg: 'sweep.run', ...r }))).catch((e) => console.error(JSON.stringify({ msg: 'sweep.run_failed', error: e instanceof Error ? e.message : String(e) }))));
	},
} satisfies ExportedHandler<Env>;
