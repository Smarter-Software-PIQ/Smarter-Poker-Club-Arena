-- 20261121175912_horse_option_shadow_scoreboard_in_the_daily_digest.sql
--
-- Version re-reserved 2026-11-21 17:59 UTC by scripts/reserve-migration-version.sh (was 20261121002048).
-- The ledger law (.github/workflows/migration-ledger-reconciled.yml, check-migrations-are-live.mjs
-- --min-age-hours 24) fails main once a merged file whose VERSION is over 24 h old is not installed; this
-- branch is held, so the old stamp would have aged past that before install. Content unchanged.
--
-- ============================================================================
-- THE DAILY DIGEST CARRIES THE HORSE OPTION SHADOW SCOREBOARD
-- (Horse Switch lane, owner 2026-11-20 5:57 PM Chicago: build, wire, test)
-- ============================================================================
--
-- WHY. An option in `shadow` or `on_shadow` is re-decided once, off the acted path, with that one option flipped
-- (HorseOptionShadow.ts); each re-decision fires option_shadow_<option>_{changed,same}[_person]_seen in
-- public.horse_brain_telemetry. The only reader was scripts/sql/horse-option-shadow-summary.sql with dates edited
-- by hand, so a live measurement was only seen when a lane remembered to run it.
--
-- WHAT THIS CHANGES (read-only on game data; switches nothing, writes no row):
-- 1. public.fn_sp_digest_horse_option_shadow(p_day) - one line per option that is in shadow / on_shadow now or has
--    re-decision counters on p_day (horse_brain_telemetry.day): its current switch state, re-decisions, changed
--    count and rate, the person-present and Horse-only split, plus the day's re-decision skips (budget, rate,
--    backlog, scale, rotation, failures) - the latency guard's cost.
-- 2. fn_sp_daily_digest returns it under 'horse_option_shadow' (anchored after 'felt_latency', exactly once).
-- No new table, no cron job: the digest already runs daily; the counters are already flushed by the engine.
--
BEGIN;
SET LOCAL statement_timeout = '12s';

CREATE OR REPLACE FUNCTION public.fn_sp_digest_horse_option_shadow(p_day date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH f AS (
    SELECT t.feature, t.fires
    FROM public.horse_brain_telemetry t
    WHERE t.day = p_day AND t.feature LIKE 'option\_shadow\_%' ESCAPE '\'
  ),
  o AS (
    SELECT substring(feature FROM '^option_shadow_(.+)_(?:changed|same)(?:_person)?_seen$') AS option,
           substring(feature FROM '_(changed|same)(?:_person)?_seen$') AS outcome,
           feature ~ '_person_seen$' AS person, fires
    FROM f WHERE feature ~ '^option_shadow_.+_(changed|same)(_person)?_seen$'
  ),
  per AS (
    SELECT option,
           coalesce(sum(fires) FILTER (WHERE outcome = 'changed' AND NOT person), 0) AS changed_all,
           coalesce(sum(fires) FILTER (WHERE outcome = 'same' AND NOT person), 0) AS same_all,
           coalesce(sum(fires) FILTER (WHERE outcome = 'changed' AND person), 0) AS changed_person,
           coalesce(sum(fires) FILTER (WHERE outcome = 'same' AND person), 0) AS same_person
    FROM o GROUP BY option
  ),
  names AS (
    SELECT option FROM per
    UNION
    SELECT s.option FROM public.ca_horse_style_switch s WHERE s.state IN ('shadow', 'on_shadow')
  ),
  lines AS (
    SELECT n.option, s.state,
           coalesce(p.changed_all, 0) + coalesce(p.same_all, 0) AS redecided,
           coalesce(p.changed_all, 0) AS changed,
           coalesce(p.changed_person, 0) AS changed_person_present,
           coalesce(p.changed_all, 0) - coalesce(p.changed_person, 0) AS changed_horse_only,
           coalesce(p.changed_person, 0) + coalesce(p.same_person, 0) AS redecided_person_present,
           round(100.0 * coalesce(p.changed_all, 0) / nullif(coalesce(p.changed_all, 0) + coalesce(p.same_all, 0), 0), 1) AS changed_pct
    FROM names n
    LEFT JOIN per p USING (option)
    LEFT JOIN public.ca_horse_style_switch s USING (option)
  )
  SELECT jsonb_build_object(
    'day', p_day,
    'options', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.redecided DESC, l.option) FROM lines l), '[]'::jsonb),
    'skips', coalesce((SELECT jsonb_object_agg(feature, fires) FROM f
                       WHERE feature IN ('option_shadow_skipped_backlog_seen', 'option_shadow_skipped_budget_seen',
                                         'option_shadow_skipped_scale_seen', 'option_shadow_skipped_rate_seen',
                                         'option_shadow_rotated_out_seen', 'option_shadow_scale_mismatch_seen',
                                         'option_shadow_redecide_failed_seen', 'option_shadow_unencodable_seen')), '{}'::jsonb),
    'note', 'A shadow re-decision is never acted on: changed counts how often the flipped option would have changed the acted action or amount. It shows reach, not whether the option wins.'
  );
$function$;

REVOKE ALL ON FUNCTION public.fn_sp_digest_horse_option_shadow(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_digest_horse_option_shadow(date) TO service_role;

DO $digest$
DECLARE
  v_def text := pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure);
  c_old constant text := E'    ''felt_latency'', public.fn_sp_digest_felt_latency(v_day),\n';
  c_new constant text := E'    ''felt_latency'', public.fn_sp_digest_felt_latency(v_day),\n    ''horse_option_shadow'', public.fn_sp_digest_horse_option_shadow(v_day),\n';
BEGIN
  IF strpos(v_def, 'fn_sp_digest_horse_option_shadow') > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'HORSE_OPTION_SHADOW_DIGEST_ANCHOR: the felt_latency line of fn_sp_daily_digest did not match exactly once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$digest$;

-- @probe-for: public.fn_sp_digest_horse_option_shadow
-- @probe-exempt: public.fn_sp_daily_digest the anchored edit adds one jsonb key; a full digest run takes longer than the ordinary 12 s install transaction (its own statement timeout is 60 s), and fn_sp_digest_horse_option_shadow is probed on its own below
DO $probe$
DECLARE v_line jsonb;
BEGIN
  v_line := public.fn_sp_digest_horse_option_shadow((now() AT TIME ZONE 'utc')::date);
  IF v_line IS NULL OR NOT v_line ? 'options' OR NOT v_line ? 'skips' THEN
    RAISE EXCEPTION 'HORSE_OPTION_SHADOW_PROBE: the digest line has no options/skips (%)', v_line;
  END IF;
  IF strpos(pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure),
            '''horse_option_shadow'', public.fn_sp_digest_horse_option_shadow(v_day)') = 0 THEN
    RAISE EXCEPTION 'HORSE_OPTION_SHADOW_PROBE: fn_sp_daily_digest does not return horse_option_shadow';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
