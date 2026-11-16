-- 20261116161707_suspect_promo_chip_dumping_holds_only_attributable_incoming_.sql
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

-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.ca_promo_funding_custody_receipts'::regclass AND tgname='integrity_original_funding' AND tgenabled='O') AND position('fn_ca_promo_integrity_accept_hand' in pg_get_functiondef('public.fn_ca_commit_hand_settlement(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid,jsonb)'::regprocedure))>0
-- @install-window: daily-maintenance
-- @locks: public.ca_promo_play_through_grants
-- Requires the original promo custody and funding snapshots in 20261116153059
-- plus event custody in 20261116154719, original returns in 20261116154841
-- and the eligible-fee owner in 20261116154831. This is metadata only:
-- no chip payment, new promo grant, fee target or blocking table departure.
-- Spend clean chips first, then integrity-held winnings, then promo principal.
BEGIN;

SET LOCAL lock_timeout='1s';
CREATE TABLE public.ca_promo_integrity_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hand_id uuid NOT NULL,
 source_club_id uuid NOT NULL,source_user_id uuid NOT NULL,
 club_id uuid NOT NULL,recipient_id uuid NOT NULL,
 amount numeric NOT NULL CHECK(amount>=0 AND amount=round(amount,2)),
 evidence jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(hand_id,source_club_id,source_user_id,club_id,recipient_id),
 CHECK(amount::text NOT IN('NaN','Infinity','-Infinity'))
);
CREATE TABLE public.ca_promo_integrity_releases (
 case_id uuid PRIMARY KEY,reviewed_by uuid NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 released_amount numeric NOT NULL CHECK(released_amount>=0),
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ca_promo_integrity_cases_recipient ON public.ca_promo_integrity_cases(club_id,recipient_id,created_at);
CREATE TABLE public.ca_promo_integrity_custody (
 case_id uuid NOT NULL,club_id uuid NOT NULL,user_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('player_wallet','agent_wallet','table_stack','pending_addon','event','ticket')),
 entity_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>=0 AND amount=round(amount,2)),
 PRIMARY KEY(case_id,club_id,user_id,kind,entity_id),
 CHECK(amount::text NOT IN('NaN','Infinity','-Infinity'))
);
CREATE INDEX ca_promo_integrity_position ON public.ca_promo_integrity_custody(club_id,user_id,kind,entity_id) WHERE amount>0;
CREATE INDEX ca_promo_integrity_place ON public.ca_promo_integrity_custody(kind,entity_id) WHERE amount>0;
CREATE TABLE public.ca_promo_integrity_funding (
 ledger_id uuid PRIMARY KEY,principal_before numeric NOT NULL,principal_moved numeric NOT NULL,
 CHECK(principal_before>=principal_moved AND principal_moved>=0)
);
CREATE TABLE public.ca_promo_integrity_hand_funding (
 hand_id uuid NOT NULL,club_id uuid NOT NULL,user_id uuid NOT NULL,table_id uuid NOT NULL,
 contribution numeric NOT NULL CHECK(contribution>=0),held_contribution numeric NOT NULL CHECK(held_contribution BETWEEN 0 AND contribution),
 principal_before numeric NOT NULL CHECK(principal_before>=0),principal_lost numeric NOT NULL CHECK(principal_lost BETWEEN 0 AND principal_before),
 PRIMARY KEY(hand_id,club_id,user_id)
);
CREATE TABLE public.ca_promo_integrity_hand_receipts(hand_id uuid PRIMARY KEY,request jsonb NOT NULL);
CREATE TABLE public.ca_promo_integrity_event_lots (
 case_id uuid NOT NULL,charge_ledger_id uuid NOT NULL,tournament_id uuid NOT NULL,club_id uuid NOT NULL,user_id uuid NOT NULL,
 original_amount numeric NOT NULL CHECK(original_amount>0),remaining numeric NOT NULL CHECK(remaining BETWEEN 0 AND original_amount),
 PRIMARY KEY(case_id,charge_ledger_id)
);
CREATE INDEX ca_promo_integrity_event_source ON public.ca_promo_integrity_event_lots(tournament_id,club_id,user_id) WHERE remaining>0;
CREATE TABLE public.ca_promo_integrity_event_receipts(ledger_id uuid PRIMARY KEY,principal numeric NOT NULL CHECK(principal>=0));
CREATE TABLE public.ca_promo_integrity_fee_spends (
 charge_ledger_id uuid PRIMARY KEY,entitlement_id uuid NOT NULL UNIQUE,
 gross_fee numeric NOT NULL CHECK(gross_fee>=0),held_fee numeric NOT NULL CHECK(held_fee BETWEEN 0 AND gross_fee)
);
CREATE TABLE public.ca_promo_integrity_fee_slices (
 charge_ledger_id uuid NOT NULL,case_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0),
 PRIMARY KEY(charge_ledger_id,case_id)
);
CREATE TABLE public.ca_promo_integrity_fee_refunds (
 entitlement_id uuid PRIMARY KEY,charge_ledger_id uuid NOT NULL UNIQUE,restored numeric NOT NULL CHECK(restored>=0)
);
CREATE TABLE public.ca_promo_integrity_event_loss_slices (
 charge_ledger_id uuid NOT NULL,case_id uuid NOT NULL,source_kind text NOT NULL CHECK(source_kind IN('busted','terminal')),
 source_id uuid NOT NULL,amount numeric NOT NULL CHECK(amount>0),PRIMARY KEY(charge_ledger_id,case_id)
);
CREATE TABLE public.ca_promo_integrity_source_grants (
 hand_id uuid NOT NULL,grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),club_id uuid NOT NULL,user_id uuid NOT NULL,
 source_kind text NOT NULL,funded_from_type text,funded_from_id uuid,
 principal_before numeric NOT NULL,amount numeric NOT NULL CHECK(amount>0 AND amount<=principal_before),
 PRIMARY KEY(hand_id,grant_id)
);
ALTER TABLE public.ca_promo_integrity_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_cases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_cases TO service_role;
ALTER TABLE public.ca_promo_integrity_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_releases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_releases TO service_role;
ALTER TABLE public.ca_promo_integrity_custody ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_custody FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_custody TO service_role;
ALTER TABLE public.ca_promo_integrity_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_funding FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_funding TO service_role;
ALTER TABLE public.ca_promo_integrity_hand_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_hand_funding FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_hand_funding TO service_role;
ALTER TABLE public.ca_promo_integrity_hand_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_hand_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_hand_receipts TO service_role;
ALTER TABLE public.ca_promo_integrity_event_lots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_event_lots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_event_lots TO service_role;
ALTER TABLE public.ca_promo_integrity_event_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_event_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_event_receipts TO service_role;
ALTER TABLE public.ca_promo_integrity_fee_spends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_fee_spends FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_fee_spends TO service_role;
ALTER TABLE public.ca_promo_integrity_fee_slices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_fee_slices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_fee_slices TO service_role;
ALTER TABLE public.ca_promo_integrity_fee_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_fee_refunds FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_fee_refunds TO service_role;
ALTER TABLE public.ca_promo_integrity_event_loss_slices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_event_loss_slices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_event_loss_slices TO service_role;
ALTER TABLE public.ca_promo_integrity_source_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_integrity_source_grants FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_integrity_source_grants TO service_role;
CREATE FUNCTION public.fn_ca_promo_integrity_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN RAISE EXCEPTION 'original_integrity_evidence_is_immutable' USING ERRCODE='23514';END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_immutable() FROM PUBLIC,anon,authenticated,service_role;
DO $immutable$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['ca_promo_integrity_cases','ca_promo_integrity_releases','ca_promo_integrity_funding',
  'ca_promo_integrity_hand_funding','ca_promo_integrity_hand_receipts','ca_promo_integrity_event_receipts','ca_promo_integrity_source_grants','ca_promo_integrity_fee_spends','ca_promo_integrity_fee_slices','ca_promo_integrity_fee_refunds','ca_promo_integrity_event_loss_slices'] LOOP
  EXECUTE format('CREATE TRIGGER integrity_evidence_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable()',t);
  EXECUTE format('CREATE TRIGGER integrity_evidence_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable()',t);
 END LOOP;
