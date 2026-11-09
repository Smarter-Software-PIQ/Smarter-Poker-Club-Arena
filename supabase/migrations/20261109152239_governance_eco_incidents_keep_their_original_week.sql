-- A running close or a new calendar week makes the rolling ECO detector quiet.
-- Neither proves that the original week's books were posted. Retain each exact
-- union/week obligation on the existing incident and require its completed books
-- plus actual ECO evidence before the existing resolver can call it verified.
-- The November 2 Midway finding closed on silence with zero original ECO rows.
-- Preserve that closure as an event and reopen the same incident while it is owed.
-- @live-proof: position('fn_ca_governance_eco_proven' in pg_get_functiondef('public.fn_ca_resolve_cleared_incidents()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';

CREATE FUNCTION public.fn_ca_governance_eco_proven(p_metadata jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,pg_temp AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_governance_eco_proven(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_governance_eco_proven(jsonb) TO service_role;

DO $patch$
DECLARE source text; anchor text; replacement text;
BEGIN
  source:=pg_get_functiondef('public.fn_ca_conservation_sweep()'::regprocedure);
  IF md5(source)<>'a063974f039c9ace7dc5df907a8707c2' THEN RAISE EXCEPTION 'GOVERNANCE_SWEEP_PREIMAGE_CHANGED'; END IF;
  anchor:=$old$false, jsonb_build_object('rows', v_rows, 'row_count', v_n));$old$;
  replacement:=$new$false, jsonb_build_object('rows', v_rows, 'row_count', v_n)
            || CASE WHEN c.check_name='fn_union_governance_check' AND (
              v_rows @> '[{"invariant":"union_eco_not_recorded"}]'::jsonb
              OR EXISTS(SELECT 1 FROM public.ca_drift_incidents old
                WHERE old.source='fn_ca_conservation_sweep:fn_union_governance_check'
                  AND old.status<>'resolved' AND old.metadata ? 'eco_obligations')) THEN
              jsonb_build_object('eco_obligations',(
                SELECT COALESCE(jsonb_agg(DISTINCT obligation),'[]'::jsonb) FROM (
                  -- Exact obligations survive both message refresh and week rollover.
                  SELECT value AS obligation FROM public.ca_drift_incidents i
                  CROSS JOIN LATERAL jsonb_array_elements(CASE
                    WHEN jsonb_typeof(i.metadata->'eco_obligations')='array'
                    THEN i.metadata->'eco_obligations' ELSE '[]'::jsonb END)
                  WHERE i.source='fn_ca_conservation_sweep:fn_union_governance_check'
                    AND i.status<>'resolved'
                  UNION ALL
                  SELECT jsonb_build_object('union_id',un.id,
                    'period_start',public.fn_union_prev_week_start(),
                    'period_end',public.fn_union_week_start())
                  FROM public.unions un
                  WHERE v_rows @> '[{"invariant":"union_eco_not_recorded"}]'::jsonb
                    AND COALESCE((un.settings->>'eco_enabled')::boolean,false)
                    AND EXISTS(SELECT 1 FROM public.union_clubs uc WHERE uc.union_id=un.id)
                    AND NOT public.fn_ca_launch_accounting_waived('union',un.id,public.fn_union_week_start())
                    AND NOT EXISTS(SELECT 1 FROM public.union_eco_ledger e WHERE e.union_id=un.id
                      AND e.period_start=public.fn_union_prev_week_start() AND e.period_end=public.fn_union_week_start())
                    AND NOT (now()<public.fn_union_accounting_run_at(public.fn_union_week_start())
                      OR EXISTS(SELECT 1 FROM public.accounting_close_gates g
                        WHERE g.scope_kind='union' AND g.scope_id=un.id AND g.period_end=public.fn_union_week_start()
                          AND g.gate_until>now() AND NOT EXISTS(SELECT 1 FROM public.union_accounting_runs r
                            WHERE r.scope_kind='union' AND r.scope_id=un.id
                              AND r.period_start=g.period_start AND r.period_end=g.period_end))
                      OR EXISTS(SELECT 1 FROM public.union_accounting_runs r
                        WHERE r.scope_kind='union' AND r.scope_id=un.id
                          AND r.period_end=public.fn_union_week_start() AND r.status='running'))
                ) original_obligations)) ELSE '{}'::jsonb END);$new$;
  IF cardinality(string_to_array(source,anchor))<>2 THEN RAISE EXCEPTION 'GOVERNANCE_SWEEP_ANCHOR_CHANGED'; END IF;
  EXECUTE replace(source,anchor,replacement);

  source:=pg_get_functiondef('public.fn_ca_resolve_cleared_incidents()'::regprocedure);
  IF md5(source)<>'78fbe1c199d79287114cef6305ee2d01' THEN RAISE EXCEPTION 'GOVERNANCE_RESOLVER_PREIMAGE_CHANGED'; END IF;
  anchor:='       AND i.last_seen_at < v_second;';
  replacement:=$new$       AND i.last_seen_at < v_second
       AND (i.source<>'fn_ca_conservation_sweep:fn_union_governance_check'
         OR (NOT (COALESCE(i.metadata->'rows','[]'::jsonb) @> '[{"invariant":"union_eco_not_recorded"}]'::jsonb)
             AND NOT (i.metadata ? 'eco_obligations'))
         OR public.fn_ca_governance_eco_proven(i.metadata));$new$;
  IF cardinality(string_to_array(source,anchor))<>2 THEN RAISE EXCEPTION 'GOVERNANCE_RESOLVER_ANCHOR_CHANGED'; END IF;
  EXECUTE replace(source,anchor,replacement);
END $patch$;

DO $original$
DECLARE original public.ca_drift_incidents%ROWTYPE; bound jsonb;
BEGIN
  SELECT * INTO original FROM public.ca_drift_incidents
    WHERE id='f6593b8d-51fb-4114-9c66-d819f5b43cdc' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF original.source<>'fn_ca_conservation_sweep:fn_union_governance_check'
     OR original.dedupe_key<>'sweep:fn_union_governance_check:2026-11-02'
     OR original.metadata->'rows' IS DISTINCT FROM
       '[{"detail":"Unions with ECO enabled and no union_eco_ledger row for the settlement week that has CLOSED: that week''s win tax / loss rebate is not reproducible. The ledger is written at close, so the week in progress is not asked about","severity":"warning","invariant":"union_eco_not_recorded","offenders":1}]'::jsonb
  THEN RAISE EXCEPTION 'ORIGINAL_GOVERNANCE_WITNESS_CHANGED'; END IF;
  bound:=original.metadata || jsonb_build_object('eco_obligations',jsonb_build_array(jsonb_build_object(
    'union_id','fade0000-0000-0000-0000-000000000001',
    'period_start','2026-10-26T07:00:00+00:00','period_end','2026-11-02T08:00:00+00:00')));
  UPDATE public.ca_drift_incidents SET metadata=bound WHERE id=original.id;
  IF original.status='resolved' AND original.closure_basis='verified_remeasured'
     AND NOT public.fn_ca_governance_eco_proven(bound) THEN
    INSERT INTO public.ca_incident_events(incident_id,kind,actor_label,detail)
      VALUES(original.id,'reopened','system',jsonb_build_object(
        'reason','The rolling detector became quiet before the original ECO books completed.',
        'migration','20261109152239','prior_resolution',to_jsonb(original),
        'eco_obligations',bound->'eco_obligations'));
    UPDATE public.ca_drift_incidents SET status='open',resolved_at=NULL,resolved_by=NULL,
      closure_basis=NULL,correction_ref=NULL,
      root_cause='The rolling governance check became quiet while the original week was still incomplete.',
      resolution='Reopened with the prior closure preserved in the event log. Exact original ECO books remain required.'
      WHERE id=original.id;
  END IF;
END $original$;
COMMIT;
