import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDeposit, createPawapayDepositProvider, depositUuid, extractInstructions, friendlyDepositFailure, parseDepositConf, takesDeposits } from '../worker/deposit/pawapay.ts';

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// the shape pawaPay returns for DEPOSIT, captured from the sandbox (Orange CI: PIN prompt), plus the two other auth types as documented
const dep = (provider: string, over: Record<string, unknown>) => ({ provider, currencies: [{ currency: 'XOF', operationTypes: { DEPOSIT: { minAmount: '1', maxAmount: '2000000', decimalsInAmount: 'NONE', status: 'OPERATIONAL', ...over } } }] });
const ORANGE_CIV = dep('ORANGE_CIV', { authType: 'PROVIDER_AUTH', pinPrompt: 'MANUAL', pinPromptRevivable: true, pinPromptInstructions: { channels: [{ type: 'USSD', variables: { shortCode: '#120#' }, instructions: { en: [{ text: 'Dial #120#' }, { text: 'Enter PIN' }], fr: [{ text: 'Composez #120#' }, { text: 'Entrez le code PIN' }] } }] } });
const WAVE_CIV = dep('WAVE_CIV', { authType: 'REDIRECT_AUTH' });
const ORANGE_BFA = dep('ORANGE_BFA', { authType: 'PREAUTH', authTokenInstructions: { channels: [{ type: 'USSD', instructions: { en: [{ text: 'Dial *144*4*6#' }, { text: 'Enter the amount' }, { text: 'Enter PIN' }], fr: [{ text: 'Composez *144*4*6#' }] } }] } });
const conf = (country: string, ...providers: unknown[]) => ({ countries: [{ country, providers }] });

test('the deposit id is a stable UUIDv4 and differs from the payout id for the same reference', async () => {
  const a = await depositUuid('buyabc123');
  assert.match(a, UUID4);
  assert.equal(a, await depositUuid('buyabc123'));
  const { payoutUuid } = await import('../worker/payout/pawapay.ts');
  assert.notEqual(a, await payoutUuid('buyabc123'));
});

test('configuration: auth type, limits, status and the customer instructions are read per provider', () => {
  const m = parseDepositConf(conf('CIV', ORANGE_CIV, WAVE_CIV));
  const o = m.get('ORANGE_CIV')!;
  assert.deepEqual([o.authType, o.min, o.max, o.status], ['PROVIDER_AUTH', 1, 2_000_000, 'OPERATIONAL']);
  assert.deepEqual(o.instructions, { en: ['Dial #120#', 'Enter PIN'], fr: ['Composez #120#', 'Entrez le code PIN'] });
  assert.equal(m.get('WAVE_CIV')!.authType, 'REDIRECT_AUTH');
  assert.equal(m.get('WAVE_CIV')!.instructions, null);
  const b = parseDepositConf(conf('BFA', ORANGE_BFA)).get('ORANGE_BFA')!;
  assert.equal(b.authType, 'PREAUTH');
  assert.deepEqual(b.codeInstructions!.en, ['Dial *144*4*6#', 'Enter the amount', 'Enter PIN']);
  assert.deepEqual(b.codeInstructions!.fr, ['Composez *144*4*6#'], 'a missing translation is not invented');
  assert.equal(parseDepositConf(null).size, 0);
});

test('instructions are found however deeply they are nested, and a missing language falls back to the other', () => {
  assert.deepEqual(extractInstructions({ a: { b: [{ instructions: { en: [{ text: 'x' }] } }] } }), { en: ['x'], fr: ['x'] }, 'inside arrays too (the real config nests it under channels[])');
  assert.deepEqual(extractInstructions({ a: { channels: { instructions: { en: [{ text: 'x' }] } } } }), { en: ['x'], fr: ['x'] });
  assert.equal(extractInstructions('nope'), null);
});

test('only operational or delayed providers take payments', () => {
  const m = parseDepositConf(conf('CIV', ORANGE_CIV));
  assert.equal(takesDeposits(m.get('ORANGE_CIV')), true);
  assert.equal(takesDeposits({ ...m.get('ORANGE_CIV')!, status: 'DELAYED' }), true);
  assert.equal(takesDeposits({ ...m.get('ORANGE_CIV')!, status: 'CLOSED' }), false);
  assert.equal(takesDeposits(undefined), false);
});

test('failure codes become customer-safe messages', () => {
  assert.match(friendlyDepositFailure('PAYMENT_NOT_APPROVED'), /not approved/);
  assert.match(friendlyDepositFailure('INSUFFICIENT_BALANCE'), /balance/);
  assert.match(friendlyDepositFailure('PAYER_NOT_FOUND'), /not registered/);
  assert.match(friendlyDepositFailure('INVALID_PRE_AUTHORISATION_CODE'), /code is wrong or has expired/);
  assert.equal(friendlyDepositFailure(undefined), 'The payment could not be completed');
});

