-- @install-window: daily-maintenance
-- @locks: public.ca_promo_event_fee_consumption_receipts, public.ca_promo_free_buy_funding_slices, public.tournament_obligations, public.tournament_participant_funding_receipts
-- @live-proof: to_regprocedure('public.fn_ca_promo_profit_bind_earning_ledger(uuid)') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_obligations'::regclass AND tgname='zzzz_promo_original_obligation_earning' AND tgenabled='O')
-- Version reserved by scripts/new-migration.mjs against remote versions.
-- Preserve original financial owners. Snapshot entry generation, exact original
-- earning-hand charge prefix and cumulative owed ranges before later reentry or
-- addon. Credit tranches carry weighted source slices; no event-wide ratio can
-- let an old owed bounty consume unrelated new-entry cash or its prize.
-- Pure pre-programme earnings remain unrestricted. This is source metadata,
-- never a second payment/fee owner, a balance inference or a repair process.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NULL) THEN
  RAISE EXCEPTION 'original tournament earning producers must install before activation';
 END IF;
END $$;
CREATE TABLE public.ca_promo_profit_event_generations (
 id uuid PRIMARY KEY,registration_id uuid NOT NULL,tournament_id uuid NOT NULL,user_id uuid NOT NULL,earning_club_id uuid NOT NULL,
 candidate_id uuid UNIQUE,prior_generation_id uuid REFERENCES public.ca_promo_profit_event_generations(id),
 operation_ref text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(registration_id,operation_ref)
);
CREATE TABLE public.ca_promo_profit_generation_heads (
 registration_id uuid PRIMARY KEY,generation_id uuid NOT NULL REFERENCES public.ca_promo_profit_event_generations(id)
);
CREATE TABLE public.ca_promo_profit_charge_generations (
 charge_ledger_id uuid NOT NULL,registration_id uuid NOT NULL,generation_id uuid NOT NULL REFERENCES public.ca_promo_profit_event_generations(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(charge_ledger_id,registration_id)
);
CREATE INDEX ca_promo_profit_generation_charges ON public.ca_promo_profit_charge_generations(generation_id,recorded_at,charge_ledger_id);
CREATE TABLE public.ca_promo_profit_tournament_hand_clocks (
 hand_id uuid PRIMARY KEY,table_id uuid NOT NULL,tournament_id uuid NOT NULL,hand_number bigint NOT NULL,
 earned_at timestamptz NOT NULL,participant_ids uuid[] NOT NULL,participant_scope jsonb NOT NULL
);
CREATE TABLE public.ca_promo_profit_tournament_hand_sources (
 hand_id uuid NOT NULL REFERENCES public.ca_promo_profit_tournament_hand_clocks(hand_id),user_id uuid NOT NULL,
 earning_club_id uuid NOT NULL,generation_id uuid NOT NULL REFERENCES public.ca_promo_profit_event_generations(id),
 charge_ledger_ids uuid[] NOT NULL,PRIMARY KEY(hand_id,user_id)
);
CREATE TABLE public.ca_promo_profit_obligation_earnings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_ref text UNIQUE,obligation_id uuid,tournament_id uuid NOT NULL,user_id uuid NOT NULL,
 earning_club_id uuid NOT NULL,generation_id uuid REFERENCES public.ca_promo_profit_event_generations(id),
 charge_ledger_ids uuid[] NOT NULL,amount_from numeric NOT NULL,amount_to numeric NOT NULL,
 source_kind text NOT NULL,source_bounty_obligation_id uuid,earned_at timestamptz NOT NULL,
 CHECK(amount_from>=0 AND amount_to>amount_from AND amount_from=round(amount_from,2) AND amount_to=round(amount_to,2) AND amount_from::text NOT IN('NaN','Infinity','-Infinity') AND amount_to::text NOT IN('NaN','Infinity','-Infinity')),
 UNIQUE(obligation_id,amount_from),UNIQUE(obligation_id,amount_to)
);
CREATE INDEX ca_promo_profit_owed_earning ON public.ca_promo_profit_obligation_earnings(obligation_id,amount_from,amount_to);
CREATE TABLE public.ca_promo_profit_earning_sources (
 source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_ref text NOT NULL UNIQUE,tournament_id uuid NOT NULL,user_id uuid NOT NULL,
 earning_club_id uuid NOT NULL,generation_id uuid REFERENCES public.ca_promo_profit_event_generations(id),
 charge_ledger_ids uuid[] NOT NULL,amount numeric NOT NULL,source_kind text NOT NULL,source_obligation_id uuid,
 earned_at timestamptz NOT NULL,CHECK(amount>0 AND amount=round(amount,2) AND amount::text NOT IN('NaN','Infinity','-Infinity'))
);
CREATE TABLE public.ca_promo_profit_earning_source_slices (
 source_id uuid NOT NULL REFERENCES public.ca_promo_profit_earning_sources(source_id),
 earning_receipt_id uuid NOT NULL REFERENCES public.ca_promo_profit_obligation_earnings(id),
 amount numeric NOT NULL CHECK(amount>0 AND amount=round(amount,2) AND amount::text NOT IN('NaN','Infinity','-Infinity')),
 charge_ledger_ids uuid[] NOT NULL,generation_id uuid REFERENCES public.ca_promo_profit_event_generations(id),
 PRIMARY KEY(source_id,earning_receipt_id)
);
CREATE TABLE public.ca_promo_profit_earning_credit_links (
 ledger_id uuid PRIMARY KEY,source_id uuid NOT NULL UNIQUE REFERENCES public.ca_promo_profit_earning_sources(source_id)
);
CREATE FUNCTION public.fn_ca_promo_profit_generation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'original_tournament_earning_evidence_is_immutable' USING ERRCODE='23514';END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_generation_immutable() FROM PUBLIC,anon,authenticated,service_role;
DO $protect$ DECLARE rel text;BEGIN
 FOREACH rel IN ARRAY ARRAY['ca_promo_profit_event_generations','ca_promo_profit_generation_heads','ca_promo_profit_charge_generations','ca_promo_profit_tournament_hand_clocks','ca_promo_profit_tournament_hand_sources','ca_promo_profit_obligation_earnings','ca_promo_profit_earning_sources','ca_promo_profit_earning_source_slices','ca_promo_profit_earning_credit_links'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',rel);
  EXECUTE format('GRANT SELECT ON public.%I TO service_role',rel);
  IF rel<>'ca_promo_profit_generation_heads' THEN
   EXECUTE format('CREATE TRIGGER original_earning_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_generation_immutable()',rel);
  END IF;
  EXECUTE format('CREATE TRIGGER original_earning_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_profit_generation_immutable()',rel);
 END LOOP;
END $protect$;

CREATE FUNCTION public.fn_ca_promo_profit_initial_generation(p_registration uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r public.tournament_players%ROWTYPE;g public.ca_promo_profit_event_generations%ROWTYPE;
BEGIN
 SELECT * INTO g FROM public.ca_promo_profit_event_generations WHERE id=p_registration;
 IF FOUND THEN RETURN g.id;END IF;
 SELECT * INTO STRICT r FROM public.tournament_players WHERE id=p_registration;
 IF r.club_id IS NULL THEN RAISE EXCEPTION 'original_tournament_earning_club_missing';END IF;
 INSERT INTO public.ca_promo_profit_event_generations(id,registration_id,tournament_id,user_id,earning_club_id,operation_ref)
 VALUES(r.id,r.id,r.tournament_id,r.user_id,r.club_id,'registration:'||r.id) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.ca_promo_profit_generation_heads VALUES(r.id,r.id) ON CONFLICT(registration_id) DO NOTHING;
 RETURN r.id;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_initial_generation(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Called only at the original validated non-addon admission boundary. Its
-- context is evidence only after an actual charge or successful original core.
CREATE FUNCTION public.fn_ca_promo_profit_admission_context(p_tournament uuid,p_user uuid,p_candidate uuid,p_operation text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r public.tournament_players%ROWTYPE;c public.tournament_knockout_candidates%ROWTYPE;initial uuid;
BEGIN
 IF p_operation IS NULL OR btrim(p_operation)='' THEN RAISE EXCEPTION 'original_entry_generation_operation_missing';END IF;
 SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=p_tournament AND user_id=p_user;
 SELECT * INTO STRICT c FROM public.tournament_knockout_candidates WHERE id=p_candidate;
 IF c.tournament_id IS DISTINCT FROM p_tournament OR c.eliminated_user_id IS DISTINCT FROM p_user OR c.stack_after IS DISTINCT FROM 0
 OR c.state NOT IN('pending','eliminated') OR r.chips>0 OR r.prize>0 THEN RAISE EXCEPTION 'original_entry_generation_candidate_mismatch';END IF;
 initial:=public.fn_ca_promo_profit_initial_generation(r.id);
 RETURN jsonb_build_object('registration_id',r.id,'tournament_id',p_tournament,'user_id',p_user,'candidate_id',p_candidate,'operation_ref',p_operation)::text;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_admission_context(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_apply_generation(p_registration uuid,p_context jsonb DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r public.tournament_players%ROWTYPE;prior uuid;gid uuid;existing public.ca_promo_profit_event_generations%ROWTYPE;
BEGIN
 PERFORM public.fn_ca_promo_profit_initial_generation(p_registration);
 SELECT * INTO STRICT r FROM public.tournament_players WHERE id=p_registration;
 SELECT generation_id INTO STRICT prior FROM public.ca_promo_profit_generation_heads WHERE registration_id=p_registration FOR UPDATE;
 IF p_context IS NULL THEN RETURN prior;END IF;
 IF p_context->>'registration_id' IS DISTINCT FROM r.id::text OR p_context->>'tournament_id' IS DISTINCT FROM r.tournament_id::text
 OR p_context->>'user_id' IS DISTINCT FROM r.user_id::text THEN RAISE EXCEPTION 'original_entry_generation_scope_mismatch';END IF;
 gid:=(p_context->>'candidate_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_knockout_candidates c WHERE c.id=gid AND c.tournament_id=r.tournament_id AND c.eliminated_user_id=r.user_id AND c.stack_after=0 AND c.state IN('pending','eliminated','rebought')) THEN RAISE EXCEPTION 'original_entry_generation_candidate_missing';END IF;
 SELECT * INTO existing FROM public.ca_promo_profit_event_generations WHERE id=gid;
 IF FOUND THEN
  IF ROW(existing.registration_id,existing.tournament_id,existing.user_id,existing.operation_ref) IS DISTINCT FROM ROW(r.id,r.tournament_id,r.user_id,p_context->>'operation_ref') THEN RAISE EXCEPTION 'original_entry_generation_identity_reused';END IF;
  IF prior<>gid THEN RAISE EXCEPTION 'original_entry_generation_replay_cannot_rewind';END IF;
  RETURN gid;
 END IF;
 INSERT INTO public.ca_promo_profit_event_generations(id,registration_id,tournament_id,user_id,earning_club_id,candidate_id,prior_generation_id,operation_ref)
 VALUES(gid,r.id,r.tournament_id,r.user_id,r.club_id,gid,prior,p_context->>'operation_ref');
 UPDATE public.ca_promo_profit_generation_heads SET generation_id=gid WHERE registration_id=r.id;
 RETURN gid;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_apply_generation(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_record_charge_generation(p_charge uuid,p_registration uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE f public.ca_promo_event_fee_consumption_receipts%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;r public.tournament_players%ROWTYPE;gid uuid;ctx jsonb;prior uuid;registration uuid:=p_registration;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN RETURN NULL;END IF;
 SELECT * INTO f FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=p_charge;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO STRICT e FROM public.tournament_refund_entitlements WHERE id=f.entitlement_id AND source_ledger_id=f.charge_ledger_id;
 ctx:=NULLIF(current_setting('app.ca_promo_profit_admission',true),'')::jsonb;
 IF registration IS NOT NULL AND e.registration_id IS NOT NULL AND registration<>e.registration_id THEN RAISE EXCEPTION 'original_charge_registration_witness_conflicts';END IF;
 registration:=COALESCE(registration,e.registration_id,(ctx->>'registration_id')::uuid);
 IF registration IS NULL THEN SELECT tp.id INTO registration FROM public.tournament_players tp WHERE tp.tournament_id=e.tournament_id AND tp.user_id=e.user_id AND tp.club_id=f.club_id;END IF;
 IF registration IS NULL THEN
  SELECT p.registration_id INTO registration FROM public.tournament_participant_funding_receipts p WHERE p.ledger_id=p_charge AND p.entitlement_id=e.id;
 END IF;
 -- An initial wallet charge precedes its original registration/funding
 -- recorder. The other original rendezvous must complete this same charge.
 IF registration IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT r FROM public.tournament_players WHERE id=registration AND tournament_id=e.tournament_id AND user_id=e.user_id AND club_id=f.club_id;
 SELECT generation_id INTO prior FROM public.ca_promo_profit_charge_generations WHERE charge_ledger_id=p_charge AND registration_id=registration;
 IF FOUND THEN
  IF ctx IS NOT NULL AND ctx->>'candidate_id' IS DISTINCT FROM prior::text THEN RAISE EXCEPTION 'original_charge_generation_intent_reused';END IF;
  RETURN prior;
 END IF;
 gid:=public.fn_ca_promo_profit_apply_generation(registration,ctx);
 INSERT INTO public.ca_promo_profit_charge_generations(charge_ledger_id,registration_id,generation_id) VALUES(p_charge,registration,gid);
 IF e.refund_bounty>0 THEN
  INSERT INTO public.ca_promo_profit_head_components(operation_ref,tournament_id,user_id,head_generation_id,generation_id,earning_club_id,charge_ledger_ids,amount,source_kind,earned_at)
  VALUES('bought_head:'||p_charge,e.tournament_id,e.user_id,gid,gid,f.club_id,ARRAY[p_charge],e.refund_bounty,'bought_head',f.earned_at);
 END IF;
 RETURN gid;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_record_charge_generation(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.fn_ca_promo_profit_assign_charge() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN PERFORM public.fn_ca_promo_profit_record_charge_generation(NEW.charge_ledger_id);RETURN NULL;END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_assign_charge() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_promo_original_entry_generation AFTER INSERT ON public.ca_promo_event_fee_consumption_receipts FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_assign_charge();
CREATE FUNCTION public.fn_ca_promo_profit_funding_generation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF NEW.asset='chips' AND NEW.amount>0 THEN
  IF NEW.registration_id IS NULL OR NEW.ledger_id IS NULL OR NEW.entitlement_id IS NULL
   OR NEW.registration_snapshot->>'id' IS DISTINCT FROM NEW.registration_id::text
   OR NEW.registration_snapshot->>'user_id' IS DISTINCT FROM NEW.user_id::text
   OR NEW.registration_snapshot->>'tournament_id' IS DISTINCT FROM NEW.tournament_id::text THEN RAISE EXCEPTION 'original_participant_funding_generation_witness_invalid';END IF;
  PERFORM public.fn_ca_promo_profit_record_charge_generation(NEW.ledger_id,NEW.registration_id);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_funding_generation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_promo_original_participant_generation AFTER INSERT ON public.tournament_participant_funding_receipts FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_funding_generation();
CREATE FUNCTION public.fn_ca_promo_profit_charge_generation_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_charge_generations WHERE charge_ledger_id=NEW.charge_ledger_id) THEN
  RAISE EXCEPTION 'original_paid_charge_generation_not_recorded';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_charge_generation_complete() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER original_paid_charge_generation_complete AFTER INSERT ON public.ca_promo_event_fee_consumption_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_charge_generation_complete();

CREATE FUNCTION public.fn_ca_promo_profit_assign_free_buy_face() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE gid uuid;prior uuid;
BEGIN
 gid:=public.fn_ca_promo_profit_initial_generation(NEW.registration_id);
 INSERT INTO public.ca_promo_profit_charge_generations(charge_ledger_id,registration_id,generation_id) VALUES(NEW.ledger_id,NEW.registration_id,gid) ON CONFLICT DO NOTHING;
 SELECT generation_id INTO STRICT prior FROM public.ca_promo_profit_charge_generations WHERE charge_ledger_id=NEW.ledger_id AND registration_id=NEW.registration_id;
 IF prior<>gid THEN RAISE EXCEPTION 'original_free_buy_face_generation_reused';END IF;
 IF EXISTS(SELECT 1 FROM public.chip_ledger WHERE id=NEW.ledger_id AND metadata->>'kind'='midway_free_buy_promo_head' AND metadata->>'registration_id'=NEW.registration_id::text AND (metadata->>'bounty_part')::numeric>0) THEN
  INSERT INTO public.ca_promo_profit_head_components(operation_ref,tournament_id,user_id,head_generation_id,generation_id,earning_club_id,charge_ledger_ids,amount,source_kind,earned_at)
  SELECT 'free_buy_head:'||NEW.ledger_id||':'||NEW.registration_id,g.tournament_id,g.user_id,g.id,g.id,g.earning_club_id,ARRAY[NEW.ledger_id],NEW.amount,'free_buy_head',clock_timestamp() FROM public.ca_promo_profit_event_generations g WHERE g.id=gid;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_assign_free_buy_face() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER zzzz_promo_original_free_buy_generation AFTER INSERT ON public.ca_promo_free_buy_funding_slices FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_assign_free_buy_face();

CREATE FUNCTION public.fn_ca_promo_profit_capture_tournament_hand(p_hand uuid,p_table uuid,p_stacks jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE h public.hand_atomic_commits%ROWTYPE;tournament uuid;s jsonb;r public.tournament_players%ROWTYPE;gid uuid;ids uuid[];participants uuid[];scope jsonb:='{}';active boolean;extra boolean;prior public.ca_promo_profit_tournament_hand_clocks%ROWTYPE;
BEGIN
 SELECT tournament_id INTO tournament FROM public.tables WHERE id=p_table;
 IF tournament IS NULL OR NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN RETURN;END IF;
 SELECT * INTO STRICT h FROM public.hand_atomic_commits WHERE hand_id=p_hand AND table_id=p_table;
 IF jsonb_typeof(p_stacks)<>'array' OR jsonb_typeof(h.stack_result->'written')<>'object' THEN RAISE EXCEPTION 'original_tournament_earning_hand_incomplete';END IF;
 SELECT array_agg((v->>'user_id')::uuid ORDER BY v->>'user_id') INTO participants FROM jsonb_array_elements(p_stacks) v;
 IF cardinality(participants)<>(SELECT count(DISTINCT x) FROM unnest(participants) x) OR cardinality(participants)=0
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_stacks) v WHERE h.stack_result->'written'->>(v->>'user_id') IS NULL OR (h.stack_result->'written'->>(v->>'user_id'))::numeric IS DISTINCT FROM (v->>'stack')::numeric) THEN RAISE EXCEPTION 'original_tournament_earning_hand_players_mismatch';END IF;
 SELECT * INTO prior FROM public.ca_promo_profit_tournament_hand_clocks WHERE hand_id=p_hand;
 IF FOUND THEN
  IF ROW(prior.table_id,prior.tournament_id,prior.hand_number,prior.earned_at,prior.participant_ids) IS DISTINCT FROM ROW(p_table,tournament,h.hand_number,h.committed_at,participants) THEN RAISE EXCEPTION 'original_tournament_earning_hand_identity_reused';END IF;
  RETURN;
 END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_stacks) ORDER BY value->>'user_id' LOOP
  SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=tournament AND user_id=(s->>'user_id')::uuid;
  gid:=public.fn_ca_promo_profit_apply_generation(r.id);
  PERFORM public.fn_ca_promo_profit_capture_legacy_head(r.id);
  scope:=scope||jsonb_build_object(r.user_id::text,jsonb_build_object('club_id',r.club_id,'generation_id',gid));
 END LOOP;
 INSERT INTO public.ca_promo_profit_tournament_hand_clocks VALUES(p_hand,p_table,tournament,h.hand_number,h.committed_at,participants,scope);
 FOR s IN SELECT value FROM jsonb_array_elements(p_stacks) ORDER BY value->>'user_id' LOOP
  gid:=(scope->(s->>'user_id')->>'generation_id')::uuid;
  SELECT COALESCE(array_agg(DISTINCT c.charge_ledger_id ORDER BY c.charge_ledger_id),'{}'::uuid[]) INTO ids FROM public.ca_promo_profit_charge_generations c WHERE c.generation_id=gid;
  active:=EXISTS(SELECT 1 FROM public.ca_promo_event_principal_lots lot JOIN public.ca_promo_play_through_grants g ON g.id=lot.grant_id
   WHERE lot.tournament_id=tournament AND g.user_id=(s->>'user_id')::uuid AND lot.charge_ledger_id=ANY(ids) AND lot.original_amount>0);
  IF to_regclass('public.ca_promo_integrity_event_lots') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.ca_promo_integrity_event_lots WHERE tournament_id=$1 AND user_id=$2 AND charge_ledger_id=ANY($3) AND original_amount>0)' INTO extra USING tournament,(s->>'user_id')::uuid,ids;
   active:=active OR extra;
  END IF;
  IF to_regclass('public.ca_promo_profit_event_lots') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.ca_promo_profit_event_lots WHERE tournament_id=$1 AND user_id=$2 AND charge_ledger_id=ANY($3) AND original_amount>0)' INTO extra USING tournament,(s->>'user_id')::uuid,ids;
   active:=active OR extra;
  END IF;
  IF active THEN INSERT INTO public.ca_promo_profit_tournament_hand_sources VALUES(p_hand,(s->>'user_id')::uuid,(scope->(s->>'user_id')->>'club_id')::uuid,gid,ids);END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Snapshot the increase in the ORIGINAL amount owed before a short bank can
-- defer payment. Exact payout ranges later consume these earning slices.
CREATE FUNCTION public.fn_ca_promo_profit_capture_obligation_earning() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE lo numeric;gid uuid;club uuid;ids uuid[];bounty uuid;bo public.tournament_bounty_obligations%ROWTYPE;hand public.ca_promo_profit_tournament_hand_clocks%ROWTYPE;hs public.ca_promo_profit_tournament_hand_sources%ROWTYPE;r public.tournament_players%ROWTYPE;earned timestamptz;ctx jsonb;enabled timestamptz;legacy_clock timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) OR NEW.kind='refund' THEN RETURN NULL;END IF;
 lo:=CASE WHEN TG_OP='INSERT' THEN NEW.amount_paid ELSE OLD.amount_owed END;
 IF NEW.amount_owed<=lo THEN RETURN NULL;END IF;
 IF NEW.amount_owed::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'original_earning_amount_invalid';END IF;
 IF NEW.kind IN('bounty_residual','own_bounty') THEN
  PERFORM public.fn_ca_promo_profit_capture_residual_head(NEW.id,NEW.tournament_id,NEW.user_id,lo,NEW.amount_owed);
  RETURN NULL;
 END IF;
 IF NEW.kind IN('bounty','mystery_bounty') THEN
  bounty:=NULLIF(current_setting('app.bounty_obligation_id',true),'')::uuid;
  IF bounty IS NULL THEN RAISE EXCEPTION 'original_bounty_earning_hand_missing';END IF;
  SELECT * INTO STRICT bo FROM public.tournament_bounty_obligations WHERE id=bounty AND tournament_id=NEW.tournament_id;
  IF bo.knocker_user_id IS DISTINCT FROM NEW.user_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bo.claimants) c WHERE c->>'user_id'=NEW.user_id::text) THEN RAISE EXCEPTION 'original_bounty_earning_recipient_mismatch';END IF;
  SELECT * INTO hand FROM public.ca_promo_profit_tournament_hand_clocks WHERE hand_id=bo.hand_id AND table_id=bo.table_id AND tournament_id=NEW.tournament_id;
  IF NOT FOUND THEN
   SELECT enforced_from INTO enabled FROM public.ca_promo_play_through_settings WHERE id;
   SELECT committed_at INTO legacy_clock FROM public.hand_atomic_commits WHERE hand_id=bo.hand_id AND table_id=bo.table_id;
   IF COALESCE(legacy_clock,bo.created_at)>=enabled OR COALESCE(legacy_clock,bo.created_at) IS NULL THEN RAISE EXCEPTION 'original_bounty_earning_hand_missing';END IF;
   SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=NEW.tournament_id AND user_id=NEW.user_id;
   INSERT INTO public.ca_promo_profit_obligation_earnings(obligation_id,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,source_bounty_obligation_id,earned_at)
   VALUES(NEW.id,NEW.tournament_id,NEW.user_id,r.club_id,NULL,'{}',lo,NEW.amount_owed,NEW.kind,bounty,COALESCE(legacy_clock,bo.created_at));
   RETURN NULL;
  END IF;
  IF NOT NEW.user_id=ANY(hand.participant_ids) THEN RAISE EXCEPTION 'original_bounty_earning_participant_missing';END IF;
  club:=(hand.participant_scope->NEW.user_id::text->>'club_id')::uuid;
  gid:=(hand.participant_scope->NEW.user_id::text->>'generation_id')::uuid;
  SELECT * INTO hs FROM public.ca_promo_profit_tournament_hand_sources WHERE hand_id=hand.hand_id AND user_id=NEW.user_id;
  ids:=COALESCE(hs.charge_ledger_ids,'{}'::uuid[]);earned:=hand.earned_at;
 ELSE
  SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=NEW.tournament_id AND user_id=NEW.user_id;
  gid:=public.fn_ca_promo_profit_apply_generation(r.id);club:=r.club_id;earned:=clock_timestamp();
  SELECT COALESCE(array_agg(DISTINCT charge_ledger_id ORDER BY charge_ledger_id),'{}'::uuid[]) INTO ids FROM public.ca_promo_profit_charge_generations WHERE generation_id=gid;
 END IF;
 INSERT INTO public.ca_promo_profit_obligation_earnings(obligation_id,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,source_bounty_obligation_id,earned_at)
 VALUES(NEW.id,NEW.tournament_id,NEW.user_id,club,gid,ids,lo,NEW.amount_owed,NEW.kind,bounty,earned);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_capture_obligation_earning() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_promo_original_obligation_earning AFTER INSERT OR UPDATE OF amount_owed ON public.tournament_obligations FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_capture_obligation_earning();

CREATE FUNCTION public.fn_ca_promo_profit_prepare_tournament_credit(p_obligation uuid,p_operation text,p_amount numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE o public.tournament_obligations%ROWTYPE;prior public.ca_promo_profit_earning_sources%ROWTYPE;sid uuid;ids uuid[];club uuid;gid uuid;earned timestamptz;covered numeric;clubs integer;generations integer;legacy_to numeric;enabled timestamptz;legacy_club uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN RETURN NULL;END IF;
 SELECT * INTO STRICT o FROM public.tournament_obligations WHERE id=p_obligation;
 IF o.kind='refund' THEN RETURN NULL;END IF;
 IF p_operation IS DISTINCT FROM 'tourney:'||o.tournament_id||':obl:'||o.id||':'||round(o.amount_paid*100)::bigint OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_amount>o.amount_owed-o.amount_paid THEN RAISE EXCEPTION 'original_tournament_earning_credit_intent_mismatch';END IF;
 SELECT * INTO prior FROM public.ca_promo_profit_earning_sources WHERE operation_ref=p_operation;
 IF FOUND THEN
  IF ROW(prior.source_obligation_id,prior.amount,prior.user_id,prior.tournament_id) IS DISTINCT FROM ROW(o.id,p_amount,o.user_id,o.tournament_id) THEN RAISE EXCEPTION 'original_tournament_earning_source_reused';END IF;
  RETURN prior.source_id;
 END IF;
 SELECT enforced_from INTO enabled FROM public.ca_promo_play_through_settings WHERE id;
 IF o.created_at<enabled THEN
  SELECT COALESCE(min(e.amount_from),o.amount_owed) INTO legacy_to FROM public.ca_promo_profit_obligation_earnings e WHERE e.obligation_id=o.id;
  IF legacy_to>o.amount_paid THEN
   SELECT (v.registration_snapshot->>'club_id')::uuid INTO legacy_club FROM public.tournament_obligation_events v WHERE v.obligation_id=o.id AND v.registration_snapshot->>'user_id'=o.user_id::text AND v.registration_snapshot->>'tournament_id'=o.tournament_id::text AND v.registration_snapshot->>'club_id' IS NOT NULL ORDER BY v.event_id LIMIT 1;
   IF legacy_club IS NULL THEN SELECT club_id INTO legacy_club FROM public.tournament_players WHERE tournament_id=o.tournament_id AND user_id=o.user_id;END IF;
   IF legacy_club IS NULL THEN RAISE EXCEPTION 'original_legacy_earning_scope_missing';END IF;
   INSERT INTO public.ca_promo_profit_obligation_earnings(obligation_id,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,earned_at)
   VALUES(o.id,o.tournament_id,o.user_id,legacy_club,NULL,'{}',o.amount_paid,legacy_to,'preprogramme_'||o.kind,o.created_at);
  END IF;
 END IF;
 SELECT sum(LEAST(e.amount_to,o.amount_paid+p_amount)-GREATEST(e.amount_from,o.amount_paid)),count(DISTINCT earning_club_id),count(DISTINCT generation_id),min(earning_club_id::text)::uuid,min(generation_id::text)::uuid,min(earned_at)
 INTO covered,clubs,generations,club,gid,earned FROM public.ca_promo_profit_obligation_earnings e
 WHERE e.obligation_id=o.id AND e.amount_to>o.amount_paid AND e.amount_from<o.amount_paid+p_amount;
 IF covered IS DISTINCT FROM p_amount OR clubs<>1 THEN RAISE EXCEPTION 'original_tournament_earning_ranges_missing';END IF;
 IF generations<>1 THEN gid:=NULL;END IF;
 SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),'{}'::uuid[]) INTO ids
 FROM public.ca_promo_profit_obligation_earnings e CROSS JOIN LATERAL unnest(e.charge_ledger_ids) x
 WHERE e.obligation_id=o.id AND e.amount_to>o.amount_paid AND e.amount_from<o.amount_paid+p_amount;
 INSERT INTO public.ca_promo_profit_earning_sources(operation_ref,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount,source_kind,source_obligation_id,earned_at)
 VALUES(p_operation,o.tournament_id,o.user_id,club,gid,ids,p_amount,o.kind,o.id,earned) RETURNING source_id INTO sid;
 INSERT INTO public.ca_promo_profit_earning_source_slices(source_id,earning_receipt_id,amount,charge_ledger_ids,generation_id)
 SELECT sid,e.id,LEAST(e.amount_to,o.amount_paid+p_amount)-GREATEST(e.amount_from,o.amount_paid),e.charge_ledger_ids,e.generation_id
 FROM public.ca_promo_profit_obligation_earnings e WHERE e.obligation_id=o.id AND e.amount_to>o.amount_paid AND e.amount_from<o.amount_paid+p_amount;
 RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_prepare_tournament_credit(uuid,text,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_bind_earning_ledger(p_ledger uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE sid uuid:=NULLIF(current_setting('app.ca_promo_profit_earning_source',true),'')::uuid;s public.ca_promo_profit_earning_sources%ROWTYPE;l public.chip_ledger%ROWTYPE;o public.tournament_obligations%ROWTYPE;linked uuid;
BEGIN
 SELECT source_id INTO linked FROM public.ca_promo_profit_earning_credit_links WHERE ledger_id=p_ledger;
 IF FOUND THEN
  IF sid IS NOT NULL AND linked<>sid THEN RAISE EXCEPTION 'original_tournament_earning_ledger_reused';END IF;
  RETURN linked;
 END IF;
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.from_type<>'prize_liability' OR l.to_type<>'player_wallet' OR l.category NOT IN('tournament_prize','bounty') THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN RETURN NULL;END IF;
 SELECT * INTO STRICT s FROM public.ca_promo_profit_earning_sources WHERE source_id=sid;
 SELECT * INTO STRICT o FROM public.tournament_obligations WHERE id=s.source_obligation_id;
 IF ROW(l.from_entity_id,l.to_entity_id,l.amount) IS DISTINCT FROM ROW(s.tournament_id,s.user_id,s.amount)
 OR COALESCE(l.status,'posted')<>'posted' OR l.tournament_id IS DISTINCT FROM s.tournament_id
 OR s.operation_ref IS DISTINCT FROM 'tourney:'||o.tournament_id||':obl:'||o.id||':'||round(o.amount_paid*100)::bigint
 OR NOT EXISTS(SELECT 1 FROM public.wallet_credit_idempotency k WHERE k.key=s.operation_ref AND k.user_id=s.user_id AND k.amount=s.amount)
 OR (SELECT sum(amount) FROM public.ca_promo_profit_earning_source_slices WHERE source_id=s.source_id) IS DISTINCT FROM s.amount THEN
  RAISE EXCEPTION 'original_tournament_earning_ledger_identity_mismatch';
 END IF;
 INSERT INTO public.ca_promo_profit_earning_credit_links VALUES(l.id,s.source_id);
 RETURN s.source_id;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_bind_earning_ledger(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_earning_slices_conserved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE sid uuid:=NEW.source_id;
BEGIN
 IF (SELECT amount FROM public.ca_promo_profit_earning_sources WHERE source_id=sid) IS DISTINCT FROM (SELECT sum(amount) FROM public.ca_promo_profit_earning_source_slices WHERE source_id=sid) THEN RAISE EXCEPTION 'original_tournament_earning_slices_not_conserved';END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_earning_slices_conserved() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER original_earning_header_conserved AFTER INSERT ON public.ca_promo_profit_earning_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_earning_slices_conserved();
CREATE CONSTRAINT TRIGGER original_earning_slices_conserved AFTER INSERT ON public.ca_promo_profit_earning_source_slices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_earning_slices_conserved();

-- PKO head is a custody container. Its bought capital and each earned addition
-- retain separate source prefixes until an exact residual or knockout retires it.
CREATE TABLE public.ca_promo_profit_head_components (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_ref text NOT NULL UNIQUE,tournament_id uuid NOT NULL,user_id uuid NOT NULL,
 head_generation_id uuid NOT NULL REFERENCES public.ca_promo_profit_event_generations(id),
 generation_id uuid REFERENCES public.ca_promo_profit_event_generations(id),earning_club_id uuid NOT NULL,
 charge_ledger_ids uuid[] NOT NULL,amount numeric NOT NULL CHECK(amount>0 AND amount=round(amount,2) AND amount::text NOT IN('NaN','Infinity','-Infinity')),
 source_kind text NOT NULL,source_bounty_obligation_id uuid,earned_at timestamptz NOT NULL
);
CREATE TABLE public.ca_promo_profit_head_retirements (
 component_id uuid PRIMARY KEY REFERENCES public.ca_promo_profit_head_components(id),
 reason text NOT NULL CHECK(reason IN('knockout','residual')),operation_ref text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.ca_promo_profit_head_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_promo_profit_head_retirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_head_components,public.ca_promo_profit_head_retirements FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_head_components,public.ca_promo_profit_head_retirements TO service_role;
CREATE TRIGGER original_head_component_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_head_components FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_generation_immutable();
CREATE TRIGGER original_head_retirement_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_head_retirements FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_generation_immutable();
CREATE TRIGGER original_head_component_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_head_components FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_profit_generation_immutable();
CREATE TRIGGER original_head_retirement_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_head_retirements FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_profit_generation_immutable();

CREATE FUNCTION public.fn_ca_promo_profit_add_earned_head(p_tournament uuid,p_user uuid,p_amount numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE bo public.tournament_bounty_obligations%ROWTYPE;hand public.ca_promo_profit_tournament_hand_clocks%ROWTYPE;hs public.ca_promo_profit_tournament_hand_sources%ROWTYPE;r public.tournament_players%ROWTYPE;container uuid;op text;prior public.ca_promo_profit_head_components%ROWTYPE;gid uuid;club uuid;ids uuid[];
BEGIN
 IF p_amount<=0 OR NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN RETURN;END IF;
 SELECT * INTO STRICT bo FROM public.tournament_bounty_obligations WHERE id=NULLIF(current_setting('app.bounty_obligation_id',true),'')::uuid AND tournament_id=p_tournament;
 IF bo.knocker_user_id IS DISTINCT FROM p_user AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bo.claimants) c WHERE c->>'user_id'=p_user::text) THEN RAISE EXCEPTION 'original_earned_head_recipient_mismatch';END IF;
 SELECT * INTO STRICT hand FROM public.ca_promo_profit_tournament_hand_clocks WHERE hand_id=bo.hand_id AND table_id=bo.table_id;
 IF NOT p_user=ANY(hand.participant_ids) THEN RAISE EXCEPTION 'original_earned_head_participant_missing';END IF;
 SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=p_tournament AND user_id=p_user;
 PERFORM public.fn_ca_promo_profit_capture_legacy_head(r.id);
 container:=public.fn_ca_promo_profit_apply_generation(r.id);gid:=(hand.participant_scope->p_user::text->>'generation_id')::uuid;club:=(hand.participant_scope->p_user::text->>'club_id')::uuid;
 SELECT * INTO hs FROM public.ca_promo_profit_tournament_hand_sources WHERE hand_id=hand.hand_id AND user_id=p_user;ids:=COALESCE(hs.charge_ledger_ids,'{}'::uuid[]);
 op:='earned_head:'||bo.id||':'||p_user;
 SELECT * INTO prior FROM public.ca_promo_profit_head_components WHERE operation_ref=op;
 IF FOUND THEN
  IF ROW(prior.tournament_id,prior.user_id,prior.amount,prior.generation_id,prior.charge_ledger_ids) IS DISTINCT FROM ROW(p_tournament,p_user,p_amount,gid,ids) THEN RAISE EXCEPTION 'original_earned_head_identity_reused';END IF;
  RETURN;
 END IF;
 INSERT INTO public.ca_promo_profit_head_components(operation_ref,tournament_id,user_id,head_generation_id,generation_id,earning_club_id,charge_ledger_ids,amount,source_kind,source_bounty_obligation_id,earned_at)
 VALUES(op,p_tournament,p_user,container,gid,club,ids,p_amount,'earned_head',bo.id,hand.earned_at);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_add_earned_head(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_retire_knocked_out_head(p_tournament uuid,p_user uuid,p_head numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r public.tournament_players%ROWTYPE;container uuid;total numeric;bo public.tournament_bounty_obligations%ROWTYPE;hand public.ca_promo_profit_tournament_hand_clocks%ROWTYPE;enabled timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN RETURN;END IF;
 SELECT * INTO STRICT bo FROM public.tournament_bounty_obligations WHERE id=NULLIF(current_setting('app.bounty_obligation_id',true),'')::uuid AND tournament_id=p_tournament;
 IF bo.eliminated_user_id IS DISTINCT FROM p_user OR bo.head_amount IS DISTINCT FROM p_head THEN RAISE EXCEPTION 'original_knocked_out_head_identity_mismatch';END IF;
 SELECT * INTO hand FROM public.ca_promo_profit_tournament_hand_clocks WHERE hand_id=bo.hand_id AND table_id=bo.table_id AND tournament_id=p_tournament;
 IF NOT FOUND THEN
  SELECT enforced_from INTO enabled FROM public.ca_promo_play_through_settings WHERE id;
  IF bo.created_at<enabled THEN RETURN;END IF;
  RAISE EXCEPTION 'original_knocked_out_head_generation_missing';
 END IF;
 container:=(hand.participant_scope->p_user::text->>'generation_id')::uuid;
 IF container IS NULL OR NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_event_generations WHERE id=container AND tournament_id=p_tournament AND user_id=p_user) THEN RAISE EXCEPTION 'original_knocked_out_head_generation_mismatch';END IF;
 SELECT COALESCE(sum(h.amount),0) INTO total FROM public.ca_promo_profit_head_components h WHERE h.head_generation_id=container AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_retirements x WHERE x.component_id=h.id);
 IF total IS DISTINCT FROM p_head THEN RAISE EXCEPTION 'original_knocked_out_head_components_missing';END IF;
 INSERT INTO public.ca_promo_profit_head_retirements(component_id,reason,operation_ref)
 SELECT h.id,'knockout','knockout:'||bo.id FROM public.ca_promo_profit_head_components h WHERE h.head_generation_id=container AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_retirements x WHERE x.component_id=h.id);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_retire_knocked_out_head(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_capture_residual_head(p_obligation uuid,p_tournament uuid,p_user uuid,p_from numeric,p_to numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r public.tournament_players%ROWTYPE;container uuid;total numeric;h record;cursor_amount numeric:=p_from;
BEGIN
 SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=p_tournament AND user_id=p_user;
 PERFORM public.fn_ca_promo_profit_capture_legacy_head(r.id);
 container:=public.fn_ca_promo_profit_apply_generation(r.id);
 SELECT COALESCE(sum(x.amount),0) INTO total FROM public.ca_promo_profit_head_components x WHERE x.head_generation_id=container AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_retirements z WHERE z.component_id=x.id);
 IF total IS DISTINCT FROM p_to-p_from THEN RAISE EXCEPTION 'original_residual_head_components_missing';END IF;
 FOR h IN SELECT x.* FROM public.ca_promo_profit_head_components x WHERE x.head_generation_id=container AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_retirements z WHERE z.component_id=x.id) ORDER BY x.earned_at,x.id LOOP
  INSERT INTO public.ca_promo_profit_obligation_earnings(obligation_id,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,source_bounty_obligation_id,earned_at)
  VALUES(p_obligation,p_tournament,p_user,h.earning_club_id,h.generation_id,h.charge_ledger_ids,cursor_amount,cursor_amount+h.amount,'bounty_residual',h.source_bounty_obligation_id,h.earned_at);
  INSERT INTO public.ca_promo_profit_head_retirements VALUES(h.id,'residual','residual:'||p_obligation,clock_timestamp());
  cursor_amount:=cursor_amount+h.amount;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_capture_residual_head(uuid,uuid,uuid,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;

-- An entry already present before programme activation cannot have bought a
-- head from a later promo gift. Freeze that unrestricted compatibility opening
-- before any prospectively tracked head addition, never recolour it as promo.
CREATE FUNCTION public.fn_ca_promo_profit_capture_legacy_head(p_registration uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r public.tournament_players%ROWTYPE;enabled timestamptz;total numeric;gid uuid;amount numeric;
BEGIN
 SELECT enforced_from INTO enabled FROM public.ca_promo_play_through_settings WHERE id;
 SELECT * INTO STRICT r FROM public.tournament_players WHERE id=p_registration;
 IF enabled IS NULL OR r.registered_at IS NULL OR r.registered_at>=enabled OR COALESCE(r.current_bounty,0)<=0 THEN RETURN;END IF;
 gid:=public.fn_ca_promo_profit_initial_generation(r.id);
 IF EXISTS(SELECT 1 FROM public.ca_promo_profit_generation_heads WHERE registration_id=r.id AND generation_id<>gid) THEN RETURN;END IF;
 SELECT COALESCE(sum(x.amount),0) INTO total FROM public.ca_promo_profit_head_components x WHERE x.head_generation_id=gid AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_retirements z WHERE z.component_id=x.id);
 amount:=r.current_bounty-total;
 IF amount<=0 THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_profit_head_components WHERE operation_ref='preprogramme_head:'||r.id) THEN RAISE EXCEPTION 'original_preprogramme_head_opening_changed';END IF;
 INSERT INTO public.ca_promo_profit_head_components(operation_ref,tournament_id,user_id,head_generation_id,generation_id,earning_club_id,charge_ledger_ids,amount,source_kind,earned_at)
 VALUES('preprogramme_head:'||r.id,r.tournament_id,r.user_id,gid,gid,r.club_id,'{}',amount,'preprogramme_head',r.registered_at);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_capture_legacy_head(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.ca_promo_profit_nonwallet_earning_intents (
 source_id uuid PRIMARY KEY REFERENCES public.ca_promo_profit_earning_sources(source_id),
 destination text NOT NULL CHECK(destination IN('event','ticket')),entity_id uuid NOT NULL,
 registration_id uuid,payout_id uuid,transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id()
);
ALTER TABLE public.ca_promo_profit_nonwallet_earning_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_profit_nonwallet_earning_intents FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_profit_nonwallet_earning_intents TO service_role;
CREATE TRIGGER original_nonwallet_intent_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_profit_nonwallet_earning_intents FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_profit_generation_immutable();
CREATE TRIGGER original_nonwallet_intent_no_truncate BEFORE TRUNCATE ON public.ca_promo_profit_nonwallet_earning_intents FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_profit_generation_immutable();

-- This private constructor is called only by the two existing financial award
-- owners after their exact terminal/admission gates and before the one leg.
CREATE FUNCTION public.fn_ca_promo_profit_prepare_nonwallet_earning(p_event uuid,p_user uuid,p_amount numeric,p_operation text,p_destination text,p_entity uuid,p_registration uuid DEFAULT NULL,p_payout uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r public.tournament_players%ROWTYPE;gid uuid;ids uuid[];sid uuid;eid uuid;prior public.ca_promo_profit_earning_sources%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN RETURN NULL;END IF;
 IF p_event IS NULL OR p_user IS NULL OR p_entity IS NULL OR p_destination NOT IN('event','ticket') OR p_amount<=0 OR p_amount<>round(p_amount,2) OR COALESCE(p_operation,'')='' THEN RAISE EXCEPTION 'original_noncash_earning_intent_invalid';END IF;
 SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=p_event AND user_id=p_user;
 gid:=public.fn_ca_promo_profit_apply_generation(r.id);
 SELECT COALESCE(array_agg(DISTINCT charge_ledger_id ORDER BY charge_ledger_id),'{}'::uuid[]) INTO ids FROM public.ca_promo_profit_charge_generations WHERE generation_id=gid;
 SELECT * INTO prior FROM public.ca_promo_profit_earning_sources WHERE operation_ref=p_operation;
 IF FOUND THEN
  IF ROW(prior.tournament_id,prior.user_id,prior.amount,prior.generation_id,prior.charge_ledger_ids) IS DISTINCT FROM ROW(p_event,p_user,p_amount,gid,ids) THEN RAISE EXCEPTION 'original_noncash_earning_identity_reused';END IF;
  RETURN prior.source_id;
 END IF;
 INSERT INTO public.ca_promo_profit_obligation_earnings(operation_ref,obligation_id,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,earned_at)
 VALUES(p_operation,NULL,p_event,p_user,r.club_id,gid,ids,0,p_amount,'satellite_award',clock_timestamp()) RETURNING id INTO eid;
 INSERT INTO public.ca_promo_profit_earning_sources(operation_ref,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount,source_kind,source_obligation_id,earned_at)
 SELECT p_operation,p_event,p_user,r.club_id,gid,ids,p_amount,'satellite_award',NULL,earned_at FROM public.ca_promo_profit_obligation_earnings WHERE id=eid RETURNING source_id INTO sid;
 INSERT INTO public.ca_promo_profit_earning_source_slices VALUES(sid,eid,p_amount,ids,gid);
 INSERT INTO public.ca_promo_profit_nonwallet_earning_intents(source_id,destination,entity_id,registration_id,payout_id) VALUES(sid,p_destination,p_entity,p_registration,p_payout);
 RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_prepare_nonwallet_earning(uuid,uuid,numeric,text,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_profit_bind_nonwallet_earning(p_ledger uuid,p_user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE sid uuid:=NULLIF(current_setting('app.ca_promo_profit_nonwallet_source',true),'')::uuid;s public.ca_promo_profit_earning_sources%ROWTYPE;l public.chip_ledger%ROWTYPE;i public.ca_promo_profit_nonwallet_earning_intents%ROWTYPE;prior uuid;
BEGIN
 SELECT source_id INTO prior FROM public.ca_promo_profit_earning_credit_links WHERE ledger_id=p_ledger;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_earning_sources WHERE source_id=prior AND user_id=p_user) OR sid IS NOT NULL AND sid<>prior THEN RAISE EXCEPTION 'original_noncash_earning_link_reused';END IF;
  RETURN prior;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN RETURN NULL;END IF;
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 IF l.from_type<>'prize_liability' OR COALESCE(l.metadata->>'kind','') NOT IN('satellite_seat_pool_transfer','direct_satellite_entry_ticket') THEN RETURN NULL;END IF;
 SELECT * INTO STRICT s FROM public.ca_promo_profit_earning_sources WHERE source_id=sid;
 SELECT * INTO STRICT i FROM public.ca_promo_profit_nonwallet_earning_intents WHERE source_id=sid;
 IF i.transaction_id IS DISTINCT FROM pg_current_xact_id() OR s.source_kind<>'satellite_award'
 OR ROW(l.from_entity_id,l.to_entity_id,l.amount,l.idempotency_key,l.metadata->>'user_id') IS DISTINCT FROM ROW(s.tournament_id,i.entity_id,s.amount,s.operation_ref,p_user::text)
 OR s.user_id IS DISTINCT FROM p_user OR l.tournament_id IS DISTINCT FROM s.tournament_id OR COALESCE(l.status,'posted')<>'posted' THEN RAISE EXCEPTION 'original_noncash_earning_ledger_mismatch';END IF;
 IF i.destination='event' THEN
  IF l.to_type<>'prize_liability' OR l.category<>'tournament_buyin' OR l.metadata->>'kind'<>'satellite_seat_pool_transfer'
  OR l.metadata->>'registration_id' IS DISTINCT FROM i.registration_id::text
  OR NOT EXISTS(SELECT 1 FROM public.tournament_players tp WHERE tp.id=i.registration_id AND tp.tournament_id=i.entity_id AND tp.user_id=p_user AND tp.source_satellite_id=s.tournament_id AND tp.is_satellite_qualifier) THEN RAISE EXCEPTION 'original_noncash_seat_receipt_mismatch';END IF;
 ELSE
  IF l.to_type<>'escrow' OR l.category<>'ticket_issue' OR l.metadata->>'kind'<>'direct_satellite_entry_ticket'
  OR l.metadata->>'payout_id' IS DISTINCT FROM i.payout_id::text
  OR NOT EXISTS(SELECT 1 FROM public.tournament_tickets t WHERE t.id=i.entity_id AND t.holder_id=p_user AND t.value=s.amount AND t.source_satellite_id=s.tournament_id AND t.redemption_mode='tournament_entry_only')
  OR NOT EXISTS(SELECT 1 FROM public.tournament_payouts p WHERE p.id=i.payout_id AND p.tournament_id=s.tournament_id AND p.user_id=p_user AND p.amount=s.amount AND p.source='satellite_ticket' AND p.metadata->>'ticket_id'=i.entity_id::text) THEN RAISE EXCEPTION 'original_noncash_ticket_receipt_mismatch';END IF;
 END IF;
 INSERT INTO public.ca_promo_profit_earning_credit_links VALUES(l.id,sid);
 RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_bind_nonwallet_earning(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Keep original financial owners, permissions, receipts and refusal behavior.
-- The patch only records source metadata at their existing transaction points.
DO $admission_owner$ DECLARE def text;needle text;original text;old_hash text;new_hash text;guard text;BEGIN
 SELECT pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure) INTO def;
 original:=replace(def,E'    IF public.fn_ca_tournament_unit_cents(p_tournament_id)=1 THEN PERFORM public.fn_ca_promo_retire_busted_entry(p_tournament_id,p_user_id,v_candidate.id,v_effective_token); END IF;\n','');
 IF md5(original)<>'340946b9bef6be146cd1ba9d0354bd16' THEN RAISE EXCEPTION 'original_generation_admission_owner_changed';END IF;
 old_hash:=md5(def);
 def:=replace(def,E'DECLARE\n',E'DECLARE\n  v_promo_generation_prior text;\n');
 needle:=E'    v_response:=public.fn_ca_process_tournament_chip_purchase_money_v1(\n      p_tournament_id,p_user_id,v_type,p_cost,p_chips,v_t.current_level,\n      v_effective_token);';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_generation_admission_boundary_missing';END IF;
 def:=replace(def,needle,E'    v_promo_generation_prior:=current_setting(''app.ca_promo_profit_admission'',true);\n    IF public.fn_ca_tournament_unit_cents(p_tournament_id)=1 AND EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) THEN\n      PERFORM set_config(''app.ca_promo_profit_admission'',public.fn_ca_promo_profit_admission_context(p_tournament_id,p_user_id,v_candidate.id,v_effective_token),true);\n    ELSE PERFORM set_config(''app.ca_promo_profit_admission'','''',true);END IF;\n'||needle||E'\n    IF COALESCE((v_response->>''success'')::boolean,false) AND NULLIF(current_setting(''app.ca_promo_profit_admission'',true),'''') IS NOT NULL THEN\n      PERFORM public.fn_ca_promo_profit_apply_generation((current_setting(''app.ca_promo_profit_admission'',true)::jsonb->>''registration_id'')::uuid,current_setting(''app.ca_promo_profit_admission'',true)::jsonb);\n    END IF;\n    PERFORM set_config(''app.ca_promo_profit_admission'',COALESCE(v_promo_generation_prior,''''),true);');
 EXECUTE def;
 SELECT md5(pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) INTO new_hash;
 -- Advance only the actual changed original-owner pin, retaining all others.
 SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure) INTO guard;
 IF strpos(guard,'"signature":"public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)"')=0 THEN RAISE EXCEPTION 'original_generation_admission_pin_missing';END IF;
 guard:=regexp_replace(guard,'("signature":"public.process_tournament_rebuy\(uuid,uuid,text,numeric,numeric,integer,text\)","definition_md5":")[0-9a-f]{32}("|$)','\1'||new_hash||'\2');
 EXECUTE guard;
END $admission_owner$;

DO $obligation_credit_owner$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_settle_tournament_obligation_before_atomic_batch_gate(uuid,text,integer,uuid,numeric,text,text,uuid)'::regprocedure) INTO def;
 IF md5(def)<>'df387bd37001630d94ab2e380144ccab' THEN RAISE EXCEPTION 'original_earning_credit_owner_changed';END IF;
 def:=replace(def,E'DECLARE\n',E'DECLARE\n  v_promo_earning_prior text;\n');
 needle:='  v_credited := public.fn_credit_and_log(';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_earning_credit_boundary_missing';END IF;
 def:=replace(def,needle,E'  v_promo_earning_prior:=current_setting(''app.ca_promo_profit_earning_source'',true);\n  PERFORM set_config(''app.ca_promo_profit_earning_source'',COALESCE(public.fn_ca_promo_profit_prepare_tournament_credit(v_ob.id,v_key,v_pay)::text,''''),true);\n'||needle);
 needle:=E'    CASE WHEN v_category = ''prize'' THEN v_payout_source ELSE NULL END);';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_earning_credit_restore_boundary_missing';END IF;
 def:=replace(def,needle,needle||E'\n  PERFORM set_config(''app.ca_promo_profit_earning_source'',COALESCE(v_promo_earning_prior,''''),true);');
 EXECUTE def;
END $obligation_credit_owner$;

DO $mystery_earning_owner$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_mystery_bounty_pay(uuid)'::regprocedure) INTO def;
 IF md5(def)<>'d666baf91b06f9305191fcbc0b9c7aee' THEN RAISE EXCEPTION 'original_mystery_earning_owner_changed';END IF;
 def:=replace(def,E'DECLARE\n',E'DECLARE\n  v_promo_bounty_prior text;\n');
 needle:='    v_settle := public.fn_settle_tournament_obligation(';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_mystery_earning_boundary_missing';END IF;
 def:=replace(def,needle,E'    v_promo_bounty_prior:=current_setting(''app.bounty_obligation_id'',true);\n    PERFORM set_config(''app.bounty_obligation_id'',COALESCE(v_a.bounty_obligation_id::text,''''),true);\n'||needle);
 needle:=E'      ''fn_mystery_bounty_pay'',\n      ''Mystery bounty revealed from eliminated player'');';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_mystery_earning_restore_boundary_missing';END IF;
 def:=replace(def,needle,needle||E'\n    PERFORM set_config(''app.bounty_obligation_id'',COALESCE(v_promo_bounty_prior,''''),true);');
 needle:=E'  RETURN jsonb_build_object(\n    ''ok'', true, ''already'', false, ''award_id'', p_award_id,';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_mystery_head_retirement_boundary_missing';END IF;
 def:=replace(def,needle,E'  IF v_a.bounty_obligation_id IS NOT NULL THEN\n    v_promo_bounty_prior:=current_setting(''app.bounty_obligation_id'',true);\n    PERFORM set_config(''app.bounty_obligation_id'',v_a.bounty_obligation_id::text,true);\n    PERFORM public.fn_ca_promo_profit_retire_knocked_out_head(v_a.tournament_id,v_a.eliminated_user_id,(SELECT head_amount FROM public.tournament_bounty_obligations WHERE id=v_a.bounty_obligation_id));\n    PERFORM set_config(''app.bounty_obligation_id'',COALESCE(v_promo_bounty_prior,''''),true);\n  END IF;\n'||needle);
 EXECUTE def;
END $mystery_earning_owner$;

DO $pko_head_owner$ DECLARE def text;needle text;guard text;new_hash text;BEGIN
 SELECT pg_get_functiondef('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)'::regprocedure) INTO def;
 IF md5(def)<>'e76385f1c13c9a8e88165d231bda7d6a' THEN RAISE EXCEPTION 'original_pko_head_owner_changed';END IF;
 needle:='      IF v_cash > 0 THEN';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_pko_head_earning_boundary_missing';END IF;
 def:=replace(def,needle,E'      PERFORM public.fn_ca_promo_profit_add_earned_head(p_tournament_id,c.uid,v_to_head);\n'||needle);
 needle:='    UPDATE tournament_players SET current_bounty = 0';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_pko_head_retirement_boundary_missing';END IF;
 def:=replace(def,needle,E'    PERFORM public.fn_ca_promo_profit_retire_knocked_out_head(p_tournament_id,p_eliminated_user_id,v_head);\n'||needle);
 EXECUTE def;
 SELECT md5(pg_get_functiondef('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)'::regprocedure)) INTO new_hash;
 SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure) INTO guard;
 IF strpos(guard,'"signature":"public.fn_collect_bounty(uuid,uuid,uuid,jsonb)"')=0 THEN RAISE EXCEPTION 'original_pko_head_pin_missing';END IF;
 guard:=regexp_replace(guard,'("signature":"public.fn_collect_bounty\(uuid,uuid,uuid,jsonb\)","definition_md5":")[0-9a-f]{32}("|$)','\1'||new_hash||'\2');
 EXECUTE guard;
END $pko_head_owner$;

DO $legacy_noncash_award_owner$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_award_satellite_seat(uuid,uuid,uuid,text,integer)'::regprocedure) INTO def;
 IF md5(def)<>'2dd4a562252a0dd161413f938c85b6f1' THEN RAISE EXCEPTION 'original_noncash_award_owner_changed';END IF;
 def:=replace(def,E'DECLARE\n',E'DECLARE\n  v_promo_nonwallet_prior text;\n');
 needle:=E'      INSERT INTO public.chip_ledger\n';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'original_noncash_award_boundary_changed';END IF;
 def:=replace(def,needle,E'      v_promo_nonwallet_prior:=current_setting(''app.ca_promo_profit_nonwallet_source'',true);\n      PERFORM set_config(''app.ca_promo_profit_nonwallet_source'',COALESCE(public.fn_ca_promo_profit_prepare_nonwallet_earning(p_satellite_id,p_user_id,v_moved,''tourney:''||p_satellite_id||'':seat:''||p_user_id||'':pool_transfer'',''event'',p_target_id,v_seat_id,NULL)::text,''''),true);\n'||needle);
 needle:=E'         v_sat_pool, round(v_sat_pool - v_moved, 2))\n      ;';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_noncash_award_restore_changed';END IF;
 def:=replace(def,needle,needle||E'\n      PERFORM set_config(''app.ca_promo_profit_nonwallet_source'',COALESCE(v_promo_nonwallet_prior,''''),true);');
 EXECUTE def;
END $legacy_noncash_award_owner$;

DO $cohort_noncash_award_owner$ DECLARE def text;needle text;BEGIN
 SELECT pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure) INTO def;
 IF md5(def)<>'88743d6d6484247ac4175c6d8bd9e0c9' THEN RAISE EXCEPTION 'original_cohort_noncash_award_owner_changed';END IF;
 def:=replace(def,E'DECLARE\n',E'DECLARE\n  v_promo_nonwallet_prior text;\n');
 needle:=E'      v_pool_before := round(v_pool - (v_place - 1) * v_ticket_cost, 2);\n      INSERT INTO public.chip_ledger';
 IF length(def)-length(replace(def,needle,''))<>2*length(needle) THEN RAISE EXCEPTION 'original_cohort_noncash_award_boundaries_changed';END IF;
 def:=replace(def,needle,E'      v_promo_nonwallet_prior:=current_setting(''app.ca_promo_profit_nonwallet_source'',true);\n      PERFORM set_config(''app.ca_promo_profit_nonwallet_source'',COALESCE(public.fn_ca_promo_profit_prepare_nonwallet_earning(p_tournament_id,v_finisher.user_id,v_ticket_cost,CASE WHEN v_delivery_kind=''seat'' THEN ''tourney:''||p_tournament_id||'':seat:''||v_finisher.user_id||'':pool_transfer'' ELSE v_payout_key||'':ticket_escrow'' END,CASE WHEN v_delivery_kind=''seat'' THEN ''event'' ELSE ''ticket'' END,CASE WHEN v_delivery_kind=''seat'' THEN v_target_id ELSE v_ticket_id END,CASE WHEN v_delivery_kind=''seat'' THEN v_registration_id ELSE NULL END,CASE WHEN v_delivery_kind=''ticket'' THEN v_payout_id ELSE NULL END)::text,''''),true);\n'||needle);
 needle:='         v_pool_before, round(v_pool_before - v_ticket_cost, 2));';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_cohort_seat_restore_boundary_changed';END IF;
 def:=replace(def,needle,needle||E'\n      PERFORM set_config(''app.ca_promo_profit_nonwallet_source'',COALESCE(v_promo_nonwallet_prior,''''),true);');
 needle:='      RETURNING id INTO v_ticket_ledger_id;';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'original_cohort_ticket_restore_boundary_changed';END IF;
 def:=replace(def,needle,needle||E'\n      PERFORM set_config(''app.ca_promo_profit_nonwallet_source'',COALESCE(v_promo_nonwallet_prior,''''),true);');
 EXECUTE def;
END $cohort_noncash_award_owner$;

COMMIT;
