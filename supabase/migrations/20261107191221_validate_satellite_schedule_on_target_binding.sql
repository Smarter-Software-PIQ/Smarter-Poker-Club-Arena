-- Check the current target schedule under the creation owner's existing lock.
-- Changes to a target's clock or late registration do not revoke an existing award.
-- @live-proof: (SELECT md5(prosrc)='f176bec9f24d3fef78d0ca97b1e09a0d' FROM pg_proc WHERE oid='public.fn_ca_guard_new_satellite_target()'::regprocedure)
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE definition text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_guard_new_satellite_target()'::regprocedure) IS DISTINCT FROM 'aa5c95500f5d9fdfc74e3a9e5a5eba8f' THEN
    RAISE EXCEPTION 'SATELLITE_SCHEDULE_PREIMAGE_DRIFT';
  END IF;
  definition:=pg_get_functiondef('public.fn_ca_guard_new_satellite_target()'::regprocedure);
  definition:=replace(definition,$old$   RAISE EXCEPTION 'SATELLITE_NEW_TARGET_UNSUPPORTED' USING ERRCODE='22023';
  END IF;$old$,$new$   RAISE EXCEPTION 'SATELLITE_NEW_TARGET_UNSUPPORTED' USING ERRCODE='22023';
  END IF;
  -- Protect the creation/retarget write from an intervening schedule edit.
  -- A game already underway keeps its award contract when its target changes.
  IF (TG_OP='INSERT' OR v_target IS DISTINCT FROM coalesce(OLD.satellite_target_id,OLD.satellite_target))
     AND (v_target_row.status IS NULL OR v_target_row.status NOT IN ('ANNOUNCED','REGISTERING')
       OR v_target_row.prize_pool_finalized IS TRUE OR v_target_row.start_time IS NULL
       OR NOT isfinite(v_target_row.start_time) OR v_target_row.start_time<=clock_timestamp()
       OR (NEW.start_time IS NOT NULL AND NEW.start_time>=v_target_row.start_time)) THEN
    RAISE EXCEPTION 'SATELLITE_NEW_TARGET_SCHEDULE_UNAVAILABLE' USING ERRCODE='22023';
  END IF;$new$);
  EXECUTE definition;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_guard_new_satellite_target()'::regprocedure) IS DISTINCT FROM 'f176bec9f24d3fef78d0ca97b1e09a0d' THEN
    RAISE EXCEPTION 'SATELLITE_SCHEDULE_POSTIMAGE_DRIFT';
  END IF;
END;
$migration$;
COMMIT;
