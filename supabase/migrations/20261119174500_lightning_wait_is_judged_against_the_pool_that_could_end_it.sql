-- 20261119174500_lightning_wait_is_judged_against_the_pool_that_could_end_it.sql
--
-- A LIGHTNING WAIT IS JUDGED AGAINST THE POOL THAT COULD END IT
-- (fn_lightning_latency_regression, 2026-11-19)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, 2026-11-19 ~17:30 UTC)
--
-- lightning_alerts raised LIGHTNING_LATENCY_REGRESSION all day for leg
-- idle_to_match (and fast_fold_to_next_hand) on NLH 1.00/2.00 Lightning Games
-- (563279fc) and its siblings: 12-19 an hour before the 10:00 UTC cutover,
-- 1-4 an hour after, then 12-19 again from 15:00. Example: windows of n=22,
-- p95 19,866 ms around 12:04 UTC, at 5-7 AM Chicago.
--
-- idle_to_match is the time a folded player waits for a new table, and that
-- wait is set by how many other players are in the pool, not by the server.
-- Every 1-minute window of the last 72 h, banded by the players whose pool
-- slot was open through the whole window (windows with n >= 20):
--
--   pool    563279fc idle_to_match      all 8 clusters, idle_to_match
--   < 6     median p95 19.5 s, 92/92 over 5 s    median p95 15-20 s, ~100% over
--   6-8     median p95 15.2 s, 1213/1214 over    median p95 13-16 s, ~98% over
--   9-11    -                                    median p95  7.5-11.7 s, ~88% over
--   12-15   -                                    median p95  6.9-8.9 s,  ~80% over
--   16-24   -                                    median p95  3.9 s, 22% over (f67a1436)
--   25+     -                                    median p95  3.6 s, 17% over (f67a1436)
--
-- 563279fc never held more than 8 players in those 72 h, so every minute it
-- was measured it "regressed". HorseUnionCashPlan.ts already records the same
-- curve on PLO4 .25/.50: 20.9 s with 6 in the pool, 4.6 s with 17, 2.6 s with
-- 41. A six-max pool of one ring cannot fast fold: a folder waits for the one
-- hand in the air to end before enough players are idle to deal another.
-- The 5,000 ms ceiling is a ceiling for a full pool; the check applied it to
-- every pool.
--
-- THE FIX
--
-- The four WAIT legs (idle_to_match, fast_fold_to_next_hand,
-- normal_fold_to_next_hand, fold_watch_to_next_hand - each ends only when a
-- new table forms) are judged only when every window under judgement had at
-- least the minimum pool open through it: three full rings
-- (3 x handedness = 18 for six-max), the first band whose median p95 sits
-- under the ceiling, or the cluster's own `alert_latency_wait_min_pool` when
-- an operator sets one (0 restores the old judge-every-pool rule). A thin
-- pool is not a regression and is not paged.
-- A full pool that still waits past the ceiling in each of its windows IS a
-- regression and still pages, now with the pool of each window in the
-- alert's context. The server legs (fold_ack, ack_to_idle, match_to_hand,
-- hand_to_first_render) are judged exactly as before, at any pool size.
--
-- The same function answers the alert's 15-minute hysteresis resolve and the
-- rollout readiness LATENCY_ABOVE_CEILING reason, so both read the same rule.
-- The pool is measured only after the latency condition already holds for a
-- wait leg (about 8 ms a window, on the cluster's slots).
--
-- Pinned pre/postimage; re-apply is a no-op. Owner, settings and grants of
-- the redefined function are proven unchanged.
--
-- @live-proof: position('fn_lightning_pool_held' in pg_get_functiondef('public.fn_lightning_latency_regression(uuid,text,jsonb,timestamp with time zone)'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- The legs whose latency is a wait for a new table to form.
CREATE OR REPLACE FUNCTION public.fn_lightning_latency_leg_is_wait(p_leg text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT coalesce(p_leg IN ('idle_to_match', 'fast_fold_to_next_hand',
                            'normal_fold_to_next_hand', 'fold_watch_to_next_hand'), false);
$f$;

-- The smallest pool in which a wait leg is held to its ceiling: the cluster's
-- own alert_latency_wait_min_pool (0 judges every pool, the old rule), else
-- three full rings of its handedness.
CREATE OR REPLACE FUNCTION public.fn_lightning_latency_wait_min_pool(p_cfg jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT GREATEST(coalesce((p_cfg ->> 'alert_latency_wait_min_pool')::integer,
                           3 * GREATEST(coalesce((p_cfg ->> 'handedness')::integer, 6), 2)), 0);
$f$;

-- The players whose pool slot was open through the whole window [p_from, p_to]:
-- the players who were there to end a wait, from start to finish.
CREATE OR REPLACE FUNCTION public.fn_lightning_pool_held(p_cluster_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT count(DISTINCT s.player_id)::integer
    FROM public.lightning_pool_slot s
   WHERE s.cluster_id = p_cluster_id
     AND s.opened_at <= p_from
     AND (s.closed_at IS NULL OR s.closed_at >= p_to);
$f$;

REVOKE ALL ON FUNCTION public.fn_lightning_latency_leg_is_wait(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_lightning_latency_wait_min_pool(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_lightning_pool_held(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_latency_leg_is_wait(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_lightning_latency_wait_min_pool(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_lightning_pool_held(uuid, timestamptz, timestamptz) TO service_role;

CREATE FUNCTION pg_temp.lwp_subst(p_sig text, p_before text, p_after text,
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

SELECT pg_temp.lwp_subst(
  'public.fn_lightning_latency_regression(uuid,text,jsonb,timestamp with time zone)',
  'ccf233af7e943e8cae65d2c244a83dc6', '0985049d6eeba764739b127e27b5ed70',
  ARRAY[
$o1$  v_out  jsonb;
BEGIN$o1$,
$o2$    FROM w;
  RETURN v_out;$o2$],
  ARRAY[
$n1$  v_out  jsonb;
  v_pool jsonb;
BEGIN$n1$,
$n2$    FROM w;
  -- A WAIT IS JUDGED AGAINST THE POOL THAT COULD END IT (20261119174500):
  -- a wait leg over its ceiling is a regression only when every window under
  -- judgement held the minimum pool through it. A thin pool waits by nature.
  IF v_out IS NOT NULL AND public.fn_lightning_latency_leg_is_wait(p_leg) THEN
    SELECT jsonb_agg(x.e || jsonb_build_object('pool',
             public.fn_lightning_pool_held(p_cluster_id, (x.e ->> 'window_from')::timestamptz,
                                           (x.e ->> 'window_to')::timestamptz)) ORDER BY x.i)
      INTO v_pool
      FROM jsonb_array_elements(v_out) WITH ORDINALITY x(e, i);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_pool) y(e)
                WHERE (y.e ->> 'pool')::integer < public.fn_lightning_latency_wait_min_pool(p_cfg)) THEN
      RETURN NULL;
    END IF;
    v_out := v_pool;
  END IF;
  RETURN v_out;$n2$]);

-- @probe-for: public.fn_lightning_latency_regression
DO $probe$
DECLARE
  t0 timestamptz := clock_timestamp();
  g record;
  v_leg text;
  v_fake uuid;
  v_now timestamptz;
  v_cfg jsonb;
  v_out jsonb;
BEGIN
  -- The wait legs, and only they, are judged by pool.
  IF NOT (public.fn_lightning_latency_leg_is_wait('idle_to_match')
          AND public.fn_lightning_latency_leg_is_wait('fast_fold_to_next_hand')
          AND public.fn_lightning_latency_leg_is_wait('normal_fold_to_next_hand')
          AND public.fn_lightning_latency_leg_is_wait('fold_watch_to_next_hand'))
     OR public.fn_lightning_latency_leg_is_wait('fold_ack')
     OR public.fn_lightning_latency_leg_is_wait('ack_to_idle')
     OR public.fn_lightning_latency_leg_is_wait('match_to_hand')
     OR public.fn_lightning_latency_leg_is_wait('hand_to_first_render')
     OR public.fn_lightning_latency_leg_is_wait(NULL) THEN
    RAISE EXCEPTION 'the wait-leg set is not the four legs that wait for a table';
  END IF;
  IF public.fn_lightning_latency_wait_min_pool('{"handedness": 6}') <> 18
     OR public.fn_lightning_latency_wait_min_pool('{"handedness": 9}') <> 27
     OR public.fn_lightning_latency_wait_min_pool('{}') <> 18
     OR public.fn_lightning_latency_wait_min_pool('{"handedness": 6, "alert_latency_wait_min_pool": 10}') <> 10
     OR public.fn_lightning_latency_wait_min_pool('{"handedness": 6, "alert_latency_wait_min_pool": 0}') <> 0 THEN
    RAISE EXCEPTION 'the minimum pool is not three rings or the cluster''s own setting';
  END IF;
  -- THE JUDGEMENT, on fixture windows of a cluster with no pool (undone with
  -- the probe): three consecutive minutes, n = 30, every leg at 20 s.
  v_fake := gen_random_uuid();
  v_now := date_trunc('minute', now());
  INSERT INTO public.lightning_latency_window (cluster_id, window_from, window_to, legs)
  SELECT v_fake, v_now - make_interval(mins => m + 1), v_now - make_interval(mins => m),
         jsonb_build_object('idle_to_match', jsonb_build_object('n', 30, 'p50', 9000, 'p95', 20000, 'p99', 20000),
                            'fast_fold_to_next_hand', jsonb_build_object('n', 30, 'p50', 9000, 'p95', 20000, 'p99', 20000),
                            'match_to_hand', jsonb_build_object('n', 30, 'p50', 9000, 'p95', 20000, 'p99', 20000))
    FROM generate_series(0, 2) m;
  v_cfg := '{"handedness": 6, "alert_latency_windows": 3, "latency_window_ms": 60000, "alert_latency_min_samples": 20,
             "alert_latency_p95_ms": {"idle_to_match": 5000, "fast_fold_to_next_hand": 5000, "match_to_hand": 2000}}';
  -- A thin pool (0 held, under 18) waits by nature: no regression.
  IF public.fn_lightning_latency_regression(v_fake, 'idle_to_match', v_cfg, v_now) IS NOT NULL
     OR public.fn_lightning_latency_regression(v_fake, 'fast_fold_to_next_hand', v_cfg, v_now) IS NOT NULL THEN
    RAISE EXCEPTION 'a wait leg of a thin pool was judged a regression';
  END IF;
  -- A server leg is judged at any pool, exactly as before.
  IF public.fn_lightning_latency_regression(v_fake, 'match_to_hand', v_cfg, v_now) IS NULL THEN
    RAISE EXCEPTION 'a server leg over its ceiling was not judged a regression';
  END IF;
  -- A pool that meets the minimum is held to the ceiling, with each window's pool shown.
  v_out := public.fn_lightning_latency_regression(v_fake, 'idle_to_match',
             v_cfg || '{"alert_latency_wait_min_pool": 0}', v_now);
  IF v_out IS NULL OR jsonb_array_length(v_out) <> 3
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) e WHERE NOT (e ? 'pool')) THEN
    RAISE EXCEPTION 'a wait leg over its ceiling in a full pool was not judged a regression: %', v_out;
  END IF;
  -- Every live cluster and leg runs the new body, inside the sweep's budget.
  t0 := clock_timestamp();
  FOR g IN SELECT cg.id FROM public.cash_games cg
            WHERE EXISTS (SELECT 1 FROM public.lightning_latency_window lw WHERE lw.cluster_id = cg.id) LOOP
    FOREACH v_leg IN ARRAY ARRAY['fold_ack', 'ack_to_idle', 'idle_to_match', 'match_to_hand', 'hand_to_first_render',
                                 'fast_fold_to_next_hand', 'normal_fold_to_next_hand', 'fold_watch_to_next_hand'] LOOP
      PERFORM public.fn_lightning_latency_regression(g.id, v_leg, public.fn_lightning_config(g.id), now());
    END LOOP;
  END LOOP;
  IF clock_timestamp() - t0 > interval '3 seconds' THEN
    RAISE EXCEPTION 'the pool-aware latency check does not fit the minute sweep: %', clock_timestamp() - t0;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
