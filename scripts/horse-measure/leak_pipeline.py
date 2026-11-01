#!/usr/bin/env python3
"""Builds the read-only SQL for the horse leak analysis. Usage: leak_pipeline.py <cash|mtt> <pct> <agg_name>"""
import sys

CLS = r"""
CREATE FUNCTION pg_temp.cls(ranks int[], suits text[], n int) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $c$
DECLARE i int; j int; cnt int; s text; dr int[]; lo int; miss int; h1 int; h2 int; hits1 int := 0; hits2 int := 0; bmax int := 0; bpair boolean := false;
  made text := 'air'; fd boolean := false; sd boolean := false; sub text := '';
BEGIN
  IF ranks IS NULL OR array_length(ranks,1) < 2+n THEN RETURN NULL; END IF;
  h1 := ranks[1]; h2 := ranks[2];
  FOR i IN 3..(2+n) LOOP
    IF ranks[i] = h1 THEN hits1 := hits1 + 1; END IF;
    IF ranks[i] = h2 THEN hits2 := hits2 + 1; END IF;
    IF ranks[i] > bmax THEN bmax := ranks[i]; END IF;
    FOR j IN (i+1)..(2+n) LOOP IF ranks[i] = ranks[j] THEN bpair := true; END IF; END LOOP;
  END LOOP;
  IF h1 = h2 THEN
    IF hits1 > 0 THEN made := 'two_pair_plus'; ELSE made := 'one_pair'; sub := CASE WHEN h1 > bmax THEN 'top' ELSE 'under' END; END IF;
  ELSE
    IF hits1 >= 2 OR hits2 >= 2 OR (hits1 >= 1 AND hits2 >= 1) THEN made := 'two_pair_plus';
    ELSIF hits1 = 1 OR hits2 = 1 THEN
      IF bpair THEN made := 'two_pair_plus';
      ELSE made := 'one_pair'; sub := CASE WHEN (CASE WHEN hits1 = 1 THEN h1 ELSE h2 END) >= bmax THEN 'top' ELSE 'under' END; END IF;
    END IF;
  END IF;
  FOREACH s IN ARRAY ARRAY['s','h','d','c'] LOOP
    cnt := 0; FOR i IN 1..(2+n) LOOP IF suits[i] = s THEN cnt := cnt + 1; END IF; END LOOP;
    IF cnt >= 5 THEN made := 'two_pair_plus'; END IF;
    IF cnt = 4 AND n < 5 AND (suits[1] = s OR suits[2] = s) THEN fd := true; END IF;
  END LOOP;
  dr := ARRAY(SELECT DISTINCT x FROM unnest(ranks[1:(2+n)]) x);
  IF 13 = ANY(dr) THEN dr := dr || 0; END IF;
  FOR lo IN 0..9 LOOP
    miss := 0;
    FOR i IN 0..4 LOOP IF NOT ((lo+i) = ANY(dr)) THEN miss := miss + 1; END IF; END LOOP;
    IF miss = 0 THEN made := 'two_pair_plus'; END IF;
    IF miss = 1 AND n < 5 THEN sd := true; END IF;
  END LOOP;
  IF made = 'two_pair_plus' THEN RETURN made; END IF;
  IF made = 'one_pair' THEN RETURN 'one_pair:' || sub; END IF;
  IF fd OR sd THEN RETURN 'draw'; END IF;
  RETURN 'air';
END $c$;
"""

