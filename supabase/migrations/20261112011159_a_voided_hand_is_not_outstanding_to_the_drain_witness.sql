-- 20261112011159_a_voided_hand_is_not_outstanding_to_the_drain_witness
--
-- A VOIDED LIGHTNING HAND IS NOT OUTSTANDING TO THE DRAIN WITNESS (2026-11-12).
--
-- fn_ca_release_drained_predecessor_witness counts recent lightning hands with
-- settled_at NULL as "possibly still moving". Since 20261112000834 an
-- abandoned instance voids its hand (voided_at), and a voided hand is
-- terminal: fn_lightning_settle_hand refuses its abandoned instance and the
-- lightning_hand_settled_or_voided_never_both CHECK refuses the row. Counting
-- it kept the witness loud for up to the whole lightning window after the
-- very reaps a cutover performs. Everything else is unchanged, the answer
-- keys included, so engine-release-inflight-hands.py and the drained-cutover
-- tests read it exactly as before.
--
-- Installed on production through the Supabase MCP as version 20261112011159
-- under this same name (readback passed: contract intact, voided hands
-- excluded; grants closed to service_role, matching the live state), so the
-- applier answers ALREADY-APPLIED by name; this file is the repository's
-- canonical copy for a fresh database.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_ca_release_drained_predecessor_witness(p_moving_window_seconds integer DEFAULT 120, p_lightning_window_seconds integer DEFAULT 600)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE
  -- Transaction time, so the formed_at index is usable (one-statement call).
  v_now timestamptz := now();
  v_reserved bigint;
  v_open bigint;
  v_moving bigint;
  v_lightning bigint;
BEGIN
  IF p_moving_window_seconds IS NULL OR p_moving_window_seconds < 30 OR p_moving_window_seconds > 600
     OR p_lightning_window_seconds IS NULL OR p_lightning_window_seconds < 120 OR p_lightning_window_seconds > 1800 THEN
    RAISE EXCEPTION 'DRAINED_WITNESS_WINDOW_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_reserved FROM smarter_private.f06_hand_permits WHERE state = 'reserved';
  SELECT count(*), count(*) FILTER (WHERE updated_at >= v_now - make_interval(secs => p_moving_window_seconds))
    INTO v_open, v_moving
    FROM smarter_private.hand_continuations;
  SELECT count(*) INTO v_lightning
    FROM public.lightning_hand
   WHERE formed_at >= v_now - make_interval(secs => p_lightning_window_seconds)
     AND settled_at IS NULL
     -- A VOIDED HAND IS TERMINAL (20261112000834): its instance is abandoned,
     -- settlement refuses it, and the table CHECK refuses the row. It is not
     -- a hand the drain is waiting on.
     AND voided_at IS NULL;

  RETURN jsonb_build_object(
    'contract', 'drained-predecessor-witness-v1',
    'observed_at', v_now,
    'moving_window_seconds', p_moving_window_seconds,
    'lightning_window_seconds', p_lightning_window_seconds,
    'reserved_tournament_permits', v_reserved,
    'retained_tournament_hands', v_open,
    'moving_tournament_hands', v_moving,
    'unsettled_recent_lightning_hands', v_lightning
  );
END;
$function$;

-- OPERATOR AND ENGINE TELEMETRY, NOT PLAYER SURFACE. The witness is read by
-- the release tooling with service credentials; a caller with no account has
-- no business asking how drained the engine is. These match the live grants.
REVOKE ALL ON FUNCTION public.fn_ca_release_drained_predecessor_witness(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_release_drained_predecessor_witness(integer, integer) TO service_role;

-- @live-proof: (SELECT (public.fn_ca_release_drained_predecessor_witness() ->> 'contract') = 'drained-predecessor-witness-v1')

COMMIT;
