-- 20261116154841_expired_and_departed_promo_principal_returns_to_its_original.sql
-- @install-window: daily-maintenance
-- @locks: public.ca_promo_play_through_grants
-- @live-proof: to_regprocedure('public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)') IS NOT NULL
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
--
-- Needs ACCESS EXCLUSIVE (or SHARE / SHARE ROW EXCLUSIVE) on a hot table such as
-- clubs, tables or hand_history? Then it waits for the daily 04:00 America/Chicago
-- break (CLAUDE.md section 2 rule 10). Declare it with the rule's header line
-- "install-window: daily-maintenance" (prefixed "-- @", on a line of its own),
-- and optionally name the hot relations this file locks on a second header
-- line "locks: public.clubs, public.tables" (same "-- @" prefix, comma
-- separated, schema-qualified) so the installer sends files sharing a relation
-- together. The locks line orders only; it never widens a timeout.

BEGIN;

SET LOCAL lock_timeout='1s';

DO $guard$ BEGIN
 IF to_regprocedure('public.fn_ca_promo_move_owned_wallet(uuid,numeric)') IS NULL THEN
  RAISE EXCEPTION 'original promo custody must install before its wallet owners';
 END IF;
END $guard$;

-- The original owners supply their exact source balance and immutable journal
-- identity. A later combined wallet balance cannot reconstruct this ordering.
DO $wallets$
DECLARE def text;needle text;addition text;
BEGIN
 SELECT pg_get_functiondef('public.fn_agent_wallet_self_stake(uuid,numeric,text,uuid)'::regprocedure) INTO def;
 IF md5(def)<>'438f699e38c8e2e6a9949c76e526731b' THEN RAISE EXCEPTION 'self_stake_promo_preimage_changed'; END IF;
 needle:=E'  insert into public.chip_transactions\n';
 addition:=E'  DECLARE promo_leg uuid; BEGIN\n    SELECT id INTO STRICT promo_leg FROM public.chip_ledger\n     WHERE club_id=p_club_id AND idempotency_key=''agent_self_stake:''||p_op_id::text\n      AND from_type=''agent_wallet'' AND from_entity_id=v_actor\n      AND to_type=''player_wallet'' AND to_entity_id=v_actor AND amount=p_amount;\n    PERFORM public.fn_ca_promo_move_owned_wallet(promo_leg,v_wallet_after+p_amount);\n  END;\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'self_stake_promo_anchor_changed'; END IF;
 EXECUTE replace(def,needle,addition||needle);

 SELECT pg_get_functiondef('public.fn_agent_wallet_send_core_20260830(uuid,uuid,numeric,text,text,uuid)'::regprocedure) INTO def;
 IF md5(def)<>'1ee7dc270ba19bf1b6a4a894900d9b38' THEN RAISE EXCEPTION 'agent_send_promo_preimage_changed'; END IF;
 needle:=E'  v_until := now() + interval ''10 minutes'';';
 addition:=E'  IF p_to_user_id=v_actor AND v_dest=''player_wallet'' THEN\n    DECLARE promo_leg uuid; BEGIN\n      SELECT id INTO STRICT promo_leg FROM public.chip_ledger\n       WHERE club_id=p_club_id AND idempotency_key=''agent_send:''||v_op_id::text\n        AND from_type=''agent_wallet'' AND from_entity_id=v_actor\n        AND to_type=''player_wallet'' AND to_entity_id=v_actor AND amount=p_amount;\n      PERFORM public.fn_ca_promo_move_owned_wallet(promo_leg,v_float_before);\n    END;\n  END IF;\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'agent_send_promo_anchor_changed'; END IF;
 EXECUTE replace(def,needle,addition||needle);

 SELECT pg_get_functiondef('public.fn_club_wallet_claim_back(uuid,uuid,numeric,text,text,text,uuid,uuid)'::regprocedure) INTO def;
 IF md5(def)<>'54450c4c6f5e6ca4d3b7804a669bf0cc' THEN RAISE EXCEPTION 'own_claim_promo_preimage_changed'; END IF;
 needle:=E' IF p_transaction_id IS NOT NULL THEN\n  UPDATE public.chip_transactions';
 addition:=E' IF actor=p_from_user_id AND p_source IN(''player_wallet'',''agent_wallet'')\n  AND p_destination IN(''player_wallet'',''agent_wallet'') AND p_source<>p_destination AND v_amount>repay THEN\n  DECLARE promo_leg uuid; BEGIN\n   SELECT id INTO STRICT promo_leg FROM public.chip_ledger\n    WHERE club_id=p_club_id AND idempotency_key=''club_wallet_claim:''||p_op_id::text\n     AND from_type=p_source AND from_entity_id=actor AND to_type=p_destination\n     AND to_entity_id=actor AND amount=v_amount-repay;\n   PERFORM public.fn_ca_promo_move_owned_wallet(promo_leg,held-repay);\n  END;\n END IF;\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'own_claim_promo_anchor_changed'; END IF;
 EXECUTE replace(def,needle,addition||needle);
