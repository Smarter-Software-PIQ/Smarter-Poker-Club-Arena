-- Pacific Data cash fees follow original immutable funded source ownership.
-- A Lightning child was funded in Felt while the old parent-seat fallback
-- assigned its raw fee to Kings. Keep original UTC/Chicago writers and money
-- rules; canonical source receipts own only the Pacific reporting projection.
-- All source observations append. Duplicate callbacks and concurrent source /
-- admission writers never wait on a shared report receipt row.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='60s';
SET LOCAL check_function_bodies=false;
CREATE TABLE public.ca_club_data_pacific_cash_records(
 rake_record_id uuid NOT NULL,utc_day date NOT NULL,stat_date date NOT NULL,
 game_id uuid NOT NULL,source_at timestamptz NOT NULL,players uuid[] NOT NULL,candidate_clubs uuid[] NOT NULL
);
CREATE INDEX ca_club_data_pacific_cash_records_day_idx ON public.ca_club_data_pacific_cash_records(utc_day,rake_record_id);
CREATE INDEX ca_club_data_pacific_cash_records_source_idx ON public.ca_club_data_pacific_cash_records(rake_record_id);
CREATE INDEX ca_club_data_pacific_cash_records_window_idx ON public.ca_club_data_pacific_cash_records(stat_date);
CREATE INDEX ca_club_data_pacific_cash_records_clubs_idx ON public.ca_club_data_pacific_cash_records USING gin(candidate_clubs);
ALTER TABLE public.ca_club_data_pacific_cash_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_cash_records FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.ca_club_data_pacific_cash_observations(
 rake_record_id uuid NOT NULL,user_id uuid NOT NULL,utc_day date NOT NULL,stat_date date NOT NULL,
 game_id uuid NOT NULL,source_at timestamptz NOT NULL,stage smallint NOT NULL CHECK(stage BETWEEN 0 AND 3),
 club_id uuid,old_club_id uuid,fee numeric NOT NULL,legacy_recorded boolean,full_source boolean NOT NULL
);
CREATE INDEX ca_club_data_pacific_cash_observations_source_idx ON public.ca_club_data_pacific_cash_observations(rake_record_id,user_id,stage);
CREATE INDEX ca_club_data_pacific_cash_observations_read_idx ON public.ca_club_data_pacific_cash_observations(club_id,stat_date,game_id);
CREATE INDEX ca_club_data_pacific_cash_observations_utc_idx ON public.ca_club_data_pacific_cash_observations(utc_day);
CREATE INDEX ca_club_data_pacific_cash_observations_prior_idx ON public.ca_club_data_pacific_cash_observations(old_club_id,stat_date,rake_record_id);
CREATE INDEX ca_club_data_pacific_cash_observations_correction_idx ON public.ca_club_data_pacific_cash_observations(rake_record_id,user_id,stage) WHERE NOT full_source AND stage>0;
ALTER TABLE public.ca_club_data_pacific_cash_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_cash_observations FROM PUBLIC,anon,authenticated,service_role;

-- Immutable completion witnesses append without shared receipt-row ownership.
CREATE TABLE public.ca_club_data_pacific_cash_participants(rake_record_id uuid NOT NULL,user_id uuid NOT NULL,stat_date date NOT NULL);
CREATE INDEX ca_club_data_pacific_cash_participants_key_idx ON public.ca_club_data_pacific_cash_participants(rake_record_id,user_id);
ALTER TABLE public.ca_club_data_pacific_cash_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_cash_participants FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.ca_club_data_pacific_cash_complete(rake_record_id uuid NOT NULL,stat_date date NOT NULL);
CREATE INDEX ca_club_data_pacific_cash_complete_key_idx ON public.ca_club_data_pacific_cash_complete(rake_record_id);
ALTER TABLE public.ca_club_data_pacific_cash_complete ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_cash_complete FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ca_club_data_pacific_cash_observations_delta_idx ON public.ca_club_data_pacific_cash_observations(club_id,stat_date,rake_record_id) WHERE stage>0 AND old_club_id IS DISTINCT FROM club_id;
CREATE INDEX ca_club_data_pacific_cash_observations_old_delta_idx ON public.ca_club_data_pacific_cash_observations(old_club_id,stat_date,rake_record_id) WHERE stage>0 AND old_club_id IS DISTINCT FROM club_id;

