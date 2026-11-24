CREATE OR REPLACE FUNCTION public.fn_ca_promo_payable_contract(p_contract jsonb, p_excluded numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_post_accounting_commission_source(p_source_id uuid, p_source_type text, p_earned_at timestamp with time zone, p_contract jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE tier jsonb;commission_id uuid;count_rows integer:=0;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_source_id IS NULL OR p_source_type NOT IN('cash_rake_accrual','tournament_fee_accrual')
  OR p_source_type IS NULL OR p_earned_at IS NULL OR NOT isfinite(p_earned_at)
  OR jsonb_typeof(p_contract->'tiers') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'invalid_accounting_commission_source' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.agent_commission_settlements s WHERE s.club_id=(p_contract->>'club_id')::uuid
  AND p_earned_at>=s.period_start AND p_earned_at<s.period_end)
 THEN RAISE EXCEPTION 'cash_accrual_closed_period_requires_adjustment' USING ERRCODE='23514'; END IF;
  FOR tier IN SELECT value FROM jsonb_array_elements(p_contract->'tiers') LOOP
   IF (tier->>'amount')::numeric>0 THEN
    -- source_id identifies the real per-player source receipt above; it is
    -- never a fabricated hand identifier. Existing unique keys now distinguish
    -- two players with the same agent and one agent earning in two clubs.
    INSERT INTO public.agent_commissions(club_id,user_id,amount,commission_rate,source_type,source_id,notes,created_at)
     VALUES((p_contract->>'club_id')::uuid,(tier->>'user_id')::uuid,(tier->>'amount')::numeric,(tier->>'rate')::numeric,
      p_source_type,p_source_id,'Commission from recorded earning agreement; tier '||(tier->>'depth'),p_earned_at)
     RETURNING id INTO commission_id;
    count_rows:=count_rows+1;
   END IF;
   UPDATE public.agents SET lifetime_rake_generated=COALESCE(lifetime_rake_generated,0)+(p_contract->>'rake_credit')::numeric,
    weekly_rake_generated=COALESCE(weekly_rake_generated,0)+CASE WHEN public.fn_union_week_start(p_earned_at)=public.fn_union_week_start(now())
      THEN (p_contract->>'rake_credit')::numeric ELSE 0 END,
    last_active_at=now(),updated_at=now()
    WHERE id=(tier->>'agent_id')::uuid AND club_id=(p_contract->>'club_id')::uuid AND user_id=(tier->>'user_id')::uuid;
   -- Display counters exist only while the agent profile exists. The earned
   -- liability belongs to its recorded user and club even after retirement.
  END LOOP;
 RETURN count_rows;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_accounting_union_earned_plan_v3(p_union_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE issue_count bigint;bank_total numeric;source_total numeric;house_total numeric;detail jsonb;fingerprint text;
BEGIN
 IF p_union_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_start>=p_end
 THEN RAISE EXCEPTION 'invalid_union_earning_source_period' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounting_cash_accrual_cutover WHERE singleton AND starts_at<=p_start)
 THEN RAISE EXCEPTION 'union_earning_source_historical_week_uncertified' USING ERRCODE='55000'; END IF;
 -- Each real rake-bank credit must have exactly one typed source authority.
 -- A banked tournament with missing agreements is a debt exception, never
 -- silently reclassified as retained union revenue.
 SELECT count(*) INTO issue_count FROM public.union_wallet_transactions t
  LEFT JOIN public.accounting_cash_bank_receipts c ON c.union_transaction_id=t.id
  LEFT JOIN public.accounting_tournament_fee_recognitions f ON f.union_wallet_transaction_id=t.id
  WHERE t.union_id=p_union_id AND t.wallet='rake_wallet' AND t.direction='credit' AND t.tx_type='rake'
   AND t.created_at>=p_start AND t.created_at<p_end
   AND (((c.rake_record_id IS NOT NULL)::int+(f.tournament_id IS NOT NULL)::int)<>1
    OR (c.rake_record_id IS NOT NULL AND (c.union_id IS DISTINCT FROM p_union_id OR c.amount IS DISTINCT FROM t.amount
     OR c.banked_at IS DISTINCT FROM t.created_at OR c.club_ledger_id IS NOT NULL))
    OR (f.tournament_id IS NOT NULL AND (f.union_id IS DISTINCT FROM p_union_id OR f.net_rake IS DISTINCT FROM t.amount
     OR f.recognized_at IS DISTINCT FROM t.created_at OR f.status IS DISTINCT FROM 'recognized' OR f.bank_journal_id IS NOT NULL))
    OR t.amount IS NULL OR t.amount<=0 OR t.amount<>round(t.amount,2) OR t.amount::text IN('NaN','Infinity','-Infinity'));
 IF issue_count>0 THEN RAISE EXCEPTION 'union_rake_bank_source_unverified:%',issue_count USING ERRCODE='55000'; END IF;
 -- Check the reverse direction too, including sources whose bank row was
 -- changed to another week, union, wallet, or category.
 SELECT count(*) INTO issue_count FROM (
  SELECT c.union_transaction_id AS bank_id,c.banked_at AS earned_at,c.amount AS amount,c.union_id
   FROM public.accounting_cash_bank_receipts c WHERE c.union_id=p_union_id AND c.banked_at>=p_start AND c.banked_at<p_end
  UNION ALL
  SELECT f.union_wallet_transaction_id,f.recognized_at,f.net_rake,f.union_id
   FROM public.accounting_tournament_fee_recognitions f WHERE f.union_id=p_union_id AND f.net_rake>0
    AND f.recognized_at>=p_start AND f.recognized_at<p_end
 ) s LEFT JOIN public.union_wallet_transactions t ON t.id=s.bank_id
 WHERE t.id IS NULL OR t.union_id IS DISTINCT FROM s.union_id OR t.created_at IS DISTINCT FROM s.earned_at
  OR t.amount IS DISTINCT FROM s.amount OR t.wallet IS DISTINCT FROM 'rake_wallet'
  OR t.direction IS DISTINCT FROM 'credit' OR t.tx_type IS DISTINCT FROM 'rake';
 IF issue_count>0 THEN RAISE EXCEPTION 'union_rake_bank_receipt_drifted:%',issue_count USING ERRCODE='55000'; END IF;
 SELECT count(*) INTO issue_count FROM public.accounting_cash_bank_receipts c
  LEFT JOIN public.rake_records r ON r.id=c.rake_record_id
  LEFT JOIN public.accounting_cash_accrual_batches b ON b.rake_record_id=c.rake_record_id
  LEFT JOIN LATERAL (SELECT count(*) AS n,sum(s.rake_credit) AS total,
    count(*) FILTER(WHERE s.union_id IS DISTINCT FROM c.union_id OR s.earned_at IS DISTINCT FROM c.banked_at) AS invalid
    FROM public.accounting_payable_earning_sources s WHERE s.source_type='cash_rake_accrual' AND s.rake_record_id=c.rake_record_id) x ON true
  WHERE c.union_id=p_union_id AND c.banked_at>=p_start AND c.banked_at<p_end
   AND (r.id IS NULL OR r.rake_amount IS DISTINCT FROM c.amount OR r.created_at IS DISTINCT FROM c.banked_at
    OR r.is_tournament IS TRUE OR r.tournament_id IS NOT NULL OR b.status IS DISTINCT FROM 'accrued'
    OR b.earned_at IS DISTINCT FROM r.created_at OR x.n=0 OR x.total IS DISTINCT FROM c.amount OR x.invalid>0);
 IF issue_count>0 THEN RAISE EXCEPTION 'union_cash_sources_do_not_match_bank:%',issue_count USING ERRCODE='55000'; END IF;
 SELECT count(*) INTO issue_count FROM public.accounting_tournament_fee_recognitions f
  LEFT JOIN LATERAL (SELECT count(*) AS n,sum(s.rake_credit) AS total
   FROM public.accounting_payable_earning_sources s WHERE s.source_type='tournament_fee_accrual'
    AND s.tournament_id=f.tournament_id AND s.union_id=p_union_id AND s.earned_at=f.recognized_at) x ON true
  WHERE f.union_id=p_union_id AND f.recognized_at>=p_start AND f.recognized_at<p_end AND f.net_rake>0
   AND (f.status IS DISTINCT FROM 'recognized' OR x.n=0 OR x.total IS DISTINCT FROM f.net_rake);
 IF issue_count>0 THEN RAISE EXCEPTION 'union_tournament_sources_do_not_match_bank:%',issue_count USING ERRCODE='55000'; END IF;
 SELECT count(*) INTO issue_count FROM public.accounting_payable_earning_sources s
  LEFT JOIN public.accounting_cash_bank_receipts c ON s.source_type='cash_rake_accrual' AND c.rake_record_id=s.rake_record_id
  LEFT JOIN public.accounting_tournament_fee_recognitions f ON s.source_type='tournament_fee_accrual' AND f.tournament_id=s.tournament_id
  WHERE s.union_id=p_union_id AND s.earned_at>=p_start AND s.earned_at<p_end
   AND ((s.source_type='cash_rake_accrual' AND (c.rake_record_id IS NULL OR c.union_id IS DISTINCT FROM s.union_id OR c.banked_at IS DISTINCT FROM s.earned_at))
    OR (s.source_type='tournament_fee_accrual' AND (f.tournament_id IS NULL OR f.union_id IS DISTINCT FROM s.union_id
      OR f.recognized_at IS DISTINCT FROM s.earned_at OR f.status IS DISTINCT FROM 'recognized'))
    OR s.source_type NOT IN('cash_rake_accrual','tournament_fee_accrual'));
 IF issue_count>0 THEN RAISE EXCEPTION 'union_earning_source_without_bank:%',issue_count USING ERRCODE='55000'; END IF;
 -- The recorded union agreement must be the latest observation at earning
 -- (cash) or charge (tournament) time. Current membership/rates do not alter it.
 WITH sources AS (
  SELECT s.*,COALESCE(f.game_type,'cash') AS game_type,
   s.contract->'union_agreement' AS agreement,(s.contract->>'terms_at')::timestamptz AS terms_at,
   COALESCE((s.contract->>'is_union_house')::boolean,false) AS is_house
   FROM public.accounting_payable_earning_sources s LEFT JOIN public.accounting_tournament_fee_sources f
    ON s.source_type='tournament_fee_accrual' AND f.id=s.source_id
   WHERE s.union_id=p_union_id AND s.earned_at>=p_start AND s.earned_at<p_end
 ), checked AS (
  SELECT s.*,h.id AS history_id,h.observed_at,h.after_terms,
   COALESCE(CASE s.game_type WHEN 'cash' THEN s.agreement->'terms'->>'rate_cash'
    WHEN 'mtt' THEN s.agreement->'terms'->>'rate_mtt' WHEN 'sng' THEN s.agreement->'terms'->>'rate_sng'
    WHEN 'spin' THEN s.agreement->'terms'->>'rate_spin' WHEN 'satellite' THEN s.agreement->'terms'->>'rate_satellite' END,
    s.agreement->'terms'->>'club_commission_rate')::numeric AS rate
   FROM sources s LEFT JOIN public.accounting_agreement_history h ON h.id=(s.agreement->>'history_id')::bigint
 )
 SELECT count(*) INTO issue_count FROM checked s
 WHERE s.contract->>'club_id' IS DISTINCT FROM s.club_id::text OR s.contract->>'player_id' IS DISTINCT FROM s.player_id::text
  OR s.contract->>'union_id' IS DISTINCT FROM p_union_id::text OR s.coordinator_union_id IS DISTINCT FROM p_union_id
  OR (s.contract->>'rake_credit')::numeric IS DISTINCT FROM s.rake_credit OR s.terms_at IS NULL OR s.terms_at>s.earned_at
  OR (s.source_type='cash_rake_accrual' AND s.terms_at IS DISTINCT FROM s.earned_at)
  OR (s.source_type='tournament_fee_accrual' AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources f
    WHERE f.id=s.source_id AND public.fn_accounting_tournament_source_terms_at(f.tournament_id,f.charged_at,f.contract)=s.terms_at))
  OR (s.is_house AND (s.agreement IS DISTINCT FROM 'null'::jsonb OR NOT EXISTS(SELECT 1 FROM public.clubs c
    WHERE c.id=s.club_id AND c.is_union IS TRUE AND (c.id=p_union_id OR c.union_id=p_union_id))))
  OR (NOT s.is_house AND (s.history_id IS NULL OR s.after_terms IS DISTINCT FROM s.agreement->'terms'
    OR s.agreement->'terms'->>'club_id' IS DISTINCT FROM s.club_id::text OR s.agreement->'terms'->>'union_id' IS DISTINCT FROM p_union_id::text
    OR s.observed_at>s.terms_at OR s.observed_at IS DISTINCT FROM (s.agreement->>'observed_at')::timestamptz
    OR NOT EXISTS(SELECT 1 FROM public.accounting_agreement_history h WHERE h.id=s.history_id AND h.entity_type='union_clubs'
     AND h.club_id=s.club_id AND h.entity_key=s.agreement->'terms'->>'id')
    OR EXISTS(SELECT 1 FROM public.accounting_agreement_history h JOIN public.accounting_agreement_history old ON old.id=s.history_id
      WHERE h.entity_type='union_clubs' AND h.entity_key=old.entity_key AND h.observed_at<=s.terms_at AND (h.observed_at,h.id)>(old.observed_at,old.id))
    OR s.rate IS NULL OR s.rate<0 OR s.rate>1 OR s.rate::text IN('NaN','Infinity','-Infinity')));
 IF issue_count>0 THEN RAISE EXCEPTION 'union_earning_agreement_unverified:%',issue_count USING ERRCODE='55000'; END IF;
 SELECT COALESCE(sum(amount),0) INTO bank_total FROM public.union_wallet_transactions
  WHERE union_id=p_union_id AND wallet='rake_wallet' AND direction='credit' AND tx_type='rake' AND created_at>=p_start AND created_at<p_end;
 SELECT COALESCE(sum(s.rake_credit),0),COALESCE(sum(s.rake_credit) FILTER(WHERE (s.contract->>'is_union_house')::boolean),0),
  md5(COALESCE(string_agg(md5(jsonb_build_array(s.source_type,s.source_id,s.rake_record_id,s.tournament_id,s.earned_at,s.rake_credit,s.contract)::text),
    '' ORDER BY s.source_type,s.source_id),'')) INTO source_total,house_total,fingerprint
  FROM public.accounting_payable_earning_sources s WHERE s.union_id=p_union_id AND s.earned_at>=p_start AND s.earned_at<p_end;
 IF source_total IS DISTINCT FROM bank_total THEN RAISE EXCEPTION 'union_earned_rake_does_not_conserve_bank' USING ERRCODE='55000'; END IF;
 WITH source_rates AS (
  SELECT s.club_id,COALESCE(f.game_type,'cash') AS game_type,s.rake_credit,
   COALESCE(CASE COALESCE(f.game_type,'cash') WHEN 'cash' THEN s.contract->'union_agreement'->'terms'->>'rate_cash'
    WHEN 'mtt' THEN s.contract->'union_agreement'->'terms'->>'rate_mtt' WHEN 'sng' THEN s.contract->'union_agreement'->'terms'->>'rate_sng'
    WHEN 'spin' THEN s.contract->'union_agreement'->'terms'->>'rate_spin' WHEN 'satellite' THEN s.contract->'union_agreement'->'terms'->>'rate_satellite' END,
    s.contract->'union_agreement'->'terms'->>'club_commission_rate')::numeric AS rate
  FROM public.accounting_payable_earning_sources s LEFT JOIN public.accounting_tournament_fee_sources f
   ON s.source_type='tournament_fee_accrual' AND f.id=s.source_id
  WHERE s.union_id=p_union_id AND s.earned_at>=p_start AND s.earned_at<p_end AND COALESCE((s.contract->>'is_union_house')::boolean,false) IS FALSE
 ), basis AS (
  SELECT club_id,game_type,sum(rake_credit) AS rake_in,
   CASE WHEN sum(rake_credit)>0 THEN sum(rake_credit*rate)/sum(rake_credit) ELSE 0 END AS rate,
   trunc(sum(rake_credit*rate),2) AS payout FROM source_rates GROUP BY club_id,game_type
 ) SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY club_id,game_type),'[]') INTO detail FROM basis b;
 RETURN jsonb_build_object('accounting_version',3,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,
  'period_rake',bank_total,'earned_rake',source_total,'house_rake',house_total,'source_fingerprint',fingerprint,'basis_detail',detail);
