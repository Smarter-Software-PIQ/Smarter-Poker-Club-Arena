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
END $function$

