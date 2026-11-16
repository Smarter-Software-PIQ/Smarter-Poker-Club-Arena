# A Lightning VPIP floor is met by the cheapest entry (2026-11-16, default OFF, held)

Owner, 2026-11-15 11:35 Chicago: "A VPIP floor is met by the cheapest entry (limp, limp-fold), never by raising or putting in large amounts to meet it."

Two decide options, `lightningCheapEntryHoldem` (NLH) and `lightningCheapEntryOmaha` (PLO4, PLO5), read `=== true`, default OFF. Inside the existing Lightning participation predicate (Lightning cash, preflop, big-blind ante, four to six dealt, not all-in-or-fold) and only where the base answer is a fold:

- the small blind, folded to, completes when the hand clears a price-based bar;
- the small blind, or the button with only the blinds left, calls behind limpers when the hand clears its bar.

The answer is a call of the amount owed, at most one big blind. The option never raises. If the Horse is raised after entering, the base policy decides (limp-fold is expected for the weak part). Nothing reads the Horse's own VPIP, folds or hands since it sat.

## Registered, held

Both options change a preflop range, so they are registered in the live switch as off-only under the owner preflop range hold (independent ruling, 2026-11-16). They cannot be set on until the owner lifts that hold by name. Nothing is switched on.

## Known limits

- Nearly inert without `lightningEarlyFoldNeedsFoldThrough`: on its own, the small blind's early look folds before the pot is folded to it. The development figures below had the fold-through on in both arms.
- Development only (seed 20261114, 1,000 hands per cell, six-handed, 100 bb): small-blind VPIP NLH 26.9 to 29.3, PLO4 32.3 to 53.3, PLO5 29.9 to 44.9; no chip figure is significant. The button over-limp path fired 0 times and is unmeasured.
- The equity table and the raise-risk figures behind the bars are inherited and were not re-measured; no generator check pins the table.
- "No own-VPIP input" holds because the Lightning snapshot carries no VPIP floor. The bar multiplies by persona tightness, which on a floored table is scaled by the Horse's own VPIP; a Lightning table is never floored today.
- On a released fold-through frame answer the style records describe the first (fold) ask, and the frame's style-read time still counts.
