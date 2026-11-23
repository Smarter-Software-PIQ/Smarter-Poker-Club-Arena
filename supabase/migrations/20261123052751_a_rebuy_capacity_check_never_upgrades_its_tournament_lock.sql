-- 20261123052751_a_rebuy_capacity_check_never_upgrades_its_tournament_lock.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A REBUY'S CAPACITY CHECK NEVER UPGRADES ITS TOURNAMENT LOCK
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. A tournament hand commit
-- (fn_ca_commit_hand_submission -> fn_ca_commit_hand_settlement line 337 ->
-- fn_ca_commit_hand_settlement_exact_before_obligations line 96) and a rebuy
-- (process_tournament_rebuy) deadlocked at 05:18:06.555 UTC on 2026-11-23.
-- Postgres cancelled the hand commit; it retried and committed at 05:18:06.855.
-- The commit's side:
--
--   while locking tuple (85193,81) in relation "tables"
--   SELECT t.tournament_id FROM public.tables t WHERE t.id = p_table_id FOR UPDATE
--
-- The rebuy (tournament a915f2e3, its candidate committed 'rebought' at
-- 05:18:06.577, 22 ms after the deadlock) re-entered a seatless horse whose
-- knockout candidate sat at table 0753917c, the table the hand belonged to.
--
-- THE CAUSE, BY LINE. The two transactions take the same two rows in the same
-- order (tournament, then table). The cycle is a lock UPGRADE on the
-- tournament row:
--   commit  line 84-87:  tournaments FOR KEY SHARE
--           line 96-99:  tables (its table) FOR UPDATE           <- waited
--   rebuy   fn_ca_lock_tournament_rebuy_acquisition line 57-59:
--                        tournaments FOR NO KEY UPDATE (compatible with the
--                        commit's KEY SHARE)
--           line 64-68:  tables (the candidate's table) FOR UPDATE
--           fn_ca_choose_tournament_seat_locked line 15 ->
--           fn_ensure_late_registration_capacity(p_tournament_id,0) line 30-32:
--                        tournaments FOR UPDATE                  <- waited
-- FOR UPDATE is the one row lock that conflicts with KEY SHARE, so the rebuy,
-- already holding the tournament row NO KEY UPDATE and the commit's table,
-- waited for the commit's KEY SHARE, while the commit waited for the table.
-- This is the cycle PR #11476 (alert 445924) diagnosed on 2026-11-19; that PR
-- never merged, and the live function is still its pre-image
-- (md5 a539fd43bb2992f8d75253f2d7a4dd7c).
--
-- THE FIX. fn_ensure_late_registration_capacity takes the tournament row FOR
-- NO KEY UPDATE, the mode every caller's lane root already holds, so a caller
-- never upgrades it. The function never deletes a tournament and never
-- changes a key column of one (it reads the row and inserts tables,
-- receipts and a wake), so FOR UPDATE bought only one thing: waiting for
-- KEY SHARE holders. NO KEY UPDATE still conflicts with NO KEY UPDATE, so two
-- capacity checks, and every lane root that takes the row NO KEY UPDATE or
-- FOR UPDATE, still serialise against it exactly as before.
--
-- WHY NO OUTCOME CHANGES. The only KEY SHARE holders it stops waiting for are
-- hand commits and hand restores, which write their table's seats atomically
-- and read nothing the capacity check writes. Not waiting for one gives
-- the result of the capacity check running just before that hand began, an
-- order that already happens whenever the hand starts a moment later. Every
-- path that creates a tournament table or seats a tournament player either
-- takes the tournament row NO KEY UPDATE or stronger (fn_move_tournament_player,
-- fn_seat_stage_entitlement, the rebuy and registration roots), or runs this
-- check itself (fn_seat_late_registrant_before_maintenance_gate). No amount,
-- chip count, payment, seat choice rule or finishing place is touched.
--
-- The edit is the one token PR #11476 changed, byte for byte, so the
-- post-image md5 is c142f16547e8cde3ba10338c2bf6e6e4, the post-image #11476's
-- migration treats as already installed.
--
-- Nothing here moves or prices money, seats anyone or reads is_horse.
--
-- Proof: scripts/dev/prove-a-rebuy-capacity-check-never-upgrades-its-tournament-lock.sh
-- Law: tests/a-rebuy-capacity-check-never-upgrades-its-tournament-lock.law.test.ts
-- Changelog: docs/changelog/2026-11-23-a-rebuy-capacity-check-never-upgrades-its-tournament-lock.md
--
-- HOW. An anchored edit of the live definition: the needle must occur exactly
-- once or the whole file aborts and nothing changes.
-- @live-proof: (SELECT pg_get_functiondef('public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure) LIKE E'%WHERE t.id=p_tournament_id\n   FOR NO KEY UPDATE;%' AND pg_get_functiondef('public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure) NOT LIKE E'%WHERE t.id=p_tournament_id\n   FOR UPDATE;%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $capacity_keeps_the_root_lock$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure);
  v_old text := $o$  SELECT * INTO v_t
    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR UPDATE;$o$;
  v_new text := $r$  SELECT * INTO v_t
    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR NO KEY UPDATE;$r$;
BEGIN
  IF position(v_new IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_ensure_late_registration_capacity already takes the tournament row FOR NO KEY UPDATE: re-read before editing';
  END IF;
  IF position('DELETE FROM public.tournaments' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_ensure_late_registration_capacity deletes a tournament; it needs FOR UPDATE';
  END IF;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'fn_ensure_late_registration_capacity tournament lock anchor was expected exactly once';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$capacity_keeps_the_root_lock$;

-- @probe-for: public.fn_ensure_late_registration_capacity
DO $probe_capacity$
BEGIN
  BEGIN
    PERFORM public.fn_ensure_late_registration_capacity(gen_random_uuid(), 0);
    RAISE EXCEPTION 'CAPACITY_PROBE_FOUND_A_TOURNAMENT';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'Tournament not found' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_capacity$;

DO $verify_capacity$
BEGIN
  IF position(E'WHERE t.id=p_tournament_id\n   FOR NO KEY UPDATE' IN pg_get_functiondef('public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure))=0
     OR position(E'WHERE t.id=p_tournament_id\n   FOR UPDATE' IN pg_get_functiondef('public.fn_ensure_late_registration_capacity(uuid,integer)'::regprocedure))>0
     OR has_function_privilege('anon', 'public.fn_ensure_late_registration_capacity(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ensure_late_registration_capacity(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the capacity check tournament lock did not install as NO KEY UPDATE, or a browser role can call it';
  END IF;
END
$verify_capacity$;

COMMIT;
