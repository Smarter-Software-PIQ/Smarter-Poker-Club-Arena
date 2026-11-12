-- 20261112013925_a_rebuy_pays_the_starting_stack.sql
-- @install-window: daily-maintenance
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A REBUY PAYS THE STARTING STACK, EXACTLY (Dan 2026-11-11, verbatim): "ANY
-- TOURNAMENT THAT HAS A REBUY OR AN ADD ON, MUST 100% OF THE TIME ALWAYS AND
-- FOREVER GIVE THEM THE SAME AMOUNT OF CHIPS YOU START WITH FOR REBUYS AND
-- ADD ON'S."
--
-- Dan reported it live from the Nightly 20K (NLH): he rebought and received
-- 10,000 chips against a 15,000 starting stack. The money core
-- (fn_ca_process_tournament_chip_purchase_money_v1) already pays
-- COALESCE(NULLIF(rebuy_chips,0), starting_chips), so the one place the wrong
-- number can come from is tournaments.rebuy_chips. This is the rebuy twin of
-- zz_addon_pays_the_starting_stack (20261102005209, Dan 2026-11-01): a BEFORE
-- trigger pins rebuy_chips to starting_chips whenever rebuys or re-entries
-- are offered and a starting stack is set, on INSERT and on any UPDATE that
-- touches the deciding columns. Every writer - the engine's recurring boards,
-- the client's create forms, hand-run SQL - goes through it, so no
-- configuration path can reintroduce a short or oversized rebuy (CLAUDE.md
-- 10.11: fix at the root, not a sweep).
--
-- Trigger name order keeps the existing contracts intact: a3_bounty_mtt_*
-- and zz_freerolls_are_free_buy run first and may seed rebuy_chips; this
-- trigger runs after both (zz_r > zz_f > a3) and normalizes whatever they
-- seeded to the one authority, the starting stack. Players keep the contract
-- they registered under: an UPDATE on a registered event passes through
-- unchanged, exactly like the add-on twin.
--
-- The one-time correction of unfinished events and of the schedule configs
-- lives in 20261112013714 (immediate, row locks only). Finished events keep
-- their historical rebuy_chips: settled conservation arithmetic reads them,
-- and a settled record is never rewritten (CLAUDE.md 10.9).
--
-- LOCKS: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on tournaments, which live
-- play effectively always holds (the add-on twin was refused twice on a 2 s
-- lock timeout). Per CLAUDE.md DDL rule 10 this file installs in the daily
-- maintenance window, DDL only.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload (~28s), and loose statements mean repeated
-- reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION public.fn_ca_rebuy_pays_the_starting_stack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Dan 2026-11-11: a rebuy or re-entry pays the starting stack, exactly -
  -- never less, never more. The starting stack is the one authority; a
  -- configured rebuy_chips that disagrees is overwritten at write time, so
  -- the money core's COALESCE(NULLIF(rebuy_chips,0), starting_chips) can only
  -- ever pay the starting stack.
  -- Players keep the contract they registered under: trg_tournaments_managed_
  -- lifecycle_guard runs BEFORE this trigger (name order) and approves a
  -- no-op UPDATE, so without this check a SET that merely lists one of these
  -- columns could rewrite a registered event's rebuy behind the guard.
  IF TG_OP = 'UPDATE' AND EXISTS (
       SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF (COALESCE(NEW.is_rebuy, false) OR COALESCE(NEW.is_reentry, false))
     AND COALESCE(NEW.starting_chips, 0) > 0
     AND NEW.rebuy_chips IS DISTINCT FROM NEW.starting_chips THEN
    NEW.rebuy_chips := NEW.starting_chips;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS zz_rebuy_pays_the_starting_stack ON public.tournaments;
CREATE TRIGGER zz_rebuy_pays_the_starting_stack
  BEFORE INSERT OR UPDATE OF rebuy_chips, starting_chips, is_rebuy, is_reentry
  ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ca_rebuy_pays_the_starting_stack();

-- Declared in the same migration (check-money-trigger-declared).
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note)
VALUES('tournaments','zz_rebuy_pays_the_starting_stack',
  'Dan 2026-11-11: pins rebuy_chips to starting_chips on every rebuy/re-entry tournament write, so a rebuy pays exactly the starting stack.')
ON CONFLICT DO NOTHING;

COMMIT;
