-- 20261118072500_an_alert_resolution_reaches_its_incident_once_per_statement.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- AN ALERT RESOLUTION REACHES ITS INCIDENT ONCE PER STATEMENT, AND THE CLOSER
-- COMMITS WHAT IT HAS ALREADY PROVED (incident 075013fd, 2026-11-18)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-18 ~07:10 UTC)
--
-- cron job 354 ca-resolve-settled-alerts-20m runs
-- fn_resolve_settled_financial_alerts(true, 5000) as ONE statement. Every run
-- since 02:44 UTC was cancelled by the 2 min statement_timeout (last success
-- 02:24, 29 s), and because it is one transaction each cancellation rolled
-- back every alert it had already proved settled. 5,661
-- LightningHandHost.post_commit_obligations_pending alerts stayed open.
-- Job 227 ca-payout-guarantee-check-hourly calls the same closer inside its
-- own statement; it failed 03:18, 04:18, 05:18, 06:18 at its 300 s timeout
-- and 07:18 was still running. Every cancellation but two names the same
-- statement in its CONTEXT: "WITH members AS (" - the member roll-up of
-- fn_ca_alert_resolution_reaches_the_incident() (the other two landed on an
-- AFTER ROW intake insert of the same cascade).
--
-- The cause is the binding, not the closer. zz_ca_alert_resolution_reaches_
-- the_incident was AFTER UPDATE OF resolved ... FOR EACH ROW. For EVERY alert
-- a statement resolved it re-read the WHOLE cause group of the incident the
-- alert belongs to. Drift incident e842cb87-3b25-4105-9454-f5b0a5328e80
-- (fa:LightningHandHost.post_commit_obligations_pending:09ed6ecc...) holds
-- 7,693 member events, all financial_member_version 1, 4,957 of whose alerts
-- were still open. EXPLAIN (ANALYZE, BUFFERS) of that roll-up for one alert:
-- 7,693 member rows, 34,373 buffer hits, 169 ms; the candidate-group probe
-- before it a further 8 ms (2,647 buffers). One page of 4,957 resolutions is
-- 4,957 x ~0.18 s = ~880 s of roll-up for an answer ("not every member is
-- resolved yet") that is the same for every row of the statement. Quadratic
-- in the size of the backlog: the bigger the incident, the less the closer
-- can close, which is how it grew from a 29 s run to a permanent timeout.
--
-- THE FIX (the binding and the shape of the roll-up, not a timeout or a batch)
--
-- 1. The trigger is AFTER UPDATE ... FOR EACH STATEMENT with transition
--    tables. AFTER ROW triggers already fired only once the whole statement
--    had updated its rows, so every per-row roll-up of one statement saw the
--    same alert states; the statement-level roll-up evaluates each affected
--    incident ONCE against those same states. Cost per statement is
--    O(members of the incidents it touches + rows it resolved), not their
--    product. The transition tables are read ONCE into a jsonb object keyed
--    by alert id; every "did this statement resolve that alert" afterwards
--    is a key lookup, never a join: a tuplestore has no statistics, and the
--    first draft's joins were planned as a nested loop over the member
--    events - 40 M join-filter rows, 33 s for the same 5,000.
--    Native proof (PostgreSQL 16, 8,000-member incident): 5,000 resolved in
--    one statement 0.24 s; the last 3,000 plus the closure 0.38 s; the
--    preimage 19.6 s for 200 rows and cancelled at 120 s for 5,000.
-- 2. Before the full member proof, an incident with a versioned member whose
--    exact alert is still unresolved is skipped: that member alone makes the
--    proof's bad-member count positive, so the full proof could not close it.
--    Same for a capped storm. This makes the common "still open" answer O(1)
--    for single-alert resolutions too.
-- 3. Behaviour is otherwise the 41c8d8f0 body: the same advisory cause-group
--    locks (now taken in one global sorted order), FOR UPDATE of the incident
--    before its membership is read, the same membership proof and HAVING,
--    closure_basis 'verified_remeasured' exactly when the last member alert
--    resolves and that statement resolved one of its members, the same mirror
--    close (whose zz_ca_incident_resolution_reaches_the_alerts cascade still
--    resolves the drift_incident:* echoes), the same storm proof, and a
--    failure is still filed in ca_incident_file_failures, never raised into
--    the resolve that triggered it. A failure is now isolated per incident.
-- 4. Job 354 CALLs public.sp_ca_resolve_settled_financial_alerts_in_pages,
--    which runs the unreachable-hand resolver first in its own transaction,
--    then the unchanged closer one bounded page at a time with a COMMIT
--    after each page, starting no page after 45 s of the role's 2 min
--    statement_timeout. A slow page can no longer roll back the pages
--    before it, and the session lock is released on failure too. (pg_cron here runs over libpq,
--    cron.use_background_workers = off, and CALL with COMMIT is the shape
--    jobs 176 and 317-319 already run.) Job 227 keeps its command: its
--    timeouts were this same trigger and it is fixed by item 1.
--
-- No money moves. No alert, incident or event row is written by this file.
--
-- @live-proof: (SELECT tgtype::int & 1 = 0 AND tgnewtable = 'ca_alert_resolution_new' AND tgoldtable = 'ca_alert_resolution_old' FROM pg_trigger WHERE tgname = 'zz_ca_alert_resolution_reaches_the_incident' AND tgrelid = 'public.financial_alerts'::regclass) AND position('ONE STATEMENT, ONE ROLL-UP PER INCIDENT' in pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure)) > 0 AND (SELECT command = 'CALL public.sp_ca_resolve_settled_financial_alerts_in_pages(500, 40);' AND active FROM cron.job WHERE jobid = 354)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $preimage$
DECLARE v_job cron.job%ROWTYPE;
  -- Read through regprocedure variables: this file pages the closer and
  -- does not redefine it, so it must not read as the closer's latest source.
  v_closer regprocedure := 'public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure;
  v_proven regprocedure := 'smarter_private.financial_alerts_proven_over(boolean,integer)'::regprocedure;
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure))
     IS DISTINCT FROM '41c8d8f028e06087ffff5bd89aea8ed2' THEN
    RAISE EXCEPTION 'ALERT_RESOLUTION_ROLLUP_PREIMAGE_CHANGED: fn_ca_alert_resolution_reaches_the_incident is not the 41c8d8f0 body this migration rebinds; port the change before installing';
  END IF;
  IF (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
       WHERE t.tgname = 'zz_ca_alert_resolution_reaches_the_incident'
         AND t.tgrelid = 'public.financial_alerts'::regclass AND NOT t.tgisinternal)
     IS DISTINCT FROM 'c6f51cfd9e42c1eeb8312c5a794dedab' THEN
    RAISE EXCEPTION 'ALERT_RESOLUTION_ROLLUP_TRIGGER_PREIMAGE_CHANGED: zz_ca_alert_resolution_reaches_the_incident is not AFTER UPDATE OF resolved FOR EACH ROW';
  END IF;
  -- The pager calls these two unchanged; pin the result keys it reads.
  IF position('''total''' in pg_get_functiondef(v_closer)) = 0
     OR position('''accounting_lightning_proven_over''' in pg_get_functiondef(v_closer)) = 0
     OR position('''proven_over''' in pg_get_functiondef(v_proven)) = 0
     OR position('''echoes_closed''' in pg_get_functiondef(v_proven)) = 0 THEN
    RAISE EXCEPTION 'SETTLED_ALERT_CLOSER_RESULT_CHANGED: the pager reads total, accounting_lightning_proven_over.proven_over and .echoes_closed';
  END IF;
  PERFORM 'public.fn_ca_resolve_landed_unreachable_hand_alerts()'::regprocedure;
  SELECT * INTO STRICT v_job FROM cron.job WHERE jobid = 354;
  IF md5(v_job.command) IS DISTINCT FROM '4bf6c1efccdfb1506ba52a2c81e69e70'
     OR v_job.jobname IS DISTINCT FROM 'ca-resolve-settled-alerts-20m'
     OR v_job.schedule IS DISTINCT FROM '4,24,44 * * * *'
     OR v_job.active IS DISTINCT FROM true
     OR v_job.database IS DISTINCT FROM 'postgres'
     OR v_job.username IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'SETTLED_ALERT_CLOSER_JOB_PREIMAGE_CHANGED: job 354 is not the single-statement closer this migration pages';
  END IF;
