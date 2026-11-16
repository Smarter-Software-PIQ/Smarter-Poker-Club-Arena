-- Promo-funded fees still fill the original 4x target, but create no agent
-- commission or player rakeback. Preserve gross rake, bank evidence, immutable
-- fee sources and historical agreements. Change only the eligible earning
-- basis, captured by the original source owner before its first accrual.
-- Mixed funding is proportional to actual eligible contribution/entry charge;
-- excluded cents are rounded once, eligible + excluded always equals gross.
-- This can install before custody wiring while enforced_from remains NULL.
BEGIN;
SET LOCAL lock_timeout='1s';

CREATE TABLE public.ca_promo_entry_fee_funding (
 charge_ledger_id uuid PRIMARY KEY,club_id uuid NOT NULL,user_id uuid NOT NULL,
 charge_amount numeric NOT NULL CHECK(charge_amount>0),
 promo_amount numeric NOT NULL CHECK(promo_amount>=0 AND promo_amount<=charge_amount),
 charged_at timestamptz NOT NULL,
 CHECK(charge_amount::text NOT IN('NaN','Infinity','-Infinity')),
 CHECK(promo_amount::text NOT IN('NaN','Infinity','-Infinity'))
);
ALTER TABLE public.ca_promo_entry_fee_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_entry_fee_funding FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_promo_entry_fee_funding TO service_role;

CREATE FUNCTION public.fn_ca_promo_entry_funding_is_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='public','pg_temp' AS $$
BEGIN RAISE EXCEPTION 'original_promo_entry_funding_is_immutable' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_entry_funding_is_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_entry_funding_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_entry_fee_funding
 FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_entry_funding_is_immutable();
CREATE TRIGGER ca_promo_entry_funding_no_truncate BEFORE TRUNCATE ON public.ca_promo_entry_fee_funding
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_entry_funding_is_immutable();

