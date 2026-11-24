-- 20261123072817_a_reporting_write_is_refused_with_its_money.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A REPORTING WRITE IS REFUSED WITH ITS MONEY
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. Club Data's reporting rows are
-- written by triggers inside the money transaction that causes them: a
-- wallet_transactions insert (buy-in, cash-out, rebuy, prize, wallet return)
-- fires ca_club_data_fact_wallet and ca_reporting_wallet_insert, and a
-- rake_records insert fires ca_club_data_fact_rake and ca_reporting_rake_insert.
-- Each upserts shared per-table and per-player daily rows (ca_club_data_fact,
-- ca_club_data_game_ct, club_table_daily, ca_club_table_player_daily). Every one
-- of those writes sits under an EXCEPTION WHEN OTHERS handler that logs a
-- WARNING and carries on, so a refusal that only says "not now" was turned into
-- a report that never happens. In the 24 hours to 2026-11-23 07:15 UTC:
--
--   92  "legacy Club Data projection: 55P03 canceling statement due to lock
--       timeout" (fn_ca_club_data_fact_put line 11), 90 of them under
--       trg_ca_club_data_fact_rake > atomic_distribute_rake >
--       fn_ca_bank_pending_cash_rake > fn_project_hand_side_effects, 2 under
--       trg_finish_hand_post_commit_obligations;
--   34  "Club Data rake rollup failed for row ...: canceling statement due to
--       lock timeout" (trg_ca_reporting_rake_insert), same stack;
--    2  deadlocks swallowed at 01:15 UTC (one legacy projection, one cash table
--       rollup), the buy-in against cash-out pair 20261123024433 fixed at its
--       cause. The 24 hours before held none.
--
-- Spread across every minute of the hour, not bunched at a rebuild.
--
-- THE CAUSE, BY LINE. fn_ca_bank_pending_cash_rake banks a stored hand rake
-- with "PERFORM set_config('lock_timeout', '250ms', true)" and answers
-- {status: busy} from its "WHEN lock_not_available" handler, leaving the
-- obligation stored for the next pass: its contract is that anything held
-- right now refuses the whole bank, and nothing is half-written. The rake
-- triggers run inside that call and inherit the 250ms. When a concurrent
-- buy-in, cash-out or another table's projection holds the same table's
-- game_ct / club_table_daily row or a multi-tabling player's fact row past
-- 250ms, the trigger's handler catches the 55P03 itself: the rake banks, its
-- Club Data rows do not, and the WARNING is all that is left. The money and
-- its report disagree for good (the legacy fact is flagged legacy_recorded =
-- false in ca_club_data_pacific_fact; club_table_daily is short until a
-- rebuild). The same handlers swallow a deadlock the same way.
--
-- THE FIX. Every one of the thirteen EXCEPTION WHEN OTHERS handlers in the
-- seven reporting functions now begins
--   IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;
-- the banker's own test for "retry can change this" (class 40 deadlock and
-- serialization, 53 resources, 57 operator, 08 connection, 55P03 lock not
-- available, 55006 object in use). Such a refusal now leaves the trigger and
-- refuses the money statement that fired it, exactly as a busy wallet row
-- does: the rake bank answers busy with nothing written and the hand's own
-- next pass banks the same stored obligation with its report; a wallet path
-- under no lock_timeout meets only a deadlock here, and a deadlock already
-- aborts that transaction on any other row it locks.
--
-- WHAT THE HANDLERS STILL GUARD. A deterministic reporting defect (a bad
-- cast, a constraint, a missing row a projection expected) is still logged
-- and contained: a defect in Club Data never refuses a buy-in, a cash-out, a
-- prize or a rake. That is the one thing they were for.
--
-- BUY-IN AGAINST BUY-IN. Two buy-ins write one wallet row each, and each
-- wallet row takes its rows in one fixed order: the player's fact row, then
-- the table's game row (ca_club_data_fact_wallet), then the player's daily
-- row, then the table's club_table_daily row (ca_reporting_wallet_insert,
-- which fires after it by name). Two buyers share only the two table rows and
-- take them in that order, so they can wait for each other and cannot cycle.
-- A rake bank walks its contributors in (club, player) order and can meet a
-- contributor's buy-in in the other order; it runs under the banker's 250ms,
-- far inside the one second Postgres waits before it looks for a deadlock, so
-- the rake is the side that answers busy and is banked again, and the buy-in
-- is never the one refused.
--
-- MONEY. Every amount, key and write is the same. A refused rake is the same
-- stored obligation banked on its next pass (fn_ca_bank_pending_cash_rake does
-- not count a busy answer as an attempt). Nothing reads is_horse.
--
-- Proof: scripts/dev/prove-reporting-and-seat-writers-take-one-order.sh
-- Law: tests/a-reporting-write-is-refused-with-its-money.law.test.ts
-- Changelog: docs/changelog/2026-11-23-reporting-and-seat-writers-take-one-order.md
--
-- HOW. Anchored edits of the live definitions. Each function's handler count
-- is asserted exactly, no other kind of handler may exist in it, and a body
-- already carrying the guard refuses; any mismatch aborts the whole file.
-- @probe-exempt: public.trg_ca_club_data_fact_rake is a trigger function and cannot be called directly; the plpgsql_check gate covers its body
-- @probe-exempt: public.trg_ca_reporting_rake_insert is a trigger function and cannot be called directly; the plpgsql_check gate covers its body
-- @probe-exempt: public.trg_ca_club_data_fact_wallet is a trigger function and cannot be called directly; the plpgsql_check gate covers its body
-- @probe-exempt: public.trg_ca_reporting_wallet_insert is a trigger function and cannot be called directly; the plpgsql_check gate covers its body
-- @live-proof: (SELECT count(*) = 7 AND bool_and((length(d) - length(replace(d, 'EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;', ''))) / length('EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;') = (length(d) - length(replace(d, 'EXCEPTION WHEN', ''))) / length('EXCEPTION WHEN') AND position('EXCEPTION WHEN' IN d) > 0) FROM (SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.oid IN ('public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz)'::regprocedure, 'public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz)'::regprocedure, 'public.fn_ca_club_data_pacific_cash_register(uuid)'::regprocedure, 'public.trg_ca_club_data_fact_rake()'::regprocedure, 'public.trg_ca_reporting_rake_insert()'::regprocedure, 'public.trg_ca_club_data_fact_wallet()'::regprocedure, 'public.trg_ca_reporting_wallet_insert()'::regprocedure)) q)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- (1) The shared fact writer both the wallet and the rake triggers call.
DO $fact_put$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz)'::regprocedure);
  v_old text := $o$EXCEPTION WHEN OTHERS THEN$o$;
  v_new text := $r$EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;$r$;