PIPE = r"""
WITH base AS (
  SELECT row_number() OVER () AS hid, net_bb, horse_user_id::text hero, seat hseat, hole_cards hc, board bd, actions ac
  FROM public.horse_hand_reviews
  WHERE game_variant='nlh' AND played_at >= now() - interval '7 days' AND {segment}
    AND abs(hashtext(horse_user_id::text||played_at::text)) % 1000 < {permille}
  LIMIT 12000
),
cards AS (
  SELECT hid, array_agg(rv ORDER BY o) ranks, array_agg(s ORDER BY o) suits, jsonb_array_length(bd) nb,
    bool_and(rv > 0 AND s IN ('s','h','d','c')) ok
  FROM base, LATERAL (
    SELECT o, CASE WHEN jsonb_typeof(c)='object' THEN position(upper(left(c->>'rank',1)) in '23456789TJQKA') ELSE position(upper(left(c#>>'{}',1)) in '23456789TJQKA') END rv,
           CASE WHEN jsonb_typeof(c)='object' THEN lower(left(c->>'suit',1)) ELSE lower(right(c#>>'{}',1)) END s
    FROM jsonb_array_elements(hc||bd) WITH ORDINALITY AS t(c,o)) x
  WHERE jsonb_typeof(hc)='array' AND jsonb_typeof(bd)='array' AND jsonb_array_length(hc)=2
  GROUP BY hid, bd
),
acts AS (
  SELECT b.hid, b.hero, b.hseat, t.o, a->>'stage' stage, a->>'userId' uid, a->>'action' act,
    CASE WHEN jsonb_typeof(a->'amount')='number' THEN (a->>'amount')::numeric ELSE 0 END amt,
    (a->>'seat')::int aseat,
    (p.pn->>'pot')::numeric pot, coalesce((p.pn->>'toCall')::numeric,0) tocall, coalesce((p.pn->>'currentBet')::numeric,0) curbet,
    (p.pn->>'dealerSeat')::int dealer, (p.pn->>'bigBlind')::numeric bb,
    CASE WHEN a->>'userId' = b.hero THEN (jsonb_path_query_first(p.pn, '$.seats[*] ? (@[0] == $s)', jsonb_build_object('s', b.hseat))->>1)::numeric END hstack,
    (a ? 'isFullRaise') full_raise, (p.pn IS NOT NULL) has_pn
  FROM base b, LATERAL jsonb_array_elements(b.ac) WITH ORDINALITY t(a,o), LATERAL (SELECT a->'publicNode' pn OFFSET 0) p
  WHERE jsonb_typeof(b.ac)='array' AND a->>'stage' IS NOT NULL AND a->>'userId' IS NOT NULL
),
acts2 AS (
  SELECT *, (act IN ('bet','raise') OR (act='all_in' AND full_raise)) is_aggr,
    act NOT IN ('sb','bb','straddle','post','ante','return','uncalled') voluntary
  FROM acts),
acts3 AS (
  SELECT *,
    count(*) FILTER (WHERE is_aggr) OVER (PARTITION BY hid, stage ORDER BY o ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) st_aggr,
    coalesce(bool_or(uid=hero AND tocall=0 AND act IN ('bet','all_in')) OVER (PARTITION BY hid, stage ORDER BY o ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), false) hero_bet_before,
    (uid=hero AND voluntary AND has_pn) is_hero_dec
  FROM acts2),
hinfo AS (
  SELECT hid, max(bb) bb, max(dealer) dealer, greatest(max(aseat), max(hseat)) maxseat,
    bool_or(uid=hero AND act='sb') is_sb, bool_or(uid=hero AND act='bb') is_bb,
    count(DISTINCT uid) FILTER (WHERE stage='flop') n_flop,
    (array_agg(uid ORDER BY o DESC) FILTER (WHERE stage='preflop' AND is_aggr))[1] pfa
  FROM acts3 GROUP BY hid),
pre_first AS (
  SELECT DISTINCT ON (hid) hid, o AS o1, st_aggr raises_before, act, curbet, tocall, pot, hstack,
    (act IN ('raise','all_in') AND st_aggr=0) opened
  FROM acts3 WHERE stage='preflop' AND is_hero_dec ORDER BY hid, o),
tb AS (
  SELECT DISTINCT ON (a.hid) a.hid, a.aseat tb_seat, a.o tb_o
  FROM acts3 a JOIN pre_first p ON p.hid=a.hid AND p.opened
  WHERE a.stage='preflop' AND a.is_aggr AND a.uid<>a.hero AND a.o > p.o1 ORDER BY a.hid, a.o),
pre_3b AS (
  SELECT DISTINCT ON (a.hid) a.hid, a.act tb_act, a.tocall tb_tocall, a.pot tb_pot, a.hstack tb_hstack, t.tb_seat
  FROM acts3 a JOIN tb t ON t.hid=a.hid
  WHERE a.stage='preflop' AND a.is_hero_dec AND a.o > t.tb_o AND a.tocall > 0 ORDER BY a.hid, a.o),
pre_ai AS (
  SELECT DISTINCT ON (hid) hid,
    CASE WHEN act='all_in' AND NOT full_raise AND st_aggr > 0 THEN 'call_allin' WHEN act='all_in' AND st_aggr=0 THEN 'shove_open' WHEN act='all_in' THEN 'shove_over' ELSE 'call_allin' END ai_kind,
    CASE WHEN act='all_in' THEN amt ELSE coalesce(hstack,0) + curbet - tocall END ai_stack, st_aggr ai_raises_before
  FROM acts3 WHERE stage='preflop' AND is_hero_dec AND (act='all_in' OR (act='call' AND hstack IS NOT NULL AND hstack <= tocall)) ORDER BY hid, o),
dec AS (
  SELECT DISTINCT ON (hid, stage) hid, stage, act, tocall, pot, st_aggr, hero_bet_before, hstack,
    CASE WHEN pot - tocall > 0 THEN tocall/(pot - tocall) ELSE 1 END frac
  FROM acts3 WHERE stage IN ('flop','turn','river') AND is_hero_dec AND tocall > 0 ORDER BY hid, stage, o),
rbet AS (
  SELECT DISTINCT ON (hid) hid, amt rb_amt, pot rb_pot
  FROM acts3 WHERE stage='river' AND is_hero_dec AND tocall=0 AND act IN ('bet','all_in') AND st_aggr=0 ORDER BY hid, o),
hands AS (
  SELECT b.hid, b.net_bb, (b.net_bb > 0) won, h.bb, h.n_flop,
    CASE WHEN h.is_bb THEN 'bb' WHEN h.is_sb THEN 'sb' WHEN b.hseat = h.dealer THEN 'btn' ELSE 'other' END pos,
    CASE WHEN c.ranks[1]=c.ranks[2] THEN 'pocket_pair'
         WHEN least(c.ranks[1],c.ranks[2]) >= 9 THEN 'broadway'
         WHEN c.suits[1]=c.suits[2] AND abs(c.ranks[1]-c.ranks[2]) <= 2 THEN 'suited_connector'
         WHEN c.suits[1]=c.suits[2] AND greatest(c.ranks[1],c.ranks[2]) = 13 THEN 'suited_ace'
         ELSE 'junk' END hole,
    CASE WHEN (c.ranks[1]=c.ranks[2] AND c.ranks[1] >= 11) OR (greatest(c.ranks[1],c.ranks[2])=13 AND least(c.ranks[1],c.ranks[2])=12) THEN '1_premium'
         WHEN (c.ranks[1]=c.ranks[2] AND c.ranks[1] >= 8) OR (greatest(c.ranks[1],c.ranks[2])=13 AND least(c.ranks[1],c.ranks[2])=11)
              OR (c.suits[1]=c.suits[2] AND ((greatest(c.ranks[1],c.ranks[2])=13 AND least(c.ranks[1],c.ranks[2])=10) OR (greatest(c.ranks[1],c.ranks[2])=12 AND least(c.ranks[1],c.ranks[2])=11))) THEN '2_strong'
         WHEN (c.ranks[1]=c.ranks[2] AND c.ranks[1] >= 5) OR (greatest(c.ranks[1],c.ranks[2])=13 AND (c.suits[1]=c.suits[2] OR least(c.ranks[1],c.ranks[2]) >= 9)) OR (least(c.ranks[1],c.ranks[2]) >= 9) THEN '3_medium'
         ELSE '4_weak' END tier,
    p.raises_before pf_raises_before, p.act pf_act, p.curbet/h.bb pf_open_bb, p.tocall/h.bb pf_tocall_bb, p.hstack/h.bb pf_stack_bb, p.opened,
    q.tb_act, q.tb_tocall/h.bb tb_tocall_bb, q.tb_pot/h.bb tb_pot_bb,
    CASE WHEN q.hid IS NULL THEN NULL ELSE ((b.hseat - h.dealer - 1 + 2*h.maxseat) % h.maxseat) > ((q.tb_seat - h.dealer - 1 + 2*h.maxseat) % h.maxseat) END tb_ip,
    ai.ai_kind, ai.ai_stack/h.bb ai_stack_bb, ai.ai_raises_before,
    pg_temp.cls(c.ranks, c.suits, 3) f_cls, f.act f_act, f.frac f_frac, f.st_aggr f_aggr, f.hero_bet_before f_own, (h.pfa IS NOT NULL AND h.pfa <> b.hero) f_vspfa, f.tocall/h.bb f_tocall_bb, f.pot/h.bb f_pot_bb,
    pg_temp.cls(c.ranks, c.suits, 4) t_cls, t.act t_act, t.frac t_frac, t.st_aggr t_aggr, t.hero_bet_before t_own, t.tocall/h.bb t_tocall_bb, t.pot/h.bb t_pot_bb,
    pg_temp.cls(c.ranks, c.suits, 5) r_cls, r.act r_act, r.frac r_frac, r.st_aggr r_aggr, r.hero_bet_before r_own, r.tocall/h.bb r_tocall_bb, r.pot/h.bb r_pot_bb,
    CASE WHEN rb.hid IS NULL THEN NULL WHEN rb.rb_pot > 0 THEN rb.rb_amt/rb.rb_pot ELSE 1 END rb_frac, rb.rb_amt/h.bb rb_bet_bb,
    c.nb
  FROM base b JOIN cards c ON c.hid=b.hid AND c.ok JOIN hinfo h ON h.hid=b.hid AND h.bb > 0
  LEFT JOIN pre_first p ON p.hid=b.hid LEFT JOIN pre_3b q ON q.hid=b.hid LEFT JOIN pre_ai ai ON ai.hid=b.hid
  LEFT JOIN dec f ON f.hid=b.hid AND f.stage='flop' LEFT JOIN dec t ON t.hid=b.hid AND t.stage='turn' LEFT JOIN dec r ON r.hid=b.hid AND r.stage='river'
  LEFT JOIN rbet rb ON rb.hid=b.hid
)
"""

