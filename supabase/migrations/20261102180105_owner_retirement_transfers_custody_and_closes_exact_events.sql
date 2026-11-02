-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 18:01:05 UTC.
-- November 2 owner closure: immutable 140 older started events, no equal share.
-- Eligible Chips go to verified Midway Main Bank; Diamonds to verified KingFish.
-- The four verified human original charges require their bank-funded receipts.
-- Owner explicitly chose original-charge refund only for remaining cancellation
-- claims. Prior awards and recorded unpaid obligations remain protected.
-- Club-owned fee liabilities stay in the existing attributed fee settlement.
-- A transfer, custody discharge, administrative retirement and receipt are one
-- transaction. No accounting history is deleted; original IDs cannot restart.
-- Native tests use actual monetary writers, original journals, physical-boundary
-- fixtures, rollback, injected late failure, concurrent lanes and repeat calls.
-- No financial operation runs in this installation.
-- @live-proof: to_regprocedure('public.fn_ca_owner_retire_tournament(uuid,uuid,text)') IS NOT NULL AND has_function_privilege('service_role','public.fn_ca_owner_retire_tournament(uuid,uuid,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_owner_retire_tournament(uuid,uuid,text)','EXECUTE') AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='smarter_private.owner_retirement_pool_transfers'::regclass AND tgname='owner_retirement_transfer_must_close' AND tgenabled='O' AND tgdeferrable AND tginitdeferred)
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $pre$BEGIN
IF md5(pg_get_functiondef('public.fn_refuse_zero_chip_field_elimination()'::regprocedure)) IS DISTINCT FROM '8150bc16b61800e79d5355f1b3507a9a' THEN RAISE EXCEPTION 'owner_retirement_source_preimage_changed:%','public.fn_refuse_zero_chip_field_elimination()';END IF;
IF md5(pg_get_functiondef('public.fn_settle_tournament_rake(uuid,text)'::regprocedure)) IS DISTINCT FROM '4a3430c676cbe40f049b528123f36d1c' THEN RAISE EXCEPTION 'owner_retirement_source_preimage_changed:%','public.fn_settle_tournament_rake(uuid,text)';END IF;
IF md5(pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure)) IS DISTINCT FROM '255a830f5ecb4c6c1e7518fe33c4090c' THEN RAISE EXCEPTION 'owner_retirement_source_preimage_changed:%','public.fn_ca_tournament_escrow_chips(uuid)';END IF;
IF md5(pg_get_functiondef('public.fn_ca_tournament_cancellation_receipt(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'b6dad088592fcbbf313ddab376478532' THEN RAISE EXCEPTION 'owner_retirement_source_preimage_changed:%','public.fn_ca_tournament_cancellation_receipt(uuid,uuid)';END IF;
IF md5(pg_get_functiondef('public.fn_poker_diamond_tournament_escrow(uuid)'::regprocedure)) IS DISTINCT FROM '3b4597f68e207fd94ed339a9a7e5421b' THEN RAISE EXCEPTION 'owner_retirement_source_preimage_changed:%','public.fn_poker_diamond_tournament_escrow(uuid)';END IF;
IF md5(pg_get_functiondef('smarter_private.equal_share_retirement_must_close()'::regprocedure)) IS DISTINCT FROM 'd6711284f022f2ae11664d2ed3c50045' THEN RAISE EXCEPTION 'owner_retirement_source_preimage_changed:%','smarter_private.equal_share_retirement_must_close()';END IF;
END $pre$;
-- Exact immutable owner-directed disposition.
CREATE TABLE smarter_private.owner_retirement_pool_transfers (
 tournament_id uuid PRIMARY KEY, operation_id uuid NOT NULL,
 asset text NOT NULL CHECK(asset IN ('chips','diamonds')),
 destination_id uuid NOT NULL,
 prize numeric NOT NULL CHECK(prize>=0 AND prize=round(prize,2) AND prize::text NOT IN ('NaN','Infinity','-Infinity')),
 bounty numeric NOT NULL CHECK(bounty>=0 AND bounty=round(bounty,2) AND bounty::text NOT IN ('NaN','Infinity','-Infinity')),
 fee numeric NOT NULL CHECK(fee>=0 AND fee=round(fee,2) AND fee::text NOT IN ('NaN','Infinity','-Infinity')),
 refund_fee_reserved numeric NOT NULL CHECK(refund_fee_reserved>=0 AND refund_fee_reserved=round(refund_fee_reserved,2) AND refund_fee_reserved::text NOT IN ('NaN','Infinity','-Infinity')),
 receipt jsonb NOT NULL, transaction_id bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON smarter_private.owner_retirement_pool_transfers FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION smarter_private.owner_retirement_pool_transfer_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 RAISE EXCEPTION 'owner_retirement_pool_transfer_is_immutable' USING ERRCODE='55000';END$$;
REVOKE ALL ON FUNCTION smarter_private.owner_retirement_pool_transfer_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER owner_retirement_pool_transfer_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON smarter_private.owner_retirement_pool_transfers FOR EACH STATEMENT EXECUTE FUNCTION smarter_private.owner_retirement_pool_transfer_immutable();

CREATE FUNCTION smarter_private.owner_retirement_transfer_pools(p_operation_id uuid,p_tournament_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $function$
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
  IF prior IS NULL OR (prior->>'amount')::numeric IS DISTINCT FROM refundable.amount
   OR NOT EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=refundable.entitlement_id
    AND amount_paid_now=refundable.amount AND credit_ledger_id=(prior->'refund'->>'credit_ledger_id')::uuid)
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
REVOKE ALL ON FUNCTION smarter_private.owner_retirement_transfer_pools(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_escrow_chips(p_tournament_id uuid)
 RETURNS TABLE(prize_in numeric, bounty_in numeric, fee_in numeric, overlay_in numeric, satellite_in numeric, prize_out numeric, bounty_out numeric, fee_out numeric, refund_out numeric, prize_balance numeric, bounty_balance numeric, fee_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH owner_out AS (SELECT coalesce(sum(prize),0) prize,coalesce(sum(bounty),0) bounty,coalesce(sum(refund_fee_reserved),0) refund_fee FROM smarter_private.owner_retirement_pool_transfers WHERE tournament_id=p_tournament_id AND asset='chips'), t AS (
  SELECT id,COALESCE(buy_in_amount,0) AS buy_in_amount,
         COALESCE(buy_in_fee,0) AS buy_in_fee,
         COALESCE(bounty_amount,0) AS bounty_amount,
         (COALESCE(is_bounty,false) OR COALESCE(is_pko,false)
          OR COALESCE(is_mystery_bounty,false)) AS is_b
    FROM public.tournaments WHERE id=p_tournament_id
), w AS (
  SELECT
    COALESCE(sum(amount) FILTER (WHERE type='debit'
      AND category IN ('tournament_buyin','rebuy','addon')),0) AS gross_in,
    COALESCE(sum(amount) FILTER (WHERE type='credit' AND category='prize'),0)
      - COALESCE(sum(amount) FILTER (WHERE type='debit'
          AND category IN ('prize','prize_reversal')),0) AS prize_out,
    COALESCE(sum(amount) FILTER (WHERE type='credit' AND category='bounty'),0)
      AS bounty_out,
    COALESCE(sum(amount) FILTER (WHERE type='credit'
      AND category IN ('refund','tournament_refund')),0) AS refund_out
  FROM public.wallet_transactions WHERE related_entity_id=p_tournament_id
), direct_bounty AS (
  SELECT round(COALESCE(sum(CASE
    WHEN NOT t.is_b OR lower(l.category)='addon' THEN 0
    WHEN lower(l.category)='tournament_buyin' THEN round(t.bounty_amount,2)
    ELSE public.fn_ca_unit_floor_cents(
      round(LEAST(
        GREATEST(0,round(t.bounty_amount,2)),
        round(l.amount,2)-public.fn_ca_recovery_fee_cents(
          round(round(l.amount,2)*100)::bigint,
          public.fn_ca_tournament_fee_ratio(t.buy_in_amount,t.buy_in_fee),
          public.fn_ca_tournament_unit_cents(p_tournament_id))::numeric/100
      )*100)::bigint,
      public.fn_ca_tournament_unit_cents(p_tournament_id))::numeric/100    END),0),2) AS amount
  FROM t JOIN public.chip_ledger l
    ON l.tournament_id=p_tournament_id
   AND l.from_type='player_wallet' AND l.to_type='prize_liability'
   AND l.to_entity_id=p_tournament_id
   AND lower(l.category) IN ('tournament_buyin','rebuy','addon')
), rr AS (
  SELECT
    COALESCE(sum(rake_amount),0) AS fee_in,
    COALESCE(sum(rake_amount) FILTER (
      WHERE source='fn_award_satellite_seat'),0) AS fee_sat,
    COALESCE(sum(rake_amount) FILTER (
      WHERE source='fn_award_satellite_seat'
        AND metadata->>'entry_split_version'='2'),0) AS fee_sat_split,
    COALESCE(sum(COALESCE(pot_size,0)-rake_amount) FILTER (
      WHERE source='fn_award_satellite_seat'),0) AS satellite_in
  FROM public.rake_records
  WHERE tournament_id=p_tournament_id AND is_tournament
    AND NOT (rake_amount<0 AND source IN (
      'atomic_cancel_tournament','fn_unregister_from_tournament'))
), ov AS (
  /* A REVIEWED VOID RETURNS ITS OVERLAY (2026-09-27). The void of a retired
     event (smarter_private.f06_void_retired_mixed_custody_event) sends the
     guarantee overlay back to its funder as one 'reversal' leg out of
     prize_liability, and takes it out of the maintained escrow. The shadow
     nets it too, or it reads the returned overlay as money still in the pool. */
  SELECT COALESCE(sum(a.amount),0) AS ledger_overlay,
         (SELECT COALESCE(sum(r.amount),0) FROM public.chip_ledger r
     WHERE r.tournament_id=p_tournament_id AND r.category='reversal'
       AND r.from_type='prize_liability' AND r.from_entity_id=p_tournament_id
       AND r.metadata->>'kind'='reviewed_void_overlay_return') AS returned
    FROM public.chip_ledger a
   WHERE a.to_entity_id=p_tournament_id
     AND a.to_type='prize_liability'
     AND (a.category='overlay' OR
       (a.category='correction' AND a.from_type IN ('union_bank','club_treasury')))
     AND NOT (COALESCE(a.description,'') LIKE 'auto-ledgered%'
       AND EXISTS (
         SELECT 1 FROM public.chip_ledger b
          WHERE b.to_entity_id=a.to_entity_id AND b.category='overlay'
            AND b.to_type='prize_liability' AND b.id<>a.id
            AND b.amount=a.amount
            AND COALESCE(b.description,'') NOT LIKE 'auto-ledgered%'
            AND abs(extract(epoch FROM (b.created_at-a.created_at)))<5))
), stl AS (
  SELECT COALESCE(sum(amount),0) AS moved,
    COALESCE(sum(amount) FILTER (
      WHERE metadata->>'entry_split_version'='2'),0) AS split_moved,
    COALESCE(sum((metadata->>'entry_fee')::numeric) FILTER (
      WHERE metadata->>'entry_split_version'='2'),0) AS split_fee,
    COALESCE(sum((metadata->>'entry_bounty')::numeric) FILTER (
      WHERE metadata->>'entry_split_version'='2'),0) AS split_bounty
  FROM public.chip_ledger
  WHERE to_entity_id=p_tournament_id AND to_type='prize_liability'
    AND idempotency_key LIKE 'tourney:%:seat:%:pool_transfer'
), tk AS (
  /* A TICKET ENTRY IS AN ENTRY (2026-09-10): a tournament-entry ticket
     redeemed into this event moves its value escrow -> prize_liability
     with no wallet debit and no pool transfer; the escrow triggers count
     it as an entry and so must the shadow. */
  SELECT COALESCE(sum(amount),0) AS ticket_in,
         COALESCE(sum((metadata->>'entry_bounty')::numeric),0) AS ticket_bounty
    FROM public.chip_ledger
   WHERE to_entity_id=p_tournament_id AND to_type='prize_liability'
     AND from_type='escrow' AND category='ticket_redeem'
), tgo AS (
  SELECT COALESCE(sum(amount),0) AS tgo_amount
    FROM public.tournament_guarantee_overlays
   WHERE tournament_id=p_tournament_id
), sat AS (
  SELECT COALESCE(sum(p.amount),0) AS funded_awards_out
    FROM public.tournament_payouts p
    LEFT JOIN public.tournament_satellite_awards a
      ON a.payout_id=p.id
     AND a.tournament_id=p.tournament_id
     AND a.delivery_kind='ticket'
   WHERE p.tournament_id=p_tournament_id
     AND (p.source='satellite_seat'
       OR (p.source='satellite_ticket' AND a.payout_id IS NOT NULL))
), fo AS (
  SELECT COALESCE(sum(amount),0) AS fee_out
    FROM public.tournament_rake_settlements
   WHERE tournament_id=p_tournament_id AND settled_at IS NOT NULL
), exact_refunds AS (
  SELECT COALESCE(sum(amount_paid_now),0) AS total,
         COALESCE(sum(refund_prize),0) AS prize,
         COALESCE(sum(refund_bounty),0) AS bounty,
         COALESCE(sum(refund_fee),0) AS fee
    FROM public.tournament_refund_tranches
   WHERE tournament_id=p_tournament_id
), calc AS (
  SELECT
    round(w.gross_in+stl.split_moved-stl.split_fee+tk.ticket_in,2) AS gross_in,
    round(rr.fee_in+owner_out.refund_fee,2) AS fee_in,
    round(rr.fee_in-rr.fee_sat+owner_out.refund_fee,2) AS fee_entries,
    round(direct_bounty.amount+stl.split_bounty+tk.ticket_bounty,2) AS bounty_in,
    round(CASE WHEN ov.ledger_overlay>0 THEN ov.ledger_overlay
      ELSE tgo.tgo_amount END-ov.returned,2) AS overlay_in,
    round(stl.moved-stl.split_moved-rr.fee_sat+rr.fee_sat_split,2)
      AS satellite_in,
    round(w.prize_out+sat.funded_awards_out+owner_out.prize,2) AS prize_out,
    round(w.bounty_out+owner_out.bounty,2) AS bounty_out,
    round(fo.fee_out,2) AS fee_out,
    round(w.refund_out,2) AS refund_out,
    round(exact_refunds.total,2) AS exact_total,
    round(exact_refunds.prize,2) AS exact_prize,
    round(exact_refunds.bounty,2) AS exact_bounty,
    round(exact_refunds.fee,2) AS exact_fee
  FROM t,w,direct_bounty,rr,stl,ov,tk,tgo,sat,fo,exact_refunds,owner_out
), split AS (
  SELECT c.*,round(c.gross_in-c.fee_entries-c.bounty_in,2) AS prize_in,
         round(c.refund_out-c.exact_total,2) AS legacy_refund
    FROM calc c
), apportioned AS (
  SELECT s.*,
    CASE WHEN (s.prize_in+s.satellite_in+s.bounty_in+s.fee_in)>0
      THEN round(s.legacy_refund*(s.prize_in+s.satellite_in)
        /(s.prize_in+s.satellite_in+s.bounty_in+s.fee_in),2)
      ELSE s.legacy_refund END AS legacy_prize,
    CASE WHEN (s.prize_in+s.satellite_in+s.bounty_in+s.fee_in)>0
      THEN round(s.legacy_refund*s.bounty_in
        /(s.prize_in+s.satellite_in+s.bounty_in+s.fee_in),2)
      ELSE 0 END AS legacy_bounty
  FROM split s
)
SELECT a.prize_in,a.bounty_in,a.fee_in,a.overlay_in,a.satellite_in,
       a.prize_out,a.bounty_out,a.fee_out,a.refund_out,
       round(a.prize_in+a.overlay_in+a.satellite_in-a.prize_out
         -a.legacy_prize-a.exact_prize,2) AS prize_balance,
       round(a.bounty_in-a.bounty_out-a.legacy_bounty-a.exact_bounty,2)
         AS bounty_balance,
       round(a.fee_in-a.fee_out
         -(a.legacy_refund-a.legacy_prize-a.legacy_bounty)-a.exact_fee,2)
         AS fee_balance
  FROM apportioned a;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_poker_diamond_tournament_escrow(p_tournament_id uuid)
 RETURNS TABLE(prize_in numeric, bounty_in numeric, fee_in numeric, overlay_in numeric, satellite_in numeric, prize_out numeric, bounty_out numeric, fee_out numeric, refund_out numeric, prize_balance numeric, bounty_balance numeric, fee_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH owner_out AS (SELECT coalesce(sum(prize),0) prize,coalesce(sum(bounty),0) bounty,coalesce(sum(fee),0) fee FROM smarter_private.owner_retirement_pool_transfers WHERE tournament_id=p_tournament_id AND asset='diamonds'), l AS (
    SELECT
      COALESCE(sum(prize_part)  FILTER (WHERE kind IN ('entry','rebuy','reentry','addon')),0) AS prize_in,
      COALESCE(sum(bounty_part) FILTER (WHERE kind IN ('entry','rebuy','reentry','addon')),0) AS bounty_in,
      COALESCE(sum(fee_part)    FILTER (WHERE kind IN ('entry','rebuy','reentry','addon')),0) AS fee_in,
      COALESCE(sum(amount)      FILTER (WHERE kind = 'prize'),0)  AS prize_out,
      COALESCE(sum(amount)      FILTER (WHERE kind = 'bounty'),0) AS bounty_out,
      COALESCE(sum(amount)      FILTER (WHERE kind = 'fee'),0)    AS fee_out,
      COALESCE(sum(amount)      FILTER (WHERE kind = 'refund'),0) AS refund_out,
      COALESCE(sum(prize_part)  FILTER (WHERE kind = 'refund'),0) AS refund_prize,
      COALESCE(sum(bounty_part) FILTER (WHERE kind = 'refund'),0) AS refund_bounty,
      COALESCE(sum(fee_part)    FILTER (WHERE kind = 'refund'),0) AS refund_fee,
      -- DIAMOND PHASE 9: a Spin's reserve legs move its prize bank, whole.
      COALESCE(sum(amount)      FILTER (WHERE kind = 'spin_underwrite'),0) AS spin_underwrite,
      COALESCE(sum(amount)      FILTER (WHERE kind = 'spin_surplus'),0) AS spin_surplus,
      -- 2026-10-06: a guarantee's overlay legs move it too, whole.
      COALESCE(sum(amount)      FILTER (WHERE kind = 'overlay'),0) AS overlay,
      COALESCE(sum(amount)      FILTER (WHERE kind = 'overlay_return'),0) AS overlay_return
    FROM public.poker_diamond_tournament_ledger WHERE tournament_id = p_tournament_id)
  SELECT prize_in::numeric, bounty_in::numeric, fee_in::numeric, (overlay - overlay_return)::numeric, 0::numeric,
         (prize_out+owner_out.prize)::numeric, (bounty_out+owner_out.bounty)::numeric, (fee_out+owner_out.fee)::numeric, refund_out::numeric,
         (prize_in + spin_underwrite - spin_surplus + overlay - overlay_return - prize_out - owner_out.prize - refund_prize)::numeric,
         (bounty_in - bounty_out - owner_out.bounty - refund_bounty)::numeric,
         (fee_in - fee_out - owner_out.fee - refund_fee)::numeric
  FROM l,owner_out;
$function$

;
CREATE OR REPLACE FUNCTION public.fn_settle_tournament_rake(p_tournament_id uuid, p_source text DEFAULT 'engine'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
 v_t record;v_prior record;v_claimed int;v_plan jsonb;v_att jsonb;v_res jsonb;
 v_net numeric;v_union uuid;v_dest text;v_reason text;v_raw record;v_bank_id uuid;v_journal_id uuid;v_matches int;
 v_week_start timestamptz;v_week_end timestamptz;v_lock_key text;v_attempt int:=0;
BEGIN
 PERFORM public.fn_ca_lock_settlement_lane_global();
 SELECT t.id,t.status,t.club_id,t.union_id,t.is_private,t.name,t.current_players INTO v_t
  FROM public.tournaments t WHERE t.id=p_tournament_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF upper(COALESCE(v_t.status,'')) NOT IN('COMPLETING','COMPLETED','CANCELLED','CANCELED') THEN
  RETURN jsonb_build_object('ok',false,'reason','not_terminal','status',v_t.status); END IF;
 PERFORM public.fn_ca_begin_legacy_fee_resolution(p_tournament_id);
 INSERT INTO public.tournament_rake_settlements(tournament_id,club_id,amount,destination,source)
 VALUES(p_tournament_id,v_t.club_id,0,'pending',COALESCE(p_source,'engine')) ON CONFLICT(tournament_id) DO NOTHING;
 GET DIAGNOSTICS v_claimed=ROW_COUNT;
 IF v_claimed=0 THEN
  SELECT * INTO v_prior FROM public.tournament_rake_settlements WHERE tournament_id=p_tournament_id;
  -- Historical claims do not authorize another fee transfer or a success
  -- claim unless their stored attribution actually completed.
  IF v_prior.settled_at IS NULL OR v_prior.attributed_at IS NULL
   OR v_prior.attributed_users IS NULL OR v_prior.attributed_users<0
   OR v_prior.attribution_error IS NOT NULL
   OR NULLIF(v_prior.destination,'') IS NULL OR v_prior.destination='pending' THEN
   RETURN jsonb_build_object('ok',false,'already_settled',true,
    'reason','settlement_attribution_incomplete','amount',v_prior.amount,
    'destination',v_prior.destination,'settled_at',v_prior.settled_at,'attributed',false);
  END IF;
  IF v_prior.amount>0 AND v_prior.union_id IS NULL AND NOT public.fn_poker_diamond_tournament(p_tournament_id)
   AND v_prior.destination IS DISTINCT FROM 'chip_retirement:'||v_prior.club_id::text THEN
   RAISE EXCEPTION 'tournament_fee_legacy_treasury_leg_requires_adjustment' USING ERRCODE='55000'; END IF;
  v_att:=public.fn_accounting_tournament_terminal_fee_receipt(p_tournament_id);
  IF v_prior.amount>0 AND v_prior.union_id IS NULL AND NOT public.fn_poker_diamond_tournament(p_tournament_id) AND v_att IS NULL THEN
   RAISE EXCEPTION 'tournament_fee_disposition_receipt_missing' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('ok',true,'already_settled',true,'amount',v_prior.amount,'destination',v_prior.destination,
    'settled_at',v_prior.settled_at,'attributed',true,'attributed_users',v_prior.attributed_users,
    'no_attribution_due',v_prior.amount=0,'accounting',v_att);
 END IF;
  -- DIAMOND PHASE 8: a Diamond event's fee sits in its custody rows, not in
  -- rake_records; it goes to the house, and then the emptied custody closes.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    IF EXISTS(SELECT 1 FROM smarter_private.owner_retirement_pool_transfers x
      JOIN smarter_private.owner_tournament_deletion_intents i USING(tournament_id)
      WHERE x.tournament_id=p_tournament_id AND x.asset='diamonds' AND x.destination_id=i.destination_id
      AND x.transaction_id=txid_current()) THEN
     SELECT x.fee,'player:'||x.destination_id::text INTO v_net,v_dest
      FROM smarter_private.owner_retirement_pool_transfers x WHERE x.tournament_id=p_tournament_id;
     IF public.fn_poker_diamond_tournament_custody(p_tournament_id)<>0 THEN
      RAISE EXCEPTION 'owner_retirement_fee_custody_not_zero';END IF;
     UPDATE public.tournament_rake_settlements SET amount=v_net,destination=v_dest,
      settled_at=now(),attributed_at=now(),attributed_users=0 WHERE tournament_id=p_tournament_id;
     v_res:=public.fn_poker_diamond_tournament_close_custody(p_tournament_id);
     IF (v_res->>'still_held')::integer IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'owner_retirement_custody_close_incomplete';END IF;
     RETURN jsonb_build_object('ok',true,'amount',v_net,'destination',v_dest,'attributed',true,
      'attributed_users',0,'members',0,'asset','diamonds','custody_closed',v_res->>'closed','custody_still_held',0);
    END IF;
    v_res := public.fn_poker_diamond_tournament_settle_fee(p_tournament_id, COALESCE(p_source, 'engine'));
    v_net := COALESCE((v_res->>'amount')::numeric, 0);
    UPDATE public.tournament_rake_settlements
       SET amount = v_net,
           destination = CASE WHEN v_net > 0 THEN 'diamond_house' ELSE 'none' END,
           settled_at = now(), attributed_at = now(), attributed_users = 0
     WHERE tournament_id = p_tournament_id;
    v_res := public.fn_poker_diamond_tournament_close_custody(p_tournament_id);
    RETURN jsonb_build_object('ok', true, 'amount', v_net,
      'destination', CASE WHEN v_net > 0 THEN 'diamond_house' ELSE 'none' END,
      'attributed', true, 'attributed_users', 0, 'members', 0, 'asset', 'diamonds',
      'custody_closed', v_res->>'closed', 'custody_still_held', v_res->>'still_held');
  END IF;

 -- Deferred capture is normally already committed. A same-transaction Spin
 -- close still captures the original exact charge before it can be recognized.
 FOR v_raw IN SELECT r.id FROM public.rake_records r WHERE r.tournament_id=p_tournament_id AND r.is_tournament
  AND r.rake_amount>0 AND r.created_at=transaction_timestamp()
  AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_batches b WHERE b.rake_record_id=r.id) ORDER BY r.id LOOP
  PERFORM public.fn_stamp_accounting_tournament_fee(v_raw.id);
 END LOOP;
 -- 2026-09-20. A fee charged BEFORE the cutover was never captured by a
 -- producer, and fn_ca_capture_tournament_fee_from_recorded_evidence - the
 -- reader built for exactly that record - was reachable only from
 -- fn_ca_begin_legacy_fee_resolution, which does nothing unless the event
 -- already holds a custody obligation, which only a named event can get.
 -- So the reader was never called for an event that was not on a list.
 -- Call it here, on the ordinary close, while the event is COMPLETING.
 -- Each capture takes its own subtransaction: one that cannot prove itself
 -- rolls back alone and leaves its record exactly as it was, so the net
 -- plan below still refuses in the same words and legacy custody still
 -- receives the same reason. This can only add proof, never remove it.
 FOR v_raw IN SELECT r.id FROM public.rake_records r
   JOIN public.accounting_tournament_fee_cutover c ON c.singleton
  WHERE r.tournament_id=p_tournament_id AND r.is_tournament
    AND r.rake_amount>0 AND r.hand_id IS NULL AND r.created_at<c.starts_at
    AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_batches b WHERE b.rake_record_id=r.id)
  ORDER BY r.id LOOP
  BEGIN
   PERFORM public.fn_ca_capture_tournament_fee_from_recorded_evidence(v_raw.id);
  EXCEPTION WHEN OTHERS THEN
   -- Not silence: the reason travels to the log, and the refusal that
   -- follows is unchanged. "Could not prove it" is not "there was nothing".
   RAISE NOTICE 'pre-cutover fee % left uncaptured: % (%)', v_raw.id, SQLERRM, SQLSTATE;
  END;
 END LOOP;
 SELECT COALESCE(sum(r.rake_amount),0) INTO v_net FROM public.rake_records r WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
 IF v_net<0 OR v_net<>round(v_net,2) OR v_net::text IN('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'tournament_fee_net_invalid' USING ERRCODE='23514'; END IF;
 BEGIN
  -- Qualify only this owning close's complete original mixed-cutover Spin
  -- receipts. The original batch remains unchanged; any failure below rolls
  -- proof, source rows, claim, bank transfer and recognition back together.
  FOR v_raw IN SELECT r.id FROM public.rake_records r
   JOIN public.accounting_tournament_fee_batches b ON b.rake_record_id=r.id
   JOIN public.accounting_tournament_fee_cutover c ON c.singleton
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament AND r.rake_amount>0
    AND r.source='fn_spin_book_entry' AND r.created_at>=c.starts_at
    AND b.status='legacy_unverified' AND b.source_manifest IS NULL ORDER BY r.id LOOP
   PERFORM public.fn_accounting_qualify_mixed_cutover_spin_fee(v_raw.id);
  END LOOP;
  -- Original close owns deferred capture, source proof, player money and
  -- fee recognition in one transaction. No worker or scheduled repair.
  FOR v_raw IN SELECT r.id FROM public.rake_records r
   JOIN public.accounting_tournament_fee_batches b ON b.rake_record_id=r.id
   CROSS JOIN public.accounting_owner_direct_fee_incident i
   WHERE i.singleton AND r.tournament_id=p_tournament_id AND r.is_tournament AND r.rake_amount>0
    AND r.created_at>=i.starts_at AND r.created_at<i.ends_at
    AND b.status='legacy_unverified' AND b.source_manifest->>'capture_reason'='accounting_terms_not_observed'
   ORDER BY r.id LOOP
   PERFORM public.fn_accounting_qualify_owner_direct_fee(v_raw.id);
  END LOOP;
  v_plan:=public.fn_accounting_tournament_fee_net_plan(p_tournament_id);
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM NOT IN('tournament_fee_sources_require_reconciliation','accounting_terms_not_observed','accounting_terms_not_active','tournament_fee_not_captured_by_original_producer') THEN RAISE; END IF;
  v_reason:=SQLERRM;
  -- A new positive fee cannot leave custody before its exact attribution is
  -- available. Throw: direct callers must also roll back the inserted claim.
  IF v_net>0 THEN
   RAISE EXCEPTION 'tournament % rake attribution incomplete: %',p_tournament_id,v_reason USING ERRCODE='P0404';
  END IF;
  -- Exact zero owes no new attribution. Preserve the predecessor's zero-fee
  -- completion without inventing a source, bank, commission or paid receipt.
 END;
 v_union:=CASE WHEN v_reason IS NULL THEN NULLIF(v_plan->>'union_id','')::uuid
  WHEN v_t.is_private THEN NULL ELSE v_t.union_id END;
 PERFORM public.fn_lock_accounting_tournament_recognition_week(p_tournament_id,transaction_timestamp());
 -- A legacy event may have no captured contributor scope. Its actual bank
 -- still takes the exact same close lock, before either wallet is touched.
 v_week_start:=public.fn_union_week_start(transaction_timestamp());
 v_week_end:=((v_week_start AT TIME ZONE 'America/Los_Angeles')+interval '7 days') AT TIME ZONE 'America/Los_Angeles';
 v_lock_key:=CASE WHEN v_union IS NULL THEN 'club-accounting:'||v_t.club_id::text ELSE 'union-accounting:'||v_union::text END
  ||':'||extract(epoch FROM v_week_start)::text||':'||extract(epoch FROM v_week_end)::text;
 IF v_lock_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended(v_lock_key,0)); END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_routed_settlement_runs x WHERE x.period_start<=transaction_timestamp() AND x.period_end>transaction_timestamp()
   AND ((v_union IS NOT NULL AND x.union_id=v_union) OR(v_union IS NULL AND x.standalone_club_id=v_t.club_id))) THEN
  RAISE EXCEPTION 'tournament_accrual_closed_period_requires_adjustment' USING ERRCODE='23514'; END IF;
 IF v_net>0 THEN
  IF v_t.club_id IS NULL THEN RAISE EXCEPTION 'tournament_fee_bank_club_required' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.club_wallets WHERE club_id=v_t.club_id FOR NO KEY UPDATE;
  PERFORM set_config('app.ledger_category','rake',true);
  PERFORM set_config('app.ledger_counterparty','prize_liability',true);
  PERFORM set_config('app.ledger_counterparty_entity',p_tournament_id::text,true);
  /* THE TOURNAMENT RAKE LEG NAMES THE CLUB IT WAS EARNED IN (2026-09-21).
     The union fee is routed by UPDATE-ing union_wallets.rake_wallet through
     increment_union_wallet; fn_ca_autoledger journals that delta, and
     union_wallets has no club_id column, so every tournament union rake leg
     was written club-less. 20260920192513 taught the autoledger to read a
     declaring payer and fixed the PRIZE legs; 20260921040847 made the
     cash-table rake payer declare; this is the tournament rake payer saying
     the same thing. v_t.club_id is refused NULL above, and is the same club
     handed to increment_union_wallet for union_wallet_transactions.club_id,
     so the leg and its sibling receipt name one club or the fee does not
     move at all. NOT app.ledger_club_id: that name decides which club a
     WALLET credit is paid into (atomic_credit_wallet_and_log) and is set and
     restored by the rakeback close, so clearing it here would move money. */
  PERFORM set_config('app.ledger_autoledger_club_id',COALESCE(v_t.club_id::text,''),true);
  IF v_union IS NOT NULL THEN
   v_res:=public.increment_union_wallet(v_union,v_net,v_t.club_id,
    'Tournament rake: '||COALESCE(v_t.name,'tournament')||' [tournament '||p_tournament_id::text||']');
   IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'tournament_fee_union_credit_failed' USING ERRCODE='23514'; END IF;
   SELECT count(*),(array_agg(id))[1] INTO v_matches,v_bank_id FROM public.union_wallet_transactions
    WHERE union_id=v_union AND club_id=v_t.club_id AND wallet='rake_wallet' AND direction='credit' AND tx_type='rake'
     AND amount=v_net AND created_at=transaction_timestamp() AND position('[tournament '||p_tournament_id::text||']' IN COALESCE(notes,''))>0;
   v_dest:='union:'||v_union::text;
  ELSE
   -- The original settlement-row trigger removes this exact fee from escrow.
   -- Retire that liability in the canonical journal; never debit a treasury or
   -- call fn_ca_burn, which would take these same chips from a wallet again.
   UPDATE public.clubs SET total_rake=COALESCE(total_rake,0)+v_net,updated_at=now()
    WHERE id=v_t.club_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'tournament_fee_club_missing' USING ERRCODE='23514'; END IF;
   INSERT INTO public.chip_ledger
    (performed_by,from_type,from_entity_id,to_type,to_entity_id,club_id,tournament_id,category,amount,description)
   VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
    'prize_liability',p_tournament_id,'chip_retirement',NULL,v_t.club_id,p_tournament_id,'burn',v_net,
    'Standalone tournament fee retired (fn_settle_tournament_rake)') RETURNING id INTO v_journal_id;
   v_matches:=1;
   v_dest:='chip_retirement:'||v_t.club_id::text;
  END IF;
  IF v_matches<>1 THEN RAISE EXCEPTION 'tournament_fee_exact_bank_receipt_required' USING ERRCODE='23514'; END IF;
  UPDATE public.club_wallets SET period_rake_collected=COALESCE(period_rake_collected,0)+v_net,
   lifetime_rake_collected=COALESCE(lifetime_rake_collected,0)+v_net,updated_at=now() WHERE club_id=v_t.club_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tournament_fee_club_wallet_missing' USING ERRCODE='23514'; END IF;
  PERFORM set_config('app.ledger_autoledger_club_id','',true);
 ELSE v_dest:='none'; END IF;
 IF v_reason IS NULL THEN
  -- Preserve the installed bounded retry contract, now around the sole
  -- canonical recognition writer. Exhaustion and permanent errors escape the
  -- whole settlement; rolled-back attempts cannot retain partial attribution.
  LOOP
   v_attempt:=v_attempt+1;
   BEGIN
    v_att:=public.fn_recognize_accounting_tournament_fees(p_tournament_id,transaction_timestamp(),v_t.club_id,v_bank_id,v_journal_id);
    EXIT;
   EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    IF v_attempt>=4 THEN RAISE; END IF;
    PERFORM pg_sleep(CASE v_attempt WHEN 1 THEN 0.1 WHEN 2 THEN 0.3 ELSE 0.6 END);
   END;
  END LOOP;
  IF v_att->>'status' IS DISTINCT FROM (CASE WHEN v_net>0 THEN 'recognized' ELSE 'cancelled' END)
   OR (v_att->>'attributed_chips')::numeric IS DISTINCT FROM v_net
   OR (v_net>0 AND COALESCE((v_att->>'attributed_users')::int,0)<1) THEN
   RAISE EXCEPTION 'tournament % rake attribution incomplete: canonical source receipt',p_tournament_id USING ERRCODE='P0404';
  END IF;
 END IF;
 UPDATE public.tournament_rake_settlements SET amount=v_net,union_id=v_union,destination=v_dest,settled_at=transaction_timestamp(),
  attributed_at=transaction_timestamp(),attributed_users=COALESCE((v_att->>'attributed_users')::int,0),
  attribution_error=NULL WHERE tournament_id=p_tournament_id;
 IF EXISTS(SELECT 1 FROM public.accounting_tournament_fee_custody_resolutions WHERE tournament_id=p_tournament_id AND transaction_id=txid_current()) THEN
  UPDATE public.tournament_rake_settlements SET terminal_closed_at=(SELECT completed_at FROM public.tournament_terminal_settlements WHERE tournament_id=p_tournament_id) WHERE tournament_id=p_tournament_id AND terminal_closed_at IS NULL;
 END IF;
 RETURN jsonb_build_object('ok',true,'amount',v_net,'destination',v_dest,'attributed',true,
  'attributed_users',COALESCE((v_att->>'attributed_users')::int,0),'attribution_attempts',v_attempt,
  'no_attribution_due',v_net=0,'accounting',public.fn_accounting_tournament_terminal_fee_receipt(p_tournament_id));
END;
$function$
;
INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES('fn_ca_owner_retire_tournament','approved','Exact immutable owner manifest; verified boundary and refunds; atomic custody transfer and terminal receipt') ON CONFLICT(proname) DO NOTHING;
DO $$BEGIN IF (SELECT status FROM public.ca_money_rpc_registry WHERE proname='fn_ca_owner_retire_tournament') IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'owner_retirement_money_authority_not_approved' USING ERRCODE='42501';END IF;END$$;
CREATE OR REPLACE FUNCTION public.fn_ca_owner_retire_tournament(p_operation_id uuid, p_tournament_id uuid, p_expected_money_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE a smarter_private.tournament_abort_targets;t public.tournaments; financial jsonb; v_receipt jsonb; pre_roster jsonb; pre_seats jsonb; before_history jsonb; after_history jsonb;
 player_ids uuid[];refunded_ids uuid[];zero_ids uuid[];table_ids uuid[];seat_ids uuid[];released_ids uuid[];fee_ids uuid[]:='{}';
 fee record;fee_id uuid; rake_before numeric;rake_after numeric;fees_reversed numeric:=0; settled timestamptz:=clock_timestamp();
 recipient record;bank record;prize_units numeric;bounty_units numeric;total_units numeric;unit_scale numeric;n integer;ordinal integer:=0;share_units numeric;prize_part numeric;bounty_part numeric;key text;shares jsonb:='[]';prior_payouts jsonb;fee_receipt jsonb;
 actor constant uuid:='2d1cd6c3-5700-4af9-a271-d4863fdab20d'; v_close_note constant text:='Owner-directed permanent retirement after verified refunds and generation-bound physical drain';
BEGIN
 PERFORM smarter_private.cancellation_lane(p_tournament_id);
 PERFORM smarter_private.assert_tournament_abort_not_recovered(p_operation_id,p_tournament_id);
 IF auth.role() IS DISTINCT FROM 'service_role' AND NOT (session_user='postgres' AND coalesce(current_setting('role',true),'none') IN ('none','postgres') AND auth.role() IS NULL) THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'owner_retirement_platform_frozen' USING ERRCODE='55000';END IF;
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE operation_id=p_operation_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'operator_abort_target_not_owned';END IF;
 IF a.state='settled' THEN
  IF a.receipt->>'mode' IS DISTINCT FROM 'started_owner_retirement' THEN RAISE EXCEPTION 'operator_abort_disposition_already_committed';END IF;
  RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id);END IF;
 PERFORM smarter_private.assert_tournament_abort_quiesced(p_operation_id,p_tournament_id);
 IF p_expected_money_hash IS NULL OR p_expected_money_hash IS DISTINCT FROM a.quiescence->>'money_hash' THEN RAISE EXCEPTION 'operator_abort_review_hash_mismatch' USING ERRCODE='55000';END IF;
 IF t.started_at IS NULL OR upper(t.status) NOT IN('RUNNING','BREAK','LATE_REG') THEN RAISE EXCEPTION 'operator_abort_parent_not_running';END IF;
 PERFORM 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.tables WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id ORDER BY s.id FOR UPDATE OF s;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'),coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') INTO player_ids,pre_roster FROM public.tournament_players p WHERE tournament_id=p_tournament_id;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO table_ids FROM public.tables WHERE tournament_id=p_tournament_id;
 SELECT coalesce(array_agg(s.id ORDER BY s.id),'{}') INTO seat_ids FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'table_id',s.table_id,'user_id',s.user_id,'seat_number',s.seat_number,'stack',s.stack,'status',s.status,'left_at',s.left_at,'occupancy_id',to_jsonb(s)->'occupancy_id') ORDER BY s.id),'[]'::jsonb) INTO pre_seats FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id;
 SELECT coalesce(array_agg(s.id ORDER BY s.id),'{}') INTO released_ids FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id AND s.left_at IS NULL;
 before_history:=jsonb_build_object('awards',a.money_snapshot->'awards','bounty_awards',a.money_snapshot->'bounty_awards','satellite_awards',a.money_snapshot->'satellite_awards',
  'hands',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id)::text,'[]')) FROM public.hand_history h WHERE h.tournament_id=p_tournament_id));
 -- Earned unpaid claims are never silently reclassified as shares.
 IF EXISTS(SELECT 1 FROM public.tournament_obligations WHERE tournament_id=p_tournament_id AND amount_owed>amount_paid) THEN RAISE EXCEPTION 'owner_retirement_earned_obligation_unpaid';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p)-'terminal_closed_at' ORDER BY id),'[]') INTO prior_payouts FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id;
 financial:=smarter_private.owner_retirement_transfer_pools(p_operation_id,p_tournament_id)
  ||jsonb_build_object('fully_settled',true,'refunds','[]'::jsonb,'total_refunded',0,
   'original_refunds',(SELECT coalesce(jsonb_agg(r.receipt ORDER BY r.entitlement_id),'[]') FROM smarter_private.owner_retirement_bank_refunds r WHERE r.tournament_id=p_tournament_id));
 SELECT CASE WHEN a.asset='diamonds' THEN coalesce(t.total_rake,0) ELSE coalesce(sum(rake_amount),0) END INTO rake_before FROM public.rake_records WHERE tournament_id=p_tournament_id AND is_tournament;
 IF rake_before<0 OR rake_before::text IN('NaN','Infinity','-Infinity') OR (a.asset='chips' AND round(coalesce(t.total_rake,0),2) IS DISTINCT FROM rake_before) THEN RAISE EXCEPTION 'owner_retirement_rake_cache_mismatch';END IF;
 UPDATE public.tournaments SET status='COMPLETING',current_players=0 WHERE id=p_tournament_id;
 fee_receipt:=public.fn_settle_tournament_rake(p_tournament_id,'owner_retirement');
 IF fee_receipt->>'ok' IS DISTINCT FROM 'true' OR fee_receipt->>'attributed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'owner_retirement_fee_settlement_incomplete:%',fee_receipt;END IF;
 rake_after:=rake_before;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id=p_tournament_id AND enforced AND closed_at IS NULL AND prize_balance=0 AND bounty_balance=0 AND fee_balance=0) THEN RAISE EXCEPTION 'operator_abort_escrow_not_exact_zero';END IF;
 UPDATE public.tournament_escrow SET closed_at=settled,close_note=v_close_note,updated_at=now() WHERE tournament_id=p_tournament_id;
 -- A transaction-bound administrative retirement is not a poker bust. The
 -- deferred admission constraint demands this transaction's canonical receipt.
 UPDATE smarter_private.tournament_abort_targets SET receipt=jsonb_build_object('mode','owner_retirement_admission','transaction_id',txid_current()) WHERE tournament_id=p_tournament_id AND operation_id=p_operation_id AND state='quiesced';
 -- Keep original eliminated_at, elimination sequence, finish position and prize.
 -- Active remaining virtual stacks are administrative retirements, not results.
 UPDATE public.tournament_players SET status='eliminated',chips=0,current_bounty=0 WHERE tournament_id=p_tournament_id AND status::text<>'eliminated';
 -- owner_retirement_preactivation_mystery_cache: these busts earned no bounty.
 -- The original roster above retains every head and elimination witness.
 IF t.is_mystery_bounty IS TRUE AND coalesce(t.is_pko,false)=false
 AND t.mystery_bounty_stage='pending' AND t.mystery_bounty_regular_pool_percent=0 THEN
  UPDATE public.tournament_players SET current_bounty=0
   WHERE tournament_id=p_tournament_id AND status::text='eliminated'
   AND chips=0 AND current_bounty>0
   AND current_bounty::text NOT IN('NaN','Infinity','-Infinity');
 END IF;

 IF EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id AND (status::text<>'eliminated' OR chips IS DISTINCT FROM 0 OR current_bounty IS DISTINCT FROM 0)) THEN RAISE EXCEPTION 'owner_retirement_roster_retirement_incomplete';END IF;
 UPDATE public.table_seats s SET left_at=coalesce(s.left_at,settled),status='left',stack=0,leave_pending=false,is_sitting_out=false,is_away=false,sit_out_at=NULL,scheduled_leave_hands=NULL
  FROM public.tables tb WHERE tb.id=s.table_id AND tb.tournament_id=p_tournament_id;
 UPDATE public.tournaments SET status='CANCELLED',ended_at=settled,updated_at=now(),prize_pool=0,bounty_pool=0,total_rake=rake_after,current_players=0,on_break=false,break_started_at=NULL,break_ends_at=NULL WHERE id=p_tournament_id;
 UPDATE public.tables SET status='closed',lifecycle='closed',current_players=0,terminal_closed_at=settled,updated_at=now() WHERE tournament_id=p_tournament_id;
 after_history:=jsonb_build_object('awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'awards','bounty_awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'bounty_awards','satellite_awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'satellite_awards',
  'hands',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id)::text,'[]')) FROM public.hand_history h WHERE h.tournament_id=p_tournament_id));
 IF EXISTS(SELECT value FROM jsonb_array_elements(prior_payouts) EXCEPT SELECT to_jsonb(p)-'terminal_closed_at' FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id) THEN RAISE EXCEPTION 'owner_retirement_prior_payout_changed';END IF;
 IF before_history IS DISTINCT FROM after_history THEN RAISE EXCEPTION 'operator_abort_earned_results_or_original_hands_changed:%:%:%:%',before_history,after_history,financial->'prior_awards_preserved',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_obligations o WHERE tournament_id=p_tournament_id AND kind<>'refund');END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO refunded_ids FROM public.tournament_players p WHERE p.tournament_id=p_tournament_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(financial->'refunds') r WHERE (r->>'user_id')::uuid=p.user_id);
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO zero_ids FROM unnest(player_ids) id WHERE NOT id=ANY(refunded_ids);
 v_receipt:=jsonb_build_object('ok',true,'success',true,'fully_settled',true,'receipt_version',6,'mode','started_owner_retirement','operation_id',p_operation_id,'tournament_id',p_tournament_id,'actor_id',actor,'status','CANCELLED',
 'source_player_count',cardinality(player_ids),'refunded_count',cardinality(refunded_ids),'refund_line_count',jsonb_array_length(financial->'refunds'),'ticket_return_count',0,'ticket_returns','[]'::jsonb,'total_ticket_returned',0,
 'total_refunded',(financial->>'total_refunded')::numeric,'fees_reversed',fees_reversed,'closed_table_count',cardinality(table_ids),'source_seat_count',cardinality(seat_ids),'released_seat_count',cardinality(released_ids),'refunds',financial->'refunds','settled_at',settled,
 'original_started_at',t.started_at,'financial',financial,'fee_receipt',fee_receipt,'pre_abort_roster',pre_roster,'pre_abort_seats',pre_seats,'preserved_history',before_history,'quiescence',a.quiescence,'payout_history',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'[]')) FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id),'fee_settlement',(SELECT to_jsonb(r) FROM public.tournament_rake_settlements r WHERE tournament_id=p_tournament_id),'terminal_snapshot',smarter_private.tournament_abort_terminal_snapshot(p_tournament_id));
 v_receipt:=v_receipt||jsonb_build_object('transfer_hash',md5(financial::text));
 UPDATE smarter_private.tournament_abort_targets SET state='settled',receipt=v_receipt,settled_at=settled WHERE tournament_id=p_tournament_id AND operation_id=p_operation_id;
 INSERT INTO public.tournament_cancellation_receipts(tournament_id,actor_id,receipt_version,source_player_count,source_player_ids,refunded_count,refunded_registration_ids,refund_line_count,ticket_return_count,ticket_return_ids,total_ticket_returned,zero_refund_count,zero_refund_registration_ids,total_refunded,fees_reversed,total_rake_before,total_rake_after,closed_table_count,closed_table_ids,source_seat_count,source_seat_ids,released_seat_count,released_seat_ids,fee_reversal_ids,escrow_closed_at,escrow_close_note,spin_unwind_tournament_id,receipt,settled_at)
 VALUES(p_tournament_id,actor,6,cardinality(player_ids),player_ids,cardinality(refunded_ids),refunded_ids,jsonb_array_length(financial->'refunds'),0,'{}',0,cardinality(zero_ids),zero_ids,(financial->>'total_refunded')::numeric,fees_reversed,rake_before,rake_after,cardinality(table_ids),table_ids,cardinality(seat_ids),seat_ids,cardinality(released_ids),released_ids,fee_ids,settled,v_close_note,NULL,v_receipt,settled);

 RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id);
