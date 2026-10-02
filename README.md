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

### Dev failure switches
`localStorage['relay-mock-quote' | 'relay-mock-submit' | 'relay-mock-order' | 'relay-mock-pools']` — see `src/lib/mock.ts`.
