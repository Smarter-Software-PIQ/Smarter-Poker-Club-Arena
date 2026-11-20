# omahaFourBetFoldPricedCall: Authority For The Live Switch

Built 2026-11-20 by EMERG lane PREFLOP-UNCONTESTED (PLO-OWNER lead-2) on the owner's orders of 2026-11-20 ("EVERYTHING DEPENDS ON THE MATH"; the same corrections against all players, human or Horse). Evidence NOT MET under the machine-read replay bar (the audited-decision scorer was not run); the exact journal replay graded PASS under its declared criteria (below). This file does not authorize switching the option on: switches are made only by the lead through the delivery path.

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot (`server/src/engine/HorseOmahaFourBetFoldPricedCall.ts`). The outermost answer of the wager_rules node (after the river current-nuts floor): preflop, after the Horse's own raise, facing a 4-bet or more with every other player folded, the node's final fold becomes the legal call (the whole-stack all-in when the call is the stack) only when the engine's own priced call of a re-raise, `omahaReraisedCallPriced` with the inputs of `omahaReraisedCallPricingOf` (the re-raiser's public re-raise rate read, realization by position and depth, the call deduction for rake), gives EV(call) > 0. It changes only a fold and never raises.

Public information only: the Horse's cards, the action, the pot, the chips behind and the re-raiser's public rate. No account, name or person/Horse flag; PLO6, PLO8, hold'em and tournaments are untouched.

Receipt: `omaha_four_bet_fold_priced_call` (noteFire and the decision rule receipt, before fold, after call). The response validator re-runs the spot and the price on the request and admits wager_rules fold -> call only where it holds, for the exact chips owed.

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only; scopable per game (`horse.omahaGameScope.omahaFourBetFoldPricedCall`).

## What Was Measured

LIVEGRADE-7 duty 5: persons +352 +/- 27 bb/100 in hands ending preflop (Nov 17-19). Split (lane PREFLOP-UNCONTESTED, livegrade raw): persons' 3-bets folded to +1,847 bb, 4-bets or more folded to +1,509, blind steals +176 against Horse steals -134. Horse folds facing a 4-bet after its own raise, heads-up, graded on real cards offline (EV(call) = R x equity vs the re-raiser's actual hand x (pot + call) - call, R measured on the population's calls): +1,302 +/- 138 bb (n 62); without the most frequent re-raiser +346 +/- 50 (n 26, top share 15%); against Horse re-raisers +13.9 +/- 2.4 a fold (n 19). Horse calls in the same spot realized +2,361 +/- 1,429 real bb (n 167).

Criteria CRITERIA-PREFLOP-UNCONTESTED (sha256 b64d90d209a3df78753ad2df8968cf48d5f23b3f5786da6cd242e07c841da817), declared before the replay. Exact journal replay (PROVE/rec Nov 18-19; Nov 19 6:31 PM - Nov 20 2:33 PM journals; decisions facing 6 bb or more), 5,783 decisions, base reproduces 5,775:

| Measure                          | Value                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| Changes                          | 32, all fold -> call, 0 hard flags, 0 errors either arm     |
| Graded vs persons (REAL)         | 11: +132.1 +/- 31.7 bb                                      |
| NET (all re-raisers, 29 graded)  | +294.1 +/- 51.4 bb                                          |
| Most frequent re-raiser excluded | +112.7 +/- 20.7 (n 7)                                       |
| Splits                           | none below -1 SE (day, game, mode, stack-to-pot, re-raiser) |
| Sensitivity: realization 0.7     | -5.7 +/- 20.1 (REAL)                                        |

Verdict PASS. Rollback: its touched group losing beyond 1 SE at n >= 20, or helping against one player only.

- Replay: NOT RUN (the audited-decision scorer was not run; the exact journal replay above is recorded in the EMERG archive, PREFLOP-UNCONTESTED.md)
