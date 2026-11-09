# An Offline Migration May Declare A Longer Install Budget (2026-11-08)

**Owner instruction (2026-11-07 21:14 CT):** "CHANGE THE LIMIT, OVERCOME THE BLOCKER AND KEEP WORKING" - about the migration installer's 12-second transaction budget, which refused the V31 v2 SQL chain migration `20261108011659_v31_public215_v2_sql_encoding_chain` three times (runs 42437670477, 42437810344, 42441329582: `25P04` after ~12.3 s, nothing applied).

**Why the limit exists, and still does.** `apply-recorded-migration.mjs` runs an ordinary migration under `transaction_timeout = TRANSACTION_BUDGET_SECONDS + 4` (12 s). On 2026-11-02 an ordinary install's membership UPDATE held a payout row for 22.7 s and blocked live writers: anything an install locks, a live writer may be waiting on. That protection is unchanged for every file that touches live play or money, and for every file that does not declare otherwise - those keep exactly 12 s.

**What changed.** A migration may declare a larger budget on one line:

```
-- @install-budget-seconds: <n>      (13..60; 60 is a hard cap)
```

`scripts/ci/migration-install-budget.mjs` admits it only when, read statically over the whole file (function bodies, DO blocks and nested bodies included, with the repository's existing lexers `stripNoise` / `stripComments` and the window installer's `lockTargets`):

- every relation it writes, alters, locks or validates is `public.gto_v31_*` or `public.solver_*` (offline certification and solver stores no live writer waits on);
- every function it creates, replaces, alters, drops, grants or comments is a public `fn_gto_v31_*`, `fn_solver_*`, `ca_gto_v31_*`, or `fn_horse_solver_agreement_v31_public215_*` (the owner-only public215 branch of the V31 solver-agreement validator, which the v2 chain patches; replacing a function body takes no lock a live writer waits on);
- it sets `SET LOCAL lock_timeout <= 2s` in the SET LOCAL lines right after `BEGIN;` and never raises, disables, resets or `set_config`s it, so it can never queue behind live writers;
- it uses none of the constructs the reader cannot bound (`DROP ... CASCADE`, `FOR UPDATE/SHARE` row locks, DDL on schemas/roles/extensions/domains, `ALTER DEFAULT PRIVILEGES`, `VACUUM/CLUSTER/REINDEX`, `GRANT ... ON ALL`, its own transaction control);
- its version is at or after `PIN_CHECKED_FROM` (20261108000000), so the stale-pin function snapshot exists.

Dynamic SQL (`EXECUTE`) and functions called at install time cannot be read statically, so for a declared file the installer also splices a check into the transaction, right before the history row and `COMMIT`: if the transaction holds any lock stronger than `ACCESS SHARE` on a relation outside the allowlist (indexes and TOAST resolved to their table), or created/changed/dropped a function outside the function allowlist, it raises `install_budget_outside_offline_scope` and everything rolls back.

`assertOrdinaryMigrationBudget` (`migration-session-identity.mjs`) now refuses any pairing other than "undeclared file, exactly 12 s" or "declared file, exactly its admitted budget", and still refuses a file whose own `transaction_timeout` exceeds that budget. A declaration on a non-ordinary route (window, settlement lane, accounting admission, thaw repair) is refused rather than ignored.

**Tests.** `tests/unit/migrationInstallBudget.test.ts`: the admitted case; refusals for a live table written at top level, in a DO block, in a function body, altered, locked, referenced by a foreign key, given a trigger, unqualified, in another schema, second in a TRUNCATE list; a live function replaced or granted; row locks; `DROP ... CASCADE`; over the cap; missing, too-long, disabled, late, non-LOCAL, raised, reset and set_config'd lock_timeout; malformed, repeated and pointless declarations; a pre-snapshot file version; an undeclared file gets exactly 12 s; mismatched caps are refused; every committed migration that declares a budget is admitted. Native (`scripts/ci/test-maintenance-window-migrations.sh` section 13, PostgreSQL 17, the real applier over verified TLS): a declared offline file sleeping 13.5 s installs; the same file undeclared is killed by `25P04` at ~12 s with nothing committed; a declared file writing `public.clubs` is refused before anything is sent; a declared file reaching `public.clubs` through `EXECUTE` is rolled back by the in-transaction check.

**Not changed.** The budget of every undeclared migration, the window route's 8 s closing assertion and 1 s lock_timeout, the settlement/accounting/thaw admissions.
