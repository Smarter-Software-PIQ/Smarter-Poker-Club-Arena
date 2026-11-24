# omahaReraisedPotCallIsPriced: Authority For The Live Switch

Built 2026-11-24 by the PLO lead-6 re-raised-pot lane (session 01BNteGX) from the decision audit of every PLO4/PLO5 cash hand with a person, Nov 20-24 (4,510 hands; leaks 1-4: calls of a 3-bet or 4-bet, out of position multiway the largest). Evidence NOT MET: it stays OFF until it has been shadowed. The option is registered, default off (read `=== true`), switchable live, PLO4/PLO5 cash only; its companion is `omahaReraisedPotReraiseIsPriced` (docs/horse-option-authority.d/omahaReraisedPotReraiseIsPriced.md). This file does not authorize switching either option on.

## The Owner's Rulings It Enforces

- "Calling 3-bets and 4-bets out of position is a losing play; out of position needs a much stronger range; calling ranges are coordinated hands."
- No blanket rules: every decision is priced by the hand, the opponents and the pot and stacks.
- Nothing keyed on person-vs-Horse identity or on a named player; no unshown hole card read or stored.
- PLO6, tournaments and Hold'em untouched; every option default OFF and switchable live.

## What It Does

PLO4/PLO5 cash (table and Lightning), high only, one board, no bomb pot, not All-In-Or-Fold, preflop, facing a 3-bet or more with a fold available (`server/src/engine/HorseOmahaReraisedPotPricedRule.ts`, price in `HorseOmahaReraisedPotPriced.ts`). It runs outermost in the re-raised-pot rules (`HorseLogic.omahaReraisedPotRulesThenCallVsRaise`, both decision paths), after `omahaOopReraisedPotStrongRange`, `omahaPreflopReraiseDefencePricedInPosition` and the other re-raised-pot rules, and reads only the decision they leave standing:

- a standing CALL stands unless EV(call) < -1% of the pot after the call; then it is a fold;
- a standing FOLD becomes the call when EV(call) > +1% of the pot after the call (an over-fold to a measured wide re-raiser is a leak too);
- with it on, a call the in-position defence (#11594, `omahaPreflopReraiseDefencePricedInPosition`) made of a fold stands only where this price says call, so that defence is no longer a near-always call.

EV(call) = (1 - rho) x SUM over which players behind continue, s: P(s) x [R x equity_s x (pot_s - rake) - call] - rho x call, where

- the FIELD is every live player: the last raiser, every player already in for the price, and every player still to act behind the call (who continues with probability c, re-raises with probability rho_j, or folds). Each subset of continuers is priced on the same joint samples (one holding per player from his range, card removal, a random run-out, ties split);
- POSITION is read against every player in that field: in position only when the Horse acts after all of them. The guard it supersedes (`omahaReraisedPositionOf.ipVsRaiser`) read position against the re-raiser and the players already in only, so a big blind behind a small-blind 3-bet with the opener and a caller still to act was priced "in position" (the audit's OOP multiway calls: the cell's pricing receipt read in position in 13 of 27 replayed fold-best cases);
- R is the self-play realization (below) by role, position, depth and equity; rake is the table's.

## Prior anchor

- Baseline: league self-play of the production brain (live switch rows of 2026-11-24, Hybrid cash, PLO5 6-max 100 bb, 89,427 decisions facing one raise): a 3-bet rate of 0.085, mapped to a range of the top 0.9 x rate (the width at which sampled equity is unbiased against the 3-bettors' actual holdings, 0.08); a caller of a 3-bet holds about 4 times that width, a cold caller behind 2 times; a player behind answers a 3-bet and a call fold 0.533 / call 0.45 / re-raise 0.017, cold fold 0.895 / call 0.082 / re-raise 0.023.
- Population weight: the live population's 3-bet rate (the read envelope's mean) carries 3 pseudo-opportunities against the baseline's 8, a reduced weight because the live population is on the exploitable side of the baseline (people 3-bet 58% of Horse opens in PLO5 and call 4-bets they should fold); no population rate is used for the players behind.
- Own record: the re-raiser's own decayed re-raise record (HorseMind.currentExploitCounters threeBet / threeBetOpp) is added to the 11 prior pseudo-opportunities, so it dominates from about a dozen opportunities; a 4-bettor who opened is read at least as wide as his own continuing share against a 3-bet (his fold-to-3-bet record against the self-play 0.253) times the self-play share of continues that re-raise, raised toward all of them as his fold share falls below the baseline. No per-player record exists for a player behind; his answer is the baseline alone.
- No unshown cards: every fit is on league self-play, where every card belongs to the engine's own simulated players; production supplies only public counters (the read) and, for the evidence below, the deciding Horse's cards where they were shown at showdown.

## Realization (self-play)

PLO5 6-max, 100 bb (40,000 hands) and 300 bb (30,000 hands): 8,108 flops of pots with two or more preflop raises, 17,211 player-flops (`server/scripts/omaha-reraised-pot-priced/selfplay-realization.mts`, `fit-realization.py`). y = chips won - chips put in after the flop, regressed on x = flop-start all-in equity against the others' actual holdings x pot at the flop, with the board's luck removed by a control variate (variance -35%). R = 1 - (DEPTH - SLOPE x (eq - 0.45)) x spr/(spr+3), each coefficient shrunk by max(0, 1 - SE^2/coef^2):

| role, side                 | depth (SE) -> used       | equity slope (SE) -> used |
| -------------------------- | ------------------------ | ------------------------- |
| caller, in position        | -0.121 (0.080) -> -0.068 | 0.43 (0.90) -> 0          |
| caller, out of position    | 0.494 (0.130) -> 0.46    | 2.16 (1.15) -> 1.54       |
| aggressor, in position     | -0.233 (0.183) -> -0.089 | 1.77 (1.41) -> 0.66       |
| aggressor, out of position | 0.179 (0.115) -> 0.105   | 0.70 (0.81) -> 0          |

A caller out of position at a ratio of 5 realizes about 0.71 of an average hand's equity and 0.45 of a weak one's (equity 0.25): the "much stronger range out of position" is the measured price, not a class rule. The extra-player term measured -0.168 (0.095), i.e. multiway pots realizing more; it is not credited (held at 0) because it rests on the self-play field folding multiway postflop.

## The Audit's Flagged Decisions, Priced

The audit's HARD preflop rows with a person (decisions.csv; tier A, the Horse's cards shown): 84 calls of a 3-bet or 4-bet (2,537 bb) and 59 4-bets without the price (330 bb). The audit priced them with heuristic "top X%" ranges and an assumed 0.8/0.9 realization, one street; its best action for the calls was a RE-RAISE in 53 (2,131 bb) and a FOLD in only 31 (406 bb). Re-priced here (hands pulled SELECT-only with hole cards only from showdown entries not mucked; the persons' public read imported, their 4-bet answers included; the price of this option, a pot re-raise as the alternative; a mistake survives when the best action beats the one taken by more than max(1 bb, 5% of the pot)):

| class                    | n         | survive | as                                                                                                                                                     |
| ------------------------ | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| calls of a 3-bet/4-bet   | 81 priced | 63      | 55 "the re-raise beats the call", 8 "the fold beats the call"; 14 calls priced correct                                                                 |
| 4-bets without the price | 59        | 3       | 2 better as a call, 1 as a fold; 54 priced correct (the 3-bettors' wide ranges; their measured fold to a 4-bet is low, but their range is wide enough) |

What made them (replay on main with the person's read, live rows, 5 seeds; 238 of 240 nodes matched, calls reproduced 63 of 82): the preflop engine's maniac-price path proposes the call (`v38_preflop_allin_price`, `omaha_maniac_reraise_width_measured`, `observed_maniac_raiser_seen`) and `omahaOopReraisedPotStrongRange`'s cell keeps it (`omaha_oop_reraised_call_kept`), pricing the out-of-position multiway caller as in position (above). The 4-bets come from V53 pressure against a measured maniac (`v53_pressure_four_bet`, `v53_pressure_three_bet_priced`). `omahaPreflopReraiseDefencePricedInPosition` turned folds into calls in 12 of the in-position heads-up 4-bet replays.

Re-graded with both options on (same replay, person's read): of the 31 "call where fold was best" the Horse still calls 2 (18 on main; 246 bb of reproduced mistakes gone); of the 51 "call where the re-raise was best" it calls 3 (45 on main; 1,468 bb gone; it re-raises instead); the 49 "4-bet where the call was best" are mostly kept (37 on main 18) because this price says the 4-bet is the better action there, against the audit. Against the price itself, the action taken now matches the priced best in 107 of 141 decisions (main 50). Postflop is untouched: the audit's strengths (133 correct in-position heads-up flop, turn and river calls in 119 hands) replayed on and off at 3 seeds, 753 postflop decisions x 3, 0 differences; every changed decision in those hands is preflop facing 2 or more raises.

## Graded In Chips

League mirror, ON (live rows + both options) against OFF (live rows), duplicate pairs on the same seeds, Hybrid cash Horses, sandboxed memory learning on (tmp scripts mirror.mts = HorseLeague.runMatchup; the declared card is `plo4|plo5_omaha_reraised_pot_priced`). bb/100 of ON over OFF:

| game     | seats | depth  | pairs | ON - OFF bb/100 (SE)                                     | pairs that differ |
| -------- | ----- | ------ | ----- | -------------------------------------------------------- | ----------------- |
| PLO5     | 6     | 100 bb | 4,000 | +4.47 (6.71)                                             | 588               |
| PLO5     | 2     | 100 bb | 4,000 | +0.07 (6.98)                                             | 493               |
| PLO5     | 6     | 300 bb | 3,000 | -3.71 (9.99)                                             | 395               |
| PLO5     | 2     | 300 bb | 3,000 | +21.39 (14.18)                                           | 305               |
| PLO4     | 6     | 100 bb | 4,000 | -4.25 (4.61)                                             | 337               |
| all five |       |        |       | inverse-variance -0.29 (3.09); equal-weight +3.60 (4.08) |                   |

0 illegal actions, 0 brain exception fallbacks in every run.

Exploit probes, PLO5 cash 100 bb: one scripted seat against Horses that are all ON or all OFF, the same 4,000 deals, memory learning on (the Horses learn the probe's record); the scripted seat plays the production brain everywhere except its rule. Horse bb/100 (SE):

| probe                                  | seats | Horses ON     | Horses OFF    | ON - OFF      |
| -------------------------------------- | ----- | ------------- | ------------- | ------------- |
| (a) 3-bets every single raise          | 2     | +127.7 (17.7) | +78.3 (22.3)  | +49.5 (20.0)  |
| (a) 3-bets every single raise          | 3     | +297.1 (27.3) | +189.3 (31.7) | +107.8 (30.1) |
| (b) 3-bets only premium hands (top 4%) | 2     | -2.4 (15.1)   | +1.5 (13.1)   | -4.0 (11.2)   |
| (b) 3-bets only premium hands (top 4%) | 3     | -11.5 (16.7)  | -12.1 (15.1)  | +0.7 (10.6)   |
| (c) 4-bets every 3-bet of its open     | 2     | +2.8 (19.5)   | -3.3 (12.7)   | +6.1 (17.5)   |
| (c) 4-bets every 3-bet of its open     | 3     | +41.1 (23.8)  | +3.2 (18.4)   | +37.9 (18.0)  |
| (d) calls everything preflop           | 2     | -0.8 (15.5)   | -8.1 (14.0)   | +7.3 (9.7)    |
| (d) calls everything preflop           | 3     | +7.8 (25.5)   | -2.7 (19.9)   | +10.5 (17.1)  |

Reading. Overall the mirror is a tie (-0.29 +/- 3.09 bb/100 inverse-variance; no cell is 2 SE from zero). The option does not bleed to a habitual 3-bettor: against (a) the Horses win +49.5 (HU) and +107.8 (3-handed) bb/100 more with it on, because his own record widens his read range and the price then calls and 4-bets more. Against (c) a habitual 4-bettor +6.1 and +37.9; (b) and (d) are ties. Scripts: server/scripts/omaha-reraised-pot-priced/mirror.mts and probe.mts (OPTS_FILE = the live decide options).

## Replay

- Replay: NOT RUN (built 2026-11-24; the audited-set scorer was not run; the audit's flagged real decisions were re-priced and replayed ON vs OFF as recorded above)

## Receipts, Tests, Inertness

Receipts: `omaha_reraised_pot_priced_call_kept`, `_call_folded`, `_call_reraised`, `_fold_called`, `_fold_kept`, `_reraise_kept`, `_reraise_called`, `_reraise_folded`, `_failed`. Laws: `HorseOmahaReraisedPotPriced.law.test.ts` (out of position multiway a negative priced call never calls, with the main control; aces continue; a habitual 3-bettor loosens the defence; both off byte-identical; admissions), `.identity.law.test.ts`, `.realHands.law.test.ts` (five audit hands). Response validation admits a fold or re-raise -> the exact call and a call -> the largest legal raise-to only in the rule's own spot re-derived from the request (call -> fold is the PLO fold admission).

Inertness: `bash scripts/ops/horse-flag-off-check.sh origin/main HEAD --set full` (result in the PR).