test('status: completed, failed, not found, and in-flight states with the redirect URL when present', () => {
  assert.deepEqual(classifyDeposit({ status: 'FOUND', data: { status: 'COMPLETED' } }), { state: 'completed' });
  const f = classifyDeposit({ status: 'FOUND', data: { status: 'FAILED', failureReason: { failureCode: 'PAYMENT_NOT_APPROVED', failureMessage: 'x' } } });
  assert.ok(f.state === 'failed' && /not approved/.test(f.error) && /PAYMENT_NOT_APPROVED/.test(f.detail));
  assert.equal(classifyDeposit({ status: 'NOT_FOUND' }).state, 'not_found');
  assert.deepEqual(classifyDeposit({ status: 'FOUND', data: { status: 'PROCESSING', nextStep: 'REDIRECT_TO_AUTH_URL', authorizationUrl: 'https://pay.wave.com/x' } }), { state: 'pending', nextStep: 'REDIRECT_TO_AUTH_URL', authUrl: 'https://pay.wave.com/x' });
  for (const s of ['ACCEPTED', 'PROCESSING', 'IN_RECONCILIATION']) assert.equal(classifyDeposit({ status: 'FOUND', data: { status: s } }).state, 'pending', s);
});

// ---- the provider with a fake pawaPay ---------------------------------------------------------------------------------------
type Call = { url: string; method: string; body?: Record<string, unknown>; auth?: string };
function setup(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const env = { PAWAPAY_API_TOKEN: 'tok', PAWAPAY_BASE_URL: 'http://localhost:9999', LIVE: 'false' } as unknown as Env;
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined, auth: (init.headers as Record<string, string> | undefined)?.authorization };
    calls.push(c); return handler(c);
  }) as typeof globalThis.fetch;
  return { provider: createPawapayDepositProvider(env, { fetch }), calls };
}
const req = { reference: 'buyorder001', amountFcfa: 150_000, phone: '+2250789458900', operator: 'orange' };

test('PIN prompt flow: the request has no redirect or code, and ACCEPTED is "started" not paid', async () => {
  const { provider, calls } = setup(() => Response.json({ status: 'ACCEPTED', nextStep: 'FINAL_STATUS' }));
  const out = await provider.initiate(req);
  assert.deepEqual(out, { state: 'accepted', depositId: await depositUuid('buyorder001'), nextStep: 'FINAL_STATUS', authUrl: null });
  assert.deepEqual(calls[0]!.body, {
    depositId: await depositUuid('buyorder001'), amount: '150000', currency: 'XOF',
    payer: { type: 'MMO', accountDetails: { phoneNumber: '2250789458900', provider: 'ORANGE_CIV' } },
    customerMessage: 'Relay purchase', clientReferenceId: 'buyorder001',
  });
  assert.equal(calls[0]!.auth, 'Bearer tok');
  assert.match(String(calls[0]!.body!.customerMessage), /^[A-Za-z0-9 ]{4,22}$/);
});

test('redirect flow (Wave): sends successfulUrl and failedUrl and returns the authorization URL pawaPay gives', async () => {
  const { provider, calls } = setup(() => Response.json({ status: 'ACCEPTED', nextStep: 'REDIRECT_TO_AUTH_URL', authorizationUrl: 'https://pay.wave.com/c/abc' }));
  const out = await provider.initiate({ ...req, operator: 'wave', successUrl: 'https://relay.example/trade/status/buyorder001', failedUrl: 'https://relay.example/trade/status/buyorder001?failed=1' });
  assert.ok(out.state === 'accepted' && out.nextStep === 'REDIRECT_TO_AUTH_URL' && out.authUrl === 'https://pay.wave.com/c/abc');
  assert.equal(calls[0]!.body!.successfulUrl, 'https://relay.example/trade/status/buyorder001');
  assert.equal(calls[0]!.body!.failedUrl, 'https://relay.example/trade/status/buyorder001?failed=1');
  assert.equal((calls[0]!.body!.payer as { accountDetails: { provider: string } }).accountDetails.provider, 'WAVE_CIV');
});

test('redirect flow: when the URL is not ready yet (GET_AUTH_URL) it is picked up from the status', async () => {
  const init = await setup(() => Response.json({ status: 'ACCEPTED', nextStep: 'GET_AUTH_URL' })).provider.initiate({ ...req, operator: 'wave' });
  assert.ok(init.state === 'accepted' && init.nextStep === 'GET_AUTH_URL' && init.authUrl === null);
  const { provider } = setup(() => Response.json({ status: 'FOUND', data: { status: 'PROCESSING', nextStep: 'REDIRECT_TO_AUTH_URL', authorizationUrl: 'https://pay.wave.com/c/abc' } }));
  assert.deepEqual(await provider.status('buyorder001'), { state: 'pending', nextStep: 'REDIRECT_TO_AUTH_URL', authUrl: 'https://pay.wave.com/c/abc' });
});

