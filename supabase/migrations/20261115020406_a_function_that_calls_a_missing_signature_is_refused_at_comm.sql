-- 20261115020406_a_function_that_calls_a_missing_signature_is_refused_at_comm.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS CHANGES, AND WHY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A PL/pgSQL FUNCTION THAT CALLS A SIGNATURE THAT DOES NOT EXIST IS REFUSED
-- WHEN ITS TRANSACTION COMMITS.
--
-- 2026-11-14: 20261114072509 patched public.fn_mystery_bounty_seed to call
-- public.fn_mystery_sealed_ladder_for_open(uuid, integer, bigint) with
-- (SELECT sum((x->>'amount_cents')::bigint) ...) as the pool. sum(bigint) is
-- numeric, so the call named (uuid, integer, numeric), which does not exist.
-- Postgres accepted the CREATE, because a PL/pgSQL body is not resolved until
-- it runs; the first call raised 42883, every mystery activation rolled back,
-- and two live mystery bounty MTTs stopped dealing until 20261115001336
-- (#10884) cast the sum back. That migration's @live-proof checked the call
-- text was there, and it was. Nothing asked whether the call resolved.
--
-- Now the database asks. For every function or procedure a transaction
-- creates or alters in public or smarter_private, at COMMIT, plpgsql_check
-- resolves every static call and operator in its body, and a 42883 finding
-- ("function ... does not exist" / "operator does not exist") aborts the
-- whole transaction with the function, the line and the missing signature.
--
-- ── HOW ───────────────────────────────────────────────────────────────────
--
--   1. smarter_private.fn_ca_unresolved_function_calls(regprocedure) is the
--      question, asked once: the 42883 findings for one function. The guard
--      and every audit use it, so they cannot disagree.
--   2. Event trigger ca_function_calls_must_resolve_at_commit (ddl_command_end,
--      CREATE/ALTER FUNCTION/PROCEDURE/ROUTINE) puts the oid of each function
--      in scope on smarter_private.ca_function_resolution_queue. It decides
--      nothing, because at that moment a forward reference (A calls B, B is
--      created further down the same migration) is not yet resolvable.
--   3. Constraint trigger ca_function_calls_must_resolve on that queue is
--      DEFERRABLE INITIALLY DEFERRED, so it runs at COMMIT, when the whole
--      migration is in place. It consumes the row (the queue is empty after
--      every transaction), asks the helper, and RAISEs 42883 on a finding.
--      A RAISE at COMMIT rolls the whole transaction back: nothing installed,
--      the queued PostgREST NOTIFY discarded, no history row written.
--
-- ── MEASURED ON PRODUCTION BEFORE IT WAS WRITTEN (2026-11-15) ─────────────
--
--   * plpgsql_check 2.7 is already installed (20260421050703, schema public)
--     and in shared_preload_libraries. CREATE EXTENSION below is a no-op
--     there and only matters to a fresh database.
--   * Every role carries plpgsql_check.mode = disabled (20261110152729). In
--     that mode an EXPLICIT plpgsql_check_function_tb() call returns NO ROWS
--     for a function that plainly calls a missing signature. A checker that
--     answers "nothing found" when it did not look is the failure CLAUDE.md
--     10.86 describes, so the helper carries SET plpgsql_check.mode =
--     'by_function' (restored when it returns).
--   * plpgsql_check honours a function's own SET search_path. The 5 plpgsql
--     functions in scope without one are checked under public, extensions,
--     the path postgres and PostgREST run them with.
--   * 3,725 non-trigger plpgsql functions in public/smarter_private checked
--     in 9.2 s (about 2.5 ms each); 6 had a static call to a signature that
--     does not exist, every one a real latent 42883, none a false finding;
--     0 checker errors. Locks taken while a check prepares a query are
--     released when it returns (20 locks before 400 checks, 23 after).
--
-- ── WHAT IS NOT CHECKED, ON PURPOSE ──────────────────────────────────────
--
--   * Schemas other than public and smarter_private (auth, storage,
--     extensions, cron, graphql, ...: Supabase's own), pg_temp (probes), and
--     anything created by CREATE/ALTER EXTENSION (in_extension).
--   * Languages other than plpgsql: a SQL-language body is already resolved
--     at CREATE. Trigger and event-trigger functions (they need a relation to
--     check against) and polymorphic functions (plpgsql_check would have to
--     guess the argument type, and a guess can refuse a correct function).
--   * Dynamic SQL: EXECUTE, FOR ... IN EXECUTE, RETURN QUERY EXECUTE and
--     OPEN ... FOR EXECUTE. plpgsql_check does resolve a constant string
--     there, but EXECUTE is how a body deliberately defers resolution (an
--     optional extension, an object it creates itself), so those findings
--     are dropped. Production had none.
--   * Temporary tables: a query on a table that does not exist yet is a
--     42P01 for plpgsql_check, never a 42883, so it is not refused.
--   * A DROP or signature change of a CALLEE. This guards the function being
--     installed, not the functions that already call the one being dropped.
--   * Sessions where triggers do not fire (session_replication_role =
--     replica) and superuser sessions Supabase exempts from user event
--     triggers (platform upgrades by supabase_admin).
--
--   SET CONSTRAINTS ALL IMMEDIATE (22 migrations use it to fire the ledger's
--   deferred checks early) would make the check fire there instead of at
--   COMMIT. The event trigger sets this constraint back to DEFERRED before
--   each queued row, so only a function created BEFORE that statement and
--   calling one created AFTER it is judged early. Create the callee first.
--
-- ── THE OVERRIDE: A REASON, NOT A SWITCH ─────────────────────────────────
--
--     BEGIN;
--     SET LOCAL ca.function_resolution_override = '<why this may not resolve yet>';
--     ... the migration ...
--     COMMIT;
--
--   Honoured for that one transaction, the break-window override's rules:
--   blank or a switch ('on', 'true', '1', ...) is refused; a session-level
--   SET is consumed by the first transaction it lets through; every
--   function installed under it writes one row (function, unresolved calls,
--   reason, login role, application, time) to the append-only
--   smarter_private.ca_function_resolution_overrides, and raises a WARNING.
--
-- ── FAIL OPEN, LOUDLY ─────────────────────────────────────────────────────
--
--   It refuses only on a positive 42883 finding. If plpgsql_check is missing
--   or cannot check a function (an exotic body, a lock it cannot get), it
--   WARNs and lets that function through: a guard on every CREATE FUNCTION
--   in a database shared with Supabase and the World Hub must never turn its
--   own defect into a refusal of everything.
--
-- ── COST ──────────────────────────────────────────────────────────────────
--
--   About 2.5 ms per function at COMMIT, inside the 12 s install budget
--   (apply-recorded-migration.mjs). The audit below of the functions already
--   live is bounded to 3 s for the same reason: the full audit measured 9.2 s
--   and would put this install itself at risk. Read the full list read-only:
--     SELECT p.oid::regprocedure, c.* FROM pg_proc p
--       JOIN pg_namespace n ON n.oid = p.pronamespace
--       CROSS JOIN LATERAL smarter_private.fn_ca_unresolved_function_calls(p.oid::regprocedure) c
--      WHERE n.nspname IN ('public', 'smarter_private');
--
-- No table is locked beyond the two created here; no money moves.
--
-- @live-proof: EXISTS (SELECT 1 FROM pg_event_trigger e WHERE e.evtname = 'ca_function_calls_must_resolve_at_commit' AND e.evtenabled = 'O') AND EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'smarter_private' AND c.relname = 'ca_function_resolution_queue' AND t.tgname = 'ca_function_calls_must_resolve' AND t.tgdeferrable AND t.tginitdeferred AND t.tgenabled = 'O') AND to_regprocedure('smarter_private.fn_ca_unresolved_function_calls(regprocedure)') IS NOT NULL

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 0. THE CHECKER ────────────────────────────────────────────────────────
-- Already installed on production since 20260421050703; a no-op there.
CREATE EXTENSION IF NOT EXISTS plpgsql_check;

-- ── 1. THE QUESTION, ASKED ONCE ───────────────────────────────────────────
-- The 42883 findings for one function: every static call or operator in its
-- body that does not resolve. Nothing for a function this guard does not
-- judge (see the header), nothing (and a WARNING) when the checker fails.
CREATE OR REPLACE FUNCTION smarter_private.fn_ca_unresolved_function_calls(p_fn regprocedure)
RETURNS TABLE(lineno integer, statement text, message text)
LANGUAGE plpgsql
STABLE
-- The path a function without its own SET search_path runs under (postgres,
-- PostgREST). A function that sets its own is checked under its own.
SET search_path = public, extensions
-- Every role has plpgsql_check.mode = disabled, and in that mode an explicit
-- check silently returns nothing. Restored when this function returns.
SET plpgsql_check.mode = 'by_function'
AS $fn$
DECLARE
  v_lang    text;
  v_kind    "char";
  v_rettype oid;
  v_src     text;
  v_poly    boolean;
  v_checker text;
  v_found   jsonb;
  v_lines   text[];
BEGIN
  SELECT l.lanname, p.prokind, p.prorettype, p.prosrc,
         EXISTS (SELECT 1
                   FROM pg_catalog.unnest(p.proargtypes::oid[] || p.prorettype) AS t(typ)
                   JOIN pg_catalog.pg_type ty ON ty.oid = t.typ
                  WHERE ty.typtype = 'p' AND ty.typname LIKE 'any%')
    INTO v_lang, v_kind, v_rettype, v_src, v_poly
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
   WHERE p.oid = p_fn;

  IF v_lang IS DISTINCT FROM 'plpgsql'
     OR v_kind NOT IN ('f', 'p')
     OR v_rettype IN ('pg_catalog.trigger'::pg_catalog.regtype,
                      'pg_catalog.event_trigger'::pg_catalog.regtype)
     OR v_poly THEN
    RETURN;
  END IF;

  SELECT n.nspname INTO v_checker
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'plpgsql_check';
  IF v_checker IS NULL THEN
    RAISE WARNING 'fn_ca_unresolved_function_calls: plpgsql_check is not installed, so % was not checked', p_fn;
    RETURN;
  END IF;

  BEGIN
    EXECUTE pg_catalog.format($q$
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'lineno', c.lineno, 'statement', c.statement, 'message', c.message)
             ORDER BY c.lineno)
        FROM %I.plpgsql_check_function_tb($1, fatal_errors => false, without_warnings => true) c
       WHERE c.sqlstate = '42883'
    $q$, v_checker)
      INTO v_found
      USING p_fn;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_ca_unresolved_function_calls could not check % (% %), so it reports nothing for it',
      p_fn, SQLSTATE, SQLERRM;
    RETURN;
  END;

  IF v_found IS NULL THEN
    RETURN;
  END IF;

  -- Dynamic SQL is not judged (see the header). EXECUTE and FOR ... IN
  -- EXECUTE name themselves; RETURN QUERY EXECUTE and OPEN ... FOR EXECUTE
  -- report as RETURN QUERY / OPEN, so their own source line says which.
  v_lines := pg_catalog.string_to_array(v_src, E'\n');
  RETURN QUERY
    SELECT (f->>'lineno')::integer, f->>'statement', f->>'message'
      FROM pg_catalog.jsonb_array_elements(v_found) AS f
     WHERE NOT (
             f->>'statement' IN ('EXECUTE', 'FOR over EXECUTE statement')
          OR (f->>'statement' IN ('RETURN QUERY', 'OPEN')
              AND coalesce(v_lines[(f->>'lineno')::integer], '') || ' '
                  || coalesce(v_lines[(f->>'lineno')::integer + 1], '')
                  ~* '\y(QUERY|FOR)\s+EXECUTE\y')
           );
