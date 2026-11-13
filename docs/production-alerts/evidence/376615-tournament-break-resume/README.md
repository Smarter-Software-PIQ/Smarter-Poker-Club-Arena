# 376615: TableStoppedDealing raised at the end of every tournament break

Production Alerts PRIMARY lane, 2026-11-11.

## Rows

Opened by: 376615, 376616, 376617, 376618 (Five-Card Last Chance, tournament
`23999d44`, 07:00:17Z). The same class covers every `ca-stall-watch`
`TableStoppedDealing` row whose table's last hand fell inside a tournament
break that had just been released. In the 14 days to 2026-11-11 07:00Z that is 248 rows
(40 critical), raised at :00-:02 of most busy hours.

## What the raw rows show

Row 376615 `facts`: `on_break=false`, `break_started_at=06:55:00Z`,
`break_ends_at=null`, `sibling_tables=3`, `sibling_tables_silent=3`,
`ms_since_progress=309090` (last hand 06:55:07.9Z), detected 07:00:17Z, first
resumed hand 07:00:50.6Z. All four tables had dealt again by 07:00:50.

Of the 114 rows in the class that carry `first_progress_hand_at` (field added by
20261107231750), 89 dealt within 50 s of detection. The median was 35 s and the worst 91 s.

## Root cause

- `fn_ca_table_stall_decide` returns `tournament_break` only while
  `tournaments.on_break` is true.
- The engine's break release (`TournamentManagerBase`, break release) writes
  `on_break=false, break_ends_at=null` in one row version. No column records
  when the break ended.
- The engine's `poker_table_ms_since_progress` counts from the table's last
  hand before the :55 last-hand announcement.
- So at the first 10 s watch tick after release, every tournament table reads
  300-400 s "since progress" with `on_break` already false, and is raised.

20261107032642 fixed exactly this shape for the maintenance thaw
(`resuming_after_maintenance`) and did not cover the tournament break.

## Fix (migration 20261111074922)

- `smarter_private.ca_table_stall_watch.tournament_break_seen_at` records the last watch
  tick at which this silent table's tournament was on its break. The watch
  observes every silent tournament table on every 10 s tick of the break, so
  this is its own witness of the release, accurate to one tick.
- `fn_ca_table_stall_decide` returns `resuming_after_tournament_break` when the
  break is over, was last seen < 60 s ago, and the table's last progress
  predates that sighting. The 60 s starts at the last tick that saw the break,
  which is at most one tick before the release, so the excuse never exceeds
  Dan's 60 s rule (2026-10-31).
- A table still silent 60 s after that is raised as before, with a summary
  measured since the break ended.

## Hardening

| Item            | Where                                                                                                                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regression test | `tests/a-table-resuming-from-its-tournament-break-is-not-stopped.law.test.ts`: 5 of 6 fail on pre-fix `main`, 6 of 6 pass with the fix (`before.txt`, `after.txt` below)                                                                                                                                                    |
| Invariant       | The predicate itself; the migration's `$prove$` block aborts the install unless a table 10 s after its break is excused, one silent 61 s after it is raised, one that dealt after the break is not excused, an on-break table keeps `tournament_break`, and the thaw excuse is unchanged; md5 pre-image gate; `@live-proof` |
| Detection       | Unchanged `TableStoppedDealing` from `ca-stall-watch` into `operational_alert_events` with `target_task_id`; still fires for a table silent > 60 s after its break (proved)                                                                                                                                                 |
| CI gate         | Client Unit Tests (ci.yml) runs every `tests/*.law.test.ts` on each PR; law registered in `docs/laws.d/`                                                                                                                                                                                                                    |

## Pre-merge proof against production (rolled back)

One Supabase call, one `DO` block ending in `RAISE EXCEPTION`: both rewritten
functions were built from the live definitions with the migration's exact
anchors, compiled into `pg_temp`, and every proof ran against them. The
result was `PROBE_OK all anchors matched, both functions compiled in
pg_temp, all proofs held`, and nothing was committed. No installed function pins the
replaced md5s (`077f272a…` decide, `7e5d5b4f…` ingest).

## Close condition

After 20261111074922 is installed: no `TableStoppedDealing` row whose facts show a
table silent since before a just-released tournament break and whose first
resumed hand came within 60 s of the release. Rows still raised after a
break must carry the new "since its tournament break ended" summary.

## Test output

before (migration moved aside):

```
     × the migration exists 6ms
     × the excuse needs the break to be over, lasts 60 s after the break was last seen, and covers only a table silent since before it 2ms
     × the end of the break is the watch observing it, never a guessed duration 1ms
     × the migration proves a table still silent 61 s after its break is raised, and the thaw excuse is unchanged 1ms
     × the migration is gated on the live pre-image and carries a live proof 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
      Tests  5 failed | 1 passed (6)
```

after:

```
 Test Files  4 passed (4)
      Tests  2636 passed (2636)
```
