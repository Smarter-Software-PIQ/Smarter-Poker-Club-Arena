# retention/hand-history-prune-cursor-full-rescan

Recorded by the Production Alerts PRIMARY lane (board #5070). The defect was opened by the 2026-11-18 05:45Z run, and this candidate was prepared at 06:10Z-06:40Z.

## Symptom (read on production at 2026-11-18 05:45Z by the PRIMARY run, from pg_stat / cron history)
- `sp_prune_hand_history_10m` (cron 117, every 10 s) used about 100 s of database time per idle hour. From 2026-11-17 21:00Z it used 2,300-3,200 s per hour.
- Earlier heavy phases ran 11-14 04-14Z and 11-15 21Z to 11-16 09Z, with idle stretches of 30-35 h between them.
- At 05:47Z the pass cursor read `2026-11-09 03:35Z`, and the 8-day boundary was `2026-11-10 05:47Z`, so the cursor was 26 h behind.

## Cause (from the installed source, migration 20261107224000, md5 637890ae...)
- A pass that reaches the boundary parks with `resume_id` NULL.
- The first run 60 minutes after `pass_started_at` resets the cursor to `-infinity`.
- The rescan then has to walk every retained row older than the boundary, 250 per page, before it reaches any newly eligible hand.

## Fix
- Migration `20261118061009` adds a forward-only frontier cursor, `smarter_private.hand_history_prune_frontier`.
- When the frontier is more than 5 minutes behind the boundary, the page scans from the frontier. Otherwise the pass continues unchanged.
- The scan, the guards, the page size and the disposals are byte-identical.

## Proof (native PostgreSQL 16.15; the same digest method reproduces production's preimage md5 exactly)
`run_launch_reset_accounting_fixture.py --fixture scripts/ci/fixtures/hand-prune-frontier.sql --candidate supabase/migrations/20261118061009_...sql`
-> `native_fixture: passed`, `bound_postimages: [sp_prune_hand_history]`.

| phase | step | deleted | new_left | retained_left | meaning |
|---|---|---|---|---|---|
| old | 1 | 0 | 100 | 600 | the restarted pass reads retained rows |
| old | 2 | 0 | 100 | 600 | the new hands are still not pruned |
| new | 1 | 100 | 0 | 600 | the frontier prunes the new hands first |
| new | 2 | 0 | 0 | 600 | the frontier parks at the boundary |
| new | 3 | 0 | 0 | 600 | the pass advances to retained row 250 |
| new | 4 | 100 | 0 | 500 | a released guard is pruned by the pass |
| new | 5 | 100 | 0 | 400 | the same |
| new | 6 | 250 | 50 | 400 | a 3 h backlog: alert recorded once |
| new | 7 | 50 | 0 | 400 | the backlog drains; no second alert inside the hour |

- The migration was also applied to the stub cluster. Its pre-image and post-image checks passed (cron job command digest stubbed locally), and a second apply was refused by the pre-image check.
- `tests/unit/aMigrationMovesThePinsOnWhatItChanges.pg.test.ts` passed 7/7 as a non-root user.
- 101 of the 102 vitest files that reference the pruner or CI classifier pass. The remaining one, `privateRecordHosting`, fails identically on main because it needs a Mac `/Volumes` path.

## Expected after install
- `HandHistoryPruneFrontierBehind` fires about once per hour, as one row per UTC day, until the 26 h backlog drains. After that it should not fire.
- To verify: the `hand_history_prune_frontier.frontier_after` cursor stays within about 5 minutes of `now()-8 days`, and the job's database time per hour returns to the low hundreds of seconds.
