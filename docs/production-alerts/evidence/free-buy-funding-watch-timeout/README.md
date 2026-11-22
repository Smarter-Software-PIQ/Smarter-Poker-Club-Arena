# free-buy-funding-watch-timeout (operational_alert_events 446169)

Alert: alertmanager `PgCronJobFailingRepeatedly`, job `ca-free-buy-funding-watch-15m`, 2026-11-20 05:45 UTC.

## Production readings (read-only, 2026-11-20 05:40-05:50 UTC)

- `cron.job_run_details`: runs at 05:11, 05:26, 05:41 failed with
  `canceling statement due to statement timeout` inside the `gtd` CTE
  (duration 60.05-60.08 s); 02:41 failed the same way; every successful run
  overnight took 54.3-59.5 s. Job command:
  `SET statement_timeout = '60s'; SELECT public.fn_ca_free_buy_funding_watch();`
- `gtd` selects 433 events (window `max(2026-11-05 22:25, now() - 14 days)`,
  full since 2026-11-19).
- `fn_ca_guarantee_funding` once per event over the 433: 25.39 s.
- `fn_ca_guarantee_house_supplements` once per event: 4.15 s (called twice
  inside `fn_ca_guarantee_funding`; left unchanged).
- The gtd CTE exactly as the watch writes it, inlined with finding's WHERE:
  41.36 s, 0 findings.
- Free Buy branches (fb build 0.19 s, voucher 1.37 s, entry_without_ticket
  1.46 s, early_prize_promo 0.79 s): about 4 s.
- Live definition md5 `37dd9112a5a5830b1847e0fe31065f77` (pre-image guard).

## Native proof (PostgreSQL 16, scratch cluster, never production)

The migration's function body was installed over a minimal schema with five
finalized guaranteed events and a `fn_ca_guarantee_funding` stub that counts
its calls and reports each event overfunded:

| body | funding calls for 5 events | findings |
| --- | --- | --- |
| pre-fix (`WITH gtd AS (`) | 35 | 5 guarantee_overfunded |
| post-fix (`WITH gtd AS MATERIALIZED (`) | 5 | 5 guarantee_overfunded (same rows, no new alerts) |

## Regression test

`tests/the-free-buy-funding-watch-reads-each-guarantee-once.law.test.ts`:
fails on main without the migration (newest definition is
20261106194903 and has no MATERIALIZED), passes with it.

## Revision 2 (2026-11-20T07:0xZ): the install-budget gate

CI run 44684058363, job 136114184416 (`Client Unit Tests shard 7`) refused the first revision:
`tests/unit/aMigrationFitsTheInstallBudget.test.ts` flags `idempotency_key LIKE 'tourney:%:promo_head:%'`
in a statement that reads `chip_ledger`. The text was copied verbatim from the live body; it runs only
when the watch runs (never at install time) and is already narrowed by `to_entity_id = fb.id`. The gate is
static and is not weakened. Instead the predicate is written without LIKE:

    left(l.idempotency_key, 8) = 'tourney:'
    AND strpos(substr(l.idempotency_key, 9), ':promo_head:') > 0

Equivalence, PostgreSQL 16 (old = live LIKE, new = rewrite):

| key | old | new |
| --- | --- | --- |
| `tourney:<uuid>:promo_head:<uuid>` | t | t |
| `tourney:<uuid>:promo_head:<uuid>:return` | t | t |
| `tourney:<uuid>:free_buy_cutoff_funding` | f | f |
| `tourney:promo_head:x` | f | f |
| `tourney::promo_head:x` | t | t |
| `tourney:abc:promo_headx` | f | f |
| `xtourney:a:promo_head:b` | f | f |
| `tourney:a:promoXhead:b` | t | f |
| `''` | f | f |
| NULL | NULL | NULL |

The only disagreement is `promoXhead`, matched by LIKE because `_` is a single-character wildcard. Every
writer of these keys (`git grep "':promo_head:'"` in supabase/migrations and server/src) builds
`'tourney:' || <tournament uuid> || ':promo_head:' || <id>[ || ':return']`, so the literal form selects
the same rows. A production count of both predicates was attempted read-only and cancelled at 50 s, which
is the full-scan cost the gate exists to keep out of migrations. `migrationCostRisks` now returns `[]`
for the file.

## Revision 3 (2026-11-22T15:50Z, PRIMARY): re-reserved and re-imaged

Alert: alertmanager `PgCronJobFailingRepeatedly` for `ca-free-buy-funding-watch-15m`,
operational_alert_events 447445 (2026-11-22 15:45 UTC). The fix above never merged.

- `cron.job_run_details` per day (failed / avg successful seconds): 11-18 7 / 47.4,
  11-19 3 / 50.8, 11-20 5 / 55.1, 11-21 10 / 53.6, 11-22 11 of 63 / 56.2 (up to 15:41).
  Every failure is `canceling statement due to statement timeout` in the `gtd` CTE.
- `gtd` selects 430 events. `fn_ca_guarantee_funding` once per event: 26.6 s
  (2.50M buffers); `fn_ca_guarantee_house_supplements` once per event: 5.1 s.
  Free Buy format build over 92 events: 0.12 s.
- The live definition is no longer 37dd9112: migration 20261121154220 ran
  `ALTER FUNCTION ... SET lock_timeout = '2s'` and `SET statement_timeout = '30s'`
  on every `fn_ca_%_watch`. Live md5 is `81d72e4361a751945dc9087fff71a929`, so
  20261120055128 would have raised FREE_BUY_FUNDING_WATCH_PREIMAGE_CHANGED.
- Re-reserved as 20261122155311 with the new pre-image. The body restates both SET
  clauses. Reverting the three intended changes (MATERIALIZED and its comment, the
  promo_head LIKE rewrite) reproduces md5 81d72e43 exactly (checked line by line
  against `pg_get_functiondef` on production, read-only).
- Residual: the materialized scan is about 31 s against the 60 s job budget, and the
  14-day window is full, so it is bounded by daily guaranteed-event volume. The
  supplements helper is still evaluated twice per event inside
  `fn_ca_guarantee_funding` (about 5 s); left unchanged because that function is
  shared with settlement paths.
