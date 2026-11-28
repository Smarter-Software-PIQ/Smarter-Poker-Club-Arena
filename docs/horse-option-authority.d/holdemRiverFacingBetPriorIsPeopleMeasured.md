# holdemRiverFacingBetPriorIsPeopleMeasured: Authority For The Live Switch

**Evidence NOT MET (2026-11-27): the option FAILS two of its bars and must stay off.** Against a people-like river bettor its added calls lose 0.6 to 1.1 bb/100 (-1.1 to -1.4 standard errors; bar -1), and in the 6-max league mirror the ON seats lose 5.85 +/- 0.98 bb/100 per seat to the OFF seats (four seeds). It passes the value-only cost cap (-0.70 +/- 0.41 against -3.0), the heads-up mirror (+0.44 +/- 2.56) and every bluffer card (a barrel bot loses 4 to 8 bb per line more). This file does not authorize switching the option on. Built 2026-11-27 by PLO-OWNER lead-9 lane nlof (session 01UxDLnJ) on the owner's orders of 2026-11-27 4:48 PM and 4:50 PM Chicago ("#1 priority ... the over folding bugs ... not just multiway, but also heads up"; "all overfolding fixes for PLO4, PLO5, and No Limit"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`.

**State: OFF** (release default: no switch row; never switched).

Owner orders it rests on: no blanket rules, every threshold is a price; of 2026-11-26 12:21 PM Chicago, "the stats need to be used against human players, not horses": the opponent's own record, then the people-only population, then the equilibrium anchor; zero unshown hole cards.

## The Defect It Answers

Measured from production, NLH cash (tables and Lightning), 2026-10-28 to 2026-11-27, public actions only: a PERSON's bet or raise into a field of Horses only, 2,525 wagers by 47 people. A zero-equity bluff is worth `fold-through x pot - (1 - fold-through) x risk` per bet. Over the bar (the bluff profits by more than 2 standard errors):

| cell (heads-up, a person bets into one Horse) | bets | every Horse folds | break-even | pure bluff, bb per bet | bb per week |
| --------------------------------------------- | ---- | ----------------- | ---------- | ---------------------- | ----------- |
| river, 0.7 to 1.1 pot                         | 91   | 72.5%             | 46.4%      | +11.28 +/- 2.63        | +239        |
| river, 0.4 to 0.7 pot                         | 81   | 51.9%             | 34.6%      | +10.30 +/- 3.94        | +195        |
| flop, 0.4 to 0.7 pot                          | 205  | 52.7%             | 34.0%      | +2.17 +/- 0.92         | +104        |
| turn after a checked flop                     | 128  | 57.8%             | 36.3%      | +2.26 +/- 0.58         | +67         |
| river, above 1.1 pot                          | 16   | 87.5%             | 70.0%      | +11.17 +/- 5.18        | +42         |

The river is two thirds of it and is getting worse: 2026-11-25 to 27, river bets of 0.4 pot and more folded the Horse 86.4% of the time (22 bets, +25.0 +/- 7.8 bb per bet). Raises and check-raises on every street, re-raised pots, multiway flops and every preflop cell lose money as pure bluffs (the Horses under-fold there); this option touches none of them. The flop and turn cells are not in this option (a call before the river is not priced by a showdown alone).

Which rule folds: 87% of today's heads-up river folds leave `decidePostflop` at the river call verdict (`v38_river_fold`): the Horse's Monte Carlo equity against its range read of the bettor, less the one-pair river shades fitted on Horse stack-offs (`v61` on 71% of the folds, the large-bet shade `v63` on 56%) and the style caps. No step reads what a person's river bet is, and none reads how often this bettor bets rivers.

What people's river first bets are (shown cards only; 356 bets by 62 people, 2026-10-22 to 2026-11-27): 59 to 66% hold a hand in the top fifth of all holdings on the board, 13 to 17% a middling hand, 23 to 25% air. People are value heavy: against the average person a pot-size river bet is only a marginal call for a bluff-catcher, so the population alone cannot close the cell (replayed on the recorded nodes it moves the pot-size fold from 81.6% to 66.7% against a break-even of 46.6%). The money is taken by the bettor who bets rivers more often than people do. The fix is therefore his own record first.

