CREATE OR REPLACE FUNCTION public.fn_ca_blind_contract_number(p_value jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v numeric; t text:=p_value #>> '{}';
BEGIN
  IF jsonb_typeof(p_value) NOT IN ('number','string') OR t !~ '^[0-9]+([.][0-9]+)?$' THEN RETURN NULL; END IF;
  v:=t::numeric;
  IF v>9007199254740991 THEN RETURN NULL; END IF;
  RETURN v;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_ca_cap_structure_clock(p_structure jsonb, p_minutes integer)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(e)='object'
    AND e->'isBreak' IS DISTINCT FROM 'true'::jsonb
    AND COALESCE(public.fn_ca_blind_contract_number(e->'durationMinutes'),
                 public.fn_ca_blind_contract_number(e->'duration_minutes'),
                 public.fn_ca_blind_contract_number(e->'duration')/60)>p_minutes
    THEN (e-'duration'-'duration_minutes')||jsonb_build_object('durationMinutes',p_minutes)
    ELSE e END ORDER BY ord),'[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_structure)='array' THEN p_structure ELSE '[]'::jsonb END) WITH ORDINALITY x(e,ord);
$function$;
CREATE OR REPLACE FUNCTION public.fn_ca_high_buyin_structure_clock(p_structure jsonb, p_uniform boolean DEFAULT false, p_name text DEFAULT NULL::text, p_bounty boolean DEFAULT false, p_satellite boolean DEFAULT false, p_pinned boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE bounded jsonb; minimum_minutes numeric; maximum_minutes numeric;
BEGIN
  SELECT COALESCE(jsonb_agg(CASE
    WHEN jsonb_typeof(e)='object' AND e->'isBreak' IS DISTINCT FROM 'true'::jsonb
      AND minutes > 0 AND (minutes < 7 OR minutes > 10)
    THEN (e-'duration'-'duration_minutes') || jsonb_build_object('durationMinutes',LEAST(10,GREATEST(7,minutes)))
    ELSE e END ORDER BY ord),'[]'::jsonb),
    min(minutes) FILTER (WHERE jsonb_typeof(e)='object' AND e->'isBreak' IS DISTINCT FROM 'true'::jsonb AND minutes>0),
    max(minutes) FILTER (WHERE jsonb_typeof(e)='object' AND e->'isBreak' IS DISTINCT FROM 'true'::jsonb AND minutes>0)
  INTO bounded,minimum_minutes,maximum_minutes
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_structure)='array' THEN p_structure ELSE '[]'::jsonb END) WITH ORDINALITY x(e,ord)
  CROSS JOIN LATERAL (SELECT public.fn_ca_blind_contract_number(
    COALESCE(NULLIF(e->'durationMinutes','null'::jsonb),e->'duration_minutes')) AS authored_minutes) a
  CROSS JOIN LATERAL (SELECT CASE WHEN authored_minutes>0 THEN authored_minutes
    ELSE public.fn_ca_blind_contract_number(e->'duration')/60 END AS minutes) m;
  IF p_uniform THEN
    -- Preserve the previous one-clock-per-event MTT/satellite invariant.
    IF minimum_minutes=maximum_minutes AND minimum_minutes BETWEEN 7 AND 10 THEN RETURN p_structure; END IF;
    RETURN public.fn_ca_lock_structure_clock(p_structure,GREATEST(7,LEAST(
      public.fn_ca_locked_level_minutes(p_name,NULL,p_bounty,p_satellite,p_structure),
      CASE WHEN p_pinned IS TRUE THEN 10 ELSE 8 END)));
  END IF;
  RETURN bounded;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_ca_lock_structure_clock(p_structure jsonb, p_minutes integer)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(x) <> 'object' OR x->'isBreak' = 'true'::jsonb THEN x
      ELSE (x - 'duration' - 'duration_minutes') || jsonb_build_object('durationMinutes', p_minutes)
    END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(p_structure) WITH ORDINALITY AS e(x, ord);