END
$preimage$;

CREATE OR REPLACE FUNCTION public.fn_ca_alert_resolution_reaches_the_incident()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
/* ONE STATEMENT, ONE ROLL-UP PER INCIDENT (2026-11-18, incident 075013fd).
   Bound AFTER UPDATE FOR EACH STATEMENT with transition tables. The FOR EACH
   ROW binding re-read a 7,693-member cause group once per resolved alert -
   169 ms each, ~880 s for one closer page - and the closer's whole
   transaction rolled back at its timeout. AFTER ROW triggers fired only after
   the statement had updated every row, so each per-row roll-up saw the same
   alert states; this evaluates each touched incident once against them.
   An alert resolved here is a row whose resolved went from not-true to true
   in this statement (the old row trigger's own test).

   The resolved rows are read from the transition tables ONCE, into a jsonb
   object keyed by alert id. Every later "was this alert resolved by this
   statement" is a key lookup (O(log n)), never a join the planner can turn
   into a nested loop: a tuplestore has no statistics, and a misestimated
   join of 5,000 resolved rows against 8,000 member events is the same
   quadratic this replaces (measured: 33 s). */
DECLARE
  v_state text; v_msg text; v_storm record; v_group record; v_mirror record; v_key text;
  v_members bigint; v_bad bigint; v_current boolean; v_final text;
  v_src text; v_first text; v_n bigint;
  v_set jsonb;        -- alert id -> {s: source, h: cause hash, ra: resolved_at, rn: resolution}
  v_pairs jsonb;      -- 'financial_alerts:'||source || chr(31) || exact cause-group key -> true
  v_isources text[];  -- distinct 'financial_alerts:'||source
  c_sep constant text := chr(31);
