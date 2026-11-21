-- 20261121000757_the_hand_delay_alert_names_where_the_delay_comes_from.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE HAND-DELAY ALERT NAMES WHERE THE DELAY COMES FROM.
--
-- WHAT WAS TRUE. fn_ca_hand_gap_watch pages "Unintended Delay Between Hands
-- Tournament All_In_Showdown Hands Have Been Delayed For 15 Minutes (P95
-- +1160 Ms Over The 250 Ms Budget ...)" and stops there: it says THAT the
-- engine waits, never on WHAT. Every investigation then re-derived the same
-- split by hand. Measured on production 2026-11-20 (tournament hands, 40 min,
-- engine 95dae384): hand_history.cadence.hold_ms equals the grade's owed hold
-- exactly (p50/p95 difference 0), so the grade is right; all-in showdowns
-- WITHOUT a bust had unintended p95 498 ms, all-in showdowns WITH a bust (a
-- players[] entry left at stack 0) 1,783 ms, and engine /health
-- nextHandGap.slowest[].phases showed announce_seat_moves at 1.6-2.2 s on the
-- slowest gaps: post-bust table balancing (incident 1e532243, held by the
-- engine lane; this file does not touch the engine).
--
-- WHAT THIS CHANGES (one transaction; shapes, budgets, thresholds, the
-- constant alert message and the kind x shape dedupe are unchanged, so the
-- history and any open incident stay continuous):
--
--   1. fn_ca_hand_gap_unintended_delay gains eight trailing output columns,
--      per kind x shape over the graded hands of the window:
--        after_bust / _over_budget / _unintended_p95_ms
--          the previous hand left a player at stack 0 (the same someone_busted
--          fact the shape rule already reads);
--        after_seat_move / _over_budget / _unintended_p95_ms
--          a tournament_seat_move_receipts row for this table (as source or
--          destination) with moved_at inside the gap (previous ended_at, next
--          started_at]. Chosen because it is the one seat-move record written
--          on the deal path for every balancing move (490 in the last hour,
--          source_mode live_source), indexed (tournament_id, moved_at), and
--          stamped inside the gap it delayed (measured: 7.5-11 s after
--          ended_at on the slow gaps). Cash seat moves (cash_seat_move_receipts)
--          are player-elected, not balancing, and are not counted;
--        after_bust_and_seat_move_over_budget;
--        neither_unintended_p95_ms (no bust, no seat move).
--      Return type changes, so the function is dropped and re-created from
--      production's own text by exact anchors (each must match once, or the
--      file aborts), which keeps the hand-for-hand exclusion of
--      20261119211558 and every other clause byte-for-byte. Grants and comment
--      are restored. scripts/sql/hand-gap-unintended-delay.sql mirrors it.
--   2. ca_hand_gap_watch_history gains the same eight nullable columns (a
--      small detector table written once per 5 minutes; no hot-table lock).
--   3. fn_ca_hand_gap_watch records them and, when it opens an alert, puts the
--      split into the alert context (over-budget counts summed over the three
--      windows, p95s of the latest window) plus one sentence, 'attribution',
--      e.g. "Over budget in 15 min: 23 hands; 87% after a bust, 74% after a
--      tournament seat move, 70% both. Latest 5 min p95 +1783 ms after a
--      bust, +498 ms after neither." Windows recorded before this file carry
--      no split and are left out of the sums, never counted as zero.
--   4. The owner page route's hand_delay summary appends that sentence, so
--      the page itself names where to start.
--
-- Pinned by tests/the-hand-delay-alert-names-where-the-delay-comes-from.law.test.ts;
-- proved on PostgreSQL by scripts/ci/test-hand-gap-watch.py.
--
-- @probe-exempt: public.fn_ca_a_real_alert_reaches_the_owner trigger function on operational_alert_events, not callable directly; scripts/ci/test-hand-gap-watch.py pages through it with the attribution sentence
-- @live-proof: (SELECT (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.ca_hand_gap_watch_history'::regclass AND NOT a.attisdropped AND a.attname IN ('after_bust', 'after_bust_over_budget', 'after_bust_unintended_p95_ms', 'after_seat_move', 'after_seat_move_over_budget', 'after_seat_move_unintended_p95_ms', 'after_bust_and_seat_move_over_budget', 'neither_unintended_p95_ms')) = 8 AND strpos(pg_get_function_result('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure), 'neither_unintended_p95_ms integer') > 0 AND strpos(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure), 'FROM tournament_seat_move_receipts mv') > 0 AND strpos(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure), 'ca_tournament_hand_for_hand') > 0 AND strpos(pg_get_functiondef('public.fn_ca_hand_gap_watch(timestamp with time zone)'::regprocedure), '''attribution'', v_attr') > 0 AND strpos(pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure), '''context''->>''attribution''') > 0)

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. The grader carries the split. Re-created from production's own text.
DO $grade$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure);
  v_new text;
  c_once constant text := 'fn_ca_hand_gap_unintended_delay anchor did not match exactly once: ';
  -- Each anchor and its replacement. The replacement always contains its anchor.
  c_ret_old  constant text := 'over_budget integer, budget_ms integer)';
  c_ret_new  constant text := 'over_budget integer, budget_ms integer, after_bust integer, after_bust_over_budget integer, '
    || 'after_bust_unintended_p95_ms integer, after_seat_move integer, after_seat_move_over_budget integer, '
    || 'after_seat_move_unintended_p95_ms integer, after_bust_and_seat_move_over_budget integer, neither_unintended_p95_ms integer)';
  c_pair_old constant text := 'SELECT p.*, nx.started_at AS next_start, nx.next_cadence' || chr(10);
  c_pair_new constant text := 'SELECT p.*, nx.started_at AS next_start, nx.next_cadence, nx.table_id' || chr(10);
  c_fact_old constant text := 'AS has_cadence' || chr(10) || '  FROM pair' || chr(10);
  c_fact_new constant text := 'AS has_cadence,' || chr(10)
    || '         EXISTS (SELECT 1 FROM tournament_seat_move_receipts mv' || chr(10)
    || '                  WHERE mv.tournament_id = pair.tournament_id' || chr(10)
    || '                    AND mv.moved_at > pair.ended_at AND mv.moved_at <= pair.next_start' || chr(10)
    || '                    AND (mv.source_table_id = pair.table_id OR mv.destination_table_id = pair.table_id)) AS seat_moved' || chr(10)
    || '  FROM pair' || chr(10);
  c_shape_old constant text := 'SELECT s.tournament_id IS NOT NULL AS tournament, s.gap_ms,' || chr(10);
  c_shape_new constant text := 'SELECT s.tournament_id IS NOT NULL AS tournament, s.gap_ms, s.someone_busted, s.seat_moved,' || chr(10);
  c_out_old  constant text := '       min(budget_ms)::int AS budget_ms' || chr(10) || '  FROM shaped' || chr(10);
  c_out_new  constant text := '       min(budget_ms)::int AS budget_ms,' || chr(10)
    || '       count(*) FILTER (WHERE row_graded AND someone_busted)::int AS after_bust,' || chr(10)
    || '       count(*) FILTER (WHERE row_graded AND someone_busted AND gap_ms - owed_ms > budget_ms)::int AS after_bust_over_budget,' || chr(10)
    || '       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded AND someone_busted))::int AS after_bust_unintended_p95_ms,' || chr(10)
    || '       count(*) FILTER (WHERE row_graded AND seat_moved)::int AS after_seat_move,' || chr(10)
    || '       count(*) FILTER (WHERE row_graded AND seat_moved AND gap_ms - owed_ms > budget_ms)::int AS after_seat_move_over_budget,' || chr(10)
    || '       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded AND seat_moved))::int AS after_seat_move_unintended_p95_ms,' || chr(10)
    || '       count(*) FILTER (WHERE row_graded AND someone_busted AND seat_moved AND gap_ms - owed_ms > budget_ms)::int AS after_bust_and_seat_move_over_budget,' || chr(10)
    || '       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded AND NOT someone_busted AND NOT seat_moved))::int AS neither_unintended_p95_ms' || chr(10)
    || '  FROM shaped' || chr(10);
  v_anchor text;
BEGIN
  FOREACH v_anchor IN ARRAY ARRAY[c_ret_old, c_pair_old, c_fact_old, c_shape_old, c_out_old] LOOP
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION '% %', c_once, v_anchor;
    END IF;
  END LOOP;
  IF strpos(v_def, 'seat_moved') > 0 THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay already carries the seat-move split';
  END IF;
  v_new := replace(v_def, c_ret_old, c_ret_new);
  v_new := replace(v_new, c_pair_old, c_pair_new);
  v_new := replace(v_new, c_fact_old, c_fact_new);
  v_new := replace(v_new, c_shape_old, c_shape_new);
  v_new := replace(v_new, c_out_old, c_out_new);
  -- A changed return type cannot be replaced in place.
  DROP FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int);
  EXECUTE v_new;
END
$grade$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;

COMMENT ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) IS
  'Read-only grade of scripts/sql/hand-gap-unintended-delay.sql for one window: per kind x shape p50/p95/p99 unintended delay between hands and over-budget count, grading cash_bust and rit hands when hand_history.cadence is recorded, plus the split by a bust on the previous hand and a tournament seat move inside the gap (20261121000757). Incident 075013fd lane 3.';

-- 2. The history keeps the split per window.
ALTER TABLE public.ca_hand_gap_watch_history
  ADD COLUMN IF NOT EXISTS after_bust integer,
  ADD COLUMN IF NOT EXISTS after_bust_over_budget integer,
  ADD COLUMN IF NOT EXISTS after_bust_unintended_p95_ms integer,
  ADD COLUMN IF NOT EXISTS after_seat_move integer,
  ADD COLUMN IF NOT EXISTS after_seat_move_over_budget integer,
  ADD COLUMN IF NOT EXISTS after_seat_move_unintended_p95_ms integer,
  ADD COLUMN IF NOT EXISTS after_bust_and_seat_move_over_budget integer,
  ADD COLUMN IF NOT EXISTS neither_unintended_p95_ms integer;

-- 3. The watch records the split and names it in the alert it opens.
DO $pre$
DECLARE
  v_watch text := pg_get_functiondef('public.fn_ca_hand_gap_watch(timestamp with time zone)'::regprocedure);
BEGIN
  IF strpos(v_watch, '''paged_via'', ''operational_alert_events''') = 0
     OR strpos(v_watch, 'fn_raise_notification') > 0
     OR strpos(v_watch, 'v_attr') > 0 THEN
    RAISE EXCEPTION 'HAND_GAP_WATCH_PREIMAGE_CHANGED';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.fn_ca_hand_gap_watch(p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
SET lock_timeout TO '2s'
AS $f$
DECLARE
  c_source   constant text     := 'fn_ca_hand_gap_watch';
  c_minutes  constant int      := 5;
  c_windows  constant int      := 3;   -- 15 minutes = 3 consecutive 5-minute windows
  c_min_n    constant int      := 5;   -- graded hands a window needs before its p95 counts
  c_quiet    constant interval := interval '30 minutes';
  c_keep     constant interval := interval '30 days';
  v_end      timestamptz := date_trunc('hour', p_at)
                            + floor(extract(minute FROM p_at) / 5) * interval '5 minutes';
  v_prev1    timestamptz := v_end - interval '5 minutes';
  v_prev2    timestamptz := v_end - interval '10 minutes';
  v_recorded int := 0; v_breaching int := 0; v_new int := 0; v_resolved int := 0;
  v_alert_id uuid;
  v_split_windows int; v_over int; v_bust int; v_move int; v_both int;
  v_attr     text;
  r record;
  res record;
BEGIN
  INSERT INTO ca_hand_gap_watch_history AS h
         (window_end, window_minutes, kind, shape, graded, hands, gap_p50_ms, owed_p50_ms,
          unintended_p50_ms, unintended_p95_ms, unintended_p99_ms, over_budget, budget_ms,
          after_bust, after_bust_over_budget, after_bust_unintended_p95_ms,
          after_seat_move, after_seat_move_over_budget, after_seat_move_unintended_p95_ms,
          after_bust_and_seat_move_over_budget, neither_unintended_p95_ms)
  SELECT v_end, c_minutes, g.kind, g.shape, g.graded, g.hands, g.gap_p50_ms, g.owed_p50_ms,
         g.unintended_p50_ms, g.unintended_p95_ms, g.unintended_p99_ms, g.over_budget, g.budget_ms,
         g.after_bust, g.after_bust_over_budget, g.after_bust_unintended_p95_ms,
         g.after_seat_move, g.after_seat_move_over_budget, g.after_seat_move_unintended_p95_ms,
         g.after_bust_and_seat_move_over_budget, g.neither_unintended_p95_ms
    FROM fn_ca_hand_gap_unintended_delay(v_end, c_minutes) g
  ON CONFLICT (window_end, kind, shape) DO NOTHING;
  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  -- Resolve (CLEAR): the shape's latest window with enough graded hands is back
  -- under the budget, or the shape has had no such window for 30 minutes.
  -- The watch pages nobody itself: the resolved row reaches the private alert
  -- store through the financial_alerts capture, like every other detector.
  FOR res IN
    WITH done AS (
      UPDATE financial_alerts fa
         SET resolved = true, resolved_at = now(),
             resolution = CASE WHEN l.kind IS NULL
               THEN 'no graded windows with >= ' || c_min_n || ' hands for 30 minutes for '
                    || COALESCE(fa.context->>'kind', '?') || ' ' || COALESCE(fa.context->>'shape', '?')
               ELSE 'unintended p95 back within the ' || l.budget_ms || ' ms budget for ' || l.kind || ' ' || l.shape
             END
        FROM (SELECT DISTINCT ON (fa2.id) fa2.id, x.kind, x.shape, x.budget_ms, x.unintended_p95_ms
                FROM financial_alerts fa2
                LEFT JOIN ca_hand_gap_watch_history x
                  ON x.kind = fa2.context->>'kind' AND x.shape = fa2.context->>'shape'
                 AND x.graded AND x.hands >= c_min_n
                 AND x.window_end > v_end - c_quiet AND x.window_end <= v_end
               WHERE fa2.source = c_source AND NOT fa2.resolved
               ORDER BY fa2.id, x.window_end DESC NULLS LAST) l
       WHERE fa.id = l.id
         AND (l.kind IS NULL OR l.unintended_p95_ms <= l.budget_ms)
      RETURNING fa.id,
                COALESCE(fa.context->>'kind', l.kind, '?') AS kind,
                COALESCE(fa.context->>'shape', l.shape, '?') AS shape,
                l.unintended_p95_ms,
                COALESCE(l.budget_ms, (fa.context->>'budget_ms')::int, 250) AS budget_ms,
                (l.kind IS NULL) AS quiet_timeout)
    SELECT * FROM done
  LOOP
    v_resolved := v_resolved + 1;
  END LOOP;

  -- Open: sustained unintended delay lasting 15 minutes (3 consecutive 5-minute
  -- windows: v_end, v_prev1, v_prev2), each with >= 5 graded hands and p95 > budget.
  -- Raises ONE critical financial_alerts row. The page, if any, is decided by the
  -- owner page route (fn_ca_owner_page_kind 'hand_delay'), never here.
  FOR r IN
    SELECT cur.*,
           prev1.unintended_p95_ms AS prev1_p95_ms, prev1.hands AS prev1_hands,
           prev2.unintended_p95_ms AS prev2_p95_ms, prev2.hands AS prev2_hands,
           prev1.over_budget AS prev1_over, prev1.after_bust_over_budget AS prev1_bust_over,
           prev1.after_seat_move_over_budget AS prev1_move_over,
           prev1.after_bust_and_seat_move_over_budget AS prev1_both_over,
           prev2.over_budget AS prev2_over, prev2.after_bust_over_budget AS prev2_bust_over,
           prev2.after_seat_move_over_budget AS prev2_move_over,
           prev2.after_bust_and_seat_move_over_budget AS prev2_both_over
      FROM ca_hand_gap_watch_history cur
      JOIN ca_hand_gap_watch_history prev1
        ON prev1.window_end = v_prev1 AND prev1.kind = cur.kind AND prev1.shape = cur.shape
      JOIN ca_hand_gap_watch_history prev2
        ON prev2.window_end = v_prev2 AND prev2.kind = cur.kind AND prev2.shape = cur.shape
     WHERE cur.window_end = v_end
       AND cur.graded   AND cur.hands   >= c_min_n AND cur.unintended_p95_ms   > cur.budget_ms
       AND prev1.graded AND prev1.hands >= c_min_n AND prev1.unintended_p95_ms > prev1.budget_ms
       AND prev2.graded AND prev2.hands >= c_min_n AND prev2.unintended_p95_ms > prev2.budget_ms
     ORDER BY cur.unintended_p95_ms DESC, cur.kind, cur.shape
  LOOP
    v_breaching := v_breaching + 1;
    CONTINUE WHEN EXISTS (SELECT 1 FROM financial_alerts fa
                           WHERE fa.source = c_source AND NOT fa.resolved
                             AND fa.context->>'kind' = r.kind AND fa.context->>'shape' = r.shape);

    -- Where the delay comes from: over-budget hands of the breached windows that
    -- followed a bust, a tournament seat move, or both. A window recorded before
    -- 20261121000757 carries no split and is left out, never counted as zero.
    v_split_windows := (r.after_bust_over_budget IS NOT NULL)::int
                     + (r.prev1_bust_over IS NOT NULL)::int + (r.prev2_bust_over IS NOT NULL)::int;
    v_over := CASE WHEN r.after_bust_over_budget IS NOT NULL THEN COALESCE(r.over_budget, 0) ELSE 0 END
            + CASE WHEN r.prev1_bust_over IS NOT NULL THEN COALESCE(r.prev1_over, 0) ELSE 0 END
            + CASE WHEN r.prev2_bust_over IS NOT NULL THEN COALESCE(r.prev2_over, 0) ELSE 0 END;
    v_bust := COALESCE(r.after_bust_over_budget, 0) + COALESCE(r.prev1_bust_over, 0) + COALESCE(r.prev2_bust_over, 0);
    v_move := COALESCE(r.after_seat_move_over_budget, 0) + COALESCE(r.prev1_move_over, 0) + COALESCE(r.prev2_move_over, 0);
    v_both := COALESCE(r.after_bust_and_seat_move_over_budget, 0) + COALESCE(r.prev1_both_over, 0) + COALESCE(r.prev2_both_over, 0);
    v_attr := CASE WHEN v_split_windows > 0 AND v_over > 0 THEN format(
      'Over budget in %s min: %s hands; %s%% after a bust, %s%% after a tournament seat move, %s%% both. Latest 5 min p95 %s after a bust, %s after neither.',
      v_split_windows * c_minutes, v_over,
      round(100.0 * v_bust / v_over)::int, round(100.0 * v_move / v_over)::int, round(100.0 * v_both / v_over)::int,
      COALESCE(CASE WHEN r.after_bust_unintended_p95_ms >= 0 THEN '+' ELSE '' END || r.after_bust_unintended_p95_ms || ' ms', 'n/a'),
      COALESCE(CASE WHEN r.neither_unintended_p95_ms >= 0 THEN '+' ELSE '' END || r.neither_unintended_p95_ms || ' ms', 'n/a'))
    END;

    INSERT INTO financial_alerts (severity, source, message, context)
    VALUES ('critical', c_source,
            'Unintended delay between hands: for three consecutive 5-minute windows (15 minutes), the p95 of the gap between hands beyond the beats the hand is owed is over the engine budget. Something the engine waits on between hands is not an intended animation or pause.',
            jsonb_build_object(
              'kind', r.kind, 'shape', r.shape, 'window_end', r.window_end, 'window_minutes', r.window_minutes,
              'consecutive_windows', c_windows, 'sustained_minutes', c_windows * c_minutes,
              'hands', r.hands, 'gap_p50_ms', r.gap_p50_ms, 'owed_p50_ms', r.owed_p50_ms,
              'unintended_p50_ms', r.unintended_p50_ms, 'unintended_p95_ms', r.unintended_p95_ms,
              'unintended_p99_ms', r.unintended_p99_ms, 'over_budget', r.over_budget,
              'budget_ms', r.budget_ms,
              'previous_window_p95_ms', r.prev1_p95_ms, 'previous_window_hands', r.prev1_hands,
              'two_windows_ago_p95_ms', r.prev2_p95_ms, 'two_windows_ago_hands', r.prev2_hands,
              'grade', 'scripts/sql/hand-gap-unintended-delay.sql',
              'history', 'ca_hand_gap_watch_history')
            || jsonb_build_object(
              'attribution', v_attr,
              'attribution_minutes', v_split_windows * c_minutes,
              'over_budget_attributed', v_over,
              'over_budget_after_bust', v_bust,
              'over_budget_after_seat_move', v_move,
              'over_budget_after_bust_and_seat_move', v_both,
              'after_bust', r.after_bust,
              'after_bust_unintended_p95_ms', r.after_bust_unintended_p95_ms,
              'after_seat_move', r.after_seat_move,
              'after_seat_move_unintended_p95_ms', r.after_seat_move_unintended_p95_ms,
              'neither_unintended_p95_ms', r.neither_unintended_p95_ms))
    RETURNING id INTO v_alert_id;
    v_new := v_new + 1;

  END LOOP;

  DELETE FROM ca_hand_gap_watch_history WHERE window_end < v_end - c_keep;

  RETURN jsonb_build_object(
    'window_end', v_end, 'recorded', v_recorded, 'breaching', v_breaching,
    'opened', v_new, 'resolved', v_resolved,
    'paged_via', 'operational_alert_events',
    'checked_at', now());
END
$f$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_watch(timestamptz) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_ca_hand_gap_watch(timestamptz) IS
  'Detector (not a repair): records the 5-minute unintended-delay grade per kind x shape into ca_hand_gap_watch_history and raises one critical financial_alerts row per kind x shape whose p95 is over budget for 15 minutes (3 consecutive 5-minute windows, >= 5 graded hands each); auto-resolves it. The alert context names where the delay comes from (after a bust, after a tournament seat move, both; 20261121000757). Pages nobody itself: the owner page route (kind hand_delay) decides the page from the store row (20261120034809). Incident 075013fd lane 3.';

-- 4. The owner's page carries the attribution sentence.
DO $patch$
DECLARE
  v_page text := pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure);
  c_fmt_old constant text := E'''%s %s hands have been delayed for %s minutes (p95 +%s ms over the %s ms budget).'',\n';
  c_fmt_new constant text := E'''%s %s hands have been delayed for %s minutes (p95 +%s ms over the %s ms budget).%s'',\n';
  c_arg_old constant text := E'NEW.payload->''original_event''->''context''->>''budget_ms'') END, ''''),\n';
  c_arg_new constant text := E'NEW.payload->''original_event''->''context''->>''budget_ms'',\n'
    || E'        COALESCE('' '' || NULLIF(NEW.payload->''original_event''->''context''->>''attribution'', ''''), '''')) END, ''''),\n';
BEGIN
  IF (length(v_page) - length(replace(v_page, c_fmt_old, ''))) / length(c_fmt_old) <> 1
     OR (length(v_page) - length(replace(v_page, c_arg_old, ''))) / length(c_arg_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_a_real_alert_reaches_the_owner hand_delay summary anchor did not match exactly once';
  END IF;
  v_page := replace(v_page, c_fmt_old, c_fmt_new);
  v_page := replace(v_page, c_arg_old, c_arg_new);
  EXECUTE v_page;
END
$patch$;

-- @probe-for: public.fn_ca_hand_gap_unintended_delay
-- @probe-for: public.fn_ca_hand_gap_watch
DO $probe$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.fn_ca_hand_gap_unintended_delay(now(), 5) g
   WHERE g.after_bust IS NULL OR g.after_seat_move IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'the split counts must never be NULL (% rows)', v_n;
  END IF;
  PERFORM public.fn_ca_hand_gap_watch();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
