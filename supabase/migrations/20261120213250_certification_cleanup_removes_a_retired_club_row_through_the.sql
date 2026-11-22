-- 20261120213250_certification_cleanup_removes_a_retired_club_row_through_the.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT WAS WRONG, READ FROM ROWS (2026-11-20 21:30 UTC):
--
--   The operator-run Cert Residue Sweep (run on 2026-11-20 21:28 UTC) left 7 of
--   26 stale certification identities unrecovered. Six refused with
--     55000 CLUB_RETIRED: gameplay and cashier records are read-only
--   from public.cleanup_reserved_certification_account. Each of them is a
--   ca-customization-cert-postdeploy-*@example.invalid identity with NO chip
--   ledger history (so it reaches the door's final, full-removal branch) that
--   still holds a zero-balance 'player' row in a RETIRED Cert RH / Cert HU club
--   (for example 00205f11 in Cert RH 07824486, 62c3ecf6 in Cert RH 30066247).
--
--   The door's retained-ledger-actor branch already removes exactly that row
--   through the narrowly opened app.club_retirement_maintenance gate. The final
--   branch never got the same treatment: it ran a bare
--     DELETE FROM public.club_members WHERE user_id = p_user_id;
--   which the retired-club guard correctly refuses, rolling the whole removal
--   back. Every sweep therefore refused the same identities again.
--
-- THE FIX (the line that produced the refusal is the line changed):
--
--   In the final branch, the zero-balance 'player' rows of RETIRED clubs are
--   removed first, through the same gate, opened for that one statement and
--   closed again before anything else runs (and on any error). The plain
--   delete that follows then only meets rows of live clubs, exactly as before.
--   A non-zero row in a retired club is not matched by the gated delete and is
--   still refused by the guard: money in a retired club is never removed here.
--
-- Preimage: the function as installed by 20261114163238 (md5 below, read live
-- 2026-11-20). A function changed since then is a different decision; refuse.
-- Pinned by tests/unit/certificationCleanupRetiredClubRow.test.ts.
--
-- @live-proof: position('v_previous_final_retirement_maintenance' IN pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '60s';

DO $door$
DECLARE
  c_old constant text :=
       E'  DELETE FROM public.challenge_streak_state WHERE user_id = p_user_id;\n'
    || E'  DELETE FROM public.club_members WHERE user_id = p_user_id;\n';
  c_new constant text :=
       E'  DELETE FROM public.challenge_streak_state WHERE user_id = p_user_id;\n'
    || E'  -- A zero-balance player row of a RETIRED club is removed through the\n'
    || E'  -- retirement gate, opened for this one statement (20261120213250).\n'
    || E'  DECLARE\n'
    || E'    v_previous_final_retirement_maintenance text :=\n'
    || E'      current_setting(''app.club_retirement_maintenance'', true);\n'
    || E'  BEGIN\n'
    || E'    PERFORM set_config(''app.club_retirement_maintenance'', ''on'', true);\n'
    || E'    DELETE FROM public.club_members WHERE user_id = p_user_id\n'
    || E'      AND role = ''player''\n'
    || E'      AND EXISTS (SELECT 1 FROM public.clubs rc WHERE rc.id = club_members.club_id AND rc.lifecycle_status = ''retired'')\n'
    || E'      AND COALESCE(chip_balance, 0) = 0 AND COALESCE(promo_balance, 0) = 0\n'
    || E'      AND COALESCE(held_chips, 0) = 0 AND COALESCE(locked_chips, 0) = 0;\n'
    || E'    PERFORM set_config(''app.club_retirement_maintenance'', COALESCE(v_previous_final_retirement_maintenance, ''''), true);\n'
    || E'  EXCEPTION WHEN OTHERS THEN\n'
    || E'    PERFORM set_config(''app.club_retirement_maintenance'', COALESCE(v_previous_final_retirement_maintenance, ''''), true);\n'
    || E'    RAISE;\n'
    || E'  END;\n'
    || E'  DELETE FROM public.club_members WHERE user_id = p_user_id;\n';
  v_def text := pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure);
BEGIN
  IF md5(v_def) IS DISTINCT FROM '31f1f64019f3869630a2de7dcdcd8dde' THEN
    RAISE EXCEPTION 'CERTIFICATION_RETIRED_ROW_PREIMAGE_CHANGED';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'CERTIFICATION_RETIRED_ROW_PATCH_MISMATCH';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
  IF position('v_previous_final_retirement_maintenance' IN
       pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CERTIFICATION_RETIRED_ROW_INSTALL_MISMATCH';
  END IF;
END
$door$;

-- The patched door runs once on a stale identity of exactly the refused shape
-- (no ledger history, a zero-balance player row in a retired club) and must
-- succeed; the subtransaction is always undone. With no such identity left it
-- still executes the new body on an absent id.
-- @probe-for: public.cleanup_reserved_certification_account
DO $probe$
DECLARE
  v_id uuid;
  v_res jsonb;
BEGIN
  SELECT u.id INTO v_id
    FROM auth.users u
   WHERE u.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
     AND NOT EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.performed_by = u.id)
     AND EXISTS (
       SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
        WHERE m.user_id = u.id AND m.role = 'player' AND c.lifecycle_status = 'retired'
          AND COALESCE(m.chip_balance, 0) = 0 AND COALESCE(m.promo_balance, 0) = 0
          AND COALESCE(m.held_chips, 0) = 0 AND COALESCE(m.locked_chips, 0) = 0)
   ORDER BY u.created_at
   LIMIT 1;
  v_res := public.cleanup_reserved_certification_account(COALESCE(v_id, gen_random_uuid()));
  IF v_id IS NOT NULL AND (v_res->>'success') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'CERTIFICATION_RETIRED_ROW_PROBE_REFUSED %', v_res USING ERRCODE = 'P0002';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