-- Owner-only, called from the original charge's custody transition. A caller
-- cannot manufacture a receipt through PostgREST or pass an actor identity.
CREATE FUNCTION public.fn_ca_promo_capture_entry_funding(p_charge_ledger_id uuid,p_promo_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE;uid uuid;prior public.ca_promo_entry_fee_funding%ROWTYPE;starts timestamptz;
BEGIN
 SELECT enforced_from INTO starts FROM public.ca_promo_play_through_settings WHERE id;
 IF starts IS NULL THEN RETURN; END IF;
 SELECT * INTO l FROM public.chip_ledger WHERE id=p_charge_ledger_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'original_promo_entry_charge_missing' USING ERRCODE='23514'; END IF;
 IF l.created_at<starts THEN RETURN; END IF;
 IF l.to_type<>'prize_liability' OR l.club_id IS NULL OR COALESCE(l.status,'posted')<>'posted'
  OR l.amount<=0 OR l.amount::text IN('NaN','Infinity','-Infinity') OR p_promo_amount IS NULL
  OR p_promo_amount<0 OR p_promo_amount>l.amount OR p_promo_amount::text IN('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'invalid_original_promo_entry_funding' USING ERRCODE='23514';
 END IF;
 IF l.from_type='player_wallet' AND l.category IN('tournament_buyin','tournament_rebuy','rebuy','reentry','addon') THEN uid:=l.from_entity_id;
 ELSIF l.from_type='escrow' AND l.category='ticket_redeem' THEN
  SELECT holder_id INTO uid FROM public.tournament_tickets WHERE id=l.from_entity_id AND club_id=l.club_id;
 ELSIF l.from_type='prize_liability' AND l.category='tournament_buyin' THEN uid:=NULLIF(l.metadata->>'user_id','')::uuid;
 END IF;
 IF uid IS NULL THEN RAISE EXCEPTION 'promo_entry_original_payer_missing' USING ERRCODE='23514'; END IF;
 INSERT INTO public.ca_promo_entry_fee_funding VALUES(l.id,l.club_id,uid,l.amount,p_promo_amount,l.created_at)
  ON CONFLICT(charge_ledger_id) DO NOTHING;
 SELECT * INTO STRICT prior FROM public.ca_promo_entry_fee_funding WHERE charge_ledger_id=l.id;
 IF prior.club_id IS DISTINCT FROM l.club_id OR prior.user_id IS DISTINCT FROM uid
  OR prior.charge_amount IS DISTINCT FROM l.amount OR prior.promo_amount IS DISTINCT FROM p_promo_amount
  OR prior.charged_at IS DISTINCT FROM l.created_at THEN
  RAISE EXCEPTION 'original_promo_entry_funding_conflict' USING ERRCODE='23514';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_capture_entry_funding(uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

-- The input already contains the historical membership and each upline's
-- agreement. Keep those exact observations and cascade their same rates over
-- eligible fees. Excluded gross remains in club_residual, conserving the bank.
CREATE FUNCTION public.fn_ca_promo_payable_contract(p_contract jsonb,p_excluded numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='public','pg_temp' AS $$
DECLARE gross numeric;eligible numeric;remaining numeric;t jsonb;tiers jsonb:='[]';rate numeric;paid numeric;total_paid numeric:=0;
BEGIN
 gross:=(p_contract->>'rake_credit')::numeric;
 IF gross IS NULL OR gross<0 OR gross<>round(gross,2) OR gross::text IN('NaN','Infinity','-Infinity')
  OR p_excluded IS NULL OR p_excluded<0 OR p_excluded>gross OR p_excluded<>round(p_excluded,2)
  OR p_excluded::text IN('NaN','Infinity','-Infinity') OR jsonb_typeof(p_contract->'tiers') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'invalid_promo_payable_basis' USING ERRCODE='23514';
 END IF;
 IF p_excluded=0 THEN RETURN p_contract||jsonb_build_object('promo_basis_version',1,'promo_excluded_credit',0,'payable_rake_credit',gross); END IF;
 eligible:=gross-p_excluded;remaining:=eligible;
 FOR t IN SELECT value FROM jsonb_array_elements(p_contract->'tiers') LOOP
  rate:=(t->>'rate')::numeric;
  IF rate IS NULL OR rate<0 OR rate>1 OR rate::text IN('NaN','Infinity','-Infinity') THEN
   RAISE EXCEPTION 'invalid_historical_promo_commission_rate' USING ERRCODE='23514'; END IF;
  paid:=round(remaining*rate,2);
  tiers:=tiers||jsonb_build_array(t||jsonb_build_object('rake_basis',eligible,'remaining_basis',remaining,'amount',paid));
  total_paid:=total_paid+paid;remaining:=remaining-paid;
 END LOOP;
 RETURN p_contract||jsonb_build_object('tiers',tiers,'club_residual',gross-total_paid,
  'promo_basis_version',1,'promo_excluded_credit',p_excluded,'payable_rake_credit',eligible);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_payable_contract(jsonb,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_payable_contract(jsonb,numeric) TO service_role;

CREATE FUNCTION public.fn_ca_promo_cash_payable_contract(p_record uuid,p_club uuid,p_user uuid,p_contract jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE starts timestamptz;r public.rake_records%ROWTYPE;contributed numeric;promo numeric;excluded numeric;
BEGIN
 -- Normal source contracts already carry their immutable basis. Reapply the
 -- same cut to their current tiers without re-reading the original hand.
 IF p_contract->>'promo_basis_version'='1' THEN
  RETURN public.fn_ca_promo_payable_contract(p_contract,(p_contract->>'promo_excluded_credit')::numeric);
 END IF;
 SELECT enforced_from INTO starts FROM public.ca_promo_play_through_settings WHERE id;
 IF starts IS NULL THEN RETURN p_contract; END IF;
 SELECT * INTO r FROM public.rake_records WHERE id=p_record;
 IF NOT FOUND OR r.created_at<starts THEN RETURN p_contract; END IF;
 SELECT contribution,promo_contribution INTO contributed,promo FROM public.ca_promo_cash_hand_funding
  WHERE hand_id=r.hand_id AND club_id=p_club AND user_id=p_user;
 IF NOT FOUND OR contributed<=0 OR promo<=0 THEN RETURN public.fn_ca_promo_payable_contract(p_contract,0); END IF;
 IF p_contract->>'club_id' IS DISTINCT FROM p_club::text OR p_contract->>'player_id' IS DISTINCT FROM p_user::text THEN
  RAISE EXCEPTION 'promo_cash_original_payer_conflict' USING ERRCODE='23514'; END IF;
 IF promo>contributed THEN RAISE EXCEPTION 'original_promo_cash_funding_invalid' USING ERRCODE='23514'; END IF;
 excluded:=round((p_contract->>'rake_credit')::numeric*promo/contributed,2);
 RETURN public.fn_ca_promo_payable_contract(p_contract,excluded);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_cash_payable_contract(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_cash_payable_contract(uuid,uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.fn_ca_promo_tournament_payable_contract(p_charge uuid,p_contract jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE f public.ca_promo_entry_fee_funding%ROWTYPE;excluded numeric;l public.chip_ledger%ROWTYPE;starts timestamptz;
BEGIN
 SELECT * INTO f FROM public.ca_promo_entry_fee_funding WHERE charge_ledger_id=p_charge;
 IF NOT FOUND THEN
  SELECT enforced_from INTO starts FROM public.ca_promo_play_through_settings WHERE id;
  SELECT * INTO l FROM public.chip_ledger WHERE id=p_charge;
  IF starts IS NOT NULL AND l.created_at>=starts AND l.to_type='prize_liability'
   AND l.from_type IN('player_wallet','escrow','prize_liability')
   AND l.category IN('tournament_buyin','tournament_rebuy','rebuy','reentry','addon','ticket_redeem') THEN
   RAISE EXCEPTION 'original_promo_entry_funding_missing' USING ERRCODE='23514';
  END IF;
  RETURN p_contract;
 END IF;
 IF p_contract->>'club_id' IS DISTINCT FROM f.club_id::text OR p_contract->>'player_id' IS DISTINCT FROM f.user_id::text THEN
  RAISE EXCEPTION 'promo_fee_original_payer_conflict' USING ERRCODE='23514'; END IF;
 IF f.promo_amount=0 THEN RETURN public.fn_ca_promo_payable_contract(p_contract,0); END IF;
 excluded:=round((p_contract->>'rake_credit')::numeric*f.promo_amount/f.charge_amount,2);
 RETURN public.fn_ca_promo_payable_contract(p_contract,excluded);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_tournament_payable_contract(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_tournament_payable_contract(uuid,jsonb) TO service_role;

DO $owners$
DECLARE def text;needle text;name text;
BEGIN
 needle:='public.fn_accounting_earning_contract(a.club_id,a.player_id,a.weighted_rake_credit,game_union,source.created_at)';
 SELECT pg_get_functiondef('public.fn_accounting_cash_commission_plan(uuid)'::regprocedure) INTO def;
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_cash_plan_anchor_changed'; END IF;
 EXECUTE replace(def,needle,'public.fn_ca_promo_cash_payable_contract(source.id,a.club_id,a.player_id,'||needle||')');
 FOREACH name IN ARRAY ARRAY['fn_capture_accounting_tournament_fee(uuid,jsonb)','fn_ca_capture_tournament_fee_from_recorded_evidence(uuid)'] LOOP
  SELECT pg_get_functiondef(('public.'||name)::regprocedure) INTO def;
  needle:='IF contract->>''player_id''';
  IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_tournament_contract_anchor_changed: %',name; END IF;
  EXECUTE replace(def,needle,E'contract:=public.fn_ca_promo_tournament_payable_contract((item->>''charge_ledger_id'')::uuid,contract);\n    '||needle);
 END LOOP;
END $owners$;
-- The existing immutable MTT admission guard pins this exact earning owner.
-- Move only that signature's body fingerprint after the maintained source
-- patch, preserving every other authority, owner, ACL and activation check.
DO $admission_pin$
DECLARE def text;needle text;replacement text;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure) INTO def;
 IF md5(def)<>'db325dd573702ea5cd4eaf6cf3ad8881' THEN RAISE EXCEPTION 'promo_original_admission_guard_changed'; END IF;
 needle:='"signature":"public.fn_capture_accounting_tournament_fee(uuid,jsonb)","definition_md5":"e83638c8e5401469c336fe378505fbac"';
 IF length(def)-length(replace(def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'promo_original_admission_fee_pin_changed'; END IF;
 replacement:='"signature":"public.fn_capture_accounting_tournament_fee(uuid,jsonb)","definition_md5":"'
  ||md5(pg_get_functiondef('public.fn_capture_accounting_tournament_fee(uuid,jsonb)'::regprocedure))||'"';
 EXECUTE replace(def,needle,replacement);
END $admission_pin$;

-- Effective contracts can acquire a later authorized interpretation. Apply
-- the same frozen source funding after that interpretation as well, so an
-- admission cannot accidentally restore promo-funded earnings.
SET LOCAL search_path=public,pg_temp;
DO $view_preimages$ BEGIN
 IF md5(pg_get_viewdef('public.accounting_effective_cash_rake_sources'::regclass,true))<>'47a6e58eed8d5b3656869164d52a3b52' THEN RAISE EXCEPTION 'promo_original_view_changed: accounting_effective_cash_rake_sources'; END IF;
 IF md5(pg_get_viewdef('public.accounting_effective_tournament_fee_sources'::regclass,true))<>'c3b33eebab8ad9c01c44a4c78166d2f0' THEN RAISE EXCEPTION 'promo_original_view_changed: accounting_effective_tournament_fee_sources'; END IF;
 IF md5(pg_get_viewdef('public.accounting_payable_earning_sources'::regclass,true))<>'4b5df14ee82835c51a81745b0d1be413' THEN RAISE EXCEPTION 'promo_original_view_changed: accounting_payable_earning_sources'; END IF;
END $view_preimages$;
CREATE OR REPLACE VIEW public.accounting_effective_cash_rake_sources AS
 SELECT s.id,
    s.rake_record_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    s.earned_at,
    s.rake_credit,
    CASE WHEN s.earned_at>=(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id) THEN public.fn_ca_promo_cash_payable_contract(s.rake_record_id,s.club_id,s.player_id,COALESCE(a.admitted_contract,s.contract)) ELSE COALESCE(a.admitted_contract,s.contract) END AS contract,
    GREATEST(s.recorded_at, a.admitted_at) AS recorded_at
   FROM ( SELECT s_1.id,
            s_1.rake_record_id,
            s_1.player_id,
            s_1.club_id,
            s_1.union_id,
            s_1.coordinator_union_id,
            s_1.earned_at,
            s_1.rake_credit,
            COALESCE(a_1.admitted_contract, s_1.contract) AS contract,
            GREATEST(s_1.recorded_at, a_1.admitted_at) AS recorded_at
           FROM accounting_cash_rake_sources s_1
             LEFT JOIN accounting_cash_atomic_contract_admissions a_1 ON a_1.source_id = s_1.id
          WHERE NOT (EXISTS ( SELECT
                   FROM accounting_cash_funding_contract_admissions f
                  WHERE f.source_id = s_1.id))
        UNION ALL
         SELECT s_1.id,
            s_1.rake_record_id,
            s_1.player_id,
            f.funding_club_id AS club_id,
            s_1.union_id,
            s_1.coordinator_union_id,
            s_1.earned_at,
            s_1.rake_credit,
            f.admitted_contract AS contract,
            GREATEST(s_1.recorded_at, a_1.admitted_at, f.admitted_at) AS recorded_at
           FROM accounting_cash_funding_contract_admissions f
             JOIN accounting_cash_rake_sources s_1 ON s_1.id = f.source_id
             LEFT JOIN accounting_cash_atomic_contract_admissions a_1 ON a_1.source_id = s_1.id) s
     LEFT JOIN accounting_own_agent_interpretations a ON a.source_type = 'cash_rake_accrual'::text AND a.source_id = s.id;
CREATE OR REPLACE VIEW public.accounting_effective_tournament_fee_sources AS
 SELECT s.id,
    s.rake_record_id,
    s.tournament_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    s.game_type,
    s.registration_id,
    s.source_charge_ledger_id,
    s.source_entitlement_id,
    s.charged_at,
    s.rake_credit,
    CASE WHEN s.charged_at>=(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id) THEN public.fn_ca_promo_tournament_payable_contract(s.source_charge_ledger_id,COALESCE(a.admitted_contract,s.contract)) ELSE COALESCE(a.admitted_contract,s.contract) END AS contract,
    GREATEST(s.recorded_at, a.admitted_at) AS recorded_at
   FROM accounting_tournament_fee_sources s
     LEFT JOIN accounting_own_agent_interpretations a ON a.source_type = 'tournament_fee_accrual'::text AND a.source_id = s.id;
CREATE OR REPLACE VIEW public.accounting_payable_earning_sources AS
 SELECT 'cash_rake_accrual'::text AS source_type,
    s.id AS source_id,
    s.rake_record_id,
    NULL::uuid AS tournament_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    s.earned_at,
    COALESCE((s.contract->>'payable_rake_credit')::numeric,s.rake_credit) AS rake_credit,
    s.contract
   FROM accounting_effective_cash_rake_sources s
     LEFT JOIN fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON bd.club_id = s.club_id
  WHERE bd.cutoff_at IS NULL OR s.earned_at IS NOT NULL AND isfinite(s.earned_at) AND s.earned_at >= bd.cutoff_at
UNION ALL
 SELECT 'tournament_fee_accrual'::text AS source_type,
    s.id AS source_id,
    s.rake_record_id,
    s.tournament_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    rs.recognized_at AS earned_at,
    COALESCE((s.contract->>'payable_rake_credit')::numeric,s.rake_credit) AS rake_credit,
    s.contract
   FROM accounting_effective_tournament_fee_sources s
     JOIN accounting_tournament_recognized_sources rs ON rs.source_id = s.id AND rs.tournament_id = s.tournament_id
     JOIN accounting_tournament_fee_recognitions r ON r.tournament_id = s.tournament_id
     LEFT JOIN fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON bd.club_id = s.club_id
  WHERE (bd.cutoff_at IS NULL OR s.charged_at IS NOT NULL AND isfinite(s.charged_at) AND s.charged_at >= bd.cutoff_at) AND (bd.cutoff_at IS NULL OR rs.recognized_at IS NOT NULL AND isfinite(rs.recognized_at) AND rs.recognized_at >= bd.cutoff_at) AND rs.disposition = 'earned'::text AND r.status = 'recognized'::text AND rs.rake_credit = s.rake_credit AND rs.recognized_at = r.recognized_at AND NOT s.union_id IS DISTINCT FROM r.union_id;
-- Preserve the observed owner-only effective views and service-readable
-- canonical payable projection. CREATE OR REPLACE does not widen access.
REVOKE ALL ON public.accounting_effective_cash_rake_sources FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.accounting_effective_tournament_fee_sources FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.accounting_payable_earning_sources FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.accounting_payable_earning_sources TO service_role;
COMMIT;
