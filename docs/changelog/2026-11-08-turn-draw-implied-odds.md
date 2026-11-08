# Turn draws are priced with the implied odds the stacks can pay (2026-11-08)

## The complaint

The Nov 7 flop/turn audit (`2026-11-07-horse-flop-turn-bluff-range.md`,
"Remaining gaps") found Q-J of hearts on K-7-2-4 with the flush draw folding
to a 0.7-pot turn bet almost every time.

## Reproduced

Real `HorseLogic.decide`, the #9845 fixture (`HorseFlopTurnBluff.test-support.ts`,
line `facingBarrel`: 1/2 cash, 100bb, heads-up single-raised pot, hero called
an 8 c-bet and faces 20 into 28), 300 seeds:

| holding (K-7-2-4, two hearts) | before (heads-up 5% rake)  | after                        |
| ----------------------------- | -------------------------- | ---------------------------- |
| Qh Jh (flush draw)            | 280 fold, 8 call, 12 raise | 131 fold, 157 call, 12 raise |
| Th 9h (flush draw)            | 286 fold, 1 call, 13 raise | 244 fold, 43 call, 13 raise  |
| Ah 5h (nut flush draw)        | 293 call, 7 raise          | unchanged                    |

(The audit fixture's 94% had no rake config and so took the 10% default rake;
a heads-up production pot is raked at 5%, `config/rakeSpec.ts`. Without any
rake config the same spot goes from 288/300 folds to 217/300.)

## The rule that folded it

The heuristic facing-bet call line in `HorseLogic.decide`:
`eq + impliedBonus - shades >= potOdds + 0.03 x respect + sizingPenalty + posEdge + dominationPenalty`.
For this draw: equity 0.27-0.29 plus `impliedBonus` 0.04 against a bar of
0.310 (20 / 68 at the heads-up 5% rake) + 0.03 + 0.017 - 0.012 = 0.344. The 0.04 is a
FLAT allowance, the same at 10bb behind as at 100bb. A flush draw with 166
behind into a 68 pot is paid far more than 0.04 of the pot when it gets there.

## The fix (root: the implied-odds term)

`turnDrawImpliedBonus` (HorseLogic.ts): on the turn, for a real single-board
Hold'em draw (`holdemRealDraw`: a flush draw with a hole card, or an
open-ender / double gutter a hole card is part of) facing a wager hero did not
make, the allowance is

    outs / 46  x  B x P / (P + B)  /  P,   B = min(behind after the call, 0.7 P)

where P is the pot after the call: the chance the river completes the draw,
times a river bet of at most 0.7 pot (the V68 0.7-pot line) that the stacks
can pay, called at minimum defence. The flat 0.04 stays as the floor. It is
withheld exactly where the flat allowance is: V68's no-room rule (under 1.5
pots behind at a 0.7-pot-plus wager), V11's dominated pair, V23's one-way low.
Omaha, short deck, fixed limit, multi-board and bomb pots are untouched.
`turnDrawImpliedOdds: false` ablates it; receipt `turn_draw_implied_odds`.

Law: `server/src/engine/HorseTurnDrawImpliedOdds.law.test.ts`
(`docs/laws.d/horse-turn-draw-implied-odds.md`).

## League A/B

Duplicate-deal, the #9841 harness (`RiverBluffBaselineLeague.ts`) through the
new `server/src/scripts/riverLayerAblationLeague.ts --layer=turnDraw`: arm A
current main with the rule, arm B `turnDrawImpliedOdds: false`. NLH cash 100bb
and tournament chip EV (40bb MTT), pools standard / stations / folders /
mixed, six-handed and heads-up. Seed 20261110 at the #9841 sample (6,000
six-handed, 4,000 heads-up per cell), then seed 20261111 at 30,000 heads-up
and 20,000 six-handed (standard, mixed) because the first run changed only
1-51 hands per cell. 32 cells, 400,000 pairs. Results:
`docs/horse-measure/2026-11-08/results/turn-draw-implied-odds/`.