END $function$;

CREATE OR REPLACE FUNCTION smarter_private.own_agent_interpreted_contract(p_contract jsonb, p_club uuid, p_player uuid, p_rake numeric, p_union uuid, p_terms timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE own jsonb;canonical jsonb;
BEGIN
 IF coalesce(p_contract#>>'{membership,terms,role}','')NOT IN('super_agent','agent','sub_agent')
 OR p_contract#>>'{tiers,0,user_id}'=p_player::text
 OR ((p_contract#>>'{membership,terms,player_rakeback_pct}')::numeric=.70 AND EXISTS(SELECT FROM public.clubs c WHERE c.id=p_club AND c.owner_id=NULLIF(p_contract#>>'{membership,terms,agent_id}','')::uuid))THEN RETURN NULL;END IF;
 BEGIN own:=public.fn_accounting_agent_terms_at(p_club,p_player,p_terms);
 EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM IN('accounting_terms_not_observed','accounting_terms_not_active')THEN RETURN NULL;ELSE RAISE;END IF;END;
 canonical:=public.fn_accounting_earning_contract(p_club,p_player,p_rake,p_union,p_terms);
 -- Only hierarchy and its retained residual may change. Owner-basis,
 -- attribution and every original capture field remain in the admitted row.
 IF canonical#>>'{tiers,0,user_id}'IS DISTINCT FROM p_player::text
 OR canonical#>'{tiers,0,agreement}'IS DISTINCT FROM own
 OR NOT((p_contract-'tiers'-'club_residual')@>(canonical-'tiers'-'club_residual'))
 THEN RAISE EXCEPTION 'own_agent_interpretation_historical_contract_disagrees' USING ERRCODE='23514';END IF;
 RETURN p_contract||jsonb_build_object('tiers',canonical->'tiers','club_residual',canonical->'club_residual');
END $function$;

CREATE OR REPLACE FUNCTION smarter_private.admit_own_agent_source(p_type text, p_source uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE s record;raw jsonb;canonical jsonb;old_rows jsonb;source_proof jsonb;w_from timestamptz;w_to timestamptz;key text;old_setting text;posted int;expected int;
BEGIN
 IF NOT public.fn_caller_is_engine()OR p_type NOT IN('cash_rake_accrual','tournament_fee_accrual')OR p_type IS NULL OR p_source IS NULL THEN RAISE EXCEPTION 'own_agent_interpretation_not_authorised' USING ERRCODE='42501';END IF;
 SELECT x.*,CASE WHEN x.source_type='tournament_fee_accrual' THEN public.fn_accounting_tournament_source_terms_at(f.tournament_id,f.charged_at,f.contract)ELSE x.earned_at END terms_at
 INTO s FROM public.accounting_payable_earning_sources x LEFT JOIN public.accounting_tournament_fee_sources f ON f.id=CASE WHEN x.source_type='tournament_fee_accrual'THEN x.source_id END WHERE x.source_type=p_type AND x.source_id=p_source;
 IF NOT FOUND THEN RAISE EXCEPTION 'own_agent_interpretation_payable_source_required' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT FROM public.accounting_own_agent_interpretations a WHERE a.source_type=p_type AND a.source_id=p_source)THEN RETURN false;END IF;
 canonical:=smarter_private.own_agent_interpreted_contract(s.contract,s.club_id,s.player_id,s.rake_credit,s.union_id,s.terms_at);
 IF canonical IS NULL THEN RETURN false;END IF;
 w_from:=public.fn_union_week_start(s.earned_at);w_to:=public.fn_union_week_start(w_from+interval '8 days');
 key:=CASE WHEN s.coordinator_union_id IS NULL THEN'club-accounting:'ELSE'union-accounting:'END||coalesce(s.coordinator_union_id,s.club_id)||':'||extract(epoch FROM w_from)||':'||extract(epoch FROM w_to);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(key,0))THEN RAISE EXCEPTION 'own_agent_interpretation_scope_busy' USING ERRCODE='55000';END IF;
 -- Take the same original producer lock without reversing its lock order.
 IF p_type='cash_rake_accrual' THEN
  SELECT to_jsonb(x)INTO raw FROM public.accounting_cash_rake_sources x WHERE x.id=p_source;
  SELECT 'accounting_cash_hand:'||r.hand_id INTO key FROM public.rake_records r WHERE r.id=s.rake_record_id;
 ELSE
  SELECT to_jsonb(x)INTO raw FROM public.accounting_tournament_fee_sources x WHERE x.id=p_source;
  key:='accounting_tournament_recognition:'||s.tournament_id;
 END IF;
 IF raw IS NULL OR key IS NULL OR NOT pg_try_advisory_xact_lock(hashtextextended(key,0))THEN RAISE EXCEPTION 'own_agent_interpretation_source_busy' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT FROM public.agent_commission_settlements a WHERE a.club_id=s.club_id AND a.period_start<=s.earned_at AND a.period_end>s.earned_at)
 OR EXISTS(SELECT FROM public.accounting_routed_settlement_runs r WHERE r.period_start=w_from AND r.period_end=w_to AND((r.union_id IS NOT NULL AND r.union_id=s.coordinator_union_id)OR(r.standalone_club_id=s.club_id AND s.coordinator_union_id IS NULL)))
 OR EXISTS(SELECT FROM public.rakeback_periods r WHERE r.club_id=s.club_id AND r.period_start=(w_from AT TIME ZONE'America/Los_Angeles')::date AND r.status<>'pending')
 OR EXISTS(SELECT FROM public.rakeback_period_payouts pp JOIN public.rakeback_periods r ON r.id=pp.rakeback_period_id WHERE r.club_id=s.club_id AND r.period_start=(w_from AT TIME ZONE'America/Los_Angeles')::date)
 THEN RAISE EXCEPTION 'own_agent_interpretation_week_already_paid' USING ERRCODE='23514';END IF;
 -- Reuse the real capture/disposition proof; do not fabricate bad history IDs.
 IF p_type='cash_rake_accrual' THEN
  source_proof:=public.fn_accounting_cash_commission_plan(s.rake_record_id);
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(source_proof->'players')p WHERE p->>'attribution_id'=s.contract->>'attribution_id'AND p->>'player_id'=s.player_id::text AND(p->>'rake_credit')::numeric=s.rake_credit)THEN RAISE EXCEPTION 'own_agent_interpretation_cash_capture_changed' USING ERRCODE='23514';END IF;
 ELSE
  source_proof:=public.fn_accounting_tournament_fee_net_plan(s.tournament_id);
  IF NOT(source_proof->'active_source_ids'@>jsonb_build_array(p_source))OR source_proof->>'status'IS DISTINCT FROM'proven'
  OR NOT EXISTS(SELECT FROM public.accounting_tournament_fee_recognitions r WHERE r.tournament_id=s.tournament_id AND r.status='recognized'AND r.recognized_at=s.earned_at AND r.source_fingerprint=source_proof->>'source_fingerprint')THEN RAISE EXCEPTION 'own_agent_interpretation_fee_capture_changed' USING ERRCODE='23514';END IF;
 END IF;
 PERFORM 1 FROM public.agent_commissions a WHERE a.source_type=p_type AND a.source_id=p_source FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(a)ORDER BY a.id),'[]')INTO old_rows FROM public.agent_commissions a WHERE a.source_type=p_type AND a.source_id=p_source;
 SELECT count(*)INTO expected FROM jsonb_array_elements(s.contract->'tiers')t WHERE(t->>'amount')::numeric>0;
 IF jsonb_array_length(old_rows)<>expected OR EXISTS(SELECT FROM jsonb_array_elements(old_rows)a WHERE a->>'settled_at'IS NOT NULL OR a->>'club_id'IS DISTINCT FROM s.club_id::text OR(a->>'created_at')::timestamptz IS DISTINCT FROM s.earned_at OR NOT EXISTS(SELECT FROM jsonb_array_elements(s.contract->'tiers')t WHERE t->>'user_id'=a->>'user_id'AND(t->>'amount')::numeric=(a->>'amount')::numeric AND(t->>'rate')::numeric=(a->>'commission_rate')::numeric))THEN RAISE EXCEPTION 'own_agent_interpretation_original_commissions_changed' USING ERRCODE='23514';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('accounting_rakeback_period:'||s.club_id||':'||(w_from AT TIME ZONE'America/Los_Angeles')::date,0))THEN RAISE EXCEPTION 'own_agent_interpretation_period_busy' USING ERRCODE='55000';END IF;
 -- These are the original unpaid proof records, never copied or retagged.
 DELETE FROM public.accounting_close_partials WHERE union_id=coalesce(s.coordinator_union_id,s.club_id)AND period_start=w_from AND period_end=w_to
   AND (kind NOT IN('earned_plan_window','round2_union_window','round2_club_window','round3_union_window','round3_club_window')
     OR (window_start<=s.earned_at AND s.earned_at<window_end));
 DELETE FROM public.accounting_close_certificates WHERE union_id=coalesce(s.coordinator_union_id,s.club_id)AND period_start=w_from AND period_end=w_to;
 DELETE FROM public.accounting_recompute_split_parts WHERE club_id=s.club_id AND period_start=(w_from AT TIME ZONE'America/Los_Angeles')::date AND period_end=(w_to AT TIME ZONE'America/Los_Angeles')::date-1;
 INSERT INTO public.accounting_own_agent_interpretations(source_type,source_id,version,club_id,player_id,earned_at,raw_source,raw_source_md5,original_contract,admitted_contract,original_commissions)VALUES(p_type,p_source,'own-agent-v1',s.club_id,s.player_id,s.earned_at,raw,md5(raw::text),s.contract,canonical,old_rows);
 old_setting:=current_setting('app.ledger_maintenance',true);PERFORM set_config('app.ledger_maintenance','own-agent-interpretation:'||p_source,true);
 DELETE FROM public.agent_commissions WHERE source_type=p_type AND source_id=p_source;
 PERFORM set_config('app.ledger_maintenance',coalesce(old_setting,''),true);
 UPDATE public.agents a SET lifetime_rake_generated=coalesce(a.lifetime_rake_generated,0)-s.rake_credit,weekly_rake_generated=coalesce(a.weekly_rake_generated,0)-CASE WHEN public.fn_union_week_start(s.earned_at)=public.fn_union_week_start(now())THEN s.rake_credit ELSE 0 END WHERE a.club_id=s.club_id AND EXISTS(SELECT FROM jsonb_array_elements(s.contract->'tiers')t WHERE a.id=(t->>'agent_id')::uuid AND a.user_id=(t->>'user_id')::uuid);
 posted:=public.fn_post_accounting_commission_source(p_source,p_type,s.earned_at,canonical);
 IF posted<>(SELECT count(*)FROM jsonb_array_elements(canonical->'tiers')t WHERE(t->>'amount')::numeric>0)THEN RAISE EXCEPTION 'own_agent_interpretation_posting_incomplete' USING ERRCODE='23514';END IF;
 INSERT INTO public.accounting_period_recompute_requests(club_id,period_start,period_end)VALUES(s.club_id,(w_from AT TIME ZONE'America/Los_Angeles')::date,(w_to AT TIME ZONE'America/Los_Angeles')::date-1)ON CONFLICT(club_id,period_start,period_end)DO UPDATE SET last_requested_at=clock_timestamp(),status='pending',reason=NULL,last_result='{}';
 RETURN true;
END $function$;
