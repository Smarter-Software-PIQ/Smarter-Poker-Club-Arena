-- 20261111224606_settled_accounting_and_lightning_alerts_close_on_evidence
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch.
--
-- SETTLED ACCOUNTING AND LIGHTNING ALERTS CLOSE ON EVIDENCE (2026-11-11).
--
-- Nineteen critical financial_alerts rows (2026-10-26 to 2026-11-02) stood
-- open after the conditions they name had ended, because nothing that owns
-- them can close them:
--   * weekly_club_accounting 'Weekly club accounting is incomplete': the
--     club-scope success path of fn_process_weekly_accounting_scope never
--     closes its own incomplete-week alert (the union path does, since
--     2026-10-17). That function is md5-pinned by
--     smarter_private.weekly_payout_eligible_scopes (payout eligibility), so
--     the close lives here, beside the nine evidence classes already in the
--     resolver, and not in the payout-pinned scheduler.
--   * union_accounting_scheduler 'A weekly inventory seal step did not fit
--     the bounded close tick' carries no scope, so no receipt was matched to it.
--   * lightning_alerts reaper_failure is a state page (a live instance past
--     its deadline) that fn_lightning_alert_sweep treats as an event page and
--     never re-measures; while it stays open fn_lightning_alert_raise answers
--     'open' for that Cluster, so the reaper monitor is blind there.
--   * drift_incident:financial_alerts:<source> echoes of those pages, whose
--     incidents were retired as aged_out_unverified, stay open forever.
--
-- MEASURED read-only on production 2026-11-11 ~22:40Z: club e14bc9f7 week
-- 2026-10-19..26 complete 2026-10-28 17:48:23Z (attempt 9); club 2a1132b9 week
-- 2026-10-26..11-02 complete 2026-11-03 12:15:29Z (attempt 183); union week
-- 2026-10-19..26 complete 2026-11-08 22:46:35Z and every union week ending in
-- the four weeks before 2026-10-26 11:35Z complete; all nine Lightning
-- Clusters paged at 2026-11-02 14:46-14:55Z re-measure with zero live
-- instances past deadline and no failed reap in the window.
--
-- smarter_private.financial_alerts_proven_over closes such a row only on a
-- completion receipt or a re-measurement, with a resolution that cites it,
-- and an echo only when its parent closed on evidence ('verified'/'Re-measured')
-- - never on silence, never an echo of an aged-out parent. The established
-- resolver fn_resolve_settled_financial_alerts (job ca-resolve-settled-alerts-20m)
-- calls it once per run; no new schedule or watcher, and nothing
-- but alert rows moves. Integrity-sweep review signals are not touched.
--
-- Native PG17: scripts/ci/test-financial-alerts-proven-over-postgres.py.
--
-- @live-proof: position('smarter_private.financial_alerts_proven_over(p_apply, p_limit)' in (SELECT p.prosrc FROM pg_proc p WHERE p.oid=to_regprocedure('public.fn_resolve_settled_financial_alerts(boolean,integer)')))>0 AND to_regprocedure('smarter_private.financial_alerts_proven_over(boolean,integer)') IS NOT NULL
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';

CREATE OR REPLACE FUNCTION smarter_private.financial_alerts_proven_over(p_apply boolean, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
-- SETTLED ACCOUNTING AND LIGHTNING ALERTS CLOSE ON EVIDENCE (2026-11-11).
-- Called by fn_resolve_settled_financial_alerts. Each alert closes only on a
-- receipt or a re-measurement that the condition it names is over:
--   (a) weekly_club_accounting 'Weekly club accounting is incomplete': the
--       same club and week is recorded complete in union_accounting_runs,
--       successfully, after the alert;
--   (b) union_accounting_scheduler 'A weekly inventory seal step did not fit
--       the bounded close tick' (it names no scope): every union week that
--       ended in the four weeks before the alert is recorded complete, and
--       the week that had just ended completed after the alert;
--   (c) lightning_alerts reaper_failure: re-measured now, the Cluster is not
--       frozen, holds no live instance past its deadline by more than its
--       alert window and recorded no failed reap within that window: the
--       sweep's own raise condition (fn_lightning_alert_sweep B4) is false;
--   (d) drift_incident:financial_alerts:<source> echoes: the alert the echo
--       repeats is resolved on evidence ('verified'/'Re-measured') or closes
--       in this call.
-- A malformed identity, an unfinished or failed week, a later failure or a
-- still-late instance leaves the alert open. Nothing but the alert row moves.
DECLARE
 v_now timestamptz := clock_timestamp(); v_found jsonb; v_ids uuid[] := '{}'; v_echo uuid[] := '{}'; v_n integer := 0; v_e integer := 0;
 c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
 c_ts constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}(:?[0-9]{2})?|Z)$';
BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'evidence',t.evidence) ORDER BY t.created_at,t.id),'[]') INTO v_found FROM (
 SELECT s.id,s.created_at,s.evidence FROM (
  SELECT a.id,a.created_at,CASE
   WHEN a.source='weekly_club_accounting' AND a.message='Weekly club accounting is incomplete'
    AND a.context->>'club_id' ~ c_uuid AND a.context->>'period_start' ~ c_ts AND a.context->>'period_end' ~ c_ts THEN (
    SELECT jsonb_build_object('kind','club_week_complete','club_id',r.scope_id,'period_start',r.period_start,
      'period_end',r.period_end,'finished_at',r.finished_at,'attempts',r.attempts)
     FROM public.union_accounting_runs r
     WHERE r.scope_kind='club' AND r.scope_id=(a.context->>'club_id')::uuid
      AND r.period_start=(a.context->>'period_start')::timestamptz AND r.period_end=(a.context->>'period_end')::timestamptz
      AND r.status='complete' AND r.result->>'success'='true' AND r.finished_at>a.created_at)
   WHEN a.source='union_accounting_scheduler' AND a.message='A weekly inventory seal step did not fit the bounded close tick'
    AND NOT EXISTS(SELECT 1 FROM public.union_accounting_runs x WHERE x.scope_kind='union' AND x.period_end<=a.created_at
     AND x.period_end>a.created_at-interval '28 days'
     AND (x.status IS DISTINCT FROM 'complete' OR x.result->>'success' IS DISTINCT FROM 'true')) THEN (
    SELECT jsonb_build_object('kind','union_weeks_complete','union_id',r.scope_id,'period_start',r.period_start,
      'period_end',r.period_end,'finished_at',r.finished_at,'attempts',r.attempts)
     FROM public.union_accounting_runs r
     WHERE r.scope_kind='union' AND r.period_end<=a.created_at AND r.period_end>a.created_at-interval '7 days'
      AND r.status='complete' AND r.result->>'success'='true' AND r.finished_at>a.created_at
     ORDER BY r.period_end DESC,r.finished_at DESC LIMIT 1)
   WHEN a.source='lightning_alerts' AND a.context->>'check'='reaper_failure' AND a.context->>'cluster_id' ~ c_uuid
    AND a.created_at<=v_now-interval '15 minutes' THEN (
    SELECT jsonb_build_object('kind','lightning_reaper_clear','cluster_id',cg.id,'remeasured_at',v_now,
      'live_instances',(SELECT count(*) FROM public.lightning_instance i WHERE i.cluster_id=cg.id AND i.state IN('forming','reserved','dealing','settling')))
     FROM public.cash_games cg
     WHERE cg.id=(a.context->>'cluster_id')::uuid AND cg.cluster_mode IS DISTINCT FROM 'frozen'
      AND NOT EXISTS(SELECT 1 FROM public.lightning_instance i WHERE i.cluster_id=cg.id
       AND i.state IN('forming','reserved','dealing','settling')
       AND i.deadline_at<v_now-make_interval(secs=>COALESCE((public.fn_lightning_config(cg.id)->>'alert_window_ms')::numeric,600000)/1000.0))
      AND NOT EXISTS(SELECT 1 FROM public.cash_cluster_events e WHERE e.game_id=cg.id
       AND e.at>v_now-make_interval(secs=>COALESCE((public.fn_lightning_config(cg.id)->>'alert_window_ms')::numeric,600000)/1000.0)
       AND e.kind IN('lightning_pending_on_reap_failed','lightning_pending_off_reap_failed')))
   END evidence
  FROM public.financial_alerts a
  WHERE a.resolved IS NOT TRUE AND a.source IN('weekly_club_accounting','union_accounting_scheduler','lightning_alerts')
 ) s WHERE s.evidence IS NOT NULL
 ORDER BY s.created_at,s.id LIMIT p_limit) t;
 SELECT COALESCE(array_agg((x->>'id')::uuid),'{}') INTO v_ids FROM jsonb_array_elements(v_found) x;
 IF p_apply AND cardinality(v_ids)>0 THEN
  WITH changed AS (
   UPDATE public.financial_alerts a SET resolved=true,resolved_at=now(),
     resolution=CASE x.evidence->>'kind'
      WHEN 'club_week_complete' THEN 'verified: club '||(x.evidence->>'club_id')||' week '||(x.evidence->>'period_start')||' to '
       ||(x.evidence->>'period_end')||' was recorded complete in union_accounting_runs at '||(x.evidence->>'finished_at')
       ||' (attempt '||(x.evidence->>'attempts')||'), after this alert.'
      WHEN 'union_weeks_complete' THEN 'verified: every union week ending in the four weeks before this alert is recorded complete; the week '
       ||(x.evidence->>'period_start')||' to '||(x.evidence->>'period_end')||' completed at '||(x.evidence->>'finished_at')||', after this alert.'
      ELSE 'verified: re-measured at '||(x.evidence->>'remeasured_at')||': Lightning Cluster '||(x.evidence->>'cluster_id')
       ||' is not frozen, holds no live instance past its deadline beyond its alert window ('||(x.evidence->>'live_instances')
       ||' live now) and recorded no failed reap within that window.' END,
     context=COALESCE(a.context,'{}'::jsonb)||jsonb_build_object('resolved_by_fn','fn_resolve_settled_financial_alerts',
      'resolved_on',now(),'proven_over_v1',x.evidence)
   FROM jsonb_to_recordset(v_found) x(id uuid,evidence jsonb)
   WHERE a.id=x.id AND a.resolved IS NOT TRUE RETURNING a.id)
  SELECT count(*)::integer INTO v_n FROM changed;
 ELSE v_n:=cardinality(v_ids);
 END IF;
 SELECT COALESCE(array_agg(a.id ORDER BY a.created_at,a.id),'{}') INTO v_echo FROM (
  SELECT a.id,a.created_at FROM public.financial_alerts a JOIN public.financial_alerts p ON p.id::text=a.context->>'alert_id'
  WHERE a.resolved IS NOT TRUE AND a.source LIKE 'drift_incident:financial_alerts:%' AND a.context->>'alert_id' ~ c_uuid
   AND p.source=substr(a.source,length('drift_incident:financial_alerts:')+1)
   AND ((p.resolved IS TRUE AND (p.resolution ILIKE 'verified%' OR p.resolution ILIKE 're-measured%')) OR p.id=ANY(v_ids))
  ORDER BY a.created_at,a.id LIMIT p_limit) a;
 IF p_apply AND cardinality(v_echo)>0 THEN
  WITH changed AS (
   UPDATE public.financial_alerts a SET resolved=true,resolved_at=now(),
     resolution='verified: the alert this incident echo repeats ('||p.id::text||') is resolved: '||left(p.resolution,400),
     context=COALESCE(a.context,'{}'::jsonb)||jsonb_build_object('resolved_by_fn','fn_resolve_settled_financial_alerts',
      'resolved_on',now(),'proven_over_v1',jsonb_build_object('kind','echo_parent_resolved','parent_alert_id',p.id))
   FROM public.financial_alerts p
   WHERE a.id=ANY(v_echo) AND a.resolved IS NOT TRUE AND p.id::text=a.context->>'alert_id' AND p.resolved IS TRUE
    AND (p.resolution ILIKE 'verified%' OR p.resolution ILIKE 're-measured%')
   RETURNING a.id)
  SELECT count(*)::integer INTO v_e FROM changed;
 ELSE v_e:=cardinality(v_echo);
 END IF;
 RETURN jsonb_build_object('proven_over',v_n,'echoes_closed',v_e,'proven_ids',to_jsonb(v_ids),'echo_ids',to_jsonb(v_echo));
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.financial_alerts_proven_over(boolean,integer) FROM PUBLIC, anon, authenticated, service_role;

