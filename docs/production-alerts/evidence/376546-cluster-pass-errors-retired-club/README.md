# 376546 ClusterPassErrors: retired clubs in the cluster tick worklist

Read from production (`kuklfnapbkmacvwxktbh`) on 2026-11-11 between 05:44 and 05:55 UTC. Every query was read-only.

## Alert history

- Row 376546 (alertmanager) fired at 05:43:59Z: "4772 cluster tick errors in 15 min".
- 48 earlier firings since 2026-10-17 were closed as `informational` by the resolved-twin rule.
- Recent firing and resolution times, showing the errors never stop:
  - 11-08: fired 10:16, resolved 09:58 the next day
  - 11-09: fired 10:16 and 19:49
  - 11-10: fired 10:23 and 17:23
  - 11-11: resolved 05:26, fired again 05:44

## Raw cause

- The last 20,000 `cash_cluster_events` rows hold 3,996 `controller_tick_error` rows.
- All 3,996 are the same error: `55000 CLUB_RETIRED: gameplay and cashier records are read-only`.
- They come from 36 distinct games.

## The 36 games

| Club (retired 2026-11-07) | Games | Open seats | Stacks | Non-zero member balances |
|---|---|---|---|---|
| Crest Cert Template 6dc7e348 | 9 | 0 | 0 | 0 |
| Crest Cert Template fba91d7b | 9 | 0 | 0 | 0 |
| Crest Cert Template 32085314 | 9 | 0 | 0 | 0 |
| Crest Cert Template c4770672 | 9 | 0 | 0 | 0 |

- Every one of these games is disabled, dormant and must-move.
- Each has one table stranded at lifecycle `live`, status `closed`.

## Why they are ticked every pass

- `fn_cash_clusters_tick_all` treats `NOT enabled` as due every pass.
- It takes its games from `fn_cash_clusters_to_tick()`. That function admits a disabled game while any of its tables is non-terminal by either liveness field.
- `fn_guard_retired_club_mutation` is installed on `cash_games`, `tables`, `table_seats` and 30 other tables, so every one of those ticks is refused.

## Pre-image

- Installed `prosrc` md5 is `41a70819e205ce35986b60066f0ef484`.
- This equals the body in `20260921025523` in the repo.

## Probe (read-only SELECT of the new predicate)

- Old worklist: 83 games. New worklist: 47 games.
- Added: 0. Removed: 36, all of them retired-club games.

## Regression

- Without the migration, `tests/a-retired-club-leaves-the-cluster-tick-worklist.law.test.ts` fails 2 of 4 tests.
- With the migration, it passes 4 of 4.
- `law-registry` passes.
- The migration-convention suites pass. One test in this environment fails because the clone is shallow and is missing commit 4e9c3228; that failure is unrelated to this change.

## Unrelated finding in the same window

- At 05:45:13–05:45:45Z, 9 Lightning hands on host table `0f84a1ab` raised `post_commit_obligations_pending`. The errors were `predecessor_pending` and one `57014` statement timeout.
- All 9 have `post_commit_completed_at` within 31 s of committing. 0 were pending at 05:47Z.
- Cron job 272 `union-weekly-rakeback-close` started a run at 05:45:00.
- No money is outstanding.
