-- 20261123163000_weekly_split_parts_per_window_invalidation.sql
--
-- ROOT CAUSE (Incident 6377941a - WeeklyPayoutNotReadyHalfHourBefore, 2026-11-23):
-- On Monday 2026-11-23, weekly-prep-shard-0..3 completed the first full pass of
-- the 2026-11-16..2026-11-23 close in ~35 minutes (reaching r3 83 at 08:30Z,
-- a full hour before the 09:30Z / 03:30 CST readiness check). However, whenever
-- a late closed-week source arrived in window 83 (06:00Z..08:00Z - e.g. an
-- overnight tournament settling after 08:00Z, culminating at 11:00:57Z),
-- smarter_private.weekly_refresh_changed_payout_windows and
-- public.fn_rakeback_recompute_split deleted ALL 114+ rows in
-- public.accounting_recompute_split_parts for the club (all 84 two-hour counts
-- windows and all 28 six-hour tq windows), even though
-- own_agent_clean_windows, earned_plan_window, round2_*_window and
-- round3_*_window were already invalidated per canonical two-hour window.
-- This triggered seven full club-week rebuilds (2,958 prep units instead of
-- ~735) and delayed Monday payout readiness from ~08:35Z to 11:47Z.
--
-- PERMANENT FIX:
-- 1. smarter_private.weekly_refresh_changed_payout_windows now deletes only the
--    affected 2h counts part(s) and 6h tq part(s) matching each changed
--    window_start in smarter_private.weekly_payout_source_changes, plus
--    players/check/write (which depend on whole-week aggregates), preserving
--    all unchanged counts and tq windows.
-- 2. public.fn_rakeback_recompute_split keeps whole-week invalidation for
--    structural expiry (oldest < v_to, oldest < clock_timestamp() - 12h, or
--    mismatched period_end), and replaces the whole-week late-source wipe with
--    per-window invalidation: late cash sources invalidate only the affected 2h
--    counts window(s) (+/- 1 minute boundary margin) plus players/check/write;
--    late tournament fee sources invalidate only the affected 6h tq window(s)
--    (w.we > GREATEST(f.charged_at, v_from)) plus players/check/write - never
--    wiping all 84 cash counts windows on a late tournament settlement.
--
-- @live-proof: (SELECT position('PER-WINDOW SPLIT-PART INVALIDATION (20261123)' IN pg_get_functiondef('smarter_private.weekly_refresh_changed_payout_windows(text,uuid,timestamptz,timestamptz)'::regprocedure)) > 0 AND position('PER-WINDOW SPLIT-PART INVALIDATION (20261123)' IN pg_get_functiondef('public.fn_rakeback_recompute_split(uuid,date,date)'::regprocedure)) > 0 AND NOT has_function_privilege('anon', 'smarter_private.weekly_refresh_changed_payout_windows(text,uuid,timestamptz,timestamptz)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_rakeback_recompute_split(uuid,date,date)', 'EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

CREATE OR REPLACE FUNCTION smarter_private.weekly_refresh_changed_payout_windows(
  p_kind text,
  p_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $f$
-- PER-WINDOW SPLIT-PART INVALIDATION (20261123): invalidate only the affected
-- 2h counts and 6h tq split parts (plus players/check/write) when a closed-week
-- source changes, matching the per-window invalidation already used for
-- own_agent_clean_windows and accounting_close_partials.
DECLARE
  c record;
  start_day date := (p_start AT TIME ZONE 'America/Los_Angeles')::date;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM smarter_private.weekly_payout_source_changes l
     WHERE (l.scope_kind, l.scope_id, l.period_start) = (p_kind, p_id, p_start)
  ) THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      CASE WHEN p_kind = 'union' THEN 'union-accounting:' ELSE 'club-accounting:' END
        || p_id::text || ':' || extract(epoch FROM p_start)::text || ':' || extract(epoch FROM p_end)::text,
      0
    )
  );
  IF smarter_private.weekly_payout_has_posted(p_kind, p_id, p_start, p_end) THEN
    RETURN;
  END IF;
  -- A late recognition may credit a charge recorded days earlier. Wake only the
  -- actual beneficiary club's calculator, and drop only the affected windows
  -- plus aggregate/check/write stages so unchanged 2h/6h windows stay cached.
  FOR c IN
    SELECT l.calculator_club AS id, max(l.changed_at) AS changed_at
      FROM smarter_private.weekly_payout_source_changes l
     WHERE (l.scope_kind, l.scope_id, l.period_start) = (p_kind, p_id, p_start)
       AND l.affects_calculation
     GROUP BY l.calculator_club
     ORDER BY l.calculator_club
  LOOP
    IF pg_try_advisory_xact_lock(
      hashtextextended('accounting_rakeback_period:' || c.id::text || ':' || start_day::text, 0)
    ) THEN
      WITH counts_wins AS (
        SELECT (row_number() OVER (ORDER BY g) - 1)::int AS part,
               g AS ws,
               LEAST(g + interval '2 hours', p_end) AS we
          FROM generate_series(p_start, p_end - interval '1 microsecond', interval '2 hours') g
      ),
      tq_wins AS (
        SELECT (row_number() OVER (ORDER BY g) - 1)::int AS part,
               g AS ws,
               LEAST(g + interval '6 hours', p_end) AS we
          FROM generate_series(p_start, p_end - interval '1 microsecond', interval '6 hours') g
      ),
      changed_wins AS (
        SELECT l.window_start, max(l.changed_at) AS changed_at
          FROM smarter_private.weekly_payout_source_changes l
         WHERE (l.scope_kind, l.scope_id, l.period_start, l.calculator_club) = (p_kind, p_id, p_start, c.id)
           AND l.affects_calculation
         GROUP BY l.window_start
      ),
      stale_parts AS (
        SELECT sp.kind, sp.part
          FROM public.accounting_recompute_split_parts sp
          JOIN counts_wins cwin ON sp.kind = 'counts' AND sp.part = cwin.part
          JOIN changed_wins chg ON chg.window_start >= cwin.ws AND chg.window_start < cwin.we
         WHERE sp.club_id = c.id
           AND sp.period_start = start_day
           AND sp.computed_at <= chg.changed_at
        UNION ALL
        SELECT sp.kind, sp.part
          FROM public.accounting_recompute_split_parts sp
          JOIN tq_wins twin ON sp.kind = 'tq' AND sp.part = twin.part
          JOIN changed_wins chg ON chg.window_start >= twin.ws AND chg.window_start < twin.we
         WHERE sp.club_id = c.id
           AND sp.period_start = start_day
           AND sp.computed_at <= chg.changed_at
        UNION ALL
        SELECT sp.kind, sp.part
          FROM public.accounting_recompute_split_parts sp
         WHERE sp.club_id = c.id
           AND sp.period_start = start_day
           AND sp.kind IN ('players', 'check', 'write')
           AND sp.computed_at <= c.changed_at
      )
      DELETE FROM public.accounting_recompute_split_parts sp
       USING stale_parts d
       WHERE sp.club_id = c.id
         AND sp.period_start = start_day
         AND sp.kind = d.kind
         AND sp.part = d.part;

      UPDATE public.accounting_period_recompute_requests q
         SET status = 'pending',
             last_requested_at = clock_timestamp()
       WHERE q.club_id = c.id
         AND q.period_start = start_day
         AND q.period_end = start_day + 6
         AND q.last_requested_at < c.changed_at
         AND (q.attempted_at IS NULL OR q.attempted_at <= c.changed_at);
    END IF;
  END LOOP;

  DELETE FROM smarter_private.own_agent_clean_windows v
   USING smarter_private.weekly_payout_source_changes l
   WHERE (v.scope_kind, v.scope_id, v.period_start, v.period_end) = (p_kind, p_id, p_start, p_end)
     AND (l.scope_kind, l.scope_id, l.period_start, l.window_start) = (p_kind, p_id, p_start, v.window_start)
     AND v.checked_at <= l.changed_at;

  DELETE FROM public.accounting_close_partials p
   USING smarter_private.weekly_payout_source_changes l
   WHERE (l.scope_kind, l.scope_id, l.period_start) = (p_kind, p_id, p_start)
     AND (p.union_id, p.period_start, p.period_end, p.window_start) = (p_id, p_start, p_end, l.window_start)
     AND p.computed_at <= l.changed_at
     AND (
       p.kind IN ('round2_' || p_kind || '_window', 'round3_' || p_kind || '_window')
       OR (p_kind = 'union' AND p.kind = 'earned_plan_window')
     );
