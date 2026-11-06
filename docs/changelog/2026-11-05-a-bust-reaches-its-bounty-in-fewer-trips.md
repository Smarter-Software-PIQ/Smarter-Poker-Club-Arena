# A Bust Reaches Its Bounty In Fewer Trips

Dan, 2026-11-05: PKO bounties must be credited the second the hand is over. Production measured about 5 seconds from an accepted hand to its bounty obligation, and the engine's `/metrics` read a mean elimination sweep of 2.0 seconds over 47,015 sweeps (p50 between 1 and 2 seconds, 14 percent above 5 seconds). Every link of the bust path is an awaited PostgREST round trip from the engine to the database region.

The bust path now spends five fewer sequential round trips (fourteen down to nine in the fixed-trip harness):

- Bust stage: the playing count and the first knockout order page are sent together, and a freezeout (no rebuy, no re-entry, the same immutable flags `tryTournamentRebuys` already skips on) no longer calls `fn_open_tournament_rebuy_decisions`, which can only open a prompt in an event that sells rebuys. Three trips to the first elimination instead of five.
- `eliminatePlayer`: the replay guard and the tournament pricing row are read together, the payer reuses the exact hand obligation the door just returned and the engine proved, and the display names are read in the same round trip as the payment. A knockout reaches its `bounty_collected` broadcast after six trips instead of nine.

Every money write keeps its single authority: the knockout door and `fn_collect_bounty_obligation` are called exactly as before, once each. A new histogram, `poker_tournament_elimination_sweep_step_ms{step}`, records the wall time of every named sweep step so the remaining links can be measured in production.

Proof: `server/src/tournament/aBustReachesItsBountyInFewerTrips.law.test.ts`, `server/src/tournament/TheSweepAsksIndependentQuestionsTogether.test.ts`.

## The Sweep Gate Reads Pending Bounty Work, Not Every Marker

Before it records a bust, every sweep of a bounty event asked `fn_tournament_has_unsettled_bounties`, which re-proves the complete marker of every settled obligation in the event. Its cost grew with every knockout already paid: 2,429 ms on the 402 obligations of the Afternoon Free Buy PKO (EXPLAIN ANALYZE, 142,194 buffer hits), and pg_stat_statements shows 272,041 engine calls at a 262 ms mean, about 20 hours of database time. Late in a big PKO this one read was most of the 5 seconds between a knockout hand and its bounty.

Migration `20261106034328` adds `fn_tournament_has_pending_bounty_work`. It checks for a pending obligation, an open mystery award, or an obligation settled in the last ten minutes whose marker is incomplete, all with indexed reads (1.27 ms on the same event). The engine gate asks it and falls back to the old verdict only while the function is not installed. The full re-proof stays at every finish (finalize, final table deal, satellite finish, finish readiness, mystery guards, completion guard, final two close), so older drift still refuses the finish.

Proof: `scripts/ci/test-sweep-gate-pending-bounty-work.py`, `server/src/tournament/TheSweepGateReadsPendingBountyWork.test.ts`.
