-- Preserve canonical recovery and strict capped-owner admission in either
-- installed predecessor state. No payouts, receipt rows or status updates.
-- The known installed legacy pair is restored to #10059; an already-canonical
-- pair is a no-op. Mixed, unknown or unrecorded states are refused.
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure))='07247c1fbbdb9709740d00bcc370eb75'
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure))='88743d6d6484247ac4175c6d8bd9e0c9'

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';

DO $restore_receipt$
DECLARE
  settle text:=pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure);
  definition text:=pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure);
  projected_pool constant text := $old$    'pool', CASE WHEN v_h.ticket_award_count = v_h.field_size AND v_h.pool > v_h.ticket_award_count * v_h.ticket_cost AND current_setting('app.satellite_capped_awards', true) IS DISTINCT FROM 'v1' THEN round(v_h.ticket_award_count * v_h.ticket_cost, 2) ELSE v_h.pool END,$old$;
  projected_remainder constant text := $old$    'remainder', CASE WHEN v_h.ticket_award_count = v_h.field_size AND v_h.pool > v_h.ticket_award_count * v_h.ticket_cost AND current_setting('app.satellite_capped_awards', true) IS DISTINCT FROM 'v1' THEN NULL ELSE v_remainder END,$old$;
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE oid IN (
      'public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure,
      'public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure)
      AND pg_get_userbyid(proowner)='postgres'
      AND proacl=ARRAY['postgres=X/postgres']::aclitem[]
      AND proconfig=ARRAY['search_path=public','statement_timeout=30s']::text[]
      AND prosecdef AND provolatile='v')<>2 THEN
    RAISE EXCEPTION 'satellite_recovery_projection_metadata_changed';
  END IF;
  IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations
    WHERE version='20261109163346' AND name='settle_capped_satellites_and_nov08_digest_v2') THEN
    RAISE EXCEPTION 'satellite_recovery_projection_preimage_changed';
  END IF;
  IF md5(definition)='07247c1fbbdb9709740d00bcc370eb75'
    AND md5(settle)='88743d6d6484247ac4175c6d8bd9e0c9' THEN
    RETURN; -- Already canonical: no writes or financial calls.
  END IF;
  IF md5(definition) IS DISTINCT FROM '605f94538e5ca3507512e8631ff88f8f'
    OR md5(settle) IS DISTINCT FROM '9922d5bdafdfd794c7a3393ea8168f06'
    OR cardinality(string_to_array(definition,projected_pool)) IS DISTINCT FROM 2
    OR cardinality(string_to_array(definition,projected_remainder)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'satellite_recovery_projection_preimage_changed';
  END IF;
  definition:=replace(definition,projected_pool,$new$    'pool', v_h.pool,$new$);
  definition:=replace(definition,projected_remainder,$new$    'remainder', v_remainder,$new$);
  settle:=replace(settle,
    $old$     AND current_setting('app.satellite_capped_awards',true) IS DISTINCT FROM 'v1'
     AND nullif(current_setting('app.tournament_terminal_request_id',true),'') IS NULL THEN$old$,
    $new$     AND current_setting('app.satellite_capped_awards',true) IS DISTINCT FROM 'v1' THEN$new$);
  EXECUTE settle;
  EXECUTE definition;
  IF md5(pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure))
    IS DISTINCT FROM '07247c1fbbdb9709740d00bcc370eb75'
    OR md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure))
      IS DISTINCT FROM '88743d6d6484247ac4175c6d8bd9e0c9' THEN
    RAISE EXCEPTION 'satellite_recovery_projection_postimage_changed';
  END IF;
END
$restore_receipt$;

COMMIT;
