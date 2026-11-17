-- @live-proof: (SELECT regexp_count(prosrc,'bounded_maintenance_freeze')=2 AND position('public.fn_platform_frozen()' in prosrc)>0 AND position('interval ''5 minutes''' in prosrc)>0 FROM pg_proc WHERE oid='public.fn_ca_table_stall_watch_tick(bigint)'::regprocedure)
-- The ten-second observer held profiles AccessShare during a confirmed five-minute
-- database break, refusing the one-second terms-column DDL. Leave that bounded
-- freeze quiet before HTTP and recheck after HTTP; the original post-deadline
-- observer and twelve-minute maintenance-overrun detection remain unchanged.
-- Function-only replacement preserves the original owner, ACL and attributes.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $bounded_watch$
DECLARE
 original text := pg_get_functiondef('public.fn_ca_table_stall_watch_tick(bigint)'::regprocedure);
 patched text;
 guard text := $guard$  IF public.fn_platform_frozen() AND EXISTS (
    SELECT 1 FROM public.engine_maintenance_break b
    WHERE b.enforce_freeze AND b.phase='counting_down'
      AND b.break_started_at <= clock_timestamp()
      AND b.break_ends_at > clock_timestamp()
      AND b.break_ends_at > b.break_started_at
      AND b.break_ends_at <= b.break_started_at + interval '5 minutes'
  ) THEN
    RETURN jsonb_build_object('skipped','bounded_maintenance_freeze');
  END IF;
$guard$;
 first_anchor text := E'BEGIN\n  IF NOT pg_try_advisory_xact_lock';
 last_anchor text := '  RETURN public.fn_ca_table_stall_watch_ingest(v_body, v_now, p_threshold_ms);';
BEGIN
 IF md5(original) IS DISTINCT FROM 'aed520360cdb0170be56c68e181f1331' THEN
   RAISE EXCEPTION 'STALL_WATCH_BOUNDED_FREEZE_PREIMAGE_DRIFT' USING ERRCODE='55000';
 END IF;
 IF position(first_anchor in original)=0 OR position(last_anchor in original)=0 THEN
   RAISE EXCEPTION 'STALL_WATCH_BOUNDED_FREEZE_ANCHOR_DRIFT' USING ERRCODE='55000';
 END IF;
 patched := replace(original,first_anchor,E'BEGIN\n'||guard||'  IF NOT pg_try_advisory_xact_lock');
 patched := replace(patched,last_anchor,guard||last_anchor);
 IF replace(patched,guard,'') IS DISTINCT FROM original THEN
   RAISE EXCEPTION 'STALL_WATCH_BOUNDED_FREEZE_SOURCE_DRIFT' USING ERRCODE='55000';
 END IF;
 EXECUTE patched;
END $bounded_watch$;
COMMIT;
