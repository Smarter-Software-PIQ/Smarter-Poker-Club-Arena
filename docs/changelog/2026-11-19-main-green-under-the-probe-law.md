# 2026-11-19 - Two merged, uninstalled migrations meet the probe law (lane E1)

`tests/a-migration-proves-its-functions-before-commit.law.test.ts` (required
check "Client Unit Tests (vitest)") went red on main after #11360 widened the
law to rewrites and late files. Neither offending file is installed on
production (`schema_migrations` has no 20261119013430 or 20261119015312), so
both are corrected in place before their install:

- `20261119013430_a_bounty_rebuy_never_pauses_the_tournament.sql` (lane B7):
  its three pre-image READS were literal `pg_get_functiondef('...'::regprocedure)`
  in a file that EXECUTEs, which the checker counts as rewrites. They read
  through `to_regprocedure(...)` now, compared with `IS DISTINCT FROM` so a
  missing function still refuses. Nothing it installs changes.
- `20261119015312_an_unanswered_club_welcome_is_unlisted_for_its_sender.sql`:
  `fn_get_user_conversations` is executed before COMMIT
  (`-- @probe-for`, unwinds with `probe-unwind`). A migration session is a
  trusted caller (`fn_caller_is_engine`); an unknown user's inbox is empty
  (read on production: 0 rows).

The third offender, `20261119054539` (lane E3), is fixed by #11371.