test('pre-authorisation flow (Orange Burkina Faso): the one-time code travels as preAuthorisationCode; a wrong code is a clean rejection', async () => {
  const ok = setup(() => Response.json({ status: 'ACCEPTED', nextStep: 'FINAL_STATUS' }));
  await ok.provider.initiate({ ...req, phone: '+22670123456', preAuthCode: '367025' });
  assert.equal(ok.calls[0]!.body!.preAuthorisationCode, '367025');
  assert.equal((ok.calls[0]!.body!.payer as { accountDetails: { provider: string } }).accountDetails.provider, 'ORANGE_BFA');
  const bad = await setup(() => Response.json({ status: 'REJECTED', failureReason: { failureCode: 'INVALID_PRE_AUTHORISATION_CODE', failureMessage: 'expired' } })).provider.initiate({ ...req, phone: '+22670123456', preAuthCode: '000000' });
  assert.ok(bad.state === 'rejected' && bad.error === 'The code is wrong or has expired');
});

test('rejections are definitive; an unsupported operator is refused without calling pawaPay', async () => {
  const rej = await setup(() => Response.json({ status: 'REJECTED', failureReason: { failureCode: 'AMOUNT_OUT_OF_BOUNDS' } })).provider.initiate(req);
  assert.ok(rej.state === 'rejected' && /limits/.test(rej.error));
  const s = setup(() => Response.json({}));
  assert.equal((await s.provider.initiate({ ...req, operator: 'pispi' })).state, 'rejected');
  assert.equal(s.calls.length, 0);
  assert.equal((await setup(() => Response.json({ failureReason: { failureCode: 'AUTHENTICATION_ERROR' } }, { status: 401 })).provider.initiate(req)).state, 'rejected', 'a 4xx means our request was wrong: nothing was charged');
});

test('after an HTTP 500 it asks for the deposit status instead of guessing; both failing throws', async () => {
  const mk = (statusBody: unknown) => setup((c) => (c.method === 'POST' ? new Response('boom', { status: 500 }) : Response.json(statusBody)));
  assert.equal((await mk({ status: 'FOUND', data: { status: 'PROCESSING' } }).provider.initiate(req)).state, 'accepted');
  assert.equal((await mk({ status: 'NOT_FOUND' }).provider.initiate(req)).state, 'rejected');
  assert.equal((await mk({ status: 'FOUND', data: { status: 'FAILED', failureReason: { failureCode: 'PAYER_NOT_FOUND' } } }).provider.initiate(req)).state, 'rejected');
  await assert.rejects(setup(() => { throw new Error('offline'); }).provider.initiate(req), /outcome unknown/);
});

test('method(): reads the account configuration; a provider that is not enabled or is closed gives null; an unreadable configuration gives null', async () => {
  const live = setup(() => Response.json(conf('CIV', ORANGE_CIV)));
  const m = await live.provider.method('orange', '+2250789458900');
  assert.equal(m?.authType, 'PROVIDER_AUTH');
  assert.equal(live.calls[0]!.url, 'http://localhost:9999/v2/active-conf?country=CIV&operationType=DEPOSIT');
  assert.equal(await live.provider.method('wave', '+2250789458900'), null, 'Wave is mapped but not enabled on this account');
  assert.equal(await live.provider.method('pispi', '+2250789458900'), null);
  assert.equal(await setup(() => Response.json(conf('CIV', dep('ORANGE_CIV', { authType: 'PROVIDER_AUTH', status: 'CLOSED' })))).provider.method('orange', '+2250789458900'), null);
  assert.equal(await setup(() => new Response('x', { status: 500 })).provider.method('orange', '+2250789458900'), null);
});

test('webhook: an UNSIGNED deposit callback is confirmed with a status call and a lie is ignored', async () => {
  const lying = JSON.stringify({ depositId: await depositUuid('buyorder001'), clientReferenceId: 'buyorder001', status: 'COMPLETED' });
  const url = new URL('https://relay.example/api/webhooks/deposit');
  const failed = setup(() => Response.json({ status: 'FOUND', data: { status: 'FAILED', failureReason: { failureCode: 'PAYMENT_NOT_APPROVED' } } }));
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await failed.provider.parseWebhook(lying, new Headers(), url))?.state, 'failed', 'the body claimed COMPLETED but pawaPay says FAILED');
    assert.equal((await setup(() => Response.json({ status: 'FOUND', data: { status: 'COMPLETED' } })).provider.parseWebhook(lying, new Headers(), url))?.state, 'completed');
    assert.equal((await setup(() => Response.json({ status: 'FOUND', data: { status: 'PROCESSING' } })).provider.parseWebhook(lying, new Headers(), url))?.state, 'ignore');
    assert.equal(await setup(() => { throw new Error('offline'); }).provider.parseWebhook(lying, new Headers(), url), null);
    assert.equal(await failed.provider.parseWebhook('junk', new Headers(), url), null);
    assert.equal((await failed.provider.parseWebhook(JSON.stringify({ payoutId: 'p', status: 'COMPLETED' }), new Headers(), url))?.state, 'ignore', 'a payout callback is not for this endpoint');
  } finally { console.warn = warn; }
});
