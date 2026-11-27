select jsonb_build_object(
 'id', h.id, 't', h.created_at, 'gv', h.game_variant, 'bb', h.big_blind, 'btn', h.button_seat,
 'cc', h.community_cards, 'pot', h.pot_size, 'rake', h.rake_amount, 'build', h.engine_build,
 'pl', (select jsonb_agg(jsonb_build_array((pl->>'seat')::int, pl->>'userId', coalesce(p.is_horse,false)) order by (pl->>'seat')::int)
        from jsonb_array_elements(h.players) pl
        left join public.profiles p on p.id = case when pl->>'userId' ~ '^[0-9a-f-]{36}$' then (pl->>'userId')::uuid end),
 'sd', h.showdown,
 'hc', (select jsonb_object_agg(coalesce(s->>'userId', s->>'user_id'), h.hole_cards->(coalesce(s->>'userId', s->>'user_id')))
        from jsonb_array_elements(h.showdown) s where coalesce((s->>'mucked')::boolean, true) = false and h.hole_cards ? (coalesce(s->>'userId', s->>'user_id'))),
 'hh', (select jsonb_object_agg(coalesce(s->>'userId', s->>'user_id'), h.hole_cards->(coalesce(s->>'userId', s->>'user_id')))
        from jsonb_array_elements(h.showdown) s join public.profiles p on p.id = case when coalesce(s->>'userId', s->>'user_id') ~ '^[0-9a-f-]{36}$' then (coalesce(s->>'userId', s->>'user_id'))::uuid end
        where p.is_horse and h.hole_cards ? (coalesce(s->>'userId', s->>'user_id'))),
 'win', h.winners,
 'ac', (select jsonb_agg(jsonb_build_array((e->>'seat')::int, e->>'stage', e->>'action', (e->>'amount')::numeric, e->'dead', e->>'origin',
          e->'publicNode'->'pot', e->'publicNode'->'toCall', e->'publicNode'->'seats') order by o)
        from jsonb_array_elements(h.actions) with ordinality x(e,o))
) hand
from public.hand_history h
where h.has_human and h.tournament_id is null and h.game_variant in ('plo4','plo5')
  and h.created_at >= :from and h.created_at < :to
  and h.bomb_pot is null and h.community_cards2 is null
  and jsonb_typeof(h.showdown) = 'array'
  and exists (select 1 from jsonb_array_elements(h.showdown) s where coalesce((s->>'mucked')::boolean, true) = false)
