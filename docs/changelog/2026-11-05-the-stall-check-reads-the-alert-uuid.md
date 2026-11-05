# The stall check reads the alert uuid

`fn_ca_engine_release_stall_check` (2026-11-02) stored the open page's id in a
`bigint`, but `financial_alerts.id` is a uuid. After it raised its first page
(2026-11-02 16:23Z) every hourly run failed with "invalid input syntax for type
bigint" (73 of 74 runs), so that page never resolved after new engines led and a
new stall could not page.

- Migration `20261105181559` changes only `v_open bigint` to `v_open uuid`,
  guarded by the exact md5 of the installed body; signature, settings, grants
  and the hourly cron job are unchanged.
- The native proof's `financial_alerts` fixture now uses a uuid id like
  production and runs both migrations in order. Against the old body alone it
  reproduces the production error (line 46); with the fix all 10 behaviours pass.
- After install, the next :23 run resolves the 2026-11-02 page against the
  engine that now leads.
