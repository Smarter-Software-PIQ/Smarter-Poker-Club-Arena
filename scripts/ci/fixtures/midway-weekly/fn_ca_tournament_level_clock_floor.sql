CREATE OR REPLACE FUNCTION public.fn_ca_tournament_level_clock_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_schedule_config jsonb; v_floor numeric; v_structure text; v_count integer; v_last numeric;
BEGIN
 IF upper(coalesce(NEW.status,'')) IN ('COMPLETED','COMPLETING','CANCELLED','CANCELED','FAILED') THEN RETURN NEW; END IF;
 -- Ten raw minutes remain five after an old engine applies acceleration.
 v_floor:=CASE WHEN NEW.accelerated_mtt IS TRUE THEN 10
   WHEN upper(coalesce(NEW.tournament_type,''))='MTT' AND lower(coalesce(NEW.variant,'')) NOT IN ('spin','sng')
     AND lower(coalesce(NEW.blind_speed,'standard'))='standard' THEN 8 ELSE 5 END;
 v_structure:=public.fn_ca_minimum_tournament_levels(NEW.blind_structure,v_floor);
 IF v_structure IS DISTINCT FROM NEW.blind_structure
   OR TG_OP='INSERT' OR NEW.blind_structure IS DISTINCT FROM OLD.blind_structure THEN
  NEW.blind_structure:=v_structure;
  IF coalesce(NEW.late_reg_levels,0)>0 THEN
   SELECT jsonb_array_length(v_structure::jsonb), (array_agg(coalesce(nullif((e.value->>'durationMinutes')::numeric,0), nullif((e.value->>'duration_minutes')::numeric,0), (e.value->>'duration')::numeric/60) ORDER BY e.n DESC))[1]
   INTO v_count,v_last FROM jsonb_array_elements(v_structure::jsonb) WITH ORDINALITY e(value,n)
   WHERE NOT coalesce((e.value->>'isBreak')::boolean,false);
   SELECT ceil(greatest(0,NEW.late_reg_levels-coalesce(v_count,0))*coalesce(v_last,v_floor)+coalesce(sum(coalesce(nullif((e.value->>'durationMinutes')::numeric,0),
      nullif((e.value->>'duration_minutes')::numeric,0),(e.value->>'duration')::numeric/60)),0))::integer
   INTO NEW.late_reg_mins
   FROM jsonb_array_elements(v_structure::jsonb) WITH ORDINALITY e(value,n)
   WHERE e.n<=NEW.late_reg_levels AND NOT coalesce((e.value->>'isBreak')::boolean,false);
   -- 2026-11-07: a derived clock caps a stalled level clock; it must not
   -- close entry before the advertised last level because breaks stopped
   -- the levels. Free Buy minutes are the owner's hour and stay as set.
   IF coalesce(NEW.late_reg_mins,0)>0
      AND NEW.format_contract::text IN ('mtt-v1','mtt-v2')
      AND NEW.synchronized_breaks IS DISTINCT FROM false
      AND NOT coalesce(NEW.free_buy,false)
      AND NOT (lower(coalesce(NEW.name,'')) ~ 'free ?buy'
               AND coalesce(NEW.buy_in_amount,0)+coalesce(NEW.buy_in_fee,0)=0) THEN
    NEW.late_reg_mins := NEW.late_reg_mins + public.fn_ca_late_registration_break_allowance(NEW.late_reg_mins);
   END IF;
  END IF;
 END IF;

 -- An explicit authored schedule may choose a level window without a second
 -- wall-clock deadline. Preserve it after all existing clock normalization.
 IF NEW.schedule_id IS NOT NULL
    AND upper(coalesce(NEW.status,'')) IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING')
    AND upper(coalesce(NEW.tournament_type,'')) IN ('MTT','SATELLITE')
    AND lower(coalesce(NEW.variant,'')) NOT IN ('spin','sng')
    AND NOT coalesce(NEW.prize_pool_finalized,false) THEN
   SELECT s.config INTO v_schedule_config
   FROM public.tournament_schedules s WHERE s.id=NEW.schedule_id;
   IF v_schedule_config->>'lateRegistrationMode' = 'levels' THEN
     IF coalesce(v_schedule_config->>'lateRegistrationLevels','') !~ '^[0-9]{1,3}$'
        OR (v_schedule_config->>'lateRegistrationLevels')::integer NOT BETWEEN 1 AND 100 THEN
       RAISE EXCEPTION 'A levels-only schedule requires 1 through 100 registration levels';
     END IF;
     NEW.late_reg_levels := (v_schedule_config->>'lateRegistrationLevels')::integer;
     NEW.late_reg_mins := 0;
   END IF;
 END IF;
 RETURN NEW;
END $function$