END;
$fn$;

COMMENT ON FUNCTION smarter_private.fn_ca_unresolved_function_calls(regprocedure) IS
  'The 42883 findings (a call or operator whose signature does not exist) in one plpgsql function, from plpgsql_check. Shared by the commit-time guard and every audit. Skips non-plpgsql, trigger, event-trigger and polymorphic functions and dynamic SQL; warns and reports nothing when the checker fails. 2026-11-14 incident: fn_mystery_bounty_seed.';

-- ── 2. THE QUEUE, EMPTY AFTER EVERY TRANSACTION ───────────────────────────
-- No foreign key and no unique key (CLAUDE.md section 2 rule 7): a row lives
-- only until its own transaction commits or aborts.
CREATE TABLE smarter_private.ca_function_resolution_queue (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fn_oid      oid         NOT NULL,
  command_tag text        NOT NULL,
  queued_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE smarter_private.ca_function_resolution_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.ca_function_resolution_queue FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE smarter_private.ca_function_resolution_queue IS
  'Functions created or altered in this transaction, waiting for the COMMIT-time check that their calls resolve. Always empty outside a DDL transaction.';

-- ── 3. THE RECORD OF EVERY OVERRIDE, APPEND-ONLY ──────────────────────────
CREATE TABLE smarter_private.ca_function_resolution_overrides (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  txid             bigint      NOT NULL,
  function_name    text        NOT NULL,
  unresolved_calls text        NOT NULL,
  reason           text        NOT NULL CHECK (btrim(reason) <> ''),
  session_role     text        NOT NULL,
  application_name text
);
ALTER TABLE smarter_private.ca_function_resolution_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.ca_function_resolution_overrides FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE smarter_private.ca_function_resolution_overrides TO service_role;
COMMENT ON TABLE smarter_private.ca_function_resolution_overrides IS
  'One row per function installed with a call that does not resolve, under SET LOCAL ca.function_resolution_override = ''<reason>''. Append-only.';

CREATE OR REPLACE FUNCTION smarter_private.fn_ca_function_resolution_overrides_are_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format('smarter_private.ca_function_resolution_overrides is append-only: %s refused', TG_OP);
END;
$fn$;

CREATE TRIGGER ca_function_resolution_overrides_are_append_only
  BEFORE UPDATE OR DELETE ON smarter_private.ca_function_resolution_overrides
  FOR EACH ROW EXECUTE FUNCTION smarter_private.fn_ca_function_resolution_overrides_are_append_only();
CREATE TRIGGER ca_function_resolution_overrides_are_never_truncated
  BEFORE TRUNCATE ON smarter_private.ca_function_resolution_overrides
  FOR EACH STATEMENT EXECUTE FUNCTION smarter_private.fn_ca_function_resolution_overrides_are_append_only();

-- ── 4. THE CHECK, AT COMMIT ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION smarter_private.fn_ca_function_calls_must_resolve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_fn       regprocedure;
  v_calls    text;
  v_override text;
  v_switch   boolean := false;
  v_app      text := coalesce(current_setting('application_name', true), '');
BEGIN
  -- Consume the row first, so the queue is empty whatever happens below. A
  -- row an earlier event of this transaction already consumed is skipped.
  DELETE FROM smarter_private.ca_function_resolution_queue q WHERE q.id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- The same function created or altered again in this transaction: one
  -- check of what it is now.
  DELETE FROM smarter_private.ca_function_resolution_queue q WHERE q.fn_oid = NEW.fn_oid;

  -- Dropped again before COMMIT: nothing is being installed.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = NEW.fn_oid) THEN
    RETURN NULL;
  END IF;
  v_fn := NEW.fn_oid::regprocedure;

  SELECT string_agg(format('line %s: %s', c.lineno, c.message), '; ' ORDER BY c.lineno)
    INTO v_calls
    FROM smarter_private.fn_ca_unresolved_function_calls(v_fn) c;
  IF v_calls IS NULL THEN
    RETURN NULL;
  END IF;

  -- The override, honoured for the one transaction that set it. The marker
  -- is this transaction's id, so it cannot be carried into another one.
  IF current_setting('ca.function_resolution_override_in_force', true) = txid_current()::text THEN
    v_override := current_setting('ca.function_resolution_override_reason', true);
  ELSE
    v_override := nullif(btrim(coalesce(current_setting('ca.function_resolution_override', true), '')), '');
    v_switch := lower(coalesce(v_override, ''))
                IN ('on', 'off', 'true', 'false', 't', 'f', 'yes', 'no', 'y', 'n', '1', '0');
    IF v_override IS NOT NULL AND NOT v_switch THEN
      PERFORM set_config('ca.function_resolution_override_in_force', txid_current()::text, true);
      PERFORM set_config('ca.function_resolution_override_reason', v_override, true);
      -- Consumed: a session-level SET must not outlive this transaction.
      PERFORM set_config('ca.function_resolution_override', '', false);
    END IF;
  END IF;

  IF v_override IS NOT NULL AND NOT v_switch THEN
    INSERT INTO smarter_private.ca_function_resolution_overrides
      (txid, function_name, unresolved_calls, reason, session_role, application_name)
    VALUES
      (txid_current(), v_fn::text, v_calls, v_override, session_user::text, nullif(v_app, ''));
    RAISE WARNING 'function resolution override: % installed with calls that do not resolve (%). Reason: %',
      v_fn, v_calls, v_override;
    RETURN NULL;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '42883',
    MESSAGE = format('migration refused: %s calls a function that does not exist: %s', v_fn, v_calls),
    DETAIL  = 'A PL/pgSQL body is not resolved at CREATE, so this call would raise 42883 the first time it runs. '
           || 'On 2026-11-14 exactly that stopped two live mystery bounty MTTs (fn_mystery_bounty_seed calling '
           || 'fn_mystery_sealed_ladder_for_open with a numeric where bigint was declared). Nothing in this transaction was applied.',
    HINT    = CASE
      WHEN v_switch THEN format(
        'ca.function_resolution_override is %L, which is a switch, not a reason. Say why this call may not resolve yet.',
        v_override)
      ELSE
        'Fix the call: cast the argument to the declared type, or create the callee in this same migration '
        '(before any SET CONSTRAINTS ALL IMMEDIATE). Read any function''s findings with '
        'SELECT * FROM smarter_private.fn_ca_unresolved_function_calls(''<schema.fn(args)>''::regprocedure). '
        'Only if it must install unresolved: SET LOCAL ca.function_resolution_override = ''<why>''; in the same '
        'transaction, recorded in smarter_private.ca_function_resolution_overrides.'
    END;
