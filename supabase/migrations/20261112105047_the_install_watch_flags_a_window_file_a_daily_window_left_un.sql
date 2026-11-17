-- 20261112105047_the_install_watch_flags_a_window_file_a_daily_window_left_un.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- THE INSTALL WATCH FLAGS A WINDOW FILE A DAILY WINDOW LEFT UNINSTALLED
-- (Production Alerts fleet, incident
--  release/window-install-skipped-on-release-control-change; the detector
--  item of draft #10585)
-- ============================================================================
--
-- WHAT WENT WRONG (read from rows and runs, 2026-11-12):
-- The daily reservation for 2026-11-12 (run 43155291080, bound to bb384e80 at
-- 04:30Z) refused at the 09:30Z cutoff with "Release controls changed during
-- reservation; keep serving." (#10574, #10576 and #10580 merged after it), so
-- job "Install Queued Daily-Maintenance Migrations" (131093400494) was
-- skipped, as on 11-10 and 11-11. Six window files are still absent from
-- schema_migrations: 20261110003726, 20261110054654, 20261110173033,
-- 20261110214134, 20261111174148 and 20261112013925. Nothing reported it:
-- fn_ca_merged_migration_install_watch remembers window files but by design
-- never pages one (step 3 skips window_install), so a window file can wait
-- for ever and the store stays silent.
--
-- THE CHANGE (one function, one nullable column on a private table):
--   * step 4: a waiting window file (not installed, not retired, not
--     superseded) that was on main before the most recent 04:00
--     America/Chicago window's 03:30 cutoff, and is still uninstalled at
--     04:20 Central (fifteen minutes after the 04:05 thaw), is raised ONCE
--     as WindowMigrationNotInstalled, severity warning, into
--     operational_alert_events with payload.target_task_id. Warning is not
--     an owner page kind (fn_ca_owner_page_kind returns NULL for it): the
--     Production Alerts lane owns it, not the owner's phone.
--   * step 2 resolves that alert when the file installs, is removed from
--     main, or is superseded, exactly as it resolves the hourly alert.
--   * the hourly rule (step 3) is unchanged: a window file is still never
--     paged at an hour.
-- It still never installs, dispatches, retries or repairs anything; the
-- installer and its reservation are untouched (the installer fix is #10585).
--
-- Native proof: scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py
-- (case "a window file a daily window left uninstalled is raised once ...";
-- it fails on 20261112035143's definition, run with MIGWATCH_PRE_WINDOW=1).
-- CI: .github/workflows/a-merged-migration-left-uninstalled-is-paged.yml.
--
-- periodic-work: a detector that records a private alert; it moves no money, seats, lobbies, releases or schema, retries nothing and repairs nothing. It must run from the database clock because the failure it reports is an install event that never happened.
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'A WINDOW FILE A DAILY WINDOW LEFT UNINSTALLED (20261112105047)') > 0 AND strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'A SUPERSEDED FILE NEVER INSTALLS (20261112035143)') > 0 AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'smarter_private' AND table_name = 'ca_merged_migration_watch' AND column_name = 'window_alert_id') AND NOT has_function_privilege('anon', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-merged-migration-install-watch-10m' AND active)

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure)) <> '52d09bfc2e17574b2c92afe078a86616' THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_PREIMAGE_CHANGED: fn_ca_merged_migration_install_watch';
  END IF;
END
$pre$;

