# A migration proves its functions before it commits (2026-11-19)

## What happened

20261118164000 redefined `public.fn_cash_capture_hand_manifest` with
`FROM jsonb_array_elements(v_chairs) x` beside a PL/pgSQL loop variable named
`x`. CREATE FUNCTION checks syntax only, so the migration installed cleanly;
PL/pgSQL refused the ambiguous reference (42702) the first time the engine
called it, and every hand manifest capture failed from 20:12:48 to 21:04:56
UTC (incident d2d79c4f, about 750 hands left without seating proof;
repaired by 20261118202500). CI never executed the body, the window rehearsal
could not restore that afternoon, and the freeze kept anyone from running it.

## What changes

1. **Install-time proof.** From `20261119000000`, a migration that creates or
   replaces a SECURITY DEFINER PL/pgSQL function in `public` or
   `smarter_private` runs it before COMMIT in a `-- @probe-for: schema.fn`
   DO block that always unwinds with `'probe-unwind'`. Any other error, the
   function's own refusal included, re-raises and rolls the whole migration
   back, so a body that cannot run never reaches production. The pattern is
   `scripts/ci/templates/function-probe.sql`; a function that cannot run
   without an effect outside the transaction names a reason in
   `-- @probe-exempt:`. Checker: `scripts/ci/migration-function-probes.mjs`;
   law: `tests/a-migration-proves-its-functions-before-commit.law.test.ts`.
2. **Static check before merge.** The window rehearsal now runs
   `scripts/ci/plpgsql-check-changed.sh` after installing the queue into its
   copy of production's schema: plpgsql_check prepares every statement of
   every PL/pgSQL function the pull request defines, on every path, and fails
   on an error (warnings print). A function it cannot judge is named
   UNCHECKED, never passed silently. Because the rehearsal runs the default
   branch's tooling, `plpgsql-check-catches-a-body-that-cannot-run.yml`
   proves the script on the pull request that changes it: the 2026-11-18
   defect must fail with 42702 and its repair must pass.

## Limits

A probe proves the path its arguments reach; plpgsql_check covers the rest
statically. Trigger and event-trigger functions are not probed by call; the
static check covers a trigger function attached to a table and names the rest.
