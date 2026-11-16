-- Original promotional principal refunded in kind returns to its original fund.
-- The original gross issue and escrow refund remain immutable; exact source
-- fee/loss/open-capital receipts split the reusable asset and source-fund credit.
-- Full source-fund return cancels the durable positive-face audit ticket.
-- Runs AFTER190221/200638 so their original earning producers remain installed.
-- @install-window: daily-maintenance
-- @locks: public.tournament_tickets, public.clubs, public.agents, public.union_wallets
-- @live-proof: to_regclass('public.ca_promo_ticket_principal_fee_returns') IS NOT NULL AND position('original_ticket_Pfee_return_incomplete' in pg_get_functiondef('public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)'::regprocedure))>0 AND position('ca_promo_ticket_principal_fee_returns' in pg_get_functiondef('public.fn_ca_satellite_entry_ticket_is_guarded()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
-- Original in-kind refund: spent promotional fee belongs to its original fund.
-- No player-wallet credit, cash tranche, new gift, or closed-grant revival.
-- Existing restricted source principal is returned and its remainder closed.
CREATE TABLE public.ca_promo_ticket_principal_fee_returns(
 entitlement_id uuid NOT NULL,grant_id uuid NOT NULL,issue_ledger_id uuid NOT NULL,
 ticket_id uuid NOT NULL,charge_ledger_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0 AND amount=round(amount,2)),
 fee_amount numeric NOT NULL,loss_amount numeric NOT NULL,active_amount numeric NOT NULL,recorded_txid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 funded_from_type text NOT NULL,funded_from_id uuid NOT NULL,return_ledger_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(entitlement_id,grant_id)
);
ALTER TABLE public.ca_promo_ticket_principal_fee_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_ticket_principal_fee_returns FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_ticket_principal_fee_returns TO service_role;
CREATE TRIGGER original_ticket_principal_fee_return_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_ticket_principal_fee_returns FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER original_ticket_principal_fee_return_no_truncate BEFORE TRUNCATE ON public.ca_promo_ticket_principal_fee_returns FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES('fn_ca_promo_returned_ticket_principal_fee','approved','Exact original promo fee, proven loss and remaining restricted principal leave returned ticket escrow for the original fund; no new gift, closed-grant revival or personal cash conversion.') ON CONFLICT(proname) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes;
CREATE FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(p_ledger uuid,p_entitlement uuid,p_ticket uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
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
 ) SELECT g.id,g.club_id,g.user_id,g.funded_from_type,g.funded_from_id,sum(x.fee) fee,sum(x.lost) lost,sum(x.active) active,sum(x.fee+x.lost+x.active) amount
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
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $guard_preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_satellite_entry_ticket_is_guarded()'::regprocedure))<>'0c18d76e80f61a30d0e962cea0d3610c' THEN RAISE EXCEPTION 'original_ticket_guard_preimage_changed';END IF;END $guard_preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_satellite_entry_ticket_is_guarded()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token uuid := NULLIF(
    current_setting('app.ca_satellite_ticket_use_token',true),'')::uuid;
  v_cash_token uuid := NULLIF(
    current_setting('app.ca_closed_target_ticket_cash',true),'')::uuid;
  v_authorization public.tournament_ticket_admission_authorizations%ROWTYPE;
  v_rows integer;
