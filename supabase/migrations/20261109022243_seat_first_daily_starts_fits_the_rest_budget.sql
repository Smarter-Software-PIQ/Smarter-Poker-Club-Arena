-- 20261109022243_seat_first_daily_starts_fits_the_rest_budget.sql
--
-- THE DAILY SEAT-FIRST REPORT TIMED OUT, SO THE DIGEST SAID "UNREADABLE"
-- INSTEAD OF A NUMBER (measured 2026-11-09).
--
-- fn_ca_seat_first_daily_starts was shipped hours ago (20261109010200) and
-- verified over the Supabase MCP, which connects as postgres with a 5 minute
-- statement_timeout. The digest calls it over PostgREST as service_role, whose
-- statement_timeout is pinned to its historical ~8s (CLAUDE.md section 2, the
-- PGRST002 fix). The first real digest run proved the difference:
--
--   edge_logs  02:15:30Z  POST | 500 | /rest/v1/rpc/fn_ca_seat_first_daily_starts
--   digest     "### Seat-first board starts ... (seat-first starts unreadable today)"
--   digest     "seat-first starts: starts rpc 500"
--
-- TWO CAUSES, NOT ONE. THE SECOND WAS FOUND BY THE FIRST ATTEMPT AT THIS FILE,
-- which the applier refused at 03:04Z - "FATAL 25P04: terminating connection
-- due to transaction timeout", in this file's own assertion. Nothing was
-- committed, which is why this file is still queued and is being corrected
-- rather than followed by a second one.
--
-- CAUSE ONE, the day filter. It was
--
--     (t.started_at AT TIME ZONE 'America/Chicago')::date = day.d
--
-- which is not sargable, so the expression was computed for every one of
-- 991,799 rows of a 1,541 MB table. Fixed below with ONE half-open
-- timestamptz range, `started_at >= lo AND started_at < hi`, served by
-- idx_tournaments_started_at (20261109022418, already applied and valid).
-- That part of the plan went from a full heap scan to an index range read of
-- 12,521 rows in 66 ms.
--
-- CAUSE TWO, and it was the bigger one: the SEAT side. With
--
--     LEFT JOIN tournament_players tp ON tp.tournament_id = b.id
--     LEFT JOIN profiles pr ON pr.id = tp.user_id
--     ... bool_or(COALESCE(pr.is_horse, true) = false)
--
-- the planner estimated 108,304 boards for a day (12,521 actual), decided the
-- small side was the boards, and hash-joined against the WHOLE of
-- tournament_players: 3,080,845 rows, 713,772 buffers, 13,224 ms of the
-- 13,861 ms total. Fixing only the day filter would have left that untouched,
-- which is CLAUDE.md 10.86 rule 4 exactly - a fix with the same trap one level
-- up. Rewriting it as a plain EXISTS was not enough either: Postgres hashed
-- the subquery and scanned all 3.08 M rows TWICE, 2,088 ms.
--
-- A LATERAL carrying LIMIT 1 cannot be flattened or hashed, so it is executed
-- once per board as a nested loop over
-- tournament_players_tournament_id_user_id_key. Measured on the same day:
--
--     13,861 ms  ->  296 ms      (46x, 759,099 buffers -> 151,457)
--
-- and about 5 ms on an ordinary day once the waiting ladder is the engine that
-- is serving and a day holds a couple of hundred boards rather than 12,521.
-- `MATERIALIZED` on the board CTE is load bearing: without it the planner
-- inlines the CTE and is free to flatten the LATERAL back into a join.
--
-- THE COUNTS DO NOT MOVE. The kinds, the satellite-feeder test and the
-- human-participation rule mean exactly what #10110 shipped:
--   * a tournament_players row whose profile is missing matched nothing under
--     the old LEFT JOIN either (COALESCE(is_horse, true) = false was false),
--     and matches nothing in the LATERAL now;
--   * a board with no entrants was bool_or over zero rows -> NULL ->
--     COALESCE(..., false) -> false, and is a LEFT JOIN LATERAL miss now.
-- Both forms were run against production for 2026-11-07 before this was
-- written and returned the same three rows, splits included:
-- Spin 6,670 (1 human-triggered), regular heads-up 5,847, satellite feeder 4.
-- The assertion below pins exactly that, and now costs 296 ms rather than the
-- 12 s that refused the first attempt.
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
    -- ONE half-open range, so the predicate is sargable and
    -- idx_tournaments_started_at can serve it. `date + time zone` applies the
    -- IANA rules for that date, so a spring-forward day is 23 hours wide and a
    -- fall-back day 25 without this arithmetic having to know which.
    SELECT day.d AS d,
           (day.d::timestamp AT TIME ZONE 'America/Chicago') AS lo,
           ((day.d + 1)::timestamp AT TIME ZONE 'America/Chicago') AS hi
      FROM day
  ),
  -- MATERIALIZED is load bearing: inlined, the planner may flatten the LATERAL
  -- below back into a join and hash the whole of tournament_players again.
  board AS MATERIALIZED (
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
  )
  SELECT (SELECT d FROM bounds) AS stat_day,
         b.kind,
         count(*)::bigint AS starts,
         count(*) FILTER (WHERE h.human IS NOT NULL)::bigint AS human_triggered,
         count(*) FILTER (WHERE h.human IS NULL)::bigint AS horse_only
    FROM board b
    -- A board counts as human-triggered when ANY seat was held by a profile
    -- that is not a horse. An unreadable profile is not counted as a human:
    -- the split must never invent one. LIMIT 1 is what keeps this a nested
    -- loop over tournament_players_tournament_id_user_id_key instead of a
    -- scan of all three million rows.
    LEFT JOIN LATERAL (
      SELECT 1 AS human
        FROM public.tournament_players tp
        JOIN public.profiles pr ON pr.id = tp.user_id
       WHERE tp.tournament_id = b.id
         AND COALESCE(pr.is_horse, true) = false
       LIMIT 1
    ) h ON true
   GROUP BY b.kind
   ORDER BY b.kind;
