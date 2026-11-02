-- Weekly accounting admission precedes every original table-reading gate.
-- At 2026-11-02 04:00:00Z job272 started inside an already durable03:58:04.929
-- maintenance notice. Its long transaction blocked the04247 migration after
-- freeze04:00:04.929. Defer this tick before entering the original CASE.
-- Preserve its cadence/settings/innerCASE and all financial function bodies.
-- This admits against existing notice/freeze; it is not an atomic promise
-- against maintenance announced after this statement has already admitted.
-- @live-proof: (SELECT md5(command)='4df8089b30f347c530cfea484ed2439d' AND schedule='*/5 * * * *' AND active FROM cron.job WHERE jobid=272)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $migration$
DECLARE before_job cron.job%ROWTYPE; after_job cron.job%ROWTYPE; candidate text;
BEGIN
 SELECT * INTO STRICT before_job FROM cron.job WHERE jobid=272 FOR UPDATE;
 IF md5(before_job.command) IS DISTINCT FROM '47e33e30747b8c7ebcaabc24abc6f50c'
    OR before_job.schedule IS DISTINCT FROM '*/5 * * * *'
    OR before_job.active IS DISTINCT FROM true
    OR before_job.jobname IS DISTINCT FROM 'union-weekly-rakeback-close'
    OR before_job.database IS DISTINCT FROM 'postgres'
    OR before_job.username IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'weekly_accounting_maintenance_admission_preimage_changed' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.fn_entry_purchases_frozen()'::regprocedure)) IS DISTINCT FROM '0b05e2e7905caf71f14c8327a172cea0'
 OR md5(pg_get_functiondef('public.fn_platform_frozen()'::regprocedure)) IS DISTINCT FROM 'ec683805e052fceeae74789e82dce4cc'
 OR md5(pg_get_functiondef('public.fn_active_maintenance_release_boundary()'::regprocedure)) IS DISTINCT FROM '05b537b57c9f51a5164e20a1cd0e67e0'
 THEN RAISE EXCEPTION 'weekly_accounting_maintenance_admission_helpers_changed' USING ERRCODE='55000'; END IF;
 candidate := $command$SELECT set_config('statement_timeout','240s',false),set_config('app.weekly_accounting_attempt_budget','1',false),set_config('app.weekly_accounting_scope_budget','3 minutes',false),set_config('app.weekly_accounting_chunked','on',false); SELECT CASE WHEN public.fn_entry_purchases_frozen() IS FALSE AND public.fn_platform_frozen() IS FALSE THEN (CASE WHEN extract(minute FROM now()) BETWEEN 40 AND 44 OR (now() >= public.fn_union_accounting_run_at(public.fn_union_week_start(now())) AND now() < public.fn_union_accounting_run_at(public.fn_union_week_start(now())) + interval '40 minutes') OR EXISTS(SELECT 1 FROM public.union_accounting_runs q WHERE q.status='running' AND q.result->>'chunk_committed'='true') OR EXISTS(SELECT 1 FROM public.union_accounting_runs q WHERE q.status='failed' AND q.result->>'error'='weekly_scope_time_budget_exhausted' AND q.finished_at>now()-interval '3 hours') OR EXISTS(SELECT 1 FROM public.union_accounting_runs q WHERE q.status='failed' AND q.result->>'sqlstate' IN ('40P01','40001','55P03') AND q.finished_at>now()-interval '3 hours') OR public.fn_accounting_close_gate_lifted_unstarted() OR public.fn_union_pnl_inventory_seal_in_progress() OR public.fn_weekly_close_first_visits_pending() THEN public.fn_union_settlement_cascade_due() END) END;$command$;
 IF md5(candidate) IS DISTINCT FROM '4df8089b30f347c530cfea484ed2439d' THEN RAISE EXCEPTION 'weekly_accounting_maintenance_admission_candidate_changed'; END IF;
 PERFORM cron.alter_job(job_id:=272,command:=candidate);
 SELECT * INTO STRICT after_job FROM cron.job WHERE jobid=272;
 IF after_job.command IS DISTINCT FROM candidate
 OR (to_jsonb(before_job)-'command') IS DISTINCT FROM (to_jsonb(after_job)-'command')
 THEN RAISE EXCEPTION 'weekly_accounting_maintenance_admission_metadata_changed'; END IF;
END
$migration$;
COMMIT;