-- The established resolver calls it, once per run, after its nine classes.
DO $install$
DECLARE
 sig constant text := 'public.fn_resolve_settled_financial_alerts(boolean,integer)';
 d text; before jsonb;
 olds constant text[] := ARRAY[
$o1$  v_cron_twins integer := 0;
BEGIN
$o1$,
$o2$  RETURN jsonb_build_object(
    'ok', true,
$o2$];
 news constant text[] := ARRAY[
$n1$  v_cron_twins integer := 0;
  v_proven_over jsonb;
BEGIN
$n1$,
$n2$  -- CLASS 10 (2026-11-11): settled accounting and Lightning reaper alerts,
  -- and their incident echoes, close on a completion receipt or a
  -- re-measurement (smarter_private.financial_alerts_proven_over).
  v_proven_over := smarter_private.financial_alerts_proven_over(p_apply, p_limit);

  RETURN jsonb_build_object(
    'ok', true,
    'accounting_lightning_proven_over', v_proven_over,
$n2$];
BEGIN
 IF md5(pg_get_functiondef(sig::regprocedure))<>'f550e1733dfd2fac43a1a1b4837ef4a5' THEN
  RAISE EXCEPTION 'financial_alerts_proven_over_preimage_changed' USING ERRCODE='55000';
 END IF;
 SELECT jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'volatility',provolatile)
  INTO before FROM pg_proc WHERE oid=sig::regprocedure;
 d:=pg_get_functiondef(sig::regprocedure);
 FOR i IN 1..2 LOOP
  IF (length(d)-length(replace(d,olds[i],'')))/length(olds[i])<>1 THEN
   RAISE EXCEPTION 'financial_alerts_proven_over_anchor_not_unique: #%',i;
  END IF;
  d:=replace(d,olds[i],news[i]);
 END LOOP;
 EXECUTE d;
 IF pg_get_functiondef(sig::regprocedure)<>d THEN RAISE EXCEPTION 'financial_alerts_proven_over_postimage'; END IF;
 IF before IS DISTINCT FROM (SELECT jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'volatility',provolatile)
   FROM pg_proc WHERE oid=sig::regprocedure) THEN
  RAISE EXCEPTION 'financial_alerts_proven_over_resolver_metadata_changed';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE strpos(p.prosrc,'f550e1733dfd2fac43a1a1b4837ef4a5')>0) THEN
  RAISE EXCEPTION 'financial_alerts_proven_over_left_a_stale_pin';
 END IF;
END $install$;
COMMIT;
