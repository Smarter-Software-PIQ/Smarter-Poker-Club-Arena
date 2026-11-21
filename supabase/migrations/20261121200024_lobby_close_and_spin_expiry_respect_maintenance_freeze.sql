-- 20261121200024_lobby_close_and_spin_expiry_respect_maintenance_freeze.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE 3 AM LOBBY CLOSE AND UNFILLED-SPIN EXPIRY RESPECT THE MAINTENANCE FREEZE
-- (2026-11-21, H10 - rollback rehearsal run 44887083680 & 2026-11-16 09:04Z).
--
-- WHAT HAPPENED
--
-- Twice on Backup Engine, a swap rehearsal whose 5-minute maintenance freeze
-- crossed 09:00:00 UTC (03:00:00 America/Chicago) failed frozen_seat_boundary
-- seconds after the hour:
--   * 2026-11-16 09:00:06Z (trials.jsonl:373): count 125 -> 115 (-10 seats)
--   * 2026-11-21 09:00:04Z (trials.jsonl:591, run 44887083680): count 138 -> 132 (-6 seats)
--
-- Both engines had adopted the active maintenance break cleanly, and held exact
-- seat counts through 09:00:01Z-09:00:03Z. At 03:00:00 America/Chicago,
-- GameServer.discoverTournaments() invoked
-- fn_daily_window_close_seat_first_lobbies (missing an isMaintenanceFrozen()
-- guard, as was its sibling fn_spin_expire_unfilled). Because zz_freeze_guard
-- intentionally exempts service_role so in-flight hands can settle during a
-- freeze, and neither RPC checked public.fn_platform_frozen(), both RPCs
-- called atomic_cancel_tournament and vacated live table_seats inside the
-- frozen maintenance window.
--
-- WHAT THIS CHANGES
--
-- 1. public.fn_daily_window_close_seat_first_lobbies refuses to mutate while
--    public.fn_platform_frozen() IS DISTINCT FROM false (fail-closed on true
--    or unknown), returning ok=true, platform_frozen=true, closed=0 so older
--    serving engines during rollback rehearsals stand down without raising
--    false lobby-close alerts. Dry runs (p_dry=true) remain read-only and
--    unaffected. It also re-checks fn_platform_frozen() inside the loop before
--    each atomic_cancel_tournament call so a freeze starting mid-batch halts
--    before the next lobby.
-- 2. public.fn_spin_expire_unfilled adds the identical fail-closed
--    fn_platform_frozen() guard before its candidate scan and again inside its
--    loop before atomic_cancel_tournament, protecting both the engine sweep
--    and external service_role callers (/api/cron/spin-sweep).
--
-- CREATE OR REPLACE FUNCTION only: acquires no table lock and needs no
-- maintenance install window.
--
-- @live-proof: position('fn_platform_frozen' IN pg_get_functiondef('public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)'::regprocedure))>0 AND position('fn_platform_frozen' IN pg_get_functiondef('public.fn_spin_expire_unfilled(integer)'::regprocedure))>0 AND has_function_privilege('service_role','public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)','EXECUTE') AND has_function_privilege('service_role','public.fn_spin_expire_unfilled(integer)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_spin_expire_unfilled(integer)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_spin_expire_unfilled(integer)','EXECUTE') AND (public.fn_daily_window_close_seat_first_lobbies(10,'2026-11-03 18:00:00+00',true)->>'outside_hours')::boolean AND (public.fn_daily_window_close_seat_first_lobbies(10,'2026-11-03 09:30:00+00',true)->>'dry')::boolean

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean)'::regprocedure))
     IS DISTINCT FROM 'd0ebf7a63d861435cd76cc392febd6f1'
     AND position('fn_platform_frozen' IN pg_get_functiondef('public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'lobby_close_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_spin_expire_unfilled(integer)'::regprocedure))
     IS DISTINCT FROM 'b26c7716533363bb92347803890f87d5'
     AND position('fn_platform_frozen' IN pg_get_functiondef('public.fn_spin_expire_unfilled(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'spin_expire_preimage_changed';
  END IF;
END
$guard$;

-- 1. 3 AM seat-first lobby close stands down while the platform is frozen
CREATE OR REPLACE FUNCTION public.fn_daily_window_close_seat_first_lobbies(
 p_limit integer DEFAULT 10, p_at timestamp with time zone DEFAULT clock_timestamp(), p_dry boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
DECLARE
 pol smarter_private.daily_window_policy%ROWTYPE;
 local_t time; g record; cur record; res jsonb;
 n_closed integer:=0; n_failed integer:=0; n_skipped integer:=0; n_left integer:=0; n_parked integer:=0;
 ids jsonb:='[]'::jsonb; would jsonb:='[]'::jsonb; did_any boolean:=false;
BEGIN
 SELECT * INTO STRICT pol FROM smarter_private.daily_window_policy WHERE singleton;
 local_t := (p_at AT TIME ZONE pol.time_zone)::time;
 IF NOT (local_t >= pol.spin_sng_stop AND local_t < pol.window_end) THEN
  RETURN jsonb_build_object('ok',true,'outside_hours',true,'closed',0,'local_time',to_char(local_t,'HH24:MI'));
 END IF;

 -- THE FREEZE IS TOTAL (2026-11-21, H10): never vacate table_seats or refund
 -- buy-ins during a maintenance freeze (or when the freeze predicate is
 -- unreadable). Dry runs remain read-only.
 IF NOT p_dry AND public.fn_platform_frozen() IS DISTINCT FROM false THEN
  RETURN jsonb_build_object(
   'ok',true,'platform_frozen',true,'closed',0,'failed',0,'skipped',0,'parked',0,
   'still_open_after_window_start',0,'local_time',to_char(local_t,'HH24:MI'),'cancelled','[]'::jsonb);
 END IF;

 -- A board nobody ever used holds nothing and, from 3:00, can gain nobody
 -- (spin_sng_closed_until_reopen): it stays open and is reused at 6:00
 -- instead of being cancelled and minted anew every day.
 SELECT count(*) INTO n_parked FROM public.tournaments t
  WHERE public.fn_daily_window_seat_first_kind(t.tournament_type, t.max_players)
    AND t.status IN ('REGISTERING','ANNOUNCED') AND t.started_at IS NULL
    AND public.fn_daily_window_seat_first_lobby_unused(t.id);

 FOR g IN
  SELECT t.id, t.name, upper(t.tournament_type) AS kind,
         (lower(coalesce(t.variant::text,''))='satellite' OR upper(coalesce(t.tournament_type::text,''))='SATELLITE'
          OR t.satellite_target_id IS NOT NULL OR t.satellite_target IS NOT NULL) AS is_sat
    FROM public.tournaments t
   WHERE public.fn_daily_window_seat_first_kind(t.tournament_type, t.max_players)
     AND t.status IN ('REGISTERING','ANNOUNCED')
     AND t.started_at IS NULL
     AND NOT public.fn_daily_window_seat_first_lobby_unused(t.id)
   ORDER BY 4, t.created_at, t.id
   LIMIT GREATEST(coalesce(p_limit,10),1)
 LOOP
  IF p_dry THEN
   would := would || jsonb_build_object('id',g.id,'name',g.name,'kind',g.kind,'satellite',g.is_sat);
   CONTINUE;
  END IF;
  IF public.fn_platform_frozen() IS DISTINCT FROM false THEN
   EXIT;
  END IF;
  IF g.is_sat THEN
   -- A satellite is cancelled alone: the plain-member lane refuses it, and a
   -- call that already holds a member lane must not take the global one.
   EXIT WHEN did_any;
  ELSE
   PERFORM public.fn_ca_lock_settlement_lane_for_sweep_member(g.id);
  END IF;
  -- @lifecycle-exclusive-lock: serializes 3 AM lobby-close cancellation against concurrent registration/start
  PERFORM 1 FROM public.tournaments t WHERE t.id=g.id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN n_skipped:=n_skipped+1; CONTINUE; END IF;
  IF public.fn_platform_frozen() IS DISTINCT FROM false THEN
   EXIT;
  END IF;
  SELECT t.status, t.started_at, coalesce(t.max_players, CASE WHEN upper(t.tournament_type)='SPIN' THEN 3 END) AS max_players,
         GREATEST(
          (SELECT count(*) FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id
            WHERE tb.tournament_id=t.id AND s.left_at IS NULL),
          (SELECT count(*) FROM public.tournament_players tp
            WHERE tp.tournament_id=t.id AND tp.status IN ('registered','playing'))) AS entrants,
         (coalesce(t.spin_multiplier,0)>0
          OR EXISTS(SELECT 1 FROM public.spin_reserve_ledger l WHERE l.tournament_id=t.id AND l.kind='jackpot_draw')
          OR EXISTS(SELECT 1 FROM public.spin_draw_receipts r WHERE r.tournament_id=t.id)) AS drawn
    INTO cur FROM public.tournaments t WHERE t.id=g.id;
  IF cur.status NOT IN ('REGISTERING','ANNOUNCED') OR cur.started_at IS NOT NULL
     OR cur.drawn OR (cur.max_players IS NOT NULL AND cur.entrants >= cur.max_players) THEN
   n_skipped:=n_skipped+1; CONTINUE;
  END IF;
  did_any:=true;
  BEGIN
   res := public.atomic_cancel_tournament(g.id, NULL);
   IF res->>'ok' IS DISTINCT FROM 'true' OR res->>'status' IS DISTINCT FROM 'CANCELLED'
      OR res->>'fully_settled' IS DISTINCT FROM 'true'
      OR res->>'tournament_id' IS DISTINCT FROM g.id::text THEN
    RAISE EXCEPTION 'lobby close did not return its exact cancellation receipt: %', left(res::text,300);
   END IF;
   n_closed:=n_closed+1;
   ids := ids || jsonb_build_object('id',g.id,'kind',g.kind,'entrants',cur.entrants,'receipt',res->'receipt_id','refunded',res->'total_refunded');
  EXCEPTION WHEN OTHERS THEN
   n_failed:=n_failed+1;
   PERFORM public.fn_record_operational_alert('daily-window','lobby-close-failed:'||g.id::text,
    'DailyWindowLobbyCloseFailed','firing','warning',
    jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','tournament_id',g.id,'name',g.name,
     'kind',g.kind,'error',SQLERRM,'at',p_at));
  END;
  BEGIN PERFORM public.fn_sync_seat_first_player_count(g.id); EXCEPTION WHEN undefined_function THEN NULL; END;
  EXIT WHEN g.is_sat;
 END LOOP;

 IF p_dry THEN
  RETURN jsonb_build_object('ok',true,'dry',true,'local_time',to_char(local_t,'HH24:MI'),'would_close',would,
   'parked',n_parked);
 END IF;

 -- From 4:00 no USED seat-first lobby may still be open: say so once a day.
 -- A parked board is the intended state and is not counted.
 IF local_t >= pol.window_start AND public.fn_platform_frozen() = false THEN
  SELECT count(*) INTO n_left FROM public.tournaments t
   WHERE public.fn_daily_window_seat_first_kind(t.tournament_type, t.max_players)
     AND t.status IN ('REGISTERING','ANNOUNCED') AND t.started_at IS NULL
     AND NOT public.fn_daily_window_seat_first_lobby_unused(t.id);
  IF n_left>0 THEN
   PERFORM public.fn_record_operational_alert('daily-window',
    'lobby-still-open:'||to_char(p_at AT TIME ZONE pol.time_zone,'YYYYMMDD'),
    'DailyWindowLobbyStillOpen','firing','critical',
    jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','open_lobbies',n_left,
     'local_time',to_char(local_t,'HH24:MI'),'at',p_at));
  END IF;
 END IF;

 RETURN jsonb_build_object('ok',n_failed=0,'local_time',to_char(local_t,'HH24:MI'),'closed',n_closed,
  'failed',n_failed,'skipped',n_skipped,'parked',n_parked,'still_open_after_window_start',n_left,'cancelled',ids);
END $f$;
REVOKE ALL ON FUNCTION public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean) TO service_role;

-- 2. Unfilled-spin expiry stands down while the platform is frozen
CREATE OR REPLACE FUNCTION public.fn_spin_expire_unfilled(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_minutes integer;
  g record;
  v_current record;
  v_skipped integer := 0;
  res jsonb;
  v_expired integer := 0;
  v_failed integer := 0;
  v_refunded numeric := 0;
  v_ids jsonb := '[]'::jsonb;
BEGIN
  SELECT unfilled_timeout_minutes INTO v_minutes FROM public.spin_fill_policy LIMIT 1;
  v_minutes := COALESCE(v_minutes, 30);

  -- 0 (or a missing row) means the operator has switched the sweep off.
  IF v_minutes <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'disabled', true, 'expired', 0);
  END IF;

  -- THE FREEZE IS TOTAL (2026-11-21, H10): never vacate table_seats or refund
  -- unfilled Spins during a maintenance freeze (or when the freeze predicate is
  -- unreadable), whether invoked by the engine or an external cron.
  IF public.fn_platform_frozen() IS DISTINCT FROM false THEN
    RETURN jsonb_build_object(
      'ok', true,
      'platform_frozen', true,
      'expired', 0,
      'failed', 0,
      'skipped_raced', 0,
      'chips_refunded_estimate', 0,
      'timeout_minutes', v_minutes,
      'tournament_ids', '[]'::jsonb);
  END IF;

  FOR g IN
    SELECT t.id,
           t.buy_in_amount,
           (SELECT count(*) FROM public.table_seats s
              JOIN public.tables tb ON tb.id = s.table_id
             WHERE tb.tournament_id = t.id AND s.left_at IS NULL) AS live_seats
      FROM public.tournaments t
     WHERE t.variant = 'spin'
       AND t.status IN ('REGISTERING', 'ANNOUNCED')
       AND t.started_at IS NULL
       -- somebody has actually been waiting too long
       AND EXISTS (SELECT 1 FROM public.table_seats s
                     JOIN public.tables tb ON tb.id = s.table_id
                    WHERE tb.tournament_id = t.id
                      AND s.left_at IS NULL
                      AND s.joined_at < now() - make_interval(mins => v_minutes))
       -- and the game is NOT full: a full unstarted spin is about to deal.
       AND (SELECT count(*) FROM public.table_seats s
              JOIN public.tables tb ON tb.id = s.table_id
             WHERE tb.tournament_id = t.id AND s.left_at IS NULL)
           < COALESCE(t.max_players, 3)
     ORDER BY t.created_at
     LIMIT GREATEST(COALESCE(p_limit, 50), 1)
  LOOP
    IF public.fn_platform_frozen() IS DISTINCT FROM false THEN
      EXIT;
    END IF;
    -- THE SWEEP TAKES ONE SPIN'S LANE AT A TIME (2026-09-17). This used to
    -- take the whole platform's lane (G and B exclusive) per candidate, so
    -- each pass drained every hand settlement behind it (68 waiters for six
    -- seconds at 11:52 UTC). It now takes the finish lane for THIS Spin - G
    -- shared, F exclusive, T(id) exclusive - in the candidate scan's order,
    -- and the cancellation's own global-lane call re-enters it. Still before
    -- any parent row lock, so an expiry holding the parent cannot deadlock
    -- with a terminal lane owner.
    PERFORM public.fn_ca_lock_settlement_lane_for_sweep_member(g.id);
    -- The scan is only a candidate list. A final join or launch may commit
    -- before cancellation reaches this parent. Busy parents belong to that
    -- work; the next sweep may reconsider them.
    -- @lifecycle-exclusive-lock: serializes 3 AM lobby-close cancellation against concurrent registration/start
  PERFORM 1 FROM public.tournaments t WHERE t.id=g.id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    IF public.fn_platform_frozen() IS DISTINCT FROM false THEN
      EXIT;
    END IF;
    -- Read in a new statement AFTER acquiring the parent, so seat subqueries
    -- cannot retain the candidate scan's earlier snapshot.
    SELECT t.status,t.variant,t.started_at,t.spin_multiplier,t.buy_in_amount,
           COALESCE(t.max_players,3) AS max_players,
           (SELECT count(*) FROM public.table_seats s
              JOIN public.tables tb ON tb.id=s.table_id
             WHERE tb.tournament_id=t.id AND s.left_at IS NULL) AS live_seats,
           EXISTS(SELECT 1 FROM public.table_seats s
              JOIN public.tables tb ON tb.id=s.table_id
             WHERE tb.tournament_id=t.id AND s.left_at IS NULL
               AND s.joined_at < now()-make_interval(mins=>v_minutes)) AS has_expired_waiter,
           EXISTS(SELECT 1 FROM public.spin_reserve_ledger l
             WHERE l.tournament_id=t.id AND l.kind='jackpot_draw')
             OR EXISTS(SELECT 1 FROM public.spin_draw_receipts r
               WHERE r.tournament_id=t.id) AS has_booked_draw
      INTO v_current FROM public.tournaments t WHERE t.id=g.id;
    -- A drawn Spin is never expired. tournaments.spin_multiplier has DEFAULT 0
    -- and the seat-first creator omits the column, so `IS NOT NULL` read every
    -- undrawn Spin as drawn and this sweep expired nothing since 2026-09-08.
    -- Every other reader uses COALESCE(...,0) > 0 (2026-09-10, C-stuck-spins D3).
    IF v_current.variant IS DISTINCT FROM 'spin'
       OR v_current.status NOT IN ('REGISTERING','ANNOUNCED')
       OR v_current.status IS NULL OR v_current.started_at IS NOT NULL
       OR v_current.live_seats >= v_current.max_players
       OR NOT v_current.has_expired_waiter
       OR COALESCE(v_current.spin_multiplier, 0) > 0 OR v_current.has_booked_draw THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    BEGIN
      res := public.atomic_cancel_tournament(g.id, NULL);
      v_expired := v_expired + 1;
      v_refunded := v_refunded + (COALESCE(v_current.buy_in_amount, 0) * COALESCE(v_current.live_seats, 0));
      v_ids := v_ids || to_jsonb(g.id::text);
    EXCEPTION WHEN OTHERS THEN
      -- Loud, never fatal: one stuck game must not stop the rest being freed.
      v_failed := v_failed + 1;
      RAISE WARNING 'fn_spin_expire_unfilled: could not cancel %: %', g.id, SQLERRM;
    END;
    -- The counter derives from the seats either way (see 20260830110000).
    PERFORM public.fn_sync_seat_first_player_count(g.id);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'expired', v_expired,
    'failed', v_failed,
    'skipped_raced', v_skipped,
    'chips_refunded_estimate', round(v_refunded, 2),
    'timeout_minutes', v_minutes,
    'tournament_ids', v_ids);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_spin_expire_unfilled(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_spin_expire_unfilled(integer) TO service_role;

-- @probe-for: public.fn_daily_window_close_seat_first_lobbies
DO $probe$
DECLARE
  v_outside jsonb;
  v_dry jsonb;
BEGIN
  -- On an empty rehearsal schema, daily_window_policy has no singleton row;
  -- seed the default row inside this unwound subtransaction so the probe
  -- executes the real function body on both empty rehearsal and live DBs.
  INSERT INTO smarter_private.daily_window_policy(singleton) VALUES(true) ON CONFLICT DO NOTHING;
  v_outside := public.fn_daily_window_close_seat_first_lobbies(1, '2026-11-03 18:00:00+00', false);
  IF (v_outside->>'outside_hours')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'lobby_close_probe_outside_hours_failed: %', v_outside;
  END IF;
  v_dry := public.fn_daily_window_close_seat_first_lobbies(1, '2026-11-03 09:30:00+00', true);
  IF (v_dry->>'dry')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'lobby_close_probe_dry_failed: %', v_dry;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END
$probe$;

-- @probe-for: public.fn_spin_expire_unfilled
DO $probe$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.fn_spin_expire_unfilled(1);
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'spin_expire_probe_failed: %', v_res;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END
$probe$;

COMMIT;
