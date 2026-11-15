# The dormant broken functions resolve or are retired (2026-11-15)

The commit-time function guard (20261115020406) refuses any new plpgsql
function that calls a signature that does not exist. Its one-off audit of the
functions already installed found six that would raise 42883 the first time
they ran. This change repairs two of them. The final-table deal trio and the v2
place-batch branch of `fn_tournament_finish_readiness` are repaired in their own
change.

## `fn_gto_v31_promote_dataset_epoch(uuid,text,text)`

The function is pinned to `search_path = public` but hashes the epoch checksum
with `digest(text, text)`, which pgcrypto installs in schema `extensions` here.
Promoting any V31 dataset would therefore fail on its last step, after the
whole evaluation had passed. Nothing calls it today because the V31 program is
parked (20261107130621). The re-open condition of that parking is a promotion,
so the defect would have appeared the first time V31 was allowed to succeed.

Fix: the function's own search_path now includes `extensions`. The body is
unchanged. Before writing the migration, a `pg_temp` copy of the live
definition was run through the guard helper: 2 unresolved calls with the
current search_path, 0 with `extensions` added.

## `pgmigrate(text)`

This was a one-line wrapper, `RETURN public.exec_sql(p_sql)`, around the
arbitrary-SQL executor that 20260908042700 dropped on purpose. It still held an
EXECUTE grant to service_role, and nothing in the repo or the database calls
it. As written it could only ever raise 42883, and if anyone ever recreated an
`exec_sql`, it would have exposed that executor again under a second name. It
is retired the same way `exec_sql` was.

Migration: `20261115051140_the_dormant_broken_functions_resolve_or_are_retired.sql`.
Test: `tests/unit/theDormantBrokenFunctionsResolve.test.ts`.