BEGIN
  IF TG_LEVEL <> 'STATEMENT' OR TG_OP <> 'UPDATE' OR TG_WHEN <> 'AFTER'
     OR TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'financial_alerts' THEN
    RAISE EXCEPTION 'fn_ca_alert_resolution_reaches_the_incident must be bound AFTER UPDATE FOR EACH STATEMENT on public.financial_alerts';
  END IF;

  SELECT count(*), min(r.id::text),
         jsonb_object_agg(r.id::text, jsonb_build_object('s', r.source, 'h', r.h,
           'ra', r.resolved_at, 'rn', r.resolution)),
         jsonb_object_agg('financial_alerts:' || r.source || c_sep || 'fa:' || r.source || ':' || r.h, true),
         array_agg(DISTINCT 'financial_alerts:' || r.source)
    INTO v_n, v_first, v_set, v_pairs, v_isources
    FROM (SELECT n.id, n.source, n.resolved_at, n.resolution,
                 md5(public.fn_ca_normalize_alert_text(left(n.message,200)) || '|' ||
                     public.fn_ca_normalize_alert_text(left(COALESCE(n.context->>'error',''),200))) AS h
            FROM ca_alert_resolution_new n JOIN ca_alert_resolution_old o ON o.id = n.id
           WHERE COALESCE(n.resolved,false) AND NOT COALESCE(o.resolved,false)) r;
  IF v_n = 0 THEN RETURN NULL; END IF;

  -- The original raise and resolution share transaction ownership before any
  -- incident row lock. A conflict cannot resolve between DO NOTHING and fallback.
  -- Every cause group this statement touches, locked once, in one sorted order.
  FOR v_key IN
    SELECT DISTINCT i.dedupe_key FROM public.ca_drift_incidents i
     WHERE i.status <> 'resolved' AND i.source = ANY (v_isources)
       AND (v_pairs ? (i.source || c_sep || i.dedupe_key)
         OR 'financial_alerts:' || (v_set -> (i.metadata->>'alert_id') ->> 's') = i.source
         OR EXISTS(SELECT 1 FROM public.ca_incident_events e WHERE e.incident_id=i.id
              AND e.kind IN ('created','recurred')
              AND 'financial_alerts:' || (v_set -> lower(e.detail->>'alert_id') ->> 's') = i.source))
     ORDER BY i.dedupe_key
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('ca-financial-incident-members:' || public.fn_ca_stable_dedupe_key(v_key),0));
  END LOOP;

  -- A cause group may contain different original entities. Lock its owner row
  -- before reading membership so concurrent final resolutions see prior commits.
  FOR v_group IN
    SELECT i.id,i.source,i.dedupe_key,i.occurrences,i.detected_at
      FROM public.ca_drift_incidents i
     WHERE i.status <> 'resolved' AND i.source = ANY (v_isources)
       AND (v_pairs ? (i.source || c_sep || i.dedupe_key)
         -- versioned_membership_survives_alert_refresh
         OR (right(i.dedupe_key,32) ~ '^[0-9a-f]{32}$'
           AND left(i.source, length('financial_alerts:')) = 'financial_alerts:'
           AND i.dedupe_key = 'fa:' || substr(i.source, length('financial_alerts:') + 1) || ':' || right(i.dedupe_key,32)
           AND EXISTS(SELECT 1 FROM public.ca_incident_events e
             WHERE e.incident_id=i.id AND e.kind IN ('created','recurred')
               AND e.detail->'financial_member_version'='1'::jsonb
               AND e.detail->>'source'=i.source
               AND 'financial_alerts:' || (v_set -> lower(e.detail->>'alert_id') ->> 's') = i.source)))
     ORDER BY i.id FOR UPDATE OF i
  LOOP
    BEGIN
      v_src := substr(v_group.source, length('financial_alerts:') + 1);

      -- A versioned member whose exact alert is still open makes the proof
      -- below count a bad member, so it cannot close: answer that first.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.ca_incident_events e
          JOIN public.financial_alerts a ON a.id = CASE
            WHEN e.detail->>'alert_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN (e.detail->>'alert_id')::uuid END
         WHERE e.incident_id = v_group.id AND e.kind IN ('created','recurred')
           AND e.detail->'financial_member_version' = '1'::jsonb
           AND jsonb_typeof(e.detail->'alert_id') = 'string'
           AND a.source = v_src AND a.resolved IS NOT TRUE);

      v_members := NULL; v_bad := NULL; v_current := NULL; v_final := NULL;
      WITH members AS (
        SELECT e.id,e.detail,m.matches,m.current_member,m.current_id,m.all_resolved,
               m.legacy_event_count,m.mixed_bucket
        FROM public.ca_incident_events e
        CROSS JOIN LATERAL (
          SELECT count(*) AS matches,
                 COALESCE(bool_or(a.sel),false) AS current_member,
                 min(a.id::text) FILTER (WHERE a.sel) AS current_id,
                 bool_and(a.resolved IS TRUE) AS all_resolved,
                 (SELECT count(*) FROM public.ca_incident_events le
                   WHERE le.incident_id=v_group.id AND le.at=e.at
                     AND le.kind IN ('created','recurred')
                     AND NOT(le.detail ? 'financial_member_version')) AS legacy_event_count,
                 EXISTS(SELECT 1 FROM public.ca_incident_events ve
                   WHERE ve.incident_id=v_group.id AND ve.at=e.at
                     AND ve.kind IN ('created','recurred')
                     AND ve.detail ? 'financial_member_version') AS mixed_bucket
          FROM (
            -- sel: this member was resolved by this statement and that row
            -- selected this group (its exact cause key, or the versioned
            -- group shape it is a member of) - the old per-row own-id test.
            SELECT a.id,a.resolved,
                   COALESCE((v_set -> (a.id::text) ->> 's') = v_src
                     AND (v_group.dedupe_key = 'fa:' || v_src || ':' || (v_set -> (a.id::text) ->> 'h')
                       OR (right(v_group.dedupe_key,32) ~ '^[0-9a-f]{32}$'
                         AND v_group.dedupe_key = 'fa:' || v_src || ':' || right(v_group.dedupe_key,32))), false) AS sel
              FROM public.financial_alerts a
            WHERE e.detail->'financial_member_version'='1'::jsonb
              AND jsonb_typeof(e.detail->'alert_id')='string'
              AND a.id=CASE WHEN e.detail->>'alert_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                           THEN (e.detail->>'alert_id')::uuid END
              AND a.source=v_src
            UNION ALL
            SELECT a.id,a.resolved,
                   COALESCE((v_set -> (a.id::text) ->> 's') = v_src
                     AND (v_group.dedupe_key = 'fa:' || v_src || ':' || (v_set -> (a.id::text) ->> 'h')
                       OR (right(v_group.dedupe_key,32) ~ '^[0-9a-f]{32}$'
                         AND v_group.dedupe_key = 'fa:' || v_src || ':' || right(v_group.dedupe_key,32))), false) AS sel
              FROM public.financial_alerts a
            WHERE NOT(e.detail ? 'financial_member_version')
              AND a.source=v_src AND a.created_at=e.at AND a.severity='critical'
              AND v_group.dedupe_key='fa:' || a.source || ':' || md5(
                public.fn_ca_normalize_alert_text(left(a.message,200)) || '|' ||
                public.fn_ca_normalize_alert_text(left(COALESCE(a.context->>'error',''),200)))
          ) a
        ) m
        WHERE e.incident_id=v_group.id AND e.kind IN ('created','recurred')
      )
      -- A legacy cron transaction can raise many originals at the same now().
      -- Individual permutation is unknown, but its complete same-source/cause/time
      -- set is proved when the alert count equals the original-event count and
      -- every member resolves. Mixed formats and missing/extra rows remain unknown.
      SELECT count(*),count(*) FILTER(WHERE matches<1
              OR (detail ? 'financial_member_version' AND matches<>1)
              OR (NOT(detail ? 'financial_member_version')
                  AND (matches<>legacy_event_count OR mixed_bucket))
              OR all_resolved IS DISTINCT FROM true
              OR detail->>'source' IS DISTINCT FROM v_group.source),
             COALESCE(bool_or(current_member),false),
             min(current_id)
        INTO v_members,v_bad,v_current,v_final FROM members
      HAVING count(*) FILTER (WHERE detail ? 'financial_member_version')
           = count(DISTINCT lower(detail->>'alert_id')) FILTER (WHERE detail ? 'financial_member_version');
      IF v_members>0 AND v_members=v_group.occurrences AND v_bad=0 AND v_current THEN
        UPDATE public.ca_drift_incidents SET status='resolved',
          resolved_at=GREATEST(now(),detected_at),closure_basis='verified_remeasured',
          correction_ref=COALESCE(NULLIF(correction_ref,''),'verified: every exact cause-group source alert is resolved'),
          root_cause=COALESCE(NULLIF(root_cause,''),
            'This incident is a same-cause financial alert group. Every exact original source alert or complete legacy transaction set is resolved. Typed entity fields retain the first witness; metadata retains the latest witness.'),
          resolution=COALESCE(NULLIF(resolution,'') || ' | ','') ||
            'Verified all ' || v_members || ' exact original source alert members resolved; the final original transition was ' || v_final || '. No financial operation was replayed for incident closure.'
        WHERE id=v_group.id AND status<>'resolved';
      END IF;
    EXCEPTION
      WHEN query_canceled THEN RAISE;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        BEGIN
          INSERT INTO public.ca_incident_file_failures
            (source, dedupe_key, classification, severity, discrepancy, sqlstate, message)
          VALUES ('fn_ca_alert_resolution_reaches_the_incident',
                  'propagate:alert->incident:' || v_first,
                  'unknown', 'warning', 0, v_state,
                  'a resolved alert did not close the incident mirroring it: incident '
                    || v_group.id::text || ' (' || v_n || ' alerts resolved in the statement): ' || v_msg);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        RAISE WARNING 'fn_ca_alert_resolution_reaches_the_incident failed: %', v_msg;
    END;
  END LOOP;

  -- Mirrors: an open incident whose metadata names an alert this statement
  -- resolved closes with that alert. Open incidents are few; each is a key
  -- lookup into the resolved set.
  FOR v_mirror IN
    SELECT i.id, (i.metadata->>'alert_id')::uuid::text AS alert_id
      FROM public.ca_drift_incidents i
     WHERE i.status <> 'resolved'
       AND i.metadata->>'alert_id' ~ '^[0-9a-fA-F-]{36}$'
     ORDER BY i.id
  LOOP
    CONTINUE WHEN NOT (v_set ? v_mirror.alert_id);
    BEGIN
      UPDATE public.ca_drift_incidents i
         SET status      = 'resolved',
             resolved_at = GREATEST(COALESCE((v_set -> v_mirror.alert_id ->> 'ra')::timestamptz, now()), i.detected_at),
             correction_ref = COALESCE(NULLIF(i.correction_ref,''),
                                       'verified: closed with financial alert ' || v_mirror.alert_id),
             root_cause  = COALESCE(NULLIF(i.root_cause,''),
                            'This incident is a mirror of financial alert ' || v_mirror.alert_id
                            || ', raised by ' || COALESCE(v_set -> v_mirror.alert_id ->> 's','an unnamed source')
                            || '. The condition it describes was diagnosed and closed on that '
                            || 'alert; this row exists only because the alert was copied onto '
                            || 'the drift board when it was raised.'),
             resolution  = COALESCE(NULLIF(i.resolution,'') || ' | ', '')
                           || 'Closed with the financial alert it mirrors ('
                           || v_mirror.alert_id || '): '
                           || COALESCE(NULLIF(v_set -> v_mirror.alert_id ->> 'rn',''), 'no note given on the alert')
       WHERE i.id = v_mirror.id
         AND i.status <> 'resolved'
         AND (left(i.source,length('financial_alerts:'))<>'financial_alerts:'
           OR i.source='financial_alerts:' || (v_set -> v_mirror.alert_id ->> 's'))
         AND NOT(left(i.source,length('financial_alerts:'))='financial_alerts:'
           AND right(i.dedupe_key,32) ~ '^[0-9a-f]{32}$'
           AND i.dedupe_key='fa:' || substr(i.source,length('financial_alerts:')+1) || ':' || right(i.dedupe_key,32));
    EXCEPTION
      WHEN query_canceled THEN RAISE;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        BEGIN
          INSERT INTO public.ca_incident_file_failures
            (source, dedupe_key, classification, severity, discrepancy, sqlstate, message)
          VALUES ('fn_ca_alert_resolution_reaches_the_incident',
                  'propagate:alert->incident:' || v_mirror.alert_id,
                  'unknown', 'warning', 0, v_state,
                  'a resolved alert did not close the incident mirroring it: ' || v_msg);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        RAISE WARNING 'fn_ca_alert_resolution_reaches_the_incident failed: %', v_msg;
    END;
  END LOOP;

  -- The same original resolution transition also owns its capped aggregate.
  -- Lock first, then read membership in a NEW command snapshot: concurrent last
  -- members must observe the predecessor commit, rather than both leave it open.
  FOR v_storm IN
    SELECT i.id,i.source,i.occurrences,i.detected_at,i.metadata FROM public.ca_drift_incidents i
     WHERE i.status<>'resolved'
       AND i.source = ANY (v_isources)
       AND i.dedupe_key='storm:' || i.source
     ORDER BY i.id FOR UPDATE OF i
  LOOP
    BEGIN
      v_src := substr(v_storm.source, length('financial_alerts:') + 1);

      -- A member whose exact alert of this source is still open is a bad
      -- member of the proof below: it cannot close.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.ca_incident_events e
          JOIN public.financial_alerts a ON a.id = CASE
            WHEN jsonb_typeof(e.detail->'alert_id')='string'
              AND e.detail->>'alert_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN (e.detail->>'alert_id')::uuid END
         WHERE e.incident_id = v_storm.id AND e.kind = 'recurred'
           AND a.source = v_src AND a.resolved IS NOT TRUE);

      v_members := NULL; v_bad := NULL; v_current := NULL;
      SELECT count(*),count(*) FILTER(WHERE a.id IS NULL
                 OR a.source IS DISTINCT FROM v_src OR a.resolved IS DISTINCT FROM true),
             COALESCE(bool_or((v_set -> (a.id::text) ->> 's') = v_src),false)
        INTO v_members,v_bad,v_current
        FROM public.ca_incident_events e
        LEFT JOIN public.financial_alerts a ON a.id=CASE
          WHEN jsonb_typeof(e.detail->'alert_id')='string'
            AND e.detail->>'alert_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN (e.detail->>'alert_id')::uuid END
       WHERE e.incident_id=v_storm.id AND e.kind='recurred'
      HAVING (v_src='Tournament.atomic_finish_refused' AND v_storm.metadata->>'storm_member_version'='1')
          OR (count(DISTINCT a.id)=count(*)
            AND bool_and(COALESCE(e.detail->'financial_member_version'='1'::jsonb
                  AND e.detail->>'source'='financial_alerts:' || v_src,false)));
      IF v_members>0 AND v_members=v_storm.occurrences AND v_bad=0 AND v_current THEN
        UPDATE public.ca_drift_incidents SET status='resolved',
          resolved_at=GREATEST(now(),detected_at),
          closure_basis='verified_remeasured',
          correction_ref='verified: every exact storm member financial alert is resolved',
          root_cause='The original findings were resolved by their authoritative financial alert transitions. This capped incident retained their exact alert identities and every member now has a resolved financial record.',
          resolution='Closed in the last member financial alert resolution transaction after verifying all exact members exist, belong to this source and are resolved. No chips moved for incident closure.'
        WHERE id=v_storm.id AND status<>'resolved';
      END IF;
    EXCEPTION
      WHEN query_canceled THEN RAISE;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        BEGIN
          INSERT INTO public.ca_incident_file_failures
            (source, dedupe_key, classification, severity, discrepancy, sqlstate, message)
          VALUES ('fn_ca_alert_resolution_reaches_the_incident',
                  'propagate:alert->incident:' || v_first,
                  'unknown', 'warning', 0, v_state,
                  'a resolved alert did not close the incident mirroring it: storm '
                    || v_storm.id::text || ' (' || v_n || ' alerts resolved in the statement): ' || v_msg);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        RAISE WARNING 'fn_ca_alert_resolution_reaches_the_incident failed: %', v_msg;
    END;
  END LOOP;
  RETURN NULL;
