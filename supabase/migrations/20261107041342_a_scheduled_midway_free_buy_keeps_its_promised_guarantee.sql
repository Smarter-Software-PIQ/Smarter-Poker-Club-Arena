-- 20261107041342_a_scheduled_midway_free_buy_keeps_its_promised_guarantee.sql
-- @install-window: daily-maintenance
-- Validate the stored guarantee even when a write changes only guaranteed_prize.
-- The predecessor installs the trigger and must precede this replacement.
-- @live-proof: (SELECT count(*) = 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = 'public.tournaments'::regclass AND t.tgname = 'zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule' AND t.tgenabled = 'O' AND p.oid = 'public.fn_ca_a_built_midway_free_buy_matches_its_schedule()'::regprocedure AND md5(p.prosrc) = 'fa213ebd88d1b201dfbe2fe28ba6444d')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $preimage$
BEGIN
  IF NOT (SELECT count(*) = 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = 'public.tournaments'::regclass AND t.tgname = 'zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule' AND t.tgenabled = 'O' AND p.oid = 'public.fn_ca_a_built_midway_free_buy_matches_its_schedule()'::regprocedure AND md5(p.prosrc) = '3a732e0c6dbd9470b1b0f950e0572a68') THEN
    RAISE EXCEPTION 'Expected the enabled schedule guard from 20261106004812';
  END IF;
END
$preimage$;

CREATE OR REPLACE FUNCTION public.fn_ca_a_built_midway_free_buy_matches_its_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_slot text;
  v_got text;
  v_promised jsonb;
BEGIN
  IF NOT COALESCE(NEW.free_buy, false) OR NEW.schedule_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- A started event keeps the terms its players entered under.
  IF NEW.started_at IS NOT NULL
     OR upper(COALESCE(NEW.status, '')) NOT IN ('SCHEDULED', 'ANNOUNCED', 'REGISTERING') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.is_pko IS NOT DISTINCT FROM OLD.is_pko
     AND NEW.is_bounty IS NOT DISTINCT FROM OLD.is_bounty
     AND NEW.is_mystery_bounty IS NOT DISTINCT FROM OLD.is_mystery_bounty
     AND NEW.all_in_or_fold IS NOT DISTINCT FROM OLD.all_in_or_fold
     AND NEW.bounty_amount IS NOT DISTINCT FROM OLD.bounty_amount
     AND NEW.guaranteed_prize IS NOT DISTINCT FROM OLD.guaranteed_prize
     AND NEW.schedule_id IS NOT DISTINCT FROM OLD.schedule_id
     AND NEW.free_buy IS NOT DISTINCT FROM OLD.free_buy
     AND NEW.union_id IS NOT DISTINCT FROM OLD.union_id
     AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id THEN
    RETURN NULL;
  END IF;

  SELECT public.fn_ca_midway_free_buy_slot_format(NEW.id), s.config->'guaranteedPrize'
    INTO v_slot, v_promised
    FROM public.tournament_schedules s WHERE s.id = NEW.schedule_id;
  IF v_slot IS NULL THEN
    RETURN NULL; -- not a Midway rotation slot
  END IF;
  v_got := public.fn_ca_midway_free_buy_format(NEW.id);
  IF v_got IS DISTINCT FROM v_slot THEN
    RAISE EXCEPTION 'MIDWAY_FREE_BUY_SHAPE_DIFFERS_FROM_ITS_SCHEDULE: "%" starting % is built as %, its schedule names %',
      NEW.name, NEW.start_time, COALESCE(v_got, 'no Free Buy format'), v_slot
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(v_promised) IS DISTINCT FROM 'number'
     OR to_jsonb(NEW.guaranteed_prize) IS DISTINCT FROM v_promised THEN
    RAISE EXCEPTION 'MIDWAY_FREE_BUY_GUARANTEE_DIFFERS_FROM_ITS_SCHEDULE: "%" starting % guarantees %, its schedule promises %',
      NEW.name, NEW.start_time, NEW.guaranteed_prize, v_promised
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_a_built_midway_free_buy_matches_its_schedule() FROM PUBLIC, anon, authenticated;

COMMIT;
