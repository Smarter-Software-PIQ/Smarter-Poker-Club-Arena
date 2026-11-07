-- River bluff live report: RECEIPTS. Daily horse_brain_telemetry fires, per
-- day in [:START_DAY, :END_DAY] (UTC days, inclusive), of every river bluff
-- layer:
--   * the named BET receipts below (one fire = one bluff bet placed), listed
--     explicitly so a layer that never fired reads 0 rather than vanishing;
--   * every other feature starting river_bluff_, river_lead_, v53_river or
--     v54_river (the checks, skips, evaluations and illegal counters);
--   * the decide_* liveness CONTROLS. If the controls are 0 on a day the
--     telemetry did not flow and every other number that day is NO DATA, not
--     zero (CLAUDE.md 10.86).
-- Telemetry is a daily total for the whole fleet: it has no variant, format
-- or opponent split (except the river_bluff_baseline_bet_<gameType> labels);
-- those splits come from sql/river-bluff-spots.sql. A day only partly inside
-- the report window counts whole. Read-only (one SELECT).
with named(feature, layer) as (values
  ('river_bluff_baseline_junk', 'baseline HU (#9803): junk'),
  ('river_bluff_baseline_missedDraw', 'baseline HU (#9803): missed draw'),
  ('river_bluff_baseline_blocker', 'baseline HU (#9803): blocker'),
  ('river_bluff_baseline_blockerAndDraw', 'baseline HU (#9803): blocker and draw'),
  ('river_bluff_baseline_freeroll', 'baseline HU (#9803): hi-lo freeroll'),
  ('river_bluff_baseline_bet_fixedLimit', 'other games (#9837): fixed limit'),
  ('river_bluff_baseline_bet_shortDeck', 'other games (#9837): short deck'),
  ('river_bluff_baseline_bet_bombPot', 'other games (#9837): bomb pot'),
  ('river_bluff_baseline_bet_multiBoard', 'other games (#9837): multi-board'),
  ('river_bluff_multiway_selected_3way', 'multiway (#9842): three-way'),
  ('river_bluff_multiway_selected_4way', 'multiway (#9842): four-way'),
  ('river_lead_bluff_leadDraw', 'OOP lead (#9838): draw-completing river'),
  ('river_lead_bluff_leadBlank', 'OOP lead (#9838): blank river'),
  ('river_bluff_hilo_freeroll', 'hi-lo (#9838): freeroll'),
  ('river_bluff_hilo_scoop', 'hi-lo (#9838): scoop'),
  ('v54_river_bluff', 'V54 river bluff'),
  ('v53_river_bluff', 'V53 river bluff'),
  ('v53_river_scare_bluff', 'V53 river scare bluff'),
  ('river_bluff_checkraise_selected', 'river check-raise bluff')
),
days as (
  select d::date as day from generate_series(:START_DAY::date, :END_DAY::date, interval '1 day') d
),
tel as (
  select t.day, t.feature, sum(t.fires) as fires from public.horse_brain_telemetry t
  where t.day >= :START_DAY::date and t.day <= :END_DAY::date
    and (t.feature like 'river\_bluff\_%' or t.feature like 'river\_lead\_%'
         or t.feature like 'v53\_river%' or t.feature like 'v54\_river%'
         or t.feature like 'decide\_%')
  group by 1, 2
),
grid as (
  select days.day, n.feature, n.layer, 'bet' kind, coalesce(tel.fires, 0) fires
  from days cross join named n left join tel on tel.day = days.day and tel.feature = n.feature
  union all
  select tel.day, tel.feature, null, case when tel.feature like 'decide\_%' then 'control' else 'other' end, tel.fires
  from tel where not exists (select 1 from named n where n.feature = tel.feature)
)
select jsonb_build_object(
  'section', 'river_bluff_receipts', 'days', jsonb_build_array(:START_DAY, :END_DAY),
  'rows', (select coalesce(jsonb_agg(jsonb_build_array(day, kind, feature, layer, fires) order by day, kind, feature), '[]'::jsonb) from grid)
) receipts
