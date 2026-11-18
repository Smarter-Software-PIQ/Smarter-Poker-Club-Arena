-- 20261118084759_post_commit_lag_warns_before_the_cascade.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- POST-COMMIT LAG WARNS BEFORE THE CASCADE (incident 075013fd, lane F, G2)
--
-- WHAT WAS TRUE. The only database signal for a slow hand continuation is
-- fn_post_commit_stranded_watchdog: a committed hand whose post-commit work
-- is still not done TEN MINUTES later. On 2026-11-17 it paged once, at 23:30
-- UTC. Read back from hand_atomic_commits (read-only, 2026-11-18), the
-- per-table p95 of committed_at -> post_commit_completed_at over 5-minute
-- buckets was above the owner's 2 s hand-gap limit on 16 tables in the 15:00
-- UTC hour and on 51 in the 18:00 hour, and above 15 s from 19:00 UTC (6
-- buckets, then 37, 56, 126, 198 an hour): the cascade was visible in the
-- data four to eight hours before anything paged, while the engine filed
-- 9,079 LightningHandHost.post_commit_obligations_pending rows.
--
-- WHAT THIS ADDS. A DETECTOR, not a repair (CLAUDE.md 10.11/10.12): it
-- writes financial_alerts rows and nothing else, touches no money, re-drives
-- nothing, and the stranded watchdog stays exactly as #11266 leaves it.
--
--   fn_ca_post_commit_lag_watch(), every minute (job post-commit-lag-watch-1m):
--   for each table, the hands committed in the last 5 minutes plus every hand
--   still pending, lag = completed_at (or now) - committed_at.
--     warning   p95 > 2 s with at least 5 hands in the window
--     critical  p95 > 15 s with at least 3 hands, or any hand pending > 15 s
--   One open alert per table (the guard names context->>'table_id', so an
--   open alert silences only its own table), a warning that crosses 15 s is
--   resolved and replaced by a critical, every open alert resolves when its
--   table's p95 is back to 1.5 s or the table has no hands, and a run opens
--   at most 10 new alerts (the worst first) so a platform-wide stall cannot
--   become its own alert storm. The message is constant per severity, so the
--   incident trigger (fn_ca_financial_alert_to_incident, critical only) folds
--   every table's critical into ONE incident; the table is in the context.
--   Warnings reach the operational intake (a00_operational_source_intake)
--   and open no incident.
--
-- COST. Read with EXPLAIN ANALYZE on production 2026-11-18 (read-only): the
-- window query is an Index Scan on horse_accepted_window_time (committed_at)
-- plus idx_hand_atomic_commits_post_commit_pending, 552 shared buffers,
-- 7.4 ms, 319 rows. No new index. now(), not clock_timestamp(): a volatile
-- bound cannot use the index (measured: the clock_timestamp() form ran past
-- a 20 s statement timeout).
--
-- periodic-work: a once-a-minute detector that only raises and resolves financial_alerts rows; it pays, re-drives, retries and repairs nothing, and is not the fix (the fixes are #11270/#11266 and the hand-path law); it exists so a post-commit stall pages within minutes instead of the stranded watchdog's ten.
--
-- @live-proof: (SELECT to_regprocedure('public.fn_ca_post_commit_lag_watch()') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-commit-lag-watch-1m' AND active AND command = 'select public.fn_ca_post_commit_lag_watch()'))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.fn_ca_post_commit_lag_watch()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
SET lock_timeout TO '2s'
AS $f$
DECLARE
  c_source  constant text    := 'fn_ca_post_commit_lag_watch';
  c_warn_s  constant numeric := 2;    -- the owner's hand-gap limit (2026-11-17 22:22 CT)
  c_clear_s constant numeric := 1.5;  -- resolve below this: no flapping at the line
  c_crit_s  constant numeric := 15;
  c_warn_n  constant int     := 5;
  c_crit_n  constant int     := 3;
  c_max_new constant int     := 10;
  v_judged  jsonb;
  v_lagging int;
  v_new int := 0; v_escalated int := 0; v_resolved int := 0;
  r record;
BEGIN
  WITH recent AS (
    SELECT h.table_id, h.post_commit_completed_at IS NULL AS pending,
           extract(epoch FROM COALESCE(h.post_commit_completed_at, now()) - h.committed_at) AS lag_s
      FROM hand_atomic_commits h
     WHERE h.committed_at >= now() - interval '5 minutes'
       AND h.post_commit_payload IS NOT NULL
    UNION ALL
    SELECT h.table_id, true, extract(epoch FROM now() - h.committed_at)
      FROM hand_atomic_commits h
     WHERE h.post_commit_payload IS NOT NULL AND h.post_commit_completed_at IS NULL
       AND h.committed_at < now() - interval '5 minutes'
  ), per AS (
    SELECT table_id, count(*) AS hands, count(*) FILTER (WHERE pending) AS pending,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY lag_s) AS p95_s,
           max(lag_s) AS max_s, COALESCE(max(lag_s) FILTER (WHERE pending), 0) AS oldest_pending_s
      FROM recent GROUP BY table_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table_id', p.table_id, 'hands', p.hands, 'pending', p.pending,
           'p95_s', round(p.p95_s::numeric, 3), 'max_s', round(p.max_s::numeric, 3),
           'oldest_pending_s', round(p.oldest_pending_s::numeric, 3),
           'severity', CASE WHEN (p.hands >= c_crit_n AND p.p95_s > c_crit_s) OR p.oldest_pending_s > c_crit_s
                            THEN 'critical'
                            WHEN p.hands >= c_warn_n AND p.p95_s > c_warn_s THEN 'warning' END,
           'clear', p.p95_s <= c_clear_s AND p.oldest_pending_s <= c_clear_s)), '[]'::jsonb)
    INTO v_judged
    FROM per p;

  SELECT count(*) INTO v_lagging FROM jsonb_array_elements(v_judged) j WHERE j->>'severity' IS NOT NULL;

  -- Resolve: an open alert whose table has no hands now, or is back under the clear line.
  WITH done AS (
    UPDATE financial_alerts fa
       SET resolved = true, resolved_at = now(),
           resolution = 'post-commit p95 back under ' || c_clear_s || ' s on this table'
     WHERE fa.source = c_source AND NOT fa.resolved
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_judged) j
                        WHERE j->>'table_id' = fa.context->>'table_id' AND NOT (j->>'clear')::boolean)
    RETURNING 1)
  SELECT count(*) INTO v_resolved FROM done;

  FOR r IN
    SELECT j, (j->>'table_id')::uuid AS table_id, j->>'severity' AS severity,
           (SELECT fa.severity FROM financial_alerts fa
             WHERE fa.source = c_source AND NOT fa.resolved AND fa.context->>'table_id' = j->>'table_id'
             ORDER BY fa.created_at DESC LIMIT 1) AS open_severity
      FROM jsonb_array_elements(v_judged) j
     WHERE j->>'severity' IS NOT NULL
     ORDER BY (j->>'severity' = 'critical') DESC, (j->>'p95_s')::numeric DESC, j->>'table_id'
  LOOP
    CONTINUE WHEN r.open_severity = 'critical'
               OR (r.open_severity = 'warning' AND r.severity = 'warning');
    IF r.open_severity = 'warning' THEN
      UPDATE financial_alerts fa
         SET resolved = true, resolved_at = now(), resolution = 'escalated to critical'
       WHERE fa.source = c_source AND NOT fa.resolved AND fa.context->>'table_id' = r.table_id::text;
      v_escalated := v_escalated + 1;
    ELSE
      CONTINUE WHEN v_new >= c_max_new;
      v_new := v_new + 1;
    END IF;
    INSERT INTO financial_alerts (severity, source, message, context)
    SELECT r.severity, c_source,
           CASE r.severity
             WHEN 'critical' THEN 'Hands are waiting on their post-commit work: on this table the p95 from commit to post-commit completion over the last 5 minutes is above 15 s, or a hand has been pending longer than 15 s. The hand gap is far over the 2 s limit; find the lock the post-commit envelope is waiting on.'
             ELSE 'Post-commit work is slowing hands down: on this table the p95 from commit to post-commit completion over the last 5 minutes is above the 2 s hand-gap limit.'
           END,
           r.j || jsonb_build_object(
             'table_name', t.name, 'club_id', t.club_id, 'union_id', t.union_id,
             'window', '5 minutes', 'warn_p95_s', c_warn_s, 'critical_p95_s', c_crit_s,
             'lagging_tables', v_lagging)
      FROM (SELECT 1) one
      LEFT JOIN tables t ON t.id = r.table_id;
  END LOOP;

  RETURN jsonb_build_object('lagging_tables', v_lagging, 'opened', v_new, 'escalated', v_escalated,
                            'resolved', v_resolved, 'checked_at', now());
END
$f$;

REVOKE ALL ON FUNCTION public.fn_ca_post_commit_lag_watch() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_ca_post_commit_lag_watch() IS
  'Detector (not a repair): per-table p95 commit->post_commit_completed_at over 5 minutes; warning > 2 s, critical > 15 s or a hand pending > 15 s; one open alert per table, auto-resolving, at most 10 new per run. Incident 075013fd lane F.';

SELECT cron.schedule('post-commit-lag-watch-1m', '* * * * *', 'select public.fn_ca_post_commit_lag_watch()');

COMMIT;
