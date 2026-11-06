-- Owner November 5, 2026: MTTs and Sit & Gos open at 25/50. Spins are separate.
-- Live MTT/SNG schedules still author 25/25; legacy short formats author 10/20.
-- The common storage boundary normalizes future ladders. Preserve array size,
-- level identifiers, registration/add-on cutoffs, clocks, ante and later stakes.
-- Early legacy stakes below 25/50 are floored so the ladder never steps down.
-- Spins and already-started/terminal tournaments retain their own structures.
-- Install from protected main through Apply Merged Migration. No engine or
-- new table trigger, no wallet/seat write, and no repair schedule.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_tournament_lock_level_clock()'::regprocedure)) NOT IN ('b7f65a69cfded92ffbab47184ed6bfe4','5a612658a54907df14142624d8253249') THEN
  RAISE EXCEPTION 'Opening blind migration source drift: fn_ca_tournament_lock_level_clock';
 END IF;
 IF md5(pg_get_functiondef('public.fn_ca_schedule_level_clock_floor()'::regprocedure)) NOT IN ('6f8415c3513bb2ce42d428448ffa08cc','14413dacf7a87d66fa8aad20abb9ffe2') THEN
  RAISE EXCEPTION 'Opening blind migration source drift: fn_ca_schedule_level_clock_floor';
 END IF;
 IF md5(pg_get_functiondef('public.fn_tournament_table_inherits_committed_blinds()'::regprocedure)) NOT IN ('0386e9eb7f88d7e783c8cec1dbf5f5e8','a33b44e110d961743abf8edbb83c8a30') THEN
  RAISE EXCEPTION 'Opening blind migration source drift: fn_tournament_table_inherits_committed_blinds';
 END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_opening_blinds(p_structure text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $function$
DECLARE levels jsonb; row jsonb; result jsonb:='[]'; first_playable boolean:=true;
  sb numeric; bb numeric; changed boolean:=false; normalized jsonb;
BEGIN
  IF p_structure IS NULL OR btrim(p_structure)='' THEN RETURN p_structure; END IF;
  levels:=p_structure::jsonb;
  IF jsonb_typeof(levels)<>'array' THEN RAISE EXCEPTION 'Blind Structure Must Be An Array'; END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(levels) LOOP
    normalized:=row;
    IF NOT coalesce((row->>'isBreak')::boolean,false) THEN
      sb:=public.fn_ca_blind_contract_number(row->'smallBlind');
      bb:=public.fn_ca_blind_contract_number(row->'bigBlind');
      -- Do not make malformed authored rules look valid.
      IF sb IS NULL OR bb IS NULL OR sb<0 OR bb<=0 OR sb>bb THEN
        RAISE EXCEPTION 'Invalid tournament blind structure: invalid blinds';
      END IF;
      normalized:=jsonb_set(jsonb_set(row,'{smallBlind}',to_jsonb(
        CASE WHEN first_playable THEN 25::numeric ELSE greatest(25,sb) END)),
        '{bigBlind}',to_jsonb(CASE WHEN first_playable THEN 50::numeric ELSE greatest(50,bb) END));
      first_playable:=false;
    END IF;
    changed:=changed OR normalized IS DISTINCT FROM row;
    result:=result||jsonb_build_array(normalized);
  END LOOP;
  RETURN CASE WHEN changed THEN result::text ELSE p_structure END;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_tournament_opening_blinds(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_tournament_opening_blinds(text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_lock_level_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  authored jsonb;
  locked jsonb;
  m integer;
  derived boolean := false;
BEGIN
  -- Owner November 5: MTTs and Sit & Gos open at 25/50. Keep every
  -- level index, clock, ante and already booked Spin receipt intact.
  IF (TG_OP='INSERT' OR upper(coalesce(OLD.status,'')) IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING'))
     AND upper(coalesce(NEW.status,'')) IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING')
     AND upper(coalesce(NEW.tournament_type,'')) IN ('MTT','SNG','SATELLITE')
     AND lower(coalesce(NEW.variant,'')) <> 'spin'
     AND NEW.started_at IS NULL AND coalesce(NEW.current_level,0)=0
     THEN
    NEW.blind_structure:=public.fn_ca_tournament_opening_blinds(NEW.blind_structure);
  END IF;
  -- Owner November 1: price takes precedence over every fast-format default.
  -- Booked Spin rules are never rewritten; their engine projection owns this.
  IF NEW.buy_in_amount > 25
     AND upper(COALESCE(NEW.tournament_type,'')) <> 'SPIN'
     AND lower(COALESCE(NEW.variant,'')) <> 'spin' THEN
    IF TG_OP='UPDATE' AND upper(COALESCE(NEW.status,'')) NOT IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING') THEN RETURN NEW; END IF;
    BEGIN authored:=NEW.blind_structure::jsonb;
    EXCEPTION WHEN OTHERS THEN RETURN NEW; END;
    IF jsonb_typeof(authored)<>'array' OR jsonb_array_length(authored)=0 THEN RETURN NEW; END IF;
    locked:=public.fn_ca_high_buyin_structure_clock(authored,
      upper(COALESCE(NEW.tournament_type,'')) IN ('MTT','SATELLITE') AND lower(COALESCE(NEW.variant,'')) NOT IN ('spin','sng'),
      NEW.name,
      COALESCE(NEW.is_bounty,false) OR COALESCE(NEW.is_pko,false) OR COALESCE(NEW.is_mystery_bounty,false) OR COALESCE(NEW.bounty_amount,0)>0
        OR lower(COALESCE(NEW.variant,'')) IN ('bounty','progressive_bounty','mystery_bounty'),
      upper(COALESCE(NEW.tournament_type,''))='SATELLITE' OR lower(COALESCE(NEW.variant,''))='satellite',NEW.is_pinned);
    IF locked IS DISTINCT FROM authored THEN
      IF COALESCE(NEW.late_reg_levels,0)>0 THEN
        BEGIN derived:=NEW.late_reg_mins=public.fn_ca_mtt_late_registration_minutes(authored,NEW.late_reg_levels);
        EXCEPTION WHEN OTHERS THEN derived:=false; END;
        IF derived THEN NEW.late_reg_mins:=public.fn_ca_mtt_late_registration_minutes(locked,NEW.late_reg_levels); END IF;
      END IF;
      NEW.blind_structure:=locked::text;
    END IF;
    RETURN NEW;
  END IF;
  IF upper(COALESCE(NEW.tournament_type, '')) NOT IN ('MTT', 'SATELLITE')
     OR lower(COALESCE(NEW.variant, '')) IN ('spin', 'sng') THEN
    -- Short formats keep their own faster ladder, subject to the global ceiling.
    IF TG_OP='UPDATE' AND upper(COALESCE(NEW.status,'')) NOT IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING') THEN RETURN NEW; END IF;
    BEGIN authored:=NEW.blind_structure::jsonb;
    EXCEPTION WHEN OTHERS THEN RETURN NEW; END;
    IF jsonb_typeof(authored)='array' THEN
      NEW.blind_structure:=public.fn_ca_cap_structure_clock(authored,CASE WHEN NEW.is_pinned IS TRUE THEN 10 ELSE 8 END)::text;
    END IF;
    RETURN NEW;
  END IF;
  -- A started event keeps the clock its players are already playing.
  IF TG_OP = 'UPDATE' AND upper(COALESCE(NEW.status, ''))
       NOT IN ('REGISTERING', 'ANNOUNCED', 'SCHEDULED', 'PENDING') THEN
    RETURN NEW;
  END IF;
  BEGIN
    authored := NEW.blind_structure::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW; -- unreadable ladders are refused by the blind contract trigger
  END;
  IF authored IS NULL OR jsonb_typeof(authored) <> 'array' OR jsonb_array_length(authored) = 0 THEN
    RETURN NEW;
  END IF;

  m := public.fn_ca_locked_level_minutes(
    NEW.name,
    CASE WHEN NEW.buy_in_amount IS NULL THEN NULL
         ELSE NEW.buy_in_amount + COALESCE(NEW.buy_in_fee, 0) END,
    COALESCE(NEW.is_bounty, false) OR COALESCE(NEW.is_pko, false)
      OR COALESCE(NEW.is_mystery_bounty, false) OR COALESCE(NEW.bounty_amount, 0) > 0
      OR lower(COALESCE(NEW.variant, '')) IN ('bounty', 'progressive_bounty', 'mystery_bounty'),
    upper(COALESCE(NEW.tournament_type, '')) = 'SATELLITE'
      OR lower(COALESCE(NEW.variant, '')) = 'satellite',
    authored);
  -- Only highlighted tournaments may retain the ten-minute clock.
  m := LEAST(m, CASE WHEN NEW.is_pinned IS TRUE THEN 10 ELSE 8 END);
  locked := public.fn_ca_lock_structure_clock(authored, m);

  IF locked IS DISTINCT FROM authored THEN
    IF COALESCE(NEW.late_reg_levels, 0) > 0 THEN
      BEGIN
        derived := NEW.late_reg_mins = public.fn_ca_mtt_late_registration_minutes(authored, NEW.late_reg_levels);
      EXCEPTION WHEN OTHERS THEN
        derived := false;
      END;
      IF derived THEN
        NEW.late_reg_mins := public.fn_ca_mtt_late_registration_minutes(locked, NEW.late_reg_levels);
      END IF;
    END IF;
    NEW.blind_structure := locked::text;
  END IF;

  -- Free Buy: one hour of late registration on the 5-minute clock.
  IF upper(COALESCE(NEW.tournament_type, '')) = 'MTT'
     AND lower(COALESCE(NEW.name, '')) ~ 'free ?buy'
     AND COALESCE(NEW.buy_in_amount, 0) + COALESCE(NEW.buy_in_fee, 0) = 0
     AND m = 5
     AND COALESCE(NEW.late_reg_levels, 0) > 0
     AND (NEW.late_reg_levels, NEW.late_reg_mins) IS DISTINCT FROM (12, 60) THEN
    IF NEW.rebuy_levels IS NOT DISTINCT FROM NEW.late_reg_levels THEN
      NEW.rebuy_levels := 12;
    END IF;
    NEW.late_reg_levels := 12;
    NEW.late_reg_mins := 60;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_ca_schedule_level_clock_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_structure text; v_floor numeric;
BEGIN
 IF jsonb_typeof(NEW.config->'blindStructure')='array' THEN
  v_floor:=CASE WHEN coalesce((NEW.config->>'acceleratedMtt')::boolean,false) THEN 10
    WHEN upper(coalesce(NEW.config->>'blindPreset','STANDARD'))='STANDARD' THEN 8 ELSE 5 END;
  v_structure:=(NEW.config->'blindStructure')::text;
  IF lower(coalesce(NEW.config->>'type','mtt')) <> 'spin'
     AND lower(coalesce(NEW.config->>'variant','')) <> 'spin'
     AND upper(coalesce(NEW.config->>'tournamentType','')) <> 'SPIN' THEN
   v_structure:=public.fn_ca_tournament_opening_blinds(v_structure);
  END IF;
  v_structure:=public.fn_ca_minimum_tournament_levels(v_structure,v_floor);
  NEW.config:=jsonb_set(NEW.config,'{blindStructure}',v_structure::jsonb);
 END IF;
 RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.fn_tournament_table_inherits_committed_blinds()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_level integer; v_state jsonb; v_opening boolean;
BEGIN
  IF NEW.tournament_id IS NULL THEN RETURN NEW; END IF;
  SELECT current_level,blind_level_state,
    upper(coalesce(status,'')) IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING')
      AND upper(coalesce(tournament_type,'')) IN ('MTT','SNG','SATELLITE')
      AND lower(coalesce(variant,'')) <> 'spin'
      AND started_at IS NULL AND coalesce(current_level,0)=0
    INTO v_level,v_state,v_opening
    FROM public.tournaments WHERE id=NEW.tournament_id FOR SHARE;
  IF v_state IS NULL THEN
    -- Pre-created MTT/SNG tables obey the same opening as their stored event.
    IF v_opening THEN NEW.small_blind:=25; NEW.big_blind:=50; END IF;
    -- No committed level to inherit. The display string is still a function of
    -- this row's own blinds, so derive it rather than trusting the caller:
    -- that is what let 'undefined/undefined' and stale levels be stored, and
    -- what left a minutely cron UPDATE as the only thing holding the invariant
    -- for the 167,997 tournaments with no blind_level_state.
    IF NEW.small_blind IS NOT NULL AND NEW.big_blind IS NOT NULL THEN
      NEW.stakes := trim_scale(NEW.small_blind)::text||'/'||trim_scale(NEW.big_blind)::text;
    END IF;
    RETURN NEW;
  END IF;
  IF (v_state->>'index')::integer IS DISTINCT FROM v_level THEN
    RAISE EXCEPTION 'Tournament table cannot inherit an unconfirmed blind level';
  END IF;
  NEW.small_blind:=(v_state->>'small_blind')::numeric;
  NEW.big_blind:=(v_state->>'big_blind')::numeric;
  NEW.ante:=(v_state->>'ante')::numeric;
  NEW.stakes:=trim_scale(NEW.small_blind)::text||'/'||trim_scale(NEW.big_blind)::text;
  RETURN NEW;
END;
$function$
;
-- Finite installation of the new rule for advertised, not-started events.
-- Row locks serialize with launch. A concurrent start makes this predicate false.
WITH changed AS (
UPDATE public.tournaments t
SET blind_structure=public.fn_ca_tournament_opening_blinds(t.blind_structure)
WHERE upper(coalesce(t.status,'')) IN ('REGISTERING','ANNOUNCED','SCHEDULED','PENDING')
  AND upper(coalesce(t.tournament_type,'')) IN ('MTT','SNG','SATELLITE')
  AND lower(coalesce(t.variant,'')) <> 'spin'
  AND t.started_at IS NULL AND coalesce(t.current_level,0)=0
  AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id=t.club_id AND c.lifecycle_status='retired')
  AND t.blind_structure IS DISTINCT FROM public.fn_ca_tournament_opening_blinds(t.blind_structure)
RETURNING t.id
)
UPDATE public.tables tb SET small_blind=25,big_blind=50,stakes='25/50'
FROM changed c WHERE tb.tournament_id=c.id AND coalesce(tb.hands_dealt,0)=0
  AND (tb.small_blind,tb.big_blind,tb.stakes) IS DISTINCT FROM (25::numeric,50::numeric,'25/50'::text);
UPDATE public.tournament_schedules s
SET config=jsonb_set(s.config,'{blindStructure}',public.fn_ca_tournament_opening_blinds((s.config->'blindStructure')::text)::jsonb)
WHERE s.active AND jsonb_typeof(s.config->'blindStructure')='array'
  AND lower(coalesce(s.config->>'type','mtt')) <> 'spin'
  AND lower(coalesce(s.config->>'variant','')) <> 'spin'
  AND upper(coalesce(s.config->>'tournamentType','')) <> 'SPIN'
  AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id=s.club_id AND c.lifecycle_status='retired')
  AND s.config->'blindStructure' IS DISTINCT FROM public.fn_ca_tournament_opening_blinds((s.config->'blindStructure')::text)::jsonb;
COMMIT;
