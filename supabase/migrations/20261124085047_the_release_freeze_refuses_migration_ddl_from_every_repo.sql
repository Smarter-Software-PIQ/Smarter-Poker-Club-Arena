-- 20261124085047_the_release_freeze_refuses_migration_ddl_from_every_repo.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtname = 'ca_release_freeze_refuses_ddl' AND evtevent = 'ddl_command_end' AND evtenabled = 'O' AND evtfoid = 'smarter_private.fn_ca_release_freeze_ddl_guard()'::regprocedure) AND EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtname = 'ca_release_freeze_refuses_drops' AND evtevent = 'sql_drop' AND evtenabled = 'O' AND evtfoid = 'smarter_private.fn_ca_release_freeze_ddl_guard()'::regprocedure) AND smarter_private.fn_ca_release_freeze_refuses_migrations('2026-11-22 07:15:48+00', 'mgmt-api') IS NOT NULL AND smarter_private.fn_ca_release_freeze_refuses_migrations('2026-11-22 07:15:48+00', 'apply-recorded-migration') IS NULL AND public.fn_engine_recovery_window_contract() = 'engine-recovery-window-v1'
--
-- THE NIGHTLY RELEASE SCHEMA FREEZE IS A DATABASE RULE (2026-11-24)
--
-- WHAT BROKE. The 04:00 America/Chicago cutover serves a Backup copy of the
-- schema taken during the 23:45-04:15 Chicago release schema freeze; the
-- selector refuses a candidate whose copy lacks a migration production holds
-- ("Backup copy lacks installed migration"). The freeze was enforced only by
-- Club Arena's merge dispatcher (it holds merged files to 04:15) and, since
-- this change's companion commit, by Club Arena's applier for hand dispatches.
-- Nothing stopped a different route:
--   2026-11-21 06:38Z and 11-22 07:15Z  hand Apply Merged Migration runs
--     (copy lacked 20261121033455, 20261122025900; routine cutover kept serving);
--   2026-11-24 ~05:5x-07:00Z  five Smarter-Poker-World-Hub trivia migrations
--     (20261124041500, 041600, 052600, 060500, 061800) installed by hand
--     through the management API / MCP into this shared database; the 01:00
--     CST cycle deferred d749a61e4c94 on 060500 and 061800.
--
-- WHAT THIS CHANGES. Every repository and every hand session meets this
-- database, so the freeze is enforced here. A new event-trigger guard,
-- smarter_private.fn_ca_release_freeze_ddl_guard(), on ddl_command_end and
-- sql_drop (the same two events and the same governed sessions as the
-- break-window guard: fn_ca_break_window_governs, i.e. non-superuser members
-- of postgres, never pg_cron) refuses migration DDL while
-- smarter_private.fn_ca_release_freeze_refuses_migrations() says the freeze
-- holds. It admits:
--   - the installer's sanctioned route: application_name
--     'apply-recorded-migration' (set by scripts/ci/apply-recorded-migration.mjs
--     on its connection and SET LOCAL in every transaction it sends; the
--     daily 04:00 window route and the 04:15 held sends use it), or
--     'install-window-migrations%' (the window installer, as the existing
--     management-API freeze guard already admits). The applier itself refuses
--     a HAND dispatch inside the freeze unless it names an outage
--     (scripts/ci/release-freeze-admission.mjs), so a hand run cannot use this
--     marker to slip through;
--   - an emergency: the EXISTING one-transaction override,
--     SET LOCAL ca.break_window_migration_override = '<why>' (a reason, not a
--     switch), recorded in public.ca_break_window_migration_overrides exactly
--     as the break-window guard records it, prefixed 'release freeze: ';
--   - GRANT/REVOKE and pg_temp objects, as the break-window guard does.
--
-- WHAT IT DOES NOT CHANGE. public.fn_ca_break_window_ddl_guard(),
-- public.fn_ca_break_window_refuses_migrations(timestamptz) and their two
-- event triggers are not redefined (their md5 pins in
-- public.fn_engine_recovery_window_contract() stay valid: asserted below).
-- When both guards apply (a break inside the freeze) the break-window guard
-- fires first (event triggers fire in name order) and, with an override, sets
-- ca.break_window_override_in_force, which this guard honours: one override,
-- one audit row. No table, seat, wallet, freeze row or release row is written.
--
-- Law: tests/the-release-freeze-refuses-ddl-from-every-repo.law.test.ts
-- (constants pinned to RELEASE_SCHEMA_FREEZE_CHICAGO in
-- scripts/ci/merged-migration-dispatch.mjs). Native proof:
-- tests/unit/theReleaseFreezeRefusesDdlFromEveryRepo.pg.test.ts.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
SET LOCAL search_path = pg_catalog;

