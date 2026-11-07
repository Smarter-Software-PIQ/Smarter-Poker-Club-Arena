# Deep stack-offs by depth band (2026-11-07): measured, nothing admitted

Trigger: the 20 biggest horse losses of 2026-11-06 included deep all-ins with
weak hands; 16 of the 20 were tournament or lightning 0.5bb rows at 400-1200bb
effective. Question: should a depth-aware cap be added for (a) NLH one pair
continuing facing a turn or river raise, and (b) preflop stack-offs with KK/QQ
in NLH and AA in PLO5/PLO6?

Answer: no. No cell passes the admission rule of
`server/src/engine/HorseOmahaBigBetCalls.ts` (below zero on both days, CI
clustered by hand, and no format slice with n >= 10 positive on either day),
so no engine code was changed. The 400+ band in particular holds at most 11
decisions per cell per day once heads-up tables and bounty events are
excluded, which cannot support a rule.

## Method

- Decision EV in bb = (net + chips the horse had already invested at the node)
  / bb: the continue's value against folding there, later streets and chops
  included. `adj` (preflop only) repeats it with the all-in-equity net
  (`ca_hand_facts.ev_net`) where the hand went all in.
- 95% CI clustered by hand. Verdict BELOW = the whole CI below zero.
- Depth = effective stack of the confrontation at the deal, min(hero, last
  raiser) of behind + hand total invested, read from the recorded publicNode.
- Excluded everywhere: heads-up tables, bounty / PKO / mystery-bounty events,
  20bb effective or less, bomb pots, run-it-twice hands.
- Day A = 2026-11-05 00:00-24:00 UTC, day B = 2026-11-06 00:00-24:00 UTC.
  2026-11-04 was run as a third, supplementary day for the deep preflop cells
  only; it is not part of the admission rule.
- (a) `scripts/horse-measure/sql/deep-raise-continues.sql`: every NLH horse
  turn/river call, raise or all-in when the street already holds a bet and a
  raise. The 7-card class is computed at the decision (no straight, no flush,
  no trips, exactly one paired rank = one pair, the engine evaluator's
  categories; 40 random rows were checked by hand against the class).
- (b) `scripts/horse-measure/sql/deep-preflop-premiums.sql`: every preflop
  continue facing a 4-bet or more (three or more earlier raises or raising
  all-ins on the street), and every preflop all-in, with KK/QQ (NLH) or two
  or more aces (PLO5/PLO6).

## (a) NLH one pair, continuing facing a turn/river raise

mean bb [95% CI], n

| band    | day A                      | day B                     | verdict |
| ------- | -------------------------- | ------------------------- | ------- |
| <100    | -3.3 [-12.3, 5.8] n 71     | +7.4 [-1.6, 16.5] n 109   | no      |
| 100-200 | +11.5 [-15.1, 38.0] n 74   | +18.5 [-4.0, 41.0] n 68   | no      |
| 200-400 | -17.2 [-39.8, 5.5] n 90    | +23.5 [-15.1, 62.0] n 47  | no      |
| 400+    | +11.6 [-142.9, 166.1] n 11 | -57.3 [-243.8, 129.2] n 5 | no      |

Sub-classes at 200+ (day A / day B): overpair 200-400 -2.6 n 21 / +33.4 n 13;
top pair 200-400 -29.9 [-60.3, 0.4] n 40 / +32.4 [-14.5, 79.4] n 22; top pair
400+ -116.9 n 5 / +31.2 n 3. Lightning 200-400 -18.1 n 71 / +29.8 n 32. Raises
(not calls) 200-400 -118.1 [-177.5, -58.8] n 7 / +228.0 n 3. Nothing is below
zero on both days.

Strongest neighbouring signal (outside the requested cell, not implemented):
two pair through a paired board (the V61/V66/V67 bluff-catch class, e.g. QQ on
J-J), 200-400bb: day A -45.8 [-73.2, -18.3] n 62, day B -50.0 [-72.4, -27.7]
n 22. It fails the admission rule as measured: the day A cash slice is +11.9
(n 10). The turn-only slice is -56.2 n 49 / -46.3 n 18. A follow-up should
measure it with its own two fresh days before any rule.

## (b) Preflop premiums facing a 4-bet or more, and every preflop all-in

`vs4bet+` = any continue (call, 5-bet, jam) facing three or more raises.

| hand / spot     | band    | day A                       | day B                       | verdict          |
| --------------- | ------- | --------------------------- | --------------------------- | ---------------- |
| NLH KK vs4bet+  | 200-400 | -82.4 [-164.4, -0.4] n 21   | +18.0 [-110.4, 146.3] n 15  | no               |
| NLH KK vs4bet+  | 400+    | -786.6 n 1                  | -418.4 n 1                  | insufficient     |
| NLH KK vs5bet+  | 200-400 | -188.0 [-243.5, -132.6] n 9 | +92.1 [-94.2, 278.3] n 7    | no               |
| NLH KK all-in   | 200-400 | -82.4 [-164.4, -0.4] n 21   | +46.5 [-77.7, 170.6] n 14   | no               |
| NLH QQ vs4bet+  | 100-200 | -42.4 [-93.3, 8.6] n 14     | -6.0 [-67.9, 56.0] n 23     | no               |
| NLH QQ vs4bet+  | 200-400 | -66.1 [-151.5, 19.3] n 15   | -148.0 [-260.7, -35.2] n 9  | no (A straddles) |
| NLH QQ vs4bet+  | 400+    | -461.6 n 1                  | none                        | insufficient     |
| NLH QQ vs5bet+  | 200-400 | -130.6 [-224.4, -36.9] n 9  | -93.2 [-319.7, 133.4] n 4   | no (B straddles) |
| NLH QQ all-in   | 200-400 | -107.2 [-269.4, 55.1] n 5   | -229.5 [-323.6, -135.5] n 4 | no               |
| PLO5 AA vs4bet+ | 200-400 | +12.6 [-64.4, 89.6] n 25    | +270.5 n 1                  | no               |
| PLO5 AA 5-bet   | 200-400 | -131.4 [-220.4, -42.3] n 10 | none                        | insufficient (B) |
| PLO5 AA vs4bet+ | 400+    | -500.0 n 2 (1 hand)         | none                        | insufficient     |
| PLO6 AA vs4bet+ | 200-400 | +8.5 [-37.9, 54.9] n 29     | -60.3 [-136.2, 15.6] n 12   | no               |
| PLO6 AA vs4bet+ | 400+    | +103.1 [48.6, 157.6] n 9    | +130.6 n 4 (1 hand)         | no (wins)        |

