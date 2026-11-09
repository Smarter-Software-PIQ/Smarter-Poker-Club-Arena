CREATE OR REPLACE FUNCTION smarter_private.owner_retirement_transfer_pools(p_operation_id uuid, p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE
 intent smarter_private.owner_tournament_deletion_intents; t public.tournaments;
 e record; canonical record; prior jsonb; v_amount numeric; fee numeric; refunded_fee numeric:=0;
 bank_wallet uuid; bank_before numeric; bank_after numeric; journal uuid;
 credit jsonb; drains jsonb:='[]'; part record; saved jsonb; setting record;
 key text; answer jsonb; refundable record;
 main_bank constant uuid:='fade0000-0000-0000-0000-000000000001';
 kingfish constant uuid:='47965354-0e56-43ef-931c-ddaab82af765';
BEGIN
 PERFORM smarter_private.cancellation_lane(p_tournament_id);
 PERFORM smarter_private.assert_tournament_abort_quiesced(p_operation_id,p_tournament_id);
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 SELECT * INTO intent FROM smarter_private.owner_tournament_deletion_intents WHERE tournament_id=p_tournament_id;
 IF NOT FOUND OR intent.original_started_at IS DISTINCT FROM t.started_at
 OR intent.owner_chat_id IS DISTINCT FROM '01a19ccc-894e-75e2-a9e7-fe0d2df6c326'
 OR (intent.asset='chips' AND (intent.destination_id IS DISTINCT FROM main_bank OR t.union_id IS DISTINCT FROM main_bank))
 OR (intent.asset='diamonds' AND (intent.destination_id IS DISTINCT FROM kingfish OR NOT public.fn_poker_diamond_tournament(p_tournament_id)))
 THEN RAISE EXCEPTION 'owner_retirement_transfer_scope_changed';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_players tp JOIN public.profiles p ON p.id=tp.user_id
  WHERE tp.tournament_id=p_tournament_id AND NOT coalesce(p.is_horse,false)
  AND NOT EXISTS(SELECT 1 FROM (VALUES
   ('2781bcd7-cc8a-4713-ab3e-0d0a81fdf110'::uuid,'eed278a8-3ca2-4e2d-a196-0a0cd9e74f90'::uuid),
   ('7986217a-0a67-4585-bd43-254356a9cb54','b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216'),
   ('6379b29e-1307-4e8b-91e7-e9a0975cd64d','d55730d2-da5a-45fc-8478-82e49f97cd7e'),
   ('d5decc98-cd0f-417f-aa28-6df009a74c76','1c465f14-42ce-45cb-9186-828a5f926152'),
   ('d5decc98-cd0f-417f-aa28-6df009a74c76','ed2d1c05-c3bb-4d9e-b862-2a9797d32044'),
   ('d5decc98-cd0f-417f-aa28-6df009a74c76','c657675c-f970-4c42-8f19-ba4d8096be67')
  )v(tournament_id,user_id) WHERE v.tournament_id=tp.tournament_id AND v.user_id=tp.user_id))
 THEN RAISE EXCEPTION 'owner_retirement_unreviewed_human_registration';END IF;
 IF intent.asset='diamonds' AND EXISTS(SELECT 1 FROM public.poker_diamond_lot_reservations r
  JOIN public.poker_diamond_custody c ON c.id=r.custody_id WHERE c.target_id=p_tournament_id
  AND r.released_at IS NULL AND r.amount>r.consumed)
 THEN RAISE EXCEPTION 'owner_retirement_purchased_liability_requires_resolution';END IF;
 IF EXISTS(SELECT 1 FROM smarter_private.owner_retirement_pool_transfers WHERE tournament_id=p_tournament_id)
 THEN RAISE EXCEPTION 'owner_retirement_transfer_already_recorded';END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'owner_retirement_platform_frozen';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_obligations WHERE tournament_id=p_tournament_id AND amount_owed>amount_paid)
 THEN RAISE EXCEPTION 'owner_retirement_unpaid_player_obligation';END IF;
 -- All verified paid human charges must have their original bank-funded
 -- refund, including the two independent charges in the same event.
 FOR refundable IN SELECT * FROM (VALUES
 ('2781bcd7-cc8a-4713-ab3e-0d0a81fdf110'::uuid,'26b465dd-600d-42eb-9f37-68f6052febac'::uuid,5::numeric),
 ('6379b29e-1307-4e8b-91e7-e9a0975cd64d','8e6232d8-bbd7-4dc8-9640-4fbfa45ca952',1),
 ('d5decc98-cd0f-417f-aa28-6df009a74c76','1edfe4d2-005d-4b93-96d0-fc0bb10f8c95',1),
 ('d5decc98-cd0f-417f-aa28-6df009a74c76','26ac24a2-7c73-44af-a5ae-b971d0a8e4fd',1)
 )x(tournament_id,entitlement_id,amount) WHERE tournament_id=p_tournament_id LOOP
  SELECT receipt INTO prior FROM smarter_private.owner_retirement_bank_refunds WHERE entitlement_id=refundable.entitlement_id;
  IF smarter_private.owner_manual_refund_receipt(refundable.entitlement_id) IS NULL AND
   (prior IS NULL OR (prior->>'amount')::numeric IS DISTINCT FROM refundable.amount
   OR NOT EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=refundable.entitlement_id
    AND amount_paid_now=refundable.amount AND credit_ledger_id=(prior->'refund'->>'credit_ledger_id')::uuid))
  THEN RAISE EXCEPTION 'owner_retirement_original_refund_missing';END IF;
 END LOOP;
 IF intent.asset='diamonds' THEN PERFORM public.fn_poker_diamond_tournament_open_shadow(p_tournament_id);END IF;
 SELECT * INTO e FROM public.tournament_escrow WHERE tournament_id=p_tournament_id AND enforced AND closed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'owner_retirement_open_escrow_required';END IF;
 IF intent.asset='diamonds' THEN SELECT * INTO canonical FROM public.fn_poker_diamond_tournament_escrow(p_tournament_id);
 ELSE SELECT * INTO canonical FROM public.fn_ca_tournament_escrow_chips(p_tournament_id);END IF;
 IF canonical.prize_balance IS DISTINCT FROM e.prize_balance OR canonical.bounty_balance IS DISTINCT FROM e.bounty_balance
 OR canonical.fee_balance IS DISTINCT FROM e.fee_balance THEN RAISE EXCEPTION 'owner_retirement_escrow_sources_disagree';END IF;
 IF e.prize_balance<0 OR e.bounty_balance<0 OR e.fee_balance<0
 OR e.prize_balance::text IN ('NaN','Infinity','-Infinity') OR e.bounty_balance::text IN ('NaN','Infinity','-Infinity')
 OR e.fee_balance::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'owner_retirement_invalid_bank';END IF;
 -- A bank-funded gross refund must retain its fee portion for the original
 -- club fee liability. The refund bank's overlay initially enters prize;
 -- this same terminal transaction reserves the exact original fee component.
 IF intent.asset='chips' THEN
  SELECT coalesce(sum(tr.refund_fee),0) INTO refunded_fee
   FROM smarter_private.owner_retirement_bank_refunds r JOIN public.tournament_refund_tranches tr
    ON tr.entitlement_id=r.entitlement_id AND tr.credit_ledger_id=(r.receipt->'refund'->>'credit_ledger_id')::uuid
   WHERE r.tournament_id=p_tournament_id;
  IF refunded_fee<0 OR refunded_fee>e.prize_balance THEN RAISE EXCEPTION 'owner_retirement_refunded_fee_funding_missing';END IF;
 END IF;
 -- Chip fees are held for the member clubs through the existing fee writer.
 -- Diamond fees have no member-club attribution and use the named recipient.
 fee:=CASE WHEN intent.asset='diamonds' THEN e.fee_balance ELSE 0 END;
 v_amount:=e.prize_balance-refunded_fee+e.bounty_balance+fee;
 key:='owner-retirement-pool:'||p_tournament_id::text||':'||p_operation_id::text;
 IF intent.asset='chips' THEN
  SELECT id,chip_balance INTO bank_wallet,bank_before FROM public.union_wallets WHERE union_id=main_bank FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owner_retirement_main_bank_missing';END IF;
  IF v_amount>0 THEN
   SELECT jsonb_object_agg(k,coalesce(current_setting(k,true),'')) INTO saved FROM unnest(ARRAY[
    'app.ledger_category','app.ledger_counterparty','app.ledger_counterparty_entity','app.ledger_counterparty_label',
    'app.ledger_idempotency_key','app.ledger_tournament_id','app.ledger_autoledger_club_id']) k;
   PERFORM public.fn_ca_declare_ledger('transfer','prize_liability',t.id,NULL,key);
   PERFORM set_config('app.ledger_tournament_id',t.id::text,true);
   PERFORM set_config('app.ledger_autoledger_club_id',t.club_id::text,true);
   UPDATE public.union_wallets SET chip_balance=chip_balance+v_amount,updated_at=now()
    WHERE union_id=main_bank RETURNING chip_balance INTO bank_after;
   SELECT id INTO journal FROM public.chip_ledger WHERE idempotency_key=key AND from_type='prize_liability'
    AND from_entity_id=t.id AND to_type='union_bank' AND to_entity_id=bank_wallet
    AND to_label='union_wallets.chip_balance' AND category='transfer' AND chip_ledger.amount=v_amount;
   IF journal IS NULL OR bank_after IS DISTINCT FROM bank_before+v_amount THEN RAISE EXCEPTION 'owner_retirement_bank_credit_unproven';END IF;
   INSERT INTO public.union_wallet_transactions(union_id,wallet,direction,amount,balance_after,tx_type,club_id,notes,created_by)
    VALUES(main_bank,'chip_balance','credit',v_amount,bank_after,'owner_retirement_pool',t.club_id,key,'2d1cd6c3-5700-4af9-a271-d4863fdab20d');
   FOR setting IN SELECT * FROM jsonb_each_text(saved) LOOP PERFORM set_config(setting.key,setting.value,true);END LOOP;
  ELSE bank_after:=bank_before;END IF;
 ELSE
  IF v_amount<>trunc(v_amount) THEN RAISE EXCEPTION 'owner_retirement_diamonds_must_be_whole';END IF;
  SELECT diamonds INTO bank_before FROM public.profiles WHERE id=kingfish AND lower(username)='kingfish' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owner_retirement_kingfish_identity_changed';END IF;
  IF v_amount>0 THEN
   credit:=public.add_diamonds_to_balance(kingfish,v_amount::integer,'arena_withdraw','Owner-directed retired tournament custody transfer',key);
   IF credit->>'success' IS DISTINCT FROM 'true' OR nullif(credit->>'transaction_id','') IS NULL
    THEN RAISE EXCEPTION 'owner_retirement_diamond_credit_failed';END IF;
   journal:=(credit->>'transaction_id')::uuid;
   FOR part IN SELECT * FROM (VALUES('prize',e.prize_balance),('bounty',e.bounty_balance),('fee',fee))x(bank,quantity) WHERE quantity>0 LOOP
    drains:=drains||jsonb_build_array(jsonb_build_object('bank',part.bank,'amount',part.quantity,'movements',
     public.fn_poker_diamond_tournament_drain(t.id,part.bank,part.quantity::bigint,key||':'||part.bank,'player:'||kingfish::text,journal)));
   END LOOP;
  END IF;
  SELECT diamonds INTO bank_after FROM public.profiles WHERE id=kingfish;
  IF bank_after IS DISTINCT FROM bank_before+v_amount THEN RAISE EXCEPTION 'owner_retirement_diamond_credit_unproven';END IF;
 END IF;
 answer:=jsonb_build_object('ok',true,'asset',intent.asset,'operation_id',p_operation_id,'tournament_id',t.id,
  'destination_id',intent.destination_id,'destination_wallet_id',bank_wallet,'key',key,'journal_id',journal,
  'prize',e.prize_balance-refunded_fee,'refund_fee_reserved',refunded_fee,'bounty',e.bounty_balance,'fee',fee,'amount',v_amount,
  'destination_before',bank_before,'destination_after',bank_after,'drains',drains,
  'member_club_fee_custody',CASE WHEN intent.asset='chips' THEN e.fee_balance+refunded_fee ELSE 0 END);
 INSERT INTO smarter_private.owner_retirement_pool_transfers(tournament_id,operation_id,asset,destination_id,prize,bounty,fee,refund_fee_reserved,receipt,transaction_id)
 VALUES(t.id,p_operation_id,intent.asset,intent.destination_id,e.prize_balance-refunded_fee,e.bounty_balance,fee,refunded_fee,answer,txid_current());
 -- The existing rake-settlement trigger applies the fee outflow exactly once later in this same transaction.
 PERFORM public.fn_ca_escrow_apply(t.id,'Owner-directed remaining custody transfer',p_prize_out=>e.prize_balance-refunded_fee,p_bounty_out=>e.bounty_balance,p_fee_entries_in=>refunded_fee);
 IF intent.asset='diamonds' THEN SELECT * INTO canonical FROM public.fn_poker_diamond_tournament_escrow(t.id);
 ELSE SELECT * INTO canonical FROM public.fn_ca_tournament_escrow_chips(t.id);END IF;
 IF canonical.prize_balance<>0 OR canonical.bounty_balance<>0 OR canonical.fee_balance IS DISTINCT FROM e.fee_balance+refunded_fee-fee
 THEN RAISE EXCEPTION 'owner_retirement_transfer_conservation_failed';END IF;
 IF intent.asset='diamonds' AND public.fn_poker_diamond_tournament_custody(t.id)<>0 THEN RAISE EXCEPTION 'owner_retirement_diamond_custody_not_zero';END IF;
 RETURN answer;
END $function$;
