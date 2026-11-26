# omahaFlopRaiseIsPriced: Authority For The Live Switch

**Evidence NOT MET (2026-11-26, after the size-versus-size change): the build's replay rule still counts 1 fixed / 1 newly wrong and 0 fixed / 3 newly wrong over the two audits, because the verdict-only scorer reads action kinds only: it cannot credit a resized raise, and the raises it turns into a call or a fold are unchanged by this change. The heads-up league mirror is no longer positive (PLO4 -1.0 +/- 1.6, PLO5 -2.2 +/- 2.5 bb/100 over two seeds; not a significant loss). What moved: on the same audited decisions with every opponent's cards as shown, the EV of the action on the audits' own pricing is 34 fixed / 1 newly wrong, +400 bb (before: 18 / 2, +212 bb); the 8 real flop raises against a person in the daily audit of 2026-11-26 are all resized to the pot raise (before: 3); the 6-max mirror is +3.02 +/- 1.21 (PLO4) and +1.89 +/- 1.46 (PLO5) bb/100; no exploit probe is a significant loss over its seeds. Default OFF; a shadow trial only.** This file does not authorize switching the option on.

Built 2026-11-26 by PLO-OWNER lead-7 lane plo-postflop (session 01TLQer8) for the audit leak "raise without price, flop" (daily PLO hand audit 2026-11-25T230000Z, HARD #2: out of position heads-up, 4 cases / 97 bb; #13 in position heads-up). In 10 of that audit's 12 flop raise mistakes the Horse raised with the nuts or close to them to about half or two thirds of the pot raise, where the pot raise priced higher; in the other 2 (a flush facing a re-raise) the raise priced below the call or the fold. The option is registered, default off (read `=== true`), switchable live and scopable per game (`horse.omahaGameScope.omahaFlopRaiseIsPriced`).

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot, the flop, heads-up, facing a wager, where the rule chain's answer is a RAISE (`server/src/engine/HorseOmahaFlopRaisePriced.ts`; in the wager_rules node after the river opening rules and before the river current-nuts floor and the nut size band). The raise is priced at the legal minimum, the chain's own size, half way to the pot raise and the pot raise, beside the call and the fold, against the bettor's measured flop range (HorseOmahaMeasuredBettorRange: shown strength by line and size, showdown bias corrected, his own shown record shrunk toward it): EV(raise to T) = f P (1 - rake) + (1 - f)(R' e_c (P + A + X)(1 - rake) - A), with f his fold share, the equilibrium minimum defence of the pot he is offered X / (P + A + X), he folds the weakest share of his range and continues with the rest, e_c the Horse's two-card-runout equity against it (a card-seeded pool of the unseen holdings ranked on the flop, per strength bin), R' = 1 when the call leaves no stack behind, else the street's realization; EV(call) = R eq (P + C)(1 - rake) - C. RAISE OR NOT: the call or the fold replaces the chain's raise only when it prices above it by more than the equity estimate's error (the realization discount and the margin apply). WHICH SIZE (2026-11-26): when the raise stays, two raise sizes are compared on the same footing, the same equity sample with no realization discount between them and no margin, and the size of highest price is taken among the sizes that survive the raise-or-not question as the chain's own size did (the call or the fold does not price above them by more than the margin). It never makes a raise out of a call or a fold, so the owner rules on draws (never raised out of position; in position only combo draws) keep holding. Receipts `omaha_flop_raise_priced_resized`, `_called`, `_folded`.

## What Was Measured

All offline; scratch folders `plo-lead7-01TLQer8/plo-postflop/` (first build) and `plo-lead7-01TLQer8/build-flopraise-nlhmw/` (the size-versus-size change, BUILD.md, g1/). Base = the live switch rows of 2026-11-26 05:45Z. Harnesses as in omahaRiverValueBetInPositionIsPriced.md (the mirror prints bb/100 per seat); 6,000 pairs = 12,000 hands a card; flop probes: seat 0 bets three quarters of the pot on every flop it may, then facing a raise: raise-folder (continues only beaten by under 3% of holdings), raise-caller (always continues), mdf (continues with its strongest half of the minimum defence), re-raiser (jams the strongest 8%, calls to 25%, folds the rest).

### Why The Size Rule Changed (Daily Audit 2026-11-26, Root Cause D2)

On 8 real heads-up flop raises against a person the first build priced the pot raise highest on all 8 and resized 3: every raise row that leaves a stack behind is multiplied by the flop realization factor (0.75 out of position, 0.85 in position), which shrinks the difference between two sizes of the same raise below the error margin. The realization discount and the margin answer "raise or not"; between two sizes of a raise already chosen they do not belong (the equity sample and its error are common to both sizes). With the change all 8 are resized to the pot raise through the engine's own decide (receipt `omaha_flop_raise_priced_resized` on every seed the chain raises): c4c7aa49 79.5 -> 102 bb, a774e1b3 328 -> 420, b3705d47 182.5 -> all in, ad4551e4 117 -> 150, 1b7ab774 46 -> 59, bf2d4a5d 19 -> 24, efdffea9 35.6 -> 44, b0023f31 58.5 -> 75. The ninth row (9fb142d2, an all-in over an all-in) is a call the audit mislabels; it is untouched.

### Grades After The Change (This Code)