EXCEPTION
  WHEN query_canceled THEN RAISE;
  WHEN OTHERS THEN
  /* Never roll back the resolve that triggered us - but never disappear
     either. RAISE WARNING alone is how this defect hid from its own author. */
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  BEGIN
    INSERT INTO public.ca_incident_file_failures
      (source, dedupe_key, classification, severity, discrepancy, sqlstate, message)
    VALUES ('fn_ca_alert_resolution_reaches_the_incident',
            'propagate:alert->incident:' || COALESCE(v_first, 'statement'),
            'unknown', 'warning', 0, v_state,
            'a resolved alert did not close the incident mirroring it: ' || v_msg);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RAISE WARNING 'fn_ca_alert_resolution_reaches_the_incident failed: %', v_msg;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_alert_resolution_reaches_the_incident() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_alert_resolution_reaches_the_incident() TO postgres, service_role;

DROP TRIGGER zz_ca_alert_resolution_reaches_the_incident ON public.financial_alerts;
CREATE TRIGGER zz_ca_alert_resolution_reaches_the_incident
  AFTER UPDATE ON public.financial_alerts
  REFERENCING OLD TABLE AS ca_alert_resolution_old NEW TABLE AS ca_alert_resolution_new
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.fn_ca_alert_resolution_reaches_the_incident();