$function$;
CREATE OR REPLACE FUNCTION public.fn_ca_locked_level_minutes(p_name text, p_entry numeric, p_bounty boolean, p_satellite boolean, p_structure jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  n text := lower(COALESCE(p_name, ''));
  sat boolean := COALESCE(p_satellite, false) OR lower(COALESCE(p_name, '')) ~ 'satellite';
  r jsonb;
  mins numeric;
  secs numeric;
  opening numeric;
  uniform boolean := true;
BEGIN
  IF (p_entry IS NOT NULL AND p_entry = 0) OR n ~ 'free ?buy|free ?roll' THEN RETURN 5; END IF;
  IF NOT sat AND n ~ 'turbo|hyper' THEN RETURN 5; END IF;
  IF NOT sat AND n ~ 'deep' THEN RETURN 10; END IF;
  IF COALESCE(p_bounty, false) OR (NOT sat AND n ~ 'bounty|pko|knockout') THEN RETURN 8; END IF;
  IF p_structure IS NOT NULL AND jsonb_typeof(p_structure) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(p_structure) LOOP
      IF jsonb_typeof(r) <> 'object' OR r->'isBreak' = 'true'::jsonb THEN CONTINUE; END IF;
      mins := public.fn_ca_blind_contract_number(
        COALESCE(NULLIF(r->'durationMinutes', 'null'::jsonb), r->'duration_minutes'));
      secs := public.fn_ca_blind_contract_number(r->'duration');
      mins := CASE WHEN mins > 0 THEN mins WHEN secs > 0 THEN secs / 60 ELSE NULL END;
      IF mins IS NULL THEN CONTINUE; END IF;
      IF opening IS NULL THEN opening := mins;
      ELSIF mins <> opening THEN uniform := false;
      END IF;
    END LOOP;
  END IF;
  IF opening IS NULL THEN RETURN 8; END IF;
  IF opening <= 5 THEN RETURN 5; END IF;
  IF opening >= 12 OR (uniform AND opening = 10) THEN RETURN 10; END IF;
  RETURN 8;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_ca_minimum_tournament_levels(p_structure text, p_floor numeric DEFAULT 5)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_levels jsonb; v_level jsonb; v_result jsonb:='[]'; v_minutes numeric; v_changed boolean:=false;
BEGIN
 IF p_structure IS NULL OR btrim(p_structure)='' THEN RETURN p_structure; END IF;
 v_levels:=p_structure::jsonb;
 IF jsonb_typeof(v_levels)<>'array' THEN RAISE EXCEPTION 'Blind Structure Must Be An Array'; END IF;
 FOR v_level IN SELECT value FROM jsonb_array_elements(v_levels) LOOP
  IF jsonb_typeof(v_level)<>'object' THEN RAISE EXCEPTION 'Every Blind Level Must Be An Object'; END IF;
  IF NOT coalesce((v_level->>'isBreak')::boolean,false) THEN
   v_minutes:=coalesce(nullif((v_level->>'durationMinutes')::numeric,0),nullif((v_level->>'duration_minutes')::numeric,0),nullif((v_level->>'duration')::numeric,0)/60);
   IF v_minutes>0 AND v_minutes<greatest(5,p_floor) THEN
    v_minutes:=greatest(5,p_floor);
    v_level:=jsonb_set(v_level,'{durationMinutes}',to_jsonb(v_minutes));
    IF v_level?'duration_minutes' THEN v_level:=jsonb_set(v_level,'{duration_minutes}',to_jsonb(v_minutes)); END IF;
    IF v_level?'duration' THEN v_level:=jsonb_set(v_level,'{duration}',to_jsonb(v_minutes*60)); END IF;
    v_changed:=true;
   END IF;
  END IF;
  v_result:=v_result||jsonb_build_array(v_level);
 END LOOP;
 RETURN CASE WHEN v_changed THEN v_result::text ELSE p_structure END;
END $function$;
CREATE OR REPLACE FUNCTION public.fn_ca_mtt_late_registration_minutes(p_structure jsonb, p_levels integer)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r jsonb; idx integer:=0; mins numeric; secs numeric; duration_ms numeric;
 total_ms numeric:=0; last_ms numeric:=0; result numeric;
BEGIN
 IF p_levels IS NULL OR p_levels<0 THEN RAISE EXCEPTION 'Invalid tournament late-registration level count' USING ERRCODE='22023'; END IF;
 IF p_levels=0 THEN RETURN 0; END IF;
 IF p_structure IS NULL OR jsonb_typeof(p_structure)<>'array' THEN RAISE EXCEPTION 'Missing tournament late-registration clock' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_structure) LOOP
  idx:=idx+1;
  IF r->'isBreak'='true'::jsonb THEN CONTINUE; END IF;
  mins:=public.fn_ca_blind_contract_number(COALESCE(NULLIF(r->'durationMinutes','null'::jsonb),r->'duration_minutes'));
  secs:=public.fn_ca_blind_contract_number(r->'duration');
  duration_ms:=CASE WHEN mins>0 THEN mins*60000 ELSE secs*1000 END;
  IF duration_ms IS NULL OR duration_ms<=0 THEN RAISE EXCEPTION 'Invalid tournament late-registration clock' USING ERRCODE='22023'; END IF;
  last_ms:=duration_ms;
  IF idx<=p_levels THEN total_ms:=total_ms+duration_ms; END IF;
 END LOOP;
 IF last_ms<=0 THEN RAISE EXCEPTION 'Missing tournament late-registration clock' USING ERRCODE='22023'; END IF;
 IF p_levels>idx THEN total_ms:=total_ms+(p_levels-idx)*last_ms; END IF;
 result:=ceil(total_ms/60000);
 IF result>2147483647 THEN RAISE EXCEPTION 'Tournament late-registration minutes exceed the database range' USING ERRCODE='22023'; END IF;
 RETURN result::integer;
END $function$;
