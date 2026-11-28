# omahaHiddenBetsArePricedAsGiveUps: Authority For The Live Switch

Built 2026-11-27 by lead-9 worker HUOOP (session 01UxDLnJ) on Dan's order of 2026-11-27 4:48 PM ("#1 priority ... are the over folding bugs ... not just multiway, but also heads up"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaHiddenBetsArePricedAsGiveUps`; compiled scope 0 = PLO4 and PLO5). It acts only with `omahaPeoplePriorCountsHiddenBets` on (and that one only inside `omahaFacingBetPriorIsPeopleMeasured`). **Evidence NOT MET**: the fixed-harness grades are in `plo-lead7-01TLQer8/l9-huresid/BUILD.md` and the PR body; this file does not authorize switching the option on.

**State: OFF** (registered, no switch row in production; read `=== true`; held off by lead-10). Corrected 2026-11-28 (see "Correction 2026-11-28"): the give-up share now takes the verdict's own realization. **Evidence NOT MET** after the correction: the heads-up bettor-who-bet-the-flop turn cell still over-calls in PLO5 (value-only bettor's gain +1.75 +/- 0.85 over serving, z 2.05, bar 2 SE), and single-raised checked-flop sub-cells stay open (PLO5 big +2.96 +/- 0.97, PLO4 mid +3.40 +/- 1.23). Do not switch on.

## The Defect It Answers

With `omahaPeoplePriorCountsHiddenBets` and `omahaTurnFacingBetPriorIsLineSplit` both on (stacked head 058c92afeff7), the real-node replay of recorded Horse decisions facing a PERSON's first turn bet heads-up (Oct 27 to Nov 27, the deciding Horse's own cards only, seeds 1/7/42) still leaves one line over the bar: a 0.7-1.1 pot turn bet after a CHECKED-THROUGH flop.

| cell (heads-up, flop checked through, turn bet 0.7-1.1 pot) | decisions | fold, both on | break-even | zero-equity bluff, bb per bet |
| ----------------------------------------------------------- | --------- | ------------- | ---------- | ----------------------------- |
| PLO5 all pots                                               | 634       | 58%           | 48%        | +6.36 +/- 1.66                |
| PLO5 re-raised pots                                         | 247       | 61%           | 47%        | +14.00 +/- 4.02               |
| PLO5 single-raised, out of position                         | 200       | 58%           | 48%        | +3.05 +/- 1.28                |
| PLO4 all pots                                               | 247       | 72%           | 48%        | +5.30 +/- 1.18                |
| PLO4 single-raised, out of position                         | 78        | 77%           | 47%        | +6.15 +/- 1.01                |

Two causes. (1) The turn verdict prices the bettor as a value region plus every other holding, and multiplies the whole equity by the turn realization (0.85 out of position). The hidden-bets prior counts people's HIDDEN bets (he checked and folded to a bet later in the hand, or mucked at the showdown) into the non-value share, but they are then priced like any non-value holding: a bare pair has about 0.47 against that region, 0.85 of it realized, so the Horse's one-pair range (25% of the cell with no draw, 17% with a gutshot) folds 85-90%. A hidden bet is by construction the bettor's weakest class and a bet that did not fire the river or lost the showdown. (2) The hidden-bets prior stands aside in every re-raised pot, on the flop and the turn; its reason was measured on FLOP bets. The turn cells are split by line, not pot type, and the re-raised checked-flop line is where PLO5 leaks most.

## What It Does

PLO4/PLO5 cash (tables and Lightning, one board, high only, no bomb pot), heads-up, the turn, a first bet (never a raise), inside the facing-bet verdict, only where `omahaPeoplePriorCountsHiddenBets` prices the bet:

1. The give-up share g of his bets: people's hidden fraction of the same split cell the hidden-bets prior reads (per game, shrunk toward the game-pooled split with the same 30 pseudo-bets), blended with the equilibrium anchor's give-up share over 30 pseudo-bets. The anchor's give-up share is the ONE-street balanced share b: a balanced two-street bettor is (1-b)^2 value, b(1-b) bluffs that bet the river again and b bluffs that stop. His own record moves g with the rest of the share (own record, then people, then anchor). g never exceeds the non-value share q.
2. The verdict: P(win) = [(q - g) x other + g x bottom + (1 - q) x value] x realization, where bottom is the exact equity against his weakest half of holdings as they rank on the turn (every river card counted). The give-up part takes the same realization as the rest of his range (corrected 2026-11-28; as first merged it took none: see below).
3. A re-raised pot whose flop CHECKED THROUGH is priced with the hidden-bets prior's checked-line turn cell and this give-up share. Every other re-raised-pot line, and every flop decision in a re-raised pot, stays as before.

No clamp, no size rule, no identity input (person or Horse, name, account), no unshown card. It never raises: it only turns folds into calls. Air still folds (it loses to the weakest half too). PLO6, tournaments, the flop, the river, raises and multiway pots are untouched. Receipts `omaha_hidden_give_up_priced`, `omaha_hidden_give_up_priced_call`. Staged for shadow re-decision on the turn.

