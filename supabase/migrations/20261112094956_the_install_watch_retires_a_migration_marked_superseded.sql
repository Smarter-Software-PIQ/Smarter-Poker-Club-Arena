-- 20261112094956_the_install_watch_retires_a_migration_marked_superseded.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- THE MERGED-MIGRATION INSTALL WATCH RETIRES A FILE MARKED "SUPERSEDED BY"
-- (Production Alerts fleet, incident migration-install-watch/376926)
-- ============================================================================
--
-- WHAT WENT WRONG (read from rows, 2026-11-12):
--   #10558 (4850f853, 02:12Z) added 20261112013714_unfinished_rebuys_pay_the_
--   starting_stack.sql. #10561 (45086597, 02:52Z) added its replacement
--   20261112022726 and, in the same commit, MODIFIED 20261112013714 to begin
--   "-- SUPERSEDED BY 20261112022726". The replacement installed at 03:10Z.
--   scripts/ci/apply-recorded-migration.mjs refuses to send a superseded file,
--   so 20261112013714 can never be installed - correctly. But
--   fn_ca_merged_migration_install_watch reads only added, renamed and
--   removed files; a modify is skipped, so the marker was never seen. At
--   03:20Z it raised operational_alert_events 376926 (critical,
--   MergedMigrationNotInstalled) for a file that must never run, and at
--   09:21Z the reliability controller escalated it to the owner's phone
--   ("AI Agent Needed: MergedMigrationNotInstalled"). A false critical page.
--
-- THE FIX (the line that produced it):
--   Every added, modified or renamed migration file's text is read for the
--   supersede marker (the same spelling check-migrations-are-live.mjs reads).
--   When the named successor is installed or is itself watched, the file is
--   retired, and step 2 resolves its alert exactly as it does for a removed
--   file. A successor that is itself uninstalled keeps its own page, so no
--   uninstalled change can hide behind a marker. An unreadable modify is
--   retried next run, never guessed.
--
-- DAMAGE ALREADY DONE: the 45086597 modify was read before this fix and is
--   marked read, so it would never be re-read. This file retires
--   20261112013714 by name, asserting first that 20261112022726 is installed
--   and that the watch row is the one described above; the watch's next run
--   then resolves 376926. Only the watch's own state row is written.
--
-- Native proof: scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py
-- (case "a file marked superseded by an installed successor is retired and its
-- page resolved"; it fails on 20261110194917's definition). CI:
-- .github/workflows/a-merged-migration-left-uninstalled-is-paged.yml.
--
-- periodic-work: a detector that pages a person; it moves no money, seats, lobbies, releases or schema, retries nothing and repairs nothing. It must run from the database clock because the failure it reports is an install event that never happened.
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'A SUPERSEDED FILE IS RETIRED (20261112094956)') > 0 AND strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'WINDOW HEADER FROM THE WHOLE FILE (20261110194917)') > 0 AND NOT has_function_privilege('anon', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-merged-migration-install-watch-10m' AND active)

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure)) <> '21ae83bdc42bb6804741b41a7b803ab4' THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_PREIMAGE_CHANGED: fn_ca_merged_migration_install_watch';
  END IF;
  IF to_regprocedure('smarter_private.ca_migration_watch_raw(text,text)') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_PREIMAGE_CHANGED: smarter_private.ca_migration_watch_raw';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.fn_ca_merged_migration_install_watch(p_at timestamptz DEFAULT clock_timestamp())
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
  -- The supersede marker, as an added line of a patch or a line of the raw
  -- file; the same spelling scripts/ci/check-migrations-are-live.mjs reads.
  c_superseded constant text := '(?:^|\n)\+?[ \t]*--[ \t]*SUPERSEDED BY[ \t]+([0-9]{14})';
  v_cur smarter_private.ca_merged_migration_watch_cursor%ROWTYPE;
  v_list jsonb; v_commit jsonb; v_detail jsonb; v_f jsonb;
  v_sha text; v_at timestamptz; v_name text; v_prev text; v_text text;
  v_read boolean := true; v_new_commits integer := 0; v_newest timestamptz;
  v_row record; v_id bigint; v_raised integer := 0; v_resolved integer := 0; v_pending integer := 0;
  v_unread boolean := false;
  v_sup text;
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
          -- WINDOW HEADER FROM THE WHOLE FILE (20261110194917). Only an added
          -- file's patch is the whole file. A rename's patch carries just its
          -- changed hunk, so the window declaration on line 1 is not in it:
          -- read the raw file. If that cannot be read either, nothing is
          -- guessed: this commit stays unread and is read again next run.
          -- AN EMPTY BODY IS UNREADABLE (20261110194917). GitHub can answer
          -- 200 with an empty body and ca_migration_watch_raw returns that ''
          -- rather than NULL, so blank text would have read as "no window
          -- header" and put a window file on the ordinary route - the same
          -- false page this file exists to stop. Only the emptiness is tested;
          -- the text itself is passed to the match untouched, because the
          -- window regex anchors on the start of a line.
          v_text := CASE WHEN v_f->>'status' = 'added' THEN v_f->>'patch' END;
          IF v_text IS NULL OR v_text !~ '[^[:space:]]' THEN
            v_text := smarter_private.ca_migration_watch_raw(v_sha, v_name);
          END IF;
          IF v_text IS NULL OR v_text !~ '[^[:space:]]' THEN
            v_unread := true;
            EXIT;
          END IF;
          INSERT INTO smarter_private.ca_merged_migration_watch AS w
                 (version, file, merge_sha, merged_at, window_install, first_seen_at)
          VALUES (substring(v_name FROM c_file), v_name, v_sha, v_at, v_text ~ c_window, p_at)
          ON CONFLICT (version) DO UPDATE
             SET file = EXCLUDED.file, merge_sha = EXCLUDED.merge_sha, merged_at = EXCLUDED.merged_at,
                 window_install = EXCLUDED.window_install, retired_at = NULL, retired_by = NULL
           WHERE w.retired_at IS NOT NULL;
        END IF;
        -- A SUPERSEDED FILE IS RETIRED (20261112094956). A file marked
        -- "-- SUPERSEDED BY <version>" must never run (apply-recorded-migration
        -- refuses it), so it can never be installed and paging for it pages for
        -- nothing. The marker is usually added by a MODIFY in the PR that adds
        -- the replacement, which steps above never read: on 2026-11-12
        -- 20261112013714 was marked superseded by 20261112022726 in 45086597,
        -- 20261112022726 installed at 03:10Z, and the watch still paged the
        -- owner for 20261112013714 at 03:20Z and escalated at 09:21Z. The file
        -- is retired only when its successor is installed or is itself watched,
        -- so the successor keeps the page if it is the one left uninstalled.
        IF v_f->>'status' IN ('added', 'modified', 'renamed') AND v_name ~ c_file THEN
          v_text := CASE WHEN v_f->>'status' IN ('added', 'modified') THEN v_f->>'patch' ELSE v_text END;
          IF v_text IS NULL OR v_text !~ '[^[:space:]]' THEN
            v_text := smarter_private.ca_migration_watch_raw(v_sha, v_name);
          END IF;
          IF v_text IS NULL OR v_text !~ '[^[:space:]]' THEN
            v_unread := true;
            EXIT;
          END IF;
          v_sup := substring(v_text FROM c_superseded);
          IF v_sup IS NOT NULL AND v_sup <> substring(v_name FROM c_file) AND (
               EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations sm WHERE sm.version = v_sup)
               OR EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch s WHERE s.version = v_sup AND s.retired_at IS NULL)
               -- the successor added by this same commit, which may be listed after it
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_detail->'files') g
                           WHERE g->>'status' IN ('added', 'renamed') AND g->>'filename' ~ c_file
                             AND substring(g->>'filename' FROM c_file) = v_sup)) THEN
            UPDATE smarter_private.ca_merged_migration_watch SET retired_at = v_at, retired_by = v_sha
             WHERE version = substring(v_name FROM c_file) AND file = v_name AND retired_at IS NULL;
          END IF;
        END IF;
      END LOOP;
      IF v_unread THEN
        v_read := false;
        EXIT;  -- read it next run; nothing after it is marked read either
      END IF;
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

-- The one file already read past (see DAMAGE ALREADY DONE).
DO $retire$
BEGIN
  IF EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch
              WHERE version = '20261112013714' AND retired_at IS NULL AND installed_seen_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261112022726') THEN
    RAISE EXCEPTION 'SUPERSEDED_SUCCESSOR_NOT_INSTALLED: 20261112022726';
  END IF;
  UPDATE smarter_private.ca_merged_migration_watch
     SET retired_at = '2026-11-12 02:52:17+00', retired_by = '4508659718c2fbf20e479ca100861a58acc749a5'
   WHERE version = '20261112013714'
     AND file = 'supabase/migrations/20261112013714_unfinished_rebuys_pay_the_starting_stack.sql'
     AND retired_at IS NULL AND installed_seen_at IS NULL;
END
$retire$;
COMMIT;
