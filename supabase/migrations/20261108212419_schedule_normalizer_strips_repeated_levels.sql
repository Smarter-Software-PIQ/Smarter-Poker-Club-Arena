-- Owner 2026-11-08: a ladder never opens with the same level twice. The repeat
-- is authored into the hard coded weekly catalog and can also be produced by
-- the 25/50 opening floor, so it is stripped here, last, on both paths.
-- Late registration steps down with it so entry still closes at the same blinds.
CREATE OR REPLACE FUNCTION public.fn_ca_schedule_level_clock_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_structure text; v_floor numeric; v_authored text; v_late integer;
BEGIN
 IF NEW.config->>'midwayWeeklyRevision'='owner-sheet-2026-11-07-v1'
    AND (NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid
         OR NEW.union_id='fade0000-0000-0000-0000-000000000001'::uuid) THEN
   PERFORM public.fn_ca_mtt_blind_contract(NEW.config->'midwayWeeklyTerms'->>'blind_structure',
      (NEW.config->'midwayWeeklyTerms'->>'starting_chips')::integer);
   v_authored:=NEW.config->'midwayWeeklyTerms'->>'blind_structure';
   v_structure:=public.fn_ca_strip_repeated_levels(v_authored);
   IF v_structure IS DISTINCT FROM v_authored
      AND coalesce(NEW.config->>'lateRegistrationLevels','') ~ '^[0-9]{1,3}$' THEN
     v_late:=public.fn_ca_repeated_levels_late_reg(v_authored,(NEW.config->>'lateRegistrationLevels')::integer);
     NEW.config:=jsonb_set(NEW.config,'{lateRegistrationLevels}',to_jsonb(v_late));
   END IF;
   NEW.config:=jsonb_set(NEW.config,'{blindStructure}',v_structure::jsonb);
   RETURN NEW;
 END IF;
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
  v_authored:=v_structure;
  v_structure:=public.fn_ca_strip_repeated_levels(v_authored);
  IF v_structure IS DISTINCT FROM v_authored
     AND coalesce(NEW.config->>'lateRegistrationLevels','') ~ '^[0-9]{1,3}$' THEN
    v_late:=public.fn_ca_repeated_levels_late_reg(v_authored,(NEW.config->>'lateRegistrationLevels')::integer);
    NEW.config:=jsonb_set(NEW.config,'{lateRegistrationLevels}',to_jsonb(v_late));
  END IF;
  NEW.config:=jsonb_set(NEW.config,'{blindStructure}',v_structure::jsonb);
 END IF;
 RETURN NEW;
END $function$;