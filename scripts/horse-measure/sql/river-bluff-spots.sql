-- River bluff live report: SPOTS. Every horse river decision with nothing to
-- call (publicNode.toCall = 0, origin horse_policy) in [:START, :END), the
-- exact population of the 2026-11-07 pre-release baseline (nlh 29.5% bet of
-- 4,328 in [06:00, 08:00) UTC). A "bet" is bet, raise or all_in, as in that
-- baseline.
--
-- Returns ONE row with ONE jsonb column `report`: { window, cells } where each
-- cell is one combination of
--   v     game_variant (nlh, short_deck, flh, plo4, plo5, plo6, plo8, flo8)
--   fmt   cash | tour
--   ways  hu (one live opponent) | mw (two or more) | none
--   line  checked_to (an opponent checked this river first) | first (first to act)
--   gt    std | bomb | multi (bomb pot, or more than one board)
--   style opponent style bucket from PUBLIC stats (heads-up only): the
--         opponent's last 300 hands in the 3 days before :START from
--         ca_hand_facts (VPIP, and WTSD = went to showdown when it saw a
--         flop), first match wins: unknown (< 30 hands), station
--         (WTSD >= 0.62), folder (WTSD < 0.30), nit (VPIP < 0.21), loose
--         (VPIP >= 0.33), regular; multiway spots are 'multiway'. The cuts
--         are the measured fleet quartiles/deciles of 198 river players,
--         2026-11-04 06:00 to 11-07 06:00 UTC: WTSD p10 0.29, p25 0.38,
--         p50 0.48, p75 0.62, p90 0.71; VPIP p10 0.21, p50 0.26, p90 0.33.
--   who   human | horse (heads-up opponent), any_human | all_horse (multiway).
--         DATA IDENTIFICATION ONLY (CLAUDE.md 10.5): it splits the report and
--         never feeds a strategy.
-- and the counts
--   spots, bets, known and known_bets (hole cards recorded), air_spots, air_bets, and for the
--   bets and the air bets separately, [n, responders, folds, calls, raises,
--   sum break-even fold, sum size / pot, sum decision EV bb, sum EV bb ^ 2].
--
-- air = no pocket pair (any two hole cards of one rank), no hole rank on the
-- board, no flush (Hold'em: five of a suit across hole and board; Omaha: two
-- hole and three board), on the first board. This is #9803's definition, so
-- the air shares compare with its 12-hour measurement.
-- folds: every responder folded (nobody called or raised later on the river).
-- break-even fold: added / (pot + added), pot being publicNode.pot.
-- decision EV: (net + chips invested at the node) / bb, the chips the bet
-- won against checking and losing; for a bluff that is the pot when it gets
-- a fold and minus the bet when it is called and loses.
-- Keep each call to about 2-4 hours. Read-only (one SELECT).
with h as (
  select id, tournament_id, big_blind, game_variant v, actions, players,
         (bomb_pot is not null) bomb
  from public.hand_history
  where created_at >= :START::timestamptz and created_at < :END::timestamptz
    and big_blind > 0
),
sp as (
  select h.id, h.v, h.tournament_id, h.big_blind bb, h.bomb, h.actions, h.players, a.ord,
         a.e->>'userId' uid, a.e->>'action' act, (a.e->>'amount')::numeric amt, a.e->'publicNode' pn
  from h cross join lateral jsonb_array_elements(h.actions) with ordinality a(e, ord)
  where a.e->>'stage' = 'river' and a.e->>'origin' = 'horse_policy'
    and (a.e->'publicNode'->>'toCall')::numeric = 0
),
s1 as (
  select sp.*,
    (select s from jsonb_array_elements(sp.pn->'seats') s where (s->>0)::int = (sp.pn->>'actorSeat')::int) hs,
    (select jsonb_agg(s->>0) from jsonb_array_elements(sp.pn->'seats') s
       where (s->>0)::int <> (sp.pn->>'actorSeat')::int and ((s->>6)::int & 5) = 0) live,
    (select count(*) from jsonb_array_elements(sp.pn->'seats') s
       where (s->>0)::int <> (sp.pn->>'actorSeat')::int and ((s->>6)::int & 7) = 0 and (s->>1)::numeric > 0) responders,
    coalesce((sp.pn->>'boardCount')::int, 1) boards, sp.pn->'boards'->>0 board,
    exists (select 1 from jsonb_array_elements(sp.actions) with ordinality p(e, o)
            where p.o < sp.ord and p.e->>'stage' = 'river' and p.e->>'userId' <> sp.uid and p.e->>'action' = 'check') checked_to
  from sp
),
s2 as (
  select s1.*, jsonb_array_length(coalesce(live, '[]'::jsonb)) ways_n,
    (select array_agg(pl->>'userId') from jsonb_array_elements(s1.players) pl
       where live ? (pl->>'seat')) opp_ids,
    (select f.hole_cards from public.ca_hand_facts f where f.hand_id = s1.id and f.user_id = s1.uid::uuid) hole,
    (select f.net from public.ca_hand_facts f where f.hand_id = s1.id and f.user_id = s1.uid::uuid) net
  from s1
),
opp as (
  select distinct unnest(opp_ids) uid from s2
),
st as (
  select o.uid, count(f.*) n, avg(f.vpip::int) vpip,
         avg(f.went_to_showdown::int) filter (where f.saw_flop) wtsd,
         bool_or(coalesce(p.is_horse, false)) horse
  from opp o
  left join public.profiles p on p.id = o.uid::uuid
  left join lateral (
    select x.vpip, x.went_to_showdown, x.saw_flop from public.ca_hand_facts x
    where x.user_id = o.uid::uuid and x.played_at < :START::timestamptz
      and x.played_at >= :START::timestamptz - interval '3 days'
    order by x.played_at desc limit 300) f on true
  group by o.uid
),
s3 as (
  select s2.*,
    case when ways_n = 1 then (select case when st.n < 30 then 'unknown' when st.wtsd >= 0.62 then 'station'
                                          when st.wtsd < 0.30 then 'folder' when st.vpip < 0.21 then 'nit'
                                          when st.vpip >= 0.33 then 'loose' else 'regular' end
                               from st where st.uid = s2.opp_ids[1])
         when ways_n >= 2 then 'multiway' else 'none' end style,
    case when ways_n = 1 then (select case when st.horse then 'horse' else 'human' end from st where st.uid = s2.opp_ids[1])
         when ways_n >= 2 then (case when (select bool_and(st.horse) from st where st.uid = any (s2.opp_ids)) then 'all_horse' else 'any_human' end)
         else 'none' end who,
    case when hole is null or jsonb_typeof(hole) <> 'array' or board is null or length(board) <> 10 then null
         else not (
           (select count(distinct c->>'rank') from jsonb_array_elements(hole) c) < jsonb_array_length(hole)
           or exists (select 1 from jsonb_array_elements(hole) c
                      where position((c->>'rank') in regexp_replace(board, '[cdhs]', '', 'g')) > 0)
           or exists (select 1 from (values ('c'), ('d'), ('h'), ('s')) su(x)
                      where case when s2.v in ('plo4', 'plo5', 'plo6', 'plo8', 'flo8')
                                 then (select count(*) from jsonb_array_elements(hole) c where left(c->>'suit', 1) = su.x) >= 2
                                      and length(board) - length(replace(board, su.x, '')) >= 3
                                 else (select count(*) from jsonb_array_elements(hole) c where left(c->>'suit', 1) = su.x)
                                      + length(board) - length(replace(board, su.x, '')) >= 5 end)
         ) end air,
    (act in ('bet', 'raise', 'all_in')) is_bet,
    greatest(amt - coalesce((hs->>2)::numeric, 0), 0) added,
    (pn->>'pot')::numeric pot
  from s2
),
s4 as (
  select s3.*,
    case when is_bet then exists (select 1 from jsonb_array_elements(s3.actions) with ordinality z(e, o)
         where z.o > s3.ord and z.e->>'stage' = 'river' and z.e->>'userId' <> s3.uid
           and z.e->>'action' in ('call', 'raise', 'all_in')) end contested,
    case when is_bet then exists (select 1 from jsonb_array_elements(s3.actions) with ordinality z(e, o)
         where z.o > s3.ord and z.e->>'stage' = 'river' and z.e->>'userId' <> s3.uid
           and (z.e->>'action' = 'raise' or (z.e->>'action' = 'all_in' and (z.e->>'amount')::numeric > s3.amt))) end raised,
    case when is_bet and added > 0 then added / (pot + added) end be,
    case when is_bet and pot > 0 then added / pot end frac,
    case when is_bet and net is not null then (net + coalesce((hs->>3)::numeric, 0)) / bb end ev
  from s3
),
cell as (
  select v, case when tournament_id is null then 'cash' else 'tour' end fmt,
    case when ways_n = 1 then 'hu' when ways_n >= 2 then 'mw' else 'none' end ways,
    case when checked_to then 'checked_to' else 'first' end line,
    case when bomb then 'bomb' when boards > 1 then 'multi' else 'std' end gt,
    coalesce(style, 'unknown') style, coalesce(who, 'unknown') who,
    count(*) spots, count(*) filter (where is_bet) bets,
    count(*) filter (where air is not null) known,
    count(*) filter (where air is not null and is_bet) known_bets,
    count(*) filter (where air) air_spots, count(*) filter (where air and is_bet) air_bets,
    jsonb_build_array(count(*) filter (where is_bet), count(*) filter (where is_bet and responders > 0),
      count(*) filter (where is_bet and responders > 0 and not contested),
      count(*) filter (where is_bet and contested and not raised), count(*) filter (where is_bet and raised),
      round(coalesce(sum(be) filter (where is_bet), 0), 4), round(coalesce(sum(frac) filter (where is_bet), 0), 4),
      count(*) filter (where is_bet and ev is not null),
      round(coalesce(sum(ev) filter (where is_bet), 0), 4), round(coalesce(sum(ev ^ 2) filter (where is_bet), 0), 4)) bet_out,
    jsonb_build_array(count(*) filter (where is_bet and air), count(*) filter (where is_bet and air and responders > 0),
      count(*) filter (where is_bet and air and responders > 0 and not contested),
      count(*) filter (where is_bet and air and contested and not raised), count(*) filter (where is_bet and air and raised),
      round(coalesce(sum(be) filter (where is_bet and air), 0), 4), round(coalesce(sum(frac) filter (where is_bet and air), 0), 4),
      count(*) filter (where is_bet and air and ev is not null),
      round(coalesce(sum(ev) filter (where is_bet and air), 0), 4), round(coalesce(sum(ev ^ 2) filter (where is_bet and air), 0), 4)) air_out
  from s4 group by 1, 2, 3, 4, 5, 6, 7
)
select jsonb_build_object(
  'section', 'river_bluff_spots', 'window', jsonb_build_array(:START, :END),
  'cells', (select coalesce(jsonb_agg(to_jsonb(cell) order by v, fmt, ways, line, gt, style, who), '[]'::jsonb) from cell)
) report
