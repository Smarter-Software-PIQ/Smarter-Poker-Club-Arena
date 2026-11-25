-- 20261123151024_superseded_watch_cutover_diagnosis_and_closed_arena_revoke.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--   1. public.fn_ca_merged_migration_install_watch(timestamptz) (incident
--      0da46df7 CutoverReadinessAtRisk):
--        - On 2026-11-23, migration 20261123002808 was briefly recorded as
--          held in schema_migrations at 02:49Z before #11810 modified it on
--          main to add "-- SUPERSEDED BY 20261123024924" at 03:29Z. Because
--          installed_seen_at was already stamped at 02:50Z, the install watch
--          skipped the modifying commit; when the hold row was later removed
--          from schema_migrations, superseded_by remained NULL and
--          fn_ca_cutover_readiness_watch paged CutoverReadinessAtRisk at
--          03:00, 03:15, and 03:25 Central blaming 20261123002808.
--        - Re-read a modified migration file whenever its patch adds a
--          SUPERSEDED BY marker (even while installed_seen_at is set; normal
--          modifications to installed files still cost zero fetches).
--        - Before Step 2, if a watched row has installed_seen_at set yet is no
--          longer in supabase_migrations.schema_migrations, clear
--          installed_seen_at and re-read its raw file from main so
--          superseded_by / window_install are never stale.
--        - Backfill 20261123002808 -> superseded_by = '20261123024924' when
--          20261123024924 is installed and 20261123002808 is absent.
--   2. smarter_private.reliability_runbook_cutover_diagnosis (incident
--      076ff467 EngineCutoverMissed):
--        - Exempt window_install and superseded_by migrations tracked in
--          smarter_private.ca_merged_migration_watch from v_missing /
--          uninstalled_migrations, matching fn_ca_cutover_readiness_watch and
--          select-daily-engine.py.
--   3. public.fn_ca_closed_arena_finding_is_intended() (Production Integrity
--      Audit anon_definers=1 drift):
--        - Trigger function created SECURITY DEFINER in 20261031172724 /
--          20261031172826 without revoking default PUBLIC EXECUTE. Revoke
--          EXECUTE from PUBLIC, anon, authenticated (keeping service_role).
--
-- @probe-exempt: public.fn_ca_merged_migration_install_watch every call performs live GitHub API GETs through extensions.http; proven end to end by scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py
-- @probe-exempt: smarter_private.reliability_runbook_cutover_diagnosis calls external GitHub via ca_cutover_http_json; proven end to end by scripts/ci/test-reliability-runbooks.py
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'A HELD ROW REMOVED FROM schema_migrations IS RE-READ (20261123151024)') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_runbook_cutover_diagnosis(uuid,boolean,jsonb,timestamp with time zone)'::regprocedure), 'WINDOW AND SUPERSEDED MIGRATIONS EXEMPT (20261123151024)') > 0 AND NOT has_function_privilege('anon', 'public.fn_ca_closed_arena_finding_is_intended()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_closed_arena_finding_is_intended()', 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch WHERE version = '20261123002808' AND superseded_by IS NULL) AND NOT EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE id = '90d4fdff-011a-46c4-85e7-87d1519e2107' AND status <> 'resolved')

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── 1. Amend public.fn_ca_merged_migration_install_watch ───────────────────
DO $amend_install_watch$
DECLARE
  v_sig constant regprocedure := 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure;
  v_def text := pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure);
  v_new text;
  v_a1 text :=
$a1$        IF v_f->>'status' = 'modified' AND v_name ~ c_file
           AND EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch w
                        WHERE w.version = substring(v_name FROM c_file) AND w.file = v_name
                          AND w.installed_seen_at IS NULL AND w.retired_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations sm
                            WHERE sm.version = substring(v_name FROM c_file)) THEN$a1$;
  v_w1 text :=
$w1$        IF v_f->>'status' = 'modified' AND v_name ~ c_file
           AND (
             (EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch w
                       WHERE w.version = substring(v_name FROM c_file) AND w.file = v_name
                         AND w.installed_seen_at IS NULL AND w.retired_at IS NULL)
              AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations sm
                               WHERE sm.version = substring(v_name FROM c_file)))
             OR (regexp_replace(COALESCE(v_f->>'patch', ''), '(^|\n)\+', '\1', 'g') ~ c_superseded
                 AND EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch w
                              WHERE w.version = substring(v_name FROM c_file) AND w.file = v_name
                                AND w.retired_at IS NULL AND w.superseded_by IS NULL))
           ) THEN$w1$;
  v_a2 text :=
