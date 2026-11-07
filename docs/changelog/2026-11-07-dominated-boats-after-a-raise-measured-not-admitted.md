# Dominated full houses after a raise: measured, not admitted (2026-11-07)

## Question

Should the V15 boat gate (`v15BoatsOn`, `server/src/engine/HorseLogic.ts`),
default ON only in PLO5 cash, be turned on for more variants and formats, and
should a call-side rule (fold a dominated boat to a raise) be added? The
prompt was the `plo_underfull_stackoff` review tag (about 9.4 per 1,000 PLO
review rows on 11-06 and 11-07, mean about -230bb per tagged hand) and six of
the twenty biggest 11-06 losses.

## Method

The V81 decision-EV method and its two-day admission rule
(`server/src/engine/HorseOmahaBigBetCalls.ts` header). Every horse PLO decision
on the flop, turn or river that faces a raise after the horse bet or raised the
same street (the engine's `raisedAfterAggr` read), with a full house at the
decision, from `hand_history` actions (publicNode at the decision) joined to
`ca_hand_facts` (net, hole cards). EV is continuing against folding at the
node: (net + chips already invested) / bb. Classified with the engine's own
`omahaNutStatus` (category 7), `omahaBoatsAbove` and `omahaBoatDominated`;
95% CIs clustered by hand. Excluded as V81 excluded: tables dealt two or fewer,
bounty events, 20bb or less behind.

- SQL: `scripts/horse-measure/sql/omaha-boat-raised.sql` (read only, run in
  6-hour slices through `execute_sql`).
- Classifier: `scripts/horse-measure/omaha-boat-cells.ts`.
- Raw slices: `docs/horse-measure/2026-11-07/boat-raised/`; every cell:
  `docs/horse-measure/2026-11-07/boat-raised-cells.txt`.
- Day A: 2026-11-06 00:00 to 24:00 UTC. Day B: 2026-11-07 00:00 to 19:00 UTC.

Coverage: 740 decisions, 719 full houses at the decision, 540 of them
dominated, 203 excluded (mostly heads-up tournament tables). Kept: 377
dominated continuations (190 A, 187 B) and 138 effective-nut ones. Horses
folded a full house to a raise once in two days.

## Result: no cell passes

Dominated boat, any continuation, mean bb [95% CI] (n):

| cell        | day A                    | day B                    |
| ----------- | ------------------------ | ------------------------ |
| all         | +52.9 [+0.6, +105.2] 190 | -9.7 [-44.4, +25.1] 187  |
| PLO4 cash   | +42.6 [-27.2, +112.4] 10 | +6.8 [-53.0, +66.7] 9    |
| PLO4 light. | +48.2 [+3.5, +92.8] 84   | -15.3 [-67.8, +37.2] 110 |
| PLO4 tour.  | +224.7 [-176, +626] 11   | +23.9 2                  |
| PLO5 cash   | +89.3 [+24.5, +154.0] 22 | -14.8 [-99.3, +69.7] 22  |
| PLO5 tour.  | +23.0 [+0.4, +45.6] 16   | -44.4 2                  |
| PLO6 cash   | -5.0 [-54.1, +44.1] 37   | +4.4 [-55.2, +64.0] 39   |
| PLO6 tour.  | +95.9 [-690, +882] 10    | +1.3 3                   |

PLO8 (hi-lo) had eight rows; none is a kept full house (quads at the
decision, or a bounty event). Split by
continuation, calling a raise with a dominated boat was positive on both days
(+58.1 n 85, +35.4 n 103); raising or jamming was +48.7 (n 105) then -64.9
(n 84). No variant x format cell is negative on both days, so nothing is
admitted: `v15BoatsOn` stays PLO5-cash-only and no call-side rule is added.
No engine code changed.

Watch items for a third day (not admitted, both straddle zero on day A):
flop continuations in PLO4 lightning (-28.1 n 24, then -298.4 n 14), and an
exploratory depth tier picked after seeing the data, three or more bigger
two-rank boats live (`dom_deep`): PLO4 lightning -54.6 [-124.6, +15.4] n 30,
then -133.9 [-202.9, -64.9] n 28.

## Why the tag looked like a leak

`horse_hand_reviews` keeps only hands with |net| >= 20bb and the tag is
assigned to losing hands, so its mean is selected on the outcome; it is not a
decision EV. The same population measured at the decision wins on average,
because the range that raises a horse's boat holds trips, smaller boats and
draws as well as the bigger boat. 3363822 (AAA77, beaten only by quads) is a
cooler: `omahaBoatDominated` is false there (quads reachable by one holding).

## What the gate misses, read from the code and replayed through decide()

Replayed over 60 seeds each:

- 3358357 (PLO5 tournament, K7 7K T on JJJ, facing 814 after betting 168):
  today raise 51 / call 9; `v15Boats: true` call 60 / 60 (`v15_boat_gate`
  60). As PLO5 cash (default on): call 60 / 60.
- 3374180 (PLO4 lightning, TT on TK787, facing a raise for more than its
  stack): all-in call 60 / 60 with the gate off or on. With 600 behind instead,
  today call 18 / jam 42, on call 60 / 60.
- 3368037 (PLO4 lightning, JJ on KJK flop, facing a raise after betting):
  today call 25 / jam 17 / raise 18; on call 60 / 60. The hand was lost on
  the turn, where the villain bet and the horse jammed: no own aggression that
  street, so `raisedAfterAggr` is false and the gate cannot apply.

Structural reasons, all in `HorseLogic.ts`:

1. The gate converts a raise into a call; it never folds. Both sites return
   `call` (the committed branch at line 11825, `preferFlat15` at 11806; the
   value-raise branch at 11968, inside `else if (eq15 >= valueRaiseThresh)`
   at 11942).
2. A call-off for less than the price (`toCall >= stack`, line 11825) is a
   call whatever the gate says, so the biggest losses (river all-in calls) are
   untouched by it.
3. `raisedAfterAggr` (lines 8762-8787) is per street: a horse that bets the
   flop, is raised, calls, and then faces a turn bet is outside it.
4. Full houses never get the V15 domination penalty or equity cap (lines
   11214-11243 cover categories 5 and 6 only), so the call / fold decision of
   a dominated boat uses Monte Carlo equity against random holdings.
5. `boatDominated15` is computed only when `v15BoatsOn` (line 8692), so
   outside PLO5 cash the telemetry cannot see these spots; the
   river-trips-board flat (`tripBoardDominatedBoat15`, line 8706) is river
   only.

Points 1, 2 and 4 are the call side. The measurement says calling a raise
with a dominated boat has been positive on both days, so a fold rule is not
supported by evidence today.

## Limits

Only the horses' own continuations are observed: a raise's EV is raise
against fold, not raise against call, so the value of turning raises into
calls is not measured here. Many of these pots are horse against horse.
PLO5 cash ran with the gate on through both days, so its raises are already
mostly calls. Day B is 19 hours, and hand facts were thin on 11-06 between
09:00 and 12:00 UTC.
