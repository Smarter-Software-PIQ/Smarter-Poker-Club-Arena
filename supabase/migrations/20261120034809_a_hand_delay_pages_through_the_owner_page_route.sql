-- 20261120034809_a_hand_delay_pages_through_the_owner_page_route.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A HAND DELAY PAGES THROUGH THE OWNER PAGE ROUTE, NOT AROUND IT
-- (Production Alerts fleet, routing defect hand-delay-owner-page-route).
--
-- WHAT WAS TRUE. 20261119180500 made fn_ca_hand_gap_watch call
-- fn_raise_notification for every senior platform recipient (today: the
-- owner) on EVERY open and EVERY clear of EVERY kind x shape. A delay that
-- flaps around the 250 ms budget therefore opens and clears every 15-30
-- minutes, and each flap was a phone push: 18 owner pages between
-- 2026-11-20 02:01Z and 03:41Z (titles "Unintended Delay Between Hands" and
-- "Hand Delay Cleared", data.source fn_ca_hand_gap_watch), four of them in
-- the same second at 02:46Z (one per shape). None was captured into
-- operational_notification_destinations and every one reached push_outbox,
-- because the watch bypassed the one governed page path:
-- 20261007000420 (a real alert reaches the owner) decides which store rows
-- page, at most once per 3-hour episode per kind with a 12-hour reminder,
-- and reports how many were held. Recoveries never page there.
--
-- WHAT THIS CHANGES (one transaction):
--   1. fn_ca_hand_gap_watch keeps its detector exactly (history rows, ONE
--      critical financial_alerts row per kind x shape after 15 minutes,
--      auto-resolve), and loses both direct notification loops. Its
--      financial_alerts row already reaches public.operational_alert_events
--      as source 'financial-alerts-backfill', alertname
--      'fn_ca_hand_gap_watch', severity 'critical', with the fleet
--      target_task_id (measured: rows 445899..446115).
--   2. The owner page route gains one kind, 'hand_delay', with its own
--      episode clock in ca_owner_page_state, so a hand-delay episode pages
--      once (title "Unintended Delay Between Hands", summary from the
--      alert's own context) and later flaps are held and counted, and it can
--      never consume the 'dealing' clock a stopped table needs.
--   Dan 2026-11-18 ("i just don't want any 'un intended delays'") still gets
--   the page; he no longer gets one per flap or one per recovery.
--
-- Not touched: fn_ca_hand_gap_unintended_delay, the cron job, any player,
-- chip, seat or ledger row. No hot-table lock (ca_owner_page_state has 8
-- rows; no foreign key).
--
-- @probe-exempt: public.fn_ca_a_real_alert_reaches_the_owner trigger function on operational_alert_events, not callable directly; the static plpgsql_check gate and scripts/ci/test-hand-gap-watch.py exercise it
-- @live-proof: (SELECT strpos(pg_get_functiondef('public.fn_ca_hand_gap_watch(timestamp with time zone)'::regprocedure), 'fn_raise_notification') = 0 AND strpos(pg_get_functiondef('public.fn_ca_hand_gap_watch(timestamp with time zone)'::regprocedure), 'paged_via') > 0 AND public.fn_ca_owner_page_kind('financial-alerts-backfill', 'fn_ca_hand_gap_watch', 'critical') = 'hand_delay' AND public.fn_ca_owner_page_kind('cutover-readiness-watch', 'CutoverReadinessAtRisk', 'critical') = 'cutover_readiness' AND EXISTS (SELECT 1 FROM public.ca_owner_page_state WHERE kind = 'hand_delay') AND strpos(pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure), 'WHEN ''hand_delay'' THEN ''Unintended Delay Between Hands''') > 0)

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Pre-image: the watch still carries exactly the two notification loops this
-- file removes, and the page route still ends where 20261119234116 left it.
DO $pre$
DECLARE
  v_watch text := pg_get_functiondef('public.fn_ca_hand_gap_watch(timestamp with time zone)'::regprocedure);
BEGIN
  IF (length(v_watch) - length(replace(v_watch, 'PERFORM public.fn_raise_notification(', '')))
       / length('PERFORM public.fn_raise_notification(') <> 2
     OR strpos(v_watch, '''Hand Delay Cleared''') = 0 THEN
    RAISE EXCEPTION 'HAND_GAP_WATCH_PREIMAGE_CHANGED';
  END IF;
  IF public.fn_ca_owner_page_kind('financial-alerts-backfill', 'fn_ca_hand_gap_watch', 'critical') IS NOT NULL THEN
    RAISE EXCEPTION 'OWNER_PAGE_KIND_PREIMAGE_CHANGED';
  END IF;
  -- The page must never be diverted back into the store by the owner capture.
  IF public.fn_is_owner_operational_notification('47965354-0e56-43ef-931c-ddaab82af765'::uuid, 'system',
       'Unintended Delay Between Hands',
       jsonb_build_object('source', 'owner-real-alert', 'kind', 'hand_delay', 'alert', 'fn_ca_hand_gap_watch')) THEN
    RAISE EXCEPTION 'HAND_DELAY_PAGE_WOULD_BE_DIVERTED';
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
  r record;
  res record;
