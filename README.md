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
For Senegal, Cote d'Ivoire and Burkina Faso the FCFA icon on the trade chip becomes that country's flag; anywhere else it stays the green "F".
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

### PI-SPI: payment by alias

PI-SPI is an alias-based instant payment system, so when it is selected the form asks for the customer's **alias** instead of a mobile money number ("Cash out to alias" / "Pay from alias", with its own sheet; French too). The rule (`src/lib/account.ts`, mirrored in `worker/lists.ts`, kept equal by `test/account.test.ts`) is deliberately permissive because the scheme's own alias format isn't pinned down here: **3 to 64 characters, letters, digits and `. _ @ + -`, no spaces** (so e-mail-like and phone-like aliases both fit). The alias is kept apart from the number in the form (a number typed for Orange is never reused as an alias), and travels in the order's `phone` field, which holds "the payout account": an E.164 number, or the alias when the provider is `pispi`. The server validates the same way (`Enter your PI-SPI alias`), runs the same rules (limits, R-08), and the recipient denylist has a matching **`alias`** kind (matched case-insensitively).
**Still not connected:** no provider here can actually *pay* an alias. pawaPay doesn't support PI-SPI, so a PI-SPI cash-out is refused when the order is created while pawaPay is the payout provider (with the no-money sandbox provider it is accepted for testing), and buying with PI-SPI is refused too. Connecting PI-SPI means a PI-SPI participant or integration as a new payout (and collection) adapter.

### Fees and revenue

Customers pay **5%** of an order's value: **2.5% platform fee** (Relay's revenue) + **2.5% payment provider (PSP) fee** (passed through to the provider). `src/lib/fees.ts` drives the app's quotes (sell, buy, swap: a single `Fee 5%` line; the platform/PSP split is shown only in the admin Revenue tab), `worker/pricing.ts` decides what is actually paid out, and `test/pricing.test.ts` keeps the two equal. The customer's payout is rounded **down** to whole 100 FCFA, and the platform fee absorbs the rounding, so `payout + platform fee + PSP fee = gross` to the franc. Example: 1 000 USDT (600 000 FCFA) pays out 570 000 and splits 15 000 / 15 000.
Each payout stores its split (`gross_fcfa`, `platform_fee_fcfa`, `psp_fee_fcfa`, migration 0007). The admin **Revenue** tab (`GET /api/admin/revenue?days=7|30|90|365|0`) shows, for a period: platform revenue, gross volume, PSP fees owed, total fees, a per-day chart, and breakdowns by asset and by payout provider, plus platform fees still **pending** (payouts not yet paid). Revenue is recognised when a payout is **paid**; failed and rejected payouts earn nothing.
**Caveats:** only sells are server orders, so buy and swap fees aren't in the totals; payouts made before migration 0007 have no split and are counted separately (they were made at the old 0.25% fee); the PSP column is the fee charged to customers, not an invoice from the provider, so reconcile it with the provider's statements; limits still count the customer's payout amount (not the gross).

### Transaction limits

`src/lib/limits.ts` defines the limits per user: 2M FCFA per day and 10M per month, with the per-transaction cap set equal to the daily limit until you decide on one.
The Account card shows them with live usage (calendar day / month on the device, from the user's orders; failed orders and drafts don't count, orders waiting for a deposit reserve their amount),
and the trade form blocks an order that would exceed them ("Exceeds your limit" with the amount left).
The device copy is a UX guard. The real control is the server rule engine below, which applies the same numbers.

### Server rule engine (`worker/rules.ts`)

Built from the protection matrix. Every new **sell** order (the fiat-out ramp) is evaluated in the Worker before a deposit wallet is created, from the FCFA value priced server-side and the user's history (keyed by Privy user id). Rules are versioned data (`id`, `version`, `mode`, `phase`, `when`, `action`, `user_message`) in `RULES`.

