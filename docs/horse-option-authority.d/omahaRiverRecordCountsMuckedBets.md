# omahaRiverRecordCountsMuckedBets: Authority For The Live Switch

Built 2026-11-27 by PLO-OWNER lead-9 lane RV (session 01UxDLnJ) on Dan's order of 2026-11-27 12:27 PM ("WE STILL AREN'T EVEN CLOSE TO FIXING THE OVER FOLDING BUG, AND THAT SHOULD BE YOUR NUMBER 1 PRIORITY!"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaRiverRecordCountsMuckedBets`). **Evidence NOT MET** (no audited decision can change, so no replay evidence exists); the grades below pass against the harness bluffer it was built for. **NO EFFECT IN PRODUCTION TODAY**: on this platform a called river bettor is always tabled, so the record it reads is empty for every real player. Read "Known Limits" before switching it.

## The Defect It Answers

The last open piece of the over-folding grade was a first-encounter bluffer who bets flop, turn and river with every holding and mucks his losing showdowns. With omahaPeoplePriorCountsHiddenBets on he still won heads-up, and the profit sat on the river: PLO4 +1.36 +/- 0.62 bb per line, PLO5 out of position +2.04 +/- 0.90, with the Horses folding 73% / 71% of rivers against a 44% break-even.

Measured cause (lane RV, fixed grading harness, 4,000 deals, seed 601): at that bluffer's last river bet the Horse's own river record of him held 2 shown river bets, both value, and 23 river bets that had been CALLED and then MUCKED at the showdown. The river record step of omahaFacingBetPriorIsPeopleMeasured reads shown bets only, so it read a bettor who is 2-for-2 value and folded MORE to him than to a stranger (73% against 53% with no record at all), while the turn record, which counts hidden bets, called the turn lighter and brought more and weaker hands to the river.

The same measurement shows what is NOT wrong. With no record of any kind (a true first encounter on every hand) the same bluffer does not profit: PLO4 +0.15 +/- 0.62, PLO5 -1.01 +/- 0.80 bb per line. Under the engine's own show rule (a called river bettor is tabled) the record learns from his shown bluffs and he loses: -4.91 +/- 0.73 and -4.94 +/- 0.90; forty brand-new accounts of 400 deals each are never ahead by 2 SE per line and are losing inside about 20 lines. People's own triple barrels are not weaker than their other river bets (core 61% of 23 shown against 54% of 156), so a river prior split by line would fold more to a triple barrel, not less; it was not built.

## What It Does

PLO4/PLO5 cash (tables and Lightning), heads-up, inside omahaFacingBetPriorIsPeopleMeasured's river price, facing a river BET (never a raise) outside re-raised pots: the bettor's own river record (HorseOmahaBetRead) also counts the river bets of his that were called and then mucked at the showdown as shown bets that were not value. The count is the `hidden` counter the bet read already keeps from public events (the showdown list names a player as mucked; a bet won uncontested and a bet folded to a raise are not counted). The record then moves the people share exactly as it does today (Beta-binomial ratio, 8 pseudo-bets).

Untouched: the people cell (people's shown river bets are all of their called river bets, so the people share is already in this unit), the turn, the flop, raises, re-raised pots, multiway pots, PLO6, tournaments and hold'em. No input reads whether a player is a person or a Horse, a name or an account. No unshown card is read. The option never raises and never changes a bet: only a river fold can become a call (law test on committed real river states). Receipt: `omaha_river_mucked_bets_record_read`, fired only when his record really held mucked called river bets.

## What Was Measured

Fixed grading harness (server/scripts/horse-grade.ts and gradeProbe, ON minus same-seed no-op), base = the live switch rows of 2026-11-27 plus omahaPeoplePriorCountsHiddenBets, heads-up, 100 bb, bluffer betting 0.8 pot, 4,000 deals per run. Bars were written in the lane's BUILD.md before any grade.

| bar                                                    | PLO4                                       | PLO5                                       | result |
| ------------------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ------ |
| first-encounter mucking bluffer, bb per line (base)    | +1.36 +/- 0.62                             | +0.92 +/- 0.77 (out of position +2.04)     | leak   |
| first-encounter mucking bluffer, option on, seed 601   | -4.64 +/- 0.73                             | -4.28 +/- 0.87                             | PASS   |
| first-encounter mucking bluffer, option on, seed 602   | -3.63 +/- 0.71                             | -1.03 +/- 0.79                             | PASS   |
| river all-fold against him, base -> on (44% break-even) | 73% -> 24%                                 | 71% -> 34%                                 |        |
| production-rule bluffer (shows called river bets)      | -5.25 +/- 0.76, -4.64 +/- 0.82 (unchanged) | -5.72 +/- 0.92, -5.19 +/- 0.92 (unchanged) | PASS   |
| value-only bettor and people-calibrated responder      | see Known Limits                           | see Known Limits                           |        |

Cost law (anOmahaRiverRecordMuckedBetsIsFast): on / off ratio 0.98 with telemetry off and 1.05 with it on, 30 real river decisions, limit 4.

## Prior anchor

- Baseline: the balanced non-value share for the price (omahaEquilibriumAnchor), unchanged: the weight behind a thin people cell.
- Population weight: the PEOPLE-ONLY heads-up river cell and regions of omahaFacingBetPriorIsPeopleMeasured, unchanged (people's bets; cards people showed; Horse play never enters; never the HUD '\*' rows).
- Own record: his own river bets of the size, shown and (with this option) called-and-mucked, move the share as a Beta-binomial ratio with 8 pseudo-bets, so his own record dominates from about 8 bets.
- No unshown cards: a mucked bet is counted from the public showdown list, never from its cards.

## Replay

- Replay: NOT RUN (no audited or recorded production decision can change: the option reads only river bets that were called and then mucked, and the engine tables every called river bettor; production Nov 24-27, PLO4/PLO5 cash, every player: 2,820 river first bettors listed at a showdown, 0 mucked)

## Known Limits

- **No effect in production today.** HandController's reveal rules table the final round's last aggressor first and every hand whose last river decision was a call, so a called river bet cannot be mucked. The bluffer this option beats exists only in the grading harness. The option makes the river record right if the show rule ever changes, and it removes a false leak from the grade; it does not change a single decision against a real player today. Switching it on is safe and is not a fix that players will feel.
- For the same reason the value-only bettor, the people-calibrated responder, the real-node replay and the audited replay cannot diverge: none of those opponents ever mucks a called river bet. The value-only probe (PLO4, seed 211, 8,000 deals) read 0.00 with 0 divergent deals; the remaining probe cards are recorded in the lane's BUILD.md.
- What remains exposed on the river is the price itself, not the record: against a stranger the Horses fold 52-53% of rivers to a 0.8-pot bet against a 44% break-even (+4.9 +/- 2.7 bb per river bet in PLO4, +6.4 +/- 2.7 in PLO5), because people's measured river bets are value-heavy. Over a whole three-street line that does not pay (see above), and the record closes it inside about 20 lines.