-- The closer, one committed page at a time. A procedure (not SECURITY
-- DEFINER, no SET clause) so that its COMMIT is legal; CALL must stay the
-- top-level cron command.
--
-- TIME: the postgres role's statement_timeout (2 min) covers the WHOLE CALL;
-- a COMMIT does not reset it. So the run starts no new page after 45 s. The
-- slowest single closer statement on record is 74.9 s (job 354, 5,000-row
-- limit, 02:04 UTC 2026-11-18, pg_stat_statements max); a 500-row page is a
-- tenth of that work, and 45 s + 74.9 s still ends inside 120 s.
--
-- ORDER: fn_ca_resolve_landed_unreachable_hand_alerts runs FIRST, in its own
-- transaction, so it never waits on (or is skipped by) the pager.
--
-- ERRORS: each call runs in its own sub-block (a COMMIT may not run inside
-- one, so it comes after the block ends). A failure, including a statement
-- timeout, stops the pager, the session advisory lock is released, and the
-- first error is re-raised so job_run_details records the run as failed.
-- Every page committed before it stays committed.
CREATE OR REPLACE PROCEDURE public.sp_ca_resolve_settled_financial_alerts_in_pages(
  p_page integer DEFAULT 500, p_pages integer DEFAULT 40)
LANGUAGE plpgsql
AS $procedure$
DECLARE
  c_start_budget constant interval := interval '45 seconds';
  v_stop_starting timestamptz := clock_timestamp() + c_start_budget;
  v_lock bigint := hashtext('ca-resolve-settled-alerts');
  v_result jsonb;
  v_closed integer;
  v_total integer := 0;
  v_pages integer := 0;
  v_landed integer;
  v_failed boolean := false;
  v_state text;
  v_msg text;
