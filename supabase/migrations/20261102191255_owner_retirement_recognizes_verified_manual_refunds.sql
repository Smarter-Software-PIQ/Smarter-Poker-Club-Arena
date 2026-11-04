-- @live-proof: to_regprocedure('public.fn_ca_record_owner_manual_refund(uuid,uuid)') IS NOT NULL AND has_function_privilege('service_role','public.fn_ca_record_owner_manual_refund(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_record_owner_manual_refund(uuid,uuid)','EXECUTE')
-- Owner now handles the four original charges. Record actual existing credits;
-- never debit a bank, credit a player, or rewrite an original monetary journal.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
CREATE TABLE smarter_private.owner_retirement_manual_refunds(
 entitlement_id uuid PRIMARY KEY,tournament_id uuid NOT NULL,user_id uuid NOT NULL,
 credit_ledger_id uuid NOT NULL UNIQUE,amount numeric NOT NULL CHECK(amount>0),
 receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON smarter_private.owner_retirement_manual_refunds FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER owner_manual_refund_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON smarter_private.owner_retirement_manual_refunds
 FOR EACH STATEMENT EXECUTE FUNCTION smarter_private.owner_retirement_bank_refund_immutable();
CREATE FUNCTION smarter_private.owner_manual_refund_receipt(p_entitlement_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $body$
DECLARE r smarter_private.owner_retirement_manual_refunds;e public.tournament_refund_entitlements;l public.chip_ledger;
BEGIN
 SELECT * INTO r FROM smarter_private.owner_retirement_manual_refunds WHERE entitlement_id=p_entitlement_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO e FROM public.tournament_refund_entitlements WHERE id=p_entitlement_id;
 SELECT * INTO l FROM public.chip_ledger WHERE id=r.credit_ledger_id;
 IF e.tournament_id IS DISTINCT FROM r.tournament_id OR e.user_id IS DISTINCT FROM r.user_id
 OR e.gross IS DISTINCT FROM r.amount OR e.entitlement_kind IS DISTINCT FROM 'wallet_charge'
 OR l.status IS DISTINCT FROM 'posted' OR (l.to_type='player_wallet' OR (l.to_type='agent_wallet' AND EXISTS(SELECT 1 FROM public.agents a WHERE a.user_id=r.user_id AND a.club_id=e.refund_wallet_club_id))) IS DISTINCT FROM true OR l.to_entity_id IS DISTINCT FROM r.user_id
 OR l.club_id IS DISTINCT FROM e.refund_wallet_club_id
 OR l.from_entity_id IS DISTINCT FROM '47965354-0e56-43ef-931c-ddaab82af765'::uuid
 OR ((l.category='agent_send' AND l.from_type='agent_wallet') OR (l.category='promo_send' AND l.from_type='promo_wallet')) IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE id=e.source_ledger_id)
 OR l.amount IS NULL OR l.amount<r.amount OR l.amount::text IN ('NaN','Infinity','-Infinity')
 OR l.created_at<(SELECT created_at FROM public.chip_ledger WHERE id=e.source_ledger_id)
 OR r.receipt->>'credit_ledger_id' IS DISTINCT FROM l.id::text
 OR (r.receipt->>'source_credit_amount')::numeric IS DISTINCT FROM l.amount
 OR r.receipt->>'source_credit_key' IS DISTINCT FROM l.idempotency_key
 OR r.receipt->>'source_credit_wallet' IS DISTINCT FROM l.to_type
 OR EXISTS(SELECT 1 FROM smarter_private.owner_retirement_bank_refunds WHERE entitlement_id=e.id)
 OR EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=e.id)
 THEN RAISE EXCEPTION 'owner_manual_refund_credit_evidence_changed';END IF;
 RETURN r.receipt;