## What Was Measured (as first merged, before the 2026-11-28 correction)

Real-node replay, same decisions, base = both options above on, arm = base + this option (zero-equity bluff bb per bet; bar: not more than +2 SE above zero):

| cell (flop checked through, turn bet 0.7-1.1 pot) | base fold | fold with option | bluff with option |
| ------------------------------------------------- | --------- | ---------------- | ----------------- |
| PLO5 all pots (634)                               | 58%       | 37%              | -10.70 +/- 1.55   |
| PLO5 re-raised (247)                              | 61%       | 24%              | -25.25 +/- 3.58   |
| PLO5 single-raised (349)                          | 54%       | 45%              | -1.65 +/- 0.91    |
| PLO4 all pots (247)                               | 72%       | 53%              | -1.55 +/- 1.17    |
| PLO4 single-raised (152)                          | 68%       | 51%              | +0.87 +/- 0.82    |
| PLO4 limped (69)                                  | 80%       | 68%              | +0.86 +/- 0.32    |

Still over by a hair inside PLO4: limped pots (+0.86 +/- 0.32, pots of 3 to 4 big blinds) and single-raised out of position (+2.48 +/- 1.19, z 2.1, n 78). Chips of the calls the option adds where the recorded Horse called (natural experiment): re-raised checked-flop turn pots +9.3 +/- 16.7 bb (n 22); single-raised and limped pots, all turn lines, -2.3 +/- 7.9 bb (n 49). Speed (relative-cost law, 40 real turn decisions it prices): on 9.11 ms vs off 8.50 ms per decision telemetry off (ratio 1.07), 9.43 vs 8.53 telemetry on (1.11).

Fixed harness (ON-minus-same-seed-no-op, base = live rows + the two options above, 2 seeds pooled, bb/100): value-only bettor PLO4 -0.55 +/- 0.61 (bar >= -3.0), PLO5 -0.37 +/- 0.73 (bar >= -4.0); people-calibrated responder PLO4 +1.07 +/- 1.45, PLO5 +0.20 +/- 1.05 (bar >= -1 SE). Bluffer bots, bb per line, base -> option: flop+turn barrel that gives up the river PLO4 -0.99 -> -3.72 +/- 0.37, PLO5 -1.27 -> -3.43 +/- 0.45; three-street barrel under the production muck rule PLO4 -5.17 -> -8.33 +/- 0.69, PLO5 -5.34 -> -7.07 +/- 0.78. NOT closed by this option: the first-encounter three-street barrel with memory off still profits on the RIVER exactly as on the base (PLO4 +1.43 -> +1.50 +/- 0.66; PLO5 out of position +2.04 -> +2.54 +/- 0.91): that is the river own-record gap, another option's work.

## Correction 2026-11-28 (lead-10 worker EFIX, `plo-lead7-01TLQer8/l10-efix/BUILD.md`)

