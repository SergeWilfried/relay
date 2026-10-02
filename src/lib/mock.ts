/**
 * Dev-only failure switches so the error states can be exercised without a backend:
 *   localStorage['relay-mock-quote']  = 'error' | 'drift'   (quote fetch fails / rate moves on refresh)
 *   localStorage['relay-mock-submit'] = 'error'             (submitting an order or pool action fails)
 *   localStorage['relay-mock-order']  = 'fail' | 'stall'    (order fails mid-way / stops progressing)
 * Ignored in production builds.
 */
export const mockFlag = (key: 'quote' | 'submit' | 'order' | 'pools'): string | null => {
  if (!import.meta.env.DEV) return null;
  try { return localStorage.getItem(`relay-mock-${key}`); } catch { return null; }
};
