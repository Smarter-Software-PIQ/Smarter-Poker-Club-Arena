-- 20261119141104_a_deadlocked_hand_settlement_is_the_retryable_rolled_back_en.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A DEADLOCKED HAND SETTLEMENT IS THE RETRYABLE ROLLED-BACK ENVELOPE
-- (production alerts 258600, 267092; incident hand-commit-inner-deadlock)
--
-- WHAT HAPPENED
--
-- 2026-10-19 14:37:29Z, table 596f82eb hand #39888785, and 2026-10-22
-- 20:04:21Z, table 1aa2ab60 hand #44324262: the engine's ONE atomic hand
-- commit came back "atomic hand commit refused (rolled_back): deadlock
-- detected" (attempts 1, retry_budget 0). Each hand then waited for the
-- startup resume door (#39888785 was accepted 16 minutes later, 14:53:57Z)
-- instead of being retried at once by the live path. 16 earlier receipts carry
-- the same text (2026-10-01 and 2026-10-06).
--
-- THE LINE
--
-- fn_ca_settle_hand_stacks_absolute runs the seat writes inside its own
-- BEGIN ... EXCEPTION WHEN OTHERS block. A deadlock (40P01), a serialization
-- failure (40001) or a lock timeout (55P03) there rolls its subtransaction back
-- and is RETURNED as {success:false, reason:'rolled_back', sqlstate:...}.
-- fn_ca_commit_hand_settlement_before_lease_generation passed that object up
-- unchanged:
--
--     IF coalesce((v_stack_result->>'success')::boolean,false) IS NOT TRUE THEN
--       RETURN v_stack_result || jsonb_build_object('atomic_hand_commit',false);
--
-- so the caller never saw the canonical rolled-back envelope that the same
-- function's own handler builds for every other failure in that block
-- ({reason:'atomic_hand_rolled_back', sqlstate, commit_hash}). The engine
-- (server/src/services/supabase/handHistory.ts, the "confirmed atomic hand
-- rollback" branch) retries ONLY that envelope, and only for 40001 / 40P01 /
-- 55P03, so a lock conflict that happened one function deeper was thrown as a
-- deterministic refusal and the table's hand was parked.
--
-- THE FIX
--
-- A transient inner refusal is re-raised with its own SQLSTATE inside the same
-- block, so the block's existing handler rolls back everything the block did
-- (the tournament row locks taken just before) and returns the canonical
-- envelope with the commit hash. Nothing else changes:
--   * a non-transient inner refusal (conservation, negative stack, a code
--     defect) is still returned exactly as before;
--   * fn_ca_commit_hand_submission records the canonical failure exactly as it
--     already does for a deadlock anywhere else in the block;
--   * fn_ca_resume_hand_submission already treats 55P03/40001/40P01 as "not
--     the hand's one financial attempt" whatever the reason text;
--   * the engine's existing two bounded rollback retries (250 ms, 1 s) apply,
--     under the same lease re-check; a retry replays an idempotent request
--     (hand_atomic_commits is keyed by table and hand, payload-hash checked).
--
-- No money is written and no table is locked: one function body is replaced in
-- place (owner, ACL, SECURITY DEFINER and search_path are kept by CREATE OR
-- REPLACE). The preimage is the production definition read on 2026-11-19
-- (md5 b49192e78f472d7a931bcf20de46a702, also pinned by 20261116230906).
-- smarter_private.original_hand_correction_sources_match() already reads
-- false on production (fn_ca_commit_hand_settlement moved after it was
-- written), so this change does not newly close that one-time door.
--
-- Pinned by tests/a-deadlocked-hand-settlement-is-retried-in-the-live-path.law.test.ts
--
-- @live-proof: position('HAND_SETTLEMENT_TRANSIENT_INNER_REFUSAL' IN pg_get_functiondef('public.fn_ca_commit_hand_settlement_before_lease_generation(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb)'::regprocedure))>0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  v_def text;
  v_old constant text := $old$    v_stack_result := public.fn_ca_settle_hand_stacks_absolute(
      p_table_id,p_hand_number,v_normalized_stacks,p_rake,p_bbj,p_ref,p_inflow);
    IF coalesce((v_stack_result->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN v_stack_result || jsonb_build_object('atomic_hand_commit',false);
    END IF;$old$;
  v_new constant text := $new$    v_stack_result := public.fn_ca_settle_hand_stacks_absolute(
      p_table_id,p_hand_number,v_normalized_stacks,p_rake,p_bbj,p_ref,p_inflow);
    IF coalesce((v_stack_result->>'success')::boolean,false) IS NOT TRUE THEN
      -- HAND_SETTLEMENT_TRANSIENT_INNER_REFUSAL (2026-11-19): the stack
      -- settlement catches its own deadlock / serialization / lock timeout and
      -- returns it. Re-raise it here so this block's handler rolls the block
      -- back and answers the canonical atomic_hand_rolled_back envelope, the
      -- only shape the engine retries in the live path.
      IF v_stack_result->>'reason' = 'rolled_back'
         AND v_stack_result->>'sqlstate' IN ('40001','40P01','55P03') THEN
        RAISE EXCEPTION USING
          ERRCODE = v_stack_result->>'sqlstate',
          MESSAGE = coalesce(v_stack_result->>'error','transient stack settlement refusal');
      END IF;
      RETURN v_stack_result || jsonb_build_object('atomic_hand_commit',false);
    END IF;$new$;
BEGIN
  v_def := pg_get_functiondef(
    'public.fn_ca_commit_hand_settlement_before_lease_generation(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb)'::regprocedure);
  IF md5(v_def) <> 'b49192e78f472d7a931bcf20de46a702' THEN
    RAISE EXCEPTION 'fn_ca_commit_hand_settlement_before_lease_generation changed since this migration was written; qualify the current definition';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'stack settlement refusal return not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$migration$;

COMMIT;