BEGIN
  IF TG_OP='DELETE' AND OLD.redemption_mode='tournament_entry_only' THEN
    RAISE EXCEPTION 'tournament-entry tickets are durable financial evidence'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP='UPDATE' AND OLD.redemption_mode='tournament_entry_only' AND OLD.status='issued'
   AND OLD.source_refund_entitlement_id IS NOT NULL THEN
   DECLARE gross numeric;returned numeric;fees numeric;capital numeric;BEGIN
    SELECT e.gross,sum(r.amount),sum(r.fee_amount),sum(r.loss_amount+r.active_amount) INTO gross,returned,fees,capital
    FROM public.ca_promo_ticket_principal_fee_returns r JOIN public.tournament_refund_entitlements e ON e.id=r.entitlement_id
    JOIN public.chip_ledger issue ON issue.id=r.issue_ledger_id JOIN public.chip_ledger refund ON refund.id=r.return_ledger_id
    WHERE r.ticket_id=OLD.id AND r.entitlement_id=OLD.source_refund_entitlement_id
     AND r.recorded_txid=pg_current_xact_id() AND issue.amount=e.gross AND issue.from_type='prize_liability' AND issue.from_entity_id=e.tournament_id AND issue.to_type='escrow' AND issue.to_entity_id=OLD.id
     AND refund.from_type='escrow' AND refund.from_entity_id=OLD.id AND refund.to_type=r.funded_from_type AND refund.to_entity_id=r.funded_from_id AND refund.amount=r.amount
    GROUP BY e.gross;
    IF returned>0 AND ROW(NEW.id,NEW.club_id,NEW.issued_by,NEW.holder_id,NEW.note,NEW.redemption_mode,NEW.source_tournament_id,NEW.source_satellite_id,NEW.source_refund_entitlement_id,NEW.source_satellite_award_place,NEW.created_at,NEW.redeemed_at)
      IS NOT DISTINCT FROM ROW(OLD.id,OLD.club_id,OLD.issued_by,OLD.holder_id,OLD.note,OLD.redemption_mode,OLD.source_tournament_id,OLD.source_satellite_id,OLD.source_refund_entitlement_id,OLD.source_satellite_award_place,OLD.created_at,OLD.redeemed_at)
     AND ((returned=gross AND NEW.status='cancelled' AND NEW.cancelled_at=transaction_timestamp() AND ROW(NEW.value,NEW.entry_prize,NEW.entry_bounty,NEW.entry_fee)=ROW(OLD.value,OLD.entry_prize,OLD.entry_bounty,OLD.entry_fee))
      OR(returned<gross AND NEW.status='issued' AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at AND NEW.value=gross-returned
        AND EXISTS(SELECT 1 FROM public.tournament_refund_entitlements e WHERE e.id=OLD.source_refund_entitlement_id AND NEW.entry_fee=e.refund_fee-fees AND NEW.entry_prize=greatest(0,e.refund_prize-capital) AND NEW.entry_bounty=e.refund_bounty-greatest(0,capital-e.refund_prize)))) THEN RETURN NEW;END IF;
   END;
  END IF;
  IF TG_OP='UPDATE' AND OLD.redemption_mode='tournament_entry_only' THEN
    IF ROW(NEW.id,NEW.club_id,NEW.issued_by,NEW.holder_id,NEW.value,NEW.note,
           NEW.redemption_mode,NEW.source_tournament_id,
           NEW.source_satellite_id,NEW.source_refund_entitlement_id,
           NEW.source_satellite_award_place,
           NEW.entry_prize,NEW.entry_bounty,NEW.entry_fee,NEW.created_at,
           NEW.cancelled_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.club_id,OLD.issued_by,OLD.holder_id,OLD.value,OLD.note,
           OLD.redemption_mode,OLD.source_tournament_id,
           OLD.source_satellite_id,OLD.source_refund_entitlement_id,
           OLD.source_satellite_award_place,
           OLD.entry_prize,OLD.entry_bounty,OLD.entry_fee,OLD.created_at,
           OLD.cancelled_at) THEN
      RAISE EXCEPTION 'tournament-entry ticket identity and rails are immutable'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      /* A SATELLITE SEAT IS SEAT OR CASH (2026-10-12). A direct satellite
         ticket whose one target can no longer admit it is paid to its holder
         in cash by fn_ca_pay_closed_target_ticket_in_cash, and only by it:
         the transition is accepted only when that door has already written
         the exact escrow-to-wallet leg under the ticket's own key in this
         transaction and named this ticket on its token. */
      IF OLD.status='issued' AND NEW.status='redeemed'
         AND v_cash_token IS NOT NULL AND v_cash_token=OLD.id
         AND NOT public.fn_ca_satellite_value_ticket_marked(OLD.id)
         AND OLD.redeemed_at IS NULL
         AND NEW.redeemed_at=transaction_timestamp()
         AND OLD.source_satellite_award_place IS NOT NULL
         AND OLD.source_refund_entitlement_id IS NULL
         AND public.fn_ca_satellite_ticket_target_is_closed(
               OLD.source_tournament_id)
         AND (SELECT count(*)
                FROM public.chip_ledger_idem i
                JOIN public.chip_ledger l ON l.id=i.leg_id
               WHERE i.idempotency_key=
                       'ticket:'||OLD.id::text||':closed-target-cash'
                 AND l.from_type='escrow' AND l.from_entity_id=OLD.id
                 AND l.to_type='player_wallet'
                 AND l.to_entity_id=OLD.holder_id
                 AND l.amount=OLD.value AND l.club_id=OLD.club_id
                 AND l.category='ticket_redeem'
                 AND l.tournament_id IS NULL)=1 THEN
        RETURN NEW;
      END IF;
      IF NOT (OLD.status='issued' AND NEW.status='redeemed'
              AND v_token IS NOT NULL
              AND OLD.redeemed_at IS NULL
              AND NEW.redeemed_at IS NOT NULL
              AND NEW.redeemed_at=transaction_timestamp()) THEN
        RAISE EXCEPTION
          'tournament-entry tickets can only be consumed by tournament admission'
          USING ERRCODE = '42501';
      END IF;
      SELECT * INTO v_authorization
        FROM public.tournament_ticket_admission_authorizations a
       WHERE a.token=v_token AND a.ticket_id=OLD.id
       FOR UPDATE;
      IF v_authorization.token IS NULL
         OR v_authorization.user_id IS DISTINCT FROM OLD.holder_id
         OR NOT EXISTS(
           SELECT 1 FROM public.tournament_players tp
            WHERE tp.id=v_authorization.registration_id
              AND tp.tournament_id=v_authorization.tournament_id
              AND tp.user_id=v_authorization.user_id
              AND tp.status::text IN ('registered','playing')) THEN
        RAISE EXCEPTION
          'tournament-entry ticket has no exact admission authorization'
          USING ERRCODE = '42501';
      END IF;
      DELETE FROM public.tournament_ticket_admission_authorizations a
       WHERE a.token=v_token AND a.ticket_id=OLD.id;
      GET DIAGNOSTICS v_rows=ROW_COUNT;
      IF v_rows<>1 THEN
        RAISE EXCEPTION
          'tournament-entry ticket admission authorization was not consumed once'
          USING ERRCODE = 'P0404';
      END IF;
    END IF;
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.redeemed_at IS DISTINCT FROM OLD.redeemed_at THEN
      RAISE EXCEPTION
        'tournament-entry ticket redemption time is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$function$
;

DO $return_preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_return_satellite_entitlement_as_ticket(uuid,text,text)'::regprocedure))<>'68eb9e48479a070b0317f2baeae97b61' THEN RAISE EXCEPTION 'original_ticket_return_preimage_changed';END IF;END $return_preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_return_satellite_entitlement_as_ticket(p_entitlement_id uuid, p_source text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_e public.tournament_refund_entitlements%ROWTYPE;
  v_t public.tournaments%ROWTYPE;
  v_tournament_id uuid;
  v_ticket public.tournament_tickets%ROWTYPE;
  v_key text;
  v_before numeric;
  v_rows integer;
  v_ledger_id uuid;
  v_tx_id uuid;
  v_returned numeric;v_fee_returned numeric;v_capital_returned numeric;
