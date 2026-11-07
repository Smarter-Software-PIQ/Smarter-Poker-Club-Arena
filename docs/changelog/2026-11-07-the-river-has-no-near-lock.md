# The river has no near-lock: a dominated Omaha flush never raises a river bet (2026-11-07)

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

On the river the escape is gone: a non-nut flush or straight facing a river
wager in Omaha calls. There is nothing left to draw on the river and the hands
that pay a raise are the ones it loses to. Flop and turn keep the near-lock
reading, where a dominated made hand can still improve.

## Pinned by

`server/src/engine/HorseV15RiverRaiseGate.test.ts` reproduces the river node of
3374459 (red before the fix: 43 raises in 60; green after: 60 calls, the gate
fires every time), and checks that a third-nut flush still never raises and
the nut flush still raises for value.

## Delivery

Engine change: activates only through the certified daily 04:00 America/Chicago
maintenance window after staging (CLAUDE.md section 13).