Earlier work, read before building: PR #11921 (lead-6: `holdemLateStreetIsPriced`, `holdemFlopIsPriced` and three more, unmerged) replaces the whole postflop chooser and failed its own evidence (league mirrors -51 to -89 bb/100; real-card replay 27 fixed, 128 newly wrong); nothing of it is reused. `holdemValueAndCallsArePriced` (lead-7) priced calls on a line range with the equilibrium river bluff share and over-folded rivers when it was on (61% to 83.4%, rolled back at audit #191); its compounding line range is not reused either.

## What It Does

No-limit hold'em cash, table and Lightning (never tournaments, Short Deck, fixed limit, bomb pots, all-in-or-fold tables, two boards), heads-up, the river, facing the river's FIRST bet (the Horse has put nothing in on the river and nobody has raised), and the brain's decision is a FOLD (`HorseLogic.holdemRiverFacingBetOnPeople`, inside the reference, after the priced opening steps). The fold becomes a call when the call's value clears its sampling error. Every other decision is kept: the option never folds a call, never raises, and prices nothing facing a raise.

The price (`HorseHoldemFacingBetPeoplePrior.ts`; nothing draws from `fastRandom`):

- His holdings are every two-card hand the board and the Horse's own cards leave him, placed in five regions by the share of those holdings each one beats: nut (0.95 and above), strong (0.9 to 0.95), good (0.8 to 0.9), mid (0.5 to 0.8), bottom (below 0.5). The Horse's share of wins against each region is counted exactly. The top fifth is cut in three because people's big river bets are not spread evenly over it (of 25 shown top-fifth bets of 0.7 pot and more in cash, 14 were nut and 3 good).
- The share of his bets from each region:
  - equilibrium anchor: a bet of `s` pots bluffs `s / (1 + 2 s)` (bottom); the rest is spread over the top fifth by width;
  - people: the measured cell of people's river first bets for the size (under 0.4 pot, 0.4 to 0.7, 0.7 to 1.1, above), his line (he made the last wager of the turn, the Horse did, the turn was checked through) and the pot type (limped, single raised, re-raised); each cell shrunk to its parent by 20 pseudo-bets: size x line x pot type -> size x line -> size (cash) -> size (cash and tournaments) -> anchor. A hand mucked at the showdown is counted mid, never air. A bet that won without a showdown is not counted;
  - his own record: `rho` = how often he makes the river's first wager, over people's rate. His lifetime record on an unopened heads-up river (OPPONENT-HUD's `r.stab.hu` + `r.lead.hu`, through `HorseMind.holdemRiverUnopenedWagerRecordOf`) is shrunk by 21.0 pseudo-spots (the measured between-player prior strength) to people's river rate 0.3179 times his pooled ratio; his pooled ratio is his decayed `betCheckedTo` counters shrunk by 17.3 to people's 0.2694. The cards deal everybody the same share of top hands, so his top-fifth share is people's divided by `rho` (all top when he bets more rarely than people bet their top fifth), and the rest keeps people's mid : bottom proportion.
- The call: `value = equity x (winnable + call) x (1 - rake) - call`; it is taken only when `value` is above one standard error of the value from the sampling error of the not-top share (`sqrt(q (1 - q) / n)` on the bets behind the cell plus the pseudo-bets).

The same formula for every opponent: nothing is keyed on an account, a name or a person/Horse flag; only the population's data source is people's play.

Receipts: `holdem_river_people_prior_call` (the fold became a call), `holdem_river_people_prior_fold_stands`, `holdem_river_people_prior_own_record_read`, `holdem_river_people_prior_unpriced`.

Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## The Lifetime River Record Reaches The Decision Only While The Option Is Switched

The option is listed in `HUD_NLH_RIVER_CONSUMERS` (`services/OpponentHudStore.ts`): while its switch row is `on`, `shadow` or `on_shadow` and the store is armed, the heads-up river decision of an NLH cash hand carries the opponent's packet, and the worker's provider serves the river stab and lead cells. With no packet the pooled counters alone give `rho`.

## Prior anchor

- Baseline: equilibrium, the indifference bluff share `s / (1 + 2 s)` of a bet of `s` pots; a thin people cell reads it.
- Population weight: PEOPLE-ONLY river first bets, shown cards only (`HorseHoldemFacingBetPeoplePriorTables.json` v2-2026-11-27, fit by `scripts/ops/holdem-people-facing-bet-prior-fit.mjs` from the Hold'em hand audit's own SELECT: 356 bets by 62 people, 46,432 hands read, 2026-10-22 to 2026-11-27; a bet by a Horse never enters a cell; the stored HUD '\*' rows are not read). 20 pseudo-bets per level.
- Own record: the bettor's lifetime river first-wager record (21.0 pseudo-spots) on top of his pooled checked-to record (17.3), so his own record dominates as it grows: a player who bets every unopened river reads `rho` 1.7 after 10 river spots and 2.4 after 40; a player who bets one river in eight reads below 0.6 after 100.
- No unshown cards: the table is fitted on cards shown at showdown and public actions; his range at the decision is every holding; the only hole cards read are the deciding Horse's own.

## How To Trial It (Live Shadow Stage)

Staged in `HorseOptionShadowStage.OPTION_SHADOW_STAGE` (`holdemStage(['nlh_cash', 'nlh_lightning'], ['river'])`). The only direction it can act in is fold to call. Watch `holdem_river_people_prior_call` against `holdem_river_people_prior_fold_stands`, and the heads-up river fold-through of people's bets per size on the over-fold scoreboard.

## Grades (chips), 2026-11-27

Fixed harness (`server/src/benchmark/HorseGradeHarness.ts`, forked worlds, own stores, built-in same-seed no-op; every no-op arm read 0.00 with 0 divergent deals), base = the live switch rows of 2026-11-27 17:10Z in both arms. Lane probes in the lane's scratch folder (`plo-lead7-01TLQer8/l9-nlof/src`: `grade-nlh.mts`, `ofe.mts`, `ofe-ft.mts`). Bars were written before the first grade. All figures ON minus the same-seed no-op, bb/100, 100 bb stacks.

| card                                                                                                                 | seeds      | result                                                                                          | bar            | verdict |
| -------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- | -------------- | ------- |
| value-only river bettor (bets 0.8 pot only with a hand that beats 88% of holdings), heads-up, 8,000 deals a seed     | 211, 212   | -0.86 +/- 0.61, -0.56 +/- 0.56; pooled -0.70 +/- 0.41                                           | at least -3.0  | pass    |
| people-calibrated river bettor as run (realized bets 66 / 15 / 19% top / mid / bottom), heads-up, 8,000 deals a seed | 211, 212   | -0.38 +/- 1.01, -0.72 +/- 0.69; pooled -0.61 +/- 0.57 (-1.07 SE)                                | at least -1 SE | FAIL    |
| the same card re-solved to people's 63 / 13 / 24% at a 0.305 bet rate                                                | 211, 212   | -0.89 +/- 1.06, -1.41 +/- 1.18; pooled -1.12 +/- 0.79 (-1.4 SE)                                 | at least -1 SE | FAIL    |
| league mirror heads-up, 8,000 pairs a seed                                                                           | 311, 312   | +1.30 +/- 3.64, -0.40 +/- 3.60; pooled +0.44 +/- 2.56                                           | at least -1 SE | pass    |
| league mirror 6-max, 4,000 pairs a seed                                                                              | 311 to 314 | +0.36 +/- 2.26, -3.92 +/- 1.92, -7.78 +/- 2.04, -9.75 +/- 1.75; pooled -5.85 +/- 0.98 (-5.9 SE) | at least -1 SE | FAIL    |

Bluffer cards (seat 0 bets 0.8 pot on every street it can with every holding, heads-up; the bot's own zero-equity result per line; two seeds pooled except the last):

| card                                                              | lines | bot, bb per line, option off | option on       | river: every Horse folds, off to on (break-even 44%) | Horses' net, ON minus no-op |
| ----------------------------------------------------------------- | ----- | ---------------------------- | --------------- | ---------------------------------------------------- | --------------------------- |
| production muck rule, Horse memory on                             | 5,433 | -5.37 +/- 0.31               | -11.09 +/- 0.33 | 34.9% to 4.1%                                        | +55.97 +/- 9.52             |
| Horse memory off (the world's lifetime river record still served) | 6,052 | -0.39 +/- 0.26               | -8.66 +/- 0.31  | 51.2% to 2.7%                                        | +150.90 +/- 12.44           |
| first encounter: no memory and no record of any kind              | 6,052 | -0.39 +/- 0.26               | -4.65 +/- 0.29  | 51.2% to 27.7%                                       | +103.28 +/- 9.47            |
| flop and turn barrel, gives up the river                          | 2,663 | -2.61 +/- 0.25               | -2.61 +/- 0.25  | no river bet                                         | 0 deals changed             |

Why it fails. "He bets the river more often than people, so his extra bets are not top" is true of a bluffer and false of the Horse field: the Horses make the first wager on 38.2% of unopened heads-up rivers (people 31.8%) and their extra bets are thin value, so the frequency record prices them as bluffing a little more than people and the added calls lose. Against a bettor with people's composition and people's rate the population price alone overrules the brain's own read and loses a little. The first version (the pooled all-street counter as the only record) failed the value-only cap at -14.50 +/- 2.57 and is not this code.

What a passing build needs: the bettor's own SHOWN river record first (what his called river bets were, by region), the frequency record second; then the same bars.

Real recorded nodes (304 Horse decisions facing a person's heads-up river first bet, 2026-10-28 to 2026-11-27, the deciding Horse's own cards, opponent memory and the river record as of each decision): fold 62.2% to 52.2%; the zero-equity value of the recorded bets +9.35 +/- 1.39 to +3.11 +/- 1.28 bb per bet; 0.4 to 0.7 pot +10.90 to -0.65; 0.7 to 1.1 pot +13.62 to +6.94 +/- 2.45 (not closed); after his own turn bet +10.38 to -3.75; after a checked turn +8.16 to +6.55 (not closed). The six added calls whose recorded action was a call realized -6.38 +/- 6.01 bb per call. No decision folds more; none of the 123 multiway or facing-a-raise river nodes changes.

## Replay

Real-hand replay on the two NLH cash audit sets (every exact-tier postflop decision; opponent memory as of each decision; lane harness `l8-nlhriver/src/rc.mjs` on this branch, scored by the committed scorer). The sets hold no recorded river fold (the exact tier needs the Horse's cards, so only showdown hands are in it): they cannot judge an option that only turns folds into calls. One decision changes (a recorded correct river call the memory-on brain folds; the option calls it), unjudged by the verdict-only source.

- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 554; unjudged 1; set NLH-cash-hand-audit-2026-11-24-to-26; scorer 5302af2ab3e; source placed verdict-only; arm NLOF vs off; replayed 555 of 555
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 327; unjudged 0; set NLH-cash-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm NLOF vs off; replayed 327 of 327

Horse strengths (the audits' correct calls and bets): 0 of the other 881 decisions change.

## Speed

Relative cost law: an applicable decision with the option on costs 1.36 times the same decision off (0.38 ms against 0.28 ms per decision; `aHoldemRiverFacingBetPriorIsPeopleMeasured.law.test.ts`). The compiled-build percentile read and the 28,000-decision flag-off check were not run: the grade stopped at the failed bars.

## Limits

- River only, heads-up only, first bet only, fold to call only. The measured flop cell (+104 bb per week) and the turn cell after a checked flop (+67) are not in it; multiway river after a checked turn (+32, 27 bets) is not in it.
- After a checked turn the Horse's own range holds many hands that lose even to his bottom region; the price cannot call those, so that line stays above break-even against a bettor with no record (real-node replay below). Closing it needs the Horse's turn play, not its river call.
- It fails its bars against a people-like bettor and against the Horse field (Grades): the frequency record cannot tell a bluffer from a thin-value bettor.
- The people table is 356 shown bets; every cell is shrunk, and the call must clear the error of the cell it was priced on.

## Rollback

Set the switch row off (`node scripts/ops/horse-option-switch.mjs set holdemRiverFacingBetPriorIsPeopleMeasured off`); workers follow within two minutes. Rollback triggers for a live trial: heads-up river calls added by the option losing more than 2 standard errors below zero after 30 added calls against people, or any error or breaker receipt.