END $wallets$;

-- Enter the already-existing cashier lane before funding a recipient. This
-- also fences a new grant against that member's simultaneous departure.
DO $disbursement$
DECLARE def text;needle text:=E'  IF v_src = ''union'' THEN\n    SELECT COALESCE(promo_wallet, 0) INTO v_avail';
BEGIN
 SELECT pg_get_functiondef('public.fn_promo_disburse(text,uuid,text,uuid,numeric,text,uuid,uuid)'::regprocedure) INTO def;
 IF md5(def)<>'e54e4f3949335c61d4c1492d81b5ca21' THEN RAISE EXCEPTION 'promo_disbursement_lane_preimage_changed'; END IF;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_disbursement_lane_anchor_changed'; END IF;
 EXECUTE replace(def,needle,E'  IF NOT pg_try_advisory_xact_lock(hashtextextended(''agent-agreement:''||v_club::text,0)) OR NOT pg_try_advisory_xact_lock(hashtextextended(''cashier-hierarchy:''||v_club::text,0)) THEN RAISE EXCEPTION ''promo_cashier_lane_busy'' USING ERRCODE=''55P03''; END IF;\n\n'||needle);
END $disbursement$;

CREATE TABLE public.ca_promo_principal_return_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),
 operation_ref text NOT NULL,
 holder_club_id uuid NOT NULL,
 wallet text NOT NULL CHECK(wallet IN('player_wallet','agent_wallet')),
 reason text NOT NULL CHECK(reason IN('expired','left_club','returned','fee_refund','loss_refund')),
 fee_refund_entitlement_id uuid,
 fee_refund_credit_ledger_id uuid,
 fee_refund_charge_ledger_id uuid,
 requested_amount numeric,
 amount numeric NOT NULL CHECK(amount>0),
 funded_from_type text NOT NULL,
 funded_from_id uuid NOT NULL,
 ledger_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(grant_id,operation_ref),
 UNIQUE(grant_id,fee_refund_entitlement_id,reason),
 UNIQUE(grant_id,fee_refund_charge_ledger_id,reason)
);
ALTER TABLE public.ca_promo_principal_return_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_principal_return_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_principal_return_receipts TO service_role;

