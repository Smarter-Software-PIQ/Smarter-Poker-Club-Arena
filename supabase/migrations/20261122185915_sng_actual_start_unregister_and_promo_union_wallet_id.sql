-- 20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id
--
-- Two root-cause fixes uncovered on 2026-11-22 while unblocking two human
-- players stuck in Satellite Into Nightly 20K (NLH) (0be6a4b5, format_contract
-- 'sng-v1', max_players 9, status REGISTERING, started_at NULL, start_time
-- created_at + 2 min):
--
-- 1. Promo union_wallet fund lookup: 353 live ca_promo_play_through_grants
--    rows (wheel/arcade prizes written via fn_ca_autoledger) record
--    funded_from_type = 'union_wallet' and funded_from_id = union_wallets.id
--    (059bb325-...) rather than union_wallets.union_id (fade0000-...).
--    fn_ca_ledger_tally_key already normalizes both, but
--    fn_ca_promo_lock_grant_funds, fn_ca_promo_return_principal, and
--    fn_ca_promo_returned_ticket_principal_fee only queried WHERE union_id =
--    funded_from_id and raised promo_return_original_fund_missing /
--    original_ticket_Pfee_fund_missing on every refund, cancellation, expiry,
--    or club departure touching those grants. Resolve union_wallets by
--    union_id OR id into canonical union_wallets.union_id in all three
--    readers/payers, and normalize new union_wallet grants on insert in
--    fn_ca_promo_play_through_record_grant.
--
-- 2. Multi-player SNG unregistration: fn_ca_unregister_tournament_player_exact
--    and fn_poker_diamond_tournament_unregister only granted actual-start
--    unregistration authority to spin-v1 and 2-player sng-v1
--    (heads_up_sng_actual_start), leaving 6-max and 9-max sng-v1 tournaments
--    (including SNG satellites that start "When Full" with a nominal
--    start_time = created_at + 2 min) on scheduled_clock. Players attempting
--    to unregister more than 2 minutes after creation were refused with
--    reason='tournament_started' while status='REGISTERING' and
--    started_at IS NULL. Add start_authority='sng_actual_start' for
--    non-HU sng-v1 events in tournament_unregistration_actual_start_check,
--    fn_ca_tournament_unregistration_receipt,
--    fn_ca_unregister_tournament_player_exact, and
--    fn_poker_diamond_tournament_unregister, governed by actual start truth
--    (status in ANNOUNCED/REGISTERING, started_at IS NULL, no persisted hand,
--    and no completed launch receipt). Scheduled MTTs and MTT satellites
--    retain scheduled_clock unchanged.
--
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_promo_lock_grant_funds(uuid[])'::regprocedure), 'uw.id=g.funded_from_id') > 0 AND strpos(pg_get_functiondef('public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)'::regprocedure), 'OR id=g.funded_from_id') > 0 AND strpos(pg_get_functiondef('public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)'::regprocedure), 'uw.id=g.funded_from_id') > 0 AND strpos(pg_get_functiondef('public.fn_ca_promo_play_through_record_grant(uuid,uuid,numeric,text,text,uuid,text,uuid,numeric)'::regprocedure), 'uw.id = p_funded_from_id') > 0 AND strpos(pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure), 'sng_actual_start') > 0 AND strpos(pg_get_functiondef('public.fn_ca_tournament_unregistration_receipt(uuid,uuid,uuid,uuid)'::regprocedure), 'sng_actual_start') > 0 AND strpos(pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure), 'sng_actual_start') > 0 AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tournament_unregistration_receipts'::regclass AND conname = 'tournament_unregistration_actual_start_check' AND strpos(pg_get_constraintdef(oid), 'sng_actual_start') > 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_lock_grant_funds(uuid[])'::regprocedure))
     IS DISTINCT FROM '8ae88057d7bb542552405155fcb8ff4f' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_lock_grant_funds(uuid[])';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)'::regprocedure))
     IS DISTINCT FROM 'bfe74b76f62994c1cf55c8dff0e30fcb' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)'::regprocedure))
     IS DISTINCT FROM '0e9d2d30d9d2aed286c114f07bb4d136' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_play_through_record_grant(uuid,uuid,numeric,text,text,uuid,text,uuid,numeric)'::regprocedure))
     IS DISTINCT FROM '8b9cff0501b5882cc6b99e68d809021c' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_play_through_record_grant';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_tournament_unregistration_receipt(uuid,uuid,uuid,uuid)'::regprocedure))
     IS DISTINCT FROM 'a1eb3a788f88279d07cd421e5fee5a69' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_tournament_unregistration_receipt(uuid,uuid,uuid,uuid)';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure))
     IS DISTINCT FROM '7997019dd2c32b192cb981eaf1967120' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure)
     IS DISTINCT FROM '799ceb83c8f91e76ac3594cd181ba4b9' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)';
  END IF;
END $preimage$;

ALTER TABLE public.tournament_unregistration_receipts
  DROP CONSTRAINT tournament_unregistration_actual_start_check,
  ADD CONSTRAINT tournament_unregistration_actual_start_check
  CHECK (
    (start_authority = 'scheduled_clock'::text AND settled_at < scheduled_start_at)
    OR start_authority = ANY (ARRAY[
      'spin_actual_start'::text,
      'heads_up_sng_actual_start'::text,
      'sng_actual_start'::text,
      'launch_release'::text,
      'owner_never_seated_release'::text
    ])
  );

