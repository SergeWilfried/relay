import { useSyncExternalStore } from 'react';
import { fr } from './fr';

export type Lang = 'fr' | 'en';

const KEY = 'relay-lang';
const stored = (): Lang | null => {
  try { const v = localStorage.getItem(KEY); return v === 'fr' || v === 'en' ? v : null; } catch { return null; }
};

// French is the default: the app serves Senegal, Cote d'Ivoire and Burkina Faso.
let lang: Lang = stored() ?? 'fr';
const listeners = new Set<() => void>();

if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLang = () => lang;
/** BCP-47 locale for Intl formatting (French digits grouping and decimal comma). */
export const locale = () => (lang === 'fr' ? 'fr-FR' : 'en-US');

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const warned = new Set<string>();

/**
 * Translate an English source string. The English text is the key; `{name}` placeholders are filled from `params`.
 * Missing French entries fall back to English (and warn once in dev so they get added).
 */
export function tr(key: string, params?: Record<string, string | number>): string {
  let s = key;
  if (lang === 'fr') {
    const hit = fr[key];
    if (hit !== undefined) s = hit;
    else if (import.meta.env.DEV && !warned.has(key)) { warned.add(key); console.warn(`[i18n] missing French translation: ${JSON.stringify(key)}`); }
  }
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** Subscribes the component to language changes; use `t` for every user-facing string. */
export function useT() {
  const l = useSyncExternalStore(subscribe, getLang, getLang);
  return { t: tr, lang: l, setLang, locale: locale() };
}
