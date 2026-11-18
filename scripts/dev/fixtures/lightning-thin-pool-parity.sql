-- 15 THIN POOL (20261110214134, Dan 2026-11-10: form tables sooner when the
-- pool is thin). Six ready players deal at once and five after one second, as
-- before; four ready players deal four-handed once the latest of them has
-- waited 1.5 seconds, and only while the Cluster's whole pool is at most 24.
-- Never fewer than four. Every plan below is the real fn_lightning_match_plan;
-- the captured ones are compared with the TypeScript port (lightningPassSizes);
-- every hand is formed, dealt and settled by the real barrier, begin_dealing
-- and settlement. Horses and humans are not distinguished.
-- TIME TRAVEL (fixture boundary): every open slot has waited out the waits.
CREATE FUNCTION pp.thin_age(p_game uuid, p_ago interval) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.lightning_pool_slot SET idle_since = clock_timestamp() - p_ago,
         opened_at = LEAST(opened_at, clock_timestamp() - p_ago - interval '1 second')
   WHERE cluster_id = p_game AND closed_at IS NULL;
$f$;
CREATE FUNCTION pp.thin_sizes(p jsonb) RETURNS integer[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT coalesce(array_agg(jsonb_array_length(g -> 'players') ORDER BY o), ARRAY[]::integer[])
    FROM jsonb_array_elements(p -> 'groups') WITH ORDINALITY x(g, o);
$f$;
-- Real passes on a closed pool; no blind or button twice in a row, and each
-- player's share of each within one of passes / table size (section 14's
-- tolerance is two; blinds and the button compete for the same seats).
CREATE FUNCTION pp.thin_rotation(p_k text, p_n integer, p_passes integer) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_g uuid; i integer; bad jsonb;
BEGIN
  v_g := pp.entry_pool(p_k, p_n, 0);
  FOR i IN 1 .. p_passes LOOP
    PERFORM pp.thin_age(v_g, interval '3 seconds');
    PERFORM pp.cycle(v_g);
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.lightning_hand h WHERE h.cluster_id = v_g AND h.player_count IS DISTINCT FROM p_n) THEN
    RAISE EXCEPTION 'FAIL 15 %: a hand of the % pool was not %-handed', p_k, p_n, p_n;
  END IF;
  WITH seq AS (
    SELECT hp.player_id, hp.blind_role, hp."position",
           lag(hp.blind_role) OVER w AS prev_role, lag(hp."position") OVER w AS prev_pos
      FROM public.lightning_hand_player hp JOIN public.lightning_hand h ON h.hand_id = hp.hand_id
     WHERE h.cluster_id = v_g
    WINDOW w AS (PARTITION BY hp.player_id ORDER BY h.formed_at, h.hand_id))
  SELECT jsonb_agg(to_jsonb(seq)) INTO bad FROM seq
   WHERE (blind_role = 'sb' AND prev_role = 'sb') OR (blind_role = 'bb' AND prev_role = 'bb')
      OR ("position" = 'btn' AND prev_pos = 'btn');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL 15 %: a blind or the button twice in a row: %', p_k, bad; END IF;
  WITH per AS (
    SELECT hp.player_id,
           count(*) FILTER (WHERE hp.blind_role = 'sb') AS sb,
           count(*) FILTER (WHERE hp.blind_role = 'bb') AS bb,
           count(*) FILTER (WHERE hp."position" = 'btn') AS btn
      FROM public.lightning_hand_player hp JOIN public.lightning_hand h ON h.hand_id = hp.hand_id
     WHERE h.cluster_id = v_g GROUP BY hp.player_id)
  SELECT jsonb_agg(to_jsonb(per)) INTO bad FROM per
   WHERE abs(sb - p_passes / p_n) > 1 OR abs(bb - p_passes / p_n) > 1 OR abs(btn - p_passes / p_n) > 1;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL 15 %: a share is more than one away from one in %: %', p_k, p_n, bad; END IF;
