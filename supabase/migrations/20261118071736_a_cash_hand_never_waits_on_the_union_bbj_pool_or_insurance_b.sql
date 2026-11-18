-- 20261118071736_a_cash_hand_never_waits_on_the_union_bbj_pool_or_insurance_b
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch.
--
-- A CASH HAND NEVER WAITS ON THE UNION'S BBJ POOL OR INSURANCE BANK
-- (part 2 of 2: the switch)
--
-- Part 1 (20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on)
-- installed public.hand_bank_obligation_pending, the banker
-- fn_ca_bank_pending_hand_obligations, the continuation that calls it and the
-- conservation readers, all inert while the table is empty. It carries the
-- production evidence.
--
-- This file changes two statements of fn_ca_process_hand_post_commit_obligations,
-- on the postimage of 20261118035606 (#11256):
--   - the BBJ step stores the drop instead of locking the union's pool and
--     calling bbj_record_contribution;
--   - the insurance step stores each leg instead of calling
--     record_insurance_transaction.
-- After it, no statement reachable from the envelope writes union_wallets,
-- club_wallets, bbj_pools or ca_bbj_alloc_state, or takes a 'bbj-pool:' lock,
-- so the engine's settlement barrier for a cash hand no longer depends on any
-- holder of a union-wide row
-- (tests/a-cash-hand-never-waits-on-the-union-bbj-pool.law.test.ts;
-- scripts/ci/test-deadlock-lock-orders-r5.py proves it with two sessions and
-- proves the banked rows equal the uncontended run's exactly).
--
-- Unchanged: the validation of both obligations (the club lookup still
-- refuses a BBJ obligation whose club is missing), the hand-number bound,
-- promo play-through, add-ons, the completion receipt and its result
-- ('bbj_contribution' and 'insurance' report what the hand owed, as before),
-- bbj_record_contribution and record_insurance_transaction themselves.
--
-- ORDERING WITH THE ENVELOPE'S OTHER LANES: this pins the 20261118035606
-- postimage (da123635...). A later change to this function's control flow
-- (bounded lock waits, single flight) must re-pin against this file's
-- postimage, or this file against it; the anchors below do not overlap the
-- lock preamble.
--
-- It refuses to install unless part 1 is installed.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)) = '11f769218554c9585f92ee2c5745e61f')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The pinned-text substitution of 20261118034950, unchanged.
CREATE FUNCTION pg_temp.ca_bank_subst(p_sig text, p_before text, p_after text,
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
  IF to_regclass('public.hand_bank_obligation_pending') IS NULL
     OR to_regprocedure('public.fn_ca_bank_pending_hand_obligations(uuid)') IS NULL
     OR position('fn_ca_bank_pending_hand_obligations' in
          pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) = 0
     OR position('fn_ca_bank_pending_hand_obligations' in
          pg_get_functiondef('public.trg_finish_hand_post_commit_obligations()'::regprocedure)) = 0
     OR position($p$WHEN 'hand_bank_obligation_pending' THEN$p$ in
          pg_get_functiondef('public.fn_ca_tally_balance_move()'::regprocedure)) = 0
     OR position('hand_bank_obligation_pending' in
          pg_get_functiondef('public.fn_ca_supply_snapshot()'::regprocedure)) = 0
     OR position('hand_bank_obligation_pending' in
          pg_get_functiondef('public.fn_ca_account_balance(text,uuid,uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'part 1 (20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on) is not installed whole; the switch is refused';
  END IF;
END $m$;

SELECT pg_temp.ca_bank_subst(
  'public.fn_ca_process_hand_post_commit_obligations(uuid)',
  'da123635a0f1cdb035bd9b518ebf07f0', '11f769218554c9585f92ee2c5745e61f',
  ARRAY[$oenv1$    PERFORM pg_advisory_xact_lock(hashtextextended(
      'bbj-pool:' || COALESCE(v_union_id::text, 'club:' || (v_bbj->>'club_id')),
      0
    ));
    IF v_union_id IS NULL THEN
      SELECT p.id INTO v_pool_id
        FROM public.bbj_pools p
       WHERE p.club_id = (v_bbj->>'club_id')::uuid
         AND p.status = 'active'
       ORDER BY p.created_at, p.id
       LIMIT 1
       FOR UPDATE;
    ELSE
      SELECT p.id INTO v_pool_id
        FROM public.bbj_pools p
       WHERE p.union_id = v_union_id
         AND p.status = 'active'
       ORDER BY p.created_at, p.id
       LIMIT 1
       FOR UPDATE;
    END IF;

    IF v_pool_id IS NULL THEN
      IF v_union_id IS NULL THEN
        INSERT INTO public.bbj_pools(
          club_id, main_balance, backup_balance, promo_balance, status
        ) VALUES (
          (v_bbj->>'club_id')::uuid, 0, 0, 0, 'active'
        ) RETURNING id INTO v_pool_id;
      ELSE
        INSERT INTO public.bbj_pools(
          union_id, main_balance, backup_balance, promo_balance, status
        ) VALUES (
          v_union_id, 0, 0, 0, 'active'
        ) RETURNING id INTO v_pool_id;
      END IF;
    END IF;

    SELECT r.id INTO v_contribution_id
      FROM public.bbj_record_contribution(
        v_pool_id,
        v_commit.hand_id,
        v_commit.table_id,
        (v_bbj->>'amount')::numeric,
        0, 0, 0,
        COALESCE((v_bbj->>'big_blind')::numeric, 2),
        v_commit.hand_number::integer,
        (v_bbj->>'club_id')::uuid
      ) r;
    IF v_contribution_id IS NULL THEN
      RAISE EXCEPTION 'BBJ contribution produced no receipt for hand %', p_hand_id;
    END IF;
$oenv1$,
        $oenv2$    SELECT r.id INTO v_insurance_id
      FROM public.record_insurance_transaction(
        v_commit.table_id,
        (v_item->>'club_id')::uuid,
        v_commit.hand_number::integer,
        (v_item->>'player_id')::uuid,
        COALESCE((v_item->>'equity_percent')::numeric, 0),
        COALESCE((v_item->>'premium')::numeric, 0),
        COALESCE((v_item->>'insured_amount')::numeric, 0),
        COALESCE((v_item->>'payout')::numeric, 0),
        COALESCE((v_item->>'player_won')::boolean, false),
        COALESCE(NULLIF(v_item->>'kind', ''), 'insurance')::varchar
      ) r;
    IF v_insurance_id IS NULL THEN
      RAISE EXCEPTION 'insurance obligation produced no receipt for hand %', p_hand_id;
    END IF;
$oenv2$],
  ARRAY[$nenv1$    /* A CASH HAND NEVER WAITS ON THE UNION'S BBJ POOL (20261118071736). The
       drop used to be banked here: the union's 'bbj-pool:' lock, its one
       active pool row FOR UPDATE and its allocator row, held from this step
       to COMMIT. With the rake off union_wallets (20261118035606) that made
       the pool every BBJ table's single queue in the union. The obligation is
       stored instead, exactly as it would have been passed, with the union
       read here as before; fn_ca_bank_pending_hand_obligations makes the same
       bbj_record_contribution call on the same pool from the hand's own
       projection continuation and never waits for the pool. The casts the
       call made are still made here, so a malformed obligation is refused by
       the envelope as before. Until it is banked the drop is on the felt by
       the tally (fn_ca_tally_balance_move). */
    PERFORM COALESCE((v_bbj->>'big_blind')::numeric, 2),
            v_commit.hand_number::integer;
    INSERT INTO public.hand_bank_obligation_pending
      (hand_id, kind, item_key, table_id, hand_number, union_id, felt_amount, obligation)
    VALUES (v_commit.hand_id, 'bbj_contribution', '', v_commit.table_id, v_commit.hand_number,
            v_union_id, (v_bbj->>'amount')::numeric, v_bbj)
    ON CONFLICT (hand_id, kind, item_key) DO NOTHING;
$nenv1$,
        $nenv2$    /* AN INSURED HAND NEVER WAITS ON THE UNION'S INSURANCE BANK
       (20261118071736). record_insurance_transaction upserts
       union_wallets.insurance_wallet (club_wallets for a private table), the
       row a tournament settlement held for 45 s on 2026-11-17. The leg is
       stored instead, exactly as it would have been passed, and banked with
       the same call by the hand's projection continuation, never waiting for
       the bank row. felt_amount is the bank's side of the leg in the cents
       record_insurance_transaction rounds to: premium - payout. */
    PERFORM COALESCE((v_item->>'equity_percent')::numeric, 0),
            COALESCE((v_item->>'insured_amount')::numeric, 0),
            COALESCE((v_item->>'player_won')::boolean, false),
            COALESCE(NULLIF(v_item->>'kind', ''), 'insurance')::varchar,
            v_commit.hand_number::integer;
    INSERT INTO public.hand_bank_obligation_pending
      (hand_id, kind, item_key, table_id, hand_number, felt_amount, obligation)
    VALUES (v_commit.hand_id, 'insurance',
            lower(v_item->>'player_id') || ':' || COALESCE(NULLIF(v_item->>'kind', ''), 'insurance'),
            v_commit.table_id, v_commit.hand_number,
            round(COALESCE((v_item->>'premium')::numeric, 0), 2)
              - round(COALESCE((v_item->>'payout')::numeric, 0), 2),
            v_item)
    ON CONFLICT (hand_id, kind, item_key) DO NOTHING;
$nenv2$]
);

COMMIT;