END $body$;
REVOKE ALL ON FUNCTION smarter_private.owner_manual_refund_receipt(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_record_owner_manual_refund(p_entitlement_id uuid,p_credit_ledger_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $body$
DECLARE e public.tournament_refund_entitlements;l public.chip_ledger;prior jsonb;answer jsonb;expected record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND NOT(session_user='postgres' AND coalesce(current_setting('role',true),'none') IN ('none','postgres') AND auth.role() IS NULL)
 THEN RAISE EXCEPTION 'owner_manual_refund_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO expected FROM (VALUES
 ('26b465dd-600d-42eb-9f37-68f6052febac'::uuid,'2781bcd7-cc8a-4713-ab3e-0d0a81fdf110'::uuid,'eed278a8-3ca2-4e2d-a196-0a0cd9e74f90'::uuid,5::numeric),
 ('8e6232d8-bbd7-4dc8-9640-4fbfa45ca952','6379b29e-1307-4e8b-91e7-e9a0975cd64d','d55730d2-da5a-45fc-8478-82e49f97cd7e',1),
 ('1edfe4d2-005d-4b93-96d0-fc0bb10f8c95','d5decc98-cd0f-417f-aa28-6df009a74c76','ed2d1c05-c3bb-4d9e-b862-2a9797d32044',1),
 ('26ac24a2-7c73-44af-a5ae-b971d0a8e4fd','d5decc98-cd0f-417f-aa28-6df009a74c76','c657675c-f970-4c42-8f19-ba4d8096be67',1)
 )v(entitlement_id,tournament_id,user_id,amount) WHERE entitlement_id=p_entitlement_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'owner_manual_refund_outside_manifest';END IF;
 -- Same parent row as retirement and original refund serializes disposition.
 PERFORM 1 FROM public.tournaments WHERE id=expected.tournament_id FOR UPDATE;
 prior:=smarter_private.owner_manual_refund_receipt(p_entitlement_id);
 IF prior IS NOT NULL THEN
  IF prior->>'credit_ledger_id' IS DISTINCT FROM p_credit_ledger_id::text THEN RAISE EXCEPTION 'owner_manual_refund_different_replay';END IF;
  RETURN prior;
 END IF;
 SELECT * INTO e FROM public.tournament_refund_entitlements WHERE id=p_entitlement_id;
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_credit_ledger_id;
 IF e.tournament_id IS DISTINCT FROM expected.tournament_id OR e.user_id IS DISTINCT FROM expected.user_id OR e.gross IS DISTINCT FROM expected.amount
 OR e.refund_wallet_club_id IS DISTINCT FROM 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
 OR NOT EXISTS(SELECT 1 FROM smarter_private.owner_tournament_deletion_intents WHERE tournament_id=e.tournament_id AND owner_chat_id='01a19ccc-894e-75e2-a9e7-fe0d2df6c326')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=e.tournament_id AND status IN ('RUNNING','BREAK','LATE_REG'))
 OR l.id IS NULL THEN RAISE EXCEPTION 'owner_manual_refund_original_scope_changed';END IF;
 answer:=jsonb_build_object('mode','owner_manual_credit_evidence','entitlement_id',e.id,'tournament_id',e.tournament_id,'user_id',e.user_id,
 'amount',e.gross,'original_charge_ledger_id',e.source_ledger_id,'credit_ledger_id',l.id,'source_credit_amount',l.amount,'source_credit_key',l.idempotency_key,
 'source_credit_wallet',l.to_type,'source_credit_time',l.created_at,'owner_chat_id','01a19ccc-894e-75e2-a9e7-fe0d2df6c326','new_payment',false,'recorded_at',clock_timestamp());
 INSERT INTO smarter_private.owner_retirement_manual_refunds(entitlement_id,tournament_id,user_id,credit_ledger_id,amount,receipt)
 VALUES(e.id,e.tournament_id,e.user_id,l.id,e.gross,answer);
 RETURN smarter_private.owner_manual_refund_receipt(e.id);
END $body$;
REVOKE ALL ON FUNCTION public.fn_ca_record_owner_manual_refund(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_record_owner_manual_refund(uuid,uuid) TO service_role;

DO $patch$ DECLARE d text;p text;BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO p,d FROM pg_proc WHERE oid='smarter_private.owner_retirement_transfer_pools(uuid,uuid)'::regprocedure;
 IF md5(p)<>'7d67fb45b46fa904e8bf835ed95d5660' OR length(d)-length(replace(d,$old$  IF prior IS NULL OR (prior->>'amount')::numeric IS DISTINCT FROM refundable.amount
   OR NOT EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=refundable.entitlement_id
    AND amount_paid_now=refundable.amount AND credit_ledger_id=(prior->'refund'->>'credit_ledger_id')::uuid)
  THEN RAISE EXCEPTION 'owner_retirement_original_refund_missing';END IF;$old$,''))<>length($old$  IF prior IS NULL OR (prior->>'amount')::numeric IS DISTINCT FROM refundable.amount
   OR NOT EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=refundable.entitlement_id
    AND amount_paid_now=refundable.amount AND credit_ledger_id=(prior->'refund'->>'credit_ledger_id')::uuid)
  THEN RAISE EXCEPTION 'owner_retirement_original_refund_missing';END IF;$old$)
 THEN RAISE EXCEPTION 'manual_refund_source_preimage_changed:smarter_private.owner_retirement_transfer_pools(uuid,uuid)';END IF;
 
 EXECUTE replace(d,$old$  IF prior IS NULL OR (prior->>'amount')::numeric IS DISTINCT FROM refundable.amount
   OR NOT EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=refundable.entitlement_id
    AND amount_paid_now=refundable.amount AND credit_ledger_id=(prior->'refund'->>'credit_ledger_id')::uuid)
  THEN RAISE EXCEPTION 'owner_retirement_original_refund_missing';END IF;$old$,$new$  IF smarter_private.owner_manual_refund_receipt(refundable.entitlement_id) IS NULL AND
   (prior IS NULL OR (prior->>'amount')::numeric IS DISTINCT FROM refundable.amount
   OR NOT EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=refundable.entitlement_id
    AND amount_paid_now=refundable.amount AND credit_ledger_id=(prior->'refund'->>'credit_ledger_id')::uuid))
  THEN RAISE EXCEPTION 'owner_retirement_original_refund_missing';END IF;$new$);