$a2$  -- 2. Installed, retired or superseded: close the page.$a2$;
  v_w2 text :=
$w2$  -- A HELD ROW REMOVED FROM schema_migrations IS RE-READ (20261123151024).
  -- If a migration was temporarily recorded as held in schema_migrations and
  -- later removed (e.g. 20261123002808), installed_seen_at stayed set and hid
  -- its superseding edit from cutover readiness. Re-read its raw file from
  -- main so superseded_by and window_install stay accurate.
  FOR v_row IN
    SELECT w.version, w.file, w.modified_sha, w.merge_sha
      FROM smarter_private.ca_merged_migration_watch w
     WHERE w.installed_seen_at IS NOT NULL
       AND w.retired_at IS NULL
       AND w.superseded_by IS NULL
       AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations sm WHERE sm.version = w.version)
     ORDER BY w.version
  LOOP
    v_text := smarter_private.ca_migration_watch_raw(
      COALESCE(
        (SELECT c.sha FROM smarter_private.ca_merged_migration_watch_commits c ORDER BY c.committed_at DESC LIMIT 1),
        v_row.modified_sha,
        v_row.merge_sha
      ),
      v_row.file
    );
    IF v_text IS NULL OR v_text !~ '[^[:space:]]' THEN
      v_read := false;
      CONTINUE;
    END IF;
    v_by := substring(left(v_text, 400) FROM c_superseded);
    UPDATE smarter_private.ca_merged_migration_watch
       SET installed_seen_at = NULL,
           window_install = v_text ~ c_window,
           superseded_by = NULLIF(v_by, v_row.version)
     WHERE version = v_row.version;
  END LOOP;

  -- 2. Installed, retired or superseded: close the page.$w2$;
BEGIN
  IF strpos(v_def, 'A HELD ROW REMOVED FROM schema_migrations IS RE-READ (20261123151024)') > 0 THEN
    RAISE NOTICE 'fn_ca_merged_migration_install_watch already re-reads vanished hold rows';
  ELSE
    IF (length(v_def) - length(replace(v_def, v_a1, ''))) / length(v_a1) <> 1 THEN
      RAISE EXCEPTION 'MIGRATION_WATCH_MODIFIED_ANCHOR_NOT_ONCE';
    END IF;
    IF (length(v_def) - length(replace(v_def, v_a2, ''))) / length(v_a2) <> 1 THEN
      RAISE EXCEPTION 'MIGRATION_WATCH_STEP2_ANCHOR_NOT_ONCE';
    END IF;
    v_new := replace(replace(v_def, v_a1, v_w1), v_a2, v_w2);
    EXECUTE v_new;
    IF strpos(pg_get_functiondef(v_sig), 'A HELD ROW REMOVED FROM schema_migrations IS RE-READ (20261123151024)') = 0 THEN
      RAISE EXCEPTION 'MIGRATION_WATCH_SUPERSEDED_HOLD_AMENDMENT_NOT_READ_BACK';
    END IF;
  END IF;
END
$amend_install_watch$;

REVOKE ALL ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) TO service_role;

-- Backfill 20261123002808 when its replacement 20261123024924 is installed and
-- 20261123002808 itself is absent from schema_migrations.
UPDATE smarter_private.ca_merged_migration_watch
   SET superseded_by = '20261123024924',
       installed_seen_at = NULL
 WHERE version = '20261123002808'
   AND superseded_by IS NULL
   AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261123024924')
   AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261123002808');

-- ── 2. Amend smarter_private.reliability_runbook_cutover_diagnosis ─────────
DO $amend_cutover_diagnosis$
DECLARE
  v_sig constant regprocedure := 'smarter_private.reliability_runbook_cutover_diagnosis(uuid,boolean,jsonb,timestamp with time zone)'::regprocedure;
  v_def text := pg_get_functiondef('smarter_private.reliability_runbook_cutover_diagnosis(uuid,boolean,jsonb,timestamp with time zone)'::regprocedure);
  v_new text;
  v_a text :=