CREATE FUNCTION public.fn_ca_club_data_pacific_cash_parts(p_record uuid)
RETURNS TABLE(game_id uuid,user_id uuid,source_at timestamptz,fee numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH r AS MATERIALIZED(SELECT * FROM public.rake_records WHERE id=p_record AND tournament_id IS NULL
 AND NOT coalesce(is_tournament,false) AND rake_amount>0), e AS MATERIALIZED(
 SELECT r.table_id g,x.key::uuid u,r.created_at at,r.rake_amount amount,x.value::numeric c
 FROM r CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(r.player_contributions)='object' THEN r.player_contributions ELSE '{}'::jsonb END)x
 WHERE x.key~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 AND CASE WHEN x.value~'^[0-9]+(\.[0-9]+)?$' THEN x.value::numeric>0 ELSE false END)
 SELECT e.g,e.u,e.at,e.amount*e.c/sum(e.c) OVER() FROM e
 $$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_cash_parts(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Frozen canonical source wins over an attribution; an original funded
-- admission wins over that source. No current seat, roster or membership read.
CREATE FUNCTION public.fn_ca_club_data_pacific_cash_owner(p_record uuid,p_user uuid)
RETURNS TABLE(club_id uuid,stage smallint,old_club_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH source AS MATERIALIZED(
 SELECT s.club_id original_club,a.funding_club_id FROM public.accounting_cash_rake_sources s
 LEFT JOIN public.accounting_cash_funding_contract_admissions a ON a.source_id=s.id
 WHERE s.rake_record_id=p_record AND s.player_id=p_user), owners AS(
 SELECT coalesce(s.funding_club_id,s.original_club) club,
 CASE WHEN s.funding_club_id IS NOT NULL THEN 3 ELSE 2 END rank,s.original_club old_club FROM source s
 UNION ALL SELECT r.club_id,1,NULL::uuid FROM public.rake_attributions r
 WHERE r.rake_record_id=p_record AND r.player_id=p_user AND NOT EXISTS(SELECT 1 FROM source))
 SELECT CASE WHEN count(DISTINCT club)=1 THEN min(club::text)::uuid END,max(rank)::smallint,min(old_club::text)::uuid FROM owners
 $$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_cash_owner(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_club_data_pacific_cash_register(p_record uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.ca_club_data_pacific_cash_records
 SELECT p_record,(min(p.source_at) AT TIME ZONE 'UTC')::date,public.fn_ca_club_data_pacific_day(min(p.source_at)),
 min(p.game_id::text)::uuid,min(p.source_at),array_agg(p.user_id),
 public.fn_ca_club_data_clubs(coalesce(t.union_id,t.club_id))
 FROM public.fn_ca_club_data_pacific_cash_parts(p_record)p JOIN public.tables t ON t.id=p.game_id
 GROUP BY t.union_id,t.club_id HAVING count(*)>0;
EXCEPTION WHEN OTHERS THEN
 INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail)
 SELECT c,(r.created_at AT TIME ZONE 'UTC')::date,'live_cash_source',SQLSTATE||':'||SQLERRM FROM public.rake_records r
 JOIN public.tables t ON t.id=r.table_id CROSS JOIN LATERAL unnest(public.fn_ca_club_data_clubs(coalesce(t.union_id,t.club_id)))c WHERE r.id=p_record;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_cash_register(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_club_data_pacific_cash_observe(p_pairs jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record;o record;p record;v_full boolean;baseline_count integer;
BEGIN
 FOR r IN SELECT DISTINCT x.rake_record_id,x.user_id,x.event FROM jsonb_to_recordset(coalesce(p_pairs,'[]'))x(rake_record_id uuid,user_id uuid,event text)
 WHERE x.rake_record_id IS NOT NULL AND x.user_id IS NOT NULL ORDER BY 1,2 LOOP
  BEGIN
   SELECT * INTO p FROM public.fn_ca_club_data_pacific_cash_parts(r.rake_record_id) WHERE user_id=r.user_id;
   CONTINUE WHEN NOT FOUND;
   SELECT * INTO o FROM public.fn_ca_club_data_pacific_cash_owner(r.rake_record_id,r.user_id);
   SELECT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_records x WHERE x.rake_record_id=r.rake_record_id) INTO v_full;
   -- Pre-attachment raw captures already live in the aggregate/history. Only
   -- a new original funded admission changes their report ownership.
   CONTINUE WHEN NOT v_full AND (coalesce(o.stage,0)<2 OR coalesce(r.event,'') NOT IN('cash_source','funding_admission'));
   IF v_full THEN
    SELECT count(DISTINCT i.club_id),min(i.club_id::text)::uuid INTO baseline_count,o.old_club_id
    FROM public.ca_club_data_pacific_cash_observations i WHERE i.rake_record_id=r.rake_record_id AND i.user_id=r.user_id AND i.stage=0;
    IF baseline_count>1 THEN RAISE EXCEPTION 'cash_source_baseline_not_unique'; END IF;
   ELSE
    -- A newly frozen cash source can precede its funded admission. Preserve
    -- the first immutable pre-transition owner through both authority stages.
    SELECT coalesce((SELECT i.old_club_id FROM public.ca_club_data_pacific_cash_observations i
      WHERE i.rake_record_id=r.rake_record_id AND i.user_id=r.user_id AND NOT i.full_source AND i.stage>0
      ORDER BY i.stage LIMIT 1),
      CASE WHEN o.stage=2 THEN (SELECT CASE WHEN count(DISTINCT a.club_id)=1 THEN min(a.club_id::text)::uuid END
       FROM public.rake_attributions a WHERE a.rake_record_id=r.rake_record_id AND a.player_id=r.user_id)
      ELSE o.old_club_id END) INTO o.old_club_id;
   END IF;
   IF o.club_id IS NULL OR o.stage IS NULL THEN RAISE EXCEPTION 'cash_source_owner_not_unique'; END IF;
   INSERT INTO public.ca_club_data_pacific_cash_observations
   VALUES(r.rake_record_id,r.user_id,(p.source_at AT TIME ZONE 'UTC')::date,public.fn_ca_club_data_pacific_day(p.source_at),
   p.game_id,p.source_at,o.stage,o.club_id,o.old_club_id,p.fee,NULL,v_full);
   IF v_full THEN INSERT INTO public.ca_club_data_pacific_cash_participants VALUES(r.rake_record_id,r.user_id,public.fn_ca_club_data_pacific_day(p.source_at)); END IF;
  EXCEPTION WHEN OTHERS THEN
   INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail)
   SELECT DISTINCT c.club,(rr.created_at AT TIME ZONE 'UTC')::date,'live_cash_source',SQLSTATE||':'||SQLERRM
   FROM public.rake_records rr CROSS JOIN LATERAL(
    SELECT a.club_id club FROM public.rake_attributions a WHERE a.rake_record_id=rr.id AND a.player_id=r.user_id
    UNION SELECT i.club_id FROM public.ca_club_data_pacific_cash_observations i WHERE i.rake_record_id=rr.id AND i.user_id=r.user_id
    UNION SELECT i.old_club_id FROM public.ca_club_data_pacific_cash_observations i WHERE i.rake_record_id=rr.id AND i.user_id=r.user_id
    UNION SELECT s.club_id FROM public.accounting_cash_rake_sources s WHERE s.rake_record_id=rr.id AND s.player_id=r.user_id
    UNION SELECT a.funding_club_id FROM public.accounting_cash_rake_sources s JOIN public.accounting_cash_funding_contract_admissions a ON a.source_id=s.id WHERE s.rake_record_id=rr.id AND s.player_id=r.user_id
   )c WHERE rr.id=r.rake_record_id AND c.club IS NOT NULL;
  END;
 END LOOP;
 -- Whole-record fast path. Concurrent split callbacks can each append their
 -- participant receipt; the reader combines only records without this witness.
 INSERT INTO public.ca_club_data_pacific_cash_complete
 SELECT DISTINCT z.rake_record_id,z.stat_date FROM public.ca_club_data_pacific_cash_records z
 JOIN (SELECT DISTINCT x.rake_record_id FROM jsonb_to_recordset(coalesce(p_pairs,'[]')) x(rake_record_id uuid)) x USING(rake_record_id)
 WHERE NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_complete d WHERE d.rake_record_id=z.rake_record_id)
 AND NOT EXISTS(SELECT 1 FROM unnest(z.players) u WHERE NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_participants w WHERE w.rake_record_id=z.rake_record_id AND w.user_id=u));
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_cash_observe(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- OFFSET 0 retains bounded source-key probes: a global hash anti-join would
-- scan unrelated retained history even after the outer club/date restriction.
-- Stage dominance uses source-key index probes, not report-row locks. Club and
-- day remain grouping keys, so caller predicates push into the append heap.
CREATE VIEW public.ca_club_data_pacific_cash_current WITH(security_invoker=true) AS
 SELECT o.rake_record_id,o.user_id,o.utc_day,o.stat_date,o.game_id,o.source_at,o.stage,o.club_id,o.old_club_id,
 max(o.fee) fee,o.full_source,
 coalesce((SELECT bool_or(i.legacy_recorded) FROM public.ca_club_data_pacific_cash_observations i
 WHERE i.rake_record_id=o.rake_record_id AND i.user_id=o.user_id AND i.stage=0),false) legacy_recorded
 FROM public.ca_club_data_pacific_cash_observations o WHERE o.stage>0 AND o.club_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_observations n
 WHERE n.rake_record_id=o.rake_record_id AND n.user_id=o.user_id AND n.stage>o.stage OFFSET 0)
 AND NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_observations n
 WHERE n.rake_record_id=o.rake_record_id AND n.user_id=o.user_id AND n.stage=o.stage
 AND (n.club_id IS DISTINCT FROM o.club_id OR n.fee<>o.fee OR n.source_at<>o.source_at OR n.full_source<>o.full_source) OFFSET 0)
 GROUP BY o.rake_record_id,o.user_id,o.utc_day,o.stat_date,o.game_id,o.source_at,o.stage,o.club_id,o.old_club_id,o.full_source;
