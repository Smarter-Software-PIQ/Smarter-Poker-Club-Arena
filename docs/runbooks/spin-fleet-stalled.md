# SpinFleetProducingNothing

Runbook for `SpinFleetProducingNothing` in `infra/monitoring/spin-rules.yml`
(group `spin-money`). Written 2026-09-26, replacing a link to
`https://monitor.smarter.poker/runbooks/spin-fleet-stalled`, which has never
served anything.

## What it means

```
((poker_spin_seconds_since_last_start > poker_spin_ladder_full_envelope_seconds
    and poker_spin_open_boards > 0)
 or (poker_spin_human_oldest_wait_seconds > 2 * poker_spin_human_arrival_max_seconds
    and poker_spin_seconds_since_last_start > poker_spin_human_arrival_max_seconds))
unless on () max_over_time(poker_maintenance_break_active[6m]) == 1
for: 5m   severity: critical
```

Either nothing has started for longer than the ladder's own full envelope while
boards sit open, or a person has waited more than twice the arrival promise
while the fleet started nothing. Every other Spin alert measures games that
exist, so all of them stay green through this.

## The cadence this alert is written against

Not "a hundred Spins an hour". That was the pre-ladder fleet, retired by Dan on
2026-11-08 for running roughly eight thousand games a day to produce seven that
a person played in.

Under the seat-first ladder (`server/src/config/seatFirstLadder.ts`) ONE horse
opens a Spin, a second may sit after 60-80 minutes and a third after 30-60 more
and it deals. `SPIN_BOARD_OPEN_TARGET = 11` boards are open at once and every
rung is randomised per board. So:

- longest legitimate time from opening to dealing: **140 minutes**
  (`poker_spin_ladder_full_envelope_seconds`, 8400);
- designed throughput: 11 boards at 90-140 minutes, **4.7-7.3 starts an hour**.
  Measured 2026-11-10: 7 in the last hour, 34 over six (5.7/hr);
- a person who sits is joined in 3-7 minutes
  (`poker_spin_human_arrival_max_seconds`, 420) - the only fast path there is.

**Gaps over half an hour between starts are therefore routine, by design.** The
30-minute threshold this rule used until 2026-11-10 paged critical on the
product working (incident `78afb154-54ae-4661-bf7d-e5e3c18a6eb3`). Both
thresholds are now gauges emitted from the ladder constants, so a ladder change
moves them; `server/src/services/aSpinAlertReadsTheLadderItWatches.law.test.ts`
fails the build if a literal returns.

## What the expression measures

`fn_spin_metrics`: `seconds_since_last_start` is `now() - max(started_at)` over
all Spins (`variant = 'spin'`), `open_boards` counts Spins in REGISTERING that
no owner floor park holds. `fn_spin_fill_waits`: `human_oldest_wait_seconds` is
the longest-waiting live HUMAN seat on a partly filled board, 0 when no person
is waiting. The two ladder gauges are constants read from
`server/src/config/seatFirstLadder.ts` by `SpinMetrics.ts`.

## First checks

1. Confirm from the database, read-only:

   ```sql
   SELECT max(started_at), now() - max(started_at) AS since_last
   FROM tournaments WHERE variant = 'spin';

   SELECT status, count(*) FROM tournaments
   WHERE variant = 'spin' AND created_at > now() - interval '2 hours'
   GROUP BY 1;
   ```

2. **Split the waiting seats by who holds them. Do this first** - it is the
   question that decides whether there is a fault at all, and the one this
   runbook did not ask until 2026-11-10.

   ```sql
   SELECT tournament_id, live_seats, human_seats, horse_seats,
          unresolved_seats, longest_wait, longest_human_wait
   FROM v_spin_unfilled_waits
   ORDER BY oldest_seat_at LIMIT 20;
   ```

   | What you see | What it is |
   | --- | --- |
   | 1-2 of 3 live seats, `human_seats = 0` | **The ladder working. Not a fault.** A horse-only board holds its seats for up to 140 minutes on purpose. Stop here unless `poker_spin_seconds_since_last_start` is past the envelope, in which case go to step 3: the fault is production, not seating. |
   | `human_seats > 0` and `longest_human_wait` past 7 minutes | A paying player is waiting and the fast lane is not delivering. `SpinHumanWaitingForOpponents` owns this; read the engine log for `GameServer.seat_first_human_waiting` and `"seat-first fill added nobody"` from TournamentRecurring. |
   | 3 of 3 live seats and never starts | The start path is failing (step 4). |
   | 0 live seats on an open board | Players cannot reach it (lobby or seating), and no horse opened it either - check `TournamentRecurringService` board-room counts. |
   | `unresolved_seats > 0` | A seat with neither a `horse_id` nor a resolvable profile. It is deliberately counted as neither a person nor a horse, so it pages nothing; it is a data defect worth a separate look. |

   Do not cancel, fill or start a horse-only board to make this alert go
   quiet. It is waiting out a rung.
