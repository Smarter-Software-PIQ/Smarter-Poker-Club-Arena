-- Weekly rounds previously bypassed maintenance admission: their private money
-- capability is intentionally exempt from ordinary money freeze triggers and
-- their bookkeeping row is intentionally absent from the gameplay pause reader.
-- Serialize original round transactions with the existing530090/1 maintenance
-- writer. Recheck freeze after admission and preserve the next daily notice's
-- headroom using the current statement timeout and canonical daily policy.
-- No scheduler, payout identity, receipt, gameplay pause or schedule is changed.
-- A round already admitted can delay an unexpected writer by its finite existing
-- statement budget; this is mutual exclusion, not a zero-delay guarantee.
-- @live-proof: md5(pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure))='332b762a004a779e32dc3fd2d1aef60d' AND NOT has_function_privilege('service_role','smarter_private.weekly_payout_next_round()','EXECUTE')
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure)) IS DISTINCT FROM '86c572334023dd7a9231704cfc14868a' THEN
  RAISE EXCEPTION 'weekly_round_maintenance_preimage_changed';
 END IF;
END $guard$;
-- native:begin
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_next_round()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE n timestamptz:=clock_timestamp(); e timestamptz:=public.fn_union_week_start(clock_timestamp()); due timestamptz; plan jsonb; r public.weekly_accounting_payout_pauses%ROWTYPE;
 item jsonb; ready jsonb:='[]'::jsonb; prep jsonb; pending boolean; k text; id uuid; ws timestamptz; we timestamptz; rnd int; res jsonb; funding jsonb; d_from date; cfg smarter_private.weekly_payout_rounds_config%ROWTYPE;
 summary jsonb; att int; admission_at timestamptz; announcement timestamptz;
 budget interval; policy smarter_private.daily_window_policy%ROWTYPE;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO cfg FROM smarter_private.weekly_payout_rounds_config WHERE singleton;
 IF NOT FOUND OR NOT cfg.enabled THEN RETURN NULL; END IF;
 due:=public.fn_union_accounting_run_at(e);
 IF n<due OR n>=due+interval '24 hours' THEN RETURN NULL; END IF;
 -- Share the original entry/maintenance admission, before any financial lock.
 -- A busy maintenance writer is a definite deferral, never a queued money write.
 IF NOT pg_try_advisory_xact_lock_shared(530090,1) THEN
  RETURN jsonb_build_object('stage','maintenance_busy');
 END IF;
 IF public.fn_entry_purchases_frozen() IS DISTINCT FROM false OR public.fn_platform_frozen() IS DISTINCT FROM false THEN
  RETURN jsonb_build_object('stage','maintenance_frozen');
 END IF;
 -- Preserve the next published announcement's headroom using its maintained
 -- Chicago policy and this invocation's existing finite statement budget.
 admission_at:=clock_timestamp();
 budget:=current_setting('statement_timeout')::interval;
 IF budget<=interval '0' THEN RETURN jsonb_build_object('stage','maintenance_budget_unbounded'); END IF;
 SELECT * INTO STRICT policy FROM smarter_private.daily_window_policy WHERE singleton;
 announcement:=(((admission_at AT TIME ZONE policy.time_zone)::date+policy.last_hand) AT TIME ZONE policy.time_zone);
 IF announcement<=admission_at THEN
  announcement:=((((admission_at AT TIME ZONE policy.time_zone)::date+1)+policy.last_hand) AT TIME ZONE policy.time_zone);
 END IF;
 IF statement_timestamp()+budget<=admission_at OR statement_timestamp()+budget>=announcement THEN
  RETURN jsonb_build_object('stage','maintenance_headroom','announcement_at',announcement);
 END IF;
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

-- native:end
COMMIT;
