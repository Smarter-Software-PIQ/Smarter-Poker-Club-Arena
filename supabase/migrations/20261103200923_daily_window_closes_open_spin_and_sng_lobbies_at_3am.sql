-- 20261103200923_daily_window_closes_open_spin_and_sng_lobbies_at_3am
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-03 20:09:23 UTC.
--
-- THE 3:00 AM STOP ALSO CLOSES LOBBIES THAT ARE ALREADY OPEN (owner, 2026-11-03).
-- Owner rule: "ALL SPINS AND SIT N GO'S STOP AT 3AM TO INSURE THERE ARE NONE
-- RUNNING BEFORE THE GAMES ALL SHUT DOWN." 20261103193545 stops NEW entries
-- into a Spin or Sit & Go from 3:00 AM Chicago and the engine stops opening new
-- boards, but a lobby that opened at 2:55 with one player seated would sit there
-- holding that player's buy-in through the 4:00 to 6:00 window (the unfilled
-- Spin sweep only frees a seat after 30 minutes, and nothing frees a Sit & Go).
--
-- This migration adds public.fn_daily_window_close_seat_first_lobbies, which
-- the engine calls every minute from 3:00 to 6:00 Chicago (GameServer, next
-- to the unfilled-Spin sweep). It is the engine's call, as service_role, for
-- the same reason the Spin sweep is: fn_guard_managed_game_lifecycle lets only
-- the engine cancel a tournament that somebody has entered. The function:
--  * acts only from the policy's spin_sng_stop (3:00) to window_end (6:00),
--    Chicago wall clock read from smarter_private.daily_window_policy;
--  * cancels every SPIN or SNG that is still open and has not started and is
--    NOT full (a full game is about to deal; Phase 5's window resolution owns
--    a game that started), and never a Spin whose multiplier is drawn;
--  * cancels through public.atomic_cancel_tournament, the one cancellation
--    authority, and requires its exact receipt (ok, CANCELLED, fully settled,
--    same id): it refunds every entry (buy-in and fee, chips or Diamonds,
--    tickets returned) and writes the immutable cancellation receipt, so this
--    function moves no money of its own and a repeat is a no-op;
--  * takes each plain member's settlement lane in scan order exactly as
--    fn_spin_expire_unfilled does; a satellite is cancelled alone in its own
--    call because the member lane refuses satellites;
--  * any failed cancel raises one warning per lobby; from 4:00, any Spin or
--    Sit & Go lobby still open raises one critical DailyWindowLobbyStillOpen
--    alert per day.
-- smarter_private.daily_window_lobby_watchdog raises that same alert from the
-- database's own clock, so a dead engine cannot hide an open lobby.
-- A dry run (p_dry) lists what it would close and changes nothing.
-- periodic-work: detection only. Every five minutes 09:00 to 10:59 UTC (the
-- 4:00 AM Chicago hour in both CST and CDT) the watchdog counts open Spin and
-- Sit & Go lobbies; outside that hour it returns at once. It closes nothing.
-- @live-proof: to_regprocedure('public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)') IS NOT NULL AND has_function_privilege('service_role','public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)','EXECUTE') AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='daily-window-lobby-watchdog' AND schedule='*/5 9-10 * * *' AND active) AND (smarter_private.daily_window_lobby_watchdog('2026-11-03 18:00:00+00')->>'outside_hours')::boolean AND (public.fn_daily_window_close_seat_first_lobbies(10,'2026-11-03 18:00:00+00',true)->>'outside_hours')::boolean AND (public.fn_daily_window_close_seat_first_lobbies(10,'2026-11-03 09:30:00+00',true)->>'dry')::boolean
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

DO $need$ BEGIN
 IF to_regclass('smarter_private.daily_window_policy') IS NULL THEN
  RAISE EXCEPTION 'daily_window_policy (20261103193545) must be installed first';
 END IF;
END $need$;