$function$;

-- The rewrite must not move a single number. 2026-11-07 is a closed Chicago
-- day that production has already reported, so it is the fixture: if the new
-- shape counts it differently, this migration aborts and leaves the old
-- function in place.
DO $$
DECLARE
  v_spin bigint;
  v_spin_human bigint;
  v_hu bigint;
  v_feeder bigint;
BEGIN
  SELECT
    COALESCE(max(starts) FILTER (WHERE kind = 'Spin'), 0),
    COALESCE(max(human_triggered) FILTER (WHERE kind = 'Spin'), 0),
    COALESCE(max(starts) FILTER (WHERE kind = 'regular heads-up'), 0),
    COALESCE(max(starts) FILTER (WHERE kind = 'satellite feeder'), 0)
    INTO v_spin, v_spin_human, v_hu, v_feeder
    FROM public.fn_ca_seat_first_daily_starts('2026-11-07'::date);

  IF v_spin <> 6670 OR v_spin_human <> 1 OR v_hu <> 5847 OR v_feeder <> 4 THEN
    RAISE EXCEPTION
      'seat-first day counts moved: Spin % (% human-triggered), regular heads-up %, satellite feeder % (expected 6670 / 1 / 5847 / 4)',
      v_spin, v_spin_human, v_hu, v_feeder;
  END IF;
END
$$;

COMMENT ON FUNCTION public.fn_ca_seat_first_daily_starts(date) IS
  'Read-only daily count of seat-first board starts for one America/Chicago day: Spin, regular heads-up, satellite feeder (separate), other Sit and Go, other - each with the human-triggered and horse-only split. The day is a half-open timestamptz range served by idx_tournaments_started_at, and the seat test is a LATERAL with LIMIT 1 so it stays a per-board index probe; both are needed to fit the service_role statement budget. Read by the estate digest against the under-300 combined target.';

COMMIT;
