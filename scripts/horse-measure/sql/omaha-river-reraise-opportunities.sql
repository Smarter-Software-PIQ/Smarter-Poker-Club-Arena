-- Horse release verification: V84 DENOMINATOR (2026-11-07). Every horse
-- PLO4 / PLO5 / PLO6 river DECISION facing a raise after the same horse had
-- already bet or raised that river, whatever it did: fold, call, re-raise or
-- all-in. Nothing is filtered by size, table, event or depth here; every
-- exclusion is a column so the reader can reconcile what each one drops.
-- Candidate hands come from ca_hand_facts (aggressive_actions_river > 0: the
-- horse bet or raised the river); the decision is read from hand_history.
-- One JSON array per decision:
-- [hand_id, variant, tournament 0/1, hole (compact), board, action
--  (fold / call / raise / all_in_call / all_in_raise), wager / pot before it
--  (null when the raiser cannot be found), effective bb, decision EV bb (net +
--  chips already invested at the node, over bb; a split pot's partial return
--  is inside net), live players, seats dealt, bounty event, chop (the horse
--  shared a pot award), run-it-twice, chips to call (capped at the stack),
--  pot at the node, the raiser's action (raise / all_in), the raiser was all
--  in, the showdown winner's hand (name and description), the horse's net bb]
-- Keep each call to about 12 hours. Read-only (one SELECT).
with cand as (
  select f.hand_id, f.user_id::text uid, f.net, f.hole_cards, f.game_variant v
  from public.ca_hand_facts f
  where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz
    and f.game_variant in ('plo4', 'plo5', 'plo6')
    and coalesce(f.aggressive_actions_river, 0) > 0
    and exists (select 1 from public.profiles p where p.id = f.user_id and p.is_horse)
),
j as (
  select cand.*, h.tournament_id, h.big_blind bb, h.actions, h.pots, h.showdown, h.rit_boards
  from cand join public.hand_history h on h.id = cand.hand_id
  where h.bomb_pot is null and h.community_cards2 is null
),
sp as (
  select j.*, a.ord, a.e->'publicNode' pn, a.e->>'stage' street, a.e->>'action' act, (a.e->>'amount')::numeric amt
  from j cross join lateral jsonb_array_elements(j.actions) with ordinality a(e, ord)
  where a.e->>'userId' = j.uid and a.e->>'origin' = 'horse_policy' and a.e->>'stage' = 'river'
    and (a.e->'publicNode'->>'toCall')::numeric > 0
    and exists (select 1 from jsonb_array_elements(j.actions) with ordinality p(e3, o3)
                where p.o3 < a.ord and p.e3->>'stage' = 'river' and p.e3->>'userId' = j.uid
                  and p.e3->>'action' in ('bet', 'raise', 'all_in'))
),
s as (
  select sp.*,
    (select s from jsonb_array_elements(sp.pn->'seats') s where (s->>0)::int = (sp.pn->>'actorSeat')::int) hs,
    (select count(*) from jsonb_array_elements(sp.pn->'seats') s where s->>6 in ('0', '2')) n_active,
    jsonb_array_length(sp.pn->'seats') seats_n,
    coalesce((select (tt.is_bounty or tt.is_pko or tt.is_mystery_bounty) from public.tournaments tt where tt.id = sp.tournament_id), false) bounty,
    exists (select 1 from jsonb_array_elements(coalesce(sp.pots, '[]')) pt where jsonb_array_length(pt->'awards') > 1
            and exists (select 1 from jsonb_array_elements(pt->'awards') aw where aw->>'userId' = sp.uid)) chop,
    b.wager, b.pot_before, b.bseat, b.bact
  from sp
  left join lateral (
     select (x.e2->'publicNode'->>'actorSeat')::int bseat, x.e2->>'action' bact,
            (x.e2->>'amount')::numeric - coalesce((select (s->>2)::numeric from jsonb_array_elements(x.e2->'publicNode'->'seats') s
                                                   where (s->>0)::int = (x.e2->'publicNode'->>'actorSeat')::int), 0) wager,
            (x.e2->'publicNode'->>'pot')::numeric pot_before
     from jsonb_array_elements(sp.actions) with ordinality x(e2, o2)
     where x.o2 < sp.ord and x.e2->>'stage' = sp.street and x.e2->>'action' in ('bet', 'raise', 'all_in')
       and (x.e2->>'amount')::numeric = (sp.pn->>'currentBet')::numeric
     order by x.o2 desc limit 1) b on true
)
select coalesce(jsonb_agg(jsonb_build_array(
  hand_id, v, case when tournament_id is null then 0 else 1 end,
  (select string_agg((c->>'rank') || left(c->>'suit', 1), '' order by o) from jsonb_array_elements(hole_cards) with ordinality hc(c, o)),
  pn->'boards'->>0,
  case when act = 'all_in' and amt <= (pn->>'currentBet')::numeric then 'all_in_call'
       when act = 'all_in' then 'all_in_raise' else act end,
  case when wager > 0 and pot_before > 0 then round(wager / pot_before, 3) end,
  round(least((hs->>1)::numeric + (hs->>2)::numeric,
        (select (s2->>1)::numeric + (s2->>2)::numeric from jsonb_array_elements(pn->'seats') s2 where (s2->>0)::int = bseat)) / bb, 1),
  round((net + (hs->>3)::numeric) / bb, 2), n_active, seats_n, bounty, chop, rit_boards is not null,
  least((pn->>'toCall')::numeric, (hs->>1)::numeric), (pn->>'pot')::numeric, bact,
  (select s3->>6 = '2' from jsonb_array_elements(pn->'seats') s3 where (s3->>0)::int = bseat),
  (select string_agg((sd->>'hand_name') || ' ' || coalesce(sd->>'hand_description', ''), '; ' order by (sd->>'reveal_order')::int)
     from jsonb_array_elements(coalesce(showdown, '[]')) sd where sd->>'user_id' <> uid and not coalesce((sd->>'mucked')::boolean, false)),
  round(net / bb, 2)
  ) order by hand_id, ord), '[]'::jsonb) rows
from s
