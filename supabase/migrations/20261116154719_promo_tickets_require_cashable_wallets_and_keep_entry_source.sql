-- @install-window: daily-maintenance
-- @locks: public.chip_ledger, public.ca_promo_play_through_grants, public.tournaments, public.accounting_tournament_fee_sources, public.tournament_refund_entitlements, smarter_private.free_buy_ticket_redemptions
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='smarter_private.free_buy_ticket_redemptions'::regclass AND tgname='ca_promo_free_buy_principal' AND tgenabled='O')
-- Promo may enter tournaments directly, but cannot purchase a gifted ticket.
-- Original event principal follows entry, earned awards, refund and full loss.
-- Later optional integrity and required return owners resolve at their runtime
-- boundary through fixed typed SQL; no unresolved static dependency at this commit.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF to_regprocedure('public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text)') IS NULL THEN
  RAISE EXCEPTION 'promo principal custody must be installed first';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NULL) OR EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants) THEN RAISE EXCEPTION 'promo ticket custody must install before programme activation'; END IF;
END $$;

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
ALTER TABLE public.ca_promo_event_principal_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_event_realization_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_event_realization_slices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_event_principal_lots,public.ca_promo_event_realization_receipts,public.ca_promo_event_realization_slices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_event_principal_lots,public.ca_promo_event_realization_receipts,public.ca_promo_event_realization_slices TO service_role;

