// SQL for the Omaha hand audit. SELECT only. Hole cards leave the database ONLY for players the hand's showdown list
// records as not mucked (the shown-cards-only rule): the hc column is built by walking h.showdown and skipping every
// entry whose mucked flag is true. No other column carries hole cards.
//
// With `limit` the SELECT is one keyset page (../horse-audit-paged-read.mjs): rows after the `after` cursor in
// (created_at, id) order, at most `limit` of them, so no statement reads an unbounded hour of hands.
import { keysetSql } from '../horse-audit-paged-read.mjs';
import { PLAYER_PROFILE_ID } from '../horse-hand-audit-holdem-lib.mjs';

export function auditSql({
  from,
  to,
  games = ['plo4', 'plo5'],
  peopleOnly = true,
  after = null,
  limit = null,
}) {
  const page = limit === null ? null : keysetSql(after, { limit });
  const iso = (d) => new Date(d).toISOString();
  const g = games.map((x) => `'${String(x).replace(/[^a-z0-9]/g, '')}'`).join(',');
  return `select h.id, h.created_at, h.game_variant gv, h.big_blind bb, h.button_seat btn, h.engine_build build,
 h.has_human hh, h.rake_amount rake, h.bbj_amount bbj, h.pot_size pot, h.table_id tid,
 h.community_cards cc, h.community_cards2 cc2, h.rit_boards rit, (h.bomb_pot is not null) bomb,
 (select jsonb_agg(jsonb_build_array(p->'seat', p->>'userId', p->'stack', p->>'username',
    coalesce((select pr.is_horse from profiles pr where pr.id = ${PLAYER_PROFILE_ID('p')}), false)))
    from jsonb_array_elements(h.players) p) pl,
 (select jsonb_agg(jsonb_build_array(a->'seat', a->>'stage', a->>'action', a->'amount', a->>'origin', a->'dead',
    a->'publicNode'->'pot', a->'publicNode'->'toCall', a->>'userId') order by o)
    from jsonb_array_elements(h.actions) with ordinality t(a, o)) ac,
 (select jsonb_agg(jsonb_build_object('userId', w->>'userId', 'amount', w->'amount', 'potIndex', w->'potIndex'))
    from jsonb_array_elements(case when jsonb_typeof(h.winners) = 'array' then h.winners else '[]'::jsonb end) w) w,
 (select jsonb_agg(jsonb_build_object('amount', p->'amount', 'eligible', p->'eligible')) from jsonb_array_elements(case when jsonb_typeof(h.pots) = 'array' then h.pots else '[]'::jsonb end) p) pots,
 (select jsonb_agg(jsonb_build_array(s->'seat', s->>'user_id', coalesce((s->>'mucked')::boolean, false)))
    from jsonb_array_elements(case when jsonb_typeof(h.showdown) = 'array' then h.showdown else '[]'::jsonb end) s) sd,
 (select jsonb_object_agg(s->>'user_id', h.hole_cards -> (s->>'user_id'))
    from jsonb_array_elements(case when jsonb_typeof(h.showdown) = 'array' then h.showdown else '[]'::jsonb end) s
    where coalesce((s->>'mucked')::boolean, false) = false
      and jsonb_typeof(h.hole_cards) = 'object' and h.hole_cards ? (s->>'user_id')) hc
from hand_history h
where h.created_at >= '${iso(from)}' and h.created_at < '${iso(to)}'
  and h.tournament_id is null and h.game_variant in (${g})${
    peopleOnly
      ? `
  and h.has_human = true
  and exists (select 1 from jsonb_array_elements(h.players) p2 join profiles pr2 on pr2.id = ${PLAYER_PROFILE_ID('p2')}
              where pr2.is_horse = false)`
      : ''
  }${page ? `\n  ${page.where}` : ''}
${page ? page.order : 'order by h.created_at'}`;
}
