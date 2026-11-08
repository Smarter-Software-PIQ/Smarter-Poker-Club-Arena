# V15 river raise gate: scope evidence (2026-11-07)

PR #9943 removed the V15 gate's near-lock escape (`eq15 - dominationPenalty

> = 0.85`) on the river for every non-nut-class Omaha flush and straight. This
> note records the pre-activation review that narrowed it to the class hand
> 3374459 demonstrated, and the evidence for every class the unscoped rule
> reached.

## Which hands the unscoped rule reached

The gate sits inside the value-raise branch of the facing-a-bet path
(`server/src/engine/HorseLogic.ts`, `riverNoNearLock15`), after the hi-lo
quarter flat and the V8 river straight flat (`useDraws && isRiver && cat < 6
&& equity < 0.85`). It only ever replaces a raise with a call; it never runs
when the horse faces no wager (the checked-to branch returns first).

`nutClass15` is full house or better (minus V15-boats dominated boats), the
nut flush on an unpaired board (`higherFlushRanks === 0 && !boardPaired15`),
or the nut straight on a board without three of a suit (`straightIsNut &&
!boardMono15`). `omahaNutStatus` (`server/src/engine/HorseEval.ts`):

- `higherFlushRanks` counts the ranks above hero's highest card of the flush
  suit that are on neither the board nor hero's own cards of that suit. Hero's
  own cards cannot block a higher rank (the top suited card is by definition
  the highest), so the count is exact for blockers; it ignores straight
  flushes (a nut flush can lose to one, a non-nut flush is not promoted by it).
- `straightIsNut` compares hero's straight top with the best straight any two
  hole cards could make; it ignores blockers and flushes (boardMono15 demotes).
- A board with a pair demotes every flush; a board with three of a suit
  demotes every straight. Paired-board nut straights stay nut-class.

So the unscoped river rule reached: non-nut flushes on an unpaired board
(second-nut and worse), every flush on a paired board (the nut flush
included), non-nut straights (only those whose raw equity is 0.85 or more,
the V8 flat catches the rest), nut and non-nut straights on a three-flush
board, in every Omaha variant (PLO4, PLO5, PLO6, PLO8, FLO8), cash and
tournament, bomb pots and multi-board pots alike.

## Method

The horses' own river decisions facing a wager that ended in a call or a
raise (a raise, or an all-in above the current bet), PLO4 / PLO5 / PLO6 /
PLO8 / FLO8, `hand_history` + `ca_hand_facts`, every hand kept, classified at
the decision with `pg_temp.v15cls`, a re-implementation of `omahaNutStatus`
checked against the TypeScript evaluator on 155 real river hands (155 of 155
agree). Decision EV = (net + chips already invested at the node) / bb, the
V81 measure: the action's value against folding. 95% CIs clustered by hand.
Raise cells use the FIRST river raise facing a wager (the horse had not bet
or raised this river), bomb pots apart. Query:
`scripts/horse-measure/sql/omaha-river-raises.sql`. Day A = 2026-11-05 UTC,
day B = 2026-11-06 UTC; the old (escape-on) rule was live both days.

What this can measure is raise against fold. It can NOT measure raise
against call: a call's result depends on how the bettor answers a call,
which a raise replaced. A raise that wins against folding can still be worse
than calling (it is called only by better hands and folds out worse ones).

## Results (raise EV vs fold, bb: mean [95% CI] n)

| class (as the gate reads it)             | day A                   | day B                  | raises / calls A | raises / calls B |
| ---------------------------------------- | ----------------------- | ---------------------- | ---------------- | ---------------- |
| flush, 2nd nut, unpaired (DEMONSTRATED)  | -31.5 [-82.7, 19.6] 28  | -32.3 [-85.8, 21.2] 20 | 28 / 239         | 20 / 112         |
| flush, 3rd nut or worse, unpaired (in)   | +12.8 [8.3, 17.3] 18    | +7.4 [4.5, 10.4] 12    | 18 / 407         | 12 / 273         |
| flush, nut, paired board                 | -31.4 [-122.6, 59.8] 5  | +31.0 [9.6, 52.4] 3    | 5 / 79           | 3 / 61           |
| flush, 2nd nut, paired board             | no raises               | no raises              | 0 / 64           | 0 / 51           |
| flush, 3rd nut or worse, paired board    | no raises               | no raises              | 0 / 157          | 0 / 109          |
| straight, not the nut (no flush board)   | +15.3 [8.2, 22.3] 16    | +9.6 [5.4, 13.8] 11    | 16 / 492         | 11 / 345         |
| straight, not the nut, paired board      | no raises               | no raises              | 0 / 86           | 0 / 81           |
| straight, not the nut, three-flush board | no raises               | no raises              | 0 / 145          | 0 / 110          |
| straight, nut, three-flush board         | no raises               | no raises              | 0 / 188          | 0 / 123          |
| control: nut flush, unpaired (nut-class) | +110.2 [88.3, 132.1] 99 | +75.3 [47.3, 103.2] 65 | 99 / 19          | 65 / 15          |
| control: nut straight (nut-class)        | +41.5 [33.9, 49.2] 334  | not printed            | 334 / 187        | 173 / 94         |

Slices of the demonstrated class (A / B):

- wager >= 0.8 pot: -107.2 [-211.4, -2.9] n 12 / -65.9 [-179.1, 47.3] n 9
- wager < 0.8 pot: +25.2 [6.8, 43.5] n 16 / -4.8 [-34.2, 24.6] n 11
- cash: -95.2 [-206.8, 16.4] n 12 / -73.4 [-164.6, 17.8] n 11
- tournament: +16.2 [11.5, 21.0] n 16 / +18.0 [3.1, 32.8] n 9
- PLO4 +6.6 n 17 / -60.4 n 12; PLO5 -70.7 n 5 / +26.7 n 4; PLO6 -163.9 n 4 /
  -16.1 n 2; FLO8 +7.0 n 2 / +2.1 n 2

The 3rd-nut-or-worse raises were all against wagers under 0.8 pot (the V15
equity cap already stops them against big river bets). Re-raises (the horse
had already bet or raised the river) and bomb-pot raises: none in any class
above on either day. Multi-board pots: no non-bomb river raises.

"How often the class reaches the escape" is read as raises / (raises +
calls): demonstrated class 10.5% (A) and 15.2% (B), 3rd-nut-or-worse
unpaired 4.2% and 4.2%, non-nut straights 3.1% and 3.1%, paired-board nut
flush 6.0% and 4.7%, every other class 0. A raise could also come from a
raise branch outside the value branch, so these are upper bounds on the
escape itself.

## Decision

Admission rule for any class beyond the demonstrated one (V81's, with V84's
floor): below zero on both days, no variant or format slice with n >= 10
positive on either day, and at least 10 hands per day. No class qualifies:
non-nut straights are positive on both days, the paired-board nut flush has
5 and 3 raises, every other class has none. So the river rule is narrowed
to the demonstrated class only: a flush with `higherFlushRanks >= 1` on an
unpaired board, in a high-only (not PLO8 / FLO8), single-board game. Hi-lo
is left out because there the raise is priced on the low half and the
quarter read, which the demonstrated hand did not exercise; multi-board
because the class is read from the first board only.

The demonstrated class itself would not pass the admission rule (its
tournament slice is positive, n 16 on day A). It stays in on the owner's
instruction to correct the demonstrated defect: the equity read for this
class on the river is structurally unreliable (0.91-1.00 against a
pot-sized bet in hand 3374459), and its pot-sized slice is the losing one
(-107.2 and -65.9). The positive small-wager and tournament slices are
raise against fold; the gate replaces those raises with calls, which keep
most of that value.

## Downstream interactions (exactly as for any call)

- PLO5 second-nut flush calling a >= 0.9-pot river wager: V81's measured
  cell folds the call (`omahaBigBetCallFold`), so in that spot the old raise
  becomes a fold. V81 measured those calls at -39.0 / -58.5 bb.
- PLO6: `plo6RiverNutDiscipline` (V59 on an unpaired board) applies its
  fold line to the call as it applied it to the raise; its raise-to-call
  line simply has no raise left to flat.
- All-in to call, an all-in-or-fold table, a menu without call and fixed
  limit: see the legality tests in
  `server/src/engine/HorseV15RiverRaiseGate.test.ts` (every answer is
  accepted by a real HandController, in both arms).
