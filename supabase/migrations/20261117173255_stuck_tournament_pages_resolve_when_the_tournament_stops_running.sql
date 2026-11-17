-- @live-proof: position('STUCK TOURNAMENT NOTICES RESOLVE AT THEIR SOURCE (20261117173255)' in pg_get_functiondef('public.fn_sp_critical_scan()'::regprocedure)) > 0
-- 20261117173255_stuck_tournament_pages_resolve_when_the_tournament_stops_running.sql
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The Smarter.Poker stuck-tournament condition ("a tournament has been
-- RUNNING longer than setting stuck_tournament_hours") is reported by two
-- notices of one subsystem, both keyed by the tournament id
-- (docs/reliability-controller/EXTERNAL-PRODUCERS.md note E):
--
--   sp-critical-pager  CriticalPage.stuck_tournament  event_key stuck:<id>
--                      written by fn_sp_critical_scan(), every 5 minutes
--   sp-daily-digest    DailyDigest.stuck_tournament   event_key
--                      sp-digest:<day>:stuck_tournament:<id>, written once a
--                      day by fn_sp_dispatch_attention
--
-- Neither ever wrote 'resolved'. On 2026-11-17 the Nightly 20K 10d3c9b3
-- completed and paid at 17:05:27Z, yet Reliability Controller incidents
-- 5d8a2c02 (CriticalPage.stuck_tournament) and 24c9bbaf
-- (DailyDigest.stuck_tournament) stayed escalated: the controller closes an
-- incident only through a resolved signal from the member that fired, and
-- these members could never send one. 151 pager rows and 78 digest rows were
-- still 'firing' for tournaments that had long stopped RUNNING.
--
-- The fix is in the producer. fn_sp_critical_scan() is the subsystem's one
-- frequent evaluator of this predicate, so on every pass it now also writes
-- the end of the condition: each 'firing' stuck_tournament notice of either
-- sp source whose tournament is no longer RUNNING (or no longer exists) is
-- moved to 'resolved' in place, with resolved_at and resolution in its
-- payload, the same in-place shape fn_ca_engine_cutover_watch uses. The
-- existing intake trigger (status change) carries it to the controller,
-- which closes the incident on its normal resolved_signal path.
--
-- Why the 5-minute scan also resolves the digest's notice rather than the
-- digest doing it on its next daily run: the digest is a once-a-day report of
-- the same condition the scan evaluates every 5 minutes, with the same
-- setting. Waiting for tomorrow's digest would keep a cleared condition open
-- for up to a day; teaching the controller to link one source's resolution
-- to another would move producer semantics into the controller. The scan
-- already owns the predicate, so it states when the condition ends for both
-- notices of it. No new schedule, watcher or reconciler: the existing 5-minute
-- pass gains one bounded statement (8 ms on production for all 229 rows).
--
-- A notice whose tournament is still RUNNING stays firing. Pages for other
-- rules are unchanged: those are point-in-time findings, not conditions.
--
-- Function-only DDL on one function, guarded: it amends exactly two anchors
-- of the live definition over the exact captured preimage and refuses
-- otherwise. No money row is touched.

BEGIN;

DO $migration$
DECLARE
  v_def text;
  v_decl_anchor text := '  r record; v_id bigint; v_new int := 0;';
  v_decl_new text := '  r record; v_id bigint; v_new int := 0; v_resolved int := 0;';
  v_ret_anchor text := '  RETURN jsonb_build_object(''new'', v_new,';
  v_ret_new text := '  -- STUCK TOURNAMENT NOTICES RESOLVE AT THEIR SOURCE (20261117173255).
  -- The stuck_tournament condition ends when its tournament is no longer
  -- RUNNING. Both sp notices of it (this pager''s and the daily digest''s)
  -- are closed here, in place, so the controller sees the resolved signal of
  -- the member that fired. A notice whose tournament still runs stays firing.
  WITH open_notices AS (
    SELECT e.id,
           CASE WHEN pg_input_is_valid(e.payload#>>''{detail,tournament_id}'', ''uuid'')
                THEN (e.payload#>>''{detail,tournament_id}'')::uuid END AS tournament_id
      FROM public.operational_alert_events e
     WHERE e.status = ''firing''
       AND ((e.source = ''sp-critical-pager'' AND e.alertname = ''CriticalPage.stuck_tournament'')
         OR (e.source = ''sp-daily-digest'' AND e.alertname = ''DailyDigest.stuck_tournament''))
  ), ended AS (
    SELECT o.id, t.status
      FROM open_notices o
      LEFT JOIN public.tournaments t ON t.id = o.tournament_id
     WHERE o.tournament_id IS NOT NULL
       AND (t.id IS NULL OR t.status IS DISTINCT FROM ''RUNNING'')
  )
  UPDATE public.operational_alert_events e
     SET status = ''resolved'',
         last_received_at = clock_timestamp(),
         payload = e.payload || jsonb_build_object(
           ''resolved_at'', clock_timestamp(),
           ''resolution'', CASE WHEN x.status IS NULL
                              THEN ''the tournament no longer exists''
                              ELSE ''the tournament is '' || x.status || '', no longer RUNNING'' END,
           ''resolved_by'', ''fn_sp_critical_scan'')
    FROM ended x
   WHERE e.id = x.id AND e.status = ''firing'';
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object(''new'', v_new, ''resolved'', v_resolved,';
BEGIN
  v_def := pg_get_functiondef('public.fn_sp_critical_scan()'::regprocedure);
  IF position('STUCK TOURNAMENT NOTICES RESOLVE AT THEIR SOURCE (20261117173255)' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF md5(v_def) <> 'ef4c2c3dfdcba816c46a1e360c71a3d1' THEN
    RAISE EXCEPTION 'SP_CRITICAL_SCAN_PREIMAGE_CHANGED: %', md5(v_def);
  END IF;
  IF (length(v_def) - length(replace(v_def, v_decl_anchor, ''))) / length(v_decl_anchor) <> 1
     OR (length(v_def) - length(replace(v_def, v_ret_anchor, ''))) / length(v_ret_anchor) <> 1 THEN
    RAISE EXCEPTION 'fn_sp_critical_scan: expected exactly one declaration and one return anchor';
  END IF;
  EXECUTE replace(replace(v_def, v_decl_anchor, v_decl_new), v_ret_anchor, v_ret_new);

  v_def := pg_get_functiondef('public.fn_sp_critical_scan()'::regprocedure);
  IF position('STUCK TOURNAMENT NOTICES RESOLVE AT THEIR SOURCE (20261117173255)' IN v_def) = 0
     OR position('''resolved'', v_resolved' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fn_sp_critical_scan: resolution step did not land';
  END IF;
END
$migration$;

COMMIT;