BEGIN
  INSERT INTO ca_hand_gap_watch_history AS h
         (window_end, window_minutes, kind, shape, graded, hands, gap_p50_ms, owed_p50_ms,
          unintended_p50_ms, unintended_p95_ms, unintended_p99_ms, over_budget, budget_ms)
  SELECT v_end, c_minutes, g.kind, g.shape, g.graded, g.hands, g.gap_p50_ms, g.owed_p50_ms,
         g.unintended_p50_ms, g.unintended_p95_ms, g.unintended_p99_ms, g.over_budget, g.budget_ms
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
           prev2.unintended_p95_ms AS prev2_p95_ms, prev2.hands AS prev2_hands
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
              'history', 'ca_hand_gap_watch_history'))
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
  'Detector (not a repair): records the 5-minute unintended-delay grade per kind x shape into ca_hand_gap_watch_history and raises one critical financial_alerts row per kind x shape whose p95 is over budget for 15 minutes (3 consecutive 5-minute windows, >= 5 graded hands each); auto-resolves it. Pages nobody itself: the owner page route (kind hand_delay) decides the page from the store row (20261120034809). Incident 075013fd lane 3.';

-- The owner page route gains one kind: hand_delay, with its own episode clock.
ALTER TABLE public.ca_owner_page_state DROP CONSTRAINT ca_owner_page_state_kind_check;
ALTER TABLE public.ca_owner_page_state ADD CONSTRAINT ca_owner_page_state_kind_check
  CHECK (kind IN ('dealing', 'restarts', 'money', 'releases', 'daily_window', 'migrations', 'cutover_readiness', 'hand_delay'));
INSERT INTO public.ca_owner_page_state (kind) VALUES ('hand_delay') ON CONFLICT (kind) DO NOTHING;

DO $patch$
DECLARE
  v_kind text := pg_get_functiondef('public.fn_ca_owner_page_kind(text,text,text)'::regprocedure);
  v_page text := pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure);
  c_kind_old constant text := E'THEN ''cutover_readiness''\n  END;';
  c_title_old constant text := E'               WHEN ''cutover_readiness'' THEN ''4 AM Engine Update At Risk''\n';
  c_summary_old constant text := E'  v_summary := left(btrim(COALESCE(\n';
  c_once constant text := 'anchor did not match exactly once';
BEGIN
  IF (length(v_kind) - length(replace(v_kind, c_kind_old, ''))) / length(c_kind_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_owner_page_kind %', c_once;
  END IF;
  IF (length(v_page) - length(replace(v_page, c_title_old, ''))) / length(c_title_old) <> 1
     OR (length(v_page) - length(replace(v_page, c_summary_old, ''))) / length(c_summary_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_a_real_alert_reaches_the_owner %', c_once;
  END IF;
  EXECUTE replace(v_kind, c_kind_old,
    E'THEN ''cutover_readiness''\n    WHEN p_source = ''financial-alerts-backfill'' AND p_alertname = ''fn_ca_hand_gap_watch'' AND p_severity = ''critical'' THEN ''hand_delay''\n  END;');
  v_page := replace(v_page, c_title_old,
    c_title_old || E'               WHEN ''hand_delay'' THEN ''Unintended Delay Between Hands''\n');
  v_page := replace(v_page, c_summary_old,
    c_summary_old
    || E'      NULLIF(CASE WHEN v_kind = ''hand_delay'' THEN format(\n'
    || E'        ''%s %s hands have been delayed for %s minutes (p95 +%s ms over the %s ms budget).'',\n'
    || E'        NEW.payload->''original_event''->''context''->>''kind'', NEW.payload->''original_event''->''context''->>''shape'',\n'
    || E'        NEW.payload->''original_event''->''context''->>''sustained_minutes'',\n'
    || E'        NEW.payload->''original_event''->''context''->>''unintended_p95_ms'',\n'
    || E'        NEW.payload->''original_event''->''context''->>''budget_ms'') END, ''''),\n');
  EXECUTE v_page;
END
$patch$;

-- @probe-for: public.fn_ca_owner_page_kind
-- @probe-for: public.fn_ca_hand_gap_watch
DO $probe$
BEGIN
  IF public.fn_ca_owner_page_kind('financial-alerts-backfill', 'fn_ca_hand_gap_watch', 'critical') IS DISTINCT FROM 'hand_delay'
     OR public.fn_ca_owner_page_kind('financial-alerts-backfill', 'fn_ca_hand_gap_watch', 'warning') IS NOT NULL
     OR public.fn_ca_owner_page_kind('financial-alerts-updates', 'fn_ca_hand_gap_watch', 'critical') IS NOT NULL
     OR public.fn_ca_owner_page_kind('cutover-readiness-watch', 'CutoverReadinessAtRisk', 'critical') IS DISTINCT FROM 'cutover_readiness'
     OR public.fn_ca_owner_page_kind('migration-install-watch', 'MergedMigrationNotInstalled', 'critical') IS DISTINCT FROM 'migrations' THEN
    RAISE EXCEPTION 'fn_ca_owner_page_kind does not map the hand-delay alarm alone';
  END IF;
  PERFORM public.fn_ca_hand_gap_watch();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
