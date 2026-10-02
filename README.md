# Relay (Vite + React PWA)

```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview   # production build (needed to test PWA install)
```

## Privy (auth + wallets)

1. Create an app at https://dashboard.privy.io and copy the **App ID**.
2. `cp .env.example .env` and set `VITE_PRIVY_APP_ID=<your app id>`. Restart `npm run dev`.
3. In the Privy dashboard:
   - **Allowed origins**: add `http://localhost:5173` and your production/preview domains.
   - **Login methods**: enable **Email** (used by the in-app login screen). Passkey, social, SMS and WhatsApp
     are optional and appear under "More sign-in options". SMS outside the US/Canada and WhatsApp need the Scale plan.
   - **Embedded wallets**: enable Ethereum and Solana (created automatically on first login).
4. Backend: send `Authorization: Bearer <access token>` (see `src/lib/http.ts`) and verify the JWT with Privy; use its `sub` as the user id.

With no app ID the app runs in **demo mode**: no login, placeholder wallets. State is stored per user in `localStorage` (a stand-in for your API).

### Privy webhooks (Cloudflare Worker)

Endpoint: `POST /api/webhooks/privy` (served by `worker/index.ts`; everything under `/api/*` runs the Worker, the rest is static assets).

1. Privy dashboard -> **Webhooks** -> add endpoint `https://<your-domain>/api/webhooks/privy` and subscribe to the events you want
   (`user.created`, `user.wallet_created`, `wallet.funds_deposited`, `transaction.*`). Copy the **signing secret** (`whsec_...`).
2. Production: `npx wrangler secret put PRIVY_WEBHOOK_SIGNING_SECRET`, then `pnpm deploy`.
   Local: `cp .dev.vars.example .dev.vars` and paste a secret (any `whsec_` + base64 works for local tests).
3. After changing `wrangler.jsonc` run `pnpm types:worker`.
4. Test locally (dev server running): `node scripts/send-test-webhook.mjs http://localhost:5173/api/webhooks/privy user.wallet_created`
   (add `--tamper` to see a 401, or reuse `--id=msg_x` to see idempotency). Unit tests: `pnpm test:worker`.

Behaviour: signature + 5-minute timestamp check (Svix scheme), at-least-once safe (processed `svix-id`s kept 7 days in KV),
unknown events are acknowledged with 200, handler errors return 500 so Privy retries. Handlers log structured JSON and keep a
`user:<id>` / `wallet:<address>` index in KV; order updates are marked `TODO(orders)` in `worker/privy.ts` until orders live server-side.

### Sell orders and deposit detection (live mode)

