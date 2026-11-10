-- 20261109182123_a_merged_migration_still_uninstalled_after_an_hour_pages_the.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- A MERGED MIGRATION STILL UNINSTALLED AN HOUR AFTER MERGE PAGES THE OWNER
-- (owner-approved pipeline improvement, 2026-11-09)
-- ============================================================================
--
-- WHAT GOES WRONG: a migration merges to main and never reaches production.
-- The dispatcher did not run (#7971, 2026-10-25; #9858 and #9957,
-- 2026-11-07), the applier refused it and nobody dispatched it again (#10026,
-- #10029, 2026-11-08), or the run was cancelled in the queue (2026-10-24,
-- 20261024213143). Each time the file sat uninstalled until somebody noticed.
-- The applier's own summary is its reader, and nothing reads a run that never
-- happened.
--
-- WHAT THIS CHANGES (a read-only detector; it pages and does nothing else):
--
-- public.fn_ca_merged_migration_install_watch(p_at) - pg_cron every 10
-- minutes. It reads main's new commits under supabase/migrations from the
-- public GitHub REST API through the same helper the engine cutover watch
-- uses (smarter_private.ca_cutover_http_json), about one list request per run
-- plus one per new migration commit, and remembers each file a merge ADDED
-- (version, file, merge commit, merge time). A later commit that removes or
-- renames the file retires it. Then, for every remembered file that is
-- neither installed (supabase_migrations.schema_migrations) nor retired:
--   * merged 60 minutes ago or more -> ONE critical
--     "MergedMigrationNotInstalled" alert (source migration-install-watch,
--     key uninstalled:<version>), paged through the existing owner route
--     (zz_a_real_alert_reaches_the_owner) as the new kind 'migrations', with
--     its own episode clock so it never holds back a release page;
--   * once installed or retired -> the alert resolves itself.
-- A file that declares the daily-maintenance install window (CLAUDE.md section
-- 2 rule 10) is installed by the 04:00 Chicago window by design, so it is
-- remembered but never paged here.
--
-- It never installs, dispatches, retries or repairs anything (CLAUDE.md
-- 10.11, 10.12): the owner, or the agent the page reaches, dispatches Apply
-- Merged Migration. "Could not tell" stays its own outcome (CLAUDE.md
-- 10.86): when GitHub cannot be read the run raises nothing new, says
-- 'unknown' and keeps its cursor; files already remembered still resolve.
--
-- Native proof: scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py
-- (PostgreSQL 17, never production).
--
-- periodic-work: a detector that pages a person; it moves no money, seats, lobbies, releases or schema, retries nothing and repairs nothing. It must run from the database clock because the failure it reports is an install event that never happened.

-- @live-proof: (SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-merged-migration-install-watch-10m' AND schedule = '*/10 * * * *' AND active) AND to_regprocedure('public.fn_ca_merged_migration_install_watch(timestamp with time zone)') IS NOT NULL AND EXISTS (SELECT 1 FROM public.ca_owner_page_state WHERE kind = 'migrations') AND public.fn_ca_owner_page_kind('migration-install-watch', 'MergedMigrationNotInstalled', 'critical') = 'migrations' AND public.fn_ca_owner_page_kind('engine-cutover-watch', 'EngineCutoverMissed', 'critical') = 'releases' AND strpos(pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure), 'Merged Migration Not Installed') > 0 AND (SELECT count(*) FROM smarter_private.ca_merged_migration_watch_cursor) = 1 AND NOT has_function_privilege('anon', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_owner_page_kind(text,text,text)'::regprocedure)) <> 'c4bb669de4d2558d30eefa63e60923fb' THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_PREIMAGE_CHANGED: fn_ca_owner_page_kind';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure)) <> '45eb731db3636817ef8e2029e4049521' THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_PREIMAGE_CHANGED: fn_ca_a_real_alert_reaches_the_owner';
  END IF;
  IF to_regprocedure('smarter_private.ca_cutover_http_json(text)') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_PREIMAGE_CHANGED: smarter_private.ca_cutover_http_json';
  END IF;
END
$pre$;