END $function$
;
REVOKE ALL ON FUNCTION public.fn_ca_owner_retire_tournament(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.fn_ca_owner_retire_tournament(uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.fn_refuse_zero_chip_field_elimination()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_live int;
  v_zero int;
  v_status text;
BEGIN
  -- Only a transition INTO elimination, from a live seat, at zero chips.
  IF NEW.status <> 'eliminated' OR OLD.status <> 'playing' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(OLD.chips, 0) > 0 THEN
    RETURN NEW;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE COALESCE(chips, 0) <= 0)
    INTO v_live, v_zero
    FROM public.tournament_players
   WHERE tournament_id = NEW.tournament_id
     AND status = 'playing';

  -- More than one player left and NONE of them has a chip: the table has not
  -- been credited. Bust nobody. (At exactly one remaining player this is the
  -- legitimate "everybody busted in the same hand" tail, which the engine
  -- resolves by naming the last one out the winner - leave that alone.)
  IF v_live > 1 AND v_zero = v_live THEN
    SELECT upper(COALESCE(t.status, '')) INTO v_status
      FROM public.tournaments t WHERE t.id = NEW.tournament_id;

    -- ...unless the event is already over. Nothing is going to credit those
    -- stacks now, and holding the write means the place stays unowned and
    -- unpayable forever. Refusing to bust somebody in a finished tournament
    -- does not protect them; it withholds their money.
    IF v_status='COMPLETING' AND NEW.chips=0 AND NEW.current_bounty=0
     AND to_jsonb(NEW)-ARRAY['status','chips','current_bounty','updated_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['status','chips','current_bounty','updated_at']
     AND EXISTS(SELECT 1 FROM smarter_private.tournament_abort_targets a WHERE a.tournament_id=NEW.tournament_id AND a.state='quiesced'
       AND a.receipt->>'mode' IN ('equal_share_retirement_admission','owner_retirement_admission') AND (a.receipt->>'transaction_id')::bigint=txid_current()) THEN RETURN NEW;END IF;
    IF v_status IN ('COMPLETED', 'CANCELLED', 'CANCELED') THEN
      RAISE WARNING
        'allowing elimination in % (%): all % live player(s) read 0 chips, but the event is terminal - recording the finish',
        NEW.tournament_id, v_status, v_live;
      RETURN NEW;
    END IF;

    RAISE WARNING
      'refused elimination in %: all % live player(s) read 0 chips - uncredited stacks, not a bust',
      NEW.tournament_id, v_live;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_cancellation_receipt(p_tournament_id uuid, p_observed_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_h public.tournament_cancellation_receipts%ROWTYPE;
  v_t public.tournaments%ROWTYPE;
  v_e public.tournament_escrow%ROWTYPE;
  v_ids uuid[];
BEGIN
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'cancellation receipt requires a tournament id'
      USING ERRCODE='22004';
  END IF;
  SELECT * INTO v_h FROM public.tournament_cancellation_receipts h
   WHERE h.tournament_id=p_tournament_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % has no immutable cancellation receipt',
      p_tournament_id USING ERRCODE='P0404';
  END IF;
  IF v_h.receipt_version=6 THEN RETURN smarter_private.owner_retirement_receipt(p_tournament_id,p_observed_actor_id);END IF;
  IF v_h.receipt_version=4 THEN RETURN smarter_private.tournament_equal_share_receipt(p_tournament_id,p_observed_actor_id);END IF;
  IF v_h.receipt_version=3 AND v_h.receipt->>'mode'='started_operator_abort' THEN
    RETURN smarter_private.tournament_abort_receipt(p_tournament_id,p_observed_actor_id);
  END IF;
  -- DIAMOND PHASE 8: a Diamond event's receipt is proved against custody,
  -- the Diamond ledger and the wallet journal, never against chip rails.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    RETURN public.fn_poker_diamond_tournament_cancellation_receipt(p_tournament_id,p_observed_actor_id);
  END IF;
  IF p_observed_actor_id IS NOT NULL
     AND v_h.actor_id IS DISTINCT FROM p_observed_actor_id THEN
    RAISE EXCEPTION 'cancellation actor disagrees with stored receipt'
      USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_t FROM public.tournaments t WHERE t.id=p_tournament_id;
  SELECT * INTO v_e FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id;
  IF v_t.id IS NULL
     OR upper(COALESCE(v_t.status::text,'')) NOT IN ('CANCELLED','CANCELED')
     OR v_t.ended_at IS DISTINCT FROM v_h.settled_at
     OR v_t.current_players IS DISTINCT FROM 0
     OR v_t.prize_pool IS DISTINCT FROM 0::numeric
     OR v_t.bounty_pool IS DISTINCT FROM 0::numeric
     OR v_t.total_rake IS DISTINCT FROM v_h.total_rake_after
     OR v_t.on_break IS DISTINCT FROM false
     OR v_t.break_started_at IS NOT NULL OR v_t.break_ends_at IS NOT NULL
     OR v_e.tournament_id IS NULL OR v_e.enforced IS DISTINCT FROM true
     OR v_e.prize_balance IS DISTINCT FROM 0::numeric
     OR v_e.bounty_balance IS DISTINCT FROM 0::numeric
     OR v_e.fee_balance IS DISTINCT FROM 0::numeric
     OR v_e.closed_at IS DISTINCT FROM v_h.escrow_closed_at
     OR v_e.close_note IS DISTINCT FROM v_h.escrow_close_note THEN
    RAISE EXCEPTION 'cancellation receipt lost its terminal parent or escrow state'
      USING ERRCODE='P0404';
  END IF;

  SELECT COALESCE(array_agg(tp.id ORDER BY tp.id),ARRAY[]::uuid[])
    INTO v_ids FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id;
  IF v_ids IS DISTINCT FROM v_h.source_player_ids OR EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id
       AND (tp.status::text IS DISTINCT FROM 'eliminated'
         OR tp.eliminated_at IS DISTINCT FROM v_h.settled_at
         OR COALESCE(tp.chips,0)<>0 OR COALESCE(tp.current_bounty,0)<>0)) THEN
    RAISE EXCEPTION 'cancellation receipt lost its frozen roster'
      USING ERRCODE='P0404';
  END IF;
  SELECT COALESCE(array_agg(tb.id ORDER BY tb.id),ARRAY[]::uuid[])
    INTO v_ids FROM public.tables tb WHERE tb.tournament_id=p_tournament_id;
  IF v_ids IS DISTINCT FROM v_h.closed_table_ids OR EXISTS (
    SELECT 1 FROM public.tables tb WHERE tb.tournament_id=p_tournament_id
      AND (lower(COALESCE(tb.status::text,''))<>'closed'
        OR lower(COALESCE(tb.lifecycle,''))<>'closed'
        OR tb.current_players IS DISTINCT FROM 0
        OR tb.terminal_closed_at IS DISTINCT FROM v_h.settled_at)) THEN
    RAISE EXCEPTION 'cancellation receipt lost its frozen tables'
      USING ERRCODE='P0404';
  END IF;
  SELECT COALESCE(array_agg(s.id ORDER BY s.table_id,s.id),ARRAY[]::uuid[])
    INTO v_ids FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id;
  IF v_ids IS DISTINCT FROM v_h.source_seat_ids OR EXISTS (
    SELECT 1 FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
     WHERE tb.tournament_id=p_tournament_id
       AND (s.left_at IS NULL OR s.status IS DISTINCT FROM 'left'
         OR s.leave_pending IS DISTINCT FROM false
         OR s.is_sitting_out IS DISTINCT FROM false
         OR s.is_away IS DISTINCT FROM false OR s.sit_out_at IS NOT NULL
         OR s.scheduled_leave_hands IS NOT NULL)) THEN
    RAISE EXCEPTION 'cancellation receipt lost its frozen seats'
      USING ERRCODE='P0404';
  END IF;
  SELECT COALESCE(array_agg(s.id ORDER BY s.id),ARRAY[]::uuid[])
    INTO v_ids FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id
     AND s.left_at IS NOT DISTINCT FROM v_h.settled_at;
  IF v_ids IS DISTINCT FROM v_h.released_seat_ids THEN
    RAISE EXCEPTION 'cancellation receipt lost its released-seat identity'
      USING ERRCODE='P0404';
  END IF;

  SELECT COALESCE(array_agg(x.registration_id ORDER BY x.registration_id),
                  ARRAY[]::uuid[])
    INTO v_ids
    FROM (
      SELECT DISTINCT (line->>'registration_id')::uuid AS registration_id
        FROM jsonb_array_elements(v_h.receipt->'refunds') line
      UNION
      SELECT DISTINCT (line->>'registration_id')::uuid AS registration_id
        FROM jsonb_array_elements(v_h.receipt->'ticket_returns') line
    ) x;
  IF v_ids IS DISTINCT FROM v_h.refunded_registration_ids THEN
    RAISE EXCEPTION 'cancellation receipt lost its disposition roster'
      USING ERRCODE='P0404';
  END IF;
  SELECT COALESCE(array_agg(x.id ORDER BY x.id),ARRAY[]::uuid[])
    INTO v_ids
    FROM (
      SELECT unnest(v_h.source_player_ids) AS id
      EXCEPT SELECT unnest(v_h.refunded_registration_ids)
    ) x;
  IF v_ids IS DISTINCT FROM v_h.zero_refund_registration_ids THEN
    RAISE EXCEPTION 'cancellation receipt lost its zero-disposition roster'
      USING ERRCODE='P0404';
  END IF;

  IF (SELECT count(*) FROM public.tournament_refund_tranches tr
       WHERE tr.tournament_id=p_tournament_id
         AND tr.source='atomic_cancel_tournament')
       IS DISTINCT FROM v_h.refund_line_count
     OR (SELECT round(COALESCE(sum(tr.amount_paid_now),0),2)
           FROM public.tournament_refund_tranches tr
          WHERE tr.tournament_id=p_tournament_id
            AND tr.source='atomic_cancel_tournament')
       IS DISTINCT FROM v_h.total_refunded
     OR EXISTS (
       SELECT 1
         FROM jsonb_to_recordset(v_h.receipt->'refunds') AS line(
           registration_id uuid,user_id uuid,entitlement_id uuid,
           entitlement_kind text,source_wallet_club_id uuid,
           gross_paid numeric,amount_paid_before numeric,amount_paid_now numeric,
           refund_prize numeric,refund_bounty numeric,refund_fee numeric,
           obligation_id uuid,idempotency_key text,credit_ledger_id uuid,
           wallet_transaction_id uuid)
         LEFT JOIN public.tournament_players tp ON tp.id=line.registration_id
         LEFT JOIN public.tournament_refund_entitlements e
           ON e.id=line.entitlement_id
         LEFT JOIN public.tournament_refund_tranches tr
           ON tr.wallet_transaction_id=line.wallet_transaction_id
         LEFT JOIN public.tournament_obligations o ON o.id=line.obligation_id
         LEFT JOIN public.wallet_transactions w ON w.id=line.wallet_transaction_id
         LEFT JOIN public.wallet_credit_idempotency k ON k.key=line.idempotency_key
         LEFT JOIN public.chip_ledger l ON l.id=line.credit_ledger_id
        WHERE tp.id IS NULL OR tp.tournament_id IS DISTINCT FROM p_tournament_id
           OR tp.user_id IS DISTINCT FROM line.user_id
           OR e.id IS NULL OR e.tournament_id IS DISTINCT FROM p_tournament_id
           OR e.user_id IS DISTINCT FROM line.user_id
           OR e.entitlement_kind NOT IN ('wallet_charge','satellite_seat','tournament_ticket')
           OR e.entitlement_kind IS DISTINCT FROM line.entitlement_kind
           OR e.refund_wallet_club_id IS DISTINCT FROM line.source_wallet_club_id
           OR e.gross IS DISTINCT FROM line.amount_paid_now
           OR e.refund_prize IS DISTINCT FROM line.refund_prize
           OR e.refund_bounty IS DISTINCT FROM line.refund_bounty
           OR e.refund_fee IS DISTINCT FROM line.refund_fee
           OR (e.entitlement_kind IN ('satellite_seat','tournament_ticket')
               AND e.registration_id IS DISTINCT FROM line.registration_id)
           OR line.gross_paid IS DISTINCT FROM line.amount_paid_now
           OR line.amount_paid_now IS DISTINCT FROM
                round(line.refund_prize+line.refund_bounty+line.refund_fee,2)
           OR tr.wallet_transaction_id IS NULL
           OR tr.idempotency_key IS DISTINCT FROM line.idempotency_key
           OR tr.tournament_id IS DISTINCT FROM p_tournament_id
           OR tr.obligation_id IS DISTINCT FROM line.obligation_id
           OR tr.user_id IS DISTINCT FROM line.user_id
           OR tr.source_wallet_club_id IS DISTINCT FROM line.source_wallet_club_id
           OR tr.entitlement_id IS DISTINCT FROM line.entitlement_id
           OR tr.credit_ledger_id IS DISTINCT FROM line.credit_ledger_id
           OR tr.amount_paid_before IS DISTINCT FROM line.amount_paid_before
           OR tr.amount_paid_now IS DISTINCT FROM line.amount_paid_now
           OR tr.refund_prize IS DISTINCT FROM line.refund_prize
           OR tr.refund_bounty IS DISTINCT FROM line.refund_bounty
           OR tr.refund_fee IS DISTINCT FROM line.refund_fee
           OR tr.source IS DISTINCT FROM 'atomic_cancel_tournament'
           OR o.id IS NULL OR o.tournament_id IS DISTINCT FROM p_tournament_id
           OR o.kind IS DISTINCT FROM 'refund' OR o.place IS NOT NULL
           OR o.user_id IS DISTINCT FROM line.user_id OR o.settled_at IS NULL
           OR o.amount_paid IS DISTINCT FROM o.amount_owed
           OR o.amount_paid IS DISTINCT FROM (
             SELECT round(COALESCE(sum(all_tr.amount_paid_now),0),2)
               FROM public.tournament_refund_tranches all_tr
              WHERE all_tr.obligation_id=o.id)
           OR w.id IS NULL OR w.user_id IS DISTINCT FROM line.user_id
           OR w.related_entity_id IS DISTINCT FROM p_tournament_id
           OR w.type IS DISTINCT FROM 'credit' OR lower(w.category)<>'refund'
           OR w.amount IS DISTINCT FROM line.amount_paid_now
           OR k.key IS NULL OR k.user_id IS DISTINCT FROM line.user_id
           OR k.amount IS DISTINCT FROM line.amount_paid_now
           OR l.id IS NULL OR l.club_id IS DISTINCT FROM line.source_wallet_club_id
           OR l.from_type IS DISTINCT FROM 'prize_liability'
           OR l.from_entity_id IS DISTINCT FROM p_tournament_id
           OR l.to_type IS DISTINCT FROM 'player_wallet'
           OR l.to_entity_id IS DISTINCT FROM line.user_id
           OR l.amount IS DISTINCT FROM line.amount_paid_now)
     OR EXISTS (
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.tournament_id=p_tournament_id
          AND tr.source='atomic_cancel_tournament'
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_to_recordset(v_h.receipt->'refunds') AS line(
              wallet_transaction_id uuid)
             WHERE line.wallet_transaction_id=tr.wallet_transaction_id)) THEN
    RAISE EXCEPTION 'cancellation receipt lost exact refund evidence'
      USING ERRCODE='P0404';
  END IF;

  IF (SELECT count(*) FROM public.tournament_tickets tk
       WHERE tk.id=ANY(v_h.ticket_return_ids))
       IS DISTINCT FROM v_h.ticket_return_count
     OR (SELECT round(COALESCE(sum(tk.value),0),2)
           FROM public.tournament_tickets tk
          WHERE tk.id=ANY(v_h.ticket_return_ids))
       IS DISTINCT FROM v_h.total_ticket_returned
     OR EXISTS (
       SELECT 1
         FROM jsonb_to_recordset(v_h.receipt->'ticket_returns') AS line(
           registration_id uuid,user_id uuid,entitlement_id uuid,
           entitlement_kind text,ticket_id uuid,
           value numeric,source_wallet_club_id uuid,source_satellite_id uuid,
           refund_prize numeric,refund_bounty numeric,refund_fee numeric,
           ledger_id uuid,transaction_id uuid)
         LEFT JOIN public.tournament_players tp ON tp.id=line.registration_id
         LEFT JOIN public.tournament_refund_entitlements e
           ON e.id=line.entitlement_id
         LEFT JOIN public.tournament_tickets tk ON tk.id=line.ticket_id
         LEFT JOIN public.chip_ledger l ON l.id=line.ledger_id
         LEFT JOIN public.chip_transactions ct ON ct.id=line.transaction_id
        WHERE tp.id IS NULL OR tp.tournament_id IS DISTINCT FROM p_tournament_id
           OR tp.user_id IS DISTINCT FROM line.user_id
           OR e.id IS NULL OR e.tournament_id IS DISTINCT FROM p_tournament_id
           OR e.user_id IS DISTINCT FROM line.user_id
           OR e.entitlement_kind NOT IN ('satellite_seat','tournament_ticket')
           OR e.entitlement_kind IS DISTINCT FROM line.entitlement_kind
           OR e.registration_id IS DISTINCT FROM line.registration_id
           OR e.source_satellite_id IS DISTINCT FROM line.source_satellite_id
           OR e.refund_wallet_club_id IS DISTINCT FROM line.source_wallet_club_id
           OR e.gross IS DISTINCT FROM line.value
           OR e.refund_prize IS DISTINCT FROM line.refund_prize
           OR e.refund_bounty IS DISTINCT FROM line.refund_bounty
           OR e.refund_fee IS DISTINCT FROM line.refund_fee
           OR EXISTS (SELECT 1 FROM public.tournament_refund_tranches tr
                       WHERE tr.entitlement_id=line.entitlement_id)
           OR tk.id IS NULL OR tk.id<>ALL(v_h.ticket_return_ids)
           OR tk.source_refund_entitlement_id IS DISTINCT FROM line.entitlement_id
           OR tk.source_tournament_id IS DISTINCT FROM p_tournament_id
           OR tk.source_satellite_id IS DISTINCT FROM line.source_satellite_id
           OR tk.holder_id IS DISTINCT FROM line.user_id
           OR tk.club_id IS DISTINCT FROM line.source_wallet_club_id
           OR tk.value IS DISTINCT FROM line.value
           OR tk.status NOT IN ('issued','redeemed')
           OR tk.redemption_mode IS DISTINCT FROM 'tournament_entry_only'
           OR tk.entry_prize IS DISTINCT FROM line.refund_prize
           OR tk.entry_bounty IS DISTINCT FROM line.refund_bounty
           OR tk.entry_fee IS DISTINCT FROM line.refund_fee
           OR l.id IS NULL
           OR l.idempotency_key IS DISTINCT FROM
                'tourney:'||p_tournament_id::text
                  ||':satellite-ticket-return:'||line.entitlement_id::text
           OR l.tournament_id IS DISTINCT FROM p_tournament_id
           OR l.club_id IS DISTINCT FROM line.source_wallet_club_id
           OR l.from_type IS DISTINCT FROM 'prize_liability'
           OR l.from_entity_id IS DISTINCT FROM p_tournament_id
           OR l.to_type IS DISTINCT FROM 'escrow'
           OR l.to_entity_id IS DISTINCT FROM line.ticket_id
           OR l.category IS DISTINCT FROM 'ticket_issue'
           OR l.amount IS DISTINCT FROM line.value
           OR l.metadata->>'entitlement_kind'
                IS DISTINCT FROM line.entitlement_kind
           OR ct.id IS NULL OR ct.club_id IS DISTINCT FROM line.source_wallet_club_id
           OR ct.to_user_id IS DISTINCT FROM line.user_id
           OR ct.amount IS DISTINCT FROM line.value
           OR ct.transaction_type IS DISTINCT FROM 'tournament_ticket_issue'
           OR ct.metadata->>'ticket_id' IS DISTINCT FROM line.ticket_id::text
           OR ct.metadata->>'entitlement_id' IS DISTINCT FROM line.entitlement_id::text
           OR ct.metadata->>'entitlement_kind'
                IS DISTINCT FROM line.entitlement_kind
           OR ct.metadata->>'ledger_id' IS DISTINCT FROM line.ledger_id::text)
     OR EXISTS (
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.id=ANY(v_h.ticket_return_ids)
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_to_recordset(
              v_h.receipt->'ticket_returns') AS line(ticket_id uuid)
             WHERE line.ticket_id=tk.id)) THEN
    RAISE EXCEPTION 'cancellation receipt lost satellite entry-ticket evidence'
      USING ERRCODE='P0404';
  END IF;

  SELECT COALESCE(array_agg(r.id ORDER BY r.id),ARRAY[]::uuid[])
    INTO v_ids FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id
     AND r.source='atomic_cancel_tournament';
  IF v_ids IS DISTINCT FROM v_h.fee_reversal_ids
     OR (SELECT round(COALESCE(sum(r.rake_amount),0),2)
           FROM public.rake_records r
          WHERE r.tournament_id=p_tournament_id AND r.is_tournament)
        IS DISTINCT FROM v_h.total_rake_after
     OR (SELECT round(COALESCE(-sum(r.rake_amount),0),2)
           FROM public.rake_records r WHERE r.id=ANY(v_h.fee_reversal_ids))
        IS DISTINCT FROM v_h.fees_reversed
     OR EXISTS (
       SELECT 1 FROM public.rake_records reversal
        WHERE reversal.id=ANY(v_h.fee_reversal_ids)
          AND (reversal.rake_amount>=0
            OR reversal.club_id IS NULL
            OR reversal.source IS DISTINCT FROM 'atomic_cancel_tournament'
            OR reversal.metadata->>'kind' NOT IN (
                 'tournament_fee_refund','spin_rake_refund')
            OR (reversal.metadata->>'kind'='tournament_fee_refund' AND (
              jsonb_typeof(reversal.metadata->'original_rake_record_ids')
                IS DISTINCT FROM 'array'
              OR jsonb_array_length(
                   reversal.metadata->'original_rake_record_ids')
                 IS DISTINCT FROM (
                   SELECT count(*)::integer
                     FROM jsonb_array_elements_text(
                       reversal.metadata->'original_rake_record_ids') source(id)
                     JOIN public.rake_records original
                       ON original.id=source.id::uuid
                    WHERE original.tournament_id=p_tournament_id
                      AND original.club_id=reversal.club_id
                      AND original.metadata->>'user_id'=
                          reversal.metadata->>'user_id')
              OR (SELECT round(COALESCE(sum(original.rake_amount),0),2)
                    FROM jsonb_array_elements_text(
                      reversal.metadata->'original_rake_record_ids') source(id)
                    JOIN public.rake_records original ON original.id=source.id::uuid
                   WHERE original.tournament_id=p_tournament_id
                     AND original.club_id=reversal.club_id
                     AND original.metadata->>'user_id'=
                         reversal.metadata->>'user_id')
                 IS DISTINCT FROM -reversal.rake_amount))
            OR (reversal.metadata->>'kind'='spin_rake_refund' AND NOT EXISTS (
              SELECT 1 FROM public.rake_records original
               WHERE original.id::text=
                       reversal.metadata->>'original_rake_record_id'
                 AND original.tournament_id=p_tournament_id
                 AND original.club_id=reversal.club_id
                 AND original.source IN (
                       'fn_spin_book_entry','fn_spin_settle_game')
                 AND original.rake_amount=-reversal.rake_amount)))) THEN
    RAISE EXCEPTION 'cancellation receipt lost exact fee evidence'
      USING ERRCODE='P0404';
  END IF;

  IF v_h.spin_unwind_tournament_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tournament_spin_cancellation_unwinds u
    JOIN public.spin_reserve_ledger c ON c.id=u.original_contribution_id
    JOIN public.spin_reserve_ledger cr ON cr.id=u.contribution_reversal_id
    JOIN public.chip_ledger cj ON cj.id=u.original_entry_journal_id
    JOIN public.chip_ledger crj ON crj.id=u.contribution_reversal_journal_id
     WHERE u.tournament_id=p_tournament_id AND c.kind='contribution'
       AND cr.kind='contribution_reversal' AND cr.amount=-c.amount
       AND cj.category='spin_entry' AND cj.amount=c.amount
       AND crj.category='reversal' AND crj.amount=c.amount
       AND crj.idempotency_key='spin:'||p_tournament_id::text||':cancel:entry'
       AND ((u.draw_amount=0 AND u.original_draw_id IS NULL
             AND u.draw_reversal_id IS NULL)
         OR (u.draw_amount>0 AND EXISTS (
           SELECT 1 FROM public.spin_reserve_ledger d
           JOIN public.spin_reserve_ledger dr ON dr.id=u.draw_reversal_id
           JOIN public.chip_ledger dj ON dj.id=u.original_draw_journal_id
           JOIN public.chip_ledger drj ON drj.id=u.draw_reversal_journal_id
            WHERE d.id=u.original_draw_id AND d.kind='jackpot_draw'
              AND dr.kind='draw_reversal' AND dr.amount=-d.amount
              AND dj.category='spin_prize' AND dj.amount=-d.amount
              AND drj.category='reversal' AND drj.amount=-d.amount
              AND drj.idempotency_key=
                  'spin:'||p_tournament_id::text||':cancel:draw')))) THEN
    RAISE EXCEPTION 'cancellation receipt lost exact Spin unwind evidence'
      USING ERRCODE='P0404';
  END IF;
  IF v_h.spin_unwind_tournament_id IS NULL AND EXISTS (
    SELECT 1 FROM public.spin_reserve_ledger r
     WHERE r.tournament_id=p_tournament_id AND r.kind='contribution') THEN
    RAISE EXCEPTION 'cancellation receipt omitted the Spin contribution unwind'
      USING ERRCODE='P0404';
  END IF;
  RETURN v_h.receipt;
