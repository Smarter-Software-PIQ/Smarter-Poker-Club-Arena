-- Version reserved by scripts/new-migration.mjs.
-- @install-window: daily-maintenance
-- @locks: public.tournaments
--
-- Dan 2026-11-11: every rebuy/reentry and add-on pays the starting stack.
-- The prior functions exempted every registered UPDATE, including service
-- writes which the managed lifecycle guard admits. UPDATE OF lists also miss
-- awards seeded by an earlier producer trigger from another input column.
--
-- Normalize new/unregistered contracts. Once registered, never silently
-- rewrite a historical contract: a deciding-field transition that would
-- introduce a mismatch is refused atomically, including service writes.
-- A no-op preserves old settled supply. No data, wallet, price or fee moves.
-- One final BEFORE trigger inspects every UPDATE after the producer triggers.
-- CREATE TRIGGER requires SHARE ROW EXCLUSIVE on the hot tournaments table;
-- install only through the maintained daily-window applier, once.
BEGIN;
SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION public.fn_ca_chip_awards_match_starting_stack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP='UPDATE' AND EXISTS (
    SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=NEW.id
  ) THEN
    IF ROW(NEW.starting_chips,NEW.rebuy_chips,NEW.is_rebuy,NEW.is_reentry) IS DISTINCT FROM
       ROW(OLD.starting_chips,OLD.rebuy_chips,OLD.is_rebuy,OLD.is_reentry)
       AND (COALESCE(NEW.is_rebuy,false) OR COALESCE(NEW.is_reentry,false))
       AND (COALESCE(NEW.starting_chips,0)<=0
            OR NEW.rebuy_chips IS DISTINCT FROM NEW.starting_chips) THEN
      RAISE EXCEPTION 'rebuy chips must equal the registered starting stack'
        USING ERRCODE='23514';
    END IF;
    IF ROW(NEW.starting_chips,NEW.addon_chips,NEW.add_on_available) IS DISTINCT FROM
       ROW(OLD.starting_chips,OLD.addon_chips,OLD.add_on_available)
       AND COALESCE(NEW.add_on_available,false)
       AND (COALESCE(NEW.starting_chips,0)<=0
            OR NEW.addon_chips IS DISTINCT FROM NEW.starting_chips) THEN
      RAISE EXCEPTION 'addon chips must equal the registered starting stack'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (COALESCE(NEW.is_rebuy,false) OR COALESCE(NEW.is_reentry,false)
      OR COALESCE(NEW.add_on_available,false))
     AND COALESCE(NEW.starting_chips,0)<=0 THEN
    RAISE EXCEPTION 'chip purchases require a positive starting stack'
      USING ERRCODE='23514';
  END IF;
  IF (COALESCE(NEW.is_rebuy,false) OR COALESCE(NEW.is_reentry,false))
     AND COALESCE(NEW.starting_chips,0)>0
     AND NEW.rebuy_chips IS DISTINCT FROM NEW.starting_chips THEN
    NEW.rebuy_chips:=NEW.starting_chips;
  END IF;
  IF COALESCE(NEW.add_on_available,false)
     AND COALESCE(NEW.starting_chips,0)>0
     AND NEW.addon_chips IS DISTINCT FROM NEW.starting_chips THEN
    NEW.addon_chips:=NEW.starting_chips;
  END IF;
  RETURN NEW;
END;
$fn$;

-- One lookup per row. The final BEFORE trigger observes all producer changes,
-- including zz_freerolls_are_free_buy (which ran AFTER the old add-on twin).
DROP TRIGGER IF EXISTS zz_rebuy_pays_the_starting_stack ON public.tournaments;
DROP TRIGGER IF EXISTS zz_addon_pays_the_starting_stack ON public.tournaments;
DROP TRIGGER IF EXISTS zzzzzzzzzzzz_chip_awards_match_starting_stack ON public.tournaments;
CREATE TRIGGER zzzzzzzzzzzz_chip_awards_match_starting_stack
  BEFORE INSERT OR UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_chip_awards_match_starting_stack();

INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note)
VALUES('tournaments','zzzzzzzzzzzz_chip_awards_match_starting_stack',
  'Dan 2026-11-11: rebuy/reentry/addon equals starting stack; registered inconsistent changes refuse; final producer ordering.')
ON CONFLICT DO NOTHING;
COMMIT;
