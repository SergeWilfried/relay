// Checks Relay's pawaPay provider mapping against what YOUR pawaPay account actually has active.
//   node scripts/pawapay-check.mjs            (uses PAWAPAY_API_TOKEN and PAWAPAY_BASE_URL from the environment or .dev.vars)
// For Senegal, Côte d'Ivoire and Burkina Faso it asks pawaPay for the active payout configuration and lists every provider code with
// its limits, then flags any code Relay uses (worker/payout/pawapay.ts) that is NOT active on the account.
import { readFileSync } from 'node:fs';

for (const file of ['../.dev.vars', '../.env']) {
  try {
    for (const line of readFileSync(new URL(file, import.meta.url), 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch { /* file not present */ }
}

const token = process.env.PAWAPAY_API_TOKEN;
const base = (process.env.PAWAPAY_BASE_URL || 'https://api.sandbox.pawapay.io').trim().replace(/\/+$/, '').replace(/\/v\d+$/, '');
if (!token) { console.error('Set PAWAPAY_API_TOKEN (environment, .dev.vars or .env).'); process.exit(1); }

// keep in sync with PROVIDERS in worker/payout/pawapay.ts
const RELAY = { CIV: ['ORANGE_CIV', 'WAVE_CIV'], SEN: ['ORANGE_SEN', 'WAVE_SEN'], BFA: ['ORANGE_BFA', 'MOOV_BFA'] };
let problems = 0;
console.log(`pawaPay: ${base}\n`);
const callbacks = new Set();
for (const [country, ours] of Object.entries(RELAY)) {
  const res = await fetch(`${base}/v2/active-conf?country=${country}&operationType=PAYOUT`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) { console.error(`${country}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); problems++; continue; }
  const j = await res.json();
  const active = new Map();
  for (const c of j.countries ?? []) for (const p of c.providers ?? []) {
    const xof = p.currencies?.find((x) => x.currency === 'XOF')?.operationTypes?.PAYOUT;
    if (xof) { active.set(p.provider, xof); if (xof.callbackUrl) callbacks.add(xof.callbackUrl); }
  }
  console.log(`${country}: enabled for payouts on your account: ${[...active.keys()].join(', ') || '(none)'}`);
  for (const code of ours) {
    const a = active.get(code);
    const ok = a && (a.status === 'OPERATIONAL' || a.status === 'DELAYED');
    if (!ok) problems++;
    console.log(`   ${ok ? 'ok     ' : 'OFF    '} ${code}${a ? `  (${a.status}, ${a.minAmount}-${a.maxAmount} XOF)` : '  not enabled on this account'}`);
  }
  if (country === 'CIV' && j.signatureConfiguration) console.log(`   signed callbacks: ${j.signatureConfiguration.signedCallbacks}, signed requests only: ${j.signatureConfiguration.signedRequestsOnly}`);
}
console.log(`\nPayout callback URL(s) configured on the account: ${[...callbacks].join(', ') || '(none)'}`);
console.log('Relay receives callbacks at https://<your-domain>/api/webhooks/payout. If the URL above is another service, Relay still settles payouts by the status recheck (every 5 min, for payouts older than 3 min).');
if (problems) { console.log(`\n${problems} provider(s) Relay maps are not usable on this account (they are refused at order creation). Ask pawaPay to enable them, or ignore if intentional.`); process.exit(1); }
console.log('\nAll providers Relay uses are enabled.');
