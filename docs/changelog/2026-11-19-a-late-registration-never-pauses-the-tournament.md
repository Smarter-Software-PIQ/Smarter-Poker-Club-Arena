# A late registration never pauses the tournament (incident 075013fd, lane L)

Owner rules: "i just don't want any 'un intended delays'" (Dan, 2026-11-18) and
"REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION" (2026-08-30).

## The defect

Measured on production 2026-11-19 01:00-01:15 UTC. Horses join running
tournaments in waves of 4-8 about every two minutes, and people register late
too. Every late entry went through `fn_ca_lock_tournament_seat_acquisition`,
which takes the event's rolling lane T(id) EXCLUSIVE and then locks every table
row, roster row and live seat of the event FOR UPDATE. Every per-hand call of
that event (card writes, F06 hand begin and finish, the hand commit) holds
T(id) shared or those rows, so all of its tables queued behind each entry:
1-7.8 s waits, fold gap p90 8.9 s and p99 14.3 s during waves against p99 5.1 s
without.

## The fix (migration 20261119052513)

- `public.fn_ca_lock_tournament_registration_acquisition(event, player)` is the
  seat root of the five registration doors: `fn_register_for_tournament`,
  `fn_register_for_tournament_with_ticket`, `fn_register_horse_for_tournament`,
  `fn_register_horse_for_tournament_to_target` and `fn_seat_late_registrant`.
  For a RUNNING `mtt-v1`/`mtt-v2` event, called outside any exclusive authority,
  it joins the event's shared change lane through
  `fn_ca_share_tournament_lane_for_rebuy` (the rebuy key R(id) exclusive, then G
  and T(id) shared), re-reads the status under it, asks the seat gate's refusals
  and player keys in the gate's order, and locks only the launch receipt. A
  nested door re-enters the lane it already holds.
- Everything else is the unchanged seat gate: registration before the start
  (REGISTERING, ANNOUNCED), spins, sit-and-gos and seat-first satellites, and a
  caller that already holds G or T(id) exclusive (satellite seat delivery,
  rematch, resumed entries).
- The chain beneath the doors is unchanged. Its nested rolling-lane calls
  return at once inside the change lane and the F06 guards accept its writes
  (lane R2, 20261119011750); the seat root guard accepts the entrant's own
  chair on the held-lane proof plus the chosen table's row, which the late seat
  locks before the chair.
- `fn_satellite_target_player_provenance_is_immutable` accepts, for an INSERT,
  the held change lane of the row's own event and player: a satellite-ticket
  entrant admitted late.
- Doctrine rule 6 names the registration root among the change lane's callers;
  rule 7 pins the five doors to it and keeps it off any exclusive tournament key.

Bounty, PKO and mystery events are included: lane R2 put their rebuys and busts
on the same lane and made the nested bounty authorities take it as held.

## A new table needs nothing exclusive

When every chair is taken, `fn_ensure_late_registration_capacity` (unchanged)
opens a table in the same transaction: a table row no hand can hold, its
receipt and its manager wake, under the tournament row the core already holds.
Everything that reshapes an event's tables (balancing moves, breaks, final
table, terminal settlement) holds T(id) or G exclusive and so cannot run beside
it, and two registrations cannot both open one (R(id)). No shared hold is ever
upgraded to exclusive.

## What is left

The registration core locks the tournament row FOR UPDATE for the rest of its
transaction, and every hand commit of the event takes that row FOR SHARE. A
hand commit therefore still waits for the tail of one registration (tens of
milliseconds; production mean 62 ms per horse registration), never for the
lane or for a queue of registrations. Rebuys and busts have the same shape.

The converse is a registration that waits for a gap in those FOR SHARE holds:
new sharers do not queue behind a waiting FOR UPDATE, so under continuous
back-to-back hand commits a registration can wait for seconds (seen in CI with
six unpaced commit workers, about 150 commits a second). Production commits
about 0.15 hands a second per event, so the row is free nearly all the time.
The root fix for both is the hand commit taking the tournament row FOR KEY
SHARE and the entry cores FOR NO KEY UPDATE (status is already fenced by the
event lane); it touches the hand path and every entry core and is left to its
own change.

## Proof

`scripts/ci/test-late-registration-never-pauses-the-tournament.py` (native
PostgreSQL, production pre-images, lanes T, R and R2 installed natively; wired
in `.github/workflows/late-registration-never-pauses.yml`) and
`tests/a-late-registration-never-pauses-the-tournament.law.test.ts`.
