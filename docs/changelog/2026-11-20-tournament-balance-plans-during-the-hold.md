# Tournament Balancing Is Planned During the Hand's Hold, Not After the Park (2026-11-20)

Incident 1e532243, `fn_ca_hand_gap_watch` ("unintended delay between hands"). Owner rule: no unintended delays between hands (Dan, 2026-11-18).

## What Was Wrong

When the balancer needs a player from a table that is mid-hand, it fences that table so it stops at its next hand boundary. The table parks only after its completion hold (the 4.75 to 7 seconds the felt spends showing the winner, pushing the pot and mucking). Its park edge then read the live table list (two paged reads), read the balancer board (three chunked reads), planned, and only then made the move. Those five serial round trips began after the hold had already ended, on a table that could not deal until they finished.

Production, tournament hands, November 20 (6 hours):

| Hand role        | Hands | Unintended p50 | p90      | p95      |
| ---------------- | ----- | -------------- | -------- | -------- |
| Move source      | 163   | 784 ms         | 3,275 ms | 4,329 ms |
| Move destination | 89    | 128 ms         | 163 ms   | 177 ms   |
| Unaffected       | 5,259 | 129 ms         | 166 ms   | 202 ms   |

A source whose move committed within 1 second of its hold ending showed the normal 130 ms. Each further second before the move committed added one second of delay (move 2 to 3 s after the hold: p50 1.83 s; 4 to 5 s: 3.98 s). The time from the last move to the next deal was a steady ~0.9 s, which the 1.5 s rest normally covers. The watch's firings at 08:31 and 09:31 CST came from this tail on the ~50-table MTTs (0e999138, 88cf8792).

## The Fix

`server/src/tournament/TournamentManager.ts`:

- The hand-complete edge (fired at settlement, before the hold) now reaches `onManagedHandSettled`. For a fenced gap-balance source it starts `prepareBoundaryBalancePlan`, which reads the live table list and the balancer board while the hold plays.
- At the park, `balanceParkedGapSources` uses that board when it is still current (`takePreparedBoundaryBoard`), so only the committed seat moves run at the boundary. A park that arrives while the read is still running waits for that read rather than starting a new one.
- The board is trusted only while `balanceBoardEpoch` has not moved since its reads began. The epoch moves on every admitted sweep, every seat-move batch (start and finish) and every newly observed bust (one bust reported twice counts once), and a plan older than 15 seconds is refused. Anything else falls back to reading the board fresh at the park, exactly as before.
- A fenced source that the hold-time plan no longer needs is given back to its dealer before it reaches the gate, so a table that is neither a move source nor a destination is never parked. This never happens beside a sweep, a seat-move batch, a boundary balance, an unresolved move outcome, break recovery, or on a source that is already parked or claimed.
- A sweep that held the manager while a fenced source was in its hold re-reads the board when it settles, still under the hold.

Every check after the board read is unchanged: maintenance freeze, tournament break, recovery, hand-for-hand, the physical boundary probe, the atomic move door, receipts and quarantine.

## Expected Effect

Move-source hands drop from p50 0.78 s / p95 4.3 s unintended to the ~0.13 s / ~0.2 s every other tournament hand shows, taking the tournament roster-change p95 (1.45 to 1.65 s) back under the 250 ms budget. Live with the next engine release.

## Proof

`server/src/tournament/aBoundaryMoveIsPlannedUnderTheHold.law.test.ts` (registered in `docs/laws.d/server-src-tournament-aBoundaryMoveIsPlannedUnderTheHold.md`). The existing `aShortTableIsFilledAtTheBigTablesNextBoundary` law passes unchanged.
