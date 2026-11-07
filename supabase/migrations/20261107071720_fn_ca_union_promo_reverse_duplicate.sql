-- 20261107071720_fn_ca_union_promo_reverse_duplicate.sql
--
-- RECORDING OF A MIGRATION APPLIED DIRECTLY (CLAUDE.md section 2, rule 11).
-- Production holds this function from 2026-11-07 07:17 UTC, applied through
-- the Supabase MCP during an active money incident: the 25-chip union promo
-- had been paid twice to 32 live members and the owner asked for the duplicate
-- to be taken back while the chips were still in their wallets. Rule 11 allows
-- a direct apply only for an outage that cannot wait for required checks, and
-- requires the same agent to commit the byte-exact recording to main as its
-- next step. This file is that recording; the SQL below is what ran.
-- Version matches production, so apply-merged-migration answers ALREADY-APPLIED.
--
-- Settlement: 29 of the 32 members still held the duplicate and 725 chips were
-- returned to union_wallets.promo_wallet; 3 had already spent it and were left
-- alone on the owner's ruling. 29 reversal legs, 29 cashier rows, 29 union
-- wallet credits, no negative balance, no ledger invariant finding.
-- docs/changelog/2026-11-07-the-union-promo-is-paid-once-per-player.md

-- A DUPLICATE UNION PROMO IS TAKEN BACK ONLY IF IT IS STILL THERE (2026-11-07).
-- fn_promo_disburse is a one-way door: a union promo credited to a player had
-- no reverse. The union promo job credited 25 twice to 32 members, so this door
-- reverses ONE named promo leg, and only while the member still holds the
-- amount. A member who has spent it keeps it: nothing is clawed into a
-- negative balance and no wallet is driven below zero.
BEGIN;

INSERT INTO public.ca_money_rpc_registry (proname, status, notes)
VALUES ('fn_ca_union_promo_reverse_duplicate', 'approved',
        'Reverses ONE fn_promo_disburse union->player promo leg: debits club_members.chip_balance, credits union_wallets.promo_wallet. Gated to the union owner or a service caller; refuses any leg that is not a Union Promo Disbursement to a player; skips (never goes negative) when the member no longer holds the amount; one reversal per leg, keyed on reverses_ledger_id. Journaled as a single ''reversal'' leg by club_members'' own autoledger writer with union_wallets stood down and declared as counterparty, so both account keys tally at commit.')
ON CONFLICT (proname) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes;

