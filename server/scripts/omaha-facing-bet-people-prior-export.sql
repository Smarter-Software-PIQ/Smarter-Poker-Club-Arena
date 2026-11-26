-- Read-only export for omaha-facing-bet-people-prior-fit.ts (PLO4/PLO5 cash, people only).
-- One row per PLO4/PLO5 cash hand with a person seated (folds and calls need every hand, not only showdowns).
-- Players carry is_horse; the cards exported are ONLY those of people who showed (mucked = false): no Horse cards,
-- no mucked or folded cards, no HUD population rows. Parameters: :from / :to (ISO timestamps).
select jsonb_build_object(
  'id', h.id, 'gv', h.game_variant, 'bb', h.big_blind, 'cc', h.community_cards,
  'players', (select jsonb_agg(jsonb_build_object('seat', (pl->>'seat')::int, 'userId', pl->>'userId',
                'isHorse', coalesce(p.is_horse, true)) order by (pl->>'seat')::int)
              from jsonb_array_elements(h.players) pl
              left join public.profiles p on p.id::text = pl->>'userId'),
  'actions', (select jsonb_agg(jsonb_build_object('seat', a->'seat', 'stage', a->>'stage', 'action', a->>'action',
                'amount', a->'amount', 'origin', a->>'origin', 'dead', a->'dead',
                'pot', a->'publicNode'->'pot', 'toCall', a->'publicNode'->'toCall') order by o)
              from jsonb_array_elements(h.actions) with ordinality t(a, o)),
  'shown', (select jsonb_object_agg(s->>'user_id', h.hole_cards -> (s->>'user_id'))
            from jsonb_array_elements(case when jsonb_typeof(h.showdown) = 'array' then h.showdown else '[]'::jsonb end) s
            join public.profiles p on p.id::text = s->>'user_id'
            where coalesce((s->>'mucked')::boolean, false) = false and coalesce(p.is_horse, true) = false
              and jsonb_typeof(h.hole_cards) = 'object' and h.hole_cards ? (s->>'user_id'))
) as hand
from public.hand_history h
where h.created_at >= :from and h.created_at < :to
  and h.tournament_id is null and h.bomb_pot is null and h.kill_pot is null and h.has_human
  and h.game_variant in ('plo4', 'plo5')
  and coalesce(cardinality(h.community_cards2), 0) = 0
order by h.created_at;
