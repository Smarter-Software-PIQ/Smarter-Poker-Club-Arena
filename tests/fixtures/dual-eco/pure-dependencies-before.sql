CREATE OR REPLACE FUNCTION public.fn_pnl_evidence_cents(p_value jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v numeric;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
 v := (p_value#>>'{}')::numeric;
 IF v::text IN ('NaN','Infinity','-Infinity') OR v<>round(v,2) THEN RETURN NULL; END IF;
 RETURN v;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN NULL;
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_union_week_start(p_at timestamp with time zone DEFAULT now())
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT date_trunc('week', (p_at AT TIME ZONE 'America/Los_Angeles'))
           AT TIME ZONE 'America/Los_Angeles';
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_governance_eco_proven(p_metadata jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE obligation jsonb; v_union_id uuid; v_week_start timestamptz; v_week_end timestamptz;
BEGIN
  IF jsonb_typeof(p_metadata->'eco_obligations') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_metadata->'eco_obligations')=0 THEN RETURN false; END IF;
  FOR obligation IN SELECT value FROM jsonb_array_elements(p_metadata->'eco_obligations') LOOP
    BEGIN
      v_union_id:=(obligation->>'union_id')::uuid;
      v_week_start:=(obligation->>'period_start')::timestamptz;
      v_week_end:=(obligation->>'period_end')::timestamptz;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
      RETURN false;
    END;
    IF v_union_id IS NULL OR v_week_start IS NULL OR v_week_end IS NULL
       OR NOT isfinite(v_week_start) OR NOT isfinite(v_week_end)
       OR v_week_start IS DISTINCT FROM public.fn_union_week_start(v_week_start)
       OR v_week_end IS DISTINCT FROM public.fn_union_week_start(v_week_start+interval '8 days')
       OR NOT EXISTS(SELECT 1 FROM public.union_accounting_runs r
         WHERE r.scope_kind='union' AND r.scope_id=v_union_id
           AND r.period_start=v_week_start AND r.period_end=v_week_end
           AND r.status='complete' AND r.result->>'success'='true'
           AND r.result->>'accounting_version'='3')
       OR NOT EXISTS(SELECT 1 FROM public.union_eco_ledger e
         WHERE e.union_id=v_union_id AND e.period_start=v_week_start AND e.period_end=v_week_end)
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $function$
;

REVOKE ALL ON FUNCTION fn_ca_governance_eco_proven(jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION fn_ca_governance_eco_proven(jsonb)TO service_role;
