-- @live-proof: (SELECT count(*)=3 FROM pg_proc WHERE oid IN ('public.fn_snapshot_maintenance_thaw_targets(timestamptz,numeric)'::regprocedure,'public.fn_credit_maintenance_thaw_targets(timestamptz,numeric)'::regprocedure,'public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text)'::regprocedure) AND position('promo_expires_at' in prosrc)>0)
-- Promo expiry is a player-losable clock: maintenance must preserve its full duration.
-- Patch the original v3 snapshot, bounded credit and owner, preserving every
-- existing source/ownership/release guard and per-call four-second budget.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $quiescent$
BEGIN
 PERFORM pg_advisory_xact_lock(530090,1);
 IF EXISTS(SELECT 1 FROM public.engine_maintenance_break)
 OR EXISTS(SELECT 1 FROM public.engine_maintenance_thaws WHERE contract_version=3
   AND (NOT COALESCE((shifted->>'complete')::boolean,false) OR release_target_at>clock_timestamp())) THEN
  RAISE EXCEPTION 'PROMO_THAW_REQUIRES_QUIESCENT_CUTOVER';
 END IF;
END $quiescent$;

DO $patch$
DECLARE def text;needle text;replacement text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_snapshot_maintenance_thaw_targets(timestamptz,numeric)'::regprocedure) IS DISTINCT FROM 'd88e7a1fef47d20d060a7e100599e2fe' THEN RAISE EXCEPTION 'PROMO_THAW_PREIMAGE_DRIFT: fn_snapshot_maintenance_thaw_targets(timestamptz,numeric)'; END IF;
 SELECT pg_get_functiondef('public.fn_snapshot_maintenance_thaw_targets(timestamptz,numeric)'::regprocedure) INTO def;
 needle:=$needle$  UPDATE public.engine_maintenance_thaws t
$needle$;
 replacement:=$replacement$  INSERT INTO public.engine_maintenance_thaw_targets(freeze_started_at, step, target_id)
  SELECT p_freeze_started, 'promo_expires_at', g.id
    FROM public.ca_promo_play_through_grants g
   WHERE g.closed_at IS NULL AND g.expires_at > p_freeze_started
     AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id=g.club_id AND c.lifecycle_status='retired')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('promo_expires_at', v_n);

  UPDATE public.engine_maintenance_thaws t
$replacement$;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'PROMO_THAW_ANCHOR_DRIFT'; END IF;
 def:=replace(def,needle,replacement);
 EXECUTE def;
END $patch$;

DO $patch$
DECLARE def text;needle text;replacement text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_credit_maintenance_thaw_targets(timestamptz,numeric)'::regprocedure) IS DISTINCT FROM '3f5859bd21f9e7b35e59ed5337e2afab' THEN RAISE EXCEPTION 'PROMO_THAW_PREIMAGE_DRIFT: fn_credit_maintenance_thaw_targets(timestamptz,numeric)'; END IF;
 SELECT pg_get_functiondef('public.fn_credit_maintenance_thaw_targets(timestamptz,numeric)'::regprocedure) INTO def;
 needle:=$needle$'reconnect_presence','reconnect_snapshots','lightning_drain_deadline_at'$needle$;
 replacement:=$replacement$'reconnect_presence','reconnect_snapshots','lightning_drain_deadline_at','promo_expires_at'$replacement$;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'PROMO_THAW_ANCHOR_DRIFT'; END IF;
 def:=replace(def,needle,replacement);
 needle:=$needle$    ELSIF v_step = 'lightning_drain_deadline_at' THEN$needle$;
 replacement:=$replacement$    ELSIF v_step = 'promo_expires_at' THEN
      WITH due AS MATERIALIZED (
        SELECT x.target_id,x.credited_seconds FROM public.engine_maintenance_thaw_targets x
         WHERE x.freeze_started_at=p_freeze_started AND x.step=v_step
           AND x.credited_seconds<p_target_seconds
         ORDER BY x.target_id LIMIT v_batch FOR UPDATE
      ), moved AS (
        UPDATE public.ca_promo_play_through_grants r
           SET expires_at=CASE WHEN r.closed_at IS NULL THEN r.expires_at
             + make_interval(secs=>p_target_seconds-d.credited_seconds) ELSE r.expires_at END
          FROM due d WHERE r.id=d.target_id
           AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id=r.club_id AND c.lifecycle_status='retired')
        RETURNING r.id
      ), marked AS (
        UPDATE public.engine_maintenance_thaw_targets x SET credited_seconds=p_target_seconds
          FROM due d WHERE x.freeze_started_at=p_freeze_started AND x.step=v_step
            AND x.target_id=d.target_id RETURNING x.target_id
      ) SELECT (SELECT count(*) FROM moved),(SELECT count(*) FROM marked) INTO v_moved,v_marked;
    ELSIF v_step = 'lightning_drain_deadline_at' THEN$replacement$;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'PROMO_THAW_ANCHOR_DRIFT'; END IF;
 def:=replace(def,needle,replacement);
 EXECUTE def;
END $patch$;

DO $patch$
DECLARE def text;needle text;replacement text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text)'::regprocedure) IS DISTINCT FROM '0fa9318d609b741f7c2142b05b325c7b' THEN RAISE EXCEPTION 'PROMO_THAW_PREIMAGE_DRIFT: fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text)'; END IF;
 SELECT pg_get_functiondef('public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text)'::regprocedure) INTO def;
 needle:=$needle$'reconnect_presence','reconnect_snapshots'$needle$;
 replacement:=$replacement$'reconnect_presence','reconnect_snapshots','promo_expires_at'$replacement$;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'PROMO_THAW_ANCHOR_DRIFT'; END IF;
 def:=replace(def,needle,replacement);
 needle:=$needle$    v_result := public.fn_thaw_platform_checkpointed(
      p_freeze_started,
      LEAST(v_existing.frozen_seconds, 900::numeric),
      p_thawed_by
    );$needle$;
 replacement:=$replacement$    -- Once the retained worker has receipted its original families, the
    -- same v3 bounded worker handles the new family. One four-second worker
    -- runs per installment; no full-duration shift or post-release write.
    IF v_existing.shifted ?& array_remove(c_required_steps,'promo_expires_at') THEN
      v_result := public.fn_credit_maintenance_thaw_targets(
        p_freeze_started,v_existing.frozen_seconds);
    ELSE
    v_result := public.fn_thaw_platform_checkpointed(
      p_freeze_started,
      LEAST(v_existing.frozen_seconds, 900::numeric),
      p_thawed_by
    );
    END IF;$replacement$;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'PROMO_THAW_ANCHOR_DRIFT'; END IF;
 def:=replace(def,needle,replacement);
 EXECUTE def;
END $patch$;

COMMIT;
