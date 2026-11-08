-- 20261108172301_eco_governance_reads_the_exact_closed_accounting_week
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 17:23:01 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- The ECO completeness check used the preceding 168 UTC hours as a
-- lower bound for the period start. The November 2 close has 169 hours:
-- October 26 07:00 UTC through November 2 08:00 UTC. Its own ECO rows
-- would remain invisible to the check. Match both canonical week boundaries.
-- Midway's already-paid books also hit the scope budget before the close
-- cascade. The source-refusal check visited 35,994 blocked receipts twice
-- to check finite and nonfinite time. A read-only comparison on the exact
-- October 26 close measured 27.4 seconds before and 10.6 seconds with one
-- keyed receipt probe per blocked row. Keep all refusal gates and detail.
-- @live-proof: position('l.period_end = fn_union_week_start()' IN pg_get_functiondef('public.fn_union_credit_risk_check()'::regprocedure))>0 AND position('CROSS JOIN LATERAL' IN pg_get_functiondef('public.fn_cash_source_refusals_for_period(uuid,uuid,timestamptz,timestamptz)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_union_credit_risk_check()'::regprocedure);
  old_predicate constant text := $old$                        AND l.period_start >= fn_union_week_start() - interval '7 days')$old$;
  new_predicate constant text := $new$                        AND l.period_start = fn_union_prev_week_start()
                        AND l.period_end = fn_union_week_start())$new$;
BEGIN
  IF cardinality(string_to_array(definition, old_predicate)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'ECO_GOVERNANCE_WEEK_PREIMAGE_CHANGED';
  END IF;
  EXECUTE replace(definition, old_predicate, new_predicate);
END
$patch$;

DO $refusal_preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_cash_source_refusals_for_period(uuid,uuid,timestamptz,timestamptz)'::regprocedure))
     IS DISTINCT FROM '68140b9499b8df03590eafece567f62d' THEN
    RAISE EXCEPTION 'WEEKLY_CASH_REFUSAL_PREIMAGE_CHANGED';
  END IF;
END
$refusal_preimage$;

CREATE OR REPLACE FUNCTION public.fn_cash_source_refusals_for_period(
  p_union_id uuid, p_club_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE problems jsonb;
BEGIN
  IF (p_union_id IS NULL)=(p_club_id IS NULL) OR p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from)
    OR NOT isfinite(p_to) OR p_to<=p_from THEN
    RAISE EXCEPTION 'invalid_cash_refusal_scope' USING ERRCODE='22023';
  END IF;

  -- Start with the current blocked work only. Each lookup is by its immutable
  -- receipt ID. Materialize the qualifying keys before fetching the detail.
  WITH blocked_work AS MATERIALIZED (
    SELECT receipt_id FROM public.accounting_cash_source_work WHERE status='blocked'
  ), scoped_refusals AS MATERIALIZED (
    SELECT x.id
    FROM blocked_work w
    CROSS JOIN LATERAL (
      SELECT r.id FROM public.accounting_cash_source_receipts r
      WHERE r.id=w.receipt_id
        AND (CASE WHEN r.scope->>'kind'='unknown' THEN 'unknown'
                  WHEN r.scope->>'kind' IN ('club','union') AND octet_length(r.scope->>'id')=36
                  THEN (r.scope->>'kind')||':'||(r.scope->>'id') END)
            =ANY(ARRAY['unknown','union:'||p_union_id::text,'club:'||p_club_id::text])
        AND ((r.earned_at>=p_from AND r.earned_at<p_to)
          OR r.earned_at=ANY(ARRAY['-infinity','infinity']::timestamptz[]))
      -- Keep the lookup correlated. Flattening it can scan the receipt history.
      OFFSET 0
    ) x
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('rake_record_id',r.rake_record_id,
      'reason',r.reason,'scope',r.scope) ORDER BY r.rake_record_id),'[]'::jsonb)
    INTO problems
    FROM scoped_refusals s JOIN public.accounting_cash_source_receipts r ON r.id=s.id;
  RETURN jsonb_build_object('status',CASE WHEN jsonb_array_length(problems)=0 THEN 'ready' ELSE 'blocked' END,
    'count',jsonb_array_length(problems),'sources',problems);
END
$function$;

-- The installed function is private to its owner and nested definer callers.
REVOKE ALL ON FUNCTION public.fn_cash_source_refusals_for_period(uuid,uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
