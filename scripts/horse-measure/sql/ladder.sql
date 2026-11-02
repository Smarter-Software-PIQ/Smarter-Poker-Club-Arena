-- Horse release verification: PREFLOP LADDER (V74 open sizes, V73/V75 answer
-- to a 3-bet, rule 4 answer to a 5-bet). Same logic as
-- preflop-raise-ladder.sql, windowed [:START, :END). Raise levels: rb = raises
-- before the action (open rb=0, 3-bet rb=1, 4-bet rb=2, 5-bet rb=3).
-- Read-only (one SELECT).
WITH horses AS MATERIALIZED (SELECT id::text uid FROM public.profiles WHERE is_horse),
base AS MATERIALIZED (
  SELECT h.id, (h.tournament_id IS NULL) cash, h.big_blind bb, h.actions
  FROM public.hand_history h
  WHERE h.created_at >= :START::timestamptz AND h.created_at < :END::timestamptz
    AND h.game_variant = 'nlh' AND h.bomb_pot IS NULL AND h.big_blind > 0),
pf AS (
  SELECT b.id, b.cash, b.bb, t.o, x->>'action' act, x->>'userId' uid,
    CASE WHEN jsonb_typeof(x->'amount') = 'number' THEN (x->>'amount')::numeric ELSE 0 END amt
  FROM base b, jsonb_array_elements(b.actions) WITH ORDINALITY t(x, o)
  WHERE x->>'stage' = 'preflop' AND x->>'action' NOT IN ('ante','post','straddle','return','uncalled')),
seq AS (
  SELECT p.*, coalesce(max(amt) FILTER (WHERE act IN ('sb','bb','raise','all_in','bet'))
    OVER (PARTITION BY id ORDER BY o ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) prevmax
  FROM pf p),
r AS (SELECT s.*, (act IN ('raise','bet') OR (act = 'all_in' AND amt > prevmax)) is_raise FROM seq s WHERE act NOT IN ('sb','bb')),
lvl AS (
  SELECT r.*, count(*) FILTER (WHERE is_raise) OVER (PARTITION BY id ORDER BY o ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) raises_before,
    (hz.uid IS NOT NULL) horse
  FROM r LEFT JOIN horses hz ON hz.uid = r.uid),
f3 AS (SELECT l.* FROM lvl l WHERE l.horse AND l.raises_before = 2
    AND EXISTS (SELECT 1 FROM lvl o2 WHERE o2.id = l.id AND o2.uid = l.uid AND o2.is_raise AND o2.raises_before = 0)),
f5 AS (SELECT l.* FROM lvl l WHERE l.horse AND l.raises_before >= 4
    AND EXISTS (SELECT 1 FROM lvl o2 WHERE o2.id = l.id AND o2.uid = l.uid AND o2.is_raise AND o2.raises_before = 2)
    AND l.o = (SELECT min(o3.o) FROM lvl o3 WHERE o3.id = l.id AND o3.uid = l.uid AND o3.raises_before >= 4)),
opens AS (SELECT cash, amt / bb x FROM lvl WHERE horse AND is_raise AND raises_before = 0 AND act <> 'all_in')
SELECT
 (SELECT count(*) FROM base) hands,
 (SELECT jsonb_object_agg(k, v) FROM (SELECT (CASE WHEN cash THEN 'cash ' ELSE 'mtt ' END) || CASE WHEN is_raise THEN '4bet' WHEN act IN ('call','check') OR act = 'all_in' THEN 'call' ELSE act END k, count(*) v FROM f3 GROUP BY 1) q) facing3bet,
 (SELECT jsonb_object_agg(k, v) FROM (SELECT (CASE WHEN cash THEN 'cash ' ELSE 'mtt ' END) || CASE WHEN is_raise THEN 'jam/raise' WHEN act IN ('call','check','all_in') THEN 'call' ELSE act END k, count(*) v FROM f5 GROUP BY 1) q) facing5bet_after_4bet,
 (SELECT jsonb_object_agg(k, v) FROM (SELECT (CASE WHEN cash THEN 'cash ' ELSE 'mtt ' END) || CASE WHEN x < 2.05 THEN 'a<=2.0' WHEN x < 2.3 THEN 'b2.0-2.3' WHEN x < 2.5 THEN 'c2.3-2.5' WHEN x < 3.0 THEN 'd2.5-3.0' WHEN x < 3.6 THEN 'e3.0-3.6' ELSE 'f3.6+' END k, count(*) v FROM opens GROUP BY 1) q) open_sizes,
 (SELECT count(*) FROM opens WHERE cash AND x < 2.5 - 1e-9) cash_opens_under_2_5bb,
 (SELECT round(avg(x), 2)::text || ' / ' || round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x)::numeric, 2) FROM opens WHERE cash) cash_open_avg_med,
 (SELECT round(avg(x), 2)::text || ' / ' || round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x)::numeric, 2) FROM opens WHERE NOT cash) mtt_open_avg_med;
