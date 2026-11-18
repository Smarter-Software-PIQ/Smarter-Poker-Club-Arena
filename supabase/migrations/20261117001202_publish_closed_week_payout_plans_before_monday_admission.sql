-- Precompute the two aggregate payout plans on the closed-week preparation shards.
-- The original financial owner still posts each round and its complete receipts.
-- @live-proof: to_regprocedure('smarter_private.weekly_prepared_payout_plans(text,uuid,timestamptz,timestamptz)') IS NOT NULL AND position('weekly_publish_payout_plans' in pg_get_functiondef('smarter_private.weekly_prep_shard(int,int)'::regprocedure))>0 AND position('weekly_lock_prepared_payout' in pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';

-- A source posted into a closed week marks its canonical two-hour interval in the same
-- transaction. Preparation checks the existing commit horizon before taking any closed-week snapshot.
CREATE TABLE smarter_private.weekly_payout_source_changes(
 scope_kind text NOT NULL,scope_id uuid NOT NULL,period_start timestamptz NOT NULL,window_start timestamptz NOT NULL,
 changed_at timestamptz NOT NULL,calculator_club uuid NOT NULL,affects_calculation boolean NOT NULL, PRIMARY KEY(scope_kind,scope_id,period_start,window_start,calculator_club));
ALTER TABLE smarter_private.weekly_payout_source_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.weekly_payout_source_changes FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.weekly_payout_source_changed(p_kind text,p_id uuid,p_earned timestamptz,p_calculator_club uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE ps timestamptz:=public.fn_union_week_start(p_earned); pe timestamptz:=public.fn_union_week_start(ps+interval '8 days');
BEGIN
 IF p_id IS NULL OR p_earned IS NULL OR NOT isfinite(p_earned) THEN RETURN; END IF;
 IF pe>clock_timestamp() THEN RETURN; END IF;
 -- Serialize a late arrival with this scope's existing monetary admission and our
 -- preparation snapshot. The dirty witness survives staged publication or rollback.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(CASE WHEN p_kind='union' THEN 'union-accounting:' ELSE 'club-accounting:' END
    ||p_id::text||':'||extract(epoch FROM ps)::text||':'||extract(epoch FROM pe)::text,0)) THEN
    RAISE EXCEPTION 'closed_week_source_waits_for_owned_payout' USING ERRCODE='55P03'; END IF;
 INSERT INTO smarter_private.weekly_payout_source_changes VALUES(p_kind,p_id,ps,date_bin(interval '2 hours',p_earned,ps),clock_timestamp(),coalesce(p_calculator_club,p_id),p_calculator_club IS NOT NULL)
 ON CONFLICT(scope_kind,scope_id,period_start,window_start,calculator_club) DO UPDATE SET changed_at=EXCLUDED.changed_at,
 affects_calculation=EXCLUDED.affects_calculation OR smarter_private.weekly_payout_source_changes.affects_calculation;
END $f$;
CREATE FUNCTION smarter_private.weekly_payout_new_sources() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE rows_sql text; s record;
BEGIN
 CASE TG_TABLE_NAME
 WHEN 'accounting_cash_rake_sources' THEN
   rows_sql:='SELECT CASE WHEN coordinator_union_id IS NULL THEN ''club'' ELSE ''union'' END k,coalesce(coordinator_union_id,club_id) id,club_id calc,earned_at at FROM new_sources';
 WHEN 'accounting_tournament_recognized_sources' THEN
   rows_sql:='SELECT CASE WHEN f.coordinator_union_id IS NULL THEN ''club'' ELSE ''union'' END k,coalesce(f.coordinator_union_id,f.club_id) id,f.club_id calc,n.recognized_at at FROM new_sources n JOIN public.accounting_tournament_fee_sources f ON f.id=n.source_id WHERE n.disposition=''earned''';
 WHEN 'accounting_cash_bank_receipts' THEN
   rows_sql:='SELECT ''union'' k,union_id id,NULL::uuid calc,banked_at at FROM new_sources WHERE union_id IS NOT NULL';
 WHEN 'accounting_tournament_fee_recognitions' THEN
   rows_sql:='SELECT ''union'' k,union_id id,NULL::uuid calc,recognized_at at FROM new_sources WHERE union_id IS NOT NULL';
 WHEN 'union_wallet_transactions' THEN
   rows_sql:='SELECT ''union'' k,union_id id,NULL::uuid calc,created_at at FROM new_sources WHERE wallet=''rake_wallet'' AND direction=''credit'' AND tx_type=''rake''';
 ELSE RAISE EXCEPTION 'unknown_weekly_source';
 END CASE;
 FOR s IN EXECUTE 'SELECT k,id,calc,min(at) effective_at FROM ('||rows_sql||') x GROUP BY k,id,calc,public.fn_union_week_start(at),date_bin(interval ''2 hours'',at,public.fn_union_week_start(at)) ORDER BY k,id,min(at)' LOOP
   PERFORM smarter_private.weekly_payout_source_changed(s.k,s.id,s.effective_at,s.calc);
 END LOOP;
 RETURN NULL;
END $f$;
DO $triggers$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['accounting_cash_rake_sources','accounting_tournament_recognized_sources','accounting_cash_bank_receipts','accounting_tournament_fee_recognitions','union_wallet_transactions'] LOOP
   EXECUTE format('CREATE TRIGGER weekly_payout_closed_week_source AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_sources FOR EACH STATEMENT EXECUTE FUNCTION smarter_private.weekly_payout_new_sources()',t);
 END LOOP;
END $triggers$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_source_changed(text,uuid,timestamptz,uuid),smarter_private.weekly_payout_new_sources() FROM PUBLIC,anon,authenticated,service_role;

-- Acquire the ordinary scope lock before inspecting or republishing closed-week proofs.
CREATE FUNCTION smarter_private.weekly_payout_has_posted(p_kind text,p_id uuid,p_start timestamptz,p_end timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $f$
 SELECT EXISTS(SELECT FROM smarter_private.weekly_payout_round_receipts r JOIN public.weekly_accounting_payout_pauses p USING(run_id)
   WHERE r.scope_kind=p_kind AND r.scope_id=p_id AND EXISTS(SELECT FROM jsonb_array_elements(p.scope_plan) i
     WHERE (i->>'kind',(i->>'id')::uuid,(i->>'period_start')::timestamptz,(i->>'period_end')::timestamptz)=(p_kind,p_id,p_start,p_end)))
 OR EXISTS(SELECT FROM public.accounting_routed_settlement_runs r WHERE (r.scope_kind,r.scope_id,r.period_start,r.period_end)=(p_kind,p_id,p_start,p_end))
 OR EXISTS(SELECT FROM public.union_rakeback_log r WHERE p_kind='union' AND (r.union_id,r.period_start,r.period_end)=(p_id,p_start,p_end))
 OR EXISTS(SELECT FROM smarter_private.weekly_payout_club_rounds c WHERE (c.scope_kind,c.scope_id,c.period_start,c.period_end)=(p_kind,p_id,p_start,p_end) AND c.status='paid')
$f$;
CREATE FUNCTION smarter_private.weekly_refresh_changed_payout_windows(p_kind text,p_id uuid,p_start timestamptz,p_end timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $f$
DECLARE c record; start_day date:=(p_start AT TIME ZONE 'America/Los_Angeles')::date;
BEGIN
 IF NOT EXISTS(SELECT FROM smarter_private.weekly_payout_source_changes l WHERE (l.scope_kind,l.scope_id,l.period_start)=(p_kind,p_id,p_start)) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(CASE WHEN p_kind='union' THEN 'union-accounting:' ELSE 'club-accounting:' END
   ||p_id::text||':'||extract(epoch FROM p_start)::text||':'||extract(epoch FROM p_end)::text,0));
 IF smarter_private.weekly_payout_has_posted(p_kind,p_id,p_start,p_end) THEN RETURN; END IF;
 -- A late recognition may credit a charge recorded days earlier. Wake only the
 -- actual beneficiary club's calculator, even if the original charge timestamp is old.
 FOR c IN SELECT l.calculator_club id,max(l.changed_at) changed_at FROM smarter_private.weekly_payout_source_changes l
   WHERE (l.scope_kind,l.scope_id,l.period_start)=(p_kind,p_id,p_start) AND l.affects_calculation
   GROUP BY l.calculator_club ORDER BY l.calculator_club LOOP
   IF pg_try_advisory_xact_lock(hashtextextended('accounting_rakeback_period:'||c.id::text||':'||start_day::text,0)) THEN
     IF EXISTS(SELECT FROM public.accounting_recompute_split_parts sp WHERE sp.club_id=c.id AND sp.period_start=start_day AND sp.computed_at<=c.changed_at) THEN
       DELETE FROM public.accounting_recompute_split_parts sp WHERE sp.club_id=c.id AND sp.period_start=start_day;
     END IF;
     UPDATE public.accounting_period_recompute_requests q SET status='pending',last_requested_at=clock_timestamp()
       WHERE q.club_id=c.id AND q.period_start=start_day AND q.period_end=start_day+6 AND q.last_requested_at<c.changed_at
         AND (q.attempted_at IS NULL OR q.attempted_at<=c.changed_at);
   END IF;
 END LOOP;
 DELETE FROM smarter_private.own_agent_clean_windows v USING smarter_private.weekly_payout_source_changes l
 WHERE (v.scope_kind,v.scope_id,v.period_start,v.period_end)=(p_kind,p_id,p_start,p_end)
  AND (l.scope_kind,l.scope_id,l.period_start,l.window_start)=(p_kind,p_id,p_start,v.window_start) AND v.checked_at<=l.changed_at;
 DELETE FROM public.accounting_close_partials p USING smarter_private.weekly_payout_source_changes l
 WHERE (l.scope_kind,l.scope_id,l.period_start)=(p_kind,p_id,p_start)
   AND (p.union_id,p.period_start,p.period_end,p.window_start)=(p_id,p_start,p_end,l.window_start)
   AND p.computed_at<=l.changed_at AND (p.kind IN('round2_'||p_kind||'_window','round3_'||p_kind||'_window') OR (p_kind='union' AND p.kind='earned_plan_window'));
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_has_posted(text,uuid,timestamptz,timestamptz),smarter_private.weekly_refresh_changed_payout_windows(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE smarter_private.weekly_agent_payout_plans(
 scope_kind text NOT NULL,scope_id uuid NOT NULL,period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,
 computed_at timestamptz NOT NULL, verified boolean NOT NULL, proof jsonb NOT NULL,
 nodes jsonb NOT NULL,edges jsonb NOT NULL,clubs jsonb NOT NULL,identity_hash text NOT NULL,
 PRIMARY KEY(scope_kind,scope_id,period_start,period_end));
ALTER TABLE smarter_private.weekly_agent_payout_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.weekly_agent_payout_plans FROM PUBLIC,anon,authenticated,service_role;

-- Existing allocation identities are looked up through (period_id,id DESC). The
-- monotonically allocated certificate IDs also bound discovery of new closed-week payees.
CREATE FUNCTION smarter_private.weekly_player_plan_current(p_kind text,p_id uuid,p_start timestamptz,p_end timestamptz,p_plan jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $f$
 SELECT p_plan->>'prepared_verified'='true' AND p_plan->>'certificate_watermark' IS NOT NULL
 AND NOT EXISTS(SELECT FROM public.accounting_rakeback_period_calculations c
  WHERE c.id>(p_plan->>'certificate_watermark')::bigint AND c.period_start=(p_start AT TIME ZONE 'America/Los_Angeles')::date
    AND c.period_end=(p_end AT TIME ZONE 'America/Los_Angeles')::date-1
    AND ((p_kind='union' AND c.coordinator_union_id=p_id) OR (p_kind='club' AND c.club_id=p_id AND c.coordinator_union_id IS NULL)))
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(p_plan->'alloc') a LEFT JOIN LATERAL
  (SELECT c.id FROM public.accounting_rakeback_period_calculations c WHERE c.period_id=(a->>0)::uuid ORDER BY c.id DESC LIMIT 1) latest ON true
  WHERE latest.id IS DISTINCT FROM (a->>1)::bigint)
$f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_player_plan_current(text,uuid,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Every required component must match a canonical two-hour interval of THIS scope's week.
-- Aggregate rows and pieces from another/backlogged week never satisfy coverage.
CREATE FUNCTION smarter_private.weekly_payout_windows(p_kind text,p_id uuid,p_start timestamptz,p_end timestamptz)
RETURNS TABLE(kind text,complete boolean,newest timestamptz) LANGUAGE sql STABLE
SET search_path=pg_catalog,public AS $f$
 SELECT k.kind, bool_and(p.window_start IS NOT NULL
    AND (k.kind<>'round3_'||p_kind||'_window' OR (p.value->>'read_failed') IS NOT DISTINCT FROM 'false')), max(p.computed_at)
 FROM (VALUES ('earned_plan_window'),('round2_'||p_kind||'_window'),('round3_'||p_kind||'_window')) k(kind)
 CROSS JOIN public.fn_accounting_close_windows(p_start,p_end) w
 LEFT JOIN public.accounting_close_partials p ON p.kind=k.kind AND p.union_id=p_id
   AND (p.period_start,p.period_end,p.window_start,p.window_end)=(p_start,p_end,w.window_start,w.window_end)
   AND p.computed_at>=p_end AND p.computed_at>statement_timestamp()-public.fn_accounting_close_proof_lifetime()
   AND NOT EXISTS(SELECT FROM smarter_private.weekly_payout_source_changes l WHERE (l.scope_kind,l.scope_id,l.period_start,l.window_start)=(p_kind,p_id,p_start,w.window_start) AND l.changed_at>=p.computed_at)
 WHERE k.kind<>'earned_plan_window' OR p_kind='union'
 GROUP BY k.kind
$f$;

CREATE FUNCTION smarter_private.weekly_prepared_payout_plans(p_kind text,p_id uuid,p_start timestamptz,p_end timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $f$
 WITH windows AS MATERIALIZED (SELECT * FROM smarter_private.weekly_payout_windows(p_kind,p_id,p_start,p_end)),
 calc AS MATERIALIZED (
   SELECT q.attempted_at,smarter_private.weekly_club_calculation_current(c.club_id, d.start_day,d.end_day) AS current
   FROM (SELECT (p_start AT TIME ZONE 'America/Los_Angeles')::date start_day,
               (p_end AT TIME ZONE 'America/Los_Angeles')::date-1 end_day) d
   CROSS JOIN public.fn_accounting_week_clubs(CASE WHEN p_kind='union' THEN p_id END,CASE WHEN p_kind='club' THEN p_id END,p_start,p_end) c
   LEFT JOIN public.accounting_period_recompute_requests q ON (q.club_id,q.period_start,q.period_end)=(c.club_id,d.start_day,d.end_day)
 )
 SELECT p_kind IN('club','union') AND p_end<=statement_timestamp()
 AND EXISTS(SELECT FROM windows) AND NOT EXISTS(SELECT FROM windows WHERE complete IS DISTINCT FROM true)
 AND public.fn_cash_source_refusals_for_period(CASE WHEN p_kind='union' THEN p_id END,CASE WHEN p_kind='club' THEN p_id END,p_start,p_end) @> '{"status":"ready","count":0,"sources":[]}'::jsonb
 AND NOT EXISTS(SELECT FROM calc WHERE current IS DISTINCT FROM true)
 AND NOT EXISTS(SELECT FROM smarter_private.weekly_payout_source_changes l LEFT JOIN public.accounting_period_recompute_requests cr ON
  cr.club_id=l.calculator_club AND cr.period_start=(p_start AT TIME ZONE 'America/Los_Angeles')::date AND cr.period_end=(p_end AT TIME ZONE 'America/Los_Angeles')::date-1
  WHERE (l.scope_kind,l.scope_id,l.period_start)=(p_kind,p_id,p_start) AND l.affects_calculation AND (cr.attempted_at IS NULL OR cr.attempted_at<=l.changed_at))
 AND EXISTS(SELECT FROM public.accounting_own_agent_preparation_versions v WHERE (v.scope_kind,v.scope_id,v.period_start,v.period_end)=(p_kind,p_id,p_start,p_end) AND v.version='own-agent-v1')
 AND NOT EXISTS(SELECT FROM public.fn_accounting_close_windows(p_start,p_end) w WHERE NOT EXISTS(
  SELECT FROM smarter_private.own_agent_clean_windows v WHERE (v.scope_kind,v.scope_id,v.period_start,v.period_end,v.window_start)=(p_kind,p_id,p_start,p_end,w.window_start)
  AND NOT EXISTS(SELECT FROM smarter_private.weekly_payout_source_changes l WHERE (l.scope_kind,l.scope_id,l.period_start,l.window_start)=(p_kind,p_id,p_start,w.window_start) AND l.changed_at>=v.checked_at)))
 AND EXISTS(SELECT FROM smarter_private.weekly_agent_payout_plans a,windows w WHERE w.kind='round2_'||p_kind||'_window'
  AND (a.scope_kind,a.scope_id,a.period_start,a.period_end)=(p_kind,p_id,p_start,p_end) AND a.verified AND a.computed_at>=w.newest)
 AND (p_kind<>'union' OR EXISTS(SELECT FROM public.accounting_close_certificates c,windows w
    WHERE w.kind='earned_plan_window' AND c.kind='earned_plan' AND c.union_id=p_id AND (c.period_start,c.period_end)=(p_start,p_end)
      AND c.certified_at>=w.newest AND c.certified_at>statement_timestamp()-interval '12 hours'))
 AND EXISTS(SELECT FROM public.accounting_close_partials p,windows w
    WHERE w.kind='round3_'||p_kind||'_window' AND p.kind='round3_'||p_kind||'_plan' AND p.union_id=p_id
      AND (p.period_start,p.period_end,p.window_start,p.window_end)=(p_start,p_end,p_start,p_end)
      AND p.value->>'failed'='false' AND p.value->>'legacy'='false' AND smarter_private.weekly_player_plan_current(p_kind,p_id,p_start,p_end,p.value)
      AND p.computed_at>=w.newest AND p.computed_at>=coalesce((SELECT max(attempted_at) FROM calc),p_end)
      AND p.computed_at>statement_timestamp()-public.fn_accounting_close_proof_lifetime())
$f$;

CREATE FUNCTION smarter_private.weekly_publish_payout_plans(p_kind text,p_id uuid,p_start timestamptz,p_end timestamptz,p_step text)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public AS $f$
DECLARE plan jsonb; newest timestamptz; latest_calculation timestamptz;
 first_day date:=(p_start AT TIME ZONE 'America/Los_Angeles')::date; last_day date:=(p_end AT TIME ZONE 'America/Los_Angeles')::date-1;
BEGIN
 IF p_kind NOT IN('club','union') OR p_step NOT IN('earned','players') OR p_id IS NULL OR p_start IS NULL OR p_end IS NULL
    OR p_start<>public.fn_union_week_start(p_start) OR p_end<>public.fn_union_week_start(p_start+interval '8 days') OR p_end>statement_timestamp() THEN RETURN false; END IF;
 IF p_step='earned' AND p_kind<>'union' THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(CASE WHEN p_kind='union' THEN 'union-accounting:' ELSE 'club-accounting:' END
    ||p_id::text||':'||extract(epoch FROM p_start)::text||':'||extract(epoch FROM p_end)::text,0));
 IF smarter_private.weekly_payout_has_posted(p_kind,p_id,p_start,p_end) THEN RETURN false; END IF;
 PERFORM set_config('app.weekly_accounting_chunked','on',true);
 PERFORM set_config('app.accounting_close_memo','on',true);
 PERFORM set_config('app.weekly_accounting_scope_deadline',(clock_timestamp()+interval '3 minutes')::text,true);
 SELECT w.newest INTO newest FROM smarter_private.weekly_payout_windows(p_kind,p_id,p_start,p_end) w WHERE w.complete
 AND w.kind=CASE p_step WHEN 'earned' THEN 'earned_plan_window' ELSE 'round3_'||p_kind||'_window' END;
 IF newest IS NULL THEN RETURN false; END IF;
 IF p_step='earned' THEN
   IF EXISTS(SELECT FROM public.accounting_close_certificates c WHERE c.kind='earned_plan' AND c.union_id=p_id
      AND (c.period_start,c.period_end)=(p_start,p_end) AND c.certified_at>=newest AND c.certified_at>clock_timestamp()-interval '12 hours') THEN RETURN false; END IF;
   plan:=public.fn_accounting_union_earned_plan_combine(p_id,p_start,p_end);
   IF plan IS NULL THEN RETURN false; END IF;
   PERFORM public.fn_accounting_close_certify('earned_plan',p_id,p_start,p_end,plan);
   RETURN true;
 END IF;
 IF EXISTS(SELECT FROM public.fn_accounting_week_clubs(CASE WHEN p_kind='union' THEN p_id END,CASE WHEN p_kind='club' THEN p_id END,p_start,p_end) c
     WHERE smarter_private.weekly_club_calculation_current(c.club_id,first_day,last_day) IS DISTINCT FROM true) THEN RETURN false; END IF;
 SELECT max(q.attempted_at) INTO latest_calculation FROM public.fn_accounting_week_clubs(CASE WHEN p_kind='union' THEN p_id END,CASE WHEN p_kind='club' THEN p_id END,p_start,p_end) c
 JOIN public.accounting_period_recompute_requests q ON (q.club_id,q.period_start,q.period_end)=(c.club_id,first_day,last_day);
 IF EXISTS(SELECT FROM public.accounting_close_partials p WHERE p.kind='round3_'||p_kind||'_plan' AND p.union_id=p_id
     AND (p.period_start,p.period_end,p.window_start,p.window_end)=(p_start,p_end,p_start,p_end)
     AND p.value->>'failed'='false' AND p.value->>'legacy'='false' AND smarter_private.weekly_player_plan_current(p_kind,p_id,p_start,p_end,p.value) AND p.computed_at>=greatest(newest,latest_calculation)
     AND p.computed_at>clock_timestamp()-public.fn_accounting_close_proof_lifetime()) THEN RETURN false; END IF;
 plan:=public.fn_settle_accounting_rakeback_plan(p_kind,p_id,p_start,p_end);
 IF (plan->>'failed') IS DISTINCT FROM 'false' OR (plan->>'legacy') IS DISTINCT FROM 'false' THEN RETURN false; END IF;
 IF public.fn_settle_accounting_rakeback_plan_get(p_kind,p_id,p_start,p_end,
       ARRAY(SELECT jsonb_array_elements_text(plan->'club_ids')::uuid),CASE WHEN p_kind='union' THEN p_id END,
       CASE WHEN p_kind='club' THEN p_id END,false) IS NULL OR (plan->>'periods')::bigint<>jsonb_array_length(plan->'alloc') THEN RETURN false; END IF;
 UPDATE public.accounting_close_partials p SET value=p.value||jsonb_build_object('prepared_verified',true,'certificate_watermark',coalesce((SELECT max(c.id) FROM public.accounting_rakeback_period_calculations c),0)) WHERE
   (p.kind,p.union_id,p.period_start,p.period_end,p.window_start,p.window_end)=('round3_'||p_kind||'_plan',p_id,p_start,p_end,p_start,p_end);
 RETURN true;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_windows(text,uuid,timestamptz,timestamptz),
 smarter_private.weekly_prepared_payout_plans(text,uuid,timestamptz,timestamptz),
 smarter_private.weekly_publish_payout_plans(text,uuid,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION smarter_private.weekly_lock_prepared_payout(p_kind text,p_id uuid,p_start timestamptz,p_end timestamptz)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public AS $f$
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended(CASE WHEN p_kind='union' THEN 'union-accounting:' ELSE 'club-accounting:' END
    ||p_id::text||':'||extract(epoch FROM p_start)::text||':'||extract(epoch FROM p_end)::text,0)) THEN RETURN false; END IF;
 RETURN smarter_private.weekly_prepared_payout_plans(p_kind,p_id,p_start,p_end);
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_lock_prepared_payout(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION smarter_private.weekly_publish_agent_payout_plan(k text,id uuid,ps timestamptz,pe timestamptz)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public AS $f$
DECLARE newest timestamptz; r jsonb; ns jsonb:='[]'; es jsonb:='[]'; cs jsonb:='[]'; valid boolean;
BEGIN
 IF k NOT IN('union','club') OR ps<>public.fn_union_week_start(ps) OR pe<>public.fn_union_week_start(ps+interval '8 days') OR pe>statement_timestamp() THEN RETURN false; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(CASE WHEN k='union' THEN 'union-accounting:' ELSE 'club-accounting:' END
    ||id::text||':'||extract(epoch FROM ps)::text||':'||extract(epoch FROM pe)::text,0))
 OR smarter_private.weekly_payout_has_posted(k,id,ps,pe) THEN RETURN false; END IF;
 SELECT w.newest INTO newest FROM smarter_private.weekly_payout_windows(k,id,ps,pe) w WHERE w.kind='round2_'||k||'_window' AND w.complete;
 IF newest IS NULL OR EXISTS(SELECT FROM smarter_private.weekly_agent_payout_plans a WHERE
   (a.scope_kind,a.scope_id,a.period_start,a.period_end)=(k,id,ps,pe) AND a.computed_at>=newest) THEN RETURN false; END IF;
 PERFORM set_config('app.weekly_accounting_chunked','on',true);
 PERFORM set_config('app.weekly_accounting_scope_deadline',(clock_timestamp()+interval '3 minutes')::text,true);
 r:=public.fn_settle_accounting_commission_combine(k,id,ps,pe);
 IF r IS NULL THEN RETURN false; END IF;
 valid:=r @> '{"read_failed":false,"full_path":false,"hierarchy_bad":false,"entitlement_bad":false,"unclassified":0}'::jsonb AND r->>'fingerprint' IS NOT NULL;
 IF valid THEN
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.club_id,t.user_id),'[]') INTO ns FROM pg_temp._routed_nodes t;
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.club_id,t.payer_user,t.payee_user),'[]') INTO es FROM pg_temp._routed_edges t;
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.club_id),'[]') INTO cs FROM pg_temp._routed_clubs t;
 END IF;
 INSERT INTO smarter_private.weekly_agent_payout_plans VALUES(k,id,ps,pe,clock_timestamp(),valid,r,ns,es,cs,md5(jsonb_build_array(r,ns,es,cs)::text))
 ON CONFLICT(scope_kind,scope_id,period_start,period_end) DO UPDATE SET computed_at=EXCLUDED.computed_at,verified=EXCLUDED.verified,
 proof=EXCLUDED.proof,nodes=EXCLUDED.nodes,edges=EXCLUDED.edges,clubs=EXCLUDED.clubs,identity_hash=EXCLUDED.identity_hash;
 RETURN valid;
