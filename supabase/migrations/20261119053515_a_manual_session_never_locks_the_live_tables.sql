-- A MANUAL SESSION NEVER LOCKS THE LIVE TABLES (2026-11-19, incident 075013fd).
--
-- INCIDENT. 2026-11-18 23:32:25-23:34:19 UTC two direct `postgres` sessions
-- through Supavisor's transaction pooler (client 24.15.206.254, no
-- application_name of their own, so Postgres logged "Supavisor") ran
-- supabase/migrations/20260308_tournament_bounties_and_columns.sql against
-- production. The file was first sent whole and refused by the parser
-- (CREATE POLICY IF NOT EXISTS does not exist), then sent again statement by
-- statement in autocommit, carrying on past every error. Each
--   ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ...
-- queued for ACCESS EXCLUSIVE on public.tournaments (and then
-- tournament_players) only to find the column already there: 30 no-op
-- statements, up to 7.9 s of lock queue each, and every reader and writer of
-- the tournament tables queued behind them. Everything that touches
-- tournaments stalled for about 100 s and 13 cash tables for 16-57 s. Nothing
-- stopped it: each statement was its own short transaction, so the writer-lock
-- sentinel (15 s transaction age) never qualified it; fn_ca_table_stall_watch
-- cancelled three statements and the client simply sent the next one. The
-- version 20260308 is not in schema_migrations, and the file is not in any
-- workflow or script in this repository: the sender was an ad-hoc session.
--
-- THE RULE, ENFORCED BY THE DATABASE WHOEVER CONNECTS (an agent, psql, the
-- MCP, a script, a cron job):
--
-- 1. Only the sanctioned migration applier may run DDL that locks a live
--    table. The applier (scripts/ci/apply-recorded-migration.mjs, used by
--    apply-merged-migration.yml and by the daily window installer) now opens
--    every transaction with a CLAIM (migration-session-identity.mjs):
--    smarter_private.fn_ca_migration_applier_claim(version, name, md5) writes
--    a row bound to this backend (pid and backend start) and this transaction
--    (xid), and returns its random nonce into a transaction-local marker. The
--    claim cannot be left half-made: a deferred constraint trigger refuses
--    the COMMIT unless the same transaction recorded exactly that version and
--    name in supabase_migrations.schema_migrations with source bytes of that
--    md5. A session is the applier only when the marker, the row, the backend
--    and the transaction all agree; application_name alone proves nothing.
-- 2. An already-applied migration is never re-run: a claim for a version or
--    name already in schema_migrations is refused before the body runs.
-- 3. Any other session logged in as postgres (every manual route) is
--    refused, BEFORE any lock is requested (ddl_command_start), an ALTER
--    TABLE, CREATE/DROP/ALTER INDEX, REINDEX, CREATE/DROP/ALTER TRIGGER,
--    CREATE/ALTER/DROP POLICY, CREATE/DROP RULE or DROP TABLE whose statement
--    names a live table, and a CREATE TABLE that REFERENCES / PARTITION OF /
--    INHERITS one. CREATE/DROP/REINDEX ... CONCURRENTLY sent alone never
--    blocks writers and is allowed. A ddl_command_end backstop refuses the
--    same commands if the transaction nonetheless holds a writer-blocking lock
--    (Share, ShareRowExclusive, Exclusive, AccessExclusive) on a live table,
--    which catches DDL a statement's text does not spell out (dynamic SQL).
-- 4. ADD COLUMN IF NOT EXISTS naming a column a live table already has is
--    refused before the lock for EVERY session, the applier too: it would
--    queue ACCESS EXCLUSIVE on a live table to change nothing.
--
-- The live tables are smarter_private.ca_live_tables: the tables the 2026-11-18
-- incident and the 2026-10-22 lock storm stalled (tournaments,
-- tournament_players, tables, table_seats, hand_history, clubs) and the
-- busiest public tables on the hand, seat, tournament and money paths
-- (pg_stat_user_tables on production 2026-11-19). The writer-lock sentinel has
-- no list of its own (it watches every public table); this is that list.
--
-- Not covered (the event-trigger interface does not fire for them): LOCK
-- TABLE, TRUNCATE, VACUUM FULL, CLUSTER. The writer-lock sentinel still
-- cancels those after 15 s.
--
-- Nothing here locks a live table: two new tables in smarter_private and two
-- event triggers. The event triggers are created last, so nothing else in
-- this transaction runs under them.
-- @live-proof: EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ca_live_tables_refuse_manual_ddl' AND evtevent = 'ddl_command_start' AND evtenabled = 'O') AND EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ca_live_tables_refuse_manual_ddl_held' AND evtevent = 'ddl_command_end' AND evtenabled = 'O') AND to_regprocedure('smarter_private.fn_ca_migration_applier_claim(text,text,text)') IS NOT NULL AND (SELECT count(*) FROM smarter_private.ca_live_tables) = 31
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE smarter_private.ca_live_tables (
  relname text PRIMARY KEY CHECK (relname ~ '^[a-z_][a-z0-9_]*$'),
  why     text NOT NULL
);
COMMENT ON TABLE smarter_private.ca_live_tables IS
  'Public tables whose writer-blocking lock stalls live play. Only the sanctioned migration applier may run table-locking DDL on them (fn_ca_live_tables_refuse_manual_ddl, incident 075013fd).';
