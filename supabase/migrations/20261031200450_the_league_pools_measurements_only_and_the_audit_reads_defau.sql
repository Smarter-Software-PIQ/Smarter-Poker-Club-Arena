-- 20261031200450_the_league_pools_measurements_only_and_the_audit_reads_defau.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (2026-10-30 daily horse audit, league findings):
--
-- Bodies rebuilt from the installed ones. md5(prosrc) read from production
-- 2026-10-31 before this edit:
--   fn_league_pooled                    655f6831138bd08104924fc0c1af5be9
--   fn_horse_tuner_admitted_classes     bfc0af1af929d9ede14b8e87abd868af
--   fn_audit_league_pooled_findings     adb0fed624354c7d6b2594c12913527f
-- Signatures, volatility, SECURITY DEFINER and search_path are unchanged, so
-- CREATE OR REPLACE keeps every existing grant.
--
-- 1. fn_league_pooled pools MEASUREMENTS ONLY. It averaged every row in the
--    window, and floored stderr at 0.01, so an inert row (0.00 +/- 0.00: the
--    arms played identical poker) entered the pool as a zero with weight
--    10,000 - the exact averaging 20260927220437 says an inert row must never
--    receive - and a refused row (hands = 0) would have too. Over the 7 runs
--    to 2026-10-30 that pinned plo4_v53_pressure at 0.00 +/- 0.01 where its
--    four real measurements pool +1.13 +/- 0.63 (plo5 +0.51 +/- 0.67, plo6
--    -0.12 +/- 0.15). It now reads status = 'measured' rows with a positive
--    stderr. No pooled verdict on the 2026-10-30 card changes significance;
--    only the zeros stop masking the measured rows.
--
-- 2. fn_horse_tuner_admitted_classes refuses a dial direction the league
--    currently resolves NEGATIVE. Admission already needed 30-day pooled
--    significant positive, which tuner_tightness_down (-2.37 +/- 1.01 over
--    the 8 runs to 2026-10-31) cannot meet; this adds the audit's own 7-day
--    window as a veto, so a class can never be admitted on a 30-day average
--    while the last week says it loses (Dan 2026-10-09: a pooled-significant
--    negative layer is off for every horse). Production on 2026-10-31: no
--    class admitted, horse_tuner_league_nudges empty (no league-gated nudge
--    has ever been applied), and every observational tuner receipt since
--    2026-09-14 unchanged (fn_record_horse_tuner_update refuses a profile
--    change as causal_permission_missing), so there is nothing to unwind.
--
-- 3. fn_audit_league_pooled_findings:
--    - plo6_v24_price joins the default-off list. The PLO6 CASH half of the V24
--      Omaha price defense is DEFAULT OFF from this change
--      (HorseLogic v24PloDefenseOn), after the league pooled it NEGATIVE
--      (-2.34 +/- 1.12 bb/100 over the 7 runs to 2026-10-30; -2.41 +/- 0.98
--      over the 9 runs since 2026-10-23, after -0.20 +/- 0.42 over the 42 runs
--      before 2026-10-17) while plo4_v24_price pooled +3.43 +/- 0.89. The
--      matchup keeps its name and sign (arm A = price defense ON), so a
--      significant negative now confirms the default and a significant
--      positive says PLO6 earned it back.
--    - tuner_* matchups are CANDIDATE dial moves, not shipped layers: arm A
--      carries the move, arm B is today's brain. A significant negative is
--      the league refusing that move (info, tuner_move_refused_by_league),
--      with the count of nudges in that class applied over the last 30 days
--      as evidence. Only if one was applied anyway is it critical
--      (tuner_refused_move_applied). 2026-10-30 raised
--      tuner_tightness_down as a critical league_layer_negative_pooled -
--      "this layer is measurably losing money" - about a move no horse has
--      ever received.
--    No other finding changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_league_pooled(p_day date, p_days integer DEFAULT 7)
 RETURNS TABLE(matchup text, runs integer, hands bigint, bb100 numeric, stderr numeric, verdict text, newest_run date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with rows as (
    select r.matchup, r.bb100::numeric b, greatest(r.stderr::numeric, 0.01) s,
           r.hands::bigint h, r.run_date
    from horse_league_results r
    where r.run_date > p_day - greatest(p_days, 1)
      and r.run_date <= p_day + 1
      -- 2026-10-31: measurements only. An inert row (identical arms) or a
      -- refused row (nothing dealt) is the absence of an experiment and is
      -- never averaged in with measurements.
      and r.status = 'measured'
      and r.stderr::numeric > 0
      and r.hands > 0
  ), pooled as (
    select rows.matchup,
           count(*)::int runs,
           sum(rows.h) hands,
           sum(rows.b / (rows.s * rows.s)) / nullif(sum(1.0 / (rows.s * rows.s)), 0) bb100,
           sqrt(1.0 / nullif(sum(1.0 / (rows.s * rows.s)), 0)) stderr,
           max(rows.run_date) newest_run
    from rows group by rows.matchup
  )
  select p.matchup, p.runs, p.hands,
         round(p.bb100, 2), round(p.stderr, 2),
         case when abs(p.bb100) > 2 * p.stderr then 'SIGNIFICANT' else 'not resolved' end,
         p.newest_run
  from pooled p
  order by p.bb100 desc;
$function$;

CREATE OR REPLACE FUNCTION public.fn_horse_tuner_admitted_classes()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET statement_timeout TO '5s'
AS $function$
  SELECT coalesce(array_agg(cls ORDER BY cls), ARRAY[]::text[])
    FROM (
      SELECT substr(matchup, 7) AS cls
        FROM public.horse_league_results
       WHERE matchup IN ('tuner_tightness_up','tuner_tightness_down',
                         'tuner_aggression_up','tuner_aggression_down',
                         'tuner_bluff_up','tuner_bluff_down')
         AND status = 'measured'
         AND stderr IS NOT NULL AND stderr::numeric > 0
         AND bb100 IS NOT NULL
         AND illegal_actions = 0
         AND run_date >= (now() AT TIME ZONE 'utc')::date - 30
       GROUP BY matchup
      HAVING count(*) >= 3
         AND sum(bb100::numeric / (stderr::numeric ^ 2)) / sum(1 / (stderr::numeric ^ 2))
             > 2 * sqrt(1 / sum(1 / (stderr::numeric ^ 2)))
    ) q
   -- 2026-10-31: the audit's 7-day window vetoes a direction it resolves
   -- NEGATIVE, whatever the 30-day average says.
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.fn_league_pooled((now() AT TIME ZONE 'utc')::date, 7) p
      WHERE p.matchup = 'tuner_' || q.cls
        AND p.verdict = 'SIGNIFICANT'
        AND p.bb100 < 0
   );
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_league_pooled_findings(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb := '[]'::jsonb; r record; v_applied bigint;
begin
  for r in select * from fn_league_pooled(p_day, 7) loop
    if r.verdict = 'SIGNIFICANT' and r.bb100 < 0 then
      if r.matchup in ('hu_v16_overlay', 'v16_hu_overlay_6max', 'v17_river_probe',
                       'shortdeck_v23', 'v32_facing_defense', 'plo6_v24_price') then
        -- Arm A runs a DEFAULT-OFF flag ON (v16Hu since 2026-10-05,
        -- v17RiverProbe, v23ShortDeck and v32FacingDefense since 2026-10-16,
        -- the PLO6 cash half of v24PloDefense since 2026-10-31). A significant
        -- negative confirms the default; it is not a defect in the shipped
        -- brain.
        v := v || jsonb_build_object(
          'severity', 'info', 'category', 'gto', 'code', 'default_off_flag_confirmed_negative',
          'title', 'Pooled over ' || r.runs || ' run(s): ' || r.matchup || ' (default-off '
                   || case r.matchup
                        when 'v17_river_probe' then 'v17RiverProbe'
                        when 'shortdeck_v23' then 'v23ShortDeck'
                        when 'v32_facing_defense' then 'v32FacingDefense'
                        when 'plo6_v24_price' then 'v24PloDefense (PLO6)'
                        else 'v16Hu' end
                   || ' arm) is NEGATIVE at ' || r.bb100 || ' bb/100',
          'evidence', jsonb_build_object('matchup', r.matchup, 'bb100', r.bb100, 'stderr', r.stderr,
                                         'runs', r.runs, 'hands', r.hands, 'newest_run', r.newest_run),
          'recommendation', 'Hypothesis failed as expected; the flag stays default OFF. Nothing to ablate.'
        );
      elsif r.matchup like 'tuner\_%' then
        -- 2026-10-31: a tuner_* card measures a CANDIDATE dial move (arm A
        -- carries it, arm B is today's brain). A significant negative is the
        -- league refusing the move; it is a defect only if a horse got it.
        select count(*) into v_applied
          from horse_tuner_league_nudges n
         where substr(r.matchup, 7) = any(n.admitted_classes)
           and n.run_date > p_day - 30;
        v := v || jsonb_build_object(
          'severity', case when v_applied > 0 then 'critical' else 'info' end,
          'category', 'gto',
          'code', case when v_applied > 0 then 'tuner_refused_move_applied'
                       else 'tuner_move_refused_by_league' end,
          'title', 'Pooled over ' || r.runs || ' run(s): the tuner move ' || substr(r.matchup, 7)
                   || ' is NEGATIVE at ' || r.bb100 || ' bb/100'
                   || case when v_applied > 0
                           then ' and ' || v_applied || ' horse nudge(s) in that class were applied in 30 days'
                           else ' and no horse has it' end,
          'evidence', jsonb_build_object('matchup', r.matchup, 'bb100', r.bb100, 'stderr', r.stderr,
                                         'runs', r.runs, 'hands', r.hands, 'newest_run', r.newest_run,
                                         'class', substr(r.matchup, 7),
                                         'applied_nudges_30d', v_applied),
          'recommendation', case when v_applied > 0
            then 'A dial move the league resolves negative reached live horses. Find the admission that let it '
                 || 'through (fn_horse_tuner_admitted_classes, fn_apply_league_gated_horse_tuner_nudge) and '
                 || 'reverse those nudges through the same gated path.'
            else 'The league refused this dial direction: fn_horse_tuner_admitted_classes will not admit it '
                 || 'while it resolves negative, so no horse receives it. Nothing to ablate.' end
        );
      else
        v := v || jsonb_build_object(
          'severity', 'critical', 'category', 'gto', 'code', 'league_layer_negative_pooled',
          'title', 'Pooled over ' || r.runs || ' run(s): ' || r.matchup || ' resolves NEGATIVE at ' || r.bb100 || ' bb/100',
          'evidence', jsonb_build_object('matchup', r.matchup, 'bb100', r.bb100, 'stderr', r.stderr,
                                         'runs', r.runs, 'hands', r.hands, 'newest_run', r.newest_run),
          'recommendation', 'This layer is measurably losing money across every night it was measured. Ablate it properly before tuning anything else - and check whether a recent change to it caused the flip.'
        );
      end if;
    end if;
    if r.verdict = 'SIGNIFICANT' and r.bb100 > 0 and r.matchup = 'v17_river_probe' then
      v := v || jsonb_build_object(
        'severity', 'info', 'category', 'gto', 'code', 'flagged_experiment_earned_its_keep',
        'title', 'v17_river_probe is pooled-SIGNIFICANT positive (' || r.bb100 || ' bb/100 over ' || r.runs || ' runs)',
        'evidence', jsonb_build_object('bb100', r.bb100, 'stderr', r.stderr, 'runs', r.runs),
        'recommendation', 'The default-OFF river probe has earned its default back. Ship a PR flipping v17RiverProbe to default ON, citing these runs.'
      );
    end if;
    if r.verdict = 'SIGNIFICANT' and r.bb100 > 0
       and r.matchup in ('shortdeck_v23', 'v32_facing_defense', 'plo6_v24_price') then
      v := v || jsonb_build_object(
        'severity', 'info', 'category', 'gto', 'code', 'flagged_experiment_earned_its_keep',
        'title', r.matchup || ' is pooled-SIGNIFICANT positive (' || r.bb100 || ' bb/100 over ' || r.runs || ' runs)',
        'evidence', jsonb_build_object('bb100', r.bb100, 'stderr', r.stderr, 'runs', r.runs),
        'recommendation', 'The default-OFF layer has earned its default back. Ship a PR flipping '
                          || case r.matchup
                               when 'shortdeck_v23' then 'v23ShortDeck'
                               when 'plo6_v24_price' then 'the PLO6 cash half of v24PloDefense (HorseLogic v24PloDefenseOn)'
                               else 'v32FacingDefense' end
                          || ' to default ON, citing these runs.'
      );
    end if;
    if r.verdict = 'SIGNIFICANT' and r.bb100 > 0 and r.matchup = 'v16_ratio_rescale' then
      v := v || jsonb_build_object(
        'severity', 'info', 'category', 'gto', 'code', 'flagged_experiment_earned_its_keep',
        'title', 'v16_ratio_rescale is pooled-SIGNIFICANT positive (' || r.bb100 || ' bb/100 over ' || r.runs || ' runs)',
        'evidence', jsonb_build_object('bb100', r.bb100, 'stderr', r.stderr, 'runs', r.runs),
        'recommendation', 'The default-OFF experiment has earned its default. Ship a PR flipping v16Ratio to default ON, citing these runs.'
      );
    end if;
  end loop;
  return v;
end $function$;

-- Grants stated as production holds them (proacl read 2026-10-31), so the
-- replacement cannot widen them: the audit and the tuner gate are engine
-- (service_role) only; fn_league_pooled also keeps its signed-in reader.
REVOKE ALL ON FUNCTION public.fn_audit_league_pooled_findings(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_league_pooled_findings(date) TO service_role;
REVOKE ALL ON FUNCTION public.fn_horse_tuner_admitted_classes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_tuner_admitted_classes() TO service_role;
REVOKE ALL ON FUNCTION public.fn_league_pooled(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_league_pooled(date, integer) TO authenticated, service_role;

COMMIT;