DO $preimage$
BEGIN
  IF to_regprocedure('smarter_private.fn_ca_release_freeze_ddl_guard()') IS NOT NULL
     OR to_regprocedure('smarter_private.fn_ca_release_freeze_refuses_migrations(timestamptz,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger
                 WHERE evtname IN ('ca_release_freeze_refuses_ddl', 'ca_release_freeze_refuses_drops')) THEN
    RAISE EXCEPTION 'release freeze guard preimage drift: already present';
  END IF;
  IF to_regprocedure('public.fn_ca_break_window_governs(text,text)') IS NULL
     OR to_regclass('public.ca_break_window_migration_overrides') IS NULL THEN
    RAISE EXCEPTION 'release freeze guard preimage drift: break-window scope or override record missing';
  END IF;
END;
$preimage$;

CREATE FUNCTION smarter_private.fn_ca_release_freeze_refuses_migrations(p_at timestamptz, p_app text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $fn$
DECLARE
  -- Pinned to RELEASE_SCHEMA_FREEZE_CHICAGO {from: [23, 45], until: [4, 15]}
  -- in scripts/ci/merged-migration-dispatch.mjs by
  -- tests/the-release-freeze-refuses-ddl-from-every-repo.law.test.ts.
  c_freeze_from  CONSTANT time := '23:45';
  c_freeze_until CONSTANT time := '04:15';
  v_local time;
BEGIN
  IF p_at IS NULL THEN
    RETURN NULL;
  END IF;
  -- The installer's sanctioned route (see the file header).
  IF coalesce(p_app, '') = 'apply-recorded-migration'
     OR coalesce(p_app, '') LIKE 'install-window-migrations%' THEN
    RETURN NULL;
  END IF;
  v_local := (p_at AT TIME ZONE 'America/Chicago')::time;
  IF v_local >= c_freeze_from OR v_local < c_freeze_until THEN
    RETURN to_char(p_at AT TIME ZONE 'America/Chicago', 'HH24:MI:SS')
        || ' America/Chicago is inside the nightly release schema freeze (23:45-04:15 America/Chicago);'
        || ' the 04:00 cutover serves a Backup copy of the schema, and a migration installed now is'
        || ' missing from that copy, so the routine cutover keeps serving the old engine';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_release_freeze_refuses_migrations(timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION smarter_private.fn_ca_release_freeze_ddl_guard()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fn$
DECLARE
  v_now      timestamptz := clock_timestamp();
  v_refusal  text;
  v_app      text := '';
  v_what     text;
  v_schema   text;
  v_override text;
  v_switch   boolean := false;
BEGIN
  BEGIN
    v_app := coalesce(current_setting('application_name', true), '');
    IF NOT public.fn_ca_break_window_governs(session_user::text, v_app) THEN RETURN; END IF;

    -- Privilege changes do not change the served schema (as the break-window guard).
    IF TG_EVENT = 'ddl_command_end' AND TG_TAG IN ('GRANT', 'REVOKE') THEN RETURN; END IF;

    v_refusal := smarter_private.fn_ca_release_freeze_refuses_migrations(v_now, v_app);
    IF v_refusal IS NULL THEN RETURN; END IF;

    IF TG_EVENT = 'sql_drop' THEN
      SELECT 'DROP ' || upper(d.object_type) || coalesce(' ' || d.object_identity, ''),
             d.schema_name
        INTO v_what, v_schema
        FROM pg_catalog.pg_event_trigger_dropped_objects() d
       WHERE NOT d.is_temporary
       LIMIT 1;
    ELSE
      SELECT c.command_tag || coalesce(' ' || c.object_identity, ''), c.schema_name
        INTO v_what, v_schema
        FROM pg_catalog.pg_event_trigger_ddl_commands() c
       WHERE c.schema_name IS DISTINCT FROM 'pg_temp'
         AND coalesce(c.object_identity, '') NOT LIKE 'pg_temp.%'
       LIMIT 1;
    END IF;

    IF v_what IS NULL THEN RETURN; END IF;

    -- One override per transaction, shared with the break-window guard.
    IF current_setting('ca.break_window_override_in_force', true) = txid_current()::text THEN
      RETURN;
    END IF;

    v_override := nullif(btrim(coalesce(current_setting('ca.break_window_migration_override', true), '')), '');
    v_switch := lower(coalesce(v_override, ''))
                IN ('on', 'off', 'true', 'false', 't', 'f', 'yes', 'no', 'y', 'n', '1', '0');

    IF v_override IS NOT NULL AND NOT v_switch THEN
      PERFORM set_config('ca.break_window_override_in_force', txid_current()::text, true);
      PERFORM set_config('ca.break_window_migration_override', '', false);
      INSERT INTO public.ca_break_window_migration_overrides
        (txid, reason, session_role, application_name, first_command, query_snippet)
      VALUES
        (txid_current(), 'release freeze: ' || v_override, session_user::text, nullif(v_app, ''), v_what,
         left(current_query(), 500));
      RAISE WARNING 'release freeze override: % allowed at % America/Chicago, inside the nightly release schema freeze. Reason: %',
        v_what, to_char(v_now AT TIME ZONE 'America/Chicago', 'HH24:MI:SS'), v_override;
      RETURN;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Once a governed command is identified, a failure (including the audit
    -- insert) aborts it. Before that, as the break-window guard, it allows.
    IF v_what IS NOT NULL THEN
      RAISE;
    END IF;
    RAISE WARNING 'fn_ca_release_freeze_ddl_guard could not decide (% %), so it allowed the command',
      SQLSTATE, SQLERRM;
    RETURN;
  END;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'migration refused: ' || v_refusal,
    DETAIL  = format(
      '%s was refused and nothing in this transaction was applied (login role %s, application %s). '
      'This rule holds for every repository and every hand session that reaches this database.',
      v_what, session_user, coalesce(nullif(v_app, ''), 'none')),
    HINT    = CASE
      WHEN v_switch THEN format(
        'ca.break_window_migration_override is %L, which is a switch, not a reason. Say which outage cannot wait until 04:15 America/Chicago.',
        v_override)
      WHEN v_schema = 'supabase_migrations' THEN
        'This is a migration tool preparing its history table (the Supabase MCP runs no-op ALTERs before '
        'list_migrations and apply_migration). Read the history with execute_sql instead: '
        'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC. '
        'Install after 04:15 America/Chicago.'
      ELSE
        'Merge the change and let it install after 04:15 America/Chicago (Club Arena: Apply Merged Migration). '
        'An outage that cannot wait: BEGIN; SET LOCAL ca.break_window_migration_override = ''<the outage>''; '
        '<migration>; COMMIT; every override is recorded in public.ca_break_window_migration_overrides '
        'and makes tonight''s Backup copy stale. club-arena CLAUDE.md, Production DDL policy.'
    END;
END;
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_release_freeze_ddl_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DO $postimage$
DECLARE
  f CONSTANT text := 'smarter_private.fn_ca_release_freeze_refuses_migrations';
BEGIN
  -- Boundaries: November (CST, UTC-6) and July (CDT, UTC-5).
  IF smarter_private.fn_ca_release_freeze_refuses_migrations('2026-11-22 05:44:59+00', 'mgmt-api') IS NOT NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-11-22 05:45:00+00', 'mgmt-api') IS NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-11-22 10:14:59+00', 'mgmt-api') IS NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-11-22 10:15:00+00', 'mgmt-api') IS NOT NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-07-01 04:44:59+00', 'Supavisor') IS NOT NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-07-01 04:45:00+00', 'Supavisor') IS NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-07-01 09:14:59+00', 'Supavisor') IS NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-07-01 09:15:00+00', 'Supavisor') IS NOT NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-11-22 07:15:48+00', 'apply-recorded-migration') IS NOT NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-11-22 07:15:48+00', 'install-window-migrations') IS NOT NULL
     OR smarter_private.fn_ca_release_freeze_refuses_migrations('2026-11-22 07:15:48+00', NULL) IS NULL THEN
    RAISE EXCEPTION '% boundary postimage drift', f;
  END IF;
  -- The break-window guard and the engine's recovery capability are untouched.
  IF public.fn_engine_recovery_window_contract() IS DISTINCT FROM 'engine-recovery-window-v1' THEN
    RAISE EXCEPTION 'release freeze guard changed the engine recovery capability';
  END IF;
  IF has_function_privilege('service_role', 'smarter_private.fn_ca_release_freeze_ddl_guard()', 'EXECUTE')
     OR has_function_privilege('anon', 'smarter_private.fn_ca_release_freeze_refuses_migrations(timestamptz,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'release freeze guard ACL drift';
  END IF;
END;
$postimage$;

-- Last: nothing after this in the transaction runs under them.
CREATE EVENT TRIGGER ca_release_freeze_refuses_ddl ON ddl_command_end
  EXECUTE FUNCTION smarter_private.fn_ca_release_freeze_ddl_guard();
CREATE EVENT TRIGGER ca_release_freeze_refuses_drops ON sql_drop
  EXECUTE FUNCTION smarter_private.fn_ca_release_freeze_ddl_guard();

COMMIT;