-- Invoked immediately after the original charge's custody movement. The exact
-- per-grant delta, not a second funding allocator, creates that entry's lots.
CREATE FUNCTION public.fn_ca_promo_record_event_charge(p_ledger_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;r record;extra numeric;total_extra numeric:=0;uid uuid;earning_club uuid;
BEGIN
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_ledger_id;
 IF l.id IS NULL OR l.from_type NOT IN('player_wallet','agent_wallet','escrow','prize_liability') OR l.to_type<>'prize_liability'
  OR l.category NOT IN('tournament_buyin','tournament_rebuy','rebuy','reentry','addon','ticket_redeem') OR l.amount<=0 OR COALESCE(l.status,'posted')<>'posted' THEN
  RAISE EXCEPTION 'invalid_promo_event_charge'; END IF;
 SELECT scope.user_id,scope.club_id INTO uid,earning_club FROM public.fn_ca_promo_entry_charge_identity(l.id) scope;
 IF uid IS NULL THEN RAISE EXCEPTION 'promo_event_charge_has_no_original_player'; END IF;
 FOR r IN SELECT c.grant_id,c.amount,g.granted_at FROM public.ca_promo_principal_custody c
  JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE c.kind='event' AND c.entity_id=l.to_entity_id AND c.amount>0 AND g.closed_at IS NULL
   AND g.club_id=earning_club AND g.user_id=uid ORDER BY g.granted_at,g.id FOR UPDATE OF g,c LOOP
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
 PERFORM public.fn_ca_promo_consume_entry_fee(l.id);
 IF to_regprocedure('public.fn_ca_promo_integrity_consume_entry_fee(uuid)') IS NOT NULL THEN EXECUTE 'SELECT public.fn_ca_promo_integrity_consume_entry_fee($1::uuid)' USING l.id; END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_record_event_charge(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- The original immutable financial entitlement fixes the fee independently
-- of earning agreements. Spend once as soon as it and original custody exist.
CREATE TABLE public.ca_promo_event_fee_consumption_receipts (
 charge_ledger_id uuid PRIMARY KEY REFERENCES public.chip_ledger(id),
 entitlement_id uuid NOT NULL UNIQUE,
 gross_fee numeric NOT NULL CHECK(gross_fee>=0),
 original_promo numeric NOT NULL CHECK(original_promo>=0),
 charge_amount numeric NOT NULL CHECK(charge_amount>0),
 principal numeric NOT NULL CHECK(principal>=0 AND principal<=original_promo),
 club_id uuid NOT NULL,
 player_id uuid NOT NULL,
 earned_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(earned_at))
);
CREATE INDEX ca_promo_original_paid_fee_member ON public.ca_promo_event_fee_consumption_receipts(club_id,player_id,earned_at);
CREATE TABLE public.ca_promo_event_fee_consumption_slices (
 charge_ledger_id uuid NOT NULL REFERENCES public.ca_promo_event_fee_consumption_receipts(charge_ledger_id),
 grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),
 lot_id uuid NOT NULL REFERENCES public.ca_promo_event_principal_lots(id),
 amount numeric NOT NULL CHECK(amount>0),
 PRIMARY KEY(charge_ledger_id,grant_id)
);
CREATE TABLE public.ca_promo_event_fee_source_links (
 fee_source_id uuid PRIMARY KEY REFERENCES public.accounting_tournament_fee_sources(id),
 charge_ledger_id uuid NOT NULL UNIQUE REFERENCES public.ca_promo_event_fee_consumption_receipts(charge_ledger_id)
);
ALTER TABLE public.ca_promo_event_fee_consumption_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_event_fee_consumption_slices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_event_fee_source_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_event_fee_consumption_receipts,public.ca_promo_event_fee_consumption_slices,public.ca_promo_event_fee_source_links FROM PUBLIC,anon,authenticated,service_role;
-- Freeze the original fee earner independently of where a cancellation
-- refunds its money. Nonwallet entry rows exist inside this admission owner.
CREATE FUNCTION public.fn_ca_promo_entry_charge_identity(p_charge uuid)
RETURNS TABLE(club_id uuid,user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;v_club uuid;v_user uuid;registration uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=p_charge) THEN
  RETURN QUERY SELECT r.club_id,r.player_id FROM public.ca_promo_event_fee_consumption_receipts r WHERE r.charge_ledger_id=p_charge;RETURN; END IF;
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_charge;
 IF l.from_type IN('player_wallet','agent_wallet') THEN v_club:=l.club_id;v_user:=l.from_entity_id;
 ELSE
  v_user:=NULLIF(l.metadata->>'user_id','')::uuid;
  registration:=NULLIF(l.metadata->>'registration_id','')::uuid;
  IF registration IS NULL THEN SELECT e.registration_id INTO registration FROM public.tournament_refund_entitlements e WHERE e.source_ledger_id=l.id; END IF;
  SELECT p.club_id INTO v_club FROM public.tournament_players p WHERE p.id=registration AND p.tournament_id=l.to_entity_id AND p.user_id=v_user;
 END IF;
 IF v_user IS NULL OR v_club IS NULL THEN RAISE EXCEPTION 'promo_entry_original_earning_identity_missing'; END IF;
 RETURN QUERY SELECT v_club,v_user;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_entry_charge_identity(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_consume_entry_fee(p_charge_ledger_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;
 lot record;original_p numeric;proved_p numeric;fee_p numeric;left_to_spend numeric;take numeric;earning_club uuid;entrant uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=p_charge_ledger_id) THEN
  RETURN(SELECT principal FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=p_charge_ledger_id); END IF;
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_charge_ledger_id;
 SELECT * INTO e FROM public.tournament_refund_entitlements WHERE source_ledger_id=l.id AND tournament_id=l.to_entity_id;
 IF e.id IS NULL THEN RETURN 0; END IF;
 SELECT scope.club_id,scope.user_id INTO earning_club,entrant FROM public.fn_ca_promo_entry_charge_identity(l.id) scope;
 IF e.gross IS DISTINCT FROM l.amount OR l.amount<=0 OR e.refund_fee<0 OR e.refund_fee>l.amount
  OR l.to_type<>'prize_liability' THEN RAISE EXCEPTION 'promo_fee_lost_original_charge'; END IF;
 SELECT COALESCE(sum(x.original_amount),0) INTO original_p FROM public.ca_promo_event_principal_lots x
  JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.charge_ledger_id=l.id AND g.club_id=earning_club AND g.user_id=entrant;
 -- A genuine zero-P entry is complete only after its actual funding receipt.
 -- Entitlement-first calls may precede the original custody allocator.
 SELECT principal_moved INTO proved_p FROM public.ca_promo_funding_custody_receipts
  WHERE ledger_id=l.id AND amount=l.amount AND destination_kind='event' AND destination_id=l.to_entity_id;
 IF proved_p IS NULL THEN SELECT principal INTO proved_p FROM public.ca_promo_event_realization_receipts
  WHERE ledger_id=l.id AND amount=l.amount AND club_id=earning_club AND user_id=entrant; END IF;
 IF original_p=0 AND proved_p IS NULL THEN RETURN 0; END IF;
 IF original_p>l.amount OR proved_p IS NOT NULL AND proved_p<>original_p THEN RAISE EXCEPTION 'promo_fee_original_funding_disagrees'; END IF;
 fee_p:=round(e.refund_fee*original_p/l.amount,2);
 INSERT INTO public.ca_promo_event_fee_consumption_receipts(charge_ledger_id,entitlement_id,gross_fee,original_promo,charge_amount,principal,club_id,player_id) VALUES(l.id,e.id,e.refund_fee,original_p,l.amount,fee_p,earning_club,entrant);
 left_to_spend:=fee_p;
 FOR lot IN SELECT x.id,x.grant_id,x.remaining,g.granted_at FROM public.ca_promo_event_principal_lots x
  JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.charge_ledger_id=l.id AND x.remaining>0 AND g.club_id=earning_club AND g.user_id=entrant AND g.closed_at IS NULL
  ORDER BY g.granted_at,g.id,x.id FOR UPDATE OF g,x LOOP
  EXIT WHEN left_to_spend<=0;take:=least(lot.remaining,left_to_spend);
  UPDATE public.ca_promo_principal_custody SET amount=amount-take WHERE grant_id=lot.grant_id AND kind='event' AND entity_id=e.tournament_id AND amount>=take;
  IF NOT FOUND THEN RAISE EXCEPTION 'promo_fee_original_event_custody_missing'; END IF;
  UPDATE public.ca_promo_event_principal_lots SET remaining=remaining-take WHERE id=lot.id;
  INSERT INTO public.ca_promo_event_fee_consumption_slices VALUES(l.id,lot.grant_id,lot.id,take);
  UPDATE public.ca_promo_play_through_grants SET remaining=remaining-take,
   closed_at=CASE WHEN remaining=take THEN clock_timestamp() ELSE NULL END,
   close_reason=CASE WHEN remaining=take THEN 'spent' ELSE NULL END WHERE id=lot.grant_id;
  left_to_spend:=left_to_spend-take;
 END LOOP;
 IF left_to_spend<>0 THEN RAISE EXCEPTION 'promo_fee_cannot_spend_missing_original_principal'; END IF;
 RETURN fee_p;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_consume_entry_fee(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_consume_event_fee(p_fee_source_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE f public.accounting_tournament_fee_sources%ROWTYPE;r public.ca_promo_event_fee_consumption_receipts%ROWTYPE;spent numeric;
BEGIN
 SELECT * INTO STRICT f FROM public.accounting_tournament_fee_sources WHERE id=p_fee_source_id;
 IF f.source_charge_ledger_id IS NULL THEN RETURN 0; END IF;
 SELECT * INTO r FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=f.source_charge_ledger_id;
 IF NOT FOUND THEN
  IF (SELECT created_at FROM public.chip_ledger WHERE id=f.source_charge_ledger_id)>=(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id) THEN RAISE EXCEPTION 'promo_original_entry_fee_receipt_missing'; END IF;
  RETURN 0;
 END IF;
 spent:=r.principal;
 IF r.entitlement_id IS DISTINCT FROM f.source_entitlement_id OR r.gross_fee IS DISTINCT FROM f.rake_credit OR r.club_id IS DISTINCT FROM f.club_id OR r.player_id IS DISTINCT FROM f.player_id THEN RAISE EXCEPTION 'promo_canonical_fee_lost_original_entitlement'; END IF;
 INSERT INTO public.ca_promo_event_fee_source_links VALUES(f.id,r.charge_ledger_id) ON CONFLICT(fee_source_id) DO NOTHING;
 RETURN spent;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_consume_event_fee(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_event_fee_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN
  PERFORM public.fn_ca_promo_consume_event_fee(NEW.id);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_event_fee_source() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_event_fee_source AFTER INSERT ON public.accounting_tournament_fee_sources FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_event_fee_source();
CREATE FUNCTION public.fn_ca_promo_entry_fee_entitlement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN
  PERFORM public.fn_ca_promo_consume_entry_fee(NEW.source_ledger_id);
  IF to_regprocedure('public.fn_ca_promo_integrity_consume_entry_fee(uuid)') IS NOT NULL THEN EXECUTE 'SELECT public.fn_ca_promo_integrity_consume_entry_fee($1::uuid)' USING NEW.source_ledger_id; END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_entry_fee_entitlement() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_entry_fee_entitlement AFTER INSERT ON public.tournament_refund_entitlements FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_entry_fee_entitlement();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES
 ('accounting_tournament_fee_sources','ca_promo_event_fee_source','Canonical fee recognition verifies the already-spent exact entitlement fee; late agreement qualification never spends again.'),
 ('tournament_refund_entitlements','ca_promo_entry_fee_entitlement','Exact immutable entry fee and original custody rendezvous spend original fee principal once before any final unlock.');

-- These per-charge source facts are append-only; the mutable tournament
-- position and source association live in their own original relations.
CREATE FUNCTION public.fn_ca_promo_entry_fee_is_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN RAISE EXCEPTION 'original_promo_entry_fee_is_immutable' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_entry_fee_is_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_entry_fee_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_event_fee_consumption_receipts FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_entry_fee_no_truncate BEFORE TRUNCATE ON public.ca_promo_event_fee_consumption_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_entry_fee_slices_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_event_fee_consumption_slices FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_entry_fee_slices_no_truncate BEFORE TRUNCATE ON public.ca_promo_event_fee_consumption_slices FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE FUNCTION public.fn_ca_promo_original_entry_fee_events(p_club uuid,p_user uuid,p_from timestamptz,p_to timestamptz)
RETURNS TABLE(earned_at timestamptz,fee_credit numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
 SELECT fee.earned_at,greatest(0,fee.gross_fee-COALESCE((SELECT sum(tr.refund_fee) FROM public.tournament_refund_tranches tr
  WHERE tr.entitlement_id=e.id AND tr.tournament_id=e.tournament_id AND tr.user_id=e.user_id AND tr.source_wallet_club_id=e.refund_wallet_club_id),0))
 FROM public.ca_promo_event_fee_consumption_receipts fee JOIN public.tournament_refund_entitlements e
  ON e.id=fee.entitlement_id AND e.source_ledger_id=fee.charge_ledger_id
 WHERE fee.club_id=p_club AND fee.player_id=p_user AND e.user_id=fee.player_id AND fee.earned_at>=p_from AND fee.earned_at<p_to;
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_original_entry_fee_events(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
DO $entry_meter$
DECLARE def text;original_hash text;needle text;
BEGIN
 SELECT pg_get_functiondef(oid),md5(prosrc) INTO def,original_hash FROM pg_proc WHERE oid='public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure;
 IF original_hash<>'81ed474798763b9539a6d3aa0a4c09f1' THEN RAISE EXCEPTION 'promo_original_fee_reader_changed'; END IF;
 needle:='WHERE s.club_id=p_club AND s.player_id=p_user AND s.charged_at>=p_from AND s.charged_at<p_to';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_original_fee_source_anchor_changed'; END IF;
 def:=replace(def,needle,needle||' AND NOT EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts fee WHERE fee.charge_ledger_id=s.source_charge_ledger_id)');
 needle:=$tail$COALESCE((c.metadata->'original_rake_record_ids') ? s.rake_record_id::text,false)));$tail$;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_original_fee_reader_tail_changed'; END IF;
 def:=replace(def,needle,left(needle,length(needle)-1)||E'\n UNION ALL SELECT paid.earned_at,paid.fee_credit FROM public.fn_ca_promo_original_entry_fee_events(p_club,p_user,p_from,p_to) paid;');
 EXECUTE def;
END $entry_meter$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

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
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.tournament_id=l.from_entity_id AND x.remaining>0 AND g.closed_at IS NULL AND g.user_id=l.to_entity_id) THEN
  INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,l.from_entity_id,l.club_id,l.to_entity_id,l.amount,0);RETURN 0;
 END IF;
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
   AND (g.club_id=l.club_id OR e.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts fee WHERE fee.charge_ledger_id=e.source_ledger_id AND fee.club_id=g.club_id AND fee.player_id=g.user_id)) AND g.user_id=l.to_entity_id
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
  WHERE s.ledger_id=l.id ORDER BY g.granted_at,g.id LOOP
  EXECUTE 'SELECT public.fn_ca_promo_return_principal($1::uuid,$2::text,$3::text,$4::numeric,$5::text)' INTO paid USING r.grant_id,'player_wallet','returned',r.amount,'event_refund:'||l.id||':'||r.grant_id;
  total:=total+paid;
 END LOOP;
 EXECUTE 'SELECT public.fn_ca_promo_return_spent_event_fee($1::uuid)' INTO paid USING p_credit_ledger_id;
 total:=total+paid;
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

-- The original validated rebuy owner proves this exact old generation is
-- lost before it can admit new money. Preserve actual owed/ambiguous assets.
CREATE TABLE public.ca_promo_event_entry_loss_receipts (
 candidate_id uuid PRIMARY KEY,registration_id uuid NOT NULL,tournament_id uuid NOT NULL,
 club_id uuid NOT NULL,user_id uuid NOT NULL,table_id uuid NOT NULL,hand_id uuid NOT NULL,
 hand_number bigint NOT NULL,seat_id uuid,seat_joined_at timestamptz,
 operation_ref text NOT NULL,principal numeric NOT NULL CHECK(principal>=0),
 charge_ledger_ids uuid[] NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.ca_promo_event_entry_loss_slices (
 candidate_id uuid NOT NULL REFERENCES public.ca_promo_event_entry_loss_receipts(candidate_id),
 lot_id uuid NOT NULL REFERENCES public.ca_promo_event_principal_lots(id),
 grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),
 charge_ledger_id uuid,amount numeric NOT NULL CHECK(amount>0),PRIMARY KEY(candidate_id,lot_id)
);
CREATE TABLE public.ca_promo_free_buy_exhaustions (
 registration_id uuid PRIMARY KEY,candidate_id uuid REFERENCES public.ca_promo_event_entry_loss_receipts(candidate_id),
 terminal_tournament_id uuid,CHECK(candidate_id IS NOT NULL OR terminal_tournament_id IS NOT NULL)
);
ALTER TABLE public.ca_promo_event_entry_loss_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_event_entry_loss_slices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_free_buy_exhaustions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_event_entry_loss_receipts,public.ca_promo_event_entry_loss_slices,public.ca_promo_free_buy_exhaustions FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ca_promo_entry_loss_original_charge ON public.ca_promo_event_entry_loss_slices(charge_ledger_id,grant_id);
CREATE TRIGGER ca_promo_event_fee_source_links_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_event_fee_source_links FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_event_fee_source_links_no_truncate BEFORE TRUNCATE ON public.ca_promo_event_fee_source_links FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_event_entry_loss_receipts_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_event_entry_loss_receipts FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_event_entry_loss_receipts_no_truncate BEFORE TRUNCATE ON public.ca_promo_event_entry_loss_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_event_entry_loss_slices_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_event_entry_loss_slices FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_event_entry_loss_slices_no_truncate BEFORE TRUNCATE ON public.ca_promo_event_entry_loss_slices FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_free_buy_exhaustions_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_free_buy_exhaustions FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE TRIGGER ca_promo_free_buy_exhaustions_no_truncate BEFORE TRUNCATE ON public.ca_promo_free_buy_exhaustions FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_entry_fee_is_immutable();
CREATE FUNCTION public.fn_ca_promo_retire_busted_entry(p_tournament uuid,p_user uuid,p_candidate uuid,p_operation text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','smarter_private','pg_temp' AS $$
DECLARE c public.tournament_knockout_candidates%ROWTYPE;p public.tournament_players%ROWTYPE;
 prior public.ca_promo_event_entry_loss_receipts%ROWTYPE;lot record;total numeric;prior_charges uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN 0; END IF;
 SELECT * INTO prior FROM public.ca_promo_event_entry_loss_receipts WHERE candidate_id=p_candidate;
 IF FOUND THEN
  IF prior.tournament_id<>p_tournament OR prior.user_id<>p_user OR prior.operation_ref IS DISTINCT FROM p_operation THEN RAISE EXCEPTION 'promo_bust_loss_retry_intent_changed'; END IF;
  RETURN prior.principal;
 END IF;
 SELECT * INTO c FROM public.tournament_knockout_candidates WHERE id=p_candidate FOR UPDATE;
 SELECT * INTO p FROM public.tournament_players WHERE tournament_id=p_tournament AND user_id=p_user FOR UPDATE;
 IF c.id IS NULL OR p.id IS NULL OR c.tournament_id IS DISTINCT FROM p_tournament OR c.eliminated_user_id IS DISTINCT FROM p_user
  OR c.state IS NULL OR c.state NOT IN('pending','eliminated') OR c.stack_after IS DISTINCT FROM 0 OR p.status NOT IN('playing','eliminated') OR p.chips>0 OR COALESCE(p.prize,0)>0
  OR public.fn_ca_latest_committed_knockout_candidate(p_tournament,p_user) IS DISTINCT FROM p_candidate
  OR NULLIF(btrim(p_operation),'') IS NULL THEN RAISE EXCEPTION 'promo_entry_definitive_loss_proof_missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_obligations o WHERE o.tournament_id=p_tournament AND o.user_id=p_user AND o.terminal_closed_at IS NULL AND o.amount_owed>o.amount_paid)
  OR EXISTS(SELECT 1 FROM public.tournament_payouts owed WHERE owed.tournament_id=p_tournament AND owed.user_id=p_user AND owed.terminal_closed_at IS NULL AND owed.amount>0 AND owed.paid_at IS NULL)
  OR EXISTS(SELECT 1 FROM public.tournament_bounty_obligations b WHERE b.tournament_id=p_tournament
   AND NOT(COALESCE(b.state='settled',false) AND COALESCE(public.fn_bounty_obligation_has_complete_marker(b.id),false))
   AND (b.knocker_user_id=p_user OR b.claimants @> jsonb_build_array(jsonb_build_object('user_id',p_user))
    OR b.knocker_user_id IS NULL AND b.claimants IS NULL OR b.claimants IS NOT NULL AND jsonb_typeof(b.claimants)<>'array'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.claimants)='array' THEN b.claimants ELSE '[]'::jsonb END) item WHERE jsonb_typeof(item)<>'object' OR COALESCE(item->>'user_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))) THEN
  RETURN 0;
 END IF;
 -- Match existing funding order: original wallet before original grant rows.
 PERFORM 1 FROM public.club_members WHERE club_id=p.club_id AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'promo_bust_original_wallet_missing'; END IF;
 PERFORM g.id FROM public.ca_promo_play_through_grants g WHERE g.club_id=p.club_id AND g.user_id=p_user AND g.closed_at IS NULL
  AND EXISTS(SELECT 1 FROM public.ca_promo_event_principal_lots x WHERE x.grant_id=g.id AND x.tournament_id=p_tournament AND x.remaining>0)
  ORDER BY g.granted_at,g.id FOR UPDATE;
 SELECT COALESCE(sum(x.remaining),0) INTO total FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.tournament_id=p_tournament AND g.club_id=p.club_id AND g.user_id=p_user AND g.closed_at IS NULL;
 SELECT COALESCE(array_agg(DISTINCT old.charge),'{}'::uuid[]) INTO prior_charges FROM (
  SELECT x.charge_ledger_id charge FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.tournament_id=p_tournament AND g.club_id=p.club_id AND g.user_id=p_user
  UNION SELECT fee.charge_ledger_id FROM public.ca_promo_event_fee_consumption_receipts fee JOIN public.tournament_refund_entitlements e ON e.id=fee.entitlement_id WHERE e.tournament_id=p_tournament AND fee.club_id=p.club_id AND fee.player_id=p_user
 ) old WHERE old.charge IS NOT NULL;
 INSERT INTO public.ca_promo_event_entry_loss_receipts VALUES(c.id,p.id,p_tournament,p.club_id,p_user,c.table_id,c.hand_id,c.hand_number,c.seat_id,c.seat_joined_at,p_operation,total,prior_charges,clock_timestamp());
 FOR lot IN SELECT x.id,x.grant_id,x.charge_ledger_id,x.remaining FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.tournament_id=p_tournament AND x.remaining>0 AND g.club_id=p.club_id AND g.user_id=p_user AND g.closed_at IS NULL
  ORDER BY g.granted_at,g.id,x.id FOR UPDATE OF x,g LOOP
  UPDATE public.ca_promo_principal_custody SET amount=amount-lot.remaining WHERE grant_id=lot.grant_id AND kind='event' AND entity_id=p_tournament AND amount>=lot.remaining;
  IF NOT FOUND THEN RAISE EXCEPTION 'promo_bust_original_event_principal_missing'; END IF;
  INSERT INTO public.ca_promo_event_entry_loss_slices VALUES(c.id,lot.id,lot.grant_id,lot.charge_ledger_id,lot.remaining);
  UPDATE public.ca_promo_event_principal_lots SET remaining=0 WHERE id=lot.id;
  UPDATE public.ca_promo_play_through_grants SET remaining=remaining-lot.remaining,
   closed_at=CASE WHEN remaining=lot.remaining THEN clock_timestamp() ELSE NULL END,
   close_reason=CASE WHEN remaining=lot.remaining THEN 'spent' ELSE NULL END WHERE id=lot.grant_id;
 END LOOP;
 INSERT INTO public.ca_promo_free_buy_exhaustions(registration_id,candidate_id) SELECT d.registration_id,c.id FROM smarter_private.free_buy_ticket_redemptions d
  WHERE d.registration_id=p.id AND d.user_id=p_user AND d.tournament_id=p_tournament AND d.returned_at IS NULL
  ON CONFLICT(registration_id) DO NOTHING;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_retire_busted_entry(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
DO $rebuy_generation_owner$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure) INTO def;
 IF md5(def)<>'340946b9bef6be146cd1ba9d0354bd16' THEN RAISE EXCEPTION 'promo_original_rebuy_generation_owner_changed'; END IF;
 needle:=E'    v_response:=public.fn_ca_process_tournament_chip_purchase_money_v1(\n      p_tournament_id,p_user_id,v_type,p_cost,p_chips,v_t.current_level,\n      v_effective_token);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_original_rebuy_generation_anchor_changed'; END IF;
 EXECUTE replace(def,needle,E'    IF public.fn_ca_tournament_unit_cents(p_tournament_id)=1 THEN PERFORM public.fn_ca_promo_retire_busted_entry(p_tournament_id,p_user_id,v_candidate.id,v_effective_token); END IF;\n'||needle);
END $rebuy_generation_owner$;

-- Coupon allowance is not money. Principal starts only at the original
-- actual promo debit, capped to the funded one-chip face of each coupon.
CREATE TABLE public.ca_promo_free_buy_funding_slices (
 ledger_id uuid NOT NULL REFERENCES public.chip_ledger(id),
 registration_id uuid NOT NULL, -- original unregister lawfully deletes its registration
 grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),
 amount numeric NOT NULL CHECK(amount>0 AND amount<=1),
 PRIMARY KEY(ledger_id,registration_id)
);
ALTER TABLE public.ca_promo_free_buy_funding_slices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_free_buy_funding_slices FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_free_buy_funded() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','smarter_private','pg_temp' AS $$
DECLARE r record;gid uuid;capacity numeric;budget numeric;take numeric;total_cents bigint;index_no bigint:=0;member_count bigint;
BEGIN
 IF NEW.category<>'promo_send' OR NEW.from_type<>'union_wallet' OR NEW.to_type<>'prize_liability'
  OR NEW.metadata->>'kind' IS DISTINCT FROM 'midway_free_buy_promo_head'
  OR NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN NULL; END IF;
 IF NEW.from_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
  OR NEW.from_label IS DISTINCT FROM 'union_wallets.promo_wallet'
  OR NEW.tournament_id IS DISTINCT FROM NEW.to_entity_id OR NEW.amount<=0 THEN RAISE EXCEPTION 'promo_free_buy_original_funding_conflict'; END IF;
 IF NEW.metadata->>'stage'='cutoff' THEN
  IF NEW.idempotency_key IS DISTINCT FROM 'tourney:'||NEW.tournament_id||':free_buy_cutoff_funding' THEN RAISE EXCEPTION 'promo_free_buy_original_cutoff_conflict'; END IF;
 ELSE
  IF NEW.idempotency_key IS DISTINCT FROM 'tourney:'||NEW.tournament_id||':promo_head:'||(NEW.metadata->>'registration_id') THEN RAISE EXCEPTION 'promo_free_buy_original_head_conflict'; END IF;
 END IF;
 -- Original funding owner already holds the tournament lock. Snapshot only
 -- its valid redeemed registrations, sorted to make cent allocation stable.
 SELECT count(*),COALESCE(sum(greatest(0,1-COALESCE((SELECT sum(f.amount) FROM public.ca_promo_free_buy_funding_slices f WHERE f.registration_id=p.id),0))),0)
  INTO member_count,capacity FROM public.tournament_players p JOIN smarter_private.free_buy_ticket_redemptions d ON d.registration_id=p.id AND d.user_id=p.user_id AND d.tournament_id=p.tournament_id
  WHERE p.tournament_id=NEW.tournament_id AND d.returned_at IS NULL
   AND (NEW.metadata->>'stage'='cutoff' OR p.id::text=NEW.metadata->>'registration_id');
 budget:=least(NEW.amount,capacity);total_cents:=floor(budget*100);
 IF member_count=0 OR total_cents<=0 THEN RETURN NULL; END IF;
 -- Allocate exact cents in canonical registration order.
 -- Every previous source event consumes its face capacity even after loss/met.
 FOR r IN SELECT p.id,p.user_id,COALESCE(p.club_id,public.fn_tournament_club_for_user(p.user_id,p.tournament_id,NULL)) club_id,greatest(0,1-COALESCE((SELECT sum(f.amount) FROM public.ca_promo_free_buy_funding_slices f WHERE f.registration_id=p.id),0)) available
  FROM public.tournament_players p JOIN public.tournaments t ON t.id=p.tournament_id
  JOIN smarter_private.free_buy_ticket_redemptions d ON d.registration_id=p.id AND d.user_id=p.user_id AND d.tournament_id=p.tournament_id
  WHERE p.tournament_id=NEW.tournament_id AND d.returned_at IS NULL
   AND (NEW.metadata->>'stage'='cutoff' OR p.id::text=NEW.metadata->>'registration_id') ORDER BY p.id LOOP
  -- All coupons in a format have the same original funded components. The
  -- remaining budget/capacity proportional cut also handles legacy mixtures.
  IF capacity<=0 OR budget<=0 THEN EXIT; END IF;
  take:=least(r.available,trunc(budget*r.available/capacity,2));
  IF index_no=member_count-1 THEN take:=least(r.available,budget); END IF;
  index_no:=index_no+1;capacity:=capacity-r.available;budget:=budget-take;
  IF take<=0 THEN CONTINUE; END IF;
  gid:=public.fn_ca_promo_play_through_record_grant(r.club_id,r.user_id,take,'promo_ticket_prize',
   'free_buy_funding:'||NEW.id||':'||r.id,NEW.id,'union_wallet',NEW.from_entity_id,NULL);
  IF gid IS NOT NULL THEN
   UPDATE public.ca_promo_principal_custody SET kind='event',entity_id=NEW.tournament_id WHERE grant_id=gid AND kind='player_wallet' AND entity_id=r.user_id;
   INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining)
    VALUES(gid,NEW.tournament_id,NEW.id,'free_buy_funding:'||NEW.id||':'||r.id,take,take);
   INSERT INTO public.ca_promo_free_buy_funding_slices VALUES(NEW.id,r.id,gid,take);
   IF EXISTS(SELECT 1 FROM public.ca_promo_free_buy_exhaustions exhausted WHERE exhausted.registration_id=r.id) THEN UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent',close_note='Original Free Buy entry already exhausted before its deferred funding' WHERE id=gid; END IF;
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_free_buy_funded() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_free_buy_funded AFTER INSERT ON public.chip_ledger FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_free_buy_funded();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES('chip_ledger','ca_promo_free_buy_funded','Actual original Free Buy promo funding captures at most each redeemed coupon face; allowance issuance creates no debt.');
CREATE FUNCTION public.fn_ca_promo_free_buy_principal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','smarter_private','pg_temp' AS $$
BEGIN
 IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
  UPDATE public.ca_promo_play_through_grants g SET remaining=0,closed_at=clock_timestamp(),close_reason='returned',close_note='Original unplayed Free Buy funding returned'
  FROM public.ca_promo_free_buy_funding_slices f WHERE f.registration_id=NEW.registration_id AND f.grant_id=g.id AND g.closed_at IS NULL;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_free_buy_principal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_free_buy_principal AFTER UPDATE OF returned_at ON smarter_private.free_buy_ticket_redemptions
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_free_buy_principal();

-- Terminal status is already protected by original settlement/refund receipts.
-- Defer until that transaction's payouts/refunds have all realized principal.
CREATE FUNCTION public.fn_ca_promo_finish_event_principal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;held numeric;state text;
BEGIN
 IF upper(NEW.status) NOT IN('COMPLETED','CANCELLED','CANCELED') THEN RETURN NULL; END IF;
 INSERT INTO public.ca_promo_free_buy_exhaustions(registration_id,terminal_tournament_id)
 SELECT d.registration_id,NEW.id FROM smarter_private.free_buy_ticket_redemptions d JOIN public.tournament_players p ON p.id=d.registration_id AND p.tournament_id=d.tournament_id AND p.user_id=d.user_id
 WHERE d.tournament_id=NEW.id AND d.returned_at IS NULL AND COALESCE(p.chips,0)<=0 AND COALESCE(p.prize,0)<=0
 ON CONFLICT(registration_id) DO NOTHING;
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

-- Rebuys, reentries and addons own their original wallet UPDATE directly.
-- Export its actual locked before-balance, preserving the same money owner.
DO $purchase_owner$
DECLARE def text;needle text;guard_def text;old_pin text;new_hash text;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure) INTO def;
 IF md5(def)<>'c749e5de81a89556c602f34018087d3c' THEN RAISE EXCEPTION 'promo_original_purchase_owner_changed'; END IF;
 def:=replace(def,E'  v_led_tid text;\nBEGIN',E'  v_led_tid text;\n  v_prev_promo_debit text:=current_setting(''app.ca_promo_wallet_debit'',true);\nBEGIN');
 needle:=E'  UPDATE public.club_members\n     SET chip_balance=chip_balance-v_total,updated_at=now()';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_purchase_wallet_anchor_changed'; END IF;
 def:=replace(def,needle,E'  PERFORM set_config(''app.ca_promo_wallet_debit'',jsonb_build_object(''user_id'',p_user_id,''club_id'',v_club,''amount'',v_total,''balance_before'',v_balance,''category'',v_cat,''tournament_id'',p_tournament_id,''operation_key'',v_key,''context_token'',gen_random_uuid())::text,true);\n'||needle);
 needle:=E'  GET DIAGNOSTICS v_rows=ROW_COUNT;\n  v_original_entitlement:=';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_purchase_context_restore_anchor_changed'; END IF;
 def:=replace(def,needle,E'  GET DIAGNOSTICS v_rows=ROW_COUNT;\n  PERFORM set_config(''app.ca_promo_wallet_debit'',COALESCE(v_prev_promo_debit,''''),true);\n  v_original_entitlement:=');
 EXECUTE def;
 SELECT md5(pg_get_functiondef('public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) INTO new_hash;
 SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure) INTO guard_def;
 old_pin:=$pin$"signature":"public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)","definition_md5":"9ff346ac60f760311d884c6d63d9001d"$pin$;
 IF position(old_pin IN guard_def)=0 THEN old_pin:=replace(old_pin,'9ff346ac60f760311d884c6d63d9001d','c749e5de81a89556c602f34018087d3c'); END IF;
 IF length(guard_def)-length(replace(guard_def,old_pin,''))<>length(old_pin) THEN RAISE EXCEPTION 'promo_purchase_exact_admission_pin_changed'; END IF;
 EXECUTE replace(guard_def,old_pin,regexp_replace(old_pin,'"definition_md5":"[a-f0-9]+"','"definition_md5":"'||new_hash||'"'));
END $purchase_owner$;

DO $refund_owner$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_settle_tournament_refund_exact(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text,text)'::regprocedure) INTO def;
 IF md5(def)<>'10e0da6995df7d2be3cd33683954ceaa' THEN RAISE EXCEPTION 'promo_original_refund_owner_changed'; END IF;
 def:=replace(def,E'  v_entitlement record;\nBEGIN',E'  v_entitlement record;\n  v_prev_promo_refund text:=current_setting(''app.ca_promo_refund_entitlement'',true);\nBEGIN');
 needle:=E'  SELECT m.chip_balance INTO v_balance_before\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_refund_wallet_lock_anchor_changed'; END IF;
 def:=replace(def,needle,E'  EXECUTE ''SELECT public.fn_ca_promo_lock_grant_funds($1::uuid[])'' USING ARRAY(SELECT DISTINCT lot.grant_id FROM public.ca_promo_event_principal_lots lot JOIN public.ca_promo_play_through_grants gr ON gr.id=lot.grant_id WHERE lot.charge_ledger_id=v_entitlement.source_ledger_id AND (lot.remaining>0 AND gr.closed_at IS NULL OR EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_slices fee WHERE fee.lot_id=lot.id) OR EXISTS(SELECT 1 FROM public.ca_promo_event_entry_loss_slices lost WHERE lost.lot_id=lot.id)) ORDER BY lot.grant_id);\n'||needle);
 needle:=E'  PERFORM public.fn_ca_declare_ledger(\n    ''refund'',''prize_liability'',p_tournament_id,NULL,v_key,NULL);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_refund_credit_anchor_changed'; END IF;
 def:=replace(def,needle,E'  IF to_regprocedure(''public.fn_ca_promo_integrity_restore_event_fees(uuid)'') IS NOT NULL THEN EXECUTE ''SELECT public.fn_ca_promo_integrity_restore_event_fees($1::uuid)'' USING v_entitlement.id; END IF;\n  PERFORM set_config(''app.ca_promo_refund_entitlement'',v_entitlement.id::text,true);\n'||needle);
 needle:=E'  IF v_balance_after IS NULL\n';
 def:=replace(def,needle,E'  PERFORM set_config(''app.ca_promo_refund_entitlement'',COALESCE(v_prev_promo_refund,''''),true);\n'||needle);
 needle:=E'  RETURN jsonb_build_object(\n    ''ok'',true,''fully_settled'',true,''remaining'',0,';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_refund_return_anchor_changed'; END IF;
 def:=replace(def,needle,E'  PERFORM public.fn_ca_promo_return_refunded_principal(v_credit_ledger_id);\n'||needle);
 EXECUTE def;