END $immutable$;
CREATE FUNCTION public.fn_ca_promo_integrity_locked_at(p_club uuid,p_user uuid,p_kind text,p_entity uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
 SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_integrity_custody c
 WHERE c.club_id=p_club AND c.user_id=p_user AND c.kind=p_kind AND c.entity_id=p_entity AND c.amount>0
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases r WHERE r.case_id=c.case_id);
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_locked_at(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Owner-only position movement. NULL destination retires actual loss, never
-- leaves a debt that a subsequent deposit or rakeback credit could inherit.
CREATE FUNCTION public.fn_ca_promo_integrity_move(p_club uuid,p_user uuid,p_from text,p_from_id uuid,
 p_to text,p_to_id uuid,p_amount numeric,p_to_club uuid DEFAULT NULL,p_to_user uuid DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;n numeric;leftover numeric:=p_amount;moved numeric:=0;
BEGIN
 IF p_amount IS NULL OR p_amount<0 OR p_amount::text IN('NaN','Infinity','-Infinity')
  OR (p_to IS NULL) IS DISTINCT FROM (p_to_id IS NULL) THEN RAISE EXCEPTION 'invalid_integrity_position_movement'; END IF;
 IF p_to=p_from AND p_to_id=p_from_id AND COALESCE(p_to_club,p_club)=p_club AND COALESCE(p_to_user,p_user)=p_user THEN RETURN 0; END IF;
 PERFORM 1 FROM public.ca_promo_integrity_cases k WHERE k.id IN(
  SELECT c.case_id FROM public.ca_promo_integrity_custody c WHERE c.club_id=p_club AND c.user_id=p_user
   AND c.kind=p_from AND c.entity_id=p_from_id AND c.amount>0) ORDER BY k.id FOR UPDATE;
 FOR r IN SELECT c.* FROM public.ca_promo_integrity_custody c WHERE c.club_id=p_club AND c.user_id=p_user
  AND c.kind=p_from AND c.entity_id=p_from_id AND c.amount>0
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases x WHERE x.case_id=c.case_id)
  ORDER BY c.case_id LOOP
  EXIT WHEN leftover<=0;n:=LEAST(r.amount,leftover);
  UPDATE public.ca_promo_integrity_custody SET amount=amount-n
   WHERE case_id=r.case_id AND club_id=p_club AND user_id=p_user AND kind=p_from AND entity_id=p_from_id;
  IF p_to IS NOT NULL THEN
   INSERT INTO public.ca_promo_integrity_custody VALUES(r.case_id,COALESCE(p_to_club,p_club),COALESCE(p_to_user,p_user),p_to,p_to_id,n)
    ON CONFLICT(case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_integrity_custody.amount+EXCLUDED.amount;
  END IF;
  moved:=moved+n;leftover:=leftover-n;
 END LOOP;
 RETURN moved;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_move(uuid,uuid,text,uuid,text,uuid,numeric,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_integrity_on_funding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;held numeric;n numeric;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=NEW.ledger_id;
 held:=public.fn_ca_promo_integrity_locked_at(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id);
 IF held+NEW.principal_before>NEW.source_balance_before THEN RAISE EXCEPTION 'restricted_principal_exceeds_original_balance'; END IF;
 n:=LEAST(held,GREATEST(NEW.amount-GREATEST(NEW.source_balance_before-NEW.principal_before-held,0),0));
 n:=public.fn_ca_promo_integrity_move(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id,
  NEW.destination_kind,NEW.destination_id,n);
 INSERT INTO public.ca_promo_integrity_funding VALUES(l.id,held,n);
 IF NEW.destination_kind='event' THEN PERFORM public.fn_ca_promo_integrity_record_event(l.id); END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_on_funding() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER integrity_original_funding AFTER INSERT ON public.ca_promo_funding_custody_receipts
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_on_funding();
CREATE FUNCTION public.fn_ca_promo_integrity_on_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE f public.cash_participant_funding_receipts%ROWTYPE;a public.cash_funding_application_receipts%ROWTYPE;
 held numeric;n numeric;place uuid;unused numeric;
BEGIN
 SELECT * INTO STRICT a FROM public.cash_funding_application_receipts WHERE pending_addon_id=NEW.pending_addon_id;
 SELECT * INTO STRICT f FROM public.cash_participant_funding_receipts WHERE id=a.funding_receipt_id;
 held:=public.fn_ca_promo_integrity_locked_at(f.funding_club_id,f.user_id,'pending_addon',NEW.pending_addon_id);
 IF held+NEW.principal_before>f.amount THEN RAISE EXCEPTION 'restricted_pending_principal_exceeds_original_funding'; END IF;
 n:=LEAST(held,GREATEST(a.applied-GREATEST(f.amount-NEW.principal_before-held,0),0));
 IF n>0 THEN
  SELECT s.table_id INTO STRICT place FROM public.table_seats s WHERE s.occupancy_id=a.applied_occupancy_id AND s.user_id=f.user_id;
  unused:=public.fn_ca_promo_integrity_move(f.funding_club_id,f.user_id,'pending_addon',NEW.pending_addon_id,'table_stack',place,n);
 END IF;
 unused:=public.fn_ca_promo_integrity_move(f.funding_club_id,f.user_id,'pending_addon',NEW.pending_addon_id,'player_wallet',f.user_id,held-n);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_on_pending() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER integrity_original_pending AFTER INSERT ON public.ca_promo_pending_custody_receipts
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_on_pending();
-- Freeze each actually retired grant's funding owner before the original
-- FIFO move closes it. Digest attribution never uses a later agent hierarchy.
CREATE FUNCTION public.fn_ca_promo_integrity_source_loss(p_hand uuid,p_club uuid,p_user uuid,p_place uuid,p_ids uuid[],p_loss numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF p_loss<=0 THEN RETURN; END IF;
 INSERT INTO public.ca_promo_integrity_source_grants
 SELECT p_hand,q.id,p_club,p_user,q.source_kind,q.funded_from_type,q.funded_from_id,q.amount,
  LEAST(q.amount,GREATEST(p_loss-q.preceding,0))
 FROM (SELECT g.id,g.source_kind,g.funded_from_type,g.funded_from_id,c.amount,
  COALESCE(sum(c.amount) OVER(ORDER BY g.granted_at,g.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) preceding
  FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE c.grant_id=ANY(p_ids) AND g.club_id=p_club AND g.user_id=p_user AND c.kind='table_stack'
   AND c.entity_id=p_place AND c.amount>0) q WHERE p_loss>q.preceding;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_source_loss(uuid,uuid,uuid,uuid,uuid[],numeric) FROM PUBLIC,anon,authenticated,service_role;
-- A release is a review decision, separate from the original grant's fee meter.
-- Both evidence and reviewer receipts stay immutable; only future play becomes
-- commission-eligible. No historical earning is repriced or paid a second time.
CREATE FUNCTION public.fn_ca_promo_integrity_release(p_case uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE me uuid:=auth.uid();k public.ca_promo_integrity_cases%ROWTYPE;prior public.ca_promo_integrity_releases%ROWTYPE;released numeric;
BEGIN
 IF me IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not Authenticated'); END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
  RETURN jsonb_build_object('success',false,'error','A Review Reason Is Required'); END IF;
 SELECT * INTO k FROM public.ca_promo_integrity_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.club_members m WHERE m.club_id=k.club_id AND m.user_id=me
  AND m.role IN('owner','co_owner','admin')) THEN
  RETURN jsonb_build_object('success',false,'error','Only The Club Owner Or An Admin May Release This Hold'); END IF;
 SELECT * INTO prior FROM public.ca_promo_integrity_releases WHERE case_id=p_case;
 IF FOUND THEN RETURN jsonb_build_object('success',true,'already_reviewed',true,'case_id',p_case,'released_amount',prior.released_amount); END IF;
 SELECT COALESCE(sum(amount),0) INTO released FROM public.ca_promo_integrity_custody WHERE case_id=p_case;
 INSERT INTO public.ca_promo_integrity_releases VALUES(p_case,me,btrim(p_reason),released,clock_timestamp());
 RETURN jsonb_build_object('success',true,'case_id',p_case,'released_amount',released);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_release(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_integrity_release(uuid,text) TO authenticated,service_role;

-- Run after the whole promo acceptance, before the existing fee consumer. All
-- inputs are the original money owner's independently accepted hand facts.
CREATE FUNCTION public.fn_ca_promo_integrity_accept_hand(p_hand uuid,p_table uuid,p_stacks jsonb,p_facts jsonb,
 p_places jsonb,p_bank_fee numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE request jsonb;prior jsonb;positions jsonb;r jsonb;s jsonb;k record;fund record;
 held numeric;promo_before numeric;promo_after numeric;ending numeric;starting numeric;investment numeric;
 lost numeric;forwarded numeric;unused numeric;place uuid;winner uuid;winner_place uuid;winner_club uuid;
 gain numeric;capacity numeric;safe_pair boolean;case_id uuid;donation numeric;exact_amount numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.tables WHERE id=p_table AND tournament_id IS NOT NULL) THEN RETURN; END IF;
 -- Retain only original monetary inputs, never the best-effort hand stats.
 request:=jsonb_build_object('table',p_table,'stacks',p_stacks,
  'facts',jsonb_build_object('contributions',p_facts->'contributions','returned_uncalled',p_facts->'returned_uncalled',
   'insurance_present',COALESCE(p_facts->'insurance','[]'::jsonb) NOT IN('[]'::jsonb,'null'::jsonb)),
  'places',p_places,'bank_fee',p_bank_fee);
 SELECT h.request INTO prior FROM public.ca_promo_integrity_hand_receipts h WHERE h.hand_id=p_hand;
 IF FOUND THEN
  IF prior IS DISTINCT FROM request THEN RAISE EXCEPTION 'original_integrity_hand_conflict'; END IF;
  RETURN;
 END IF;
 -- Ordinary unrestricted hands need no enduring integrity receipt.
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_custody h WHERE h.kind='table_stack'
   AND (h.entity_id=p_table OR h.entity_id IN(SELECT value::uuid FROM jsonb_each_text(p_places)))
   AND h.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases x WHERE x.case_id=h.case_id))
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_funding f WHERE f.hand_id=p_hand
   AND f.principal_lost>f.principal_before/2 AND f.principal_lost>0) THEN RETURN; END IF;
 IF p_bank_fee IS NULL OR p_bank_fee<0 OR p_bank_fee::text IN('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'original_integrity_bank_fee_required'; END IF;
 PERFORM 1 FROM public.ca_promo_integrity_cases c WHERE c.id IN(
  SELECT h.case_id FROM public.ca_promo_integrity_custody h WHERE h.kind='table_stack'
   AND (h.entity_id=p_table OR h.entity_id IN(SELECT value::uuid FROM jsonb_each_text(p_places))) AND h.amount>0)
  ORDER BY c.id FOR UPDATE;
 -- Freeze original H positions before any incoming winnings acquire a hold.
 SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO positions FROM (
  SELECT c.club_id,c.user_id,c.entity_id,sum(c.amount) AS amount
  FROM public.ca_promo_integrity_custody c
  WHERE c.kind='table_stack' AND (c.entity_id=p_table OR c.entity_id IN(SELECT value::uuid FROM jsonb_each_text(p_places)))
   AND c.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases x WHERE x.case_id=c.case_id)
  GROUP BY c.club_id,c.user_id,c.entity_id) q;
 SELECT (value->>'user_id')::uuid,(value->>'stack')::numeric-(value->>'stack_before')::numeric
 INTO winner,gain FROM jsonb_array_elements(p_stacks)
 WHERE (value->>'stack')::numeric>(value->>'stack_before')::numeric ORDER BY value->>'user_id' LIMIT 1;
 safe_pair:=jsonb_array_length(p_stacks)=2 AND gain>0
  AND COALESCE(p_facts->'insurance','[]'::jsonb) IN('[]'::jsonb,'null'::jsonb)
  AND (SELECT count(*) FROM jsonb_array_elements(p_stacks) WHERE (value->>'stack')::numeric>(value->>'stack_before')::numeric)=1
  AND (SELECT sum((value->>'stack')::numeric-(value->>'stack_before')::numeric) FROM jsonb_array_elements(p_stacks))=-p_bank_fee;
 winner_place:=COALESCE((p_places->>winner::text)::uuid,p_table);
 -- The original accepted provenance binds the recipient's actual funding
 -- club. Never infer a payer from current club membership or best-effort stats.
 SELECT min(f->>'funding_club_id')::uuid INTO winner_club
 FROM public.cash_hand_provenance_receipts h
 CROSS JOIN LATERAL jsonb_array_elements(h.participants) participant
 CROSS JOIN LATERAL jsonb_array_elements(participant->'funding_receipts') f
 WHERE h.hand_id=p_hand AND h.status='captured' AND h.all_players_included AND h.funding_provenance_complete
  AND participant->>'user_id'=winner::text
 HAVING count(DISTINCT f->>'funding_club_id')=1;
 safe_pair:=COALESCE(safe_pair,false) AND winner_club IS NOT NULL;
 capacity:=COALESCE(gain,0);
 FOR r IN SELECT value FROM jsonb_array_elements(positions) ORDER BY value->>'club_id',value->>'user_id' LOOP
  SELECT value INTO s FROM jsonb_array_elements(p_stacks) WHERE value->>'user_id'=r->>'user_id';
  IF s IS NULL THEN RAISE EXCEPTION 'held_original_hand_participant_missing'; END IF;
  place:=(r->>'entity_id')::uuid;held:=(r->>'amount')::numeric;
  starting:=(s->>'stack_before')::numeric;ending:=(s->>'stack')::numeric;
  SELECT COALESCE(f.principal_before,0) INTO promo_before FROM public.ca_promo_cash_hand_funding f
   WHERE f.hand_id=p_hand AND f.club_id=(r->>'club_id')::uuid AND f.user_id=(r->>'user_id')::uuid;
  promo_before:=COALESCE(promo_before,0);
  promo_after:=public.fn_ca_promo_locked_at((r->>'club_id')::uuid,(r->>'user_id')::uuid,'table_stack',place);
  IF held+promo_before>starting THEN RAISE EXCEPTION 'restricted_hand_principal_exceeds_original_stack'; END IF;
  investment:=GREATEST(COALESCE((p_facts->'contributions'->>(r->>'user_id'))::numeric,0)
   -COALESCE((p_facts->'returned_uncalled'->>(r->>'user_id'))::numeric,0),0);
  lost:=held-LEAST(held,GREATEST(ending-promo_after,0));
  INSERT INTO public.ca_promo_integrity_hand_funding VALUES(p_hand,(r->>'club_id')::uuid,(r->>'user_id')::uuid,place,
   investment,LEAST(held,GREATEST(investment-GREATEST(starting-promo_before-held,0),0)),held,lost);
  forwarded:=0;
  IF safe_pair AND (r->>'user_id')::uuid<>winner THEN
   forwarded:=LEAST(capacity,GREATEST(lost-p_bank_fee,0));
   unused:=public.fn_ca_promo_integrity_move((r->>'club_id')::uuid,(r->>'user_id')::uuid,'table_stack',place,
    'table_stack',winner_place,forwarded,winner_club,winner);
   capacity:=capacity-forwarded;
  END IF;
  unused:=public.fn_ca_promo_integrity_move((r->>'club_id')::uuid,(r->>'user_id')::uuid,'table_stack',place,NULL,NULL,lost-forwarded);
 END LOOP;
 FOR fund IN SELECT * FROM public.ca_promo_cash_hand_funding WHERE hand_id=p_hand
  AND principal_lost>principal_before/2 AND principal_lost>0 ORDER BY club_id,user_id LOOP
  FOR s IN SELECT value FROM jsonb_array_elements(p_stacks)
   WHERE (value->>'stack')::numeric>(value->>'stack_before')::numeric AND (value->>'user_id')::uuid<>fund.user_id LOOP
   donation:=GREATEST(fund.principal_lost-p_bank_fee,0);
   exact_amount:=CASE WHEN safe_pair AND (s->>'user_id')::uuid=winner THEN LEAST(capacity,donation) ELSE 0 END;
   INSERT INTO public.ca_promo_integrity_cases(hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence)
    VALUES(p_hand,fund.club_id,fund.user_id,COALESCE(winner_club,fund.club_id),(s->>'user_id')::uuid,exact_amount,
     jsonb_build_object('version',1,'source_principal_before',fund.principal_before,'source_principal_lost',fund.principal_lost,
      'bank_fee',p_bank_fee,'recipient_net_gain',(s->>'stack')::numeric-(s->>'stack_before')::numeric,
      'attribution',CASE WHEN safe_pair THEN 'provable_heads_up_lower_bound' ELSE 'evidence_only' END,
      'source_grants',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.grant_id),'[]') FROM public.ca_promo_integrity_source_grants x
        WHERE x.hand_id=p_hand AND x.club_id=fund.club_id AND x.user_id=fund.user_id),'accepted_request',request))
    RETURNING id INTO case_id;
   IF exact_amount>0 THEN
    INSERT INTO public.ca_promo_integrity_custody VALUES(case_id,winner_club,winner,'table_stack',winner_place,exact_amount);
    capacity:=capacity-exact_amount;
   END IF;
  END LOOP;
 END LOOP;
 INSERT INTO public.ca_promo_integrity_hand_receipts VALUES(p_hand,request);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_accept_hand(uuid,uuid,jsonb,jsonb,jsonb,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_integrity_guard_exit(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;held numeric;promo numeric;balance numeric;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.from_type NOT IN('player_wallet','agent_wallet') THEN RETURN; END IF;
 held:=public.fn_ca_promo_integrity_locked_at(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id);
 IF held<=0 THEN RETURN; END IF;
 promo:=public.fn_ca_promo_locked_at(l.club_id,l.from_entity_id,l.from_type,l.from_entity_id);
 IF l.from_type='agent_wallet' THEN
  SELECT agent_wallet_balance INTO balance FROM public.agents WHERE club_id=l.club_id AND user_id=l.from_entity_id;
 ELSE
  SELECT chip_balance INTO balance FROM public.club_members WHERE club_id=l.club_id AND user_id=l.from_entity_id;
 END IF;
 IF COALESCE(balance,0)<promo+held THEN
  RAISE EXCEPTION 'Integrity Review: % Chips Stay Held Until The Club Reviews Their Source.',trim(to_char(held,'FM999999999990.00'))
   USING ERRCODE='P0001',HINT='promo_integrity_review_hold';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_guard_exit(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $owners$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_play_through_on_exit()'::regprocedure) INTO def;
 needle:='IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_original_exit_anchor_changed'; END IF;
 EXECUTE replace(def,needle,E'PERFORM public.fn_ca_promo_integrity_guard_exit(NEW.id);\n '||needle);
 SELECT pg_get_functiondef('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure) INTO def;
 needle:='unused:=public.fn_ca_promo_move_selected_custody(r.club_id,r.user_id,''table_stack'',place,NULL,NULL,loss,''spent'',ids);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_original_grant_loss_anchor_changed'; END IF;
 EXECUTE replace(def,needle,E'PERFORM public.fn_ca_promo_integrity_source_loss(p_hand,r.club_id,r.user_id,place,ids,loss);\n   '||needle);
 SELECT pg_get_functiondef('public.fn_ca_promo_custody_on_ledger()'::regprocedure) INTO def;
 needle:='ELSIF NEW.category=''table_cashout'' THEN';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_table_cashout_anchor_changed'; END IF;
 EXECUTE replace(def,needle,needle||E'\n   PERFORM public.fn_ca_promo_integrity_move(NEW.club_id,uid,''table_stack'',NEW.from_entity_id,''player_wallet'',uid,NEW.amount);');
 SELECT pg_get_functiondef('public.fn_ca_commit_hand_settlement(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid,jsonb)'::regprocedure) INTO def;
 needle:='PERFORM public.fn_ca_promo_accept_cash_hand(v_hand_id,p_table_id,p_stacks,p_hand_row->''_accepted_post_commit_facts'',v_lightning_seats);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_accepted_hand_anchor_changed'; END IF;
 EXECUTE replace(def,needle,needle||E'\n    PERFORM public.fn_ca_promo_integrity_accept_hand(v_hand_id,p_table_id,p_stacks,p_hand_row->''_accepted_post_commit_facts'',v_lightning_seats,p_rake+p_bbj);');
END $owners$;
-- Active held principal retains its original funding character. This changes
-- earning eligibility only: it creates no promo grant or additional fee target.
DO $fee_owners$
DECLARE def text;needle text;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_capture_entry_funding(uuid,numeric)'::regprocedure) INTO def;
 needle:='IF starts IS NULL THEN RETURN; END IF;';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_entry_fee_anchor_changed'; END IF;
 def:=replace(def,needle,needle||E'\n p_promo_amount:=p_promo_amount+COALESCE((SELECT principal_moved FROM public.ca_promo_integrity_funding WHERE ledger_id=p_charge_ledger_id),0);');
 needle:='uid uuid;prior public.ca_promo_entry_fee_funding%ROWTYPE';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_entry_identity_declaration_changed'; END IF;
 def:=replace(def,needle,'uid uuid;earning_club uuid;prior public.ca_promo_entry_fee_funding%ROWTYPE');
 needle:=$identity$ IF l.from_type='player_wallet' AND l.category IN('tournament_buyin','tournament_rebuy','rebuy','reentry','addon') THEN uid:=l.from_entity_id;
 ELSIF l.from_type='escrow' AND l.category='ticket_redeem' THEN
  SELECT holder_id INTO uid FROM public.tournament_tickets WHERE id=l.from_entity_id AND club_id=l.club_id;
 ELSIF l.from_type='prize_liability' AND l.category='tournament_buyin' THEN uid:=NULLIF(l.metadata->>'user_id','')::uuid;
 END IF;
 IF uid IS NULL THEN RAISE EXCEPTION 'promo_entry_original_payer_missing' USING ERRCODE='23514'; END IF;$identity$;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_entry_identity_owner_changed'; END IF;
 def:=replace(def,needle,$identity$ IF NOT ((l.from_type='player_wallet' AND l.category IN('tournament_buyin','tournament_rebuy','rebuy','reentry','addon'))
  OR (l.from_type='escrow' AND l.category='ticket_redeem') OR (l.from_type='prize_liability' AND l.category='tournament_buyin')) THEN
  RAISE EXCEPTION 'promo_entry_original_payer_missing' USING ERRCODE='23514'; END IF;
 SELECT identity.club_id,identity.user_id INTO earning_club,uid FROM public.fn_ca_promo_entry_charge_identity(l.id) identity;
 IF earning_club IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'promo_entry_original_payer_missing' USING ERRCODE='23514'; END IF;$identity$);
 needle:='VALUES(l.id,l.club_id,uid,l.amount,p_promo_amount,l.created_at)';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_entry_identity_insert_changed'; END IF;
 def:=replace(def,needle,'VALUES(l.id,earning_club,uid,l.amount,p_promo_amount,l.created_at)');
 needle:='prior.club_id IS DISTINCT FROM l.club_id';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_entry_identity_replay_changed'; END IF;
 EXECUTE replace(def,needle,'prior.club_id IS DISTINCT FROM earning_club');
 SELECT pg_get_functiondef('public.fn_ca_promo_cash_payable_contract(uuid,uuid,uuid,jsonb)'::regprocedure) INTO def;
 needle:=E'SELECT contribution,promo_contribution INTO contributed,promo FROM public.ca_promo_cash_hand_funding\n  WHERE hand_id=r.hand_id AND club_id=p_club AND user_id=p_user;';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_cash_fee_anchor_changed'; END IF;
 EXECUTE replace(def,needle,$basis$SELECT COALESCE(p.contribution,h.contribution),COALESCE(p.promo_contribution,0)+COALESCE(h.held_contribution,0)
 INTO contributed,promo FROM
 (SELECT contribution,promo_contribution FROM public.ca_promo_cash_hand_funding WHERE hand_id=r.hand_id AND club_id=p_club AND user_id=p_user) p
 FULL JOIN
 (SELECT contribution,held_contribution FROM public.ca_promo_integrity_hand_funding WHERE hand_id=r.hand_id AND club_id=p_club AND user_id=p_user) h ON true;$basis$);
END $fee_owners$;
CREATE FUNCTION public.fn_ca_promo_integrity_record_event(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;r record;n numeric;uid uuid;scope_club uuid;captured numeric;prior numeric;total numeric:=0;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 SELECT identity.club_id,identity.user_id INTO scope_club,uid FROM public.fn_ca_promo_entry_charge_identity(l.id) identity;
 IF l.to_type<>'prize_liability' OR l.from_type NOT IN('player_wallet','agent_wallet','escrow','prize_liability')
  OR uid IS NULL OR scope_club IS NULL OR l.amount<=0 OR COALESCE(l.status,'posted')<>'posted' THEN RAISE EXCEPTION 'original_integrity_event_charge_required'; END IF;
 SELECT principal_moved INTO captured FROM public.ca_promo_integrity_funding WHERE ledger_id=l.id;
 IF captured IS NULL THEN RAISE EXCEPTION 'original_integrity_event_funding_required'; END IF;
 SELECT sum(original_amount) INTO prior FROM public.ca_promo_integrity_event_lots WHERE charge_ledger_id=l.id;
 IF prior IS NOT NULL THEN
  IF prior IS DISTINCT FROM captured THEN RAISE EXCEPTION 'original_integrity_event_slice_conflict'; END IF;PERFORM public.fn_ca_promo_integrity_consume_entry_fee(l.id);RETURN; END IF;
 FOR r IN SELECT c.* FROM public.ca_promo_integrity_custody c WHERE c.club_id=scope_club AND c.user_id=uid
  AND c.kind='event' AND c.entity_id=l.to_entity_id AND c.amount>0
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases x WHERE x.case_id=c.case_id) ORDER BY c.case_id LOOP
  SELECT r.amount-COALESCE(sum(x.remaining),0) INTO n FROM public.ca_promo_integrity_event_lots x
   WHERE x.case_id=r.case_id AND x.tournament_id=l.to_entity_id AND x.club_id=scope_club AND x.user_id=uid;
  IF n<0 THEN RAISE EXCEPTION 'integrity_event_lots_exceed_original_principal'; END IF;
  IF n>0 THEN INSERT INTO public.ca_promo_integrity_event_lots VALUES(r.case_id,l.id,l.to_entity_id,scope_club,uid,n,n);total:=total+n; END IF;
 END LOOP;
 IF total IS DISTINCT FROM captured OR total>l.amount THEN RAISE EXCEPTION 'original_integrity_event_slices_do_not_match_funding'; END IF;
 PERFORM public.fn_ca_promo_integrity_consume_entry_fee(l.id);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_record_event(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_integrity_realize_event(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;r record;remaining_credit numeric;n numeric;total numeric:=0;refund_id text;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_receipts WHERE ledger_id=l.id) THEN RETURN; END IF;
 IF l.from_type<>'prize_liability' OR l.to_type<>'player_wallet' OR l.amount<=0 THEN RAISE EXCEPTION 'original_integrity_event_credit_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_lots x WHERE x.tournament_id=l.from_entity_id AND x.club_id=l.club_id
  AND x.user_id=l.to_entity_id AND x.remaining>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id)) THEN
  INSERT INTO public.ca_promo_integrity_event_receipts VALUES(l.id,0);RETURN; END IF;
 remaining_credit:=l.amount-(SELECT principal FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id);
 IF remaining_credit IS NULL OR remaining_credit<0 THEN RAISE EXCEPTION 'original_promo_event_realization_required'; END IF;
 IF l.category IN('refund','tournament_refund') THEN
  refund_id:=NULLIF(current_setting('app.ca_promo_refund_entitlement',true),'');
  IF refund_id IS NULL THEN INSERT INTO public.ca_promo_integrity_event_receipts VALUES(l.id,0);RETURN; END IF;
  SELECT * INTO e FROM public.tournament_refund_entitlements WHERE id=refund_id::uuid;
  IF e.id IS NULL OR e.tournament_id IS DISTINCT FROM l.from_entity_id OR e.user_id IS DISTINCT FROM l.to_entity_id
   OR e.refund_wallet_club_id IS DISTINCT FROM l.club_id OR e.gross IS DISTINCT FROM l.amount THEN
   RAISE EXCEPTION 'integrity_refund_entitlement_does_not_match_credit'; END IF;
 END IF;
 PERFORM 1 FROM public.ca_promo_integrity_cases c WHERE c.id IN(
  SELECT x.case_id FROM public.ca_promo_integrity_event_lots x WHERE x.tournament_id=l.from_entity_id
   AND x.club_id=l.club_id AND x.user_id=l.to_entity_id AND x.remaining>0) ORDER BY c.id FOR UPDATE;
 FOR r IN SELECT x.* FROM public.ca_promo_integrity_event_lots x WHERE x.tournament_id=l.from_entity_id
  AND x.club_id=l.club_id AND x.user_id=l.to_entity_id AND x.remaining>0
  AND (e.id IS NULL OR x.charge_ledger_id=e.source_ledger_id)
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id)
  ORDER BY x.case_id,x.charge_ledger_id FOR UPDATE LOOP
  EXIT WHEN remaining_credit<=0;n:=LEAST(r.remaining,remaining_credit);
  UPDATE public.ca_promo_integrity_custody SET amount=amount-n WHERE case_id=r.case_id AND club_id=l.club_id
   AND user_id=l.to_entity_id AND kind='event' AND entity_id=l.from_entity_id AND amount>=n;
  IF NOT FOUND THEN RAISE EXCEPTION 'integrity_event_lot_has_no_original_principal'; END IF;
  INSERT INTO public.ca_promo_integrity_custody VALUES(r.case_id,l.club_id,l.to_entity_id,'player_wallet',l.to_entity_id,n)
   ON CONFLICT(case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_integrity_custody.amount+EXCLUDED.amount;
  UPDATE public.ca_promo_integrity_event_lots SET remaining=remaining-n WHERE case_id=r.case_id AND charge_ledger_id=r.charge_ledger_id;
  total:=total+n;remaining_credit:=remaining_credit-n;
 END LOOP;
 INSERT INTO public.ca_promo_integrity_event_receipts VALUES(l.id,total);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_realize_event(uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Entry fees are actual losses of their original funding character. Keep
-- the frozen gross ratio for earnings, but remove spent H from event custody.
CREATE FUNCTION public.fn_ca_promo_integrity_consume_entry_fee(p_charge uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE paid public.ca_promo_event_fee_consumption_receipts%ROWTYPE;
 h numeric;needed numeric;leftover numeric;n numeric;r record;total numeric:=0;
BEGIN
 SELECT held_fee INTO total FROM public.ca_promo_integrity_fee_spends WHERE charge_ledger_id=p_charge;
 IF FOUND THEN RETURN total; END IF;total:=0;
 -- The original exact-entitlement owner freezes price, P, earner and gross
 -- fee independently of earning agreements. Its callback runs P before H.
 SELECT * INTO paid FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=p_charge;
 IF NOT FOUND THEN RETURN 0; END IF;
 SELECT COALESCE(sum(original_amount),0) INTO h FROM public.ca_promo_integrity_event_lots WHERE charge_ledger_id=p_charge;
 IF h<=0 THEN RETURN 0; END IF;
 PERFORM 1 FROM public.tournament_refund_entitlements WHERE id=paid.entitlement_id FOR UPDATE;
 SELECT held_fee INTO total FROM public.ca_promo_integrity_fee_spends WHERE charge_ledger_id=p_charge;
 IF FOUND THEN RETURN total; END IF;total:=0;
 IF paid.original_promo+h>paid.charge_amount OR EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_lots x
  WHERE x.charge_ledger_id=p_charge AND (x.club_id IS DISTINCT FROM paid.club_id OR x.user_id IS DISTINCT FROM paid.player_id)) THEN RAISE EXCEPTION 'integrity_original_entry_fee_funding_invalid'; END IF;
 needed:=LEAST(h,GREATEST(round(paid.gross_fee*(paid.original_promo+h)/paid.charge_amount,2)-round(paid.gross_fee*paid.original_promo/paid.charge_amount,2),0));
 PERFORM 1 FROM public.ca_promo_integrity_cases k WHERE k.id IN(SELECT case_id FROM public.ca_promo_integrity_event_lots WHERE charge_ledger_id=p_charge) ORDER BY k.id FOR UPDATE;
 leftover:=needed;
 FOR r IN SELECT x.* FROM public.ca_promo_integrity_event_lots x WHERE x.charge_ledger_id=p_charge
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id) ORDER BY x.case_id FOR UPDATE LOOP
  EXIT WHEN leftover<=0;n:=LEAST(r.remaining,leftover);
  IF n>0 THEN
   UPDATE public.ca_promo_integrity_custody SET amount=amount-n WHERE case_id=r.case_id AND club_id=r.club_id AND user_id=r.user_id AND kind='event' AND entity_id=r.tournament_id AND amount>=n;
   IF NOT FOUND THEN RAISE EXCEPTION 'integrity_fee_has_no_original_event_principal'; END IF;
   UPDATE public.ca_promo_integrity_event_lots SET remaining=remaining-n WHERE case_id=r.case_id AND charge_ledger_id=p_charge;
   INSERT INTO public.ca_promo_integrity_fee_slices VALUES(p_charge,r.case_id,n);
   total:=total+n;leftover:=leftover-n;
  END IF;
 END LOOP;
 IF leftover>0 AND EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_lots x WHERE x.charge_ledger_id=p_charge
  AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id)) THEN RAISE EXCEPTION 'integrity_entry_fee_exceeds_surviving_original_principal'; END IF;
 INSERT INTO public.ca_promo_integrity_fee_spends VALUES(p_charge,paid.entitlement_id,paid.gross_fee,total);
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_consume_entry_fee(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_integrity_spend_entry_fee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_fee_spends WHERE charge_ledger_id=NEW.source_charge_ledger_id)
  AND EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_lots WHERE charge_ledger_id=NEW.source_charge_ledger_id) THEN RAISE EXCEPTION 'integrity_original_fee_expense_missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_integrity_fee_spends f WHERE f.charge_ledger_id=NEW.source_charge_ledger_id
  AND (f.entitlement_id IS DISTINCT FROM NEW.source_entitlement_id OR f.gross_fee IS DISTINCT FROM NEW.rake_credit)) THEN RAISE EXCEPTION 'integrity_canonical_fee_disagrees_with_original_charge'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_spend_entry_fee() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_integrity_entry_fee AFTER INSERT ON public.accounting_tournament_fee_sources
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_spend_entry_fee();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES('accounting_tournament_fee_sources','zzzz_integrity_entry_fee','Canonical earning capture verifies original exact-entitlement review-held fee consumption without spending it again.');
-- The original exact-refund owner invokes this before its wallet credit. No
-- released case can acquire a new restriction from a later refund.
CREATE FUNCTION public.fn_ca_promo_integrity_restore_event_fees(p_entitlement uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE e public.tournament_refund_entitlements%ROWTYPE;r record;total numeric:=0;
BEGIN
 SELECT * INTO STRICT e FROM public.tournament_refund_entitlements WHERE id=p_entitlement FOR UPDATE;
 IF e.source_ledger_id IS NULL OR (NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_fee_spends WHERE charge_ledger_id=e.source_ledger_id) AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_loss_slices WHERE charge_ledger_id=e.source_ledger_id)) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts f WHERE f.charge_ledger_id=e.source_ledger_id AND f.entitlement_id=e.id AND f.charge_amount=e.gross) THEN RAISE EXCEPTION 'integrity_full_original_entry_refund_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_integrity_fee_refunds WHERE entitlement_id=e.id) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_integrity_fee_refunds WHERE charge_ledger_id=e.source_ledger_id) THEN RAISE EXCEPTION 'integrity_entry_fee_already_refunded'; END IF;
 PERFORM 1 FROM public.ca_promo_integrity_cases k WHERE k.id IN(SELECT x.case_id FROM public.ca_promo_integrity_event_lots x WHERE x.charge_ledger_id=e.source_ledger_id) ORDER BY k.id FOR UPDATE;
 FOR r IN SELECT x.case_id,x.charge_ledger_id,sum(x.amount) amount,l.tournament_id,l.club_id,l.user_id
  FROM (SELECT charge_ledger_id,case_id,amount FROM public.ca_promo_integrity_fee_slices UNION ALL SELECT charge_ledger_id,case_id,amount FROM public.ca_promo_integrity_event_loss_slices) x JOIN public.ca_promo_integrity_event_lots l USING(case_id,charge_ledger_id)
  WHERE x.charge_ledger_id=e.source_ledger_id AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id)
  GROUP BY x.case_id,x.charge_ledger_id,l.tournament_id,l.club_id,l.user_id ORDER BY x.case_id LOOP
  IF r.tournament_id IS DISTINCT FROM e.tournament_id OR r.club_id IS DISTINCT FROM e.refund_wallet_club_id OR r.user_id IS DISTINCT FROM e.user_id THEN RAISE EXCEPTION 'integrity_fee_refund_original_payer_conflict'; END IF;
  UPDATE public.ca_promo_integrity_event_lots SET remaining=remaining+r.amount WHERE case_id=r.case_id AND charge_ledger_id=r.charge_ledger_id;
  INSERT INTO public.ca_promo_integrity_custody VALUES(r.case_id,r.club_id,r.user_id,'event',r.tournament_id,r.amount)
   ON CONFLICT(case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_integrity_custody.amount+EXCLUDED.amount;
  total:=total+r.amount;
 END LOOP;
 IF total>e.gross THEN RAISE EXCEPTION 'integrity_fee_refund_exceeds_original_credit'; END IF;
 INSERT INTO public.ca_promo_integrity_fee_refunds VALUES(e.id,e.source_ledger_id,total);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_restore_event_fees(uuid) FROM PUBLIC,anon,authenticated,service_role;
-- A later real reentry never inherits restrictions on an old, proved-lost
-- entry. The original owner supplies exact generation charge IDs and owed proof.
CREATE FUNCTION public.fn_ca_promo_integrity_retire_event_lots(p_tournament uuid,p_club uuid,p_user uuid,p_charges uuid[],p_kind text,p_source uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;
BEGIN
 IF p_kind NOT IN('busted','terminal') OR p_source IS NULL THEN RAISE EXCEPTION 'original_integrity_loss_receipt_required'; END IF;
 PERFORM 1 FROM public.ca_promo_integrity_cases k WHERE k.id IN(SELECT case_id FROM public.ca_promo_integrity_event_lots
  WHERE tournament_id=p_tournament AND club_id=p_club AND user_id=p_user AND charge_ledger_id=ANY(p_charges) AND remaining>0) ORDER BY k.id FOR UPDATE;
 FOR r IN SELECT x.* FROM public.ca_promo_integrity_event_lots x WHERE x.tournament_id=p_tournament AND x.club_id=p_club
  AND x.user_id=p_user AND x.charge_ledger_id=ANY(p_charges) AND x.remaining>0 ORDER BY x.case_id,x.charge_ledger_id FOR UPDATE LOOP
  IF NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=r.case_id) THEN
   UPDATE public.ca_promo_integrity_custody SET amount=amount-r.remaining WHERE case_id=r.case_id AND club_id=p_club
    AND user_id=p_user AND kind='event' AND entity_id=p_tournament AND amount>=r.remaining;
   IF NOT FOUND THEN RAISE EXCEPTION 'integrity_lost_entry_has_no_original_principal'; END IF;
   INSERT INTO public.ca_promo_integrity_event_loss_slices VALUES(r.charge_ledger_id,r.case_id,p_kind,p_source,r.remaining);
  END IF;
  UPDATE public.ca_promo_integrity_event_lots SET remaining=0 WHERE case_id=r.case_id AND charge_ledger_id=r.charge_ledger_id;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_retire_event_lots(uuid,uuid,uuid,uuid[],text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_integrity_on_entry_loss() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 PERFORM public.fn_ca_promo_integrity_retire_event_lots(NEW.tournament_id,NEW.club_id,NEW.user_id,NEW.charge_ledger_ids,'busted',NEW.candidate_id);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_on_entry_loss() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER integrity_original_entry_loss AFTER INSERT ON public.ca_promo_event_entry_loss_receipts
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_on_entry_loss();
CREATE FUNCTION public.fn_ca_promo_integrity_finish_event(p_tournament uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT club_id,user_id,array_agg(DISTINCT charge_ledger_id) charges FROM public.ca_promo_integrity_event_lots
  WHERE tournament_id=p_tournament AND remaining>0 GROUP BY club_id,user_id ORDER BY club_id,user_id LOOP
  PERFORM public.fn_ca_promo_integrity_retire_event_lots(p_tournament,r.club_id,r.user_id,r.charges,'terminal',p_tournament);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_finish_event(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $events$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_custody_on_ledger()'::regprocedure) INTO def;
 needle:='PERFORM public.fn_ca_promo_realize_event_principal(NEW.id);';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_event_realization_anchor_changed'; END IF;
 EXECUTE replace(def,needle,needle||E'\n PERFORM public.fn_ca_promo_integrity_realize_event(NEW.id);');
 SELECT pg_get_functiondef('public.fn_ca_promo_finish_event_principal()'::regprocedure) INTO def;
 needle:=E'RETURN NULL;\nEND';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_event_terminal_anchor_changed'; END IF;
 EXECUTE replace(def,needle,E'PERFORM public.fn_ca_promo_integrity_finish_event(NEW.id);\n '||needle);
END $events$;
-- Earned qualifier capabilities retain the source cases through the same
-- original non-wallet owner. Purchased/sent tickets still require cashable
-- wallet funds, so this does not create a new promo-ticket purchase route.
CREATE FUNCTION public.fn_ca_promo_integrity_roll_source(p_ledger uuid,p_user uuid,p_promo numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;r record;held numeric;remaining_credit numeric;n numeric;total numeric:=0;
 destination text;source_principal numeric;scope_club uuid;scope_user uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_integrity_funding WHERE ledger_id=p_ledger) THEN RETURN; END IF;
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.metadata->>'user_id' IS DISTINCT FROM p_user::text OR l.amount<=0 OR p_promo<0 OR p_promo>l.amount
  OR l.to_type NOT IN('prize_liability','escrow') THEN RAISE EXCEPTION 'original_integrity_roll_owner_required'; END IF;
 destination:=CASE l.to_type WHEN 'escrow' THEN 'ticket' ELSE 'event' END;
 IF destination='event' THEN SELECT identity.club_id,identity.user_id INTO scope_club,scope_user FROM public.fn_ca_promo_entry_charge_identity(l.id) identity;
 ELSE SELECT club_id,user_id INTO scope_club,scope_user FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id; END IF;
 IF scope_club IS NULL OR scope_user IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'original_integrity_roll_earning_scope_required'; END IF;
 remaining_credit:=l.amount-p_promo;
 IF l.from_type='escrow' AND l.to_type='prize_liability' AND l.category='ticket_redeem' THEN
  IF NOT EXISTS(SELECT 1 FROM public.tournament_tickets t WHERE t.id=l.from_entity_id AND t.holder_id=p_user AND t.club_id=l.club_id) THEN
   RAISE EXCEPTION 'original_integrity_ticket_holder_required'; END IF;
  SELECT COALESCE(sum(original_amount),0) INTO source_principal FROM public.ca_promo_event_principal_lots WHERE charge_ledger_id=l.id;
  IF source_principal IS DISTINCT FROM p_promo THEN RAISE EXCEPTION 'original_integrity_ticket_promo_slice_required'; END IF;
  held:=public.fn_ca_promo_integrity_locked_at(scope_club,p_user,'ticket',l.from_entity_id);
  total:=public.fn_ca_promo_integrity_move(scope_club,p_user,'ticket',l.from_entity_id,'event',l.to_entity_id,LEAST(held,remaining_credit));
 ELSIF l.from_type='prize_liability' AND ((l.to_type='prize_liability' AND l.category='tournament_buyin') OR (l.to_type='escrow' AND l.category='ticket_issue')) THEN
  SELECT principal INTO source_principal FROM public.ca_promo_event_realization_receipts WHERE ledger_id=l.id;
  IF source_principal IS DISTINCT FROM p_promo THEN RAISE EXCEPTION 'original_integrity_event_promo_slice_required'; END IF;
  IF destination='ticket' AND NOT EXISTS(SELECT 1 FROM public.tournament_tickets t WHERE t.id=l.to_entity_id AND t.holder_id=p_user AND t.club_id=l.club_id) THEN
   RAISE EXCEPTION 'original_integrity_awarded_ticket_holder_required'; END IF;
  PERFORM 1 FROM public.ca_promo_integrity_cases c WHERE c.id IN(
   SELECT x.case_id FROM public.ca_promo_integrity_event_lots x WHERE x.tournament_id=l.from_entity_id
    AND x.club_id=scope_club AND x.user_id=p_user AND x.remaining>0) ORDER BY c.id FOR UPDATE;
  held:=public.fn_ca_promo_integrity_locked_at(scope_club,p_user,'event',l.from_entity_id);
  FOR r IN SELECT x.* FROM public.ca_promo_integrity_event_lots x WHERE x.tournament_id=l.from_entity_id
   AND x.club_id=scope_club AND x.user_id=p_user AND x.remaining>0
   AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases z WHERE z.case_id=x.case_id)
   ORDER BY x.case_id,x.charge_ledger_id FOR UPDATE LOOP
   EXIT WHEN remaining_credit<=0;n:=LEAST(r.remaining,remaining_credit);
   UPDATE public.ca_promo_integrity_custody SET amount=amount-n WHERE case_id=r.case_id AND club_id=scope_club AND user_id=p_user
    AND kind='event' AND entity_id=l.from_entity_id AND amount>=n;
   IF NOT FOUND THEN RAISE EXCEPTION 'integrity_roll_has_no_original_principal'; END IF;
   INSERT INTO public.ca_promo_integrity_custody VALUES(r.case_id,scope_club,p_user,destination,l.to_entity_id,n)
    ON CONFLICT(case_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_integrity_custody.amount+EXCLUDED.amount;
   UPDATE public.ca_promo_integrity_event_lots SET remaining=remaining-n WHERE case_id=r.case_id AND charge_ledger_id=r.charge_ledger_id;
   total:=total+n;remaining_credit:=remaining_credit-n;
  END LOOP;
 ELSE RAISE EXCEPTION 'unsupported_original_integrity_roll';
 END IF;
 INSERT INTO public.ca_promo_integrity_funding VALUES(l.id,held,total);
 IF destination='event' THEN PERFORM public.fn_ca_promo_integrity_record_event(l.id); END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_roll_source(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;
DO $roll_owner$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_nonwallet_entry()'::regprocedure) INTO def;
 needle:='PERFORM public.fn_ca_promo_capture_entry_funding(NEW.id,promo);';
 IF length(def)-length(replace(def,needle,''))<>2*length(needle) THEN RAISE EXCEPTION 'integrity_nonwallet_fee_anchor_changed'; END IF;
 def:=replace(def,needle,E'PERFORM public.fn_ca_promo_integrity_roll_source(NEW.id,uid,promo);\n  '||needle);
 needle:='promo:=public.fn_ca_promo_roll_event_principal(NEW.id,uid,''ticket'');';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_earned_ticket_anchor_changed'; END IF;
 EXECUTE replace(def,needle,needle||E'\n  PERFORM public.fn_ca_promo_integrity_roll_source(NEW.id,uid,promo);');
END $roll_owner$;
CREATE FUNCTION public.fn_ca_promo_integrity_read(p_club uuid,p_user uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE me uuid:=auth.uid();target uuid;manager boolean;cases jsonb;
BEGIN
 IF me IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not Authenticated'); END IF;
 target:=COALESCE(p_user,me);
 SELECT EXISTS(SELECT 1 FROM public.club_members WHERE club_id=p_club AND user_id=me
  AND role IN('owner','co_owner','admin')) INTO manager;
 IF NOT EXISTS(SELECT 1 FROM public.club_members WHERE club_id=p_club AND user_id=me) OR (target<>me AND NOT manager) THEN
  RETURN jsonb_build_object('success',false,'error','Not Authorized'); END IF;
 SELECT COALESCE(jsonb_agg(q.value ORDER BY q.created_at,q.id),'[]') INTO cases FROM (
  SELECT k.id,k.created_at,jsonb_build_object('case_id',k.id,'created_at',k.created_at,'original_amount',k.amount,
   'review_club_id',k.club_id,'can_release',EXISTS(SELECT 1 FROM public.club_members m WHERE m.club_id=k.club_id
     AND m.user_id=me AND m.role IN('owner','co_owner','admin')),
   'held',(SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_integrity_custody c
     WHERE c.case_id=k.id AND c.club_id=p_club AND c.user_id=target AND c.amount>0),
   'status','pending_review','reason','Promo Source Review',
   'evidence',CASE WHEN manager THEN k.evidence-'accepted_request' ELSE NULL END) value
  FROM public.ca_promo_integrity_cases k JOIN (
   SELECT id FROM public.ca_promo_integrity_cases WHERE club_id=p_club AND recipient_id=target
   UNION SELECT case_id FROM public.ca_promo_integrity_custody WHERE club_id=p_club AND user_id=target AND amount>0
  ) selected ON selected.id=k.id
  WHERE NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases x WHERE x.case_id=k.id)) q;
 RETURN jsonb_build_object('success',true,'club_id',p_club,'user_id',target,'cases',cases,
  'wallet_held',public.fn_ca_promo_integrity_locked_at(p_club,target,'player_wallet',target),
  'agent_held',public.fn_ca_promo_integrity_locked_at(p_club,target,'agent_wallet',target));
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_read(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_integrity_read(uuid,uuid) TO authenticated,service_role;
DO $summary$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_promo_play_through_summary(uuid,uuid)'::regprocedure) INTO def;
 needle:='''cashable'', GREATEST(v_balance - public.fn_ca_promo_locked_at(p_club_id,p_user_id,''player_wallet'',p_user_id),0),';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'integrity_cashable_summary_anchor_changed'; END IF;
 EXECUTE replace(def,needle,E'''cashable'', GREATEST(v_balance - public.fn_ca_promo_locked_at(p_club_id,p_user_id,''player_wallet'',p_user_id)-public.fn_ca_promo_integrity_locked_at(p_club_id,p_user_id,''player_wallet'',p_user_id),0),\n    ''integrity_held'',public.fn_ca_promo_integrity_locked_at(p_club_id,p_user_id,''player_wallet'',p_user_id),\n    ''agent_integrity_held'',public.fn_ca_promo_integrity_locked_at(p_club_id,p_user_id,''agent_wallet'',p_user_id),\n    ''integrity_total_held'',(SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_integrity_custody c WHERE c.club_id=p_club_id AND c.user_id=p_user_id AND c.amount>0 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_integrity_releases r WHERE r.case_id=c.case_id)),');
END $summary$;
CREATE FUNCTION public.fn_ca_promo_integrity_is_conserved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE original numeric;held numeric;
BEGIN
 SELECT amount INTO original FROM public.ca_promo_integrity_cases WHERE id=NEW.case_id;
 SELECT COALESCE(sum(amount),0) INTO held FROM public.ca_promo_integrity_custody WHERE case_id=NEW.case_id;
 IF original IS NULL OR held>original THEN RAISE EXCEPTION 'integrity_principal_is_not_conserved' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_integrity_is_conserved() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER integrity_principal_conserved AFTER INSERT OR UPDATE ON public.ca_promo_integrity_custody
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_is_conserved();

COMMIT;
