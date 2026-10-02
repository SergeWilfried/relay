import assert from 'node:assert/strict';
import { test } from 'node:test';
import { address, appendTransactionMessageInstruction, compileTransaction, createNoopSigner, createTransactionMessage, getBase64EncodedWireTransaction, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { base58Decode, classifyResponse, erc20TransferData, solanaTransferTx, toHex } from '../worker/sweepTx.ts';

const FROM = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const TO = 'F3L2PZ9xEH55mxg8ccRCHAGzJpitnBCTkpeQ3AKb9t2g';
const BLOCKHASH = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';

test('Solana transfer serialization is byte-identical to @solana/kit', () => {
  const sender = createNoopSigner(address(FROM));
  const msg = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(sender, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH as never, lastValidBlockHeight: 1n }, m),
    (m) => appendTransactionMessageInstruction(getTransferSolInstruction({ source: sender, destination: address(TO), amount: 1_234_567n }), m),
  );
  const expected = getBase64EncodedWireTransaction(compileTransaction(msg));
  assert.equal(solanaTransferTx(FROM, TO, 1_234_567n, BLOCKHASH), expected);
});

test('Solana builder rejects a bad address and a zero amount', () => {
  assert.throws(() => solanaTransferTx('nope', TO, 1n, BLOCKHASH));
  assert.throws(() => solanaTransferTx(FROM, TO, 0n, BLOCKHASH), /network fee/);
});

test('base58 decoding yields 32 bytes for an address', () => assert.equal(base58Decode(FROM).length, 32));

test('ERC-20 transfer calldata: selector, padded recipient, padded amount', () => {
  const data = erc20TransferData('0xC59C7DFD746016F5c325084BBcC6539c3c18a2B5', 1_500_000n);
  assert.equal(data, '0xa9059cbb' + '000000000000000000000000c59c7dfd746016f5c325084bbcc6539c3c18a2b5' + (1_500_000n).toString(16).padStart(64, '0'));
  assert.equal(data.length, 2 + 8 + 128);
  assert.throws(() => erc20TransferData('0x123', 1n));
});

test('hex amounts', () => assert.equal(toHex(2_000_000_000_000_000_000n), '0x1bc16d674ec80000'));

test('Privy responses: 2xx submitted (empty hash allowed), 429 retry, other 4xx failed, 5xx and odd statuses unknown', () => {
  assert.deepEqual(classifyResponse(200, '{"data":{"hash":"","transaction_id":"tx1"}}'), { state: 'submitted', txHash: null, txId: 'tx1' });
  assert.equal(classifyResponse(200, '{"data":{"hash":"0xab"}}').state, 'submitted');
  assert.equal(classifyResponse(200, 'not json').state, 'unknown');
  assert.equal(classifyResponse(429, '{"error":"slow down"}').state, 'retry');
  const policy = classifyResponse(403, '{"error":"Policy violation"}');
  assert.ok(policy.state === 'failed' && policy.error.includes('Policy violation'));
  assert.equal(classifyResponse(400, 'bad').state, 'failed');
  assert.equal(classifyResponse(500, '{}').state, 'unknown');
  assert.equal(classifyResponse(502, '').state, 'unknown');
  assert.equal(classifyResponse(302, '').state, 'unknown');
});
