-- Horse release verification: OMAHA FULL HOUSES RAISED AFTER THE HORSE'S OWN
-- AGGRESSION (2026-11-07, the V15 boats evidence). Every horse PLO decision
-- (flop / turn / river, any Omaha variant) that faces a bet after the horse
-- bet or raised THIS street and another player then raised over it
-- (a raise, or an all-in above the bet it faced): the exact read of the
-- engine's raisedAfterAggr. Folds are kept for counts. One JSON array per
-- decision: [hand_id, variant, street, format (cash | tour | light | hu),
-- hole cards (as a board string), board at the decision, action, decision EV bb (net + chips
-- already invested at the node, over bb: the continuation's value against
-- folding there, chops at their fractional return, later streets included),
-- live players, seats dealt, bounty event, chop, effective bb, to_call over
-- the horse's stack]. Feed the files to
-- scripts/horse-measure/omaha-boat-cells.ts (classifies with the engine's
-- own omahaBoatsAbove / omahaBoatDominated and prints hand-clustered CIs).
-- Keep each slice to about 2 hours. Read-only (one SELECT).
with cand as (
  select f.hand_id, f.user_id::text uid, f.net, f.hole_cards, f.game_variant v, f.players_dealt
  from public.ca_hand_facts f
  where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz
    and f.game_variant like 'plo%'
    and f.saw_flop
    and coalesce(f.aggressive_actions_flop, 0) + coalesce(f.aggressive_actions_turn, 0)
        + coalesce(f.aggressive_actions_river, 0) > 0
    and exists (select 1 from public.profiles p where p.id = f.user_id and p.is_horse)
),
j as (
  select cand.*, h.tournament_id, h.big_blind bb, h.actions, h.pots,
    exists (select 1 from public.lightning_hand lh where lh.hand_id = cand.hand_id) light
  from cand join public.hand_history h on h.id = cand.hand_id
  where h.bomb_pot is null and h.community_cards2 is null
),
ev as (
  select j.*, a.ord, a.e
  from j cross join lateral jsonb_array_elements(j.actions) with ordinality a(e, ord)
  where a.e->>'stage' in ('flop', 'turn', 'river')
),
sp as (
  select d.*, d.e->'publicNode' pn, d.e->>'stage' street, d.e->>'action' act
  from ev d
  where d.e->>'userId' = d.uid and d.e->>'origin' = 'horse_policy'
    and d.e->>'action' in ('call', 'raise', 'all_in', 'fold')
    and (d.e->'publicNode'->>'toCall')::numeric > 0
    and exists (
      select 1 from jsonb_array_elements(d.actions) with ordinality h1(e1, o1)
      where h1.o1 < d.ord and h1.e1->>'stage' = d.e->>'stage' and h1.e1->>'userId' = d.uid
        and (h1.e1->>'action' in ('bet', 'raise')
             or (h1.e1->>'action' = 'all_in'
                 and (h1.e1->>'amount')::numeric > coalesce((h1.e1->'publicNode'->>'currentBet')::numeric, 0)))
        and exists (
          select 1 from jsonb_array_elements(d.actions) with ordinality h2(e2, o2)
          where h2.o2 > h1.o1 and h2.o2 < d.ord and h2.e2->>'stage' = d.e->>'stage'
            and h2.e2->>'userId' <> d.uid
            and (h2.e2->>'action' = 'raise'
                 or (h2.e2->>'action' = 'all_in'
                     and (h2.e2->>'amount')::numeric > coalesce((h2.e2->'publicNode'->>'currentBet')::numeric, 0)))))
),
s as (
  select sp.hand_id, sp.v, sp.street, sp.act, sp.bb, sp.net, sp.hole_cards, sp.players_dealt,
    case when sp.light then 'light' when sp.tournament_id is not null then 'tour'
         when sp.players_dealt = 2 then 'hu' else 'cash' end fmt,
    sp.pn->'boards'->>0 board,
    (select s from jsonb_array_elements(sp.pn->'seats') s where (s->>0)::int = (sp.pn->>'actorSeat')::int) hs,
    (select count(*) from jsonb_array_elements(sp.pn->'seats') s where s->>6 in ('0', '2')) n_active,
    jsonb_array_length(sp.pn->'seats') seats_n,
    coalesce((select (tt.is_bounty or tt.is_pko or tt.is_mystery_bounty) from public.tournaments tt where tt.id = sp.tournament_id), false) bounty,
    exists (select 1 from jsonb_array_elements(coalesce(sp.pots, '[]')) pt where jsonb_array_length(pt->'awards') > 1
            and exists (select 1 from jsonb_array_elements(pt->'awards') aw where aw->>'userId' = sp.uid)) chop,
    sp.pn
  from sp
)
select coalesce(jsonb_agg(jsonb_build_array(
  left(hand_id::text, 8), v, street, fmt,
  (select string_agg((c->>'rank') || left(c->>'suit', 1), '' order by o) from jsonb_array_elements(hole_cards) with ordinality x(c, o)),
  board, act,
  case when act = 'fold' then 0 else round((net + (hs->>3)::numeric) / bb, 2) end,
  n_active, seats_n, bounty, chop,
  round(((hs->>1)::numeric + (hs->>2)::numeric) / bb, 1),
  round((pn->>'toCall')::numeric / nullif((hs->>1)::numeric, 0), 3))), '[]'::jsonb) rows
from s
-- A full house needs a paired board, and the horse must be able to make one
-- (two hole cards and three board cards whose ranks fall 3 + 2). The
-- classifier decides dominance with the engine's own evaluator.
where (select count(distinct substr(board, i, 1)) from generate_series(1, length(board), 2) i) < length(board) / 2
  and exists (
    select 1
    from (select array_agg(c->>'rank' order by o) r from jsonb_array_elements(hole_cards) with ordinality x(c, o)) hr,
         (select array_agg(substr(board, i, 1) order by i) r from generate_series(1, length(board), 2) i) br,
         generate_series(1, 8) i, generate_series(1, 8) j,
         generate_series(1, 5) a, generate_series(1, 5) b, generate_series(1, 5) c
    where i < j and j <= cardinality(hr.r) and a < b and b < c and c <= cardinality(br.r)
      and (select array_agg(n order by n) from (select count(*) n from unnest(array[hr.r[i], hr.r[j], br.r[a], br.r[b], br.r[c]]) u(k) group by k) z) = array[2, 3]::bigint[])
