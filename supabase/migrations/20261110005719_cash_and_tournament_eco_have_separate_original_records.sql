-- Cash and tournament ECO use independent club-profit bases and rates.
-- Owner chat01a1bbdd, November10: 10% each, calculated separately. The initial
-- amendment is observed NOW, applies to Midway's original unclosed book and
-- forward, and does not invent old captured keys or modify settled history.
-- Original qualified P&L, its 68 source pins, payments and invoices stay intact.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
SET LOCAL search_path=pg_catalog,public,smarter_private;

CREATE TEMP TABLE eco_v2_sources_before ON COMMIT DROP AS SELECT md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure)) matcher,pg_get_functiondef('smarter_private.original_inventory_basis_generation()'::regprocedure) generation_source;
DO $guard$DECLARE sig text;expected text;p pg_proc;BEGIN
SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.fn_union_eco_adjustment(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure; IF md5(pg_get_functiondef(p.oid))<>'9b09f51ede2b420b0d2fd81c95c96d20' OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.proacl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'::aclitem[] THEN RAISE EXCEPTION 'original_eco_owner_preimage_changed';END IF;
SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.fn_union_eco_record(uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure; IF md5(pg_get_functiondef(p.oid))<>'5e0d0e20cd1e25f4d448b4ee0d0e7047' OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.proacl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'::aclitem[] THEN RAISE EXCEPTION 'original_eco_owner_preimage_changed';END IF;
SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.fn_union_issue_weekly_invoices(uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure; IF md5(pg_get_functiondef(p.oid))<>'eb918477105f151524c85b73ab700ae4' OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[] THEN RAISE EXCEPTION 'original_eco_owner_preimage_changed';END IF;
SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.fn_union_settlement_cascade(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure; IF md5(pg_get_functiondef(p.oid))<>'a68664588b6e7f83806f10b122a2bccc' OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.proacl IS DISTINCT FROM '{postgres=X/postgres}'::aclitem[] THEN RAISE EXCEPTION 'original_eco_owner_preimage_changed';END IF;
END$guard$;

CREATE TABLE smarter_private.union_eco_v2_terms(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),union_id uuid NOT NULL REFERENCES public.unions(id),
 effective_from timestamptz NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 cash_enabled boolean NOT NULL,cash_rate numeric NOT NULL CHECK(cash_rate>=0 AND cash_rate<=1),
 tournament_enabled boolean NOT NULL,tournament_rate numeric NOT NULL CHECK(tournament_rate>=0 AND tournament_rate<=1),
 actor_id uuid,authority text NOT NULL,legacy_evidence jsonb,
 CHECK(isfinite(effective_from)AND isfinite(observed_at)),UNIQUE(union_id,effective_from,observed_at)
);
CREATE TABLE smarter_private.union_eco_components(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),union_id uuid NOT NULL,club_id uuid NOT NULL,
 period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,
 activity text NOT NULL CHECK(activity IN('cash','tournament')),
 terms_id uuid NOT NULL REFERENCES smarter_private.union_eco_v2_terms(id),enabled boolean NOT NULL,
 base_mode text NOT NULL CHECK(base_mode='club_profit'),base numeric NOT NULL,rate numeric NOT NULL,
 amount numeric NOT NULL,basis jsonb NOT NULL,basis_sha256 text NOT NULL,settlement_id uuid,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(isfinite(period_start)AND isfinite(period_end)AND period_start<period_end),
 CHECK(period_start=public.fn_union_week_start(period_start)AND period_end=public.fn_union_week_start(period_start+interval '8 days')),
 CHECK(base::text NOT IN('NaN','Infinity','-Infinity')AND amount::text NOT IN('NaN','Infinity','-Infinity')),
 CHECK(rate>=0 AND rate<=1 AND amount=CASE WHEN enabled THEN round(-base*rate,2)ELSE 0 END),
 UNIQUE(union_id,club_id,period_start,period_end,activity)
);
ALTER TABLE smarter_private.union_eco_v2_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.union_eco_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.union_eco_v2_terms,smarter_private.union_eco_components FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION smarter_private.union_eco_v2_immutable()RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog AS $f$BEGIN RAISE EXCEPTION 'original_eco_component_and_terms_are_immutable' USING ERRCODE='55000';END$f$;
REVOKE ALL ON FUNCTION smarter_private.union_eco_v2_immutable()FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER original_eco_immutable BEFORE UPDATE OR DELETE ON smarter_private.union_eco_v2_terms FOR EACH ROW EXECUTE FUNCTION smarter_private.union_eco_v2_immutable();
CREATE TRIGGER original_eco_no_truncate BEFORE TRUNCATE ON smarter_private.union_eco_v2_terms FOR EACH STATEMENT EXECUTE FUNCTION smarter_private.union_eco_v2_immutable();
CREATE TRIGGER original_eco_immutable BEFORE UPDATE OR DELETE ON smarter_private.union_eco_components FOR EACH ROW EXECUTE FUNCTION smarter_private.union_eco_v2_immutable();
CREATE TRIGGER original_eco_no_truncate BEFORE TRUNCATE ON smarter_private.union_eco_components FOR EACH STATEMENT EXECUTE FUNCTION smarter_private.union_eco_v2_immutable();

CREATE FUNCTION smarter_private.union_eco_terms_for_book(p_union uuid,p_start timestamptz,p_end timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $f$
DECLARE t smarter_private.union_eco_v2_terms;
BEGIN
 IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start)OR NOT isfinite(p_end)OR p_end<=p_start THEN
  RAISE EXCEPTION 'original_eco_book_boundary_required' USING ERRCODE='22023';END IF;
 IF public.fn_union_week_start(p_start)IS DISTINCT FROM p_start
  OR public.fn_union_week_start(p_start+interval '8 days')IS DISTINCT FROM p_end THEN
  RAISE EXCEPTION 'original_eco_book_boundary_required' USING ERRCODE='22023';END IF;
 SELECT * INTO t FROM smarter_private.union_eco_v2_terms WHERE union_id=p_union AND effective_from<=p_start ORDER BY effective_from DESC,observed_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF EXISTS(SELECT FROM smarter_private.union_eco_v2_terms WHERE union_id=p_union AND effective_from>p_start AND effective_from<p_end)THEN
  RAISE EXCEPTION 'original_eco_intra_book_terms_change_refused' USING ERRCODE='55000';END IF;
 RETURN to_jsonb(t);
END$f$;
REVOKE ALL ON FUNCTION smarter_private.union_eco_terms_for_book(uuid,timestamptz,timestamptz)FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.union_eco_calculate(p_club jsonb,p_basis jsonb,p_terms jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $f$
DECLARE activity text;earned numeric;pnl numeric;b numeric;r numeric;onoff boolean;components jsonb:='[]';facts jsonb:='{}';total numeric:=0;n numeric;
BEGIN
 IF jsonb_typeof(p_club)IS DISTINCT FROM 'object'OR jsonb_typeof(p_basis)IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_terms)IS DISTINCT FROM 'object'OR NOT pg_input_is_valid(p_terms->>'id','uuid')THEN
  RAISE EXCEPTION 'original_eco_component_inputs_missing' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_basis)x WHERE x->>'club_id'IS DISTINCT FROM p_club->>'club_id'
  OR jsonb_typeof(x->'game_type')IS DISTINCT FROM 'string'OR x->>'game_type'NOT IN('cash','mtt','sng','spin','satellite','other')
  OR jsonb_typeof(x->'payout')IS DISTINCT FROM 'number'OR (x->>'payout')::numeric<0)THEN
  RAISE EXCEPTION 'original_eco_canonical_rake_activity_unproven' USING ERRCODE='55000';END IF;
 SELECT COALESCE(sum((x->>'payout')::numeric),0)INTO n FROM jsonb_array_elements(p_basis)x;
 IF n IS DISTINCT FROM public.fn_pnl_evidence_cents(p_club->'rake_earned')THEN RAISE EXCEPTION 'original_eco_earned_rake_split_disagrees' USING ERRCODE='55000';END IF;
 FOREACH activity IN ARRAY ARRAY['cash','tournament']LOOP
  SELECT COALESCE(sum((x->>'payout')::numeric),0)INTO earned FROM jsonb_array_elements(p_basis)x
   WHERE (x->>'game_type'='cash')=(activity='cash');
  pnl:=public.fn_pnl_evidence_cents(p_club->(CASE WHEN activity='cash'THEN 'cash_player_pnl'ELSE 'tournament_player_pnl'END));
  IF pnl IS NULL THEN RAISE EXCEPTION 'original_eco_activity_pnl_missing' USING ERRCODE='55000';END IF;
  r:=(p_terms->>(activity||'_rate'))::numeric;onoff:=(p_terms->>(activity||'_enabled'))::boolean;b:=earned-pnl;
  IF r IS NULL OR r<0 OR r>1 OR r::text IN('NaN','Infinity','-Infinity')OR onoff IS NULL THEN
   RAISE EXCEPTION 'original_eco_explicit_activity_terms_required' USING ERRCODE='22023';END IF;
  n:=CASE WHEN onoff THEN round(-b*r,2)ELSE 0 END;total:=total+n;
  facts:=facts||jsonb_build_object(activity,jsonb_build_object('rake_earned',earned,'player_pnl',pnl));
  components:=components||jsonb_build_array(jsonb_build_object('activity',activity,'enabled',onoff,'base_mode','club_profit',
   'base',b,'rate',r,'amount',n,'terms_id',p_terms->'id','record_id',NULL,'status','preview'));
 END LOOP;
 RETURN jsonb_build_object('club_id',p_club->'club_id','eco_version',2,'eco_components',components,'eco_amount',total,'eco_facts',facts);
END$f$;
REVOKE ALL ON FUNCTION smarter_private.union_eco_calculate(jsonb,jsonb,jsonb)FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_union_eco_components(p_union_id uuid,p_start timestamptz,p_end timestamptz)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $f$
DECLARE terms jsonb;proof jsonb;basis jsonb;club jsonb;club_basis jsonb;output jsonb:='[]';n integer;
BEGIN
 IF auth.uid()IS NULL AND COALESCE(auth.role(),'')<>'service_role'AND session_user NOT IN('postgres','supabase_admin')THEN RAISE EXCEPTION 'ECO authentication required' USING ERRCODE='42501';END IF;
 IF auth.uid()IS NOT NULL AND NOT public.ca_can_oversee_union(p_union_id)THEN RAISE EXCEPTION 'not authorized to read union ECO' USING ERRCODE='42501';END IF;
 PERFORM smarter_private.union_eco_terms_for_book(p_union_id,p_start,p_end);
 IF EXISTS(SELECT FROM smarter_private.union_eco_components WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end)THEN
  FOR club IN SELECT DISTINCT jsonb_build_object('club_id',club_id)FROM smarter_private.union_eco_components WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end LOOP
   PERFORM smarter_private.union_eco_invoice_components(p_union_id,(club->>'club_id')::uuid,p_start,p_end);
  END LOOP;
  IF EXISTS(SELECT club_id FROM smarter_private.union_eco_components WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end GROUP BY club_id HAVING count(*)<>2)THEN
   RAISE EXCEPTION 'original_eco_recorded_activity_pair_incomplete' USING ERRCODE='55000';END IF;
  SELECT jsonb_agg(jsonb_build_object('club_id',x.club_id,'eco_version',2,'eco_components',x.components,'eco_amount',x.amount)ORDER BY x.club_id)
   INTO output FROM(SELECT club_id,sum(amount)amount,jsonb_agg(jsonb_build_object('activity',activity,'enabled',enabled,'base_mode',base_mode,
    'base',base,'rate',rate,'amount',amount,'terms_id',terms_id,'record_id',id,'status','recorded')ORDER BY activity)components
    FROM smarter_private.union_eco_components WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end GROUP BY club_id)x;
  RETURN jsonb_build_object('status','ready','eco_version',2,'clubs',output,'period_start',p_start,'period_end',p_end);
 END IF;
 -- A historical scalar is authoritative, but cannot be reverse-engineered into two facts.
 IF EXISTS(SELECT FROM public.union_eco_ledger WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end)THEN
  SELECT jsonb_agg(jsonb_build_object('club_id',club_id,'eco_version',1,'eco_components',NULL,'eco_amount',eco_amount)ORDER BY club_id)
   INTO output FROM public.union_eco_ledger WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end;
  RETURN jsonb_build_object('status','legacy_unavailable','eco_version',1,'clubs',output,'period_start',p_start,'period_end',p_end);
 END IF;
 terms:=smarter_private.union_eco_terms_for_book(p_union_id,p_start,p_end);
 IF terms IS NULL THEN RETURN jsonb_build_object('status','legacy_unavailable','eco_version',1,'eco_components',NULL,'clubs',NULL);END IF;
 proof:=public.fn_union_pnl_qualified_clubs(p_union_id,p_start,p_end);
 SELECT COALESCE(jsonb_agg(to_jsonb(b)),'[]')INTO basis FROM public.fn_union_club_rake_basis(p_union_id,p_start,p_end)b;
 FOR club IN SELECT x FROM jsonb_array_elements(proof->'clubs')x LOOP
  SELECT COALESCE(jsonb_agg(x),'[]')INTO club_basis FROM jsonb_array_elements(basis)x WHERE x->>'club_id'=club->>'club_id';
  output:=output||jsonb_build_array(smarter_private.union_eco_calculate(club,club_basis,terms));
 END LOOP;
 RETURN jsonb_build_object('status','ready','eco_version',2,'clubs',output,'period_start',p_start,'period_end',p_end,'terms_id',terms->'id');
