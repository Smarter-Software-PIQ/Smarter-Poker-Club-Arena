# 2026-11-07 - A Freeze Refusal Is Counted By Name

Dan, after his NLH and PLO Lightning joins were refused at 13:20 Chicago: "HOW ELSE CAN THIS BE IMPROVED, ENHANCED OR OPTIMIZED STILL SO THIS NEVER HAPPENS AGAIN?"

## What the alarms saw

Nothing. His browser did report the refusals: `client_error_events` holds them for user 47965354 (1 occurrence at 19:20:07 and 9 more at 19:21:06 UTC), source `LightningEntryPage.buyin_context_failed`. They were filed as code `P0001`, the code every plpgsql `RAISE` shares, so `fn_client_error_health` could not tell a freeze refusal from any other refusal. And `ClientErrorSpike` is silenced during maintenance by design. A real player refused by a freeze left no measured trace.

## Fix

- `src/utils/errorReporter.ts`: `pickCode` files any freeze refusal (`isPlatformFrozenError`: code 55006, or a `PLATFORM_FROZEN` message/reason) as `PLATFORM_FROZEN`.
- Migration `20261107210000_a_freeze_refusal_is_counted_by_name.sql`: `fn_client_error_health` adds `freeze_refusals_10m` and `freeze_refusal_users_10m` after its original three columns. A freeze refusal is code `PLATFORM_FROZEN`, `55006`, or a `P0001` whose message starts `PLATFORM_FROZEN` (bundles published before this change). Automated sessions and horses are excluded. The `ClientErrorSpike` top code no longer counts freeze refusals: they are expected while a freeze holds and now have their own gauge.
- `server/scripts/collect-monitoring-health.sh`: renders `poker_client_freeze_refusals_10m` and `poker_client_freeze_refusal_users_10m` only when both columns are present, so an older database never drops the original gauges.
- `infra/monitoring/alert-rules.yml`: info alert `PlayersRefusedDuringFreeze` (`poker_client_freeze_refusal_users_10m >= 1`). Info routes to the operational intake (`operational_alert_events`) and to nobody's inbox: a record, not a page.
- `docs/runbooks/client-errors.md` names the code and the gauges.

Measured against today's data with the new function's exact query at 19:21:30 UTC: 12 freeze refusals from 2 real players, where the old function counted none as a freeze.

The migration installs on merge through `apply-merged-migration.yml`; the collector change ships with the engine release.