REVOKE ALL ON public.ca_club_data_pacific_cash_current FROM PUBLIC,anon,authenticated,service_role;
CREATE VIEW public.ca_club_data_pacific_cash_live WITH(security_invoker=true) AS
 SELECT c.club_id,c.utc_day,c.stat_date,'CASH'::text kind,c.game_id,c.user_id,c.fee,0::numeric buyins,0::numeric cashouts,
 0::numeric winnings,c.source_at last_at,0::smallint src,CASE WHEN c.old_club_id IS NULL THEN c.legacy_recorded ELSE true END legacy_recorded,1::bigint hands
 FROM public.ca_club_data_pacific_cash_current c WHERE c.old_club_id IS DISTINCT FROM c.club_id
 AND public.fn_ca_launch_accounting_accepts(c.club_id,c.source_at)
 UNION ALL
 SELECT c.old_club_id,c.utc_day,c.stat_date,'CASH',c.game_id,c.user_id,-c.fee,0,0,0,c.source_at,0,true,-1::bigint
 FROM public.ca_club_data_pacific_cash_current c WHERE c.old_club_id IS DISTINCT FROM c.club_id
 AND c.old_club_id IS NOT NULL AND public.fn_ca_launch_accounting_accepts(c.old_club_id,c.source_at);
REVOKE ALL ON public.ca_club_data_pacific_cash_live FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_club_data_pacific_cash_hand_delta(p_record uuid)
RETURNS TABLE(club_id uuid,utc_day date,stat_date date,table_id uuid,hands bigint,src smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH parts AS MATERIALIZED(SELECT * FROM public.fn_ca_club_data_pacific_cash_parts(p_record)),
 prior AS MATERIALIZED(SELECT user_id,min(old_club_id::text)::uuid club FROM public.ca_club_data_pacific_cash_current
 WHERE rake_record_id=p_record AND NOT full_source GROUP BY user_id),
 owners AS MATERIALIZED(SELECT p.*,o.club_id current_club,coalesce(prior.club,o.club_id) prior_club
 FROM parts p CROSS JOIN LATERAL public.fn_ca_club_data_pacific_cash_owner(p_record,p.user_id)o LEFT JOIN prior USING(user_id)),
 baseline AS(SELECT DISTINCT i.club_id club FROM public.ca_club_data_pacific_cash_observations i WHERE i.rake_record_id=p_record AND i.stage=0
 AND i.user_id='00000000-0000-0000-0000-000000000000'::uuid AND i.club_id IS NOT NULL
 UNION SELECT DISTINCT prior_club FROM owners WHERE NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_records r WHERE r.rake_record_id=p_record)),
 presence AS(SELECT current_club club,1 delta FROM owners WHERE public.fn_ca_launch_accounting_accepts(current_club,source_at) GROUP BY current_club
 UNION ALL SELECT club,-1 FROM baseline WHERE club IS NOT NULL)
 SELECT q.club,(min(p.source_at) AT TIME ZONE 'UTC')::date,public.fn_ca_club_data_pacific_day(min(p.source_at)),min(p.game_id::text)::uuid,sum(q.delta)::bigint,0::smallint
 FROM presence q CROSS JOIN(SELECT min(source_at) source_at,min(game_id::text)::uuid game_id FROM parts)p
 WHERE q.club IS NOT NULL GROUP BY q.club HAVING sum(q.delta)<>0
 $$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_cash_hand_delta(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE VIEW public.ca_club_data_pacific_cash_hands_live WITH(security_invoker=true) AS
 WITH affected AS NOT MATERIALIZED(
 SELECT DISTINCT rake_record_id,club_id,utc_day,stat_date,game_id FROM public.ca_club_data_pacific_cash_current WHERE full_source AND old_club_id IS DISTINCT FROM club_id
 UNION SELECT DISTINCT rake_record_id,old_club_id,utc_day,stat_date,game_id FROM public.ca_club_data_pacific_cash_current WHERE full_source AND old_club_id IS DISTINCT FROM club_id AND old_club_id IS NOT NULL),
 presence AS NOT MATERIALIZED(
 SELECT a.rake_record_id,a.club_id,a.utc_day,a.stat_date,a.game_id,1 delta FROM affected a
 JOIN public.ca_club_data_pacific_cash_observations o ON o.rake_record_id=a.rake_record_id AND o.club_id=a.club_id
 WHERE o.full_source AND o.stage>0 AND public.fn_ca_launch_accounting_accepts(o.club_id,o.source_at)
 AND NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_observations n WHERE n.rake_record_id=o.rake_record_id AND n.user_id=o.user_id AND n.stage>o.stage OFFSET 0)
 AND NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_observations n WHERE n.rake_record_id=o.rake_record_id AND n.user_id=o.user_id AND n.stage=o.stage
 AND(n.club_id IS DISTINCT FROM o.club_id OR n.fee<>o.fee OR n.source_at<>o.source_at OR n.full_source<>o.full_source) OFFSET 0)
 GROUP BY a.rake_record_id,a.club_id,a.utc_day,a.stat_date,a.game_id
 UNION ALL
 SELECT a.rake_record_id,a.club_id,a.utc_day,a.stat_date,a.game_id,-1 FROM affected a
 JOIN public.ca_club_data_pacific_cash_observations i ON i.rake_record_id=a.rake_record_id AND i.club_id=a.club_id
 AND i.stage=0 AND i.user_id='00000000-0000-0000-0000-000000000000'::uuid
 GROUP BY a.rake_record_id,a.club_id,a.utc_day,a.stat_date,a.game_id)
 SELECT club_id,utc_day,stat_date,game_id table_id,sum(delta)::bigint hands,0::smallint src FROM presence
 GROUP BY club_id,utc_day,stat_date,game_id HAVING sum(delta)<>0
 UNION ALL
 SELECT d.* FROM(
 SELECT DISTINCT rake_record_id,club_id candidate,stat_date FROM public.ca_club_data_pacific_cash_current WHERE NOT full_source AND old_club_id IS DISTINCT FROM club_id
 UNION SELECT DISTINCT rake_record_id,old_club_id,stat_date FROM public.ca_club_data_pacific_cash_current WHERE NOT full_source AND old_club_id IS DISTINCT FROM club_id AND old_club_id IS NOT NULL)c
 CROSS JOIN LATERAL public.fn_ca_club_data_pacific_cash_hand_delta(c.rake_record_id)d
 WHERE d.club_id=c.candidate AND d.stat_date=c.stat_date;