ALTER TABLE smarter_private.ca_merged_migration_watch
  ADD COLUMN IF NOT EXISTS window_alert_id bigint;

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
  -- The never-run marker, spelled in two pieces for the same reason. It is
  -- read exactly as scripts/ci/check-migrations-are-live.mjs supersededBy()
  -- and apply-recorded-migration.mjs read it: a line of its own in the first
  -- 400 characters of the FILE, naming a 14-digit version.
  c_superseded constant text := '(?:^|\n)--[ \t]*SUPER' || 'SEDED BY[ \t]+([0-9]{14})\M';
  v_cur smarter_private.ca_merged_migration_watch_cursor%ROWTYPE;
  v_list jsonb; v_commit jsonb; v_detail jsonb; v_f jsonb;
  v_sha text; v_at timestamptz; v_name text; v_prev text; v_text text; v_file_text text; v_by text;
  v_read boolean := true; v_new_commits integer := 0; v_newest timestamptz;
  v_row record; v_id bigint; v_raised integer := 0; v_resolved integer := 0; v_pending integer := 0;
  v_unread boolean := false;
  v_window_start timestamptz; v_window_cutoff timestamptz; v_window_day date;
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
          -- A SUPERSEDED FILE NEVER INSTALLS (20261112035143). An added
          -- file's patch is the file with a hunk header and a '+' on every
          -- line; strip both so the marker is read from the same 400
          -- characters of the file the applier reads.
          v_file_text := CASE WHEN v_f->>'status' = 'added' AND v_text ~ '^@@'
                              THEN regexp_replace(regexp_replace(v_text, '^@@[^\n]*\n', ''), '(^|\n)\+', '\1', 'g')
                              ELSE v_text END;
          v_by := substring(left(v_file_text, 400) FROM c_superseded);
          INSERT INTO smarter_private.ca_merged_migration_watch AS w
                 (version, file, merge_sha, merged_at, window_install, first_seen_at, superseded_by)
          VALUES (substring(v_name FROM c_file), v_name, v_sha, v_at, v_text ~ c_window, p_at,
                  NULLIF(v_by, substring(v_name FROM c_file)))
          ON CONFLICT (version) DO UPDATE
             SET file = EXCLUDED.file, merge_sha = EXCLUDED.merge_sha, merged_at = EXCLUDED.merged_at,
                 window_install = EXCLUDED.window_install, superseded_by = EXCLUDED.superseded_by,
                 retired_at = NULL, retired_by = NULL
           WHERE w.retired_at IS NOT NULL;
        END IF;
        -- A MODIFIED FILE IS READ AGAIN (20261112035143). A merged file that
        -- is still waiting can change after its merge: it can be marked
        -- superseded (20261112013714 by #10561, alert 376926) or gain or lose
        -- the window declaration. Its patch is only the changed hunk, so the
        -- whole file is read at this commit; unreadable means read again next
        -- run, never a guess. Files already installed or retired are skipped,
        -- so a modification costs no fetch once nothing waits on it.
        IF v_f->>'status' = 'modified' AND v_name ~ c_file
           AND EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch w
                        WHERE w.version = substring(v_name FROM c_file) AND w.file = v_name
                          AND w.installed_seen_at IS NULL AND w.retired_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations sm
                            WHERE sm.version = substring(v_name FROM c_file)) THEN
          v_text := smarter_private.ca_migration_watch_raw(v_sha, v_name);
          IF v_text IS NULL OR v_text !~ '[^[:space:]]' THEN
            v_unread := true;
            EXIT;
          END IF;
          v_by := substring(left(v_text, 400) FROM c_superseded);
          UPDATE smarter_private.ca_merged_migration_watch
             SET window_install = v_text ~ c_window,
                 superseded_by = NULLIF(v_by, version)
           WHERE version = substring(v_name FROM c_file) AND file = v_name;
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

  -- 2. Installed, retired or superseded: close the page. A superseded mark
  --    counts only while the version it names is on main (remembered and not
  --    retired) or installed, exactly as the applier and CI honour it only
  --    when the named file exists. A mark naming nothing is ignored.
  FOR v_row IN
    SELECT w.version, w.alert_id, w.window_alert_id, w.retired_at, w.superseded_by, sm.version IS NOT NULL AS installed
      FROM smarter_private.ca_merged_migration_watch w
      LEFT JOIN supabase_migrations.schema_migrations sm ON sm.version = w.version
     WHERE w.installed_seen_at IS NULL
       AND (sm.version IS NOT NULL OR w.retired_at IS NOT NULL
            OR (w.superseded_by IS NOT NULL
                AND (EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s2 WHERE s2.version = w.superseded_by)
                     OR EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch w2
                                 WHERE w2.version = w.superseded_by AND w2.retired_at IS NULL))))
  LOOP
    UPDATE smarter_private.ca_merged_migration_watch
       SET installed_seen_at = CASE WHEN v_row.installed THEN p_at END
     WHERE version = v_row.version;
    IF v_row.alert_id IS NOT NULL THEN
      UPDATE public.operational_alert_events
         SET status = 'resolved', last_received_at = p_at,
             payload = payload || jsonb_build_object('resolved_at', p_at,
               'resolution', CASE WHEN v_row.installed THEN 'installed in production'
                                  WHEN v_row.retired_at IS NOT NULL THEN 'removed from main'
                                  ELSE 'superseded on main by ' || v_row.superseded_by || '; it must never install' END)
       WHERE id = v_row.alert_id AND status = 'firing';
      IF FOUND THEN v_resolved := v_resolved + 1; END IF;
    END IF;
    -- A WINDOW FILE'S MISSED-WINDOW ALERT CLOSES THE SAME WAY (20261112105047).
    IF v_row.window_alert_id IS NOT NULL THEN
      UPDATE public.operational_alert_events
         SET status = 'resolved', last_received_at = p_at,
             payload = payload || jsonb_build_object('resolved_at', p_at,
               'resolution', CASE WHEN v_row.installed THEN 'installed in production'
                                  WHEN v_row.retired_at IS NOT NULL THEN 'removed from main'
                                  ELSE 'superseded on main by ' || v_row.superseded_by || '; it must never install' END)
       WHERE id = v_row.window_alert_id AND status = 'firing';
      IF FOUND THEN v_resolved := v_resolved + 1; END IF;
    END IF;
  END LOOP;

  -- 3. Merged an hour ago, ordinary route, still not installed: page once.
  --    Only on a run that read GitHub, so a removal is never missed.
  FOR v_row IN
    SELECT w.* FROM smarter_private.ca_merged_migration_watch w
     WHERE w.installed_seen_at IS NULL AND w.retired_at IS NULL AND NOT w.window_install
       AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations sm WHERE sm.version = w.version)
       AND NOT (w.superseded_by IS NOT NULL
                AND (EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s2 WHERE s2.version = w.superseded_by)
                     OR EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch w2
                                 WHERE w2.version = w.superseded_by AND w2.retired_at IS NULL)))
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

  -- 4. A WINDOW FILE A DAILY WINDOW LEFT UNINSTALLED (20261112105047).
  --    A daily-maintenance window file is never paged at an hour (step 3):
  --    it waits for the 04:00 America/Chicago break. But on 2026-11-10,
  --    11-11 and 11-12 the installer job never ran (its reservation refused
  --    at the 03:30 cutoff) and nothing said so; five files sat uninstalled
  --    for three windows. So: a waiting window file that was on main before
  --    the most recent window's 03:30 cutoff, and is still not installed
  --    fifteen minutes after that window's 04:05 thaw, is raised ONCE as a
  --    warning into the private alert store (not an owner page). It resolves
  --    in step 2 when the file installs, is removed, or is superseded.
  v_window_day := ((p_at AT TIME ZONE c_tz) - interval '4 hours 20 minutes')::date;
  v_window_start := (v_window_day + time '04:00') AT TIME ZONE c_tz;
  v_window_cutoff := v_window_start - interval '30 minutes';
  FOR v_row IN
    SELECT w.* FROM smarter_private.ca_merged_migration_watch w
     WHERE w.installed_seen_at IS NULL AND w.retired_at IS NULL AND w.window_install
       AND w.window_alert_id IS NULL AND w.merged_at < v_window_cutoff
       AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations sm WHERE sm.version = w.version)
       AND NOT (w.superseded_by IS NOT NULL
                AND (EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s2 WHERE s2.version = w.superseded_by)
                     OR EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch w2
                                 WHERE w2.version = w.superseded_by AND w2.retired_at IS NULL)))
     ORDER BY w.version
  LOOP
    v_id := public.fn_record_operational_alert('migration-install-watch', 'window-missed:' || v_row.version,
      'WindowMigrationNotInstalled', 'firing', 'warning', jsonb_build_object(
        'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
        'summary', format('%s (daily-maintenance window file) merged at %s Central (%s) and was still not installed after the %s 04:00 Central window. Read that day''s Daily engine reservation run: its Install Queued Daily-Maintenance Migrations job.',
                          regexp_replace(v_row.file, '^supabase/migrations/', ''),
                          to_char(v_row.merged_at AT TIME ZONE c_tz, 'Mon FMDD HH24:MI'), left(v_row.merge_sha, 8),
                          to_char(v_window_day, 'Mon FMDD')),
        'version', v_row.version, 'file', v_row.file, 'merge_sha', v_row.merge_sha,
        'merged_at', v_row.merged_at, 'window_date', v_window_day, 'window_start', v_window_start, 'at', p_at));
    UPDATE smarter_private.ca_merged_migration_watch SET window_alert_id = v_id WHERE version = v_row.version;
    v_raised := v_raised + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', v_read, 'state', CASE WHEN v_read THEN 'read' ELSE 'unknown' END,
                            'new_commits', v_new_commits, 'pending', v_pending,
                            'raised', v_raised, 'resolved', v_resolved);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) TO service_role;

COMMIT;
