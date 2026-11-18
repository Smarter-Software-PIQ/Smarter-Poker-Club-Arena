-- 20261112005012_lightning_horse_arrivals_keep_the_70_to_90_second_pace_in_ev.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch.
--
-- WHAT THIS CHANGES, AND WHY (owner, Dan, 2026-11-11):
--
-- 20261111214248 paced Horse arrivals in every Lightning game other than
-- c79d8ec2, but it also divided the 70 to 90 second spacing by the number of
-- whole Lightning starts already in the pool:
--     v_streams := greatest(1, v_population / v_on);
--     next_admission_at = p_now + (70 + floor(random()*21)) / v_streams
-- That acceleration was never approved. In production it let Horses arrive
-- 4.4 to 10 seconds apart in the busy Horse-only pools NLH 0.25/0.50 and
-- PLO4 0.25/0.50. Owner decision: the approved 70 to 90 second Horse arrival
-- pace holds in EVERY game, however many players the pool already holds.
--
-- This redefines fn_lightning_horse_admit_paced without the division. All
-- else is kept exactly: one Horse admission at a time per game, counted from
-- the last SUCCESSFUL admission; a lone person's heads-up opponent is seated
-- at once and at that person's table; a refused admission raises P0001 inside
-- the buy-in so the debit, seat and progress row roll back together. People
-- never reach this guard (Horse seat inserts only), so real players are never
-- slowed or capped. c79d8ec2 (PLO4 1/2) keeps its own route, which already
-- spaces 70 to 90 seconds with no acceleration (read-only check 2026-11-12).
-- Existing seats, stacks and admission progress rows are not touched.
-- No timer, worker, sweep or repair loop is added.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $predecessor$
BEGIN
  IF md5(pg_get_functiondef('public.fn_lightning_horse_admit_paced(uuid,uuid,timestamptz)'::regprocedure))
     <> '55fb815245ccef227f084ac8d0c6a47d' THEN
    RAISE EXCEPTION 'fn_lightning_horse_admit_paced predecessor changed';
  END IF;
END $predecessor$;

CREATE OR REPLACE FUNCTION public.fn_lightning_horse_admit_paced(p_table uuid, p_player uuid, p_now timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_game uuid;
  v_mode text;
  v_progress public.lightning_horse_admission%ROWTYPE;
  v_rescue uuid;
BEGIN
  SELECT g.id, g.cluster_mode INTO v_game, v_mode
    FROM public.tables t JOIN public.cash_games g ON g.id = t.cluster_id
   WHERE t.id = p_table AND g.enabled AND g.lightning_enabled;
  IF v_game IS NULL THEN RETURN; END IF;

  INSERT INTO public.lightning_horse_admission(game_id, next_admission_at)
  VALUES (v_game, p_now) ON CONFLICT (game_id) DO NOTHING;
  SELECT * INTO STRICT v_progress FROM public.lightning_horse_admission
   WHERE game_id = v_game FOR UPDATE;

  -- A lone person's first opponent belongs at that person's table.
  IF v_mode = 'must_move' THEN
    SELECT t.id INTO v_rescue
      FROM public.tables t JOIN public.table_seats s ON s.table_id = t.id
      LEFT JOIN public.profiles p ON p.id = s.user_id
     WHERE t.cluster_id = v_game AND NOT coalesce(t.is_deleted, false)
       AND coalesce(t.lifecycle, '') <> 'closed' AND s.left_at IS NULL
       AND s.user_id IS NOT NULL AND coalesce(s.stack, 0) > 0
       AND NOT coalesce(s.is_sitting_out, false) AND NOT coalesce(s.leave_pending, false)
     GROUP BY t.id HAVING count(DISTINCT s.user_id) = 1 AND bool_or(NOT coalesce(p.is_horse, false))
     ORDER BY t.id LIMIT 1;
    IF v_rescue IS NOT NULL AND p_table IS DISTINCT FROM v_rescue THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'LIGHTNING_ADMISSION_DEMAND: the heads-up opponent belongs at the waiting human table';
    END IF;
  END IF;

  IF p_now < v_progress.next_admission_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'LIGHTNING_ADMISSION_PACED: next individual arrival is not due';
  END IF;

  -- 70 to 90 whole seconds after THIS admission, in every pool, at any size.
  UPDATE public.lightning_horse_admission
     SET admitted_count = admitted_count + 1, last_admitted_at = p_now, last_player_id = p_player,
         next_admission_at = p_now + make_interval(secs => 70 + floor(random() * 21)::integer)
   WHERE game_id = v_game;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_horse_admit_paced(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

DO $verify$
DECLARE s text := pg_get_functiondef('public.fn_lightning_horse_admit_paced(uuid,uuid,timestamptz)'::regprocedure);
BEGIN
  IF position('v_streams' in s) > 0 OR position('v_on' in s) > 0
     OR position('make_interval(secs => 70 + floor(random() * 21)::integer)' in s) = 0 THEN
    RAISE EXCEPTION 'Lightning Horse spacing is not the fixed 70 to 90 seconds';
  END IF;
END $verify$;
COMMIT;