| card                           | seed(s)                      | bb/100 ON - OFF                                      | first build                     |
| ------------------------------ | ---------------------------- | ---------------------------------------------------- | ------------------------------- |
| PLO4 heads-up mirror           | 20261126, 20261203           | -1.75 +/- 2.63, -0.26 +/- 1.98 (pooled -1.0 +/- 1.6) | +2.19 +/- 2.36                  |
| PLO5 heads-up mirror           | 20261126, 20261203           | -2.05 +/- 3.49, -2.30 +/- 3.52 (pooled -2.2 +/- 2.5) | +3.74 +/- 3.21                  |
| PLO4 6-max mirror              | 20261126                     | +3.02 +/- 1.21                                       | +2.04 +/- 0.91                  |
| PLO5 6-max mirror              | 20261126                     | +1.89 +/- 1.46                                       | +1.05 +/- 1.10                  |
| probe raise-folder PLO4 / PLO5 | 20261127                     | -0.02 +/- 4.85 / +3.15 +/- 6.90                      | -5.94 +/- 4.50 / -5.06 +/- 6.58 |
| probe raise-caller PLO4 / PLO5 | 20261127                     | +7.55 +/- 6.27 / +9.70 +/- 8.96                      | +1.33 +/- 5.42 / +7.10 +/- 8.00 |
| probe mdf PLO4                 | 20261127, 20261201, 20261202 | -8.54 +/- 5.36, +6.13 +/- 5.67, +5.80 +/- 5.04       | +1.24 +/- 4.61                  |
| probe mdf PLO5                 | 20261127                     | -3.32 +/- 8.29                                       | -8.12 +/- 8.66                  |
| probe re-raiser PLO4           | 20261127, 20261201, 20261202 | -11.56 +/- 5.88, +5.21 +/- 6.50, -3.37 +/- 6.12      | -2.56 +/- 5.18                  |
| probe re-raiser PLO5           | 20261127                     | +9.69 +/- 7.10                                       | -0.25 +/- 7.93                  |

Read honestly: the 6-max mirrors rose and the PLO4 one is significant; the heads-up mirrors fell from slightly positive to slightly negative, neither significant; the PLO4 re-raiser probe is -1.97 standard errors on its first seed and +0.8 and -0.6 on two more (pooled about -3.2 +/- 3.6): not a significant loss, and the one to watch in shadow. The bigger raise wins more from a caller and loses more to a player who re-raises only his strongest hands.

Audited real decisions (EV of the arm's action against the off arm's on hand-audit-plo lib/grade.mjs, shown cards only; `g1/D.ev.txt`, `g1/F.ev.txt`): daily 2026-11-25 23 changed, 12 fixed / 0 newly wrong, 20 better / 3 worse, +186.9 bb (first build: 6 changed, 5 / 0, +109.3 bb); 2026-11-20..24 37 changed, 22 fixed / 1 newly wrong, 33 better / 4 worse, +213.0 bb (first build: 19 changed, 13 / 2, +102.6 bb). The one newly wrong row (8a2b3d04, a raise folded where the audit calls, -14.2 bb) is the raise-or-not test, unchanged. A limit of this scorer: the audit prices one fold-to-raise rate that does not depend on the raise size, so it favours the pot raise by construction; the resizes that go DOWN (three in the daily set, e.g. fdf22ddf 67 -> 42.5 bb) also score better on it. The audits' in-position calls: 0 changed (it reads raises only).

Speed (this code): 585 applicable real heads-up flop raises (286 at 200 bb or deeper), HorseLogic.decide: p50 3.3 / p95 4.3 / max 5.6 ms with the option on; added p50 1.5 / p95 1.9 / max 2.6 ms; 0 over 50 ms. The relative-cost law (anOmahaFlopRaiseIsPricedIsFast) reads 2.1x the option-off decision (limit 8).

Flag-off: see the pull request (0 differences in 28,000 on the full set).

Limits: no per-opponent flop fold-to-raise record exists in the HUD feed, so every opponent folds at the equilibrium prior. Heads-up only; the multiway flop raise is not priced. Between two raise sizes no realization difference is priced (a bigger raise leaves less stack behind, which this comparison ignores in both directions). The verdict-only replay scorer cannot see a resize, so this option's main effect is invisible to the build's replay rule.

## Prior anchor

- Baseline: with no record, his fold share against a raise is the equilibrium minimum defence of the pot he is offered, X / (P + A + X).
- Own record: his shown flop wagers (HorseOmahaBetRead's per-opponent cells) move the measured range toward his own shown value share; the OPPONENT-HUD feed holds no per-opponent flop fold-to-raise count, so the fold share is the equilibrium prior for every opponent.
- Population weight: the range SHAPE is the measured pooled table (#11939); no pooled fold rate enters.
- No unshown cards: the table is fitted from shown cards only; the decision reads the public state, the Horse's own cards and the known dead cards.

## Replay

- Replay: fixed 1; newlyWrong 1; changed 3; unchanged 866; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm flopraise vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 3; changed 5; unchanged 2692; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm flopraise vs off; replayed 2697 of 2697
- Note (2026-11-26): arm flopraise is this option alone; both rows were re-run on the size-versus-size code (integration-2 head f39476d4a536 plus this change) and came out identical, because the scorer is verdict-only: a resized raise is 'unchanged' to it.
