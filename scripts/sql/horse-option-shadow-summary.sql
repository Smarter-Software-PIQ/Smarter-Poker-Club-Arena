-- OPTION SHADOW SUMMARY FROM THE DAILY COUNTERS (read-only; 2026-11-18, HorseOptionShadow.ts).
--
-- For every option in shadow, per day over the window: how many re-decisions with the option flipped would have
-- changed the acted action or amount, split person-present (a seat that is not a Horse was dealt in) vs Horse-only,
-- and the budget skips of the day. One SELECT, no write. Edit the two dates of the window below.
-- An option in on_shadow (2026-11-19: acted with true exactly as on, re-decided with false) counts under the same
-- names; the journal receipt's flippedTo (false) and the switch audit tell which state the option was in.
--   option_shadow_<option>_changed_seen / _same_seen                 every re-decision
--   option_shadow_<option>_changed_person_seen / _same_person_seen   the person-present subset
-- Horse-only = all - person. Skips (2026-11-21, PEOPLE FIRST: the per-minute budget never refuses a decision with a
-- person dealt in, so skipped_rate_person fires only when the budget is 0):
--   option_shadow_skipped_<backlog|budget|scale|stage_disabled|rate>_person_seen   the person-present subset of a skip
--   option_shadow_rate_person_over_seen   a person decision re-decided after the minute's budget was used
-- Per-decision detail (action pairs, street, variant) is in the decision journal:
--   npx tsx server/scripts/horse-option-shadow-summary.ts <journal copy .ndjson> --since ... --until ...
WITH params AS (
  SELECT DATE '2026-11-18' AS since_day, DATE '2026-11-25' AS until_day
),
fires AS (
  SELECT t.day, t.feature, t.fires
  FROM public.horse_brain_telemetry t, params p
  WHERE t.day >= p.since_day AND t.day < p.until_day
    AND t.feature LIKE 'option\_shadow\_%' ESCAPE '\'
),
outcomes AS (
  SELECT day,
         substring(feature FROM '^option_shadow_(.+)_(?:changed|same)(?:_person)?_seen$') AS option,
         substring(feature FROM '_(changed|same)(?:_person)?_seen$') AS outcome,
         feature ~ '_person_seen$' AS person,
         fires
  FROM fires
  WHERE feature ~ '^option_shadow_.+_(changed|same)(_person)?_seen$'
),
per_option AS (
  SELECT day, option,
         sum(fires) FILTER (WHERE outcome = 'changed' AND NOT person) AS changed_all,
         sum(fires) FILTER (WHERE outcome = 'same' AND NOT person) AS same_all,
         sum(fires) FILTER (WHERE outcome = 'changed' AND person) AS changed_person,
         sum(fires) FILTER (WHERE outcome = 'same' AND person) AS same_person
  FROM outcomes
  GROUP BY day, option
),
skips AS (
  SELECT day, jsonb_object_agg(feature, fires) AS skips
  FROM fires
  WHERE feature IN ('option_shadow_skipped_backlog_seen', 'option_shadow_skipped_budget_seen',
                    'option_shadow_skipped_scale_seen', 'option_shadow_skipped_rate_seen',
                    'option_shadow_skipped_backlog_person_seen', 'option_shadow_skipped_budget_person_seen',
                    'option_shadow_skipped_scale_person_seen', 'option_shadow_skipped_rate_person_seen',
                    'option_shadow_skipped_stage_disabled_seen', 'option_shadow_skipped_stage_disabled_person_seen',
                    'option_shadow_skipped_stage_horse_only_seen', 'option_shadow_rate_person_over_seen',
                    'option_shadow_rotated_out_seen', 'option_shadow_scale_mismatch_seen',
                    'option_shadow_redecide_failed_seen', 'option_shadow_unencodable_seen')
  GROUP BY day
)
SELECT o.day, o.option,
       coalesce(o.changed_all, 0) + coalesce(o.same_all, 0) AS redecided,
       coalesce(o.changed_all, 0) AS changed,
       coalesce(o.changed_person, 0) AS changed_person_present,
       coalesce(o.changed_all, 0) - coalesce(o.changed_person, 0) AS changed_horse_only,
       coalesce(o.same_person, 0) AS same_person_present,
       coalesce(o.same_all, 0) - coalesce(o.same_person, 0) AS same_horse_only,
       round(100.0 * coalesce(o.changed_all, 0)
             / nullif(coalesce(o.changed_all, 0) + coalesce(o.same_all, 0), 0), 1) AS changed_pct,
       s.skips
FROM per_option o
LEFT JOIN skips s USING (day)
ORDER BY o.option, o.day
