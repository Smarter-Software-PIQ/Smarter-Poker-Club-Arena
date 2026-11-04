-- 20261103193545_daily_window_policy_and_tournament_hours
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-03 19:35:45 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- THE DAILY WINDOW HAS ONE SOURCE OF TRUTH, AND TOURNAMENT HOURS ARE ENFORCED (owner, 2026-11-03).
-- Owner rules of 2026-11-03: every game closes 4:00 to 6:00 AM Chicago every
-- day; tournaments start only from 6:00 AM to 11:00 PM; Spins and Sit & Gos
-- stop at 3:00 AM so none is running when the games close. This migration:
--  1. smarter_private.daily_window_policy: the one row every other part reads
--     (Chicago wall clock, DST-safe); public.fn_daily_window_policy() serves it
--     to the engine and the lobby.
--  2. public.fn_daily_window_entry_refusal(tournament, at): no new entry into
--     any tournament 4:00 to 6:00, none into a SPIN or SNG 3:00 to 6:00.
--  3. fn_ca_lock_tournament_seat_acquisition (the first step of every
--     registration door: person, ticket, horse) refuses a NEW entry with that
--     reason. A player already registered or playing is never refused, and
--     cash tables are untouched here (the 4 AM cash closure is its own phase).
--  4. fn_upsert_tournament_schedule refuses a start time outside 6:00 AM to
--     11:00 PM in the schedule's own zone (UTC when it names none).
--  5. The seven 1:00 AM club "Graveyard" schedules are switched off (the
--     engine's own board drops its 11:30 PM, 12:00 AM and 12:30 AM events in
--     the same release, and its sync retires those rows).
-- Exact guarded replacements over live definitions; nothing moves money.
-- @live-proof: to_regclass('smarter_private.daily_window_policy') IS NOT NULL AND position('daily_window_entry_refusal' IN pg_get_functiondef('public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure))>0 AND position('tournament_start_outside_daily_hours' IN pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure))>0 AND NOT EXISTS(SELECT 1 FROM public.tournament_schedules s WHERE s.active AND s.time_zone='America/Chicago' AND NOT (s.config ? 'fixedBoard') AND EXISTS(SELECT 1 FROM unnest(s.start_times_utc) t WHERE t::time<'06:00' OR t::time>'23:00'))
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

CREATE TABLE IF NOT EXISTS smarter_private.daily_window_policy(
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 time_zone text NOT NULL DEFAULT 'America/Chicago',
 spin_sng_stop time NOT NULL DEFAULT '03:00',
 last_hand time NOT NULL DEFAULT '03:58',
 window_start time NOT NULL DEFAULT '04:00',
 window_end time NOT NULL DEFAULT '06:00',
 first_tournament_start time NOT NULL DEFAULT '06:00',
 last_tournament_start time NOT NULL DEFAULT '23:00',
 monday_reopen_limit time NOT NULL DEFAULT '07:00',
 CHECK (spin_sng_stop < last_hand AND last_hand < window_start AND window_start < window_end
        AND window_end <= first_tournament_start AND first_tournament_start < last_tournament_start
        AND window_end < monday_reopen_limit)
);
ALTER TABLE smarter_private.daily_window_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.daily_window_policy FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO smarter_private.daily_window_policy(singleton) VALUES(true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_daily_window_policy()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
 SELECT jsonb_build_object('time_zone',p.time_zone,'spin_sng_stop',to_char(p.spin_sng_stop,'HH24:MI'),
  'last_hand',to_char(p.last_hand,'HH24:MI'),'window_start',to_char(p.window_start,'HH24:MI'),
  'window_end',to_char(p.window_end,'HH24:MI'),'first_tournament_start',to_char(p.first_tournament_start,'HH24:MI'),
  'last_tournament_start',to_char(p.last_tournament_start,'HH24:MI'),'monday_reopen_limit',to_char(p.monday_reopen_limit,'HH24:MI'))
 FROM smarter_private.daily_window_policy p WHERE p.singleton
$f$;
REVOKE ALL ON FUNCTION public.fn_daily_window_policy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_daily_window_policy() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_daily_window_entry_refusal(p_tournament_id uuid, p_at timestamptz DEFAULT clock_timestamp())
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE p smarter_private.daily_window_policy%ROWTYPE; local_t time; kind text;
BEGIN
 SELECT * INTO STRICT p FROM smarter_private.daily_window_policy WHERE singleton;
 local_t := (p_at AT TIME ZONE p.time_zone)::time;
 IF local_t >= p.window_start AND local_t < p.window_end THEN RETURN 'daily_maintenance_window'; END IF;
 SELECT upper(coalesce(t.tournament_type,'')) INTO kind FROM public.tournaments t WHERE t.id=p_tournament_id;
 IF kind IN ('SPIN','SNG') AND local_t >= p.spin_sng_stop AND local_t < p.window_end THEN RETURN 'spin_sng_closed_until_reopen'; END IF;
 RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.fn_daily_window_entry_refusal(uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_daily_window_entry_refusal(uuid,timestamptz) TO authenticated, service_role;

DO $patch$
DECLARE d text; r text[][]; i int;
BEGIN
 -- 3. the registration lock
 d:=pg_get_functiondef('public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure);
 IF position('daily_window_entry_refusal' IN d)=0 THEN
  IF md5(d) IS DISTINCT FROM 'aa265e27cee6b1ae2fd06a9f729d7903' THEN RAISE EXCEPTION 'seat_acquisition_preimage_changed'; END IF;
  r:=ARRAY[
   ARRAY[$o1$v_started_at timestamptz;$o1$, $n1$v_started_at timestamptz; v_window_refusal text;$n1$],
   ARRAY[$o2$RETURN jsonb_build_object('ok',false,'reason','missing_user_id');
  END IF;$o2$,
         $n2$RETURN jsonb_build_object('ok',false,'reason','missing_user_id');
  END IF;
  -- THE DAILY WINDOW (20261103193545): no NEW tournament entry 4:00 to 6:00 AM
  -- Chicago, none into a Spin or Sit & Go from 3:00 AM; a player already in
  -- the tournament is never refused.
  IF p_tournament_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id AND tp.status IN ('registered','playing')) THEN
   v_window_refusal := public.fn_daily_window_entry_refusal(p_tournament_id);
   IF v_window_refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_window_refusal); END IF;
  END IF;$n2$]];
  FOR i IN 1..2 LOOP
   IF (length(d)-length(replace(d,r[i][1],'')))<>length(r[i][1]) THEN RAISE EXCEPTION 'seat_acquisition_patch_not_single %', i; END IF;
   d:=replace(d,r[i][1],r[i][2]);
  END LOOP;
  EXECUTE d;
 END IF;
 -- 4. the schedule writer
 d:=pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure);
 IF position('tournament_start_outside_daily_hours' IN d)=0 THEN
  IF md5(d) IS DISTINCT FROM 'a09f6bb1f74305694c18a437e01b39bb' THEN RAISE EXCEPTION 'schedule_upsert_preimage_changed'; END IF;
  r:=ARRAY[ARRAY[$o3$  IF array_length(v_days, 1) IS NULL THEN$o3$,
   $n3$  -- THE DAILY WINDOW (20261103193545): tournaments start only between the
  -- policy's first and last start (6:00 AM to 11:00 PM), in the schedule's zone.
  IF EXISTS(SELECT 1 FROM unnest(coalesce(v_times,'{}'::text[])) tm, smarter_private.daily_window_policy pol
     WHERE pol.singleton AND tm ~ '^\d{2}:\d{2}$' AND (CASE WHEN v_zone IS NOT NULL THEN tm::time
       ELSE ((('2026-01-15'::date + tm::time) AT TIME ZONE 'UTC') AT TIME ZONE pol.time_zone)::time END
       NOT BETWEEN pol.first_tournament_start AND pol.last_tournament_start)) THEN
    RETURN jsonb_build_object('error','tournament_start_outside_daily_hours','first_start','06:00','last_start','23:00')
      || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;
  IF array_length(v_days, 1) IS NULL THEN$n3$]];
  IF (length(d)-length(replace(d,r[1][1],'')))<>length(r[1][1]) THEN RAISE EXCEPTION 'schedule_upsert_patch_not_single'; END IF;
  EXECUTE replace(d,r[1][1],r[1][2]);
 END IF;
END $patch$;

-- 5. the seven 1:00 AM club Graveyard events
UPDATE public.tournament_schedules s SET active=false, updated_at=now()
 WHERE s.active AND s.time_zone='America/Chicago' AND s.start_times_utc='{01:00}'
   AND s.name IN ('Friday Graveyard','Omaha Thursday Graveyard','Midweek Five-Card Graveyard','Monday Graveyard PLO',
                  'Saturday Graveyard PLO','Turbo Tuesday Graveyard','Sunday Funday Graveyard');
COMMIT;
