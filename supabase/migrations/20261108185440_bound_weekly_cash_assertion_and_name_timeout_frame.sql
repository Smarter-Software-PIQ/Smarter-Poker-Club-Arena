-- 20261108185440_bound_weekly_cash_assertion_and_name_timeout_frame
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 18:54:40 UTC.
--
-- The October 26 Midway close read 5.35 million batch receipts to prove
-- 1.30 million in-week rake records were accrued. The same-scope read-only
-- plan took 46.5 seconds and spilled its hash; indexed lookups by original
-- rake record took 5.8 seconds with the same zero unaccrued candidates.
-- Keep missing and non-accrued receipts visible. If a natural scope visit
-- still hits its budget, record only the failing function and line.
-- @live-proof: md5(pg_get_functiondef('public.fn_assert_cash_commission_period(uuid,uuid,timestamptz,timestamptz)'::regprocedure))='ef372e6bdd51f978f2cd7da1e2814098' AND md5(pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure))='bab099269e6370e48b3d8605c74d1b1d'

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  assertion text := pg_get_functiondef('public.fn_assert_cash_commission_period(uuid,uuid,timestamptz,timestamptz)'::regprocedure);
  coordinator text := pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure);
  old_join constant text := $old_join$     FROM public.rake_records r LEFT JOIN public.accounting_cash_accrual_batches b ON b.rake_record_id=r.id$old_join$;
  new_join constant text := $new_join$     FROM public.rake_records r
     LEFT JOIN LATERAL (
       SELECT a.status
       FROM public.accounting_cash_accrual_batches a
       WHERE a.rake_record_id=r.id
       -- Keep the lookup on the original record key for this week.
       OFFSET 0
     ) b ON true$new_join$;
  declaration constant text := '  v_msg text; v_detail text; v_state text; v_context text;';
  old_handler constant text := $old_handler$          WHEN query_canceled THEN
            GET STACKED DIAGNOSTICS v_msg=MESSAGE_TEXT,v_state=RETURNED_SQLSTATE;
            -- An operator's cancel keeps its meaning: the whole tick stops.
            IF v_msg IS DISTINCT FROM 'canceling statement due to statement timeout' THEN RAISE; END IF;
            v_scope_outcome:='statement_timeout';
            v_scope_error:=jsonb_build_object('success',false,'error','weekly_scope_statement_budget_exhausted','sqlstate',v_state,
              'statement_timeout',current_setting('statement_timeout'));$old_handler$;
  new_handler constant text := $new_handler$          WHEN query_canceled THEN
            GET STACKED DIAGNOSTICS v_msg=MESSAGE_TEXT,v_state=RETURNED_SQLSTATE,v_context=PG_EXCEPTION_CONTEXT;
            -- An operator's cancel keeps its meaning: the whole tick stops.
            IF v_msg IS DISTINCT FROM 'canceling statement due to statement timeout' THEN RAISE; END IF;
            v_scope_outcome:='statement_timeout';
            -- Persist only the first PL/pgSQL function name and line.
            v_timeout_frame := regexp_match(v_context,
              '^PL/pgSQL function ([a-zA-Z_][a-zA-Z_0-9.]*)[(][^[:cntrl:]]*[)] line ([0-9]+) at ', 'n');
            v_scope_error:=jsonb_build_object('success',false,'error','weekly_scope_statement_budget_exhausted','sqlstate',v_state,
              'statement_timeout',current_setting('statement_timeout'),
              'timeout_function',v_timeout_frame[1],'timeout_line',v_timeout_frame[2]);$new_handler$;
BEGIN
  IF md5(assertion) IS DISTINCT FROM '49069d66667813f6f332b8f72c523295'
     OR cardinality(string_to_array(assertion, old_join)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WEEKLY_CASH_ASSERTION_PREIMAGE_CHANGED';
  END IF;
  IF md5(coordinator) IS DISTINCT FROM '12bfc8d8f09be5fa21b951efe3a77d62'
     OR cardinality(string_to_array(coordinator, declaration)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(coordinator, old_handler)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WEEKLY_SCOPE_TIMEOUT_PREIMAGE_CHANGED';
  END IF;

  EXECUTE replace(assertion, old_join, new_join);
  EXECUTE replace(replace(coordinator, declaration, declaration || E'\n  v_timeout_frame text[];'),
    old_handler, new_handler);
END
$patch$;

COMMIT;
