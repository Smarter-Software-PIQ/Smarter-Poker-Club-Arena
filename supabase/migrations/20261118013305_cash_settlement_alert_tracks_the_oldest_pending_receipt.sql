-- The existing alert kept reporting the first two hands after the live queue grew to thousands.
-- The accepted envelope's pending_addons object identifies cash, including Lightning.
-- Older and other modes retain the established ten-minute threshold.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_post_commit_stranded_watchdog()'::regprocedure))='03e6c9ebf4d1f86b58e90f923cbe5fc8' AND NOT has_function_privilege('authenticated','public.fn_post_commit_stranded_watchdog()','EXECUTE') AND NOT has_function_privilege('anon','public.fn_post_commit_stranded_watchdog()','EXECUTE') AND has_function_privilege('service_role','public.fn_post_commit_stranded_watchdog()','EXECUTE') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname='post-commit-stranded-watchdog-5m' AND active AND schedule='* * * * *' AND command='select public.fn_post_commit_stranded_watchdog()'))
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $precondition$
BEGIN
  IF md5(pg_get_functiondef('public.fn_post_commit_stranded_watchdog()'::regprocedure)) <> 'a459b8438ac006de92495a8325220ed5'
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='post-commit-stranded-watchdog-5m' AND active
                     AND schedule='*/5 * * * *' AND command='select public.fn_post_commit_stranded_watchdog()') THEN
    RAISE EXCEPTION 'Existing receipt alert or schedule differs from its qualified definition';
  END IF;
END
$precondition$;

CREATE OR REPLACE FUNCTION public.fn_post_commit_stranded_watchdog()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s' AS $watch$
DECLARE
  alert_source CONSTANT text := 'fn_post_commit_stranded_watchdog';
  finding CONSTANT text := 'accepted_hand_receipt_overdue';
  facts jsonb;
  active_alert public.financial_alerts.id%TYPE;
BEGIN
  -- The cron owner and a concurrent operator read must share one alert lifecycle.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca:post_commit_stranded_watchdog:v1',0)) THEN
    RETURN jsonb_build_object('observing', true);
  END IF;
  WITH aged AS MATERIALIZED (
    SELECT hand_id, table_id, hand_number, committed_at,
           coalesce(jsonb_typeof(post_commit_payload->'pending_addons')='object',false) AS cash
    FROM public.hand_atomic_commits
    WHERE post_commit_payload IS NOT NULL AND post_commit_completed_at IS NULL
      AND committed_at < statement_timestamp() - interval '20 seconds'
  ), overdue AS MATERIALIZED (
    SELECT hand_id, table_id, hand_number, committed_at,
           row_number() OVER (ORDER BY committed_at, hand_id) AS seq
    FROM aged WHERE cash OR committed_at < statement_timestamp() - interval '10 minutes'
  )
  SELECT jsonb_build_object('finding', finding, 'stranded', count(*),
           'oldest', min(committed_at), 'oldest_cash', (
             SELECT jsonb_build_object('hand_id', c.hand_id, 'table_id', c.table_id, 'hand_number', c.hand_number,
                     'committed_at', c.committed_at, 'mode', CASE WHEN EXISTS (
                       SELECT 1 FROM public.lightning_hand l WHERE l.hand_history_id=c.hand_id
                     ) THEN 'lightning' ELSE 'cash' END)
             FROM (SELECT * FROM aged WHERE cash ORDER BY committed_at, hand_id LIMIT 1) c
           ), 'sample', coalesce(jsonb_agg(
             jsonb_build_object('hand_id',hand_id,'table_id',table_id,'hand_number',hand_number,
                                'committed_at',committed_at) ORDER BY seq) FILTER (WHERE seq <= 10), '[]'::jsonb))
    INTO facts FROM overdue;
  IF (facts->>'stranded')::bigint > 0 THEN
    SELECT id INTO active_alert FROM public.financial_alerts
     WHERE source=alert_source AND NOT resolved
       AND (context->>'finding'=finding OR (NOT context ? 'finding' AND context ?& ARRAY['stranded','oldest','sample']))
     ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.financial_alerts
         SET context=context||facts,
             message='Accepted hands are waiting for their final financial receipt. The oldest overdue hand and current count are in the alert details.'
       WHERE id=active_alert AND context IS DISTINCT FROM (context||facts);
    ELSE
      INSERT INTO public.financial_alerts(severity,source,message,context) VALUES ('critical',alert_source,
        'Accepted hands are waiting for their final financial receipt. The oldest overdue hand and current count are in the alert details.',facts);
    END IF;
  ELSE
    UPDATE public.financial_alerts SET resolved=true, resolved_at=statement_timestamp(),
           resolution='All accepted hand receipts are within their applicable age threshold.'
     WHERE source=alert_source AND NOT resolved
       AND (context->>'finding'=finding OR (NOT context ? 'finding' AND context ?& ARRAY['stranded','oldest','sample']));
  END IF;
  RETURN facts;
END
$watch$;
REVOKE ALL ON FUNCTION public.fn_post_commit_stranded_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_post_commit_stranded_watchdog() TO service_role;

SELECT cron.alter_job(jobid, schedule => '* * * * *') FROM cron.job WHERE jobname='post-commit-stranded-watchdog-5m';
COMMIT;
