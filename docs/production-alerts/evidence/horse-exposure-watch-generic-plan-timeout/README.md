# horse-exposure-watch-generic-plan-timeout

Production Alerts rows 446831 (`PgCronJobFailingRepeatedly`) and the `fn_ca_cron_failure_watch` rows after it (446810, 446811, 446845, 446852).

## Symptom (pg_cron `cron.job_run_details`, read 2026-11-21 18:46Z)

`ca-horse-exposure-watch-hourly` failed at 16:17, 17:17 and 18:17 UTC, with no success all day:

    ERROR: canceling statement due to statement timeout
    CONTEXT: SQL function "fn_ca_horse_exposure_hands" statement 1

## Root cause (read-only EXPLAINs on production, 2026-11-21 18:4xZ)

- The live helper is `LANGUAGE sql`, `STABLE`, with `SET search_path`. A function with a SET clause is never inlined, so its body is planned with `p_at` as a parameter, which gives a generic plan.
- `EXPLAIN (GENERIC_PLAN)` of the full body: `Parallel Index Scan using idx_hand_history_created on hand_history` (every hand in the 60 days) with `has_human AND tournament_id IS NULL AND bomb_pot IS NULL AND game_variant = ANY ('{plo4,plo5}')` as a heap filter, estimated at 53 rows per worker.
- The same scan with known timestamps uses `Index Scan using idx_hand_history_human_created`, estimated at 25,158 rows.

## Fix measured (temporary `pg_temp` copy of the fixed helper on production, read-only)

`SELECT ... FROM pg_temp.probe_exposure_hands(now(), 100000)` returned 26,257 seats in 25,477 hands, sum x_ev 1316.31, in 20.7 s. The watch allows 120 s and the cron 150 s. Before the fix, the helper did not finish within 120 s.

## Native proof (PostgreSQL 16 locally; CI runs 17)

`scripts/ci/test-a-person-beating-the-horses-reaches-production-alerts.py` installs 20261121011654, then 20261122094628, and runs every case against the fixed helper: 14 passed.

## Law

`tests/the-horse-exposure-hands-are-planned-for-their-own-window.law.test.ts`: 5 tests pass on the fix. On pre-fix main it fails, because the fixed definition is absent.

## Re-versioned 2026-11-22

First built on 2026-11-21 as 20261121184753, then 20261121204642; neither was pushed (the cloud lane's push was refused). Re-reserved as 20261122094628 by `scripts/new-migration.mjs` on `bb9ca31bf`. The watch was still failing at 09:17Z on 2026-11-22 (`cron.job_run_details`, same statement timeout). On this tree: native proof on PG16 14 passed; this law 5/5; law registry 1889/1889.