BEGIN
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Invalid settled alert page size %', p_page;
  END IF;
  IF p_pages IS NULL OR p_pages NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid settled alert page count %', p_pages;
  END IF;
  -- Same session lock key the single-statement job took.
  IF NOT pg_try_advisory_lock(v_lock) THEN
    RAISE WARNING 'ca-resolve-settled-alerts busy: another session holds the closer lock';
    RETURN;
  END IF;

  -- 1. The unreachable-hand resolver, independent of the pager.
  PERFORM set_config('search_path', 'pg_catalog, public, pg_temp', true);
  BEGIN
    v_landed := public.fn_ca_resolve_landed_unreachable_hand_alerts();
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    v_failed := true;
  END;
  COMMIT;

  -- 2. The settled-alert closer, one committed page at a time.
  WHILE NOT v_failed LOOP
    -- COMMIT resets transaction-local settings; restore the lookup path.
    PERFORM set_config('search_path', 'pg_catalog, public, pg_temp', true);
    BEGIN
      v_result := public.fn_resolve_settled_financial_alerts(true, p_page);
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      v_failed := true;
    END;
    EXIT WHEN v_failed;
    v_closed := COALESCE((v_result->>'total')::integer, 0)
              + COALESCE((v_result->'accounting_lightning_proven_over'->>'proven_over')::integer, 0)
              + COALESCE((v_result->'accounting_lightning_proven_over'->>'echoes_closed')::integer, 0);
    COMMIT;
    v_pages := v_pages + 1;
    v_total := v_total + v_closed;
    EXIT WHEN v_closed = 0 OR v_pages >= p_pages OR clock_timestamp() >= v_stop_starting;
  END LOOP;

  PERFORM pg_advisory_unlock(v_lock);
  IF v_failed THEN
    RAISE EXCEPTION USING ERRCODE = v_state,
      MESSAGE = v_msg,
      DETAIL = format('settled alerts closed %s in %s committed pages of %s before the failure; unreachable_landed=%s',
                      v_total, v_pages, p_page, COALESCE(v_landed::text, 'not run'));
  END IF;
  RAISE NOTICE 'settled alerts closed % in % committed pages of %; unreachable_landed=%',
    v_total, v_pages, p_page, v_landed;
