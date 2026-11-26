with h as (
  select id, big_blind, created_at, actions, showdown, hole_cards
  from hand_history
  where tournament_id is not null and game_variant = 'nlh'
    and created_at >= '__FROM__'::timestamptz and created_at < '__TO__'::timestamptz
), a as (
  select h.id, h.big_blind, x.ord, x.v
  from h, jsonb_array_elements(h.actions) with ordinality as x(v, ord)
  where x.v->>'stage' = 'preflop' and x.v ? 'publicNode'
), r as (
  select a.id, a.big_blind, a.ord,
    jsonb_build_array(
      (a.v->>'seat')::int, a.v->>'action', (a.v->>'amount')::numeric,
      (select (e->>1)::numeric from jsonb_array_elements(a.v->'publicNode'->'seats') e where (e->>0)::int = (a.v->>'seat')::int),
      (select (e->>2)::numeric from jsonb_array_elements(a.v->'publicNode'->'seats') e where (e->>0)::int = (a.v->>'seat')::int),
      (a.v->'publicNode'->>'currentBet')::numeric,
      (select count(*) from jsonb_array_elements(a.v->'publicNode'->'seats') e where (e->>0)::int <> (a.v->>'seat')::int and (e->>6)::int = 0),
      (select max((e->>1)::numeric + (e->>2)::numeric) from jsonb_array_elements(a.v->'publicNode'->'seats') e where (e->>0)::int <> (a.v->>'seat')::int and (e->>6)::int in (0,2)),
      (a.v->'publicNode'->>'allInOrFold')::boolean,
      (a.v->'publicNode'->>'ante')::numeric,
      jsonb_array_length(a.v->'publicNode'->'seats'),
      a.v->'publicNode'->'tournamentStage'->>'format',
      (a.v->'publicNode'->'tournamentStage'->>'nearBubble')::boolean,
      (a.v->'publicNode'->>'dealerSeat')::int,
      (a.v->'publicNode'->>'pot')::numeric
    ) as row
  from a
)
select json_build_object('id', h.id, 'bb', h.big_blind,
  'acts', (select jsonb_agg(r.row order by r.ord) from r where r.id = h.id),
  'shown', (select jsonb_object_agg(s->>'seat', h.hole_cards->(s->>'user_id')) from jsonb_array_elements(coalesce(h.showdown, '[]'::jsonb)) s where (s->>'mucked')::boolean is not true and h.hole_cards ? (s->>'user_id'))
) as j
from h
