-- @install-window: daily-maintenance
-- @locks: public.chip_ledger, public.tournament_tickets, public.tournaments, smarter_private.free_buy_ticket_redemptions
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_tickets'::regclass AND tgname='ca_promo_ticket_principal' AND tgenabled='O')
-- Promo tickets retain one original grant, target and clock. Ticket and entry
-- entitlements never reserve unrelated wallet cash. Original money doors keep
-- their credits, refunds, immutable entitlements and idempotency identities.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF to_regprocedure('public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text)') IS NULL THEN
  RAISE EXCEPTION 'promo principal custody must be installed first';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NULL) OR EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants) THEN RAISE EXCEPTION 'promo ticket custody must install before programme activation'; END IF;
END $$;

CREATE TABLE public.ca_promo_ticket_entry_bridges (
 redemption_id uuid PRIMARY KEY,ticket_id uuid NOT NULL UNIQUE,tournament_id uuid NOT NULL,
 club_id uuid NOT NULL,user_id uuid NOT NULL,value numeric NOT NULL CHECK(value>0),
 promo_amount numeric NOT NULL CHECK(promo_amount>=0 AND promo_amount<=value),
 charge_ledger_id uuid UNIQUE,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.ca_promo_event_principal_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),
 tournament_id uuid NOT NULL,charge_ledger_id uuid,source_ref text NOT NULL,
 original_amount numeric NOT NULL CHECK(original_amount>0),
 remaining numeric NOT NULL CHECK(remaining>=0 AND remaining<=original_amount),
 UNIQUE(grant_id,source_ref)
);
CREATE INDEX ca_promo_event_principal_lots_event ON public.ca_promo_event_principal_lots(tournament_id,grant_id) WHERE remaining>0;
CREATE INDEX ca_promo_event_principal_lots_charge ON public.ca_promo_event_principal_lots(charge_ledger_id) WHERE remaining>0;
CREATE TABLE public.ca_promo_event_realization_receipts (
 ledger_id uuid PRIMARY KEY,tournament_id uuid NOT NULL,club_id uuid NOT NULL,user_id uuid NOT NULL,
 amount numeric NOT NULL CHECK(amount>0),principal numeric NOT NULL CHECK(principal>=0 AND principal<=amount)
);
CREATE TABLE public.ca_promo_event_realization_slices (
 ledger_id uuid NOT NULL REFERENCES public.ca_promo_event_realization_receipts(ledger_id),
 grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),
 amount numeric NOT NULL CHECK(amount>0),PRIMARY KEY(ledger_id,grant_id)
);
ALTER TABLE public.ca_promo_ticket_entry_bridges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_event_principal_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_event_realization_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_event_realization_slices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_ticket_entry_bridges,public.ca_promo_event_principal_lots,
 public.ca_promo_event_realization_receipts,public.ca_promo_event_realization_slices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_ticket_entry_bridges,public.ca_promo_event_principal_lots,
 public.ca_promo_event_realization_receipts,public.ca_promo_event_realization_slices TO service_role;

