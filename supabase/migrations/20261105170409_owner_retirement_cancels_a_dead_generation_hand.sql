-- 20261105170409_owner_retirement_cancels_a_dead_generation_hand.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('OWNER RETIREMENT CANCELS A DEAD GENERATION HAND' in pg_get_functiondef('public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure)) > 0 AND position('OWNER RETIREMENT CANCELS A DEAD GENERATION HAND' in pg_get_functiondef('smarter_private.assert_tournament_abort_absence(uuid,uuid,uuid,uuid,jsonb)'::regprocedure)) > 0
--
-- OWNER RETIREMENT CANCELS A DEAD GENERATION HAND (Dan, 2026-11-05: "HARD CODE
-- FIX THIS AT ITS ROOT CAUSE SO IT STOPS HAPPENING")
--
-- WHAT WAS WRONG, READ FROM ROWS
--
-- Six owner-retired Diamond satellites (fe9145bb, 26ebb662, 369d46bd,
-- 928dc47d, 0d98f87e, eb82f8d7; horse-only, started 2026-10-29 to 10-31, their
-- targets long finished) sat RUNNING with stop_requested for days. Each table
-- holds exactly one f06_hand_permits row in state 'reserved' from a generation
-- that is no longer the lease holder, with its original retained in
-- hand_continuations. The abort cannot quiesce while that hand is pending
-- (tournament_abort_pending), and the engine will not continue a hand in an
-- event whose stop was requested. Nothing could ever move it:
--   * fn_f06_abort_abandoned_generation refuses it: HAND_CONTINUATION_UNSETTLED
--     (the hand is retained for continuation);
--   * fn_ca_cancel_tournament_abort_unsettled_hand, the audited door that
--     closes exactly this kind of hand 'aborted_unsettled' crediting nothing,
--     admitted only the equal-share closure;
--   * the owner's 2026-11-03 retirement order superseded equal share, so the
--     owner-retirement path had no way to close the hand at all.
--
-- THE FIX
--
-- The owner-retirement closure ('owner_retirement') is admitted by the same two
-- checks that admit equal share, and only for an event the owner recorded for
-- retirement (smarter_private.owner_tournament_deletion_intents, owner chat
-- 01a19ccc-894e-75e2-a9e7-fe0d2df6c326): the cancellation door, and the
-- cancelled-boundary certificate in assert_tournament_abort_absence. Every other
-- refusal in the door is unchanged: nothing durable of the hand may exist (no
-- submission, dispatch, commit or history), every chair must hold exactly its
-- registration's chips, the retained original must match the permit, and the
-- money snapshot must not move. The engine sends the mode through owner_cancel_ack.
--
-- No money moves in this migration.
--
-- Applied to the installed definitions, refusing unless each anchor appears
-- exactly once, so the long functions are not retyped by hand.

BEGIN;

SET LOCAL lock_timeout = '1s';

DO $migration$
DECLARE
  v_marker constant text := 'OWNER RETIREMENT CANCELS A DEAD GENERATION HAND';
  v_owner constant text :=
    $s$(p_evidence->>'closure_mode' = 'owner_retirement' AND EXISTS (SELECT 1 FROM smarter_private.owner_tournament_deletion_intents i WHERE i.tournament_id = p_tournament_id AND i.owner_chat_id = '01a19ccc-894e-75e2-a9e7-fe0d2df6c326'))$s$;
  v_cancel_old constant text :=
    $s$ IF p_evidence->>'closure_mode' IS DISTINCT FROM 'equal_share' THEN RAISE EXCEPTION 'operator_abort_explicit_equal_share_required' USING ERRCODE='42501';END IF;$s$;
  v_absence_old constant text := $s$p_evidence->>'closure_mode'='equal_share'$s$;
  v_def text;
BEGIN
  v_def := pg_get_functiondef(
    'public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure);
  IF position(v_marker IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_cancel_old, ''))) / length(v_cancel_old) <> 1 THEN
      RAISE EXCEPTION 'fn_ca_cancel_tournament_abort_unsettled_hand anchor not found exactly once; refusing to patch';
    END IF;
    EXECUTE replace(v_def, v_cancel_old,
      E'\n /* OWNER RETIREMENT CANCELS A DEAD GENERATION HAND (2026-11-05): equal share,\n'
      || E'    or the owner-directed retirement of an event the owner recorded. */\n'
      || $s$ IF NOT (p_evidence->>'closure_mode' = 'equal_share' OR $s$ || v_owner
      || $s$) THEN RAISE EXCEPTION 'operator_abort_explicit_equal_share_required' USING ERRCODE='42501';END IF;$s$);
  END IF;

  v_def := pg_get_functiondef(
    'smarter_private.assert_tournament_abort_absence(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
  IF position(v_marker IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_absence_old, ''))) / length(v_absence_old) <> 1 THEN
      RAISE EXCEPTION 'assert_tournament_abort_absence anchor not found exactly once; refusing to patch';
    END IF;
    v_def := replace(v_def, v_absence_old,
      $s$(p_evidence->>'closure_mode'='equal_share' OR $s$ || v_owner || ')');
    v_def := replace(v_def, E'DECLARE t public.tables;\n',
      E'DECLARE t public.tables;\n'
      || E' /* OWNER RETIREMENT CANCELS A DEAD GENERATION HAND (2026-11-05): a cancelled\n'
      || E'    boundary is certified for equal share or an owner-recorded retirement. */\n');
    IF position(v_marker IN v_def) = 0 THEN
      RAISE EXCEPTION 'assert_tournament_abort_absence marker anchor missing; refusing to patch';
    END IF;
    EXECUTE v_def;
  END IF;
END
$migration$;

COMMIT;