$a$      EXECUTE 'SELECT EXISTS (SELECT 1 FROM ' || v_history || ' m WHERE m.version = $1)'
         INTO v_installed USING v_version;
      IF NOT v_installed THEN
        v_missing := v_missing || v_version;
      END IF;$a$;
  v_w text :=
$w$      EXECUTE 'SELECT EXISTS (SELECT 1 FROM ' || v_history || ' m WHERE m.version = $1)'
         INTO v_installed USING v_version;
      -- WINDOW AND SUPERSEDED MIGRATIONS EXEMPT (20261123151024).
      IF NOT v_installed AND to_regclass('smarter_private.ca_merged_migration_watch') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch w WHERE w.version = $1 AND (w.window_install OR w.superseded_by IS NOT NULL))'
           INTO v_installed USING v_version;
      END IF;
      IF NOT v_installed THEN
        v_missing := v_missing || v_version;
      END IF;$w$;
BEGIN
  IF strpos(v_def, 'WINDOW AND SUPERSEDED MIGRATIONS EXEMPT (20261123151024)') > 0 THEN
    RAISE NOTICE 'reliability_runbook_cutover_diagnosis already exempts window and superseded migrations';
  ELSE
    IF (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 THEN
      RAISE EXCEPTION 'CUTOVER_DIAGNOSIS_MISSING_ANCHOR_NOT_ONCE';
    END IF;
    v_new := replace(v_def, v_a, v_w);
    EXECUTE v_new;
    IF strpos(pg_get_functiondef(v_sig), 'WINDOW AND SUPERSEDED MIGRATIONS EXEMPT (20261123151024)') = 0 THEN
      RAISE EXCEPTION 'CUTOVER_DIAGNOSIS_AMENDMENT_NOT_READ_BACK';
    END IF;
  END IF;
END
$amend_cutover_diagnosis$;

REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_cutover_diagnosis(uuid, boolean, jsonb, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_runbook_cutover_diagnosis(uuid, boolean, jsonb, timestamp with time zone) TO service_role;

-- ── 3. Revoke anonymous/authenticated EXECUTE on trigger function ──────────
REVOKE ALL ON FUNCTION public.fn_ca_closed_arena_finding_is_intended() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_closed_arena_finding_is_intended() TO service_role;

-- ── 4. Resolve guard-def drift incident 90d4fdff after 20261123150909 ──────
DO $resolve_sng_guard_drift$
BEGIN
  IF to_regclass('public.ca_drift_incidents') IS NULL
     OR to_regclass('public.ca_guard_defs') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ca_drift_incidents
     WHERE id = '90d4fdff-011a-46c4-85e7-87d1519e2107'
       AND status <> 'resolved'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ca_guard_defs
     WHERE proname = 'fn_poker_diamond_tournament_unregister'
       AND declared_ref LIKE '%20261123150909%'
  ) THEN
    RAISE EXCEPTION 'refusing to close guard-def drift incident 90d4fdff before 20261123150909 declaration is recorded';
  END IF;

  UPDATE public.ca_drift_incidents
     SET status = 'resolved',
         resolved_at = GREATEST(now(), detected_at),
         closure_basis = 'verified_remeasured',
         root_cause = 'Installed migration 20261122222254 patched watched guard fn_poker_diamond_tournament_unregister via pg_get_functiondef(::regprocedure) and EXECUTE without calling fn_ca_declare_guard_redefinition, altering pg_get_functiondef() to 87057141df59ad86d5bcbad4e6d4a0b7.',
         resolution = 'Verified exact live function hash (87057141df59ad86d5bcbad4e6d4a0b7) and schema_migrations sha256 match 20261122222254; recorded forward declaration in migration 20261123150909 and hardened a-declared-guard-change-is-recorded-not-raised.law.test.ts to catch ::regprocedure EXECUTE rewrites.',
         correction_ref = 'migration 20261123150909_declare_installed_sng_launch_unregister_guard'
   WHERE id = '90d4fdff-011a-46c4-85e7-87d1519e2107'
     AND status <> 'resolved';
END
$resolve_sng_guard_drift$;

COMMIT;
