# The unsettled rake sweep takes its lane through the helper again (2026-11-18)

Found while auditing the rathole-floor change: `The lane doctrine holds on the live catalog` went red on main at 07:20 UTC and stayed red.

## What happened

Incident 758cd269 replayed `20260826_tournament_rake_settlement_integrity.sql` against production at 06:16 UTC. The repair (`20261118071742`, PR #11264) restored `fn_sweep_unsettled_tournament_rake` from the newest file that defines it, `20260909014534`. That file's body takes the global settlement lane directly (`pg_advisory_xact_lock(hashtextextended('ca:tournament-terminal-settlement:v1', 0))`). The pre-incident live body did not: `20260910035435` rewrote it in place, inside a DO block, to `PERFORM public.fn_ca_lock_settlement_lane_global();`. No migration file contains the rewritten body, so a restore that reads files cannot find it.

`fn_ca_settlement_lane_doctrine()` read on production at 08:01 UTC: `ok=false`, `g_exclusive_only_by_helpers` found `fn_sweep_unsettled_tournament_rake`.

## Why it matters

The helper does two things the raw lock does not. It takes the hand-settlement barrier (`ca:hand-settlement-barrier:v1`) as well, so the sweep is serialised against hand settlements. Inside a non-satellite finish it also re-enters the finish lane it already holds, instead of asking for the global lane exclusively, which would upgrade a shared hold: the 2026-09-10 deadlock. Nothing calls the sweep today (no cron job, no function, no engine code), so no run happened with the wrong body.

## Fix

`20261118080240` applies exactly the `20260910035435` rewrite to this one function, with the same refusals: exactly one raw site, the rewrite must change the body, and no direct use of the global key may remain. Before committing, it asks `fn_ca_settlement_lane_doctrine()` and refuses unless the answer is `ok=true`. Re-applying it is a no-op once the helper is in place.

Read-only pre-check on production: one raw site, rewrite changes the body (44 characters shorter), uses the helper, no raw key remains. The new body's fingerprint (`smarter_private.fn_ca_body_fingerprint`) is not in `smarter_private.function_body_lineage`, so the superseded-body guard from `20261118072356` accepts it.

## For the next restore

A function rewritten by a DO block (`regexp_replace` + `EXECUTE`) has no file holding its final body. Any restore-from-files has to re-run those rewrites, or read the body back from a backup, not from the newest `CREATE OR REPLACE`.