END $refund_owner$;

CREATE FUNCTION public.fn_ca_promo_leave_events(p_club uuid,p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE g.club_id=p_club AND g.user_id=p_user AND g.closed_at IS NULL AND c.kind IN('event','ticket') AND c.amount>0) THEN
  RAISE EXCEPTION 'Finish Or Unregister Your Promo-Funded Tournament Before Leaving This Club'
   USING ERRCODE='P0001',HINT='promo_event_still_active'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_leave_events(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- New promo-funded cashier tickets are forbidden at the original money door.
-- Original successful receipts still answer an exact retry; new requests stop
-- before role/fund/member locks and before any debit or entitlement creation.
DO $restrict_promo_ticket$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cashier_promo_ticket_send(uuid,uuid,numeric,text)'::regprocedure) INTO def;
 IF md5(def)<>'b6ff2586a9f6b58cd334e25367b40756' THEN RAISE EXCEPTION 'promo_ticket_send_owner_changed'; END IF;
 needle:=E'  v_role := public.fn_club_bank_role(p_club_id);\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_ticket_restriction_anchor_changed'; END IF;
 def:=replace(def,needle,E'  RETURN jsonb_build_object(''success'',false,''error_code'',''promo_ticket_purchase_forbidden'',''error'',''Tickets Require Cashable Player Or Agent Chips. Send Promo Chips Directly To The Player Instead.'');\n'||needle);
 EXECUTE def;
END $restrict_promo_ticket$;

-- Satellite awards can carry original promo into a new entry or a ticket
-- without a wallet credit. The same original grant follows its entitlement.
CREATE FUNCTION public.fn_ca_promo_roll_event_principal(p_ledger_id uuid,p_user uuid,p_destination text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;lot record;take numeric;left_to_move numeric;moved numeric:=0;n integer;earning_club uuid;
BEGIN
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_ledger_id;
 IF l.id IS NULL OR l.from_type<>'prize_liability' OR p_destination NOT IN('event','ticket')
  OR l.amount<=0 OR l.metadata->>'user_id' IS DISTINCT FROM p_user::text THEN RAISE EXCEPTION 'invalid_promo_event_roll'; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id) THEN
  RETURN (SELECT principal FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id); END IF;
 IF p_destination='event' THEN SELECT scope.club_id INTO earning_club FROM public.fn_ca_promo_entry_charge_identity(l.id) scope; ELSE
  SELECT min(scope.club_id::text)::uuid INTO earning_club FROM (
   SELECT g.club_id FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
    WHERE x.tournament_id=l.from_entity_id AND x.remaining>0 AND g.user_id=p_user
   UNION SELECT tp.club_id FROM public.tournament_players tp WHERE tp.tournament_id=l.from_entity_id AND tp.user_id=p_user
   UNION SELECT f.club_id FROM public.ca_promo_event_fee_consumption_receipts f JOIN public.tournament_refund_entitlements e ON e.id=f.entitlement_id
    WHERE e.tournament_id=l.from_entity_id AND f.player_id=p_user
  ) scope HAVING count(DISTINCT scope.club_id)=1;
  IF earning_club IS NULL THEN RAISE EXCEPTION 'earned_promo_award_original_scope_missing_or_ambiguous'; END IF;
 END IF;
 PERFORM public.fn_ca_promo_play_through_settle(earning_club,p_user);
 INSERT INTO public.ca_promo_event_realization_receipts VALUES(l.id,l.from_entity_id,earning_club,p_user,l.amount,0);
 left_to_move:=l.amount;
 FOR lot IN SELECT x.id,x.grant_id,x.remaining,g.granted_at FROM public.ca_promo_event_principal_lots x
  JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id
  WHERE x.tournament_id=l.from_entity_id AND x.remaining>0 AND g.closed_at IS NULL
   AND g.club_id=earning_club AND g.user_id=p_user ORDER BY g.granted_at,g.id,x.source_ref,x.id FOR UPDATE OF g,x LOOP
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
DECLARE uid uuid;promo numeric:=0;earning_club uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp())
  OR NEW.amount<=0 OR COALESCE(NEW.status,'posted')<>'posted' THEN RETURN NULL; END IF;
 uid:=(NEW.metadata->>'user_id')::uuid;
 IF NEW.from_type='escrow' AND NEW.to_type='prize_liability' AND NEW.category='ticket_redeem' THEN
  IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.tournament_tickets t WHERE t.id=NEW.from_entity_id AND t.holder_id=uid AND t.club_id=NEW.club_id) THEN
   RAISE EXCEPTION 'promo_ticket_direct_entry_original_holder_missing'; END IF;
  SELECT scope.club_id INTO earning_club FROM public.fn_ca_promo_entry_charge_identity(NEW.id) scope;
  PERFORM public.fn_ca_promo_play_through_settle(earning_club,uid);
  promo:=public.fn_ca_promo_move_custody(earning_club,uid,'ticket',NEW.from_entity_id,'event',NEW.to_entity_id,NEW.amount);
  INSERT INTO public.ca_promo_event_realization_receipts VALUES(NEW.id,NEW.to_entity_id,earning_club,uid,NEW.amount,promo);
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