-- Owner-only. The cashier ticket owner invokes this after its canonical
-- redemption receipt, inside the same rollback scope as ordinary registration.
CREATE FUNCTION public.fn_ca_promo_prepare_ticket_entry(p_ticket uuid,p_target uuid,p_user uuid,p_redemption uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE t public.tournament_tickets%ROWTYPE;r public.chip_transactions%ROWTYPE;
 amount_held numeric;g record;held numeric;prior public.ca_promo_ticket_entry_bridges%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN; END IF;
 SELECT * INTO t FROM public.tournament_tickets WHERE id=p_ticket FOR UPDATE;
 SELECT * INTO r FROM public.chip_transactions WHERE id=p_redemption;
 IF t.id IS NULL OR t.holder_id IS DISTINCT FROM p_user OR t.status IS DISTINCT FROM 'redeemed'
  OR r.transaction_type IS DISTINCT FROM 'tournament_ticket_redeem' OR r.club_id IS DISTINCT FROM t.club_id
  OR r.to_user_id IS DISTINCT FROM p_user OR r.amount IS DISTINCT FROM t.value
  OR r.metadata->>'ticket_id' IS DISTINCT FROM t.id::text
  OR r.metadata->>'reason' IS DISTINCT FROM 'tournament_entry'
  OR r.metadata->>'target_tournament_id' IS DISTINCT FROM p_target::text
  OR EXISTS(SELECT 1 FROM public.tournament_ticket_entry_targets b WHERE b.ticket_id=t.id AND (b.tournament_id IS DISTINCT FROM p_target OR b.holder_id IS DISTINCT FROM p_user OR b.value IS DISTINCT FROM t.value))
  OR NOT EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.from_type='escrow' AND l.from_entity_id=t.id
   AND l.to_type='player_wallet' AND l.to_entity_id=p_user AND l.club_id=t.club_id
   AND l.amount=t.value AND l.category='ticket_redeem' AND COALESCE(l.status,'posted')='posted'
   AND pg_xact_status(l.xmin::text::xid8)='in progress') THEN
  RAISE EXCEPTION 'promo_ticket_entry_original_credit_not_proven' USING ERRCODE='23514';
 END IF;
 SELECT * INTO prior FROM public.ca_promo_ticket_entry_bridges WHERE redemption_id=r.id;
 IF FOUND THEN
  IF prior.ticket_id IS DISTINCT FROM t.id OR prior.tournament_id IS DISTINCT FROM p_target
   OR prior.user_id IS DISTINCT FROM p_user OR prior.value IS DISTINCT FROM t.value THEN
   RAISE EXCEPTION 'promo_ticket_entry_identity_conflict'; END IF;
 ELSE
  PERFORM public.fn_ca_promo_play_through_settle(t.club_id,p_user);
  SELECT COALESCE(sum(c.amount),0) INTO amount_held FROM public.ca_promo_principal_custody c
   JOIN public.ca_promo_play_through_grants gr ON gr.id=c.grant_id
   WHERE c.kind='ticket' AND c.entity_id=t.id AND gr.club_id=t.club_id AND gr.user_id=p_user AND gr.closed_at IS NULL;
  IF amount_held>t.value THEN RAISE EXCEPTION 'promo_ticket_principal_exceeds_entitlement'; END IF;
  INSERT INTO public.ca_promo_ticket_entry_bridges(redemption_id,ticket_id,tournament_id,club_id,user_id,value,promo_amount)
   VALUES(r.id,t.id,p_target,t.club_id,p_user,t.value,amount_held);
  FOR g IN SELECT c.grant_id,c.amount FROM public.ca_promo_principal_custody c
   JOIN public.ca_promo_play_through_grants gr ON gr.id=c.grant_id
   WHERE c.kind='ticket' AND c.entity_id=t.id AND c.amount>0 AND gr.closed_at IS NULL
    AND gr.club_id=t.club_id AND gr.user_id=p_user ORDER BY gr.granted_at,gr.id FOR UPDATE OF gr,c LOOP
   INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,source_ref,original_amount,remaining)
    VALUES(g.grant_id,p_target,'ticket_redeem:'||r.id,g.amount,g.amount);
  END LOOP;
  held:=public.fn_ca_promo_move_custody(t.club_id,p_user,'ticket',t.id,'event',p_target,amount_held);
  IF held IS DISTINCT FROM amount_held THEN RAISE EXCEPTION 'promo_ticket_entry_custody_changed'; END IF;
 END IF;
 PERFORM set_config('app.ca_promo_ticket_entry',jsonb_build_object('redemption_id',r.id,'ticket_id',t.id,
  'tournament_id',p_target,'holder_id',p_user,'club_id',t.club_id,'value',t.value)::text,true);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_prepare_ticket_entry(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- A GUC is not proof. Bind the original receipt/credit to exactly one actual
-- charge. A nonpromo ticket still covers its entry and cannot consume older,
-- unrelated promo in the player's ordinary wallet.
CREATE FUNCTION public.fn_ca_promo_ticket_entry_funding(p_charge_ledger_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE context jsonb;l public.chip_ledger%ROWTYPE;b public.ca_promo_ticket_entry_bridges%ROWTYPE;r public.chip_transactions%ROWTYPE;
BEGIN
 IF COALESCE(current_setting('app.ca_promo_ticket_entry',true),'')='' THEN
  RETURN jsonb_build_object('covered_amount',0,'promo_amount',0); END IF;
 BEGIN context:=current_setting('app.ca_promo_ticket_entry',true)::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_promo_ticket_entry_context'; END;
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_charge_ledger_id;
 SELECT * INTO b FROM public.ca_promo_ticket_entry_bridges WHERE redemption_id=(context->>'redemption_id')::uuid FOR UPDATE;
 SELECT * INTO r FROM public.chip_transactions WHERE id=b.redemption_id;
 IF b.redemption_id IS NULL OR l.id IS NULL OR l.from_type IS DISTINCT FROM 'player_wallet'
  OR l.to_type IS DISTINCT FROM 'prize_liability' OR l.category IS DISTINCT FROM 'tournament_buyin'
  OR l.from_entity_id IS DISTINCT FROM b.user_id OR l.to_entity_id IS DISTINCT FROM b.tournament_id
  OR l.club_id IS DISTINCT FROM b.club_id OR l.amount IS DISTINCT FROM b.value
  OR context->>'ticket_id' IS DISTINCT FROM b.ticket_id::text OR context->>'holder_id' IS DISTINCT FROM b.user_id::text
  OR context->>'tournament_id' IS DISTINCT FROM b.tournament_id::text OR context->>'club_id' IS DISTINCT FROM b.club_id::text
  OR (context->>'value')::numeric IS DISTINCT FROM b.value
  OR r.transaction_type IS DISTINCT FROM 'tournament_ticket_redeem' OR r.to_user_id IS DISTINCT FROM b.user_id
  OR r.metadata->>'ticket_id' IS DISTINCT FROM b.ticket_id::text
  OR r.metadata->>'target_tournament_id' IS DISTINCT FROM b.tournament_id::text
  OR r.metadata->>'reason' IS DISTINCT FROM 'tournament_entry'
  OR NOT EXISTS(SELECT 1 FROM public.chip_transactions ct WHERE ct.id=r.id AND pg_xact_status(ct.xmin::text::xid8)='in progress')
  OR COALESCE(l.status,'posted')<>'posted' THEN RAISE EXCEPTION 'promo_ticket_entry_charge_not_proven'; END IF;
 IF b.charge_ledger_id IS NOT NULL AND b.charge_ledger_id IS DISTINCT FROM l.id THEN
  RAISE EXCEPTION 'promo_ticket_entry_has_another_charge'; END IF;
 UPDATE public.ca_promo_ticket_entry_bridges SET charge_ledger_id=l.id WHERE redemption_id=b.redemption_id AND charge_ledger_id IS NULL;
 RETURN jsonb_build_object('covered_amount',b.value,'promo_amount',b.promo_amount,'ticket_id',b.ticket_id,'redemption_id',b.redemption_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_ticket_entry_funding(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Invoked immediately after the original charge's custody movement. The exact
-- per-grant delta, not a second funding allocator, creates that entry's lots.
CREATE FUNCTION public.fn_ca_promo_record_event_charge(p_ledger_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;r record;extra numeric;total_extra numeric:=0;uid uuid;
BEGIN
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_ledger_id;
 IF l.id IS NULL OR l.from_type NOT IN('player_wallet','agent_wallet','escrow','prize_liability') OR l.to_type<>'prize_liability'
  OR l.category NOT IN('tournament_buyin','tournament_rebuy','rebuy','reentry','addon','ticket_redeem') OR l.amount<=0 OR COALESCE(l.status,'posted')<>'posted' THEN
  RAISE EXCEPTION 'invalid_promo_event_charge'; END IF;
 uid:=CASE WHEN l.from_type IN('player_wallet','agent_wallet') THEN l.from_entity_id ELSE (l.metadata->>'user_id')::uuid END;
 IF uid IS NULL THEN RAISE EXCEPTION 'promo_event_charge_has_no_original_player'; END IF;
 UPDATE public.ca_promo_event_principal_lots lot SET charge_ledger_id=l.id
  FROM public.ca_promo_ticket_entry_bridges b WHERE b.charge_ledger_id=l.id
   AND lot.source_ref='ticket_redeem:'||b.redemption_id AND lot.charge_ledger_id IS NULL;
 FOR r IN SELECT c.grant_id,c.amount,g.granted_at FROM public.ca_promo_principal_custody c
  JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE c.kind='event' AND c.entity_id=l.to_entity_id AND c.amount>0 AND g.closed_at IS NULL
   AND g.club_id=l.club_id AND g.user_id=uid ORDER BY g.granted_at,g.id FOR UPDATE OF g,c LOOP
  SELECT r.amount-COALESCE(sum(lot.remaining),0) INTO extra FROM public.ca_promo_event_principal_lots lot
   WHERE lot.grant_id=r.grant_id AND lot.tournament_id=l.to_entity_id;
  IF extra<0 THEN RAISE EXCEPTION 'promo_event_lots_exceed_principal'; END IF;
  IF extra>0 THEN
   INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining)
    VALUES(r.grant_id,l.to_entity_id,l.id,'charge:'||l.id,extra,extra);
   total_extra:=total_extra+extra;
  END IF;
 END LOOP;
 IF total_extra>l.amount THEN RAISE EXCEPTION 'promo_event_charge_principal_exceeds_charge'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_record_event_charge(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_realize_event_principal(p_ledger_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;
 lot record;left_to_realize numeric;take numeric;realized numeric:=0;refund_id text;n integer;
BEGIN
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_ledger_id;
 IF l.id IS NULL OR l.from_type<>'prize_liability' OR l.to_type<>'player_wallet'
  OR l.amount<=0 OR COALESCE(l.status,'posted')<>'posted' THEN RAISE EXCEPTION 'invalid_promo_event_realization'; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id) THEN
  RETURN (SELECT principal FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id); END IF;
 PERFORM public.fn_ca_promo_play_through_settle(l.club_id,l.to_entity_id);
 IF l.category IN('refund','tournament_refund') THEN
  refund_id:=current_setting('app.ca_promo_refund_entitlement',true);
  IF COALESCE(refund_id,'')='' THEN
   -- A non-entry refund cannot take principal from another entry.
   INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,l.from_entity_id,l.club_id,l.to_entity_id,l.amount,0);
   RETURN 0;
  END IF;
  SELECT * INTO e FROM public.tournament_refund_entitlements WHERE id=refund_id::uuid;
  IF e.id IS NULL OR e.tournament_id IS DISTINCT FROM l.from_entity_id OR e.user_id IS DISTINCT FROM l.to_entity_id
   OR e.refund_wallet_club_id IS DISTINCT FROM l.club_id OR e.gross IS DISTINCT FROM l.amount THEN
   RAISE EXCEPTION 'promo_refund_entitlement_does_not_match_credit'; END IF;
 END IF;
 INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,l.from_entity_id,l.club_id,l.to_entity_id,l.amount,0);
 left_to_realize:=l.amount;
 FOR lot IN SELECT x.id,x.grant_id,x.remaining,g.granted_at FROM public.ca_promo_event_principal_lots x
  JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.tournament_id=l.from_entity_id AND x.remaining>0 AND g.closed_at IS NULL
   AND g.club_id=l.club_id AND g.user_id=l.to_entity_id
   AND (e.id IS NULL OR x.charge_ledger_id=e.source_ledger_id)
  ORDER BY g.granted_at,g.id,x.source_ref,x.id FOR UPDATE OF g,x LOOP
  EXIT WHEN left_to_realize<=0;
  take:=LEAST(lot.remaining,left_to_realize);
  UPDATE public.ca_promo_principal_custody SET amount=amount-take
   WHERE grant_id=lot.grant_id AND kind='event' AND entity_id=l.from_entity_id AND amount>=take;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'promo_event_lot_has_no_matching_principal'; END IF;
  INSERT INTO public.ca_promo_principal_custody VALUES(lot.grant_id,'player_wallet',l.to_entity_id,take)
   ON CONFLICT(grant_id,kind,entity_id) DO UPDATE SET amount=ca_promo_principal_custody.amount+EXCLUDED.amount;
  UPDATE public.ca_promo_event_principal_lots SET remaining=remaining-take WHERE id=lot.id;
  INSERT INTO public.ca_promo_event_realization_slices VALUES(l.id,lot.grant_id,take)
   ON CONFLICT(ledger_id,grant_id) DO UPDATE SET amount=ca_promo_event_realization_slices.amount+EXCLUDED.amount;
  realized:=realized+take;left_to_realize:=left_to_realize-take;
 END LOOP;
 UPDATE public.ca_promo_event_realization_receipts SET principal=realized WHERE ledger_id=l.id;
 -- Expired winnings remain original locked principal here. The product's
 -- wallet expiry owner returns them using fund-before-member lock order;
 -- this ledger trigger already runs under the original prize wallet lock.
 RETURN realized;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_realize_event_principal(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Runs inside the original verified refund transaction, after the full exact
-- refund credit/tranche is recorded. This is the product's return-to-promo
-- leg, through the same permanent return owner as expiry and club departure.
CREATE FUNCTION public.fn_ca_promo_return_refunded_principal(p_credit_ledger_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;r record;paid numeric;total numeric:=0;
BEGIN
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_credit_ledger_id;
 IF l.id IS NULL OR l.category NOT IN('refund','tournament_refund') OR l.to_type<>'player_wallet'
  OR l.from_type<>'prize_liability' THEN RAISE EXCEPTION 'invalid_promo_refund_return'; END IF;
 FOR r IN SELECT s.grant_id,s.amount,g.granted_at FROM public.ca_promo_event_realization_slices s
  JOIN public.ca_promo_play_through_grants g ON g.id=s.grant_id
  WHERE s.ledger_id=l.id AND g.closed_at IS NULL ORDER BY g.granted_at,g.id LOOP
  paid:=public.fn_ca_promo_return_principal(r.grant_id,'player_wallet','returned',r.amount,'event_refund:'||l.id||':'||r.grant_id);
  total:=total+paid;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_return_refunded_principal(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_clear_closed_event_lots() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF NEW.closed_at IS NOT NULL THEN
  UPDATE public.ca_promo_event_principal_lots SET remaining=0 WHERE grant_id=NEW.id AND remaining>0;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_clear_closed_event_lots() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_clear_closed_event_lots AFTER UPDATE OF closed_at ON public.ca_promo_play_through_grants
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_clear_closed_event_lots();

CREATE FUNCTION public.fn_ca_promo_ticket_principal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;gid uuid;r record;returned numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN
  -- The original ticket owner has posted its escrow leg before this row.
  -- A gifted ticket cannot launder locked principal into another person.
  IF EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
    WHERE c.kind='ticket' AND c.entity_id=NEW.id AND c.amount>0 AND g.closed_at IS NULL AND g.user_id<>NEW.holder_id) THEN
   RAISE EXCEPTION 'Promo Play Through: Locked Promo Cannot Be Sent To Another Player In A Ticket'
    USING ERRCODE='P0001',HINT='promo_play_through_locked'; END IF;
  SELECT * INTO l FROM public.chip_ledger WHERE to_type='escrow' AND to_entity_id=NEW.id
   AND category='ticket_issue' AND club_id=NEW.club_id AND amount=NEW.value
   AND COALESCE(status,'posted')='posted' AND
    (from_type='promo_wallet' OR (from_type='union_wallet' AND from_label='union_wallets.promo_wallet'));
  IF l.id IS NULL THEN RETURN NULL; END IF;
  gid:=public.fn_ca_promo_play_through_record_grant(NEW.club_id,NEW.holder_id,NEW.value,
   'promo_ticket_redeem','promo_ticket:'||NEW.id,l.id,l.from_type,l.from_entity_id,NULL);
  IF gid IS NOT NULL THEN
   UPDATE public.ca_promo_principal_custody SET kind='ticket',entity_id=NEW.id WHERE grant_id=gid AND kind='player_wallet' AND entity_id=NEW.holder_id;
  END IF;
 ELSIF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
  FOR r IN SELECT DISTINCT g.club_id,g.user_id FROM public.ca_promo_principal_custody c
   JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   WHERE c.kind='ticket' AND c.entity_id=NEW.id AND c.amount>0 AND g.closed_at IS NULL ORDER BY g.club_id,g.user_id LOOP
   PERFORM public.fn_ca_promo_play_through_settle(r.club_id,r.user_id);
   IF EXISTS(SELECT 1 FROM public.chip_ledger x WHERE x.from_type='escrow' AND x.from_entity_id=NEW.id
     AND x.to_type='promo_wallet' AND x.to_entity_id=NEW.issued_by AND x.club_id=NEW.club_id
     AND x.amount=NEW.value AND x.category IN('refund','ticket_cancel','escrow_release') AND COALESCE(x.status,'posted')='posted') THEN
    returned:=public.fn_ca_promo_move_custody(r.club_id,r.user_id,'ticket',NEW.id,NULL,NULL,NEW.value,'returned');
   ELSIF EXISTS(SELECT 1 FROM public.chip_ledger x WHERE x.from_type='escrow' AND x.from_entity_id=NEW.id
     AND x.to_type='player_wallet' AND x.to_entity_id=r.user_id AND x.club_id=NEW.club_id
     AND x.amount=NEW.value AND x.category IN('refund','ticket_cancel','escrow_release') AND COALESCE(x.status,'posted')='posted') THEN
    returned:=public.fn_ca_promo_move_custody(r.club_id,r.user_id,'ticket',NEW.id,'player_wallet',r.user_id,NEW.value);
   ELSE RAISE EXCEPTION 'promo_ticket_cancel_has_no_original_refund'; END IF;
  END LOOP;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_ticket_principal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_ticket_principal AFTER INSERT OR UPDATE OF status ON public.tournament_tickets
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_ticket_principal();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES
 ('tournament_tickets','ca_promo_ticket_principal','Promo escrow creates one grant; cancellation follows the original refund owner; locked ticket gifts cannot evade player-transfer rules.');

CREATE FUNCTION public.fn_ca_promo_redeem_ticket_to_wallet(p_ticket uuid,p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE t public.tournament_tickets%ROWTYPE;r record;positions jsonb;
BEGIN
 SELECT * INTO t FROM public.tournament_tickets WHERE id=p_ticket;
 IF t.id IS NULL OR t.holder_id IS DISTINCT FROM p_user OR t.status IS DISTINCT FROM 'redeemed' THEN
  RAISE EXCEPTION 'promo_ticket_wallet_redemption_not_proven'; END IF;
 PERFORM public.fn_ca_promo_play_through_settle(t.club_id,p_user);
 SELECT jsonb_agg(jsonb_build_object('grant_id',c.grant_id,'amount',c.amount)) INTO positions
  FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE c.kind='ticket' AND c.entity_id=t.id AND c.amount>0 AND g.closed_at IS NULL AND g.user_id=p_user AND g.club_id=t.club_id;
 PERFORM public.fn_ca_promo_move_custody(t.club_id,p_user,'ticket',t.id,'player_wallet',p_user,t.value);
 FOR r IN SELECT (x.value->>'grant_id')::uuid grant_id,(x.value->>'amount')::numeric amount
  FROM jsonb_array_elements(COALESCE(positions,'[]')) x
  JOIN public.fn_ca_promo_play_through_state(t.club_id,p_user) state ON state.grant_id=(x.value->>'grant_id')::uuid
  WHERE state.state='expired_pending' LOOP
  PERFORM public.fn_ca_promo_return_principal(r.grant_id,'player_wallet','expired',r.amount,'ticket_redeem:'||t.id||':'||r.grant_id);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_redeem_ticket_to_wallet(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_free_buy_principal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','smarter_private','pg_temp' AS $$
DECLARE club uuid;gid uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.returned_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN NULL; END IF;
  SELECT t.club_id INTO club FROM public.tournaments t JOIN public.tournament_players p ON p.tournament_id=t.id
   WHERE t.id=NEW.tournament_id AND p.id=NEW.registration_id AND p.user_id=NEW.user_id;
  IF club IS NULL THEN RAISE EXCEPTION 'promo_free_buy_requires_original_registration'; END IF;
  gid:=public.fn_ca_promo_play_through_record_grant(club,NEW.user_id,1,'promo_ticket_prize',
   'free_buy_ticket:'||NEW.registration_id,NULL,'union_wallet','fade0000-0000-0000-0000-000000000001',NULL);
  IF gid IS NOT NULL THEN
   UPDATE public.ca_promo_principal_custody SET kind='event',entity_id=NEW.tournament_id WHERE grant_id=gid AND kind='player_wallet' AND entity_id=NEW.user_id;
   INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,source_ref,original_amount,remaining)
    VALUES(gid,NEW.tournament_id,'free_buy_ticket:'||NEW.registration_id,1,1);
  END IF;
 ELSIF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
  SELECT id INTO gid FROM public.ca_promo_play_through_grants WHERE source_ref='free_buy_ticket:'||NEW.registration_id AND closed_at IS NULL FOR UPDATE;
  IF gid IS NOT NULL THEN
   UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='returned',
    close_note='Original unplayed Free Buy ticket restored' WHERE id=gid;
  END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_free_buy_principal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_free_buy_principal AFTER INSERT OR UPDATE OF returned_at ON smarter_private.free_buy_ticket_redemptions
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_free_buy_principal();

-- Terminal status is already protected by original settlement/refund receipts.
-- Defer until that transaction's payouts/refunds have all realized principal.
CREATE FUNCTION public.fn_ca_promo_finish_event_principal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;held numeric;state text;
BEGIN
 IF upper(NEW.status) NOT IN('COMPLETED','CANCELLED','CANCELED') THEN RETURN NULL; END IF;
 FOR r IN SELECT DISTINCT g.id,g.club_id,g.user_id,g.granted_at FROM public.ca_promo_event_principal_lots lot
  JOIN public.ca_promo_play_through_grants g ON g.id=lot.grant_id
  WHERE lot.tournament_id=NEW.id AND lot.remaining>0 AND g.closed_at IS NULL ORDER BY g.granted_at,g.id LOOP
  SELECT s.state INTO state FROM public.fn_ca_promo_play_through_state(r.club_id,r.user_id) s WHERE s.grant_id=r.id;
  IF state='met_pending' THEN
   UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='met' WHERE id=r.id AND closed_at IS NULL;
  ELSE
   SELECT COALESCE(sum(remaining),0) INTO held FROM public.ca_promo_event_principal_lots WHERE grant_id=r.id AND tournament_id=NEW.id;
   UPDATE public.ca_promo_principal_custody SET amount=amount-held WHERE grant_id=r.id AND kind='event' AND entity_id=NEW.id AND amount>=held;
   IF NOT FOUND THEN RAISE EXCEPTION 'terminal_promo_event_lots_do_not_match_principal'; END IF;
   UPDATE public.ca_promo_event_principal_lots SET remaining=0 WHERE grant_id=r.id AND tournament_id=NEW.id AND remaining>0;
   UPDATE public.ca_promo_play_through_grants SET remaining=remaining-held,
    closed_at=CASE WHEN remaining=held THEN clock_timestamp() ELSE NULL END,
    close_reason=CASE WHEN remaining=held THEN 'spent' ELSE NULL END WHERE id=r.id AND closed_at IS NULL;
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_finish_event_principal() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER ca_promo_finish_event_principal AFTER UPDATE OF status ON public.tournaments
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.status IS DISTINCT FROM OLD.status)
 EXECUTE FUNCTION public.fn_ca_promo_finish_event_principal();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES
 ('tournaments','ca_promo_finish_event_principal','After original terminal settlement, unrealized promo entry principal is spent, without moving chips or reviving it on later deposits.');

-- The original ticket money doors share the cashier hierarchy order, then
-- lock every selected entitlement before any source fund or holder wallet.
-- Bulk expiry/departure cannot hold FundA while waiting for TicketB.
CREATE FUNCTION public.fn_ca_promo_lock_ticket_resources(p_tickets uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE c uuid;ids uuid[];
BEGIN
 FOR c IN SELECT DISTINCT club_id FROM public.tournament_tickets WHERE id=ANY(p_tickets) ORDER BY club_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('agent-agreement:'||c::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:'||c::text,0));
 END LOOP;
 PERFORM id FROM public.tournament_tickets WHERE id=ANY(p_tickets) ORDER BY id FOR UPDATE;
 SELECT array_agg(DISTINCT gr.id ORDER BY gr.id) INTO ids FROM public.ca_promo_principal_custody cu
  JOIN public.ca_promo_play_through_grants gr ON gr.id=cu.grant_id
  WHERE cu.kind='ticket' AND cu.entity_id=ANY(p_tickets) AND cu.amount>0 AND gr.closed_at IS NULL;
 IF cardinality(ids)>0 THEN PERFORM public.fn_ca_promo_lock_grant_funds(ids); END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_lock_ticket_resources(uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_lock_leave_tickets(p_club uuid,p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE ids uuid[];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('agent-agreement:'||p_club::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:'||p_club::text,0));
 SELECT array_agg(t.id ORDER BY t.id) INTO ids FROM public.tournament_tickets t
 WHERE t.club_id=p_club AND t.holder_id=p_user AND t.status='issued' AND EXISTS(
  SELECT 1 FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE c.kind='ticket' AND c.entity_id=t.id AND c.amount>0 AND g.closed_at IS NULL AND g.user_id=p_user);
 PERFORM public.fn_ca_promo_lock_ticket_resources(COALESCE(ids,ARRAY[]::uuid[]));
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_lock_leave_tickets(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the single original cancellation implementation. Public callers
-- still authenticate as the issuer; expiry/departure derives the issuer from
-- that exact entitlement through an owner-only core, never a substituted JWT.
INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES
 ('fn_ca_cancel_promo_ticket_owned','approved','Owner-only original ticket cancellation core; public issuer authentication remains in fn_cancel_tournament_ticket; product expiry and departure derive its original issuer without changing request identity.')
ON CONFLICT(proname) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes;
DO $cancel_core$
DECLARE def text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure) INTO def;
 IF md5(def)<>'25b182e8905f859ba5de2467957a4eda' THEN RAISE EXCEPTION 'promo_ticket_cancel_owner_changed'; END IF;
 def:=replace(def,'FUNCTION public.fn_cancel_tournament_ticket(p_ticket_id uuid)',
  'FUNCTION public.fn_ca_cancel_promo_ticket_owned(p_ticket_id uuid, p_issuer_id uuid, p_reason text)');
 def:=replace(def,'v_me uuid:=auth.uid();','v_me uuid:=p_issuer_id;');
 def:=replace(def,E'BEGIN\n  IF v_me IS NULL THEN',
  E'BEGIN\n  IF p_reason IS NULL OR p_reason NOT IN (''cancelled'',''expired'',''left_club'') OR (p_reason=''cancelled'' AND p_issuer_id IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION ''invalid_ticket_cancellation_authority'' USING ERRCODE=''42501''; END IF;\n  IF v_me IS NULL THEN');
 def:=replace(def,E'  SELECT * INTO v_t FROM public.tournament_tickets\n',E'  PERFORM public.fn_ca_promo_lock_ticket_resources(ARRAY[p_ticket_id]);\n  SELECT * INTO v_t FROM public.tournament_tickets\n');
 def:=replace(def,E'''refund_wallet'',CASE WHEN v_promo THEN ''promo_wallet'' ELSE ''player_wallet'' END,',
  E'''promo_return_reason'',p_reason,\n      ''refund_wallet'',CASE WHEN v_promo THEN ''promo_wallet'' ELSE ''player_wallet'' END,');
 EXECUTE def;
END $cancel_core$;
REVOKE ALL ON FUNCTION public.fn_ca_cancel_promo_ticket_owned(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.fn_cancel_tournament_ticket(p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not Authenticated'); END IF;
 RETURN public.fn_ca_cancel_promo_ticket_owned(p_ticket_id,auth.uid(),'cancelled');
END $$;

DO $ticket_owners$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_redeem_tournament_ticket(uuid)'::regprocedure) INTO def;
 IF md5(def)<>'49cb942d53af3521ff14a6502520924c' THEN RAISE EXCEPTION 'promo_ticket_redeem_owner_changed'; END IF;
 def:=replace(def,E'  SELECT * INTO v_t FROM public.tournament_tickets\n',E'  PERFORM public.fn_ca_promo_lock_ticket_resources(ARRAY[p_ticket_id]);\n  SELECT * INTO v_t FROM public.tournament_tickets\n');
 needle:=E'   WHERE id=p_ticket_id;\n  INSERT INTO public.chip_transactions(';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_ticket_redeem_anchor_changed'; END IF;
 def:=replace(def,E'  v_after numeric;\n',E'  v_after numeric;\n  v_final_after numeric;\n');
 def:=replace(def,needle,E'   WHERE id=p_ticket_id;\n  PERFORM public.fn_ca_promo_redeem_ticket_to_wallet(p_ticket_id,v_me);\n  SELECT chip_balance INTO v_final_after FROM public.club_members WHERE club_id=v_t.club_id AND user_id=v_me;\n  INSERT INTO public.chip_transactions(');
 def:=replace(def,E'''holder_balance_after'',v_after))',E'''holder_balance_after'',v_after,''holder_balance_after_return'',v_final_after))');
 def:=replace(def,E'''your_balance'',v_after,''transaction_id'',v_receipt.id)',E'''your_balance'',v_final_after,''transaction_id'',v_receipt.id)');
 def:=replace(def,E'''your_balance'',(v_receipt.metadata->>''holder_balance_after'')::numeric',E'''your_balance'',COALESCE((v_receipt.metadata->>''holder_balance_after_return'')::numeric,(v_receipt.metadata->>''holder_balance_after'')::numeric)');
 EXECUTE def;
 SELECT pg_get_functiondef('public.fn_ca_use_cashier_entry_ticket(uuid,uuid,uuid)'::regprocedure) INTO def;
 IF md5(def)<>'0d5b384945f80b0b127663bbc5a64652' THEN RAISE EXCEPTION 'promo_cashier_entry_owner_changed'; END IF;
 def:=replace(def,'  SELECT * INTO v_tk FROM public.tournament_tickets tk WHERE tk.id = p_ticket_id FOR UPDATE;',E'  PERFORM public.fn_ca_promo_lock_ticket_resources(ARRAY[p_ticket_id]);\n  SELECT * INTO v_tk FROM public.tournament_tickets tk WHERE tk.id = p_ticket_id FOR UPDATE;');
 def:=replace(def,E'  v_receipt uuid;\nBEGIN',E'  v_receipt uuid;\n  v_prev_promo_ticket text:=current_setting(''app.ca_promo_ticket_entry'',true);\nBEGIN');
 needle:=E'    -- (b) The ordinary entry door, paid from that same wallet.\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_cashier_entry_anchor_changed'; END IF;
 def:=replace(def,needle,needle||E'    PERFORM public.fn_ca_promo_prepare_ticket_entry(v_tk.id,p_tournament_id,v_uid,v_receipt);\n');
 def:=replace(def,E'    -- (c) The wallet nets to zero exactly, in the ticket''s club, or nothing',
  E'    PERFORM set_config(''app.ca_promo_ticket_entry'',COALESCE(v_prev_promo_ticket,''''),true);\n    -- (c) The wallet nets to zero exactly, in the ticket''s club, or nothing');
 EXECUTE def;
END $ticket_owners$;

-- The ordinary debit already owns the exact locked wallet-before. Export it
-- only across its own journaled UPDATE, then restore the prior context.
DO $debit_owner$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.atomic_deduct_wallet_and_log(uuid,numeric,text,text,uuid,uuid,uuid)'::regprocedure) INTO def;
 IF md5(def)<>'a3997f92d5acf8f5e2898b592dab4f32' THEN RAISE EXCEPTION 'promo_original_wallet_debit_owner_changed'; END IF;
 def:=replace(def,E'  v_has_club boolean;\nBEGIN',E'  v_has_club boolean;\n  v_prev_promo_debit text:=current_setting(''app.ca_promo_wallet_debit'',true);\nBEGIN');
 needle:=E'    UPDATE public.club_members cm\n       SET chip_balance=cm.chip_balance-p_amount,updated_at=now()';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_wallet_debit_anchor_changed'; END IF;
 def:=replace(def,needle,E'    IF lower(COALESCE(p_category,'''')) IN(''tournament_buyin'',''tournament_rebuy'',''rebuy'',''reentry'',''addon'') AND COALESCE(p_related_entity_id,v_context_tournament) IS NOT NULL THEN\n      PERFORM set_config(''app.ca_promo_wallet_debit'',jsonb_build_object(''user_id'',p_user_id,''club_id'',v_club_id,''amount'',p_amount,''balance_before'',v_balance,''category'',lower(p_category),''tournament_id'',COALESCE(p_related_entity_id,v_context_tournament),''operation_key'',current_setting(''app.ledger_idempotency_key'',true),''context_token'',gen_random_uuid())::text,true);\n    END IF;\n'||needle);
 needle:=E'       AND cm.chip_balance>=p_amount;\n    IF NOT FOUND THEN';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_wallet_debit_restore_anchor_changed'; END IF;
 -- Preserve UPDATE FOUND before set_config changes the PL/pgSQL status.
 def:=replace(def,needle,E'       AND cm.chip_balance>=p_amount;\n    v_has_club:=FOUND;\n    PERFORM set_config(''app.ca_promo_wallet_debit'',COALESCE(v_prev_promo_debit,''''),true);\n    IF NOT v_has_club THEN');
 EXECUTE def;
END $debit_owner$;

DO $refund_owner$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_settle_tournament_refund_exact(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text,text)'::regprocedure) INTO def;
 IF md5(def)<>'10e0da6995df7d2be3cd33683954ceaa' THEN RAISE EXCEPTION 'promo_original_refund_owner_changed'; END IF;
 def:=replace(def,E'  v_entitlement record;\nBEGIN',E'  v_entitlement record;\n  v_prev_promo_refund text:=current_setting(''app.ca_promo_refund_entitlement'',true);\nBEGIN');
 needle:=E'  SELECT m.chip_balance INTO v_balance_before\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_refund_wallet_lock_anchor_changed'; END IF;
 def:=replace(def,needle,E'  PERFORM public.fn_ca_promo_lock_grant_funds(ARRAY(SELECT DISTINCT lot.grant_id FROM public.ca_promo_event_principal_lots lot JOIN public.ca_promo_play_through_grants gr ON gr.id=lot.grant_id WHERE lot.charge_ledger_id=v_entitlement.source_ledger_id AND lot.remaining>0 AND gr.closed_at IS NULL ORDER BY lot.grant_id));\n'||needle);
 needle:=E'  PERFORM public.fn_ca_declare_ledger(\n    ''refund'',''prize_liability'',p_tournament_id,NULL,v_key,NULL);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_refund_credit_anchor_changed'; END IF;
 def:=replace(def,needle,E'  PERFORM set_config(''app.ca_promo_refund_entitlement'',v_entitlement.id::text,true);\n'||needle);
 needle:=E'  IF v_balance_after IS NULL\n';
 def:=replace(def,needle,E'  PERFORM set_config(''app.ca_promo_refund_entitlement'',COALESCE(v_prev_promo_refund,''''),true);\n'||needle);
 needle:=E'  RETURN jsonb_build_object(\n    ''ok'',true,''fully_settled'',true,''remaining'',0,';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_refund_return_anchor_changed'; END IF;
 def:=replace(def,needle,E'  PERFORM public.fn_ca_promo_return_refunded_principal(v_credit_ledger_id);\n'||needle);
 EXECUTE def;
END $refund_owner$;

CREATE FUNCTION public.fn_ca_promo_leave_tickets(p_club uuid,p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE t record;result jsonb;
BEGIN
 PERFORM public.fn_ca_promo_lock_leave_tickets(p_club,p_user);
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_principal_lots lot
   JOIN public.ca_promo_play_through_grants g ON g.id=lot.grant_id
   JOIN public.tournaments event ON event.id=lot.tournament_id
   WHERE g.club_id=p_club AND g.user_id=p_user AND g.closed_at IS NULL AND lot.remaining>0
    AND upper(event.status) NOT IN('COMPLETED','CANCELLED','CANCELED')) THEN
  RAISE EXCEPTION 'Finish Or Unregister Your Promo-Funded Tournament Before Leaving This Club'
   USING ERRCODE='P0001',HINT='promo_event_still_active'; END IF;
 FOR t IN SELECT ticket.id,ticket.issued_by FROM public.tournament_tickets ticket
  WHERE ticket.club_id=p_club AND ticket.status='issued' AND EXISTS(
   SELECT 1 FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   WHERE c.kind='ticket' AND c.entity_id=ticket.id AND c.amount>0 AND g.closed_at IS NULL
    AND g.club_id=p_club AND g.user_id=p_user) ORDER BY ticket.id FOR UPDATE OF ticket LOOP
  result:=public.fn_ca_cancel_promo_ticket_owned(t.id,t.issued_by,'left_club');
  IF COALESCE((result->>'success')::boolean,false) IS NOT TRUE THEN
   RAISE EXCEPTION 'promo_ticket_original_cancellation_refused: %',result; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_leave_tickets(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_expire_tickets(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE t record;r record;result jsonb;n integer:=0;positions jsonb;selected uuid[];
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'promo_ticket_expiry_limit_invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN 0; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT ticket.id FROM public.tournament_tickets ticket
  WHERE ticket.status='issued' AND ticket.redemption_mode='wallet_chips' AND EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c
   JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   JOIN public.fn_ca_promo_play_through_state(g.club_id,g.user_id) s ON s.grant_id=g.id
   WHERE c.kind='ticket' AND c.entity_id=ticket.id AND c.amount>0 AND g.closed_at IS NULL AND s.state='expired_pending')
  ORDER BY ticket.id LIMIT p_limit) chosen;
 PERFORM public.fn_ca_promo_lock_ticket_resources(COALESCE(selected,ARRAY[]::uuid[]));
 FOR t IN SELECT ticket.id,ticket.issued_by FROM public.tournament_tickets ticket WHERE ticket.id=ANY(selected) AND ticket.status='issued' ORDER BY ticket.id LOOP
  SELECT jsonb_agg(jsonb_build_object('grant_id',g.id,'user_id',g.user_id,'club_id',g.club_id,'amount',c.amount))
   INTO positions FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   JOIN public.fn_ca_promo_play_through_state(g.club_id,g.user_id) s ON s.grant_id=g.id
   WHERE c.kind='ticket' AND c.entity_id=t.id AND c.amount>0 AND s.state='expired_pending';
  result:=public.fn_ca_cancel_promo_ticket_owned(t.id,t.issued_by,'expired');
  IF COALESCE((result->>'success')::boolean,false) IS NOT TRUE THEN
   RAISE EXCEPTION 'promo_ticket_original_expiry_refused: %',result; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(positions,'[]')) LOOP
   IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE id=(r.value->>'grant_id')::uuid AND closed_at IS NULL) THEN
    PERFORM public.fn_ca_promo_return_principal((r.value->>'grant_id')::uuid,'player_wallet','expired',
     (r.value->>'amount')::numeric,'ticket_expiry:'||t.id||':'||(r.value->>'grant_id'));
   ELSE
    UPDATE public.ca_promo_play_through_grants SET close_reason='expired',close_note='Original unused promo ticket expired'
     WHERE id=(r.value->>'grant_id')::uuid AND close_reason='returned';
   END IF;
  END LOOP;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_expire_tickets(integer) FROM PUBLIC,anon,authenticated,service_role;


-- Satellite awards can carry original promo into a new entry or a ticket
-- without a wallet credit. The same original grant follows its entitlement.
CREATE FUNCTION public.fn_ca_promo_roll_event_principal(p_ledger_id uuid,p_user uuid,p_destination text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;lot record;take numeric;left_to_move numeric;moved numeric:=0;n integer;
BEGIN
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_ledger_id;
 IF l.id IS NULL OR l.from_type<>'prize_liability' OR p_destination NOT IN('event','ticket')
  OR l.amount<=0 OR l.metadata->>'user_id' IS DISTINCT FROM p_user::text THEN RAISE EXCEPTION 'invalid_promo_event_roll'; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id) THEN
  RETURN (SELECT principal FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id); END IF;
 PERFORM public.fn_ca_promo_play_through_settle(l.club_id,p_user);
 INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,l.from_entity_id,l.club_id,p_user,l.amount,0);
 left_to_move:=l.amount;
 FOR lot IN SELECT x.id,x.grant_id,x.remaining,g.granted_at FROM public.ca_promo_event_principal_lots x
  JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.tournament_id=l.from_entity_id AND x.remaining>0 AND g.closed_at IS NULL
   AND g.club_id=l.club_id AND g.user_id=p_user ORDER BY g.granted_at,g.id,x.source_ref,x.id FOR UPDATE OF g,x LOOP
  EXIT WHEN left_to_move<=0;take:=LEAST(left_to_move,lot.remaining);
  UPDATE public.ca_promo_principal_custody SET amount=amount-take
   WHERE grant_id=lot.grant_id AND kind='event' AND entity_id=l.from_entity_id AND amount>=take;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'promo_roll_has_no_original_principal'; END IF;
  INSERT INTO public.ca_promo_principal_custody VALUES(lot.grant_id,p_destination,l.to_entity_id,take)
   ON CONFLICT(grant_id,kind,entity_id) DO UPDATE SET amount=ca_promo_principal_custody.amount+EXCLUDED.amount;
  UPDATE public.ca_promo_event_principal_lots SET remaining=remaining-take WHERE id=lot.id;
  INSERT INTO public.ca_promo_event_realization_slices VALUES(l.id,lot.grant_id,take)
   ON CONFLICT(ledger_id,grant_id) DO UPDATE SET amount=ca_promo_event_realization_slices.amount+EXCLUDED.amount;
  moved:=moved+take;left_to_move:=left_to_move-take;
 END LOOP;
 UPDATE public.ca_promo_event_realization_receipts SET principal=moved WHERE ledger_id=l.id;
 RETURN moved;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_roll_event_principal(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_nonwallet_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE uid uuid;promo numeric:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp())
  OR NEW.amount<=0 OR COALESCE(NEW.status,'posted')<>'posted' THEN RETURN NULL; END IF;
 uid:=(NEW.metadata->>'user_id')::uuid;
 IF NEW.from_type='escrow' AND NEW.to_type='prize_liability' AND NEW.category='ticket_redeem' THEN
  IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.tournament_tickets t WHERE t.id=NEW.from_entity_id AND t.holder_id=uid AND t.club_id=NEW.club_id) THEN
   RAISE EXCEPTION 'promo_ticket_direct_entry_original_holder_missing'; END IF;
  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);
  promo:=public.fn_ca_promo_move_custody(NEW.club_id,uid,'ticket',NEW.from_entity_id,'event',NEW.to_entity_id,NEW.amount);
  PERFORM public.fn_ca_promo_record_event_charge(NEW.id);
  PERFORM public.fn_ca_promo_capture_entry_funding(NEW.id,promo);
 ELSIF NEW.from_type='prize_liability' AND NEW.to_type='prize_liability' AND NEW.category='tournament_buyin' THEN
  IF uid IS NULL THEN RAISE EXCEPTION 'promo_satellite_entry_original_holder_missing'; END IF;
  promo:=public.fn_ca_promo_roll_event_principal(NEW.id,uid,'event');
  PERFORM public.fn_ca_promo_record_event_charge(NEW.id);
  PERFORM public.fn_ca_promo_capture_entry_funding(NEW.id,promo);
 ELSIF NEW.from_type='prize_liability' AND NEW.to_type='escrow' AND NEW.category='ticket_issue' THEN
  IF uid IS NULL THEN RAISE EXCEPTION 'promo_satellite_ticket_original_holder_missing'; END IF;
  promo:=public.fn_ca_promo_roll_event_principal(NEW.id,uid,'ticket');
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_nonwallet_entry() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_ca_promo_nonwallet_entry AFTER INSERT ON public.chip_ledger FOR EACH ROW
 WHEN(NEW.from_type IN('escrow','prize_liability') AND NEW.to_type IN('prize_liability','escrow'))
 EXECUTE FUNCTION public.fn_ca_promo_nonwallet_entry();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES
 ('chip_ledger','zzzz_ca_promo_nonwallet_entry','Original ticket or satellite entitlement moves existing principal and records original entry fee funding, without another grant target.');

-- The ordinary cashier ticket is always a gift (its original owner refuses
-- self-issuance). A gift spends unrestricted cash only, like a player transfer.
DO $cash_gift_owner$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_issue_tournament_ticket_phase2_core_20260831(uuid,uuid,numeric,text,text)'::regprocedure) INTO def;
 IF md5(def)<>'267995c5bd9d6231c8506625c1bf3d73' THEN RAISE EXCEPTION 'promo_cash_ticket_gift_owner_changed'; END IF;
 def:=replace(def,E'  v_after numeric;\n',E'  v_after numeric;\n  v_promo_before numeric;\n');
 needle:=E'  v_ticket_id:=gen_random_uuid();\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_cash_ticket_gift_anchor_changed'; END IF;
 def:=replace(def,needle,E'  IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN\n    PERFORM public.fn_ca_promo_play_through_settle(p_club_id,v_me);\n    SELECT chip_balance INTO v_promo_before FROM public.club_members WHERE club_id=p_club_id AND user_id=v_me;\n    IF p_value>GREATEST(COALESCE(v_promo_before,0)-public.fn_ca_promo_locked_at(p_club_id,v_me,''player_wallet'',v_me),0) THEN\n      RETURN jsonb_build_object(''success'',false,''error'',''Promo Play Through: Locked Promo Cannot Be Sent To Another Player In A Ticket'');\n    END IF;\n  END IF;\n'||needle);
 EXECUTE def;
END $cash_gift_owner$;
COMMIT;
