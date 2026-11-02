-- 20261102005209_an_add_on_pays_the_starting_stack.sql
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
-- Dan reported it from a live break card: the Sunday Funday Big Stack add-on
-- offered 80,000 chips against its starting stack. The money core
-- (fn_ca_process_tournament_chip_purchase_money_v1) already pays
-- COALESCE(NULLIF(addon_chips,0), starting_chips), so the one place the wrong
-- number can come from is tournaments.addon_chips. This migration makes that
-- column INCAPABLE of disagreeing with starting_chips on an add-on tournament:
--
--   1. A BEFORE trigger on public.tournaments pins addon_chips to
--      starting_chips whenever add-ons are available and a starting stack is
--      set, on INSERT and on any UPDATE that touches the three deciding
--      columns. Every writer - the engine's recurring boards, the client's
--      create forms, hand-run SQL - goes through it, so no configuration path
--      can reintroduce an oversized or undersized add-on (CLAUDE.md 10.11:
--      fix at the root, not a sweep).
--
--   2. A one-time backfill corrects every tournament that has not ended.
--      Finished events keep their historical addon_chips: settled
--      conservation arithmetic (RakebackSettlerService's chips-in-play
--      estimate) reads them, and a settled record is never rewritten
--      (CLAUDE.md 10.9).
--
-- This supersedes the Free Buy's deliberate 10,000-chip add-on on a 3,000
-- stack (server/src/services/FreeBuy.ts, changed in the same commit): Dan's
-- 2026-11-01 ruling is categorical, "any and all" tournaments.
--
-- LOCKS: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on tournaments, which is not
-- one of the three daily-window tables (clubs/tables/hand_history) and whose
-- writers are short transactions. lock_timeout is set so a busy moment refuses
-- this migration cleanly instead of queueing behind live play (CLAUDE.md
-- DDL policy rule 9); apply it once, never in a retry loop.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.fn_ca_addon_pays_the_starting_stack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Dan 2026-11-01: an add-on pays the starting stack, exactly - never less,
  -- never more. The starting stack is the one authority; a configured
  -- addon_chips that disagrees is overwritten at write time, so the money
  -- core's COALESCE(NULLIF(addon_chips,0), starting_chips) can only ever pay
  -- the starting stack.
  IF COALESCE(NEW.add_on_available, false)
     AND COALESCE(NEW.starting_chips, 0) > 0
     AND NEW.addon_chips IS DISTINCT FROM NEW.starting_chips THEN
    NEW.addon_chips := NEW.starting_chips;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS zz_addon_pays_the_starting_stack ON public.tournaments;
CREATE TRIGGER zz_addon_pays_the_starting_stack
  BEFORE INSERT OR UPDATE OF addon_chips, starting_chips, add_on_available
  ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ca_addon_pays_the_starting_stack();

-- Declared in the same migration (check-money-trigger-declared).
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note)
VALUES('tournaments','zz_addon_pays_the_starting_stack',
  'Dan 2026-11-01: pins addon_chips to starting_chips on every add-on tournament write, so an add-on pays exactly the starting stack.')
ON CONFLICT DO NOTHING;

-- One-time correction for every event that has not ended. The trigger above
-- normalizes the rows as this UPDATE touches them; the WHERE keeps the write
-- set to the rows that are actually wrong.
UPDATE public.tournaments
   SET addon_chips = starting_chips
 WHERE add_on_available IS TRUE
   AND ended_at IS NULL
   AND COALESCE(starting_chips, 0) > 0
   AND addon_chips IS DISTINCT FROM starting_chips;

COMMIT;
