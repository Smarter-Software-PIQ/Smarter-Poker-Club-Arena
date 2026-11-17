-- 20261117051330_enable_horse_play_styles.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
--
-- Needs ACCESS EXCLUSIVE (or SHARE / SHARE ROW EXCLUSIVE) on a hot table such as
-- clubs, tables or hand_history? Then it waits for the daily 04:00 America/Chicago
-- break (CLAUDE.md section 2 rule 10). Declare it with the rule's header line
-- "install-window: daily-maintenance" (prefixed "-- @", on a line of its own),
-- and optionally name the hot relations this file locks on a second header
-- line "locks: public.clubs, public.tables" (same "-- @" prefix, comma
-- separated, schema-qualified) so the installer sends files sharing a relation
-- together. The locks line orders only; it never widens a timeout.

BEGIN;

-- your change here

COMMIT;
