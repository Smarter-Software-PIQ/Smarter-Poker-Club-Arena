-- 20261121091106_freeze_marks_follow_every_three_hourly_engine_cycle.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- periodic-work: Retimes the existing read-only maintenance circulation observations to every scheduled engine cycle; no game, payment, release or repair is performed.
--
-- THE FREEZE MARKS FOLLOW EVERY THREE-HOURLY ENGINE CYCLE (owner order
-- 2026-11-21 02:22 Chicago, session_01Gw7aDsC1z7GdpSYmDAM2kv: "I WANT A
-- ENGINE CUT OVER EVERY 3 HOURS"; docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md).
--
-- fn_ca_capture_freeze_mark took its pre/post circulation marks only at the
-- 04:00 Chicago break (20261021174252). The engine now breaks at 01, 04, 07,
-- 10, 13, 16, 19 and 22 Chicago once a release carrying the three-hourly
-- schedule seals. This takes the same observation-only marks at each of those
-- cycles. The database cannot read the serving engine's schedule, so a
-- non-04:00 cycle is marked only when the engine's own durable break row
-- names that cycle's announcement (announced_at within the two minutes before
-- the cycle): while the engine is still daily that row never exists at 07:00
-- and the function returns NULL at once, exactly as today. 04:00 is unchanged.
-- The repeated fall-back 01:00 is one cycle, the first (CDT). The crons run at
-- :00 and :05 of every UTC hour; the function decides.
--
-- @live-proof: (SELECT position('three-hourly' in pg_get_functiondef('public.fn_ca_capture_freeze_mark(text)'::regprocedure)) > 0 AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-freeze-mark-pre' AND schedule = '0 * * * *') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-freeze-mark-post' AND schedule = '5 * * * *'))
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_capture_freeze_mark(text)'::regprocedure) <> 'a5494657f5fbd308434ad69e88b2758c' THEN
    RAISE EXCEPTION 'circulation mark preimage changed; requalify';
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.fn_ca_capture_freeze_mark(p_kind text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_at timestamptz := clock_timestamp();
  v_local timestamp := v_at AT TIME ZONE 'America/Chicago';
  v_hour integer := extract(hour FROM v_local)::integer;
  v_cycle timestamptz;
  v_end timestamptz;
  m numeric; f numeric; t numeric; i integer := 0;
BEGIN
  IF p_kind NOT IN ('pre','post') OR p_kind IS NULL THEN
    RAISE EXCEPTION 'p_kind must be pre or post';
  END IF;
  -- three-hourly: the Chicago start hours of the scheduled engine cycles.
  IF v_hour <> ALL (ARRAY[1,4,7,10,13,16,19,22])
     OR extract(minute FROM v_local) <> (CASE WHEN p_kind='pre' THEN 0 ELSE 5 END) THEN
    RETURN NULL;
  END IF;
  -- The cycle start on the real epoch hour; the repeated fall-back hour (its
  -- local hour equals the hour before) is not a second cycle.
  v_cycle := date_trunc('hour', v_at);
  IF extract(hour FROM (v_cycle - interval '1 hour') AT TIME ZONE 'America/Chicago')::integer = v_hour THEN
    RETURN NULL;
  END IF;
  v_end := v_cycle + interval '5 minutes';
  -- Only the 04:00 anchor is unconditional. Any other cycle's pre mark is
  -- taken only when the engine's own durable break row announced THIS cycle;
  -- its post mark, as before, only when that pre mark exists.
  IF v_hour <> 4 AND p_kind = 'pre' AND NOT EXISTS (
    SELECT 1 FROM public.engine_maintenance_break b
     WHERE b.announced_at >= v_cycle - interval '3 minutes'
       AND b.announced_at <= v_cycle
  ) THEN
    RETURN NULL;
  END IF;
  IF p_kind='pre' THEN
    -- Existing bounded observation wait. Missing freeze means missing evidence,
    -- never a snapshot of ordinary play disguised as a conserved freeze.
    WHILE NOT public.fn_platform_frozen() AND i < 25 LOOP
      PERFORM pg_sleep(1); i := i + 1;
    END LOOP;
    IF NOT public.fn_platform_frozen() THEN RETURN NULL; END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.ca_freeze_circulation_marks
    WHERE window_hour=v_end AND kind='pre'
  ) THEN
    RETURN NULL;
  END IF;
  SELECT member_wallets,on_the_felt,total INTO m,f,t FROM public.fn_ca_circulation_total();
  INSERT INTO public.ca_freeze_circulation_marks(window_hour,kind,member_wallets,on_the_felt,total,mark_at)
  VALUES(v_end,p_kind,m,f,t,clock_timestamp())
  -- Repeated delivery must not replace the actual edge with later play.
  ON CONFLICT(window_hour,kind) DO NOTHING;
  RETURN v_end;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_capture_freeze_mark(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_capture_freeze_mark(text) TO service_role;
-- 'post' never waits: outside its minute it returns NULL at once, and inside
-- it writes only after an existing pre mark; the probe undoes either outcome.
-- @probe-for: public.fn_ca_capture_freeze_mark
DO $probe$
BEGIN
  PERFORM public.fn_ca_capture_freeze_mark('post');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
-- The same two read-only observers, on every hour; the function gates them.
SELECT cron.schedule('ca-freeze-mark-pre','0 * * * *', $$SELECT public.fn_ca_capture_freeze_mark('pre')$$);
SELECT cron.schedule('ca-freeze-mark-post','5 * * * *', $$SELECT public.fn_ca_capture_freeze_mark('post')$$);
COMMIT;
