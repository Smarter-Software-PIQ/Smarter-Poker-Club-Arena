# holdemTurnFacingBetAfterCheckedFlopIsPeoplePriced: Authority For The Live Switch

**Evidence NOT MET (2026-11-28, build v2): every chip bar passed, the real-node bar failed.** Value-only turn stabber 0.00 (0 deals of 16,000 changed; cap -3.0); people-calibrated turn stabber pooled -0.07 +/- 0.12 bb/100 (-0.5 SE; bar -1 SE); league mirror heads-up -1.30 +/- 2.13, 6-max -0.01 +/- 0.17 (four seeds; bar -2 SE); the delayed-stab bluffer that gives the river up goes from +2.46 to -0.28 +/- 0.25 bb per line and the turn-and-river barreller from +2.97 to -0.77 +/- 0.31 (both bars: not above zero by 2 SE). FAILED: on 150 real recorded Horse decisions facing a person's heads-up turn stab after a checked flop, a zero-equity stab still wins +1.84 +/- 0.55 bb per bet against the option (+3.3 SE; inside its limped and single-raised scope +0.87 +/- 0.42, +2.1 SE): the 0.7 to 1.1 pot stab of a person with no record is folded to 77% of the time against a 48% break-even, because people's cell for that size holds 10 bets and the price falls back to the equilibrium anchor. A first encounter with the bluffer is not fixed (+3.89 to +3.84 bb per line). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`. Built 2026-11-28 by PLO-OWNER lead-10 lane nlt (session 01Gw7aDr) on the owner's order of 2026-11-27 4:50 PM Chicago ("all overfolding fixes for PLO4, PLO5, and No Limit").

**State: OFF** (release default: no switch row; never switched).

Owner orders it rests on: no blanket rules, every threshold is a price; of 2026-11-26 12:21 PM Chicago, "the stats need to be used against human players, not horses": the opponent's own record, then the people-only population, then the equilibrium anchor; zero unshown hole cards; floating a street is right only when the Horse will continue later, and calling and then folding to every later barrel must stop.

## The Defect It Answers

NLH cash (tables and Lightning), 2026-10-28 to 2026-11-27, public actions only, a person's first bet of a heads-up turn after a checked-through flop into a Horse: every Horse folded 57.8% of the time where a pure bluff breaks even at 36.3%, +2.26 +/- 0.58 bb per bet (128 bets, 28 bettors). A turn-only call price (lane nlof2 v5, never shipped) left the delayed stab with a river barrel profitable (+3.38 bb per line) because the Horse called the turn and folded the river.

## What It Does

No-limit hold'em cash, table and Lightning (never tournaments, Short Deck, fixed limit, bomb pots, all-in-or-fold tables, two boards), heads-up at the time of the bet, the flop checked through, limped and single-raised pots (`HorseLogic.holdemTurnRiverPlanOnPeople`).

- TURN, facing the turn's FIRST bet, the brain's decision a FOLD: the fold becomes a call when the call is worth more than the fold with the river played to the plan below, his turn shares moved one standard error toward his top fifth (n = people's cell + his own stabs).
- RIVER, facing that bettor's first river bet after the Horse called his stab, the brain's decision a FOLD: the fold becomes a call where the plan calls on the card that came and the bet that was made.

It never folds a call, never raises, and prices nothing facing a raise.

The plan (`HorseHoldemTurnRiverPlan.ts`; exact, every holding and every river card; nothing draws from `fastRandom`):

- His turn range: every holding the board and the Horse's cards leave him, in six regions by where it stands on the turn, weighted by his turn-stab shares: his own stabs of that size (`HorseHoldemBetRead`: shown, mucked at the showdown, given up), against the re-measured between-bettor strength (26.8 pseudo-bets) of people's cell -> people's turn cell (hidden bets counted) -> equilibrium.
- His river barrel on each card: the part of that range whose make-up by river region equals his river bets after his own turn bet (his own shown river bets of that line and size -> people's river cell -> equilibrium, as `holdemRiverFacingBetPriorIsPeopleMeasured` reads them); by Bayes the chance a holding of river region r barrels is proportional to C_r / m_r. His own record of barrels after a called stab moves how often (f = (barrels + 9.5 B) / (spots + 9.5)).
- The Horse's river: facing a barrel, call exactly where the river price clears its error; facing a check, the showdown share against what checks. The Horse's own river bets are not counted.
- A mucked showdown loser is counted over the turn regions of the holdings that lose to the one shown winning hand (each alike), in his record and in people's turn cells; the mucked cards are never read.

Receipts: `holdem_turn_plan_call`, `holdem_turn_plan_fold_stands`, `holdem_turn_plan_own_record_read`, `holdem_turn_plan_unpriced`, and the `holdem_turn_plan_river_*` twins.

Off (absent, false or a truthy non-boolean): nothing here is read; the store keeps learning as it already did for the river option (nothing else reads its new slots).

## Prior anchor

- Baseline: equilibrium, the indifference bluff share `s / (1 + 2 s)` of a bet of `s` pots; a thin people cell reads it.
- Population weight: PEOPLE-ONLY first bets of a heads-up turn after a checked flop (`scripts/ops/holdem-people-facing-bet-prior-fit.mjs`, table v5: the old script on the same inputs reproduces the shipped v4 table exactly; v5 changes only turn cells where a muck was spread); 20 pseudo-bets per level.
- Own record: his own turn stabs of that size (26.8 pseudo-bets, measured), his shown river bets (9.5, measured), his barrels after a called stab (9.5, borrowed from the river measure).
- No unshown cards: cells and the store hold shown cards and public outcomes only; the only hole cards read at a decision are the deciding Horse's own.

## Grades (chips), 2026-11-28

Fixed harness (`server/src/benchmark/HorseGradeHarness.ts`, forked worlds, own stores, built-in same-seed no-op; every no-op arm 0.00 with 0 divergent deals), base = the live switch rows (`l8-harness/opts-live.json`). Lane probes `plo-lead7-01TLQer8/l10-nlt/src` (`grade-nlh.mts`, `ofe-d.mts` from lane nlof2). Bars written before the first grade; seeds are lane nlof2's. ON minus the same-seed no-op, bb/100, 100 bb.

| card                                       | seeds      | v2 result                                                                             | bar            | verdict |
| ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------- | -------------- | ------- |
| value-only turn stabber                    | 211, 212   | 0.00, 0.00 (0 deals changed)                                                          | at least -3.0  | pass    |
| people-calibrated turn stabber             | 211, 212   | -0.03 +/- 0.14, -0.16 +/- 0.23; pooled -0.07 +/- 0.12                                 | at least -1 SE | pass    |
| league mirror heads-up, 8,000 pairs a seed | 311, 312   | -2.45 +/- 3.08, -0.24 +/- 2.95; pooled -1.30 +/- 2.13                                 | at least -2 SE | pass    |
| league mirror 6-max, 4,000 pairs a seed    | 311 to 314 | -0.36 +/- 0.29, +0.47 +/- 0.24, -0.62 +/- 0.93, -0.69 +/- 0.44; pooled -0.01 +/- 0.17 | at least -2 SE | pass    |

Delayed-stab bluffers (seat 0 checks the flop and bets 0.8 pot on the turn with every holding; the bot's zero-equity result per line, seeds 221 + 222 pooled):

| card                                     | lines | off            | on             | turn: every Horse folds, on (break-even 44%) | verdict                         |
| ---------------------------------------- | ----- | -------------- | -------------- | -------------------------------------------- | ------------------------------- |
| gives the river up                       | 2,198 | +2.46 +/- 0.24 | -0.28 +/- 0.25 | 50.9% (78.5% off)                            | pass                            |
| barrels the river (production muck rule) | 2,271 | +2.97          | -0.77 +/- 0.31 | 62.3%; river 22.7% (59.6% off)               | pass                            |
| first encounter: no memory, no record    | 3,178 | +3.89 +/- 0.17 | +3.84 +/- 0.18 | 80.6%                                        | reported (not worse, not fixed) |

Earlier builds of this option (not this code): v1 (no muck spread, no barrel record) failed the give-up bluffer (+1.22 +/- 0.27); v3 (no error margin on either street, re-raised pots in scope) failed the 6-max mirror (-1.10 +/- 0.35, -3.1 SE) and still the real-node bar (+1.22 +/- 0.55, +2.2 SE).

Real recorded nodes (150 Horse decisions facing a person's heads-up turn stab after a checked flop, 30 days; the deciding Horse's own cards; opponent memory and the whole bet-read store as of each decision, 72 h): fold 58.4% to 50.0% (break-even 36.2%); zero-equity stab +2.60 to +1.84 +/- 0.55 bb per bet (FAIL); under 0.4 pot -1.32 +/- 0.60, 0.4 to 0.7 +2.49 +/- 0.89, 0.7 to 1.1 +3.45 +/- 1.08. No decision folds more.

## Replay

The NLH cash audit sets hold no recorded turn fold of this line with the Horse's cards (exact tier needs a showdown); not run for this option.

- Replay: NOT RUN (the NLH cash audit sets hold no exact-tier turn fold facing a stab after a checked flop)

## Speed

Relative cost law: an applicable decision with the option on costs 20.9 times the same decision off on the loaded Mac (4.87 ms against 0.23 ms; limit 40; `aHoldemTurnFacingBetAfterCheckedFlopIsPeoplePriced.law.test.ts`). The compiled-build percentile read was not run.

## Limits

- First encounter is not fixed: against a person with no record the price is people's thin cell shrunk to the anchor, value heavy at 0.7 pot and above.
- The Horse's own river bets are not in the plan (the plan never counts chips it might not win).
- The barrel record's prior strength is borrowed from the river measure.

## Rollback

Set the switch row off (`node scripts/ops/horse-option-switch.mjs set holdemTurnFacingBetAfterCheckedFlopIsPeoplePriced off`).
