# Queued Lightning Leaves And Full-Ring Holds No Longer Strand Seats (2026-11-13)

Two production defects found while verifying the owner's Lightning staffing
order (#10739). Both kept seats in place that could neither play nor leave,
which also kept horses at the table past their rest day or daily cap.

## #10740: a queued Lightning leave that owes hands

Owner rule (2026-11-06): a player in profit who leaves before the hand count is
played is blinded off for the remaining hands.

Measured 15:10-15:25 Chicago: fifteen seats in Lightning NLH .25/.50 and PLO4
.25/.50 sat out with `leave_pending`, the oldest for 60 hours, each owing 7 to
10 hands and dealt none since.

Cause:

1. A leave asked while the player's chips were in a live Lightning hand is
   queued: `fn_request_seat_departure` sets `is_sitting_out` and
   `leave_pending`. The engine's lock check that runs first judged the count
   at its roster stack, which Lightning settlements never update, so a seat in
   profit could read as owing nothing and be queued.
2. After that hand the voluntary cash-out is refused for the hands owed and
   the leave is held.
3. `fn_lightning_player_legality` answers `CASHOUT_PENDING` / `SITTING_OUT`
   for such a seat, so the pool never deals it again.

Fix:

- Migration `20261113225904` adds `fn_lightning_owed_leave_returns_to_pool`,
  engine-only. It withdraws the voluntary request for that exact occupancy,
  clears `leave_pending` and the sit-out, and marks the session blinded off.
  It asks `fn_cash_leave_check` what is owed. It refuses without writing when
  the platform is frozen, the occupancy is stale, the request is forced, the
  player is in a live hand, or nothing is owed. No stack, departure or
  occupant changes. It is additive only.
- The engine (`ServerTableEngineBase.returnOwedLightningLeaveToPool`) calls it
  from the held-leave release pass at a Lightning anchor and holds the seat as
  a blind off. The existing machinery then takes over: the pool deals the seat,
  the hand host folds or checks it, and the settlement counts each hand. The
  held leave cashes out through the voluntary door once nothing is owed.
- An anchor now judges the count at the database's stack
  (`handCountStack`) everywhere the leave is decided.
- The fifteen existing seats need no hand-written repair. After the cutover the
  engine's first pass finds each pending seat, the count refuses its cash-out,
  and the same door returns it to the pool.
- Proof: `scripts/qualify-lightning-owed-leave.mjs` runs the installed
  production images in a throwaway PostgreSQL cluster. Before the migration the
  strand reproduces; after it the seven owed hands are dealt and the leave
  completes. Forced, live-hand, nothing-owed, stale, repeated and non-engine
  calls are all refused. Engine behaviour tests:
  `aQueuedLightningLeaveOwingHandsReturnsToThePool.test.ts`, with person and
  horse twins. Law: `tests/a-queued-lightning-leave-owing-hands-returns-to-the-pool.law.test.ts`.

## #10741: FLO8 .25/.50 Madness tables seated and not dealing

Four tables of game `0bc9bdf3` held six funded, sat-in seats and dealt nothing:
Main 1 from 00:55, Mains 3 and 4 from 04:21 and 04:11, and Main 2 from 14:48.
`/health` reported 0 stalled tables.

Cause: these are the only cash tables whose deal minimum
(`auto_start_players`) is the full ring, six of six. Must-move seats carry
`entry_hold = 'moved'`. `admitMovedSeats` keeps such a seat out while it sits
between the button and the big blind, until the button passes it. The button
only moves when a hand is dealt, so on a six-of-six table the hold could never
end.

Health missed it because of the idle loop. The engine's own per-table liveness
showed `dealable 6`, `loopPhase idle_cluster_closed` and `msSinceProgress`
under 2 s, because the idle branch stamps progress after every sweep. Every
stall filter needs a table with no progress.

Fix:

- When the hold is the only reason a cash table is below its minimum, it
  releases itself. Nothing is being dealt, so there is no blind to come in
  behind; every seat enters the same hand, as `releaseWaitersNoBlindCanReach`
  already does for a big-blind wait. Anywhere else the hold still holds.
- The idle branch no longer stamps progress when the gate's own candidates
  already reach the minimum. A future disagreement inside the gate now shows
  as a stall instead of as waiting.
- Main 3 also carried two horses blinded off with hands owed, which could
  never be played while the table could not deal. The same release lets them
  play out.
- Tests: `aMovedSeatHoldNeverStopsAFullRingTable.test.ts`.

## Off-duty horses at Lightning anchors stayed seated

Measured 2026-11-13: 24 off-duty horse departures at Lightning anchors against
891 at Classic tables. One horse at the NLH .25/.50 feeder was 62 hands past
its daily cap with nothing owed in the database and no departure ever asked.

Cause: the rotator asks the engine whether a seat owes hands or a big-pot orbit
(`hitRunHandsOwed`, `bigPotOrbitHandsOwed`). Both read the continuity mirror.
At an anchor every hand settles in the pool, and the mirror was refreshed only
when presence changed, so a snapshot taken just after a win kept answering
"owes" for as long as the horse played on, and `offDutyExitNow` deferred every
cycle.

Fix: `refreshAnchorContinuity` re-reads every seat through the same evaluate
the leave door uses, at most every 30 seconds, on the halted loop that already
serves the anchor, and never during the freeze. Person and horse alike. Specs
added to `aQueuedLightningLeaveOwingHandsReturnsToThePool.test.ts`.

## Delivery order

The engine changes ship first, in the routine 04:00 cutover. The database
function is allowlisted in `scripts/ci/engine-doors.allowlist.json` as an
optional door: until it exists, the engine's call returns null and nothing
changes. The migration merges in a second pull request after the seal is
verified. An ordinary migration installed before the cutover would have
invalidated the night's Backup certificate. Once it installs, the next release
pass returns the stranded seats to the pool with no engine change.