CREATE OR REPLACE FUNCTION public.fn_ca_promo_lock_grant_funds(p_grants uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE f record;
BEGIN
 IF p_grants IS NULL OR cardinality(p_grants)>1000 THEN RAISE EXCEPTION 'invalid_promo_return_fund_scope'; END IF;
 FOR f IN SELECT DISTINCT g.funded_from_type,
   CASE WHEN g.funded_from_type='union_wallet'
        THEN COALESCE((SELECT uw.union_id FROM public.union_wallets uw
                        WHERE uw.union_id=g.funded_from_id OR uw.id=g.funded_from_id
                        LIMIT 1), g.funded_from_id)
        ELSE g.funded_from_id END AS funded_from_id,
   g.club_id
  FROM public.ca_promo_play_through_grants g WHERE g.id=ANY(p_grants)
  ORDER BY 1,2,3 LOOP
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
END $function$
;
REVOKE ALL ON FUNCTION public.fn_ca_promo_lock_grant_funds(uuid[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_return_principal(p_grant_id uuid, p_wallet text, p_reason text, p_amount numeric DEFAULT NULL::numeric, p_operation_ref text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
   JOIN public.ca_promo_original_entry_loss_basis fs ON fs.charge_ledger_id=fee.charge_ledger_id AND fs.grant_id=g.id
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
  SELECT union_id,promo_wallet INTO source_id,fund_balance
    FROM public.union_wallets
   WHERE union_id=g.funded_from_id OR id=g.funded_from_id
   FOR UPDATE;
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
END $function$
;
REVOKE ALL ON FUNCTION public.fn_ca_promo_return_principal(uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(p_ledger uuid, p_entitlement uuid, p_ticket uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.chip_ledger%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;t public.tournament_tickets%ROWTYPE;
 r record;prior public.ca_promo_ticket_principal_fee_returns%ROWTYPE;source_label text;fund_before numeric;fund_after numeric;
 total numeric;returned numeric;ticket_before numeric;fee_total numeric;capital_total numeric;capital_returned numeric;fee_returned numeric;prize_after numeric;bounty_after numeric;key text;return_id uuid;saved jsonb;ctx jsonb;k text;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 SELECT * INTO STRICT e FROM public.tournament_refund_entitlements WHERE id=p_entitlement FOR UPDATE;
 SELECT * INTO STRICT t FROM public.tournament_tickets WHERE id=p_ticket FOR UPDATE;
 IF l.from_type<>'prize_liability' OR l.from_entity_id<>e.tournament_id OR l.to_type<>'escrow' OR l.to_entity_id<>t.id
  OR l.amount<>e.gross OR l.category<>'ticket_issue' OR l.club_id<>e.refund_wallet_club_id
  OR l.metadata->>'kind'<>'tournament_entry_ticket_return' OR l.metadata->>'entitlement_id'<>e.id::text OR l.metadata->>'ticket_id'<>t.id::text
  OR t.source_refund_entitlement_id<>e.id OR t.holder_id<>e.user_id OR t.club_id<>e.refund_wallet_club_id
  OR t.redemption_mode<>'tournament_entry_only' OR EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=e.id)
 THEN RAISE EXCEPTION 'original_ticket_Pfee_identity_invalid';END IF;
 SELECT COALESCE(sum(s.amount),0) INTO fee_total FROM public.ca_promo_event_fee_consumption_slices s WHERE s.charge_ledger_id=e.source_ledger_id;
 SELECT COALESCE(sum(amount),0) INTO capital_total FROM(SELECT amount FROM public.ca_promo_event_entry_loss_slices WHERE charge_ledger_id=e.source_ledger_id UNION ALL SELECT amount FROM public.ca_promo_event_terminal_loss_slices WHERE charge_ledger_id=e.source_ledger_id) lost;
 capital_total:=capital_total+COALESCE((SELECT sum(active_amount) FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id),0)+COALESCE((SELECT sum(x.remaining) FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.charge_ledger_id=e.source_ledger_id AND g.closed_at IS NULL),0);
 total:=fee_total+capital_total;
 IF total=0 THEN RETURN;END IF;
 IF total<0 OR fee_total>e.refund_fee OR capital_total>e.refund_prize+e.refund_bounty OR NOT EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts f WHERE f.entitlement_id=e.id AND f.charge_ledger_id=e.source_ledger_id AND f.player_id=e.user_id AND f.gross_fee=e.refund_fee AND f.charge_amount=e.gross) THEN RAISE EXCEPTION 'original_ticket_Pfee_expense_invalid';END IF;
 SELECT COALESCE(sum(amount),0),COALESCE(sum(fee_amount),0),COALESCE(sum(loss_amount+active_amount),0) INTO returned,fee_returned,capital_returned FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id;
 IF (returned<e.gross AND (t.value<>e.gross-returned OR t.entry_fee<>e.refund_fee-fee_returned OR t.entry_prize<>greatest(0,e.refund_prize-capital_returned) OR t.entry_bounty<>e.refund_bounty-greatest(0,capital_returned-e.refund_prize))) OR (returned=e.gross AND t.status<>'cancelled') THEN RAISE EXCEPTION 'original_ticket_Pfee_asset_budget_invalid';END IF;
 FOR r IN WITH expenses AS(
 SELECT grant_id,sum(amount) fee,0::numeric lost,0::numeric active FROM public.ca_promo_event_fee_consumption_slices WHERE charge_ledger_id=e.source_ledger_id GROUP BY grant_id
 UNION ALL SELECT grant_id,0,sum(amount),0 FROM public.ca_promo_event_entry_loss_slices WHERE charge_ledger_id=e.source_ledger_id GROUP BY grant_id
 UNION ALL SELECT grant_id,0,sum(amount),0 FROM public.ca_promo_event_terminal_loss_slices WHERE charge_ledger_id=e.source_ledger_id GROUP BY grant_id
 UNION ALL SELECT x.grant_id,0,0,sum(x.remaining) FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.charge_ledger_id=e.source_ledger_id AND g.closed_at IS NULL GROUP BY x.grant_id
 UNION ALL SELECT grant_id,0,0,sum(active_amount) FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id GROUP BY grant_id
 ) SELECT g.id,g.club_id,g.user_id,g.funded_from_type,
  CASE WHEN g.funded_from_type='union_wallet'
       THEN COALESCE((SELECT uw.union_id FROM public.union_wallets uw
                       WHERE uw.union_id=g.funded_from_id OR uw.id=g.funded_from_id
                       LIMIT 1), g.funded_from_id)
       ELSE g.funded_from_id END AS funded_from_id,
  sum(x.fee) fee,sum(x.lost) lost,sum(x.active) active,sum(x.fee+x.lost+x.active) amount
 FROM expenses x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id GROUP BY g.id HAVING sum(x.fee+x.lost+x.active)>0 ORDER BY g.id LOOP
  IF r.user_id<>e.user_id OR NOT EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts f WHERE f.entitlement_id=e.id AND f.club_id=r.club_id AND f.player_id=r.user_id) THEN RAISE EXCEPTION 'original_ticket_Pfee_original_scope_invalid';END IF;
  SELECT * INTO prior FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id AND grant_id=r.id;
  IF FOUND THEN
   IF prior.issue_ledger_id<>l.id OR prior.ticket_id<>t.id OR prior.charge_ledger_id<>e.source_ledger_id OR prior.amount<>r.amount
    OR prior.funded_from_type<>r.funded_from_type OR prior.funded_from_id<>r.funded_from_id THEN RAISE EXCEPTION 'original_ticket_Pfee_retry_changed';END IF;
   CONTINUE;
  END IF;
  IF t.status<>'issued' THEN RAISE EXCEPTION 'original_ticket_Pfee_asset_already_used';END IF;
  source_label:=NULL;fund_before:=NULL;
  IF r.funded_from_type='union_wallet' THEN
   source_label:='union_wallets.promo_wallet';SELECT promo_wallet INTO fund_before FROM public.union_wallets WHERE union_id=r.funded_from_id FOR UPDATE;
  ELSIF r.funded_from_type='promo_wallet' THEN
   IF EXISTS(SELECT 1 FROM public.clubs WHERE id=r.funded_from_id) THEN
    source_label:='clubs.promo_balance';SELECT promo_balance INTO fund_before FROM public.clubs WHERE id=r.funded_from_id FOR UPDATE;
   ELSE
    source_label:='agents.promo_wallet_balance';SELECT promo_wallet_balance INTO fund_before FROM public.agents WHERE club_id=r.club_id AND user_id=r.funded_from_id FOR UPDATE;
   END IF;
  END IF;
  IF source_label IS NULL OR fund_before IS NULL THEN RAISE EXCEPTION 'original_ticket_Pfee_fund_missing';END IF;
  ticket_before:=t.value;key:='promo_ticket_fee_return:'||e.id::text||':'||r.id::text;
  saved:=public.fn_ca_ledger_declaration_save(ARRAY['clubs','agents','union_wallets']);
  SELECT jsonb_object_agg(x,COALESCE(current_setting(x,true),'')) INTO ctx FROM unnest(ARRAY['app.ledger_idempotency_key','app.ledger_tournament','app.ledger_tournament_id','app.ledger_hand_id','app.ledger_settlement','app.ledger_correlation'])x;
  PERFORM public.fn_ca_declare_ledger('reversal','escrow',t.id,NULL,key,ARRAY['clubs','agents','union_wallets']);
  PERFORM set_config('app.ledger_counterparty_label','tournament_tickets.value',true);
  IF source_label='union_wallets.promo_wallet' THEN
   UPDATE public.union_wallets SET promo_wallet=promo_wallet+r.amount,updated_at=now() WHERE union_id=r.funded_from_id RETURNING promo_wallet INTO fund_after;
  ELSIF source_label='clubs.promo_balance' THEN
   UPDATE public.clubs SET promo_balance=promo_balance+r.amount,updated_at=now() WHERE id=r.funded_from_id RETURNING promo_balance INTO fund_after;
  ELSE
   UPDATE public.agents SET promo_wallet_balance=promo_wallet_balance+r.amount,updated_at=now() WHERE club_id=r.club_id AND user_id=r.funded_from_id RETURNING promo_wallet_balance INTO fund_after;
  END IF;
  IF fund_after IS DISTINCT FROM fund_before+r.amount THEN RAISE EXCEPTION 'original_ticket_Pfee_fund_credit_failed';END IF;
  fee_returned:=fee_returned+r.fee;capital_returned:=capital_returned+r.lost+r.active;
  prize_after:=greatest(0,e.refund_prize-capital_returned);bounty_after:=e.refund_bounty-greatest(0,capital_returned-e.refund_prize);
  INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,amount,category,club_id,idempotency_key,description,metadata,pre_from_balance,post_from_balance,pre_to_balance,post_to_balance)
  VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),'escrow',t.id,'tournament_tickets.value',r.funded_from_type,r.funded_from_id,source_label,r.amount,'reversal',r.club_id,key,'Original Promotional Principal Returned To Original Fund',jsonb_build_object('entitlement_id',e.id,'ticket_id',t.id,'grant_id',r.id,'issue_ledger_id',l.id,'charge_ledger_id',e.source_ledger_id),ticket_before,greatest(0,ticket_before-r.amount),fund_before,fund_after) RETURNING id INTO return_id;
  INSERT INTO public.ca_promo_ticket_principal_fee_returns(entitlement_id,grant_id,issue_ledger_id,ticket_id,charge_ledger_id,amount,fee_amount,loss_amount,active_amount,funded_from_type,funded_from_id,return_ledger_id)
  VALUES(e.id,r.id,l.id,t.id,e.source_ledger_id,r.amount,r.fee,r.lost,r.active,r.funded_from_type,r.funded_from_id,return_id);
  IF ticket_before=r.amount THEN
   UPDATE public.tournament_tickets SET status='cancelled',cancelled_at=transaction_timestamp() WHERE id=t.id RETURNING * INTO t;
  ELSE
   UPDATE public.tournament_tickets SET value=ticket_before-r.amount,entry_fee=e.refund_fee-fee_returned,entry_prize=prize_after,entry_bounty=bounty_after WHERE id=t.id RETURNING * INTO t;
  END IF;
  IF r.active>0 THEN
   UPDATE public.ca_promo_principal_custody SET amount=amount-r.active WHERE grant_id=r.id AND kind='event' AND entity_id=e.tournament_id AND amount>=r.active;
   IF NOT FOUND THEN RAISE EXCEPTION 'original_ticket_P_active_custody_missing';END IF;
   UPDATE public.ca_promo_event_principal_lots SET remaining=0 WHERE grant_id=r.id AND charge_ledger_id=e.source_ledger_id;
   UPDATE public.ca_promo_play_through_grants SET remaining=remaining-r.active,closed_at=CASE WHEN remaining=r.active THEN clock_timestamp() ELSE NULL END,close_reason=CASE WHEN remaining=r.active THEN 'returned' ELSE NULL END WHERE id=r.id AND remaining>=r.active AND closed_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'original_ticket_P_active_grant_missing';END IF;
  END IF;
  PERFORM public.fn_ca_ledger_declaration_restore(saved);
  FOR k IN SELECT jsonb_object_keys(ctx) LOOP PERFORM set_config(k,ctx->>k,true);END LOOP;

 END LOOP;
 IF (SELECT sum(amount) FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id)<>total THEN RAISE EXCEPTION 'original_ticket_Pfee_return_incomplete';END IF;
