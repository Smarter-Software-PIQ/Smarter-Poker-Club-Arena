-- 20261102045002_rabbit_hunt_replay_status_says_saved_expired_or_unavailable.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-02: "Make the one-day availability limit clear in the UI ...
-- While the engine dependency is unavailable, show an accurate unavailable
-- state rather than implying an eligible hand has expired."
--
-- The replayer inferred a previous hand's availability from its AGE alone.
-- While the engine that saves run-outs (#9233) is not yet serving, every VIP
-- saw a live button whose only answer was "No Longer Available" - which reads
-- as "your hand expired" when the truth is "this feature is not live yet".
--
-- 1. public.fn_rabbit_hunt_replay_status(table, hand) answers from the sealed
--    rabbit_hunt_offers table WITHOUT returning any card:
--      saved        - this caller was dealt in; expires_at = saved + 1 day
--      not_eligible - a run-out is on file, but the caller was not dealt in
--      expired      - on file but older than one day (awaiting the prune)
--      not_saved    - run-outs ARE being saved, but not this hand's
--      unavailable  - no run-out saved anywhere in the last 30 minutes:
--                     previous-hand rabbit hunting is not live
--      signed_out   - no caller
--    It reveals existence and timing only to a dealt-in caller, and a single
--    platform-wide "is anything being saved" bit to everyone signed in. The
--    cards still leave the server only through the engine, paid.
--
-- 2. The one-day limit is made exact: the prune moves from hourly (:41) to
--    every ten minutes, so a saved run-out outlives its stated day by at
--    most ten minutes instead of up to an hour.
--
-- @live-proof: has_function_privilege('authenticated','public.fn_rabbit_hunt_replay_status(uuid,bigint)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_rabbit_hunt_replay_status(uuid,bigint)','EXECUTE') AND EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'ca-rabbit-hunt-offers-prune' AND schedule = '*/10 * * * *' AND active)

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_rabbit_hunt_replay_status(p_table_id uuid, p_hand_number bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_created timestamptz;
  v_eligible uuid[];
  v_active boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;

  SELECT o.created_at, o.eligible_user_ids
    INTO v_created, v_eligible
    FROM public.rabbit_hunt_offers o
   WHERE o.table_id = p_table_id AND o.hand_number = p_hand_number;

  IF FOUND THEN
    IF NOT (v_caller = ANY (COALESCE(v_eligible, '{}'::uuid[]))) THEN
      RETURN jsonb_build_object('status', 'not_eligible');
    END IF;
    IF v_created <= now() - interval '1 day' THEN
      RETURN jsonb_build_object('status', 'expired');
    END IF;
    RETURN jsonb_build_object('status', 'saved', 'expires_at', v_created + interval '1 day');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rabbit_hunt_offers o2 WHERE o2.created_at > now() - interval '30 minutes'
  ) INTO v_active;

  RETURN jsonb_build_object('status', CASE WHEN v_active THEN 'not_saved' ELSE 'unavailable' END);
END
$function$;

COMMENT ON FUNCTION public.fn_rabbit_hunt_replay_status(uuid, bigint) IS
  'Card-free availability of a previous hand''s saved rabbit-hunt run-out for the signed-in caller (2026-11-02): saved (with expires_at = saved + 1 day), not_eligible, expired, not_saved, unavailable (nothing saved platform-wide in 30 minutes: previous-hand rabbit hunt not live), signed_out. Never returns cards; purchases go through the engine.';

REVOKE ALL ON FUNCTION public.fn_rabbit_hunt_replay_status(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rabbit_hunt_replay_status(uuid, bigint) TO authenticated, service_role;

-- Not DDL: cron.unschedule/cron.schedule write rows in cron.job.
DO $$
BEGIN
  PERFORM cron.unschedule('ca-rabbit-hunt-offers-prune');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- periodic-work: the prune IS the product: rabbit_hunt_offers promises a
-- one-day retention that the UI now states to the player; every ten minutes
-- keeps that promise within ten minutes rather than within the hour.
SELECT cron.schedule(
  'ca-rabbit-hunt-offers-prune',
  '*/10 * * * *',
  'SELECT public.sp_prune_rabbit_hunt_offers(5000)'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'ca-rabbit-hunt-offers-prune'
        AND schedule = '*/10 * * * *'
        AND command = 'SELECT public.sp_prune_rabbit_hunt_offers(5000)'
        AND active) <> 1 THEN
    RAISE EXCEPTION 'ca-rabbit-hunt-offers-prune is not registered exactly once';
  END IF;
  IF has_function_privilege('anon', 'public.fn_rabbit_hunt_replay_status(uuid,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'replay status must not be callable without an account';
  END IF;
END $$;

COMMIT;