Below 200bb every one of these cells is at or above zero on at least one day
(KK <100 vs4bet+ +12.0 / +16.6; PLO5 AA <100 +37.6 / +26.0; PLO6 AA <100
+25.4 / +48.1). The all-in-adjusted means agree in sign with the realized
means in every cell above except PLO5 AA 200-400 day A (+12.6 realized, -5.5
adjusted) and PLO6 AA 200-400 day B (-60.3 realized, +31.1 adjusted).

Supplementary day 2026-11-04 (not part of the rule): NLH QQ vs4bet+ 200-400
-92.8 [-185.1, -0.5] n 19, 400+ +28.5 n 6; NLH KK vs4bet+ 200-400 +20.9 n 35,
400+ +272.8 n 4; PLO5 AA vs4bet+ 400+ -135.4 n 7; PLO6 AA 400+ -1.1 n 15.
NLH QQ facing a 4-bet at 200-400bb is negative on all three days (means -66,
-148, -93) with the CI below zero on two of them. It is the candidate to
re-measure on two fresh days; under the rule it is not admitted today.

## The four example hands

Each decision was rebuilt from the recorded publicNode and replayed with
`HorseLogic.decide` over 40 seeds for the live hybrid profile and every base
style (`HorseComplaintReplay`), on this tree (aae49728f). Line numbers are this
tree's.

1. **3361178**, NLH QQ, tournament (a PKO, so outside the measured population),
   about 504bb. Flop: QQ bets 9-5-J, faces a raise, calls 40/40 every profile:
   `HorseLogic.ts:12853` (the V38 EV call; V66 fired and its shade was taken
   off the equity at :12797, still a call). Turn: bets 40/40 (final layer
   `holdemPremiumAggression`, receipt `holdem_premium_postflop_bet`,
   `HorseLogic.ts:4123`). River on 9-5-J-6-J: bets 40/40 (35 sized, 5 all in);
   the legacy GTO cell was served beyond its depth ceiling
   (`gto_served_beyond_depth_ceiling`, `HorseLogic.ts:10355`; the opt-in skip
   `v33DepthCeiling` at :10353 is off by default). Facing the jam it calls
   40/40 at 7,409 into 43,234 (needs 14.6%): `HorseLogic.ts:11783`, the
   committed branch with the V67 price, correct by price. At the river the
   hand is two pair through the board, not one pair.
2. **3369931**, NLH KK, lightning 0.5bb, about 430bb at the deal (394bb
   effective against the raiser on the turn). Turn: KK bets, is raised 1.3x
   pot, calls 40/40 every profile: `HorseLogic.ts:11783`, the V66 committed
   branch (V66 recomputes the post-call SPR at :11643-11648; it is 0.81, so
   the hand is "committed" and calls at the shaded price). River 4-9-T-3-2:
   KK leads 40/40 (about 250bb, 10 of 40 seeds all in): the river lead
   (`river_lead_value_pass`, `HorseLogic.ts:10486`) and the final layer
   `holdemPremiumAggression` (:4123) turning some leads into the jam.
3. **3376090**, NLH KK, lightning 0.5bb, 428bb, facing a 4-bet. The live
   hybrid cash profile FOLDS 40/40 on this tree (`HorsePreflop.ts:2169`, the
   5-bet-pot branch's fold). lag jams 40/40 at `HorsePreflop.ts:2085` (the
   value 4-bet branch: `raises >= 3` jams; the V21 deepT relief window is
   capped at +0.05 and KK sits above it). balanced and tricky reach the call
   at `HorsePreflop.ts:2167` and the final layer converts it to a jam:
   `HorseHoldemPremiumAggression.ts:636` (`premiumRaise`, "AA/KK over a 4-bet:
   get it in", no depth term; in cash nothing downstream re-checks depth,
   `tournamentShoveDiscipline` only runs in tournaments). The recorded jam
   came from a profile or engine build that is not today's hybrid.
4. **3359936**, PLO6 AAKQ32 double-suited, tournament, villain about 590bb.
   Facing the 5-bet the horse pots to 52,685 (villain's 29,432 is all in) in
   40/40 seeds, every profile: `HorsePreflop.ts:1090`, the V25 PLO commitment
   zone (facing action, pot raise). The zone reads `commitRatio` against
   HERO's own stack (one pot raise is 100% of it), never the effective stack.
   Measured, PLO6 AA continuing facing a 4-bet at 400+ wins (+103.1 n 9 day A).

## What would change the verdict

The deep bands are thin because the excluded bounty events and heads-up
tables hold much of the deep play, and lightning tables are 200-450bb. A
rule for 400+ needs either many more days per side or a pooled 200+ band
fixed in advance. The two cells to re-measure first: NLH QQ facing a 4-bet at
200-400bb (negative on all three days measured), and NLH two pair through a
paired board continuing facing a turn/river raise at 200-400bb (negative on
both days, one positive cash slice).
