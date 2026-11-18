-- 20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch.
--
-- A CASH HAND NEVER WAITS ON A TOURNAMENT WALLET LOCK (part 2 of 2: the switch)
--
-- Part 1 (20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall) installed public.cash_rake_pending, the banker
-- fn_ca_bank_pending_cash_rake, the continuation that calls it and the
-- conservation readers, all inert while the table is empty.
--
-- This file changes one statement of fn_ca_process_hand_post_commit_obligations:
-- where the envelope called atomic_distribute_rake, it now stores the same
-- obligation in cash_rake_pending, keyed on the hand. After it, no statement
-- reachable from the envelope's rake step writes public.union_wallets, so the
-- engine's settlement barrier for a raked cash hand no longer depends on any
-- holder of that row (tests/a-cash-hand-never-waits-on-the-union-wallet.law.test.ts;
-- scripts/ci/test-deadlock-lock-orders-r5.py proves it with two sessions and
-- proves the banked rows equal the uncontended run's exactly).
--
-- Unchanged: the obligation's validation, the hand-number bound, the BBJ drop,
-- promo play-through, insurance and add-on steps, the completion receipt, and
-- atomic_distribute_rake itself. An insured hand's insurance step still
-- updates union_wallets.insurance_wallet (record_insurance_transaction); that
-- is a separate, named exposure and is not changed here.
--
-- It refuses to install unless part 1 is installed.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)) = 'da123635a0f1cdb035bd9b518ebf07f0')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The pinned-text substitution every function change below goes through
-- (the form 20261016172614 and 20261022062934 use): the live definition must
-- be the pinned preimage, each anchor must occur exactly once, the result must
-- be the derived postimage before and after it is executed, and owner,
-- SECURITY DEFINER, settings and grants must not move.
CREATE FUNCTION pg_temp.ca_rake_subst(p_sig text, p_before text, p_after text,
                                      p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;

  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;

  EXECUTE v_new;

  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

DO $m$
BEGIN
  IF to_regclass('public.cash_rake_pending') IS NULL
     OR to_regprocedure('public.fn_ca_bank_pending_cash_rake(uuid)') IS NULL
     OR position('fn_ca_bank_pending_cash_rake' in
          pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) = 0
     OR position('fn_ca_bank_pending_cash_rake' in
          pg_get_functiondef('public.trg_finish_hand_post_commit_obligations()'::regprocedure)) = 0
     OR position($p$WHEN 'cash_rake_pending' THEN$p$ in
          pg_get_functiondef('public.fn_ca_tally_balance_move()'::regprocedure)) = 0
     OR position('cash_rake_pending' in
          pg_get_functiondef('public.fn_ca_supply_snapshot()'::regprocedure)) = 0
     OR position('cash_rake_pending' in
          pg_get_functiondef('public.fn_ca_account_balance(text,uuid,uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'part 1 (20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall) is not installed whole; the switch is refused';
  END IF;
END $m$;

SELECT pg_temp.ca_rake_subst(
  'public.fn_ca_process_hand_post_commit_obligations(uuid)',
  '8b81e8bb218cacb235832285e4fbbb24', 'da123635a0f1cdb035bd9b518ebf07f0',
  ARRAY[$oenv0$    SELECT * INTO v_rake_result
      FROM public.atomic_distribute_rake(
        v_commit.table_id,
        (v_rake->>'club_id')::uuid,
        v_commit.hand_id,
        v_commit.hand_number::integer,
        (v_rake->>'amount')::numeric,
        COALESCE((v_rake->>'bbj')::numeric, 0),
        NULLIF(v_rake->>'pot', '')::numeric,
        NULLIF(v_rake->>'num_players', '')::integer,
        COALESCE(v_rake->'contributions', '{}'::jsonb),
        NULLIF(v_rake->>'tournament_id', '')::uuid,
        COALESCE(v_rake->'returned_uncalled', '{}'::jsonb),
        COALESCE(NULLIF(v_rake->>'method', ''), 'WEIGHTED_CONTRIBUTED')
      );
    IF NOT FOUND OR NOT (
      COALESCE(v_rake_result.applied, false)
      OR COALESCE(v_rake_result.already_processed, false)
      OR v_rake_result.rake_record_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'rake obligation did not produce a receipt for hand %', p_hand_id;
    END IF;
$oenv0$],
  ARRAY[$nenv0$    /* A CASH HAND NEVER WAITS ON THE UNION WALLET ROW (20261118). The rake
       used to be banked here through atomic_distribute_rake, whose union leg
       updates the one union_wallets row every table of the union shares. A
       tournament settlement holding that row for 45 s made every cash table's
       envelope wait and time out (2,676 statement timeouts in 25 minutes on
       2026-11-17). The obligation is stored instead, exactly as it would have
       been passed, keyed on the hand; fn_ca_bank_pending_cash_rake banks it
       from the hand's own projection continuation with the same call. The
       casts the call made are still made here, so a malformed obligation is
       refused by the envelope as before. Until it is banked the rake is on
       the felt by the tally (fn_ca_tally_balance_move). */
    PERFORM (v_rake->>'club_id')::uuid,
            v_commit.hand_number::integer,
            COALESCE((v_rake->>'bbj')::numeric, 0),
            NULLIF(v_rake->>'pot', '')::numeric,
            NULLIF(v_rake->>'num_players', '')::integer,
            NULLIF(v_rake->>'tournament_id', '')::uuid,
            COALESCE(NULLIF(v_rake->>'method', ''), 'WEIGHTED_CONTRIBUTED');
    INSERT INTO public.cash_rake_pending (hand_id, table_id, hand_number, amount, rake)
    VALUES (v_commit.hand_id, v_commit.table_id, v_commit.hand_number,
            (v_rake->>'amount')::numeric, v_rake)
    ON CONFLICT (hand_id) DO NOTHING;
$nenv0$]
);

COMMIT;
