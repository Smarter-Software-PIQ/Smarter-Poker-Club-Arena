-- Horse release verification: OMAHA RIVER CALLS AFTER THE HORSE'S OWN RIVER
-- BET OR RAISE (2026-11-07, the call side of V81). Every horse PLO4 / PLO5 /
-- PLO6 river CALL of a raise, made after the same horse had already bet or
-- raised that river (the spot V81 leaves out with heroHasStreetChips). Same
-- row shape and EV definition as omaha-calls.sql, so omaha-call-cells.ts reads
-- it unchanged: [hand_id, variant, street, tournament 0/1, hole cards, board at
-- the decision, wager / pot before it, effective bb, call EV bb (net + chips
-- already invested at the node, over bb), live players, seats dealt, bounty
-- event, chop]; the hole cards come as one compact string ("Kd4d...", the
-- board's own format) to keep the result small. The wager is the chips the last raiser ADDED, over the pot just
-- before that raise (v81StreetWager). Keep each call to about 6 hours.
-- Read-only (one SELECT).
with cand as (
  select f.hand_id, f.user_id::text uid, f.net, f.hole_cards, f.game_variant v
  from public.ca_hand_facts f
  where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz
    and f.game_variant in ('plo4', 'plo5', 'plo6')
    and coalesce(f.passive_actions_river, 0) > 0
    and exists (select 1 from public.profiles p where p.id = f.user_id and p.is_horse)
),
j as (
  select cand.*, h.tournament_id, h.big_blind bb, h.actions, h.pots
  from cand join public.hand_history h on h.id = cand.hand_id
  where h.bomb_pot is null and h.community_cards2 is null
),
sp as (
  select j.*, a.ord, a.e->'publicNode' pn, a.e->>'stage' street, a.e->>'action' act
  from j cross join lateral jsonb_array_elements(j.actions) with ordinality a(e, ord)
  where a.e->>'userId' = j.uid and a.e->>'origin' = 'horse_policy' and a.e->>'stage' = 'river'
    and a.e->>'action' in ('call', 'all_in')
    and (a.e->'publicNode'->>'toCall')::numeric > 0
    and (a.e->>'action' = 'call' or (a.e->>'amount')::numeric <= (a.e->'publicNode'->>'currentBet')::numeric)
    and exists (select 1 from jsonb_array_elements(j.actions) with ordinality p(e3, o3)
                where p.o3 < a.ord and p.e3->>'stage' = 'river' and p.e3->>'userId' = j.uid
                  and p.e3->>'action' in ('bet', 'raise', 'all_in'))
),
s as (
  select sp.hand_id, sp.v, sp.street, sp.bb, sp.net, sp.hole_cards, sp.tournament_id, sp.pn->'boards'->>0 board,
    (select s from jsonb_array_elements(sp.pn->'seats') s where (s->>0)::int = (sp.pn->>'actorSeat')::int) hs,
    (select count(*) from jsonb_array_elements(sp.pn->'seats') s where s->>6 in ('0', '2')) n_active,
    jsonb_array_length(sp.pn->'seats') seats_n,
    coalesce((select (tt.is_bounty or tt.is_pko or tt.is_mystery_bounty) from public.tournaments tt where tt.id = sp.tournament_id), false) bounty,
    exists (select 1 from jsonb_array_elements(coalesce(sp.pots, '[]')) pt where jsonb_array_length(pt->'awards') > 1
            and exists (select 1 from jsonb_array_elements(pt->'awards') aw where aw->>'userId' = sp.uid)) chop,
    b.wager, b.pot_before, b.bseat, sp.pn
  from sp
  cross join lateral (
     select (x.e2->'publicNode'->>'actorSeat')::int bseat,
            (x.e2->>'amount')::numeric - coalesce((select (s->>2)::numeric from jsonb_array_elements(x.e2->'publicNode'->'seats') s
                                                   where (s->>0)::int = (x.e2->'publicNode'->>'actorSeat')::int), 0) wager,
            (x.e2->'publicNode'->>'pot')::numeric pot_before
     from jsonb_array_elements(sp.actions) with ordinality x(e2, o2)
     where x.o2 < sp.ord and x.e2->>'stage' = sp.street and x.e2->>'action' in ('bet', 'raise', 'all_in')
       and (x.e2->>'amount')::numeric = (sp.pn->>'currentBet')::numeric
     order by x.o2 desc limit 1) b
)
select coalesce(jsonb_agg(jsonb_build_array(
  hand_id, v, street, case when tournament_id is null then 0 else 1 end,
  (select string_agg((c->>'rank') || left(c->>'suit', 1), '' order by o) from jsonb_array_elements(hole_cards) with ordinality hc(c, o)),
  board,
  round(wager / nullif(pot_before, 0), 3),
  round(least((hs->>1)::numeric + (hs->>2)::numeric,
        (select (s2->>1)::numeric + (s2->>2)::numeric from jsonb_array_elements(pn->'seats') s2 where (s2->>0)::int = bseat)) / bb, 1),
  round((net + (hs->>3)::numeric) / bb, 2), n_active, seats_n, bounty, chop)), '[]'::jsonb) rows
from s where wager > 0 and pot_before > 0
