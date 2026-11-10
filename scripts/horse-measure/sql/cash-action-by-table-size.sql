-- Hold'em cash action by table size, horses (READ-ONLY; one SELECT; run
-- through the Supabase MCP execute_sql or psql inside BEGIN ... ROLLBACK).
--
-- What a player at the table sees, per number of players dealt in: VPIP, PFR,
-- 3-bet (first action facing exactly one raise), raise-first-in, open-limp,
-- and the no-limper open size in big blinds (mean, median, share under
-- 2.45bb, min, max). Production twin of the offline probe
-- server/src/benchmark/HoldemCashActionProbe.ts.
--
-- Raise levels: rb = raises before the action (an open has rb 0, a 3-bet
-- rb 1). Change the window as needed; three hours of the fleet is ~60k
-- horse-hands and runs in a few seconds. Longer windows can hit the
-- statement timeout: narrow the window, never retry in a loop.
--
-- Baseline, 2026-11-10 ~02:45-05:45 UTC, engine 391f7bc0 (before V85):
--   9-handed  VPIP 15.9  PFR 11.8  3-bet 4.0  RFI 18.4  opens 3.37 mean / 3.50 median, 2.50-4.00
--   8-handed  VPIP 17.7  PFR 12.8  3-bet 2.7  RFI 21.7
--   6-handed  VPIP 26.5  PFR 17.7  3-bet 5.1  RFI 30.8  opens 3.09 mean / 3.06 median, 2.50-4.00
WITH horses AS MATERIALIZED (SELECT id::text uid FROM public.profiles WHERE is_horse),
base AS MATERIALIZED (
  SELECT h.id, h.big_blind bb, h.actions
  FROM public.hand_history h
  WHERE h.created_at >= now() - interval '3 hours' AND h.game_variant='nlh' AND h.tournament_id IS NULL AND h.bomb_pot IS NULL AND h.big_blind > 0),
pf AS (
  SELECT b.id, b.bb, t.o, x->>'action' act, x->>'userId' uid,
    CASE WHEN jsonb_typeof(x->'amount')='number' THEN (x->>'amount')::numeric ELSE 0 END amt
  FROM base b, jsonb_array_elements(b.actions) WITH ORDINALITY t(x,o)
  WHERE x->>'stage'='preflop' AND x->>'action' NOT IN ('ante','post','straddle','return','uncalled')),
dealt AS (SELECT id, count(DISTINCT uid) n FROM pf GROUP BY id),
seq AS (
  SELECT p.*, coalesce(max(amt) FILTER (WHERE act IN ('sb','bb','raise','all_in','bet')) OVER (PARTITION BY id ORDER BY o ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prevmax
  FROM pf p),
r AS (SELECT s.*, (act IN ('raise','bet') OR (act='all_in' AND amt > prevmax)) is_raise FROM seq s WHERE act NOT IN ('sb','bb')),
lvl AS (
  SELECT r.*, count(*) FILTER (WHERE is_raise) OVER (PARTITION BY id ORDER BY o ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) rb,
    count(*) FILTER (WHERE act='call') OVER (PARTITION BY id ORDER BY o ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) calls_before,
    (hz.uid IS NOT NULL) horse
  FROM r LEFT JOIN horses hz ON hz.uid=r.uid),
per AS (
  SELECT l.id, l.uid, d.n,
    bool_or(act IN ('call','raise','bet','all_in')) vpip,
    bool_or(is_raise) pfr,
    bool_or(rb=1) had3, bool_or(rb=1 AND is_raise) did3,
    bool_or(rb=0 AND calls_before=0) had_rfi, bool_or(rb=0 AND calls_before=0 AND is_raise) did_rfi,
    bool_or(rb=0 AND calls_before=0 AND act='call') open_limp
  FROM lvl l JOIN dealt d USING (id) WHERE l.horse GROUP BY 1,2,3),
opens AS (SELECT d.n, l.amt/l.bb x FROM lvl l JOIN dealt d USING (id) WHERE l.horse AND l.is_raise AND l.rb=0 AND l.calls_before=0 AND l.act<>'all_in'),
stats AS (
  SELECT n, count(*) horse_hands, round(100.0*avg(vpip::int),1) vpip, round(100.0*avg(pfr::int),1) pfr,
    round(100.0*sum(did3::int)/nullif(sum(had3::int),0),1) three_bet, sum(had3::int) three_bet_opps,
    round(100.0*sum(did_rfi::int)/nullif(sum(had_rfi::int),0),1) rfi,
    round(100.0*sum(open_limp::int)/nullif(sum(had_rfi::int),0),1) open_limp
  FROM per GROUP BY n),
sizes AS (
  SELECT n, count(*) opens, round(avg(x),2) open_mean_bb, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x)::numeric,2) open_median_bb,
    round(100.0*avg((x<2.45)::int),1) pct_under_2_45bb, round(min(x),2) open_min_bb, round(max(x),2) open_max_bb
  FROM opens GROUP BY n)
SELECT s.*, z.opens, z.open_mean_bb, z.open_median_bb, z.pct_under_2_45bb, z.open_min_bb, z.open_max_bb
FROM stats s LEFT JOIN sizes z USING (n) ORDER BY s.n DESC;
