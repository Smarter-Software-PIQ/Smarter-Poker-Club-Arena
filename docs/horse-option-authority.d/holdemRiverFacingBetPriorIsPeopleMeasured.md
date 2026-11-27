# holdemRiverFacingBetPriorIsPeopleMeasured: Authority For The Live Switch

**Evidence NOT MET (2026-11-27, interim): the grades are running; this file does not authorize switching the option on.** Built 2026-11-27 by PLO-OWNER lead-9 lane nlof (session 01UxDLnJ) on the owner's orders of 2026-11-27 4:48 PM and 4:50 PM Chicago ("#1 priority ... the over folding bugs ... not just multiway, but also heads up"; "all overfolding fixes for PLO4, PLO5, and No Limit"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`.

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

Pending (the grade queue of the lane is running; bars in the lane's BUILD.md).

## Replay

- Replay: NOT RUN (the audited replay of the lane is queued behind its grades)

## Speed

Relative cost law: an applicable decision with the option on costs 1.36 times the same decision off (0.38 ms against 0.28 ms per decision; `aHoldemRiverFacingBetPriorIsPeopleMeasured.law.test.ts`).

## Limits

- River only, heads-up only, first bet only, fold to call only. The measured flop cell (+104 bb per week) and the turn cell after a checked flop (+67) are not in it; multiway river after a checked turn (+32, 27 bets) is not in it.
- After a checked turn the Horse's own range holds many hands that lose even to his bottom region; the price cannot call those, so that line stays above break-even against a bettor with no record (real-node replay below). Closing it needs the Horse's turn play, not its river call.
- A bettor seen for the first time is priced as the population, which is value heavy: a first-encounter bluffer profits until his river record exists.
- The people table is 356 shown bets; every cell is shrunk, and the call must clear the error of the cell it was priced on.

## Rollback

Set the switch row off (`node scripts/ops/horse-option-switch.mjs set holdemRiverFacingBetPriorIsPeopleMeasured off`); workers follow within two minutes. Rollback triggers for a live trial: heads-up river calls added by the option losing more than 2 standard errors below zero after 30 added calls against people, or any error or breaker receipt.