BEGIN
  IF p_entitlement_id IS NULL OR p_source IS NULL
     OR length(btrim(p_source))=0 OR p_description IS NULL
     OR length(btrim(p_description))=0 THEN
    RAISE EXCEPTION 'satellite ticket return received an invalid contract'
      USING ERRCODE = '22003';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ca_settle_sources s
     WHERE s.source=lower(btrim(p_source))) THEN
    RAISE EXCEPTION 'satellite ticket return source % is not an authority',p_source
      USING ERRCODE = '42501';
  END IF;
  SELECT e.tournament_id INTO v_tournament_id
    FROM public.tournament_refund_entitlements e
   WHERE e.id=p_entitlement_id;
  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'satellite refund entitlement % does not exist',p_entitlement_id
      USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.fn_ca_lock_settlement_lane_global();
  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=v_tournament_id FOR UPDATE;
  SELECT * INTO v_e FROM public.tournament_refund_entitlements e
   WHERE e.id=p_entitlement_id FOR UPDATE;
  IF v_e.id IS NULL
     OR v_e.entitlement_kind NOT IN ('satellite_seat','tournament_ticket')
     OR v_e.tournament_id IS DISTINCT FROM v_t.id THEN
    RAISE EXCEPTION
      'entitlement % is not a satellite-funded tournament entry',p_entitlement_id
      USING ERRCODE = 'P0404';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_refund_tranches tr
     WHERE tr.entitlement_id=v_e.id) THEN
    RAISE EXCEPTION 'satellite seat entitlement was incorrectly converted to chips'
      USING ERRCODE = 'P0404';
  END IF;
  SELECT * INTO v_ticket FROM public.tournament_tickets tk
   WHERE tk.source_refund_entitlement_id=v_e.id FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(sum(amount),0),COALESCE(sum(fee_amount),0),COALESCE(sum(loss_amount+active_amount),0) INTO v_returned,v_fee_returned,v_capital_returned FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=v_e.id AND ticket_id=v_ticket.id;
    SELECT count(*),min(l.id::text)::uuid
      INTO v_rows,v_ledger_id FROM public.chip_ledger l
     WHERE l.idempotency_key='tourney:'||v_e.tournament_id::text
             ||':satellite-ticket-return:'||v_e.id::text
       AND l.from_type='prize_liability'
       AND l.from_entity_id=v_e.tournament_id
       AND l.to_type='escrow' AND l.to_entity_id=v_ticket.id
       AND l.club_id=v_e.refund_wallet_club_id AND l.amount=v_e.gross;
    IF v_rows<>1 OR v_ledger_id IS NULL
       OR (SELECT count(*) FROM public.chip_transactions ct
            WHERE ct.transaction_type='tournament_ticket_issue'
              AND ct.club_id=v_e.refund_wallet_club_id
              AND ct.from_user_id IS NULL AND ct.to_user_id=v_e.user_id
              AND ct.amount=v_e.gross
              AND ct.metadata->>'ticket_id'=v_ticket.id::text
              AND ct.metadata->>'entitlement_id'=v_e.id::text
              AND ct.metadata->>'ledger_id'=v_ledger_id::text) <> 1
       OR v_ticket.status NOT IN ('issued','redeemed','cancelled') OR (v_ticket.status='cancelled' AND v_returned<>v_e.gross)
       OR v_ticket.holder_id IS DISTINCT FROM v_e.user_id
       OR (v_returned<v_e.gross AND v_ticket.value IS DISTINCT FROM v_e.gross-v_returned)
       OR v_ticket.redemption_mode<>'tournament_entry_only'
       OR v_ticket.source_tournament_id IS DISTINCT FROM v_e.tournament_id
       OR v_ticket.source_satellite_id IS DISTINCT FROM v_e.source_satellite_id
       OR v_ticket.source_refund_entitlement_id IS DISTINCT FROM v_e.id
       OR (v_returned<v_e.gross AND v_ticket.entry_prize IS DISTINCT FROM greatest(0,v_e.refund_prize-v_capital_returned))
       OR (v_returned<v_e.gross AND v_ticket.entry_bounty IS DISTINCT FROM v_e.refund_bounty-greatest(0,v_capital_returned-v_e.refund_prize))
       OR (v_returned<v_e.gross AND v_ticket.entry_fee IS DISTINCT FROM v_e.refund_fee-v_fee_returned) THEN
      RAISE EXCEPTION 'satellite ticket replay evidence is incomplete'
        USING ERRCODE = 'P0404';
    END IF;
    RETURN jsonb_build_object(
      'ok',true,'replayed',true,'ticket_id',v_ticket.id,
      'entitlement_id',v_e.id,'value',CASE WHEN v_ticket.status='cancelled' THEN 0 ELSE v_ticket.value END,
      'refund_prize',v_e.refund_prize,
      'refund_bounty',v_e.refund_bounty,'refund_fee',v_e.refund_fee,
      'refund_wallet_club_id',v_e.refund_wallet_club_id);
  END IF;

  PERFORM public.fn_ca_escrow_apply(
    v_e.tournament_id,'satellite ticket return escrow prelock');
  SELECT round(e.prize_balance+e.bounty_balance+e.fee_balance,2)
    INTO v_before FROM public.tournament_escrow e
   WHERE e.tournament_id=v_e.tournament_id FOR UPDATE;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'satellite ticket return has no enforced target escrow'
      USING ERRCODE = 'P0404';
  END IF;
  v_ticket.id:=gen_random_uuid();
  INSERT INTO public.tournament_tickets(
    id,club_id,issued_by,holder_id,value,status,note,
    redemption_mode,source_tournament_id,source_satellite_id,
    source_refund_entitlement_id,entry_prize,entry_bounty,entry_fee,created_at)
  VALUES(
    v_ticket.id,v_e.refund_wallet_club_id,
    '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid,
    v_e.user_id,v_e.gross,'issued',
    p_description,'tournament_entry_only',v_e.tournament_id,
    v_e.source_satellite_id,v_e.id,v_e.refund_prize,v_e.refund_bounty,
    v_e.refund_fee,transaction_timestamp())
  RETURNING * INTO v_ticket;
  v_key:='tourney:'||v_e.tournament_id::text
         ||':satellite-ticket-return:'||v_e.id::text;
  INSERT INTO public.chip_ledger(
    performed_by,from_type,from_entity_id,from_label,
    to_type,to_entity_id,to_label,amount,category,club_id,tournament_id,
    idempotency_key,settlement_id,actor_service,description,metadata,
    pre_from_balance,post_from_balance,pre_to_balance,post_to_balance)
  VALUES(
    COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
    'prize_liability',v_e.tournament_id,'tournaments escrow',
    'escrow',v_ticket.id,'satellite tournament entry ticket',
    v_e.gross,'ticket_issue',v_e.refund_wallet_club_id,v_e.tournament_id,
    v_key,'satellite-ticket:'||v_ticket.id::text,lower(btrim(p_source)),
    p_description,jsonb_build_object(
      'kind','tournament_entry_ticket_return','ticket_id',v_ticket.id,
      'entitlement_id',v_e.id,'user_id',v_e.user_id,
      'entitlement_kind',v_e.entitlement_kind,
      'source_satellite_id',v_e.source_satellite_id,
      'refund_prize',v_e.refund_prize,'refund_bounty',v_e.refund_bounty,
      'refund_fee',v_e.refund_fee),
    v_before,round(v_before-v_e.gross,2),0,v_e.gross)
  RETURNING id INTO v_ledger_id;
  INSERT INTO public.chip_transactions(
    club_id,from_user_id,to_user_id,amount,transaction_type,notes,
    balance_after,metadata)
  VALUES(
    v_e.refund_wallet_club_id,NULL,v_e.user_id,v_e.gross,
    'tournament_ticket_issue',p_description,NULL,jsonb_build_object(
      'ticket_id',v_ticket.id,'escrow_entity_id',v_ticket.id,
      'holder_id',v_e.user_id,'value',v_e.gross,
      'redemption_mode','tournament_entry_only',
      'source_tournament_id',v_e.tournament_id,
      'source_satellite_id',v_e.source_satellite_id,
      'entitlement_id',v_e.id,'entitlement_kind',v_e.entitlement_kind,
      'ledger_id',v_ledger_id,
      'idempotency_key',v_key))
  RETURNING id INTO v_tx_id;
  PERFORM public.fn_ca_escrow_apply_exact_refund(
    v_e.tournament_id,'satellite seat returned as tournament ticket',
    v_e.refund_prize,v_e.refund_bounty,v_e.refund_fee);
  PERFORM public.fn_ca_promo_returned_ticket_principal_fee(v_ledger_id,v_e.id,v_ticket.id);
  SELECT * INTO STRICT v_ticket FROM public.tournament_tickets WHERE id=v_ticket.id;
  RETURN jsonb_build_object(
    'ok',true,'replayed',false,'ticket_id',v_ticket.id,
    'entitlement_id',v_e.id,'value',CASE WHEN v_ticket.status='cancelled' THEN 0 ELSE v_ticket.value END,
    'refund_prize',v_e.refund_prize,
    'refund_bounty',v_e.refund_bounty,'refund_fee',v_e.refund_fee,
    'refund_wallet_club_id',v_e.refund_wallet_club_id,
    'ledger_id',v_ledger_id,'transaction_id',v_tx_id);
