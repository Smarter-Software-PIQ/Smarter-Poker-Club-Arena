-- Satellite settlement agrees with the original live-field owner.
-- Fix both single-winner and cohort counter checks; retain all bank, total-roster,
-- receipt and duplicate-award checks. No persisted game or financial rows repaired.
-- @live-proof: md5(pg_get_functiondef('public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'::regprocedure))='c8abcf05ff594c44e0007fdd73128ad9' AND md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure))='125892fc05cff0f9433813fcfa8fca2b'
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $counter$
DECLARE original text; candidate text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'::regprocedure AND pg_get_userbyid(proowner)='postgres' AND proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'SATELLITE_LIVE_FIELD_OWNER_CHANGED'; END IF;
 SELECT pg_get_functiondef('public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'::regprocedure) INTO original;
 IF md5(original) IS DISTINCT FROM '10ef0bb347ef36feff6c105c491ff12c' THEN RAISE EXCEPTION 'SATELLITE_LIVE_FIELD_PREIMAGE_CHANGED: fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'; END IF;
 candidate := replace(replace(original,$before$WHEN upper(COALESCE(v_target.status, '')) IN ('ANNOUNCED','REGISTERING')
      THEN v_target_live_count_before$before$,$new_before$WHEN upper(COALESCE(v_target.status, '')) IN ('ANNOUNCED','REGISTERING')
      OR (upper(COALESCE(v_target.status, '')) = 'RUNNING'
          AND NOT public.fn_ca_tournament_recorded_seat_first(v_target_id, true))
      THEN v_target_live_count_before$new_before$),$after$WHEN upper(COALESCE(v_target.status, '')) IN ('ANNOUNCED','REGISTERING')
        THEN v_target_live_count$after$,$new_after$WHEN upper(COALESCE(v_target.status, '')) IN ('ANNOUNCED','REGISTERING')
      OR (upper(COALESCE(v_target.status, '')) = 'RUNNING'
          AND NOT public.fn_ca_tournament_recorded_seat_first(v_target_id, true))
        THEN v_target_live_count$new_after$);
 candidate := replace(candidate,'Once RUNNING, it is the immutable total entrant
  -- count and must not shrink when a player is eliminated.','A RUNNING non-seat-first field uses the same live count,
  -- maintained by the original roster membership trigger on every bust.');
 EXECUTE candidate;
 IF md5(pg_get_functiondef('public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'c8abcf05ff594c44e0007fdd73128ad9' THEN RAISE EXCEPTION 'SATELLITE_LIVE_FIELD_POSTIMAGE_CHANGED'; END IF;
END $counter$;
DO $counter$
DECLARE original text; candidate text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure AND pg_get_userbyid(proowner)='postgres' AND proacl::text='{postgres=X/postgres}') THEN RAISE EXCEPTION 'SATELLITE_LIVE_FIELD_OWNER_CHANGED'; END IF;
 SELECT pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure) INTO original;
 IF md5(original) IS DISTINCT FROM '0b36c08a59b0f82ea10d00106899c12c' THEN RAISE EXCEPTION 'SATELLITE_LIVE_FIELD_PREIMAGE_CHANGED: fn_ca_settle_satellite_cohort(uuid,uuid[])'; END IF;
 candidate := replace(replace(original,$before$WHEN upper(COALESCE(v_target.status, '')) IN ('ANNOUNCED','REGISTERING')
      THEN v_target_live_count_before$before$,$new_before$WHEN upper(COALESCE(v_target.status, '')) IN ('ANNOUNCED','REGISTERING')
      OR (upper(COALESCE(v_target.status, '')) = 'RUNNING'
          AND NOT public.fn_ca_tournament_recorded_seat_first(v_target_id, true))
      THEN v_target_live_count_before$new_before$),$after$WHEN upper(COALESCE(v_target.status, '')) IN ('ANNOUNCED','REGISTERING')
        THEN v_target_live_count$after$,$new_after$WHEN upper(COALESCE(v_target.status, '')) IN ('ANNOUNCED','REGISTERING')
      OR (upper(COALESCE(v_target.status, '')) = 'RUNNING'
          AND NOT public.fn_ca_tournament_recorded_seat_first(v_target_id, true))
        THEN v_target_live_count$new_after$);
 candidate := replace(candidate,'Once RUNNING, it is the immutable total entrant
  -- count and must not shrink when a player is eliminated.','A RUNNING non-seat-first field uses the same live count,
  -- maintained by the original roster membership trigger on every bust.');
 EXECUTE candidate;
 IF md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure)) IS DISTINCT FROM '125892fc05cff0f9433813fcfa8fca2b' THEN RAISE EXCEPTION 'SATELLITE_LIVE_FIELD_POSTIMAGE_CHANGED'; END IF;
END $counter$;
COMMIT;
