-- 20261118163436_owner_pauses_free_buy_starts_until_the_hand_delay_is_fixed.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT paused FROM public.ca_free_buy_start_pause WHERE singleton) AND position('FREE BUY START PAUSE' in pg_get_functiondef('public.fn_begin_tournament_launch_before_lease_generation(uuid,uuid,timestamptz)'::regprocedure)) > 0 AND position('fn_ca_free_buy_start_paused' in pg_get_functiondef('public.fn_ca_launch_tournament_start_refused(uuid)'::regprocedure)) > 0
--
-- THE OWNER'S FREE BUY PAUSE SWITCH (incident 075013fd, lane FB, 2026-11-18)
--
-- OWNER HOLD (Dan, 2026-11-17 21:30 America/Chicago, binding): shut down ALL
-- Free Buy tournaments 100% until the hand-delay problem is fixed. It was
-- enforced by hand that night and nothing durable carried it, so "Morning Free
-- Buy (NLH)" 7004d241 started at 14:30 UTC on 2026-11-18 with 544 entrants.
-- Dan's 22:17 CT hardening list asked for a "Free Buy pause switch"; this is it.
--
-- WHERE A FREE BUY STARTS (read on production, 2026-11-18 16:30 UTC)
--
--   The engine's discovery loop (GameServer.discoverTournaments, start gate
--   `timeReached = scheduledPreparationAt(start_time, field) <= now`) calls
--   TournamentManagerBase.start(), whose ONE durable admission point is
--   fn_begin_tournament_launch_atomic(...,lease,format) ->
--   fn_begin_tournament_launch_before_lease_generation (the receipt insert is
--   the first launch write), then fn_complete_tournament_launch_atomic flips
--   RUNNING. Every status -> RUNNING / started_at write is also checked by the
--   trigger zzzzzzzz_launch_tournament_admission, which asks
--   fn_ca_launch_tournament_start_refused (the October 30 owner start hold,
--   20261030001305, lives in that same function).
--
-- WHAT THIS CHANGES
--
--   1. public.ca_free_buy_start_pause: one durable row (paused, reason, set_by,
--      set_at, operation_id). Written only by
--      fn_ca_owner_set_free_buy_start_pause (postgres / owner only); every
--      change appends a row to public.ca_free_buy_start_pause_audit. A trigger
--      refuses any other write. Installed ON with Dan's 21:30 CT hold.
--   2. A Free Buy is `tournaments.free_buy IS TRUE` (the kind column every
--      creator stamps; not the name). Live board 2026-11-18: only the five
--      Midway board slots carry it.
--   3. fn_begin_tournament_launch_before_lease_generation, FIRST thing: while
--      the switch is ON, a not-yet-launched REGISTERING Free Buy (no launch
--      receipt, no start evidence) is DEFERRED: its start_time moves to
--      greatest(start_time, now) + 30 minutes, one row in
--      public.ca_free_buy_start_deferrals records the original start, and the
--      call answers {ok:false, reason:'platform_frozen',
--      cause:'free_buy_owner_pause', deferred_until}. 'platform_frozen' is the
--      refusal the serving engine already treats as a quiet stand-down
--      (TournamentManagerBase.beginTournamentLaunch: one console line, no
--      reportError, no retry), and the moved start_time takes the row out of
--      the start gate, so the engine asks again about once every 22 minutes
--      (30 minutes less its ~8 minute preparation lead), never hot.
--      Registrations, entries, horses and humans are untouched (10.5: nothing
--      here reads is_horse); no refund, no ledger row, no money moves.
--   4. fn_ca_launch_tournament_start_refused also answers true for such a
--      Free Buy, so no other writer can flip it RUNNING while paused (the
--      admission trigger raises OPERATOR_FLOOR_PARKED). Read-only addition.
--   5. Turning the switch OFF writes nothing to tournaments. Each deferred
--      Free Buy already carries a start_time at most 30 minutes ahead and
--      starts through the normal path at it. A RUNNING Free Buy, or one whose
--      launch receipt exists, is never touched by either gate.
--
-- NO CRON, NO REPAIR JOB (CLAUDE.md 10.12). New Free Buys may still be created.
--
-- Install guards (read on production 2026-11-18 ~16:35 UTC):
--   * Stale pins: no function in public or smarter_private carries the md5 of
--     either changed function (prosrc fa0a771b... / aa80f650..., functiondef
--     d3fcd5b3... / c611793f...). Nothing to move.
--   * Money-RPC registry: fn_ca_money_rpc_writes_balances is false for every
--     body here (no wallet / balance writes).
--   * Hand path: none of these functions is on the hand path; the deferral
--     writes only public.tournaments (keyed by id) and its own table.
--   * Break window: install outside minute :50-:03 UTC.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $preimage$
BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_begin_tournament_launch_before_lease_generation(uuid,uuid,timestamptz)'::regprocedure))
       IS DISTINCT FROM 'fa0a771ba327e690dd91c26351701a7a'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_ca_launch_tournament_start_refused(uuid)'::regprocedure))
       IS DISTINCT FROM 'aa80f650f8c76bd214d6955394ec355b' THEN
    RAISE EXCEPTION 'FREE_BUY_PAUSE_BASELINE_CHANGED' USING ERRCODE = '55000';
  END IF;
