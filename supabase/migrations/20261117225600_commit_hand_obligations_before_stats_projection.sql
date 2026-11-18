-- Commit the accepted hand's financial obligations before projecting stats.
-- The projection worker could hold the union_wallets rake row while it ran
-- the whole statistics projection. Live post-hand RPCs on other tables
-- queued behind that shared row and exceeded their statement deadline.
-- The committed receipt and outbox preserve retry identity across both calls.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) = '459a0031d391c2516633b28afdca089e')

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';

DO $migration$
DECLARE
  signature constant regprocedure := 'public.fn_project_hand_side_effects(uuid)'::regprocedure;
  original text := pg_get_functiondef(signature);
  anchor constant text := $anchor$  /* LOCK ORDER 4: projection serialisation comes after post-commit. The$anchor$;
  boundary constant text := $boundary$  /* A newly completed envelope still holds the union wallet row until this
     transaction commits. End this pass before taking projection locks or
     writing dashboard facts. The outbox row is the durable continuation.
     The existing worker already defers predecessor_pending without claiming
     success: here its predecessor is the just-completed financial phase. */
  IF (v_post_commit->>'ok')::boolean IS TRUE
     AND (v_post_commit->>'already_completed')::boolean IS FALSE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', 'post_commit_completed_in_this_transaction',
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

$boundary$;
  candidate text;
BEGIN
  IF md5(original) <> 'e1402cc728a46730f2c478ef2e397317' THEN
    RAISE EXCEPTION 'hand projection definition changed; revalidate the transaction boundary';
  END IF;
  candidate := replace(original, anchor, boundary || anchor);
  IF md5(candidate) <> '459a0031d391c2516633b28afdca089e' THEN
    RAISE EXCEPTION 'hand projection transaction-boundary postimage mismatch';
  END IF;
  EXECUTE candidate;
END;
$migration$;

COMMIT;
