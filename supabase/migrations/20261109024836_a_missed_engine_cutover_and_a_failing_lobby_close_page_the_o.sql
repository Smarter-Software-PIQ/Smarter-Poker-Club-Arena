-- 20261109024836_a_missed_engine_cutover_and_a_failing_lobby_close_page_the_o.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- A MISSED 04:00 ENGINE CUTOVER, AND A LOBBY CLOSE THAT KEEPS FAILING, PAGE
-- THE OWNER (owner, 2026-11-08)
-- ============================================================================
--
-- WHAT WENT WRONG ON 2026-11-08, measured on production:
--  * Production held 391f7bc0 (released 2026-11-07 21:22Z) through the
--    2026-11-08 04:00 Chicago window although protected main already held a
--    newer engine. The Stage run that owned the date arrived 6 hours late
--    (GitHub delivered its schedule at 15:31Z), so nothing was prepared and
--    the cutover silently did not happen. Nothing paged.
--  * fn_daily_window_close_seat_first_lobbies failed 108 times between 03:00
--    and 05:05 Chicago (record "old" has no field "late_reg_levels", then
--    CANCELLATION_GLOBAL_LANE_BUSY). Each failure was a WARNING inbox row
--    under its own tournament key; nothing reached the owner.
--
-- WHAT THIS CHANGES (read-only watches; nothing here starts, retries or
-- changes a release, a lobby, an engine or money):
--
-- 1. public.fn_ca_engine_cutover_watch(p_at) - pg_cron every 5 minutes. It
--    reads America/Chicago itself (DST-aware, no second schedule) and returns
--    at once, with no outside read, before 04:30 or once the day is decided,
--    unless an alarm is open. GitHub is asked once per day (2-3 requests) and
--    again only when the serving build changes while an alarm is open.
--    It does NOT depend on any GitHub event arriving: the database itself asks
--      - the serving build: engine_leader.engine_version (the 8-hex build the
--        database already learns from the engine heartbeat), and
--        https://engine.smarter.poker/health releaseSha (full SHA) through the
--        existing extensions.http, the same path fn_ca_table_stall_watch_tick
--        uses for /metrics;
--      - the build owed: the newest engine-runtime commit on protected main
--        (path server/, excluding *.test.ts, server/sim, server/qualification,
--        exactly stage-engine-release.yml's LATEST_REQUIRED filter) committed
--        before that day's 03:30 Chicago preparation cutoff, read from the
--        public GitHub REST API; whether the serving build already contains
--        it (compare API). Nothing is owed when it does.
--    From 04:30 Chicago, when the owed build is not held, it raises ONE
--    critical "EngineCutoverMissed" alert (source engine-cutover-watch, key
--    missed:<Chicago date>) naming the build still serving, the build owed,
--    and the known reason: the newest engine_deploy_exit_paths receipt for the
--    window (a failed or refused release: its stage and error) or, when there
--    is none, "no preparation run reached the receiver". The owner page route
--    is the existing one (zz_a_real_alert_reaches_the_owner): the kinds
--    'releases' and 'daily_window' are added to fn_ca_owner_page_kind and
--    ca_owner_page_state, each with its own episode clock, so one never holds
--    back the other's page.
--    It closes itself (status resolved, with the time and build) on the first
--    run that finds production holding the owed build, on any later day too.
--    With no receiver receipt it asks GitHub whether that date's
--    daily-engine-selection artifact exists: absent is "no preparation run";
--    present, with nothing sent, is "refused selection".
--    "Could not tell" stays its own outcome (CLAUDE.md 10.86): when GitHub or
--    /health cannot be read it raises nothing and says 'unknown'.
--
-- 2. public.fn_ca_daily_window_lobby_close_page(p_at) - every 5 minutes
--    03:00-06:00 Chicago (pg_cron */5 8-11 UTC; the function checks Chicago
--    time). When the lobby close has recorded failures continuously for 15
--    minutes or more today (first failure 15+ minutes ago, at least 3 failures,
--    and a failure in the last 10 minutes), it raises ONE critical "DailyWindowLobbyCloseKeepsFailing"
--    (source daily-window, key close-keeps-failing:<date>) with the count, the
--    lobbies and the latest error, paged as kind 'daily_window'. It resolves when
--    no failure has been recorded for 10 minutes.
--
-- 3. public.fn_sp_digest_engine_cutover(p_day) - one read-only line for the
--    Daily Operations Digest: the live engine build and since when, and
--    whether the 04:00 cutover on the morning after p_day happened, was
--    missed, or was not owed. fn_sp_daily_digest returns it under the key
--    'engine_cutover'.
--
-- Native proof: scripts/ci/test-a-missed-engine-cutover-is-paged.py
-- (PostgreSQL 17, never production).
--
-- periodic-work: both schedules are detectors that page a person; they move no money, seats, lobbies or releases, retry nothing and repair nothing. The cutover watch must run from the database clock because the failure it reports is a GitHub event that did not arrive on time, and the lobby close page reads only the failures the engine already records.

-- @live-proof: (SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-engine-cutover-watch-5m' AND schedule = '*/5 * * * *' AND active) AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-daily-window-lobby-close-page-5m' AND schedule = '*/5 8-11 * * *' AND active) AND to_regprocedure('public.fn_ca_engine_cutover_watch(timestamp with time zone)') IS NOT NULL AND to_regprocedure('public.fn_ca_daily_window_lobby_close_page(timestamp with time zone)') IS NOT NULL AND to_regprocedure('public.fn_sp_digest_engine_cutover(date)') IS NOT NULL AND (SELECT count(*) FROM public.ca_owner_page_state WHERE kind IN ('releases', 'daily_window')) = 2 AND public.fn_ca_owner_page_kind('daily-window', 'DailyWindowLobbyCloseKeepsFailing', 'critical') = 'daily_window' AND public.fn_ca_owner_page_kind('engine-cutover-watch', 'EngineCutoverMissed', 'critical') = 'releases' AND strpos(pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure), 'fn_sp_digest_engine_cutover') > 0 AND NOT has_function_privilege('anon', 'public.fn_ca_engine_cutover_watch(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_sp_digest_engine_cutover(date)', 'EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_owner_page_kind(text,text,text)'::regprocedure)) <> '62dc62e1ed9f47cd0ac599e44c2ebddf' THEN
    RAISE EXCEPTION 'CUTOVER_WATCH_PREIMAGE_CHANGED: fn_ca_owner_page_kind';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure)) <> '230108ce37e54f57ea776786ddadd3b5' THEN
    RAISE EXCEPTION 'CUTOVER_WATCH_PREIMAGE_CHANGED: fn_ca_a_real_alert_reaches_the_owner';
  END IF;
  IF md5(pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure)) <> 'fd1ecf4cf7d60243667074c3c8afbfce' THEN
    RAISE EXCEPTION 'CUTOVER_WATCH_PREIMAGE_CHANGED: fn_sp_daily_digest';
  END IF;
