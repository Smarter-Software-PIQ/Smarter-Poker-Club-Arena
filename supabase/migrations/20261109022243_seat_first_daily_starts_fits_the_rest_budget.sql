-- 20261109022243_seat_first_daily_starts_fits_the_rest_budget.sql
--
-- THE DAILY SEAT-FIRST REPORT TIMED OUT OVER POSTGREST, SO THE DIGEST SAID
-- "UNREADABLE" INSTEAD OF A NUMBER (measured 2026-11-09).
--
-- fn_ca_seat_first_daily_starts was shipped hours ago (20261109010200) and
-- verified by running it over the Supabase MCP, which connects as postgres
-- with a 5 minute statement_timeout. The digest calls it over PostgREST as
-- service_role, whose statement_timeout is pinned to its historical ~8s
-- (CLAUDE.md section 2, the PGRST002 fix). The first real digest run proved
-- the difference:
--
--   edge_logs  02:15:30Z  POST | 500 | /rest/v1/rpc/fn_ca_seat_first_daily_starts
--   digest     "### Seat-first board starts ... (seat-first starts unreadable today)"
--   digest     "seat-first starts: starts rpc 500"
--
-- CAUSE, read from the plan rather than guessed. The day filter was
--
--     (t.started_at AT TIME ZONE 'America/Chicago')::date = day.d
--
-- which is not sargable: the expression has to be computed for every one of
-- 991,799 tournament rows. EXPLAIN ANALYZE on the shipped function:
-- 247,595 shared buffers, 2,843 ms warm. The same call cold, in the postgres
-- log at 02:11:05Z, took 13,831 ms for two days - about 7 s a day, which is
-- inside 8 s with no headroom at all, and over it whenever the heap is cold
-- or the box is busy. 979,100 of those rows are SPIN or SNG, so
-- idx_tournaments_tournament_type cannot narrow it either.
--
-- THE FIX, and it is the arithmetic rather than a retry (CLAUDE.md 10.11 and
-- 10.12: a retry would hide a path that should not have failed). The Chicago
-- calendar day is turned into ONE half-open timestamptz range, computed once,
-- and compared against the stored column:
--
--     t.started_at >= lo AND t.started_at < hi
--
-- That is sargable, so the companion index on tournaments(started_at)
-- (20261109022402, installed in the daily maintenance window because
-- CREATE INDEX takes SHARE on a hot table) turns the scan into a range read of
-- one day's rows. The boundaries come from `date + time zone`, so the IANA
-- rules decide them and a DST day is 23 or 25 hours wide without arithmetic
-- here knowing which.
--
-- Nothing about WHAT is counted changes. The kinds, the satellite-feeder test
-- and the human-participation rule are byte-for-byte the ones #10110 shipped
-- and production has already answered with: Spin 6,670 / regular heads-up
-- 5,847 / satellite feeder 4 for 2026-11-07. Only the day predicate moves,
-- and this file asserts the counts are unchanged for that day before it
-- commits.
--
-- One transaction, one CREATE OR REPLACE, so one PostgREST schema reload.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_ca_seat_first_daily_starts(p_day date DEFAULT NULL::date)
RETURNS TABLE(stat_day date, kind text, starts bigint, human_triggered bigint, horse_only bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH day AS (
    SELECT COALESCE(
             p_day,
             ((now() AT TIME ZONE 'America/Chicago')::date - 1)
           ) AS d
  ),
  bounds AS (
    -- ONE half-open range, so the predicate is sargable and the index on
    -- tournaments(started_at) can be used. `date + time zone` applies the IANA
    -- rules for that date, so a spring-forward day is 23 hours wide and a
    -- fall-back day 25 without this arithmetic having to know which.
    SELECT day.d AS d,
           (day.d::timestamp AT TIME ZONE 'America/Chicago') AS lo,
           ((day.d + 1)::timestamp AT TIME ZONE 'America/Chicago') AS hi
      FROM day
  ),
  board AS (
    SELECT t.id,
           CASE
             WHEN t.tournament_type = 'SATELLITE'
               OR t.satellite_target_id IS NOT NULL
               OR t.satellite_target IS NOT NULL
               THEN 'satellite feeder'
             WHEN t.tournament_type = 'SPIN' THEN 'Spin'
             WHEN t.tournament_type = 'SNG' AND t.max_players = 2
               THEN 'regular heads-up'
             WHEN t.tournament_type = 'SNG' THEN 'other Sit and Go'
             ELSE 'other'
           END AS kind
      FROM public.tournaments t, bounds
     WHERE t.started_at >= bounds.lo
       AND t.started_at <  bounds.hi
       AND (t.tournament_type IN ('SPIN', 'SNG')
            OR (t.tournament_type = 'SATELLITE' AND t.max_players = 2))
  ),
  seated AS (
    SELECT b.id,
           b.kind,
           -- A board counts as human-triggered when ANY seat was held by a
           -- profile that is not a horse. An unreadable profile is not
           -- counted as a human: the split must never invent one.
           COALESCE(
             bool_or(COALESCE(pr.is_horse, true) = false),
             false
           ) AS had_human
      FROM board b
      LEFT JOIN public.tournament_players tp ON tp.tournament_id = b.id
      LEFT JOIN public.profiles pr ON pr.id = tp.user_id
     GROUP BY b.id, b.kind
  )
  SELECT (SELECT d FROM bounds) AS stat_day,
         s.kind,
         count(*)::bigint AS starts,
         count(*) FILTER (WHERE s.had_human)::bigint AS human_triggered,
         count(*) FILTER (WHERE NOT s.had_human)::bigint AS horse_only
    FROM seated s
   GROUP BY s.kind
   ORDER BY s.kind;
$function$;

-- The rewrite must not move a single number. 2026-11-07 is a closed Chicago
-- day that production has already reported, so it is the fixture: if the new
-- day predicate counts it differently, this migration aborts and leaves the
-- old function in place.
DO $$
DECLARE
  v_spin bigint;
  v_hu bigint;
  v_feeder bigint;
BEGIN
  SELECT
    COALESCE(max(starts) FILTER (WHERE kind = 'Spin'), 0),
    COALESCE(max(starts) FILTER (WHERE kind = 'regular heads-up'), 0),
    COALESCE(max(starts) FILTER (WHERE kind = 'satellite feeder'), 0)
    INTO v_spin, v_hu, v_feeder
    FROM public.fn_ca_seat_first_daily_starts('2026-11-07'::date);

  IF v_spin <> 6670 OR v_hu <> 5847 OR v_feeder <> 4 THEN
    RAISE EXCEPTION
      'seat-first day counts moved: Spin %, regular heads-up %, satellite feeder % (expected 6670 / 5847 / 4)',
      v_spin, v_hu, v_feeder;
  END IF;
END
$$;

COMMENT ON FUNCTION public.fn_ca_seat_first_daily_starts(date) IS
  'Read-only daily count of seat-first board starts for one America/Chicago day: Spin, regular heads-up, satellite feeder (separate), other Sit and Go, other - each with the human-triggered and horse-only split. The day is a half-open timestamptz range so the index on tournaments(started_at) can serve it inside the service_role statement budget. Read by the estate digest against the under-300 combined target.';

COMMIT;