END $f$;
CREATE FUNCTION smarter_private.weekly_agent_payout_plan_get(k text,id uuid,ps timestamptz,pe timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $f$
DECLARE a smarter_private.weekly_agent_payout_plans%ROWTYPE;
BEGIN
 SELECT * INTO a FROM smarter_private.weekly_agent_payout_plans p WHERE (p.scope_kind,p.scope_id,p.period_start,p.period_end)=(k,id,ps,pe) AND p.verified;
 IF NOT FOUND THEN RAISE EXCEPTION 'weekly_certified_agent_plan_required' USING ERRCODE='55000'; END IF;
 CREATE TEMP TABLE IF NOT EXISTS _routed_nodes(club_id uuid,user_id uuid,agent_id uuid,role text,own_amount numeric,rows_count int,opening_balance numeric,sort_order int,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _routed_edges(club_id uuid,payer_user uuid,payee_user uuid,amount numeric,role text,sort_order int) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _routed_clubs(club_id uuid PRIMARY KEY) ON COMMIT DROP;
 TRUNCATE pg_temp._routed_nodes,pg_temp._routed_edges,pg_temp._routed_clubs;
 INSERT INTO pg_temp._routed_nodes SELECT * FROM jsonb_populate_recordset(NULL::pg_temp._routed_nodes,a.nodes);
 INSERT INTO pg_temp._routed_edges SELECT * FROM jsonb_populate_recordset(NULL::pg_temp._routed_edges,a.edges);
 INSERT INTO pg_temp._routed_clubs SELECT * FROM jsonb_populate_recordset(NULL::pg_temp._routed_clubs,a.clubs);
 RETURN a.proof;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_publish_agent_payout_plan(text,uuid,timestamptz,timestamptz),smarter_private.weekly_agent_payout_plan_get(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE smarter_private.weekly_payout_admitted_proofs(
 run_id uuid NOT NULL REFERENCES public.weekly_accounting_payout_pauses(run_id),
 scope_kind text NOT NULL,scope_id uuid NOT NULL,period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,
 proof jsonb NOT NULL,held_at timestamptz,held_round integer,held_reason text,PRIMARY KEY(run_id,scope_kind,scope_id,period_start,period_end));
ALTER TABLE smarter_private.weekly_payout_admitted_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.weekly_payout_admitted_proofs FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION smarter_private.weekly_payout_proof_identity(p_kind text,p_id uuid,p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $f$
 SELECT jsonb_build_object('earned',(SELECT c.value->>'source_fingerprint' FROM public.accounting_close_certificates c WHERE p_kind='union'
  AND c.kind='earned_plan' AND (c.union_id,c.period_start,c.period_end)=(p_id,p_start,p_end)),
 'agent_plan',(SELECT a.identity_hash FROM smarter_private.weekly_agent_payout_plans a WHERE (a.scope_kind,a.scope_id,a.period_start,a.period_end)=(p_kind,p_id,p_start,p_end)),
 'player_plan',(SELECT md5(p.value::text) FROM public.accounting_close_partials p WHERE
 (p.kind,p.union_id,p.period_start,p.period_end,p.window_start,p.window_end)=('round3_'||p_kind||'_plan',p_id,p_start,p_end,p_start,p_end)))
$f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_proof_identity(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- Refuse unexpected source drift in the individual anchor(s) we own, preserving
-- other independent changes to the same scheduler.
CREATE FUNCTION pg_temp.patch_payout_source(sig regprocedure,old_text text,new_text text,expected integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d text:=pg_get_functiondef(sig);
BEGIN
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>expected THEN
    RAISE EXCEPTION 'weekly_payout_source_anchor_changed: % %',sig,left(old_text,85);
 END IF;
 EXECUTE replace(d,old_text,new_text);
END $f$;
SELECT pg_temp.patch_payout_source('smarter_private.weekly_payout_next_round()'::regprocedure,$before$ item jsonb; ready jsonb:='[]'::jsonb;$before$,$after$ item jsonb; deferred jsonb; ready jsonb:='[]'::jsonb;$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_prep_shard(int,int)'::regprocedure,$before$ IF EXISTS(SELECT 1 FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e AND p.phase IN('draining','ready','paying')) THEN RETURN; END IF;$before$,$after$ -- Existing active rounds may need to refresh an unpaid scope. Engine-owned maintenance remains exclusive.
 IF EXISTS(SELECT 1 FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e AND p.phase IN('draining','ready','paying')
     AND p.instance_id IS DISTINCT FROM 'weekly-payout-rounds') THEN RETURN; END IF;
 IF (public.fn_accounting_commit_horizon()>=e) IS DISTINCT FROM true THEN RETURN; END IF;$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_prep_shard(int,int)'::regprocedure,$before$ IF n<e OR n>=due+interval '12 hours' THEN RETURN; END IF;$before$,$after$ IF n<e OR n>=due+interval '24 hours' THEN RETURN; END IF;$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_prep_shard(int,int)'::regprocedure,$before$ -- Stage order: own-agent markers, earned plan, calculator parts, round windows.$before$,$after$ -- A changed closed source invalidates just its own original two-hour financial windows.
 FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
   IF p_shard=0 AND NOT smarter_private.weekly_payout_has_posted(item->>'kind',(item->>'id')::uuid,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz) THEN
     IF NOT EXISTS(SELECT FROM public.accounting_own_agent_preparation_versions v WHERE (v.scope_kind,v.scope_id,v.period_start,v.period_end)=
        (item->>'kind',(item->>'id')::uuid,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz)) OR EXISTS(SELECT FROM public.fn_accounting_close_windows((item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz) w
        WHERE NOT EXISTS(SELECT FROM smarter_private.own_agent_clean_windows c WHERE (c.scope_kind,c.scope_id,c.period_start,c.period_end,c.window_start)=
         (item->>'kind',(item->>'id')::uuid,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz,w.window_start))) THEN
       PERFORM set_config('app.weekly_accounting_preparation_deadline',(clock_timestamp()+interval '25 seconds')::text,true);
       PERFORM smarter_private.prepare_own_agent_interpretation(CASE WHEN item->>'kind'='union' THEN (item->>'id')::uuid END,
         CASE WHEN item->>'kind'='club' THEN (item->>'id')::uuid END,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz);
       COMMIT;
     END IF;
     PERFORM smarter_private.weekly_refresh_changed_payout_windows(item->>'kind',(item->>'id')::uuid,
       (item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz);
     COMMIT;
   END IF;
 END LOOP;
 -- Stage order: own-agent markers, earned plan, calculator parts, round windows.$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_prep_shard(int,int)'::regprocedure,$before$ UPDATE smarter_private.weekly_prep_shard_runs SET finished_at=clock_timestamp() WHERE smarter_private.weekly_prep_shard_runs.id=run_id;$before$,$after$ -- Close the calculator once from its committed pieces. Each publisher, including the
 -- earned-fee combiner, has a separate transaction from a club or another stage.
 FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
  k:=item->>'kind'; id:=(item->>'id')::uuid; ps:=(item->>'period_start')::timestamptz; pe:=(item->>'period_end')::timestamptz;
  IF smarter_private.weekly_payout_has_posted(k,id,ps,pe) THEN CONTINUE; END IF;
  IF p_shard=0 AND k='union' THEN
   PERFORM smarter_private.weekly_publish_payout_plans(k,id,ps,pe,'earned');
   COMMIT;
  END IF;
  d_from:=(ps AT TIME ZONE 'America/Los_Angeles')::date;
  FOR c IN SELECT w.club_id FROM public.fn_accounting_week_clubs(CASE WHEN k='union' THEN id END,CASE WHEN k='club' THEN id END,ps,pe) w
    WHERE mod(abs(hashtext(w.club_id::text)::bigint),p_shards)=p_shard ORDER BY w.club_id LOOP
   PERFORM smarter_private.weekly_finalize_club_calculation(c,d_from,(pe AT TIME ZONE 'America/Los_Angeles')::date-1);
   COMMIT;
  END LOOP;
  IF p_shard=mod(2,p_shards) THEN
   PERFORM smarter_private.weekly_publish_agent_payout_plan(k,id,ps,pe);
   COMMIT;
  END IF;
  IF p_shard=mod(1,p_shards) THEN
   PERFORM smarter_private.weekly_publish_payout_plans(k,id,ps,pe,'players');
   COMMIT;
  END IF;
 END LOOP;
 UPDATE smarter_private.weekly_prep_shard_runs SET finished_at=clock_timestamp() WHERE smarter_private.weekly_prep_shard_runs.id=run_id;$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_prep_shard(int,int)'::regprocedure,$before$   IF step='earned' AND k<>'union' THEN CONTINUE; END IF;$before$,$after$   IF step='earned' AND k<>'union' THEN CONTINUE; END IF;
   IF smarter_private.weekly_payout_has_posted(k,id,ps,pe) THEN CONTINUE; END IF;
   IF NOT EXISTS(SELECT FROM public.accounting_own_agent_preparation_versions v
     WHERE (v.scope_kind,v.scope_id,v.period_start,v.period_end)=(k,id,ps,pe)) THEN CONTINUE; END IF;$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_payout_next_round()'::regprocedure,$before$    prep:=public.fn_prepare_accounting_week(CASE WHEN item->>'kind'='union' THEN (item->>'id')::uuid END,CASE WHEN item->>'kind'='club' THEN (item->>'id')::uuid END,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz);$before$,$after$    IF NOT smarter_private.weekly_lock_prepared_payout(item->>'kind',(item->>'id')::uuid,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz) THEN
     PERFORM public.fn_weekly_accounting_attempt_end();
     CONTINUE;
    END IF;
    PERFORM set_config('app.weekly_prepared_plans_only','on',true);
    prep:=public.fn_prepare_accounting_week(CASE WHEN item->>'kind'='union' THEN (item->>'id')::uuid END,CASE WHEN item->>'kind'='club' THEN (item->>'id')::uuid END,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz);$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_payout_next_round()'::regprocedure,$before$  RETURN jsonb_build_object('stage','rounds_booked','run_id',r.run_id,'scopes',ready);$before$,$after$  INSERT INTO smarter_private.weekly_payout_admitted_proofs(run_id,scope_kind,scope_id,period_start,period_end,proof)
  SELECT r.run_id,i->>'kind',(i->>'id')::uuid,(i->>'period_start')::timestamptz,(i->>'period_end')::timestamptz,
    smarter_private.weekly_payout_proof_identity(i->>'kind',(i->>'id')::uuid,(i->>'period_start')::timestamptz,(i->>'period_end')::timestamptz)
  FROM jsonb_array_elements(r.scope_plan) i;
  RETURN jsonb_build_object('stage','rounds_booked','run_id',r.run_id,'scopes',ready);$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_payout_next_round()'::regprocedure,$before$   prep:=public.fn_prepare_accounting_week(CASE WHEN k='union' THEN id END,CASE WHEN k='club' THEN id END,ws,we);$before$,$after$   IF NOT smarter_private.weekly_lock_prepared_payout(k,id,ws,we) THEN
     PERFORM public.fn_weekly_accounting_attempt_end();
     UPDATE smarter_private.weekly_payout_admitted_proofs ap SET held_at=clock_timestamp(),held_round=rnd,held_reason='awaiting_current_sources'
      WHERE (ap.run_id,ap.scope_kind,ap.scope_id,ap.period_start,ap.period_end)=(r.run_id,k,id,ws,we)
       AND (ap.held_round,ap.held_reason) IS DISTINCT FROM (rnd,'awaiting_current_sources'::text);
     deferred:=jsonb_build_object('stage','rounds_waiting_for_certified_sources','scope',item,'round',rnd,'run_id',r.run_id);
     CONTINUE;
   END IF;
   IF NOT EXISTS(SELECT FROM smarter_private.weekly_payout_admitted_proofs ap
     WHERE (ap.run_id,ap.scope_kind,ap.scope_id,ap.period_start,ap.period_end)=(r.run_id,k,id,ws,we)
       AND ap.proof=smarter_private.weekly_payout_proof_identity(k,id,ws,we)) THEN
     IF smarter_private.weekly_payout_has_posted(k,id,ws,we) THEN
       PERFORM public.fn_weekly_accounting_attempt_end();
       UPDATE smarter_private.weekly_payout_admitted_proofs ap SET held_at=clock_timestamp(),held_round=rnd,held_reason='paid_scope_source_change'
        WHERE (ap.run_id,ap.scope_kind,ap.scope_id,ap.period_start,ap.period_end)=(r.run_id,k,id,ws,we)
         AND (ap.held_round,ap.held_reason) IS DISTINCT FROM (rnd,'paid_scope_source_change'::text);
       deferred:=jsonb_build_object('stage','paid_scope_source_change_requires_reconciliation','scope',item,'round',rnd,'run_id',r.run_id);
     CONTINUE;
     END IF;
     INSERT INTO smarter_private.weekly_payout_admitted_proofs(run_id,scope_kind,scope_id,period_start,period_end,proof) VALUES(r.run_id,k,id,ws,we,smarter_private.weekly_payout_proof_identity(k,id,ws,we))
     ON CONFLICT(run_id,scope_kind,scope_id,period_start,period_end) DO UPDATE SET proof=EXCLUDED.proof;
   END IF;
   UPDATE smarter_private.weekly_payout_admitted_proofs ap SET held_at=NULL,held_round=NULL,held_reason=NULL
    WHERE (ap.run_id,ap.scope_kind,ap.scope_id,ap.period_start,ap.period_end)=(r.run_id,k,id,ws,we) AND ap.held_reason IS NOT NULL;
   PERFORM set_config('app.weekly_prepared_plans_only','on',true);
   prep:=public.fn_prepare_accounting_week(CASE WHEN k='union' THEN id END,CASE WHEN k='club' THEN id END,ws,we);$after$);

SELECT pg_temp.patch_payout_source('public.fn_accounting_union_earned_plan(uuid,timestamptz,timestamptz)'::regprocedure,$before$ plan:=public.fn_accounting_union_earned_plan_combine(p_union_id,p_start,p_end);$before$,$after$ IF current_setting('app.weekly_prepared_plans_only',true)='on' THEN RAISE EXCEPTION 'weekly_earned_certificate_required' USING ERRCODE='55000'; END IF;
 plan:=public.fn_accounting_union_earned_plan_combine(p_union_id,p_start,p_end);$after$);

SELECT pg_temp.patch_payout_source('public.fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)'::regprocedure,$before$  result:=public.fn_rakeback_recompute_split(club,from_date,to_date);$before$,$after$  IF current_setting('app.weekly_prepared_plans_only',true)='on' THEN
   RETURN jsonb_build_object('success',false,'accounting_version',3,'problems',jsonb_build_array(jsonb_build_object('reason','weekly_current_club_calculation_required','club_id',club)));
  END IF;
  result:=public.fn_rakeback_recompute_split(club,from_date,to_date);$after$);

SELECT pg_temp.patch_payout_source('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure,$before$   IF NOT v_plan_used THEN
   CREATE TEMP TABLE$before$,$after$   IF NOT v_plan_used AND current_setting('app.weekly_prepared_plans_only',true)='on' AND previous.scope_id IS NULL THEN
    RAISE EXCEPTION 'weekly_current_player_allocations_required' USING ERRCODE='55000'; END IF;
   IF NOT v_plan_used THEN
   CREATE TEMP TABLE$after$);

SELECT pg_temp.patch_payout_source('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure,$before$ IF NOT v4_ok THEN
 TRUNCATE pg_temp._routed_player_items;$before$,$after$ IF NOT v4_ok AND current_setting('app.weekly_prepared_plans_only',true)='on' AND previous.scope_id IS NULL THEN
  RAISE EXCEPTION 'weekly_certified_player_plan_required' USING ERRCODE='55000'; END IF;
 IF NOT v4_ok THEN
 TRUNCATE pg_temp._routed_player_items;$after$);

SELECT pg_temp.patch_payout_source('public.fn_settle_accounting_rakeback_plan(text,uuid,timestamptz,timestamptz)'::regprocedure,$before$  IF NOT FOUND THEN RAISE EXCEPTION 'round3_windows_missing'; END IF;$before$,$after$  IF NOT FOUND AND NOT EXISTS(SELECT FROM smarter_private.weekly_payout_windows(p_scope_kind,p_scope_id,p_period_start,p_period_end) w
   WHERE w.kind='round3_'||p_scope_kind||'_window' AND w.complete) THEN RAISE EXCEPTION 'round3_windows_missing'; END IF;$after$);

SELECT pg_temp.patch_payout_source('public.fn_settle_accounting_rakeback_plan_get(text,uuid,timestamptz,timestamptz,uuid[],uuid,uuid,boolean)'::regprocedure,$before$FROM p WHERE EXISTS(SELECT 1 FROM q)$before$,$after$FROM p WHERE (EXISTS(SELECT 1 FROM q) OR ((p.value->>'periods')::bigint=0 AND p.value->'alloc'='[]'::jsonb
   AND EXISTS(SELECT FROM smarter_private.weekly_payout_windows(p_scope_kind,p_scope_id,p_period_start,p_period_end) w
     WHERE w.kind='round3_'||p_scope_kind||'_window' AND w.complete)))$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_prep_unit(text,uuid,timestamptz,timestamptz,text,uuid,int)'::regprocedure,$before$ IF p_step IN('clean','earned','r2','r3') THEN$before$,$after$ -- A backdated posting must not commit between a window's source read and its publication.
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended(CASE WHEN p_kind='union' THEN 'union-accounting:' ELSE 'club-accounting:' END
   ||p_scope::text||':'||extract(epoch FROM p_from)::text||':'||extract(epoch FROM p_to)::text,0)) THEN RETURN NULL; END IF;
 IF p_step IN('clean','earned','r2','r3') THEN$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_payout_readiness_check()'::regprocedure,$before$ SELECT count(*) INTO nw FROM public.fn_accounting_close_windows(public.fn_union_prev_week_start(e),e);
 SELECT jsonb_agg(jsonb_build_object('scope',x,
   'own_agent_windows_clean',(SELECT count(*) FROM smarter_private.own_agent_clean_windows k WHERE k.scope_kind=x->>'kind' AND k.scope_id=(x->>'id')::uuid AND k.period_end=e),
   'round2_windows',(SELECT count(*) FROM public.accounting_close_partials p WHERE p.kind='round2_'||(x->>'kind')||'_window' AND p.union_id=(x->>'id')::uuid AND p.period_end=e AND p.computed_at>=e),
   'round3_windows',(SELECT count(*) FROM public.accounting_close_partials p WHERE p.kind='round3_'||(x->>'kind')||'_window' AND p.union_id=(x->>'id')::uuid AND p.period_end=e AND p.computed_at>=e),
   'calculations_not_complete',(SELECT count(*) FROM public.fn_accounting_week_clubs(CASE WHEN x->>'kind'='union' THEN (x->>'id')::uuid END,CASE WHEN x->>'kind'='club' THEN (x->>'id')::uuid END,(x->>'period_start')::timestamptz,(x->>'period_end')::timestamptz) c
     WHERE NOT EXISTS(SELECT 1 FROM public.accounting_period_recompute_requests q WHERE q.club_id=c.club_id AND q.period_start=((x->>'period_start')::timestamptz AT TIME ZONE 'America/Los_Angeles')::date AND q.status='complete' AND q.attempted_at>=e))))
 INTO missing FROM jsonb_array_elements(plan) x;
 SELECT bool_and((m->>'own_agent_windows_clean')::int>=nw AND (m->>'round2_windows')::int>=nw AND (m->>'round3_windows')::int>=nw AND (m->>'calculations_not_complete')::int=0) INTO ok FROM jsonb_array_elements(missing) m;
$before$,$after$ SELECT jsonb_agg(jsonb_build_object('scope',x,'certified',smarter_private.weekly_prepared_payout_plans(
   x->>'kind',(x->>'id')::uuid,(x->>'period_start')::timestamptz,(x->>'period_end')::timestamptz),
   'windows',(SELECT count(*) FROM public.fn_accounting_close_windows((x->>'period_start')::timestamptz,(x->>'period_end')::timestamptz))))
 INTO missing FROM jsonb_array_elements(plan) x;
 SELECT bool_and((m->>'certified')::boolean),max((m->>'windows')::integer) INTO ok,nw FROM jsonb_array_elements(missing) m;
$after$);

SELECT pg_temp.patch_payout_source('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure,$before$ v_comb:=CASE WHEN COALESCE$before$,$after$ v_comb:=CASE WHEN current_setting('app.weekly_prepared_plans_only',true)='on'
  THEN smarter_private.weekly_agent_payout_plan_get(p_scope_kind,p_scope_id,p_period_start,p_period_end)
  WHEN COALESCE$after$);

SELECT pg_temp.patch_payout_source('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure,$before$ IF NOT v4_ok THEN RETURN public.fn_settle_accounting_commission_stage_v3(p_scope_kind,p_scope_id,p_period_start,p_period_end); END IF;$before$,$after$ IF NOT v4_ok AND current_setting('app.weekly_prepared_plans_only',true)='on' THEN
   RAISE EXCEPTION 'weekly_agent_plan_validation_failed' USING ERRCODE='55000', DETAIL=v_comb::text; END IF;
 IF NOT v4_ok THEN RETURN public.fn_settle_accounting_commission_stage_v3(p_scope_kind,p_scope_id,p_period_start,p_period_end); END IF;$after$,2);

SELECT pg_temp.patch_payout_source('smarter_private.admit_cash_atomic_contracts(uuid,jsonb)'::regprocedure,$before$DELETE FROM public.accounting_close_partials
   WHERE union_id=COALESCE(s.coordinator_union_id,s.club_id) AND period_start=w_from AND period_end=w_to;$before$,$after$DELETE FROM public.accounting_close_partials
   WHERE union_id=COALESCE(s.coordinator_union_id,s.club_id) AND period_start=w_from AND period_end=w_to
   AND (kind NOT IN('earned_plan_window','round2_union_window','round2_club_window','round3_union_window','round3_club_window')
     OR (window_start<=s.earned_at AND s.earned_at<window_end));$after$);

SELECT pg_temp.patch_payout_source('smarter_private.admit_cash_funding_contracts(uuid,jsonb)'::regprocedure,$before$DELETE FROM public.accounting_close_partials WHERE union_id=s.union_id AND period_start=w_from AND period_end=w_to;$before$,$after$DELETE FROM public.accounting_close_partials WHERE union_id=s.union_id AND period_start=w_from AND period_end=w_to
   AND (kind NOT IN('earned_plan_window','round2_union_window','round2_club_window','round3_union_window','round3_club_window')
     OR (window_start<=s.earned_at AND s.earned_at<window_end));$after$);

SELECT pg_temp.patch_payout_source('smarter_private.admit_own_agent_source(text,uuid)'::regprocedure,$before$DELETE FROM public.accounting_close_partials WHERE union_id=coalesce(s.coordinator_union_id,s.club_id)AND period_start=w_from AND period_end=w_to;$before$,$after$DELETE FROM public.accounting_close_partials WHERE union_id=coalesce(s.coordinator_union_id,s.club_id)AND period_start=w_from AND period_end=w_to
   AND (kind NOT IN('earned_plan_window','round2_union_window','round2_club_window','round3_union_window','round3_club_window')
     OR (window_start<=s.earned_at AND s.earned_at<window_end));$after$);

SELECT pg_temp.patch_payout_source('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure,$before$ v_plan:=public.fn_settle_accounting_rakeback_plan_get(p_scope_kind,p_scope_id,p_period_start,p_period_end,scope.club_ids,p_union_id,standalone_club,legacy_paid_cash_replay);$before$,$after$ v_plan:=public.fn_settle_accounting_rakeback_plan_get(p_scope_kind,p_scope_id,p_period_start,p_period_end,scope.club_ids,p_union_id,standalone_club,legacy_paid_cash_replay);
 IF v_plan IS NULL AND current_setting('app.weekly_prepared_plans_only',true)='on' AND previous.scope_id IS NULL THEN
   RAISE EXCEPTION 'weekly_current_player_plan_required' USING ERRCODE='55000'; END IF;$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_payout_next_round()'::regprocedure,$before$   -- CLUB ISOLATION (20261111174403): a unit with a refused club waits while$before$,$after$   IF rnd>1 AND NOT EXISTS(SELECT FROM smarter_private.weekly_payout_round_receipts x WHERE
      (x.run_id,x.scope_kind,x.scope_id,x.round_no)=(r.run_id,k,id,rnd-1)) THEN CONTINUE; END IF;
   -- CLUB ISOLATION (20261111174403): a unit with a refused club waits while$after$);

SELECT pg_temp.patch_payout_source('smarter_private.weekly_payout_next_round()'::regprocedure,$before$ RETURN smarter_private.weekly_payout_finalize(r.run_id);$before$,$after$ IF deferred IS NOT NULL THEN RETURN deferred; END IF;
 RETURN smarter_private.weekly_payout_finalize(r.run_id);$after$);
COMMIT;