What was wrong. As merged (#12259) the verdict added g x (bottom - other x realization) AFTER multiplying the whole equity by the turn realization, i.e. the give-up share was granted full realization on top of a realization factor that already averages over every river line of the bettor, his check-downs and give-ups included (the paired-board cap 0.42 and the aggressor cap 0.65 say so in their own comments: "realizing equity only on river check-downs"). Those rivers were counted twice. The over-call is largest where the factor is smallest: the bettor who also bet the flop. The give-up share g itself was checked and is plausible there (people-measured: PLO4 0.258 of q 0.473 with 55 bets in the cell, PLO5 0.226 of q 0.468 with 120; the anchor 0.27 sits beside people). Of 15 real nodes the production-shaped replay turned from fold to call on that line, 12 reproduce in isolation: 6 are paired-board hands at realization 0.42 whose whole gain (+0.10 to +0.14 equity) was the 0.42 -> 1 step.

What changed. One line pair in the option's gated block of `HorseOmahaFacingBetEv.ts`: pWin += g x (bottom.win - other.win) x realization (pTie the same). With the option off nothing changes (0 differences in 28,000). A law test (`anOmahaHiddenBetsArePricedAsGiveUps.law.test.ts`, "the give-up class takes the verdict realization, never a second one") prices a real bettor-bet-flop node (PLO4, paired turn, realization < 0.5) and fails on the merged formula.

Evidence after the correction (production-shaped replay `l10-plx/src/replayD.mts`, opponent memory on, seeds 1/7/42, base A = `omahaPeoplePriorCountsHiddenBets` + B = `omahaTurnFacingBetPriorIsLineSplit`). Three variants were graded: v1 the merged formula, v2 this correction, v3 a conservation variant (g x (bottom - other), g at most realization x q). v2 is shipped: it is strictly less over-calling than v1 and no worse than v3 on either side.

| cell (heads-up, turn)                                                      | bar             | v1 merged                   | v2 shipped                        | v3                          |
| -------------------------------------------------------------------------- | --------------- | --------------------------- | --------------------------------- | --------------------------- |
| bettor bet the flop, mid size, value-only bettor's gain over serving, PLO4 | within 2 SE     | +1.71 +/- 0.58 (z 3.0) FAIL | +0.38 +/- 0.27 (z 1.4) PASS       | +0.38 +/- 0.27 PASS         |
| same, PLO5                                                                 | within 2 SE     | +4.33 +/- 1.20 (z 3.6) FAIL | +1.75 +/- 0.85 (z 2.05) FAIL      | +2.06 +/- 0.90 (z 2.3) FAIL |
| flop checked, big, zero-equity bluff bb/bet, PLO5 all pots (n 337)         | not > 0 by 2 SE | -3.52 +/- 2.56              | -1.69 +/- 2.57 PASS               | -1.94 +/- 2.57              |
| same, PLO5 single-raised                                                   |                 | +2.73 +/- 0.97 open         | +2.96 +/- 0.97 (z 3.1) OPEN       | +2.96 +/- 0.97 open         |
| flop checked, mid, PLO5 all pots (n 77)                                    |                 | -2.99 +/- 5.02              | +1.80 +/- 5.28 PASS               | +1.80 +/- 5.28              |
| flop checked, big, PLO4 all pots (n 160)                                   |                 | -2.16 +/- 1.46              | -0.16 +/- 1.52 PASS               | -0.16 +/- 1.52              |
| same, PLO4 single-raised                                                   |                 | +1.24 (z 1.4)               | +1.78 +/- 0.89 (z 2.0) at the bar | +1.78                       |
| flop checked, mid, PLO4 all pots (n 68)                                    |                 |                             | +1.25 +/- 1.38 PASS               | +1.25                       |
| same, PLO4 single-raised                                                   |                 | +1.84 (z 1.5)               | +3.40 +/- 1.23 (z 2.8) OPEN       | +3.40                       |

The A + B base alone already gives PLO5 bet-flop z 1.76; the corrected option moves one event per game there (+0.37 +/- 0.37 PLO5, +0.19 +/- 0.19 PLO4). With `omahaGiveUpPricedTurnCallIsAtIndifference` (#12308) on top, the bet-flop cell fails in both games (PLO4 +1.24 +/- 0.50, PLO5 +2.92 +/- 1.06): that option stays held off.

Lane harness, checked-flop big and mid turn cells, no memory (method of `l9-huresid`), zero-equity bluff bb/bet, v1 -> v2: PLO4 big -1.55 +/- 1.17 -> -0.38 +/- 1.20; PLO4 mid -0.69 -> +0.83 +/- 1.23; PLO5 big -10.70 +/- 1.55 -> -6.75 +/- 1.60; PLO5 mid -10.65 -> -7.11 +/- 3.69 (all PASS); sub-cell PLO4 big single-raised +0.87 +/- 0.82 -> +1.72 +/- 0.81 (z 2.1, over).

Next design (not built here): realization by line. A give-up does not bet the river, so against it the caller realizes his showdown equity; the rest of the non-value share should carry the realization of the bettor's betting lines only, measured from people's public river lines after a called turn bet.

## Watch And Rollback

- Re-raised pots, flop checked through, turn bet: roll back (switch off) if the realised chips of the calls this option adds against people are below zero by 2 SE after 30 such calls.
- The whole option: roll back if `omaha_hidden_give_up_priced_call` calls against people lose by 2 SE after 60, or any breaker, error or decision over 50 ms appears in the shadow read.

## Prior anchor

- Baseline: equilibrium. The one-street balanced share for the price (`omahaEquilibriumAnchor`) is the give-up share of a balanced two-street bettor; it weighs 30 pseudo-bets behind people's hidden fraction and is the whole give-up share where a cell is unmeasured.
- Population weight: PEOPLE-ONLY hidden fraction of the split cell (`HorseOmahaPeoplePriorHidden.data.ts`, the hidden-bets prior's own fit; public folds and mucks only), n / (n + 30).
- Own record: his own shown and hidden turn bets of that size and line move the give-up share with the non-value share (8 pseudo-bets); a value-heavy record shrinks it.
- No unshown cards: a fold and a muck are public events; at decision time the option reads the public state and the deciding Horse's own cards.

## Replay

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm GU vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2696; unjudged 1; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm GU vs off; replayed 2697 of 2697
- Note (2026-11-27): arm GU = omahaPeoplePriorCountsHiddenBets + omahaTurnFacingBetPriorIsLineSplit + this option, opponent memory off; the arm without this option (AB) gives the same two rows, so the audited sets hold no decision this option changes: the bar (fixed >= 2 x newly wrong) is met trivially and says nothing. The evidence is the real-node replay and the fixed-harness grades above.
