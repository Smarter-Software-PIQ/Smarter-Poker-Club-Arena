# A repeat waiting-list join keeps its place (2026-11-22)

## What was wrong

Production Postgres logged `duplicate key value violates unique constraint
"cash_game_waitlist_one_open"` 1 to 11 times an hour. Read from the logs for
the 24 hours to 02:21 UTC on 2026-11-23:

- **67 refusals, every one from the same statement**: PostgREST
  `INSERT INTO public.cash_game_waitlist (game_id, status, user_id)` (query id
  `-8053065959155238626`), sent by the engine (edge log user agent `node`,
  `POST | 409`).
- **All 60 players involved are horses** (`profiles.is_horse`).
- **No person ever hit it.** A person joins through `fn_cash_game_join`, which
  already inserts with `ON CONFLICT DO NOTHING` and then returns their
  position (`action: waitlisted`, the same answer as a first join). No client
  toast ever showed for this error.

The insert is `HorseFleetManager.syncHorseGameQueues`, the cycle that keeps
horse lines on full games. It read the horse rows with
`.eq('status', 'waiting')`, but the index counts a row as open while it is
`'waiting'` **or** `'notified'` (the tick has called that name into a chair and
holds it for sixty seconds). A horse whose name had just been called therefore
looked like it was on no list; `planHorseQueues` could pick it for the same
game again; and Postgres refused the batch.

Row history read back for the sampled refusals matches every time: for example
game `bda665c1` / horse `9ecd6262` joined at 02:08:32, the duplicate was sent
at 02:21:02.694 (after the 02:21:02.348 waiting-only read), and the row expired
at 02:22:01 when its called chair lapsed; game `0914a283` / horse `312e2301`
joined at 01:47:32, the duplicate came at 02:02:06 and the row was seated at
02:02:37.

**The cost was larger than one horse.** The fleet sends every game's new
arrival in one multi-row insert, and one refused row refuses the statement.
Proved on a throwaway Postgres 16 with the production index: a batch of
`(g1, h1)` (h1 already `notified` on g1) and `(g2, h2)` left g2 with **0** rows;
the same batch without the repeat left g2 with 1 row and h1's called row
untouched (still `notified`, still joined 60 minutes ago).

## What changed (engine)

- `syncHorseGameQueues` reads every open row (`OPEN_LIST_STATUSES`,
  `'waiting'` and `'notified'`). The planner still receives only the
  `'waiting'` rows, exactly as before.
- `keepHeldPlaces` (pure, `HorseGameQueue.ts`) drops an arrival whose horse
  will still hold an open place on that game once this cycle's cancels land.
  A `'notified'` row is never cancelled by the fleet (its cancel is filtered to
  `'waiting'`), so it always holds its place; a `'waiting'` row the plan
  cancels frees it.

Nothing else moves: every cancel, every other arrival, who is called to a
chair and in what order, and the existing row's place in line are exactly what
they were. Horses keep the same door rule a person has: a repeat join is the
place you already hold.

## Proof

- `server/src/services/aRepeatListJoinKeepsItsPlace.law.test.ts` (8 cases):
  the pure rule, the planner state behind every measured refusal, the source
  of the read, and that the fleet's open statuses equal the index's. With the
  old `HorseFleetManager.ts` restored the source case fails.
- The horse queue suites (`HorseGameQueue`, `aFullGameAlwaysHasAWaitingList`,
  `theFloorIsFull`, `HorseQueueAdmission`, `HorseWorkSchedule`,
  `ClassicHorseDemand`, `HorseRegulars`) pass unchanged.

## Live

This is engine code, so it goes live at the next certified engine cutover
after merge (`stage-engine-release.yml` -> `auto-deploy-hetzner.yml`). Live
proof is the serving `releaseSha` containing the merge and no further
`cash_game_waitlist_one_open` refusals in the postgres logs.
