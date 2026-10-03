---
target: customer trade flow (src/routes/trade)
total_score: 26
p0_count: 0
p1_count: 3
timestamp: 2026-10-03T20-01-06Z
slug: src-routes-trade
---
# Critique: customer trade flow (swap, sell, review, verify, deposit, status, account), phone width

## Design Health Score: 26/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Quote timer, stepper and limit meters are strong; waiting states are mostly honest |
| 2 | Match System / Real World | 3 | French, FCFA, mobile-money brands; "Glissement", "Pool", "cotation" are jargon for this audience |
| 3 | User Control and Freedom | 3 | Back, cancel order, auto-refreshing quote; no undo after confirm |
| 4 | Consistency and Standards | 2 | Black vs purple primary CTA; legal copy names a button that is not on screen; "Menu" icon duplicates Account |
| 5 | Error Prevention | 3 | Limits are enforced early, but the form opens pre-filled over the limit |
| 6 | Recognition Rather Than Recall | 3 | Everything needed is on the screen; provider grid is 4 options |
| 7 | Flexibility and Efficiency | 2 | Max shortcut only; first tab is Swap, not the mobile-money tasks |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained and calm; nested rounded cards and a card per row add weight |
| 9 | Error Recovery | 2 | The limit message is truncated ("200..."), so the key number is hidden |
| 10 | Help and Documentation | 2 | No inline help or support entry in the trade flow |
| | **Total** | **26/40** | **Acceptable** |

## Anti-Patterns Verdict
Does not read as AI-generated: restrained palette, one family, clear tokens. Tells present: nested cards (outer shell radius around 40px holding inner cards), card-per-row Account page. Detector: 2 layout-transition warnings (src/app.css:286, :348, progress bar widths). Browser: low-contrast error text (#d14343 on #f4f4f6, 4.2:1), 0px horizontal padding on a disabled CTA, plus one more.

## Priority Issues
- [P1] The first screen is an error: Swap opens with 1.50 ETH (about 2.35M FCFA), over the limit, so it shows truncated red text and a disabled "Depasse votre plafond" button. Fix: start empty or under the limit, wrap the limit message. Command: harden.
- [P1] Deposit screen inverts the hierarchy: the QR (external-wallet path) leads; the in-app "Envoyer depuis votre portefeuille Relay" button is third and wraps to two lines; a spinner shares a line with an instruction. Fix: lead with the in-app action, fold QR and address under "Depuis un autre portefeuille". Command: layout.
- [P1] Contrast: --fnt is 2.96:1 on the page and 3.52:1 on cards (3.29:1 on dark cards) and is used for inactive tab-bar labels, pending steps and footers; error red is 4.2:1. PRODUCT.md promises WCAG AA and daylight use. Fix: darken --fnt to at least 4.5:1 in both themes and the error red. Command: polish.
- [P2] No prefers-reduced-motion anywhere (0 rules) despite spinner and width transitions. Command: animate.
- [P2] Copy that does not match behavior: the verify screen says the quote "reste verrouillee" though it locks for 30 seconds; the legal line names "Verifier la vente" while the button reads "Confirmer le montant" / "Choisissez un operateur"; step "3" on the verify list is a time estimate; header "Menu" links to Account; header targets are 36px. Command: clarify.
- [P3] Nested rounded cards and a card per Account row; about 300px of empty space above the trade card on tall phones.

## What's Working
- Review screen: rate, fee, payout account, arrival and net amount all before commitment, with a visible quote timer.
- Status stepper: honest, specific steps with the transaction link.
- Account limits: usage meters with "left" and reset time, matching the server.
- Structure: landmarks, no unnamed controls, viewport allows zoom.

## Persona Red Flags
- Mobile-money user in daylight (project persona): inactive tab labels and pending steps fail contrast; the 1.50 ETH default means nothing to them; Swap, not Sell, is the default tab.
- Casey (distracted mobile): header controls 36px; roughly 1 MB of JS before the login screen is usable on a slow network.
- Jordan (first-timer): "Glissement 0,5 %", "Pool", "Reseau Ethereum uniquement", and a QR first when they hold funds inside Relay.
- Sam (screen reader): no h1 on trade pages; "Menu" announces a link to Account.