-- Original refund/redemption owners acquire these before their first holder
-- wallet lock. Cold grant identities are immutable; no new balance door.
CREATE FUNCTION public.fn_ca_promo_lock_grant_funds(p_grants uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $funds$
DECLARE f record;
BEGIN
 IF p_grants IS NULL OR cardinality(p_grants)>1000 THEN RAISE EXCEPTION 'invalid_promo_return_fund_scope'; END IF;
 FOR f IN SELECT DISTINCT funded_from_type,funded_from_id,club_id
  FROM public.ca_promo_play_through_grants WHERE id=ANY(p_grants)
  ORDER BY funded_from_type,funded_from_id,club_id LOOP
  IF f.funded_from_type='union_wallet' THEN
   PERFORM 1 FROM public.union_wallets WHERE union_id=f.funded_from_id FOR UPDATE;
  ELSIF f.funded_from_type='promo_wallet' AND EXISTS(SELECT 1 FROM public.clubs WHERE id=f.funded_from_id) THEN
   PERFORM 1 FROM public.clubs WHERE id=f.funded_from_id FOR UPDATE;
  ELSIF f.funded_from_type='promo_wallet' THEN
   PERFORM 1 FROM public.agents WHERE club_id=f.club_id AND user_id=f.funded_from_id FOR UPDATE;
  ELSE RAISE EXCEPTION 'promo_return_original_fund_type_unproven';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'promo_return_original_fund_missing'; END IF;
 END LOOP;
END $funds$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_lock_grant_funds(uuid[]) FROM PUBLIC,anon,authenticated,service_role;

-- Private original product return, used by the expiry, departure and verified
-- refund owners. It can debit only this grant's actual wallet principal and
-- credit only its recorded original promo fund. Never debit a table or create
-- another grant/fee target. The original request supplies its retry identity.
INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES
 ('fn_ca_promo_return_principal','approved',
  'Owner-requested promo expiry, departure and original verified refund return. Owner-only EXECUTE; exact original grant and surviving wallet custody; original fund credited atomically, stable intent receipt and one canonical journal leg. No table debit or new grant.');
CREATE FUNCTION public.fn_ca_promo_return_principal(
 p_grant_id uuid,p_wallet text,p_reason text,p_amount numeric DEFAULT NULL,p_operation_ref text DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $return$
DECLARE
 g public.ca_promo_play_through_grants%ROWTYPE;
 prior public.ca_promo_principal_return_receipts%ROWTYPE;
 source_kind text;source_label text;source_id uuid;fund_balance numeric;wallet_balance numeric;holder_club uuid;refund_credit uuid;
 principal numeric;amount_to_return numeric;receipt_id uuid:=gen_random_uuid();ledger_id uuid;
 fee_mode boolean:=p_reason IN('fee_refund','loss_refund');fee_entitlement uuid;fee_credit uuid;fee_charge uuid;fee_principal numeric;
 operation text;saved jsonb;context_saved jsonb;context_key text;member_after numeric;fund_after numeric;state text;
BEGIN
 IF p_grant_id IS NULL OR p_wallet IS NULL OR p_wallet NOT IN('player_wallet','agent_wallet')
  OR p_reason IS NULL OR p_reason NOT IN('expired','left_club','returned','fee_refund','loss_refund')
  OR (p_amount IS NOT NULL AND (p_amount<=0 OR p_amount<>round(p_amount,2)
      OR p_amount::text IN('NaN','Infinity','-Infinity'))) THEN RAISE EXCEPTION 'invalid_promo_principal_return'; END IF;
 SELECT * INTO g FROM public.ca_promo_play_through_grants WHERE id=p_grant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'promo_return_original_grant_missing'; END IF;
 holder_club:=g.club_id;
 operation:=COALESCE(NULLIF(btrim(p_operation_ref),''),p_reason||':'||p_wallet||':'||g.remaining::text);
 IF length(operation)>300 THEN RAISE EXCEPTION 'promo_return_operation_reference_too_long'; END IF;
 IF fee_mode THEN
  IF p_wallet<>'player_wallet' OR split_part(operation,':',1)<>p_reason OR p_amount IS NULL THEN RAISE EXCEPTION 'invalid_original_promo_fee_refund'; END IF;
  fee_credit:=split_part(operation,':',2)::uuid;fee_entitlement:=split_part(operation,':',3)::uuid;
  SELECT source_ledger_id,refund_wallet_club_id INTO fee_charge,holder_club FROM public.tournament_refund_entitlements WHERE id=fee_entitlement;
  IF p_reason='fee_refund' THEN
  SELECT sum(fs.amount) INTO fee_principal
   FROM public.tournament_refund_entitlements e JOIN public.tournament_refund_tranches tr ON tr.entitlement_id=e.id
   JOIN public.chip_ledger credit ON credit.id=tr.credit_ledger_id
   JOIN public.ca_promo_event_fee_consumption_receipts fee ON fee.charge_ledger_id=e.source_ledger_id AND fee.entitlement_id=e.id
   JOIN public.ca_promo_event_fee_consumption_slices fs ON fs.charge_ledger_id=fee.charge_ledger_id AND fs.grant_id=g.id
   WHERE e.id=fee_entitlement AND tr.credit_ledger_id=fee_credit
    AND e.user_id=g.user_id AND fee.club_id=g.club_id AND fee.player_id=g.user_id
    AND tr.user_id=e.user_id AND tr.source_wallet_club_id=e.refund_wallet_club_id
    AND tr.tournament_id=e.tournament_id AND tr.amount_paid_now=e.gross AND tr.refund_fee=e.refund_fee
    AND credit.from_type='prize_liability' AND credit.from_entity_id=e.tournament_id
    AND credit.to_type='player_wallet' AND credit.to_entity_id=e.user_id AND credit.club_id=e.refund_wallet_club_id
    AND credit.category IN('refund','tournament_refund') AND credit.amount=e.gross;
  ELSE
  SELECT sum(fs.amount) INTO fee_principal
   FROM public.tournament_refund_entitlements e JOIN public.tournament_refund_tranches tr ON tr.entitlement_id=e.id
   JOIN public.chip_ledger credit ON credit.id=tr.credit_ledger_id
   JOIN public.ca_promo_event_fee_consumption_receipts fee ON fee.charge_ledger_id=e.source_ledger_id AND fee.entitlement_id=e.id
   JOIN public.ca_promo_event_entry_loss_slices fs ON fs.charge_ledger_id=fee.charge_ledger_id AND fs.grant_id=g.id
   WHERE e.id=fee_entitlement AND tr.credit_ledger_id=fee_credit
    AND e.user_id=g.user_id AND fee.club_id=g.club_id AND fee.player_id=g.user_id
    AND tr.user_id=e.user_id AND tr.source_wallet_club_id=e.refund_wallet_club_id
    AND tr.tournament_id=e.tournament_id AND tr.amount_paid_now=e.gross AND tr.refund_fee=e.refund_fee
    AND credit.from_type='prize_liability' AND credit.from_entity_id=e.tournament_id
    AND credit.to_type='player_wallet' AND credit.to_entity_id=e.user_id AND credit.club_id=e.refund_wallet_club_id
    AND credit.category IN('refund','tournament_refund') AND credit.amount=e.gross;
  END IF;
  IF fee_principal IS NULL OR fee_principal<=0 OR fee_principal IS DISTINCT FROM p_amount
   OR fee_principal>(SELECT CASE WHEN p_reason='fee_refund' THEN refund_fee ELSE refund_prize+refund_bounty END FROM public.tournament_refund_entitlements WHERE id=fee_entitlement) THEN
   RAISE EXCEPTION 'promo_fee_refund_lost_original_source'; END IF;
 END IF;
 IF NOT fee_mode AND p_reason='returned' AND split_part(operation,':',1)='event_refund' THEN
  refund_credit:=split_part(operation,':',2)::uuid;
  SELECT tr.source_wallet_club_id INTO holder_club
   FROM public.tournament_refund_tranches tr JOIN public.tournament_refund_entitlements e ON e.id=tr.entitlement_id
   JOIN public.chip_ledger credit ON credit.id=tr.credit_ledger_id
   JOIN public.ca_promo_event_realization_slices slice ON slice.ledger_id=credit.id AND slice.grant_id=g.id
   WHERE credit.id=refund_credit AND credit.to_type='player_wallet' AND credit.to_entity_id=g.user_id
    AND credit.from_type='prize_liability' AND credit.from_entity_id=e.tournament_id AND credit.club_id=tr.source_wallet_club_id
    AND credit.amount=tr.amount_paid_now AND tr.entitlement_id=e.id AND e.source_ledger_id IN(SELECT lot.charge_ledger_id FROM public.ca_promo_event_principal_lots lot WHERE lot.grant_id=g.id)
    AND tr.user_id=g.user_id AND e.user_id=g.user_id AND slice.amount=p_amount;
  IF holder_club IS NULL THEN RAISE EXCEPTION 'promo_refund_return_lost_original_wallet'; END IF;
 END IF;
 SELECT * INTO prior FROM public.ca_promo_principal_return_receipts WHERE grant_id=p_grant_id AND operation_ref=operation;
 IF FOUND THEN
  IF prior.wallet<>p_wallet OR prior.holder_club_id<>holder_club OR prior.reason<>p_reason OR prior.requested_amount IS DISTINCT FROM p_amount THEN
   RAISE EXCEPTION 'promo_return_retry_intent_changed' USING ERRCODE='22023';
  END IF;
  RETURN prior.amount;
 END IF;
 IF g.closed_at IS NOT NULL AND NOT fee_mode THEN RETURN 0; END IF;

 -- Match original disbursement ownership: the source promo fund is locked
 -- before the holder's wallet. Retired agent rows still own their promo fund.
 source_id:=g.funded_from_id;
 IF g.funded_from_type='union_wallet' THEN
  source_kind:='union_wallet';source_label:='union_wallets.promo_wallet';
  SELECT promo_wallet INTO fund_balance FROM public.union_wallets WHERE union_id=source_id FOR UPDATE;
 ELSIF g.funded_from_type='promo_wallet' THEN
  source_kind:='promo_wallet';
  IF EXISTS(SELECT 1 FROM public.clubs WHERE id=source_id) THEN
   source_label:='clubs.promo_balance';
   SELECT promo_balance INTO fund_balance FROM public.clubs WHERE id=source_id FOR UPDATE;
  ELSE
   source_label:='agents.promo_wallet_balance';
   SELECT promo_wallet_balance INTO fund_balance FROM public.agents WHERE club_id=g.club_id AND user_id=source_id FOR UPDATE;
  END IF;
 ELSE RAISE EXCEPTION 'promo_return_original_fund_type_unproven';
 END IF;
 IF source_id IS NULL OR fund_balance IS NULL THEN RAISE EXCEPTION 'promo_return_original_fund_missing'; END IF;
 IF p_wallet='player_wallet' THEN
  SELECT chip_balance INTO wallet_balance FROM public.club_members WHERE club_id=holder_club AND user_id=g.user_id FOR UPDATE;
 ELSE
  SELECT agent_wallet_balance INTO wallet_balance FROM public.agents WHERE club_id=g.club_id AND user_id=g.user_id FOR UPDATE;
 END IF;
 IF wallet_balance IS NULL THEN RAISE EXCEPTION 'promo_return_holder_wallet_missing'; END IF;
 SELECT * INTO g FROM public.ca_promo_play_through_grants WHERE id=p_grant_id FOR UPDATE;
 SELECT * INTO prior FROM public.ca_promo_principal_return_receipts WHERE grant_id=p_grant_id AND operation_ref=operation;
 IF FOUND THEN
  IF prior.wallet<>p_wallet OR prior.holder_club_id<>holder_club OR prior.reason<>p_reason OR prior.requested_amount IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'promo_return_retry_intent_changed'; END IF;
  RETURN prior.amount;
 END IF;
 IF g.closed_at IS NOT NULL AND NOT fee_mode THEN RETURN 0; END IF;
 IF fee_mode THEN
  -- The actual original refund just credited this exact fee. Return it to
  -- its original fund even when that grant is already closed; never reopen
  -- the grant, manufacture custody, or take another deposit's principal.
  IF wallet_balance<fee_principal THEN RAISE EXCEPTION 'original_promo_fee_refund_credit_missing'; END IF;
  amount_to_return:=fee_principal;
 ELSE
 SELECT s.state INTO state FROM public.fn_ca_promo_play_through_state(g.club_id,g.user_id) s WHERE s.grant_id=g.id;
 IF state IS NULL OR state NOT IN('locked','expired_pending') THEN RETURN 0; END IF;
 IF p_reason='expired' AND state<>'expired_pending' THEN RETURN 0; END IF;
 SELECT amount INTO principal FROM public.ca_promo_principal_custody
  WHERE grant_id=g.id AND kind=p_wallet AND entity_id=g.user_id FOR UPDATE;
 amount_to_return:=LEAST(COALESCE(principal,0),COALESCE(p_amount,principal),wallet_balance);
 IF amount_to_return<=0 OR amount_to_return IS NULL THEN RETURN 0; END IF;

 END IF;

 saved:=public.fn_ca_ledger_declaration_save(ARRAY['clubs','agents','club_members','union_wallets']);
 -- The shared declaration saver deliberately excludes operation context.
 -- This nested reversal owns a fresh key and must restore the original
 -- departure/refund owner's key before that owner writes its next leg.
 SELECT jsonb_object_agg(k,COALESCE(current_setting(k,true),'')) INTO context_saved
  FROM unnest(ARRAY['app.ledger_idempotency_key','app.ledger_tournament',
   'app.ledger_tournament_id','app.ledger_hand_id',
   'app.ledger_settlement','app.ledger_correlation']) AS context(k);
 PERFORM set_config('app.ledger_tournament','',true);
 PERFORM set_config('app.ledger_tournament_id','',true);
 PERFORM set_config('app.ledger_hand_id','',true);
 PERFORM set_config('app.ledger_settlement','',true);
 PERFORM set_config('app.ledger_correlation','',true);
 PERFORM public.fn_ca_declare_ledger('reversal',source_kind,source_id,NULL,
  'promo_principal_return:'||receipt_id::text,ARRAY['clubs','agents','club_members','union_wallets']);
 PERFORM set_config('app.ledger_counterparty_label',source_label,true);
 IF p_wallet='player_wallet' THEN
  UPDATE public.club_members SET chip_balance=chip_balance-amount_to_return,updated_at=now()
   WHERE club_id=holder_club AND user_id=g.user_id RETURNING chip_balance INTO member_after;
 ELSE
  UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-amount_to_return,updated_at=now()
   WHERE club_id=g.club_id AND user_id=g.user_id RETURNING agent_wallet_balance INTO member_after;
 END IF;
 IF source_label='union_wallets.promo_wallet' THEN
  UPDATE public.union_wallets SET promo_wallet=promo_wallet+amount_to_return,updated_at=now()
   WHERE union_id=source_id RETURNING promo_wallet INTO fund_after;
 ELSIF source_label='clubs.promo_balance' THEN
  UPDATE public.clubs SET promo_balance=promo_balance+amount_to_return,updated_at=now()
   WHERE id=source_id RETURNING promo_balance INTO fund_after;
 ELSE
  UPDATE public.agents SET promo_wallet_balance=promo_wallet_balance+amount_to_return,updated_at=now()
   WHERE club_id=g.club_id AND user_id=source_id RETURNING promo_wallet_balance INTO fund_after;
 END IF;
 IF member_after IS NULL OR fund_after IS NULL THEN RAISE EXCEPTION 'promo_return_credit_landed_nowhere'; END IF;
 IF NOT fee_mode THEN
 WITH returned AS (
  UPDATE public.ca_promo_principal_custody SET amount=amount-amount_to_return
   WHERE grant_id=g.id AND kind=p_wallet AND entity_id=g.user_id RETURNING grant_id
 )
 UPDATE public.ca_promo_play_through_grants SET remaining=remaining-amount_to_return,
  closed_at=CASE WHEN remaining=amount_to_return THEN clock_timestamp() ELSE NULL END,
  close_reason=CASE WHEN remaining=amount_to_return THEN p_reason ELSE NULL END,
  close_note=CASE WHEN remaining=amount_to_return THEN 'Original Principal Returned: '||operation ELSE close_note END
  WHERE id=g.id AND EXISTS(SELECT 1 FROM returned);
 END IF;
 -- The general nine-argument post helper cannot name a union wallet column.
 -- Post the same single original journal leg with both explicit labels,
 -- through all existing enrichment, epoch, tally and conservation guards.
 INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,
  from_label,to_label,amount,category,club_id,description,idempotency_key)
 VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),p_wallet,g.user_id,source_kind,source_id,
  CASE p_wallet WHEN 'player_wallet' THEN 'club_members.chip_balance' ELSE 'agents.agent_wallet_balance' END,
  source_label,round(amount_to_return,2),'reversal',holder_club,'Promo Principal Returned To Original Fund',
  'promo_principal_return:'||receipt_id::text) RETURNING id INTO ledger_id;
 PERFORM public.fn_ca_ledger_declaration_restore(saved);
 FOR context_key IN SELECT jsonb_object_keys(context_saved) LOOP
  PERFORM set_config(context_key,context_saved->>context_key,true);
 END LOOP;
 INSERT INTO public.ca_promo_principal_return_receipts(id,grant_id,operation_ref,holder_club_id,wallet,reason,requested_amount,amount,funded_from_type,funded_from_id,ledger_id,fee_refund_entitlement_id,fee_refund_credit_ledger_id,fee_refund_charge_ledger_id)
 VALUES(receipt_id,g.id,operation,holder_club,p_wallet,p_reason,p_amount,amount_to_return,source_kind,source_id,ledger_id,fee_entitlement,fee_credit,fee_charge);
 INSERT INTO public.chip_transactions(club_id,from_user_id,amount,transaction_type,notes,metadata,balance_after)
 VALUES(holder_club,g.user_id,amount_to_return,'promo_reversal','Promo Principal Returned To Original Fund',
  jsonb_build_object('grant_id',g.id,'operation_ref',operation,'reason',p_reason,'source',p_wallet,
   'funded_from_type',source_kind,'funded_from_id',source_id,'ledger_id',ledger_id),member_after);
 IF source_kind='union_wallet' THEN
  INSERT INTO public.union_wallet_transactions(union_id,club_id,wallet,direction,amount,balance_after,tx_type,notes)
  VALUES(source_id,holder_club,'promo_wallet','credit',amount_to_return,fund_after,'promo_reversal','Promo Principal Returned To Original Fund');
 END IF;
 RETURN amount_to_return;