END;
$function$
;

-- Internal original issuer: only the owning financial request calls it.
REVOKE ALL ON FUNCTION public.fn_ca_return_satellite_entitlement_as_ticket(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

DO $admission_preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)'::regprocedure))<>'aecdb2201062f680a6196b3d68f132ed' THEN RAISE EXCEPTION 'original_net_ticket_admission_preimage_changed';END IF;END $admission_preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_register_for_tournament_with_ticket_for(p_tournament_id uuid, p_ticket_id uuid, p_beneficiary_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid:=p_beneficiary_id;
  v_value_ticket boolean:=false;
  v_diamond_value boolean:=false;
  v_diamond_receipt jsonb;
  v_t public.tournaments%ROWTYPE;
  v_ticket public.tournament_tickets%ROWTYPE;
  v_split record;
  v_username text;
  v_registration_id uuid;
  v_ledger_id uuid;
  v_tx_id uuid;
  v_entitlement_id uuid;
  v_resolved_club uuid;
  v_is_bounty boolean;
  v_late_open boolean:=false;
  v_start_chips integer:=0;
  v_seat jsonb;
  v_seat_reason text;
  v_players_before integer;
  v_wallet_rows_before bigint;
  v_wallet_rows_after bigint;
  v_rows integer;
  v_key text;
  v_ticket_use_token uuid:=gen_random_uuid();
  v_previous_ticket_use_token text:=
    current_setting('app.ca_satellite_ticket_use_token',true);
  v_escrow_before public.tournament_escrow%ROWTYPE;
  v_escrow_after public.tournament_escrow%ROWTYPE;
