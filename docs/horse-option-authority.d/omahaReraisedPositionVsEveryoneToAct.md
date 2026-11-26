# omahaReraisedPositionVsEveryoneToAct: Authority For The Live Switch

PLO lead-7, lane plo-preflop, 2026-11-26. Evidence NOT MET for PLO4 (league mirror lost chips, see below); for PLO5 the grades below passed (real-hand replay 2 fixed / 0 newly wrong, mirror neutral, no probe lost), but the committed scorer row has not been recorded, so this file does not claim the switch-on bar. If it is ever switched on, it is to be confined to PLO5 with `horse.omahaGameScope.omahaReraisedPositionVsEveryoneToAct = 5`.

## What It Does

The priced call of a 3-bet or more in PLO4/PLO5 cash (`omahaReraisedCallPricingOf`, read by the out-of-position re-raised-pot call cell of `omahaOopReraisedPotStrongRange`, which is live) took its realization's position as `ipVsRaiser`: the Horse acts after the re-raiser, and nothing else. A big blind behind a small-blind 3-bet with the opener still to act was therefore priced with the in-position realization, although the opener, whenever he continues, acts after him on every later street. The audit (HAND-AUDIT-PLO) found 13 of 27 fold-best out-of-position multiway calls of a 3-bet priced in position (receipt `omaha_reraised_call_priced_in_position`).

With the option on, in a PLO4/PLO5 cash table hand (`omahaNoCategoricalRulesInScope`; never Lightning, tournaments, PLO6, hi-lo, bomb pots, multi-board) and the Horse in position against the re-raiser, the priced call's realization is weighted by the chance the Horse plays the flop out of position:

- a player already in for the price who acts after the Horse on later streets: weight 1;
- otherwise 1 - prod(1 - c_j) over the players still to act who act after the Horse, where c_j is that player's chance to continue: his own decayed fold-to-3-bet record against an anchored prior (`omahaReraisedPendingContinue`);
- nobody acts after the Horse: the pricing is exactly the one without the option.

R = w x R(out of position) + (1 - w) x R(in position), with the existing measured realization (`omahaReraisedCallRealization`). Every other input of the priced call is unchanged. It only moves the price of a call; on 600 generated hands of the audited shape a decision only ever moved from call to fold.

A first version took any player still to act as certain (w = 1). It lost chips in the league mirror (inverse-variance -0.92 bb/100, SE 0.40) and was replaced: a player still to act folds to a 3-bet and a call about half the time (the F-02 measurement had found no charge for him), so certainty over-priced the out-of-position side.

## Prior anchor

- Baseline: an opener facing a pot-sized re-raise with a caller in continues at the break-even complement of a no-equity re-raise, about one half (0.50 PLO4, 0.52 PLO5); a player who has not raised and faces a re-raise cold continues 0.20 (PLO4) / 0.25 (PLO5).
- Population weight: the measured population (2026-11-17..24, 58,681 PLO4/PLO5/NLH cash hands with two or more preflop raises, public actions only: openers facing a squeeze fold 49-56%, callers 66-79%) is mostly Horses, who over-fold re-raised pots; it only shapes the prior and is held to the break-even side, worth RERAISED_PENDING_PRIOR_MASS (8) opportunities.
- Own record: each player's own decayed fold-to-3-bet record (HorseMind.currentExploitCounters) outweighs the prior once it has more than 8 opportunities.
- No unshown cards: nothing here reads a hole card; the prior and the grade used public actions and the Horses' own cards in self-play or in a replay of their own decisions.

## What Was Measured

Live options: fn_ca_horse_option_switch_effective() at 2026-11-26 05:40Z plus runtime settings v13. Lane folder: /Volumes/SmarterWork/agent-work/shared-capacity/plo-lead7-01TLQer8/plo-preflop (BUILD.md, j1/).

Real audited decisions (HAND-AUDIT-PLO tier A, the deciding Horse's cards shown at showdown; 991 preflop decisions facing a raise in 1,064 hands, decisions.csv and the 2026-11-25 daily; five seeds; scripts/real.ts, scripts/grade_real.py):

| read                                | changed | fixed                  | newly wrong |
| ----------------------------------- | ------- | ---------------------- | ----------- |
| the people's durable reads imported | 2       | 2 (e2a563a7, af1c2328) | 0           |
| no read                             | 2       | 2 (e2a563a7, 92a28132) | 0           |

All changed hands are PLO5. The audit's listed Horse strengths (strength-hands.json, every Horse decision with shown cards, three seeds): preflop 684, flop 417, turn 228, river 108, all identical.

League mirror, live options ON against OFF, duplicate pairs (scripts/mirror.mts = HorseLeague.runMatchup), bb/100 of ON:

| card                 | hands  | ON - OFF bb/100 (SE)        | pairs that differ                    |
| -------------------- | ------ | --------------------------- | ------------------------------------ |
| PLO5 6-max 100 bb    | 12,000 | +0.21 (0.21)                | 26                                   |
| PLO5 6-max 300 bb    | 12,000 | -2.70 (1.72)                | 56                                   |
| PLO5 3-handed 100 bb | 12,000 | 0.00 (0.00)                 | 0                                    |
| PLO5 heads-up 100 bb | 6,000  | 0.00 (0.00)                 | 0 (heads-up the test is the old one) |
| PLO4 6-max 100 bb    | 12,000 | -0.77 (0.52)                | 34                                   |
| PLO4 6-max 300 bb    | 12,000 | -0.92 (0.47)                | 32                                   |
| PLO4 3-handed 100 bb | 12,000 | -1.12 (1.12)                | 1                                    |
| PLO5 pooled          |        | +0.17 (0.21)                |                                      |
| PLO4 pooled          |        | -0.88 (0.34), z -2.6: FAILS |                                      |

Exploit probes, PLO5 100 bb, one scripted seat against Horses all ON or all OFF on the same deals (scripts/probe.mts), Horse bb/100 ON - OFF (SE): (a) 3-bets every single raise: 3 seats -18.5 (30.0), 6 seats +62.0 (42.6); (b) 3-bets only the top 4%: +5.2 (6.3), 0.0 (0.0); (c) 4-bets every 3-bet of its open: -4.4 (6.0), +0.3 (0.3); (d) calls everything preflop: -3.5 (9.3), -3.8 (7.4). No significant loss.

Speed (scripts/speed1.ts, HorseLogic.decide, 600 spots where the position input changes, 100/300/800 bb, PLO4 and PLO5): ON p50 0.23 / p95 1.23 / max 2.82 ms, none over 50 ms; OFF p50 0.22 / p95 1.23 / max 2.75 ms. Relative-cost law in the law test.

## Receipts

None new: the option changes an input of the priced call, not its path. The existing `omaha_reraised_call_priced_*` receipts carry the verdicts.

## Tests

`server/src/engine/HorseOmahaReraisedPositionVsEveryone.law.test.ts`, `server/src/engine/HorseOmahaReraisedPositionVsEveryone.realHands.law.test.ts` (fixture of three audited hands, neutral ids, only the deciding Horse's shown cards).

## League Card

`plo4_omaha_reraised_position_vs_everyone_to_act`, `plo5_omaha_reraised_position_vs_everyone_to_act` (HorseLeague.ts).

## Replay

- Replay: NOT RUN (the committed scorer, server/scripts/audited-decision-replay.ts --row, was not run; the lane's own real-hand replay of 991 audited decisions is reported above in prose)