ALTER TABLE smarter_private.ca_live_tables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.ca_live_tables FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO smarter_private.ca_live_tables (relname, why) VALUES
  ('tournaments',                 'stalled ~100 s on 2026-11-18 23:32 UTC'),
  ('tournament_players',          'stalled on 2026-11-18 23:33 UTC; every tournament hand'),
  ('tournament_bounties',         'knockout hands'),
  ('tables',                      'every hand; 2026-10-22 lock storm'),
  ('table_seats',                 'every hand and seat change'),
  ('table_hole_cards',            'every deal'),
  ('hand_history',                'every hand commit; 2026-10-22 lock storm'),
  ('hand_atomic_commits',         'every hand commit'),
  ('hand_state_snapshots',        'every hand action'),
  ('hand_projection_outbox',      'every hand commit'),
  ('ca_settlements',              'every settlement'),
  ('settlement_idempotency_keys', 'every settlement'),
  ('ca_hand_facts',               'every hand projection'),
  ('ca_hand_transfers',           'every hand projection'),
  ('engine_table_leases',         'engine table heartbeat'),
  ('engine_tournament_leases',    'engine tournament heartbeat'),
  ('cash_games',                  'cash lobby and seating'),
  ('cash_player_session',         'every cash sit and leave'),
  ('lightning_reservation',       'every Lightning hand'),
  ('lightning_pool_slot',         'every Lightning hand'),
  ('lightning_hand_player',       'every Lightning hand'),
  ('clubs',                       'every buy-in and rake; 2026-10-22 lock storm'),
  ('club_members',                'every buy-in and cash-out'),
  ('club_wallets',                'club money'),
  ('unions',                      'union money'),
  ('union_wallets',               'union money and rake'),
  ('bbj_pools',                   'every BBJ hand'),
  ('wallets',                     'player money'),
  ('diamond_wallets',             'player diamonds'),
  ('chip_transactions',           'every chip movement'),
  ('profiles',                    'every request reads it');

