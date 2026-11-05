-- Horse complaint pipeline: EXTRACT one hand (Phase 5.3). Given a hand id, or
-- a table id plus a moment, returns ONE row with ONE jsonb column `hand`:
-- the hand's table, format, blinds, button, board, the seated players (seat,
-- user id, is_horse; no names), the horses' own hole cards (ca_hand_facts,
-- else hand_history; a person's cards are never returned), every recorded
-- action in order with its ordinal `ord` and the public table snapshot the
-- engine recorded at each horse decision (`publicNode`), and every seat's
-- result. For table + time the hand whose start/end brackets the moment wins,
-- else the nearest within 30 minutes; `nearby` lists up to 6 hands on that
-- table around the moment so the right one can be chosen. Feed the row to
-- scripts/horse-measure/horse-complaint-replay.ts. Read-only (one SELECT).
with pick as (
  select h.id from public.hand_history h
  where :PICK
  order by :ORDER
  limit 1
),
near as (
  select coalesce(jsonb_agg(jsonb_build_object('handId', n.id, 'handNumber', n.hand_number, 'createdAt', n.created_at) order by n.created_at), '[]'::jsonb) j
  from (select h.id, h.hand_number, h.created_at from public.hand_history h
        where :NEAR order by :ORDER limit 6) n
)
select jsonb_build_object(
  'handId', h.id, 'tableId', h.table_id, 'tournamentId', h.tournament_id, 'variant', h.game_variant,
  'handNumber', h.hand_number, 'createdAt', h.created_at, 'startedAt', h.started_at, 'endedAt', h.ended_at,
  'hasHuman', h.has_human, 'bigBlind', h.big_blind, 'smallBlind', h.small_blind, 'buttonSeat', h.button_seat,
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
              from public.ca_hand_facts f where f.hand_id = h.id),
  'nearby', (select j from near)
) hand
from public.hand_history h where h.id = (select id from pick)