END
$preimage$;

-- 1. The owner's switch, its audit, and the deferral record. No foreign key to
--    tournaments (CLAUDE.md section 2 rule 7).
CREATE TABLE public.ca_free_buy_start_pause (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  paused boolean NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 1000),
  set_by text NOT NULL CHECK (length(btrim(set_by)) > 0),
  set_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  operation_id uuid NOT NULL
);
CREATE TABLE public.ca_free_buy_start_pause_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL,
  paused boolean NOT NULL,
  previous_paused boolean,
  reason text NOT NULL,
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  db_user text NOT NULL DEFAULT session_user
);
CREATE TABLE public.ca_free_buy_start_deferrals (
  tournament_id uuid PRIMARY KEY,
  original_start_time timestamptz NOT NULL,
  deferred_until timestamptz NOT NULL,
  deferrals integer NOT NULL DEFAULT 1 CHECK (deferrals > 0),
  pause_operation_id uuid NOT NULL,
  first_deferred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  last_deferred_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
ALTER TABLE public.ca_free_buy_start_pause ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_free_buy_start_pause_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_free_buy_start_deferrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_free_buy_start_pause, public.ca_free_buy_start_pause_audit,
  public.ca_free_buy_start_deferrals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_free_buy_start_pause, public.ca_free_buy_start_pause_audit,
  public.ca_free_buy_start_deferrals TO service_role;

-- Only the owner function writes the switch; the audit is append-only.
CREATE FUNCTION public.fn_ca_free_buy_start_pause_write_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $function$
BEGIN
  IF TG_TABLE_NAME = 'ca_free_buy_start_pause_audit' THEN
    RAISE EXCEPTION 'FREE_BUY_PAUSE_AUDIT_IS_APPEND_ONLY' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(current_setting('ca.free_buy_start_pause_writer', true), '') <> 'owner' THEN
    RAISE EXCEPTION 'FREE_BUY_PAUSE_OWNER_FUNCTION_ONLY: use fn_ca_owner_set_free_buy_start_pause'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_start_pause_write_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER ca_free_buy_start_pause_owner_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.ca_free_buy_start_pause
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_free_buy_start_pause_write_guard();
CREATE TRIGGER ca_free_buy_start_pause_audit_append_only
  BEFORE UPDATE OR DELETE ON public.ca_free_buy_start_pause_audit
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_free_buy_start_pause_write_guard();

CREATE FUNCTION public.fn_ca_owner_set_free_buy_start_pause(
  p_paused boolean, p_reason text, p_set_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE
  v_previous boolean;
  v_op uuid := gen_random_uuid();
BEGIN
  IF p_paused IS NULL OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 10 AND 1000
     OR p_set_by IS NULL OR length(btrim(p_set_by)) = 0 THEN
    RAISE EXCEPTION 'FREE_BUY_PAUSE_NEEDS_STATE_REASON_AND_OWNER' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('ca.free_buy_start_pause_writer', 'owner', true);
  SELECT paused INTO v_previous FROM public.ca_free_buy_start_pause WHERE singleton FOR UPDATE;
  INSERT INTO public.ca_free_buy_start_pause AS s (singleton, paused, reason, set_by, set_at, operation_id)
  VALUES (true, p_paused, p_reason, btrim(p_set_by), transaction_timestamp(), v_op)
  ON CONFLICT (singleton) DO UPDATE
    SET paused = EXCLUDED.paused, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by,
        set_at = EXCLUDED.set_at, operation_id = EXCLUDED.operation_id;
  INSERT INTO public.ca_free_buy_start_pause_audit (operation_id, paused, previous_paused, reason, set_by)
  VALUES (v_op, p_paused, v_previous, p_reason, btrim(p_set_by));
  PERFORM set_config('ca.free_buy_start_pause_writer', '', true);
  RETURN jsonb_build_object('ok', true, 'paused', p_paused, 'previous_paused', v_previous,
    'operation_id', v_op, 'set_at', transaction_timestamp());
END
$function$;
-- Owner only: no API role may flip it (postgres, the SQL editor and migrations can).
REVOKE ALL ON FUNCTION public.fn_ca_owner_set_free_buy_start_pause(boolean, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- 2. Is this tournament a Free Buy the switch holds? Read-only, lock-free.
CREATE FUNCTION public.fn_ca_free_buy_start_paused(p_tournament uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE v_paused boolean;
BEGIN
  SELECT paused INTO v_paused FROM public.ca_free_buy_start_pause WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FREE_BUY_START_CONTROL_UNKNOWN' USING ERRCODE = '58000';
  END IF;
  IF NOT v_paused THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament AND t.free_buy IS TRUE);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_start_paused(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 3. Defer one paused Free Buy's start. Returns the refusal, or NULL to go on.
--    Lock order matches the launch door: receipt row, then tournament row.
CREATE FUNCTION public.fn_ca_free_buy_start_pause_defers(p_tournament uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE
  v_op uuid;
  v_status text;
  v_started_at timestamptz;
  v_start timestamptz;
  v_until timestamptz;
  v_moved boolean := false;
BEGIN
  IF p_tournament IS NULL OR NOT public.fn_ca_free_buy_start_paused(p_tournament) THEN
    RETURN NULL;
  END IF;
  SELECT operation_id INTO v_op FROM public.ca_free_buy_start_pause WHERE singleton;
  -- A launch already admitted is recovery work, never paused.
  PERFORM 1 FROM public.tournament_launch_receipts r WHERE r.tournament_id = p_tournament FOR UPDATE;
  IF FOUND THEN RETURN NULL; END IF;
  SELECT t.status, t.started_at, t.start_time INTO v_status, v_started_at, v_start
    FROM public.tournaments t WHERE t.id = p_tournament FOR UPDATE;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'REGISTERING' OR v_started_at IS NOT NULL
     OR public.fn_ca_launch_tournament_has_started(p_tournament) IS TRUE THEN
    RETURN NULL;
  END IF;
  v_until := greatest(COALESCE(v_start, transaction_timestamp()), transaction_timestamp()) + interval '30 minutes';
  BEGIN
    UPDATE public.tournaments SET start_time = v_until, updated_at = now() WHERE id = p_tournament;
    v_moved := true;
  EXCEPTION WHEN OTHERS THEN
    -- A guard refused the move (a non-engine caller): the start is still refused.
    v_moved := false;
  END;
  IF v_moved THEN
    INSERT INTO public.ca_free_buy_start_deferrals AS d
      (tournament_id, original_start_time, deferred_until, pause_operation_id)
    VALUES (p_tournament, COALESCE(v_start, transaction_timestamp()), v_until, v_op)
    ON CONFLICT (tournament_id) DO UPDATE
      SET deferred_until = EXCLUDED.deferred_until, deferrals = d.deferrals + 1,
          pause_operation_id = EXCLUDED.pause_operation_id, last_deferred_at = transaction_timestamp();
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'platform_frozen',
    'cause', 'free_buy_owner_pause', 'deferred', v_moved,
    'deferred_until', CASE WHEN v_moved THEN v_until END,
    'pause_operation_id', v_op);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_start_pause_defers(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 4. The launch door asks first (live body, fa0a771b..., plus the block marked).
CREATE OR REPLACE FUNCTION public.fn_begin_tournament_launch_before_lease_generation(p_tournament_id uuid, p_launch_id uuid, p_started_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_existing public.tournament_launch_receipts%ROWTYPE;
  v_status text;
  v_tournament_started_at timestamptz;
  v_requested_started_at timestamptz := COALESCE(p_started_at, transaction_timestamp());
  v_cohort uuid[];
  v_free_buy_pause jsonb;
BEGIN
  /* FREE BUY START PAUSE (Dan, 2026-11-17 21:30 CT; 20261118163436): while the
     owner switch is ON a REGISTERING Free Buy is deferred, not launched. The
     answer is the quiet platform_frozen stand-down the engine already handles. */
  v_free_buy_pause := public.fn_ca_free_buy_start_pause_defers(p_tournament_id);
  IF v_free_buy_pause IS NOT NULL THEN
    RETURN v_free_buy_pause;
  END IF;
  IF public.fn_ca_launch_tournament_start_refused(p_tournament_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','operator_floor_parked');
  END IF;
  PERFORM pg_advisory_xact_lock_shared(530090, 1);

  IF p_tournament_id IS NULL OR p_launch_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_launch_request');
  END IF;

  SELECT * INTO v_existing
    FROM public.tournament_launch_receipts r
   WHERE r.tournament_id = p_tournament_id
   FOR UPDATE;
  IF FOUND THEN
    IF p_started_at IS NOT NULL
       AND v_existing.launch_id = p_launch_id
       AND v_existing.started_at IS DISTINCT FROM p_started_at THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'launch_request_mismatch');
    END IF;
    SELECT t.status, t.started_at INTO v_status, v_tournament_started_at
      FROM public.tournaments t
     WHERE t.id = p_tournament_id
     FOR UPDATE;
    IF NOT FOUND
       OR (v_existing.completed_at IS NULL AND v_status <> 'REGISTERING')
       OR (v_existing.completed_at IS NOT NULL
           AND (v_status <> 'RUNNING'
                OR v_tournament_started_at IS DISTINCT FROM v_existing.started_at)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'launch_receipt_state_mismatch');
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'claimed', true,
      'launch_id', v_existing.launch_id,
      'replay', true,
      'started_at', v_existing.started_at,
      'completed', v_existing.completed_at IS NOT NULL,
      'status', v_status,
      'launch_player_ids', to_jsonb(v_existing.launch_player_ids)
    );
  END IF;

  IF public.fn_entry_purchases_frozen() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'platform_frozen');
  END IF;

  SELECT t.status, t.started_at INTO v_status, v_tournament_started_at
    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_status <> 'REGISTERING' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'launch_status_changed',
      'status', v_status
    );
  END IF;
  IF v_tournament_started_at IS NOT NULL
     AND v_tournament_started_at IS DISTINCT FROM v_requested_started_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'launch_started_at_mismatch');
  END IF;

  INSERT INTO public.tournament_launch_receipts (
    tournament_id, launch_id, started_at, launch_player_ids
  ) VALUES (
    p_tournament_id, p_launch_id, v_requested_started_at,
    CASE WHEN public.fn_ca_tournament_recorded_format(p_tournament_id) IN ('mtt-v1','mtt-v2')
      THEN ARRAY(SELECT p.id FROM public.tournament_players p
        WHERE p.tournament_id=p_tournament_id AND p.status IN ('registered','playing')
        ORDER BY p.id)
      ELSE NULL END
  ) RETURNING launch_player_ids INTO v_cohort;

  RETURN jsonb_build_object(
    'ok', true,
    'claimed', true,
    'launch_id', p_launch_id,
    'replay', false,
    'started_at', v_requested_started_at,
    'completed', false,
    'launch_player_ids', to_jsonb(v_cohort)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_begin_tournament_launch_before_lease_generation(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- 5. No other writer flips a paused Free Buy RUNNING (live body aa80f650... plus one line).
CREATE OR REPLACE FUNCTION public.fn_ca_launch_tournament_start_refused(p_tournament uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t record;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(530090,1);
 PERFORM pg_advisory_xact_lock_shared(530093);
 -- Started-at, live status, launch, Spin and hand evidence keep recovery and settlement open.
 IF public.fn_ca_launch_tournament_has_started(p_tournament) IS NOT TRUE THEN
  IF public.fn_ca_new_tournament_starts_blocked() THEN RETURN true; END IF;
  -- FREE BUY START PAUSE (20261118163436): the owner switch holds unlaunched Free Buys.
  IF public.fn_ca_free_buy_start_paused(p_tournament) THEN RETURN true; END IF;
 END IF;
 SELECT club_id,union_id INTO t FROM public.tournaments WHERE id=p_tournament;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN public.fn_ca_launch_tournament_held(t.club_id,t.union_id)
  AND public.fn_ca_launch_tournament_has_started(p_tournament) IS NOT TRUE;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_launch_tournament_start_refused(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- 6. Install the owner's hold ON.
SELECT public.fn_ca_owner_set_free_buy_start_pause(
  true,
  'Owner hold (Dan, 2026-11-17 21:30 America/Chicago): shut down ALL Free Buy tournaments 100% until the hand-delay problem is fixed. Installed durably by 20261118163436 (incident 075013fd, lane FB).',
  'Dan (owner hold 2026-11-17 21:30 CT), installed by migration 20261118163436');

DO $bounded$
BEGIN
  IF clock_timestamp() - transaction_timestamp() >= interval '8 seconds' THEN
    RAISE EXCEPTION 'FREE_BUY_PAUSE_INSTALL_BUDGET_EXCEEDED';
  END IF;
END
$bounded$;
COMMIT;
