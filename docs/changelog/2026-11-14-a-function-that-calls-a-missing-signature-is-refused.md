# A function that calls a missing signature is refused when its migration commits

**Why.** On 2026-11-14 migration 20261114072509 patched `public.fn_mystery_bounty_seed` to call `public.fn_mystery_sealed_ladder_for_open(uuid, integer, bigint)` with `(SELECT sum((x->>'amount_cents')::bigint) ...)`. `sum(bigint)` is `numeric`, so the call named `(uuid, integer, numeric)`, which does not exist. Postgres accepted the CREATE because a PL/pgSQL body is not resolved until it runs; every mystery activation then raised 42883 and rolled back, and two live mystery bounty MTTs stopped dealing until 20261115001336 (#10884) cast the sum back. The migration's own `@live-proof` checked that the call text was present, and it was. Nothing asked whether the call resolved.

**What changed.** Migration `20261115020406_a_function_that_calls_a_missing_signature_is_refused_at_comm` makes the database ask. Every plpgsql function or procedure that a transaction creates or alters in `public` or `smarter_private` is checked with plpgsql_check at COMMIT. If any static call or operator in its body does not resolve (SQLSTATE 42883), the COMMIT fails with the function, the line and the missing signature, and the whole transaction rolls back. Nothing is installed and no history row is written.

- `smarter_private.fn_ca_unresolved_function_calls(regprocedure)` is the one question: the 42883 findings for one function. The guard uses it, and so does anyone auditing.
- Event trigger `ca_function_calls_must_resolve_at_commit` (CREATE/ALTER FUNCTION/PROCEDURE/ROUTINE) only queues the function's oid in `smarter_private.ca_function_resolution_queue`. The decision cannot be made at CREATE, because a migration may create A (which calls B) before B.
- Constraint trigger `ca_function_calls_must_resolve` on that queue is `DEFERRABLE INITIALLY DEFERRED`, so it runs at COMMIT, when the whole migration exists. It consumes its row, so the queue is empty after every transaction.
- Override, in the break-window style: `SET LOCAL ca.function_resolution_override = '<why>'` in the same transaction. It takes a reason, not a switch, and every function installed under it is recorded in the append-only `smarter_private.ca_function_resolution_overrides`.

**Measured on production before writing it (rolled-back probes, 2026-11-15).**

- plpgsql_check 2.7 has been installed since 20260421050703, in schema `public`, and is in `shared_preload_libraries`. `CREATE EXTENSION IF NOT EXISTS` is a no-op there.
- Every role carries `plpgsql_check.mode = disabled`. In that mode, an explicit `plpgsql_check_function_tb()` returns **no rows**, even for a function that plainly calls a missing signature. The helper therefore sets `plpgsql_check.mode = 'by_function'` on itself, and the law pins it.
- plpgsql_check honours a function's own `SET search_path`.
- 3,725 non-trigger plpgsql functions in scope were checked in 9.2 s. Six have a real latent unresolved call; none was a false finding. Those six are listed in the PR. They are not refused, because the guard judges only what a transaction installs. But re-creating one of them unchanged is now refused.

**Not checked, on purpose.** These are not checked:

- Supabase's own schemas, `pg_temp` probes and anything created by an extension script.
- Non-plpgsql, trigger, event-trigger and polymorphic functions.
- Dynamic SQL (EXECUTE and its forms). That is how a body deliberately defers resolution.
- A DROP or signature change of a callee.

A query on a temporary table is a 42P01 for the checker, never a 42883, so it is not refused. The audit inside the migration is bounded to 3 s, because the 12 s install budget would not survive the full 9.2 s pass.

**This also covers the World Hub.** Its migrations write to the same database, so they are covered too.

Pinned by `tests/a-function-that-calls-a-missing-signature-is-refused.law.test.ts`.
