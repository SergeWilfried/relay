/**
 * Svix webhook signature verification (the scheme Privy uses), implemented with Web Crypto.
 * https://docs.svix.com/receiving/verifying-payloads/how-manual
 *
 * Signed content = `${svix-id}.${svix-timestamp}.${raw body}`, HMAC-SHA256 with the base64-decoded
 * secret (the part after `whsec_`). `svix-signature` is a space-separated list like `v1,<base64> v1,<base64>`.
 */
export class WebhookVerificationError extends Error {}

const TOLERANCE_SECONDS = 5 * 60;

const b64ToBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToB64 = (bytes: ArrayBuffer): string => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
};

/** Constant-time string comparison (avoids leaking how many leading characters matched). */
const safeEqual = (a: string, b: string): boolean => {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
};

export interface VerifyInput {
  /** The raw request body, exactly as received (do not parse and re-serialise). */
  body: string;
  headers: Headers;
  /** The `whsec_…` signing secret. */
  secret: string;
  /** Override "now" (seconds) for tests. */
  nowSeconds?: number;
}

/** Returns the verified `svix-id`. Throws WebhookVerificationError if anything is off. */
export async function verifySvix({ body, headers, secret, nowSeconds }: VerifyInput): Promise<string> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature');
  if (!id || !timestamp || !signatures) throw new WebhookVerificationError('Missing svix headers');

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new WebhookVerificationError('Invalid timestamp');
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) throw new WebhookVerificationError('Timestamp outside tolerance (possible replay)');

  let keyBytes: Uint8Array<ArrayBuffer>;
  try { keyBytes = b64ToBytes(secret.replace(/^whsec_/, '')); } catch { throw new WebhookVerificationError('Malformed signing secret'); }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = bytesToB64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));

  // several signatures can be present during secret rotation: accept any v1 match
  const ok = signatures.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && !!sig && safeEqual(sig, expected);
  });
  if (!ok) throw new WebhookVerificationError('Signature mismatch');
  return id;
}
