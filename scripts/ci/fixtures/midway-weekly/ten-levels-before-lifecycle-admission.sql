-- Owner: all chip tournaments with a total entry of25 or more change12
-- late-registration levels to10. Preserve every other setting, including
-- rebuy/add-on caps, prices, ladders, clocks and scheduled starts.
-- Existing final row boundary owns future writes. No new trigger or engine.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
CREATE OR REPLACE FUNCTION public.fn_ca_ten_level_late_registration(t public.tournaments)
RETURNS public.tournaments LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $function$
BEGIN
 IF t.late_reg_levels=12
    AND coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0)>=25
    AND upper(coalesce(t.status,'')) NOT IN ('COMPLETED','COMPLETING','CANCELLED','CANCELED','FAILED')
    AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=t.club_id AND c.asset='chips') THEN
   t.late_reg_levels:=10;
   t.short_description:=replace(t.short_description,'Late Registration Through Level 12.','Late Registration Through Level 10.');
 END IF;
 RETURN t;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_ten_level_late_registration(public.tournaments) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_ten_level_late_registration(public.tournaments) TO service_role;
DO $source$
DECLARE source text; doc jsonb; original text; changed jsonb; event jsonb; result jsonb:='[]';
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_midway_weekly_catalog()'::regprocedure) INTO source;
 IF md5(source)<>'4f06153d9e33c08cf36f4f5c00fd28ef' THEN RAISE EXCEPTION 'Late registration catalog source drift'; END IF;
 original:=split_part(source,'$catalog$',2); doc:=original::jsonb;
 FOR event IN SELECT value FROM jsonb_array_elements(doc->'events') LOOP
   IF (event->'config'->>'buyIn')::numeric>=25 AND event->'terms'->>'late_reg_levels'='12' THEN
     event:=jsonb_set(jsonb_set(event,'{config,lateRegistrationLevels}','10'),'{terms,late_reg_levels}','10');
     event:=jsonb_set(event,'{terms,short_description}',to_jsonb(replace(event->'terms'->>'short_description','Late Registration Through Level 12.','Late Registration Through Level 10.')));
   END IF;
   result:=result||jsonb_build_array(event);
 END LOOP;
 changed:=jsonb_set(doc,'{events}',result);
 IF changed=doc THEN RAISE EXCEPTION 'No twelve-level paid catalog definitions'; END IF;
 EXECUTE replace(source,'$catalog$'||original||'$catalog$','$catalog$'||changed::text||'$catalog$');
 SELECT pg_get_functiondef('public.fn_ca_tournament_level_clock_floor()'::regprocedure) INTO source;
 IF md5(source)<>'7e8e5816027858656fbf432462bd5556' THEN RAISE EXCEPTION 'Late registration final boundary source drift'; END IF;
 IF position('RETURN NEW;' in source)=0 THEN RAISE EXCEPTION 'Final boundary missing'; END IF;
 EXECUTE replace(source,'RETURN NEW;','RETURN public.fn_ca_ten_level_late_registration(NEW);');
 SELECT pg_get_functiondef('public.fn_ca_bounty_mtt_rebuys_until_registration_closes()'::regprocedure) INTO source;
 IF md5(source)<>'3ff166c6abec4367399651c6fefa38af' THEN RAISE EXCEPTION 'Late registration bounty boundary source drift'; END IF;
 -- A cutoff-only UPDATE must not re-author any existing rebuy terms.
 source:=replace(source,E'BEGIN\n', $pure$BEGIN
  IF TG_OP='UPDATE' AND OLD.late_reg_levels=12 AND NEW.late_reg_levels=10
     AND coalesce(NEW.buy_in_amount,0)+coalesce(NEW.buy_in_fee,0)>=25
     AND (to_jsonb(NEW)-ARRAY['late_reg_levels','short_description'])
       =(to_jsonb(OLD)-ARRAY['late_reg_levels','short_description']) THEN RETURN NEW; END IF;
$pure$);
 -- Subsequent writes retain the separately authored rebuy cap after12->10.
 source:=replace(source,'NEW.rebuy_levels := NEW.late_reg_levels;', $rebuy$IF NOT (v_total>=25 AND NEW.late_reg_levels=10 AND coalesce(NEW.rebuy_levels,0)>0
      AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=NEW.club_id AND c.asset='chips')) THEN
      NEW.rebuy_levels := NEW.late_reg_levels;
    END IF;$rebuy$);
 EXECUTE source;
