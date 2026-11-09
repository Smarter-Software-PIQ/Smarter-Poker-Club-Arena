-- 163346 projected field-capped receipts to the legacy ticket-covered pool
-- outside the execution GUC. The current engine's lost-ack resolver reads in
-- that context too, so its v3 recovery answer omitted a committed remainder.
-- Restore only those two JSON fields to the original #10059 reader. The
-- original settlement, receipt rows, payout legs, grants and guards are kept.
-- Installation requires the known installed legacy projection. If its owner
-- retires 163346 before installation, this follow-up is unnecessary.
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure))='07247c1fbbdb9709740d00bcc370eb75'

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';

DO $restore_receipt$
DECLARE
  definition text:=pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure);
  projected_pool constant text := $old$    'pool', CASE WHEN v_h.ticket_award_count = v_h.field_size AND v_h.pool > v_h.ticket_award_count * v_h.ticket_cost AND current_setting('app.satellite_capped_awards', true) IS DISTINCT FROM 'v1' THEN round(v_h.ticket_award_count * v_h.ticket_cost, 2) ELSE v_h.pool END,$old$;
  projected_remainder constant text := $old$    'remainder', CASE WHEN v_h.ticket_award_count = v_h.field_size AND v_h.pool > v_h.ticket_award_count * v_h.ticket_cost AND current_setting('app.satellite_capped_awards', true) IS DISTINCT FROM 'v1' THEN NULL ELSE v_remainder END,$old$;
BEGIN
  IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=
      'public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure
      AND pg_get_userbyid(proowner)='postgres'
      AND proacl=ARRAY['postgres=X/postgres']::aclitem[]
      AND proconfig=ARRAY['search_path=public','statement_timeout=30s']::text[]
      AND prosecdef AND provolatile='v') THEN
    RAISE EXCEPTION 'satellite_recovery_projection_metadata_changed';
  END IF;
  IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations
    WHERE version='20261109163346' AND name='settle_capped_satellites_and_nov08_digest_v2')
    OR md5(definition) IS DISTINCT FROM '605f94538e5ca3507512e8631ff88f8f'
    OR cardinality(string_to_array(definition,projected_pool)) IS DISTINCT FROM 2
    OR cardinality(string_to_array(definition,projected_remainder)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'satellite_recovery_projection_preimage_changed';
  END IF;
  definition:=replace(definition,projected_pool,$new$    'pool', v_h.pool,$new$);
  definition:=replace(definition,projected_remainder,$new$    'remainder', v_remainder,$new$);
  EXECUTE definition;
  IF md5(pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure))
    IS DISTINCT FROM '07247c1fbbdb9709740d00bcc370eb75' THEN
    RAISE EXCEPTION 'satellite_recovery_projection_postimage_changed';
  END IF;
END
$restore_receipt$;

COMMIT;
