-- 20261117165416_the_install_watch_holds_its_page_while_installs_are_switched.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- THE MERGED-MIGRATION INSTALL WATCH HOLDS ITS PAGE WHILE INSTALLS ARE
-- SWITCHED OFF, AND STARTS ITS HOUR WHEN THEY ARE SWITCHED BACK ON
-- (Production Alerts fleet, reliability incident c1a85d20, MergedMigrationNotInstalled)
-- ============================================================================
--
-- WHAT WENT WRONG (read from rows and Actions runs, 2026-11-14 to 2026-11-17):
-- c1a85d20 recurred 9 times; 18 MergedMigrationNotInstalled rows in four days.
-- Two causes, and only one of them was a false page.
--
--   1. Installs switched off for an owner engine window (12 of 18 rows).
--      docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md step 5 pauses installs
--      from the booking merge to SEALED by switching Apply Merged Migration
--      (and, in practice, Dispatch Merged Migrations) off, because a
--      migration installed after the Backup copy makes the engine
--      certificate unusable. Dispatch Merged Migrations recorded no run at
--      all in 2026-11-15 08:00-16:29Z, 16:58-19:35Z, 21:30Z-00:29Z and
--      2026-11-16 00:31-03:53Z, exactly the 0806z/1206z, 1806z, 2245z and
--      0106z windows, and every row merged inside one (20261115064521,
--      070500, 075440, 164443, 164243, 164547, 205037, 205153, 210559,
--      20261116003412; on 2026-11-14 the 0506z and 1706z windows:
--      20261114034527, 161610, 163039, 192610). Each pause outlasted the
--      watch's 60 minutes, so it paged "Dispatch Apply Merged Migration for
--      it" while that applier was switched off on purpose - an instruction
--      that, followed, would have installed a file inside the window and
--      spoiled the certificate. Since #11004 (2026-11-15 20:25Z) the
--      custodian's resume step sends what merged during the pause, and every
--      such file was installed by it (the 00:27-00:34Z and 03:34Z applier
--      runs). The page was the wrong signal, at the wrong time.
--   2. The applier refused the file (6 of 18 rows): a stale function pin
--      (20261116163448, run 43993028834), an index build past its budget
--      (20261116230906, 20261116183213), a lock timeout (20261116202837). Each
--      was a real defect, fixed by its owner and installed. Those pages were
--      right, and nothing here changes them.
--
-- THE ROOT FIX (one function amendment, two nullable columns on a private row):
--   * each run that read GitHub also reads the two workflows' own state from
--     the Actions API. Either one not 'active' is a pause. The watch records
--     when it first saw the pause and when it first saw both active again;
--   * while installs are paused the hour page is held, for at most six hours
--     from the first sight of the pause. An owner window admits for at most
--     six hours, so a pause still open after that is a forgotten pause, and
--     the files page exactly as before;
--   * a file merged before the pause ended gets its hour from the end, so a
--     resume that never sent it (the 2026-11-15 1806z case, re-enabled with
--     no resume) pages one hour after the switch-on, never sooner;
--   * a workflow state that cannot be read is no pause: unknown never holds a
--     page that would otherwise fire, and the stored pause is kept as it was.
-- Nothing else changes. It still never installs, dispatches, retries,
-- enables or repairs anything, and it reads only GET endpoints.
--
-- WHAT THIS DOES NOT CHANGE: when installs happen. The pause itself, the
-- 00:01 Backup refresh, the 03:30 cutoff and the resume step are untouched,
-- so no install moves into the span that makes a certificate stale.
--
-- The amendment is the repository's guarded replace(pg_get_functiondef(...))
-- pattern: each anchor must occur exactly once in the live definition, the
-- result is compiled, and the new markers are read back. It composes with an
-- open change to step 4 of the same function (#10588), which none of these
-- anchors touch.
--
-- Native proof: scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py
-- (cases "a pause holds the hour page ..."; they fail with
-- MIGWATCH_PRE_PAUSE=1, i.e. on 20261112035143's definition). CI:
-- .github/workflows/a-merged-migration-left-uninstalled-is-paged.yml.
--
-- periodic-work: a detector that pages a person; it moves no money, seats, lobbies, releases or schema, retries nothing and repairs nothing. It must run from the database clock because the failure it reports is an install event that never happened.
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'INSTALLS SWITCHED OFF HOLD THE PAGE (20261117165416)') > 0 AND strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'A SUPERSEDED FILE NEVER INSTALLS (20261112035143)') > 0 AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'smarter_private' AND table_name = 'ca_merged_migration_watch_cursor' AND column_name = 'install_pause_since') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'smarter_private' AND table_name = 'ca_merged_migration_watch_cursor' AND column_name = 'install_pause_ended_at') AND NOT has_function_privilege('anon', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-merged-migration-install-watch-10m' AND active)

BEGIN;

ALTER TABLE smarter_private.ca_merged_migration_watch_cursor
  ADD COLUMN IF NOT EXISTS install_pause_since timestamptz,
  ADD COLUMN IF NOT EXISTS install_pause_ended_at timestamptz;

COMMENT ON COLUMN smarter_private.ca_merged_migration_watch_cursor.install_pause_since IS
  'First watch run that read Apply Merged Migration or Dispatch Merged Migrations as not active (20261117165416). NULL when installs run.';
COMMENT ON COLUMN smarter_private.ca_merged_migration_watch_cursor.install_pause_ended_at IS
  'First watch run that read both workflows active again after a pause (20261117165416). A file merged before it gets its hour from here.';

DO $amend$
DECLARE
  v_sig constant regprocedure := 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure;
  v_def text := pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure);
  v_new text;
  v_anchor text;
  v_with text;
  v_pairs text[][] := ARRAY[
    -- 1. Declarations.
    ARRAY[
$a1$  v_unread boolean := false;
BEGIN$a1$,
$w1$  v_unread boolean := false;
  -- INSTALLS SWITCHED OFF HOLD THE PAGE (20261117165416).
  v_applier text; v_dispatcher text; v_paused boolean;
  v_pause_since timestamptz; v_pause_ended timestamptz;
BEGIN$w1$],
    -- 2. Read the pause before the hour page.
    ARRAY[
$a2$  -- 3. Merged an hour ago, ordinary route, still not installed: page once.$a2$,
$w2$  -- INSTALLS SWITCHED OFF HOLD THE PAGE (20261117165416). The owner-window
  -- playbook pauses installs by switching Apply Merged Migration (and
  -- Dispatch Merged Migrations) off from the booking merge to SEALED. While
  -- either is not 'active', "dispatch it" is the wrong instruction, so the
  -- hour page waits - at most six hours, the longest owner-window admission;
  -- a longer pause is a forgotten one and pages as before. A file merged
  -- before the switch-on gets its hour from the switch-on. A state that
  -- cannot be read is no pause and keeps the stored pause unchanged.
  IF v_read THEN
    v_applier := smarter_private.ca_cutover_http_json(c_repo || '/actions/workflows/apply-merged-migration.yml')->>'state';
    v_dispatcher := smarter_private.ca_cutover_http_json(c_repo || '/actions/workflows/dispatch-merged-migrations.yml')->>'state';
    v_paused := CASE WHEN v_applier IS NULL OR v_dispatcher IS NULL THEN NULL
                     ELSE v_applier <> 'active' OR v_dispatcher <> 'active' END;
    IF v_paused THEN
      UPDATE smarter_private.ca_merged_migration_watch_cursor
         SET install_pause_since = COALESCE(install_pause_since, p_at), install_pause_ended_at = NULL
       WHERE id;
    ELSIF NOT v_paused THEN
      UPDATE smarter_private.ca_merged_migration_watch_cursor
         SET install_pause_ended_at = CASE WHEN install_pause_since IS NOT NULL THEN p_at ELSE install_pause_ended_at END,
             install_pause_since = NULL
       WHERE id;
    END IF;
  END IF;
  SELECT install_pause_since, install_pause_ended_at INTO v_pause_since, v_pause_ended
    FROM smarter_private.ca_merged_migration_watch_cursor WHERE id;

  -- 3. Merged an hour ago, ordinary route, still not installed: page once.$w2$],
    -- 3. The hour clock.
    ARRAY[
$a3$    CONTINUE WHEN NOT v_read OR v_row.alert_id IS NOT NULL OR v_row.merged_at > p_at - interval '60 minutes';$a3$,
$w3$    CONTINUE WHEN NOT v_read OR v_row.alert_id IS NOT NULL OR v_row.merged_at > p_at - interval '60 minutes'
      OR (v_pause_since IS NOT NULL AND p_at < v_pause_since + interval '6 hours')
      OR (v_pause_ended IS NOT NULL AND v_row.merged_at <= v_pause_ended AND p_at < v_pause_ended + interval '60 minutes');$w3$],
    -- 4. Say it in the run's answer.
    ARRAY[
$a4$                            'raised', v_raised, 'resolved', v_resolved);$a4$,
$w4$                            'raised', v_raised, 'resolved', v_resolved,
                            'install_pause', CASE WHEN v_pause_since IS NOT NULL THEN 'paused since ' || v_pause_since::text
                                                  WHEN v_paused IS NULL AND v_read THEN 'unknown' ELSE 'running' END);$w4$]
  ];
  i integer;
BEGIN
  IF strpos(v_def, 'INSTALLS SWITCHED OFF HOLD THE PAGE (20261117165416)') > 0 THEN
    RAISE NOTICE 'fn_ca_merged_migration_install_watch already holds its page during a pause';
    RETURN;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    v_anchor := v_pairs[i][1];
    v_with := v_pairs[i][2];
    IF (length(v_new) - length(replace(v_new, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'MIGRATION_WATCH_ANCHOR_NOT_ONCE: anchor % of fn_ca_merged_migration_install_watch', i;
    END IF;
    v_new := replace(v_new, v_anchor, v_with);
  END LOOP;
  EXECUTE v_new;
  IF strpos(pg_get_functiondef(v_sig), 'INSTALLS SWITCHED OFF HOLD THE PAGE (20261117165416)') = 0
     OR strpos(pg_get_functiondef(v_sig), 'v_pause_ended + interval ''60 minutes''') = 0 THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_AMENDMENT_NOT_READ_BACK';
  END IF;
END
$amend$;

-- CREATE OR REPLACE keeps the owner, ACL and proconfig; restate the grants the
-- earlier migrations set so the live proof's privilege checks hold either way.
REVOKE ALL ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) TO service_role;

COMMIT;
