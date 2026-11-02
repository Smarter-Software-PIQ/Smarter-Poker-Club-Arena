-- Horse release verification: SEAT-AWARE JAMS (V77). How often a horse
-- facing exactly one open (its first voluntary preflop action, opener
-- excluded) moved all in, by the OPENER's position bucket, format and the
-- table size (3-handed Spins only have late seats) and the
-- horse's effective stack, windowed [:START, :END). Keep the window at most
-- about 4 hours per call (hand_history is large); sum the slices.
-- Read-only (one SELECT).
WITH hands AS (
  SELECT id, big_blind, tournament_id, actions
  FROM public.hand_history
  WHERE created_at >= :START::timestamptz AND created_at < :END::timestamptz
    AND game_variant = 'nlh' AND bomb_pot IS NULL AND big_blind > 0),
pf AS (
  SELECT h.id AS hand_id, h.big_blind, h.tournament_id, a.ord,
         a.elem->>'userId' AS user_id, a.elem->>'action' AS action,
         coalesce((a.elem->>'amount')::numeric, 0) AS amount
  FROM hands h CROSS JOIN LATERAL jsonb_array_elements(h.actions) WITH ORDINALITY AS a(elem, ord)
  WHERE a.elem->>'stage' = 'preflop' AND a.elem->>'action' IN ('raise','all_in','call','fold','check')),
pf2 AS (
  SELECT *, count(*) FILTER (WHERE action IN ('raise','all_in'))
    OVER (PARTITION BY hand_id ORDER BY ord ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_aggr
  FROM pf),
openers AS (
  SELECT DISTINCT ON (hand_id) hand_id, user_id AS opener_id
  FROM pf2 WHERE action IN ('raise','all_in') AND prior_aggr = 0 ORDER BY hand_id, ord),
opps AS (
  SELECT DISTINCT ON (p.hand_id, p.user_id) p.hand_id, p.user_id, p.action, p.tournament_id, o.opener_id
  FROM pf2 p JOIN openers o ON o.hand_id = p.hand_id
  WHERE p.prior_aggr = 1 AND p.user_id <> o.opener_id ORDER BY p.hand_id, p.user_id, p.ord),
horse_opps AS (
  SELECT op.*, cfo.position AS opener_pos, cfh.effective_stack_bb_at_deal AS eff_bb, cfh.players_dealt AS dealt
  FROM opps op
  JOIN public.profiles pr ON pr.id = op.user_id::uuid AND pr.is_horse
  LEFT JOIN public.ca_hand_facts cfo ON cfo.hand_id = op.hand_id AND cfo.user_id = op.opener_id::uuid
  LEFT JOIN public.ca_hand_facts cfh ON cfh.hand_id = op.hand_id AND cfh.user_id = op.user_id::uuid)
SELECT
  CASE WHEN opener_pos IN ('UTG','UTG+1','UTG+2','LJ') THEN 'early'
       WHEN opener_pos IN ('MP','HJ') THEN 'mid'
       WHEN opener_pos IN ('CO','BTN','SB','BB') THEN 'late' ELSE 'unknown' END AS opener_bucket,
  CASE WHEN tournament_id IS NULL THEN 'cash' ELSE 'tournament' END AS fmt,
  CASE WHEN dealt IS NULL THEN 'unknown' WHEN dealt <= 3 THEN 'dealt<=3' WHEN dealt <= 6 THEN 'dealt4-6' ELSE 'dealt7+' END AS table_size,
  CASE WHEN eff_bb IS NULL THEN 'unknown' WHEN eff_bb <= 15 THEN 'a_le15' WHEN eff_bb <= 25 THEN 'b_15_25'
       WHEN eff_bb <= 40 THEN 'c_25_40' ELSE 'd_40plus' END AS stack_bucket,
  count(*) AS faced_one_open,
  count(*) FILTER (WHERE action = 'all_in') AS jams
FROM horse_opps
GROUP BY 1, 2, 3, 4
ORDER BY 2, 3, 4, 1;
