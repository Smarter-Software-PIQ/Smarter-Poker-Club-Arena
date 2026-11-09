-- Exact obsolete patch from 10200, parent edb19408b54. Original file SHA256
-- 5c33ae87635152f310e5e82603ae07a774eb908f44bda4d14d1ae3608d1853af.
-- Counterfactual local fixture only; never executes manual payer or status cleanup.
DO $patch_sat$
DECLARE
  v_settle text := pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure);
  v_receipt text := pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure);
BEGIN
  IF md5(v_settle) <> '88743d6d6484247ac4175c6d8bd9e0c9' THEN
    RAISE EXCEPTION 'fn_ca_settle_satellite_cohort preimage drift: %', md5(v_settle);
  END IF;
  v_settle := replace(
    v_settle,
    $old_s$  IF v_ticket_award_count=v_field_size
     AND v_pool>v_ticket_award_count*v_ticket_cost
     AND current_setting('app.satellite_capped_awards',true) IS DISTINCT FROM 'v1' THEN$old_s$,
    $new_s$  IF v_ticket_award_count=v_field_size
     AND v_pool>v_ticket_award_count*v_ticket_cost
     AND current_setting('app.satellite_capped_awards',true) IS DISTINCT FROM 'v1'
     AND nullif(current_setting('app.tournament_terminal_request_id',true),'') IS NULL THEN$new_s$
  );
  EXECUTE v_settle;
  IF md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure)) <> '9922d5bdafdfd794c7a3393ea8168f06' THEN
    RAISE EXCEPTION 'fn_ca_settle_satellite_cohort postimage drift';
  END IF;

  IF md5(v_receipt) <> '07247c1fbbdb9709740d00bcc370eb75' THEN
    RAISE EXCEPTION 'fn_ca_satellite_cohort_receipt preimage drift: %', md5(v_receipt);
  END IF;
  v_receipt := replace(
    v_receipt,
    $old_rp$    'pool', v_h.pool,$old_rp$,
    $new_rp$    'pool', CASE WHEN v_h.ticket_award_count = v_h.field_size AND v_h.pool > v_h.ticket_award_count * v_h.ticket_cost AND current_setting('app.satellite_capped_awards', true) IS DISTINCT FROM 'v1' THEN round(v_h.ticket_award_count * v_h.ticket_cost, 2) ELSE v_h.pool END,$new_rp$
  );
  v_receipt := replace(
    v_receipt,
    $old_rr$    'remainder', v_remainder,$old_rr$,
    $new_rr$    'remainder', CASE WHEN v_h.ticket_award_count = v_h.field_size AND v_h.pool > v_h.ticket_award_count * v_h.ticket_cost AND current_setting('app.satellite_capped_awards', true) IS DISTINCT FROM 'v1' THEN NULL ELSE v_remainder END,$new_rr$
  );
  EXECUTE v_receipt;
  IF md5(pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure)) <> '605f94538e5ca3507512e8631ff88f8f' THEN
    RAISE EXCEPTION 'fn_ca_satellite_cohort_receipt postimage drift';
  END IF;
END
$patch_sat$;