END
$f$;

REVOKE ALL ON FUNCTION smarter_private.weekly_refresh_changed_payout_windows(text, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

DO $patch_split$
DECLARE
  v_sig regprocedure := 'public.fn_rakeback_recompute_split(uuid,date,date)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old text := $old$ SELECT min(computed_at) INTO oldest FROM public.accounting_recompute_split_parts
  WHERE club_id=p_club_id AND period_start=p_period_start;
 IF oldest IS NOT NULL AND (oldest<v_to OR oldest<clock_timestamp()-interval '12 hours'
   OR EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND period_end<>p_period_end)
   OR EXISTS(SELECT 1 FROM (
     SELECT s.earned_at FROM public.accounting_cash_rake_sources s
     WHERE s.club_id=p_club_id AND s.recorded_at>oldest-interval '1 minute' OFFSET 0
    ) s WHERE s.earned_at>=v_from AND s.earned_at<v_to)
   OR EXISTS(SELECT 1 FROM (
     SELECT a.source_id FROM public.accounting_cash_atomic_contract_admissions a
     WHERE a.admitted_at>oldest-interval '1 minute' OFFSET 0
    ) a CROSS JOIN LATERAL (
     SELECT s.club_id,s.earned_at FROM public.accounting_cash_rake_sources s WHERE s.id=a.source_id OFFSET 0
    ) s WHERE s.club_id=p_club_id AND s.earned_at>=v_from AND s.earned_at<v_to)
   OR EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources f
     WHERE f.club_id=p_club_id AND f.charged_at<v_to AND f.recorded_at>oldest-interval '1 minute')) THEN
  DELETE FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start;
 END IF;$old$;
  v_new text := $new$ -- PER-WINDOW SPLIT-PART INVALIDATION (20261123): structural expiry clears
 -- the club-week; a late cash or tournament source invalidates only its
 -- affected 2h counts / 6h tq window(s) plus players/check/write so unchanged
 -- windows of the 7-day week are preserved (incident 6377941a).
 SELECT min(computed_at) INTO oldest FROM public.accounting_recompute_split_parts
  WHERE club_id=p_club_id AND period_start=p_period_start;
 IF oldest IS NOT NULL AND (oldest<v_to OR oldest<clock_timestamp()-interval '12 hours'
   OR EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND period_end<>p_period_end)) THEN
  DELETE FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start;
 ELSIF oldest IS NOT NULL THEN
  WITH cash_changes AS MATERIALIZED (
    SELECT s.earned_at, s.recorded_at AS changed_at
      FROM (
        SELECT s.earned_at, s.recorded_at
          FROM public.accounting_cash_rake_sources s
         WHERE s.club_id=p_club_id AND s.recorded_at>oldest-interval '1 minute' OFFSET 0
      ) s
     WHERE s.earned_at>=v_from AND s.earned_at<v_to
    UNION ALL
    SELECT s.earned_at, a.admitted_at AS changed_at
      FROM (
        SELECT a.source_id, a.admitted_at
          FROM public.accounting_cash_atomic_contract_admissions a
         WHERE a.admitted_at>oldest-interval '1 minute' OFFSET 0
      ) a
      CROSS JOIN LATERAL (
        SELECT s.club_id, s.earned_at
          FROM public.accounting_cash_rake_sources s
         WHERE s.id=a.source_id OFFSET 0
      ) s
     WHERE s.club_id=p_club_id AND s.earned_at>=v_from AND s.earned_at<v_to
  ),
  tourney_changes AS MATERIALIZED (
    SELECT f.charged_at, f.recorded_at AS changed_at
      FROM public.accounting_tournament_fee_sources f
     WHERE f.club_id=p_club_id AND f.charged_at<v_to AND f.recorded_at>oldest-interval '1 minute'
  ),
  counts_wins AS (
    SELECT (row_number() OVER(ORDER BY g)-1)::int AS part,
           g AS ws,
           LEAST(g+interval '2 hours', v_to) AS we
      FROM generate_series(v_from, v_to-interval '1 microsecond', interval '2 hours') g
  ),
  tq_wins AS (
    SELECT (row_number() OVER(ORDER BY g)-1)::int AS part,
           g AS ws,
           LEAST(g+interval '6 hours', v_to) AS we
      FROM generate_series(v_from, v_to-interval '1 microsecond', interval '6 hours') g
  ),
  stale_parts AS (
    SELECT sp.kind, sp.part
      FROM public.accounting_recompute_split_parts sp
      JOIN counts_wins cwin ON sp.kind='counts' AND sp.part=cwin.part
     WHERE sp.club_id=p_club_id AND sp.period_start=p_period_start
       AND EXISTS(SELECT 1 FROM cash_changes cc
                   WHERE cc.earned_at>=cwin.ws-interval '1 minute'
                     AND cc.earned_at<cwin.we+interval '1 minute'
                     AND cc.changed_at>sp.computed_at-interval '1 minute')
    UNION ALL
    SELECT sp.kind, sp.part
      FROM public.accounting_recompute_split_parts sp
      JOIN tq_wins twin ON sp.kind='tq' AND sp.part=twin.part
     WHERE sp.club_id=p_club_id AND sp.period_start=p_period_start
       AND EXISTS(SELECT 1 FROM tourney_changes tc
                   WHERE twin.we>GREATEST(tc.charged_at, v_from)
                     AND tc.changed_at>sp.computed_at-interval '1 minute')
    UNION ALL
    SELECT sp.kind, sp.part
      FROM public.accounting_recompute_split_parts sp
     WHERE sp.club_id=p_club_id AND sp.period_start=p_period_start
       AND sp.kind IN ('players','check','write')
       AND (EXISTS(SELECT 1 FROM cash_changes cc WHERE cc.changed_at>sp.computed_at-interval '1 minute')
         OR EXISTS(SELECT 1 FROM tourney_changes tc WHERE tc.changed_at>sp.computed_at-interval '1 minute'))
  )
  DELETE FROM public.accounting_recompute_split_parts sp
   USING stale_parts d
   WHERE sp.club_id=p_club_id AND sp.period_start=p_period_start AND sp.kind=d.kind AND sp.part=d.part;
 END IF;$new$;
  v_hits integer;
BEGIN
  IF strpos(v_def, 'PER-WINDOW SPLIT-PART INVALIDATION (20261123)') > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'weekly_split_parts_invalidation_anchor_changed: hits=%', v_hits USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_split$;

REVOKE ALL ON FUNCTION public.fn_rakeback_recompute_split(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rakeback_recompute_split(uuid, date, date) TO service_role;

COMMIT;
