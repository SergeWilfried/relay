import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askClef, buildActivityState, clefEnabled, PATTERN_QUESTIONS, patternVerdict, POINTS, triageVerdict, TRIAGE_QUESTIONS, type Answer, type ClefResult } from '../worker/clef.ts';

const res = (answers: Record<string, Answer>, callId: number | null = 7): ClefResult => ({ model: 'clef', answers, usage: { input_tokens: 10, output_tokens: 2 }, callId });
const choice = (probabilities: Record<string, number>): Answer => {
  const [choiceId] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]!;
  return { type: 'choice', choice: choiceId, probabilities, confidence: 0.9 };
};
const mute = () => { const l = console.log, e = console.error; console.log = console.error = () => {}; return () => { console.log = l; console.error = e; }; };

// a minimal fake of the Worker env: the AI binding and the D1 insert used for the audit log
function fakeEnv(opts: { enabled?: boolean; ai?: (model: string, input: unknown) => Promise<unknown> } = {}) {
  const inserted: unknown[][] = [];
  const env = {
    CLEF_ENABLED: opts.enabled === false ? 'false' : 'true',
    AI: opts.ai ? { run: opts.ai } : undefined,
    DB: { prepare: () => ({ bind: (...b: unknown[]) => ({ run: async () => { inserted.push(b); return { meta: { last_row_id: 42 } }; } }) }) },
  } as unknown as Env;
  return { env, inserted };
}

test('C-05: only an INFO alert can auto-close, and only at >= 0.95 false positive', () => {
  const r = res({ priority: choice({ false_positive: 0.97, review: 0.02, urgent: 0.01 }) });
  assert.equal(triageVerdict(r, 'info')!.autoClose, true);
  assert.equal(triageVerdict(r, 'warning')!.autoClose, false, 'a warning is never auto-closed');
  assert.equal(triageVerdict(r, 'critical')!.autoClose, false);
  assert.equal(triageVerdict(res({ priority: choice({ false_positive: 0.94, review: 0.05, urgent: 0.01 }) }), 'info')!.autoClose, false);
  assert.equal(triageVerdict(res({ priority: { type: 'noul', noul: 1 } }), 'info'), null, 'wrong answer type is ignored');
});

test('C-04: a pattern at >= 0.75 becomes a flag; "none" and weaker patterns do not', () => {
  const f = patternVerdict(res({ pattern: choice({ none: 0.1, mule: 0.8, round_trip: 0.05, structuring: 0.05 }) }), 1000);
  assert.deepEqual(f, { pattern: 'mule', probability: 0.8, at: 1000, callId: 7, model: 'clef' });
  assert.equal(patternVerdict(res({ pattern: choice({ none: 0.9, mule: 0.05, round_trip: 0.03, structuring: 0.02 }) }), 1), null);
  assert.equal(patternVerdict(res({ pattern: choice({ none: 0.2, mule: 0.74, round_trip: 0.03, structuring: 0.03 }) }), 1), null);
  const strongest = patternVerdict(res({ pattern: choice({ none: 0, mule: 0.76, round_trip: 0.1, structuring: 0.14 }) }), 1)!;
  assert.equal(strongest.pattern, 'mule');
});

test('the activity state is pseudonymous: numbers become indexes, nothing identifying leaks', () => {
  const now = 10 * 3_600_000;
  const s = buildActivityState([
    { amount_fcfa: 1_900_000, asset: 'ETH', created_at: now - 2 * 3_600_000, status: 'processing', payout_status: 'pending_approval', phone: '+2250700000002' },
    { amount_fcfa: 1_950_000, asset: 'ETH', created_at: now - 5 * 3_600_000, status: 'processing', payout_status: 'paid', phone: '+2250700000001' },
    { amount_fcfa: 1_900_000, asset: 'USDT', created_at: now - 1 * 3_600_000, status: 'processing', payout_status: null, phone: '+2250700000002' },
  ], { now, accountAgeDays: 3, perTxLimit: 2_000_000, dailyLimit: 2_000_000, deniedRequests7d: 1 });
  assert.equal(s.distinct_payout_numbers, 2);
  assert.deepEqual(s.cash_out_orders.map((o) => o.payout_number), [1, 2, 2], 'ordered by time, numbered by first appearance');
  assert.equal(s.total_fcfa, 5_750_000);
  assert.ok(!JSON.stringify(s).includes('+225'), 'no phone digits are sent to the model');
});

test('question schemas follow the model contract (choice needs 2 to 255 criteria and instructions)', () => {
  for (const q of [TRIAGE_QUESTIONS.priority!, PATTERN_QUESTIONS.pattern!]) {
    assert.equal(q.type, 'choice');
    const n = Object.keys((q as { criteria: object }).criteria).length;
    assert.ok(n >= 2 && n <= 255 && q.instructions.length > 10);
  }
});

test('askClef: disabled or without the AI binding makes no call', async () => {
  let called = false;
  const off = fakeEnv({ enabled: false, ai: async () => { called = true; return {}; } });
  assert.equal(await askClef(off.env, POINTS['C-05']!, 'shadow', 's', {}, TRIAGE_QUESTIONS), null);
  assert.equal(clefEnabled(fakeEnv({}).env), false, 'no binding');
  assert.equal(called, false);
});

test('askClef: sends the right model and schema, logs the call, returns the answers', async () => {
  const restore = mute();
  let seen: { model: string; input: { model: string; state: unknown; questions: unknown } } | undefined;
  const { env, inserted } = fakeEnv({ ai: async (model, input) => { seen = { model, input: input as never }; return { model: 'clef-flash', answers: { priority: choice({ false_positive: 0.1, review: 0.2, urgent: 0.7 }) }, usage: { input_tokens: 50, output_tokens: 3 } }; } });
  try {
    const r = await askClef(env, POINTS['C-05']!, 'shadow', 'subj', { level: 'warning' }, TRIAGE_QUESTIONS);
    assert.equal(seen!.model, '@cf/cloudflare/clef-flash', 'the model path follows the point\'s model');
    assert.equal(seen!.input.model, 'clef-flash');
    assert.deepEqual(seen!.input.questions, TRIAGE_QUESTIONS);
    assert.equal(r!.callId, 42);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]![0], 'C-05');
    assert.equal(inserted[0]![2], 'shadow');
  } finally { restore(); }
});

test('askClef: an error, a timeout-style rejection or a malformed answer returns null and is still logged', async () => {
  const restore = mute();
  try {
    for (const ai of [async () => { throw new Error('boom'); }, async () => ({ answers: { priority: { type: 'noul', noul: 0.5 } } }), async () => ({})]) {
      const { env, inserted } = fakeEnv({ ai });
      assert.equal(await askClef(env, POINTS['C-05']!, 'enforce', 's', {}, TRIAGE_QUESTIONS), null);
      assert.equal(inserted.length, 1, 'failed calls are in the audit log too');
      assert.equal(inserted[0]![7], null, 'no answers stored');
      assert.ok(inserted[0]![11], 'error stored');
    }
  } finally { restore(); }
});

test('both points ship in shadow mode', () => assert.ok(Object.values(POINTS).every((p) => p.mode === 'shadow')));
