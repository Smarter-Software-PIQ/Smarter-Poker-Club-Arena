# holdemRiverFacingBetPriorIsPeopleMeasured: Authority For The Live Switch

**Evidence MET (2026-11-27, build v5): every pre-registered chip bar passed on the fixed harness.** Value-only river bettor 0.00 (0 deals of 16,000 changed; cap -3.0); people-calibrated river bettor pooled -0.15 +/- 0.47 bb/100 (-0.3 SE; bar -1 SE) and recalibrated +0.65 +/- 0.48; league mirror heads-up -0.28 +/- 2.30, 6-max +0.06 +/- 0.33 (four seeds; bar -2 SE); a river barrel bot loses 4.9 more bb per line with production mucking (river fold-through 35.0% to 8.7%, break-even 44%) and 3.8 more with Horse memory off; a true first encounter (no memory, no record) is not made profitable (-0.39 to -0.56 bb per line). What the evidence does not hold: on 304 recorded heads-up river nodes the option turns 6 folds into calls and only one of them was a recorded call (-20 bb), so the real-node chip bar cannot be read; the audited replay sets hold no river fold; the first-encounter bluffer keeps a river fold-through above break-even (50.2%) until his bets are shown. The next step is the live shadow stage, not on. Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`. Built 2026-11-27 by PLO-OWNER lead-9 lanes nlof / nlof2 / nlof3 (session 01UxDLnJ) on the owner's orders of 2026-11-27 4:48 PM and 4:50 PM Chicago ("#1 priority ... the over folding bugs ... not just multiway, but also heads up"; "all overfolding fixes for PLO4, PLO5, and No Limit").

**State: OFF** (release default: no switch row; never switched).

Owner orders it rests on: no blanket rules, every threshold is a price; of 2026-11-26 12:21 PM Chicago, "the stats need to be used against human players, not horses": the opponent's own record, then the people-only population, then the equilibrium anchor; zero unshown hole cards.

## The Defect It Answers

Measured from production, NLH cash (tables and Lightning), 2026-10-28 to 2026-11-27, public actions only: a PERSON's bet into a field of Horses only. A zero-equity bluff is worth `fold-through x pot - (1 - fold-through) x risk` per bet.

| cell (heads-up, a person bets into one Horse) | bets | every Horse folds | break-even | pure bluff, bb per bet | bb per week |
| --------------------------------------------- | ---- | ----------------- | ---------- | ---------------------- | ----------- |
| river, 0.7 to 1.1 pot                         | 91   | 72.5%             | 46.4%      | +11.28 +/- 2.63        | +239        |
| river, 0.4 to 0.7 pot                         | 81   | 51.9%             | 34.6%      | +10.30 +/- 3.94        | +195        |
| river, above 1.1 pot                          | 16   | 87.5%             | 70.0%      | +11.17 +/- 5.18        | +42         |

Which rule folds: 87% of the heads-up river folds leave `decidePostflop` at the river call verdict (`v38_river_fold`): Monte Carlo equity against the Horse's range read, less the one-pair river shades fitted on Horse stack-offs. No step reads what a person's river bet is.

Two earlier builds of this option failed and are not this code: v1/v2 read how OFTEN the bettor bets rivers (failed the people-like bettor, -1.1 to -1.4 SE, and the 6-max mirror, -5.85 +/- 0.98: the Horses bet more rivers than people with thin value, and a frequency cannot tell that from bluffing); v4 read his shown bets pooled over lines and sizes (failed the 6-max mirror, -1.15 +/- 0.41: the same shown bets entered three times and his small thin-value bets priced his big ones).

## What It Does

No-limit hold'em cash, table and Lightning (never tournaments, Short Deck, fixed limit, bomb pots, all-in-or-fold tables, two boards), heads-up AT THE TIME OF THE BET (a river bet made into more than one player is not priced), the river, facing the river's FIRST bet (the Horse has put nothing in on the river and nobody has raised), and the brain's decision is a FOLD (`HorseLogic.holdemRiverFacingBetOnPeople`). The fold becomes a call when the call's value clears its sampling error. It never folds a call, never raises, and prices nothing facing a raise.

The price (`HorseHoldemFacingBetPeoplePrior.ts`; nothing draws from `fastRandom`):

- His holdings are every two-card hand the board and the Horse's cards leave him, in six regions by the share of holdings each beats: nut (0.95+), strong (0.9), good (0.8), upper middle (0.7), lower middle (0.5), bottom. The Horse's win share against each region is counted exactly.
- The share of his bets from each region, in the evidence order:
  - equilibrium anchor: a bet of `s` pots bluffs `s / (1 + 2 s)`;
  - people: the measured cell of people's heads-up river first bets (size x his line x pot type), shown cards only, a hand mucked at showdown counted lower middle; 20 pseudo-bets per level up to the anchor (`HorseHoldemFacingBetPeoplePriorTables.json`: 356 bets by 62 people, 2026-10-22 to 2026-11-27; a Horse's bet never enters a cell; HUD '\*' rows are not read);
  - his own record FIRST: his own SHOWN heads-up river first bets in the same cell (same line, same size), from `HorseHoldemBetRead.ts`, against `K = 9.5` pseudo-bets of people's cell (the measured between-bettor prior strength of the not-top share: 62 bettors, 356 bets). Entered once, in the cell it was observed in; no pooling across lines or sizes.
- The call: `value = equity x (winnable + call) x (1 - rake) - call`, taken only when `value` is above one standard error of the not-top share about THIS bettor (`n` = his shown bets in the cell + `K` discounted by people's cell sample). A never-shown bettor is priced on people's cell with the full between-bettor spread as margin, so a population-only bet is almost never called.

The bet-read store (`HorseHoldemBetRead.ts`) keeps, per player, the region of every heads-up river first bet he SHOWED at a showdown (mucked at showdown = lower middle; uncalled = nothing). Fed by the live hand-complete learner (`horseDecision/workerRuntime.ts`), the boot rebuild (`HorseExploitHydrator`, 72 h) and the grading harness's per-world store. Memory only, no table. One rule for every player; nothing is keyed on an account, a name or a person/Horse flag. Production shows every called heads-up river bet (136 of 136 called people's river first bets, 30 days), so the shown sample carries no muck bias on the river.

Receipts: `holdem_river_people_prior_call`, `holdem_river_people_prior_fold_stands`, `holdem_river_people_prior_own_record_read`, `holdem_river_people_prior_unpriced`.

Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical (flag-off 0 differences in 28,000).

## Prior anchor

- Baseline: equilibrium, the indifference bluff share `s / (1 + 2 s)` of a bet of `s` pots; a thin people cell reads it.
- Population weight: PEOPLE-ONLY river first bets, shown cards only, fit by `scripts/ops/holdem-people-facing-bet-prior-fit.mjs`; 20 pseudo-bets per level.
- Own record: his own shown river first bets of that line and size, 9.5 pseudo-bets of people's cell (measured), so his own record dominates as it grows.
- No unshown cards: cells and the store hold cards shown at showdown only; the only hole cards read at the decision are the deciding Horse's own.

## How To Trial It (Live Shadow Stage)

Staged in `HorseOptionShadowStage.OPTION_SHADOW_STAGE` (`holdemStage(['nlh_cash', 'nlh_lightning'], ['river'])`). The only direction it can act in is fold to call. Watch `holdem_river_people_prior_call` against `holdem_river_people_prior_fold_stands`, and the heads-up river fold-through of people's bets per size on the over-fold scoreboard.

## Grades (chips), 2026-11-27, build v5

Fixed harness (`server/src/benchmark/HorseGradeHarness.ts`, forked worlds, own stores including the bet-read store, built-in same-seed no-op; every no-op arm read 0.00 with 0 divergent deals), base = the live switch rows (`l8-harness/opts-live.json`) in both arms. Lane probes in `plo-lead7-01TLQer8/l9-nlof2/src` (`grade-nlh.mts`, `ofe.mts`, `ofe-ft.mts`). Bars written before the first grade; seeds are the first build's (no seed added after a result). ON minus the same-seed no-op, bb/100, 100 bb stacks.

| card                                                                                               | seeds      | result                                                                                | bar            | verdict |
| -------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- | -------------- | ------- |
| value-only river bettor (0.8 pot only with a hand beating 88% of holdings), HU, 8,000 deals a seed | 211, 212   | 0.00, 0.00 (0 deals changed)                                                          | at least -3.0  | pass    |
| people-calibrated river bettor as run                                                              | 211, 212   | +1.17 +/- 0.92, -0.62 +/- 0.55; pooled -0.15 +/- 0.47 (-0.3 SE)                       | at least -1 SE | pass    |
| the same card re-solved to people's 63 / 13 / 24%                                                  | 211, 212   | +0.85 +/- 0.53, -0.28 +/- 1.14; pooled +0.65 +/- 0.48                                 | at least -1 SE | pass    |
| league mirror heads-up, 8,000 pairs a seed                                                         | 311, 312   | -0.58 +/- 3.09, +0.10 +/- 3.45; pooled -0.28 +/- 2.30                                 | at least -2 SE | pass    |
| league mirror 6-max, 4,000 pairs a seed                                                            | 311 to 314 | +0.43 +/- 0.99, +0.05 +/- 0.69, +0.13 +/- 1.12, -0.02 +/- 0.44; pooled +0.06 +/- 0.33 | at least -2 SE | pass    |

Bluffer cards (seat 0 bets 0.8 pot on every street it can with every holding, heads-up; the bot's zero-equity result per line; two seeds pooled except ftk):

| card                                               | lines | bot bb per line, off | on              | river: every Horse folds, off to on (break-even 44%) | Horses' net, ON minus no-op |
| -------------------------------------------------- | ----- | -------------------- | --------------- | ---------------------------------------------------- | --------------------------- |
| production muck rule, memory on                    | 5,462 | -5.29 +/- 0.31       | -10.20 +/- 0.33 | 35.0% to 8.7%                                        | +56.93 +/- 8.95             |
| Horse memory off (bet-read store learned)          | 6,049 | -0.39 +/- 0.26       | -4.23 +/- 0.29  | 51.2% to 29.8%                                       | +92.78 +/- 8.98             |
| first encounter: no memory, no record, no learning | 6,049 | -0.39 +/- 0.26       | -0.56 +/- 0.27  | 51.2% to 50.2%                                       | +5.78 +/- 2.04              |
| flop and turn barrel, gives up the river           | 2,663 | -2.73 +/- 0.25       | -2.73 +/- 0.25  | no river bet                                         | 0 deals changed             |

Real recorded nodes (304 Horse decisions facing a person's heads-up river first bet, 30 days; the deciding Horse's own cards; opponent memory and the shown record as of each decision in a 72 h window as the live store holds): fold 62.2% to 60.3% (6 flips; 0.4 to 0.7 pot 58.5% to 56.3%, 0.7 to 1.1 pot 81.6% to 81.0%, under 0.4 pot 40.5% to 37.5%); added calls whose recorded action was a call: 1, -20.0 bb (too few to read). No decision folds more; none of the 123 multiway or facing-a-raise river nodes changes. With an unlimited window: 62.2% to 59.6% (8 flips). The live effect starts small and grows with each bettor's shown record: the cell is not closed against a bettor nobody has seen bluff.

## Replay

Real-hand replay on the two NLH cash audit sets (exact-tier postflop decisions, memory as of each decision, `l8-nlhriver/src/rc.mjs`, scored by the committed scorer). The sets hold no recorded river fold (exact tier needs the Horse's cards), so they cannot judge a fold-to-call option.

On the 2026-11-24 to 26 set (555 rows) the option changes no decision and the committed scorer refuses to score an arm identical to its base (inert arm: no row written). On the 2026-11-20 to 24 set:

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 327; unjudged 0; set NLH-cash-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm NLOF2R vs off; replayed 327 of 327

Horse strengths (the audits' correct calls and bets): none of the 882 audited decisions changes.

## Speed

Relative cost law: an applicable decision with the option on costs 1.41 times the same decision off (0.35 ms against 0.25 ms; `aHoldemRiverFacingBetPriorIsPeopleMeasured.law.test.ts`). Flag-off: `scripts/ops/horse-flag-off-check.sh origin/main HEAD --set full` = 0 differences in 28,000 decisions (same action, amount, full decision JSON and receipts). The compiled-build percentile read was not run.

## Limits

- River only, heads-up at the time of the bet, first bet only, fold to call only.
- A bettor never shown is priced on people's value-heavy cell with the full between-bettor margin: the option calls almost nothing against him; first-encounter bluffs keep their river fold-through until he is shown.
- After a checked turn the Horse's own range holds many hands that lose even to the bottom region; no fold-to-call price can close that line.
- The record is built from spots where the answering player called and applied where the brain folds; if the brain's own read is right the bets it folds to are stronger than the cell average. That bias cannot be measured from public data; the mirrors are its check.

## Rollback

Set the switch row off (`node scripts/ops/horse-option-switch.mjs set holdemRiverFacingBetPriorIsPeopleMeasured off`); workers follow within two minutes. Rollback triggers for a live trial: heads-up river calls added by the option losing more than 2 standard errors below zero after 30 added calls against people, or any error or breaker receipt.
