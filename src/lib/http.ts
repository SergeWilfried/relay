/**
 * Fetch wrapper for your API: attaches the Privy access token so the backend can verify who is calling.
 * Backend: verify the JWT with Privy (@privy-io/server-auth / `verifyAuthToken`) and use the `sub` claim as the user id.
 */
let getToken: (() => Promise<string | null>) | null = null;
export const setTokenGetter = (fn: (() => Promise<string | null>) | null) => { getToken = fn; };

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await getToken?.();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${BASE}${path}`, { ...init, headers });
}
