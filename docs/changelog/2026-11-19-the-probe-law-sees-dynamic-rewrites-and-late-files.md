# The probe law sees dynamic rewrites and late files (2026-11-19)

Two ways a migration could still redefine a SECURITY DEFINER PL/pgSQL function
without executing it before COMMIT (law from #11337):

1. **Rewriting the live text.** The anchored-edit pattern,
   `EXECUTE replace(pg_get_functiondef('schema.fn(args)'::regprocedure), ...)`,
   redefines a function with no `CREATE FUNCTION` in the file, so the checker
   never saw it. Open PR #11352 (`fn_lightning_top_up_request`) passed that way.
   A file that EXECUTEs dynamic SQL and reads `pg_get_functiondef` of a
   public/smarter_private function now owes that function a probe (or a named
   `-- @probe-exempt`, e.g. for a trigger function). Reading a definition
   without executing anything is not a redefinition.
2. **A late file with an old version.** The law bound files by version number
   (>= 20261119030000). On 2026-11-19, 94 open PRs carried redefinitions
   versioned before that cutoff, so each would have merged unproven. The law
   now binds every file except the 6,992 that were on main before it existed
   (`scripts/ci/probe-law-grandfathered-migrations.txt`, frozen; every one is
   installed, including five merged after the law with sub-cutoff versions:
   20261118194330, 20261119002019, 20261119002137, 20261119011750,
   20261119014500, confirmed in `supabase_migrations.schema_migrations`). The
   test pins the list's size so it can never grow.

No file on main is newly flagged. Pinned by
`tests/a-migration-proves-its-functions-before-commit.law.test.ts` (13 cases).
