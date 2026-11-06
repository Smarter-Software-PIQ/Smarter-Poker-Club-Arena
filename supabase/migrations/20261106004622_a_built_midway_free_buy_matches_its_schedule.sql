-- 20261106004622_a_built_midway_free_buy_matches_its_schedule.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A BUILT EVENT MUST MATCH ITS SCHEDULE (owner, 2026-11-05), and an unstarted,
-- horse-only, wrongly-shaped event is rebuilt to it. On 2026-11-04 the Midway
-- Union's rotation built some occurrences in the previous PKO format (#9515
-- fixed the source): the Afternoon
-- Free Buy of 2026-11-05 (schedule aiof, built pko) and the Prime Time Free Buy
-- of 2026-11-05 (schedule mystery, built pko). The scheduler's sync pass saw the
-- date's spawn key as claimed and never looked at the event again, so a
-- wrongly-shaped occurrence stood until it ran.
--
-- This file is the database half of the rebuild. The decision of what an
-- event's format IS and what its schedule SAYS it is lives in exactly one place
-- each, both already installed by 20261105035220/20261105233756 and read by the
-- digest watch: fn_ca_midway_free_buy_format(id) classifies the built row and
-- fn_ca_midway_free_buy_slot_format(id) reads the slot format the event's own
-- tournament_schedules row names (config.midwayFreeBuyFormat). Nothing here
-- re-reads the schedule or names any event id.
--
-- fn_ca_rebuild_midway_free_buy_to_its_schedule(p_tournament_id), one atomic
-- transaction, engine (service_role) only:
--   1. takes the cancellation lane first, then the event row, in the same order
--      as atomic_cancel_tournament;
--   2. answers rebuilt=false, with a reason, unless ALL of these hold: the slot
--      names a format and the built row's format differs; the event is
--      ANNOUNCED/REGISTERING, not started, pool not finalized, and more than
--      20 minutes from its start; every registration is a horse (a human who
--      registered keeps the terms he registered under); and it is a scheduled
--      occurrence (it holds a tournament_schedule_spawns claim);
--   3. cancels it through atomic_cancel_tournament, the platform's one
--      cancellation authority. Every registration, horse or human alike, is
--      refunded there (including the Midway promo head) with its immutable
--      receipt. Horses are players (CLAUDE.md 10.5): they are refunded exactly
--      as a human would be, and the pre-start ramp registers them into the
--      rebuilt event through the same registration path as anybody else;
--   4. releases that occurrence's spawn claim, in the same transaction, so the
--      scheduler's same pass spawns the date fresh in the schedule's shape.
--      There is no window in which an event is cancelled and its date is still
--      claimed, so a cancelled occurrence can never strand its slot.
--
-- It is called only from the scheduler's own sync pass for the schedule
-- (ScheduledTournamentService.rebuildWrongShapedMidwayOccurrences), the same
-- live path that already makes a pre-spawned occurrence follow its schedule's
-- times. It is not a cron, sweep or repair job (CLAUDE.md 10.12): the guard that
-- stops a wrong shape from being built at all is the companion trigger in
-- 20261106004812 (installed in the daily maintenance window).
--
-- Creating a function takes no lock on tournaments, so this file installs
-- immediately.
--
-- @live-proof: (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ca_rebuild_midway_free_buy_to_its_schedule(uuid)')) AND NOT has_function_privilege('authenticated', 'public.fn_ca_rebuild_midway_free_buy_to_its_schedule(uuid)', 'EXECUTE') AND has_function_privilege('service_role', 'public.fn_ca_rebuild_midway_free_buy_to_its_schedule(uuid)', 'EXECUTE')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';

CREATE OR REPLACE FUNCTION public.fn_ca_rebuild_midway_free_buy_to_its_schedule(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_slot text;
  v_got text;
  v_entries integer;
  v_humans integer;
  v_key text;
  v_receipt jsonb;
  v_status text;
BEGIN
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'Tournament id is required' USING ERRCODE = '22004';
  END IF;
  -- The engine rebuilds; a signed-in person never does (EXECUTE is also
  -- revoked from every browser role below).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Only the engine rebuilds a scheduled Free Buy' USING ERRCODE = '42501';
  END IF;

  -- Same lock order as atomic_cancel_tournament: the lane, then the row.
  PERFORM smarter_private.cancellation_lane(p_tournament_id);
  SELECT * INTO v_t FROM public.tournaments t WHERE t.id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'rebuilt', false, 'reason', 'not_found');
  END IF;

  v_slot := public.fn_ca_midway_free_buy_slot_format(p_tournament_id);
  v_got := public.fn_ca_midway_free_buy_format(p_tournament_id);
  IF v_slot IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'no_schedule_format');
  END IF;
  IF v_got IS NOT DISTINCT FROM v_slot THEN
    RETURN jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'matches_its_schedule');
  END IF;

  IF upper(COALESCE(v_t.status, '')) NOT IN ('ANNOUNCED', 'REGISTERING')
     OR v_t.started_at IS NOT NULL
     OR COALESCE(v_t.prize_pool_finalized, false) THEN
    RETURN jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'started',
                              'format', v_got, 'expected_format', v_slot);
  END IF;
  IF v_t.start_time IS NULL OR v_t.start_time <= now() + interval '20 minutes' THEN
    RETURN jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'too_close_to_start',
                              'format', v_got, 'expected_format', v_slot);
  END IF;

  -- A registration with no horse profile counts as a human (fail closed).
  SELECT count(*), count(*) FILTER (WHERE NOT COALESCE(p.is_horse, false))
    INTO v_entries, v_humans
    FROM public.tournament_players tp
    LEFT JOIN public.profiles p ON p.id = tp.user_id
   WHERE tp.tournament_id = p_tournament_id;
  IF v_humans > 0 THEN
    RETURN jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'a_human_is_registered',
                              'format', v_got, 'expected_format', v_slot, 'humans', v_humans);
  END IF;

  SELECT s.spawn_key INTO v_key
    FROM public.tournament_schedule_spawns s
   WHERE s.tournament_id = p_tournament_id
   ORDER BY s.id
   LIMIT 1
   FOR UPDATE;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'not_a_scheduled_occurrence',
                              'format', v_got, 'expected_format', v_slot);
  END IF;

  -- The platform's one cancellation authority refunds every registration and
  -- writes the immutable receipt. Any refusal raises and rolls back all of it.
  v_receipt := public.atomic_cancel_tournament(p_tournament_id, NULL);
  SELECT upper(COALESCE(t.status, '')) INTO v_status FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF v_status NOT IN ('CANCELLED', 'CANCELED') THEN
    RAISE EXCEPTION 'MIDWAY_FREE_BUY_REBUILD_NOT_CANCELLED %', p_tournament_id USING ERRCODE = '55000';
  END IF;

  -- The date goes back to its schedule in the same transaction.
  DELETE FROM public.tournament_schedule_spawns s
   WHERE s.spawn_key = v_key AND s.tournament_id = p_tournament_id;

  RETURN jsonb_build_object(
    'ok', true, 'rebuilt', true, 'reason', 'rebuilt_to_its_schedule',
    'tournament_id', p_tournament_id, 'spawn_key', v_key,
    'format', v_got, 'expected_format', v_slot,
    'entries_refunded', v_entries, 'receipt', v_receipt);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_rebuild_midway_free_buy_to_its_schedule(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_rebuild_midway_free_buy_to_its_schedule(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_ca_rebuild_midway_free_buy_to_its_schedule(uuid) IS
  'Owner 2026-11-05: a built Midway Free Buy matches its schedule. Cancels (atomic_cancel_tournament, every registration refunded) and releases the spawn claim of an unstarted, horse-only occurrence whose format differs from its schedule slot, so the scheduler respawns it in the schedule''s shape. Engine only.';

COMMIT;
