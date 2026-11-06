-- 20261106052532_the_league_pools_heads_up_cards_only_from_the_corrected_butt.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Every heads-up league row before 2026-11-06 was dealt with the blinds
-- reversed. Until #9526 (8715922322a2, merged 2026-11-05 10:58 UTC; the
-- nightly worker first runs it on the 2026-11-06 card) the two-seat
-- simulator posted the small blind from the NON-button seat and the big blind
-- from the button, while the live engine (engine/headsUpButton.ts) and every
-- solver key (gtoV31Position: dealer = SB) put the small blind on the button.
-- The brain therefore played every heads-up league hand from the wrong
-- position: measured on identical code and seeds, the reversed simulator
-- plays v33_depth_ceiling_400bb in 4.6 to 4.9 s per 12,000 hands with about
-- 140 of 6,000 pairs divergent (the nightly worker's own 3.2 to 5.5 s), and
-- the corrected simulator in 38.5 s with 829 divergent. Those rows measured a
-- game production does not play, and their stderr is SMALLER than a correct
-- row's (fewer, cheaper hands), so inverse-variance pooling let them outweigh
-- the corrected rows for a week after the fix.
--
-- fn_league_pooled now leaves out the six heads-up cards' rows dealt before
-- 2026-11-06. Nothing is deleted or rewritten: the rows stay in
-- horse_league_results as the record of what was measured. Every other card,
-- the measured-only rule (20261031200450) and the signature, volatility,
-- SECURITY DEFINER and search_path are unchanged, so CREATE OR REPLACE keeps
-- every grant. md5(prosrc) read from production 2026-11-06 before this edit:
--   fn_league_pooled  a204a00224fa0ae477ae36326bd92d67
-- Pinned by server/src/benchmark/HorseLeagueHeadsUpEpoch.test.ts.

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
      -- 2026-11-06: a heads-up row dealt before the corrected button (#9526)
      -- measured reversed blinds, a game production does not play.
      and not (
        r.run_date < date '2026-11-06'
        and r.matchup = any (array[
          'hu_mind_layer',
          'hu_v16_overlay',
          'v29_gto_flop',
          'v30_gto_turn_river',
          'v32_facing_defense',
          'v33_depth_ceiling_400bb'
        ])
      )
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

-- Access unchanged from production (read 2026-11-06: anon cannot execute,
-- authenticated and service_role can), now stated in the migration itself.
REVOKE ALL ON FUNCTION public.fn_league_pooled(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_league_pooled(date, integer) TO authenticated, service_role;

COMMIT;