END $f$;
DO $$
DECLARE v_g uuid; p jsonb; r jsonb; h jsonb; v_hand uuid;
BEGIN
  -- A. Four players, a thin pool, the latest arrival 3 s ago: one four-handed
  -- table, formed, dealt and settled for real, with a button and both blinds.
  v_g := pp.entry_pool('THIN FOUR', 4, 0);
  p := pp.capture_entry('THIN FOUR', v_g);
  IF pp.thin_sizes(p) <> ARRAY[4] THEN RAISE EXCEPTION 'FAIL 15A: four aged players in a thin pool: %', p; END IF;
  PERFORM public.fxr_lease(public.fn_cash_cluster_front_table(v_g), true);
  r := public.fn_lightning_match_and_form(v_g, clock_timestamp(), NULL, NULL, gen_random_uuid());
  IF coalesce((r ->> 'formed')::integer, 0) <> 1 THEN RAISE EXCEPTION 'FAIL 15A: the barrier did not form the four: %', r; END IF;
  h := r -> 'hands' -> 0;
  v_hand := (h ->> 'hand_id')::uuid;
  PERFORM pp.finish(v_g, (h ->> 'instance_id')::uuid, v_hand);
  IF (SELECT player_count FROM public.lightning_hand WHERE hand_id = v_hand) <> 4
     OR (SELECT count(*) FROM public.lightning_hand_player WHERE hand_id = v_hand AND blind_role = 'sb') <> 1
     OR (SELECT count(*) FROM public.lightning_hand_player WHERE hand_id = v_hand AND blind_role = 'bb') <> 1
     OR (SELECT count(*) FROM public.lightning_hand_player WHERE hand_id = v_hand AND "position" = 'btn') <> 1
     OR (SELECT count(*) FROM public.lightning_instance WHERE hand_id = v_hand AND started_at IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'FAIL 15A: the four-handed hand was not dealt with a button and both blinds: %',
      (SELECT jsonb_agg(to_jsonb(x)) FROM public.lightning_hand_player x WHERE x.hand_id = v_hand);
  END IF;

  -- B. The latest arrival 1.2 s ago: past the five's second, inside the
  -- four's 1.5 s. Nothing forms; at 1.6 s it does.
  PERFORM pp.thin_age(v_g, interval '1.2 seconds');
  p := public.fn_lightning_match_plan(v_g, clock_timestamp(), NULL, NULL, NULL, NULL);
  IF jsonb_array_length(p -> 'groups') <> 0 THEN RAISE EXCEPTION 'FAIL 15B: four formed inside 1.5 s: %', p; END IF;
  r := public.fn_lightning_form_hand(v_g, pp.open_players(v_g), p_target_size => 4::smallint, p_max_size => 4::smallint,
         p_now => clock_timestamp(), p_matcher_version => 'm1', p_request_id => gen_random_uuid());
  IF r ->> 'reason' IS DISTINCT FROM 'WAITING_FOR_FIFTH_PLAYER' THEN
    RAISE EXCEPTION 'FAIL 15B: a direct caller formed four inside 1.5 s: %', r;
  END IF;
  PERFORM pp.thin_age(v_g, interval '1.6 seconds');
  p := public.fn_lightning_match_plan(v_g, clock_timestamp(), NULL, NULL, NULL, NULL);
  IF pp.thin_sizes(p) <> ARRAY[4] THEN RAISE EXCEPTION 'FAIL 15B: four did not form after 1.5 s: %', p; END IF;

  -- C. Ten in a thin pool: a six and a four.
  v_g := pp.entry_pool('THIN TEN', 10, 0);
  p := pp.capture_entry('THIN TEN', v_g);
  IF pp.thin_sizes(p) <> ARRAY[6, 4] THEN RAISE EXCEPTION 'FAIL 15C: ten in a thin pool: %', p; END IF;

  -- D. A healthy pool (28, above 24) keeps six as the target: four sixes and
  -- the four left over wait, however long they have waited.
  v_g := pp.entry_pool('HEALTHY 28', 28, 0);
  p := pp.capture_entry('HEALTHY 28', v_g);
  IF pp.thin_sizes(p) <> ARRAY[6, 6, 6, 6] THEN RAISE EXCEPTION 'FAIL 15D: a healthy pool dealt a short table: %', p; END IF;
  -- At the boundary: 24 is thin (four sixes, nothing over), 22 = three sixes and a four.
  v_g := pp.entry_pool('THIN 22', 22, 0);
  p := pp.capture_entry('THIN 22', v_g);
  IF pp.thin_sizes(p) <> ARRAY[6, 6, 6, 4] THEN RAISE EXCEPTION 'FAIL 15D: a pool of 22 did not deal its four: %', p; END IF;

  -- E. Five is unchanged: one second from the fifth arrival.
  v_g := pp.entry_pool('FIVE UNCHANGED', 5, 0);
  PERFORM pp.thin_age(v_g, interval '1.2 seconds');
  p := pp.capture_entry('FIVE UNCHANGED', v_g);
  IF pp.thin_sizes(p) <> ARRAY[5] THEN RAISE EXCEPTION 'FAIL 15E: five did not form after one second: %', p; END IF;

  -- Three never deal.
  v_g := pp.entry_pool('THREE NEVER', 3, 0);
  p := public.fn_lightning_match_plan(v_g, clock_timestamp(), NULL, NULL, NULL, NULL);
  IF jsonb_array_length(p -> 'groups') <> 0 THEN RAISE EXCEPTION 'FAIL 15E: three formed: %', p; END IF;
END $$;
-- F. Fairness holds short-handed: twelve real passes of four, fifteen of five.
SELECT pp.thin_rotation('ROTATION FOUR', 4, 12);
SELECT pp.thin_rotation('ROTATION FIVE', 5, 15);
\echo '  ok  15 THIN POOL  four aged players in a thin pool deal four-handed through the real barrier, begin_dealing and settlement; inside 1.5 s nothing forms (plan and direct caller); ten deal 6+4, 22 deal 6+6+6+4, a healthy 28 keeps sixes; five unchanged at one second, three never; at four and five no blind or button twice in a row and every share within one'