-- What the watch remembers. No foreign key (CLAUDE.md section 2 rule 7).
CREATE TABLE smarter_private.ca_merged_migration_watch (
  version text PRIMARY KEY CHECK (version ~ '^[0-9]{14}$'),
  file text NOT NULL,
  merge_sha text NOT NULL,
  merged_at timestamptz NOT NULL,
  window_install boolean NOT NULL,
  first_seen_at timestamptz NOT NULL,
  retired_at timestamptz,
  retired_by text,
  installed_seen_at timestamptz,
  alert_id bigint
);
REVOKE ALL ON smarter_private.ca_merged_migration_watch FROM PUBLIC, anon, authenticated;

CREATE TABLE smarter_private.ca_merged_migration_watch_commits (
  sha text PRIMARY KEY,
  committed_at timestamptz NOT NULL,
  read_at timestamptz NOT NULL
);
REVOKE ALL ON smarter_private.ca_merged_migration_watch_commits FROM PUBLIC, anon, authenticated;

-- One row: commits from this instant on are read. It starts two hours before
-- the install, so a file merged just before this migration is covered too.
CREATE TABLE smarter_private.ca_merged_migration_watch_cursor (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  since timestamptz NOT NULL,
  last_read_at timestamptz,
  last_state text
);
REVOKE ALL ON smarter_private.ca_merged_migration_watch_cursor FROM PUBLIC, anon, authenticated;
INSERT INTO smarter_private.ca_merged_migration_watch_cursor (since) VALUES (clock_timestamp() - interval '2 hours');

-- The owner page route gains one kind: migrations.
ALTER TABLE public.ca_owner_page_state DROP CONSTRAINT ca_owner_page_state_kind_check;
ALTER TABLE public.ca_owner_page_state ADD CONSTRAINT ca_owner_page_state_kind_check
  CHECK (kind IN ('dealing', 'restarts', 'money', 'releases', 'daily_window', 'migrations'));
INSERT INTO public.ca_owner_page_state (kind) VALUES ('migrations') ON CONFLICT (kind) DO NOTHING;

DO $patch$
DECLARE
  v_kind text := pg_get_functiondef('public.fn_ca_owner_page_kind(text,text,text)'::regprocedure);
  v_page text := pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure);
  c_kind_anchor constant text := E'THEN ''daily_window''\n  END;';
  c_title_anchor constant text := E'               WHEN ''daily_window'' THEN ''3 AM Lobby Close Keeps Failing''\n';
  c_summary_anchor constant text := E'CASE WHEN v_kind IN (''releases'', ''daily_window'') THEN';
BEGIN
  IF strpos(v_kind, c_kind_anchor) = 0 THEN RAISE EXCEPTION 'MIGRATION_WATCH_KIND_ANCHOR'; END IF;
  EXECUTE replace(v_kind, c_kind_anchor,
    E'THEN ''daily_window''\n    WHEN p_source = ''migration-install-watch'' AND p_alertname = ''MergedMigrationNotInstalled'' AND p_severity = ''critical'' THEN ''migrations''\n  END;');
  IF strpos(v_page, c_title_anchor) = 0 OR strpos(v_page, c_summary_anchor) = 0 THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_PAGE_ANCHOR';
  END IF;
  v_page := replace(v_page, c_title_anchor,
    c_title_anchor || E'               WHEN ''migrations'' THEN ''Merged Migration Not Installed''\n');
  v_page := replace(v_page, c_summary_anchor,
    E'CASE WHEN v_kind IN (''releases'', ''daily_window'', ''migrations'') THEN');
  EXECUTE v_page;
END
$patch$;

