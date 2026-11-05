-- Horse daily scorecard: CORE (Phase 5.1). One read-only statement for one
-- UTC day [:START, :END) that returns ONE row with ONE jsonb column
-- `scorecard`:
--   controls    every decide_* telemetry counter on :DAY (the liveness
--               controls: if decide_nlh is 0, every other zero is meaningless)
--   activation  every upgrade receipt from sql/activation.sql (inserted at
--               render time, so the two lists can never drift) fired on :DAY
--   cells       per variant x format (cash / tour): hands, horse and human
--               seats; hands with a horse 4-bet and hands with a horse
--               4-bet-then-fold (same proxy as sql/four-bet-fold.sql, counted
--               per HAND so the assembler's interval is hand-clustered); and,
--               in hands with a person seated (hand_history.has_human), the
--               per-hand horse net and human net in big blinds with their
--               sums of squares (the hand is the cluster).
-- The human-hand list is read through the partial index on
-- hand_history(created_at) WHERE has_human, two hours either side of the
-- window, and then bounded by ca_hand_facts.played_at. Measured 2026-11-05:
-- six hours in 0.9 s, so one call covers the day. Read-only (one SELECT).
with rc(feature, upgrade) as (values
:RECEIPTS
),
act as (
  select rc.feature, rc.upgrade, coalesce(sum(t.fires), 0) fires
  from rc left join public.horse_brain_telemetry t on t.feature = rc.feature and t.day = :DAY::date
  group by 1, 2
),
ctl as (
  select t.feature, sum(t.fires) fires from public.horse_brain_telemetry t
  where t.day = :DAY::date and left(t.feature, 7) = 'decide_'
  group by 1
),
hf as (
  select f.hand_id, f.game_variant v, case when f.tournament_id is null then 'cash' else 'tour' end fmt,
    f.net / nullif(f.big_blind, 0) net_bb, f.four_bet, f.saw_flop, f.was_all_in, f.net,
    coalesce(p.is_horse, false) horse
  from public.ca_hand_facts f left join public.profiles p on p.id = f.user_id
  where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz
),
hu as materialized (
  select h.id from public.hand_history h
  where h.has_human and h.created_at >= :START::timestamptz - interval '2 hours'
    and h.created_at < :END::timestamptz + interval '2 hours'
),
ph as (
  select hand_id, v, fmt,
    bool_or(horse and four_bet) fb,
    bool_or(horse and four_bet and not saw_flop and not was_all_in and net < 0) fbf,
    count(*) filter (where horse) hs, count(*) filter (where not horse) us,
    sum(net_bb) filter (where horse) horse_bb, sum(net_bb) filter (where not horse) human_bb
  from hf group by 1, 2, 3
),
hh as (select ph.*, (hu.id is not null) has_human from ph left join hu on hu.id = ph.hand_id),
cell as (
  select v variant, fmt format, count(*) hands, sum(hs) horse_seats, sum(us) human_seats,
    count(*) filter (where fb) four_bet_hands, count(*) filter (where fbf) four_bet_then_fold_hands,
    count(*) filter (where has_human) human_hands,
    round(coalesce(sum(coalesce(horse_bb, 0)) filter (where has_human), 0), 3) horse_net_bb,
    round(coalesce(sum(coalesce(horse_bb, 0) ^ 2) filter (where has_human), 0), 3) horse_net_bb_sq,
    round(coalesce(sum(coalesce(human_bb, 0)) filter (where has_human), 0), 3) human_net_bb,
    round(coalesce(sum(coalesce(human_bb, 0) ^ 2) filter (where has_human), 0), 3) human_net_bb_sq
  from hh group by 1, 2
)
select jsonb_build_object(
  'section', 'core', 'day', :DAY, 'window', jsonb_build_array(:START, :END),
  'controls', (select coalesce(jsonb_object_agg(feature, fires), '{}'::jsonb) from ctl),
  'activation', (select coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'upgrade', upgrade, 'fires', fires)
                 order by upgrade, feature), '[]'::jsonb) from act),
  'cells', (select coalesce(jsonb_agg(to_jsonb(cell) order by variant, format), '[]'::jsonb) from cell)
) scorecard