END;
$procedure$;

REVOKE ALL ON PROCEDURE public.sp_ca_resolve_settled_financial_alerts_in_pages(integer, integer) FROM PUBLIC, anon, authenticated;

DO $job$
DECLARE before_job cron.job%ROWTYPE; after_job cron.job%ROWTYPE;
  candidate constant text := 'CALL public.sp_ca_resolve_settled_financial_alerts_in_pages(500, 40);';
BEGIN
  SELECT * INTO STRICT before_job FROM cron.job WHERE jobid = 354;
  PERFORM cron.alter_job(job_id := 354, command := candidate);
  SELECT * INTO STRICT after_job FROM cron.job WHERE jobid = 354;
  IF after_job.command IS DISTINCT FROM candidate
     OR (to_jsonb(before_job) - 'command') IS DISTINCT FROM (to_jsonb(after_job) - 'command') THEN
    RAISE EXCEPTION 'SETTLED_ALERT_CLOSER_JOB_POSTIMAGE: job 354 did not take exactly the paged command';
  END IF;
END
$job$;

DO $postimage$
DECLARE v_t pg_trigger%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_t FROM pg_trigger
   WHERE tgname = 'zz_ca_alert_resolution_reaches_the_incident'
     AND tgrelid = 'public.financial_alerts'::regclass AND NOT tgisinternal;
  -- tgtype bit 0 = ROW; 2 = BEFORE; 16 = UPDATE
  IF (v_t.tgtype::int & 1) <> 0 OR (v_t.tgtype::int & 2) <> 0 OR (v_t.tgtype::int & 16) = 0
     OR v_t.tgoldtable IS DISTINCT FROM 'ca_alert_resolution_old'
     OR v_t.tgnewtable IS DISTINCT FROM 'ca_alert_resolution_new'
     OR v_t.tgenabled <> 'O' THEN
    RAISE EXCEPTION 'ALERT_RESOLUTION_ROLLUP_POSTIMAGE: the roll-up is not AFTER UPDATE FOR EACH STATEMENT with both transition tables';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ca_alert_resolution_reaches_the_incident()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_alert_resolution_reaches_the_incident()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sp_ca_resolve_settled_financial_alerts_in_pages(integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sp_ca_resolve_settled_financial_alerts_in_pages(integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ALERT_RESOLUTION_ROLLUP_POSTIMAGE: a browser role can execute the roll-up or the pager';
  END IF;
END
$postimage$;

COMMIT;
