-- Hold'em late-street priors (holdemLateStreetIsPriced): one row per NLH hand in [:FROM, :TO) with a turn or river
-- wager, its tournament flag and a slim action list (stage, action, amount, acting user, origin, and from the public
-- snapshot the pot, toCall and the count of players not folded before the action). No hole card, no name. Read-only.
select h.id, h.tournament_id is not null as tourn,
  (select jsonb_agg(jsonb_build_object(
      's', a->>'stage', 'a', a->>'action', 'm', (a->>'amount')::numeric, 'u', a->>'userId', 'o', a->>'origin',
      'p', (a->'publicNode'->>'pot')::numeric, 't', (a->'publicNode'->>'toCall')::numeric,
      'n', (select count(*) from jsonb_array_elements(a->'publicNode'->'seats') x where coalesce((x->>6)::int, 0) = 0))
    order by o) from jsonb_array_elements(h.actions) with ordinality q(a, o)) as acts
from public.hand_history h
where h.created_at >= ':FROM' and h.created_at < ':TO' and h.game_variant = 'nlh' and h.bomb_pot is null
  and exists (select 1 from jsonb_array_elements(h.actions) x where x->>'stage' in ('turn', 'river') and x->>'action' in ('bet', 'raise', 'all_in'))
