# Incident 758cd269 - TournamentFinishRefusalsPersisting (reason=rake_attribution)

**Window:** 2026-11-18 06:16 UTC (break) -> 07:17 UTC (restored) -> 07:21 UTC (alert resolved).
**Impact:** every tournament finish refused for about an hour (21 refusals / 15 min). No chips moved: the terminal finish refuses before commit. Decided tournaments sat RUNNING until restore, then completed on engine retry with rake attributed.

## Root cause
A pooler session as `postgres` ran `supabase/migrations/20260826_tournament_rake_settlement_integrity.sql` twice (06:16:54, 06:19:53), statement by statement, with no top-level transaction. That file was applied on 2026-08-27 and **recorded as 20260827011455**, so its filename version `20260826` is not in `schema_migrations` and it looks pending to anyone comparing filenames to recorded versions. The replay:

| Object | Effect |
|---|---|
| `fn_settle_tournament_rake(uuid,text)` | back to the pre-attribution body; never sets `attributed_at`/`attributed_users`, so `fn_complete_tournament_terminal_pre_seat_guard` raised `rake attribution did not complete` for every finish |
| `fn_sweep_unsettled_tournament_rake`, `fn_unregister_from_tournament(uuid)`, `atomic_cancel_tournament` | August bodies |
| `process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer)` | **resurrected** (dropped by 20260828021009), EXECUTE to PUBLIC/anon |
| `atomic_cancel_tournament` ACL | re-granted to `authenticated` |

Separately, at 06:24:40 a management-API statement (`-- Apply migrations`) re-created `fn_club_card_figures(uuid)` (dropped by 20261117195710) and regressed `fn_club_share_figures(uuid)` to the 20261117212227 body.

## Fix (all applied, all asserted by md5)
- `20261118071742` restores the four bodies from the exact statements their latest recorded migrations applied, restores ACLs, drops the resurrected overload.
- `20261118071947` restores `fn_club_share_figures` to 20261118002641 and re-drops `fn_club_card_figures`.

## Hardening - why it cannot happen again
`20261118072356` installs `smarter_private.function_body_lineage` (fingerprint of every body every public/smarter_private function has ever had, seeded from all 7,357 recorded migrations) and the event trigger `ca_superseded_function_body_is_refused`. Any `CREATE FUNCTION` that writes back a superseded body, by any tool or person, through psql, the pooler, the management API or a migration, is refused with SQLSTATE 55000 `SUPERSEDED_FUNCTION_BODY_REFUSED`. Re-creating a dropped function's old body is refused the same way. A deliberate rollback must say so: `SET LOCAL ca.allow_function_rollback = 'public.fn_name';`. Verified live with a rolled-back probe (new body ok, replay refused, idempotent re-apply ok, explicit rollback ok, resurrection refused). `tests/config/aSupersededFunctionBodyIsRefused.law.test.ts` pins it.

## Not reverted (noted)
- `fn_execute_tournament_terminal_request(uuid,uuid)` was changed at 05:03 UTC through the management API, outside any migration: it is the recorded 20261103115836 body plus a maintenance-freeze and advisory-lock-order prelude. Additive, so kept live; it should be adopted into a migration by its author.
- `notice_board_entries`, `notice_board_agents`, `fn_escalate_cashout_to_notice_board` were also created outside migrations (05:08-06:12).
- The actor of the 06:16 replay could not be named: the pooler hides the client. It was not CI (`apply-recorded-migration.mjs` refuses 8-digit versions and records what it applies), `supabase db push`, or the install-window job.

## Runbook - TournamentFinishRefusalsPersisting reason=rake_attribution
1. Dry-run one stuck finish in a transaction that always aborts and read the exact refusal text.
2. If it is `rake attribution did not complete: {ok:true ...}`, the settle function no longer attributes: compare `md5(prosrc)` of `fn_settle_tournament_rake` with its latest recorded migration body.
3. Query `smarter_private.function_body_lineage` and the Postgres DDL log for the window to find what changed.
