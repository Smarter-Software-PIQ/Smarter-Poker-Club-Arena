-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- WEEKLY PAYOUT CATCHES UP FOR A WHOLE DAY OF HOURLY SLOTS.
--
-- On 2026-11-02 the first automatic payout never prepared (own-agent
-- preparation timed out every tick; fixed in the previous migration). With
-- only 8 owned slots (04:00-11:00 Chicago) a scope whose preparation and
-- window proofs finish later in the day would be recorded as
-- WeeklyPayoutUnpaidAfterLastSlot and never paid automatically. The owned
-- slot cap rises from 8 to 24 hourly slots. Nothing else changes: each slot
-- still prepares only scopes the week still owes (weekly_payout_scope_plan),
-- a paid scope is never owed again, the engine pause/ACK, money deadline,
-- measured-loss admission and alerts are unchanged. The alert still fires
-- when all 24 slots are spent. Not generation-pinned; no function pins this
-- body's md5. The boundary table's attempt_no check (1..8) becomes 1..24.
-- No money moves by this migration.
-- @live-proof: (SELECT position('A WHOLE DAY OF CATCH-UP SLOTS (20261102)' IN pg_get_functiondef('smarter_private.weekly_payout_prepare_due()'::regprocedure))>0)
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_prepare_due()'::regprocedure))
    IS DISTINCT FROM '0981554b0498965a487348ac112f04c9' THEN RAISE EXCEPTION 'weekly_payout_prepare_preimage_changed'; END IF;
END
$guard$;

-- native:begin
-- The boundary table's own attempt check follows the cap (tiny table; the
-- swap holds its lock for milliseconds).
-- The job-272 tick reads this table for its whole attempt; wait briefly for
-- the gap between ticks, never long enough to stall a tick behind the swap.
SET LOCAL lock_timeout='8s';
ALTER TABLE public.weekly_accounting_payout_pauses DROP CONSTRAINT weekly_accounting_payout_pauses_attempt_no_check;
ALTER TABLE public.weekly_accounting_payout_pauses ADD CONSTRAINT weekly_accounting_payout_pauses_attempt_no_check CHECK (attempt_no >= 1 AND attempt_no <= 24);

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

REVOKE ALL ON FUNCTION smarter_private.weekly_payout_prepare_due() FROM PUBLIC, anon, authenticated, service_role;
-- native:end

DO $post$
BEGIN
 IF position('IF attempt>24 THEN' IN pg_get_functiondef('smarter_private.weekly_payout_prepare_due()'::regprocedure))=0
  OR position('IF attempt>8 THEN' IN pg_get_functiondef('smarter_private.weekly_payout_prepare_due()'::regprocedure))>0 THEN
  RAISE EXCEPTION 'weekly_payout_slot_cap_not_24'; END IF;
 IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='public.weekly_accounting_payout_pauses'::regclass AND conname='weekly_accounting_payout_pauses_attempt_no_check'))
    NOT LIKE '%attempt_no <= 24%' THEN RAISE EXCEPTION 'weekly_payout_attempt_check_not_24'; END IF;
 IF has_function_privilege('anon','smarter_private.weekly_payout_prepare_due()','EXECUTE')
  OR has_function_privilege('authenticated','smarter_private.weekly_payout_prepare_due()','EXECUTE') THEN
  RAISE EXCEPTION 'weekly_payout_prepare_reachable_without_account'; END IF;
END
$post$;
COMMIT;
