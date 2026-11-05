-- Horse release verification: TOURNAMENT RESHOVES over exactly one open
-- (no callers), 15-30bb effective, by the opener's seat, table size and depth.
-- The horse's own blind seats are excluded: folding there is not free, so the
-- all-in-adjusted net (ca_hand_facts.ev_net, bb) is the jam's value against
-- folding only from a non-blind seat; antes are sunk in both branches, which
-- understates the jam by the ante (conservative). ICM is not modelled. A
-- reshove recorded as a 'raise' to the whole stack is not counted.
-- Measured 2026-11-01 16:00 to 11-02 16:00 UTC (old engine): every cell with
-- n >= 5 above zero, including over UTG openers 9-handed (+2.1bb, n 49) and
-- 4-6 handed (+3.2bb, n 13, 15-20bb), so the Phase 6 reshove node was left
-- unchanged. Watch these cells after V77.
-- n_ev / sum_ev_bb / sum_sq_ev_bb / sum_net_bb are additive, so the daily
-- scorecard combines slices exactly (one horse reshove per hand: a row is a
-- hand, so the interval is hand-clustered).
-- Windowed [:START, :END), keep <= ~1 day per call. Read-only (one SELECT).
with f as (
  select f.hand_id, f.user_id::text uid, f.net, f.big_blind bb, f.effective_stack_bb_at_deal eff,
         f.players_dealt dealt, f.ev_net
  from public.ca_hand_facts f
  where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz and f.game_variant = 'nlh'
    and f.tournament_id is not null and f.was_all_in and f.all_in_street = 'preflop'
    and f.effective_stack_bb_at_deal > 15 and f.effective_stack_bb_at_deal <= 30
    and f.position not in ('SB', 'BB')
    and exists (select 1 from public.profiles p where p.id = f.user_id and p.is_horse)
),
a as (
  select f.*, x.ord, x.e->>'userId' who, x.e->>'action' act, x.e->>'origin' origin
  from f join public.hand_history h on h.id = f.hand_id
  cross join lateral jsonb_array_elements(h.actions) with ordinality x(e, ord)
  where x.e->>'stage' = 'preflop' and x.e->>'action' in ('raise', 'all_in', 'call', 'bet')
),
s as (
  select hand_id, uid, net, bb, eff, dealt, ev_net,
    array_agg(who order by ord) ws, array_agg(act order by ord) acts, array_agg(origin order by ord) og
  from a group by 1, 2, 3, 4, 5, 6, 7
),
spot as (
  select s.*, ws[1] opener from s
  where acts[1] = 'raise' and ws[2] = uid and acts[2] = 'all_in' and og[2] = 'horse_policy'
)
select coalesce(cf.position, '?') opener_pos,
  case when spot.dealt <= 3 then 'd<=3' when spot.dealt <= 6 then 'd4-6' else 'd7+' end tsize,
  case when spot.eff <= 20 then '15-20' when spot.eff <= 25 then '20-25' else '25-30' end depth,
  count(*) n, round(avg(spot.net / spot.bb), 1) mean_net_bb, round(avg(spot.ev_net / spot.bb), 1) mean_ev_bb,
  round((stddev(spot.ev_net / spot.bb) / sqrt(count(*)))::numeric, 1) se_ev,
  count(spot.ev_net) n_ev, round(sum(spot.ev_net / spot.bb), 3) sum_ev_bb,
  round(sum((spot.ev_net / spot.bb) ^ 2), 3) sum_sq_ev_bb, round(sum(spot.net / spot.bb), 3) sum_net_bb
from spot left join public.ca_hand_facts cf on cf.hand_id = spot.hand_id and cf.user_id::text = spot.opener
group by 1, 2, 3 order by 2, 3, 1;