END $return$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_return_principal(uuid,text,text,numeric,text) FROM PUBLIC,anon,authenticated,service_role;

-- Called only after the original exact refund has verified its credit and
-- canonical tranche. It uses the same permanent source-fund return owner.
CREATE FUNCTION public.fn_ca_promo_return_spent_event_fee(p_credit_ledger_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;paid numeric;total numeric:=0;
BEGIN
 FOR r IN SELECT tr.entitlement_id,fs.grant_id,sum(fs.amount) amount
  FROM public.tournament_refund_tranches tr JOIN public.tournament_refund_entitlements e ON e.id=tr.entitlement_id
  JOIN public.ca_promo_event_fee_consumption_receipts fee ON fee.charge_ledger_id=e.source_ledger_id AND fee.entitlement_id=e.id
  JOIN public.ca_promo_event_fee_consumption_slices fs ON fs.charge_ledger_id=fee.charge_ledger_id
  WHERE tr.credit_ledger_id=p_credit_ledger_id GROUP BY tr.entitlement_id,fs.grant_id ORDER BY fs.grant_id LOOP
  paid:=public.fn_ca_promo_return_principal(r.grant_id,'player_wallet','fee_refund',r.amount,
   'fee_refund:'||p_credit_ledger_id||':'||r.entitlement_id);
  total:=total+paid;
 END LOOP;
 FOR r IN SELECT tr.entitlement_id,fs.grant_id,sum(fs.amount) amount
  FROM public.tournament_refund_tranches tr JOIN public.tournament_refund_entitlements e ON e.id=tr.entitlement_id
  JOIN public.ca_promo_event_fee_consumption_receipts fee ON fee.charge_ledger_id=e.source_ledger_id AND fee.entitlement_id=e.id
  JOIN public.ca_promo_event_entry_loss_slices fs ON fs.charge_ledger_id=fee.charge_ledger_id
  WHERE tr.credit_ledger_id=p_credit_ledger_id GROUP BY tr.entitlement_id,fs.grant_id ORDER BY fs.grant_id LOOP
  paid:=public.fn_ca_promo_return_principal(r.grant_id,'player_wallet','loss_refund',r.amount,
   'loss_refund:'||p_credit_ledger_id||':'||r.entitlement_id);
  total:=total+paid;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_return_spent_event_fee(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- This schedule IS the requested thirty-day product expiry. It is not a
-- reconciler or a release action. Still-played principal remains in its
-- original position and returns through its original payout/exit owner.
CREATE FUNCTION public.fn_ca_promo_expire_principal(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $expiry$
DECLARE r record;n integer:=0;amount_returned numeric:=0;scope_club uuid;grants uuid[];
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'invalid_promo_expiry_batch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN
  RETURN jsonb_build_object('enabled',false,'wallets',0,'returned',0);
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('promo-principal-product-expiry',0)) THEN
  RETURN jsonb_build_object('enabled',true,'already_running',true);
 END IF;
 IF public.fn_platform_frozen() THEN RETURN jsonb_build_object('enabled',true,'frozen',true); END IF;
 SELECT g.club_id INTO scope_club FROM public.ca_promo_play_through_grants g
  WHERE g.closed_at IS NULL AND g.expires_at<=clock_timestamp()
   AND EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c WHERE c.grant_id=g.id AND c.amount>0 AND c.kind IN('player_wallet','agent_wallet'))
  ORDER BY g.expires_at,g.id LIMIT 1;
 IF scope_club IS NULL THEN RETURN jsonb_build_object('enabled',true,'wallets',0,'returned',0); END IF;
 -- One club per bounded transaction keeps the existing financial lock order.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('agent-agreement:'||scope_club::text,0))
  OR NOT pg_try_advisory_xact_lock(hashtextextended('cashier-hierarchy:'||scope_club::text,0)) THEN
  RAISE EXCEPTION 'promo_cashier_lane_busy' USING ERRCODE='55P03';
 END IF;
 SELECT array_agg(id) INTO grants FROM(
  SELECT g.id FROM public.ca_promo_play_through_grants g WHERE g.club_id=scope_club
   AND g.closed_at IS NULL AND g.expires_at<=clock_timestamp()
   AND EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c WHERE c.grant_id=g.id AND c.amount>0 AND c.kind IN('player_wallet','agent_wallet'))
   ORDER BY g.expires_at,g.id LIMIT p_limit
 ) selected;
 PERFORM public.fn_ca_promo_lock_grant_funds(COALESCE(grants,ARRAY[]::uuid[]));
 FOR r IN SELECT g.id,g.club_id,g.user_id,g.remaining,c.kind FROM public.ca_promo_play_through_grants g
  JOIN public.ca_promo_principal_custody c ON c.grant_id=g.id
  WHERE g.id=ANY(grants) AND g.closed_at IS NULL AND g.expires_at<=clock_timestamp()
   AND c.amount>0 AND c.kind IN('player_wallet','agent_wallet')
  ORDER BY g.user_id,g.granted_at,g.id,c.kind LOOP
  PERFORM public.fn_ca_promo_play_through_settle(r.club_id,r.user_id);
  amount_returned:=amount_returned+public.fn_ca_promo_return_principal(r.id,r.kind,'expired',NULL,
   'expiry:'||r.kind||':'||r.remaining::text);
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('enabled',true,'wallets',n,'returned',amount_returned);
END $expiry$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_expire_principal(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_expire_principal(integer) TO service_role;

CREATE FUNCTION public.fn_ca_promo_leave_principal(p_club uuid,p_user uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $leave$
DECLARE r record;returned numeric:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN 0; END IF;
 PERFORM public.fn_ca_promo_play_through_settle(p_club,p_user);
 -- An original pending funding application still owes this member either
 -- a seat credit or its wallet refund. Keep its destination until that
 -- original owner has recorded the application; never discard the liability.
 IF EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c
  JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE g.club_id=p_club AND g.user_id=p_user AND g.closed_at IS NULL
   AND c.kind='pending_addon' AND c.amount>0) THEN
  RAISE EXCEPTION 'Wait For Your Pending Table Top-Up To Settle Before Leaving The Club'
   USING ERRCODE='55000';
 END IF;
 FOR r IN SELECT g.id,c.kind FROM public.ca_promo_play_through_grants g
  JOIN public.ca_promo_principal_custody c ON c.grant_id=g.id
  WHERE g.club_id=p_club AND g.user_id=p_user AND g.closed_at IS NULL
   AND c.amount>0 AND c.kind IN('player_wallet','agent_wallet')
  ORDER BY g.granted_at,g.id,c.kind LOOP
  returned:=returned+public.fn_ca_promo_return_principal(r.id,r.kind,'left_club',NULL,'leave:'||r.kind);
 END LOOP;
 RETURN returned;
END $leave$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_leave_principal(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $departure$
DECLARE def text;needle text:=E'  IF v_chips > 0 THEN\n';lock_anchor text:=E'  SELECT role, COALESCE(chip_balance, 0)\n';
BEGIN
 SELECT pg_get_functiondef('public.fn_member_leave_to_treasury(uuid,uuid)'::regprocedure) INTO def;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_departure_owner_anchor_changed'; END IF;
 IF length(def)-length(replace(def,lock_anchor,''))<>length(lock_anchor) THEN RAISE EXCEPTION 'promo_departure_lock_anchor_changed'; END IF;
 def:=replace(def,lock_anchor,E'  IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN\n    IF NOT pg_try_advisory_xact_lock(hashtextextended(''agent-agreement:''||p_club_id::text,0)) OR NOT pg_try_advisory_xact_lock(hashtextextended(''cashier-hierarchy:''||p_club_id::text,0)) THEN RAISE EXCEPTION ''promo_cashier_lane_busy'' USING ERRCODE=''55P03''; END IF;\n    PERFORM public.fn_ca_promo_leave_events(p_club_id,p_user_id);\n    PERFORM public.fn_ca_promo_lock_grant_funds(COALESCE((SELECT array_agg(id) FROM public.ca_promo_play_through_grants WHERE club_id=p_club_id AND user_id=p_user_id AND closed_at IS NULL),ARRAY[]::uuid[]));\n  END IF;\n'||lock_anchor);
 EXECUTE replace(def,needle,E'  PERFORM public.fn_ca_promo_leave_principal(p_club_id,p_user_id);\n  SELECT COALESCE(chip_balance,0) INTO v_chips FROM public.club_members WHERE club_id=p_club_id AND user_id=p_user_id;\n'||needle);
END $departure$;

-- periodic-work: Executes the owner-requested 30-day promo expiration, returning expired wallet-held principal to its original fund through the exact financial owner.
SELECT cron.schedule('promo-principal-product-expiry','*/15 * * * *',
 'SELECT public.fn_ca_promo_expire_principal(100)');

COMMIT;
