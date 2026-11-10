CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_canonical(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE fast text;t text;v record;parts text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(p)='object' AND p->>'format'='public_hist215_v1' THEN
  fast:=public.fn_gto_v31_public215_model_canonical_fast(p);IF fast IS NOT NULL THEN RETURN fast;END IF;
 END IF;
 CASE jsonb_typeof(p)
 WHEN 'object' THEN
  FOR v IN SELECT key,value FROM jsonb_each(p) ORDER BY key COLLATE "C" LOOP
   IF v.key!~'^[ -~]*$' THEN RAISE EXCEPTION 'public215 canonical ASCII key';END IF;
   parts:=array_append(parts,to_jsonb(v.key)::text||':'||public.fn_gto_v31_public215_canonical(v.value));
  END LOOP;RETURN '{'||array_to_string(parts,',')||'}';
 WHEN 'array' THEN
  FOR v IN SELECT value FROM jsonb_array_elements(p) LOOP parts:=array_append(parts,public.fn_gto_v31_public215_canonical(v.value));END LOOP;RETURN '['||array_to_string(parts,',')||']';
 WHEN 'string' THEN IF (p#>>'{}')!~'^[ -~]*$' THEN RAISE EXCEPTION 'public215 canonical ASCII';END IF;RETURN p::text;
 WHEN 'number' THEN t:=p::text;IF t!~'^-?(0|[1-9][0-9]*)$' OR abs(t::numeric)>9007199254740991 OR t='-0' THEN RAISE EXCEPTION 'public215 canonical safeinteger';END IF;RETURN t;
 ELSE RETURN p::text;
 END CASE;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_digest(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'extensions'
AS $function$ SELECT encode(digest(convert_to(public.fn_gto_v31_public215_canonical(p),'UTF8'),'sha256'),'hex') $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_quality_gates_valid(p_gates jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_gates IS NULL OR jsonb_typeof(p_gates) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_gates)) <> 5
     OR NOT (p_gates ?& ARRAY[
       'max_frequency_mae','max_sizing_mae','max_policy_ev_mae_bb',
       'max_action_regret_bb','min_regret_coverage'
     ])
     OR EXISTS (
       SELECT 1 FROM jsonb_each(p_gates) gate
        WHERE jsonb_typeof(gate.value) <> 'number'
     ) THEN
    RETURN false;
  END IF;
  RETURN (p_gates->>'max_frequency_mae')::numeric BETWEEN 0 AND 0.15
     AND (p_gates->>'max_sizing_mae')::numeric BETWEEN 0 AND 0.25
     AND (p_gates->>'max_policy_ev_mae_bb')::numeric BETWEEN 0 AND 0.50
     AND (p_gates->>'max_action_regret_bb')::numeric BETWEEN 0 AND 0.25
     AND (p_gates->>'min_regret_coverage')::numeric BETWEEN 0.50 AND 1;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_model_canonical_fast(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
WITH root AS MATERIALIZED(
 SELECT p WHERE CASE WHEN jsonb_typeof(p)='object' THEN
 p-ARRAY['format','variant','feature_count','action_ids','heads','template_sha256','feature_schema_sha256','provenance_sha256']='{}'::jsonb
 AND p?&ARRAY['format','variant','feature_count','action_ids','heads','template_sha256','feature_schema_sha256','provenance_sha256']
 AND p->>'format'='public_hist215_v1' AND jsonb_typeof(p->'format')='string'
 AND jsonb_typeof(p->'heads')='array' AND jsonb_typeof(p->'action_ids')='array'
 AND CASE WHEN jsonb_typeof(p->'feature_count')='number' THEN
  (p->'feature_count')::text~'^-?(0|[1-9][0-9]*)$' AND abs((p->>'feature_count')::numeric)<=9007199254740991 ELSE false END
 AND (SELECT bool_and(jsonb_typeof(p->k)='string' AND p->>k~'^[ -~]*$')
 FROM unnest(ARRAY['variant','template_sha256','feature_schema_sha256','provenance_sha256'])k)
 ELSE false END
)
SELECT CASE WHEN actions.valid AND heads.valid
 THEN '{"action_ids":['||actions.body||'],"feature_count":'||(r.p->'feature_count')::text||',"feature_schema_sha256":'||(r.p->'feature_schema_sha256')::text||',"format":'||(r.p->'format')::text||',"heads":['||heads.body||'],"provenance_sha256":'||(r.p->'provenance_sha256')::text||',"template_sha256":'||(r.p->'template_sha256')::text||',"variant":'||(r.p->'variant')::text||'}' END
FROM root r
CROSS JOIN LATERAL(
 SELECT COALESCE(string_agg(a.value::text,',' ORDER BY a.ordinality),'') body,
 COALESCE(bool_and(jsonb_typeof(a.value)='string' AND (a.value#>>'{}')~'^[ -~]*$'),true) valid
 FROM jsonb_array_elements(r.p->'action_ids')WITH ORDINALITY a
)actions
CROSS JOIN LATERAL(
 SELECT COALESCE(string_agg('{"baseline_f64":'||(h.value->'baseline_f64')::text||',"trees":['||trees.body||']}',',' ORDER BY h.ordinality),'') body,
 COALESCE(bool_and(CASE WHEN jsonb_typeof(h.value)='object' THEN
 h.value-ARRAY['baseline_f64','trees']='{}'::jsonb AND h.value?&ARRAY['baseline_f64','trees']
 AND jsonb_typeof(h.value->'baseline_f64')='string' AND h.value->>'baseline_f64'~'^[ -~]*$'
 AND jsonb_typeof(h.value->'trees')='array' AND trees.valid ELSE false END),true) valid
 FROM jsonb_array_elements(r.p->'heads')WITH ORDINALITY h
 CROSS JOIN LATERAL(
  SELECT COALESCE(string_agg('['||nodes.body||']',',' ORDER BY t.ordinality),'') body,
  COALESCE(bool_and(jsonb_typeof(t.value)='array' AND nodes.valid),true) valid
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.value->'trees')='array' THEN h.value->'trees' ELSE '[]'::jsonb END)WITH ORDINALITY t
  CROSS JOIN LATERAL(
   SELECT COALESCE(string_agg(render.token,',' ORDER BY n.ordinality),'') body,
   COALESCE(bool_and(render.token IS NOT NULL),true) valid
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.value)='array' THEN t.value ELSE '[]'::jsonb END)WITH ORDINALITY n
   CROSS JOIN LATERAL(SELECT
 CASE WHEN jsonb_typeof(n.value)='object' THEN CASE WHEN n.value?'value_f64' THEN
  CASE WHEN n.value-'value_f64'='{}'::jsonb AND jsonb_typeof(n.value->'value_f64')='string' AND n.value->>'value_f64'~'^[ -~]*$'
   THEN '{"value_f64":'||(n.value->'value_f64')::text||'}' END
 ELSE
  CASE WHEN n.value-ARRAY['feature','threshold_f64','left','right','missing_left']='{}'::jsonb
  AND n.value?&ARRAY['feature','threshold_f64','left','right','missing_left']
  AND jsonb_typeof(n.value->'missing_left')='boolean'
  AND jsonb_typeof(n.value->'threshold_f64')='string' AND n.value->>'threshold_f64'~'^[ -~]*$'
  AND (SELECT bool_and(CASE WHEN jsonb_typeof(n.value->k)='number' THEN
    (n.value->k)::text~'^-?(0|[1-9][0-9]*)$' AND abs((n.value->>k)::numeric)<=9007199254740991 ELSE false END)
    FROM unnest(ARRAY['feature','left','right'])k)
  THEN '{"feature":'||(n.value->'feature')::text||',"left":'||(n.value->'left')::text||',"missing_left":'||(n.value->'missing_left')::text||',"right":'||(n.value->'right')::text||',"threshold_f64":'||(n.value->'threshold_f64')::text||'}' END
 END END token OFFSET 0)render
  )nodes
 )trees
)heads
$function$
;

