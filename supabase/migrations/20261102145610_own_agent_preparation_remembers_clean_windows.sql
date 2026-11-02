-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- OWN-AGENT PREPARATION REMEMBERS CLEAN WINDOWS (payout blocker, 2026-11-02).
--
-- After 20261102132226 every job-272 attempt returned cleanly but never
-- became ready: with all 2,531 Midway candidates already reviewed, each call
-- re-scanned every close window for zero candidates and exhausted its work
-- deadline before the last window, so fn_prepare_accounting_week stopped at
-- this step on every tick and the 2026-11-02 payout could not prepare.
--
-- A window whose candidates were all reviewed is recorded in
-- smarter_private.own_agent_clean_windows and skipped by later calls until a
-- cash source of the week's clubs is recorded (or a contract admission is
-- made, or a tournament fee source recorded) after the check -- the same reuse
-- rule the closed-week recompute uses. Filters, admission, reviews and the
-- ready/budget contract are unchanged. Not generation-pinned; caller md5
-- unchanged. No money moves by this migration.
-- @live-proof: (SELECT to_regclass('smarter_private.own_agent_clean_windows') IS NOT NULL AND position('CLEAN WINDOWS ARE REMEMBERED 20261102' IN pg_get_functiondef('smarter_private.prepare_own_agent_interpretation(uuid,uuid,timestamptz,timestamptz,integer)'::regprocedure))>0)
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('smarter_private.prepare_own_agent_interpretation(uuid,uuid,timestamptz,timestamptz,integer)'::regprocedure))
    IS DISTINCT FROM '487a24f20e86edd68fa6831d4f3f2c23' THEN RAISE EXCEPTION 'own_agent_preparation_preimage_changed'; END IF;
 IF md5(pg_get_functiondef('public.fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)'::regprocedure))
    IS DISTINCT FROM '39a7e057da9a65dab5d0b2f761428f13' THEN RAISE EXCEPTION 'own_agent_preparation_caller_changed'; END IF;
END
$guard$;