END;
$function$

;
CREATE FUNCTION smarter_private.owner_retirement_receipt(p_tournament_id uuid,p_observed_actor_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $function$
DECLARE h public.tournament_cancellation_receipts;t public.tournaments;a smarter_private.tournament_abort_targets;
 x smarter_private.owner_retirement_pool_transfers;i smarter_private.owner_tournament_deletion_intents;
 total numeric;part record;actual numeric;history jsonb;
BEGIN
 SELECT * INTO h FROM public.tournament_cancellation_receipts WHERE tournament_id=p_tournament_id;
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id;
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE tournament_id=p_tournament_id;
 SELECT * INTO x FROM smarter_private.owner_retirement_pool_transfers WHERE tournament_id=p_tournament_id;
 SELECT * INTO i FROM smarter_private.owner_tournament_deletion_intents WHERE tournament_id=p_tournament_id;
 IF h.receipt_version IS DISTINCT FROM 6 OR h.receipt->>'mode' IS DISTINCT FROM 'started_owner_retirement'
 OR a.state IS DISTINCT FROM 'settled' OR a.operation_id IS DISTINCT FROM x.operation_id
 OR h.receipt IS DISTINCT FROM a.receipt OR h.receipt->>'operation_id' IS DISTINCT FROM x.operation_id::text
 OR x.asset IS DISTINCT FROM i.asset OR x.destination_id IS DISTINCT FROM i.destination_id
 OR i.original_started_at IS DISTINCT FROM t.started_at OR t.status IS DISTINCT FROM 'CANCELLED'
 OR h.receipt->'fully_settled' IS DISTINCT FROM 'true'::jsonb
 OR t.started_at IS DISTINCT FROM (h.receipt->>'original_started_at')::timestamptz OR t.ended_at IS DISTINCT FROM h.settled_at
 OR t.current_players IS DISTINCT FROM 0 OR t.prize_pool IS DISTINCT FROM 0::numeric OR t.bounty_pool IS DISTINCT FROM 0::numeric
 OR t.total_rake IS DISTINCT FROM h.total_rake_after OR t.on_break IS DISTINCT FROM false
 OR t.break_started_at IS NOT NULL OR t.break_ends_at IS NOT NULL
 OR (p_observed_actor_id IS NOT NULL AND h.actor_id IS DISTINCT FROM p_observed_actor_id)
 OR h.receipt->'terminal_snapshot' IS DISTINCT FROM smarter_private.tournament_abort_terminal_snapshot(p_tournament_id)
 OR h.receipt->'fee_settlement' IS DISTINCT FROM (SELECT to_jsonb(r) FROM public.tournament_rake_settlements r WHERE tournament_id=p_tournament_id)
 OR h.receipt->>'payout_history' IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'[]')) FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id)
 OR h.receipt->>'transfer_hash' IS DISTINCT FROM md5((h.receipt->'financial')::text)
 OR (h.receipt->'financial')-ARRAY['fully_settled','refunds','total_refunded','original_refunds'] IS DISTINCT FROM x.receipt
 THEN RAISE EXCEPTION 'owner_retirement_terminal_evidence_changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id=p_tournament_id AND enforced
  AND prize_balance=0 AND bounty_balance=0 AND fee_balance=0 AND closed_at=h.settled_at)
 OR EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id
  AND (status::text IS DISTINCT FROM 'eliminated' OR chips IS DISTINCT FROM 0 OR current_bounty IS DISTINCT FROM 0))
 OR EXISTS(SELECT 1 FROM public.tables WHERE tournament_id=p_tournament_id
  AND (status IS DISTINCT FROM 'closed' OR lifecycle IS DISTINCT FROM 'closed' OR current_players IS DISTINCT FROM 0 OR terminal_closed_at IS DISTINCT FROM h.settled_at))
 OR EXISTS(SELECT 1 FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id
  AND (s.left_at IS NULL OR s.status IS DISTINCT FROM 'left' OR s.stack IS DISTINCT FROM 0))
 OR EXISTS(SELECT 1 FROM public.tournament_obligations WHERE tournament_id=p_tournament_id AND amount_owed>amount_paid)
 THEN RAISE EXCEPTION 'owner_retirement_terminal_state_incomplete';END IF;
 total:=x.prize+x.bounty+x.fee;
 IF total::text IN ('NaN','Infinity','-Infinity') OR total<0 OR total<>round(total,2)
 OR x.prize<0 OR x.bounty<0 OR x.fee<0 OR total IS DISTINCT FROM (x.receipt->>'amount')::numeric
 OR (x.receipt->>'destination_after')::numeric IS DISTINCT FROM (x.receipt->>'destination_before')::numeric+total
 OR h.receipt->'fee_receipt'->'ok' IS DISTINCT FROM 'true'::jsonb
 OR h.receipt->'fee_receipt'->'attributed' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'owner_retirement_financial_conservation_changed';END IF;
 IF x.asset='chips' THEN
  IF x.fee<>0 OR x.refund_fee_reserved IS DISTINCT FROM (SELECT coalesce(sum(tr.refund_fee),0) FROM smarter_private.owner_retirement_bank_refunds r JOIN public.tournament_refund_tranches tr ON tr.entitlement_id=r.entitlement_id AND tr.credit_ledger_id=(r.receipt->'refund'->>'credit_ledger_id')::uuid WHERE r.tournament_id=p_tournament_id) OR x.destination_id<>'fade0000-0000-0000-0000-000000000001'::uuid
  OR (total>0 AND NOT EXISTS(SELECT 1 FROM public.chip_ledger l JOIN public.union_wallets w ON w.id=l.to_entity_id
    WHERE l.id=(x.receipt->>'journal_id')::uuid AND l.idempotency_key=x.receipt->>'key'
    AND l.from_type='prize_liability' AND l.from_entity_id=p_tournament_id AND l.to_type='union_bank'
    AND l.to_label='union_wallets.chip_balance' AND w.union_id=x.destination_id AND l.amount=total AND l.category='transfer'))
  OR (h.receipt->'fee_receipt'->>'amount')::numeric IS DISTINCT FROM (x.receipt->>'member_club_fee_custody')::numeric
  THEN RAISE EXCEPTION 'owner_retirement_main_bank_or_fee_evidence_changed';END IF;
 ELSE
  IF total<>trunc(total) OR x.destination_id<>'47965354-0e56-43ef-931c-ddaab82af765'::uuid
  OR public.fn_poker_diamond_tournament_custody(p_tournament_id)<>0
  OR EXISTS(SELECT 1 FROM public.poker_diamond_custody WHERE target_id=p_tournament_id AND purpose='tournament_entry' AND state<>'released')
  OR (total>0 AND NOT EXISTS(SELECT 1 FROM public.diamond_transactions d WHERE d.id=(x.receipt->>'journal_id')::uuid
    AND d.user_id=x.destination_id AND d.amount=total AND d.reference_id=x.receipt->>'key'
    AND d.transaction_type='arena_withdraw' AND d.issuance_class='arena'))
  OR (h.receipt->'fee_receipt'->>'amount')::numeric IS DISTINCT FROM x.fee
  OR h.receipt->'fee_receipt'->>'destination' IS DISTINCT FROM 'player:'||x.destination_id::text
  THEN RAISE EXCEPTION 'owner_retirement_kingfish_or_custody_evidence_changed';END IF;
  FOR part IN SELECT * FROM (VALUES('prize',x.prize),('bounty',x.bounty),('fee',x.fee))v(bank,quantity) LOOP
   SELECT coalesce(sum(m.amount),0) INTO actual FROM public.poker_diamond_movements m
    JOIN public.poker_diamond_custody c ON c.id=m.custody_id WHERE c.target_id=p_tournament_id AND c.purpose='tournament_entry'
    AND m.action='release' AND m.wallet_journal_id=(x.receipt->>'journal_id')::uuid
    AND m.destination_account='player:'||x.destination_id::text AND m.request->>'bank'=part.bank
    AND m.request->>'reason'=(x.receipt->>'key')||':'||part.bank;
   IF actual IS DISTINCT FROM part.quantity THEN RAISE EXCEPTION 'owner_retirement_diamond_movement_conservation_changed';END IF;
  END LOOP;
 END IF;
 history:=jsonb_build_object('awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'awards',
  'bounty_awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'bounty_awards',
  'satellite_awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'satellite_awards',
  'hands',(SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id)::text,'[]')) FROM public.hand_history v WHERE v.tournament_id=p_tournament_id));
 IF history IS DISTINCT FROM h.receipt->'preserved_history' THEN RAISE EXCEPTION 'owner_retirement_prior_awards_changed';END IF;
 RETURN h.receipt;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.owner_retirement_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.owner_retirement_transfer_must_close() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $$BEGIN
 PERFORM smarter_private.owner_retirement_receipt(NEW.tournament_id,NULL);RETURN NULL;END$$;
