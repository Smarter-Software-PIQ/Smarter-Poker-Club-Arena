-- 20261108034940_an_unused_seat_first_board_is_parked_not_recycled_at_3am.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- AN UNUSED SPIN OR SIT & GO BOARD IS PARKED AT 3:00 AM, NOT CANCELLED AND
-- MINTED AGAIN AT 6:00 AM.
--
-- WHAT WAS WRONG (read from production 2026-11-08 03:40 UTC, SELECT only)
--
-- fn_daily_window_close_seat_first_lobbies (20261103200923, rewritten by
-- 20261103222817) cancels EVERY open, unstarted, not-full seat-first lobby
-- from 3:00 AM Chicago, including a board nobody ever sat at. At 6:00 the
-- engine's always-on board (TournamentRecurringService.ensureBoardOpen) finds
-- no REGISTERING instance of each config and opens a fresh one. So every
-- standing board was cancelled and re-created once a day for nothing: each
-- generation leaves a CANCELLED tournament, a closed table and an immutable
-- tournament_cancellation_receipts row that moved nothing.
--   3 AM hour, Chicago   cancellations   zero players/seats/refund   tables
--   2026-11-05                115                   85                  83
--   2026-11-06                134                  109                  84
--   2026-11-07                139                  122                  94
-- On 2026-11-07: 12 per welcome-board certification fixture (five of them,
-- 8 Spins + 4 Sit & Gos each, every one empty) and 62 of the Midway Union's
-- 79, the rest held real entrants. 20261107211612 found 58-59 such cancelled
-- generations per fixture club after five days. Of the 160 seat-first lobbies
-- open as this was written, 114 have never had an entrant.
--
-- WHY THE 3 AM CLOSE EXISTS, AND WHY PARKING KEEPS IT
--
-- Owner, 2026-11-03: "ALL SPINS AND SIT N GO'S STOP AT 3AM TO INSURE THERE
-- ARE NONE RUNNING BEFORE THE GAMES ALL SHUT DOWN." The close exists so a
-- lobby opened at 2:55 does not hold a seated player's buy-in through the
-- 4:00-6:00 window. A board that never had an entrant holds nothing. From
-- 3:00 fn_ca_lock_tournament_seat_acquisition (the lock every registration
-- and seat door takes: fn_register_for_tournament, ..._with_ticket,
-- fn_take_seat_and_buy_in, fn_register_horse_for_tournament,
-- fn_seat_horse_in_seat_first_game, fn_seat_late_registrant) already refuses
-- every new entry to a seat-first game with spin_sng_closed_until_reopen, so
-- a parked board cannot gain a player, cannot fill and cannot start before
-- 6:00. The engine opens no board in those hours either. Nothing runs.
--
-- WHAT THIS CHANGES
--
-- 1. public.fn_daily_window_seat_first_lobby_unused(tournament) answers true
--    only for a board that has never been used: no tournament_players row in
--    ANY status, no table_seats row on any of its tables EVER (open or left),
--    zero prize pool, zero current players, zero rake, never started, and a
--    Spin whose multiplier was never drawn. Every row counts, horse or human
--    (CLAUDE.md 10.5): nothing here reads is_horse.
-- 2. fn_daily_window_close_seat_first_lobbies leaves such a board open
--    (counted as 'parked') instead of cancelling it, both when it scans and
--    again under the row lock. Every other lobby - one with an entrant, a
--    registration, a seat (even one since left) or chips - is cancelled
--    exactly as before, through atomic_cancel_tournament with its exact
--    receipt, refunds and settlement lanes unchanged. The scan filters parked
--    boards out before its LIMIT so they can never crowd a real lobby out of
--    a pass.
-- 3. The 4:00 "still open" alert (both the close's and the database
--    watchdog's) counts only lobbies that are NOT unused: a parked board is
--    the intended state, a lobby with an entrant at 4:00 is still critical.
--
-- At 6:00 the engine's board finds the parked REGISTERING instance and opens
-- nothing new, so the churn stops at its source. Historical cancelled
-- generations and their receipts are immutable and are left exactly as they
-- are. Nothing here moves money. Exact guarded replacements over the audited
-- live definitions (md5 preimages below).
-- @live-proof: to_regprocedure('public.fn_daily_window_seat_first_lobby_unused(uuid)') IS NOT NULL AND NOT has_function_privilege('authenticated','public.fn_daily_window_seat_first_lobby_unused(uuid)','EXECUTE') AND position('fn_daily_window_seat_first_lobby_unused' IN pg_get_functiondef('public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)'::regprocedure))>0 AND position('fn_daily_window_seat_first_lobby_unused' IN pg_get_functiondef('smarter_private.daily_window_lobby_watchdog(timestamp with time zone)'::regprocedure))>0 AND has_function_privilege('service_role','public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)','EXECUTE') AND NOT public.fn_daily_window_seat_first_lobby_unused('00000000-0000-0000-0000-000000000000'::uuid) AND (public.fn_daily_window_close_seat_first_lobbies(10,'2026-11-03 18:00:00+00',true)->>'outside_hours')::boolean AND (public.fn_daily_window_close_seat_first_lobbies(10,'2026-11-03 09:30:00+00',true)->>'dry')::boolean
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean)'::regprocedure))
    IS DISTINCT FROM 'c610d559a8142be1990b52c69d154de0'
    AND position('fn_daily_window_seat_first_lobby_unused' IN pg_get_functiondef('public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'lobby_close_preimage_changed';
 END IF;
 IF md5(pg_get_functiondef('smarter_private.daily_window_lobby_watchdog(timestamptz)'::regprocedure))
    IS DISTINCT FROM 'b306e4ab0cf9df0ca44de6079670e482'
    AND position('fn_daily_window_seat_first_lobby_unused' IN pg_get_functiondef('smarter_private.daily_window_lobby_watchdog(timestamptz)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'lobby_watchdog_preimage_changed';
 END IF;
END $guard$;

-- 1. the one predicate: a board nobody has ever used
CREATE OR REPLACE FUNCTION public.fn_daily_window_seat_first_lobby_unused(p_tournament_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
 SELECT EXISTS(
  SELECT 1 FROM public.tournaments t
   WHERE t.id = p_tournament_id
     AND t.started_at IS NULL
     AND t.status IN ('REGISTERING','ANNOUNCED')
     AND coalesce(t.current_players,0) = 0
     AND coalesce(t.prize_pool,0) = 0
     AND coalesce(t.total_rake,0) = 0
     AND coalesce(t.spin_multiplier,0) = 0
     AND NOT EXISTS(SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id = t.id)
     AND NOT EXISTS(SELECT 1 FROM public.table_seats s JOIN public.tables tb ON tb.id = s.table_id
                     WHERE tb.tournament_id = t.id)
     AND NOT EXISTS(SELECT 1 FROM public.spin_reserve_ledger l WHERE l.tournament_id = t.id AND l.kind = 'jackpot_draw')
     AND NOT EXISTS(SELECT 1 FROM public.spin_draw_receipts r WHERE r.tournament_id = t.id))
$f$;
REVOKE ALL ON FUNCTION public.fn_daily_window_seat_first_lobby_unused(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_daily_window_seat_first_lobby_unused(uuid) TO service_role;

-- 2. the 3 AM close parks an unused board and closes everything else as before
CREATE OR REPLACE FUNCTION public.fn_daily_window_close_seat_first_lobbies(
 p_limit integer DEFAULT 10, p_at timestamptz DEFAULT clock_timestamp(), p_dry boolean DEFAULT false)
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
  RETURN jsonb_build_object('ok',true,'dry',true,'local_time',to_char(local_t,'HH24:MI'),'would_close',would,
   'parked',n_parked);
 END IF;

 -- From 4:00 no USED seat-first lobby may still be open: say so once a day.
 -- A parked board is the intended state and is not counted.
 IF local_t >= pol.window_start THEN
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

-- 3. the 4:00 watchdog counts only lobbies somebody used
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
  WHERE public.fn_daily_window_seat_first_kind(t.tournament_type, t.max_players)
    AND t.status IN ('REGISTERING','ANNOUNCED') AND t.started_at IS NULL
    AND NOT public.fn_daily_window_seat_first_lobby_unused(t.id);
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

COMMIT;