END
$pre$;

-- Remembers what the watch last saw, so the digest can say "since when" and
-- the day's verdict without asking GitHub again. No foreign key (CLAUDE.md
-- section 2 rule 7).
CREATE TABLE smarter_private.ca_engine_cutover_days (
  chicago_day date PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  serving_sha text,
  serving_since timestamptz,
  owed_sha text,
  owed_committed_at timestamptz,
  verdict text NOT NULL CHECK (verdict IN ('sealed', 'missed', 'not_owed', 'unknown')),
  reason text,
  alert_id bigint,
  resolved_at timestamptz
);
REVOKE ALL ON smarter_private.ca_engine_cutover_days FROM PUBLIC, anon, authenticated;

-- The owner page route gains one kind: releases.
ALTER TABLE public.ca_owner_page_state DROP CONSTRAINT ca_owner_page_state_kind_check;
ALTER TABLE public.ca_owner_page_state ADD CONSTRAINT ca_owner_page_state_kind_check
  CHECK (kind IN ('dealing', 'restarts', 'money', 'releases', 'daily_window'));
INSERT INTO public.ca_owner_page_state (kind) VALUES ('releases'), ('daily_window') ON CONFLICT (kind) DO NOTHING;

DO $patch$
DECLARE
  v_kind text := pg_get_functiondef('public.fn_ca_owner_page_kind(text,text,text)'::regprocedure);
  v_page text := pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure);
