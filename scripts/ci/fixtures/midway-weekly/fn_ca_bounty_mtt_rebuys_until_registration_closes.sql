CREATE OR REPLACE FUNCTION public.fn_ca_bounty_mtt_rebuys_until_registration_closes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total numeric;
BEGIN
  -- The existing generator snaps an authored 40-chip entry to its 35-chip
  -- ladder. Preserve the owner's exact price on NEW occurrences of these
  -- three explicitly configured daily series, before any entry can be sold.
  IF TG_OP = 'INSERT'
     AND NEW.club_id = 'fade0000-0000-0000-0000-000000000001'::uuid
     AND NEW.union_id = NEW.club_id
     AND NEW.schedule_id IN ('a70c1028-1200-4000-9000-000000000001'::uuid,
       'a70c1028-1600-4000-9000-000000000001'::uuid,
       'a70c1028-2000-4000-9000-000000000001'::uuid) THEN
    NEW.buy_in_amount := 36;
    NEW.buy_in_fee := 4;
  END IF;

  -- Exact owner-authored daily6PM contract, before the first entry can be sold.
  IF TG_OP = 'INSERT'
     AND NEW.schedule_id = 'a70c1028-1800-2500-9000-000000000001'::uuid
     AND NEW.club_id = 'fade0000-0000-0000-0000-000000000001'::uuid
     AND NEW.union_id = NEW.club_id
     AND upper(COALESCE(NEW.status,'')) = 'REGISTERING'
     AND upper(COALESCE(NEW.tournament_type,'')) = 'MTT'
     AND NEW.satellite_target_id IS NULL
     AND NEW.buy_in_amount + NEW.buy_in_fee = 25
     AND NEW.is_bounty IS NOT TRUE AND NEW.is_pko IS NOT TRUE
     AND NEW.is_mystery_bounty IS NOT TRUE THEN
    NEW.starting_chips := 15000;
    NEW.is_rebuy := true;
    NEW.rebuy_cost := 25;
    NEW.rebuy_chips := 15000;
    NEW.rebuy_levels := 6;
    NEW.max_rebuys := 1;
    NEW.is_reentry := false;
    NEW.max_reentries := 0;
    NEW.add_on_available := false;
    NEW.addon_cost := 0;
    NEW.addon_chips := 0;
    NEW.addon_levels := 0;
    NEW.addon_from_start := false;
    NEW.addon_break_minutes := 0;
    SELECT (config->'blindStructure')::text INTO STRICT NEW.blind_structure
      FROM public.tournament_schedules WHERE id=NEW.schedule_id;
    PERFORM public.fn_ca_mtt_blind_contract(NEW.blind_structure,NEW.starting_chips);
    IF (NEW.blind_structure::jsonb->0->>'smallBlind')::numeric <> 25
       OR (NEW.blind_structure::jsonb->0->>'bigBlind')::numeric <> 50
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.blind_structure::jsonb) b
          WHERE (b->>'durationMinutes')::numeric IS DISTINCT FROM 8::numeric) THEN
      RAISE EXCEPTION 'DAILY_6PM_AUTHORED_STRUCTURE_DRIFT';
    END IF;
  END IF;
  IF NOT (COALESCE(NEW.is_bounty, false) OR COALESCE(NEW.is_pko, false)
          OR COALESCE(NEW.is_mystery_bounty, false)) THEN
    RETURN NEW;
  END IF;
  IF upper(COALESCE(NEW.tournament_type, 'MTT')) <> 'MTT'
     OR lower(COALESCE(NEW.variant, '')) = 'satellite'
     OR NEW.satellite_target_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- A game that has started keeps the contract it started with.
  IF upper(COALESCE(NEW.status, 'REGISTERING')) NOT IN ('REGISTERING', 'ANNOUNCED') THEN
    RETURN NEW;
  END IF;
  v_total := COALESCE(NEW.buy_in_amount, 0) + COALESCE(NEW.buy_in_fee, 0);
  -- A freeroll keeps its Free Buy rules (fn_freerolls_are_free_buy).
  IF v_total <= 0 THEN
    RETURN NEW;
  END IF;

  -- Owner 2026-10-27: the Midway daily 8 PM series is a bounty FREEZEOUT.
  -- Its stable schedule identity is retained on every future occurrence.
  -- The existing spawner applies the general bounty defaults before INSERT;
  -- normalize this explicitly authorized series at the persisted boundary.
  IF (NEW.id = 'a70c1028-2000-4000-8000-000000000001'::uuid
      OR NEW.schedule_id = 'a70c1028-2000-4000-9000-000000000001'::uuid)
     AND NEW.club_id = 'fade0000-0000-0000-0000-000000000001'::uuid
     AND NEW.union_id = NEW.club_id
     AND NEW.is_bounty IS TRUE AND NEW.is_pko IS FALSE AND NEW.is_mystery_bounty IS FALSE
     AND NEW.bounty_amount = 10 AND v_total = 40 THEN
    NEW.is_rebuy := false;
    NEW.is_reentry := false;
    NEW.add_on_available := false;
    NEW.rebuy_cost := 0;
    NEW.rebuy_chips := 0;
    NEW.rebuy_levels := 0;
    NEW.max_rebuys := 0;
    NEW.max_reentries := 0;
    NEW.addon_cost := 0;
    NEW.addon_chips := 0;
    NEW.addon_levels := 0;
    RETURN NEW;
  END IF;

  NEW.is_rebuy := true;
  NEW.is_reentry := true;
  IF COALESCE(NEW.rebuy_cost, 0) <= 0 THEN
    NEW.rebuy_cost := v_total;
  END IF;
  IF COALESCE(NEW.rebuy_chips, 0) <= 0 THEN
    NEW.rebuy_chips := COALESCE(NULLIF(NEW.starting_chips, 0), 10000);
  END IF;
  IF COALESCE(NEW.late_reg_levels, 0) > 0 THEN
    NEW.rebuy_levels := NEW.late_reg_levels;
  ELSIF COALESCE(NEW.rebuy_levels, 0) <= 0 THEN
    NEW.rebuy_levels := 6;
  END IF;
  IF COALESCE(NEW.max_rebuys, 0) <= 0 THEN
    NEW.max_rebuys := NULL;
  END IF;
  IF COALESCE(NEW.max_reentries, 0) <= 0 THEN
    NEW.max_reentries := NULL;
  END IF;
  RETURN NEW;
END;
$function$