- **Order** (matrix evaluation order): 2 account status (P-06 restricted, P-07 frozen) → 3 hard blocks (R-01 sanctioned country) → 4 limits, adjusted by D-03 (R-02 to R-07) → 5 dynamic holds (D-01, D-02, D-09) → allow and log. Circuit breakers (step 1) are not built.
- **Hold, don't reject:** only limits, sanctions and frozen accounts are refused (403/422/429). A hold accepts the order, blocks the payout from being approved until the hold ends or an analyst releases it, and tells the user why (`hold.message` on the order; shown on the Status page).
- **Most restrictive wins:** deny > hold; among holds, "until review" beats a timer and the longest timer wins.
- **Shadow first:** a rule in `shadow` mode is evaluated and logged (`applied: false`) but never changes the outcome. All D-rules ship in shadow; R and P rules enforce. Promote one at a time without a deploy: `PUT /api/admin/rules/D-02/mode {"mode":"enforce"}` (stored in KV); `GET /api/admin/rules` lists versions and effective modes.
- **Decision log:** table `decisions` has one row per evaluation: final action, the rules that fired with version, mode and applied, the facts they saw, the user message. (Decision logging can't fail an order: a failed insert is reported in the Worker logs instead.)

| Rule | Does | Mode |
|---|---|---|
| P-07 / P-06 | frozen: deny (403) / restricted: hold every payout until review. Set with `POST /api/admin/users/:id/status {status, note}` | enforce |
| R-01 | sanctioned country `KP IR SY CU` (by IP; deny-only; compliance should confirm the list) | enforce |
| R-02 to R-05 | minimum 1 000 FCFA; per-transaction 2M; daily 2M; monthly 10M (calendar day/month in UTC, = local time in SN/CI/BF) | enforce |
| R-06 / R-07 | more than 3 open orders / more than 10 orders in an hour (429) | enforce |
| D-03 | account younger than 14 days: limits at 50% | shadow |
| D-01 | request from a different country than the previous one: hold 24 h | shadow |
| D-02 | payout number differs from numbers used before: hold 48 h (a first number is the baseline) | shadow |
| D-09 | 3+ requests within 10% of the per-transaction limit in 7 days: hold until review | shadow |

Counted toward limits: orders that aren't underpaid, aren't unpaid and expired, and whose payout wasn't rejected or failed. The daily and monthly checks are repeated inside the INSERT (with the effective limits), so concurrent requests can't both slip under a limit. Retrying an existing order id returns the order without re-evaluating.
Admin: the payouts page shows holds and a **Release hold** action (a note is required and logged); approving a held payout is refused by the API (409). Run `pnpm db:migrate:local` / `pnpm db:migrate` for migrations 0003 and 0004.

**Not built from the matrix:** the KYC tier table (limits are flat 2M/10M for everyone; `tierLimits()` in `rules.ts` is where tiers plug in once KYC status reaches the server), circuit breakers B-01 to B-07 and the kill switch, and the rules that need fiat-in, devices, payer names, MFA or address-risk data (D-04 to D-08, D-10 to D-12) or Clef (C-01 to C-07). Account age (D-03) counts from a user's first authenticated API call, not their Privy signup. Swaps aren't server orders yet, so none of this covers them.

### Privy policies for deposit wallets

Each sell order gets its own Privy server wallet, restricted by a policy that pins the chain, the asset and a maximum amount, and, when `TREASURY_EVM` / `TREASURY_SOL` are set, the **destination**: the wallet can only send to your treasury.

| Wallet | Allowed | Cap |
|---|---|---|
| EVM | USDT or USDC `transfer` on Ethereum mainnet (no ETH attached) | 5 000 per transfer |
| EVM | ETH transfer on mainnet | 2 ETH |
| Solana | SOL transfer | 40 SOL |
| EVM | explicitly denied: `exportPrivateKey`, `personal_sign` (typed-data and EIP-7702 signing fall to Privy's default deny; it rejects an explicit DENY for them without a condition) | |

Privy denies whatever no ALLOW rule matches and a matching DENY always wins, so there is no catch-all DENY. Several ALLOW rules for one method are OR-ed, so every restriction sits inside the ALLOW rule itself (a separate looser ALLOW would override it). Caps are generous multiples of the 2M FCFA order limit so rate drift can't block a legitimate sweep (edit `CAPS`).

```bash
node scripts/privy-policies.mjs            # dry run: prints the policies, needs nothing
node scripts/privy-policies.mjs --apply    # creates them in your Privy app (needs PRIVY_APP_ID / PRIVY_APP_SECRET)
```

Set the printed ids as `PRIVY_DEPOSIT_POLICY_EVM` / `PRIVY_DEPOSIT_POLICY_SOL` (Worker secrets). With `LIVE=true` the Worker refuses to create a deposit wallet without them. Definitions: `scripts/privy-policy-defs.mjs` (unit-tested in `test/policies.test.ts`).
**User wallets (`--users`):** `node scripts/privy-policies.mjs --users [--apply]` also creates the matrix's policies for users' own wallets: P-03 to P-05 per-transfer caps (50 / 500 / 5 000 USD by tier), P-02 (unlimited approvals denied) and P-07 (frozen: deny all). They are shaped as ALLOW-all plus DENY rules so they can't break swaps. They are **not attached to any wallet yet** (assigning a tier or frozen policy on a status change is a server job needing the wallet owner's authorization). ETH and SOL caps use placeholder reference prices (`REF_USD`); the caps apply to any recipient because there is no allowlist. Not expressible without addresses or dashboard settings: P-01 (contract allowlist: router, ramp contract), P-06 (needs those addresses) and P-08 (MFA is a Privy app setting, not a policy rule).

**Destination lock:** EVM and Solana are locked to the treasuries in `TREASURY_EVM` / `TREASURY_SOL`. Changing a policy creates a new one in Privy (the old one stays until deleted), so update the policy ids afterwards.
**Limits of this version:** The Solana rules and the calldata match haven't been run against real Privy; test a sweep on a throwaway order first. There is no sweep job yet; for stronger protection give the wallets an owner (authorization key).

### Buys: pawaPay deposits, crypto delivered by a person (`worker/buys.ts`, `worker/deposit/pawapay.ts`)

The customer pays FCFA by mobile money and receives crypto. Needs `PAYOUT_PROVIDER=pawapay` (there is no no-money sandbox for deposits; the pawaPay sandbox moves no money). Because Relay holds **no treasury key**, the crypto is **sent by a person from the treasury** after the payment is confirmed, and recorded with its transaction hash (Admin → **Deliveries**), like refunds.

- **Flow:** `POST /api/orders {tab:'buy', id, asset, amountFcfa, destination, providerId, phone}` creates the order (status `created`: the quote and the crypto amount are fixed server-side, with the same rules, limits and denylists as sells) → `POST /api/orders/:id/pay` starts the payment (`collecting`) → pawaPay confirms (`collected`) → a person sends the crypto and records it (`delivered`); or `failed` / `expired`. Buys and sells count toward the **same daily and monthly limits** (checked atomically inside the insert). An unpaid order expires after 15 minutes.
- **Three authentication flows, read per provider from the pawaPay configuration (`authType`):**
  - **PIN prompt** (Orange and MTN in Côte d'Ivoire, Free and Orange in Senegal, Moov in Burkina Faso): the customer approves on the phone; if the prompt doesn't appear within about 12 seconds, the app shows the provider's USSD steps (in French or English).
  - **Redirect (Wave):** the Worker sends `successfulUrl` / `failedUrl` (back to the order's status page); pawaPay returns an `authorizationUrl`, possibly a poll later (`GET_AUTH_URL` → `REDIRECT_TO_AUTH_URL`); the customer taps **Open Wave**, approves in the app and comes back. Return URLs are only sent to redirect providers (pawaPay rejects unsupported parameters).
  - **Pre-authorisation code (Orange Burkina Faso):** the app shows how to generate the one-time code (USSD), the customer types it, and it goes as `preAuthorisationCode`. A wrong or expired code fails the order cleanly with nothing charged.
- **Only providers the account can really collect from are offered** (the live configuration is read and cached 10 min), and the amount must fit the provider's limits; a configuration that can't be read means "not available", never a guess.
- **Settling:** the order id becomes a deterministic UUIDv4 (`depositId`), so a retry can't charge twice. The result arrives by signed callback (`POST /api/webhooks/deposit`: set this URL for **deposits** in the pawaPay dashboard; unsigned callbacks are confirmed with a status call) **or** by the status check, which the order's own screen triggers every few seconds and the cron repeats (so a callback sent to another service doesn't stall anything). A timeout or HTTP 500 on initiation is resolved by asking pawaPay, never guessed.
- **Delivery safeguards:** only a `collected` order can be delivered; a hold (same rules as sells) blocks it until released; the name (audit log) and a transaction hash for the right chain are required. Alerts: "Payment received: send the crypto" when a payment is confirmed, and a reminder when a customer who has paid is still waiting after 30 minutes (critical after 2 hours). The purchase quote says "usually within 30 minutes".
- **Customer screens:** the buy form asks for the payer's mobile money number (live mode); **Review → Pay** (new `/trade/pay/:id` screen) handles the three flows; **Status** shows Payment received → Preparing → sent, with the delivery transaction link; all in French too.
- **Revenue:** purchases earn their fees when the crypto is **delivered** (a collected payment is pending); the Revenue tab splits cash-outs and purchases.
- **Tested against the real pawaPay sandbox** (no money moves): active configuration for deposits, rejection of a provider that isn't enabled (Wave), initiation and status of PIN-prompt deposits in Côte d'Ivoire (one number simulated an unapproved payment, three were collected), and the whole customer journey in the browser through to a delivered purchase. **Not testable on this account:** Wave and Orange Burkina Faso aren't enabled for deposits on the sandbox account, so those two flows were verified with a mock pawaPay that behaves as documented (including the delayed redirect URL and the code check) plus unit tests; confirm them on an account where they are enabled. The exact name of the code-instructions field in the configuration (`authTokenInstructions`) and of the failure code for a wrong code come from pawaPay's guide and are read tolerantly.
- **Not built:** fiat refunds when a collected payment can't be delivered (do it from the pawaPay dashboard for now; their refunds API would automate it), automatic delivery from a hot wallet (a deliberate choice: no key in Relay), and server-side swaps.
- Run migration 0010 (`pnpm db:migrate:local` / `pnpm db:migrate`).

### Refunds (crypto, for sells that can't be paid out)

When a sell can't be paid (a failed or rejected payout, or a deposit smaller than the order), the customer's crypto is returned. Relay holds **no treasury key** (a deposit wallet can only forward to the treasury), so a refund is **sent by a person from the treasury**; Relay decides whether it may happen, who asked and who approved, records the transaction, shows the customer its progress, and stops the payout from also being made. Admin → **Refunds** tab, or `GET/POST /api/admin/refunds`.

- **Flow:** *requested* → *approved* by a **different person** than the requester (four eyes) → *sent* (the transaction hash, checked for the chain) — or *cancelled* before it is sent (a cancelled refund can be started again). Each step records the analyst's name, kept in `refund_events` (the names are self-declared, since the admin key is shared: an audit aid, not authentication).
- **Who can be refunded:** an order whose payout `failed` or was `rejected`, or whose deposit was smaller than the order (right asset). Never refunded: a customer who was already **paid**, a payout still **in flight** (reject it first, so payout and refund can never both happen), a deposit that came from a **denylisted address** (hold A-01), and a **wrong-asset or wrong-chain** deposit (Relay can't sweep it: recover it by hand). One refund per order.
- **Safety checks:** the destination must be a valid address for the order's chain, not the order's own deposit wallet, and not on the recipient denylist; the amount is at most what was deposited (default: all of it; any network fee is the analyst's call). While a refund is live, the payout can't be approved or retried.
- **Funds first reach the treasury:** a deposit that was never swept (an underpaid one) is queued for the sweep only once its refund is **approved**; with `LIVE=true`, *mark sent* is refused until that sweep has been submitted.
- **Customer:** the order shows "Your refund is on its way" and, once sent, a link to the refund transaction (French too). The destination suggested to the analyst is the customer's own Relay wallet on that chain (from the Privy wallet index); the analyst confirms it.
- **Alerts:** an info alert when a refund is requested (it needs a second person) and a warning when one has waited more than 24 hours (the customer is promised 24 hours). Migration 0009.
- **Not built:** sending the refund from Relay itself (it would need a treasury signing key), refunding a paid-out order (that is a fiat-side reversal), recovering wrong-asset deposits, and pawaPay's own refunds API (it reverses fiat *deposits*, which belong to the buy flow).

### pawaPay payouts (`worker/payout/pawapay.ts`)

Set `PAYOUT_PROVIDER` to `pawapay` to pay sells through [pawaPay](https://docs.pawapay.io/v2/docs/payouts) (default is the no-money `sandbox` provider). Needs the `PAWAPAY_API_TOKEN` secret and `PAWAPAY_BASE_URL` (`https://api.sandbox.pawapay.io`, with or without `/v2`, or `https://api.pawapay.io`). Safety: the pawaPay sandbox is refused with `LIVE=true`, and production is refused unless `LIVE=true` (so simulated deposits can never trigger real payouts). Payouts serve **sells**; pawaPay *deposits* serve **buys** (see the next section).

- **Flow:** an admin approves a payout, the Worker sends it (XOF, MSISDN without `+`, `clientReferenceId` = our payout id). `ACCEPTED` means *processing*, not paid: it settles by the signed callback or by the status recheck. `REJECTED` and 4xx are definitive failures (nothing was sent); the customer sees a safe message ("This number is not registered…"), and the raw pawaPay code goes to logs and alerts.
- **Idempotency:** the payout id becomes a deterministic UUIDv4 (`payoutId`), so a retry can never pay twice (`DUPLICATE_IGNORED`).
- **Unknown outcomes:** a timeout or HTTP 500 is *not* assumed failed (pawaPay's own guidance): the adapter asks for the payout's status and decides from that; only if that also fails does a person get an "unknown outcome". Payouts stuck in `sending` are re-checked every 5 minutes once 3 minutes old (`POST /api/admin/payouts/reconcile` runs it by hand), so a lost callback or a callback sent to the wrong URL still settles.
- **Callbacks** (`POST /api/webhooks/payout`, set this URL in the pawaPay dashboard and keep **signed callbacks** on): verified as RFC 9421 signatures (ECDSA P-256/P-384) against pawaPay's public key (`/v2/public-key/http`, cached 1 h): body digest, covered components, 5-minute freshness. An **unsigned** callback is never trusted: its claim is confirmed with a status call.
- **Operators:** Orange and Wave in Côte d'Ivoire and Senegal; Orange and Moov in Burkina Faso. PI-SPI (not supported by pawaPay) and unlisted combinations are refused when the order is created, **and so is any provider that isn't enabled on your pawaPay account** (the live configuration is read and cached 10 min) **or whose limits don't fit the amount** (Orange Senegal caps a payout at 200 000 XOF), so a customer is never asked to send crypto for a payout that can't be paid.
- **Float (Admin → Float):** pawaPay wallets are **per country**: a payout fails with `PAWAPAY_WALLET_OUT_OF_FUNDS` when the wallet of the *recipient's* country is empty (customers see "Payouts are temporarily unavailable"), and a purchase credits the wallet of the *payer's* country. The Float tab (`GET /api/admin/payouts/float`) shows, for Côte d'Ivoire, Senegal and Burkina Faso: the balance against the 2 000 000 XOF minimum (the matrix's B-02), what is **already committed** (payouts waiting for approval or in flight, which the wallet must still cover), the last 24 hours paid out and collected from purchases, and the estimated **cover in days** at the last 7 days' pace. A wallet is *critical* when it is empty or can't cover the waiting payouts, and *low* below the minimum. A critical alert fires (at most once per 12 hours per country and level) for either. Balances come from pawaPay's `wallet-balances` (they may be provider-specific wallets, shown when so); flows come from Relay's own records. **Top-ups** are done in the pawaPay dashboard (a bank transfer with your merchant reference, per country, which takes days), so top up well before the cover runs out; and set a **minimum wallet balance** per wallet in the dashboard's settlement settings, so a scheduled settlement can never empty the float. The balance may include money reserved for in-flight payouts (pawaPay doesn't say), so the committed figure is a guide, not an exact reconciliation.
- **Check your account:** `node scripts/pawapay-check.mjs` lists which of Relay's providers are enabled on your pawaPay account, with limits, the callback URL and the signing settings.
- **Tested against the real pawaPay sandbox** (no money moves): initiation, status recheck, a completed payout (Burkina Faso, Moov), an out-of-funds failure (Senegal), provider/limit refusals at order creation, wallet balances. **Not tested against real pawaPay:** a callback delivered by pawaPay itself (it needs a public URL, and on the sandbox account the payout callback URL points at another service, so only the recheck path was exercised live). Signature verification is covered by unit tests with a locally signed callback and by an end-to-end run against a mock that signs like pawaPay does.
- **Not built:** refunds through pawaPay's API (it reverses a fiat *deposit*), and an admin view of the float.

### Recipient lists: allowlists and denylists

What exists for each kind of list, and where it is enforced:

| | Denylist | Allowlist |
|---|---|---|
| **Transfer recipients (blockchain)** | Addresses in `recipient_lists`, mirrored to a **Privy condition set**. User-wallet policies (`--users`) DENY ETH, ERC-20 and SOL transfers *to* any listed address (`in_condition_set`), so the list changes without editing a policy | Deposit wallets: the **treasury** is the only allowed destination (Privy policy, fail-closed). Users' own wallets: not possible yet (see below) |
| **Payout recipients (mobile numbers)** | Rule **R-08** refuses a sell order whose payout number is listed (403, enforced) | Not built: "numbers allowed per tier, in the user's own name" needs the KYC name on the server |
| **Deposit sources (blockchain)** | Rule **A-01**: a deposit *from* a listed address is recorded but the payout is held (until an analyst releases it) and the **sweep skips it**, so tainted funds aren't forwarded to the treasury; a critical alert fires | none |

Manage the denylist with the admin API (`GET/POST /api/admin/lists`, `DELETE /api/admin/lists/:id`, `POST /api/admin/lists/sync`). Adding needs `{kind: phone|evm|solana, value, note}`; the note (why it's listed) is required. Values are normalised (phone `+digits`, EVM lowercase, Solana as given) so one address has one form. Removal from Privy happens first: if Privy can't be updated the local entry is kept, so the two never disagree about a removal. Run migration 0008.
**Privy setup:** `node scripts/privy-policies.mjs --users --apply` creates the two condition sets (`PRIVY_DENY_SET_EVM`, `PRIVY_DENY_SET_SOL`) and the user-wallet policies that reference them. Set those ids as Worker secrets; without them entries are enforced by Relay only and reported as `synced: false` (`POST /api/admin/lists/sync` pushes them later). Note: if a Privy condition set is deleted, every condition that references it evaluates to false, so a DENY rule built on it stops firing (fails open): don't delete the sets.
**Verified against real Privy:** creating the condition sets and the policies that reference them, adding an address (the returned item id is stored) and removing it (the set is empty again). **Not verified:** the **deposit webhook's sender field isn't documented** (the code accepts `sender`, `from` or `source`). If none is present the A-01 check cannot run, and the Worker logs `deposit.sender_unknown` for each deposit; check one real webhook before relying on it.
**Why no allowlist for users' own wallets:** an allowlist means "deny everything except these", which would also block swaps unless the router and ramp contracts are allowlisted too (P-01). Add those addresses first. A treasury allowlist as a condition set (so you can rotate the treasury without recreating policies, which existing deposit wallets keep) is a sensible next step.
**Contracts and networks:** the deposit-wallet policies already allowlist the USDT/USDC contracts and pin Ethereum mainnet / Solana; the server's `SELL_ASSETS` is the asset and network allowlist for orders. A contract denylist would use the same condition-set mechanism (not built).

### Sweeps: forwarding deposits to the treasury (`worker/sweep.ts`)

A cron trigger (every 5 minutes, `wrangler.jsonc` `triggers`) and `POST /api/admin/sweeps/run` queue a sweep for every order whose deposit is confirmed, then send it from the order's Privy deposit wallet to `TREASURY_EVM` / `TREASURY_SOL`. The wallet policies allow exactly that transfer, so even a bug here can't send elsewhere.

- **One sweep per order** (primary key) and conditional status updates: overlapping runs can't send twice.
- **Statuses:** `pending → sending → submitted | failed | unknown`. `failed` = Privy definitively refused (policy violation, validation): fix the cause, then `POST /api/admin/sweeps/:orderId/retry`. `unknown` = ambiguous (network error, 5xx): funds may have moved, so it is **never retried automatically**; check the chain, then `POST .../resolve {outcome: submitted|failed, note, txHash}`. A 429 is retried on the next run (up to 3 times).
- **Ethereum:** native ETH or an ERC-20 `transfer` to the treasury, with **Privy gas sponsorship** (`sponsor: true`), because a deposit wallet holds only the deposit and a token sweep would have no ETH for gas. **Enable gas sponsorship for Ethereum in the Privy dashboard first.**
- **Solana:** a legacy System Program transfer built in the Worker (a recent blockhash comes from `SOLANA_RPC_URL`; leave it empty for the public endpoint, which is rate-limited, so use a provider URL in production). The wallet pays the 5 000-lamport fee, so the fee is subtracted from the amount sent. The transaction bytes are tested to be identical to `@solana/kit`'s.
- **Sandbox:** with `LIVE=false` a sweep just records `sandbox-sweep-<order>`; with `LIVE=true` only orders with a real deposit wallet are swept.
- **List:** `GET /api/admin/sweeps[?status=]`. Run `pnpm db:migrate:local` / `pnpm db:migrate` for migration 0005.
- **Admin page:** the **Sweeps** tab (`/admin`) groups sweeps into needs attention / in progress / sent, links sent hashes to the explorer, has **Retry** for failed ones and **Resolve** for unknown ones (a note is required), and a "Run sweeps now" button.
- **Not built:** confirmation tracking (`submitted` means Privy accepted and broadcast it, not that it is final).
- **Untested against real Privy:** the `/rpc` request shapes follow Privy's docs, the sponsored token transfer must satisfy the policy's `value = 0` check, and the policy `transfer.recipient` match; test one small real order before relying on it.

### Alerts (`worker/alerts.ts`)

Things a person must look at are written to the Worker log (`msg: "alert"`) and, if `ALERT_WEBHOOK_URL` is set (a Slack or Discord incoming-webhook URL, kept as a secret), POSTed there (`text`, `content`, `level`, `title`, `details`). They fire once, on the transition: **critical** for a sweep or payout with an unknown outcome (money may have moved); **warning** for a failed sweep or payout (a payout failure reported by the provider webhook too); **info** when a rule puts a payout on hold. Payloads hold order ids, assets, amounts and rule ids only (no phone numbers); only the Clef pattern alerts carry a user id, so an analyst knows whom to review. A failing webhook is logged and never breaks the operation. Warning and info alerts go through Clef triage when enabled (see below). Not built: email or SMS, escalation, and alerts for payouts waiting a long time for approval.

### Clef: the judgment layer (`worker/clef.ts`)

[Clef](https://developers.cloudflare.com/workers-ai/models/clef/) is a Workers AI decision model (`@cf/cloudflare/clef` and `clef-flash`, called through the `AI` binding). It takes a state and typed questions and returns a probability per option. As in the matrix, it **only advises**: it never signs, moves funds, blocks or freezes, and it has no hand on Privy policies. A person (or an enforced rule) acts on what it says.

Off by default: set `CLEF_ENABLED` to `"true"` (`wrangler.jsonc` vars). Calls are billed per token on your Cloudflare account, and local dev calls the real model. Both points start in **shadow** mode (the call is made and logged, nothing changes) and are promoted like rules: `PUT /api/admin/rules/C-05/mode`. Any error, timeout (8 s) or malformed answer returns null and everything carries on as it did without Clef.

| Point | Model | What it does | Auto-action |
|---|---|---|---|
| **C-05** alert triage | clef-flash | rates each warning/info alert false positive / review / urgent and adds `clef: …` to the alert | enforce mode: an **info** alert that is ≥ 0.95 a false positive is closed with a log line (`alert.auto_closed`). Critical alerts skip Clef entirely; warnings are never auto-closed |
| **C-04** daily review (cron 03:00 UTC, or `POST /api/admin/clef/run-review`) | clef | reviews each user with 2+ cash-outs in 7 days: none / mule / round trip / structuring | enforce mode: a pattern ≥ 0.75 sets the user's flag. Rule **D-11** (its own mode, shadow by default) turns the flag into a payout hold until an analyst runs `POST /api/admin/users/:id/clef-flag/clear {note}` |

Promote in two steps: C-04 to enforce (flags get stored), then D-11 to enforce (flags hold payouts). In shadow, C-04 sends an info alert saying what it would have flagged.
What Clef sees is pseudonymous: payout numbers become "number 1, 2, …", times are hours ago, no phone digits or names. Every call (point, version, mode, the questions and state sent, the answers, model, tokens, latency, error) is stored in `clef_calls` (`GET /api/admin/clef/calls[?point=]`); `GET /api/admin/rules` lists the points with their effective mode. Run `pnpm db:migrate:local` / `pnpm db:migrate` for migration 0006.
**Not built:** C-01 (signup risk), C-02 (receipt images; the model supports them), C-03 (address risk) and C-06 (sanctions/PEP match) need data that isn't server-side yet; C-07 (support tickets). Clef is only given sell orders, so it can't see round trips that involve buying. Treat its thresholds as starting points and calibrate them on shadow data (14 days) before enforcing; a flag's confidence is often modest (the test run returned 0.34 to 0.57), so read the stored probabilities.

### Swaps: Privy native swap, run from the customer's own wallet (`worker/swaps.ts`)
Live (Privy sign-in) swaps use Privy's swap wallet action: the Worker asks Privy for a quote and executes it **as a signer** on the customer's embedded wallet. Funds never leave the customer's wallet; the output always goes to the customer's own address (any destination sent by a client is ignored). No FCFA rail is involved.
- **Assets:** ETH, USDT, USDC (Ethereum) and SOL; BTC is not swappable. Same-chain and cross-chain routes are supported by Privy; slippage defaults to 0.5% (`DEFAULT_SLIPPAGE_BPS`, bounds 10-300 bps; no UI control yet).
- **API:** `GET /api/swap/status`, `POST /api/swap/quote`, `POST /api/swap` (idempotent per user and id), `GET /api/swap/:id`; admin `GET /api/admin/swaps-orders`. Swaps go through the rule engine (limits, frozen accounts) and are listed in `/api/orders`.
- **Settlement:** polled by the client, by the cron (`reconcileSwaps`, alert if pending over 15 minutes) and by Privy webhooks `wallet_action.swap.*` (matched by `reference_id`).
- **Setup:** `node scripts/privy-signer.mjs --write` creates the authorization key + key quorum and writes `PRIVY_SIGNER_ID` / `PRIVY_SIGNER_PRIVATE_KEY` to `.dev.vars` (never printed). Then `node scripts/privy-policies.mjs --swap` creates the signer policies (`PRIVY_SWAP_POLICY_EVM/SOL`). In production set all four as Worker secrets. Optional `PRIVY_API_URL` overrides the Privy base URL (tests).
- **Customer consent:** the first swap shows "Enable swaps"; the app calls Privy `addSigners` with the Relay signer and policy once. Swaps are refused (409 `signer_required`) until the wallet reports the signer as delegated.
- **Fees/gas:** Privy charges 0.25%; gas sponsorship must be enabled in the Privy dashboard or swaps fail with a configuration error. Relay earns no fee on swaps (developer fees are Enterprise-only).
- **Verified:** against real Privy for quotes, signed execute acceptance and the signature algorithm; the full flow (readiness, idempotency, polling, webhook settlement, failures, rules) against a signature-verifying mock; the UI in the browser.
- **Not verified:** the signer policies that deny `transfer` and ERC-20 transfers on a funded wallet, the real `addSigners` consent flow, and a real funded swap. Test one swap and one denied transfer on a funded wallet before launch. A leaked signer key is only as limited as those policies.

### Pools (crypto only)

Pools are crypto-only (ETH, SOL, USDT, USDC); there is no fiat / FCFA pool. A position is an amount of the pool's own coin (stored per pool id), deposits are checked against the user's Relay wallet balance, and values in FCFA are shown as approximations.
**Pool deposits and withdrawals are still simulated** (state in the app only; nothing moves on-chain or on a server yet). Pool numbers (APY, utilization, volume, TVL) are placeholders in `src/lib/data.ts`.

### Dev failure switches
`localStorage['relay-mock-quote' | 'relay-mock-submit' | 'relay-mock-order' | 'relay-mock-pools']` — see `src/lib/mock.ts`.
