import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRefundable, validName, validTxHash, type Refundable } from '../worker/refundRules.ts';

const SOL_SIG = '3'.repeat(88); // a real Solana signature is 87 or 88 base58 characters
const base: Refundable = { orderStatus: 'processing', note: null, depositAmountUnits: '100000000', payoutStatus: 'failed', holdA01Active: false, existingRefundStatus: null };
const why = (over: Partial<Refundable>) => { const r = checkRefundable({ ...base, ...over }); return r.ok ? 'ok' : r.reason; };

test('a failed or rejected payout can be refunded; underpaid deposits too', () => {
  assert.equal(why({}), 'ok');
  assert.equal(why({ payoutStatus: 'rejected' }), 'ok');
  assert.equal(why({ orderStatus: 'underpaid', payoutStatus: null, note: 'Deposit smaller than the order amount' }), 'ok');
});

test('a customer who was already paid is never refunded', () => assert.match(why({ payoutStatus: 'paid' }), /already paid/));

test('a payout still in flight must be rejected (or fail) first, so payout and refund can never both happen', () => {
  for (const s of ['pending_approval', 'approved', 'sending']) assert.match(why({ payoutStatus: s }), /still in progress/, s);
});

test('nothing deposited, or no recorded amount: nothing to refund', () => {
  assert.match(why({ orderStatus: 'awaiting_deposit', payoutStatus: null }), /Nothing was deposited/);
  assert.match(why({ depositAmountUnits: null }), /No deposit amount/);
});

test('a wrong-asset deposit cannot be handled by Relay (the wallet policy only forwards the right asset to the treasury)', () => {
  assert.match(why({ orderStatus: 'underpaid', payoutStatus: null, note: 'Wrong asset or chain received' }), /by hand/);
});

test('funds from a denylisted address are not refunded automatically', () => assert.match(why({ holdA01Active: true }), /denylisted/));

test('one refund per order, but a cancelled one can be started again', () => {
  assert.match(why({ existingRefundStatus: 'requested' }), /already has a refund/);
  assert.match(why({ existingRefundStatus: 'sent' }), /already has a refund/);
  assert.equal(why({ existingRefundStatus: 'cancelled' }), 'ok');
});

test('transaction hashes are checked per chain', () => {
  assert.equal(validTxHash('Ethereum', '0x' + 'ab'.repeat(32)), true);
  assert.equal(validTxHash('Ethereum', '0x123'), false);
  assert.equal(validTxHash('Ethereum', SOL_SIG), false);
  assert.equal(validTxHash('Solana', SOL_SIG), true);
  assert.equal(validTxHash('Solana', '0x' + 'ab'.repeat(32)), false);
  assert.equal(validTxHash('Ethereum', 42), false);
});

test('analyst names: 2 to 40 characters, starting with a letter', () => {
  for (const ok of ['Serge', 'Aïcha Diop', "N'Golo", 'amy.k']) assert.equal(validName(ok), true, ok);
  for (const bad of ['', 'A', '1abc', ' ', 'x'.repeat(41), null, 5]) assert.equal(validName(bad), false, String(bad));
});
