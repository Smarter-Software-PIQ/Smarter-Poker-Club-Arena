# omahaBareOverpairContinuationIsPeoplePriced: Authority For The Live Switch

Built 2026-11-27 by lead-9 worker HU2 (session 01UxDLnJ) on Dan's order of 2026-11-27 4:48 PM ("#1 priority ... are the over folding bugs ... not just multiway, but also heads up"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaBareOverpairContinuationIsPeoplePriced`; compiled scope 0 = PLO4 and PLO5). It acts only where `omahaBareOverpairOopFlopCheck` is on (its continuation is the spot); it reads the hidden-corrected flop cell when `omahaPeoplePriorCountsHiddenBets` is on. **Evidence NOT MET**: the fixed-harness grades are in `plo-lead7-01TLQer8/l9-huresid2/BUILD.md` and the PR body; this file does not authorize switching the option on.

## The Defect It Answers

With `omahaPeoplePriorCountsHiddenBets` and `omahaTurnFacingBetPriorIsLineSplit` on, the real-node replay of recorded Horse decisions facing a PERSON's flop bet heads-up (Oct 15 to Nov 27, the deciding Horse's own cards only, seeds 1/7/42) leaves one single-raised flop cell over the bar: PLO4, the Horse raised before the flop, checked out of position and faces a 0.7-1.1 pot bet: 63% fold against a 48% break-even, a zero-equity bluff wins +2.58 +/- 1.14 bb per bet (n 70).

Of the 44 folds, 32 are the flop pressure cap's people-measured price (`omahaFlopPressureCapIsPriced`), 1 is another rule, and 11 are the CONTINUATION of `omahaBareOverpairOopFlopCheck`: the bare big pair that checked out of position. In 10 of those 11 the people-measured price had called (equity 0.44 to 0.57 against people's measured flop bets) and the continuation turned the call into a fold. The continuation prices the same bet on the sampler's aggressor tiers (equity 0.41 to 0.50), not on people's flop bets, and it does not count hidden bets. Two prices for one bet, and the older one decided.

## What It Does

PLO4/PLO5 cash (tables and Lightning, one board, high only, no bomb pot), heads-up, the flop, the continuation's own spot (the Horse holds the preflop lead, checked a bare big pair out of position, and faces one bet), never a re-raised pot:

1. The continuation's equity is the Horse's equity against the bettor's PEOPLE-MEASURED flop range: the flop pressure cap's own price (`omahaFlopPressureCapPricedEquity`): his value region for this size plus the people-only non-value share of the flop cell (hidden bets counted and split by pot type with `omahaPeoplePriorCountsHiddenBets`), blended toward the balanced share at 30 pseudo-bets, moved by his own flop record (8 pseudo-bets).
2. Everything else of the continuation is unchanged: its out-of-position flop realization, the rake, the 2% margin, the fail-safe and "never a raise".
3. A re-raised pot (two or more preflop raises) keeps the sampler-tier price exactly as before: no call is added in a 3-bet pot.

No clamp, no size rule, no identity input (person or Horse, name, account), no unshown card. It can turn a fold into a call and a call into a fold; it never produces a raise. PLO6, tournaments, the turn, the river, raises and multiway pots are untouched. Receipts `omaha_bare_overpair_people_priced`, `omaha_bare_overpair_people_priced_call`. Staged for shadow re-decision on the flop.

## What Was Measured

Real-node replay, same decisions, base = the two options above + `omahaHiddenBetsArePricedAsGiveUps`, arm = base + this option (zero-equity bluff bb per bet; bar: not more than +2 SE above zero):

| cell (heads-up, out of position, single-raised, Horse checked as the raiser, flop bet 0.7-1.1 pot) | decisions | base fold | fold with option | bluff base     | bluff with option |
| -------------------------------------------------------------------------------------------------- | --------- | --------- | ---------------- | -------------- | ----------------- |
| PLO4                                                                                               | 70        | 63%       | 54%              | +2.58 +/- 1.14 | +0.98 +/- 1.17    |
| PLO5                                                                                               | 87        | 57%       | 57%              | +2.34 +/- 1.60 | +2.16 +/- 1.60    |
| PLO4, every size                                                                                   | 111       | 46%       | 41%              | +0.99 +/- 0.83 | -0.02 +/- 0.83    |

All flop decisions (4,858): 17 change, 11 fold to call and 6 call to fold (PLO4 8 to 1, PLO5 3 to 5). No re-raised pot changes. Only one added call and one removed call were recorded calls (added -31.5 bb, removed +28.2 bb): too thin to judge chips from real nodes. NOT closed by this option, and not its work: limped pots out of position facing a pot-size flop bet (PLO4 78% fold, +1.63 +/- 0.23, n 102; PLO5 71%, +1.88 +/- 0.56, n 52): every one of those folds is the people-measured flop price itself on a weak holding (a weak pair has 0.36 against the measured range), and the recorded calls there lose (-14.0 +/- 14.2 bb, n 10): the accepted cost of the table VPIP floor ruling.

Audit fixture (445 audited PLO4 heads-up flop decisions): 55 in the continuation's spot, 21 of them re-raised pots (untouched), 34 priced, 3 fold to call, 0 call to fold. Speed (relative-cost law, the 34 priced decisions): on 9.67 ms vs off 6.82 ms per decision telemetry off (ratio 1.42), 9.61 vs 6.64 telemetry on (1.45).

Fixed harness (ON-minus-same-seed-no-op, base = live rows + the three options above): FIXEDHARNESS-PENDING

## Watch And Rollback

- Roll back (switch off) if the calls it adds against people (`omaha_bare_overpair_people_priced_call` where the tier price would have folded: shadow read direction fold to call) lose by 2 SE after 30 such calls, or any breaker, error or decision over 50 ms appears in the shadow read.

## Prior anchor

- Baseline: equilibrium. The balanced non-value share of a flop bet for the price (`omahaFlopBalancedShare`: 1 - (1 - b)^3 with the turn and river to come, b from `omahaEquilibriumAnchor`) weighs 30 pseudo-bets behind people's flop cell and is the whole share where a cell is unmeasured.
- Population weight: PEOPLE-ONLY flop cell (`HorseOmahaFacingBetPeoplePrior.data.ts`; with `omahaPeoplePriorCountsHiddenBets` the hidden-corrected cell per game and pot type, `HorseOmahaPeoplePriorHidden.data.ts`), n / (n + 30).
- Own record: his own shown (and, with the hidden-bets prior, hidden) flop bets of that size move the share and narrow the value region (8 pseudo-bets), exactly as in the flop pressure cap's price.
- No unshown cards: the fit reads only cards people showed; a fold and a muck are public events; at decision time the option reads the public state and the deciding Horse's own cards.

## Replay

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm BO vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2696; unjudged 1; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm BO vs off; replayed 2697 of 2697
- Note (2026-11-27): arm BO = omahaPeoplePriorCountsHiddenBets + omahaTurnFacingBetPriorIsLineSplit + omahaHiddenBetsArePricedAsGiveUps + this option, opponent memory off; the arm without this option (GU) gives the same two rows, so the audited sets hold no decision this option changes: the bar (fixed >= 2 x newly wrong) is met trivially and says nothing. The evidence is the real-node replay above and the fixed-harness grades.