With Privy configured, a sell order is created on the server (`POST /api/orders`, authenticated with the user's Privy access token).
The server issues a **per-order deposit address**; when Privy emits `wallet.funds_deposited` for that address the order moves
`awaiting_deposit` -> `processing` (or `underpaid` if the amount/asset doesn't match) and the app's Deposit screen, which polls
`GET /api/orders/:id` every 4s, advances to Status by itself. Orders live in D1 (`migrations/`).

Setup:
1. `pnpm db:migrate:local` (local) / `pnpm db:migrate` (production, after the D1 database exists).
2. Secrets / vars: `PRIVY_APP_ID` (same as `VITE_PRIVY_APP_ID`), `PRIVY_VERIFICATION_KEY` (dashboard -> App settings, SPKI public key),
   `PRIVY_WEBHOOK_SIGNING_SECRET`. For real deposit addresses also set `PRIVY_APP_SECRET` and `"LIVE": "true"` in `wrangler.jsonc` vars.
   With `LIVE=false` addresses are random placeholders and the app refuses to send real funds to them.
3. Subscribe the webhook to `wallet.funds_deposited` (and the `transaction.*` events if you want them logged).

Local end-to-end (no real Privy needed): `node scripts/mint-token.mjs did:privy:alice` mints a token signed with the throwaway key in
`.test-key.pem`; use it with `curl` against `/api/orders`, then simulate the chain with
`node scripts/send-test-webhook.mjs http://localhost:5173/api/webhooks/privy wallet.funds_deposited --to=<depositAddress> --amount=<base units>`.
(`.dev.vars` must hold the matching `.test-pub.pem` as `PRIVY_VERIFICATION_KEY` for these local tokens to verify.)

### Mobile money payouts (manual approval)

After a deposit is confirmed the server creates a payout in `pending_approval`; **a person releases it**. The FCFA amount is computed
on the server (`worker/pricing.ts`, placeholder rates: replace with a real rate feed), never taken from the client.

Lifecycle: `pending_approval` -> `approved` -> `sending` -> `paid` | `failed`; `pending_approval` -> `rejected`.
- Every transition is a conditional update, so double clicks / retries can't double-pay; the provider receives the payout id as its idempotency reference.
- If the provider call errors (outcome unknown) the payout stays `sending` with an `UNKNOWN OUTCOME` note. It is never retried automatically:
  check the provider's dashboard, then `resolve` it as paid or failed. Only a definitively `failed` payout can be `retry`-ed.

Release payouts from the admin page at **`/admin`** (sign in with the `ADMIN_API_KEY`; tabs: Needs approval / In progress / Failed / Done; every action shows a confirmation with the amount, number and deposit tx first). The key is kept in `sessionStorage` only. **Put `/admin` and `/api/admin/*` behind Cloudflare Access (or an IP allowlist) in production**: the key alone is the only protection otherwise. Or use the CLI (same `ADMIN_API_KEY`, 16+ chars, as a secret):
```bash
node scripts/admin-payouts.mjs list pending_approval
node scripts/admin-payouts.mjs approve <payoutId>
node scripts/admin-payouts.mjs reject <payoutId> "reason"
node scripts/admin-payouts.mjs retry <payoutId>
node scripts/admin-payouts.mjs resolve <payoutId> paid|failed "note"
# production: ADMIN_API_KEY=... API_URL=https://your-domain node scripts/admin-payouts.mjs ...
```
Provider: `PAYOUT_PROVIDER` (default `sandbox`, which moves no money; behaviour by the last digits of the phone: `0000` fails,
`9999` settles later by webhook, `5555` simulates an unknown outcome). The sandbox refuses to run with `LIVE=true`.
To go live add an adapter in `worker/payout/` implementing `PayoutProvider` (`send`, `parseWebhook`) and register it in `worker/payout/index.ts`.
Provider status callbacks arrive at `POST /api/webhooks/payout` (set `PAYOUT_WEBHOOK_SECRET`). Apply migrations with `pnpm db:migrate:local` / `pnpm db:migrate`.

The app asks for the user's own mobile money number on Sell (live mode never pre-fills the placeholder numbers).

### Country flag as the FCFA avatar

`GET /api/geo` returns the visitor's country from Cloudflare's IP geolocation (`request.cf.country`, no third-party service, no IP stored).
For Senegal, Cote d'Ivoire and Burkina Faso the FCFA icon (trade chip, FCFA pool) becomes that country's flag; anywhere else it stays the green "F".
The answer is cached on the device for 24h. It is **cosmetic only**: a VPN or roaming changes it, so never use it for KYC, limits or payouts.
Flags live in `design-assets/country/` (originals) and `public/country/` (square 96px, `pnpm flags`). To add a country: add its flag to `scripts/flags.mjs` and an entry to `SERVED` in `src/lib/geo.ts`.
Locally Wrangler fills in `request.cf` from your real IP; to pretend: `localStorage['relay-mock-country'] = 'SN'` (dev only).

### Languages (French by default)

The app is in **French** (Senegal, Cote d'Ivoire, Burkina Faso) with English kept as a fallback; users switch with the FR / EN toggle on the login screen and in Account (stored in `localStorage['relay-lang']`).
- Text lives in the code as English source strings: `t('Review order')` (components, via `useT()`) or `tr('...')` (non-React code). Placeholders use `{name}`.
- French is in `src/i18n/fr.common.ts` and `src/i18n/fr.app.ts`, keyed by the English string. A missing key falls back to English and logs `[i18n] missing French translation: ...` in dev.
- Numbers and dates follow the language (`1 500 000`, `1,50`, `0,25 %`): always format with `src/lib/format.ts` (`fmtInt`, `fmtCrypto`, `localizePct`, `parseAmount`). In French a comma typed in an amount is a decimal comma.
- Not translated: the internal `/admin` page (English), Privy's own sign-in modal opened by "More sign-in options" (Privy only localizes wallet/card screens), and text stored in an order when it was created (an order made in French stays French if you later switch to English).
- Server messages shown to users are translated on the client by matching the English message (see the last block of `fr.app.ts`).

### Transaction limits

`src/lib/limits.ts` defines the limits (placeholders: 5M FCFA per transaction, 10M per day, 50M per month; set them from your compliance policy).
The Account card shows them with live usage (calendar day / month on the device, from the user's orders; failed orders and drafts don't count, orders waiting for a deposit reserve their amount),
and the trade form blocks an order that would exceed them ("Exceeds your limit" with the amount left).
**This is a UX guard only.** The server does not enforce limits yet (it doesn't store KYC status or all of a user's orders for buys/swaps), so enforce them server-side before relying on them for compliance.

### Dev failure switches
`localStorage['relay-mock-quote' | 'relay-mock-submit' | 'relay-mock-order' | 'relay-mock-pools']` — see `src/lib/mock.ts`.
