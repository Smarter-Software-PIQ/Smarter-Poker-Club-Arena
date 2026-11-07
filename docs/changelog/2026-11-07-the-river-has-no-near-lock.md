# The river has no near-lock: a dominated unpaired-board Omaha flush never raises a river bet (2026-11-07)

## What happened

The completed 2026-11-06 horse audit (the GTO sweep of the 20 biggest losses)
found hand 3374459: plo4 lightning, hero 4d7sQdKs on Ts3c7hJs2s holds the
K-high flush with the As live, raised a pot-sized river bet (21.8 into 21.8,
to 77.51) and then called the re-jam for -456bb. The V15 raise gate
(dominated flushes and straights never raise) has fired since 2026-08-26, so
this read as a regression.

## Root cause

It was not a regression of the code; the gate had a hole from the start.
`server/src/engine/HorseLogic.ts`, the V15 gate inside the value-raise branch:

    (cat === 5 || cat === 6) && !nutClass15 && eq15 - dominationPenalty < 0.85

The last clause is a near-lock escape. Replaying the exact river node over 60
seeds, `eq15` (the Monte Carlo against the bettor's estimated range) read
0.91-1.00 and the domination premium for a second-nut flush is 0.05, so the
escape was taken on every seed and the hand raised 43 of 60 times through the
value-raise branch. A third-nut flush, whose equity read lower, was already
caught, which is why the gate fired at all (900-1,700 times a day).

## The fix

On the river the escape is gone for the demonstrated class: an Omaha flush
with at least one live higher flush rank (`higherFlushRanks >= 1`) on an
unpaired board, in a high-only, single-board game, facing a river wager,
calls. There is nothing left to draw on the river and the hands that pay a
raise are the ones it loses to. Flop and turn keep the near-lock reading,
where a dominated made hand can still improve.

## Scope (pre-activation review, same day)

The first version (PR #9943) removed the escape for every non-nut-class
flush and straight. Before activation the owner asked for that breadth to be
justified. It was not: the horses' own river raises, measured raise against
fold on 2026-11-05 and 11-06 (hand_history + ca_hand_facts, CIs clustered by
hand), show no other class negative on both days with 10 or more hands.
Non-nut straights were positive (+15.3 [8.2, 22.3] n 16 and +9.6 [5.4, 13.8]
n 11), the paired-board nut flush raised 5 and 3 times, and paired-board
non-nut flushes, straights on a three-flush board and paired-board non-nut
straights did not raise at all. The demonstrated class read -31.5 n 28 and
-32.3 n 20, its pot-sized slice -107.2 [-211.4, -2.9] n 12 and -65.9 n 9.

So the rule is narrowed to that class. Paired-board flushes (nut or not),
non-nut straights, nut straights on a three-flush board, PLO8 / FLO8 and
multi-board pots keep today's near-lock reading, seed for seed against the
explicit off arm. Full tables, method and limits (raise against call is not
measurable from these rows):
`docs/horse-measure/2026-11-07/v15-river-raise-scope.md`; the query is
`scripts/horse-measure/sql/omaha-river-raises.sql`.

Legality: the gate's `{ action: 'call', amount: toCall }` goes through
`legalizeInner` (a call for the whole stack becomes the all-in the controller
settles as a call) and `enforceAuthoritativeDecision` (an all-in-or-fold menu
turns the call into its all-in; a menu without call degrades to a menu
action). A real HandController accepts every answer in both arms, including
all-in to call, an all-in-or-fold table and fixed-limit FLO8. In PLO5 a
second-nut flush facing a pot-sized river wager then meets V81's measured
call cell and folds, exactly as any call there does.

## Pinned by

`server/src/engine/HorseV15RiverRaiseGate.test.ts` reproduces the river node of
3374459 (red before the fix: 43 raises in 60; green after: 60 calls, the gate
fires every time), and checks that a third-nut flush still never raises and
the nut flush still raises for value. The scope review added: the class in
PLO5 and PLO6 never raises; each excluded class decides exactly as the off arm
on every seed (and still raises where it did); flop and turn are unchanged;
facing no wager the gate never fires; and every answer, in both arms, is
accepted by a real HandController (all-in to call, all-in-or-fold, PLO6,
fixed-limit FLO8).

## Delivery

Engine change: activates only through the certified daily 04:00 America/Chicago
maintenance window after staging (CLAUDE.md section 13).