CREATE TABLE smarter_private.own_agent_clean_windows(
 scope_kind text NOT NULL CHECK (scope_kind IN ('union','club')),
 scope_id uuid NOT NULL,
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL,
 window_start timestamptz NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (scope_kind,scope_id,period_start,period_end,window_start)
);
ALTER TABLE smarter_private.own_agent_clean_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.own_agent_clean_windows FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION smarter_private.prepare_own_agent_interpretation(p_union uuid, p_club uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer DEFAULT 256)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE kind text;identity uuid;item record;seen int:=0;admitted int:=0;clubs uuid[];parts jsonb;certs jsonb;old_hash text;new_hash text;did_admit boolean;budget_exhausted boolean:=false;w record;win_first timestamptz;win_last timestamptz;win_n int;win_gaps int;by_window boolean:=false;win_seen int;win_exited boolean;work_deadline timestamptz:=LEAST(NULLIF(current_setting('app.weekly_accounting_preparation_deadline',true),'')::timestamptz,NULLIF(current_setting('app.weekly_accounting_scope_deadline',true),'')::timestamptz);
BEGIN
 IF NOT public.fn_caller_is_engine()OR p_from IS NULL OR p_to IS NULL OR(p_union IS NULL)=(p_club IS NULL)OR p_limit IS NULL OR p_limit<1 OR p_limit>1024
 OR p_from IS DISTINCT FROM public.fn_union_week_start(p_from)OR p_to IS DISTINCT FROM public.fn_union_week_start(p_from+interval '8 days')OR p_to>now()THEN RAISE EXCEPTION 'own_agent_preparation_scope_invalid' USING ERRCODE='22023';END IF;
 kind:=CASE WHEN p_union IS NULL THEN'club'ELSE'union'END;identity:=coalesce(p_union,p_club);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(CASE WHEN p_union IS NULL THEN'club-accounting:'ELSE'union-accounting:'END||identity||':'||extract(epoch FROM p_from)||':'||extract(epoch FROM p_to),0))THEN RAISE EXCEPTION 'own_agent_interpretation_scope_busy' USING ERRCODE='55000';END IF;
 -- Original completed books remain authoritative, including manual correction
 -- receipts made later. Replaying them cannot create a v1 source or new delta.
 IF EXISTS(SELECT FROM public.accounting_routed_settlement_runs r WHERE r.scope_kind=kind AND r.scope_id=identity AND r.period_start=p_from AND r.period_end=p_to AND r.round_no=3)THEN RETURN jsonb_build_object('ready',true,'legacy_paid',true,'admitted',0);END IF;
 IF work_deadline IS NOT NULL AND(NOT isfinite(work_deadline)OR clock_timestamp()+interval '1 second'>=work_deadline)THEN RETURN jsonb_build_object('ready',false,'admitted',0,'reviewed',0,'budget_exhausted',true,'version','own-agent-v1');END IF;
 SELECT coalesce(array_agg(DISTINCT s.club_id),'{}')INTO clubs FROM public.accounting_payable_earning_sources s WHERE s.earned_at>=p_from AND s.earned_at<p_to AND((p_union IS NOT NULL AND s.coordinator_union_id=p_union)OR(p_club IS NOT NULL AND s.club_id=p_club AND s.coordinator_union_id IS NULL));
 IF NOT EXISTS(SELECT FROM public.accounting_own_agent_preparation_versions v WHERE v.scope_kind=kind AND v.scope_id=identity AND v.period_start=p_from AND v.period_end=p_to)THEN
  IF EXISTS(SELECT FROM public.accounting_routed_settlement_runs r WHERE r.scope_kind=kind AND r.scope_id=identity AND r.period_start=p_from AND r.period_end=p_to)
  OR EXISTS(SELECT FROM public.agent_commission_settlements a WHERE a.club_id=ANY(clubs)AND a.period_start=p_from AND a.period_end=p_to)
  OR EXISTS(SELECT FROM public.rakeback_periods r WHERE r.club_id=ANY(clubs)AND r.period_start=(p_from AT TIME ZONE'America/Los_Angeles')::date AND(r.status<>'pending'OR EXISTS(SELECT FROM public.rakeback_period_payouts pp WHERE pp.rakeback_period_id=r.id)))THEN RAISE EXCEPTION 'own_agent_interpretation_week_already_paid' USING ERRCODE='23514';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',p.kind,'window_start',p.window_start,'window_end',p.window_end,'full_row_md5',md5(to_jsonb(p)::text))ORDER BY p.kind,p.window_start),'[]')INTO parts FROM public.accounting_close_partials p WHERE p.union_id=identity AND p.period_start=p_from AND p.period_end=p_to;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',c.kind,'full_row_md5',md5(to_jsonb(c)::text))ORDER BY c.kind),'[]')INTO certs FROM public.accounting_close_certificates c WHERE c.union_id=identity AND c.period_start=p_from AND c.period_end=p_to;
  INSERT INTO public.accounting_own_agent_preparation_versions(scope_kind,scope_id,period_start,period_end,version,original_partials,original_certificates,owner_hashes)VALUES(kind,identity,p_from,p_to,'own-agent-v1',parts,certs,jsonb_build_object('producer',md5(pg_get_functiondef('public.fn_accounting_earning_contract(uuid,uuid,numeric,uuid,timestamptz)'::regprocedure)),'calculator',md5(pg_get_functiondef('public.fn_calculate_cash_rakeback_periods(uuid,date,date,uuid[])'::regprocedure)),'split_check',md5(pg_get_functiondef('public.fn_rakeback_split_check(uuid,date,date,uuid[])'::regprocedure)),'split_write',md5(pg_get_functiondef('public.fn_rakeback_split_write(uuid,date,date,uuid[])'::regprocedure))));
  DELETE FROM public.accounting_close_partials WHERE union_id=identity AND period_start=p_from AND period_end=p_to;
  DELETE FROM public.accounting_close_certificates WHERE union_id=identity AND period_start=p_from AND period_end=p_to;
  DELETE FROM public.accounting_recompute_split_parts WHERE club_id=ANY(clubs)AND period_start=(p_from AT TIME ZONE'America/Los_Angeles')::date AND period_end=(p_to AT TIME ZONE'America/Los_Angeles')::date-1;
  UPDATE public.accounting_period_recompute_requests SET status='pending',reason=NULL,last_result='{}',last_requested_at=clock_timestamp()WHERE club_id=ANY(clubs)AND period_start=(p_from AT TIME ZONE'America/Los_Angeles')::date AND period_end=(p_to AT TIME ZONE'America/Los_Angeles')::date-1;
 END IF;
 -- WINDOW BY WINDOW 20261102: the whole-week form of this query sorted every
 -- payable source of the week (millions of rows through the union view and
 -- their contract JSON) before returning one row, so it could not finish
 -- inside a 240s preparation tick and the 2026-11-02 payout never prepared.
 -- The same filters run per canonical close window (about 0.5s each); the
 -- reviewed set and every decision are identical, only the visiting order
 -- becomes window, then source. If the canonical windows do not tile the week
 -- exactly, the original whole-week query runs unchanged.
 SELECT min(x.window_start),max(x.window_end),count(*),
  count(*) FILTER(WHERE x.window_start IS DISTINCT FROM x.prev_end AND x.prev_end IS NOT NULL)
  INTO win_first,win_last,win_n,win_gaps
  FROM(SELECT c.window_start,c.window_end,lag(c.window_end)OVER(ORDER BY c.window_start)prev_end FROM public.fn_accounting_close_windows(p_from,p_to)c)x;
 by_window:=win_n>0 AND win_first=p_from AND win_last=p_to AND win_gaps=0;
 IF by_window THEN
 FOR w IN SELECT c.window_start,c.window_end FROM public.fn_accounting_close_windows(p_from,p_to)c ORDER BY c.window_start LOOP
  EXIT WHEN seen>=p_limit OR budget_exhausted;
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;EXIT;END IF;
  -- CLEAN WINDOWS ARE REMEMBERED 20261102: a window whose every candidate
  -- was reviewed stays clean until a source of this week's clubs is recorded
  -- or admitted after the window was checked (the recompute's reuse rule).
  CONTINUE WHEN EXISTS(SELECT 1 FROM smarter_private.own_agent_clean_windows k
   WHERE k.scope_kind=kind AND k.scope_id=identity AND k.period_start=p_from AND k.period_end=p_to AND k.window_start=w.window_start
    AND NOT EXISTS(SELECT 1 FROM (SELECT s.earned_at FROM public.accounting_cash_rake_sources s
      WHERE s.club_id=ANY(clubs) AND s.recorded_at>k.checked_at-interval '1 minute' OFFSET 0) s WHERE s.earned_at>=w.window_start AND s.earned_at<w.window_end)
    AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources f
      WHERE f.club_id=ANY(clubs) AND f.recorded_at>k.checked_at-interval '1 minute' AND f.charged_at>=w.window_start AND f.charged_at<w.window_end)
    AND NOT EXISTS(SELECT 1 FROM public.accounting_cash_atomic_contract_admissions a WHERE a.admitted_at>k.checked_at-interval '1 minute'));
  win_seen:=seen;win_exited:=false;
 FOR item IN SELECT s.source_type,s.source_id FROM public.accounting_payable_earning_sources s
 WHERE s.earned_at>=w.window_start AND s.earned_at<w.window_end AND((p_union IS NOT NULL AND s.coordinator_union_id=p_union)OR(p_club IS NOT NULL AND s.club_id=p_club AND s.coordinator_union_id IS NULL))
 AND coalesce(s.contract#>>'{membership,terms,role}','')IN('super_agent','agent','sub_agent')AND s.contract#>>'{tiers,0,user_id}'IS DISTINCT FROM s.player_id::text
 AND NOT(coalesce((s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric=.70,false)AND EXISTS(SELECT FROM public.clubs c WHERE c.id=s.club_id AND c.owner_id=NULLIF(s.contract#>>'{membership,terms,agent_id}','')::uuid))
 AND NOT EXISTS(SELECT FROM public.accounting_own_agent_source_reviews a WHERE a.source_type=s.source_type AND a.source_id=s.source_id)
 ORDER BY s.source_type,s.source_id LIMIT p_limit-seen LOOP
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;win_exited:=true;EXIT;END IF;
  seen:=seen+1;
  SELECT md5(s.contract::text)INTO STRICT old_hash FROM public.accounting_payable_earning_sources s WHERE s.source_type=item.source_type AND s.source_id=item.source_id;
  did_admit:=smarter_private.admit_own_agent_source(item.source_type,item.source_id);
  IF did_admit THEN admitted:=admitted+1;END IF;
  SELECT md5(s.contract::text)INTO STRICT new_hash FROM public.accounting_payable_earning_sources s WHERE s.source_type=item.source_type AND s.source_id=item.source_id;
  INSERT INTO public.accounting_own_agent_source_reviews(source_type,source_id,version,original_contract_md5,effective_contract_md5,outcome)VALUES(item.source_type,item.source_id,'own-agent-v1',old_hash,new_hash,CASE WHEN did_admit THEN'admitted'ELSE'unchanged'END);
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;win_exited:=true;EXIT;END IF;
 END LOOP;
  IF NOT win_exited AND NOT budget_exhausted AND seen-win_seen<p_limit-win_seen THEN
   INSERT INTO smarter_private.own_agent_clean_windows(scope_kind,scope_id,period_start,period_end,window_start,checked_at)
   VALUES(kind,identity,p_from,p_to,w.window_start,clock_timestamp())
   ON CONFLICT(scope_kind,scope_id,period_start,period_end,window_start) DO UPDATE SET checked_at=EXCLUDED.checked_at;
  END IF;
 END LOOP;
 ELSE
 FOR item IN SELECT s.source_type,s.source_id FROM public.accounting_payable_earning_sources s
 WHERE s.earned_at>=p_from AND s.earned_at<p_to AND((p_union IS NOT NULL AND s.coordinator_union_id=p_union)OR(p_club IS NOT NULL AND s.club_id=p_club AND s.coordinator_union_id IS NULL))
 AND coalesce(s.contract#>>'{membership,terms,role}','')IN('super_agent','agent','sub_agent')AND s.contract#>>'{tiers,0,user_id}'IS DISTINCT FROM s.player_id::text
 AND NOT(coalesce((s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric=.70,false)AND EXISTS(SELECT FROM public.clubs c WHERE c.id=s.club_id AND c.owner_id=NULLIF(s.contract#>>'{membership,terms,agent_id}','')::uuid))
 AND NOT EXISTS(SELECT FROM public.accounting_own_agent_source_reviews a WHERE a.source_type=s.source_type AND a.source_id=s.source_id)
 ORDER BY s.source_type,s.source_id LIMIT p_limit LOOP
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;EXIT;END IF;
  seen:=seen+1;
  SELECT md5(s.contract::text)INTO STRICT old_hash FROM public.accounting_payable_earning_sources s WHERE s.source_type=item.source_type AND s.source_id=item.source_id;
  did_admit:=smarter_private.admit_own_agent_source(item.source_type,item.source_id);
  IF did_admit THEN admitted:=admitted+1;END IF;
  SELECT md5(s.contract::text)INTO STRICT new_hash FROM public.accounting_payable_earning_sources s WHERE s.source_type=item.source_type AND s.source_id=item.source_id;
  INSERT INTO public.accounting_own_agent_source_reviews(source_type,source_id,version,original_contract_md5,effective_contract_md5,outcome)VALUES(item.source_type,item.source_id,'own-agent-v1',old_hash,new_hash,CASE WHEN did_admit THEN'admitted'ELSE'unchanged'END);
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;EXIT;END IF;
 END LOOP;
 END IF;
 RETURN jsonb_build_object('ready',NOT budget_exhausted AND seen<p_limit,'admitted',admitted,'reviewed',seen,'budget_exhausted',budget_exhausted,'version','own-agent-v1');
END $function$;

REVOKE ALL ON FUNCTION smarter_private.prepare_own_agent_interpretation(uuid,uuid,timestamptz,timestamptz,integer) FROM PUBLIC, anon, authenticated;

DO $post$
BEGIN
 IF position('CLEAN WINDOWS ARE REMEMBERED 20261102' IN pg_get_functiondef('smarter_private.prepare_own_agent_interpretation(uuid,uuid,timestamptz,timestamptz,integer)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'own_agent_clean_window_memory_missing'; END IF;
 IF md5(pg_get_functiondef('public.fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)'::regprocedure))
    IS DISTINCT FROM '39a7e057da9a65dab5d0b2f761428f13' THEN RAISE EXCEPTION 'own_agent_preparation_caller_changed_by_install'; END IF;
END
$post$;
COMMIT;
