-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- WEEKLY PAYOUT PAID ROUND BY ROUND (owner, 2026-11-02).
-- On 2026-11-02 the 04:00 payout could not be paid inside the engine's
-- four-minute parked window: round 3 alone ran longer than the 240-second
-- statement, and the park acknowledgement never matched. It was paid that day
-- round by round in separate committed transactions, retried on deadlock, with
-- no table pause. This makes that the product: weekly-payout-rounds books a
-- database-only boundary once every owed scope is prepared, then pays each
-- scope's round 1, 2 and 3 in its own transaction (one unit per minute), funds
-- any agent wallet that would be short for its players from that club's bank
-- (a recorded Club Bank send), and finalizes: financial receipts, credit-line
-- invoices at credit line minus agent wallet, Rakeback Received notifications
-- for every player, agent and club owner paid, and an owner report. Job 272
-- keeps preparing and, after the runner releases, runs the promo and the books.
-- A round with a receipt is never paid again.
-- periodic-work: the weekly payout itself, paid one round per minute between the week's payout time and twenty-four hours after; it is the product, not a retry of a failed writer.
-- @live-proof: (SELECT to_regprocedure('smarter_private.weekly_payout_next_round()') IS NOT NULL AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='weekly-payout-rounds' AND active) AND position('ROUND RUNNER OWNS THE MONEY' IN pg_get_functiondef('smarter_private.weekly_payout_due()'::regprocedure))>0)
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='20s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_due()'::regprocedure)) IS DISTINCT FROM 'b3a66cda25156eb5472ab1d1c4e37351'
  OR md5(pg_get_functiondef('smarter_private.weekly_payout_prepare_due()'::regprocedure)) IS DISTINCT FROM '34b4863f296c4fbbe99522109d444c6a'
  OR md5(pg_get_functiondef('public.fn_weekly_accounting_payout_pause_state(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'c104d1b8c7ad71a07c24319c332def0a'
 THEN RAISE EXCEPTION 'weekly_payout_preimage_changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.weekly_accounting_payout_pauses p WHERE p.phase IN('draining','ready','paying')) THEN RAISE EXCEPTION 'weekly_payout_boundary_open'; END IF;
END $guard$;
CREATE TABLE IF NOT EXISTS smarter_private.weekly_payout_rounds_config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT true, report_user_id uuid);
INSERT INTO smarter_private.weekly_payout_rounds_config(singleton,enabled,report_user_id) VALUES(true,true,'47965354-0e56-43ef-931c-ddaab82af765') ON CONFLICT DO NOTHING;
ALTER TABLE smarter_private.weekly_payout_rounds_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.weekly_payout_rounds_config FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS smarter_private.weekly_payout_round_receipts(
 run_id uuid NOT NULL REFERENCES public.weekly_accounting_payout_pauses(run_id), scope_kind text NOT NULL CHECK(scope_kind IN('union','club')), scope_id uuid NOT NULL,
 round_no int NOT NULL CHECK(round_no BETWEEN 1 AND 3), receipt jsonb NOT NULL, funding jsonb, paid_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(run_id,scope_kind,scope_id,round_no));
ALTER TABLE smarter_private.weekly_payout_round_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.weekly_payout_round_receipts FROM PUBLIC, anon, authenticated, service_role;

-- The round runner's boundary is a database-only owner: it is never a game pause.
ALTER TABLE public.weekly_accounting_payout_pauses DROP CONSTRAINT IF EXISTS weekly_accounting_payout_pauses_attempt_no_check;
ALTER TABLE public.weekly_accounting_payout_pauses ADD CONSTRAINT weekly_accounting_payout_pauses_attempt_no_check CHECK (attempt_no >= 1 AND (attempt_no <= 24 OR instance_id IS NOT DISTINCT FROM 'weekly-payout-rounds')) NOT VALID;
ALTER TABLE public.weekly_accounting_payout_pauses DROP CONSTRAINT IF EXISTS weekly_accounting_payout_pauses_check4;
ALTER TABLE public.weekly_accounting_payout_pauses DROP CONSTRAINT IF EXISTS weekly_accounting_payout_pauses_check5;
ALTER TABLE public.weekly_accounting_payout_pauses DROP CONSTRAINT IF EXISTS weekly_accounting_payout_pauses_slot_check;
ALTER TABLE public.weekly_accounting_payout_pauses ADD CONSTRAINT weekly_accounting_payout_pauses_check4 CHECK (instance_id IS NOT DISTINCT FROM 'weekly-payout-rounds' OR money_deadline_at = money_starts_at + interval '4 minutes') NOT VALID;
ALTER TABLE public.weekly_accounting_payout_pauses ADD CONSTRAINT weekly_accounting_payout_pauses_check5 CHECK (instance_id IS NOT DISTINCT FROM 'weekly-payout-rounds' OR expires_at = money_starts_at + interval '5 minutes') NOT VALID;
ALTER TABLE public.weekly_accounting_payout_pauses ADD CONSTRAINT weekly_accounting_payout_pauses_slot_check CHECK (instance_id IS NOT DISTINCT FROM 'weekly-payout-rounds' OR money_starts_at = (public.fn_union_accounting_run_at(period_end) + make_interval(hours => (attempt_no - 1)))) NOT VALID;

-- Fund every agent wallet that will pay its players more than it holds, from
-- that club's bank, as the club owner's recorded Club Bank send.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_fund_agent_shortfalls(p_run uuid,p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE d_from date:=(p_from AT TIME ZONE 'America/Los_Angeles')::date; s record; res jsonb; out jsonb:='[]'::jsonb; saved text:=current_setting('request.jwt.claims',true); saved_sub text:=current_setting('request.jwt.claim.sub',true);
BEGIN
 FOR s IN
  WITH f AS (SELECT c.club_id, fp.payer_user, fp.owed FROM public.accounting_rakeback_period_calculations c JOIN public.rakeback_periods rp ON rp.id=c.period_id
    CROSS JOIN LATERAL smarter_private.rakeback_certificate_wallets(c.id) fp
    JOIN public.clubs cl ON cl.id=c.club_id
    WHERE rp.period_start=d_from AND rp.status='pending' AND c.payer_kind<>'club'
     AND ((p_kind='union' AND c.coordinator_union_id=p_id) OR (p_kind='club' AND c.club_id=p_id AND c.coordinator_union_id IS NULL))
     AND fp.payer_kind<>'club' AND fp.payer_user IS NOT NULL AND fp.payer_user<>cl.owner_id AND fp.owed>0)
  SELECT f.club_id, f.payer_user, round(sum(f.owed),2) owed, a.agent_wallet_balance bal, cl.owner_id
  FROM f JOIN public.agents a ON a.club_id=f.club_id AND a.user_id=f.payer_user JOIN public.clubs cl ON cl.id=f.club_id
  GROUP BY f.club_id,f.payer_user,a.agent_wallet_balance,cl.owner_id HAVING round(sum(f.owed),2)>a.agent_wallet_balance
 LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',s.owner_id,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',s.owner_id::text,true);
  res:=public.fn_club_bank_send(s.club_id,s.payer_user,round(s.owed-s.bal,2),'agent_wallet',
    'Weekly rakeback funding: agent wallet short for players (week ending '||to_char(p_to AT TIME ZONE 'America/Chicago','Mon DD')||')',
    md5(p_run::text||':'||s.club_id::text||':'||s.payer_user::text)::uuid);
  IF COALESCE(res->>'success','false')<>'true' THEN RAISE EXCEPTION 'weekly_payout_agent_funding_refused %',res::text; END IF;
  out:=out||jsonb_build_array(jsonb_build_object('club_id',s.club_id,'agent_user_id',s.payer_user,'owed',s.owed,'wallet_before',s.bal,'funded',round(s.owed-s.bal,2)));
 END LOOP;
 PERFORM set_config('request.jwt.claims',COALESCE(saved,''),true);
 PERFORM set_config('request.jwt.claim.sub',COALESCE(saved_sub,''),true);
 RETURN out;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ROUND-BY-ROUND WEEKLY PAYOUT (owner, 2026-11-02). Each call does one unit
-- in its own transaction: books the database-only runner boundary once every
-- owed scope is prepared, then pays round 1 (union/club bank), round 2 (club
-- to agents) and round 3 (agents/clubs to players) one scope at a time, then
-- finalizes (receipts, release, credit-line invoices, Rakeback Received
-- notifications, owner report). A round that raised rolls back whole and is
-- retried on the next call; a round with a receipt is never paid again.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_next_round()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE n timestamptz:=clock_timestamp(); e timestamptz:=public.fn_union_week_start(clock_timestamp()); due timestamptz; plan jsonb; r public.weekly_accounting_payout_pauses%ROWTYPE;
 item jsonb; ready jsonb:='[]'::jsonb; prep jsonb; pending boolean; k text; id uuid; ws timestamptz; we timestamptz; rnd int; res jsonb; funding jsonb; d_from date; cfg smarter_private.weekly_payout_rounds_config%ROWTYPE;
 summary jsonb; att int;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO cfg FROM smarter_private.weekly_payout_rounds_config WHERE singleton;
 IF NOT FOUND OR NOT cfg.enabled THEN RETURN NULL; END IF;
 due:=public.fn_union_accounting_run_at(e);
 IF n<due OR n>=due+interval '24 hours' THEN RETURN NULL; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('weekly-payout-rounds',0)) THEN RETURN jsonb_build_object('stage','rounds_busy'); END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('union-accounting-scheduler',0)) THEN RETURN jsonb_build_object('stage','scheduler_busy'); END IF;
 PERFORM set_config('app.weekly_accounting_chunked','on',true);
 SELECT * INTO r FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e AND p.instance_id='weekly-payout-rounds' AND p.phase<>'released' ORDER BY p.attempt_no DESC LIMIT 1;
 IF NOT FOUND THEN
  plan:=smarter_private.weekly_payout_scope_plan(e,n);
  IF plan IS NULL OR jsonb_array_length(plan)=0 THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e AND p.phase IN('draining','ready','paying')) THEN RETURN jsonb_build_object('stage','engine_boundary_open'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
   BEGIN
    PERFORM public.fn_weekly_accounting_attempt_begin(item->>'kind'='union');
    PERFORM set_config('app.weekly_accounting_scope_deadline',(clock_timestamp()+interval '8 minutes')::text,true);
    prep:=public.fn_prepare_accounting_week(CASE WHEN item->>'kind'='union' THEN (item->>'id')::uuid END,CASE WHEN item->>'kind'='club' THEN (item->>'id')::uuid END,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz);
    pending:=prep->>'success'='true' AND public.fn_accounting_close_windows_pending(CASE WHEN item->>'kind'='union' THEN (item->>'id')::uuid END,CASE WHEN item->>'kind'='club' THEN (item->>'id')::uuid END,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz);
    PERFORM public.fn_weekly_accounting_attempt_end();
    IF prep->>'success'='true' AND NOT pending THEN ready:=ready||jsonb_build_array(item); END IF;
   EXCEPTION WHEN OTHERS THEN NULL;
   END;
  END LOOP;
  IF jsonb_array_length(ready)=0 OR (jsonb_array_length(ready)<jsonb_array_length(plan) AND n<due+interval '45 minutes') THEN
   RETURN jsonb_build_object('stage','rounds_waiting_for_preparation','ready',ready,'owed',plan);
  END IF;
  SELECT COALESCE(max(attempt_no),0)+1 INTO att FROM public.weekly_accounting_payout_pauses WHERE period_end=e;
  INSERT INTO public.weekly_accounting_payout_pauses(period_start,period_end,attempt_no,announced_at,money_starts_at,money_deadline_at,expires_at,scope_plan,phase,acknowledged_at,instance_id,lease_claims)
  VALUES(public.fn_union_prev_week_start(e),e,att,date_trunc('second',n)-interval '2 minutes',date_trunc('second',n),n+interval '20 hours',n+interval '20 hours 1 minute',ready,'ready',n,'weekly-payout-rounds','[]'::jsonb)
  RETURNING * INTO r;
  RETURN jsonb_build_object('stage','rounds_booked','run_id',r.run_id,'scopes',ready);
 END IF;
 -- The next unpaid unit: every scope's round 1, then round 2, then round 3.
 FOR rnd IN 1..3 LOOP
  FOR item IN SELECT value FROM jsonb_array_elements(r.scope_plan) LOOP
   k:=item->>'kind'; id:=(item->>'id')::uuid; ws:=(item->>'period_start')::timestamptz; we:=(item->>'period_end')::timestamptz;
   CONTINUE WHEN EXISTS(SELECT 1 FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.scope_kind=k AND x.scope_id=id AND x.round_no=rnd);
   UPDATE public.weekly_accounting_payout_pauses SET phase='paying' WHERE run_id=r.run_id AND phase<>'paying';
   PERFORM public.fn_weekly_accounting_attempt_begin(k='union');
   PERFORM set_config('app.weekly_accounting_scope_deadline',(r.money_deadline_at-interval '2 seconds')::text,true);
   prep:=public.fn_prepare_accounting_week(CASE WHEN k='union' THEN id END,CASE WHEN k='club' THEN id END,ws,we);
   IF prep->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'weekly_payout_round_preparation_changed %',left(prep::text,1000); END IF;
   funding:=NULL;
   IF rnd=3 THEN funding:=smarter_private.weekly_payout_fund_agent_shortfalls(r.run_id,k,id,ws,we); END IF;
   INSERT INTO smarter_private.weekly_payout_owned_transactions(backend_pid,transaction_id,run_id,scope_kind,scope_id,period_start,period_end,round_no)
   VALUES(pg_backend_pid(),txid_current(),r.run_id,k,id,ws,we,rnd)
   ON CONFLICT(backend_pid,transaction_id) DO UPDATE SET run_id=EXCLUDED.run_id,scope_kind=EXCLUDED.scope_kind,scope_id=EXCLUDED.scope_id,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,round_no=EXCLUDED.round_no;
   IF rnd=1 THEN
    PERFORM set_config('app.union_close_defer_rake_debit','',true);
    IF k='union' THEN
     res:=public.fn_union_weekly_rakeback_close(id,ws,we);
     IF res->>'success' IS DISTINCT FROM 'true' AND res->>'error' IS DISTINCT FROM 'already_executed' THEN RAISE EXCEPTION 'weekly_payout_round1_refused %',left(res::text,1000); END IF;
    ELSE
     res:=public.fn_bank_standalone_week_rake(id,ws,we);
     IF res->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'weekly_payout_club_bank_refused %',left(res::text,1000); END IF;
    END IF;
   ELSIF rnd=2 THEN res:=public.fn_settle_accounting_commission_stage(k,id,ws,we);
   ELSE res:=public.fn_settle_accounting_rakeback_stage(k,id,ws,we);
   END IF;
   IF rnd IN(2,3) AND (res->>'success' IS DISTINCT FROM 'true' OR res->>'routing_version' IS DISTINCT FROM '3' OR res->>'source_version' IS DISTINCT FROM '2'
     OR COALESCE((res->>'shortfalls')::integer,0)<>0 OR res->>'batch_committed'='true'
     OR NOT EXISTS(SELECT FROM public.accounting_routed_settlement_runs x WHERE x.scope_kind=k AND x.scope_id=id AND x.period_start=ws AND x.period_end=we AND x.round_no=rnd AND x.result=(res-'duplicate')))
   THEN RAISE EXCEPTION 'weekly_payout_round_receipt_required %',left(res::text,1000); END IF;
   IF k='union' THEN
    INSERT INTO public.union_settlement_rounds(union_id,period_start,period_end,round_no,round_name,payers,payees,amount,shortfalls,detail)
    VALUES(id,ws,we,rnd,CASE rnd WHEN 1 THEN 'union_to_clubs' WHEN 2 THEN 'club_to_agents' ELSE 'agents_to_players' END,CASE WHEN rnd=1 THEN 1 ELSE 0 END,
     COALESCE((res->>'payees')::integer,(res->>'clubs_paid')::integer,0),COALESCE((res->>'amount')::numeric,(res->>'total_rakeback')::numeric,0),COALESCE((res->>'shortfalls')::integer,0),res)
    ON CONFLICT(union_id,period_start,period_end,round_no) DO NOTHING;
   END IF;
   INSERT INTO smarter_private.weekly_payout_round_receipts(run_id,scope_kind,scope_id,round_no,receipt,funding) VALUES(r.run_id,k,id,rnd,res,funding);
   DELETE FROM smarter_private.weekly_payout_owned_transactions WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
   PERFORM public.fn_weekly_accounting_attempt_end();
   RETURN jsonb_build_object('stage','round_paid','run_id',r.run_id,'scope',item,'round',rnd,'receipt',res,'funding',funding);
  END LOOP;
 END LOOP;
 -- Every round of every scope is paid: finalize once.
 RETURN smarter_private.weekly_payout_finalize(r.run_id);
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_next_round() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_finalize(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE r public.weekly_accounting_payout_pauses%ROWTYPE; item jsonb; d_from date; summary jsonb; cfg smarter_private.weekly_payout_rounds_config%ROWTYPE; notes int; label text;
BEGIN
 SELECT * INTO STRICT r FROM public.weekly_accounting_payout_pauses WHERE run_id=p_run FOR UPDATE;
 IF r.phase='released' THEN RETURN r.result; END IF;
 d_from:=(r.period_start AT TIME ZONE 'America/Los_Angeles')::date;
 label:=to_char(r.period_start AT TIME ZONE 'America/Chicago','Mon DD')||' - '||to_char((r.period_end-interval '1 second') AT TIME ZONE 'America/Chicago','Mon DD');
 FOR item IN SELECT value FROM jsonb_array_elements(r.scope_plan) LOOP
  INSERT INTO smarter_private.weekly_payout_financial_receipts(scope_kind,scope_id,period_start,period_end,run_id,original_round_receipts)
  SELECT item->>'kind',(item->>'id')::uuid,r.period_start,r.period_end,r.run_id,
   (SELECT jsonb_agg(jsonb_build_object('scope',item,'round',x.round_no,'receipt',x.receipt) ORDER BY x.round_no) FROM smarter_private.weekly_payout_round_receipts x
     WHERE x.run_id=r.run_id AND x.scope_kind=item->>'kind' AND x.scope_id=(item->>'id')::uuid)
  WHERE NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_financial_receipts f WHERE f.scope_kind=item->>'kind' AND f.scope_id=(item->>'id')::uuid AND f.period_end=r.period_end);
 END LOOP;
 -- Credit lines: what an agent owes is its credit line minus the chips in its agent wallet after rakeback.
 UPDATE public.credit_invoices ci SET debt_owed=round(a.credit_limit-a.agent_wallet_balance,2),amount_remaining=round(a.credit_limit-a.agent_wallet_balance,2)
 FROM public.agents a WHERE a.id=ci.agent_id AND ci.period_end=r.period_end AND ci.status='pending' AND ci.amount_paid=0 AND a.credit_limit-a.agent_wallet_balance>0;
 UPDATE public.credit_invoices ci SET status='void',void_reason='Agent wallet covers the credit line after weekly rakeback',debt_owed=0,amount_remaining=0
 FROM public.agents a WHERE a.id=ci.agent_id AND ci.period_end=r.period_end AND ci.status='pending' AND ci.amount_paid=0 AND a.credit_limit-a.agent_wallet_balance<=0;
 -- Rakeback Received: every player, agent and club owner that was paid.
 WITH players AS (SELECT pp.user_id,pp.club_id,round(sum(pp.payout_amount),2) amt FROM public.rakeback_periods rp JOIN public.rakeback_period_payouts pp ON pp.rakeback_period_id=rp.id
   WHERE rp.period_start=d_from AND pp.payout_amount>0 AND pp.paid_at>=r.money_starts_at GROUP BY 1,2),
 agents AS (SELECT a.user_id,a.club_id,round(sum(a.amount),2) amt FROM public.agent_commission_settlements a WHERE a.period_start=r.period_start GROUP BY 1,2 HAVING sum(a.amount)>0),
 owners AS (SELECT c.owner_id user_id,c.id club_id,si.gross_amount amt FROM public.settlement_invoices si JOIN public.clubs c ON c.id::text=si.to_entity_id::text
   WHERE si.invoice_type='union_to_club' AND si.created_at>=r.money_starts_at AND si.gross_amount>0),
 allrows AS (SELECT user_id,club_id,amt,'player' k FROM players UNION ALL SELECT user_id,club_id,amt,'agent' FROM agents UNION ALL SELECT user_id,club_id,amt,'club' FROM owners)
 INSERT INTO public.notifications(user_id,type,title,message,data,link)
 SELECT x.user_id,'rakeback_received',
  CASE x.k WHEN 'player' THEN 'Weekly Rakeback Received' WHEN 'agent' THEN 'Weekly Agent Rakeback Received' ELSE 'Weekly Club Rakeback Received' END,
  CASE x.k WHEN 'player' THEN 'Your weekly rakeback of '||to_char(x.amt,'FM999,999,990.00')||' chips from '||c.name||' ('||label||') was added to your wallet.'
   WHEN 'agent' THEN 'Your weekly agent rakeback of '||to_char(x.amt,'FM999,999,990.00')||' chips from '||c.name||' ('||label||') was added to your agent wallet.'
   ELSE c.name||' received its weekly rakeback of '||to_char(x.amt,'FM999,999,990.00')||' chips from the union ('||label||') in the club bank.' END,
  jsonb_build_object('club_id',x.club_id,'amount',x.amt,'kind',x.k,'period_start',d_from::text,'run_id',r.run_id),'/club/'||x.club_id
 FROM allrows x JOIN public.clubs c ON c.id=x.club_id
 WHERE x.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.user_id=x.user_id AND n.type='rakeback_received' AND n.data->>'club_id'=x.club_id::text AND n.data->>'kind'=x.k AND n.data->>'period_start'=d_from::text);
 GET DIAGNOSTICS notes=ROW_COUNT;
 SELECT jsonb_build_object('rounds',(SELECT jsonb_agg(jsonb_build_object('scope_kind',x.scope_kind,'scope_id',x.scope_id,'round',x.round_no,
   'amount',COALESCE((x.receipt->>'amount')::numeric,(x.receipt->>'total_rakeback')::numeric,0),'payees',COALESCE((x.receipt->>'payees')::int,(x.receipt->>'clubs_paid')::int,0),'funding',x.funding) ORDER BY x.round_no,x.scope_kind)
   FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id),'notifications',notes) INTO summary;
 UPDATE public.weekly_accounting_payout_pauses SET phase='released',result=jsonb_build_object('success',true,'paid',true,'stage','weekly_payout_financial_complete','run_id',r.run_id,
  'attempt_no',r.attempt_no,'financial_finished_at',clock_timestamp(),'books_complete',false,'round_runner',true)||summary WHERE run_id=r.run_id;
 SELECT * INTO cfg FROM smarter_private.weekly_payout_rounds_config WHERE singleton;
 IF cfg.report_user_id IS NOT NULL THEN
  INSERT INTO public.notifications(user_id,type,title,message,data,link)
  VALUES(cfg.report_user_id,'weekly_payout_report','Weekly Rakeback Completed',
   'Weekly rakeback for '||label||' is paid: clubs '||to_char(COALESCE((SELECT sum((x.receipt->>'total_rakeback')::numeric) FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.round_no=1),0),'FM999,999,990.00')
   ||', agents '||to_char(COALESCE((SELECT sum((x.receipt->>'amount')::numeric) FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.round_no=2),0),'FM999,999,990.00')
   ||', players '||to_char(COALESCE((SELECT sum((x.receipt->>'amount')::numeric) FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.round_no=3),0),'FM999,999,990.00')||'.',
   summary||jsonb_build_object('run_id',r.run_id,'period_start',d_from::text),'/hub');
 END IF;
 RETURN jsonb_build_object('stage','weekly_payout_finalized','run_id',r.run_id)||summary;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_finalize(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_due()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE n timestamptz:=smarter_private.weekly_payout_clock();e timestamptz:=public.fn_union_week_start(n);
 c timestamptz;r public.weekly_accounting_payout_pauses%ROWTYPE;answer jsonb;lost jsonb;
BEGIN
 SELECT cutover_period_end INTO STRICT c FROM smarter_private.weekly_payout_phase_configuration WHERE singleton;
 IF e<c THEN RETURN NULL;END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('union-accounting-scheduler',0)) THEN
  RETURN jsonb_build_object('success',false,'owns_tick',true,'advanced',false,'stage','weekly_payout_original_scheduler_owned');END IF;
 -- EVERY PREPARED SCOPE IS PAID; THE REST CATCH UP (20261031190020): the
 -- newest owned boundary of this closed week. Released (paid, refused or
 -- missed) means the next slot is prepared for whatever this week still owes;
 -- with nothing owed, or every slot spent, the original post-money scope owner
 -- continues P&L/docs and reads the original financial receipts, never paying
 -- them again.
 SELECT * INTO r FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e ORDER BY p.attempt_no DESC LIMIT 1;
 -- ROUND RUNNER OWNS THE MONEY (owner, 2026-11-02): a database-only runner
 -- boundary is paid round by round by weekly_payout_next_round, never here.
 IF FOUND AND r.instance_id IS NOT DISTINCT FROM 'weekly-payout-rounds' AND r.phase<>'released' THEN
  RETURN jsonb_build_object('success',true,'owns_tick',true,'advanced',false,'stage','weekly_payout_rounds_running','run_id',r.run_id);END IF;
 IF NOT FOUND OR r.phase='released' THEN RETURN smarter_private.weekly_payout_prepare_due();END IF;
 IF n<r.money_starts_at THEN
  RETURN jsonb_build_object('success',false,'owns_tick',true,'advanced',false,'stage','weekly_payout_prepared',
   'run_id',r.run_id,'attempt_no',r.attempt_no,'scheduled_for',r.money_starts_at);
 END IF;
 BEGIN
  answer:=smarter_private.weekly_payout_execute(r.run_id);
 EXCEPTION WHEN OTHERS THEN
  -- This subtransaction rolled back every financial pass, context capability
  -- and receipt together. A network-unknown outcome is read from this SAME
  -- durable run; this handler never starts another payer or extends the pause.
  -- The scopes it owned stay owed and are prepared for the next owned slot.
  answer:=jsonb_build_object('success',false,'owns_tick',true,'advanced',false,'stage','weekly_payout_financial_refused',
   'run_id',r.run_id,'attempt_no',r.attempt_no,'sqlstate',SQLSTATE,'reason',SQLERRM,'paid',false,'scheduled_for',r.money_starts_at,'observed_at',smarter_private.weekly_payout_clock());
  -- MEASURED MONEY ADMISSION (20261031223940): an acknowledged slot whose own
  -- money statement was lost (read from the scheduler's durable run record,
  -- outside the rolled-back statement) is marked so that every later slot of
  -- this week owns one scope; a lost SOLO statement records that scope's loss.
  IF r.acknowledged_at IS NOT NULL THEN
   lost:=smarter_private.weekly_payout_lost_money_run(r.money_starts_at,r.money_deadline_at);
  END IF;
  IF lost IS NOT NULL THEN
   answer:=answer||jsonb_build_object('money_lost',true,'money_lost_run',lost);
   IF jsonb_array_length(r.scope_plan)=1 THEN
    INSERT INTO smarter_private.weekly_payout_money_losses(period_end,scope_kind,scope_id,run_id,attempt_no,evidence)
    VALUES(r.period_end,r.scope_plan->0->>'kind',(r.scope_plan->0->>'id')::uuid,r.run_id,r.attempt_no,lost)ON CONFLICT DO NOTHING;
   END IF;
  END IF;
  UPDATE public.weekly_accounting_payout_pauses SET phase='released',result=answer WHERE run_id=r.run_id;
 END;
 -- PRODUCTION ALERTS (20261031210000): a refused slot or a deferred scope is
 -- recorded once per boundary for Production Alerts; it never pages and never
 -- changes the payout outcome. The owed scopes are prepared for the next slot.
 IF answer->>'stage'='weekly_payout_financial_refused' OR jsonb_array_length(COALESCE(answer->'deferred_scopes','[]'::jsonb))>0 THEN
  BEGIN
   PERFORM public.fn_record_operational_alert('weekly-payout',
    CASE WHEN answer->>'stage'='weekly_payout_financial_refused' THEN 'refused:' ELSE 'deferred:' END||r.run_id::text,
    CASE WHEN answer->>'stage'='weekly_payout_financial_refused' THEN 'WeeklyPayoutSlotRefused' ELSE 'WeeklyPayoutScopeDeferred' END,
    'firing','warning',jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','period_start',r.period_start,'period_end',r.period_end,'attempt_no',r.attempt_no,
     'scheduled_for',r.money_starts_at,'reason',answer->>'reason','deferred_scopes',COALESCE(answer->'deferred_scopes','[]'::jsonb),
     'next','owed scopes are prepared for the next owned hourly slot'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
 END IF;
 RETURN answer;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_due() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_prepare_due()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE n timestamptz:=smarter_private.weekly_payout_clock();e timestamptz:=public.fn_union_week_start(n);
 due timestamptz:=public.fn_union_accounting_run_at(e);cutover timestamptz;plan jsonb;item jsonb;preparation jsonb;
 problems jsonb:='[]'::jsonb;ready jsonb:='[]'::jsonb;had_windows boolean;began timestamptz:=clock_timestamp();work_deadline timestamptz;saved_preparation_deadline text;r public.weekly_accounting_payout_pauses%ROWTYPE;
 latest public.weekly_accounting_payout_pauses%ROWTYPE;attempt integer:=1;slot timestamptz;final_call boolean;remaining integer;share interval;scope_deadline timestamptz;
 too_large jsonb:='[]'::jsonb;solo boolean:=false;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 SELECT cutover_period_end INTO STRICT cutover FROM smarter_private.weekly_payout_phase_configuration WHERE singleton;
 IF e<cutover OR n<e THEN RETURN NULL;END IF;
 IF COALESCE(current_setting('app.weekly_accounting_chunked',true),'')<>'on'
  OR current_setting('statement_timeout')::interval IS DISTINCT FROM interval '240 seconds'
 THEN RAISE EXCEPTION 'weekly_payout_original_bounded_tick_required' USING ERRCODE='55000';END IF;
 -- EVERY PREPARED SCOPE IS PAID; THE REST CATCH UP (20261031190020). The newest
 -- owned boundary of this closed week decides the next slot: the original 04:00
 -- slot, then one owned slot per hour for scopes an earlier slot did not pay.
 -- A boundary that is not released waits for its own slot and is never
 -- re-prepared here; weekly_payout_due executes it at its own money start.
 SELECT * INTO latest FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e ORDER BY p.attempt_no DESC LIMIT 1;
 IF FOUND THEN
  IF latest.phase<>'released' THEN
   RETURN jsonb_build_object('success',false,'owns_tick',true,'advanced',false,'stage','weekly_payout_prepared',
    'run_id',latest.run_id,'attempt_no',latest.attempt_no,'scheduled_for',latest.money_starts_at);
  END IF;
  attempt:=latest.attempt_no+1;
 END IF;
 slot:=due+make_interval(hours=>attempt-1);
 -- A slot needs its two-minute last-hand notice plus one more tick ahead of it.
 WHILE n>slot-interval '3 minutes' LOOP attempt:=attempt+1;slot:=due+make_interval(hours=>attempt-1);END LOOP;
 -- A WHOLE DAY OF CATCH-UP SLOTS (20261102): 24 owned hourly slots, not 8.
 -- More slots only retry scopes still owed; a paid scope is never owed again.
 IF attempt>24 THEN
  -- PRODUCTION ALERTS (20261031210000): every owned slot of this week is spent
  -- while the week still owes scopes. Recorded, never paged; no payer starts.
  IF jsonb_array_length(smarter_private.weekly_payout_scope_plan(e,n))>0 THEN
   BEGIN
    PERFORM public.fn_record_operational_alert('weekly-payout','unpaid-after-last-slot:'||e::text,'WeeklyPayoutUnpaidAfterLastSlot','firing','critical',
     jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','period_end',e,'owed',smarter_private.weekly_payout_scope_plan(e,n),'observed_at',n));
   EXCEPTION WHEN OTHERS THEN NULL;
   END;
  END IF;
  RETURN NULL;
 END IF;
 plan:=smarter_private.weekly_payout_scope_plan(e,n);
 IF jsonb_array_length(plan)=0 THEN RETURN NULL;END IF;
 -- MEASURED MONEY ADMISSION (20261031223940): an owned slot pays all of its
 -- scopes inside ONE bounded 240-second money statement. Admission is by what
 -- this week's own money statements measured, never by size: (a) after a slot
 -- whose money statement was lost (its cron run started inside the money
 -- window and did not succeed: timeout, crash or restart), every later slot of
 -- this week owns ONE scope, standalone clubs first, so a scope whose money
 -- does not fit can never hold another unpaid; (b) a scope whose OWN solo
 -- money statement was lost this week gets no further slot and is recorded
 -- once for Production Alerts (never paged). It stays owed; nothing is paid
 -- twice: every lost statement rolled back whole, receipts are exactly-once.
 SELECT COALESCE(jsonb_agg(x.value),'[]'::jsonb) INTO too_large FROM jsonb_array_elements(plan) x
  WHERE EXISTS(SELECT FROM smarter_private.weekly_payout_money_losses l WHERE l.period_end=e
   AND l.scope_kind=x.value->>'kind' AND l.scope_id=(x.value->>'id')::uuid);
 IF jsonb_array_length(too_large)>0 THEN
  BEGIN
   PERFORM public.fn_record_operational_alert('weekly-payout','money-statement-lost:'||e::text,'WeeklyPayoutScopeMoneyStatementLost','firing','critical',
    jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','period_end',e,'scopes',too_large,
     'losses',(SELECT jsonb_agg(to_jsonb(l)) FROM smarter_private.weekly_payout_money_losses l WHERE l.period_end=e),'observed_at',n));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.o),'[]'::jsonb) INTO plan FROM jsonb_array_elements(plan) WITH ORDINALITY x(j,o)
   WHERE NOT x.j IN (SELECT t.value FROM jsonb_array_elements(too_large) t);
  IF jsonb_array_length(plan)=0 THEN RETURN NULL;END IF;
 END IF;
 solo:=EXISTS(SELECT FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e AND p.phase='released' AND p.result->>'money_lost'='true');
 -- The last preparation ticks before a slot own it with the scopes that are
 -- ready; a scope still preparing is deferred to the next slot, never allowed
 -- to keep every other scope unpaid.
 final_call:=n>=slot-interval '10 minutes';
 remaining:=jsonb_array_length(plan);
 -- Standalone club books before union books, each with a fair share of this
 -- tick, so one large union cannot spend the whole tick of every scope.
 FOR item IN SELECT j FROM jsonb_array_elements(plan) WITH ORDINALITY x(j,o) ORDER BY (j->>'kind'='union'),o LOOP
  IF clock_timestamp()-began>interval '150 seconds' THEN
   problems:=problems||jsonb_build_array(jsonb_build_object('reason','preparation_budget','scope',item));
   remaining:=remaining-1;CONTINUE;
  END IF;
  PERFORM public.fn_weekly_accounting_attempt_begin(item->>'kind'='union');
  share:=GREATEST(interval '30 seconds',((began+interval '150 seconds')-clock_timestamp())/GREATEST(remaining,1));
  scope_deadline:=LEAST(NULLIF(current_setting('app.weekly_accounting_scope_deadline',true),'')::timestamptz,clock_timestamp()+share);
  PERFORM set_config('app.weekly_accounting_scope_deadline',scope_deadline::text,true);
  -- The original window provers stop at deadline-budget+120s (and never past
  -- the statement's own start+timeout-60s): this scope's budget is its share.
  PERFORM set_config('app.weekly_accounting_scope_budget',share::text,true);
  BEGIN
   -- Continue only this original R0 transition while its immutable source
   -- reviews prove positive progress. No other failure/result is retried.
   work_deadline:=LEAST(scope_deadline,slot-interval '3 minutes');
   saved_preparation_deadline:=current_setting('app.weekly_accounting_preparation_deadline',true);
   PERFORM set_config('app.weekly_accounting_preparation_deadline',work_deadline::text,true);
   LOOP
   preparation:=public.fn_prepare_accounting_week(CASE WHEN item->>'kind'='union' THEN (item->>'id')::uuid END,
    CASE WHEN item->>'kind'='club' THEN (item->>'id')::uuid END,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz);
    EXIT WHEN NOT(coalesce(jsonb_array_length(preparation->'problems'),0)=1
      AND preparation#>>'{problems,0,reason}'='own_agent_source_interpretation_in_progress'
      AND coalesce((preparation#>>'{problems,0,source_check,reviewed}')::int,0)>0);
    EXIT WHEN preparation#>>'{problems,0,source_check,budget_exhausted}'='true'OR clock_timestamp()>=work_deadline;
   END LOOP;
   PERFORM set_config('app.weekly_accounting_preparation_deadline',coalesce(saved_preparation_deadline,''),true);
   had_windows:=false;
   IF preparation->>'success'='true' THEN
    had_windows:=public.fn_accounting_close_windows_pending(CASE WHEN item->>'kind'='union' THEN (item->>'id')::uuid END,
     CASE WHEN item->>'kind'='club' THEN (item->>'id')::uuid END,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz);
   END IF;
   IF preparation->>'success' IS DISTINCT FROM 'true' OR had_windows THEN
    problems:=problems||jsonb_build_array(jsonb_build_object('scope',item,'preparation',preparation,'windows_pending',had_windows));
   ELSE
    ready:=ready||jsonb_build_array(item);
   END IF;
  EXCEPTION WHEN OTHERS THEN
   PERFORM set_config('app.weekly_accounting_preparation_deadline',coalesce(saved_preparation_deadline,''),true);
   problems:=problems||jsonb_build_array(jsonb_build_object('scope',item,'error',SQLERRM,'sqlstate',SQLSTATE));
  END;
  PERFORM public.fn_weekly_accounting_attempt_end();
  remaining:=remaining-1;
 END LOOP;
 -- After a lost money statement this week, one ready scope owns the slot.
 IF solo AND jsonb_array_length(ready)>1 THEN
  problems:=problems||COALESCE((SELECT jsonb_agg(jsonb_build_object('scope',x.j,'reason','one_scope_per_slot_after_lost_money_statement') ORDER BY (x.j->>'kind'='union'),x.o)
   FROM jsonb_array_elements(plan) WITH ORDINALITY x(j,o) WHERE x.j IN (SELECT value FROM jsonb_array_elements(ready))
    AND x.j IS DISTINCT FROM (SELECT y.j FROM jsonb_array_elements(plan) WITH ORDINALITY y(j,o) WHERE y.j IN (SELECT value FROM jsonb_array_elements(ready)) ORDER BY (y.j->>'kind'='union'),y.o LIMIT 1)),'[]'::jsonb);
  SELECT jsonb_build_array(y.j) INTO ready FROM jsonb_array_elements(plan) WITH ORDINALITY y(j,o)
   WHERE y.j IN (SELECT value FROM jsonb_array_elements(ready)) ORDER BY (y.j->>'kind'='union'),y.o LIMIT 1;
 END IF;
 IF jsonb_array_length(problems)>0 AND NOT((final_call OR solo) AND jsonb_array_length(ready)>0) THEN
  RETURN jsonb_build_object('success',false,'owns_tick',true,'advanced',true,'stage','weekly_payout_preparing',
   'attempt_no',attempt,'scheduled_for',slot,'ready_scopes',jsonb_array_length(ready),'problems',problems);
 END IF;
 -- ROUND RUNNER BOOKS ITS OWN BOUNDARY (owner, 2026-11-02): preparation is
 -- complete here; weekly_payout_next_round pays it round by round.
 IF EXISTS(SELECT FROM smarter_private.weekly_payout_rounds_config c WHERE c.singleton AND c.enabled) THEN
  RETURN jsonb_build_object('success',true,'owns_tick',true,'advanced',false,'stage','weekly_payout_ready_for_rounds','ready_scopes',ready,'problems',problems);
 END IF;
 -- The boundary keeps the original plan order of the scopes it pays.
 SELECT jsonb_agg(j ORDER BY o) INTO ready FROM jsonb_array_elements(plan) WITH ORDINALITY x(j,o) WHERE j IN (SELECT value FROM jsonb_array_elements(ready));
 INSERT INTO public.weekly_accounting_payout_pauses(period_start,period_end,attempt_no,announced_at,money_starts_at,money_deadline_at,expires_at,scope_plan)
 VALUES(public.fn_union_prev_week_start(e),e,attempt,slot-interval '2 minutes',slot,slot+interval '240 seconds',slot+interval '5 minutes',ready)
 ON CONFLICT(period_start,period_end,attempt_no)DO NOTHING;
 SELECT * INTO STRICT r FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e AND p.attempt_no=attempt;
 IF r.scope_plan IS DISTINCT FROM ready THEN RAISE EXCEPTION 'weekly_payout_prepared_scope_changed' USING ERRCODE='55000';END IF;
 IF jsonb_array_length(problems)>0 THEN
  BEGIN
   PERFORM public.fn_record_operational_alert('weekly-payout','deferred-at-preparation:'||r.run_id::text,'WeeklyPayoutScopeDeferred','firing','warning',
    jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','period_start',r.period_start,'period_end',r.period_end,'attempt_no',attempt,'scheduled_for',slot,'deferred_scopes',problems,
     'next','still-preparing scopes are prepared for the next owned hourly slot'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
 END IF;
 RETURN jsonb_build_object('success',false,'owns_tick',true,'advanced',true,'stage','weekly_payout_prepared','run_id',r.run_id,
  'attempt_no',attempt,'scheduled_for',slot,'deferred_scopes',problems);
END $function$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_prepare_due() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_weekly_accounting_payout_pause_state(p_run_id uuid DEFAULT NULL::uuid, p_ownership_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.weekly_accounting_payout_pauses%ROWTYPE;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 IF (p_run_id IS NULL) IS DISTINCT FROM(p_ownership_token IS NULL) THEN
  RAISE EXCEPTION 'weekly_payout_exact_owner_required' USING ERRCODE='22023';END IF;
 IF p_run_id IS NULL THEN
  SELECT * INTO r FROM public.weekly_accounting_payout_pauses p
   -- R0/boot discovers this closed week's precomputed boundary before the
   -- announcement. The engine owns its finite deferred edge timers; it must
   -- not depend on an unrelated maintenance announcement to discover it.
   WHERE p.period_end=public.fn_union_week_start(smarter_private.weekly_payout_clock())
    AND p.expires_at>smarter_private.weekly_payout_clock() AND p.phase<>'released'
    AND p.instance_id IS DISTINCT FROM 'weekly-payout-rounds'
   ORDER BY p.money_starts_at DESC LIMIT 1;
 ELSE
  SELECT * INTO r FROM public.weekly_accounting_payout_pauses p
   WHERE p.run_id=p_run_id AND p.ownership_token=p_ownership_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'weekly_payout_exact_owner_unknown' USING ERRCODE='55000';END IF;
 END IF;
 RETURN smarter_private.weekly_payout_pause_json(r);
END $function$;
REVOKE ALL ON FUNCTION public.fn_weekly_accounting_payout_pause_state(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_weekly_accounting_payout_pause_state(uuid,uuid) TO service_role;

-- READINESS AT HALF PAST THREE, ROUND RUNNER EDITION: ready means every owed
-- scope's own-agent windows are clean, its clubs' calculations are complete and
-- its round 2/3 windows are proved; otherwise a Production Alert names what is missing.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_readiness_check()
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $f$
DECLARE n timestamptz:=clock_timestamp(); e timestamptz:=public.fn_union_week_start(clock_timestamp()); due timestamptz; plan jsonb; missing jsonb; nw int; ok boolean;
BEGIN
 due:=public.fn_union_accounting_run_at(e);
 IF n<due-interval '30 minutes' OR n>=due-interval '25 minutes' THEN RETURN NULL; END IF;
 plan:=smarter_private.weekly_payout_scope_plan(e,n);
 IF plan IS NULL OR jsonb_array_length(plan)=0 THEN RETURN NULL; END IF;
 SELECT count(*) INTO nw FROM public.fn_accounting_close_windows(public.fn_union_prev_week_start(e),e);
 SELECT jsonb_agg(jsonb_build_object('scope',x,
   'own_agent_windows_clean',(SELECT count(*) FROM smarter_private.own_agent_clean_windows k WHERE k.scope_kind=x->>'kind' AND k.scope_id=(x->>'id')::uuid AND k.period_end=e),
   'round2_windows',(SELECT count(*) FROM public.accounting_close_partials p WHERE p.kind='round2_'||(x->>'kind')||'_window' AND p.union_id=(x->>'id')::uuid AND p.period_end=e AND p.computed_at>=e),
   'round3_windows',(SELECT count(*) FROM public.accounting_close_partials p WHERE p.kind='round3_'||(x->>'kind')||'_window' AND p.union_id=(x->>'id')::uuid AND p.period_end=e AND p.computed_at>=e),
   'calculations_not_complete',(SELECT count(*) FROM public.fn_accounting_week_clubs(CASE WHEN x->>'kind'='union' THEN (x->>'id')::uuid END,CASE WHEN x->>'kind'='club' THEN (x->>'id')::uuid END,(x->>'period_start')::timestamptz,(x->>'period_end')::timestamptz) c
     WHERE NOT EXISTS(SELECT 1 FROM public.accounting_period_recompute_requests q WHERE q.club_id=c.club_id AND q.period_start=((x->>'period_start')::timestamptz AT TIME ZONE 'America/Los_Angeles')::date AND q.status='complete' AND q.attempted_at>=e))))
 INTO missing FROM jsonb_array_elements(plan) x;
 SELECT bool_and((m->>'own_agent_windows_clean')::int>=nw AND (m->>'round2_windows')::int>=nw AND (m->>'round3_windows')::int>=nw AND (m->>'calculations_not_complete')::int=0) INTO ok FROM jsonb_array_elements(missing) m;
 IF ok THEN RETURN jsonb_build_object('ready',true,'scopes',missing); END IF;
 BEGIN
  PERFORM public.fn_record_operational_alert('weekly-payout','not-ready-at-0330:'||e::text,'WeeklyPayoutNotReadyHalfHourBefore','firing','critical',
   jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','period_end',e,'due',due,'windows',nw,'scopes',missing,'observed_at',n));
 EXCEPTION WHEN OTHERS THEN NULL;
 END;
 RETURN jsonb_build_object('ready',false,'windows',nw,'scopes',missing);
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_readiness_check() FROM PUBLIC, anon, authenticated, service_role;

DO $cron$ DECLARE j record; BEGIN
 FOR j IN SELECT jobid FROM cron.job WHERE jobname='weekly-payout-rounds' LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
 PERFORM cron.schedule('weekly-payout-rounds','* * * * *',
  $c$SELECT set_config('statement_timeout','1500s',false),set_config('lock_timeout','30s',false); SELECT smarter_private.weekly_payout_next_round();$c$);
END $cron$;
COMMIT;
