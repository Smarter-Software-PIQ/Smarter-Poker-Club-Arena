-- 20261115052022_the_final_deal_manager_scope_resolves_and_the_v2_place_branc.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE FINAL-TABLE DEAL MANAGER SCOPE RESOLVES, AND THE UNINSTALLED VERSION-2
-- PLACE BRANCH REFUSES WITHOUT CALLING A MISSING VERIFIER (2026-11-15).
--
-- Found by the function-call guard (20261115020406): four installed functions
-- call a signature that does not exist. Read on production 2026-11-15:
--
-- ── 1. THE VERSIONED DEAL DOORS CALL A SCOPE CHECK THAT WAS NEVER INSTALLED ──
--
--   public.fn_begin_tournament_deal_review(uuid,uuid)                 line 5
--   public.fn_close_tournament_deal_review(uuid,uuid,text)            line 4
--   public.fn_complete_tournament_terminal_proposal(uuid,uuid,text,uuid,text) line 7
--
--   each open with PERFORM public.fn_assert_tournament_manager_write_scope(uuid).
--   20260910125453 (phase three versioned final deal) installed the callers;
--   the callee was defined only in the Stage-B contraction
--   (20260910055955_..._contraction.sql.pending) and the retired
--   20260910002530_tournament_manager_request_fencing_is_strict.sql, and
--   neither was ever installed. A rolled-back probe with a manager context
--   (actor, tournament, generation set) raised 42883 at all three doors.
--
--   Reachable today? Not yet. fn_ca_tournament_deal_proposals_active() is
--   false (the require_exact_final_deal_proposal trigger is not on
--   tournament_obligations), so fn_request_tournament_deal_review answers
--   proposal_authority_not_active, no review row can exist (0 ever), the
--   engine (TournamentManagerEliminations.checkFinalTableDeal) takes the
--   legacy vote path, and that path settles through
--   fn_execute_tournament_terminal_request kind 'legacy_deal' ->
--   fn_complete_tournament_terminal, which never reaches the missing call.
--   But the day the proposal authority is activated
--   (scripts/deploy/phase-three-activate-versioned-final-deal.sql), the
--   engine parks the final table, calls fn_begin_tournament_deal_review,
--   gets 42883, tries fn_close_tournament_deal_review to release the
--   dealer, gets 42883 again, and the parked table cannot resume.
--
--   The native rehearsal that drove a proposal deal green
--   (scripts/ci/terminal_original_request_native.py) installed the scope
--   check from the .pending file and emulated a request hook that sets
--   app.smarter_manager_request_fenced = 'protocol-2'. Production's hook
--   (smarter_private.fn_smarter_data_api_pre_request, Stage A) never sets
--   that marker, so even installing the Stage-B body verbatim would refuse
--   every manager ("request lease proof is absent").
--
--   THE FIX: install the scope check the callers name, with the authority
--   production actually runs. It asserts exactly what the working durable
--   terminal door (fn_execute_tournament_terminal_request, which already
--   settles places, satellites and legacy deals) asserts, by calling the same
--   function: smarter_private.assert_terminal_request_generation, for this
--   tournament and the generation the request hook admitted. That is: actor
--   tournament-manager, app.smarter_tournament_id equal to this tournament,
--   and the exact fresh, unaborted protocol-2 engine_tournament_leases row
--   for that generation held FOR KEY SHARE until COMMIT. The three callers
--   are not edited. The unfinished Stage-B programme is not installed; if it
--   ever is, its contraction replaces this body together with its own hook.
--
-- ── 2. THE VERSION-2 PLACE BRANCH CALLS A VERIFIER THAT EXISTS NOWHERE ─────
--
--   public.fn_tournament_finish_readiness(uuid,uuid) line 169 calls
--   public.fn_ca_verify_terminal_place_batch(uuid, boolean) when a
--   tournament_place_settlement_batches row has contract_version = 2. That
--   verifier is defined only in unapplied scripts/deploy phase-three files.
--   Nothing writes a version-2 place batch: the table has no contract_version
--   column at all (to_jsonb(b)->>'contract_version' is always NULL, so every
--   one of the 5,618 batches reads as version 1), no installed function
--   writes one, and the engine never touches the table. The branch is dead.
--
--   THE FIX: keep the version detection and keep it fail-closed, but stop
--   calling the missing function. A version-2 batch is refused with the same
--   failure code it gets today (canonical_place_batch_not_proven, today via a
--   caught 42883), with a detail naming the reason. No verifier is invented.
--   Version-1 behaviour is byte-for-byte the same text outside that block;
--   readiness for the first 300 finish receipts digested
--   4a4e153a22b800768ccd7a1d62c18072 before this change (all ok).
--
-- Both edits are pinned to the installed preimages by md5; the readiness edit
-- replaces one anchor that must occur exactly once. Function DDL only: no
-- table is locked, no row is written, no money moves, no engine dependency.
-- The function-call guard checks both installed bodies at COMMIT, and the
-- block before COMMIT asserts that none of the four functions still calls a
-- missing signature.
--
-- @live-proof: to_regprocedure('public.fn_assert_tournament_manager_write_scope(uuid)') IS NOT NULL AND position('smarter_private.assert_terminal_request_generation(p_tournament_id, v_generation)' IN pg_get_functiondef('public.fn_assert_tournament_manager_write_scope(uuid)'::regprocedure))>0 AND position('fn_ca_verify_terminal_place_batch' IN pg_get_functiondef('public.fn_tournament_finish_readiness(uuid,uuid)'::regprocedure))=0 AND position('version-2 place batch verifier is not installed' IN pg_get_functiondef('public.fn_tournament_finish_readiness(uuid,uuid)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

-- ── 0. PREIMAGES: exactly the bodies read on 2026-11-15 ─────────────────────
DO $preimage$
DECLARE
  v_fn text;
  v_md5 text;
BEGIN
  FOR v_fn, v_md5 IN SELECT * FROM (VALUES
    ('public.fn_begin_tournament_deal_review(uuid,uuid)', '38ef591da01466c0a69a2e43e41ef218'),
    ('public.fn_close_tournament_deal_review(uuid,uuid,text)', 'caf796a4fd545a1c1e68a5c0c1de3af4'),
    ('public.fn_complete_tournament_terminal_proposal(uuid,uuid,text,uuid,text)', '20a359f0554e5eaaa58dd0ae4be14864'),
    ('smarter_private.assert_terminal_request_generation(uuid,uuid)', 'cda0970a91262d8eb5b8fa75423acc19'),
    ('public.fn_tournament_finish_readiness(uuid,uuid)', '3209cfadeb8a36eccf0f75d7d58cabd9')
  ) pins(fn, body_md5) LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR md5(pg_get_functiondef(to_regprocedure(v_fn))) IS DISTINCT FROM v_md5 THEN
      RAISE EXCEPTION 'FINAL_DEAL_SCOPE_PREIMAGE_CHANGED: %', v_fn;
    END IF;
  END LOOP;
  IF to_regprocedure('public.fn_assert_tournament_manager_write_scope(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'FINAL_DEAL_SCOPE_PREIMAGE_CHANGED: the manager scope check already exists';
  END IF;
  IF to_regprocedure('public.fn_ca_verify_terminal_place_batch(uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'FINAL_DEAL_SCOPE_PREIMAGE_CHANGED: a version-2 place verifier now exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.tournament_place_settlement_batches'::regclass
                AND attname = 'contract_version' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'FINAL_DEAL_SCOPE_PREIMAGE_CHANGED: place batches now carry a contract version';
  END IF;
END
$preimage$;

-- ── 1. THE MANAGER WRITE SCOPE THE DEAL DOORS NAME ──────────────────────────
CREATE FUNCTION public.fn_assert_tournament_manager_write_scope(p_tournament_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_generation uuid;
BEGIN
  BEGIN
    v_generation :=
      NULLIF(current_setting('app.smarter_tournament_lease_generation', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'TOURNAMENT_MANAGER_SCOPE_INVALID: malformed authority context'
      USING ERRCODE = '22023';
  END;
  IF p_tournament_id IS NULL OR v_generation IS NULL THEN
    RAISE EXCEPTION 'TOURNAMENT_MANAGER_SCOPE_REQUIRED: tournament and manager lease generation are required'
      USING ERRCODE = '42501';
  END IF;
  -- The durable terminal door's own authority: actor tournament-manager, this
  -- tournament, this generation, and the exact fresh, unaborted protocol-2
  -- lease held FOR KEY SHARE until COMMIT.
  PERFORM smarter_private.assert_terminal_request_generation(p_tournament_id, v_generation);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_assert_tournament_manager_write_scope(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.fn_assert_tournament_manager_write_scope(uuid) IS
  'Manager write scope for the versioned final-table deal doors (begin/close review, complete proposal). Asserts the same authority as fn_execute_tournament_terminal_request: smarter_private.assert_terminal_request_generation for this tournament and the generation the Stage-A request hook admitted. Not an API route. 20261115052022.';

-- ── 2. THE VERSION-2 PLACE BRANCH REFUSES WITHOUT A MISSING CALL ────────────
CREATE FUNCTION pg_temp.ca_patch(p_fn regprocedure, p_md5 text, p_old text, p_new text)
 RETURNS void LANGUAGE plpgsql AS $patch$
DECLARE
  d text := pg_get_functiondef(p_fn);
BEGIN
  IF md5(d) <> p_md5 THEN
    RAISE EXCEPTION 'FINAL_DEAL_SCOPE_PREIMAGE_CHANGED: %', p_fn;
  END IF;
  IF (length(d) - length(replace(d, p_old, ''))) / length(p_old) <> 1 THEN
    RAISE EXCEPTION 'FINAL_DEAL_SCOPE_ANCHOR_NOT_UNIQUE in %', p_fn;
  END IF;
  EXECUTE replace(d, p_old, p_new);
END
$patch$;

SELECT pg_temp.ca_patch(
  'public.fn_tournament_finish_readiness(uuid,uuid)'::regprocedure,
  '3209cfadeb8a36eccf0f75d7d58cabd9',
  $old$    IF v_modern_place THEN
      BEGIN
        v_domain_check:=public.fn_ca_verify_terminal_place_batch(p_tournament_id,true);
        IF COALESCE((v_domain_check->>'ok')::boolean,false) IS NOT TRUE THEN
          RAISE EXCEPTION 'canonical place proof refused';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failures:=v_failures||jsonb_build_array(jsonb_build_object(
          'code','canonical_place_batch_not_proven','detail',SQLERRM));
      END;
    END IF;
$old$,
  $new$    IF v_modern_place THEN
      -- No version-2 place batch verifier is installed (20261115052022), so a
      -- version-2 batch is refused here, never certified by the version-1 proof.
      v_failures:=v_failures||jsonb_build_array(jsonb_build_object(
        'code','canonical_place_batch_not_proven',
        'detail','version-2 place batch verifier is not installed'));
    END IF;
$new$);

-- ── 3. POSTIMAGE: none of the four still calls a missing signature ──────────
DO $postimage$
DECLARE
  v_found text;
  v_readiness text := pg_get_functiondef('public.fn_tournament_finish_readiness(uuid,uuid)'::regprocedure);
BEGIN
  SELECT string_agg(f::text || ' line ' || u.lineno || ': ' || u.message, '; ')
    INTO v_found
    FROM unnest(ARRAY[
      'public.fn_begin_tournament_deal_review(uuid,uuid)',
      'public.fn_close_tournament_deal_review(uuid,uuid,text)',
      'public.fn_complete_tournament_terminal_proposal(uuid,uuid,text,uuid,text)',
      'public.fn_tournament_finish_readiness(uuid,uuid)',
      'public.fn_assert_tournament_manager_write_scope(uuid)'
    ]::regprocedure[]) AS f
    CROSS JOIN LATERAL smarter_private.fn_ca_unresolved_function_calls(f) AS u;
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'FINAL_DEAL_SCOPE_STILL_UNRESOLVED: %', v_found;
  END IF;
  IF position('fn_ca_verify_terminal_place_batch' IN v_readiness) <> 0
     OR (length(v_readiness) - length(replace(v_readiness, 'canonical_place_batch_not_proven', '')))
          / length('canonical_place_batch_not_proven') <> 1 THEN
    RAISE EXCEPTION 'FINAL_DEAL_SCOPE_POSTIMAGE_DIFFERS: readiness';
  END IF;
  IF has_function_privilege('anon', 'public.fn_assert_tournament_manager_write_scope(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_assert_tournament_manager_write_scope(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_assert_tournament_manager_write_scope(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FINAL_DEAL_SCOPE_POSTIMAGE_DIFFERS: the scope check is reachable as an API route';
  END IF;
END
$postimage$;

COMMIT;
