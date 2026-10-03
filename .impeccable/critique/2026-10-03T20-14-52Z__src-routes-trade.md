---
target: customer trade flow (src/routes/trade)
total_score: 29
p0_count: 0
p1_count: 0
timestamp: 2026-10-03T20-14-52Z
slug: src-routes-trade
---
# Critique: customer trade flow (second run, after the P1 and P2 passes)

## Design Health Score: 29/40 (Good)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Quote countdown, steppers, blocked states all explained; demo status shows a gross amount |
| 2 | Match System / Real World | 3 | "Glissement" and "Pool" are still unexplained |
| 3 | User Control and Freedom | 3 | Back, cancel, auto-refresh quote |
| 4 | Consistency and Standards | 3 | CTA colour and legal line fixed; provider tiles wrap unevenly |
| 5 | Error Prevention | 3 | Empty default, hard-blocked limits, KYC gate; the amount field is a 27px tap target |
| 6 | Recognition Rather Than Recall | 3 | Stepwise disclosure keeps the next choice visible |
| 7 | Flexibility and Efficiency | 3 | Opens on Vendre, last provider remembered, Max |
| 8 | Aesthetic and Minimalist Design | 3 | Calm; three levels of nested rounded containers remain |
| 9 | Error Recovery | 3 | Messages wrap in full; no way forward from a limit error |
| 10 | Help and Documentation | 2 | Still no help or support entry in the trade flow |
| | **Total** | **29/40** | **Good** |

## Anti-Patterns Verdict
Not AI-looking. CLI detector: clean (was 2 warnings). Browser overlay: 1 finding (cramped-padding, 0px horizontal padding on .btn). Measured contrast: 0 failures across visible text in light mode.

## Priority Issues
- [P2] The primary amount input is 27px tall and only the digits are tappable; the surrounding row does nothing. Fix: tapping anywhere in the row focuses the input, and give the field a 44px minimum. Command: adapt.
- [P2] No headings on the trade screens (zero h1 or role=heading), so a screen reader has no page title to land on. Fix: a visually-hidden h1 per tab and screen. Command: harden.
- [P2] No help in the flow and no way forward from a limit error. Fix: a "Need help?" link and, on a per-transaction limit error, a one-tap "use the maximum" action. Command: clarify.
- [P3] The demo status screen shows a gross "82 600 FCFA réglés" after the review promised 78 400 net. Command: clarify.
- [P3] Three levels of nested rounded containers, about 190px of dead space above the form, "Frais : 5 % · 0 FCFA" noise in the empty state, uneven provider tiles ("Orange Money" wraps), a crowded Activity row with no tap affordance, and 0px horizontal padding on buttons. Command: layout.

## What's Working
- Stepwise form: amount, then provider, then number, then review, each revealed when needed.
- Honest blocked states: the empty form says what to do; limit errors wrap in full and the button stays disabled.
- Deposit screen: one primary action, the QR tucked under "another wallet".
- Contrast and motion: no contrast failures measured; reduced motion supported.

## Persona Red Flags
- Casey (one-handed): the amount field's tap target is 27px.
- Sam (screen reader): no page headings anywhere on the trade screens.
- Jordan (first-timer): "Glissement 0,5 %", "Pool"; no help entry.
- Mobile-money user: the Activity row is cramped and doesn't look tappable; the demo status number differs from the review.