BEGIN
  IF strpos(v_kind, E'THEN ''money''\n  END;') = 0 THEN RAISE EXCEPTION 'CUTOVER_WATCH_KIND_ANCHOR'; END IF;
  EXECUTE replace(v_kind, E'THEN ''money''\n  END;',
    E'THEN ''money''\n    WHEN p_source = ''engine-cutover-watch'' AND p_alertname = ''EngineCutoverMissed'' AND p_severity = ''critical'' THEN ''releases''\n'
    || E'    WHEN p_source = ''daily-window'' AND p_alertname = ''DailyWindowLobbyCloseKeepsFailing'' AND p_severity = ''critical'' THEN ''daily_window''\n  END;');
  IF strpos(v_page, E'               WHEN ''restarts'' THEN ''Engine Restart Storm''\n') = 0
     OR strpos(v_page, E'COALESCE(\n      NULLIF(NEW.payload->''alert''->''annotations''->>''summary'', ''''),') = 0 THEN
    RAISE EXCEPTION 'CUTOVER_WATCH_PAGE_ANCHOR';
  END IF;
  v_page := replace(v_page, E'               WHEN ''restarts'' THEN ''Engine Restart Storm''\n',
    E'               WHEN ''restarts'' THEN ''Engine Restart Storm''\n               WHEN ''releases'' THEN ''Engine Update Missed At 4 AM''\n               WHEN ''daily_window'' THEN ''3 AM Lobby Close Keeps Failing''\n');
  v_page := replace(v_page, E'COALESCE(\n      NULLIF(NEW.payload->''alert''->''annotations''->>''summary'', ''''),',
    E'COALESCE(\n      NULLIF(CASE WHEN v_kind IN (''releases'', ''daily_window'') THEN NEW.payload->>''summary'' END, ''''),\n      NULLIF(NEW.payload->''alert''->''annotations''->>''summary'', ''''),');
  EXECUTE v_page;
END
$patch$;

