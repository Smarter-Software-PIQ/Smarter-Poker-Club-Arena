-- @live-proof: to_regprocedure('public.fn_ca_owner_retirement_bank_refund(uuid)') IS NOT NULL AND has_function_privilege('service_role','public.fn_ca_owner_retirement_bank_refund(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_owner_retirement_bank_refund(uuid)','EXECUTE') AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='smarter_private.owner_retirement_bank_refunds'::regclass AND tgname='owner_refund_receipt_immutable' AND tgenabled='O')
-- Owner instruction November 2: refund the verified human charges from Midway
-- Main Bank. Bank funds and exact original-source refunds commit together.
-- No prize/ticket claim is waived, no event is retired, and no award is rewritten.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
CREATE TABLE smarter_private.owner_retirement_bank_refunds(
 entitlement_id uuid PRIMARY KEY,
 tournament_id uuid NOT NULL,
 receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON smarter_private.owner_retirement_bank_refunds FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION smarter_private.owner_retirement_bank_refund_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 RAISE EXCEPTION 'owner_retirement_bank_refund_receipt_is_immutable' USING ERRCODE='55000';END$$;
REVOKE ALL ON FUNCTION smarter_private.owner_retirement_bank_refund_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER owner_refund_receipt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON smarter_private.owner_retirement_bank_refunds FOR EACH STATEMENT
 EXECUTE FUNCTION smarter_private.owner_retirement_bank_refund_immutable();
INSERT INTO public.ca_settle_sources(source,note)
 VALUES('owner_retirement_bank_refund','November 2 owner-directed original-charge refund funded by Midway Main Bank; other entitlements preserved')
 ON CONFLICT(source) DO NOTHING;
-- Register this exact monetary authority before the enabled DDL guard sees it.
INSERT INTO public.ca_money_rpc_registry(proname,status,notes)
 VALUES('fn_ca_owner_retirement_bank_refund','approved','Exact four owner-authorized original charges: Main Bank funding and original player refunds are atomic, journaled, scoped and immutable')
 ON CONFLICT(proname) DO NOTHING;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_money_rpc_registry WHERE proname='fn_ca_owner_retirement_bank_refund' AND status='approved')
 THEN RAISE EXCEPTION 'owner_bank_refund_money_authority_not_approved' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION public.fn_ca_owner_retirement_bank_refund(p_entitlement_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,smarter_private AS $function$
DECLARE
 ent public.tournament_refund_entitlements; target public.tournaments;
 expected record; prior jsonb; answer jsonb; bank_before numeric; bank_after numeric;
 escrow_before numeric; escrow_after numeric; wallet_before numeric; wallet_after numeric;
 bank_wallet uuid; funding_id uuid; owed numeric; key text; saved jsonb; setting record;
 bank constant uuid:='fade0000-0000-0000-0000-000000000001';
 actor constant uuid:='2d1cd6c3-5700-4af9-a271-d4863fdab20d';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND NOT
   (session_user='postgres' AND coalesce(current_setting('role',true),'none') IN ('none','postgres') AND auth.role() IS NULL)
 THEN RAISE EXCEPTION 'owner_refund_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO expected FROM (VALUES
 ('26b465dd-600d-42eb-9f37-68f6052febac'::uuid,'2781bcd7-cc8a-4713-ab3e-0d0a81fdf110'::uuid,'eed278a8-3ca2-4e2d-a196-0a0cd9e74f90'::uuid,'322489e1-e6a3-4f6e-a8b9-50f66d7866a5'::uuid,5::numeric),
 ('8e6232d8-bbd7-4dc8-9640-4fbfa45ca952','6379b29e-1307-4e8b-91e7-e9a0975cd64d','d55730d2-da5a-45fc-8478-82e49f97cd7e','3795bc35-05f7-4003-893a-5f960ff6e274',1),
 ('1edfe4d2-005d-4b93-96d0-fc0bb10f8c95','d5decc98-cd0f-417f-aa28-6df009a74c76','ed2d1c05-c3bb-4d9e-b862-2a9797d32044','e7a3f5d1-dff2-4f34-9bc8-19ec2e31e9fd',1),
 ('26ac24a2-7c73-44af-a5ae-b971d0a8e4fd','d5decc98-cd0f-417f-aa28-6df009a74c76','c657675c-f970-4c42-8f19-ba4d8096be67','22344400-69bd-4730-84e3-9dac2b8f8603',1)
 ) x(entitlement_id,tournament_id,user_id,source_ledger_id,amount)
 WHERE entitlement_id=p_entitlement_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'owner_refund_outside_verified_manifest' USING ERRCODE='22023';END IF;
 PERFORM smarter_private.cancellation_lane(expected.tournament_id);
 SELECT * INTO target FROM public.tournaments WHERE id=expected.tournament_id FOR UPDATE;
 SELECT receipt INTO prior FROM smarter_private.owner_retirement_bank_refunds WHERE entitlement_id=p_entitlement_id;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.tournament_refund_tranches tr WHERE tr.entitlement_id=p_entitlement_id
    AND tr.credit_ledger_id=(prior->'refund'->>'credit_ledger_id')::uuid
    AND tr.amount_paid_now=expected.amount)
   OR NOT EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.id=(prior->>'funding_ledger_id')::uuid
    AND l.amount=expected.amount AND l.to_type='prize_liability' AND l.to_entity_id=expected.tournament_id
    AND l.from_type='union_bank' AND l.from_entity_id=(prior->>'source_bank_wallet_id')::uuid
    AND l.from_label='union_wallets.chip_balance')
   OR NOT EXISTS(SELECT 1 FROM public.wallet_credit_idempotency k WHERE k.key=prior->'refund'->>'idempotency_key'
    AND k.user_id=expected.user_id AND k.amount=expected.amount)
   OR NOT EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.id=(prior->'refund'->>'credit_ledger_id')::uuid
    AND l.from_type='prize_liability' AND l.from_entity_id=expected.tournament_id
    AND l.to_type='player_wallet' AND l.to_entity_id=expected.user_id AND l.amount=expected.amount)
  THEN RAISE EXCEPTION 'owner_refund_prior_receipt_evidence_changed';END IF;
  RETURN prior;
 END IF;
 IF target.status NOT IN ('RUNNING','BREAK','LATE_REG') OR target.union_id IS DISTINCT FROM bank
  OR NOT EXISTS(SELECT 1 FROM smarter_private.owner_tournament_deletion_intents i
    WHERE i.tournament_id=target.id AND i.original_started_at=target.started_at AND i.asset='chips'
      AND i.destination_id=bank AND i.owner_chat_id='01a19ccc-894e-75e2-a9e7-fe0d2df6c326')
 THEN RAISE EXCEPTION 'owner_refund_original_event_changed';END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'owner_refund_platform_frozen';END IF;
 SELECT * INTO ent FROM public.tournament_refund_entitlements WHERE id=p_entitlement_id FOR UPDATE;
 IF ent.tournament_id IS DISTINCT FROM expected.tournament_id OR ent.user_id IS DISTINCT FROM expected.user_id
  OR ent.source_ledger_id IS DISTINCT FROM expected.source_ledger_id OR ent.gross IS DISTINCT FROM expected.amount
  OR ent.entitlement_kind IS DISTINCT FROM 'wallet_charge'
  OR ent.refund_wallet_club_id IS DISTINCT FROM 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
  OR EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=ent.id)
  OR EXISTS(SELECT 1 FROM public.tournament_tickets WHERE source_refund_entitlement_id=ent.id)
 THEN RAISE EXCEPTION 'owner_refund_original_charge_already_disposed_or_changed';END IF;
 SELECT prize_balance+bounty_balance+fee_balance INTO escrow_before FROM public.tournament_escrow
  WHERE tournament_id=target.id AND enforced AND closed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'owner_refund_open_custody_required';END IF;
 SELECT chip_balance INTO wallet_before FROM public.club_members
  WHERE club_id=ent.refund_wallet_club_id AND user_id=ent.user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'owner_refund_original_wallet_missing';END IF;
 SELECT id,chip_balance INTO bank_wallet,bank_before FROM public.union_wallets WHERE union_id=bank FOR NO KEY UPDATE;
 IF NOT FOUND OR bank_before<ent.gross OR bank_before::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'owner_refund_main_bank_insufficient';END IF;
 SELECT jsonb_object_agg(k,coalesce(current_setting(k,true),'')) INTO saved FROM unnest(ARRAY[
 'app.ledger_category','app.ledger_counterparty','app.ledger_counterparty_entity','app.ledger_counterparty_label',
 'app.ledger_idempotency_key','app.ledger_tournament_id','app.ledger_autoledger_club_id']) k;
 key:='owner-retirement-bank-refund:'||ent.id::text;
 PERFORM public.fn_ca_declare_ledger('overlay','prize_liability',target.id,NULL,key||':funding');
 PERFORM set_config('app.ledger_tournament_id',target.id::text,true);
 PERFORM set_config('app.ledger_autoledger_club_id',target.club_id::text,true);
 -- The maintained autoledger stays enabled. The bank's one debit journals its
 -- exact destination; its auto-ledgered overlay does not apply escrow itself.
 UPDATE public.union_wallets SET chip_balance=chip_balance-ent.gross,updated_at=now()
  WHERE union_id=bank AND chip_balance=bank_before RETURNING chip_balance INTO bank_after;
 IF bank_after IS DISTINCT FROM bank_before-ent.gross THEN RAISE EXCEPTION 'owner_refund_bank_debit_changed';END IF;
 SELECT id INTO funding_id FROM public.chip_ledger WHERE idempotency_key=key||':funding'
  AND from_entity_id=bank_wallet AND from_label='union_wallets.chip_balance'
  AND to_type='prize_liability' AND to_entity_id=target.id AND amount=ent.gross AND category='overlay';
 IF funding_id IS NULL THEN RAISE EXCEPTION 'owner_refund_bank_journal_missing';END IF;
 PERFORM public.fn_ca_escrow_apply(target.id,'Owner Main Bank funded original-charge refund',p_overlay_in=>ent.gross);
 INSERT INTO public.union_wallet_transactions(union_id,wallet,direction,amount,balance_after,tx_type,club_id,notes,created_by)
 VALUES(bank,'chip_balance','debit',ent.gross,bank_after,'owner_retirement_refund',target.club_id,key,actor);
 FOR setting IN SELECT * FROM jsonb_each_text(saved) LOOP PERFORM set_config(setting.key,setting.value,true);END LOOP;
 SELECT coalesce(amount_paid,0)+ent.gross INTO owed FROM public.tournament_obligations
  WHERE tournament_id=target.id AND user_id=ent.user_id AND kind='refund' AND place IS NULL FOR UPDATE;
 IF NOT FOUND THEN owed:=ent.gross;END IF;
 answer:=public.fn_settle_tournament_refund_exact(target.id,ent.user_id,ent.refund_wallet_club_id,owed,
   ent.refund_prize,ent.refund_bounty,ent.refund_fee,'owner_retirement_bank_refund',
   'Owner-directed original-charge refund funded by Midway Union Main Bank; additional prize and ticket claims preserved');
 SELECT chip_balance INTO wallet_after FROM public.club_members WHERE club_id=ent.refund_wallet_club_id AND user_id=ent.user_id;
 SELECT prize_balance+bounty_balance+fee_balance INTO escrow_after FROM public.tournament_escrow WHERE tournament_id=target.id;
 IF answer->>'fully_settled' IS DISTINCT FROM 'true' OR (answer->>'entitlement_id')::uuid IS DISTINCT FROM ent.id
  OR (answer->>'paid')::numeric IS DISTINCT FROM ent.gross OR wallet_after IS DISTINCT FROM wallet_before+ent.gross
  OR escrow_after IS DISTINCT FROM escrow_before THEN RAISE EXCEPTION 'owner_refund_conservation_failed';END IF;
 prior:=jsonb_build_object('ok',true,'mode','owner_bank_funded_original_charge_refund','entitlement_id',ent.id,
  'tournament_id',target.id,'user_id',ent.user_id,'source_union_id',bank,'source_bank_wallet_id',bank_wallet,'source_wallet','chip_balance',
  'original_charge_ledger_id',ent.source_ledger_id,'funding_ledger_id',funding_id,'amount',ent.gross,
  'bank_before',bank_before,'bank_after',bank_after,'player_before',wallet_before,'player_after',wallet_after,
  'event_custody_before',escrow_before,'event_custody_after',escrow_after,'refund',answer,
  'additional_entitlements_preserved',true,'settled_at',clock_timestamp());
 INSERT INTO smarter_private.owner_retirement_bank_refunds(entitlement_id,tournament_id,receipt) VALUES(ent.id,target.id,prior);
 RETURN prior;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_owner_retirement_bank_refund(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_owner_retirement_bank_refund(uuid) TO service_role;
DO $$BEGIN IF clock_timestamp()-transaction_timestamp()>interval '8 seconds' THEN RAISE EXCEPTION 'owner_bank_refund_install_budget';END IF;END$$;
COMMIT;
