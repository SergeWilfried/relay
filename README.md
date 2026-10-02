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

### Dev failure switches
`localStorage['relay-mock-quote' | 'relay-mock-submit' | 'relay-mock-order' | 'relay-mock-pools']` — see `src/lib/mock.ts`.
