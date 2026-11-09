-- 20261109010200_seat_first_daily_starts_report
--
-- THE DAILY SEAT-FIRST START COUNT, SO THE ACCEPTANCE NUMBER HAS A READER
--
-- Dan, 2026-11-08: "CUT SPINS AND SIT N GOS DOWN TO LIKE UNDER 300 PER DAY
-- COMBINED" and, on acceptance: "report total starts, human-triggered starts
-- and horse-only starts, with satellite feeders counted separately."
--
-- What was wrong: nothing on the platform answered "how many seat-first boards
-- started today, and did a person sit in any of them". The daily aggregates
-- that exist are per player (ca_stats_club_tournament_player_daily) or per
-- club and tournament (ca_club_tournament_daily); neither counts BOARDS, and
-- none of them splits by whether a human was in the field. The measurement
-- behind the ladder change was therefore assembled by hand, which is exactly
-- the shape of evidence that disappears when a session ends.
--
-- What this adds: ONE read-only function. It performs no writes, schedules
-- nothing, repairs nothing and corrects nothing - it is reporting, which
-- CLAUDE.md 10.12 names as a job whose schedule IS the product. The reader is
-- the existing estate digest (.github/scripts/estate-digest.mjs), which runs
-- at 06:07 Chicago, after the Chicago day it reports on has closed.
--
-- The definitions are the ones the baseline was measured with on 2026-11-08,
-- kept here verbatim so the "after" number is comparable to the "before":
--   * a START is a row with a non-null started_at, bucketed by its
--     America/Chicago calendar date - not created_at, because a board that
--     opens at 23:50 and deals at 00:10 belongs to the day it DEALT;
--   * Spin        = tournament_type 'SPIN';
--   * regular     = tournament_type 'SNG' with max_players = 2 and no
--     heads-up      satellite target. Every game this platform plays in volume
--                   as 'SNG' is a heads-up match; the 6-max and 9-max Sit and
--                   Gos are satellites;
--   * satellite   = anything carrying a satellite target, or tournament_type
--     feeder        'SATELLITE'. Counted and REPORTED SEPARATELY, because a
--                   feeder exists to fill one named event rather than to be a
--                   price point on the open board;
--   * human-triggered = at least one seat held by a profile with is_horse
--     false. Horse-only = every seat a horse.
--
-- is_horse is read here to IDENTIFY who sat, which CLAUDE.md 10.5 allows as
-- data. It denies a horse nothing: a horse-only board is counted in the total
-- exactly as a human board is, and the split exists because Dan asked which
-- games a person was actually in.
--
-- Bounded: one Chicago day per call, driven by the started_at index, and the
-- caller passes the day. A null day reports the previous Chicago day.
--
-- Measured before writing this (2026-11-07, the baseline day): 6,670 Spins
-- with 1 human-triggered, 5,847 regular heads-up with 0, and 4 satellite
-- feeders. 12,517 combined against a ceiling of 300.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_ca_seat_first_daily_starts(
  p_day date DEFAULT NULL
)
RETURNS TABLE (
  stat_day date,
  kind text,
  starts bigint,
  human_triggered bigint,
  horse_only bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH day AS (
    SELECT COALESCE(
             p_day,
             ((now() AT TIME ZONE 'America/Chicago')::date - 1)
           ) AS d
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
      FROM public.tournaments t, day
     WHERE t.started_at IS NOT NULL
       AND (t.started_at AT TIME ZONE 'America/Chicago')::date = day.d
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
  SELECT (SELECT d FROM day) AS stat_day,
         s.kind,
         count(*)::bigint AS starts,
         count(*) FILTER (WHERE s.had_human)::bigint AS human_triggered,
         count(*) FILTER (WHERE NOT s.had_human)::bigint AS horse_only
    FROM seated s
   GROUP BY s.kind
   ORDER BY s.kind;
$$;

COMMENT ON FUNCTION public.fn_ca_seat_first_daily_starts(date) IS
  'Read-only. Seat-first board STARTS for one America/Chicago day, split by '
  'human-triggered and horse-only, with satellite feeders reported separately. '
  'Reader: the estate digest. Baseline definitions from 2026-11-08.';

GRANT EXECUTE ON FUNCTION public.fn_ca_seat_first_daily_starts(date) TO service_role;

COMMIT;