END;
$fn$;

CREATE CONSTRAINT TRIGGER ca_function_calls_must_resolve
  AFTER INSERT ON smarter_private.ca_function_resolution_queue
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION smarter_private.fn_ca_function_calls_must_resolve();

-- ── 5. THE QUEUEING, AT EACH STATEMENT ────────────────────────────────────
CREATE OR REPLACE FUNCTION smarter_private.fn_ca_queue_function_for_resolution()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  obj record;
BEGIN
  BEGIN
    FOR obj IN
      SELECT c.objid, c.command_tag
        FROM pg_event_trigger_ddl_commands() c
       WHERE c.object_type IN ('function', 'procedure')
         AND c.schema_name IN ('public', 'smarter_private')
         AND NOT c.in_extension
    LOOP
      -- An earlier SET CONSTRAINTS ALL IMMEDIATE must not judge this one
      -- before the rest of the migration exists.
      SET CONSTRAINTS smarter_private.ca_function_calls_must_resolve DEFERRED;
      INSERT INTO smarter_private.ca_function_resolution_queue (fn_oid, command_tag)
      VALUES (obj.objid, obj.command_tag);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Fail open, loudly: see the header.
    RAISE WARNING 'fn_ca_queue_function_for_resolution could not queue (% %), so this command''s functions are not checked at COMMIT',
      SQLSTATE, SQLERRM;
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION smarter_private.fn_ca_unresolved_function_calls(regprocedure) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_function_calls_must_resolve() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_queue_function_for_resolution() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_function_resolution_overrides_are_append_only() FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS ca_function_calls_must_resolve_at_commit;
CREATE EVENT TRIGGER ca_function_calls_must_resolve_at_commit
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION', 'CREATE PROCEDURE', 'ALTER PROCEDURE', 'ALTER ROUTINE')
  EXECUTE FUNCTION smarter_private.fn_ca_queue_function_for_resolution();