-- One original money owner, explicit source, old player callers unchanged.
INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES
 ('fn_ca_issue_cashable_ticket_owned','approved','Owner-only original ticket implementation with explicit cashable player/agent wallet source.'),
 ('fn_issue_tournament_ticket_agent','approved','Authenticated agent-wallet wrapper around the original ticket money owner.')
ON CONFLICT(proname) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes;
DO $cash_ticket_owner$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_issue_tournament_ticket_phase2_core_20260831(uuid,uuid,numeric,text,text)'::regprocedure) INTO def;
 IF md5(def)<>'267995c5bd9d6231c8506625c1bf3d73' THEN RAISE EXCEPTION 'promo_cash_ticket_gift_owner_changed'; END IF;
 def:=replace(def,'FUNCTION public.fn_issue_tournament_ticket_phase2_core_20260831(', 'FUNCTION public.fn_ca_issue_cashable_ticket_owned(');
 def:=replace(def,'p_idempotency_key text DEFAULT NULL::text)', 'p_idempotency_key text DEFAULT NULL::text, p_source_wallet text DEFAULT ''player_wallet''::text)');
 def:=replace(def,E'  v_after numeric;\n',E'  v_after numeric;\n  v_before numeric;\n  v_locked numeric;\n');
 def:=replace(def,E'begin\n  if v_me is null', E'begin\n  IF p_source_wallet IS NULL OR p_source_wallet NOT IN (''player_wallet'',''agent_wallet'') THEN RETURN jsonb_build_object(''success'',false,''error'',''Tickets Require A Player Or Agent Wallet''); END IF;\n  if v_me is null');
 def:=replace(def,E'         or v_prior.amount is distinct from p_value\n',E'         or v_prior.amount is distinct from p_value\n         or COALESCE(v_prior.metadata->>''funding_source'',''player_wallet'') IS DISTINCT FROM p_source_wallet\n');
 needle:=E'  v_ticket_id:=gen_random_uuid();\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_cash_ticket_guard_anchor_changed'; END IF;
 def:=replace(def,needle,$guard$  IF p_source_wallet='agent_wallet' THEN
    SELECT agent_wallet_balance INTO v_before FROM public.agents WHERE club_id=p_club_id AND user_id=v_me FOR UPDATE;
  ELSE
    SELECT chip_balance INTO v_before FROM public.club_members WHERE club_id=p_club_id AND user_id=v_me;
  END IF;
  PERFORM public.fn_ca_promo_play_through_settle(p_club_id,v_me);
  v_locked:=public.fn_ca_promo_locked_at(p_club_id,v_me,p_source_wallet,v_me);
  IF to_regprocedure('public.fn_ca_promo_integrity_locked_at(uuid,uuid,text,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT $1::numeric+public.fn_ca_promo_integrity_locked_at($2::uuid,$3::uuid,$4::text,$5::uuid)' INTO v_locked USING v_locked,p_club_id,v_me,p_source_wallet,v_me;
  END IF;
  IF v_before IS NULL OR p_value>GREATEST(v_before-v_locked,0) THEN
    RETURN jsonb_build_object('success',false,'error','Tickets Require Cashable Player Or Agent Chips');
  END IF;
$guard$||needle);
 needle:=E'  update public.club_members set chip_balance=coalesce(chip_balance,0)-p_value,updated_at=now()\n   where club_id=p_club_id and user_id=v_me and coalesce(status,''active'') in (''active'',''approved'')\n     and coalesce(chip_balance,0)>=p_value returning chip_balance into v_after;';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'agent_ticket_debit_anchor_changed'; END IF;
 def:=replace(def,needle,$agent$  IF p_source_wallet='agent_wallet' THEN
    UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-p_value,updated_at=now()
     WHERE club_id=p_club_id AND user_id=v_me AND agent_wallet_balance>=p_value RETURNING agent_wallet_balance INTO v_after;
  ELSE
$agent$||needle||E'\n  END IF;');
 def:=replace(def,$literal$'holder_id',p_holder_id,'value',p_value,'note',v_note,'issuer_balance_after',v_after$literal$, $literal$'holder_id',p_holder_id,'value',p_value,'note',v_note,'issuer_balance_after',v_after,'funding_source',p_source_wallet$literal$);
 EXECUTE def;
END $cash_ticket_owner$;
REVOKE ALL ON FUNCTION public.fn_ca_issue_cashable_ticket_owned(uuid,uuid,numeric,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.fn_issue_tournament_ticket_phase2_core_20260831(p_club_id uuid,p_holder_id uuid,p_value numeric,p_note text DEFAULT NULL,p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not Authenticated'); END IF;
 RETURN public.fn_ca_issue_cashable_ticket_owned(p_club_id,p_holder_id,p_value,p_note,p_idempotency_key,'player_wallet');
END $$;
CREATE FUNCTION public.fn_issue_tournament_ticket_agent(p_club_id uuid,p_holder_id uuid,p_value numeric,p_note text DEFAULT NULL,p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not Authenticated'); END IF;
 IF NULLIF(btrim(COALESCE(p_idempotency_key,'')),'') IS NULL THEN RETURN jsonb_build_object('success',false,'error','A Retry Key Is Required For Every Ticket'); END IF;
 RETURN public.fn_ca_issue_cashable_ticket_owned(p_club_id,p_holder_id,p_value,p_note,p_idempotency_key,'agent_wallet');
END $$;
REVOKE ALL ON FUNCTION public.fn_issue_tournament_ticket_agent(uuid,uuid,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_issue_tournament_ticket_agent(uuid,uuid,numeric,text,text) TO authenticated,service_role;

-- Original batch keeps its per-item transaction and acknowledgement identity.
DO $ticket_batch_owner$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cashier_batch_transfer(uuid,text,jsonb,uuid)'::regprocedure) INTO def;
 IF md5(def)<>'859bb844228d65085bf134c4dbd8b32b' THEN RAISE EXCEPTION 'cashier_ticket_batch_owner_changed'; END IF;
 needle:=E'  -- Validate the complete envelope before the first item can move money.\n';
 def:=replace(def,needle,$guard$  IF p_kind='ticket' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) item WHERE COALESCE(item->>'source','player_wallet') NOT IN('player_wallet','agent_wallet')) THEN RETURN jsonb_build_object('success',false,'error','Tickets Require Cashable Player Or Agent Chips'); END IF;
$guard$||needle);
 needle:=E'      elsif v_tournament_id is not null then\n';
 def:=replace(def,needle,$agent$      elsif COALESCE(v_item->>'source','player_wallet')='agent_wallet' AND v_tournament_id IS NULL THEN
        v_result:=public.fn_issue_tournament_ticket_agent(p_club_id,v_user_id,v_amount,nullif(v_item->>'note',''),v_item->>'idempotency_key');
      elsif COALESCE(v_item->>'source','player_wallet')='agent_wallet' THEN
        v_result:=jsonb_build_object('success',false,'error','Choose A Ticket Value For Agent Wallet Tickets');
$agent$||needle);
 EXECUTE def;
END $ticket_batch_owner$;

-- A distinct entry point makes a newer client's agent choice fail safely on
-- an older database that ignores ticket source in the legacy batch envelope.
-- It delegates to the same original batch and per-ticket monetary owner.
INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES
 ('fn_cashier_agent_ticket_batch','approved','Compatibility wrapper for explicit agent ticket funding; delegates the original shared cashier batch, never falls back to player funding.')
ON CONFLICT(proname) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes;
CREATE FUNCTION public.fn_cashier_agent_ticket_batch(p_club_id uuid,p_kind text,p_items jsonb,p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not Authenticated'); END IF;
 IF p_kind IS DISTINCT FROM 'ticket' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) item WHERE item->>'source' IS DISTINCT FROM 'agent_wallet') THEN
  RETURN jsonb_build_object('success',false,'error','Choose Agent Wallet Ticket Funding'); END IF;
 RETURN public.fn_cashier_batch_transfer(p_club_id,p_kind,p_items,p_batch_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_cashier_agent_ticket_batch(uuid,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_cashier_agent_ticket_batch(uuid,text,jsonb,uuid) TO authenticated,service_role;

-- Cancellation returns a new agent-funded ticket to its recorded source.
-- Historical player and promo ticket refund branches remain unchanged.
DO $ticket_cancel_owner$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure) INTO def;
 IF md5(def)<>'25b182e8905f859ba5de2467957a4eda' THEN RAISE EXCEPTION 'cashier_ticket_cancel_owner_changed'; END IF;
 def:=replace(def,E'  v_promo boolean := false;\n',E'  v_promo boolean := false;\n  v_agent boolean := false;\n');
 needle:=E'  ELSE\n    UPDATE public.club_members\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'agent_ticket_refund_anchor_changed'; END IF;
 def:=replace(def,needle,$agent$  ELSIF EXISTS(SELECT 1 FROM public.chip_transactions ct WHERE ct.transaction_type='tournament_ticket_issue' AND ct.metadata->>'ticket_id'=v_t.id::text AND ct.club_id=v_t.club_id AND ct.from_user_id=v_me AND ct.amount=v_t.value AND ct.metadata->>'funding_source'='agent_wallet') THEN
    v_agent:=true;
    UPDATE public.agents SET agent_wallet_balance=COALESCE(agent_wallet_balance,0)+v_t.value,updated_at=now()
     WHERE club_id=v_t.club_id AND user_id=v_me RETURNING agent_wallet_balance INTO v_after;
  ELSE
    UPDATE public.club_members
$agent$);
 def:=replace(def,$literal$CASE WHEN v_promo THEN 'promo_wallet' ELSE 'player_wallet' END$literal$, $literal$CASE WHEN v_promo THEN 'promo_wallet' WHEN v_agent THEN 'agent_wallet' ELSE 'player_wallet' END$literal$);
 EXECUTE def;
END $ticket_cancel_owner$;
COMMIT;
