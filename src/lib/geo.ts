import { useEffect, useState } from 'react';
import { apiFetch } from './http';
import { mockFlag } from './mock';

/** Countries we serve (all use the FCFA / XOF), with the flag used as the currency avatar. */
export const SERVED: Record<string, { name: string; flag: string }> = {
  SN: { name: 'Senegal', flag: '/country/sn.png' },
  CI: { name: "Côte d'Ivoire", flag: '/country/ci.png' },
  BF: { name: 'Burkina Faso', flag: '/country/bf.png' },
};

const KEY = 'relay-country';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const cached = (): string | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { c: string | null; t: number } | null;
    return v && Date.now() - v.t < MAX_AGE_MS ? v.c : null;
  } catch { return null; }
};

let inflight: Promise<string | null> | null = null;

/** Country from the Worker's IP geolocation. One request per session; the answer is cached for a day. */
async function detect(): Promise<string | null> {
  const mock = mockFlag('country');
  if (mock) return mock;
  inflight ??= apiFetch('/geo')
    .then((r) => (r.ok ? (r.json() as Promise<{ country: string | null }>) : { country: null }))
    .then(({ country }) => {
      try { localStorage.setItem(KEY, JSON.stringify({ c: country, t: Date.now() })); } catch { /* ignore */ }
      return country;
    })
    .catch(() => null);
  return inflight;
}

export function useCountry(): string | null {
  const [country, setCountry] = useState<string | null>(() => mockFlag('country') ?? cached());
  useEffect(() => {
    let live = true;
    void detect().then((c) => { if (live && c) setCountry(c); });
    return () => { live = false; };
  }, []);
  return country;
}

/**
 * Avatar for FCFA: the flag of the visitor's country when it's one we serve, otherwise the plain "F" circle.
 * IP geolocation is only a hint (VPNs, roaming): it's cosmetic and never used for compliance decisions.
 */
export function useFcfaAvatar(): { logo?: string; country?: string } {
  const country = useCountry();
  const served = country ? SERVED[country] : undefined;
  return served ? { logo: served.flag, country: served.name } : {};
}
