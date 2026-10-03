/**
 * Privy authorization signatures (https://docs.privy.io/controls/authorization-keys): requests that act on a wallet with an owner or
 * signer carry `privy-authorization-signature`, an ECDSA P-256 / SHA-256 signature, DER-encoded and base64'd, over the canonical (RFC 8785)
 * JSON of `{ version: 1, method, url, body, headers }`. This mirrors @privy-io/node's `generateAuthorizationSignature`, which the tests
 * cross-check. Import-free, so it is unit-tested in plain Node.
 */

/** RFC 8785 (JSON Canonicalization Scheme) for the JSON values we sign: sorted keys, no whitespace, ES number and string serialisation. */
export function canonicalize(v: unknown): string {
	if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
	if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('Cannot canonicalize a non-finite number'); return JSON.stringify(v); }
	if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalize(x))).join(',')}]`;
	if (typeof v === 'object') {
		const o = v as Record<string, unknown>;
		return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(',')}}`;
	}
	throw new Error(`Cannot canonicalize ${typeof v}`);
}

export interface AuthRequest {
	method: 'POST' | 'GET' | 'PATCH' | 'PUT' | 'DELETE';
	/** the full URL being called, exactly as sent */
	url: string;
	/** the JSON body, or undefined / {} / '' for none */
	body?: unknown;
	/** headers covered by the signature: privy-app-id always, plus privy-idempotency-key and privy-request-expiry when sent */
	headers: Record<string, string>;
}

/** The exact bytes that get signed. An empty body is signed as the empty string, as Privy's SDK does. */
export function authorizationPayload(r: AuthRequest): Uint8Array {
	const empty = r.body === undefined || r.body === null || (typeof r.body === 'object' && !Array.isArray(r.body) && Object.keys(r.body as object).length === 0);
	return new TextEncoder().encode(canonicalize({ version: 1, method: r.method, url: r.url, body: empty ? '' : r.body, headers: r.headers }));
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };

/** IEEE P1363 (r || s, what WebCrypto produces) -> ASN.1 DER SEQUENCE of two INTEGERs (what Privy expects). */
export function p1363ToDer(sig: Uint8Array): Uint8Array {
	const half = sig.length / 2;
	const int = (b: Uint8Array) => {
		let i = 0;
		while (i < b.length - 1 && b[i] === 0) i++;
		const body = b.slice(i);
		return body[0]! & 0x80 ? Uint8Array.from([0, ...body]) : body;
	};
	const r = int(sig.slice(0, half)), s = int(sig.slice(half));
	const len = (n: number) => (n < 128 ? [n] : [0x81, n]);
	const inner = [0x02, ...len(r.length), ...r, 0x02, ...len(s.length), ...s];
	return Uint8Array.from([0x30, ...len(inner.length), ...inner]);
}

/** DER -> P1363, used by the tests to verify a DER signature with WebCrypto. */
export function derToP1363(der: Uint8Array, size = 32): Uint8Array {
	let i = 2 + (der[1]! & 0x80 ? 1 : 0);
	const read = () => {
		if (der[i++] !== 0x02) throw new Error('Bad DER');
		const n = der[i++]!;
		let b = der.slice(i, i + n); i += n;
		while (b.length > size && b[0] === 0) b = b.slice(1);
		const out = new Uint8Array(size); out.set(b, size - b.length);
		return out;
	};
	const r = read(), s = read();
	return Uint8Array.from([...r, ...s]);
}

/** Signs a request with an authorization key: a base64 PKCS8 P-256 private key (a leading `wallet-auth:` from the dashboard is accepted). */
export async function signAuthorization(privateKeyPkcs8: string, r: AuthRequest | Uint8Array): Promise<string> {
	const payload = r instanceof Uint8Array ? r : authorizationPayload(r);
	const key = await crypto.subtle.importKey('pkcs8', b64ToBytes(privateKeyPkcs8.replace(/^wallet-auth:/, '').trim()), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
	const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, payload));
	return bytesToB64(p1363ToDer(raw));
}