BEGIN
  IF p_tournament_id IS NULL OR p_ticket_id IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'tournament, ticket and beneficiary ids are required'
      USING ERRCODE='22004';
  END IF;

  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  IF NOT pg_try_advisory_xact_lock_shared(530090,1) THEN
    RAISE EXCEPTION 'ticket_admission_platform_freeze_busy' USING ERRCODE='55P03';
  END IF;
  PERFORM public.fn_ca_lock_mtt_admission_contract();
  IF public.fn_entry_purchases_frozen() THEN
    RETURN jsonb_build_object('ok',false,'reason','platform_frozen');
  END IF;

  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF v_t.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;
  SELECT * INTO v_ticket FROM public.tournament_tickets tk
   WHERE tk.id=p_ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','ticket_not_found');
  END IF;
  IF v_ticket.holder_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok',false,'reason','ticket_not_owned');
  END IF;
  IF v_ticket.redemption_mode IS DISTINCT FROM 'tournament_entry_only' THEN
    RETURN jsonb_build_object('ok',false,'reason','ticket_is_wallet_only');
  END IF;

  v_value_ticket:=public.fn_ca_satellite_value_ticket_marked(v_ticket.id);
  IF v_value_ticket THEN
    v_diamond_value:=public.fn_ca_assert_satellite_value_ticket(v_ticket.id)='diamonds';
    IF public.fn_poker_diamond_tournament(p_tournament_id) IS DISTINCT FROM v_diamond_value THEN
      RETURN jsonb_build_object('ok',false,'reason','ticket_asset_mismatch');
    END IF;
  ELSE
  IF v_ticket.source_refund_entitlement_id IS NOT NULL THEN
    SELECT count(*) INTO v_rows
      FROM public.tournament_refund_entitlements source_e
      JOIN public.chip_ledger issue_l
        ON issue_l.idempotency_key='tourney:'
             ||source_e.tournament_id::text
             ||':satellite-ticket-return:'||source_e.id::text
       AND issue_l.from_type='prize_liability'
       AND issue_l.from_entity_id=source_e.tournament_id
       AND issue_l.to_type='escrow' AND issue_l.to_entity_id=v_ticket.id
       AND issue_l.club_id=v_ticket.club_id AND issue_l.amount=source_e.gross
       AND issue_l.category='ticket_issue'
      LEFT JOIN LATERAL(SELECT COALESCE(sum(r.amount),0) amount,COALESCE(sum(r.fee_amount),0) fee,COALESCE(sum(r.loss_amount+r.active_amount),0) capital
       FROM public.ca_promo_ticket_principal_fee_returns r WHERE r.entitlement_id=source_e.id AND r.ticket_id=v_ticket.id AND r.issue_ledger_id=issue_l.id) returned ON true
     WHERE source_e.id=v_ticket.source_refund_entitlement_id
       AND v_ticket.source_satellite_award_place IS NULL
       AND source_e.user_id=v_uid
       AND source_e.entitlement_kind IN ('satellite_seat','tournament_ticket')
       AND source_e.gross=v_ticket.value+returned.amount
       AND greatest(0,source_e.refund_prize-returned.capital)=v_ticket.entry_prize
       AND source_e.refund_bounty-greatest(0,returned.capital-source_e.refund_prize)=v_ticket.entry_bounty
       AND source_e.refund_fee-returned.fee=v_ticket.entry_fee
       AND source_e.source_satellite_id=v_ticket.source_satellite_id
       AND source_e.tournament_id=v_ticket.source_tournament_id
       AND NOT EXISTS(
         SELECT 1 FROM public.tournament_refund_tranches tr
          WHERE tr.entitlement_id=source_e.id)
       AND (SELECT count(*) FROM public.chip_transactions issue_tx
             WHERE issue_tx.transaction_type='tournament_ticket_issue'
               AND issue_tx.club_id=v_ticket.club_id
               AND issue_tx.from_user_id IS NULL AND issue_tx.to_user_id=v_uid
               AND issue_tx.amount=source_e.gross
               AND issue_tx.metadata->>'ticket_id'=v_ticket.id::text
               AND issue_tx.metadata->>'entitlement_id'=source_e.id::text
               AND issue_tx.metadata->>'ledger_id'=issue_l.id::text)=1;
  ELSE
    -- A cap-blocked satellite winner never held a target registration, so its
    -- noncash ticket is sourced directly by the immutable satellite award.
    SELECT count(*) INTO v_rows
      FROM public.tournament_satellite_awards source_a
      JOIN public.tournament_satellite_settlements source_h
        ON source_h.tournament_id=source_a.tournament_id
      JOIN public.tournament_payouts source_p ON source_p.id=source_a.payout_id
      JOIN public.chip_ledger issue_l
        ON issue_l.idempotency_key=source_a.idempotency_key||':ticket_escrow'
       AND issue_l.from_type='prize_liability'
       AND issue_l.from_entity_id=source_a.tournament_id
       AND issue_l.to_type='escrow' AND issue_l.to_entity_id=v_ticket.id
       AND issue_l.club_id=v_ticket.club_id AND issue_l.amount=v_ticket.value
       AND issue_l.category='ticket_issue'
       AND issue_l.tournament_id=source_a.tournament_id
       AND issue_l.metadata->>'kind'='direct_satellite_entry_ticket'
       AND issue_l.metadata->>'ticket_id'=v_ticket.id::text
       AND issue_l.metadata->>'payout_id'=source_a.payout_id::text
       AND issue_l.metadata->>'satellite_target_id'=
             v_ticket.source_tournament_id::text
       AND issue_l.metadata->>'user_id'=source_a.user_id::text
       AND COALESCE(issue_l.metadata->>'position',issue_l.metadata->>'award_slot')=source_a.place::text
     WHERE source_a.tournament_id=v_ticket.source_satellite_id
       AND source_a.place=v_ticket.source_satellite_award_place
       AND source_a.user_id=v_uid
       AND source_a.delivery_kind='ticket'
       AND source_a.ticket_id=v_ticket.id
       AND source_a.amount=v_ticket.value
       AND source_a.payout_source='satellite_ticket'
       AND source_p.tournament_id=source_a.tournament_id
       AND source_p.user_id=source_a.user_id
       AND (source_p."position"=source_a.place OR source_h.receipt_version>=3)
       AND source_p.amount=source_a.amount
       AND source_p.source=source_a.payout_source
       AND source_p.idempotency_key=source_a.idempotency_key
       AND source_h.target_id=v_ticket.source_tournament_id
       AND source_h.ticket_cost=v_ticket.value
       -- A bounty target's seat ticket carries its bounty slice: the
       -- target's buy-in is the ticket's prize plus bounty (2026-10-16).
       AND source_h.target_buy_in=round(v_ticket.entry_prize+v_ticket.entry_bounty,2)
       AND source_h.target_fee=v_ticket.entry_fee
       AND p_tournament_id=v_ticket.source_tournament_id
       AND NOT EXISTS(
         SELECT 1 FROM public.wallet_credit_idempotency wallet_key
          WHERE wallet_key.key=source_a.idempotency_key)
       AND (SELECT count(*) FROM public.chip_transactions issue_tx
             WHERE issue_tx.transaction_type='tournament_ticket_issue'
               AND issue_tx.club_id=v_ticket.club_id
               AND issue_tx.from_user_id IS NULL AND issue_tx.to_user_id=v_uid
               AND issue_tx.amount=v_ticket.value
               AND issue_tx.metadata->>'ticket_id'=v_ticket.id::text
               AND issue_tx.metadata->>'source_tournament_id'=
                     p_tournament_id::text
               AND issue_tx.metadata->>'source_satellite_id'=source_a.tournament_id::text
               AND issue_tx.metadata->>'source_award_place'=source_a.place::text
               AND issue_tx.metadata->>'payout_id'=source_a.payout_id::text
               AND issue_tx.metadata->>'ledger_id'=issue_l.id::text
               AND issue_tx.metadata->>'idempotency_key'=
                     source_a.idempotency_key)=1;
  END IF;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'tournament-entry ticket has no exact noncash issue evidence'
      USING ERRCODE='P0404';
  END IF;

  END IF;

  IF v_ticket.status='redeemed' THEN
    IF v_diamond_value THEN
      SELECT jsonb_build_object('ok',true,'replayed',true,'ticket_id',v_ticket.id,
        'registration_id',l.registration_id,'ledger_id',l.id,'asset','diamonds','wallet_chips_credited',0)
        INTO v_diamond_receipt FROM public.poker_diamond_tournament_ledger l
       WHERE l.idempotency_key='poker-value-ticket-entry:'||v_ticket.id::text
         AND l.tournament_id=p_tournament_id AND l.user_id=v_uid AND l.amount=v_ticket.value
         AND l.kind='entry' AND l.request->>'ticket_id'=v_ticket.id::text;
      RETURN coalesce(v_diamond_receipt,jsonb_build_object('ok',false,'reason','ticket_already_used'));
    END IF;
    SELECT count(*),min(e.id::text)::uuid,min(e.registration_id::text)::uuid
      INTO v_rows,v_entitlement_id,v_registration_id
      FROM public.tournament_refund_entitlements e
      JOIN public.tournament_players tp ON tp.id=e.registration_id
     WHERE e.source_ticket_id=v_ticket.id
       AND e.entitlement_kind='tournament_ticket'
       AND e.tournament_id=p_tournament_id
       AND e.user_id=v_uid
       AND tp.tournament_id=e.tournament_id AND tp.user_id=e.user_id;
    IF v_rows=1 AND v_entitlement_id IS NOT NULL
       AND v_registration_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok',true,'replayed',true,'ticket_id',v_ticket.id,
        'registration_id',v_registration_id,
        'entitlement_id',v_entitlement_id,'wallet_chips_credited',0);
    END IF;
    RETURN jsonb_build_object('ok',false,'reason','ticket_already_used');
  END IF;
  IF v_ticket.status<>'issued' THEN
    RETURN jsonb_build_object('ok',false,'reason','ticket_not_available');
  END IF;

  IF NOT public.fn_ca_tournament_is_unlimited(p_tournament_id)
     AND (lower(COALESCE(v_t.variant,''))='spin'
       OR (v_t.max_players IS NOT NULL
         AND v_t.max_players>0 AND v_t.max_players<=2)) THEN
    RETURN jsonb_build_object('ok',false,'reason','seat_first_variant');
  END IF;
  IF v_t.status='RUNNING' THEN
    v_late_open:=public.fn_tournament_late_registration_open(p_tournament_id)
                 AND NOT COALESCE(v_t.prize_pool_finalized,false);
  END IF;
  IF v_t.status NOT IN ('ANNOUNCED','REGISTERING') AND NOT v_late_open THEN
    RETURN jsonb_build_object('ok',false,'reason','registration_closed');
  END IF;
  IF COALESCE(v_t.prize_pool_finalized,false) THEN
    RETURN jsonb_build_object('ok',false,'reason','target_pool_finalized');
  END IF;
  IF public.fn_tournament_entry_cap_reached(p_tournament_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_full');
  END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_players tp
             WHERE tp.tournament_id=p_tournament_id AND tp.user_id=v_uid) THEN
    RETURN jsonb_build_object('ok',false,'reason','already_registered');
  END IF;

  IF NOT v_diamond_value AND NOT EXISTS(
    SELECT 1 FROM public.club_members m
     WHERE m.club_id=v_ticket.club_id AND m.user_id=v_uid
       AND COALESCE(m.status,'active') IN ('active','approved')) THEN
    RETURN jsonb_build_object('ok',false,'reason','ticket_club_membership_inactive');
  END IF;
  IF v_t.union_id IS NULL AND v_t.club_id IS NOT NULL
     AND v_ticket.club_id IS DISTINCT FROM v_t.club_id THEN
    RETURN jsonb_build_object('ok',false,'reason','ticket_club_mismatch');
  END IF;
  IF v_t.union_id IS NOT NULL
     AND v_ticket.club_id IS DISTINCT FROM v_t.club_id AND NOT EXISTS(
    SELECT 1 FROM public.union_clubs uc
     WHERE uc.union_id=v_t.union_id AND uc.club_id=v_ticket.club_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','ticket_union_mismatch');
  END IF;
  IF v_diamond_value THEN
    IF NOT public.fn_ca_entry_scope_ok(v_uid,v_ticket.club_id) THEN
      RETURN jsonb_build_object('ok',false,'reason','ticket_arena_profile_unavailable');
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.ca_arena_settings a WHERE a.id=1 AND a.club_id=v_ticket.club_id AND a.tournaments_enabled) THEN
      RETURN jsonb_build_object('ok',false,'reason','diamond_tournaments_closed');
    END IF;
    v_resolved_club:=v_ticket.club_id;
  ELSE
    v_resolved_club:=public.fn_tournament_club_for_user(v_uid,p_tournament_id,v_ticket.club_id);
  END IF;
  IF v_resolved_club IS DISTINCT FROM v_ticket.club_id THEN
    RETURN jsonb_build_object('ok',false,'reason','ticket_source_club_unavailable');
  END IF;

  IF COALESCE(v_t.authorized_to_register,false)
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_registration_approvals a
        WHERE a.tournament_id=p_tournament_id AND a.user_id=v_uid)
     AND NOT public.is_club_admin(v_ticket.club_id,v_uid) THEN
    RETURN jsonb_build_object('ok',false,'reason','not_authorized_to_register');
  END IF;
  IF COALESCE(v_t.is_vip_only,false)
     AND NOT EXISTS(
       SELECT 1 FROM public.profiles pr
        WHERE pr.id=v_uid AND COALESCE(pr.is_vip,false)
          AND (pr.vip_expires_at IS NULL OR pr.vip_expires_at>now()))
     AND NOT EXISTS(
       SELECT 1 FROM public.club_members m
        WHERE m.club_id=v_ticket.club_id AND m.user_id=v_uid
          AND m.role IN ('owner','co_owner','admin','agent')) THEN
    RETURN jsonb_build_object('ok',false,'reason','vip_only');
  END IF;

  v_is_bounty:=COALESCE(v_t.is_bounty,false)
            OR COALESCE(v_t.is_pko,false)
            OR COALESCE(v_t.is_mystery_bounty,false);
  SELECT * INTO v_split FROM public.fn_tournament_entry_split(
    v_t.buy_in_amount,v_t.buy_in_fee,v_t.bounty_amount,v_is_bounty);
  IF v_split.charge IS NULL OR v_split.prize IS NULL
     OR v_split.bounty IS NULL OR v_split.rake IS NULL
     OR v_split.charge::text IN ('NaN','Infinity','-Infinity')
     OR v_split.prize::text IN ('NaN','Infinity','-Infinity')
     OR v_split.bounty::text IN ('NaN','Infinity','-Infinity')
     OR v_split.rake::text IN ('NaN','Infinity','-Infinity')
     OR v_split.charge<=0 OR v_split.prize<0
     OR v_split.bounty<0 OR v_split.rake<0
     OR v_split.charge IS DISTINCT FROM
          round(v_split.prize+v_split.bounty+v_split.rake,2)
     OR v_ticket.value IS DISTINCT FROM v_split.charge
     OR (NOT v_value_ticket AND (v_ticket.entry_prize IS DISTINCT FROM v_split.prize
       OR v_ticket.entry_bounty IS DISTINCT FROM v_split.bounty
       OR v_ticket.entry_fee IS DISTINCT FROM v_split.rake)) THEN
    RETURN jsonb_build_object('ok',false,'reason','ticket_entry_contract_mismatch');
  END IF;

  IF COALESCE(v_t.early_bird_enabled,false)
     AND now()<v_t.start_time AND COALESCE(v_t.early_bird_chips,0)>0 THEN
    v_start_chips:=v_t.early_bird_chips;
  END IF;
  SELECT COALESCE(NULLIF(p.display_name,''),NULLIF(p.username,''),'Player')
    INTO v_username FROM public.profiles p WHERE p.id=v_uid;
  v_username:=COALESCE(v_username,'Player');

  IF v_diamond_value THEN
    INSERT INTO public.tournament_players(tournament_id,user_id,username,chips,status,current_bounty,
      mystery_bounty_value,bounties_collected,bounty_winnings,club_id,is_satellite_qualifier,source_satellite_id)
    VALUES(p_tournament_id,v_uid,v_username,v_start_chips,'registered',0,0,0,0,v_ticket.club_id,true,v_ticket.source_satellite_id)
    RETURNING id INTO v_registration_id;
    v_diamond_receipt:=public.fn_ca_diamond_value_ticket_fund_entry(p_tournament_id,v_ticket.id,v_registration_id);
  ELSE
  PERFORM public.fn_ca_escrow_apply(p_tournament_id,'ticket admission prelock');
  SELECT * INTO v_escrow_before FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id FOR UPDATE;
  SELECT count(*) INTO v_players_before FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
     AND tp.status::text IN ('registered','playing');
  SELECT count(*) INTO v_wallet_rows_before
    FROM public.wallet_transactions w
   WHERE w.related_entity_id=p_tournament_id AND w.user_id=v_uid;
  IF v_escrow_before.tournament_id IS NULL
     OR v_escrow_before.enforced IS DISTINCT FROM true
     OR v_t.current_players IS DISTINCT FROM v_players_before
     OR v_t.prize_pool IS DISTINCT FROM v_escrow_before.prize_balance
     -- A running bounty event's bank is its pool less what knockouts have
     -- already paid from it, so a late ticket seat compares against that
     -- (2026-10-16), as both settlement authorities do.
     OR v_escrow_before.bounty_balance IS DISTINCT FROM
          round(COALESCE(v_t.bounty_pool,0)-COALESCE(v_t.bounty_pool_paid,0),2)
     OR v_t.total_rake IS DISTINCT FROM v_escrow_before.fee_balance THEN
    RAISE EXCEPTION 'ticket admission found divergent tournament escrow'
      USING ERRCODE='P0404';
  END IF;

  INSERT INTO public.tournament_players(
    tournament_id,user_id,username,chips,status,current_bounty,
    mystery_bounty_value,bounties_collected,bounty_winnings,
    club_id,is_satellite_qualifier,source_satellite_id)
  VALUES(
    p_tournament_id,v_uid,v_username,v_start_chips,'registered',
    v_split.bounty,0,0,0,v_ticket.club_id,true,v_ticket.source_satellite_id)
  RETURNING id INTO v_registration_id;

  v_key:='ticket:'||v_ticket.id::text||':tournament:'
         ||p_tournament_id::text||':entry';
  INSERT INTO public.chip_ledger(
    performed_by,from_type,from_entity_id,from_label,
    to_type,to_entity_id,to_label,amount,category,club_id,tournament_id,
    idempotency_key,settlement_id,actor_service,description,metadata,
    pre_from_balance,post_from_balance,pre_to_balance,post_to_balance)
  VALUES(
    v_uid,'escrow',v_ticket.id,'tournament entry ticket',
    'prize_liability',p_tournament_id,'tournaments escrow',
    v_ticket.value,'ticket_redeem',v_ticket.club_id,p_tournament_id,
    v_key,'ticket-entry:'||v_ticket.id::text,
    'fn_register_for_tournament_with_ticket',
    'Tournament-entry ticket committed to tournament admission',
    jsonb_build_object(
      'kind','tournament_entry_ticket_admission','ticket_id',v_ticket.id,
      'user_id',v_uid,'registration_id',v_registration_id,
      'source_tournament_id',v_ticket.source_tournament_id,
      'source_satellite_id',v_ticket.source_satellite_id,
      'entry_prize',v_split.prize,
      'entry_bounty',v_split.bounty,'entry_fee',v_split.rake),
    v_ticket.value,0,
    round(v_escrow_before.prize_balance+v_escrow_before.bounty_balance
          +v_escrow_before.fee_balance,2),
    round(v_escrow_before.prize_balance+v_escrow_before.bounty_balance
          +v_escrow_before.fee_balance+v_ticket.value,2))
  RETURNING id INTO v_ledger_id;

  PERFORM public.fn_ca_escrow_apply(
    p_tournament_id,'tournament-entry ticket admission',
    p_gross_in=>v_ticket.value,p_bounty_in=>v_split.bounty);
  IF v_split.rake>0 THEN
    INSERT INTO public.rake_records(
      hand_id,table_id,club_id,rake_amount,pot_size,num_players,
      bbj_contribution,is_tournament,tournament_id,source,metadata)
    VALUES(
      NULL,NULL,v_ticket.club_id,v_split.rake,v_ticket.value,1,
      0,true,p_tournament_id,'fn_register_for_tournament_with_ticket',
      jsonb_build_object(
        'kind','tournament_ticket_entry_fee','user_id',v_uid,
        'registration_id',v_registration_id,'ticket_id',v_ticket.id));
  END IF;

  UPDATE public.tournaments
     SET current_players=v_players_before+1,
         prize_pool=round(v_t.prize_pool+v_split.prize,2),
         bounty_pool=round(v_t.bounty_pool+v_split.bounty,2),
         total_rake=round(v_t.total_rake+v_split.rake,2),
         updated_at=now()
   WHERE id=p_tournament_id
     -- Before the start the canonical roster trigger has already counted
     -- the row inserted above. A RUNNING field is not counted on INSERT
     -- (20260922141704): this door publishes that count itself, as the
     -- wallet doors do. Expect exactly the state the trigger left.
     AND current_players IS NOT DISTINCT FROM CASE
       WHEN v_t.status IN ('ANNOUNCED','REGISTERING') THEN v_players_before+1
       ELSE v_players_before
     END
     AND prize_pool IS NOT DISTINCT FROM v_t.prize_pool
     AND bounty_pool IS NOT DISTINCT FROM v_t.bounty_pool
     AND total_rake IS NOT DISTINCT FROM v_t.total_rake;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'ticket admission tournament cache changed'
      USING ERRCODE='55000';
  END IF;

  END IF;

  INSERT INTO public.tournament_ticket_admission_authorizations(
    token,ticket_id,tournament_id,user_id,registration_id)
  VALUES(
    v_ticket_use_token,v_ticket.id,p_tournament_id,v_uid,v_registration_id);

  PERFORM set_config(
    'app.ca_satellite_ticket_use_token',v_ticket_use_token::text,true);
  UPDATE public.tournament_tickets
     SET status='redeemed',redeemed_at=transaction_timestamp()
   WHERE id=v_ticket.id AND status='issued';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  PERFORM set_config(
    'app.ca_satellite_ticket_use_token',
    COALESCE(v_previous_ticket_use_token,''),true);
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'tournament-entry ticket changed during admission'
      USING ERRCODE='55000';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.tournament_ticket_admission_authorizations a
     WHERE a.token=v_ticket_use_token) THEN
    RAISE EXCEPTION
      'tournament-entry ticket authorization was not consumed by admission'
      USING ERRCODE='P0404';
  END IF;

  IF NOT v_diamond_value THEN
  INSERT INTO public.tournament_refund_entitlements(
    tournament_id,user_id,entitlement_kind,charge_category,
    refund_wallet_club_id,gross,refund_prize,refund_bounty,refund_fee,
    source_ledger_id,registration_id,source_satellite_id,source_award_place,
    source_ticket_id,escrow_bucket,evidence_kind,created_at)
  VALUES(
    p_tournament_id,v_uid,'tournament_ticket','tournament_ticket',
    v_ticket.club_id,v_ticket.value,v_split.prize,
    v_split.bounty,v_split.rake,v_ledger_id,
    v_registration_id,v_ticket.source_satellite_id,NULL,v_ticket.id,
    'ticket_gross','atomic_tournament_ticket',transaction_timestamp())
  RETURNING id INTO v_entitlement_id;

  INSERT INTO public.chip_transactions(
    club_id,from_user_id,to_user_id,amount,transaction_type,notes,
    balance_after,metadata)
  VALUES(
    v_ticket.club_id,v_uid,NULL,v_ticket.value,
    'tournament_ticket_entry','Tournament-Entry Ticket Used',NULL,
    jsonb_build_object(
      'ticket_id',v_ticket.id,'holder_id',v_uid,
      'target_tournament_id',p_tournament_id,
      'registration_id',v_registration_id,
      'entitlement_id',v_entitlement_id,'ledger_id',v_ledger_id,
      'idempotency_key',v_key,'wallet_chips_credited',0))
  RETURNING id INTO v_tx_id;

  END IF;

  IF v_late_open THEN
    BEGIN
      v_seat:=public.fn_seat_late_registrant(p_tournament_id,v_uid);
    EXCEPTION WHEN SQLSTATE '55000' THEN
      PERFORM public.fn_ensure_late_registration_capacity(p_tournament_id,0);
      v_seat:=public.fn_seat_late_registrant(p_tournament_id,v_uid);
    END;
    v_seat_reason:=v_seat->>'reason';
    IF NOT COALESCE((v_seat->>'ok')::boolean,false)
       AND COALESCE(v_seat_reason,'')<>'already_seated_or_missing' THEN
      PERFORM public.fn_ensure_late_registration_capacity(p_tournament_id,0);
      v_seat:=public.fn_seat_late_registrant(p_tournament_id,v_uid);
      v_seat_reason:=v_seat->>'reason';
      IF NOT COALESCE((v_seat->>'ok')::boolean,false)
         AND COALESCE(v_seat_reason,'')<>'already_seated_or_missing' THEN
        RAISE EXCEPTION
          'Late ticket admission could not seat the player (%)',
          COALESCE(v_seat_reason,'unknown') USING ERRCODE='55000';
      END IF;
    END IF;
    -- The wake reasons are a closed list (fn_emit_tournament_manager_wake
    -- and tournament_manager_wakes_reason_check); the engine acts on
    -- 'late_registration'. A reason outside it rolled back every late
    -- ticket entry (20261012).
    PERFORM public.fn_emit_tournament_manager_wake(
      p_tournament_id,'late_registration');
  END IF;

  IF NOT v_diamond_value THEN
  SELECT * INTO v_escrow_after FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id;
  SELECT count(*) INTO v_wallet_rows_after
    FROM public.wallet_transactions w
   WHERE w.related_entity_id=p_tournament_id AND w.user_id=v_uid;
  IF v_escrow_after.prize_balance IS DISTINCT FROM
       round(v_escrow_before.prize_balance+v_split.prize,2)
     OR v_escrow_after.bounty_balance IS DISTINCT FROM
       round(v_escrow_before.bounty_balance+v_split.bounty,2)
     OR v_escrow_after.fee_balance IS DISTINCT FROM
       round(v_escrow_before.fee_balance+v_split.rake,2)
     OR v_wallet_rows_after IS DISTINCT FROM v_wallet_rows_before THEN
    RAISE EXCEPTION 'ticket admission did not preserve exact noncash rails'
      USING ERRCODE='P0404';
  END IF;

  END IF;
  IF v_value_ticket THEN PERFORM public.fn_ca_assert_satellite_value_ticket(v_ticket.id); END IF;

  RETURN jsonb_build_object(
    'ok',true,'replayed',false,'ticket_id',v_ticket.id,
    'registration_id',v_registration_id,'entitlement_id',v_entitlement_id,
    'ledger_id',v_ledger_id,'transaction_id',v_tx_id,
    'ticket_value',v_ticket.value,'wallet_chips_credited',0,
    'prize_contribution',v_split.prize,
    'bounty_contribution',v_split.bounty,
    'fee_contribution',v_split.rake,'late_registration',v_late_open,
    'seat',v_seat)||CASE WHEN v_diamond_value THEN v_diamond_receipt ELSE '{}'::jsonb END;
END;
$function$
;


-- Internal beneficiary admission keeps its captured postgres-only EXECUTE ACL.
REVOKE ALL ON FUNCTION public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $net_ticket_admission_pin$
DECLARE def text;needle text;replacement text;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure) INTO def;
 needle:='"signature":"public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)","definition_md5":"8a9b893eeb07cbcf518782391e757c2c"';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_net_ticket_admission_pin_changed';END IF;
 replacement:='"signature":"public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)","definition_md5":"'||md5(pg_get_functiondef('public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)'::regprocedure))||'"';
 EXECUTE replace(def,needle,replacement);
END $net_ticket_admission_pin$;

COMMIT;