END $function$
;
REVOKE ALL ON FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_record_grant(p_club_id uuid, p_user_id uuid, p_amount numeric, p_source_kind text, p_source_ref text, p_source_ledger_id uuid DEFAULT NULL::uuid, p_funded_from_type text DEFAULT NULL::text, p_funded_from_id uuid DEFAULT NULL::uuid, p_multiplier numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_settings public.ca_promo_play_through_settings%ROWTYPE;
  v_now      timestamptz := clock_timestamp();
  v_cycle    timestamptz;
  v_id       uuid;
  v_funded_from_id uuid := p_funded_from_id;
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL
     OR p_amount IS NULL OR p_amount <= 0
     OR p_source_ref IS NULL OR btrim(p_source_ref) = '' THEN
    RAISE EXCEPTION 'promo play-through grant needs a club, a member, a positive amount and a source reference';
  END IF;

  SELECT * INTO v_settings FROM public.ca_promo_play_through_settings WHERE id;
  IF NOT FOUND OR v_settings.enforced_from IS NULL OR v_now < v_settings.enforced_from THEN
    RETURN NULL;
  END IF;

  SELECT g.id INTO v_id
    FROM public.ca_promo_play_through_grants g
   WHERE g.source_ref = p_source_ref;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Takes the member's advisory lock and closes whatever is already met, so
  -- a finished cycle never lends its old fees to a new grant.
  PERFORM public.fn_ca_promo_play_through_settle(p_club_id, p_user_id);

  SELECT min(g.cycle_started_at) INTO v_cycle
    FROM public.ca_promo_play_through_grants g
   WHERE g.club_id = p_club_id
     AND g.user_id = p_user_id
     AND g.closed_at IS NULL;

  IF p_funded_from_type = 'union_wallet' AND p_funded_from_id IS NOT NULL THEN
    SELECT COALESCE(
      (SELECT uw.union_id FROM public.union_wallets uw
        WHERE uw.union_id = p_funded_from_id OR uw.id = p_funded_from_id
        LIMIT 1),
      p_funded_from_id)
      INTO v_funded_from_id;
  END IF;

  INSERT INTO public.ca_promo_play_through_grants (
    club_id, user_id, amount, remaining, multiplier, source_kind, source_ref,
    source_ledger_id, funded_from_type, funded_from_id,
    cycle_started_at, granted_at, expires_at
  ) VALUES (
    p_club_id, p_user_id, p_amount, p_amount,
    COALESCE(p_multiplier, v_settings.multiplier),
    p_source_kind, p_source_ref,
    p_source_ledger_id, p_funded_from_type, v_funded_from_id,
    COALESCE(v_cycle, v_now), v_now,
    v_now + make_interval(days => v_settings.expiry_days)
  )
  ON CONFLICT ON CONSTRAINT ca_promo_play_through_grants_source_once DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT g.id INTO v_id
      FROM public.ca_promo_play_through_grants g
     WHERE g.source_ref = p_source_ref;
  END IF;

  RETURN v_id;
END;
$function$
;
REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_record_grant(uuid, uuid, numeric, text, text, uuid, text, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_record_grant(uuid, uuid, numeric, text, text, uuid, text, uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_unregistration_receipt(p_tournament_id uuid, p_user_id uuid, p_source_table_id uuid DEFAULT NULL::uuid, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_r public.tournament_unregistration_receipts%ROWTYPE;
  v_entitlement_count integer;
  v_fee_entitlement_count integer;
  v_entitlement_total numeric;
  v_entitlement_fee numeric;
  v_source_count integer;
  v_wallet_count integer;
  v_wallet_total numeric;
  v_ticket_count integer;
  v_ticket_total numeric;
  v_ticket_ledger_count integer;
  v_ticket_transaction_count integer;
  v_fee_reversal_count integer;
  v_fee_reversal_total numeric;
  v_fee_source_ids uuid[];
  v_fee_mapping_count integer;
  v_fee_mapping_entitlement_count integer;
  v_fee_mapping_ids uuid[];
BEGIN
  SELECT * INTO v_r
    FROM public.tournament_unregistration_receipts r
   WHERE r.tournament_id=p_tournament_id AND r.user_id=p_user_id
     AND r.source_table_id IS NOT DISTINCT FROM p_source_table_id
     AND (p_request_id IS NULL OR r.request_id=p_request_id)
   ORDER BY r.settled_at DESC,r.registration_id DESC
   LIMIT 1;
  IF v_r.registration_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A later registration, including an eliminated one, makes an unkeyed
  -- "latest receipt" unsafe. The exact request-key path is also refused while
  -- any later registration row exists: a replay is an outcome read, never an
  -- operation against a new lifecycle.
  IF EXISTS(
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=v_r.tournament_id AND tp.user_id=v_r.user_id) THEN
    RETURN NULL;
  END IF;

  SELECT count(*),count(*) FILTER (WHERE e.refund_fee>0),
         round(COALESCE(sum(e.gross),0),2),
         round(COALESCE(sum(e.refund_fee),0),2)
    INTO v_entitlement_count,v_fee_entitlement_count,
         v_entitlement_total,v_entitlement_fee
    FROM public.tournament_refund_entitlements e
   WHERE e.id=ANY(v_r.entitlement_ids)
     AND e.tournament_id=v_r.tournament_id AND e.user_id=v_r.user_id;
  SELECT count(*) INTO v_source_count
    FROM unnest(v_r.entitlement_ids) WITH ORDINALITY entitlement(id,n)
    JOIN unnest(v_r.source_wallet_club_ids) WITH ORDINALITY source(club_id,n)
      USING(n)
    JOIN public.tournament_refund_entitlements e
      ON e.id=entitlement.id AND e.refund_wallet_club_id=source.club_id
     AND e.tournament_id=v_r.tournament_id AND e.user_id=v_r.user_id;
  SELECT count(*),round(COALESCE(sum(tr.amount_paid_now),0),2)
    INTO v_wallet_count,v_wallet_total
    FROM public.tournament_refund_tranches tr
    JOIN public.tournament_refund_entitlements e ON e.id=tr.entitlement_id
   WHERE e.id=ANY(v_r.entitlement_ids)
     AND e.entitlement_kind IN ('wallet_charge','satellite_seat','tournament_ticket')
     AND tr.wallet_transaction_id=ANY(v_r.wallet_transaction_ids)
     AND tr.credit_ledger_id=ANY(v_r.credit_ledger_ids)
     AND tr.tournament_id=v_r.tournament_id AND tr.user_id=v_r.user_id;
  SELECT count(*),round(COALESCE(sum(tk.value),0),2)
    INTO v_ticket_count,v_ticket_total
    FROM public.tournament_tickets tk
    JOIN public.tournament_refund_entitlements e
      ON e.id=tk.source_refund_entitlement_id
   WHERE tk.id=ANY(v_r.ticket_ids)
     AND tk.redemption_mode='tournament_entry_only'
     AND e.id=ANY(v_r.entitlement_ids)
     AND e.entitlement_kind IN ('satellite_seat','tournament_ticket')
     AND e.tournament_id=v_r.tournament_id AND e.user_id=v_r.user_id
     AND tk.value=e.gross;
  SELECT count(*) INTO v_ticket_ledger_count
    FROM public.chip_ledger l
    JOIN public.tournament_tickets tk ON tk.id=l.to_entity_id
    JOIN public.tournament_refund_entitlements e
      ON e.id=tk.source_refund_entitlement_id
   WHERE tk.id=ANY(v_r.ticket_ids)
     AND e.id=ANY(v_r.entitlement_ids)
     AND l.idempotency_key='tourney:'||e.tournament_id::text
          ||':satellite-ticket-return:'||e.id::text
     AND l.from_type='prize_liability'
     AND l.from_entity_id=e.tournament_id
     AND l.to_type='escrow' AND l.to_entity_id=tk.id
     AND l.club_id=e.refund_wallet_club_id AND l.amount=e.gross;
  SELECT count(*) INTO v_ticket_transaction_count
    FROM public.chip_transactions ct
    JOIN public.tournament_tickets tk
      ON tk.id::text=ct.metadata->>'ticket_id'
    JOIN public.tournament_refund_entitlements e
      ON e.id=tk.source_refund_entitlement_id
    JOIN public.chip_ledger l
      ON l.id::text=ct.metadata->>'ledger_id'
   WHERE tk.id=ANY(v_r.ticket_ids)
     AND e.id=ANY(v_r.entitlement_ids)
     AND ct.transaction_type='tournament_ticket_issue'
     AND ct.club_id=e.refund_wallet_club_id
     AND ct.from_user_id IS NULL AND ct.to_user_id=e.user_id
     AND ct.amount=e.gross
     AND ct.metadata->>'entitlement_id'=e.id::text
     AND l.to_entity_id=tk.id
     AND l.idempotency_key='tourney:'||e.tournament_id::text
          ||':satellite-ticket-return:'||e.id::text;

  SELECT count(*),round(COALESCE(-sum(reversal.rake_amount),0),2)
    INTO v_fee_reversal_count,v_fee_reversal_total
    FROM public.rake_records reversal
   WHERE reversal.id=ANY(v_r.fee_reversal_ids)
     AND reversal.tournament_id=v_r.tournament_id
     AND reversal.is_tournament IS TRUE
     AND reversal.source='fn_unregister_from_tournament'
     AND reversal.rake_amount<0
     AND reversal.metadata->>'kind'='tournament_fee_refund'
     AND reversal.metadata->>'user_id'=v_r.user_id::text
     AND reversal.metadata->>'registration_id'=v_r.registration_id::text;
  SELECT COALESCE(array_agg(source.id ORDER BY source.id),ARRAY[]::uuid[])
    INTO v_fee_source_ids
    FROM public.rake_records reversal
   CROSS JOIN LATERAL jsonb_array_elements_text(
     reversal.metadata->'original_rake_record_ids') raw(id)
   JOIN LATERAL (SELECT raw.id::uuid AS id) source ON true
   WHERE reversal.id=ANY(v_r.fee_reversal_ids);
  WITH exact_fee_mapping AS MATERIALIZED (
    SELECT e.id AS entitlement_id,r.id AS rake_record_id
      FROM public.tournament_refund_entitlements e
      JOIN public.chip_ledger l ON l.id=e.source_ledger_id
      JOIN public.rake_records r
        ON r.id=ANY(v_r.fee_source_rake_record_ids)
       AND r.tournament_id=e.tournament_id
       AND r.is_tournament IS TRUE
       AND r.club_id IS NOT NULL
       AND r.rake_amount=e.refund_fee
       AND r.created_at=l.created_at
       AND r.metadata->>'user_id'=e.user_id::text
       AND (
         (e.entitlement_kind='wallet_charge'
          AND e.charge_category='tournament_buyin'
          AND r.source IN (
            'fn_register_for_tournament','fn_register_horse_for_tournament')
          AND r.metadata->>'kind'='tournament_entry_fee'
          AND r.metadata->>'registration_id'=v_r.registration_id::text)
         OR (e.entitlement_kind='wallet_charge'
          AND e.charge_category='rebuy'
          AND r.source='process_tournament_rebuy'
          AND r.metadata->>'kind' IN (
            'tournament_rebuy_fee','tournament_reentry_fee'))
         OR (e.entitlement_kind='satellite_seat'
          AND r.source='fn_award_satellite_seat'
          AND r.metadata->>'kind'='satellite_seat_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text)
         OR (e.entitlement_kind='tournament_ticket'
          AND r.source='fn_register_for_tournament_with_ticket'
          AND r.metadata->>'kind'='tournament_ticket_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text))
     WHERE e.id=ANY(v_r.entitlement_ids) AND e.refund_fee>0
  )
  SELECT count(*),count(DISTINCT entitlement_id),
         COALESCE(array_agg(rake_record_id ORDER BY rake_record_id),
                  ARRAY[]::uuid[])
    INTO v_fee_mapping_count,v_fee_mapping_entitlement_count,v_fee_mapping_ids
    FROM exact_fee_mapping;

  IF (v_r.start_authority='scheduled_clock'
       AND v_r.settled_at>=v_r.scheduled_start_at)
     OR (v_r.start_authority IN (
           'spin_actual_start','heads_up_sng_actual_start','sng_actual_start','launch_release')
       AND EXISTS (
         SELECT 1
           FROM public.tournament_launch_receipts launch
          WHERE launch.tournament_id=v_r.tournament_id
            AND launch.completed_at IS NOT NULL
            AND launch.completed_at<=v_r.settled_at))
     OR (v_r.start_authority='spin_actual_start'
       AND NOT EXISTS (
         SELECT 1 FROM public.tournaments t
          WHERE t.id=v_r.tournament_id
            AND t.satellite_target_id IS NULL
            AND upper(COALESCE(t.tournament_type::text,''))<>'SATELLITE'
            AND (lower(COALESCE(t.variant::text,''))='spin'
              OR upper(COALESCE(t.tournament_type::text,''))='SPIN')))
     OR (v_r.start_authority='heads_up_sng_actual_start'
       AND NOT EXISTS (
         SELECT 1 FROM public.tournaments t
          WHERE t.id=v_r.tournament_id
            AND t.satellite_target_id IS NULL
            AND upper(COALESCE(t.tournament_type::text,''))='SNG'
            AND lower(COALESCE(t.variant::text,''))<>'spin'
            AND COALESCE(t.max_players,0)=2))
     OR (v_r.start_authority='sng_actual_start'
       AND NOT EXISTS (
         SELECT 1 FROM public.tournaments t
          WHERE t.id=v_r.tournament_id
            AND t.format_contract='sng-v1'
            AND upper(COALESCE(t.tournament_type::text,''))='SNG'
            AND lower(COALESCE(t.variant::text,''))<>'spin'
            AND COALESCE(t.max_players,0)<>2))
     OR v_r.start_authority NOT IN (
          'scheduled_clock','spin_actual_start','heads_up_sng_actual_start',
          'sng_actual_start','launch_release')
     OR v_entitlement_count<>cardinality(v_r.entitlement_ids)
     OR v_source_count<>cardinality(v_r.entitlement_ids)
     OR v_entitlement_total IS DISTINCT FROM
          round(v_r.refunded_chips+v_r.returned_ticket_value,2)
     OR v_wallet_count<>cardinality(v_r.wallet_transaction_ids)
     OR v_wallet_total IS DISTINCT FROM v_r.refunded_chips
     OR v_ticket_count<>cardinality(v_r.ticket_ids)
     OR v_ticket_total IS DISTINCT FROM v_r.returned_ticket_value
     OR v_ticket_ledger_count<>cardinality(v_r.ticket_ids)
     OR v_ticket_transaction_count<>cardinality(v_r.ticket_ids)
     OR v_r.fees_reversed IS DISTINCT FROM v_entitlement_fee
     OR v_fee_reversal_count<>cardinality(v_r.fee_reversal_ids)
     OR v_fee_reversal_total IS DISTINCT FROM v_r.fees_reversed
     OR v_fee_source_ids IS DISTINCT FROM v_r.fee_source_rake_record_ids
     OR v_fee_mapping_ids IS DISTINCT FROM v_r.fee_source_rake_record_ids
     OR v_fee_mapping_count<>v_fee_entitlement_count
     OR v_fee_mapping_entitlement_count<>v_fee_entitlement_count
     OR cardinality(v_fee_source_ids)<>(
       SELECT count(DISTINCT id) FROM unnest(v_fee_source_ids) source(id))
     OR EXISTS (
       SELECT 1 FROM public.tournament_unregistration_receipts other
        WHERE other.registration_id<>v_r.registration_id
          AND (other.fee_reversal_ids && v_r.fee_reversal_ids
            OR other.fee_source_rake_record_ids
                 && v_r.fee_source_rake_record_ids))
     OR EXISTS (
       SELECT 1
         FROM public.rake_records reversal
        WHERE reversal.id=ANY(v_r.fee_reversal_ids)
          AND (
            jsonb_typeof(reversal.metadata->'original_rake_record_ids')
              IS DISTINCT FROM 'array'
            OR jsonb_array_length(
                 reversal.metadata->'original_rake_record_ids')=0
            OR (SELECT round(COALESCE(sum(original.rake_amount),0),2)
                  FROM jsonb_array_elements_text(
                    reversal.metadata->'original_rake_record_ids') raw(id)
                  JOIN public.rake_records original
                    ON original.id=raw.id::uuid
                 WHERE original.tournament_id=v_r.tournament_id
                   AND original.club_id=reversal.club_id
                   AND original.is_tournament IS TRUE
                   AND original.rake_amount>0
                   AND original.metadata->>'user_id'=v_r.user_id::text
                   AND (
                     (original.source IN (
                        'fn_register_for_tournament',
                        'fn_register_horse_for_tournament')
                       AND original.metadata->>'kind'='tournament_entry_fee')
                     OR (original.source='process_tournament_rebuy'
                       AND original.metadata->>'kind' IN (
                         'tournament_rebuy_fee','tournament_reentry_fee'))
                     OR (original.source=
                           'fn_register_for_tournament_with_ticket'
                       AND original.metadata->>'kind'=
                           'tournament_ticket_entry_fee')
                     OR (original.source='fn_award_satellite_seat'
                       AND original.metadata->>'kind'=
                           'satellite_seat_entry_fee')))
                IS DISTINCT FROM -reversal.rake_amount))
     OR (v_r.source_table_id IS NOT NULL AND NOT EXISTS(
       SELECT 1 FROM public.tables tb
        WHERE tb.id=v_r.source_table_id
          AND tb.tournament_id=v_r.tournament_id)) THEN
    RAISE EXCEPTION 'tournament unregistration receipt % is not exact',
      v_r.registration_id USING ERRCODE='P0404';
  END IF;

  RETURN jsonb_build_object(
    'ok',true,'request_id',v_r.request_id,
    'registration_id',v_r.registration_id,
    'refunded_chips',v_r.refunded_chips,
    'returned_ticket_value',v_r.returned_ticket_value,
    'wallet_chips_from_satellite_entitlements',(
      SELECT COALESCE(sum(tr.amount_paid_now),0)
        FROM public.tournament_refund_tranches tr
        JOIN public.tournament_refund_entitlements e ON e.id=tr.entitlement_id
       WHERE e.id=ANY(v_r.entitlement_ids)
         AND e.entitlement_kind IN ('satellite_seat','tournament_ticket')
         AND tr.wallet_transaction_id=ANY(v_r.wallet_transaction_ids)
         AND tr.credit_ledger_id=ANY(v_r.credit_ledger_ids)
         AND tr.tournament_id=v_r.tournament_id AND tr.user_id=v_r.user_id),
    'entitlement_ids',to_jsonb(v_r.entitlement_ids),
    'ticket_ids',to_jsonb(v_r.ticket_ids),
    'source_wallet_club_ids',to_jsonb(v_r.source_wallet_club_ids),
    'credit_ledger_ids',to_jsonb(v_r.credit_ledger_ids),
    'wallet_transaction_ids',to_jsonb(v_r.wallet_transaction_ids),
    'fees_reversed',v_r.fees_reversed,
    'fee_reversal_ids',to_jsonb(v_r.fee_reversal_ids),
    'fee_source_rake_record_ids',to_jsonb(v_r.fee_source_rake_record_ids),
    'seat_number',v_r.seat_number,'seats_taken',v_r.seats_taken,
    'scheduled_start_at',v_r.scheduled_start_at,
    'start_authority',v_r.start_authority,
    'settled_at',v_r.settled_at);
END;
$function$
;
REVOKE ALL ON FUNCTION public.fn_ca_tournament_unregistration_receipt(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_unregister_tournament_player_exact(p_tournament_id uuid, p_user_id uuid, p_expected_table_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_reg public.tournament_players%ROWTYPE;
  v_ent record;
  v_fee_group record;
  v_settle jsonb;
  v_receipt jsonb;
  v_escrow_before public.tournament_escrow%ROWTYPE;
  v_escrow_after public.tournament_escrow%ROWTYPE;
  v_players_before integer;
  v_rows integer;
  v_seat_number integer;
  v_seats_taken integer;
  v_non_cash_count integer;
  v_wallet_debits numeric:=0;
  v_wallet_refunds_before numeric:=0;
  v_wallet_refunds_after numeric:=0;
  v_entitled_wallet_total numeric:=0;
  v_tranche_total numeric:=0;
  v_refund_prize numeric:=0;
  v_refund_bounty numeric:=0;
  v_refund_fee numeric:=0;
  v_refund_total numeric:=0;
  v_wallet_amount numeric:=0;
  v_ticket_amount numeric:=0;
  v_running_owed numeric:=0;
  v_rake_before numeric:=0;
  v_rake_after numeric:=0;
  v_fees_reversed numeric:=0;
  v_entitlement_ids uuid[]:='{}'::uuid[];
  v_ticket_ids uuid[]:='{}'::uuid[];
  v_credit_ledger_ids uuid[]:='{}'::uuid[];
  v_wallet_transaction_ids uuid[]:='{}'::uuid[];
  v_source_wallet_club_ids uuid[]:='{}'::uuid[];
  v_fee_reversal_ids uuid[]:='{}'::uuid[];
  v_fee_source_rake_record_ids uuid[]:='{}'::uuid[];
  v_fee_entitlement_ids uuid[]:='{}'::uuid[];
  v_fee_reversal_id uuid;
  v_fee_source_count integer:=0;
  v_fee_source_entitlement_count integer:=0;
  v_fee_source_amount numeric:=0;
  v_request_id uuid:=COALESCE(p_request_id,gen_random_uuid());
  v_start_authority text:='scheduled_clock';
  v_launch_completed_at timestamptz;
  v_persisted_hand_exists boolean:=false;
  v_actual_status text;
  v_actual_started_at timestamptz;
  v_unregistered_at timestamptz;
  v_description text:=COALESCE(
    NULLIF(btrim(p_description),''),'Tournament unregistration refund');
BEGIN
  IF p_tournament_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'tournament and player ids are required'
      USING ERRCODE='22004';
  END IF;
  PERFORM public.fn_ca_lock_mtt_admission_contract();
  -- DIAMOND PHASE 8: a Diamond entry never rode the chip rails. Every
  -- caller of this authority (the lobby, the seat, the administrator, the
  -- launch) sends it home through its own door before a chip rail is
  -- touched. A caller that named no request id is given one exactly as
  -- this authority mints its own. A seat exit naming a table the player
  -- does not sit at answers not_seated unless its request id is already
  -- settled, in which case the door replays that receipt.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    IF p_expected_table_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.table_seats s
                        WHERE s.table_id=p_expected_table_id AND s.user_id=p_user_id AND s.left_at IS NULL)
       AND NOT (p_request_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.poker_diamond_tournament_ledger l
                   WHERE l.tournament_id=p_tournament_id AND l.user_id=p_user_id AND l.kind='refund'
                     AND l.request->>'request_id'=p_request_id::text)) THEN
      RETURN jsonb_build_object('ok',false,'reason','not_seated');
    END IF;
    RETURN public.fn_poker_diamond_tournament_unregister(
      p_tournament_id, p_user_id, COALESCE(p_request_id, gen_random_uuid()));
  END IF;
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  -- @lifecycle-exclusive-lock: pre-start unregistration serializes tournament status, current_players, and pool totals under settlement lane
  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF v_t.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;

  -- Spins and Sit & Gos (Heads-Up and multi-player SNGs, including SNG
  -- satellites that start when full) have no scheduled start: start_time is
  -- only a nominal fill-window timestamp. Scheduled MTTs and MTT satellites
  -- (mtt-v2) retain scheduled_clock.
  IF v_t.format_contract='spin-v1' THEN
    v_start_authority:='spin_actual_start';
  ELSIF v_t.format_contract='sng-v1'
     AND COALESCE(v_t.max_players,0)=2 THEN
    v_start_authority:='heads_up_sng_actual_start';
  ELSIF v_t.format_contract='sng-v1'
     AND upper(COALESCE(v_t.tournament_type::text,''))='SNG'
     AND lower(COALESCE(v_t.variant::text,''))<>'spin' THEN
    v_start_authority:='sng_actual_start';
  END IF;
  /* A release performed by the launch that holds this event's INCOMPLETE
     launch receipt has its own start authority. The clock has passed
     start_time, but no hand has been dealt (checked below, fails closed)
     and the receipt has not been completed, so the seat-first proofs -
     started_at unset, launch not completed - are the right ones and the
     receipt records launch_release. The launch names its receipt through
     the transaction-local app.ca_launch_release_launch_id, set only by
     fn_ca_release_unseatable_registrant_at_launch. */
  IF v_start_authority='scheduled_clock' AND EXISTS (
       SELECT 1 FROM public.tournament_launch_receipts r
        WHERE r.tournament_id=p_tournament_id
          AND r.completed_at IS NULL
          AND r.launch_id::text=NULLIF(
            current_setting('app.ca_launch_release_launch_id',true),'')) THEN
    v_start_authority:='launch_release';
  END IF;

  -- A caller-supplied request id is a durable operation identity. It may only
  -- name this exact player/event/endpoint scope. If its pre-start outcome is
  -- already committed, replay that immutable outcome even when the wall clock
  -- is now past the start; this branch performs no new unregistration writes.
  IF p_request_id IS NOT NULL THEN
    IF EXISTS(
      SELECT 1 FROM public.tournament_unregistration_receipts r
       WHERE r.request_id=p_request_id
         AND (r.tournament_id IS DISTINCT FROM p_tournament_id
           OR r.user_id IS DISTINCT FROM p_user_id
           OR r.source_table_id IS DISTINCT FROM p_expected_table_id)) THEN
      RAISE EXCEPTION 'unregistration request id belongs to another intent'
        USING ERRCODE='22023';
    END IF;
    IF EXISTS(
      SELECT 1 FROM public.tournament_unregistration_receipts r
       WHERE r.request_id=p_request_id) THEN
      v_receipt:=public.fn_ca_tournament_unregistration_receipt(
        p_tournament_id,p_user_id,p_expected_table_id,p_request_id);
      IF v_receipt IS NOT NULL THEN
        RETURN v_receipt||jsonb_build_object('replayed',true);
      END IF;
      RAISE EXCEPTION
        'unregistration request id belongs to a prior registration lifecycle'
        USING ERRCODE='P0404';
    END IF;
  END IF;

  SELECT * INTO v_reg FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
     AND tp.status::text IN ('registered','playing')
   ORDER BY tp.id LIMIT 1 FOR UPDATE;
  IF upper(COALESCE(v_t.status::text,'')) NOT IN ('ANNOUNCED','REGISTERING') THEN
    RETURN jsonb_build_object('ok',false,'reason','registration_closed');
  END IF;
  PERFORM public.fn_ca_tournament_recorded_format(p_tournament_id);

  -- A persisted hand is stronger actual-start evidence than either a mutable
  -- parent status or a launch receipt that an interrupted launcher failed to
  -- complete. Canonical accepted-hand commits carry tournament_id; the
  -- table-linked branch also fails closed for older rows that omitted it. The
  -- exclusive lifecycle advisory lock above serializes this read against the
  -- shared lock held by every canonical accepted-hand commit.
  SELECT EXISTS (
           SELECT 1
             FROM public.hand_history hh
            WHERE hh.tournament_id=p_tournament_id
         ) OR EXISTS (
           SELECT 1
             FROM public.tables hand_table
             JOIN public.hand_history hh ON hh.table_id=hand_table.id
            WHERE hand_table.tournament_id=p_tournament_id
         )
    INTO v_persisted_hand_exists;
  IF v_persisted_hand_exists THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;
  IF v_start_authority='scheduled_clock' THEN
    IF v_t.start_time IS NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','registration_schedule_unset');
    END IF;
    IF clock_timestamp()>=v_t.start_time THEN
      RETURN jsonb_build_object('ok',false,'reason','tournament_started');
    END IF;
  ELSE
    SELECT r.completed_at INTO v_launch_completed_at
      FROM public.tournament_launch_receipts r
     WHERE r.tournament_id=p_tournament_id;
    IF v_t.started_at IS NOT NULL OR v_launch_completed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','tournament_started');
    END IF;
  END IF;
  IF v_reg.id IS NULL THEN
    -- Rolling clients without a request id may recover a just-lost response
    -- only while registration remains open. They can never turn an old receipt
    -- into a successful post-start response.
    IF p_request_id IS NULL THEN
      v_receipt:=public.fn_ca_tournament_unregistration_receipt(
        p_tournament_id,p_user_id,p_expected_table_id,NULL);
      IF v_receipt IS NOT NULL THEN
        RETURN v_receipt||jsonb_build_object('replayed',true);
      END IF;
    END IF;
    RETURN jsonb_build_object('ok',false,'reason','not_registered');
  END IF;
  IF p_expected_table_id IS NOT NULL THEN
    SELECT s.seat_number INTO v_seat_number
      FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id
     WHERE s.table_id=p_expected_table_id AND s.user_id=p_user_id
       AND s.left_at IS NULL AND tb.tournament_id=p_tournament_id
     ORDER BY s.id LIMIT 1 FOR UPDATE OF s;
    IF v_seat_number IS NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','not_seated');
    END IF;
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.spin_reserve_ledger r
     WHERE r.tournament_id=p_tournament_id
       AND r.kind IN ('contribution','jackpot_draw')) THEN
    RETURN jsonb_build_object('ok',false,'reason','spin_entry_already_booked');
  END IF;

  PERFORM 1 FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
   ORDER BY e.entitlement_kind,e.id FOR UPDATE;
  SELECT count(*) INTO v_non_cash_count
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
     AND e.registration_id=v_reg.id
     AND e.entitlement_kind IN ('satellite_seat','tournament_ticket')
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id=e.id)
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=e.id);
  IF COALESCE(v_reg.is_satellite_qualifier,false)
     AND v_non_cash_count<>1 THEN
    RAISE EXCEPTION
      'satellite-funded registration % requires one unspent ticket entitlement',
      v_reg.id USING ERRCODE='P0404';
  END IF;
  IF NOT COALESCE(v_reg.is_satellite_qualifier,false)
     AND v_non_cash_count<>0 THEN
    RAISE EXCEPTION
      'cash registration % cannot own a satellite ticket entitlement',v_reg.id
      USING ERRCODE='P0404';
  END IF;

  SELECT round(COALESCE(sum(e.refund_prize),0),2),
         round(COALESCE(sum(e.refund_bounty),0),2),
         round(COALESCE(sum(e.refund_fee),0),2),
         round(COALESCE(sum(e.gross),0),2),
         round(COALESCE(sum(e.gross),0),2),
         0::numeric
    INTO v_refund_prize,v_refund_bounty,v_refund_fee,v_refund_total,
         v_wallet_amount,v_ticket_amount
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
     AND (e.entitlement_kind='wallet_charge' OR e.registration_id=v_reg.id)
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=e.id)
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id=e.id);
  IF v_refund_total IS DISTINCT FROM
       round(v_refund_prize+v_refund_bounty+v_refund_fee,2)
     OR v_refund_total IS DISTINCT FROM
       round(v_wallet_amount+v_ticket_amount,2) THEN
    RAISE EXCEPTION 'registration % has invalid entitlement totals',v_reg.id
      USING ERRCODE='P0404';
  END IF;
  -- A funded satellite entry does not invent a player-wallet debit.
  -- It returns the same escrow value in cash through its exact source proof.
  IF COALESCE(v_reg.is_satellite_qualifier,false)
     AND EXISTS (
       SELECT 1 FROM public.tournament_refund_entitlements e
        WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
          AND e.entitlement_kind='wallet_charge'
          AND NOT EXISTS (
            SELECT 1 FROM public.tournament_refund_tranches tr
             WHERE tr.entitlement_id=e.id)) THEN
    RAISE EXCEPTION
      'satellite-funded registration % has an unexpected wallet charge',
      v_reg.id USING ERRCODE='P0404';
  END IF;

  SELECT round(COALESCE(sum(w.amount),0),2) INTO v_wallet_debits
    FROM public.wallet_transactions w
   WHERE w.related_entity_id=p_tournament_id AND w.user_id=p_user_id
     AND w.type='debit'
     AND lower(w.category) IN ('tournament_buyin','rebuy','addon');
  SELECT round(COALESCE(sum(e.gross),0),2) INTO v_entitled_wallet_total
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
     AND e.entitlement_kind='wallet_charge';
  SELECT round(COALESCE(sum(w.amount),0),2) INTO v_wallet_refunds_before
    FROM public.wallet_transactions w
   WHERE w.related_entity_id=p_tournament_id AND w.user_id=p_user_id
     AND w.type='credit'
     AND lower(w.category) IN ('refund','tournament_refund');
  SELECT round(COALESCE(sum(tr.amount_paid_now),0),2) INTO v_tranche_total
    FROM public.tournament_refund_tranches tr
   WHERE tr.tournament_id=p_tournament_id AND tr.user_id=p_user_id;
  IF v_wallet_debits IS DISTINCT FROM v_entitled_wallet_total
     OR v_wallet_refunds_before IS DISTINCT FROM v_tranche_total
     OR v_wallet_refunds_before>(
       SELECT COALESCE(sum(e.gross),0)
         FROM public.tournament_refund_entitlements e
        WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
          AND NOT EXISTS (
            SELECT 1 FROM public.tournament_tickets tk
             WHERE tk.source_refund_entitlement_id=e.id)) THEN
    RAISE EXCEPTION 'registration % wallet and entitlement journals disagree',v_reg.id
      USING ERRCODE='P0404';
  END IF;
  v_running_owed:=v_tranche_total;

  SELECT round(COALESCE(sum(r.rake_amount),0),2) INTO v_rake_before
    FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  SELECT COALESCE(array_agg(e.id ORDER BY e.id),ARRAY[]::uuid[])
    INTO v_fee_entitlement_ids
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
     AND (e.entitlement_kind='wallet_charge' OR e.registration_id=v_reg.id)
     AND e.refund_fee>0
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=e.id)
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id=e.id);

  -- Bind every fee-bearing entitlement to its actual same-transaction rake
  -- journal. The refund wallet club is deliberately absent from this match:
  -- it identifies the payer, while rake_records.club_id identifies the fee
  -- recipient and can be a different club.
  WITH fee_sources AS MATERIALIZED (
    SELECT e.id AS entitlement_id,r.id AS rake_record_id,
           r.club_id,r.rake_amount
      FROM public.tournament_refund_entitlements e
      JOIN public.chip_ledger l ON l.id=e.source_ledger_id
      JOIN public.rake_records r
        ON r.tournament_id=e.tournament_id
       AND r.is_tournament IS TRUE
       AND r.club_id IS NOT NULL
       AND r.rake_amount=e.refund_fee
       AND r.created_at=l.created_at
       AND r.metadata->>'user_id'=e.user_id::text
       AND (
         (e.entitlement_kind='wallet_charge'
          AND e.charge_category='tournament_buyin'
          AND r.source IN (
            'fn_register_for_tournament','fn_register_horse_for_tournament')
          AND r.metadata->>'kind'='tournament_entry_fee'
          AND r.metadata->>'registration_id'=v_reg.id::text)
         OR (e.entitlement_kind='wallet_charge'
          AND e.charge_category='rebuy'
          AND r.source='process_tournament_rebuy'
          AND r.metadata->>'kind' IN (
            'tournament_rebuy_fee','tournament_reentry_fee'))
         OR (e.entitlement_kind='satellite_seat'
          AND r.source='fn_award_satellite_seat'
          AND r.metadata->>'kind'='satellite_seat_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text)
         OR (e.entitlement_kind='tournament_ticket'
          AND r.source='fn_register_for_tournament_with_ticket'
          AND r.metadata->>'kind'='tournament_ticket_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text))
     WHERE e.id=ANY(v_fee_entitlement_ids)
  )
  SELECT count(*),count(DISTINCT entitlement_id),
         round(COALESCE(sum(rake_amount),0),2),
         COALESCE(array_agg(rake_record_id ORDER BY rake_record_id),
                  ARRAY[]::uuid[])
    INTO v_fee_source_count,v_fee_source_entitlement_count,
         v_fee_source_amount,v_fee_source_rake_record_ids
    FROM fee_sources;
  IF v_fee_source_count<>cardinality(v_fee_entitlement_ids)
     OR v_fee_source_entitlement_count<>cardinality(v_fee_entitlement_ids)
     OR v_fee_source_count<>(
       SELECT count(DISTINCT id)
         FROM unnest(v_fee_source_rake_record_ids) source(id))
     OR v_fee_source_amount IS DISTINCT FROM v_refund_fee THEN
    RAISE EXCEPTION
      'registration % fee entitlements do not map one-to-one to exact rake evidence',
      v_reg.id USING ERRCODE='P0404';
  END IF;
  PERFORM 1 FROM public.rake_records r
   WHERE r.id=ANY(v_fee_source_rake_record_ids)
   ORDER BY r.club_id,r.id FOR UPDATE;

  PERFORM public.fn_ca_midway_free_buy_promo_head(p_tournament_id,v_reg.id,true);
  SELECT * INTO v_t FROM public.tournaments WHERE id=p_tournament_id;
  PERFORM public.fn_ca_escrow_apply(
    p_tournament_id,'unregister entitlement escrow prelock');
  SELECT * INTO v_escrow_before FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id FOR UPDATE;
  SELECT count(*) INTO v_players_before FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
     AND tp.status::text IN ('registered','playing');
  IF v_escrow_before.tournament_id IS NULL
     OR v_escrow_before.enforced IS DISTINCT FROM true
     OR v_players_before<=0
     OR v_t.current_players IS DISTINCT FROM v_players_before
     OR v_t.prize_pool IS DISTINCT FROM v_escrow_before.prize_balance
     OR v_t.bounty_pool IS DISTINCT FROM v_escrow_before.bounty_balance
     OR v_t.total_rake IS DISTINCT FROM v_escrow_before.fee_balance
     OR v_t.total_rake IS DISTINCT FROM v_rake_before
     OR v_t.prize_pool<v_refund_prize
     OR v_t.bounty_pool<v_refund_bounty
     OR v_t.total_rake<v_refund_fee THEN
    RAISE EXCEPTION 'registration % cannot leave divergent tournament state',v_reg.id
      USING ERRCODE='P0404';
  END IF;

  FOR v_ent IN
    SELECT e.* FROM public.tournament_refund_entitlements e
     WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
       AND (e.entitlement_kind='wallet_charge' OR e.registration_id=v_reg.id)
       AND NOT EXISTS(
         SELECT 1 FROM public.tournament_refund_tranches tr
          WHERE tr.entitlement_id=e.id)
       AND NOT EXISTS(
         SELECT 1 FROM public.tournament_tickets tk
          WHERE tk.source_refund_entitlement_id=e.id)
     ORDER BY e.entitlement_kind,e.id
  LOOP
    v_running_owed:=round(v_running_owed+v_ent.gross,2);
    v_settle:=public.fn_settle_tournament_refund_exact(
      p_tournament_id,p_user_id,v_ent.refund_wallet_club_id,v_running_owed,
      v_ent.refund_prize,v_ent.refund_bounty,v_ent.refund_fee,
      'fn_unregister_from_tournament',v_description);
    IF COALESCE((v_settle->>'ok')::boolean,false) IS NOT TRUE
       OR (v_settle->>'entitlement_id')::uuid IS DISTINCT FROM v_ent.id
       OR (v_settle->>'paid')::numeric IS DISTINCT FROM v_ent.gross
       OR (v_settle->>'amount_paid')::numeric IS DISTINCT FROM v_running_owed
       OR (v_settle->>'source_wallet_club_id')::uuid
            IS DISTINCT FROM v_ent.refund_wallet_club_id THEN
      RAISE EXCEPTION 'registration % exact wallet refund failed',v_reg.id
        USING ERRCODE='P0404';
    END IF;
    v_entitlement_ids:=array_append(v_entitlement_ids,v_ent.id);
    v_source_wallet_club_ids:=array_append(
      v_source_wallet_club_ids,v_ent.refund_wallet_club_id);
    v_credit_ledger_ids:=array_append(
      v_credit_ledger_ids,(v_settle->>'credit_ledger_id')::uuid);
    v_wallet_transaction_ids:=array_append(
      v_wallet_transaction_ids,(v_settle->>'wallet_transaction_id')::uuid);
  END LOOP;

  FOR v_fee_group IN
    SELECT r.club_id,round(sum(r.rake_amount),2) AS fee,
           array_agg(r.id ORDER BY r.id) AS source_rake_record_ids,
           array_agg(e.id ORDER BY e.id) AS entitlement_ids
      FROM public.rake_records r
      JOIN public.tournament_refund_entitlements e
        ON e.id=ANY(v_fee_entitlement_ids)
       AND e.refund_fee=r.rake_amount
       AND e.tournament_id=r.tournament_id
       AND e.user_id=p_user_id
       AND r.metadata->>'user_id'=e.user_id::text
       AND (
         (e.entitlement_kind='wallet_charge'
          AND e.charge_category='tournament_buyin'
          AND r.source IN (
            'fn_register_for_tournament','fn_register_horse_for_tournament')
          AND r.metadata->>'kind'='tournament_entry_fee'
          AND r.metadata->>'registration_id'=v_reg.id::text)
         OR (e.entitlement_kind='wallet_charge'
          AND e.charge_category='rebuy'
          AND r.source='process_tournament_rebuy'
          AND r.metadata->>'kind' IN (
            'tournament_rebuy_fee','tournament_reentry_fee'))
         OR (e.entitlement_kind='satellite_seat'
          AND r.source='fn_award_satellite_seat'
          AND r.metadata->>'kind'='satellite_seat_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text)
         OR (e.entitlement_kind='tournament_ticket'
          AND r.source='fn_register_for_tournament_with_ticket'
          AND r.metadata->>'kind'='tournament_ticket_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text))
      JOIN public.chip_ledger l
        ON l.id=e.source_ledger_id AND l.created_at=r.created_at
     WHERE r.id=ANY(v_fee_source_rake_record_ids)
     GROUP BY r.club_id ORDER BY r.club_id
  LOOP
    IF v_fee_group.fee>0 THEN
      INSERT INTO public.rake_records(
        hand_id,table_id,club_id,rake_amount,pot_size,num_players,
        bbj_contribution,is_tournament,tournament_id,source,metadata)
      VALUES(
        NULL,NULL,v_fee_group.club_id,-v_fee_group.fee,v_fee_group.fee,1,
        0,true,p_tournament_id,'fn_unregister_from_tournament',
        jsonb_build_object(
          'kind','tournament_fee_refund','user_id',p_user_id,
          'registration_id',v_reg.id,
          'fee_recipient_club_id',v_fee_group.club_id,
          'entitlement_ids',to_jsonb(v_fee_group.entitlement_ids),
          'original_rake_record_ids',
            to_jsonb(v_fee_group.source_rake_record_ids)))
      RETURNING id INTO v_fee_reversal_id;
      v_fee_reversal_ids:=array_append(
        v_fee_reversal_ids,v_fee_reversal_id);
      v_fees_reversed:=round(v_fees_reversed+v_fee_group.fee,2);
    END IF;
  END LOOP;
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_fee_reversal_ids
    FROM unnest(v_fee_reversal_ids) reversal(id);
  IF v_fees_reversed IS DISTINCT FROM v_refund_fee THEN
    RAISE EXCEPTION
      'registration % reversed % in exact fee rows but owes %',
      v_reg.id,v_fees_reversed,v_refund_fee USING ERRCODE='P0404';
  END IF;

  UPDATE public.tournaments
     SET current_players=v_players_before-1,
         prize_pool=round(v_t.prize_pool-v_refund_prize,2),
         bounty_pool=round(v_t.bounty_pool-v_refund_bounty,2),
         total_rake=round(v_t.total_rake-v_refund_fee,2),updated_at=now()
   WHERE id=p_tournament_id
     AND current_players IS NOT DISTINCT FROM v_players_before
     AND prize_pool IS NOT DISTINCT FROM v_t.prize_pool
     AND bounty_pool IS NOT DISTINCT FROM v_t.bounty_pool
     AND total_rake IS NOT DISTINCT FROM v_t.total_rake;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'registration % tournament cache changed',v_reg.id
      USING ERRCODE='55000';
  END IF;

  UPDATE public.table_seats s
     SET left_at=transaction_timestamp(),status='left',leave_pending=false,
         is_sitting_out=false,is_away=false,sit_out_at=NULL,
         scheduled_leave_hands=NULL
   WHERE s.user_id=p_user_id AND s.left_at IS NULL
     AND EXISTS(SELECT 1 FROM public.tables tb
                 WHERE tb.id=s.table_id AND tb.tournament_id=p_tournament_id);
  UPDATE public.tables tb
     SET current_players=(SELECT count(*) FROM public.table_seats s
                           WHERE s.table_id=tb.id AND s.left_at IS NULL),
         updated_at=now()
   WHERE tb.tournament_id=p_tournament_id;
  DELETE FROM public.tournament_players tp WHERE tp.id=v_reg.id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'registration % was not deleted after settlement',v_reg.id
      USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_escrow_after FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id;
  SELECT round(COALESCE(sum(r.rake_amount),0),2) INTO v_rake_after
    FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  SELECT round(COALESCE(sum(w.amount),0),2) INTO v_wallet_refunds_after
    FROM public.wallet_transactions w
   WHERE w.related_entity_id=p_tournament_id AND w.user_id=p_user_id
     AND w.type='credit'
     AND lower(w.category) IN ('refund','tournament_refund');
  IF (SELECT count(*) FROM public.tournament_players tp
       WHERE tp.tournament_id=p_tournament_id
         AND tp.status::text IN ('registered','playing'))<>v_players_before-1
     OR v_wallet_refunds_after IS DISTINCT FROM
          round(v_wallet_refunds_before+v_wallet_amount,2)
     OR v_escrow_after.prize_balance IS DISTINCT FROM
          round(v_escrow_before.prize_balance-v_refund_prize,2)
     OR v_escrow_after.bounty_balance IS DISTINCT FROM
          round(v_escrow_before.bounty_balance-v_refund_bounty,2)
     OR v_escrow_after.fee_balance IS DISTINCT FROM
          round(v_escrow_before.fee_balance-v_refund_fee,2)
     OR v_rake_after IS DISTINCT FROM round(v_rake_before-v_refund_fee,2)
     OR NOT EXISTS(
       SELECT 1 FROM public.tournaments t
        WHERE t.id=p_tournament_id
          AND t.current_players=v_players_before-1
          AND t.prize_pool=v_escrow_after.prize_balance
          AND t.bounty_pool=v_escrow_after.bounty_balance
          AND t.total_rake=v_rake_after) THEN
    RAISE EXCEPTION 'registration % did not leave exact final state',v_reg.id
      USING ERRCODE='P0404';
  END IF;
  IF p_expected_table_id IS NOT NULL THEN
    SELECT count(*) INTO v_seats_taken FROM public.table_seats s
     WHERE s.table_id=p_expected_table_id AND s.left_at IS NULL;
  END IF;

  -- Re-prove the chosen start authority after all money and seat work. Timed
  -- events still use the locked schedule cutoff; every product also treats a
  -- persisted hand as irreversible start truth; seat-first products further
  -- use status, started_at and completed launch truth. Any loss of the race
  -- rolls every preceding write back atomically.
  v_unregistered_at:=clock_timestamp();
  SELECT EXISTS (
           SELECT 1
             FROM public.hand_history hh
            WHERE hh.tournament_id=p_tournament_id
         ) OR EXISTS (
           SELECT 1
             FROM public.tables hand_table
             JOIN public.hand_history hh ON hh.table_id=hand_table.id
            WHERE hand_table.tournament_id=p_tournament_id
         )
    INTO v_persisted_hand_exists;
  IF v_persisted_hand_exists THEN
    RAISE EXCEPTION
      'tournament hand persisted before unregistration could commit'
      USING ERRCODE='55000';
  END IF;
  IF v_start_authority='scheduled_clock' THEN
    IF v_unregistered_at>=v_t.start_time THEN
      RAISE EXCEPTION 'tournament started before unregistration could commit'
        USING ERRCODE='55000';
    END IF;
  ELSE
    SELECT t.status::text,t.started_at,launch.completed_at
      INTO v_actual_status,v_actual_started_at,v_launch_completed_at
      FROM public.tournaments t
      LEFT JOIN public.tournament_launch_receipts launch
        ON launch.tournament_id=t.id
     WHERE t.id=p_tournament_id;
    IF upper(COALESCE(v_actual_status,'')) NOT IN ('ANNOUNCED','REGISTERING')
       OR v_actual_started_at IS NOT NULL
       OR v_launch_completed_at IS NOT NULL THEN
      RAISE EXCEPTION
        'seat-first tournament started before unregistration could commit'
        USING ERRCODE='55000';
    END IF;
  END IF;

  INSERT INTO public.tournament_unregistration_receipts(
    registration_id,request_id,tournament_id,user_id,source_table_id,
    refunded_chips,returned_ticket_value,entitlement_ids,ticket_ids,
    source_wallet_club_ids,credit_ledger_ids,wallet_transaction_ids,
    fees_reversed,fee_reversal_ids,fee_source_rake_record_ids,
    seat_number,seats_taken,scheduled_start_at,start_authority,settled_at)
  VALUES(
    v_reg.id,v_request_id,p_tournament_id,p_user_id,p_expected_table_id,
    v_wallet_amount,v_ticket_amount,v_entitlement_ids,v_ticket_ids,
    v_source_wallet_club_ids,v_credit_ledger_ids,v_wallet_transaction_ids,
    v_fees_reversed,v_fee_reversal_ids,v_fee_source_rake_record_ids,
    v_seat_number,v_seats_taken,v_t.start_time,v_start_authority,v_unregistered_at);
  v_receipt:=public.fn_ca_tournament_unregistration_receipt(
    p_tournament_id,p_user_id,p_expected_table_id,v_request_id);
  IF v_receipt IS NULL
     OR (v_receipt->>'registration_id')::uuid IS DISTINCT FROM v_reg.id THEN
    RAISE EXCEPTION 'registration % has no exact unregistration receipt',v_reg.id
      USING ERRCODE='P0404';
  END IF;
  RETURN v_receipt||jsonb_build_object('replayed',false);
END;
$function$
;
REVOKE ALL ON FUNCTION public.fn_ca_unregister_tournament_player_exact(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_poker_diamond_tournament_unregister(p_tournament_id uuid, p_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.tournaments%ROWTYPE; v_reg public.tournament_players%ROWTYPE;
  v_refund jsonb; v_players_before integer; v_rows integer;
  v_prior public.poker_diamond_tournament_ledger%ROWTYPE; v_prior_reg uuid; v_prior_after bigint;
  v_authority text := 'scheduled_clock';
BEGIN
  IF p_tournament_id IS NULL OR p_user_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'tournament, player and request ids are required' USING ERRCODE='22004';
  END IF;
  PERFORM public.fn_ca_lock_mtt_admission_contract();
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  -- @lifecycle-exclusive-lock: pre-start Diamond unregistration serializes tournament status, current_players, and pool totals under settlement lane
  SELECT * INTO v_t FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;
  IF v_t.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','tournament_not_found'); END IF;
  IF NOT public.fn_poker_diamond_tournament(p_tournament_id) THEN
    RAISE EXCEPTION 'diamond_asset_required' USING ERRCODE='23514';
  END IF;

  -- A withdrawal that already happened answers with what it did: the same
  -- receipt the first answer carried, rebuilt from the refund ledger row
  -- (its registration id from the entry row of the same custody), so the
  -- client's one exact replay after a lost response is a receipt. The chip
  -- authority replays its stored receipt the same way, past the clock too.
  -- DIAMOND PHASE 11: word for word - no replay marker, and the balance it
  -- reports is the one the refund left, read from the release's own
  -- immutable receipt (keyed by this request id), never the wallet as it
  -- stands at the retry.
  SELECT l.* INTO v_prior FROM public.poker_diamond_tournament_ledger l
   WHERE l.tournament_id=p_tournament_id AND l.user_id=p_user_id AND l.kind='refund'
     AND l.request->>'request_id'=p_request_id::text
   ORDER BY l.id LIMIT 1;
  IF FOUND THEN
    SELECT e.registration_id INTO v_prior_reg FROM public.poker_diamond_tournament_ledger e
     WHERE e.custody_id=v_prior.custody_id AND e.kind='entry'
     ORDER BY e.id LIMIT 1;
    SELECT (m.receipt->>'available_balance')::bigint INTO v_prior_after
      FROM public.poker_diamond_movements m
     WHERE m.request_id=p_request_id AND m.custody_id=v_prior.custody_id AND m.action='release';
    IF v_prior_after IS NULL THEN
      RAISE EXCEPTION 'diamond_tournament_refund_receipt_missing' USING ERRCODE='P0404';
    END IF;
    RETURN jsonb_build_object('ok',true,'fully_settled',true,'remaining',0,
      'request_id',p_request_id,
      'refunded_diamonds',v_prior.amount,'refund_prize',v_prior.prize_part,
      'refund_bounty',v_prior.bounty_part,'refund_fee',v_prior.fee_part,
      'registration_id',v_prior_reg,'custody_id',v_prior.custody_id,'obligation_id',v_prior.obligation_id,
      'asset','diamonds','diamonds_after',v_prior_after);
  END IF;

  -- The start authority is the chip authority's. A scheduled event closes at
  -- its clock. A spin or a heads-up sit-and-go is seat-first: start_time is
  -- only its fill-window deadline, and it closes when it actually starts. A
  -- launch releasing a registrant it could not seat names its incomplete
  -- receipt through app.ca_launch_release_launch_id; it is past the clock by
  -- design and is held to the seat-first proofs instead. A persisted hand
  -- closes every product.
  IF v_t.format_contract='spin-v1' THEN
    v_authority := 'spin_actual_start';
  ELSIF v_t.format_contract='sng-v1'
     AND COALESCE(v_t.max_players,0)=2 THEN
    v_authority := 'heads_up_sng_actual_start';
  ELSIF v_t.format_contract='sng-v1'
     AND upper(COALESCE(v_t.tournament_type::text,''))='SNG'
     AND lower(COALESCE(v_t.variant::text,''))<>'spin' THEN
    v_authority := 'sng_actual_start';
  END IF;
  IF v_authority='scheduled_clock' AND EXISTS (
       SELECT 1 FROM public.tournament_launch_receipts r
        WHERE r.tournament_id=p_tournament_id
          AND r.completed_at IS NULL
          AND r.launch_id::text=NULLIF(current_setting('app.ca_launch_release_launch_id',true),'')) THEN
    v_authority := 'launch_release';
  END IF;
  IF upper(COALESCE(v_t.status,'')) NOT IN ('ANNOUNCED','REGISTERING') OR v_t.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;
  PERFORM public.fn_ca_tournament_recorded_format(p_tournament_id);
  IF EXISTS (SELECT 1 FROM public.hand_history hh WHERE hh.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.tables ht JOIN public.hand_history hh ON hh.table_id=ht.id
                 WHERE ht.tournament_id=p_tournament_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;
  IF v_authority='scheduled_clock' THEN
    IF v_t.start_time IS NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','registration_schedule_unset');
    END IF;
    IF clock_timestamp()>=v_t.start_time THEN
      RETURN jsonb_build_object('ok',false,'reason','tournament_started');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.tournament_launch_receipts r
                 WHERE r.tournament_id=p_tournament_id AND r.completed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;

  SELECT * INTO v_reg FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id FOR UPDATE;
  IF v_reg.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_registered'); END IF;
  IF v_reg.status::text NOT IN ('registered','playing') THEN
    RETURN jsonb_build_object('ok',false,'reason','not_registered');
  END IF;
  SELECT count(*)::integer INTO v_players_before FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id AND tp.status::text IN ('registered','playing');

  -- Money first: the release is the part that can refuse.
  v_refund := public.fn_poker_diamond_tournament_refund(
    p_tournament_id, p_user_id, 'unregister', 'fn_unregister_from_tournament', p_request_id);

  -- The same roster effects the chip authority produces, in the same order.
  UPDATE public.table_seats s
     SET left_at=transaction_timestamp(),status='left',leave_pending=false,
         is_sitting_out=false,is_away=false,sit_out_at=NULL,scheduled_leave_hands=NULL
   WHERE s.user_id=p_user_id AND s.left_at IS NULL
     AND EXISTS(SELECT 1 FROM public.tables tb WHERE tb.id=s.table_id AND tb.tournament_id=p_tournament_id);
  UPDATE public.tables tb
     SET current_players=(SELECT count(*) FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL),
         updated_at=now()
   WHERE tb.tournament_id=p_tournament_id;
  DELETE FROM public.tournament_players tp WHERE tp.id=v_reg.id;
  UPDATE public.tournaments
     SET current_players=v_players_before-1,
         prize_pool=round(COALESCE(prize_pool,0)-(v_refund->>'refund_prize')::numeric,2),
         bounty_pool=round(COALESCE(bounty_pool,0)-(v_refund->>'refund_bounty')::numeric,2),
         total_rake=round(COALESCE(total_rake,0)-(v_refund->>'refund_fee')::numeric,2),
         updated_at=now()
   WHERE id=p_tournament_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RAISE EXCEPTION 'tournament vanished during unregistration' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('ok',true,'fully_settled',true,'remaining',0,'request_id',p_request_id,
    'refunded_diamonds',(v_refund->>'paid')::numeric,'refund_prize',(v_refund->>'refund_prize')::numeric,
    'refund_bounty',(v_refund->>'refund_bounty')::numeric,'refund_fee',(v_refund->>'refund_fee')::numeric,
    'registration_id',v_reg.id,'custody_id',v_refund->>'custody_id','obligation_id',v_refund->>'obligation_id',
    'asset','diamonds','diamonds_after',(v_refund->>'available_balance')::bigint);
END $function$
;
REVOKE ALL ON FUNCTION public.fn_poker_diamond_tournament_unregister(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
SELECT public.fn_ca_declare_guard_redefinition(
  'fn_poker_diamond_tournament_unregister',
  'migration 20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id'
);

-- @probe-for: public.fn_ca_promo_lock_grant_funds
-- @probe-for: public.fn_ca_promo_return_principal
-- @probe-for: public.fn_ca_promo_returned_ticket_principal_fee
-- @probe-for: public.fn_ca_promo_play_through_record_grant
-- @probe-for: public.fn_ca_tournament_unregistration_receipt
-- @probe-for: public.fn_ca_unregister_tournament_player_exact
-- @probe-for: public.fn_poker_diamond_tournament_unregister
DO $probe$
DECLARE
  v_res jsonb;
  v_rec jsonb;
BEGIN
  PERFORM public.fn_ca_promo_lock_grant_funds(ARRAY[]::uuid[]);

  BEGIN
    PERFORM public.fn_ca_promo_return_principal(
      gen_random_uuid(), 'player_wallet', 'returned');
    RAISE EXCEPTION 'probe_expected_grant_missing';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'promo_return_original_grant_missing' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.fn_ca_promo_returned_ticket_principal_fee(
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'probe_expected_ledger_missing';
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;

  BEGIN
    PERFORM public.fn_ca_promo_play_through_record_grant(
      gen_random_uuid(), gen_random_uuid(), 0, 'wheel_prize', 'probe');
    RAISE EXCEPTION 'probe_expected_amount_guard';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'promo play-through grant needs a club, a member, a positive amount and a source reference' THEN
      RAISE;
    END IF;
  END;

  v_rec := public.fn_ca_tournament_unregistration_receipt(
    gen_random_uuid(), gen_random_uuid(), NULL, NULL);
  IF v_rec IS NOT NULL THEN
    RAISE EXCEPTION 'probe_unexpected_receipt';
  END IF;

  BEGIN
    v_res := public.fn_ca_unregister_tournament_player_exact(
      gen_random_uuid(), gen_random_uuid(), NULL, 'probe', gen_random_uuid());
    IF COALESCE(v_res->>'reason', '') <> 'tournament_not_found' THEN
      RAISE EXCEPTION 'probe_unexpected_unregister_answer:%', v_res;
    END IF;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'MTT_ADMISSION_CONTRACT_MISSING_OR_UNKNOWN' THEN RAISE; END IF;
  END;

  BEGIN
    v_res := public.fn_poker_diamond_tournament_unregister(
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
    IF COALESCE(v_res->>'reason', '') <> 'tournament_not_found' THEN
      RAISE EXCEPTION 'probe_unexpected_diamond_unregister_answer:%', v_res;
    END IF;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'MTT_ADMISSION_CONTRACT_MISSING_OR_UNKNOWN' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