3. Can the platform create a tournament at all? On 2026-09-01 every INSERT
   into `tournaments` failed for four hours in an AFTER INSERT trigger (a text
   column read as jsonb), and every Spin alert except this one stayed silent.
   Reproduce it by cloning a live row inside one `DO` block that ends in
   `RAISE EXCEPTION` (CLAUDE.md 11.5 rule 1): the error and the trigger that
   raised it come back together and nothing commits. The row-level triggers on
   `tournaments` are listed by
   `SELECT tgname, tgfoid::regproc FROM pg_trigger WHERE tgrelid = 'public.tournaments'::regclass AND NOT tgisinternal;`.
4. The engine log for the start path:
   `docker logs --since 1h club-arena-engine 2>&1 | grep -E 'ScheduledTournaments.insert_failed|spin_launch|SpinDraw|spinLaunchParking' | tail -40`.
   `/health.spinLaunchParks` shows launches the engine has parked and why.
5. Is the platform frozen? During the :55 break the freeze guards
   (`zz_freeze_launch_guard` on `tournaments`) refuse new entries by design;
   a freeze that did not thaw (`/health.maintenance.phase`) stops everything.

## Likely causes

- A trigger or constraint on `tournaments` refusing every insert or start.
- The start path failing its receipt (`fn_spin_draw_and_settle_atomic`
  refusing) so launches park instead of dealing.
- The engine not owning the Spin managers at all (compare
  `poker_tournaments_owned` with `poker_tournaments_running`; see
  `docs/runbooks/tournament-fleet-unserved.md`).
- A platform freeze that did not thaw.
- Something cancelling horse-opened boards before their first rung. This
  happened on 2026-11-10: `fn_spin_expire_unfilled` cancelled and refunded 40
  Spins in two hours on a 30-minute `spin_fill_policy.unfilled_timeout_minutes`
  that predated the ladder. The timeout is now floored above the ladder
  (migration `20261110144739_a_spin_waits_out_its_horse_ladder`); read
  `spin_fill_policy` before suspecting the engine.

NOT a cause: the ladder itself. Eleven boards sitting at 1-2 of 3 seats with no
person in them is the specified steady state.

## What not to do

- Do not insert or start Spins by hand, and do not disable a trigger to get
  games flowing; the triggers are money and contract guards.
- Do not probe with DDL on production (CLAUDE.md section 2, rules 3 and 7).
- Do not restart the engine outside the :55 break.

## Where the owning code lives

- Gauge: `server/src/services/SpinMetrics.ts`, SQL `fn_spin_metrics`
  (`live` and `boards` CTEs), added by
  `supabase/migrations/20260902020033_a_fleet_that_produces_nothing_looks_like_a_quiet_night.sql`.
- Who is waiting: `fn_spin_fill_waits` and `v_spin_unfilled_waits`, seat
  identity added by
  `supabase/migrations/20261110233909_a_waiting_spin_seat_says_whether_a_person_is_in_it.sql`.
- The ladder and both alert thresholds: `server/src/config/seatFirstLadder.ts`,
  emitted by `SpinMetrics.ts` and bound by
  `server/src/services/aSpinAlertReadsTheLadderItWatches.law.test.ts`.
- Board creation: `server/src/services/TournamentRecurringService.ts`.
- Launch and draw: `server/src/tournament/TournamentManagerBase.ts`,
  `spinLaunchParking.ts`, `spinSettlementReceipt.ts`.
- The 2026-09-01 cause and fix:
  `supabase/migrations/20260902013000_every_tournament_insert_was_failing_on_a_text_column_read_as_jsonb.sql`.
