/** Pure transaction builders for sweeps (no I/O, so they are unit-tested). */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(s: string): Uint8Array {
	let n = 0n;
	for (const ch of s) {
		const i = B58.indexOf(ch);
		if (i < 0) throw new Error('Invalid base58');
		n = n * 58n + BigInt(i);
	}
	const bytes: number[] = [];
	while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
	const zeros = [...s].findIndex((c) => c !== '1');
	return Uint8Array.from([...Array(zeros < 0 ? s.length : zeros).fill(0), ...bytes]);
}

const pad32 = (hex: string) => hex.padStart(64, '0');

/** ERC-20 transfer(address,uint256) calldata. */
export function erc20TransferData(to: string, amountUnits: bigint): string {
	if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error('Invalid EVM address');
	return `0xa9059cbb${pad32(to.slice(2).toLowerCase())}${pad32(amountUnits.toString(16))}`;
}

export const toHex = (n: bigint) => `0x${n.toString(16)}`;

/** Fee of a one-signature legacy Solana transaction. The deposit wallet pays it, so it is taken out of the amount sent. */
export const SOL_FEE_LAMPORTS = 5_000n;

/**
 * Serialized legacy transaction (base64) transferring `lamports` from `from` to `to` through the System Program,
 * with the sender as fee payer and a zeroed signature slot for the wallet to fill. Layout:
 * [sig count][signature 64][header 3][account count][from, to, system program][blockhash][1 instruction: program 2, accounts 0 1, data = u32 2 + u64 lamports]
 */
export function solanaTransferTx(from: string, to: string, lamports: bigint, blockhash: string): string {
	const f = base58Decode(from), t = base58Decode(to), b = base58Decode(blockhash);
	if (f.length !== 32 || t.length !== 32 || b.length !== 32) throw new Error('Invalid Solana address or blockhash');
	if (lamports <= 0n) throw new Error('Nothing to send after the network fee');
	const data = new Uint8Array(12);
	const dv = new DataView(data.buffer);
	dv.setUint32(0, 2, true); // SystemInstruction::Transfer
	dv.setBigUint64(4, lamports, true);
	const tx = Uint8Array.from([
		1, ...new Uint8Array(64),
		1, 0, 1,
		3, ...f, ...t, ...new Uint8Array(32),
		...b,
		1, 2, 2, 0, 1, 12, ...data,
	]);
	let bin = '';
	for (const byte of tx) bin += String.fromCharCode(byte);
	return btoa(bin);
}

/** What a send attempt told us about the money. */
export type Sent = { state: 'submitted'; txHash: string | null; txId: string | null } | { state: 'failed'; error: string } | { state: 'retry'; error: string } | { state: 'unknown'; error: string };

/** Pure: maps Privy's answer to what we know about the money. Only a definite 4xx means "not sent"; anything unclear is 'unknown'. */
export function classifyResponse(status: number, text: string): Sent {
	if (status >= 200 && status < 300) {
		try { const d = (JSON.parse(text) as { data?: { hash?: string; transaction_id?: string } }).data; return { state: 'submitted', txHash: d?.hash || null, txId: d?.transaction_id ?? null }; }
		catch { return { state: 'unknown', error: 'Accepted but the response was unreadable' }; }
	}
	const msg = (() => { try { return (JSON.parse(text) as { error?: string }).error ?? text; } catch { return text; } })().slice(0, 300);
	if (status === 429) return { state: 'retry', error: `Rate limited: ${msg}` };
	if (status >= 500 || status < 200 || status >= 300 && status < 400) return { state: 'unknown', error: `Privy ${status}: ${msg}` };
	return { state: 'failed', error: `Privy ${status}: ${msg}` };
}

