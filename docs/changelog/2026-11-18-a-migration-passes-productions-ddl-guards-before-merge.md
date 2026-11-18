# A migration passes production's DDL guards before it merges (incident 075013fd)

**What broke.** Two merged migrations passed every check and were refused at install by guards that exist
only on production:

| PR | file | refused by | code |
| --- | --- | --- | --- |
| #11256 | `20261118034950` | the applier's stale-pin guard: `original_erased_cash_base_discharge` pins `b7911a24...`, the tally body the file rewrites | 55000 |
| #11266 | `20261118071728` | event trigger `ab_ca_money_rpc_registered` (`fn_ca_money_rpc_registry_guard`): `fn_ca_bank_pending_hand_obligations` writes balances and is not registered | 42501 |

The window rehearsal restores production's schema with `pg_dump -n`, which carries neither event triggers
(database-level objects) nor the rows they read, and it never ran the applier's in-transaction guard.

**The fix.** A `guards` job ("Production's DDL guards pass before merge") in
`window-migrations-install-before-merge.yml`:

- capture (default branch, `ci-main`, read-only, constant SQL in `scripts/ci/migration-guards-capture.mjs`):
  function md5s in both stale-pin forms, hex runs in installed sources, `pg_event_trigger`, and
  `COPY ... TO STDOUT` of `ca_money_rpc_registry` and `function_body_lineage` (about 0.5 s).
- guards (no secret): restore the copy, load those rows, re-create production's event triggers, install each
  changed migration through them and the applier's own `stalePinGuardSQL`
  (`scripts/ci/migration-guards-before-merge.mjs rehearse`). When a file cannot install on an empty schema,
  production's own classifiers decide statically.

**Coverage, from production's 21 event triggers (read 2026-11-18).** Re-created and run with their own logic:
`ab_ca_money_rpc_registered`, `ca_superseded_function_body_is_refused`, `ca_dropped_function_body_is_superseded`,
`ca_function_calls_must_resolve_at_commit` (and the commit-time resolution trigger it feeds),
`ca_release_freeze_refuses_mgmt_api_ddl` (inert off the management API), `trg_reject_retired_solver_option_rpc_ddl`,
`xp_ban_guard`, `trg_autorevoke_privileged_anon`, `trg_rls_on_new_public_table`, `trg_new_view_respects_the_caller`,
`trg_strip_client_writes_from_new_views`, `ca_ddl_watchdog_log`, `ca_ddl_watchdog_drop_log`. Not re-created:
`ca_break_window_refuses_ddl` / `_drops` (wall clock and session role, not content) and Supabase's six
`extensions.*` triggers (none refuses a migration; the image has its own). Applier-side: the stale-pin guard
is run; its admission and timing checks (live locks, :50 UTC cutoff, daily window, wallet-cutover preflight,
offline budget lock re-check, accounting admission) read live state, not file content, and stay at install.

**Proof.** `tests/unit/aMigrationPassesProductionsDdlGuardsBeforeMerge.pg.test.ts`: on native PostgreSQL built
from production's own definitions (fixtures `cash-rake-pending`, `hand-bank-pending`, `production-ddl-guards`,
every md5 asserted), the workflow's CLI fails #11256's and #11266's byte-exact originals and passes #11270's and
#11288's files. Law: `tests/a-migration-passes-productions-ddl-guards-before-merge.law.test.ts`.