-- Raw file text (for the install-window declaration when GitHub omits the
-- patch). NULL when it cannot tell.
CREATE FUNCTION smarter_private.ca_migration_watch_raw(p_sha text, p_file text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_status integer; v_body text;
BEGIN
  IF p_sha !~ '^[0-9a-f]{40}$' OR p_file !~ '^supabase/migrations/[0-9]{14}_[A-Za-z0-9_.-]+\.sql$' THEN RETURN NULL; END IF;
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
  SELECT h.status, h.content INTO v_status, v_body
    FROM extensions.http((
      'GET', format('https://raw.githubusercontent.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/%s/%s', p_sha, p_file),
      ARRAY[extensions.http_header('User-Agent', 'club-arena-migration-install-watch')],
      NULL, NULL)::extensions.http_request) h;
  IF v_status IS DISTINCT FROM 200 THEN RETURN NULL; END IF;
  RETURN v_body;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.ca_migration_watch_raw(text, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_ca_merged_migration_install_watch(p_at timestamptz DEFAULT clock_timestamp())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '50s'
AS $function$
DECLARE
  c_tz constant text := 'America/Chicago';
  c_repo constant text := 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  c_file constant text := '^supabase/migrations/([0-9]{14})_[A-Za-z0-9_.-]+\.sql$';
  -- The window declaration, spelled in two pieces so this file is not read as one.
  c_window constant text := '(^|\n)\+?[ \t]*--[ \t]*@install' || '-window:[ \t]*daily-maintenance';
  v_cur smarter_private.ca_merged_migration_watch_cursor%ROWTYPE;
  v_list jsonb; v_commit jsonb; v_detail jsonb; v_f jsonb;
  v_sha text; v_at timestamptz; v_name text; v_prev text; v_text text;
  v_read boolean := true; v_new_commits integer := 0; v_newest timestamptz;
  v_row record; v_id bigint; v_raised integer := 0; v_resolved integer := 0; v_pending integer := 0;
BEGIN
  SELECT * INTO v_cur FROM smarter_private.ca_merged_migration_watch_cursor WHERE id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'state', 'busy');
  END IF;

  -- 1. Learn what main merged since the cursor, oldest first. GitHub lists
  --    newest first; 100 per page covers far more than ten minutes of merges.
  v_list := smarter_private.ca_cutover_http_json(format('%s/commits?sha=main&path=supabase/migrations&since=%s&per_page=100',
              c_repo, to_char(v_cur.since AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  IF v_list IS NULL OR jsonb_typeof(v_list) <> 'array' THEN
    v_read := false;
  ELSE
    FOR v_commit IN SELECT x FROM jsonb_array_elements(v_list) WITH ORDINALITY t(x, n) ORDER BY n DESC LOOP
      v_sha := v_commit->>'sha';
      v_at := (v_commit->'commit'->'committer'->>'date')::timestamptz;
      CONTINUE WHEN v_sha !~ '^[0-9a-f]{40}$' OR v_at IS NULL;
      CONTINUE WHEN EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch_commits WHERE sha = v_sha);
      v_detail := smarter_private.ca_cutover_http_json(format('%s/commits/%s', c_repo, v_sha));
      IF v_detail IS NULL OR jsonb_typeof(v_detail->'files') <> 'array' THEN
        v_read := false;
        EXIT;  -- read it next run; nothing after it is marked read either
      END IF;
      FOR v_f IN SELECT f FROM jsonb_array_elements(v_detail->'files') f LOOP
        v_name := v_f->>'filename';
        v_prev := v_f->>'previous_filename';
        -- A removal, or the old name of a rename, retires the file.
        IF v_f->>'status' = 'removed' AND v_name ~ c_file THEN
          UPDATE smarter_private.ca_merged_migration_watch SET retired_at = v_at, retired_by = v_sha
           WHERE version = substring(v_name FROM c_file) AND file = v_name AND retired_at IS NULL;
        END IF;
        IF v_f->>'status' = 'renamed' AND v_prev ~ c_file THEN
          UPDATE smarter_private.ca_merged_migration_watch SET retired_at = v_at, retired_by = v_sha
           WHERE version = substring(v_prev FROM c_file) AND file = v_prev AND retired_at IS NULL;
        END IF;
        -- An added (or renamed-to) file is remembered with its merge time.
        IF v_f->>'status' IN ('added', 'renamed') AND v_name ~ c_file THEN
          v_text := COALESCE(v_f->>'patch', smarter_private.ca_migration_watch_raw(v_sha, v_name));
          INSERT INTO smarter_private.ca_merged_migration_watch AS w
                 (version, file, merge_sha, merged_at, window_install, first_seen_at)
          VALUES (substring(v_name FROM c_file), v_name, v_sha, v_at, COALESCE(v_text ~ c_window, false), p_at)
          ON CONFLICT (version) DO UPDATE
             SET file = EXCLUDED.file, merge_sha = EXCLUDED.merge_sha, merged_at = EXCLUDED.merged_at,
                 window_install = EXCLUDED.window_install, retired_at = NULL, retired_by = NULL
           WHERE w.retired_at IS NOT NULL;
        END IF;
      END LOOP;
      INSERT INTO smarter_private.ca_merged_migration_watch_commits VALUES (v_sha, v_at, p_at);
      v_new_commits := v_new_commits + 1;
      v_newest := GREATEST(v_newest, v_at);
    END LOOP;
  END IF;
  -- The cursor only moves past commits that were read, with a margin for
  -- commits GitHub dates slightly out of order; read commits are skipped.
  UPDATE smarter_private.ca_merged_migration_watch_cursor
     SET since = CASE WHEN v_read AND v_newest IS NOT NULL THEN GREATEST(since, v_newest - interval '30 minutes') ELSE since END,
         last_read_at = CASE WHEN v_read THEN p_at ELSE last_read_at END,
         last_state = CASE WHEN v_read THEN 'read' ELSE 'unknown' END
   WHERE id;
  DELETE FROM smarter_private.ca_merged_migration_watch_commits WHERE committed_at < p_at - interval '7 days';

  -- 2. Installed or retired: close the page.
  FOR v_row IN
    SELECT w.version, w.alert_id, w.retired_at, sm.version IS NOT NULL AS installed
      FROM smarter_private.ca_merged_migration_watch w
      LEFT JOIN supabase_migrations.schema_migrations sm ON sm.version = w.version
     WHERE w.installed_seen_at IS NULL AND (sm.version IS NOT NULL OR w.retired_at IS NOT NULL)
  LOOP
    UPDATE smarter_private.ca_merged_migration_watch
       SET installed_seen_at = CASE WHEN v_row.installed THEN p_at END
     WHERE version = v_row.version;
    IF v_row.alert_id IS NOT NULL THEN
      UPDATE public.operational_alert_events
         SET status = 'resolved', last_received_at = p_at,
             payload = payload || jsonb_build_object('resolved_at', p_at,
               'resolution', CASE WHEN v_row.installed THEN 'installed in production' ELSE 'removed from main' END)
       WHERE id = v_row.alert_id AND status = 'firing';
      IF FOUND THEN v_resolved := v_resolved + 1; END IF;
    END IF;
  END LOOP;

  -- 3. Merged an hour ago, ordinary route, still not installed: page once.
  --    Only on a run that read GitHub, so a removal is never missed.
  FOR v_row IN
    SELECT w.* FROM smarter_private.ca_merged_migration_watch w
     WHERE w.installed_seen_at IS NULL AND w.retired_at IS NULL AND NOT w.window_install
       AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations sm WHERE sm.version = w.version)
     ORDER BY w.version
  LOOP
    v_pending := v_pending + 1;
    CONTINUE WHEN NOT v_read OR v_row.alert_id IS NOT NULL OR v_row.merged_at > p_at - interval '60 minutes';
    v_id := public.fn_record_operational_alert('migration-install-watch', 'uninstalled:' || v_row.version,
      'MergedMigrationNotInstalled', 'firing', 'critical', jsonb_build_object(
        'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
        'summary', format('%s merged at %s Central (%s) and is still not installed in production after %s minutes. Dispatch Apply Merged Migration for it and read the run''s result.',
                          regexp_replace(v_row.file, '^supabase/migrations/', ''),
                          to_char(v_row.merged_at AT TIME ZONE c_tz, 'Mon FMDD HH24:MI'), left(v_row.merge_sha, 8),
                          floor(extract(epoch FROM p_at - v_row.merged_at) / 60)::int),
        'version', v_row.version, 'file', v_row.file, 'merge_sha', v_row.merge_sha,
        'merged_at', v_row.merged_at, 'at', p_at));
    UPDATE smarter_private.ca_merged_migration_watch SET alert_id = v_id WHERE version = v_row.version;
    v_raised := v_raised + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', v_read, 'state', CASE WHEN v_read THEN 'read' ELSE 'unknown' END,
                            'new_commits', v_new_commits, 'pending', v_pending,
                            'raised', v_raised, 'resolved', v_resolved);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) TO service_role;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-merged-migration-install-watch-10m') THEN
    PERFORM cron.unschedule('ca-merged-migration-install-watch-10m');
  END IF;
  PERFORM cron.schedule('ca-merged-migration-install-watch-10m', '*/10 * * * *',
                        'select public.fn_ca_merged_migration_install_watch();');
END
$schedule$;
COMMIT;