-- ---------------------------------------------------------------------------
-- The two reads from outside. Each returns NULL when it cannot tell.
-- ---------------------------------------------------------------------------
CREATE FUNCTION smarter_private.ca_cutover_http_json(p_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_status integer; v_body text;
BEGIN
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
  SELECT h.status, h.content INTO v_status, v_body
    FROM extensions.http((
      'GET', p_url,
      ARRAY[extensions.http_header('User-Agent', 'club-arena-engine-cutover-watch'),
            extensions.http_header('Accept', 'application/vnd.github+json')],
      NULL, NULL)::extensions.http_request) h;
  IF v_status IS DISTINCT FROM 200 THEN RETURN NULL; END IF;
  RETURN v_body::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.ca_cutover_http_json(text) FROM PUBLIC, anon, authenticated;

-- The newest engine-runtime commit on main before p_cutoff, and whether
-- p_serving already contains it. Returns {owed_sha, owed_at, held} or NULL.
CREATE FUNCTION smarter_private.ca_cutover_owed_build(p_serving text, p_cutoff timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c_repo constant text := 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  v_list jsonb; v_cmp jsonb; v_commit jsonb; v_files jsonb;
  v_sha text; v_at timestamptz; v_page integer := 1; v_runtime boolean;
BEGIN
  IF p_serving !~ '^[0-9a-f]{40}$' THEN RETURN NULL; END IF;
  -- Walk newest-first server/ commits before the cutoff until one touches
  -- engine runtime (not only tests, sim or qualification).
  WHILE v_page <= 1 LOOP
    v_list := smarter_private.ca_cutover_http_json(format('%s/commits?sha=main&path=server&until=%s&per_page=20&page=%s',
                c_repo, to_char(p_cutoff AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), v_page));
    IF v_list IS NULL OR jsonb_typeof(v_list) <> 'array' THEN RETURN NULL; END IF;
    IF jsonb_array_length(v_list) = 0 THEN EXIT; END IF;
    FOR v_commit IN SELECT x FROM jsonb_array_elements(v_list) x LOOP
      IF v_commit->>'sha' = p_serving THEN
        -- Reached the serving build: nothing newer touched runtime.
        RETURN jsonb_build_object('owed_sha', NULL, 'owed_at', NULL, 'held', true);
      END IF;
      v_cmp := smarter_private.ca_cutover_http_json(format('%s/commits/%s', c_repo, v_commit->>'sha'));
      IF v_cmp IS NULL THEN RETURN NULL; END IF;
      v_files := COALESCE(v_cmp->'files', '[]'::jsonb);
      SELECT bool_or(f->>'filename' LIKE 'server/%' AND f->>'filename' NOT LIKE '%.test.ts'
                     AND f->>'filename' NOT LIKE 'server/sim/%' AND f->>'filename' NOT LIKE 'server/qualification/%')
        INTO v_runtime FROM jsonb_array_elements(v_files) f;
      IF COALESCE(v_runtime, false) THEN
        v_sha := v_commit->>'sha';
        v_at := (v_commit->'commit'->'committer'->>'date')::timestamptz;
        EXIT;
      END IF;
    END LOOP;
    EXIT WHEN v_sha IS NOT NULL;
    v_page := v_page + 1;
  END LOOP;
  IF v_sha IS NULL THEN RETURN NULL; END IF;
  -- Does the serving build contain it? (behind/identical = held)
  v_cmp := smarter_private.ca_cutover_http_json(format('%s/compare/%s...%s', c_repo, v_sha, p_serving));
  IF v_cmp IS NULL OR v_cmp->>'status' IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('owed_sha', v_sha, 'owed_at', v_at,
                            'held', v_cmp->>'status' IN ('identical', 'ahead'));
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.ca_cutover_owed_build(text, timestamptz) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. The missed-cutover alarm.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_engine_cutover_watch(p_at timestamptz DEFAULT clock_timestamp())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '50s'
AS $function$
DECLARE
  c_tz constant text := 'America/Chicago';
  c_repo constant text := 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  v_local timestamp := p_at AT TIME ZONE c_tz;
  v_day date := v_local::date;
  v_window timestamptz := (v_day + time '04:00') AT TIME ZONE c_tz;
  v_cutoff timestamptz := (v_day + time '03:30') AT TIME ZONE c_tz;
  v_row smarter_private.ca_engine_cutover_days%ROWTYPE;
  v_leader text; v_since timestamptz;
  v_serving text; v_owed jsonb; v_cmp jsonb; v_runs jsonb;
  v_reason text; v_exit record; v_verdict text; v_shipped boolean;
  v_open record; v_id bigint; v_summary text; v_resolved integer := 0;
BEGIN
  SELECT l.engine_version, l.acquired_at INTO v_leader, v_since
    FROM public.engine_leader l ORDER BY l.heartbeat_at DESC NULLS LAST LIMIT 1;
  -- "Since" is the sealed release of that build, not a later restart.
  SELECT COALESCE(max(e.recorded_at), v_since) INTO v_since FROM public.engine_deploy_exit_paths e
   WHERE e.outcome = 'shipped' AND left(e.target_sha, 8) = left(v_leader, 8);
  SELECT * INTO v_row FROM smarter_private.ca_engine_cutover_days WHERE chicago_day = v_day;

  -- Nothing to do: before 04:30 with no alarm open, or today is decided and
  -- no alarm is open. A missed day stays open until the owed build is held.
  IF NOT EXISTS (SELECT 1 FROM public.operational_alert_events
                  WHERE source = 'engine-cutover-watch' AND alertname = 'EngineCutoverMissed' AND status = 'firing')
     AND (v_local::time < time '04:30' OR v_row.verdict IN ('sealed', 'not_owed')) THEN
    RETURN jsonb_build_object('ok', true, 'state', COALESCE(v_row.verdict, 'before_0430'), 'chicago_day', v_day);
  END IF;

  v_serving := smarter_private.ca_cutover_http_json('https://engine.smarter.poker/health')->>'releaseSha';
  IF v_serving IS NULL OR v_serving !~ '^[0-9a-f]{40}$'
     OR (v_leader IS NOT NULL AND left(v_serving, 8) <> left(v_leader, 8)) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'unknown', 'reason', 'engine /health did not report one releaseSha matching the leader');
  END IF;

  -- An open alarm (today's or an earlier day's) closes once production holds
  -- the build it named. Only asked again when the serving build has changed.
  FOR v_open IN
    SELECT o.id, o.event_key, o.payload->>'owed_sha' AS owed, o.payload->>'serving_sha' AS was
      FROM public.operational_alert_events o
     WHERE o.source = 'engine-cutover-watch' AND o.alertname = 'EngineCutoverMissed' AND o.status = 'firing'
  LOOP
    CONTINUE WHEN v_open.was = v_serving;
    v_cmp := smarter_private.ca_cutover_http_json(format('%s/compare/%s...%s', c_repo, v_open.owed, v_serving));
    CONTINUE WHEN v_cmp IS NULL OR v_cmp->>'status' NOT IN ('identical', 'ahead');
    UPDATE public.operational_alert_events
       SET status = 'resolved', last_received_at = p_at,
           payload = payload || jsonb_build_object('resolved_at', p_at,
             'resolution', format('production now holds %s, which contains the owed %s', left(v_serving, 8), left(v_open.owed, 8)))
     WHERE id = v_open.id AND status = 'firing';
    UPDATE smarter_private.ca_engine_cutover_days SET resolved_at = p_at, checked_at = p_at
     WHERE alert_id = v_open.id;
    v_resolved := v_resolved + 1;
  END LOOP;

  IF v_local::time < time '04:30' OR v_row.verdict IN ('sealed', 'not_owed') THEN
    RETURN jsonb_build_object('ok', true, 'state', COALESCE(v_row.verdict, 'before_0430'), 'resolved', v_resolved);
  END IF;
  IF v_row.verdict = 'missed' THEN
    UPDATE smarter_private.ca_engine_cutover_days SET checked_at = p_at, serving_sha = v_serving WHERE chicago_day = v_day;
    RETURN jsonb_build_object('ok', true, 'state', CASE WHEN v_resolved > 0 THEN 'resolved' ELSE 'missed' END,
                              'serving', left(v_serving, 8), 'owed', left(v_row.owed_sha, 8), 'resolved', v_resolved);
  END IF;

  -- First decision for today: which engine build was owed going into 04:00?
  v_owed := smarter_private.ca_cutover_owed_build(v_serving, v_cutoff);
  IF v_owed IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'state', 'unknown', 'reason', 'GitHub could not be read', 'serving', left(v_serving, 8));
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.engine_deploy_exit_paths e
                  WHERE e.outcome = 'shipped' AND e.recorded_at >= v_cutoff AND e.recorded_at < p_at
                    AND left(e.target_sha, 8) = left(v_serving, 8)) INTO v_shipped;
  IF (v_owed->>'held')::boolean THEN
    v_verdict := CASE WHEN v_shipped OR (v_since >= v_window - interval '5 minutes' AND v_since < v_window + interval '30 minutes')
                      THEN 'sealed' ELSE 'not_owed' END;
    INSERT INTO smarter_private.ca_engine_cutover_days (chicago_day, checked_at, serving_sha, serving_since, owed_sha, owed_committed_at, verdict)
    VALUES (v_day, p_at, v_serving, v_since, v_owed->>'owed_sha', (v_owed->>'owed_at')::timestamptz, v_verdict)
    ON CONFLICT (chicago_day) DO NOTHING;
    RETURN jsonb_build_object('ok', true, 'state', v_verdict, 'serving', left(v_serving, 8),
                              'owed', left(v_owed->>'owed_sha', 8), 'resolved', v_resolved);
  END IF;

  -- Owed and not held: name why. A receiver receipt for this window wins;
  -- without one, say whether GitHub delivered a preparation run at all.
  SELECT e.run_id, e.stage, e.outcome, left(COALESCE(e.error, e.release_result, ''), 200) AS error, e.recorded_at, left(e.target_sha, 8) AS target
    INTO v_exit
    FROM public.engine_deploy_exit_paths e
   WHERE e.recorded_at >= v_cutoff - interval '5 hours' AND e.recorded_at < p_at
   ORDER BY e.recorded_at DESC LIMIT 1;
  IF v_exit.run_id IS NULL THEN
    -- The admitted daily selection job uploads daily-engine-selection-<date>
    -- (stage-engine-release.yml job selection). Present: a preparation ran
    -- and chose nothing to send. Absent: no preparation run was admitted.
    v_runs := smarter_private.ca_cutover_http_json(format('%s/actions/artifacts?name=daily-engine-selection-%s&per_page=1',
                c_repo, to_char(v_day, 'YYYY-MM-DD')));
  END IF;
  v_reason := CASE
    WHEN v_exit.run_id IS NOT NULL AND v_exit.outcome = 'shipped'
      THEN format('a release of %s sealed at %s, but it does not contain %s', v_exit.target,
                  to_char(v_exit.recorded_at AT TIME ZONE c_tz, 'HH24:MI "Central"'), left(v_owed->>'owed_sha', 8))
    WHEN v_exit.run_id IS NOT NULL AND v_exit.stage IN ('admit', 'engine-doors', 'prepare', 'stage')
      THEN format('the release was refused at %s: %s (run %s)', v_exit.stage, v_exit.error, v_exit.run_id)
    WHEN v_exit.run_id IS NOT NULL
      THEN format('the release failed at %s: %s (run %s)', v_exit.stage, v_exit.error, v_exit.run_id)
    WHEN v_runs IS NULL THEN 'no release attempt was recorded; whether a preparation run arrived could not be read from GitHub'
    WHEN COALESCE((v_runs->>'total_count')::int, 0) = 0
      THEN 'no preparation run: no Stage run was admitted for the 03:30-03:50 preparation of this date'
    ELSE 'refused selection: the 03:30 preparation ran but selected no Backup-certified build to send (read its daily-engine-selection artifact)' END;
  v_summary := format('The 4 AM engine update did not happen on %s. Still serving %s (since %s); owed %s. Reason: %s.',
                      to_char(v_day, 'Mon FMDD'), left(v_serving, 8),
                      to_char(v_since AT TIME ZONE c_tz, 'Mon FMDD HH24:MI "Central"'), left(v_owed->>'owed_sha', 8), v_reason);
  v_id := public.fn_record_operational_alert('engine-cutover-watch', 'missed:' || v_day::text, 'EngineCutoverMissed',
    'firing', 'critical', jsonb_build_object(
      'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
      'summary', v_summary, 'chicago_day', v_day, 'serving_sha', v_serving, 'serving_since', v_since,
      'owed_sha', v_owed->>'owed_sha', 'owed_committed_at', v_owed->>'owed_at', 'reason', v_reason,
      'latest_receipt', CASE WHEN v_exit.run_id IS NULL THEN NULL ELSE to_jsonb(v_exit) END, 'at', p_at));
  INSERT INTO smarter_private.ca_engine_cutover_days (chicago_day, checked_at, serving_sha, serving_since, owed_sha, owed_committed_at, verdict, reason, alert_id)
  VALUES (v_day, p_at, v_serving, v_since, v_owed->>'owed_sha', (v_owed->>'owed_at')::timestamptz, 'missed', v_reason, v_id)
  ON CONFLICT (chicago_day) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'state', 'missed', 'serving', left(v_serving, 8),
                            'owed', left(v_owed->>'owed_sha', 8), 'reason', v_reason, 'alert_id', v_id, 'resolved', v_resolved);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_engine_cutover_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_cutover_watch(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The lobby close that keeps failing pages.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_daily_window_lobby_close_page(p_at timestamptz DEFAULT clock_timestamp())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '20s'
AS $function$
DECLARE
  c_tz constant text := 'America/Chicago';
  v_local timestamp := p_at AT TIME ZONE c_tz;
  v_day date := v_local::date;
  v_from timestamptz := (v_day + time '03:00') AT TIME ZONE c_tz;
  v_first timestamptz; v_last timestamptz; v_failures bigint; v_lobbies integer; v_error text;
  v_key text := 'close-keeps-failing:' || to_char(v_day, 'YYYYMMDD');
  v_open public.operational_alert_events%ROWTYPE;
  v_id bigint;
BEGIN
  IF v_local::time < time '03:00' OR v_local::time >= time '06:15' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'outside_hours');
  END IF;
  -- Each failing lobby is one row whose delivery_count counts its failures:
  -- received_at is its first failure, last_received_at its latest.
  SELECT min(GREATEST(o.received_at, v_from)), max(o.last_received_at), sum(o.delivery_count), count(*),
         (array_agg(o.payload->>'error' ORDER BY o.last_received_at DESC))[1]
    INTO v_first, v_last, v_failures, v_lobbies, v_error
    FROM public.operational_alert_events o
   WHERE o.source = 'daily-window' AND o.alertname = 'DailyWindowLobbyCloseFailed'
     AND o.last_received_at >= v_from AND o.last_received_at <= p_at;
  SELECT * INTO v_open FROM public.operational_alert_events WHERE source = 'daily-window' AND event_key = v_key;

  IF v_last IS NULL OR v_last < p_at - interval '10 minutes' THEN
    IF v_open.id IS NOT NULL AND v_open.status = 'firing' THEN
      UPDATE public.operational_alert_events
         SET status = 'resolved', last_received_at = p_at,
             payload = payload || jsonb_build_object('resolved_at', p_at, 'resolution', 'no lobby close failure for 10 minutes')
       WHERE id = v_open.id;
      RETURN jsonb_build_object('ok', true, 'state', 'resolved');
    END IF;
    RETURN jsonb_build_object('ok', true, 'state', 'clear');
  END IF;

  IF v_first <= p_at - interval '15 minutes' AND v_failures >= 3 THEN
    IF v_open.id IS NULL THEN
      v_id := public.fn_record_operational_alert('daily-window', v_key, 'DailyWindowLobbyCloseKeepsFailing', 'firing', 'critical',
        jsonb_build_object('target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
          'summary', format('The 3 AM Spin and Sit & Go lobby close has been failing since %s Central: %s failures across %s lobbies. Latest error: %s',
                            to_char(v_first AT TIME ZONE c_tz, 'HH24:MI'), v_failures, v_lobbies, left(COALESCE(v_error, 'unknown'), 160)),
          'first_failure_at', v_first, 'latest_failure_at', v_last, 'failures', v_failures, 'lobbies', v_lobbies,
          'latest_error', v_error, 'at', p_at));
      RETURN jsonb_build_object('ok', false, 'state', 'paged', 'alert_id', v_id, 'failures', v_failures);
    END IF;
    UPDATE public.operational_alert_events SET last_received_at = p_at, delivery_count = delivery_count + 1,
           payload = payload || jsonb_build_object('failures', v_failures, 'latest_error', v_error, 'latest_failure_at', v_last)
     WHERE id = v_open.id AND status = 'firing';
    RETURN jsonb_build_object('ok', false, 'state', 'still_failing', 'failures', v_failures);
  END IF;
  RETURN jsonb_build_object('ok', false, 'state', 'failing_under_15_minutes', 'failures', v_failures);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_daily_window_lobby_close_page(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_daily_window_lobby_close_page(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The digest line.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_sp_digest_engine_cutover(p_day date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'live_build', left(l.engine_version, 8),
    'live_since', s.at,
    'live_since_ct', to_char(s.at AT TIME ZONE 'America/Chicago', 'Mon FMDD HH24:MI'),
    'cutover_day', p_day + 1,
    'cutover', COALESCE(d.verdict, 'not_checked'),
    'owed_build', left(d.owed_sha, 8),
    'reason', d.reason,
    'resolved_at', d.resolved_at)
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (SELECT * FROM public.engine_leader ORDER BY heartbeat_at DESC NULLS LAST LIMIT 1) l ON true
    -- Since the sealed release of that build; the leader's own start otherwise.
    LEFT JOIN LATERAL (SELECT COALESCE(max(e.recorded_at), l.acquired_at) AS at FROM public.engine_deploy_exit_paths e
                        WHERE e.outcome = 'shipped' AND left(e.target_sha, 8) = left(l.engine_version, 8)) s ON true
    LEFT JOIN smarter_private.ca_engine_cutover_days d ON d.chicago_day = p_day + 1;
$function$;
REVOKE ALL ON FUNCTION public.fn_sp_digest_engine_cutover(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_digest_engine_cutover(date) TO service_role;

DO $digest$
DECLARE v text := pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure);
BEGIN
  IF strpos(v, E'    ''horse_roster'', public.fn_ca_horse_roster_digest(v_day),\n') = 0 THEN
    RAISE EXCEPTION 'CUTOVER_WATCH_DIGEST_ANCHOR';
  END IF;
  EXECUTE replace(v, E'    ''horse_roster'', public.fn_ca_horse_roster_digest(v_day),\n',
    E'    ''horse_roster'', public.fn_ca_horse_roster_digest(v_day),\n    ''engine_cutover'', public.fn_sp_digest_engine_cutover(v_day),\n');
END
$digest$;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-engine-cutover-watch-5m') THEN
    PERFORM cron.unschedule('ca-engine-cutover-watch-5m');
  END IF;
  PERFORM cron.schedule('ca-engine-cutover-watch-5m', '*/5 * * * *',
                        'select public.fn_ca_engine_cutover_watch();');
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-daily-window-lobby-close-page-5m') THEN
    PERFORM cron.unschedule('ca-daily-window-lobby-close-page-5m');
  END IF;
  PERFORM cron.schedule('ca-daily-window-lobby-close-page-5m', '*/5 8-11 * * *',
                        'select public.fn_ca_daily_window_lobby_close_page();');
END
$schedule$;

COMMIT;
