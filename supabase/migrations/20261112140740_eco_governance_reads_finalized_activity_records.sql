-- The closed ECO book can be recorded as immutable cash/tournament components.
-- The legacy-only detector reported Midway's complete November 2-9 book missing
-- despite all ten actual components and delivered invoices. Recognize the
-- existing strict original-period proof at BOTH the detector and capture owner.
-- No close, invoice, wallet, ledger or historical incident is replayed here.
-- @live-proof: md5(pg_get_functiondef('public.fn_union_credit_risk_check()'::regprocedure))='c038dcbd1c2559845703e468c83814be' AND md5(pg_get_functiondef('public.fn_ca_conservation_sweep()'::regprocedure))='c71291c2adb632febdace247f97b9c1e'
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $patch$
DECLARE source text; anchor text; replacement text;
BEGIN
  source:=pg_get_functiondef('public.fn_union_credit_risk_check()'::regprocedure);
  IF md5(source)<>'034ffe3db7a17ac3944050fcb5fee8a6' THEN RAISE EXCEPTION 'ECO_ACTIVITY_DETECTOR_PREIMAGE_CHANGED: fn_union_credit_risk_check()'; END IF;
  anchor:=$old$     AND NOT EXISTS (SELECT 1 FROM union_eco_ledger l
                      WHERE l.union_id = un.id
                        AND l.period_start = fn_union_prev_week_start()
                        AND l.period_end = fn_union_week_start())$old$;
  replacement:=$new$     AND NOT EXISTS (SELECT 1 FROM union_eco_ledger l
                      WHERE l.union_id = un.id
                        AND l.period_start = fn_union_prev_week_start()
                        AND l.period_end = fn_union_week_start())
     AND NOT public.fn_ca_governance_eco_proven(jsonb_build_object(
       'eco_obligations',jsonb_build_array(jsonb_build_object(
         'union_id',un.id,'period_start',public.fn_union_prev_week_start(),
         'period_end',public.fn_union_week_start()))))$new$;
  IF cardinality(string_to_array(source,anchor))<>2 THEN RAISE EXCEPTION 'ECO_ACTIVITY_DETECTOR_ANCHOR_CHANGED'; END IF;
  EXECUTE replace(source,anchor,replacement);
  source:=pg_get_functiondef('public.fn_ca_conservation_sweep()'::regprocedure);
  IF md5(source)<>'43cd9018c6554ff6c53fde66213b34a1' THEN RAISE EXCEPTION 'ECO_ACTIVITY_DETECTOR_PREIMAGE_CHANGED: fn_ca_conservation_sweep()'; END IF;
  anchor:=$old$                    AND NOT EXISTS(SELECT 1 FROM public.union_eco_ledger e WHERE e.union_id=un.id
                      AND e.period_start=public.fn_union_prev_week_start() AND e.period_end=public.fn_union_week_start())$old$;
  replacement:=$new$                    AND NOT EXISTS(SELECT 1 FROM public.union_eco_ledger e WHERE e.union_id=un.id
                      AND e.period_start=public.fn_union_prev_week_start() AND e.period_end=public.fn_union_week_start())
                    AND NOT public.fn_ca_governance_eco_proven(jsonb_build_object(
                      'eco_obligations',jsonb_build_array(jsonb_build_object(
                        'union_id',un.id,'period_start',public.fn_union_prev_week_start(),
                        'period_end',public.fn_union_week_start()))))$new$;
  IF cardinality(string_to_array(source,anchor))<>2 THEN RAISE EXCEPTION 'ECO_ACTIVITY_DETECTOR_ANCHOR_CHANGED'; END IF;
  EXECUTE replace(source,anchor,replacement);
END $patch$;
COMMIT;
