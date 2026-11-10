-- 14 POSITION FAIRNESS (20261110160345, Dan 2026-11-10: "I was SB 3 hands in
-- a row and was on the button or in the bb multiple times within a couple
-- hands. this needs to be truly fair and corrected").
--
-- A Cluster of eighteen players (three six-handed tables a pass) is dealt
-- thirty real passes through the real matcher, barrier and terminal path.
-- Each blind and the button go to the player who has gone longest without
-- it, so:
--   - nobody posts the small blind, posts the big blind or holds the button
--     in two consecutive hands of their own;
--   - every player holds each of them within one or two of hands / 6;
--   - every open slot's hands_since_button is exactly the dealt hands since
--     its last button (and hands_since_sb since its last small blind);
--   - a pass voided before dealing gives every counter back exactly;
--   - a mid-run plan is captured, so the TypeScript port is compared with the
--     SQL under the recency rule with counters that differ.
-- Horses and humans are not distinguished: the rig's population is both.
CREATE FUNCTION pp.fair_min_hands(p_game uuid) RETURNS integer LANGUAGE sql STABLE AS $f$
  SELECT coalesce(min(c), 0)::integer FROM (
    SELECT ps.player_id, (SELECT count(*) FROM public.lightning_hand_player hp
                           JOIN public.lightning_hand h ON h.hand_id = hp.hand_id
                          WHERE h.cluster_id = p_game AND hp.player_id = ps.player_id) AS c
      FROM public.lightning_pool_session ps WHERE ps.cluster_id = p_game AND ps.exited_at IS NULL) x;
$f$;
DO $$
DECLARE v_g uuid; i integer; bad jsonb; before jsonb; after jsonb; r jsonb; h jsonb;
BEGIN
  -- Eighteen regulars on the template production deals (13's builder; no
  -- newcomers, so every seat is a blind, a button or neither by the rule).
  v_g := pp.entry_pool('FAIRNESS', 18, 0);
  -- Real passes until every player has been dealt thirty hands (a pass may
  -- admit fewer than three tables), capturing one plan on the way.
  i := 0;
  LOOP
    PERFORM pp.cycle(v_g);
    i := i + 1;
    EXIT WHEN pp.fair_min_hands(v_g) >= 30;
    IF i = 12 THEN PERFORM pp.capture_entry('FAIRNESS MID-RUN', v_g); END IF;
    IF i >= 200 THEN RAISE EXCEPTION 'FAIL 14: 200 passes dealt fewer than 30 hands to somebody'; END IF;
  END LOOP;
  IF i <= 12 THEN RAISE EXCEPTION 'FAIL 14: the mid-run plan was never captured (% passes)', i; END IF;

  -- No blind and no button twice in a row in any player's own hands.
  WITH seq AS (
    SELECT hp.player_id, h.formed_at, hp.blind_role, hp."position",
           lag(hp.blind_role) OVER w AS prev_role, lag(hp."position") OVER w AS prev_pos
      FROM public.lightning_hand_player hp JOIN public.lightning_hand h ON h.hand_id = hp.hand_id
     WHERE h.cluster_id = v_g
    WINDOW w AS (PARTITION BY hp.player_id ORDER BY h.formed_at, h.hand_id))
  SELECT jsonb_agg(to_jsonb(seq)) INTO bad FROM seq
   WHERE (blind_role = 'sb' AND prev_role = 'sb')
      OR (blind_role IN ('bb', 'entry_bb') AND prev_role IN ('bb', 'entry_bb'))
      OR ("position" = 'btn' AND prev_pos = 'btn');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 14: a blind or the button twice in a row: %', bad;
  END IF;

  -- Each player's share of each, within two of their hands / 6.
  WITH per AS (
    SELECT hp.player_id, count(*) AS n,
           count(*) FILTER (WHERE hp.blind_role = 'sb') AS sb,
           count(*) FILTER (WHERE hp.blind_role IN ('bb', 'entry_bb')) AS bb,
           count(*) FILTER (WHERE hp."position" = 'btn') AS btn,
           avg(h.player_count) AS seats
      FROM public.lightning_hand_player hp JOIN public.lightning_hand h ON h.hand_id = hp.hand_id
     WHERE h.cluster_id = v_g GROUP BY hp.player_id)
  SELECT jsonb_agg(to_jsonb(per)) INTO bad FROM per
   WHERE abs(sb - n / seats) > 2 OR abs(bb - n / seats) > 2 OR abs(btn - n / seats) > 2;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 14: a player''s share of a blind or the button is not fair: %', bad;
  END IF;

  -- The counters are exactly the dealt hands since the last one.
  SELECT jsonb_agg(jsonb_build_object('slot', sl.id, 'hsb', sl.hands_since_button, 'want_hsb', c.hsb,
                                      'hss', sl.hands_since_sb, 'want_hss', c.hss)) INTO bad
    FROM public.lightning_pool_slot sl
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE d.formed_at > coalesce(d.last_btn, '-infinity'))::integer AS hsb,
             count(*) FILTER (WHERE d.formed_at > coalesce(d.last_sb, '-infinity'))::integer AS hss
        FROM (SELECT h.formed_at,
                     max(h.formed_at) FILTER (WHERE x."position" = 'btn') OVER () AS last_btn,
                     max(h.formed_at) FILTER (WHERE x.blind_role = 'sb') OVER () AS last_sb
                FROM public.lightning_hand_player x
                JOIN public.lightning_hand h ON h.hand_id = x.hand_id
                JOIN public.lightning_instance li ON li.hand_id = x.hand_id
               WHERE x.pool_slot_id = sl.id AND li.started_at IS NOT NULL) d) c
   WHERE sl.cluster_id = v_g AND sl.closed_at IS NULL
     AND (sl.hands_since_button IS DISTINCT FROM c.hsb OR sl.hands_since_sb IS DISTINCT FROM c.hss);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 14: a slot''s hands_since_button or hands_since_sb is not its dealt hands since: %', bad;
  END IF;

  -- A pass voided before dealing gives every counter and stamp back.
  SELECT jsonb_object_agg(sl.id, jsonb_build_array(sl.hands_since_button, sl.last_button_at,
                                                    sl.hands_since_sb, sl.last_sb_at,
                                                    sl.hands_since_bb, sl.last_bb_at))
    INTO before FROM public.lightning_pool_slot sl WHERE sl.cluster_id = v_g AND sl.closed_at IS NULL;
  PERFORM public.fxr_lease(public.fn_cash_cluster_front_table(v_g), true);
  r := public.fn_lightning_match_and_form(v_g, clock_timestamp(), NULL, NULL, gen_random_uuid());
  IF coalesce((r ->> 'formed')::integer, 0) = 0 THEN RAISE EXCEPTION 'FAIL 14: the void pass formed nothing: %', r; END IF;
  FOR h IN SELECT x FROM jsonb_array_elements(r -> 'hands') x LOOP
    PERFORM public.fn_lightning_instance_abandon((h ->> 'instance_id')::uuid, 'fixture_void_before_deal', clock_timestamp());
  END LOOP;
  SELECT jsonb_object_agg(sl.id, jsonb_build_array(sl.hands_since_button, sl.last_button_at,
                                                    sl.hands_since_sb, sl.last_sb_at,
                                                    sl.hands_since_bb, sl.last_bb_at))
    INTO after FROM public.lightning_pool_slot sl WHERE sl.cluster_id = v_g AND sl.closed_at IS NULL;
  IF after IS DISTINCT FROM before THEN
    RAISE EXCEPTION 'FAIL 14: a voided pass kept a counter or a stamp: before % after %', before, after;
  END IF;
END $$;
\echo '  ok  14 POSITION FAIRNESS  eighteen players dealt real passes until each has thirty hands: no blind or button twice in a row, every share within two of hands / seats, the counters exact, a voided pass gives them back, and a mid-run plan captured for the port'