CREATE TABLE smarter_private.ca_migration_applier_claims (
  id               bigserial PRIMARY KEY,
  txid             xid8 NOT NULL UNIQUE,
  pid              integer NOT NULL,
  backend_start    timestamptz NOT NULL,
  version          text NOT NULL,
  name             text NOT NULL,
  source_md5       text NOT NULL CHECK (source_md5 ~ '^[0-9a-f]{32}$'),
  nonce            uuid NOT NULL DEFAULT gen_random_uuid(),
  application_name text,
  claimed_at       timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE smarter_private.ca_migration_applier_claims IS
  'One row per migration transaction the sanctioned applier opened: the backend and transaction it is bound to, and the history it must record before COMMIT (incident 075013fd).';
ALTER TABLE smarter_private.ca_migration_applier_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.ca_migration_applier_claims FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE smarter_private.ca_migration_applier_claims_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- A claim is made by this backend, for this transaction, for a migration that
-- is not yet recorded; and it is never rewritten afterwards.
CREATE FUNCTION smarter_private.fn_ca_migration_applier_claim_admit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prior text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'migration_applier_claim_immutable: a migration applier claim is never % ', lower(TG_OP)
      USING ERRCODE = '55000';
  END IF;
  IF NEW.txid IS DISTINCT FROM pg_catalog.pg_current_xact_id()
     OR NEW.pid IS DISTINCT FROM pg_catalog.pg_backend_pid()
     OR NEW.backend_start IS DISTINCT FROM
        (SELECT a.backend_start FROM pg_catalog.pg_stat_activity a WHERE a.pid = pg_catalog.pg_backend_pid()) THEN
    RAISE EXCEPTION 'migration_applier_claim_foreign: a claim binds only the transaction and backend that make it'
      USING ERRCODE = '55000';
  END IF;
  SELECT string_agg(format('version %s name %s', m.version, m.name), '; ' ORDER BY m.version)
    INTO v_prior
    FROM supabase_migrations.schema_migrations m
   WHERE m.version = NEW.version OR m.name = NEW.name OR m.name = left(NEW.name, 55);
  IF v_prior IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('migration_already_applied: %s_%s is already recorded (%s); a re-run is refused',
                       NEW.version, NEW.name, v_prior),
      DETAIL  = 'Nothing in this transaction was applied. An applied migration is never sent again: its statements ran once, and a re-run can only re-take their locks.',
      HINT    = 'Read the history with SELECT version, name FROM supabase_migrations.schema_migrations; change production with a new migration.';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_migration_applier_claim_admit() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER ca_migration_applier_claim_admit
  BEFORE INSERT OR UPDATE OR DELETE ON smarter_private.ca_migration_applier_claims
  FOR EACH ROW EXECUTE FUNCTION smarter_private.fn_ca_migration_applier_claim_admit();

-- At COMMIT: the claimed migration is recorded, by exactly the claimed bytes.
CREATE FUNCTION smarter_private.fn_ca_migration_applier_claim_recorded()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations m
     WHERE m.version = NEW.version AND m.name = NEW.name
       AND pg_catalog.cardinality(m.statements) = 1
       AND pg_catalog.md5(m.statements[1]) = NEW.source_md5
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('migration_applier_claim_unrecorded: the transaction claimed migration %s_%s but did not record it',
                       NEW.version, NEW.name),
      DETAIL  = 'A migration applier claim commits only with its exact history row (same version, name and source md5). Rolled back; nothing was applied.';
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_migration_applier_claim_recorded() FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER ca_migration_applier_claim_is_recorded
  AFTER INSERT ON smarter_private.ca_migration_applier_claims
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION smarter_private.fn_ca_migration_applier_claim_recorded();

CREATE FUNCTION smarter_private.fn_ca_migration_applier_claim(p_version text, p_name text, p_source_md5 text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_nonce uuid;
BEGIN
  IF p_version IS NULL OR p_version !~ '^[0-9A-Za-z_]{1,64}$'
     OR p_name IS NULL OR p_name !~ '^[A-Za-z0-9_.-]{1,255}$'
     OR p_source_md5 IS NULL OR p_source_md5 !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'migration_applier_claim_invalid: version %, name %, md5 %', p_version, p_name, p_source_md5
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO smarter_private.ca_migration_applier_claims
    (txid, pid, backend_start, version, name, source_md5, application_name)
  SELECT pg_catalog.pg_current_xact_id(), a.pid, a.backend_start, p_version, p_name, p_source_md5,
         current_setting('application_name', true)
    FROM pg_catalog.pg_stat_activity a
   WHERE a.pid = pg_catalog.pg_backend_pid()
  RETURNING nonce INTO v_nonce;
  IF v_nonce IS NULL THEN
    RAISE EXCEPTION 'migration_applier_claim_unbound: this backend is not in pg_stat_activity' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_catalog.set_config('ca.migration_applier_claim', v_nonce::text, true);
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_migration_applier_claim(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
-- The applier logs in as postgres (production's owner of this function already).
GRANT EXECUTE ON FUNCTION smarter_private.fn_ca_migration_applier_claim(text, text, text) TO postgres;
COMMENT ON FUNCTION smarter_private.fn_ca_migration_applier_claim(text, text, text) IS
  'Called by the sanctioned migration applier right after BEGIN (scripts/ci/migration-session-identity.mjs). Refuses a migration already recorded; the claim must be matched by its exact history row at COMMIT.';

-- Is this transaction the sanctioned applier's? The marker, the claim row, the
-- backend and the transaction must all agree.
CREATE FUNCTION smarter_private.fn_ca_migration_applier_claimed()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_marker text := current_setting('ca.migration_applier_claim', true);
  v_xid    xid8 := pg_catalog.pg_current_xact_id_if_assigned();
BEGIN
  IF v_xid IS NULL OR v_marker IS NULL
     OR v_marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM smarter_private.ca_migration_applier_claims c
      JOIN pg_catalog.pg_stat_activity a ON a.pid = c.pid AND a.backend_start = c.backend_start
     WHERE c.txid = v_xid
       AND c.pid = pg_catalog.pg_backend_pid()
       AND c.nonce = v_marker::uuid
  );
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_migration_applier_claimed() FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: smarter_private.fn_ca_migration_applier_claim
-- @probe-for: smarter_private.fn_ca_migration_applier_claimed
-- Both bodies run once in a subtransaction that is always undone (the claim
-- row, its marker and its deferred check go with it): unclaimed reads false,
-- a claim for an unrecorded probe version binds this backend and transaction,
-- and a claim for a recorded version is refused.
DO $probe$
DECLARE
  v_recorded text;
BEGIN
  IF smarter_private.fn_ca_migration_applier_claimed() THEN
    RAISE EXCEPTION 'probe: an unclaimed transaction read as the applier';
  END IF;
  PERFORM smarter_private.fn_ca_migration_applier_claim('00000000000000', 'probe_never_recorded', md5('probe'));
  IF NOT smarter_private.fn_ca_migration_applier_claimed() THEN
    RAISE EXCEPTION 'probe: a claim did not bind its own transaction';
  END IF;
  SELECT m.version INTO v_recorded FROM supabase_migrations.schema_migrations m
   WHERE m.version ~ '^[0-9A-Za-z_]{1,64}$' AND m.name ~ '^[A-Za-z0-9_.-]{1,255}$' LIMIT 1;
  IF v_recorded IS NOT NULL THEN
    BEGIN
      PERFORM smarter_private.fn_ca_migration_applier_claim(v_recorded, 'probe_rerun', md5('probe'));
      RAISE EXCEPTION 'probe: a claim for recorded version % was admitted', v_recorded;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM NOT LIKE 'migration_already_applied:%' AND SQLERRM NOT LIKE 'duplicate key%' THEN RAISE; END IF;
    END;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- SQL text without comments; with p_keep_dollar false, without dollar-quoted
-- bodies either.
CREATE FUNCTION smarter_private.fn_ca_ddl_code(p_query text, p_keep_dollar boolean)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_src  text := coalesce(p_query, '');
  v_out  text := '';
  v_m    text[];
  v_tag  text;
  v_at   integer;
BEGIN
  v_src := regexp_replace(v_src, '/\*.*?\*/', ' ', 'g');
  v_src := regexp_replace(v_src, '--[^\n]*', ' ', 'g');
  IF p_keep_dollar THEN
    RETURN v_src;
  END IF;
  LOOP
    v_m := regexp_match(v_src, '\$([A-Za-z_][A-Za-z_0-9]*)?\$');
    EXIT WHEN v_m IS NULL;
    v_tag := '$' || coalesce(v_m[1], '') || '$';
    v_at := strpos(v_src, v_tag);
    v_out := v_out || left(v_src, v_at - 1) || ' ';
    v_src := substr(v_src, v_at + length(v_tag));
    v_at := strpos(v_src, v_tag);
    IF v_at = 0 THEN
      v_src := '';
      EXIT;
    END IF;
    v_src := substr(v_src, v_at + length(v_tag));
  END LOOP;
  RETURN v_out || v_src;
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_ddl_code(text, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- The live tables a statement names (optionally only right after a prefix
-- such as REFERENCES), as public.<name>. Unqualified or public-qualified,
-- quoted or not; another schema's table of the same name is not a match.
CREATE FUNCTION smarter_private.fn_ca_live_tables_named(p_query text, p_prefix text DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_code text := smarter_private.fn_ca_ddl_code(p_query, true);
  v_out  text[] := '{}';
  r      record;
BEGIN
  FOR r IN SELECT h.relname FROM smarter_private.ca_live_tables h ORDER BY h.relname LOOP
    IF v_code ~* (
         CASE WHEN p_prefix IS NULL THEN '(^|[^a-z0-9_$."])'
              ELSE '(^|[^a-z0-9_$."])(' || p_prefix || ')[[:space:]]*' END
         || '("?public"?[[:space:]]*\.[[:space:]]*)?"?' || r.relname || '"?([^a-z0-9_$]|$)') THEN
      v_out := v_out || ('public.' || r.relname);
    END IF;
  END LOOP;
  RETURN v_out;
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_live_tables_named(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Every ALTER TABLE <live table> ... ADD [COLUMN] IF NOT EXISTS <column> whose
-- column already exists, as public.<table>.<column>. Reads the catalog only:
-- no relation lock is taken.
CREATE FUNCTION smarter_private.fn_ca_live_table_noop_add_columns(p_query text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_out  text[] := '{}';
  v_stmt text;
  v_rel  text[];
  v_tbl  text;
  v_oid  oid;
  v_col  text[];
BEGIN
  FOREACH v_stmt IN ARRAY string_to_array(smarter_private.fn_ca_ddl_code(p_query, false), ';') LOOP
    v_rel := regexp_match(v_stmt,
      '^[[:space:]]*alter[[:space:]]+table[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?(only[[:space:]]+)?'
      || '(("?[a-z_][a-z0-9_$]*"?)[[:space:]]*\.[[:space:]]*)?("?[a-z_][a-z0-9_$]*"?)[[:space:]]', 'i');
    CONTINUE WHEN v_rel IS NULL;
    CONTINUE WHEN lower(btrim(coalesce(v_rel[4], 'public'), '"')) <> 'public';
    v_tbl := lower(btrim(v_rel[5], '"'));
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM smarter_private.ca_live_tables h WHERE h.relname = v_tbl);
    v_oid := to_regclass(format('public.%I', v_tbl));
    CONTINUE WHEN v_oid IS NULL;
    FOR v_col IN
      SELECT regexp_matches(v_stmt,
        'add[[:space:]]+(column[[:space:]]+)?if[[:space:]]+not[[:space:]]+exists[[:space:]]+("?[a-z_][a-z0-9_$]*"?)', 'gi')
    LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
                    AND a.attname = lower(btrim(v_col[2], '"'))) THEN
        v_out := v_out || format('public.%s.%s', v_tbl, lower(btrim(v_col[2], '"')));
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_out;
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_live_table_noop_add_columns(text) FROM PUBLIC, anon, authenticated, service_role;

-- ddl_command_start: decided before the command requests any relation lock.
CREATE FUNCTION smarter_private.fn_ca_live_tables_refuse_manual_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_app     text := coalesce(nullif(current_setting('application_name', true), ''), 'none');
  v_query   text;
  v_key     text;
  v_claimed boolean := false;
  v_noop    text[] := '{}';
  v_named   text[] := '{}';
  v_failed  text;
BEGIN
  IF TG_TAG NOT IN ('ALTER TABLE', 'CREATE TABLE', 'DROP TABLE', 'CREATE INDEX', 'DROP INDEX', 'ALTER INDEX',
                    'REINDEX', 'CREATE TRIGGER', 'DROP TRIGGER', 'ALTER TRIGGER', 'CREATE POLICY',
                    'ALTER POLICY', 'DROP POLICY', 'CREATE RULE', 'DROP RULE') THEN
    RETURN;
  END IF;
  -- Every manual route (the pooler, the management API and MCP, psql, the
  -- dashboard) and the applier log in as postgres. The engine's roles,
  -- PostgREST's authenticator and Supabase's own roles own no live table.
  IF session_user::text <> 'postgres' THEN
    RETURN;
  END IF;
  BEGIN
    v_claimed := coalesce(smarter_private.fn_ca_migration_applier_claimed(), false);
  EXCEPTION WHEN OTHERS THEN
    v_claimed := false;
  END;
  BEGIN
    v_query := current_query();
    -- One no-op scan per client statement, against the catalog as the
    -- statement found it (a multi-statement message shares one statement_timestamp).
    IF TG_TAG = 'ALTER TABLE' THEN
      v_key := pg_catalog.pg_backend_pid()::text || '/' || transaction_timestamp()::text || '/' || statement_timestamp()::text;
      IF current_setting('ca.live_table_noop_checked', true) IS DISTINCT FROM v_key THEN
        v_noop := smarter_private.fn_ca_live_table_noop_add_columns(v_query);
        IF cardinality(v_noop) = 0 THEN
          PERFORM pg_catalog.set_config('ca.live_table_noop_checked', v_key, true);
        END IF;
      END IF;
    END IF;
    IF cardinality(v_noop) = 0 AND NOT v_claimed THEN
      IF TG_TAG IN ('CREATE INDEX', 'DROP INDEX', 'REINDEX')
         AND btrim(smarter_private.fn_ca_ddl_code(v_query, true), E' \t\r\n;') !~ ';'
         AND btrim(smarter_private.fn_ca_ddl_code(v_query, true), E' \t\r\n;') ~*
             '^(create[[:space:]]+(unique[[:space:]]+)?index|drop[[:space:]]+index|reindex[[:space:]]+[a-z]+)[[:space:]]+concurrently[[:space:]]' THEN
        RETURN;  -- never blocks writers
      END IF;
      v_named := CASE WHEN TG_TAG = 'CREATE TABLE'
                      THEN smarter_private.fn_ca_live_tables_named(v_query, 'references|partition[[:space:]]+of|inherits[[:space:]]*\(')
                      ELSE smarter_private.fn_ca_live_tables_named(v_query) END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLSTATE || ' ' || SQLERRM;
  END;

  IF v_failed IS NOT NULL THEN
    IF v_claimed THEN
      RAISE WARNING 'fn_ca_live_tables_refuse_manual_ddl could not read % (%); the migration applier''s command was allowed', TG_TAG, v_failed;
      RETURN;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('live-table DDL refused: %s could not be checked (%s) and this session is not the migration applier', TG_TAG, v_failed),
      DETAIL  = format('login role %s, application %s. Nothing was locked and nothing in this transaction was applied.', session_user, v_app);
  END IF;

  IF cardinality(v_noop) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('no-op live-table DDL refused before its lock: ADD COLUMN IF NOT EXISTS names existing column %s',
                       array_to_string(v_noop, ', ')),
      DETAIL  = format('ALTER TABLE takes ACCESS EXCLUSIVE on the live table before it notices the column exists, and every hand, seat and tournament queues behind it to change nothing (2026-11-18 23:32 UTC: 30 such statements froze tournaments for ~100 s). Login role %s, application %s. Nothing was locked and nothing in this transaction was applied.',
                       session_user, v_app),
      HINT    = 'Remove the clause for the column that already exists.';
  END IF;

  IF cardinality(v_named) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('live-table DDL refused: %s names %s and this session is not the migration applier',
                       TG_TAG, array_to_string(v_named, ', ')),
      DETAIL  = format('Login role %s, application %s. Nothing was locked and nothing in this transaction was applied. A lock on a live table queues every hand, seat and tournament behind it (2026-11-18 23:32 UTC: a manual re-run of 20260308_tournament_bounties_and_columns.sql froze tournaments for ~100 s).',
                       session_user, v_app),
      HINT    = 'Merge the change as a migration: it installs through apply-merged-migration.yml, or in the daily 04:00 America/Chicago window when it locks a live table. club-arena CLAUDE.md, Production DDL policy.';
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_live_tables_refuse_manual_ddl() FROM PUBLIC, anon, authenticated, service_role;

-- ddl_command_end backstop: whatever the text said, a session that is not the
-- applier does not keep a writer-blocking lock on a live table.
CREATE FUNCTION smarter_private.fn_ca_live_tables_refuse_manual_ddl_held()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_app     text := coalesce(nullif(current_setting('application_name', true), ''), 'none');
  v_claimed boolean := false;
  v_held    text;
BEGIN
  IF TG_TAG NOT IN ('ALTER TABLE', 'CREATE TABLE', 'DROP TABLE', 'CREATE INDEX', 'DROP INDEX', 'ALTER INDEX',
                    'REINDEX', 'CREATE TRIGGER', 'DROP TRIGGER', 'ALTER TRIGGER', 'CREATE POLICY',
                    'ALTER POLICY', 'DROP POLICY', 'CREATE RULE', 'DROP RULE') THEN
    RETURN;
  END IF;
  IF session_user::text <> 'postgres' THEN
    RETURN;
  END IF;
  BEGIN
    v_claimed := coalesce(smarter_private.fn_ca_migration_applier_claimed(), false);
  EXCEPTION WHEN OTHERS THEN
    v_claimed := false;
  END;
  IF v_claimed THEN
    RETURN;
  END IF;
  SELECT string_agg(DISTINCT format('%s on public.%s', l.mode, c.relname), ', ')
    INTO v_held
    FROM pg_catalog.pg_locks l
    JOIN pg_catalog.pg_class c ON c.oid = l.relation
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN smarter_private.ca_live_tables h ON h.relname = c.relname
   WHERE l.locktype = 'relation'
     AND l.pid = pg_catalog.pg_backend_pid()
     AND l.granted
     AND l.mode IN ('ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock');
  IF v_held IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('live-table DDL refused: %s left this session holding %s and this session is not the migration applier', TG_TAG, v_held),
      DETAIL  = format('Login role %s, application %s. Rolled back; nothing in this transaction was applied.', session_user, v_app),
      HINT    = 'Merge the change as a migration: it installs through apply-merged-migration.yml, or in the daily 04:00 America/Chicago window when it locks a live table. club-arena CLAUDE.md, Production DDL policy.';
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_live_tables_refuse_manual_ddl_held() FROM PUBLIC, anon, authenticated, service_role;

-- Last: nothing after this in the transaction runs under them.
CREATE EVENT TRIGGER ca_live_tables_refuse_manual_ddl ON ddl_command_start
  EXECUTE FUNCTION smarter_private.fn_ca_live_tables_refuse_manual_ddl();
CREATE EVENT TRIGGER ca_live_tables_refuse_manual_ddl_held ON ddl_command_end
  EXECUTE FUNCTION smarter_private.fn_ca_live_tables_refuse_manual_ddl_held();

COMMIT;
