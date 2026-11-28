-- 20261119235115_a_rebuy_never_upgrades_its_tournament_row_lock
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-19 23:51:15 UTC.
--
-- A REBUY NEVER UPGRADES ITS TOURNAMENT ROW LOCK (Production Alerts, store
-- rows 445924 DatabaseDeadlocksElevated, 445928 and 445931
-- tournament.real_time_payout_refused 40P01).
--
-- WHAT HAPPENED, READ FROM THE POSTGRES LOG (2026-11-19 23:02-23:29 UTC).
-- Nine `deadlock detected` errors, every one the same cycle:
--   victim  process_tournament_rebuy (line 599)
--             -> fn_ca_choose_tournament_seat_locked (line 15)
--             -> fn_ensure_late_registration_capacity (line 29)
--             "SELECT * FROM public.tournaments t WHERE t.id=... FOR UPDATE"
--   other   fn_ca_commit_hand_submission -> fn_ca_commit_hand_settlement
--             -> ... -> fn_ca_settle_hand_stacks_absolute (line 209)
--             "SELECT ... FROM public.tournaments t ... FOR SHARE"
--   (and fn_ca_retain_hand_submission line 71, FOR SHARE, queued behind).
-- Tournaments 1b630c53 and ed11d658. Two of the victims were the
-- at-bust real-time payout (financial_alerts 768233a8, 04e68f2d), which the
-- terminal settlement still owes; nothing was lost, but a player was not paid
-- at the moment of the bust and every hand of the table waited ~1-2 s.
--
-- THE CAUSE. The shared rebuy lane's seat root
-- (fn_ca_lock_tournament_rebuy_acquisition, 20261118191946) locks the
-- tournament row FOR NO KEY UPDATE - deliberately not FOR UPDATE, so the
-- foreign-key checks of every hand commit of the event (FOR KEY SHARE on the
-- same row) are not paused by a rebuy. A seatless rebuy (v_live_count = 0)
-- then chooses its chair through fn_ensure_late_registration_capacity, which
-- asks for the SAME row FOR UPDATE. That is a lock UPGRADE: FOR UPDATE
-- conflicts with FOR KEY SHARE, which NO KEY UPDATE let a hand commit take
-- in the meantime. The hand then asks for the row FOR SHARE, which conflicts
-- with the rebuy's NO KEY UPDATE. Rebuy waits on hand, hand waits on rebuy.
-- Thirteen production functions take this row FOR NO KEY UPDATE before they
-- can reach the capacity check (the rebuy root, the late-registration lane,
-- busts, moves, bounty collection among them), so every one of them carried
-- the same upgrade.
--
-- THE FIX. fn_ensure_late_registration_capacity locks the tournament row
-- FOR NO KEY UPDATE. A caller that already holds NO KEY UPDATE is granted it
-- at once and never waits; every capacity check is still serialised against
-- every other (NO KEY UPDATE conflicts with itself); the function changes no
-- key column of the row and deletes nothing, which is the only thing FOR
-- UPDATE adds. The only behaviour it gives up is blocking other
-- transactions' foreign-key inserts that reference the tournament while it
-- counts - and a row it could not see before commit is the same row either
-- way (READ COMMITTED, one snapshot per statement), so the count is
-- unchanged. One line of the body changes; nothing else.
--
-- PROOF. scripts/ci/test-rebuy-capacity-lock-order.py, on a throwaway
-- PostgreSQL cluster with the exact production pre-image (md5-checked):
-- before this file, a session holding the row FOR NO KEY UPDATE, a hand
-- holding FOR KEY SHARE and then asking FOR SHARE, and the capacity call
-- reproduce 40P01; after it, the capacity call returns at once, the hand
-- proceeds when the rebuy commits, and no deadlock is logged. Gate:
-- .github/workflows/rebuy-capacity-lock-order.yml and
-- tests/a-capacity-check-never-upgrades-the-tournament-lock.law.test.ts.
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only (owner, ACL, SECURITY
-- DEFINER and search_path are preserved by CREATE OR REPLACE): no table or
-- row lock, no install window, one transaction, one schema reload.
--
-- @live-proof: md5(pg_get_functiondef('public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure)) = 'c142f16547e8cde3ba10338c2bf6e6e4'

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure);
  v_old text := E'  SELECT * INTO v_t\n    FROM public.tournaments t\n   WHERE t.id=p_tournament_id\n   FOR UPDATE;\n';
  v_new text := E'  SELECT * INTO v_t\n    FROM public.tournaments t\n   WHERE t.id=p_tournament_id\n   FOR NO KEY UPDATE;\n';
BEGIN
  IF md5(v_def) = 'c142f16547e8cde3ba10338c2bf6e6e4' THEN
    RETURN;  -- already installed
  END IF;
  IF md5(v_def) IS DISTINCT FROM 'a539fd43bb2992f8d75253f2d7a4dd7c' THEN
    RAISE EXCEPTION 'capacity lock order: fn_ensure_late_registration_capacity is not the qualified pre-image (md5 %)', md5(v_def);
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'capacity lock order: expected exactly one tournament row lock to change';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$m$;

DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure))
     IS DISTINCT FROM 'c142f16547e8cde3ba10338c2bf6e6e4' THEN
    RAISE EXCEPTION 'capacity lock order: post-image differs';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ensure_late_registration_capacity(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ensure_late_registration_capacity(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'capacity lock order: browser roles gained EXECUTE';
  END IF;
END
$post$;

COMMIT;
