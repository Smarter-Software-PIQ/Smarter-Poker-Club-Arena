-- Horse release verification: DEEP ONE-PAIR CONTINUES FACING A RAISE
-- (2026-11-07, V82 measurement). Every NLH horse TURN or RIVER decision that
-- continues (call, raise, all-in) when the street already holds a bet AND a
-- raise (hero bet and was raised, or hero faces a bet and a raise). The hand
-- class is computed AT THE DECISION from hole cards plus the board recorded in
-- the publicNode, with the same categories as the engine's 7-card evaluator
-- (no straight, no flush, no trips, exactly one paired rank = one pair).
-- Decision EV, bb = (net + chips the horse had already invested at the node)
-- / bb: the continue's value against folding there, later streets and chops
-- included (the HorseOmahaBigBetCalls standard). Depth = the effective stack
-- of the confrontation AT THE DEAL: min(hero, last raiser) of behind + hand
-- total invested at the node. Excluded from every cell: heads-up tables,
-- bounty / PKO / mystery-bounty events, effective 20bb or less, bomb pots and
-- run-it-twice hands. Output: one text cell, a line per key 'class|band|slice n N g HANDS m MEAN
-- [LO, HI]' with the 95% CI clustered by hand. Windowed [:START, :END); one
-- UTC day per call completes. Read-only (one SELECT).
with cand as (
  select f.hand_id, f.user_id::text uid, f.net, f.hole_cards
  from public.ca_hand_facts f
  where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz
    and f.game_variant = 'nlh'
    and coalesce(f.passive_actions_turn, 0) + coalesce(f.passive_actions_river, 0)
      + coalesce(f.aggressive_actions_turn, 0) + coalesce(f.aggressive_actions_river, 0) > 0
    and exists (select 1 from public.profiles p where p.id = f.user_id and p.is_horse)
),
j as (
  select cand.*, h.tournament_id, h.big_blind bb, h.actions,
    exists (select 1 from public.lightning_hand l where l.hand_id = h.id) lightning
  from cand join public.hand_history h on h.id = cand.hand_id
  where h.bomb_pot is null and h.community_cards2 is null and h.big_blind > 0
),
sp as (
  select j.*, a.ord, a.e->'publicNode' pn, a.e->>'stage' street, a.e->>'action' act,
    (select x.e2->>'seat' from jsonb_array_elements(j.actions) with ordinality x(e2, o2)
      where x.o2 < a.ord and x.e2->>'stage' = a.e->>'stage' and x.e2->>'action' in ('bet', 'raise', 'all_in')
        and (x.e2->>'amount')::numeric = (a.e->'publicNode'->>'currentBet')::numeric
      order by x.o2 desc limit 1)::int rseat
  from j cross join lateral jsonb_array_elements(j.actions) with ordinality a(e, ord)
  where a.e->>'userId' = j.uid and a.e->>'origin' = 'horse_policy' and a.e->>'stage' in ('turn', 'river')
    and a.e->>'action' in ('call', 'raise', 'all_in')
    and (a.e->'publicNode'->>'toCall')::numeric > 0
    and (select count(*) from jsonb_array_elements(j.actions) with ordinality p(e3, o3)
          where p.o3 < a.ord and p.e3->>'stage' = a.e->>'stage'
            and p.e3->>'action' in ('bet', 'raise', 'all_in')
            and coalesce((p.e3->>'amount')::numeric, 0) > 0) >= 2
),
c as (
  select sp.*, sp.pn->'boards'->>0 board,
    (select s from jsonb_array_elements(sp.pn->'seats') s where (s->>0)::int = (sp.pn->>'actorSeat')::int) hs,
    (select s from jsonb_array_elements(sp.pn->'seats') s where (s->>0)::int = sp.rseat) rs,
    (select count(*) from jsonb_array_elements(sp.pn->'seats') s where s->>6 in ('0', '2')) n_active,
    jsonb_array_length(sp.pn->'seats') seats_n,
    coalesce((select (tt.is_bounty or tt.is_pko or tt.is_mystery_bounty) from public.tournaments tt where tt.id = sp.tournament_id), false) bounty
  from sp where sp.rseat is not null
),
cls as (
  select c.hand_id, c.ord, k.*
  from c cross join lateral (
    with kc as (
      select strpos('23456789TJQKA', hc->>'rank') + 1 r, left(hc->>'suit', 1) s from jsonb_array_elements(c.hole_cards) hc
      union all
      select strpos('23456789TJQKA', substr(c.board, 2 * i - 1, 1)) + 1, substr(c.board, 2 * i, 1)
      from generate_series(1, length(c.board) / 2) i)
    select (select max(n) from (select count(*) n from kc group by r) a) maxc,
      (select count(*) from (select r from kc group by r having count(*) = 2) b) npairs,
      (select max(r) from (select r from kc group by r having count(*) = 2) b) prank,
      (select max(n) >= 5 from (select count(*) n from kc group by s) z) flush,
      exists (select 1 from generate_series(1, 10) g
              where (select count(distinct case when kc.r = 14 and g = 1 then 1 else kc.r end) from kc
                     where (case when kc.r = 14 and g = 1 then 1 else kc.r end) between g and g + 4) = 5) straight) k
),
f as (
  select c.hand_id, c.street, c.act, c.board, c.n_active,
    case when c.tournament_id is not null then 'tour' when c.lightning then 'lightning' else 'cash' end fmt,
    least((c.hs->>1)::numeric + (c.hs->>3)::numeric, (c.rs->>1)::numeric + (c.rs->>3)::numeric) / c.bb eff_bb,
    (c.net + (c.hs->>3)::numeric) / c.bb ev_bb,
    case when cl.flush or cl.straight or cl.maxc >= 3 then 'trips_plus'
         when cl.npairs >= 2 then case when (select count(*) - count(distinct substr(c.board, 2 * i - 1, 1)) from generate_series(1, length(c.board) / 2) i) > 0
                                       then 'two_pair_boardpair' else 'two_pair' end
         when cl.npairs = 1 then
           case when (select count(*) from jsonb_array_elements(c.hole_cards) hc where strpos('23456789TJQKA', hc->>'rank') + 1 = cl.prank) = 2
                  then case when cl.prank > (select max(strpos('23456789TJQKA', substr(c.board, 2 * i - 1, 1)) + 1) from generate_series(1, length(c.board) / 2) i)
                            then 'one_pair_overpair' else 'one_pair_underpocket' end
                when (select count(*) from jsonb_array_elements(c.hole_cards) hc where strpos('23456789TJQKA', hc->>'rank') + 1 = cl.prank) = 1
                  then case when cl.prank = (select max(strpos('23456789TJQKA', substr(c.board, 2 * i - 1, 1)) + 1) from generate_series(1, length(c.board) / 2) i)
                            then 'one_pair_top' else 'one_pair_lower' end
                else 'one_pair_board' end
         else 'no_pair' end hclass
  from c join cls cl on cl.hand_id = c.hand_id and cl.ord = c.ord
  where c.seats_n > 2 and not c.bounty
),
g as (
  select f.*, case when eff_bb < 100 then 'a<100' when eff_bb < 200 then 'b100-200' when eff_bb < 400 then 'c200-400' else 'd400+' end band
  from f where eff_bb > 20 and ev_bb is not null
),
lab as (
  select g.hand_id, g.ev_bb, l.k from g cross join lateral unnest(array[
    (case when hclass like 'one_pair%' then 'one_pair' else hclass end) || '|' || band || '|all',
    (case when hclass like 'one_pair%' then 'one_pair' else hclass end) || '|' || band || '|' || street,
    (case when hclass like 'one_pair%' then 'one_pair' else hclass end) || '|' || band || '|' || fmt,
    (case when hclass like 'one_pair%' then 'one_pair' else hclass end) || '|' || band || '|' || case when act = 'call' then 'call' else 'raise' end,
    (case when hclass like 'one_pair%' then 'one_pair' else hclass end) || '|' || band || '|' || case when n_active > 2 then 'mw' else 'hu' end,
    case when hclass like 'one_pair%' then hclass || '|' || band || '|all' end,
    case when hclass like 'one_pair%' then hclass || '|' || band || '|' || street end,
    case when hclass like 'one_pair%' then hclass || '|' || band || '|' || fmt end
  ]) l(k) where l.k is not null
),
hc as (select k, hand_id, count(*) n_h, sum(ev_bb) s_h from lab group by 1, 2),
agg as (select k, sum(n_h) n, count(*) g, sum(s_h) s, sum(s_h * s_h) ss, sum(s_h * n_h) sn, sum(n_h * n_h) nn from hc group by k)
select string_agg(k || ' n ' || n || ' g ' || g || ' m ' || round(s / n, 1) || ' [' ||
    case when g < 2 then 'NaN, NaN' else
      round(s / n - 1.96 * sqrt(greatest(ss - 2 * (s / n) * sn + (s / n) ^ 2 * nn, 0) * g / (g - 1)) / n, 1) || ', ' ||
      round(s / n + 1.96 * sqrt(greatest(ss - 2 * (s / n) * sn + (s / n) ^ 2 * nn, 0) * g / (g - 1)) / n, 1) end || ']',
  chr(10) order by k) cells
from agg