END$f$;
REVOKE ALL ON FUNCTION public.fn_union_eco_components(uuid,timestamptz,timestamptz)FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_union_eco_components(uuid,timestamptz,timestamptz)TO authenticated,service_role;

CREATE FUNCTION public.fn_union_patch_settings(p_union_id uuid,p_settings jsonb,p_name text DEFAULT NULL,p_description text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $f$
DECLARE u public.unions;next_book timestamptz;
BEGIN
 IF auth.uid()IS NULL THEN RAISE EXCEPTION 'union owner authentication required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_settings)IS DISTINCT FROM 'object'THEN RAISE EXCEPTION 'settings object required' USING ERRCODE='22023';END IF;
 SELECT * INTO u FROM public.unions WHERE id=p_union_id FOR UPDATE;
 IF NOT FOUND OR u.owner_id IS DISTINCT FROM auth.uid()THEN RAISE EXCEPTION 'union owner required' USING ERRCODE='42501';END IF;
 IF p_name IS NOT NULL AND(length(btrim(p_name))=0 OR length(p_name)>200)THEN RAISE EXCEPTION 'valid union name required' USING ERRCODE='22023';END IF;
 UPDATE public.unions SET settings=COALESCE(settings,'{}'::jsonb)||p_settings,
  name=COALESCE(p_name,name),description=COALESCE(p_description,description)WHERE id=p_union_id RETURNING * INTO u;
 SELECT effective_from INTO next_book FROM smarter_private.union_eco_v2_terms WHERE union_id=p_union_id ORDER BY observed_at DESC,id DESC LIMIT 1;
 RETURN jsonb_build_object('success',true,'union',to_jsonb(u),'eco_terms_effective_from',next_book);
END$f$;
REVOKE ALL ON FUNCTION public.fn_union_patch_settings(uuid,jsonb,text,text)FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fn_union_patch_settings(uuid,jsonb,text,text)TO authenticated;

CREATE FUNCTION smarter_private.union_eco_capture_v2()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,smarter_private AS $f$
DECLARE prior jsonb;terms jsonb;next_book timestamptz;
BEGIN
 SELECT COALESCE(jsonb_object_agg(k,v),'{}')INTO terms FROM jsonb_each(COALESCE(NEW.settings,'{}'))e(k,v)
  WHERE k IN('eco_cash_enabled','eco_cash_rate','eco_tournament_enabled','eco_tournament_rate');
 SELECT COALESCE(jsonb_object_agg(k,v),'{}')INTO prior FROM jsonb_each(COALESCE(OLD.settings,'{}'))e(k,v)
  WHERE k IN('eco_cash_enabled','eco_cash_rate','eco_tournament_enabled','eco_tournament_rate');
 IF terms=prior THEN RETURN NULL;END IF;
 IF NOT terms?&ARRAY['eco_cash_enabled','eco_cash_rate','eco_tournament_enabled','eco_tournament_rate']
  OR jsonb_typeof(terms->'eco_cash_enabled')IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(terms->'eco_tournament_enabled')IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(terms->'eco_cash_rate')IS DISTINCT FROM 'number'
  OR jsonb_typeof(terms->'eco_tournament_rate')IS DISTINCT FROM 'number'
  OR (terms->>'eco_cash_rate')::numeric NOT BETWEEN 0 AND 1
  OR (terms->>'eco_tournament_rate')::numeric NOT BETWEEN 0 AND 1 THEN
  RAISE EXCEPTION 'both explicit ECO activity configurations required' USING ERRCODE='22023';END IF;
 next_book:=public.fn_union_week_start(public.fn_union_week_start(clock_timestamp())+interval '8 days');
 INSERT INTO smarter_private.union_eco_v2_terms(union_id,effective_from,cash_enabled,cash_rate,tournament_enabled,tournament_rate,actor_id,authority)
 VALUES(NEW.id,next_book,(terms->>'eco_cash_enabled')::boolean,(terms->>'eco_cash_rate')::numeric,
  (terms->>'eco_tournament_enabled')::boolean,(terms->>'eco_tournament_rate')::numeric,auth.uid(),'original_owner_settings_write_next_book');
 RETURN NULL;
END$f$;
REVOKE ALL ON FUNCTION smarter_private.union_eco_capture_v2()FROM PUBLIC,anon,authenticated,service_role;

-- This explicit newly observed commercial amendment is not a backdated journal.
-- No other union is enabled, no legacy term or already recorded result changes.
DO $owner_amendment$
DECLARE legacy jsonb;u public.unions;
BEGIN
 SELECT * INTO STRICT u FROM public.unions WHERE id='fade0000-0000-0000-0000-000000000001';
 IF public.fn_union_week_start('2026-10-26 07:00Z')IS DISTINCT FROM '2026-10-26 07:00Z'::timestamptz
  OR public.fn_union_week_start('2026-11-02 08:00Z')IS DISTINCT FROM '2026-11-02 08:00Z'::timestamptz THEN
  RAISE EXCEPTION 'original_ECO_book_clock_changed';END IF;
 IF EXISTS(SELECT FROM public.union_accounting_runs WHERE scope_kind='union'AND scope_id=u.id
  AND period_start='2026-10-26 07:00Z'AND period_end='2026-11-02 08:00Z'AND status='complete')THEN
  RAISE EXCEPTION 'original_eco_owner_amendment_book_already_closed';END IF;
 IF EXISTS(SELECT FROM public.union_eco_ledger WHERE union_id=u.id AND period_start='2026-10-26 07:00Z'AND period_end='2026-11-02 08:00Z')THEN
  RAISE EXCEPTION 'original_eco_owner_amendment_legacy_record_exists';END IF;
 legacy:=public.fn_union_eco_terms_evidence(u.id,'2026-10-26 07:00Z','2026-11-02 08:00Z');
 IF legacy->>'status'IS DISTINCT FROM 'ready' OR EXISTS(SELECT FROM jsonb_array_elements(legacy->'segments')s
  WHERE s#>'{terms,eco_enabled}'IS DISTINCT FROM 'true'::jsonb OR s#>'{terms,eco_include_horses}'IS DISTINCT FROM 'true'::jsonb
   OR s#>>'{terms,eco_base_mode}'IS DISTINCT FROM 'club_cash_profit' OR(s#>>'{terms,eco_rate}')::numeric IS DISTINCT FROM 0.10)THEN
  RAISE EXCEPTION 'original_shared_ten_percent_terms_unproven';END IF;
 INSERT INTO smarter_private.union_eco_v2_terms(union_id,effective_from,cash_enabled,cash_rate,tournament_enabled,tournament_rate,actor_id,authority,legacy_evidence)
 VALUES(u.id,'2026-10-26 07:00Z',true,0.10,true,0.10,NULL,
  'owner_chat_01a1bbdd_2026_11_10_ten_percent_each_separately_original_unclosed_book_and_forward',legacy);
 UPDATE public.unions SET settings=COALESCE(settings,'{}')||jsonb_build_object('eco_cash_enabled',true,'eco_cash_rate',0.10,
  'eco_tournament_enabled',true,'eco_tournament_rate',0.10)WHERE id=u.id;
END$owner_amendment$;
CREATE TRIGGER original_eco_v2_settings AFTER UPDATE OF settings ON public.unions FOR EACH ROW EXECUTE FUNCTION smarter_private.union_eco_capture_v2();

CREATE OR REPLACE FUNCTION smarter_private.union_eco_legacy_adjustment(p_union_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(club_id uuid, club_name text, players_won numeric, rake_generated numeric, cash_players_won numeric, cash_rake numeric, tournament_rake numeric, total_rake_generated numeric, club_commission_rate numeric, rake_earned numeric, eco_base numeric, eco_rate numeric, eco_amount numeric, direction text, union_net_eco numeric, eco_base_mode text, baseline_cash_exact boolean, include_horses boolean, eco_enabled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE proof jsonb; terms jsonb;
BEGIN
 -- Preserve the existing disclosure authorization before reading evidence.
 IF auth.uid() IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM unions u WHERE u.id=p_union_id AND u.owner_id=auth.uid())
  AND NOT EXISTS(SELECT 1 FROM union_admins ua WHERE ua.union_id=p_union_id AND ua.user_id=auth.uid())
  AND NOT EXISTS(SELECT 1 FROM union_clubs uc JOIN club_members cm ON cm.club_id=uc.club_id
   WHERE uc.union_id=p_union_id AND cm.user_id=auth.uid() AND cm.role IN('owner','co_owner','admin','super_agent')) THEN
  RAISE EXCEPTION 'not authorized to read union reconciliation' USING ERRCODE='42501'; END IF;
 proof:=public.fn_union_pnl_qualified_clubs(p_union_id,p_start,p_end);
 terms:=proof#>'{eco_commercial_terms_evidence,segments,0,terms}';
 RETURN QUERY WITH rows AS(
  SELECT x,(x->>'club_id')::uuid id,(x->>'eco_amount')::numeric eco FROM jsonb_array_elements(proof->'clubs') x
 ), total AS(SELECT COALESCE(sum(-eco),0) amount FROM rows)
 SELECT r.id,c.name::text,(x->>'realized_net')::numeric+(x->>'stack_delta')::numeric,(x->>'rake_paid')::numeric,
  (x->>'cash_player_pnl')::numeric,(x->>'cash_rake')::numeric,(x->>'tournament_rake')::numeric,(x->>'rake_paid')::numeric,
  CASE WHEN (x->>'rake_paid')::numeric>0 THEN (x->>'rake_earned')::numeric/(x->>'rake_paid')::numeric ELSE NULL END,
  (x->>'rake_earned')::numeric,(x->>'eco_base')::numeric,(terms->>'eco_rate')::numeric,r.eco,
  CASE WHEN r.eco<0 THEN 'club pays union (profitable week)' WHEN r.eco>0 THEN 'union pays club (losing week)' ELSE 'square' END,
  total.amount,terms->>'eco_base_mode',true,true,(terms->>'eco_enabled')::boolean
 FROM rows r LEFT JOIN clubs c ON c.id=r.id CROSS JOIN total ORDER BY r.eco;
END $function$
;
REVOKE ALL ON FUNCTION smarter_private.union_eco_legacy_adjustment(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION smarter_private.union_eco_legacy_record(p_union_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_settlement_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_rows int;
  v_mode text;
BEGIN
  IF v_caller IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unions u WHERE u.id = p_union_id AND u.owner_id = v_caller)
     AND NOT EXISTS (SELECT 1 FROM union_admins ua
                      WHERE ua.union_id = p_union_id AND ua.user_id = v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not authorized');
  END IF;

  -- Preserve original authorization; refuse before any existing ECO row can be upserted.
  PERFORM public.fn_require_union_pnl_evidence(p_union_id,p_start,p_end);

  SELECT x.eco_base_mode INTO v_mode FROM public.fn_union_eco_adjustment(p_union_id,p_start,p_end) x LIMIT 1;
  INSERT INTO union_eco_ledger (union_id, club_id, period_start, period_end,
                                eco_base, eco_rate, eco_amount, eco_base_mode,
                                cash_players_won, total_rake_generated,
                                rake_earned, club_commission_rate, include_horses,
                                settlement_id)
  SELECT p_union_id, e.club_id, p_start, p_end, e.eco_base, e.eco_rate,
         e.eco_amount, e.eco_base_mode, e.cash_players_won, e.total_rake_generated,
         e.rake_earned, e.club_commission_rate, e.include_horses, p_settlement_id
    FROM fn_union_eco_adjustment(p_union_id, p_start, p_end) e
  ON CONFLICT (union_id, club_id, period_start) DO UPDATE
    SET period_end            = EXCLUDED.period_end,
        eco_base              = EXCLUDED.eco_base,
        eco_rate              = EXCLUDED.eco_rate,
        eco_amount            = EXCLUDED.eco_amount,
        eco_base_mode         = EXCLUDED.eco_base_mode,
        cash_players_won      = EXCLUDED.cash_players_won,
        total_rake_generated  = EXCLUDED.total_rake_generated,
        rake_earned           = EXCLUDED.rake_earned,
        club_commission_rate  = EXCLUDED.club_commission_rate,
        include_horses        = EXCLUDED.include_horses,
        settlement_id         = COALESCE(EXCLUDED.settlement_id, union_eco_ledger.settlement_id),
        computed_at           = now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'clubs', v_rows, 'eco_base_mode', v_mode,
                            'period_start', p_start, 'period_end', p_end);
END;
$function$
;
REVOKE ALL ON FUNCTION smarter_private.union_eco_legacy_record(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_union_eco_settings(p_union_id uuid)RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $f$
DECLARE u public.unions;config jsonb;effective timestamptz;
BEGIN
 IF auth.uid()IS NULL OR NOT EXISTS(SELECT FROM public.unions WHERE id=p_union_id AND owner_id=auth.uid())
  AND NOT EXISTS(SELECT FROM public.union_admins WHERE union_id=p_union_id AND user_id=auth.uid())THEN
  RAISE EXCEPTION 'union owner or administrator required' USING ERRCODE='42501';END IF;
 SELECT *INTO STRICT u FROM public.unions WHERE id=p_union_id;
 SELECT COALESCE(jsonb_object_agg(k,v),'{}')INTO config FROM jsonb_each(COALESCE(u.settings,'{}'))e(k,v)
 WHERE k IN('eco_cash_enabled','eco_cash_rate','eco_tournament_enabled','eco_tournament_rate');
 SELECT effective_from INTO effective FROM smarter_private.union_eco_v2_terms t WHERE t.union_id=p_union_id
  AND to_jsonb(t.cash_enabled)=config->'eco_cash_enabled'AND to_jsonb(t.cash_rate)=config->'eco_cash_rate'
  AND to_jsonb(t.tournament_enabled)=config->'eco_tournament_enabled'AND to_jsonb(t.tournament_rate)=config->'eco_tournament_rate'
 ORDER BY t.observed_at DESC,t.id DESC LIMIT 1;
 RETURN jsonb_build_object('settings',config,'eco_terms_effective_from',effective);
END$f$;
REVOKE ALL ON FUNCTION public.fn_union_eco_settings(uuid)FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fn_union_eco_settings(uuid)TO authenticated;

CREATE FUNCTION smarter_private.union_eco_invoice_components(p_union uuid,p_club uuid,p_start timestamptz,p_end timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $f$
DECLARE components jsonb;n integer;total numeric;
BEGIN
 SELECT count(*),sum(amount),jsonb_agg(jsonb_build_object('activity',activity,'enabled',enabled,'base_mode',base_mode,
  'base',base,'rate',rate,'amount',amount,'terms_id',terms_id,'record_id',id,'status','recorded')ORDER BY activity)
 INTO n,total,components FROM smarter_private.union_eco_components WHERE union_id=p_union AND club_id=p_club AND period_start=p_start AND period_end=p_end;
 IF n=0 THEN RETURN jsonb_build_object('eco_version',1,'eco_components',NULL,'eco_components_complete',false);END IF;
 IF n<>2 OR EXISTS(SELECT FROM smarter_private.union_eco_components WHERE union_id=p_union AND club_id=p_club AND period_start=p_start AND period_end=p_end
  AND(amount IS DISTINCT FROM CASE WHEN enabled THEN round(-base*rate,2)ELSE 0 END OR base::text IN('NaN','Infinity','-Infinity')
   OR rate IS NULL OR rate<0 OR rate>1 OR terms_id IS NULL
   OR base IS DISTINCT FROM public.fn_pnl_evidence_cents(basis#>ARRAY['facts',activity,'rake_earned'])-public.fn_pnl_evidence_cents(basis#>ARRAY['facts',activity,'player_pnl'])
   OR basis_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex')))THEN
  RAISE EXCEPTION 'union_squareup_eco_activity_record_fails_its_own_arithmetic' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('eco_version',2,'eco_components',components,'eco_components_complete',true,'eco_amount',total);
END$f$;
REVOKE ALL ON FUNCTION smarter_private.union_eco_invoice_components(uuid,uuid,timestamptz,timestamptz)FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_union_eco_record(p_union_id uuid,p_start timestamptz,p_end timestamptz,p_settlement_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $f$
DECLARE proof jsonb;c jsonb;component jsonb;basis jsonb;terms jsonb;n integer:=0;
BEGIN
 IF auth.uid()IS NOT NULL AND NOT EXISTS(SELECT FROM public.unions WHERE id=p_union_id AND owner_id=auth.uid())
  AND NOT EXISTS(SELECT FROM public.union_admins WHERE union_id=p_union_id AND user_id=auth.uid())THEN
  RETURN jsonb_build_object('success',false,'error','not authorized');END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('union-eco-components:'||p_union_id::text||':'||p_start::text,0))THEN
  RAISE EXCEPTION 'original_eco_book_already_owned' USING ERRCODE='55006';END IF;
 terms:=smarter_private.union_eco_terms_for_book(p_union_id,p_start,p_end);
 IF terms IS NOT NULL AND p_end>clock_timestamp()THEN RAISE EXCEPTION 'original_eco_book_not_closed' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT FROM smarter_private.union_eco_components WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end)THEN
  proof:=public.fn_union_eco_components(p_union_id,p_start,p_end);
  RETURN jsonb_build_object('success',true,'already_recorded',true,'eco_version',2,'clubs',jsonb_array_length(proof->'clubs'),'period_start',p_start,'period_end',p_end);
 END IF;
 IF EXISTS(SELECT FROM public.union_eco_ledger WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end)THEN
  RETURN jsonb_build_object('success',true,'already_recorded',true,'eco_version',1,'legacy_split_unavailable',true,'period_start',p_start,'period_end',p_end);END IF;
 terms:=smarter_private.union_eco_terms_for_book(p_union_id,p_start,p_end);
 IF terms IS NULL THEN RETURN smarter_private.union_eco_legacy_record(p_union_id,p_start,p_end,p_settlement_id);END IF;
 PERFORM public.fn_require_union_pnl_evidence(p_union_id,p_start,p_end);
 proof:=public.fn_union_eco_components(p_union_id,p_start,p_end);
 IF proof->>'status'IS DISTINCT FROM 'ready' OR proof->'eco_version'IS DISTINCT FROM '2'::jsonb THEN
  RAISE EXCEPTION 'original_eco_activity_basis_unqualified' USING ERRCODE='55000';END IF;
 FOR c IN SELECT x FROM jsonb_array_elements(proof->'clubs')x LOOP
  n:=n+1;
  FOR component IN SELECT x FROM jsonb_array_elements(c->'eco_components')x LOOP
   basis:=jsonb_build_object('version',2,'component',component,'terms',terms,'club_id',c->'club_id','period_start',p_start,'period_end',p_end,
    'financial_basis','unchanged_qualified_original_cash_and_realized_tournament_pnl','facts',c->'eco_facts',
    'financial_generation',smarter_private.original_inventory_basis_generation(),
    'club_roster',(SELECT jsonb_agg(x->'club_id'ORDER BY x->>'club_id')FROM jsonb_array_elements(proof->'clubs')x),
    'calculator_md5',md5(pg_get_functiondef('smarter_private.union_eco_calculate(jsonb,jsonb,jsonb)'::regprocedure)));
   INSERT INTO smarter_private.union_eco_components(union_id,club_id,period_start,period_end,activity,terms_id,enabled,base_mode,base,rate,amount,basis,basis_sha256,settlement_id)
   VALUES(p_union_id,(c->>'club_id')::uuid,p_start,p_end,component->>'activity',(component->>'terms_id')::uuid,(component->>'enabled')::boolean,
    'club_profit',(component->>'base')::numeric,(component->>'rate')::numeric,(component->>'amount')::numeric,basis,
    encode(extensions.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex'),p_settlement_id);
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('success',true,'eco_version',2,'clubs',n,'components',2*n,'eco_base_mode','separate_club_profit','period_start',p_start,'period_end',p_end);
END$f$;
-- Preserve original service-only writer authority and owner/admin predicate.
REVOKE ALL ON FUNCTION public.fn_union_eco_record(uuid,timestamptz,timestamptz,uuid)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_union_eco_record(uuid,timestamptz,timestamptz,uuid)TO service_role;

CREATE OR REPLACE FUNCTION public.fn_union_eco_adjustment(p_union_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(club_id uuid, club_name text, players_won numeric, rake_generated numeric, cash_players_won numeric, cash_rake numeric, tournament_rake numeric, total_rake_generated numeric, club_commission_rate numeric, rake_earned numeric, eco_base numeric, eco_rate numeric, eco_amount numeric, direction text, union_net_eco numeric, eco_base_mode text, baseline_cash_exact boolean, include_horses boolean, eco_enabled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE proof jsonb;components jsonb;terms jsonb;
BEGIN
 terms:=smarter_private.union_eco_terms_for_book(p_union_id,p_start,p_end);
 IF terms IS NULL OR EXISTS(SELECT FROM public.union_eco_ledger WHERE union_id=p_union_id AND period_start=p_start AND period_end=p_end)THEN
  RETURN QUERY SELECT * FROM smarter_private.union_eco_legacy_adjustment(p_union_id,p_start,p_end);RETURN;END IF;
 components:=public.fn_union_eco_components(p_union_id,p_start,p_end);
 proof:=public.fn_union_pnl_qualified_clubs(p_union_id,p_start,p_end);
 RETURN QUERY WITH rows AS(SELECT x,(x->>'club_id')::uuid id,(x->>'eco_amount')::numeric eco FROM jsonb_array_elements(components->'clubs')x),
 total AS(SELECT COALESCE(sum(-eco),0)amount FROM rows)
 SELECT r.id,c.name::text,(facts.x->>'realized_net')::numeric+(facts.x->>'stack_delta')::numeric,(facts.x->>'rake_paid')::numeric,
  (facts.x->>'cash_player_pnl')::numeric,(facts.x->>'cash_rake')::numeric,(facts.x->>'tournament_rake')::numeric,(facts.x->>'rake_paid')::numeric,
  CASE WHEN(facts.x->>'rake_paid')::numeric>0 THEN(facts.x->>'rake_earned')::numeric/(facts.x->>'rake_paid')::numeric ELSE NULL END,
  (facts.x->>'rake_earned')::numeric,NULL::numeric,NULL::numeric,r.eco,
  CASE WHEN r.eco<0 THEN 'club pays union (profitable week)' WHEN r.eco>0 THEN 'union pays club (losing week)' ELSE 'square' END,
  total.amount,'separate_club_profit'::text,true,true,((terms->>'cash_enabled')::boolean OR(terms->>'tournament_enabled')::boolean)
 FROM rows r JOIN LATERAL(SELECT q FROM jsonb_array_elements(proof->'clubs')q WHERE q->>'club_id'=r.id::text)facts(x)ON true
 LEFT JOIN public.clubs c ON c.id=r.id CROSS JOIN total ORDER BY r.eco;
END $function$;
REVOKE ALL ON FUNCTION public.fn_union_eco_adjustment(uuid,timestamptz,timestamptz)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_union_eco_adjustment(uuid,timestamptz,timestamptz)TO service_role;

CREATE OR REPLACE FUNCTION public.fn_union_issue_weekly_invoices(p_union_id uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notify boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_from timestamptz := COALESCE(p_start, public.fn_union_prev_week_start(now()));
  v_to   timestamptz := COALESCE(p_end,   public.fn_union_week_start(now()));
  v_due  timestamptz;
  v_union_name text;
  r record;
  v_period_id uuid;
  v_invoice_id uuid;
  v_already_sent boolean;
  v_issued int := 0;
  v_notified int := 0;
  v_notified_batch int := 0;
  v_messaged int := 0;
  v_basis_exact boolean;
  v_msg jsonb;
  v_body text;
  v_number text;
  v_out jsonb := '[]'::jsonb;
  v_recorded_eco numeric;
  v_eco_recorded boolean;
  v_recorded_base numeric;
  v_recorded_rate numeric;
  v_components jsonb;
BEGIN
  IF v_caller IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unions u WHERE u.id = p_union_id AND u.owner_id = v_caller)
     AND NOT EXISTS (SELECT 1 FROM union_admins ua
                      WHERE ua.union_id = p_union_id AND ua.user_id = v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not authorized');
  END IF;

  -- Original owner/admin authorization above remains the first disclosure gate.
  PERFORM public.fn_require_union_pnl_evidence(p_union_id,v_from,v_to);

  /* THE GUARDS LIVE HERE, NOT ONLY IN THE CASCADE (Phase 6 verification,
     20260908). The Open Claw safety net calls this function directly. */
  IF EXISTS (SELECT 1 FROM public.union_settlement_floor f
              WHERE f.union_id = p_union_id AND v_from < f.earliest_period_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'before_settlement_floor',
                              'period_start', v_from, 'period_end', v_to);
  END IF;
  IF public.fn_union_setting(p_union_id, 'weekly_invoices_enabled', 1) <> 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'weekly_invoices_disabled',
                              'period_start', v_from, 'period_end', v_to);
  END IF;
  -- A statement says "rakeback already moved in chips". It is issued only for a
  -- period whose round 1 is final, and then it reads that round's own rows.
  IF NOT EXISTS (SELECT 1 FROM public.ca_settlements s
                  WHERE s.settlement_type = 'union_rakeback_close' AND s.union_id = p_union_id
                    AND s.state = 'final'
                    AND s.external_ref = p_union_id::text || ':'
                      || to_char(v_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '..'
                      || to_char(v_to   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'period_not_closed',
                              'period_start', v_from, 'period_end', v_to);
  END IF;

  v_due := v_to + interval '3 days';
  SELECT u.name INTO v_union_name FROM unions u WHERE u.id = p_union_id;

  -- Is the seated-stack baseline this week's ECO rests on an exact one?
  SELECT bool_and(COALESCE(e.baseline_cash_exact, false))
    INTO v_basis_exact
    FROM fn_union_eco_adjustment(p_union_id, v_from, v_to) e;
  v_basis_exact := COALESCE(v_basis_exact, false);

  FOR r IN SELECT * FROM fn_union_club_invoice(p_union_id, v_from, v_to) LOOP
    v_msg := NULL;
    v_invoice_id := NULL;
    v_already_sent := false;

    /* THE DOCUMENT QUOTES THE RECORDED ECO (2026-09-21). union_eco_ledger
       is the recorded ECO for this period; fn_union_eco_record wrote it
       earlier in this settlement. fn_union_club_invoice now reads it, so
       this refusal should never fire - it exists because a square-up that
       cannot quote its own record must STOP, not state a number. On
       2026-09-14 a second live recomputation billed club a41434bb 11244.03
       against a recorded -11242.82. With ECO terms disabled nothing is
       recorded and nothing may be stated. */
    v_components:=smarter_private.union_eco_invoice_components(p_union_id,r.club_id,v_from,v_to);
    IF v_components->>'eco_version'='2' THEN
      v_recorded_eco:=(v_components->>'eco_amount')::numeric;v_recorded_base:=NULL;v_recorded_rate:=NULL;v_eco_recorded:=true;
    ELSE
    SELECT l.eco_amount, l.eco_base, l.eco_rate
      INTO v_recorded_eco, v_recorded_base, v_recorded_rate
      FROM union_eco_ledger l
     WHERE l.union_id = p_union_id AND l.club_id = r.club_id
       AND l.period_start = v_from AND l.period_end = v_to;
    v_eco_recorded := FOUND;
    END IF;
    IF r.eco_enabled AND NOT v_eco_recorded THEN
      RAISE EXCEPTION 'union_squareup_eco_not_recorded' USING ERRCODE = '23514',
        DETAIL = jsonb_build_object('union_id', p_union_id, 'club_id', r.club_id,
          'period_start', v_from, 'period_end', v_to, 'stated_eco', r.eco_amount)::text;
    END IF;
    /* THE RECORD ANSWERS FOR ITS OWN ARITHMETIC (2026-09-25). The
       comparison below it - the document against union_eco_ledger - is
       the record against itself since 20260921040847 taught
       fn_union_club_invoice to RETURN the recorded amount, and a
       rehearsal proved it silent while a recorded value was mutated by
       0.01. The independent basis is IN the record: eco_base, eco_rate
       and eco_amount are stored side by side, all NOT NULL, and the
       producer defines the amount as round(-eco_rate*eco_base,2)
       (fn_union_pnl_evidence_report). Three stored numerics, no
       recomputation of the week, no second snapshot - so this can fire
       without resurrecting the 2026-09-14 overstatement that a second
       VOLATILE recomputation caused. The two arms below it are kept and
       are not weakened: the ECO-disabled arm is the one arm of the old
       comparison that could always fire. */
    IF r.eco_enabled AND v_eco_recorded AND v_components->>'eco_version' IS DISTINCT FROM '2'
       AND (v_recorded_base IS NULL OR v_recorded_rate IS NULL
            OR round(-v_recorded_rate * v_recorded_base, 2)
               IS DISTINCT FROM round(COALESCE(v_recorded_eco, 0), 2)) THEN
      RAISE EXCEPTION 'union_squareup_eco_record_fails_its_own_arithmetic' USING ERRCODE = '23514',
        DETAIL = jsonb_build_object('union_id', p_union_id, 'club_id', r.club_id,
          'period_start', v_from, 'period_end', v_to,
          'recorded_eco', v_recorded_eco, 'recorded_base', v_recorded_base,
          'recorded_rate', v_recorded_rate,
          'base_times_rate', round(-v_recorded_rate * v_recorded_base, 2))::text,
        HINT = 'union_eco_ledger.eco_amount must equal round(-eco_rate*eco_base,2). A record that does not support its own figure cannot be invoiced.';
    END IF;
    IF round(COALESCE(r.eco_amount, 0), 2)
       IS DISTINCT FROM round(COALESCE(v_recorded_eco, 0), 2) THEN
      RAISE EXCEPTION 'union_squareup_eco_disagrees_with_record' USING ERRCODE = '23514',
        DETAIL = jsonb_build_object('union_id', p_union_id, 'club_id', r.club_id,
          'period_start', v_from, 'period_end', v_to,
          'stated_eco', r.eco_amount, 'recorded_eco', v_recorded_eco)::text;
    END IF;
    IF NOT r.eco_enabled AND round(COALESCE(v_recorded_eco, 0), 2) <> 0 THEN
      RAISE EXCEPTION 'union_squareup_eco_disagrees_with_record' USING ERRCODE = '23514',
        DETAIL = jsonb_build_object('union_id', p_union_id, 'club_id', r.club_id,
          'period_start', v_from, 'period_end', v_to,
          'stated_eco', r.eco_amount, 'recorded_eco', v_recorded_eco,
          'eco_enabled', false)::text;
    END IF;

    SELECT sp.id INTO v_period_id
      FROM settlement_periods sp
     WHERE sp.club_id = r.club_id AND sp.union_id = p_union_id
       AND sp.start_at = v_from AND sp.end_at = v_to
     ORDER BY sp.created_at DESC LIMIT 1;

    IF v_period_id IS NULL THEN
      INSERT INTO settlement_periods (club_id, union_id, period_number, year,
                                      start_at, end_at, status)
      VALUES (r.club_id, p_union_id,
              EXTRACT(week FROM v_from)::int, EXTRACT(isoyear FROM v_from)::int,
              v_from, v_to, 'processing')
      RETURNING id INTO v_period_id;
    END IF;

    -- Reuse the number this document already carries. Take a new one ONLY
    -- when there is no document yet: the upsert below may take the ON
    -- CONFLICT path, and a number taken and not used is a gap in the series.
    SELECT si.invoice_number INTO v_number
      FROM settlement_invoices si
     WHERE si.club_id = r.club_id AND si.period_id = v_period_id
       AND si.invoice_type = 'union_weekly_squareup';
    IF NOT FOUND THEN
      v_number := public.fn_next_invoice_number(p_union_id, now());
    END IF;

    INSERT INTO settlement_invoices (
      club_id, period_id, invoice_type, invoice_number,
      from_entity_type, from_entity_id, to_entity_type, to_entity_id,
      gross_amount, net_amount, deductions, breakdown, status,
      chips_transferred, due_at, notes)
    VALUES (
      r.club_id, v_period_id, 'union_weekly_squareup', v_number,
      CASE WHEN r.outstanding >= 0 THEN 'union' ELSE 'club' END,
      CASE WHEN r.outstanding >= 0 THEN p_union_id::text ELSE r.club_id::text END,
      CASE WHEN r.outstanding >= 0 THEN 'club'  ELSE 'union' END,
      CASE WHEN r.outstanding >= 0 THEN r.club_id::text ELSE p_union_id::text END,
      abs(r.outstanding), abs(r.outstanding), 0,
      jsonb_build_object(
        'union_id', p_union_id, 'union_name', v_union_name,
        'club_id', r.club_id, 'club_name', r.club_name,
        'period_start', r.period_start, 'period_end', r.period_end,
        'rake_generated', r.rake_generated,
        'union_fee_kept', r.union_fee_kept,
        'rakeback_due',   r.rakeback_due,
        'players_won',    r.players_won,
        'player_pnl_net', r.player_pnl_net,
        'eco_amount',     r.eco_amount,
        'eco_enabled',    r.eco_enabled,
        'presettled',     r.presettled,
        'settled_in_chips', r.settled_in_chips,
        'outstanding',    r.outstanding,
        'net_position',   r.net_position,
        'direction',      r.direction,
        'baseline_cash_exact', v_basis_exact,
        'computed_at',    now())||v_components,
      'generated', false, v_due,
      'Weekly union square-up. settled_in_chips already moved during the week; '
      || 'outstanding is the amount to settle.')
    ON CONFLICT (club_id, period_id, invoice_type)
      WHERE invoice_type = 'union_weekly_squareup'
    DO UPDATE SET
      from_entity_type = EXCLUDED.from_entity_type,
      from_entity_id   = EXCLUDED.from_entity_id,
      to_entity_type   = EXCLUDED.to_entity_type,
      to_entity_id     = EXCLUDED.to_entity_id,
      gross_amount     = EXCLUDED.gross_amount,
      net_amount       = EXCLUDED.net_amount,
      invoice_number   = COALESCE(settlement_invoices.invoice_number, EXCLUDED.invoice_number),
      breakdown        = EXCLUDED.breakdown,
      due_at           = EXCLUDED.due_at,
      updated_at       = now()
    WHERE COALESCE(settlement_invoices.message_sent, false) = false AND settlement_invoices.status NOT IN('paid','cancelled')
    RETURNING id, COALESCE(message_sent, false) INTO v_invoice_id, v_already_sent;

    -- The upsert returns nothing when the guard above refused to restate an
    -- already-delivered invoice. That row is the record; read it as it stands.
    IF v_invoice_id IS NULL THEN
      SELECT si.id, COALESCE(si.message_sent, false)
        INTO v_invoice_id, v_already_sent
        FROM settlement_invoices si
       WHERE si.club_id = r.club_id
         AND si.period_id = v_period_id
         AND si.invoice_type = 'union_weekly_squareup';
    END IF;

    v_issued := v_issued + 1;

    -- Delivery is mandatory and shared with every accounting invoice.
    v_msg := public.fn_deliver_accounting_invoice(v_invoice_id);
    v_notified := v_notified + CASE WHEN v_already_sent THEN (v_msg->>'new_deliveries')::int ELSE (v_msg->>'delivered')::int END;
    v_messaged := v_messaged + CASE WHEN v_already_sent THEN (v_msg->>'new_deliveries')::int ELSE (v_msg->>'delivered')::int END;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'club_id', r.club_id, 'club_name', r.club_name,
      'invoice_id', v_invoice_id, 'outstanding', r.outstanding,
      'direction', r.direction, 'due_at', v_due,
      'messaged', COALESCE((v_msg->>'delivered')::int, 0),
      'already_sent', v_already_sent));
  END LOOP;

  RETURN jsonb_build_object('success', true, 'union_id', p_union_id,
    'period_start', v_from, 'period_end', v_to, 'due_at', v_due,
    'baseline_cash_exact', v_basis_exact,
    'invoices', v_issued, 'notified', v_notified, 'messenger_deliveries', v_messaged,
    'detail', v_out);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_union_settlement_cascade(p_union_id uuid DEFAULT 'fade0000-0000-0000-0000-000000000001'::uuid, p_period_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_preparation jsonb; v_credit_club record;
  v_from timestamptz := COALESCE(p_period_start, public.fn_union_prev_week_start(now()));
  v_to   timestamptz := COALESCE(p_period_end,   public.fn_union_week_start(now()));
  v_r1 jsonb; v_r2 jsonb; v_r3 jsonb; v_eco jsonb; v_inv jsonb;
  v_floor timestamptz;
  v_club_statements jsonb; v_previous_validated text;
  v_sqlstate text; v_msg text; v_detail text; v_context text;
  v_pending jsonb; v_posted record; v_quality jsonb;
  -- CHUNKED CLOSE (20261003): set by job 272's tick; see
  -- fn_process_weekly_accounting_scope. Off, this function is unchanged.
  v_chunked boolean := COALESCE(current_setting('app.weekly_accounting_chunked', true), '') = 'on';

BEGIN
  IF EXISTS (SELECT 1 FROM settlement_locks WHERE lock_type = 'GLOBAL_SETTLEMENT_FREEZE' AND is_active = true) THEN
    RAISE EXCEPTION 'EMERGENCY_PROFIT_DRIFT_LOCK';
  END IF;

  IF NOT public.fn_caller_is_engine() AND (auth.uid() IS NULL OR ( NOT public.fn_is_union_overseer(p_union_id, auth.uid()))) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  IF public.fn_ca_launch_accounting_waived('union',p_union_id,v_to) THEN
    RETURN jsonb_build_object('success',true,'waived',true,'paid',false,'reason','owner_directed_launch_waiver','union_id',p_union_id,'period_start',v_from,'period_end',v_to);
  END IF;
  -- THE FLOOR, checked before anything moves. Round 1 has always honoured it;
  -- nothing above round 1 did, so three further rounds ran on a floored week.
  SELECT f.earliest_period_start INTO v_floor
    FROM union_settlement_floor f WHERE f.union_id = p_union_id;

  IF v_floor IS NOT NULL AND v_from < v_floor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'union_settlement_incomplete', DETAIL = (jsonb_build_object('success', false, 'union_id', p_union_id,
      'error', 'before_settlement_floor',
      'period_start', v_from, 'period_end', v_to,
      'settlement_floor', v_floor,
      'note', 'This period is below the union settlement floor and must not be '
              || 'settled. No round was run.'))::text;
  END IF;

  /* WARM THE CACHE BEFORE THE FIRST LOCK (2026-09-09). union_rake_rollup_days
     is a speed cache: a day that is missing is recomputed live and correct,
     but it is recomputed INSIDE the settlement, while it holds treasury rows -
     which is where this union has been deadlocking. Doing it here costs the
     same work at a moment when nothing is locked. A failure is not fatal:
     the live path still answers, just more slowly. */
  BEGIN
    PERFORM public.fn_union_rake_rollup_refresh_day(p_union_id, g.d::date)
       FROM generate_series(v_from::date, (v_to - interval '1 day')::date, interval '1 day') g(d)
      WHERE NOT EXISTS (SELECT 1 FROM public.union_rake_rollup_days rd
                         WHERE rd.union_id = p_union_id AND rd.day = g.d::date)
        AND g.d::date < (now() AT TIME ZONE 'UTC')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'settlement could not warm the rake rollup (%); the live path will answer instead', SQLERRM;
  END;

  IF v_from IS NULL OR NOT isfinite(v_from) OR v_from<>public.fn_union_week_start(v_from)
   OR v_to IS DISTINCT FROM public.fn_union_week_start(v_from+interval '8 days') THEN
   RAISE EXCEPTION 'accounting_preparation_requires_closed_week' USING ERRCODE='22023';
  END IF;
  PERFORM public.fn_union_pnl_closed_book_barrier(v_to);
  -- Serialize every entry point for this union/period. A replay must read
  -- the receipts after the competing transaction commits, before moving chips.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'union-accounting:' || p_union_id::text || ':' || extract(epoch FROM v_from)::text || ':' || extract(epoch FROM v_to)::text, 0));

  -- A union-owned table is not a player's earning club. These outstanding
  -- records are invisible to the member-club join in Round 3. Never certify
  -- completion while they exist, and never guess a replacement beneficiary.
  IF EXISTS (SELECT 1 FROM public.rakeback_periods rp
       WHERE rp.club_id = p_union_id AND rp.status = 'pending'
         AND rp.rakeback_amount > 0
         AND (rp.period_start::timestamp AT TIME ZONE 'America/Los_Angeles') < v_to
         AND ((rp.period_end + 1)::timestamp AT TIME ZONE 'America/Los_Angeles') > v_from) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'union_rakeback_wrong_club',
      DETAIL = 'Pending player rakeback is booked under the union ID. Reconcile the earning-club evidence before settlement.';
  END IF;

  -- THE UNION WALLET IS DEBITED LAST (20260929): round 1 leaves its rake
  -- wallet debit pending for this exact book; it is posted below, after the
  -- statements, so live hands are never queued behind the close.
  -- CHUNKED CLOSE (20261003): a round that commits in its own transaction
  -- posts its own union wallet debit (round 1's original undeferred path):
  -- a pending debit is a transaction-local setting and cannot outlive it.
  PERFORM set_config('app.union_close_defer_rake_debit', CASE WHEN v_chunked THEN '' ELSE p_union_id::text || ':'
    || to_char(v_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '..'
    || to_char(v_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END, true);
  PERFORM set_config('app.union_close_pending_rake_debit', '', true);

  -- ROUND 1 - union rake treasury pays the clubs their 90%.
  PERFORM public.fn_assert_cash_commission_period(p_union_id,NULL,v_from,v_to);
  v_preparation:=public.fn_prepare_accounting_week(p_union_id,NULL,v_from,v_to);
  IF v_preparation->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'weekly_accounting_calculation_incomplete' USING DETAIL=v_preparation::text;
  END IF;
  PERFORM public.fn_weekly_accounting_deadline_check();
  v_r1 := public.fn_union_weekly_rakeback_close(p_union_id, v_from, v_to);
  INSERT INTO union_settlement_rounds (union_id, period_start, period_end, round_no, round_name,
                                       payers, payees, amount, detail)
  VALUES (p_union_id, v_from, v_to, 1, 'union_to_clubs', 1,
          COALESCE((v_r1->>'clubs_paid')::int,0),
          COALESCE((v_r1->>'total_rakeback')::numeric,0), v_r1)
  ON CONFLICT (union_id, period_start, period_end, round_no) DO NOTHING;

  IF COALESCE((v_r1->>'success')::boolean, false) IS NOT TRUE
     AND COALESCE(v_r1->>'error','') <> 'already_executed' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'union_settlement_incomplete', DETAIL = (jsonb_build_object('success', false, 'union_id', p_union_id,
      'error', 'round1_failed: ' || COALESCE(v_r1->>'error','unknown'),
      'period_start', v_from, 'period_end', v_to,
      'round1_union_to_clubs', v_r1,
      'note', 'Rounds 2, 3 and 4 were not run. A club is not asked to pay its '
              || 'agents out of a treasury the union has not funded.'))::text;
  END IF;

  -- CHUNKED CLOSE (20261003): a round that moved money ends this attempt
  -- here; it commits with its receipts (union_rakeback_log, the final
  -- ca_settlements row, union_settlement_rounds round 1) and the next attempt
  -- skips it by them ('already_executed'). Nothing after this point - no
  -- period is marked settled, no statement or square-up is issued - until
  -- the attempt that finds every round committed.
  IF v_chunked AND v_r1->>'success' = 'true' THEN
    RETURN jsonb_build_object('success', false, 'chunk_committed', true, 'committed_round', 1,
      'union_id', p_union_id, 'period_start', v_from, 'period_end', v_to,
      'round1_union_to_clubs', v_r1);
  END IF;

  -- ROUND 2 - clubs pay their super agents and agents.
  PERFORM public.fn_weekly_accounting_deadline_check();
  -- CHUNKED CLOSE (20261003): a round 2 an earlier attempt committed is
  -- answered from its own receipt - exactly what the stage returns for it
  -- as a duplicate - instead of reading the whole week again to prove it.
  -- Every attempt has first re-run the book's barrier, accrual, refusal and
  -- preparation checks, under which no source of this closed week can change.
  IF v_chunked THEN
    SELECT r.result||jsonb_build_object('duplicate',true) INTO v_r2 FROM public.accounting_routed_settlement_runs r
     WHERE r.scope_kind='union' AND r.scope_id=p_union_id AND r.period_start=v_from AND r.period_end=v_to AND r.round_no=2;
  END IF;
  IF v_r2 IS NULL THEN
  v_r2 := public.fn_settle_round2_club_to_agents(p_union_id, v_from, v_to);
  END IF;
  IF v_r2->>'routing_version' IS DISTINCT FROM '3'
    OR v_r2->>'source_version' IS DISTINCT FROM '2'
    OR NOT EXISTS(SELECT 1 FROM public.accounting_routed_settlement_runs r
      WHERE r.union_id=p_union_id AND r.period_start=v_from AND r.period_end=v_to AND r.round_no=2
       AND r.result=(v_r2-'duplicate')) THEN
    RAISE EXCEPTION 'weekly_routing_receipt_not_confirmed' USING ERRCODE='23514';
  END IF;
  INSERT INTO union_settlement_rounds (union_id, period_start, period_end, round_no, round_name,
                                       payees, amount, shortfalls, detail)
  VALUES (p_union_id, v_from, v_to, 2, 'club_to_agents',
          COALESCE((v_r2->>'payees')::int,0), COALESCE((v_r2->>'amount')::numeric,0),
          COALESCE((v_r2->>'shortfalls')::int,0), v_r2)
  ON CONFLICT (union_id, period_start, period_end, round_no) DO UPDATE
    SET detail=union_settlement_rounds.detail || jsonb_build_object('latest_attempt',EXCLUDED.detail);

  -- Round 2 carries no 'success' key: it raises on error and returns
  -- {round,name,payees,amount,shortfalls,detail} otherwise, so a test for
  -- 'success' would be unreachable. Assert the CONTRACT instead - a round that
  -- stops reporting an amount must stop the cascade, not record 0 and carry on.
  IF (v_r2->>'amount') IS NULL OR (v_r2->>'payees') IS NULL
     OR (v_r2->>'shortfalls') IS NULL
     OR jsonb_typeof(v_r2->'shortfalls') IS DISTINCT FROM 'number'
     OR (v_r2 ? 'success' AND COALESCE((v_r2->>'success')::boolean, true) IS FALSE
         AND COALESCE(v_r2->>'error','') <> 'already_executed') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'union_settlement_incomplete', DETAIL = (jsonb_build_object('success', false, 'union_id', p_union_id,
      'error', 'round2_contract_violated_or_failed: ' || COALESCE(v_r2->>'error','unknown'),
      'period_start', v_from, 'period_end', v_to,
      'round1_union_to_clubs', v_r1, 'round2_club_to_agents', v_r2,
      'note', 'Rounds 3 and 4 were not run.'))::text;
  END IF;

  -- CHUNKED CLOSE (20261003): round 2 commits on its own only with no
  -- shortfall, exactly what the unchunked close would have kept; the next
  -- attempt finds its receipt (accounting_routed_settlement_runs round 2)
  -- and the stage returns it as a duplicate.
  IF v_chunked AND v_r2->>'duplicate' IS DISTINCT FROM 'true' THEN
    IF (v_r2->>'shortfalls')::numeric <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'union_settlement_incomplete', DETAIL = (jsonb_build_object('success',false,'union_id',p_union_id,
        'error','recipient_shortfalls_remaining','period_start',v_from,'period_end',v_to,
        'round1_union_to_clubs',v_r1,'round2_club_to_agents',v_r2))::text;
    END IF;
    RETURN jsonb_build_object('success', false, 'chunk_committed', true, 'committed_round', 2,
      'union_id', p_union_id, 'period_start', v_from, 'period_end', v_to,
      'round1_union_to_clubs', v_r1, 'round2_club_to_agents', v_r2);
  END IF;

  -- ROUND 3 - agents pay their players.
  PERFORM public.fn_weekly_accounting_deadline_check();
  -- CHUNKED CLOSE (20261003): the same for a committed round 3.
  IF v_chunked THEN
    SELECT r.result||jsonb_build_object('duplicate',true) INTO v_r3 FROM public.accounting_routed_settlement_runs r
     WHERE r.scope_kind='union' AND r.scope_id=p_union_id AND r.period_start=v_from AND r.period_end=v_to AND r.round_no=3;
  END IF;
  IF v_r3 IS NULL THEN
  v_r3 := public.fn_settle_round3_agents_to_players(p_union_id, v_from, v_to);
  END IF;
  -- CHUNKED CLOSE (20261003, round 3 in batches): a batch that paid part of
  -- round 3 ends this attempt as a committed step; the next attempt pays on.
  IF v_chunked AND v_r3->>'batch_committed' = 'true' THEN
    RETURN jsonb_build_object('success', false, 'chunk_committed', true, 'committed_round', 3, 'stage', 'round3_batch',
      'union_id', p_union_id, 'period_start', v_from, 'period_end', v_to, 'round3_batch', v_r3);
  END IF;
  IF v_r3->>'routing_version' IS DISTINCT FROM '3'
    OR v_r3->>'source_version' IS DISTINCT FROM '2'
    OR NOT EXISTS(SELECT 1 FROM public.accounting_routed_settlement_runs r
      WHERE r.union_id=p_union_id AND r.period_start=v_from AND r.period_end=v_to AND r.round_no=3
       AND r.result=(v_r3-'duplicate')) THEN
    RAISE EXCEPTION 'weekly_routing_receipt_not_confirmed' USING ERRCODE='23514';
  END IF;
  INSERT INTO union_settlement_rounds (union_id, period_start, period_end, round_no, round_name,
                                       payees, amount, shortfalls, detail)
  VALUES (p_union_id, v_from, v_to, 3, 'agents_to_players',
          COALESCE((v_r3->>'payees')::int,0), COALESCE((v_r3->>'amount')::numeric,0),
          COALESCE((v_r3->>'shortfalls')::int,0), v_r3)
  ON CONFLICT (union_id, period_start, period_end, round_no) DO UPDATE
    SET detail=union_settlement_rounds.detail || jsonb_build_object('latest_attempt',EXCLUDED.detail);

  -- Same contract assertion for round 3.
  IF (v_r3->>'amount') IS NULL OR (v_r3->>'payees') IS NULL
     OR (v_r3->>'shortfalls') IS NULL
     OR jsonb_typeof(v_r3->'shortfalls') IS DISTINCT FROM 'number'
     OR (v_r3 ? 'success' AND COALESCE((v_r3->>'success')::boolean, true) IS FALSE
         AND COALESCE(v_r3->>'error','') <> 'already_executed') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'union_settlement_incomplete', DETAIL = (jsonb_build_object('success', false, 'union_id', p_union_id,
      'error', 'round3_contract_violated_or_failed: ' || COALESCE(v_r3->>'error','unknown'),
      'period_start', v_from, 'period_end', v_to,
      'round1_union_to_clubs', v_r1, 'round2_club_to_agents', v_r2,
      'round3_agents_to_players', v_r3,
      'note', 'Round 4 was not run; no statement is issued for a settlement '
              || 'that did not complete.'))::text;
  END IF;

  -- A round can post funded recipients while reporting others still unpaid.
  -- Keep that durable progress, but do not mark the period settled or issue
  -- completion statements until every reported shortfall is zero.
  IF (v_r2->>'shortfalls')::numeric <> 0
     OR (v_r3->>'shortfalls')::numeric <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'union_settlement_incomplete', DETAIL = (jsonb_build_object('success',false,'union_id',p_union_id,
      'error','recipient_shortfalls_remaining','period_start',v_from,'period_end',v_to,
      'round1_union_to_clubs',v_r1,'round2_club_to_agents',v_r2,
      'round3_agents_to_players',v_r3))::text;
  END IF;

  IF EXISTS (SELECT 1 FROM public.rakeback_periods rp
      JOIN public.fn_accounting_week_clubs(p_union_id,NULL,v_from,v_to) uc ON uc.club_id=rp.club_id
      WHERE rp.status='pending' AND rp.rakeback_amount>0
        AND rp.period_start >= (v_from AT TIME ZONE 'America/Los_Angeles')::date
        AND ((rp.period_end+1)::timestamp AT TIME ZONE 'America/Los_Angeles') <= v_to) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='union_player_obligations_remaining';
  END IF;

  -- CONSERVATION, asserted before anything else is written. Raises on a
  -- breach, which rolls this union's whole settlement back.
  PERFORM public.fn_union_settlement_conservation_assert(
            p_union_id, v_from, v_to, v_r1, v_r2, v_r3);

  -- CHUNKED CLOSE (20261003): round 3 commits on its own only after every
  -- test the unchunked close applies to it - no shortfall, no pending player
  -- period, conservation asserted - and the attempt that finds all three
  -- rounds committed repeats those tests before it settles the period.
  IF v_chunked AND v_r3->>'duplicate' IS DISTINCT FROM 'true' THEN
    RETURN jsonb_build_object('success', false, 'chunk_committed', true, 'committed_round', 3,
      'union_id', p_union_id, 'period_start', v_from, 'period_end', v_to,
      'round1_union_to_clubs', v_r1, 'round2_club_to_agents', v_r2,
      'round3_agents_to_players', v_r3);
  END IF;

  -- club_books_close_after_rakeback: the P&L guard owns the club settlement,
  -- after the earned fee cascade, before statements, ECO or settled status.
  v_quality:=public.fn_union_pnl_close_quality(p_union_id,v_from,v_to);
  IF v_quality->>'status' IS DISTINCT FROM 'ready' THEN
    IF v_chunked AND v_quality->'issues'='["union_pnl_certification_in_progress"]'::jsonb THEN
      RETURN jsonb_build_object('success',false,'chunk_committed',true,'committed_round',0,
        'stage','certifying','purpose','club_settlements','union_id',p_union_id,
        'period_start',v_from,'period_end',v_to,'pnl_evidence',v_quality);
    END IF;
    RAISE EXCEPTION 'union_pnl_basis_uncertified' USING ERRCODE='55000',DETAIL=v_quality::text;
  END IF;

  -- A CLUB STATEMENT'S TOURNAMENT PROOF IS ITS OWN STEP (20261017223358).
  -- Every club statement below proves its club's tournament week, about a
  -- minute a club at Midway's scale, and all of them were proved in the one
  -- attempt that also settles and issues: two clubs did not fit job 272's
  -- 240 s tick, so the 2026-10-05 Midway close could not finish. In a chunked
  -- close each club's READY proof is kept as a close certificate, one club per
  -- attempt, before anything below is settled or issued; the statement reads
  -- it back. A proof that is not ready refuses the statement here, as the
  -- statement itself would. A proof that cannot be kept changes nothing.
  IF v_chunked THEN
    FOR v_credit_club IN SELECT uc.club_id FROM public.fn_accounting_week_clubs(p_union_id,NULL,v_from,v_to) uc
                          WHERE uc.club_id<>p_union_id ORDER BY uc.club_id LOOP
      CONTINUE WHEN public.fn_accounting_close_certificate('club_statement_quality:'||v_credit_club.club_id::text,
        p_union_id,v_from,v_to)->>'status'='ready';
      PERFORM public.fn_weekly_accounting_deadline_check();
      v_quality:=public.fn_accounting_tournament_week_quality(v_credit_club.club_id,v_from,v_to);
      IF v_quality->>'status' IS DISTINCT FROM 'ready' THEN
        RAISE EXCEPTION 'club_weekly_statement_requires_reconciliation' USING ERRCODE='23514',
          DETAIL=jsonb_build_object('club_id',v_credit_club.club_id,'tournament_quality',v_quality)::text;
      END IF;
      PERFORM public.fn_accounting_close_certify('club_statement_quality:'||v_credit_club.club_id::text,
        p_union_id,v_from,v_to,v_quality);
      IF public.fn_accounting_close_certificate('club_statement_quality:'||v_credit_club.club_id::text,
        p_union_id,v_from,v_to)->>'status'='ready' THEN
        RETURN jsonb_build_object('success', false, 'chunk_committed', true, 'committed_round', 3,
          'stage', 'statement_evidence', 'club_id', v_credit_club.club_id,
          'union_id', p_union_id, 'period_start', v_from, 'period_end', v_to);
      END IF;
      EXIT;
    END LOOP;
  END IF;

  -- The period is an accounting object, not a by-product of invoicing.
  PERFORM public.fn_mark_scope_accounting_settled('union',p_union_id,v_from,v_to);

  IF smarter_private.union_eco_terms_for_book(p_union_id,v_from,v_to) IS NOT NULL OR public.fn_union_pnl_qualified_clubs(p_union_id,v_from,v_to)#>>'{eco_commercial_terms_evidence,segments,0,terms,eco_enabled}'='true' THEN
    BEGIN
      v_eco := public.fn_union_eco_record(p_union_id, v_from, v_to, NULL);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT,
                              v_detail = PG_EXCEPTION_DETAIL, v_context = PG_EXCEPTION_CONTEXT;
      v_eco := jsonb_build_object('success', false, 'error', v_msg, 'sqlstate', v_sqlstate,
                                  'exception_detail', v_detail, 'exception_context', v_context);
    END;
  ELSE
    v_eco := jsonb_build_object('skipped', true, 'reason', 'eco_disabled');
  END IF;

  IF v_eco->>'success' = 'false' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'union_eco_record_failed', DETAIL = v_eco::text;
  END IF;

  PERFORM public.fn_weekly_accounting_deadline_check();
  IF public.fn_union_setting(p_union_id, 'weekly_invoices_enabled', 1) <> 1 THEN
    v_inv := jsonb_build_object(
      'success', true, 'skipped', true, 'invoices', 0,
      'reason', 'weekly_invoices_disabled: the union setting weekly_invoices_enabled is 0. '
                || 'Since Phase 6 (20260907) the statement reads the same fn_union_club_rake_basis '
                || 'rows round 1 pays on; switching statements back on is a setting, not a fix.');
  ELSE
    BEGIN
      v_inv := public.fn_union_issue_weekly_invoices(p_union_id, v_from, v_to, true);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT,
                              v_detail = PG_EXCEPTION_DETAIL, v_context = PG_EXCEPTION_CONTEXT;
      v_inv := jsonb_build_object('success', false, 'error', v_msg, 'sqlstate', v_sqlstate,
                                  'exception_detail', v_detail, 'exception_context', v_context);
    END;
  END IF;

  INSERT INTO union_settlement_rounds (union_id, period_start, period_end, round_no, round_name,
                                       payees, amount, detail)
  VALUES (p_union_id, v_from, v_to, 4, 'union_invoices_issued',
          COALESCE((v_inv->>'invoices')::int, 0), 0, v_inv)
  ON CONFLICT (union_id, period_start, period_end, round_no) DO UPDATE
    SET detail=EXCLUDED.detail,payees=EXCLUDED.payees;

  IF COALESCE((v_inv->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'union_settlement_incomplete', DETAIL = (jsonb_build_object('success', false, 'union_id', p_union_id,
      'error', 'round4_invoices_failed: ' || COALESCE(v_inv->>'error','unknown'),
      'period_start', v_from, 'period_end', v_to,
      'round1_union_to_clubs', v_r1, 'round2_club_to_agents', v_r2,
      'round3_agents_to_players', v_r3, 'eco_recorded', v_eco,
      'round4_invoices', v_inv))::text;
  END IF;

  IF COALESCE((v_inv->>'skipped')::boolean, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'union_invoices_not_issued', DETAIL = v_inv::text;
  END IF;

  IF EXISTS (SELECT 1 FROM public.fn_accounting_week_clubs(p_union_id,NULL,v_from,v_to) uc
    WHERE uc.club_id<>p_union_id
      AND NOT EXISTS (SELECT 1 FROM public.settlement_invoices si
        WHERE si.club_id=uc.club_id AND si.invoice_type='union_weekly_squareup'
          AND si.breakdown->>'union_id'=p_union_id::text
          AND (si.breakdown->>'period_start')::timestamptz=v_from
          AND (si.breakdown->>'period_end')::timestamptz=v_to
          AND si.message_sent=true AND si.status<>'cancelled')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='union_invoice_delivery_incomplete';
  END IF;

  -- THE SQUARE-UP'S OWN PERIOD SETTLES WITH ITS WEEK (2026-10-08). The
  -- settler above ran before round 4, and the square-up then opened the
  -- union's own club row (clubs.id = union id) as 'processing', so that one
  -- period never settled (cc6c056b, week of 2026-09-28). Settle every period
  -- this week opened once more, now that the last opener has run, and prove it.
  PERFORM public.fn_mark_scope_accounting_settled('union',p_union_id,v_from,v_to);
  IF EXISTS (SELECT 1 FROM public.settlement_periods sp
              WHERE sp.union_id=p_union_id AND sp.start_at=v_from AND sp.end_at=v_to
                AND sp.status NOT IN ('settled','closed')) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='union_week_period_left_unsettled';
  END IF;

  PERFORM public.fn_weekly_accounting_deadline_check();
  FOR v_credit_club IN SELECT club_id FROM public.fn_accounting_week_clubs(p_union_id,NULL,v_from,v_to) ORDER BY club_id LOOP
    PERFORM public.fn_generate_scope_credit_invoices(v_credit_club.club_id,v_from,v_to);
  END LOOP;
  v_previous_validated:=current_setting('app.union_accounting_validated_period',true);
  PERFORM set_config('app.union_accounting_validated_period',p_union_id::text||':'||v_from::text||':'||v_to::text,true);
  v_club_statements:=public.fn_issue_club_weekly_accounting(p_union_id,v_from,v_to);
  PERFORM public.fn_weekly_accounting_deadline_check();
  PERFORM set_config('app.union_accounting_validated_period',COALESCE(v_previous_validated,''),true);
  v_pending := NULLIF(current_setting('app.union_close_pending_rake_debit', true), '')::jsonb;
  PERFORM set_config('app.union_close_defer_rake_debit', '', true);
  PERFORM set_config('app.union_close_pending_rake_debit', '', true);
  IF v_r1->>'success' = 'true' AND COALESCE((v_r1->>'period_rake')::numeric, 0) > 0 AND (v_pending IS NULL OR v_pending->>'settlement_id' IS DISTINCT FROM v_r1->>'settlement_id') THEN
    RAISE EXCEPTION 'union_close_rake_debit_not_pending' USING ERRCODE='55000';
  END IF;
  IF v_pending IS NOT NULL THEN
    IF v_r1->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'union_close_rake_debit_without_round1' USING ERRCODE='55000';
    END IF;
    SELECT * INTO v_posted FROM public.fn_union_close_post_rake_debit(v_pending);
    v_r1 := v_r1 || jsonb_build_object('rake_wallet_after', v_posted.rw_after, 'chip_balance_after', v_posted.cb_after,
      'rake_debit_posted', 'last_write_of_cascade');
  END IF;
  RETURN jsonb_build_object('success', true, 'union_id', p_union_id, 'club_weekly_statements',v_club_statements,
    'period_start', v_from, 'period_end', v_to,
    'round1_union_to_clubs', v_r1, 'round2_club_to_agents', v_r2,
    'round3_agents_to_players', v_r3, 'eco_recorded', v_eco,
    'round4_invoices', v_inv);
END $function$
;

DO $governance_preimage$BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_governance_eco_proven(jsonb)'::regprocedure))<>'50e8b8a420ed2ee4c02de39012cea491' THEN
  RAISE EXCEPTION 'original_eco_governance_preimage_changed';END IF;
END$governance_preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_governance_eco_proven(p_metadata jsonb)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE obligation jsonb;u uuid;ws timestamptz;we timestamptz;roster jsonb;c jsonb;component jsonb;
BEGIN
 IF jsonb_typeof(p_metadata->'eco_obligations')IS DISTINCT FROM 'array'OR jsonb_array_length(p_metadata->'eco_obligations')=0 THEN RETURN false;END IF;
 FOR obligation IN SELECT x FROM jsonb_array_elements(p_metadata->'eco_obligations')x LOOP
  BEGIN u:=(obligation->>'union_id')::uuid;ws:=(obligation->>'period_start')::timestamptz;we:=(obligation->>'period_end')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;END;
  IF u IS NULL OR ws IS NULL OR we IS NULL OR NOT isfinite(ws)OR NOT isfinite(we)
   OR ws IS DISTINCT FROM public.fn_union_week_start(ws)OR we IS DISTINCT FROM public.fn_union_week_start(ws+interval '8 days')
   OR NOT EXISTS(SELECT FROM public.union_accounting_runs r WHERE r.scope_kind='union'AND r.scope_id=u AND r.period_start=ws AND r.period_end=we
    AND r.status='complete'AND r.result->>'success'='true'AND r.result->>'accounting_version'='3')THEN RETURN false;END IF;
  IF EXISTS(SELECT FROM smarter_private.union_eco_components WHERE union_id=u AND period_start=ws AND period_end=we)THEN
   SELECT basis->'club_roster'INTO roster FROM smarter_private.union_eco_components WHERE union_id=u AND period_start=ws AND period_end=we ORDER BY club_id,activity LIMIT 1;
   IF jsonb_typeof(roster)IS DISTINCT FROM 'array'OR jsonb_array_length(roster)=0
    OR(SELECT count(DISTINCT x)FROM jsonb_array_elements_text(roster)x)<>jsonb_array_length(roster)
    OR EXISTS(SELECT FROM smarter_private.union_eco_components WHERE union_id=u AND period_start=ws AND period_end=we AND basis->'club_roster'IS DISTINCT FROM roster)
    OR(SELECT jsonb_agg(to_jsonb(club_id)ORDER BY club_id)FROM(SELECT DISTINCT club_id FROM smarter_private.union_eco_components WHERE union_id=u AND period_start=ws AND period_end=we)r)IS DISTINCT FROM roster THEN RETURN false;END IF;
   FOR c IN SELECT x FROM jsonb_array_elements(roster)x LOOP
    component:=smarter_private.union_eco_invoice_components(u,(c#>>'{}')::uuid,ws,we);
    IF component->>'eco_version'IS DISTINCT FROM '2'OR NOT EXISTS(SELECT FROM public.settlement_invoices i WHERE i.id IS NOT NULL
     AND i.club_id=(c#>>'{}')::uuid AND i.invoice_type='union_weekly_squareup'AND i.breakdown->>'union_id'=u::text
     AND(i.breakdown->>'period_start')::timestamptz=ws AND(i.breakdown->>'period_end')::timestamptz=we
     AND i.message_sent=true AND i.status<>'cancelled'AND i.breakdown->'eco_version'='2'::jsonb
     AND i.breakdown->'eco_components'=component->'eco_components'
     AND(i.breakdown->>'eco_amount')::numeric=(component->>'eco_amount')::numeric)THEN RETURN false;END IF;
   END LOOP;
  ELSIF NOT EXISTS(SELECT FROM public.union_eco_ledger WHERE union_id=u AND period_start=ws AND period_end=we)THEN RETURN false;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN false;
END$f$;
-- Insert inside the owned combined migration transaction; no financial writes.
DO $eco_board_preimage$DECLARE p pg_proc;BEGIN
 SELECT *INTO STRICT p FROM pg_proc WHERE oid='public.ca_union_statement_board(uuid,date,integer)'::regprocedure;
 IF md5(pg_get_functiondef(p.oid))<>'2dc15caf24356d48621316759315d78f'OR p.proowner<>'postgres'::regrole
  OR NOT p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']
  OR p.proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
 THEN RAISE EXCEPTION 'DUAL_ECO_BOARD_PREIMAGE_OR_AUTHORITY_CHANGED';END IF;
END$eco_board_preimage$;

CREATE OR REPLACE FUNCTION public.ca_union_statement_board(p_union_id uuid, p_period_end date DEFAULT NULL::date, p_history integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hist int := GREATEST(LEAST(COALESCE(p_history, 8), 52), 1);
  v_end  date;
  v_out  jsonb;
BEGIN
  IF NOT ca_can_oversee_union(p_union_id) THEN
    RAISE EXCEPTION 'not authorized for this union' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p_period_end, MAX((s.breakdown->>'period_end')::date))
    INTO v_end
    FROM settlement_invoices s
   WHERE s.invoice_type = 'union_weekly_squareup'
     AND s.breakdown->>'union_id' = p_union_id::text;

  WITH invoice_eco AS NOT MATERIALIZED (
    -- Project the immutable issued invoice. Never rerun today's ECO terms or
    -- invent aggregate record IDs/rates for separately recorded activities.
    SELECT s.*, COALESCE(s.breakdown->'eco_version'='2'::jsonb
             AND e.parts=2 AND e.record_ids=2 AND e.cash_parts=1 AND e.tournament_parts=1 AND e.valid_parts
             AND jsonb_typeof(s.breakdown->'eco_amount')='number'
             AND CASE WHEN jsonb_typeof(s.breakdown->'eco_amount')='number'
                  THEN (s.breakdown->>'eco_amount')::numeric=e.component_amount END,false) AS recorded_eco_complete,
           e.cash_amount AS recorded_cash_eco_amount,
           e.tournament_amount AS recorded_tournament_eco_amount
      FROM settlement_invoices s
      CROSS JOIN LATERAL (
        SELECT count(*) AS parts, count(DISTINCT c.value->>'record_id') AS record_ids,
          count(*) FILTER(WHERE c.value->>'activity'='cash') AS cash_parts,
          count(*) FILTER(WHERE c.value->>'activity'='tournament') AS tournament_parts,
          bool_and(COALESCE(jsonb_typeof(c.value)='object'
            AND c.value->>'activity' IN('cash','tournament')
            AND jsonb_typeof(c.value->'enabled')='boolean'
            AND c.value->>'base_mode'='club_profit'
            AND jsonb_typeof(c.value->'base')='number'
            AND jsonb_typeof(c.value->'rate')='number'
            AND jsonb_typeof(c.value->'amount')='number'
            AND CASE WHEN jsonb_typeof(c.value->'amount')='number'
                 THEN (c.value->>'amount')::numeric=round((c.value->>'amount')::numeric,2) END
            AND CASE WHEN jsonb_typeof(c.value->'base')='number'
                 AND jsonb_typeof(c.value->'rate')='number' AND jsonb_typeof(c.value->'amount')='number'
                 AND jsonb_typeof(c.value->'enabled')='boolean'
                 THEN (c.value->>'rate')::numeric BETWEEN 0 AND 1
                  AND (c.value->>'amount')::numeric=CASE WHEN (c.value->>'enabled')::boolean
                   THEN round(-(c.value->>'base')::numeric*(c.value->>'rate')::numeric,2) ELSE 0 END END
            AND jsonb_typeof(c.value->'terms_id')='string'
            AND pg_input_is_valid(c.value->>'terms_id','uuid')
            AND jsonb_typeof(c.value->'record_id')='string'
            AND pg_input_is_valid(c.value->>'record_id','uuid')
            AND c.value->>'status'='recorded',false)) AS valid_parts,
          sum(CASE WHEN jsonb_typeof(c.value->'amount')='number' THEN (c.value->>'amount')::numeric END) AS component_amount,
          max(CASE WHEN c.value->>'activity'='cash' AND jsonb_typeof(c.value->'amount')='number' THEN (c.value->>'amount')::numeric END) AS cash_amount,
          max(CASE WHEN c.value->>'activity'='tournament' AND jsonb_typeof(c.value->'amount')='number' THEN (c.value->>'amount')::numeric END) AS tournament_amount
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.breakdown->'eco_components')='array'
          THEN s.breakdown->'eco_components' ELSE '[]'::jsonb END)c(value)
      )e
     WHERE s.invoice_type='union_weekly_squareup' AND s.breakdown->>'union_id'=p_union_id::text
  ),
  clubs_in_union AS (
    -- Current members must show missing invoices. Former members keep their
    -- historical invoice under the union that issued it, after membership moves.
    SELECT c.id AS club_id, c.name AS club_name, c.code AS club_code, c.slug AS club_slug
      FROM clubs c
     WHERE EXISTS (SELECT 1 FROM union_clubs uc WHERE uc.club_id=c.id AND uc.union_id=p_union_id)
        OR EXISTS (SELECT 1 FROM settlement_invoices s WHERE s.club_id=c.id
          AND s.invoice_type='union_weekly_squareup'
          AND s.breakdown->>'union_id'=p_union_id::text
          AND (v_end IS NULL OR (s.breakdown->>'period_end')::date=v_end))
  ),
  period_invoices AS (
    SELECT DISTINCT ON (s.club_id) s.*
      FROM invoice_eco s
      JOIN clubs_in_union cu ON cu.club_id = s.club_id
     WHERE s.invoice_type = 'union_weekly_squareup'
       AND s.breakdown->>'union_id' = p_union_id::text
       AND (v_end IS NULL OR (s.breakdown->>'period_end')::date = v_end)
     ORDER BY s.club_id, s.created_at DESC
  ),
  board AS (
    SELECT cu.club_id, cu.club_name, cu.club_code, cu.club_slug,
           (i.id IS NULL OR i.status <> 'paid' OR coalesce(i.net_amount,0)=0 OR i.breakdown->>'paid_total' IS NOT NULL) AS payment_details_available,
           i.id                            AS invoice_id,
           (i.net_amount IS NOT NULL
             AND i.breakdown->>'rake_generated' IS NOT NULL
             AND i.breakdown->>'rakeback_due' IS NOT NULL
             AND i.breakdown->>'union_fee_kept' IS NOT NULL) AS snapshot_complete,
           COALESCE(i.status, 'missing')   AS status,
           i.created_at                    AS issued_at,
           i.due_at,
           COALESCE(i.net_amount, 0)       AS amount,
           i.breakdown->>'direction'       AS direction,
           COALESCE(i.message_sent, false) AS message_sent,
           COALESCE((i.breakdown->>'paid_total')::numeric, 0)     AS paid_total,
           COALESCE((i.breakdown->>'rake_generated')::numeric, 0) AS rake_generated,
           COALESCE((i.breakdown->>'rakeback_due')::numeric, 0)   AS rakeback_due,
           COALESCE((i.breakdown->>'union_fee_kept')::numeric, 0) AS union_fee_kept,
           COALESCE((i.breakdown->>'players_won')::numeric, 0)    AS players_won,
           COALESCE((i.breakdown->>'eco_amount')::numeric, 0)     AS eco_amount,
           COALESCE((i.breakdown->>'presettled')::numeric, 0)     AS presettled,
           CASE WHEN i.id IS NOT NULL THEN COALESCE(i.breakdown->'eco_version','1'::jsonb) END AS eco_version,
           CASE WHEN i.breakdown->'eco_version'='2'::jsonb THEN i.breakdown->'eco_components' END AS eco_components,
           COALESCE(i.recorded_eco_complete,false) AS eco_components_complete,
           CASE WHEN i.recorded_eco_complete THEN i.recorded_cash_eco_amount END AS cash_eco_amount,
           CASE WHEN i.recorded_eco_complete THEN i.recorded_tournament_eco_amount END AS tournament_eco_amount
      FROM clubs_in_union cu
      LEFT JOIN period_invoices i ON i.club_id = cu.club_id
  ),
  history AS (
    SELECT (s.breakdown->>'period_end')::date AS period_end,
           MIN((s.breakdown->>'period_start')::date) AS period_start,
           count(*)                                  AS clubs,
           round(SUM(s.net_amount), 2)               AS total_amount,
           round(SUM(COALESCE((s.breakdown->>'rake_generated')::numeric, 0)), 2) AS rake_generated,
           round(SUM(COALESCE((s.breakdown->>'eco_amount')::numeric, 0)), 2)     AS eco_amount,
           bool_and(s.recorded_eco_complete) AS eco_components_complete,
           CASE WHEN bool_and(s.recorded_eco_complete) THEN round(SUM(s.recorded_cash_eco_amount),2) END AS cash_eco_amount,
           CASE WHEN bool_and(s.recorded_eco_complete) THEN round(SUM(s.recorded_tournament_eco_amount),2) END AS tournament_eco_amount,
           count(*) FILTER (WHERE s.status = 'paid')                             AS paid,
           count(*) FILTER (WHERE COALESCE(s.message_sent, false))               AS delivered
      FROM invoice_eco s
     WHERE s.invoice_type = 'union_weekly_squareup'
       AND s.breakdown->>'union_id' = p_union_id::text
       AND s.breakdown ? 'period_end'
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT v_hist
  )
  SELECT jsonb_build_object(
    'union_id', p_union_id,
    'union_name', (SELECT u.name FROM unions u WHERE u.id = p_union_id),
    'period_end', v_end,
    'period_start', (SELECT MIN((i.breakdown->>'period_start')::date) FROM period_invoices i),
    'totals', (SELECT jsonb_build_object(
                 'clubs',      count(*),
                 'issued',     count(*) FILTER (WHERE b.status <> 'missing'),
                 'missing',    count(*) FILTER (WHERE b.status = 'missing'),
                 'delivered',  count(*) FILTER (WHERE b.message_sent),
                 'paid',       count(*) FILTER (WHERE b.status = 'paid'),
                 'clubs_owe',  round(COALESCE(SUM(b.amount) FILTER (WHERE b.amount > 0), 0), 2),
                 'union_owes', round(COALESCE(SUM(-b.amount) FILTER (WHERE b.amount < 0), 0), 2),
                 'net',        round(COALESCE(SUM(b.amount), 0), 2),
                 'payment_details_available', coalesce(bool_and(b.payment_details_available),true), 'collected', CASE WHEN coalesce(bool_and(b.payment_details_available),true) THEN round(COALESCE(SUM(b.paid_total), 0), 2) END,
                 -- what is still out: the unpaid remainder, not the headline
                 'outstanding', CASE WHEN coalesce(bool_and(b.payment_details_available),true) THEN round(COALESCE(SUM(
                     GREATEST(abs(b.amount) - b.paid_total, 0))
                     FILTER (WHERE b.status NOT IN ('missing','cancelled')), 0), 2) END,
                 'rake_generated', round(COALESCE(SUM(b.rake_generated), 0), 2),
                 'eco_amount',     round(COALESCE(SUM(b.eco_amount), 0), 2),
                 'eco_components_complete',count(*)>0 AND bool_and(b.eco_components_complete),
                 'cash_eco_amount',CASE WHEN count(*)>0 AND bool_and(b.eco_components_complete) THEN round(SUM(b.cash_eco_amount),2) END,
                 'tournament_eco_amount',CASE WHEN count(*)>0 AND bool_and(b.eco_components_complete) THEN round(SUM(b.tournament_eco_amount),2) END)
                 FROM board b),
    'clubs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'club_id', b.club_id, 'club_name', b.club_name,
               'club_code', b.club_code, 'club_slug', b.club_slug,
               'invoice_id', b.invoice_id, 'status', b.status, 'snapshot_complete', b.snapshot_complete,
               'issued_at', b.issued_at, 'due_at', b.due_at,
               'amount', round(b.amount, 2), 'direction', b.direction,
               'message_sent', b.message_sent,
               'payment_details_available', b.payment_details_available, 'paid_total', CASE WHEN b.payment_details_available THEN round(b.paid_total, 2) END,
               'outstanding', CASE WHEN b.payment_details_available THEN round(GREATEST(abs(b.amount) - b.paid_total, 0), 2) END,
               -- overdue is derived, never stored: a stored flag needs a job to
               -- maintain it, and a job that does not run leaves the row lying
               'overdue', (b.status NOT IN ('paid','missing','cancelled')
                           AND b.due_at IS NOT NULL AND b.due_at < now()),
               'rake_generated', round(b.rake_generated, 2),
               'rakeback_due', round(b.rakeback_due, 2),
               'union_fee_kept', round(b.union_fee_kept, 2),
               'players_won', round(b.players_won, 2),
               'eco_amount', round(b.eco_amount, 2),
               'eco_version',b.eco_version,'eco_components',b.eco_components,
               'eco_components_complete',b.eco_components_complete,
               'presettled', round(b.presettled, 2))
             ORDER BY (b.status = 'missing') DESC, b.amount DESC)
        FROM board b), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'period_start', h.period_start, 'period_end', h.period_end,
               'clubs', h.clubs, 'total_amount', h.total_amount,
               'rake_generated', h.rake_generated, 'eco_amount', h.eco_amount,
               'eco_components_complete',h.eco_components_complete,
               'cash_eco_amount',h.cash_eco_amount,'tournament_eco_amount',h.tournament_eco_amount,
               'paid', h.paid, 'delivered', h.delivered)
             ORDER BY h.period_end DESC)
        FROM history h), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_out;

  RETURN v_out;
END;
$function$;
DO $eco_board_postimage$DECLARE p pg_proc;BEGIN
 SELECT *INTO STRICT p FROM pg_proc WHERE oid='public.ca_union_statement_board(uuid,date,integer)'::regprocedure;
 IF md5(pg_get_functiondef(p.oid))<>'2d7fe1169eabafba8f7638e4df252661'OR p.proowner<>'postgres'::regrole
  OR NOT p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']
  OR p.proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
 THEN RAISE EXCEPTION 'DUAL_ECO_BOARD_POSTIMAGE_OR_AUTHORITY_CHANGED';END IF;
END$eco_board_postimage$;

DO $preserve_financial_sources$BEGIN
 IF NOT EXISTS(SELECT FROM eco_v2_sources_before b WHERE b.matcher=md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))
  AND b.generation_source=pg_get_functiondef('smarter_private.original_inventory_basis_generation()'::regprocedure))THEN
  RAISE EXCEPTION 'original_eco_financial_generation_source_changed';END IF;
END$preserve_financial_sources$;
COMMIT;