CREATE OR REPLACE FUNCTION public.fn_ca_union_promo_reverse_duplicate(
  p_ledger_id uuid,
  p_reason    text DEFAULT NULL,
  p_op_id     uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_actor   uuid := auth.uid();
  v_service boolean := public.fn_caller_is_engine();
  v_op      uuid := COALESCE(p_op_id, gen_random_uuid());
  v_leg     record;
  v_held    numeric;
  v_pb      numeric;
  v_ub      numeric;
  v_prior   uuid;
  v_tx      uuid;
BEGIN
  IF v_actor IS NULL AND NOT v_service THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not Authenticated');
  END IF;

  SELECT id, to_entity_id AS user_id, club_id, union_id, round(amount, 2) AS amount
    INTO v_leg
    FROM chip_ledger
   WHERE id = p_ledger_id;
  IF v_leg.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'That Promo Leg Was Not Found');
  END IF;

  -- Only the union promo door's own leg is reversible here.
  IF NOT EXISTS (
    SELECT 1 FROM chip_ledger
     WHERE id = p_ledger_id
       AND category = 'promo'
       AND description = 'Union Promo Disbursement'
       AND from_type = 'union_wallet'
       AND to_type = 'player_wallet') THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Only A Union Promo Disbursement To A Player Can Be Reversed Here');
  END IF;

  IF NOT v_service AND NOT EXISTS (
       SELECT 1 FROM unions u WHERE u.id = v_leg.union_id AND u.owner_id = v_actor) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Only The Union Owner May Reverse Union Promo');
  END IF;

  -- ONE REVERSAL PER LEG, replay-safe on the leg itself, not just the op id.
  SELECT id INTO v_prior FROM chip_transactions
   WHERE transaction_type = 'promo_reversal'
     AND metadata ->> 'reverses_ledger_id' = p_ledger_id::text
   LIMIT 1;
  IF v_prior IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'replayed', true,
      'transaction_id', v_prior, 'ledger_id', p_ledger_id);
  END IF;

  SELECT COALESCE(chip_balance, 0) INTO v_held
    FROM club_members
   WHERE club_id = v_leg.club_id AND user_id = v_leg.user_id
   FOR UPDATE;
  IF v_held IS NULL THEN
    RETURN jsonb_build_object('success', false, 'skipped', true,
      'error', 'That Wallet No Longer Exists', 'ledger_id', p_ledger_id);
  END IF;

  -- SPENT IS SPENT. The member keeps it and the books are left alone.
  IF v_held < v_leg.amount THEN
    RETURN jsonb_build_object('success', true, 'skipped', true,
      'reason', 'already_spent', 'held', v_held, 'required', v_leg.amount,
      'user_id', v_leg.user_id, 'ledger_id', p_ledger_id);
  END IF;

  PERFORM public.fn_ca_declare_ledger('reversal', 'union_wallet', v_leg.union_id, NULL,
            'promo_reverse:' || v_op::text, ARRAY['union_wallets']);
  PERFORM set_config('app.ledger_counterparty_label', 'union_wallets.promo_wallet', true);
  PERFORM set_config('app.ledger_correlation', v_op::text, true);

  UPDATE union_wallets
     SET promo_wallet = COALESCE(promo_wallet, 0) + v_leg.amount, updated_at = now()
   WHERE union_id = v_leg.union_id
   RETURNING round(promo_wallet, 2) INTO v_ub;
  IF v_ub IS NULL THEN
    RAISE EXCEPTION 'union promo wallet not found for union %', v_leg.union_id;
  END IF;

  UPDATE club_members
     SET chip_balance = chip_balance - v_leg.amount, updated_at = now()
   WHERE club_id = v_leg.club_id AND user_id = v_leg.user_id
   RETURNING round(chip_balance, 2) INTO v_pb;

  PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);

  -- The cashier's transaction history shows it (2026-10-24).
  INSERT INTO chip_transactions
    (club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after)
  VALUES
    (v_leg.club_id, v_leg.user_id, NULL, v_leg.amount, 'promo_reversal',
     COALESCE(NULLIF(btrim(p_reason), ''), 'Duplicate Union Promo Returned'),
     jsonb_build_object('op_id', v_op,
                        'reverses_ledger_id', p_ledger_id,
                        'union_id', v_leg.union_id,
                        'authorised_by', v_actor,
                        'player_after', v_pb,
                        'union_promo_after', v_ub),
     v_pb)
  RETURNING id INTO v_tx;

  INSERT INTO union_wallet_transactions
    (union_id, club_id, wallet, direction, amount, balance_after, tx_type, notes, created_by)
  VALUES
    (v_leg.union_id, v_leg.club_id, 'promo_wallet', 'credit', v_leg.amount, v_ub,
     'promo_reversal',
     COALESCE(NULLIF(btrim(p_reason), ''), 'Duplicate union promo returned') || ' (player)',
     v_actor);

  RETURN jsonb_build_object('success', true, 'replayed', false, 'skipped', false,
    'transaction_id', v_tx, 'op_id', v_op, 'ledger_id', p_ledger_id,
    'user_id', v_leg.user_id, 'amount', v_leg.amount,
    'player_after', v_pb, 'union_promo_after', v_ub);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_union_promo_reverse_duplicate(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_union_promo_reverse_duplicate(uuid, text, uuid) TO service_role;

COMMIT;
