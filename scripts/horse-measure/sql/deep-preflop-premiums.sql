-- Horse release verification: DEEP PREFLOP PREMIUM STACK-OFFS (2026-11-07,
-- V82 measurement). Every horse PREFLOP decision holding KK or QQ in NLH, or
-- at least two aces in PLO5 / PLO6, that continues (call, raise, all-in)
-- facing a 4-bet or more (three or more earlier raises or raising all-ins on
-- the street), plus every preflop all-in by those hands at any raise level.
-- Decision EV, bb = (net + chips already invested at the node) / bb, the
-- HorseOmahaBigBetCalls standard; `adj` repeats it with the all-in-equity
-- net (ca_hand_facts.ev_net) where the hand went all in, which removes the
-- run-out variance and nothing else. Depth = effective stack of the
-- confrontation at the deal: min(hero, last raiser) of behind + hand total
-- invested at the node. Excluded: heads-up tables, bounty / PKO / mystery-
-- bounty events, effective 20bb or less, bomb pots, run-it-twice hands.
-- Output: one text cell, a line per key 'hand|spot|band|slice n N g HANDS m
-- MEAN [LO, HI] adj MEAN [LO, HI]', 95% CIs clustered by hand. Windowed
-- [:START, :END); one UTC day per call completes. Read-only (one SELECT).
with cand as (
  select f.hand_id, f.user_id::text uid, f.net, coalesce(f.ev_net, f.net) evn, f.game_variant v,
    case when f.game_variant = 'nlh' then
           case when (select count(*) from jsonb_array_elements(f.hole_cards) h where h->>'rank' = 'K') = 2 then 'KK'
                when (select count(*) from jsonb_array_elements(f.hole_cards) h where h->>'rank' = 'Q') = 2 then 'QQ' end
         when (select count(*) from jsonb_array_elements(f.hole_cards) h where h->>'rank' = 'A') >= 2 then 'AA' end hand
  from public.ca_hand_facts f
  where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz
    and f.game_variant in ('nlh', 'plo5', 'plo6')
    and exists (select 1 from public.profiles p where p.id = f.user_id and p.is_horse)
),
j as (
  select cand.*, h.tournament_id, h.big_blind bb, h.actions,
    exists (select 1 from public.lightning_hand l where l.hand_id = h.id) lightning
  from cand join public.hand_history h on h.id = cand.hand_id
  where cand.hand is not null and h.bomb_pot is null and h.community_cards2 is null and h.big_blind > 0
),
sp as (
  select j.*, a.ord, a.e->'publicNode' pn, a.e->>'action' act,
    (select count(*) from jsonb_array_elements(j.actions) with ordinality p(e3, o3)
      where p.o3 < a.ord and p.e3->>'stage' = 'preflop' and p.e3->>'action' in ('raise', 'all_in')
        and coalesce((p.e3->>'amount')::numeric, 0) > 0) prior,
    (select x.e2->>'seat' from jsonb_array_elements(j.actions) with ordinality x(e2, o2)
      where x.o2 < a.ord and x.e2->>'stage' = 'preflop' and x.e2->>'action' in ('raise', 'all_in')
        and (x.e2->>'amount')::numeric = (a.e->'publicNode'->>'currentBet')::numeric
      order by x.o2 desc limit 1)::int rseat
  from j cross join lateral jsonb_array_elements(j.actions) with ordinality a(e, ord)
  where a.e->>'userId' = j.uid and a.e->>'origin' = 'horse_policy' and a.e->>'stage' = 'preflop'
    and a.e->>'action' in ('call', 'raise', 'all_in')
),
c as (
  select sp.*,
    (select s from jsonb_array_elements(sp.pn->'seats') s where (s->>0)::int = (sp.pn->>'actorSeat')::int) hs,
    (select s from jsonb_array_elements(sp.pn->'seats') s where (s->>0)::int = sp.rseat) rs,
    jsonb_array_length(sp.pn->'seats') seats_n,
    coalesce((select (tt.is_bounty or tt.is_pko or tt.is_mystery_bounty) from public.tournaments tt where tt.id = sp.tournament_id), false) bounty
  from sp where sp.rseat is not null and (sp.prior >= 3 or sp.act = 'all_in')
),
f as (
  select c.hand_id, c.v || '_' || c.hand hk, c.act,
    case when c.tournament_id is not null then 'tour' when c.lightning then 'lightning' else 'cash' end fmt,
    least((c.hs->>1)::numeric + (c.hs->>3)::numeric, (c.rs->>1)::numeric + (c.rs->>3)::numeric) / c.bb eff_bb,
    (c.net + (c.hs->>3)::numeric) / c.bb ev_bb,
    (c.evn + (c.hs->>3)::numeric) / c.bb adj_bb,
    array_remove(array[
      case when c.prior = 3 and c.act = 'call' then 'vs4bet_call' end,
      case when c.prior = 3 and c.act <> 'call' then 'vs4bet_5bet' end,
      case when c.prior >= 4 then 'vs5bet_plus_continue' end,
      case when c.act = 'all_in' then 'allin_any' end,
      case when c.prior >= 3 then 'vs4bet_plus_continue' end], null) spots
  from c where c.seats_n > 2 and not c.bounty
),
g as (
  select f.*, case when eff_bb < 100 then 'a<100' when eff_bb < 200 then 'b100-200' when eff_bb < 400 then 'c200-400' else 'd400+' end band
  from f where eff_bb > 20 and ev_bb is not null
),
lab as (
  select g.hand_id, g.ev_bb, g.adj_bb, l.k from g cross join lateral unnest(spots) sp(s)
  cross join lateral unnest(array[hk || '|' || s || '|' || band || '|all', hk || '|' || s || '|' || band || '|' || fmt]) l(k)
),
hc as (select k, hand_id, count(*) n_h, sum(ev_bb) s_h, sum(adj_bb) a_h from lab group by 1, 2),
agg as (select k, sum(n_h) n, count(*) g, sum(s_h) s, sum(s_h * s_h) ss, sum(s_h * n_h) sn, sum(n_h * n_h) nn,
          sum(a_h) a, sum(a_h * a_h) aa, sum(a_h * n_h) an from hc group by k)
select string_agg(k || ' n ' || n || ' g ' || g || ' m ' || round(s / n, 1) || ' [' ||
    case when g < 2 then 'NaN, NaN' else
      round(s / n - 1.96 * sqrt(greatest(ss - 2 * (s / n) * sn + (s / n) ^ 2 * nn, 0) * g / (g - 1)) / n, 1) || ', ' ||
      round(s / n + 1.96 * sqrt(greatest(ss - 2 * (s / n) * sn + (s / n) ^ 2 * nn, 0) * g / (g - 1)) / n, 1) end || '] adj ' ||
    round(a / n, 1) || ' [' ||
    case when g < 2 then 'NaN, NaN' else
      round(a / n - 1.96 * sqrt(greatest(aa - 2 * (a / n) * an + (a / n) ^ 2 * nn, 0) * g / (g - 1)) / n, 1) || ', ' ||
      round(a / n + 1.96 * sqrt(greatest(aa - 2 * (a / n) * an + (a / n) ^ 2 * nn, 0) * g / (g - 1)) / n, 1) end || ']',
  chr(10) order by k) cells
from agg