END $source$;
-- Capture and lock just the finite affected rows; compare all unaffected
-- columns inside the same transaction, so trigger side effects abort.
CREATE TEMP TABLE late_reg_before ON COMMIT DROP AS
 SELECT t.id,to_jsonb(t) AS row FROM public.tournaments t
 WHERE t.late_reg_levels=12 AND coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0)>=25
 AND upper(coalesce(t.status,'')) NOT IN ('COMPLETED','COMPLETING','CANCELLED','CANCELED','FAILED')
 AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=t.club_id AND c.asset='chips')
 FOR UPDATE OF t;
UPDATE public.tournaments t SET late_reg_levels=10,
 short_description=replace(t.short_description,'Late Registration Through Level 12.','Late Registration Through Level 10.')
FROM late_reg_before b WHERE t.id=b.id;
DO $unchanged$ BEGIN
 IF EXISTS(SELECT 1 FROM late_reg_before b JOIN public.tournaments t USING(id)
   WHERE t.late_reg_levels<>10 OR (to_jsonb(t)-ARRAY['late_reg_levels','short_description'])
     IS DISTINCT FROM (b.row-ARRAY['late_reg_levels','short_description'])) THEN
   RAISE EXCEPTION 'Late registration update changed another tournament setting';
 END IF;
END $unchanged$;
-- The board owner reads the amended catalog. Other configured schedules
-- change only their explicit late-registration field and matching copy.
CREATE TEMP TABLE late_reg_schedule_before ON COMMIT DROP AS
 SELECT s.id,to_jsonb(s) AS row FROM public.tournament_schedules s
 WHERE s.config->>'lateRegistrationLevels'='12' AND (s.config->>'buyIn')::numeric>=25
 AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=s.club_id AND c.asset='chips')
 FOR UPDATE OF s;
UPDATE public.tournament_schedules s SET config=
 jsonb_set(s.config,'{lateRegistrationLevels}','10')
 || CASE WHEN s.config ? 'midwayWeeklyTerms' THEN jsonb_build_object('midwayWeeklyTerms',
    jsonb_set(s.config->'midwayWeeklyTerms','{late_reg_levels}','10')
    || jsonb_build_object('short_description',replace(s.config->'midwayWeeklyTerms'->>'short_description','Late Registration Through Level 12.','Late Registration Through Level 10.')))
    ELSE '{}'::jsonb END
WHERE s.config->>'lateRegistrationLevels'='12'
 AND (s.config->>'buyIn')::numeric>=25
 AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=s.club_id AND c.asset='chips');
DO $schedules_unchanged$ BEGIN
 IF EXISTS(SELECT 1 FROM late_reg_schedule_before b JOIN public.tournament_schedules s USING(id)
  WHERE s.config->>'lateRegistrationLevels'<>'10'
   OR ((to_jsonb(s) #- '{config,lateRegistrationLevels}') #- '{config,midwayWeeklyTerms,late_reg_levels}' #- '{config,midwayWeeklyTerms,short_description}')
    IS DISTINCT FROM ((b.row #- '{config,lateRegistrationLevels}') #- '{config,midwayWeeklyTerms,late_reg_levels}' #- '{config,midwayWeeklyTerms,short_description}'))
 THEN RAISE EXCEPTION 'Late registration update changed another schedule setting'; END IF;
END $schedules_unchanged$;
COMMIT;