BEGIN
  IF position('bank_refusal_is_transient(SQLSTATE)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_ca_club_data_fact_put already re-raises a concurrency refusal: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 3 THEN
    RAISE EXCEPTION 'fn_ca_club_data_fact_put was expected to hold exactly three WHEN OTHERS handlers';
  END IF;
  IF position('EXCEPTION WHEN' IN replace(v_def, v_old, '')) > 0 THEN
    RAISE EXCEPTION 'fn_ca_club_data_fact_put holds a handler this edit does not cover: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fact_put$;

-- (2) The shared hand-count writer the rake trigger calls.
DO $hand_put$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz)'::regprocedure);
  v_old text := $o$EXCEPTION WHEN OTHERS THEN$o$;
  v_new text := $r$EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;$r$;
BEGIN
  IF position('bank_refusal_is_transient(SQLSTATE)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_ca_club_data_hand_put already re-raises a concurrency refusal: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 3 THEN
    RAISE EXCEPTION 'fn_ca_club_data_hand_put was expected to hold exactly three WHEN OTHERS handlers';
  END IF;
  IF position('EXCEPTION WHEN' IN replace(v_def, v_old, '')) > 0 THEN
    RAISE EXCEPTION 'fn_ca_club_data_hand_put holds a handler this edit does not cover: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$hand_put$;

-- (3) The Pacific cash record the rake trigger registers first.
DO $cash_register$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_club_data_pacific_cash_register(uuid)'::regprocedure);
  v_old text := $o$EXCEPTION WHEN OTHERS THEN$o$;
  v_new text := $r$EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;$r$;
BEGIN
  IF position('bank_refusal_is_transient(SQLSTATE)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_ca_club_data_pacific_cash_register already re-raises a concurrency refusal: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_club_data_pacific_cash_register was expected to hold exactly one WHEN OTHERS handler';
  END IF;
  IF position('EXCEPTION WHEN' IN replace(v_def, v_old, '')) > 0 THEN
    RAISE EXCEPTION 'fn_ca_club_data_pacific_cash_register holds a handler this edit does not cover: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$cash_register$;

-- (4) The rake's Club Data fact trigger (the 90 lost legacy facts).
DO $rake_fact$
DECLARE
  v_def text := pg_get_functiondef('public.trg_ca_club_data_fact_rake()'::regprocedure);
  v_old text := $o$EXCEPTION WHEN OTHERS THEN$o$;
  v_new text := $r$EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;$r$;
BEGIN
  IF position('bank_refusal_is_transient(SQLSTATE)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'trg_ca_club_data_fact_rake already re-raises a concurrency refusal: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 2 THEN
    RAISE EXCEPTION 'trg_ca_club_data_fact_rake was expected to hold exactly two WHEN OTHERS handlers';
  END IF;
  IF position('EXCEPTION WHEN' IN replace(v_def, v_old, '')) > 0 THEN
    RAISE EXCEPTION 'trg_ca_club_data_fact_rake holds a handler this edit does not cover: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$rake_fact$;

-- (5) The rake's table rollup trigger (the 34 lost club_table_daily rakes).
DO $rake_rollup$
DECLARE
  v_def text := pg_get_functiondef('public.trg_ca_reporting_rake_insert()'::regprocedure);
  v_old text := $o$EXCEPTION WHEN OTHERS THEN$o$;
  v_new text := $r$EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;$r$;
BEGIN
  IF position('bank_refusal_is_transient(SQLSTATE)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'trg_ca_reporting_rake_insert already re-raises a concurrency refusal: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'trg_ca_reporting_rake_insert was expected to hold exactly one WHEN OTHERS handler';
  END IF;
  IF position('EXCEPTION WHEN' IN replace(v_def, v_old, '')) > 0 THEN
    RAISE EXCEPTION 'trg_ca_reporting_rake_insert holds a handler this edit does not cover: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$rake_rollup$;

-- (6) The wallet's Club Data fact trigger.
DO $wallet_fact$
DECLARE
  v_def text := pg_get_functiondef('public.trg_ca_club_data_fact_wallet()'::regprocedure);
  v_old text := $o$EXCEPTION WHEN OTHERS THEN$o$;
  v_new text := $r$EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;$r$;
BEGIN
  IF position('bank_refusal_is_transient(SQLSTATE)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'trg_ca_club_data_fact_wallet already re-raises a concurrency refusal: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'trg_ca_club_data_fact_wallet was expected to hold exactly one WHEN OTHERS handler';
  END IF;
  IF position('EXCEPTION WHEN' IN replace(v_def, v_old, '')) > 0 THEN
    RAISE EXCEPTION 'trg_ca_club_data_fact_wallet holds a handler this edit does not cover: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$wallet_fact$;

-- (7) The wallet's table and player rollup trigger.
DO $wallet_rollup$
DECLARE
  v_def text := pg_get_functiondef('public.trg_ca_reporting_wallet_insert()'::regprocedure);
  v_old text := $o$EXCEPTION WHEN OTHERS THEN$o$;
  v_new text := $r$EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;$r$;
BEGIN
  IF position('bank_refusal_is_transient(SQLSTATE)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'trg_ca_reporting_wallet_insert already re-raises a concurrency refusal: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 2 THEN
    RAISE EXCEPTION 'trg_ca_reporting_wallet_insert was expected to hold exactly two WHEN OTHERS handlers';
  END IF;
  IF position('EXCEPTION WHEN' IN replace(v_def, v_old, '')) > 0 THEN
    RAISE EXCEPTION 'trg_ca_reporting_wallet_insert holds a handler this edit does not cover: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$wallet_rollup$;

-- Every handler of the seven now opens with the guard, and the banker's test
-- still says what it said when this was written.
DO $verify_reporting$
DECLARE
  v_guard text := $g$EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;$g$;
  v_sig regprocedure;
  v_def text;
  v_total integer := 0;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz)'::regprocedure,
    'public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz)'::regprocedure,
    'public.fn_ca_club_data_pacific_cash_register(uuid)'::regprocedure,
    'public.trg_ca_club_data_fact_rake()'::regprocedure,
    'public.trg_ca_reporting_rake_insert()'::regprocedure,
    'public.trg_ca_club_data_fact_wallet()'::regprocedure,
    'public.trg_ca_reporting_wallet_insert()'::regprocedure]
  LOOP
    v_def := pg_get_functiondef(v_sig);
    IF (length(v_def) - length(replace(v_def, v_guard, ''))) / length(v_guard)
       <> (length(v_def) - length(replace(v_def, 'EXCEPTION WHEN', ''))) / length('EXCEPTION WHEN') THEN
      RAISE EXCEPTION 'a reporting handler in % did not take the guard', v_sig;
    END IF;
    v_total := v_total + (length(v_def) - length(replace(v_def, v_guard, ''))) / length(v_guard);
  END LOOP;
  IF v_total <> 13 THEN
    RAISE EXCEPTION 'expected the guard on 13 reporting handlers, found %', v_total;
  END IF;
  IF NOT (smarter_private.bank_refusal_is_transient('55P03') AND smarter_private.bank_refusal_is_transient('40P01')
          AND NOT smarter_private.bank_refusal_is_transient('22P02') AND NOT smarter_private.bank_refusal_is_transient('23505')) THEN
    RAISE EXCEPTION 'smarter_private.bank_refusal_is_transient no longer separates a busy row from a defect';
  END IF;
END
$verify_reporting$;

-- @probe-for: public.fn_ca_club_data_fact_put
DO $probe_fact_put$
BEGIN
  -- A zero fact for a club, game and player that do not exist: the edited
  -- body runs every block to its end and writes nothing anyone reads.
  PERFORM public.fn_ca_club_data_fact_put(gen_random_uuid(), current_date, 'CASH', gen_random_uuid(),
                                          gen_random_uuid(), 0, 0, 0, 0, now());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_fact_put$;

-- @probe-for: public.fn_ca_club_data_hand_put
DO $probe_hand_put$
BEGIN
  -- A hand at a club and table that do not exist.
  PERFORM public.fn_ca_club_data_hand_put(gen_random_uuid(), gen_random_uuid(), now());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_hand_put$;

-- @probe-for: public.fn_ca_club_data_pacific_cash_register
DO $probe_cash_register$
BEGIN
  -- A rake record that does not exist has no parts and registers nothing.
  PERFORM public.fn_ca_club_data_pacific_cash_register(gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_cash_register$;

COMMIT;
