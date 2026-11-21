# The sweep's own plan lifts the fences it does not need (2026-11-21, incident 1e532243)

## What was still slow after #11520

`fn_ca_hand_gap_watch` kept paging `all_in_showdown` after #11520 went live.
The #11555 attribution split it: about three quarters of the over-budget
all-in hands followed a bust (p95 +1476 to +1786 ms against +200 ms for hands
with neither a bust nor a seat move).

Engine logs and `hand_history`, 2026-11-21 01:05-01:15 UTC, two-hand showdowns:
from settlement to the next deal log, p50 5.96 s / p90 6.99 s after a bust
against 5.49 s / 5.61 s with no bust. The deal itself (log to `started_at`)
was normal. The slow tables logged "Parked between hands" at the end of their
completion hold and dealt only when an unrelated move landed. Example
7973d396 (event d80a187c): settled 01:11:25.36, elimination recorded 27.63,
parked 30.27, moved player arrived 32.00, dealt 32.35.

## The cause

A gap-balance source is fenced while it is the big table. When its hand busts
a player it often stops being one. The bust admits a sweep, which voids the
plan prepared under the hold (`balanceBoardEpoch` moves). The sweep's balance
stage (`prepareFreshTableBalance` step 2) planned from fresh rows and fenced
the sources it needed, but never lifted the fences it did NOT need. The source
parked at the end of its hold and waited for the next boundary drain, which
itself waits for any sweep holding the manager, to be told it was free.

## The fix

`releaseGapFencesNotIn(needed)` in `TournamentManager.ts`, called by every
plan made while the manager is held: the sweep's balance stage (no rebalance
needed, a single table left, or the computed moves) and the plan prepared under
the hold (which now delegates to it). Each fenced source the plan does not name
as a move source is handed back at the moment the plan is made, so a source
the sweep reaches during its hold never parks. The guards are unchanged from
the prepared-plan path: a source already parked awaiting its claim, a claimed
boundary, a durable break source, pending move outcomes, a pending break
retirement, unfinished discovery, recovery, a freeze, the tournament break and
a refused mutation all keep the fence.

Engine change: reaches production only through the next certified engine
release.

Tests: five new cases in
`server/src/tournament/aBoundaryMoveIsPlannedUnderTheHold.law.test.ts`; two
fail without the fix.
