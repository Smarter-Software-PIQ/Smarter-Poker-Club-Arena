-- 20261118165140_the_horse_fleet_measures_its_stuck_horses.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE HORSE FLEET MEASURES ITS STUCK HORSES, AND ONE FALLBACK CYCLE IS NOT A
-- DEGRADED FLEET (reliability incident DailyDigest.horse_fleet_degraded,
-- 2026-11-18)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-18 ~16:40 UTC)
--
-- The daily digest said "Horse fleet degraded on 1 heartbeats; stuck-horse
-- count unavailable" for 2026-11-17 and the reliability controller escalated
-- it. Two separate defects:
--
-- 1. The stuck count has NEVER been measured. Every one of the
--    public.ca_horse_fleet_heartbeat rows for 40+ days has horses_stuck NULL
--    (2026-11-17: 2,635 of 2,635). HorseFleetManager.publishFleetState sends
--    horses_stuck: null on purpose ("derived from last_action_at, which the
--    seeding cycle never reads"), and nothing downstream ever filled it.
--    20261028152402 then correctly stopped reading NULL as 0, so the digest
--    can only ever say "unavailable". Yet public.ca_horse_fleet_state, which
--    the SAME RPC writes a moment earlier, carries last_action_at and is
--    current for seated horses (162 of 196 acted in the last 2 minutes at
--    16:33 UTC). The measurement belongs where both are in hand.
-- 2. "degraded" on a heartbeat means only that the fleet policy read failed
--    and that one cycle ran on the built-in defaults - today's behaviour,
--    unchanged (HorseFleetManager seedAllTables: `if (p.degraded)
--    beat.degraded = true` with the warning "running on the hardcoded
--    defaults for this cycle (today behaviour, unchanged)"). Every degraded
--    beat in 30 days has no failed read and no reason; 2026-11-17's single one
--    (03:10 UTC, a 104 s cycle) fell inside the Lightning post-commit convoy.
--    fn_sp_digest_attention fired the warning on ANY degraded beat, so one
--    slow policy read out of 2,635 cycles paged the fleet as degraded.
--
-- THE FIX
--
-- 1. public.fn_ca_horses_stuck_now(), read from the engine's own commit
--    record (hand_history), never from ca_horse_fleet_state.last_action_at
--    (a batched seat touch that can freeze or go stale: see the function).
--    A horse is stuck when, for the whole horse_stuck_minutes window
--    (sp_digest_settings, default 10), it held its live seat (seated before
--    the window, no exit at that seat and no seat move into the table inside
--    it), was not sitting out and not waiting for the big blind, its table
--    committed at least three hands, and it was dealt into none of them or
--    every voluntary action recorded for it was a timeout. A horse at a table
--    that is not dealing is a stalled TABLE (TableStoppedDealing owns that).
--    Measured on production 2026-11-18: the first draft (last_action_at older
--    than 10 minutes at a dealing table) counted 10-12 horses, every one of
--    them dealt into hands in the window, just seated, moved in, or waiting
--    for the big blind; this definition counts 0, in 60 ms.
-- 2. fn_ca_fleet_state_upsert fills horses_stuck from it when the engine sends
--    null, AFTER the state rows of the same call are written. The measurement
--    runs in its own subtransaction: a failure leaves horses_stuck NULL
--    (unknown, never 0) and never costs the heartbeat. A value the engine does
--    send is kept. No engine change and no cutover are needed.
-- 3. fn_sp_daily_metrics_compute adds horse_fleet.max_degraded_run (the
--    longest run of consecutive degraded beats that day), and
--    fn_sp_digest_attention fires the fleet warning when that run reaches
--    horse_degraded_run (sp_digest_settings, default 3), or when the measured
--    stuck count passes horse_stuck_ratio of seated (unchanged). A metrics row
--    from before max_degraded_run existed is read by its degraded count.
--
-- No money moves. No heartbeat, state or digest row is written by this file.
--
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_fleet_state_upsert(jsonb,jsonb)'::regprocedure)) = 'b3b7429972a836c072e0f212b6303766' AND md5(pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure)) = 'd28b32a8562f5b24035f7fc0d1323326' AND md5(pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure)) = '37787e6b6afcf24e0289741858ebb855' AND to_regprocedure('public.fn_ca_horses_stuck_now()') IS NOT NULL

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

INSERT INTO public.sp_digest_settings (key, value, note)
VALUES
  ('horse_stuck_minutes', 10, 'A seated horse that has not acted this many minutes while its own table dealt a hand in that window is stuck'),
  ('horse_degraded_run', 3, 'Consecutive fleet cycles on fallback policy before the digest calls the horse fleet degraded')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_ca_horses_stuck_now()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $f$
  -- A STUCK HORSE IS ONE ITS TABLE DEALS AROUND, OR ONE THAT ONLY TIMES OUT
  -- (20261118165140). Read from the engine's own commit record
  -- (hand_history.players and .actions), never from
  -- ca_horse_fleet_state.last_action_at: that stamp is a batched, best-effort
  -- seat touch (HorseHandReview.touchHorseSeats -> fn_ca_fleet_seat_touch)
  -- that the fleet upsert keeps forever once written. At table f02a6a5e it
  -- froze at 16:08-16:09 on 2026-11-18 while the table committed 55 more
  -- hands with the same five horses dealt into every one, and for 2478c921 it
  -- was 14 hours older than the seat. A horse counts only when, for the WHOLE
  -- window, it held its live seat: seated before the window (joined_at, which
  -- a seat move copies from the source seat, so ALSO no exit recorded at that
  -- table and seat inside the window and no seat move into the table inside
  -- it), not sitting out, not waiting for the big blind (entry_hold
  -- 'waiting': not dealt in by rule); and its table committed at least three
  -- hands in the window; and either it is in NONE of them, or every voluntary
  -- action the engine recorded for it was a timeout.
  WITH w AS (
    SELECT now() - make_interval(mins => public.fn_sp_setting('horse_stuck_minutes', 10)::integer) AS since
  ),
  seated AS (
    SELECT f.horse_id, f.table_id
      FROM public.ca_horse_fleet_state f
      JOIN public.table_seats s
        ON s.table_id = f.table_id AND s.user_id = f.horse_id AND s.left_at IS NULL
     CROSS JOIN w
     WHERE f.state = 'seated'
       AND s.joined_at <= w.since
       AND NOT COALESCE(s.is_sitting_out, false)
       AND s.entry_hold IS DISTINCT FROM 'waiting'
       AND NOT EXISTS (SELECT 1 FROM public.ca_seat_stack_exits e
                        WHERE e.occurred_at > w.since
                          AND e.table_id = s.table_id AND e.seat_number = s.seat_number)
       AND NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m
                        WHERE m.player_id = f.horse_id AND m.to_table_id = f.table_id
                          AND m.executed_at > w.since)
  ),
  hands AS (
    SELECT h.table_id, h.players, h.actions
      FROM public.hand_history h CROSS JOIN w
     WHERE h.table_id IN (SELECT DISTINCT table_id FROM seated)
       AND h.created_at > w.since
  ),
  dealing AS (
    SELECT table_id FROM hands GROUP BY table_id HAVING count(*) >= 3
  ),
  dealt AS (
    SELECT DISTINCT h.table_id, p ->> 'userId' AS uid
      FROM hands h, jsonb_array_elements(h.players) p
  ),
  acted AS (
    SELECT h.table_id, a ->> 'userId' AS uid,
           count(*) FILTER (WHERE a ->> 'origin' = 'timeout') AS timeouts,
           count(*) AS voluntary
      FROM hands h,
           jsonb_array_elements(CASE WHEN jsonb_typeof(h.actions) = 'array' THEN h.actions ELSE '[]'::jsonb END) a
     WHERE COALESCE(a ->> 'origin', '') <> 'forced'
       AND COALESCE(a ->> 'action', '') NOT IN ('return', 'sb', 'bb', 'ante', 'bomb_ante')
     GROUP BY 1, 2
  )
  SELECT count(*)::integer
    FROM seated s
   WHERE s.table_id IN (SELECT table_id FROM dealing)
     AND (NOT EXISTS (SELECT 1 FROM dealt d WHERE d.table_id = s.table_id AND d.uid = s.horse_id::text)
          OR EXISTS (SELECT 1 FROM acted x
                      WHERE x.table_id = s.table_id AND x.uid = s.horse_id::text
                        AND x.voluntary > 0 AND x.timeouts = x.voluntary));
$f$;

REVOKE ALL ON FUNCTION public.fn_ca_horses_stuck_now() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horses_stuck_now() TO service_role;

-- The pinned-text substitution (the form 20261118073646 uses). Already the
-- postimage (installed by an earlier run): a no-op, never a refusal.
CREATE FUNCTION pg_temp.fleet_subst(p_sig text, p_before text, p_after text,
                                    p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;

  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;

  EXECUTE v_new;

  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

-- 1 and 2. The heartbeat carries a measured stuck count.
SELECT pg_temp.fleet_subst(
  'public.fn_ca_fleet_state_upsert(jsonb,jsonb)',
  'a9949cbfaba3ab6f13c660c1d81561ea', 'b3b7429972a836c072e0f212b6303766',
  ARRAY[
$o1$  v_beat_at timestamptz;
begin
$o1$,
$o2$  if p_beat is not null and jsonb_typeof(p_beat) = 'object' then
    insert into public.ca_horse_fleet_heartbeat (
$o2$,
$o3$      nullif(p_beat ->> 'horses_stuck', '')::int,
$o3$],
  ARRAY[
$n1$  v_beat_at timestamptz;
  v_stuck int;
begin
$n1$,
$n2$  if p_beat is not null and jsonb_typeof(p_beat) = 'object' then
    -- THE FLEET MEASURES ITS STUCK HORSES (20261118165140): the engine sends
    -- horses_stuck as null (its seeding cycle never reads last_action_at) and
    -- nothing else ever filled it, so every heartbeat since October said
    -- "unknown" and the daily digest could only say "stuck-horse count
    -- unavailable". The state rows this call just wrote carry last_action_at,
    -- so the count is measured here by fn_ca_horses_stuck_now(). A failed
    -- measurement stays null (unknown), never 0, and never costs the beat.
    if nullif(p_beat ->> 'horses_stuck', '') is null then
      begin
        v_stuck := public.fn_ca_horses_stuck_now();
      exception when others then
        v_stuck := null;
      end;
    end if;
    insert into public.ca_horse_fleet_heartbeat (
$n2$,
$n3$      coalesce(nullif(p_beat ->> 'horses_stuck', '')::int, v_stuck),
$n3$]);

-- 3a. The day reports its longest run of fallback cycles.
SELECT pg_temp.fleet_subst(
  'public.fn_sp_daily_metrics_compute(date)',
  'cf92a94803102ccc48e77192e38bfa17', 'd28b32a8562f5b24035f7fc0d1323326',
  ARRAY[$o4$'avg_seated', round(avg(horses_seated)), 'max_seated', max(horses_seated)) FROM hb),$o4$],
  ARRAY[$n4$'avg_seated', round(avg(horses_seated)), 'max_seated', max(horses_seated))
         || jsonb_build_object('max_degraded_run', (SELECT COALESCE(max(n), 0) FROM (SELECT count(*) AS n FROM (SELECT COALESCE(degraded, false) AS d, count(*) FILTER (WHERE NOT COALESCE(degraded, false)) OVER (ORDER BY beat_at, id) AS grp FROM hb) r WHERE d GROUP BY grp) q)) FROM hb),$n4$]);

-- 3b. The fleet warning fires on a run of fallback cycles, not on one.
SELECT pg_temp.fleet_subst(
  'public.fn_sp_digest_attention(date,jsonb)',
  'a95a3c6f8a5c4230c9a190ea38b1dede', '37787e6b6afcf24e0289741858ebb855',
  ARRAY[$o5$  IF COALESCE(v,0) > 0 OR COALESCE(v2,0) >$o5$],
  ARRAY[$n5$  -- ONE FALLBACK CYCLE IS NOT A DEGRADED FLEET (20261118165140): a degraded
  -- beat means the fleet policy read failed and that one cycle ran on the
  -- built-in defaults (today's behaviour, unchanged). One such cycle in a day
  -- (2026-11-17: 1 of 2,635 beats) paged the fleet as degraded; a run of
  -- horse_degraded_run consecutive fallback cycles is what is degraded. A
  -- metrics row from before max_degraded_run existed is read by its count.
  IF COALESCE((p_metrics#>>'{play,horse_fleet,max_degraded_run}')::numeric, v, 0) >= public.fn_sp_setting('horse_degraded_run',3) OR COALESCE(v2,0) >$n5$]);

COMMIT;
