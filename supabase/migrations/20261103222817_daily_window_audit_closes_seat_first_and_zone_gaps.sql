-- 20261103222817_daily_window_audit_closes_seat_first_and_zone_gaps
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-03 22:28:17 UTC.
--
-- PHASE 2 AUDIT FIXES FOR THE DAILY WINDOW (owner, 2026-11-03: "CHECK FOR ANY
-- AND ALL BUGS, GAPS ... BEFORE PHASE 3"). Measured against production after
-- 20261103193545 and 20261103200923 were installed:
--  1. A SEAT PURCHASE SKIPPED THE 3:00 AM RULE. Spins and Sit & Gos are bought
--     through fn_take_seat_and_buy_in, which calls
--     fn_ca_lock_tournament_seat_acquisition(NULL, table, user). The window
--     check only ran when a tournament id was passed, so a Spin seat could be
--     bought at 3:30 AM. The check now resolves the tournament from the table,
--     exactly as the same function's operator hold already does, and still
--     never refuses a player who is registered, playing or already seated.
--  2. A HEADS-UP SATELLITE WAS NOT A SEAT-FIRST GAME TO THE WINDOW.
--     fn_create_seat_first_game_atomic can create tournament_type 'SATELLITE'
--     with 2 or 3 seats; the 3:00 AM refusal, the lobby close and the 4:00 AM
--     watchdog only named SPIN and SNG. One predicate,
--     fn_daily_window_seat_first_kind, now decides for all three: SPIN, SNG,
--     or a SATELLITE with a seat count (a multi-table satellite has none).
--  3. A SCHEDULE IN ANOTHER ZONE WAS JUDGED ON ITS OWN CLOCK. The schedule
--     writer compared a New York 06:30 (05:30 Chicago, inside the closed
--     window) to the Chicago hours and accepted it, and judged a UTC schedule
--     on a January date only (one hour off all summer). Every start time is
--     now converted from the schedule's zone (UTC when it names none) to
--     Chicago on a January AND a July date and must fall inside 6:00 AM to
--     11:00 PM on both. An unknown zone is left to the writer's own
--     time_zone_unknown refusal instead of raising here.
--  4. A ONE-OFF TOURNAMENT COULD START AT ANY HOUR. fn_create_tournament (the
--     owner's Create Tournament and Table Config forms) checked only that the
--     start was not in the past, so a 2:00 AM one-off was accepted. The shared
--     fn_tournament_config_refusal now answers tournament_start_outside_daily_hours
--     for a timed event outside 6:00 AM to 11:00 PM Chicago; the browser's
--     mirror (src/lib/tournamentCreationRules.ts) answers the same.
-- Exact guarded replacements over the audited live definitions (md5 preimages
-- below); nothing moves money. Measured before: every active schedule in every
-- zone is inside the hours except the three fixed-board rows the engine
-- release retires at 4:00 AM.
-- @live-proof: position('v_window_tournament' IN pg_get_functiondef('public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure))>0 AND position('2026-07-15' IN pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure))>0 AND public.fn_tournament_config_refusal(jsonb_build_object('type','mtt','startTime','2030-01-15T08:00:00Z'),'create')='tournament_start_outside_daily_hours' AND public.fn_tournament_config_refusal(jsonb_build_object('type','mtt','startTime','2030-01-16T02:00:00Z'),'create') IS DISTINCT FROM 'tournament_start_outside_daily_hours' AND public.fn_daily_window_seat_first_kind('SATELLITE',2) AND NOT public.fn_daily_window_seat_first_kind('SATELLITE',NULL) AND NOT public.fn_daily_window_seat_first_kind('MTT',9) AND public.fn_daily_window_seat_first_kind('SPIN',3) AND position('fn_daily_window_seat_first_kind' IN pg_get_functiondef('public.fn_daily_window_close_seat_first_lobbies(integer,timestamp with time zone,boolean)'::regprocedure))>0 AND position('fn_daily_window_seat_first_kind' IN pg_get_functiondef('smarter_private.daily_window_lobby_watchdog(timestamp with time zone)'::regprocedure))>0
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.fn_daily_window_seat_first_kind(p_type text, p_max_players integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT upper(coalesce(p_type,'')) IN ('SPIN','SNG')
     OR (upper(coalesce(p_type,''))='SATELLITE' AND p_max_players IS NOT NULL)
$f$;
REVOKE ALL ON FUNCTION public.fn_daily_window_seat_first_kind(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_daily_window_seat_first_kind(text,integer) TO authenticated, service_role;

DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.fn_daily_window_entry_refusal(uuid,timestamptz)'::regprocedure))
    IS DISTINCT FROM '3966fc8d91cb21f14861f04268e39343'
    AND position('fn_daily_window_seat_first_kind' IN pg_get_functiondef('public.fn_daily_window_entry_refusal(uuid,timestamptz)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'entry_refusal_preimage_changed';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.fn_daily_window_entry_refusal(p_tournament_id uuid, p_at timestamptz DEFAULT clock_timestamp())
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE p smarter_private.daily_window_policy%ROWTYPE; local_t time; seat_first boolean;
BEGIN
 SELECT * INTO STRICT p FROM smarter_private.daily_window_policy WHERE singleton;
 local_t := (p_at AT TIME ZONE p.time_zone)::time;
 IF local_t >= p.window_start AND local_t < p.window_end THEN RETURN 'daily_maintenance_window'; END IF;
 SELECT public.fn_daily_window_seat_first_kind(t.tournament_type, t.max_players) INTO seat_first
   FROM public.tournaments t WHERE t.id=p_tournament_id;
 IF seat_first AND local_t >= p.spin_sng_stop AND local_t < p.window_end THEN RETURN 'spin_sng_closed_until_reopen'; END IF;
 RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.fn_daily_window_entry_refusal(uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_daily_window_entry_refusal(uuid,timestamptz) TO authenticated, service_role;

DO $patch$
DECLARE d text; r text[][]; i int;
BEGIN
 -- 1. the registration lock resolves the tournament from the table
 d:=pg_get_functiondef('public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure);
 IF position('v_window_tournament' IN d)=0 THEN
  IF md5(d) IS DISTINCT FROM 'b0f09e751bb0f551c0abcc4e0f3161a2' THEN RAISE EXCEPTION 'seat_acquisition_preimage_changed'; END IF;
  r:=ARRAY[
   ARRAY[$o1$v_started_at timestamptz; v_window_refusal text;$o1$,
         $n1$v_started_at timestamptz; v_window_refusal text; v_window_tournament uuid;$n1$],
   ARRAY[$o2$  -- THE DAILY WINDOW (20261103193545): no NEW tournament entry 4:00 to 6:00 AM
  -- Chicago, none into a Spin or Sit & Go from 3:00 AM; a player already in
  -- the tournament is never refused.
  IF p_tournament_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id AND tp.status IN ('registered','playing')) THEN
   v_window_refusal := public.fn_daily_window_entry_refusal(p_tournament_id);$o2$,
         $n2$  -- THE DAILY WINDOW (20261103193545, 20261103222817): no NEW tournament entry
  -- 4:00 to 6:00 AM Chicago, none into a Spin or Sit & Go from 3:00 AM. A seat
  -- purchase names only its table, so the tournament is read from the table.
  -- A player already registered, playing or seated is never refused.
  v_window_tournament := COALESCE(p_tournament_id,(SELECT tb.tournament_id FROM public.tables tb WHERE tb.id=p_table_id));
  IF v_window_tournament IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=v_window_tournament AND tp.user_id=p_user_id AND tp.status IN ('registered','playing'))
     AND NOT EXISTS(SELECT 1 FROM public.table_seats ts JOIN public.tables tb ON tb.id=ts.table_id
     WHERE tb.tournament_id=v_window_tournament AND ts.user_id=p_user_id AND ts.left_at IS NULL) THEN
   v_window_refusal := public.fn_daily_window_entry_refusal(v_window_tournament);$n2$]];
  FOR i IN 1..2 LOOP
   IF (length(d)-length(replace(d,r[i][1],'')))<>length(r[i][1]) THEN RAISE EXCEPTION 'seat_acquisition_patch_not_single %', i; END IF;
   d:=replace(d,r[i][1],r[i][2]);
  END LOOP;
  EXECUTE d;
 END IF;
 -- 3. the schedule writer judges every start on the Chicago clock, winter and summer
 d:=pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure);
 IF position('2026-07-15' IN d)=0 THEN
  IF md5(d) IS DISTINCT FROM '8f89aa16ea2987b4acc2f9efa407ed3e' THEN RAISE EXCEPTION 'schedule_upsert_preimage_changed'; END IF;
  r:=ARRAY[ARRAY[$o3$  -- policy's first and last start (6:00 AM to 11:00 PM), in the schedule's zone.
  IF EXISTS(SELECT 1 FROM unnest(coalesce(v_times,'{}'::text[])) tm, smarter_private.daily_window_policy pol
     WHERE pol.singleton AND tm ~ '^\d{2}:\d{2}$' AND (CASE WHEN v_zone IS NOT NULL THEN tm::time
       ELSE ((('2026-01-15'::date + tm::time) AT TIME ZONE 'UTC') AT TIME ZONE pol.time_zone)::time END
       NOT BETWEEN pol.first_tournament_start AND pol.last_tournament_start)) THEN$o3$,
   $n3$  -- policy's first and last start (6:00 AM to 11:00 PM) on the Chicago clock
  -- (20261103222817): each time is read in the schedule's zone (UTC when it
  -- names none) on a winter and a summer date; an unknown zone is left to the
  -- time_zone_unknown refusal below.
  IF EXISTS(SELECT 1 FROM unnest(coalesce(v_times,'{}'::text[])) tm,
       unnest(ARRAY['2026-01-15'::date,'2026-07-15'::date]) dd, smarter_private.daily_window_policy pol
     WHERE pol.singleton AND tm ~ '^\d{2}:\d{2}$'
       AND (v_zone IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=v_zone))
       AND (((dd + tm::time) AT TIME ZONE coalesce(v_zone,'UTC')) AT TIME ZONE pol.time_zone)::time
       NOT BETWEEN pol.first_tournament_start AND pol.last_tournament_start) THEN$n3$]];
  IF (length(d)-length(replace(d,r[1][1],'')))<>length(r[1][1]) THEN RAISE EXCEPTION 'schedule_upsert_patch_not_single'; END IF;
  EXECUTE replace(d,r[1][1],r[1][2]);
 END IF;
END $patch$;

DO $patch4$
DECLARE d text; o text; n text;
BEGIN
 -- 4. a one-off tournament (fn_create_tournament) starts only 6:00 AM to 11:00 PM Chicago
 d:=pg_get_functiondef('public.fn_tournament_config_refusal(jsonb,text)'::regprocedure);
 IF position('tournament_start_outside_daily_hours' IN d)=0 THEN
  IF md5(d) IS DISTINCT FROM 'c1a376cb8d9a01b4ba9db181c7ab9e50' THEN RAISE EXCEPTION 'config_refusal_preimage_changed'; END IF;
  o:=$o4$      IF v_start IS NOT NULL AND v_start < now() - interval '5 minutes' THEN
        RETURN 'start_time_in_past';
      END IF;
    END IF;$o4$;
  n:=$n4$      IF v_start IS NOT NULL AND v_start < now() - interval '5 minutes' THEN
        RETURN 'start_time_in_past';
      END IF;
      -- THE DAILY WINDOW (20261103222817): a timed event starts only between the
      -- policy's first and last start on the Chicago clock. Spins and Sit & Gos
      -- have no start time; they are bound by the 3:00 AM entry stop instead.
      IF v_start IS NOT NULL AND NOT v_short AND v_type NOT IN ('hu_sng','heads_up')
         AND EXISTS(SELECT 1 FROM smarter_private.daily_window_policy pol WHERE pol.singleton
           AND (v_start AT TIME ZONE pol.time_zone)::time NOT BETWEEN pol.first_tournament_start AND pol.last_tournament_start) THEN
        RETURN 'tournament_start_outside_daily_hours';
      END IF;
    END IF;$n4$;
  IF (length(d)-length(replace(d,o,'')))<>length(o) THEN RAISE EXCEPTION 'config_refusal_patch_not_single'; END IF;
  EXECUTE replace(d,o,n);
 END IF;
END $patch4$;

-- 2. the lobby close and the watchdog use the same seat-first predicate
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
   WHERE public.fn_daily_window_seat_first_kind(t.tournament_type, t.max_players)
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
   WHERE public.fn_daily_window_seat_first_kind(t.tournament_type, t.max_players)
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
  WHERE public.fn_daily_window_seat_first_kind(t.tournament_type, t.max_players)
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

COMMIT;
