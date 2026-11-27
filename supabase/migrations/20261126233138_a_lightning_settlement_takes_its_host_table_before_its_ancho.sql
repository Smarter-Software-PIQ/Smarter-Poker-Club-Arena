-- 20261126233138_a_lightning_settlement_takes_its_host_table_before_its_ancho.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A LIGHTNING SETTLEMENT TAKES ITS HOST TABLE BEFORE ITS ANCHORS
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. Three of the six "deadlock detected"
-- lines in the 24 hours to 2026-11-26 21:45 UTC were one cycle:
--
--   2026-11-25 23:09:10.962 fn_cashout_seat_occupancy   (seat FOR UPDATE)
--   2026-11-26 02:54:41.608 fn_cashout_seat_occupancy   (seat FOR UPDATE)
--   2026-11-26 21:29:36.981 fn_cash_seat_sitout          (seat FOR UPDATE)
--
-- each against fn_lightning_settle_hand. For 23:09:10 the Lightning hand
-- (f5cb68a0) was settling on host table bd52ccec, the very table the cash-out
-- was leaving.
--
-- THE CAUSE, BY LINE (live definitions read 2026-11-26).
--   cash-out  fn_cashout_seat_occupancy: tables (its table) FOR NO KEY UPDATE,
--             then the seat FOR UPDATE (20261123024433, THE TABLE BEFORE THE
--             SEAT).
--   sit out   fn_cash_seat_sitout: tables FOR NO KEY UPDATE, then the seat
--             FOR UPDATE (20261123024034).
--   settle    fn_lightning_settle_hand step 5 (line 249): every anchor seat
--             FOR UPDATE in seat order, then line 341
--             fn_ca_commit_hand_settlement -> fn_ca_commit_hand_settlement_
--             exact_before_obligations line 102: the HOST tables row
--             FOR UPDATE.
-- A cash-out or sit-out of an anchor at the host table holds the table and
-- waits for the anchor's seat; the settlement holds that seat and waits for
-- the table. 20261123072823 (EVERY CASH SEAT WRITER TAKES ITS TABLE FIRST)
-- listed "the hand settlement locks seats and never the table"; the Lightning
-- settlement does take its host table, through the shared commit core, so it
-- was the one seat-first writer left on a cash table.
--
-- THE FIX. Inside step 5's BEGIN block, before the first anchor, take the host
-- tables row FOR UPDATE: the same row, in the same mode, the commit core takes
-- later (so that later lock is re-entrant and never an upgrade). The order is
-- now matcher gate (shared), instance, host table, anchors, pool slots and
-- sessions, commit. Feeder tables are unchanged: the settlement never locks a
-- feeder's tables row, so a feeder cash-out (its table, then its seat) has no
-- second edge with it. Inside the BEGIN block, a PLT03/PLT04 rollback to the
-- block's savepoint releases the table with the anchors, exactly as before.
--
-- WHY NO OUTCOME CHANGES. Only the moment one row lock is taken moves. Every
-- amount, delta, rake, receipt, marker and refusal is the same; nothing reads
-- is_horse, closes a game, moves a seat or touches a wallet.
--
-- HOW. An anchored edit of the live definition: the needle must occur exactly
-- once or the whole file aborts and nothing changes. CREATE OR REPLACE keeps
-- the ACL; the edit block compares it with the one read before the edit
-- (live 2026-11-26: {postgres=X/postgres,service_role=X/postgres}).
--
-- Law: tests/a-lightning-settlement-takes-its-host-table-before-its-anchors.law.test.ts
-- Changelog: docs/changelog/2026-11-26-db-contention.md
-- @live-proof: (SELECT pg_get_functiondef('public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)'::regprocedure) LIKE E'%THE HOST TABLE BEFORE ANY ANCHOR (20261126233138)%PERFORM 1 FROM public.tables WHERE id = p_host_table_id FOR UPDATE;%-- 5. THE ANCHORS, FOR UPDATE, IN SEAT ORDER%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $settle_takes_its_host_table_first$
DECLARE
  v_fn regprocedure := 'public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)'::regprocedure;
  v_def text := pg_get_functiondef('public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)'::regprocedure);
  v_acl text := (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)'::regprocedure);
  -- Literals on purpose: the text is what this file inserts, never a lock this
  -- DO block takes (scripts/ci/check-migration-hot-row-locks.mjs masks literals).
  v_old text := E'  BEGIN\n    -- 5. THE ANCHORS, FOR UPDATE, IN SEAT ORDER, each named in the marker\n';
  v_new text := E'  BEGIN\n    -- THE HOST TABLE BEFORE ANY ANCHOR (20261126233138). The commit core\n    -- (fn_ca_commit_hand_settlement_exact_before_obligations) takes this\n    -- row FOR UPDATE; a cash-out or sit-out takes it before its seat. Taken\n    -- here, in the same mode, the anchors below never hold a seat while a\n    -- table writer waits for it (deadlocks 2026-11-25 23:09, 11-26 02:54\n    -- and 21:29).\n    PERFORM 1 FROM public.tables WHERE id = p_host_table_id FOR UPDATE;\n\n    -- 5. THE ANCHORS, FOR UPDATE, IN SEAT ORDER, each named in the marker\n';
BEGIN
  IF position('THE HOST TABLE BEFORE ANY ANCHOR' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_lightning_settle_hand already takes its host table first: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_lightning_settle_hand anchor-loop anchor was expected exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF (SELECT proacl::text FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM v_acl THEN
    RAISE EXCEPTION 'fn_lightning_settle_hand grants changed';
  END IF;
END
$settle_takes_its_host_table_first$;

-- @probe-for: public.fn_lightning_settle_hand
DO $probe_settle$
DECLARE v_r jsonb;
BEGIN
  v_r := public.fn_lightning_settle_hand(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    'migration-probe', gen_random_uuid(), '[]'::jsonb, 0, 0, '{}'::jsonb);
  IF v_r ->> 'ok' IS DISTINCT FROM 'false'
     OR v_r ->> 'reason' IS DISTINCT FROM 'hand_not_found' THEN
    RAISE EXCEPTION 'fn_lightning_settle_hand probe expected hand_not_found, got %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_settle$;

DO $verify_settle$
DECLARE
  v_table int := position('PERFORM 1 FROM public.tables WHERE id = p_host_table_id FOR UPDATE'
    IN pg_get_functiondef('public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)'::regprocedure));
  v_anchor int := position('INTO s FROM public.table_seats ts WHERE ts.id = a.seat_id FOR UPDATE'
    IN pg_get_functiondef('public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)'::regprocedure));
BEGIN
  IF v_table = 0 OR v_anchor = 0 OR v_table > v_anchor
     OR has_function_privilege('anon', 'public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_lightning_settle_hand does not take its host table before its first anchor, or a browser role can call it';
  END IF;
END
$verify_settle$;

COMMIT;