AGGS = {
 'timing': "SELECT clock_timestamp()-now() el, count(*) n, sum(net_bb) net FROM hands",
 'turn': """
  SELECT 'turn_'||t_act q, t_cls k1, CASE WHEN t_frac < 0.4 THEN 'a<0.4' WHEN t_frac < 0.7 THEN 'b0.4-0.7' WHEN t_frac < 1.05 THEN 'c0.7-1.05' ELSE 'd>=1.05' END k2,
    count(*) n, count(*) FILTER (WHERE won) w, round(sum(net_bb)) net, round(avg(t_frac),2) avg_frac, round(avg(t_tocall_bb),1) avg_call_bb
  FROM hands WHERE t_act IS NOT NULL GROUP BY 1,2,3
  UNION ALL SELECT 'zz_sample','all','all', count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), null, null FROM hands
  ORDER BY 1,2,3""",
 'flop': """
  SELECT 'flop_vs_cbet' q, f_cls k1, f_act k2, count(*) n, count(*) FILTER (WHERE won) w, round(sum(net_bb)) net, round(avg(f_frac),2) avg_frac, round(avg(f_tocall_bb),1) avg_call_bb
  FROM hands WHERE f_vspfa AND f_aggr=1 AND NOT f_own GROUP BY 1,2,3
  UNION ALL
  SELECT 'flop_notcbet', f_cls, f_act, count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(f_frac),2), round(avg(f_tocall_bb),1)
  FROM hands WHERE f_act IS NOT NULL AND NOT (f_vspfa AND f_aggr=1 AND NOT f_own) GROUP BY 1,2,3
  UNION ALL
  SELECT 'flopcall_then_turn', f_cls, coalesce(t_act, CASE WHEN nb >= 4 THEN 'no_turn_bet_faced' ELSE 'ended' END), count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(t_frac),2), round(avg(t_tocall_bb),1)
  FROM hands WHERE f_act='call' GROUP BY 1,2,3
  UNION ALL
  SELECT 'flopcall_turncall_river', f_cls || '>' || t_cls, coalesce(r_act, CASE WHEN nb >= 5 THEN 'no_river_bet_faced' ELSE 'ended' END), count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(r_frac),2), round(avg(r_tocall_bb),1)
  FROM hands WHERE f_act='call' AND t_act='call' AND f_cls LIKE 'one_pair%' GROUP BY 1,2,3
  UNION ALL SELECT 'zz_sample','all','all', count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), null, null FROM hands
  ORDER BY 1,2,3""",
 'pre': """
  SELECT 'pre_3bet_faced' q, hole k1, (CASE WHEN tb_ip THEN 'ip' ELSE 'oop' END) || ':' || tb_act k2, count(*) n, count(*) FILTER (WHERE won) w, round(sum(net_bb)) net, round(avg(tb_tocall_bb),1) avg_tocall_bb, round(avg(tb_pot_bb),1) avg_pot_bb
  FROM hands WHERE tb_act IS NOT NULL GROUP BY 1,2,3
  UNION ALL
  SELECT 'pre_coldcall', hole, pos || ':' || CASE WHEN pf_raises_before=1 THEN 'vs_open' ELSE 'vs_3bet+' END, count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(pf_tocall_bb),1), round(avg(pf_open_bb),1)
  FROM hands WHERE pf_act='call' AND pf_raises_before >= 1 AND pos NOT IN ('bb') GROUP BY 1,2,3
  UNION ALL
  SELECT 'bb_defend_call', hole, CASE WHEN pf_open_bb <= 2.5 THEN 'a<=2.5x' WHEN pf_open_bb <= 3.5 THEN 'b2.5-3.5x' WHEN pf_open_bb <= 5 THEN 'c3.5-5x' ELSE 'd>5x' END, count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(pf_tocall_bb),1), round(avg(pf_open_bb),1)
  FROM hands WHERE pos='bb' AND pf_act='call' AND pf_raises_before = 1 GROUP BY 1,2,3
  UNION ALL
  SELECT 'bb_defend_3bet', hole, CASE WHEN pf_open_bb <= 2.5 THEN 'a<=2.5x' WHEN pf_open_bb <= 3.5 THEN 'b2.5-3.5x' WHEN pf_open_bb <= 5 THEN 'c3.5-5x' ELSE 'd>5x' END, count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(pf_tocall_bb),1), round(avg(pf_open_bb),1)
  FROM hands WHERE pos='bb' AND pf_act IN ('raise','all_in') AND pf_raises_before = 1 GROUP BY 1,2,3
  UNION ALL
  SELECT 'pre_first_overall', pos, pf_act || ':' || CASE WHEN pf_raises_before=0 THEN 'unopened' WHEN pf_raises_before=1 THEN 'vs_open' ELSE 'vs_3bet+' END, count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(pf_tocall_bb),1), round(avg(pf_open_bb),1)
  FROM hands WHERE pf_act IS NOT NULL GROUP BY 1,2,3
  UNION ALL SELECT 'zz_sample','all','all', count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), null, null FROM hands
  ORDER BY 1,2,3""",
 'river': """
  SELECT 'river_bet_raised' q, rb_cls_k k1, k2, count(*) n, count(*) FILTER (WHERE won) w, round(sum(net_bb)) net, round(avg(r_frac),2) avg_raise_frac, round(avg(r_tocall_bb),1) avg_tocall_bb
  FROM (SELECT *, r_cls rb_cls_k, coalesce(CASE WHEN r_own THEN r_act END, 'not_raised') k2 FROM hands WHERE rb_frac IS NOT NULL) s GROUP BY 1,2,3
  UNION ALL
  SELECT 'river_call_after_own_bet', r_cls, CASE WHEN r_frac < 0.7 THEN 'raise<0.7' WHEN r_frac < 1.5 THEN 'raise0.7-1.5' ELSE 'raise>=1.5' END, count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(r_frac),2), round(avg(r_tocall_bb),1)
  FROM hands WHERE r_own AND r_act IN ('call','all_in') GROUP BY 1,2,3
  UNION ALL
  SELECT 'turn_bet_raised', t_cls, coalesce(t_act,'x'), count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(t_frac),2), round(avg(t_tocall_bb),1)
  FROM hands WHERE t_own GROUP BY 1,2,3
  UNION ALL
  SELECT 'flop_bet_raised', f_cls, coalesce(f_act,'x'), count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(f_frac),2), round(avg(f_tocall_bb),1)
  FROM hands WHERE f_own GROUP BY 1,2,3
  UNION ALL SELECT 'zz_sample','all','all', count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), null, null FROM hands
  ORDER BY 1,2,3""",
 'allin': """
  SELECT 'pre_allin' q, CASE WHEN ai_stack_bb <= 15 THEN 'a<=15' WHEN ai_stack_bb <= 30 THEN 'b15-30' ELSE 'c30+' END || ':' || ai_kind k1, tier k2, count(*) n, count(*) FILTER (WHERE won) w, round(sum(net_bb)) net, round(avg(ai_stack_bb),1) avg_stack_bb, round(avg(abs(net_bb)),1) avg_abs_net
  FROM hands WHERE ai_kind IS NOT NULL GROUP BY 1,2,3
  UNION ALL
  SELECT 'pre_allin_hole', ai_kind, hole, count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(ai_stack_bb),1), round(avg(abs(net_bb)),1)
  FROM hands WHERE ai_kind IS NOT NULL GROUP BY 1,2,3
  UNION ALL
  SELECT 'multiway_onepair', CASE WHEN n_flop >= 3 THEN 'multiway' ELSE 'hu' END || ':' || st, cls || ':' || act, count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), round(avg(frac),2), round(avg(tocall),1)
  FROM (SELECT n_flop, won, net_bb, 'flop' st, f_cls cls, f_act act, f_frac frac, f_tocall_bb tocall FROM hands WHERE f_act IS NOT NULL
        UNION ALL SELECT n_flop, won, net_bb, 'turn', t_cls, t_act, t_frac, t_tocall_bb FROM hands WHERE t_act IS NOT NULL
        UNION ALL SELECT n_flop, won, net_bb, 'river', r_cls, r_act, r_frac, r_tocall_bb FROM hands WHERE r_act IS NOT NULL) u
  WHERE cls LIKE 'one_pair%' AND act IN ('call','fold') GROUP BY 1,2,3
  UNION ALL SELECT 'zz_sample','all','all', count(*), count(*) FILTER (WHERE won), round(sum(net_bb)), null, null FROM hands
  ORDER BY 1,2,3""",
}

seg = {'cash': 'tournament_id IS NULL', 'mtt': 'tournament_id IS NOT NULL'}[sys.argv[1]]
permille = int(sys.argv[2])
agg = AGGS[sys.argv[3]]
sql = CLS + PIPE.replace("{segment}", seg).replace("{permille}", str(permille)) + agg + ";"
sys.stdout.write(sql)
