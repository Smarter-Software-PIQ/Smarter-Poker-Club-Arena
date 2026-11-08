-- V31 human replay: EXTRACT one keyset page of NLH hands that had a person
-- seated and at least one postflop horse decision. One row per hand with one
-- jsonb column `hand`, in exactly the shape complaint-extract.sql returns (so
-- HorseComplaintReplay.stateAt rebuilds the public state at every horse
-- decision): table, format, blinds, button, board, the seated players (seat,
-- user id, is_horse; no names), the horses' own hole cards (ca_hand_facts,
-- else hand_history; a person's cards are never returned), every recorded
-- action with its ordinal `ord` and public snapshot `publicNode`, and every
-- seat's result. Pages are ordered by (created_at, id); pass the last row's
-- createdAt/handId as :AFTER_CREATED/:AFTER_ID for the next page. Read-only
-- (one SELECT). Rendered and run by scripts/horse-measure/v31-human-replay-fetch.mjs.
with page as (
  select h.id, h.created_at from public.hand_history h
  where h.has_human
    and h.game_variant = 'nlh'
    and h.created_at >= :SINCE
    and h.created_at < :UNTIL
    and (h.created_at, h.id) > (:AFTER_CREATED, :AFTER_ID)
    and exists (select 1 from jsonb_array_elements(h.actions) e
                where e->>'origin' = 'horse_policy' and e->>'stage' in ('flop', 'turn', 'river'))
  order by h.created_at, h.id
  limit :LIMIT
)
select jsonb_build_object(
  'handId', h.id, 'tableId', h.table_id, 'tournamentId', h.tournament_id, 'variant', h.game_variant,
  'handNumber', h.hand_number, 'createdAt', h.created_at, 'hasHuman', h.has_human,
  'bigBlind', h.big_blind, 'smallBlind', h.small_blind, 'buttonSeat', h.button_seat,
  'board', h.board, 'bombPot', h.bomb_pot is not null, 'runItTwice', h.community_cards2 is not null,
  'players', (select coalesce(jsonb_agg(jsonb_build_object('seat', (pl->>'seat')::int, 'userId', pl->>'userId',
                'isHorse', coalesce(p.is_horse, false)) order by (pl->>'seat')::int), '[]'::jsonb)
              from jsonb_array_elements(h.players) pl
              left join public.profiles p on p.id = case when pl->>'userId' ~ '^[0-9a-f-]{36}$' then (pl->>'userId')::uuid end),
  'horseHoleCards', (select coalesce(jsonb_object_agg(k.uid, k.cards), '{}'::jsonb) from (
                      select pl->>'userId' uid,
                        coalesce((select f.hole_cards from public.ca_hand_facts f where f.hand_id = h.id and f.user_id = p.id),
                                 h.hole_cards->(pl->>'userId')) cards
                      from jsonb_array_elements(h.players) pl
                      join public.profiles p on p.id = case when pl->>'userId' ~ '^[0-9a-f-]{36}$' then (pl->>'userId')::uuid end
                      where p.is_horse) k where k.cards is not null),
  'actions', (select coalesce(jsonb_agg((x.e - 'observationIdentity') || jsonb_build_object('ord', x.o) order by x.o), '[]'::jsonb)
              from jsonb_array_elements(h.actions) with ordinality x(e, o)),
  'results', (select coalesce(jsonb_agg(jsonb_build_object('userId', f.user_id, 'seat', f.seat, 'position', f.position,
                'net', f.net, 'netBb', f.net_bb) order by f.seat), '[]'::jsonb)
              from public.ca_hand_facts f where f.hand_id = h.id)
) hand
from page pg join public.hand_history h on h.id = pg.id
order by pg.created_at, pg.id
