-- 20261102024023_unfinished_add_ons_pay_the_starting_stack.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- AN ADD-ON PAYS THE STARTING STACK, EXACTLY (Dan 2026-11-01, verbatim): "AN
-- ADD ON CAN NEVER EXCEED THE AMOUNT OF CHIPS THAT THE TOURANMENT STARTED
-- WITH, THE ADD ON SHOULD THE SAME AMOUNT OF CHIPS THAT YOU START WITH IN THE
-- TOURNAMENT, NEVER LESS!"
--
-- The money core (fn_ca_process_tournament_chip_purchase_money_v1) pays
-- COALESCE(NULLIF(addon_chips,0), starting_chips). Every creator now writes
-- addon_chips = starting_chips (#9249), and 20261102005209 installs the
-- trigger that pins it on every write - but that trigger needs a table lock
-- the live engine never releases during play, so it installs in the daily
-- maintenance window. This immediate migration corrects the rows that exist
-- now: every add-on tournament that has not ended, so no player who adds on
-- before the window is paid anything but the starting stack.
--
-- Row locks only (ROW EXCLUSIVE on tournaments, compatible with the engine's
-- own writes). Finished events keep their historical addon_chips: settled
-- conservation arithmetic reads them and a settled record is never rewritten
-- (CLAUDE.md 10.9). A short lock_timeout refuses cleanly instead of queueing
-- behind a live row; apply once, never in a retry loop.
--
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.add_on_available IS TRUE AND t.ended_at IS NULL AND COALESCE(t.starting_chips,0)>0 AND t.addon_chips IS DISTINCT FROM t.starting_chips AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id = t.id))

BEGIN;

SET LOCAL lock_timeout = '2s';

-- Only events nobody has registered for. fn_guard_managed_game_lifecycle
-- refuses any change to an event after a player registers (first attempt,
-- run 41383172175, refused with nothing applied): players keep the contract
-- they entered under, and those events finish on their advertised add-on.
UPDATE public.tournaments t
   SET addon_chips = t.starting_chips
 WHERE t.add_on_available IS TRUE
   AND t.ended_at IS NULL
   AND COALESCE(t.starting_chips, 0) > 0
   AND t.addon_chips IS DISTINCT FROM t.starting_chips
   AND NOT EXISTS (
     SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id = t.id);

COMMIT;
