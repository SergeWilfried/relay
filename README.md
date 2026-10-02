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

**Not built from the matrix:** the KYC tier table (limits are flat 2M/10M for everyone; `tierLimits()` in `rules.ts` is where tiers plug in once KYC status reaches the server), circuit breakers B-01 to B-07 and the kill switch, and the rules that need fiat-in, devices, payer names, MFA or address-risk data (D-04 to D-08, D-10 to D-12) or Clef (C-01 to C-07). Account age (D-03) counts from a user's first authenticated API call, not their Privy signup. Buys and swaps aren't server orders yet, so none of this covers them.

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

### Pools (crypto only)

Pools are crypto-only (ETH, SOL, USDT, USDC); there is no fiat / FCFA pool. A position is an amount of the pool's own coin (stored per pool id), deposits are checked against the user's Relay wallet balance, and values in FCFA are shown as approximations.
**Pool deposits and withdrawals are still simulated** (state in the app only; nothing moves on-chain or on a server yet). Pool numbers (APY, utilization, volume, TVL) are placeholders in `src/lib/data.ts`.

### Dev failure switches
`localStorage['relay-mock-quote' | 'relay-mock-submit' | 'relay-mock-order' | 'relay-mock-pools']` — see `src/lib/mock.ts`.
