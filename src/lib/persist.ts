/**
 * Tiny versioned localStorage store. Stand-in for server-side state: in production the profile,
 * orders and pool position come from the API and this goes away.
 */
let scope = 'anon';
/** Namespaces stored state per signed-in user. Call before the first `loadState`. */
export const setPersistScope = (id: string) => { scope = id; };
const prefix = () => `relay-v1:${scope}:`;

export function loadState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(prefix() + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export function saveState(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(prefix() + key);
    else localStorage.setItem(prefix() + key, JSON.stringify(value));
  } catch { /* storage full or unavailable: state just won't survive a reload */ }
}