REVOKE ALL ON public.ca_club_data_pacific_cash_hands_live FROM PUBLIC,anon,authenticated,service_role;

-- Fold CASH across seed/live sources before deciding game presence. Signed
-- ownership deltas must not leave a phantom game at its former wrong club.
-- Tournament source rows remain intact, including legitimate zero-fee entries.
CREATE OR REPLACE VIEW public.ca_club_data_pacific_fact_ct WITH(security_invoker=true) AS
 WITH facts AS NOT MATERIALIZED(SELECT * FROM public.ca_club_data_pacific_fact UNION ALL SELECT * FROM public.ca_club_data_pacific_journal
 UNION ALL SELECT * FROM public.ca_club_data_pacific_cash_live)
 SELECT club_id,stat_date,'CASH'::text kind,game_id,user_id,sum(fee) fee,sum(buyins) buyins,sum(cashouts) cashouts,
 sum(winnings) winnings,max(last_at) last_at,0::smallint src,sum(hands)::bigint hands FROM facts WHERE kind='CASH'
 GROUP BY club_id,stat_date,game_id,user_id
 HAVING sum(fee)<>0 OR sum(buyins)<>0 OR sum(cashouts)<>0 OR sum(winnings)<>0 OR sum(hands)<>0
 UNION ALL
 SELECT club_id,stat_date,min(kind),game_id,user_id,sum(fee),sum(buyins),sum(cashouts),sum(winnings),max(last_at),src::smallint,sum(hands)::bigint
 FROM facts WHERE kind<>'CASH' GROUP BY club_id,stat_date,game_id,user_id,src;
