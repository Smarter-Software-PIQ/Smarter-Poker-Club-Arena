# A Sit and Go whose launch has begun cannot be unregistered (2026-11-22)

Found while unblocking the migration queue for incident `9408cfd4` (PR #11775).

## What was open

Dan's rule of 2026-11-22 lets a player unregister from a Sit and Go until it
starts. Two lanes built it the same afternoon. `20261122185915` installed first
with the authority `sng_actual_start`; `20261122192807` was refused on its
anchors and its lane is making it verify-only (#11785).

`20261122185915` closes a Sit and Go only once its launch receipt is completed.
On production, `fn_begin_tournament_launch_before_lease_generation` is the
launch's first step: it writes the receipt with the cohort it will seat
(`launch_player_ids`) and leaves the event `REGISTERING`. Seating and funding
come in later steps. Between them, a player in the cohort passed every check
and could be unregistered and refunded while being seated.

## The change

`20261122222254_a_sit_and_go_whose_launch_has_begun_cannot_be_unregistered.sql`,
anchored edits of the installed bodies (each needle exactly once, or nothing):

- an `sng_actual_start` unregistration is refused once any launch receipt
  exists, in the chip core and the Diamond door;
- the chip core proves it again after the refund work and before the
  immutable receipt, or rolls back;
- the launch's own release of a registrant it cannot seat keeps the
  `launch_release` authority, so the launch is never refused.

The receipt reader and the receipt check already accept `sng_actual_start` and
are not changed. Nothing moves or prices money; nothing reads `is_horse`.

## Proof

`scripts/dev/prove-a-begun-sit-and-go-launch-closes-unregistration.sh` builds a
throwaway PostgreSQL from the `20261122185915` bodies:

| case                                                                                           | before         | after              |
| ---------------------------------------------------------------------------------------------- | -------------- | ------------------ |
| nine seat Sit and Go, launch begun (chip)                                                      | not_registered | tournament_started |
| nine seat Sit and Go, launch begun (Diamond)                                                   | not_registered | tournament_started |
| nine seat Sit and Go, released by its own launch                                               | not_registered | not_registered     |
| every other case (MTT, Heads-Up, Spin, seat-first satellite, started, running, hand persisted) | unchanged      | unchanged          |

The edited bodies were also compiled against production as `pg_temp` copies in
a rolled-back block. Production held 17 incomplete launch receipts, all on
CANCELLED scheduled events, so no live Sit and Go is closed by the new check.

Law: `tests/a-sit-and-go-whose-launch-has-begun-cannot-be-unregistered.law.test.ts`.