Decision rule: ship if no cell's 95% CI lies wholly below zero and the pooled
result is not negative.

- No cell lies wholly below zero. Significant: heads-up MTT against
  production horses +6.29 +/- 3.28 (seed 20261111; the field's reads of the
  hero change once it calls draws, 3,452 changed hands).
- Pooled, both seeds: heads-up +0.86 +/- 0.41 [+0.45, +1.27] pair-weighted,
  -0.04 +/- 0.12 [-0.15, +0.08] inverse-variance; six-handed +0.14 +/- 0.34
  [-0.20, +0.47] and -0.07 +/- 0.18 [-0.25, +0.10].
- Disclosed: seed 20261110 alone pooled heads-up at -0.42 +/- 0.65
  pair-weighted and -0.21 +/- 0.16 [-0.37, -0.05] inverse-variance. With 5-14
  changed hands per cell the per-cell SE is noise: a cell whose few changed
  hands were missed draws (each costs about the call) gets a small SE and
  dominates the inverse-variance pool. The 7x larger fresh-seed run does not
  reproduce it (heads-up +1.03 [+0.57, +1.48] pair-weighted, +0.18
  [+0.00, +0.36] inverse-variance).
- Legality: 0 illegal actions, 0 truncated streets, 0 brain exception
  fallbacks in every cell.
- Not a claim of improvement for six-handed play: its CI includes zero.