CREATE OR REPLACE FUNCTION public.fn_daily_window_close_seat_first_lobbies(
 p_limit integer DEFAULT 10, p_at timestamptz DEFAULT clock_timestamp(), p_dry boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
DECLARE
 pol smarter_private.daily_window_policy%ROWTYPE;
 local_t time; g record; cur record; res jsonb;
 n_closed integer:=0; n_failed integer:=0; n_skipped integer:=0; n_left integer:=0;
 ids jsonb:='[]'::jsonb; would jsonb:='[]'::jsonb; did_any boolean:=false;
BEGIN
 SELECT * INTO STRICT pol FROM smarter_private.daily_window_policy WHERE singleton;
 local_t := (p_at AT TIME ZONE pol.time_zone)::time;
 IF NOT (local_t >= pol.spin_sng_stop AND local_t < pol.window_end) THEN
  RETURN jsonb_build_object('ok',true,'outside_hours',true,'closed',0,'local_time',to_char(local_t,'HH24:MI'));
 END IF;

 FOR g IN
  SELECT t.id, t.name, upper(t.tournament_type) AS kind,
         (lower(coalesce(t.variant::text,''))='satellite' OR upper(coalesce(t.tournament_type::text,''))='SATELLITE'
          OR t.satellite_target_id IS NOT NULL OR t.satellite_target IS NOT NULL) AS is_sat
    FROM public.tournaments t
   WHERE upper(coalesce(t.tournament_type,'')) IN ('SPIN','SNG')
     AND t.status IN ('REGISTERING','ANNOUNCED')
     AND t.started_at IS NULL
   ORDER BY 4, t.created_at, t.id
   LIMIT GREATEST(coalesce(p_limit,10),1)
 LOOP
  IF p_dry THEN
   would := would || jsonb_build_object('id',g.id,'name',g.name,'kind',g.kind,'satellite',g.is_sat);
   CONTINUE;
  END IF;
  IF g.is_sat THEN
   -- A satellite is cancelled alone: the plain-member lane refuses it, and a
   -- call that already holds a member lane must not take the global one.
   EXIT WHEN did_any;
  ELSE
   PERFORM public.fn_ca_lock_settlement_lane_for_sweep_member(g.id);
  END IF;
  PERFORM 1 FROM public.tournaments t WHERE t.id=g.id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN n_skipped:=n_skipped+1; CONTINUE; END IF;
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
  RETURN jsonb_build_object('ok',true,'dry',true,'local_time',to_char(local_t,'HH24:MI'),'would_close',would);
 END IF;

 -- From 4:00 nothing seat-first may still be open: say so once a day.
 IF local_t >= pol.window_start THEN
  SELECT count(*) INTO n_left FROM public.tournaments t
   WHERE upper(coalesce(t.tournament_type,'')) IN ('SPIN','SNG')
     AND t.status IN ('REGISTERING','ANNOUNCED') AND t.started_at IS NULL;
  IF n_left>0 THEN
   PERFORM public.fn_record_operational_alert('daily-window',
    'lobby-still-open:'||to_char(p_at AT TIME ZONE pol.time_zone,'YYYYMMDD'),
    'DailyWindowLobbyStillOpen','firing','critical',
    jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','open_lobbies',n_left,
     'local_time',to_char(local_t,'HH24:MI'),'at',p_at));
  END IF;
 END IF;

 RETURN jsonb_build_object('ok',n_failed=0,'local_time',to_char(local_t,'HH24:MI'),'closed',n_closed,
  'failed',n_failed,'skipped',n_skipped,'still_open_after_window_start',n_left,'cancelled',ids);
END $f$;
REVOKE ALL ON FUNCTION public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean) TO service_role;

CREATE OR REPLACE FUNCTION smarter_private.daily_window_lobby_watchdog(p_at timestamptz DEFAULT clock_timestamp())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
DECLARE pol smarter_private.daily_window_policy%ROWTYPE; local_t time; n integer:=0;
BEGIN
 SELECT * INTO STRICT pol FROM smarter_private.daily_window_policy WHERE singleton;
 local_t := (p_at AT TIME ZONE pol.time_zone)::time;
 IF NOT (local_t >= pol.window_start AND local_t < pol.window_start + interval '1 hour') THEN
  RETURN jsonb_build_object('ok',true,'outside_hours',true,'local_time',to_char(local_t,'HH24:MI'));
 END IF;
 SELECT count(*) INTO n FROM public.tournaments t
  WHERE upper(coalesce(t.tournament_type,'')) IN ('SPIN','SNG')
    AND t.status IN ('REGISTERING','ANNOUNCED') AND t.started_at IS NULL;
 IF n>0 THEN
  PERFORM public.fn_record_operational_alert('daily-window',
   'lobby-still-open:'||to_char(p_at AT TIME ZONE pol.time_zone,'YYYYMMDD'),
   'DailyWindowLobbyStillOpen','firing','critical',
   jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','open_lobbies',n,
    'local_time',to_char(local_t,'HH24:MI'),'at',p_at,'seen_by','database watchdog'));
 END IF;
 RETURN jsonb_build_object('ok',n=0,'open_lobbies',n,'local_time',to_char(local_t,'HH24:MI'));
END $f$;
REVOKE ALL ON FUNCTION smarter_private.daily_window_lobby_watchdog(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='daily-window-lobby-watchdog';
SELECT cron.schedule('daily-window-lobby-watchdog','*/5 9-10 * * *',
 $c$SELECT smarter_private.daily_window_lobby_watchdog();$c$);
COMMIT;