-- ── 6. WHAT IS ALREADY LIVE: COUNTED, NEVER REFUSED ───────────────────────
-- The guard judges what a transaction installs, so legacy code cannot fail
-- this install. Bounded to 3 s, newest first (the full pass is 9.2 s; the
-- read-only query in the header lists all of them).
DO $audit$
DECLARE
  c_budget  CONSTANT interval := interval '3 seconds';
  v_started timestamptz := clock_timestamp();
  v_total   integer;
  v_audited integer := 0;
  v_with    integer := 0;
  r         record;
BEGIN
  SELECT count(*) INTO v_total
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
   WHERE n.nspname IN ('public', 'smarter_private')
     AND l.lanname = 'plpgsql'
     AND p.prokind IN ('f', 'p')
     AND p.prorettype NOT IN ('pg_catalog.trigger'::pg_catalog.regtype, 'pg_catalog.event_trigger'::pg_catalog.regtype);

  FOR r IN
    SELECT p.oid
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE n.nspname IN ('public', 'smarter_private')
       AND l.lanname = 'plpgsql'
       AND p.prokind IN ('f', 'p')
       AND p.prorettype NOT IN ('pg_catalog.trigger'::pg_catalog.regtype, 'pg_catalog.event_trigger'::pg_catalog.regtype)
     ORDER BY p.oid DESC
  LOOP
    EXIT WHEN clock_timestamp() - v_started > c_budget;
    v_audited := v_audited + 1;
    IF EXISTS (SELECT 1 FROM smarter_private.fn_ca_unresolved_function_calls(r.oid::regprocedure)) THEN
      v_with := v_with + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'function resolution audit: % of % plpgsql functions in public/smarter_private checked in % ms (newest first); % call a signature that does not exist. Not refused: the guard judges only what a transaction installs.',
    v_audited, v_total, round(extract(epoch FROM clock_timestamp() - v_started) * 1000), v_with;
END
$audit$;

COMMIT;
