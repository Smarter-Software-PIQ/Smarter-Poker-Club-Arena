-- @live-proof: position('funded_credit_tracking_basis' in pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure)) > 0
-- PR #8729 changed credit lines to funded-wallet tracking on October 30.
-- The digest still described every generated tracking statement as prohibited
-- borrowed credit. Match the immutable exact agent/period basis before treating
-- a statement as expected. Missing, inconsistent or incomplete evidence remains
-- attention. Historical metrics, invoices, balances and source alerts are kept.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $digest$
DECLARE d text;old text;replacement text;
BEGIN
 d:=pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure);
 IF position('funded_credit_tracking_basis' IN d)>0 THEN RETURN;END IF;
 old:='  v_source_events jsonb;';
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'digest tracking declaration anchor changed';END IF;
 d:=replace(d,old,old||E'\n  v_credit_count numeric; v_credit_unbacked numeric;');
 old:=$before$  v := (p_metrics#>>'{agents,agent_credit_invoices}')::numeric;
  IF COALESCE(v,0) > 0 THEN
    a := a || jsonb_build_object('rule','agent_on_credit','severity','warning','title', format('%s agent credit invoices were created (agents are prepaid only)', v), 'detail', jsonb_build_object('count', v));
  END IF;$before$;
 replacement:=$after$  v := (p_metrics#>>'{agents,agent_credit_invoices}')::numeric;
  IF COALESCE(v,0) > 0 THEN
    -- funded_credit_tracking_basis: a statement documents an actual funded
    -- wallet top-up requirement; it never grants borrowed spendable chips.
    SELECT count(*),count(*) FILTER(WHERE NOT EXISTS(
      SELECT 1 FROM public.agent_credit_weekly_basis b
      JOIN public.agent_credit_tracking_policy policy ON policy.singleton
       AND b.period_end>=policy.activated_at
      WHERE b.agent_id=i.agent_id AND b.period_start=i.period_start AND b.period_end=i.period_end
       AND b.amount_owed=GREATEST(0,b.credit_line-b.agent_wallet_before_rakeback)
       AND i.debt_owed>0 AND i.debt_owed<=b.amount_owed))
      INTO v_credit_count,v_credit_unbacked
      FROM public.credit_invoices i WHERE i.created_at>=s AND i.created_at<e;
    IF v_credit_count IS DISTINCT FROM v THEN
      a:=a||jsonb_build_object('rule','agent_on_credit','severity','warning',
        'title','Agent Invoice Tracking Evidence Is Incomplete',
        'detail',jsonb_build_object('count',v,'source_count',v_credit_count,'unbacked',v_credit_unbacked));
    ELSIF v_credit_unbacked>0 THEN
      a:=a||jsonb_build_object('rule','agent_on_credit','severity','warning',
        'title',format('%s agent invoices lack an original funded tracking basis',v_credit_unbacked),
        'detail',jsonb_build_object('count',v_credit_unbacked,'invoices_created',v));
    END IF;
  END IF;$after$;
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'digest original credit attention anchor changed';END IF;
 EXECUTE replace(d,old,replacement);
END $digest$;
COMMIT;