REVOKE ALL ON public.ca_club_data_pacific_fact_ct FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE VIEW public.ca_club_data_pacific_hands_ct WITH(security_invoker=true) AS
 SELECT club_id,stat_date,table_id,sum(hands)::bigint hands,0::smallint src FROM(
 SELECT * FROM public.ca_club_data_pacific_hands UNION ALL SELECT * FROM public.ca_club_data_pacific_hands_journal
 UNION ALL SELECT * FROM public.ca_club_data_pacific_cash_hands_live)h
 GROUP BY club_id,stat_date,table_id HAVING sum(hands)<>0;
REVOKE ALL ON public.ca_club_data_pacific_hands_ct FROM PUBLIC,anon,authenticated,service_role;

-- The source-ID context changes report wiring only. Original rake logic runs
-- inside its own labeled block with the same returns/error handling. Pending
-- registration survives an old report-only failure and never blocks money.
DO $rake_context$ DECLARE d text;body text;
BEGIN
 d:=pg_get_functiondef('public.trg_ca_club_data_fact_rake()'::regprocedure);
 IF md5(d)<>'ce441b36099ff467dabe3bf209c14a43' THEN RAISE EXCEPTION 'PACIFIC_CASH_RAKE_PREIMAGE_CHANGED'; END IF;
 SELECT prosrc INTO body FROM pg_proc WHERE oid='public.trg_ca_club_data_fact_rake()'::regprocedure;
 body:=replace(body,'RETURN NULL;','EXIT original_rake;');
 body:='DECLARE old_context text:=current_setting(''ca.pacific_rake_record'',true); BEGIN '
 ||'BEGIN PERFORM public.fn_ca_club_data_pacific_cash_register(NEW.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING ''Pacific cash registration failed: %'',SQLERRM; END; '
 ||'PERFORM set_config(''ca.pacific_rake_record'',NEW.id::text,true); <<original_rake>> '||body||' '
 ||'PERFORM set_config(''ca.pacific_rake_record'',coalesce(old_context,''''),true); RETURN NULL; END;';
 d:=regexp_replace(d,'AS \$function\$.*\$function\$','AS '||quote_literal(body),'s'); EXECUTE d;
END $rake_context$;
REVOKE ALL ON FUNCTION public.trg_ca_club_data_fact_rake() FROM PUBLIC,anon,authenticated,service_role;
DO $fact_capture$ DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz)'::regprocedure);
 IF md5(d)<>'51f848b45580cce2731ba4922135364c' THEN RAISE EXCEPTION 'PACIFIC_CASH_CAPTURE_PREIMAGE_CHANGED'; END IF;
 d:=replace(d,'DECLARE ok boolean:=true;', 'DECLARE captured boolean:=false; ok boolean:=true;');
 d:=replace(d,' END IF;'||chr(10)||' EXCEPTION WHEN OTHERS THEN',' END IF; captured:=true;'||chr(10)||' EXCEPTION WHEN OTHERS THEN');
 d:=replace(d,'END $function$', $capture$ BEGIN
 IF p_kind='CASH' AND p_fee>0 AND p_user IS NOT NULL AND nullif(current_setting('ca.pacific_rake_record',true),'') IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_records c WHERE c.rake_record_id=current_setting('ca.pacific_rake_record')::uuid
 AND c.game_id=p_game AND p_user=ANY(c.players) AND c.source_at=a) THEN
  INSERT INTO public.ca_club_data_pacific_cash_observations
  VALUES(current_setting('ca.pacific_rake_record')::uuid,p_user,p_day,d,p_game,a,0,CASE WHEN captured THEN p_club END,NULL,p_fee,ok,true);
 END IF;
 EXCEPTION WHEN OTHERS THEN INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail) VALUES(p_club,p_day,'live_cash_source',SQLSTATE||':'||SQLERRM); END;
END $function$$capture$);

 EXECUTE d;
END $fact_capture$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) TO service_role;
DO $hand_capture$ DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz)'::regprocedure);
 IF md5(d)<>'cca5e6789e50034650ca7a375f991d33' THEN RAISE EXCEPTION 'PACIFIC_CASH_HAND_PREIMAGE_CHANGED'; END IF;
 d:=replace(d,'DECLARE d date','DECLARE captured boolean:=false; d date');
 d:=replace(d,' END IF;'||chr(10)||' EXCEPTION WHEN OTHERS THEN',' END IF; captured:=true;'||chr(10)||' EXCEPTION WHEN OTHERS THEN');
 d:=replace(d,'END $function$', $capture$ BEGIN
 IF nullif(current_setting('ca.pacific_rake_record',true),'') IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_records c WHERE c.rake_record_id=current_setting('ca.pacific_rake_record')::uuid
 AND c.game_id=p_table AND c.source_at=p_at) THEN
  INSERT INTO public.ca_club_data_pacific_cash_observations
  VALUES(current_setting('ca.pacific_rake_record')::uuid,'00000000-0000-0000-0000-000000000000'::uuid,u,d,p_table,p_at,0,CASE WHEN captured THEN p_club END,NULL,0,true,true);
 END IF;
 EXCEPTION WHEN OTHERS THEN INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail) VALUES(p_club,u,'live_cash_source',SQLSTATE||':'||SQLERRM); END;
END $function$$capture$);

 EXECUTE d;
END $hand_capture$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz) TO service_role;

-- These existing statement hooks already own their transition relations.
-- Preserve their original blocks and errors, then observe independently.
CREATE FUNCTION pg_temp.pacific_cash_hook(p_name text,p_hash text,p_pairs text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text;b text;
BEGIN
 d:=pg_get_functiondef(('public.'||p_name||'()')::regprocedure);
 IF md5(d)<>p_hash THEN RAISE EXCEPTION 'PACIFIC_CASH_HOOK_PREIMAGE_CHANGED: %',p_name; END IF;
 SELECT prosrc INTO b FROM pg_proc WHERE oid=('public.'||p_name||'()')::regprocedure;
 b:=replace(b,'RETURN NULL;','EXIT original_projection;');
 b:='BEGIN <<original_projection>> '||b||' BEGIN PERFORM public.fn_ca_club_data_pacific_cash_observe('||p_pairs||'); '
 ||'EXCEPTION WHEN OTHERS THEN RAISE WARNING ''Pacific original cash source observation failed: %'',SQLERRM; END; RETURN NULL; END;';
 EXECUTE regexp_replace(d,'AS \$function\$.*\$function\$','AS '||quote_literal(b),'s');
END $$;
SELECT pg_temp.pacific_cash_hook('trg_ca_club_rake_daily_user_insert','dfc897bb2bd90950d6e34e8f6f3c0bfd',
 '(SELECT jsonb_agg(jsonb_build_object(''rake_record_id'',n.rake_record_id,''user_id'',n.player_id,''event'',''attribution'')) FROM new_rows n)');
SELECT pg_temp.pacific_cash_hook('trg_ca_club_acct_cash_fee','4470919d9dc7a0035bac84b136225213',
 '(SELECT jsonb_agg(jsonb_build_object(''rake_record_id'',n.rake_record_id,''user_id'',n.player_id,''event'',''cash_source'')) FROM new_rows n)');
SELECT pg_temp.pacific_cash_hook('trg_ca_club_acct_admission','aef78526deebd3a83dd92c44651cd459',
 '(SELECT jsonb_agg(jsonb_build_object(''rake_record_id'',s.rake_record_id,''user_id'',s.player_id,''event'',''funding_admission'')) FROM new_rows n JOIN public.accounting_cash_rake_sources s ON s.id=n.source_id)');
REVOKE ALL ON FUNCTION public.trg_ca_club_rake_daily_user_insert() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.trg_ca_club_acct_cash_fee() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.trg_ca_club_acct_admission() FROM PUBLIC,anon,authenticated,service_role;

-- Old load receipts proved a different ownership/hand question. Preserve them
-- for audit, but only the new source-qualified body can mark basis_version=1.
ALTER TABLE public.ca_club_data_pacific_seed_log ADD COLUMN basis_version integer NOT NULL DEFAULT 0;
DO $seed$ DECLARE d text; a int;b int;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_club_data_pacific_seed(date,boolean)'::regprocedure);
 IF md5(d)<>'c7a99bef2e94ab81b5d6d197cc628b12' THEN RAISE EXCEPTION 'PACIFIC_CASH_SEED_PREIMAGE_CHANGED'; END IF;
 d:=replace(d,'WHERE utc_day=p_day) AND NOT p_rebuild','WHERE utc_day=p_day AND basis_version=1) AND NOT p_rebuild');
 d:=replace(d,' ) x GROUP BY club_id,kind,game_id,user_id;', $live$ UNION ALL SELECT club_id,kind,game_id,user_id,fee,buyins,cashouts,winnings
 FROM public.ca_club_data_pacific_cash_live WHERE utc_day=p_day AND NOT legacy_recorded
 ) x GROUP BY club_id,kind,game_id,user_id;$live$);
 d:=replace(d,'SELECT ev.*,coalesce(ev.original_club,fk.club,', $owner$SELECT ev.*,CASE WHEN ev.kind='CASH' AND ev.hid IS NOT NULL
 AND ev.u<>'00000000-0000-0000-0000-000000000000'::uuid THEN
 (SELECT o.club_id FROM public.fn_ca_club_data_pacific_cash_owner(ev.hid,ev.u)o)
 ELSE coalesce(ev.original_club,fk.club,$owner$);
 d:=replace(d,'END) club,','END) END club,');
 -- Ambiguous original cash owners widen only the failure scope. Aggregate
 -- fallbacks cannot hide an independently implicated source club.
 d:=replace(d,' INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail)'||chr(10)||' WITH cut AS MATERIALIZED',
 $scope$ INSERT INTO ca_pacific_potential
 SELECT DISTINCT e.g,e.at,p.club_id FROM ca_pacific_events e CROSS JOIN LATERAL(
  SELECT a.club_id FROM public.rake_attributions a WHERE a.rake_record_id=e.hid AND a.player_id=e.u
  UNION SELECT s.club_id FROM public.accounting_cash_rake_sources s WHERE s.rake_record_id=e.hid AND s.player_id=e.u
  UNION SELECT a.funding_club_id FROM public.accounting_cash_rake_sources s JOIN public.accounting_cash_funding_contract_admissions a ON a.source_id=s.id
   WHERE s.rake_record_id=e.hid AND s.player_id=e.u
 )p WHERE e.club IS NULL AND e.kind='CASH' AND e.hid IS NOT NULL AND p.club_id IS NOT NULL;
 INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail)
 WITH cut AS MATERIALIZED$scope$);
 -- Cash fees conserve the original raw amount by game/player across clubs.
 -- Source receipts, never those aggregate controls, prove actual ownership.
 d:=replace(d,'WHERE coalesce(e.fee,0)<>coalesce(c.fee,0) OR', 'WHERE (coalesce(e.kind,c.kind)<>''CASH'' AND coalesce(e.fee,0)<>coalesce(c.fee,0)) OR');
 a:=position(' INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail) SELECT club_id,p_day,''history'',''Timestamped source sums' IN d);
 IF a=0 THEN RAISE EXCEPTION 'PACIFIC_CASH_SEED_MONEY_ANCHOR_CHANGED'; END IF;
 d:=left(d,a-1)||$money$ INSERT INTO ca_pacific_bad
 WITH e AS(SELECT g,u,sum(fee) fee FROM ca_pacific_events WHERE kind='CASH' GROUP BY g,u),
 c AS(SELECT game_id g,user_id u,sum(fee) fee FROM ca_pacific_control WHERE kind='CASH' GROUP BY game_id,user_id),
 bad AS(SELECT coalesce(e.g,c.g) g,coalesce(e.u,c.u) u FROM e FULL JOIN c USING(g,u) WHERE coalesce(e.fee,0)<>coalesce(c.fee,0))
 SELECT DISTINCT x.club FROM bad JOIN ca_pacific_events x USING(g,u) WHERE x.club IS NOT NULL
 UNION SELECT DISTINCT c.club_id FROM bad JOIN ca_pacific_control c ON c.game_id=bad.g AND c.user_id=bad.u
 ON CONFLICT DO NOTHING;
$money$||substring(d FROM a);
 -- The old UTC club_table_daily includes zero-contribution clubs. It is not
 -- the Data producer's positive-contributor raked-hand question.
 a:=position(' INSERT INTO ca_pacific_bad'||chr(10)||' WITH h AS(' IN d);
 b:=position(' INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail) SELECT club_id,p_day,''history'',''Original UTC fact/hand' IN d);
 IF a=0 OR b<=a THEN RAISE EXCEPTION 'PACIFIC_CASH_SEED_HAND_ANCHOR_CHANGED'; END IF;
 d:=left(d,a-1)||substring(d FROM b);
 d:=replace(d,'Original UTC fact/hand evidence incomplete','Original source evidence incomplete');
 d:=replace(d,'SELECT * FROM public.ca_club_data_pacific_journal WHERE utc_day=p_day) l',
 'SELECT * FROM public.ca_club_data_pacific_journal WHERE utc_day=p_day UNION ALL SELECT * FROM public.ca_club_data_pacific_cash_live WHERE utc_day=p_day) l');
 d:=replace(d,'SELECT * FROM public.ca_club_data_pacific_hands_journal WHERE utc_day=p_day) l',
 'SELECT * FROM public.ca_club_data_pacific_hands_journal WHERE utc_day=p_day UNION ALL SELECT * FROM public.ca_club_data_pacific_cash_hands_live WHERE utc_day=p_day) l');
 d:=replace(d,'INSERT INTO public.ca_club_data_pacific_seed_log VALUES(p_day,clock_timestamp(),coalesce(v_rows,0),coalesce(v_hands,0))',
 'INSERT INTO public.ca_club_data_pacific_seed_log VALUES(p_day,clock_timestamp(),coalesce(v_rows,0),coalesce(v_hands,0),1)');
 d:=replace(d,'hands=EXCLUDED.hands;', 'hands=EXCLUDED.hands,basis_version=1;');
 -- Only the already qualified club/day and repeatable-read snapshot may
 -- retire an original observer error; unresolved source clubs stay refused.
 d:=replace(d,'f.source IN(''live_fact'',''live_hand'')','f.source IN(''live_fact'',''live_hand'',''live_cash_source'')');
 IF position('FULL JOIN (SELECT * FROM public.club_table_daily' IN d)>0 THEN RAISE EXCEPTION 'PACIFIC_CASH_OLD_HAND_CONTROL_REMAINED'; END IF;
 EXECUTE d;
END $seed$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_seed(date,boolean) FROM PUBLIC,anon,authenticated,service_role;

DO $coverage$ DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_club_data_pacific_require(uuid,date,date,integer)'::regprocedure);
 IF md5(d)<>'454850c7342992884a202ffcf194a8e6' THEN RAISE EXCEPTION 'PACIFIC_CASH_COVERAGE_PREIMAGE_CHANGED'; END IF;
 d:=replace(d,'WHERE l.utc_day=d::date)', 'WHERE l.utc_day=d::date AND l.basis_version=1)');
 d:=replace(d,' OR EXISTS(SELECT 1 FROM public.ca_club_data_pacific_failures f', $pending$ OR EXISTS(
 WITH unfinished AS MATERIALIZED(
  SELECT DISTINCT r.rake_record_id,r.players FROM public.ca_club_data_pacific_cash_records r
  WHERE r.stat_date BETWEEN a AND b AND r.candidate_clubs&&public.fn_ca_club_data_clubs(p_club)
  AND NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_cash_complete d WHERE d.rake_record_id=r.rake_record_id)),
 expected AS MATERIALIZED(SELECT DISTINCT r.rake_record_id,u.user_id FROM unfinished r CROSS JOIN LATERAL unnest(r.players)u(user_id)),
 qualified AS MATERIALIZED(SELECT DISTINCT w.rake_record_id,w.user_id FROM public.ca_club_data_pacific_cash_participants w JOIN expected e USING(rake_record_id,user_id))
 SELECT 1 FROM(SELECT rake_record_id,user_id FROM expected EXCEPT SELECT rake_record_id,user_id FROM qualified) missing)

 OR EXISTS(SELECT 1 FROM public.ca_club_data_pacific_failures f$pending$);
 EXECUTE d;
END $coverage$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_require(uuid,date,date,integer) FROM PUBLIC,anon,authenticated,service_role;
-- Preserve the original attachment time; the barrier tracks this replacement
-- source path too, so an old in-flight producer cannot be missed by rebuild.
UPDATE public.ca_club_data_pacific_state SET attachment_xid=pg_current_xact_id()::text::xid WHERE id=true;
COMMIT;