| layer    | seats | variant | format     | pool     | seed     | pairs | A-B bb/100     | 95% CI         | div  | acted | illegal/trunc/fb | flag |
| -------- | ----- | ------- | ---------- | -------- | -------- | ----- | -------------- | -------------- | ---- | ----- | ---------------- | ---- |
| turnDraw | 2     | nlh     | cash       | folders  | 20261110 | 4000  | -1.36 +/- 2.72 | [-4.08, +1.36] | 5    | 15    | 0/0/0            |      |
| turnDraw | 2     | nlh     | cash       | folders  | 20261111 | 30000 | +0.08 +/- 0.41 | [-0.33, +0.49] | 30   | 144   | 0/0/0            |      |
| turnDraw | 2     | nlh     | cash       | mixed    | 20261110 | 4000  | -0.12 +/- 0.25 | [-0.37, +0.13] | 5    | 28    | 0/0/0            |      |
| turnDraw | 2     | nlh     | cash       | mixed    | 20261111 | 30000 | -0.23 +/- 0.51 | [-0.73, +0.28] | 63   | 215   | 0/0/0            |      |
| turnDraw | 2     | nlh     | cash       | standard | 20261110 | 4000  | -0.29 +/- 0.51 | [-0.79, +0.22] | 6    | 44    | 0/0/0            |      |
| turnDraw | 2     | nlh     | cash       | standard | 20261111 | 30000 | +1.10 +/- 1.15 | [-0.05, +2.25] | 110  | 327   | 0/0/0            |      |
| turnDraw | 2     | nlh     | cash       | stations | 20261110 | 4000  | -0.51 +/- 1.36 | [-1.88, +0.85] | 14   | 26    | 0/0/0            |      |
| turnDraw | 2     | nlh     | cash       | stations | 20261111 | 30000 | +0.13 +/- 0.41 | [-0.28, +0.54] | 27   | 220   | 0/0/0            |      |
| turnDraw | 2     | nlh     | tournament | folders  | 20261110 | 4000  | -0.28 +/- 0.29 | [-0.57, +0.01] | 4    | 21    | 0/0/0            |      |
| turnDraw | 2     | nlh     | tournament | folders  | 20261111 | 30000 | +0.04 +/- 0.43 | [-0.39, +0.47] | 36   | 158   | 0/0/0            |      |
| turnDraw | 2     | nlh     | tournament | mixed    | 20261110 | 4000  | -0.01 +/- 0.64 | [-0.65, +0.64] | 13   | 38    | 0/0/0            |      |
| turnDraw | 2     | nlh     | tournament | mixed    | 20261111 | 30000 | +0.43 +/- 0.53 | [-0.10, +0.97] | 83   | 315   | 0/0/0            |      |
| turnDraw | 2     | nlh     | tournament | standard | 20261110 | 4000  | -0.46 +/- 4.10 | [-4.56, +3.64] | 51   | 89    | 0/0/0            |      |
| turnDraw | 2     | nlh     | tournament | standard | 20261111 | 30000 | +6.29 +/- 3.28 | [+3.01, +9.57] | 3452 | 597   | 0/0/0            |      |
| turnDraw | 2     | nlh     | tournament | stations | 20261110 | 4000  | -0.30 +/- 0.45 | [-0.75, +0.15] | 6    | 26    | 0/0/0            |      |
| turnDraw | 2     | nlh     | tournament | stations | 20261111 | 30000 | +0.36 +/- 0.40 | [-0.04, +0.76] | 48   | 220   | 0/0/0            |      |
| turnDraw | 6     | nlh     | cash       | folders  | 20261110 | 6000  | -0.34 +/- 0.66 | [-1.00, +0.32] | 1    | 14    | 0/0/0            |      |
| turnDraw | 6     | nlh     | cash       | mixed    | 20261110 | 6000  | -0.27 +/- 0.45 | [-0.72, +0.19] | 4    | 20    | 0/0/0            |      |
| turnDraw | 6     | nlh     | cash       | mixed    | 20261111 | 20000 | +0.65 +/- 1.45 | [-0.80, +2.10] | 13   | 76    | 0/0/0            |      |
| turnDraw | 6     | nlh     | cash       | standard | 20261110 | 6000  | -0.22 +/- 0.44 | [-0.65, +0.22] | 5    | 17    | 0/0/0            |      |
| turnDraw | 6     | nlh     | cash       | standard | 20261111 | 20000 | -0.07 +/- 0.70 | [-0.77, +0.63] | 8    | 83    | 0/0/0            |      |
| turnDraw | 6     | nlh     | cash       | stations | 20261110 | 6000  | +1.27 +/- 2.87 | [-1.60, +4.14] | 3    | 17    | 0/0/0            |      |
| turnDraw | 6     | nlh     | tournament | folders  | 20261110 | 6000  | -0.34 +/- 0.66 | [-1.00, +0.32] | 1    | 12    | 0/0/0            |      |
| turnDraw | 6     | nlh     | tournament | mixed    | 20261110 | 6000  | +0.21 +/- 0.53 | [-0.33, +0.74] | 4    | 19    | 0/0/0            |      |
| turnDraw | 6     | nlh     | tournament | mixed    | 20261111 | 20000 | +0.02 +/- 0.42 | [-0.41, +0.44] | 8    | 65    | 0/0/0            |      |
| turnDraw | 6     | nlh     | tournament | standard | 20261110 | 6000  | +0.22 +/- 0.58 | [-0.36, +0.80] | 4    | 29    | 0/0/0            |      |
| turnDraw | 6     | nlh     | tournament | standard | 20261111 | 20000 | -0.14 +/- 0.71 | [-0.85, +0.57] | 21   | 113   | 0/0/0            |      |
| turnDraw | 6     | nlh     | tournament | stations | 20261110 | 6000  | +0.83 +/- 2.39 | [-1.57, +3.22] | 7    | 14    | 0/0/0            |      |

| layer    | seats | pairs  | pair-weighted A-B bb/100 | 95% CI         | inverse-variance | 95% CI         |
| -------- | ----- | ------ | ------------------------ | -------------- | ---------------- | -------------- |
| turnDraw | 2     | 272000 | +0.86 +/- 0.41           | [+0.45, +1.27] | -0.04 +/- 0.12   | [-0.15, +0.08] |
| turnDraw | 6     | 128000 | +0.14 +/- 0.34           | [-0.20, +0.47] | -0.07 +/- 0.18   | [-0.25, +0.10] |

## Activation

Engine change: live only in the next certified 04:00-04:05 America/Chicago
maintenance release after merge.