END $patch$;

DO $patch$ DECLARE d text;p text;BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO p,d FROM pg_proc WHERE oid='public.fn_ca_owner_retire_tournament(uuid,uuid,text)'::regprocedure;
 IF md5(p)<>'cd5db29ba0cdbf309e89551fdec4c85b' OR length(d)-length(replace(d,$old$'original_refunds',(SELECT coalesce(jsonb_agg(r.receipt ORDER BY r.entitlement_id),'[]') FROM smarter_private.owner_retirement_bank_refunds r WHERE r.tournament_id=p_tournament_id))$old$,''))<>length($old$'original_refunds',(SELECT coalesce(jsonb_agg(r.receipt ORDER BY r.entitlement_id),'[]') FROM smarter_private.owner_retirement_bank_refunds r WHERE r.tournament_id=p_tournament_id))$old$)
 THEN RAISE EXCEPTION 'manual_refund_source_preimage_changed:public.fn_ca_owner_retire_tournament(uuid,uuid,text)';END IF;
 
 EXECUTE replace(d,$old$'original_refunds',(SELECT coalesce(jsonb_agg(r.receipt ORDER BY r.entitlement_id),'[]') FROM smarter_private.owner_retirement_bank_refunds r WHERE r.tournament_id=p_tournament_id))$old$,$new$'original_refunds',(SELECT coalesce(jsonb_agg(r.receipt ORDER BY r.entitlement_id),'[]') FROM smarter_private.owner_retirement_bank_refunds r WHERE r.tournament_id=p_tournament_id),'manual_refunds',(SELECT coalesce(jsonb_agg(smarter_private.owner_manual_refund_receipt(r.entitlement_id) ORDER BY r.entitlement_id),'[]') FROM smarter_private.owner_retirement_manual_refunds r WHERE r.tournament_id=p_tournament_id))$new$);
END $patch$;

DO $patch$ DECLARE d text;p text;BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO p,d FROM pg_proc WHERE oid='smarter_private.owner_retirement_receipt(uuid,uuid)'::regprocedure;
 IF md5(p)<>'6742a47d780290d2e16ff39c14ba53da' OR length(d)-length(replace(d,$old$ RETURN h.receipt;$old$,''))<>length($old$ RETURN h.receipt;$old$)
 THEN RAISE EXCEPTION 'manual_refund_source_preimage_changed:smarter_private.owner_retirement_receipt(uuid,uuid)';END IF;
 d:=replace(d,$array$ARRAY['fully_settled','refunds','total_refunded','original_refunds']$array$,$array$ARRAY['fully_settled','refunds','total_refunded','original_refunds','manual_refunds']$array$);
 EXECUTE replace(d,$old$ RETURN h.receipt;$old$,$new$ IF coalesce(h.receipt->'financial'->'manual_refunds','[]'::jsonb) IS DISTINCT FROM
 (SELECT coalesce(jsonb_agg(smarter_private.owner_manual_refund_receipt(r.entitlement_id) ORDER BY r.entitlement_id),'[]') FROM smarter_private.owner_retirement_manual_refunds r WHERE r.tournament_id=p_tournament_id)
 THEN RAISE EXCEPTION 'owner_retirement_manual_refund_receipt_changed';END IF;
 RETURN h.receipt;$new$);
END $patch$;

DO $patch$ DECLARE d text;p text;BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO p,d FROM pg_proc WHERE oid='public.fn_ca_owner_retirement_bank_refund(uuid)'::regprocedure;
 IF md5(p)<>'60ace3c05a251f9a229d0917a2b051b3' OR length(d)-length(replace(d,$old$BEGIN
 IF auth.role()$old$,''))<>length($old$BEGIN
 IF auth.role()$old$)
 THEN RAISE EXCEPTION 'manual_refund_source_preimage_changed:public.fn_ca_owner_retirement_bank_refund(uuid)';END IF;
 
 EXECUTE replace(d,$old$BEGIN
 IF auth.role()$old$,$new$BEGIN
 RAISE EXCEPTION 'owner_manual_credits_supersede_bank_refunds' USING ERRCODE='55000';
 IF auth.role()$new$);
END $patch$;
REVOKE ALL ON FUNCTION smarter_private.owner_retirement_transfer_pools(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_owner_retire_tournament(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_owner_retire_tournament(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION smarter_private.owner_retirement_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_owner_retirement_bank_refund(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_owner_retirement_bank_refund(uuid) TO service_role;
DO $$BEGIN IF clock_timestamp()-transaction_timestamp()>interval '8 seconds' THEN RAISE EXCEPTION 'owner_manual_refund_install_budget';END IF;END$$;
COMMIT;