REVOKE ALL ON FUNCTION smarter_private.owner_retirement_transfer_must_close() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER owner_retirement_transfer_must_close AFTER INSERT ON smarter_private.owner_retirement_pool_transfers
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION smarter_private.owner_retirement_transfer_must_close();

ALTER TABLE public.tournament_cancellation_receipts DROP CONSTRAINT tournament_cancellation_receipts_receipt_version_check;
ALTER TABLE public.tournament_cancellation_receipts ADD CONSTRAINT tournament_cancellation_receipts_receipt_version_check CHECK(
 receipt_version=2 OR (receipt_version=3 AND receipt->>'mode' IS NOT DISTINCT FROM 'started_operator_abort' AND receipt->>'operation_id' IS NOT NULL)
 OR (receipt_version=4 AND receipt->>'mode' IS NOT DISTINCT FROM 'started_operator_equal_share' AND receipt->>'operation_id' IS NOT NULL)
 OR (receipt_version=6 AND receipt->>'mode' IS NOT DISTINCT FROM 'started_owner_retirement' AND receipt->>'operation_id' IS NOT NULL));
ALTER TABLE public.tournament_cancellation_receipts DROP CONSTRAINT tournament_cancellation_receipts_check12;
ALTER TABLE public.tournament_cancellation_receipts ADD CONSTRAINT tournament_cancellation_receipts_check12 CHECK(
 total_rake_before::text NOT IN ('NaN','Infinity','-Infinity') AND total_rake_after::text NOT IN ('NaN','Infinity','-Infinity') AND total_rake_before>=0
 AND ((receipt_version IN (2,3) AND total_rake_after=0 AND total_rake_before=fees_reversed)
 OR (receipt_version IN (4,6) AND total_rake_after=total_rake_before AND fees_reversed=0 AND total_refunded=0 AND total_ticket_returned=0
 AND refund_line_count=0 AND ticket_return_count=0 AND cardinality(fee_reversal_ids)=0)));

CREATE OR REPLACE FUNCTION smarter_private.equal_share_retirement_must_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
BEGIN
 IF NEW.receipt->>'mode'='equal_share_retirement_admission' THEN
  IF NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_targets a JOIN public.tournament_cancellation_receipts h USING(tournament_id)
   WHERE a.tournament_id=NEW.tournament_id AND a.operation_id=NEW.operation_id AND a.state='settled' AND h.receipt_version=4 AND h.receipt=a.receipt)
  THEN RAISE EXCEPTION 'equal_share_retirement_requires_terminal_receipt' USING ERRCODE='23514';END IF;
  PERFORM smarter_private.tournament_equal_share_receipt(NEW.tournament_id,NULL);
 END IF;
 IF NEW.receipt->>'mode'='owner_retirement_admission' THEN PERFORM smarter_private.owner_retirement_receipt(NEW.tournament_id,NULL);END IF;
 RETURN NULL;
END $function$

;
DO $$BEGIN IF clock_timestamp()-transaction_timestamp()>interval '8 seconds' THEN RAISE EXCEPTION 'owner_retirement_install_budget';END IF;END$$;
COMMIT;
