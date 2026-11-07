-- A satellite transaction used to hold the platform finish mutex while
-- waiting for a source or target row or hand lane. Other tournaments could
-- not settle during that wait. Preserve the original financial exclusions.
-- @live-proof: (SELECT md5(prosrc)='67f27c9cfc45cc50dedfcdddc6cf03e2' FROM pg_proc WHERE oid=to_regprocedure('public.fn_ca_lock_settlement_lane_for_satellite_finish(uuid)'))

BEGIN;
SET LOCAL lock_timeout='3s';
DO $pre$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid='public.fn_ca_lock_settlement_lane_for_satellite_finish(uuid)'::regprocedure
      AND md5(prosrc)='c0f7edc3cdef54d9c920d44b94627b11' AND proowner='postgres'::regrole
      AND proacl::text='{postgres=X/postgres,service_role=X/postgres}'
      AND proconfig=ARRAY['search_path=public, pg_temp'] AND NOT prosecdef
  ) THEN RAISE EXCEPTION 'satellite finish admission predecessor differs'; END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ca_lock_settlement_lane_for_satellite_finish(p_satellite_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_held text := COALESCE(current_setting('ca.finish_lane_tournament', true), '');
  v_target_id uuid;
  v_first uuid;
  v_second uuid;
BEGIN
  IF v_held <> '' THEN
    -- Re-entry inside a finish transaction: everything below is held.
    PERFORM public.fn_ca_lock_settlement_lane_for_finish(NULL);
    RETURN;
  END IF;
  IF p_satellite_id IS NOT NULL THEN
    SELECT COALESCE(t.satellite_target_id, t.satellite_target)
      INTO v_target_id
      FROM public.tournaments t
     WHERE t.id = p_satellite_id;
  END IF;
  IF p_satellite_id IS NULL OR v_target_id IS NULL OR v_target_id = p_satellite_id THEN
    -- No target to scope to: the whole lane, as it always was.
    PERFORM public.fn_ca_lock_settlement_lane_global();
    RETURN;
  END IF;
  -- G shared, F exclusive (one finish at a time, satellite or not), then
  -- both T keys exclusively in uuid order. A rolling authority or hand of
  -- either tournament waits on its T; two satellites into one target are
  -- serialised by F; no other transaction holds two T keys at once.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-terminal-settlement:v1', 0));
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca:tournament-finish-lane:v1', 0));
  IF p_satellite_id::text < v_target_id::text THEN
    v_first := p_satellite_id; v_second := v_target_id;
  ELSE
    v_first := v_target_id; v_second := p_satellite_id;
  END IF;
  -- Keep the financial lock order. A wait for a specific source or target
  -- must not hold the platform finish mutex. 55P03 rolls back this attempt.
  IF NOT pg_try_advisory_xact_lock(
      hashtextextended('ca:tournament-terminal-settlement:v1:' || v_first::text, 0))
     OR NOT pg_try_advisory_xact_lock(
      hashtextextended('ca:tournament-terminal-settlement:v1:' || v_second::text, 0)) THEN
    RAISE EXCEPTION 'satellite settlement lane busy for source % and target %',
      p_satellite_id, v_target_id USING ERRCODE = '55P03';
  END IF;
  -- Keep the payer's target-before-source row order. NOWAIT also covers a
  -- row writer that did not acquire the tournament advisory key.
  PERFORM 1 FROM public.tournaments t
    WHERE t.id IN (v_target_id, p_satellite_id)
    ORDER BY CASE WHEN t.id = v_target_id THEN 0 ELSE 1 END
    FOR UPDATE NOWAIT;
  -- Re-entry names the satellite; T(target) is held for the transaction's
  -- life regardless, which is what the target's guards read.
  PERFORM set_config('ca.finish_lane_tournament', p_satellite_id::text, true);
END;
$function$;

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_lock_settlement_lane_for_satellite_finish(uuid)'::regprocedure)
       IS DISTINCT FROM '67f27c9cfc45cc50dedfcdddc6cf03e2' THEN
    RAISE EXCEPTION 'satellite finish admission postimage differs';
  END IF;
END $post$;
COMMIT;
