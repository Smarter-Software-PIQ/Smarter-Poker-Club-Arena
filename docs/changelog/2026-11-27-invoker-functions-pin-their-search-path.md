# Invoker Functions Pin Their Search Path (2026-11-27)

## What Was Wrong

The Supabase advisor listed 37 production functions with no fixed search_path (function_search_path_mutable). None is SECURITY DEFINER, so none runs with more rights than its caller, but each resolved unqualified names through whatever path the caller had set. One of them, `fn_escalate_cashout_to_notice_board`, writes to an unqualified `notice_board_entries`, so a session holding a temporary table of that name could make it write there instead of to the notice board. Nothing stopped a future migration from creating an owner-rights function with the same gap.

## The Change

**Migration:** `supabase/migrations/20261127005018_invoker_functions_pin_their_search_path.sql`

23 of the 37 get `SET search_path = public, pg_temp`. Each body was read first: all resolve only built-ins and public objects. The migration records every EXECUTE grant before the ALTERs and refuses to commit if any changed, and it declares the change to `fn_ca_guard_watchlist`, which is itself on the guard watch. Absent functions are skipped by name (to_regprocedure).

14 stay unpinned on purpose, each named with its reason in the header:

- five procedures that COMMIT in their bodies (a SET clause makes the first COMMIT fail);
- three sealed `fn_gto_v31_public215_*` functions, whose definitions and settings feed the seal qualification fingerprint;
- six SQL helpers that production's planner inlines on hot or set-oriented paths (club history snapshot predicates, the union P&L tournament entry and touched-registration helpers, the messenger continuity filter, the Diamond kind bucket). A SET clause stops inlining; measured locally at about 10x on a per-row predicate.

**Law:** `tests/a-definer-function-pins-its-search-path.law.test.ts` fails if a migration from 2026-09-01 on creates or alters a SECURITY DEFINER routine without SET search_path, or puts a SET clause on a procedure that COMMITs. It also fails if a later migration redefines one of the 23 without SET search_path, because CREATE OR REPLACE would drop the pin.

**Test:** `tests/unit/invokerFunctionsPinTheirSearchPath.pg.test.ts` installs the migration on a scratch PostgreSQL and shows a temporary `notice_board_entries` no longer shadows public, results and grants are unchanged, the exemptions stay unpinned, a grant change rolls everything back, and a pinned committing procedure fails.

## What Did Not Change

No EXECUTE grant is revoked or added. The two owner-rights views (`tournament_players_public`, `ca_closed_player_labels`) stay as they are: migration 20261110051146 made them owner-rights deliberately, so they can mask closed persons and read placements that anon cannot read from profiles.
