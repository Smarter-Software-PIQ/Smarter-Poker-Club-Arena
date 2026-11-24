-- @live-proof: (SELECT regexp_count(prosrc,'interval ''12 minutes''')>=4 AND position('public.engine_maintenance_thaws' in prosrc)>0 FROM pg_proc WHERE oid='public.fn_ca_table_stall_watch_tick(bigint)'::regprocedure) AND (SELECT position('t.release_target_at <= t.freeze_started_at + interval ''12 minutes''' in prosrc)>0 FROM pg_proc WHERE oid='public.fn_ca_table_stall_watch_ingest(text,timestamp with time zone,bigint)'::regprocedure) AND (SELECT position('bbj_payout_paid' in prosrc)>0 AND position('processBBJPayout.exhausted' in prosrc)>0 FROM pg_proc WHERE oid='smarter_private.financial_alerts_proven_over(boolean,integer)'::regprocedure)
-- 20261124074800_harden_stall_12m_and_bbj_alert_closure.sql
--
-- Hardening follow-up across two verified incident tracks:
--   1. Stall-watch v3 thaw & adopted break upper bound (6684eba0 / 20261124041800):
--      Raise the hard 5-minute ceiling on bounded maintenance freezes and v3
--      thaws in fn_ca_table_stall_watch_tick and fn_ca_table_stall_watch_ingest
--      to 12 minutes (matching fn_ca_table_stall_watch_ingest's existing 12m
--      bounded-maintenance cap from 20261031202225). A 1ms-early countdown
--      produces release_target_at - freeze_started_at = 300.001s, heavy/rebased
--      thaws legitimately span 316-382s, and last_hand adoption spans up to 7m;
--      all of those bypassed <= 5 minutes while runaway freezes (>12m) stay
--      fully alertable.
--   2. Receipt-proven auto-closure for paid BBJ alerts (7a0c2e25):
--      Add branch (e) to smarter_private.financial_alerts_proven_over so
--      processBBJPayout.exhausted and FeeReconciler.exhausted (kind=bbj_payout)
--      alerts resolve with 'verified: ...' ONLY when public.bbj_payouts exists
--      for (table_id, hand_number), recipient + unpaid unclaimed shares equal
--      bbj_payouts.total_amount (> 0), and no unresolved pending_fee_distributions
--      (kind='bbj_payout') row remains. Existing triggers propagate the verified
--      resolution to ca_drift_incidents and drift_incident echoes automatically.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $harden_stall_and_bbj$
DECLARE
  v_tick_fn regprocedure := 'public.fn_ca_table_stall_watch_tick(bigint)'::regprocedure;
  v_ingest_fn regprocedure := 'public.fn_ca_table_stall_watch_ingest(text,timestamp with time zone,bigint)'::regprocedure;
  v_proven_fn regprocedure := 'smarter_private.financial_alerts_proven_over(boolean,integer)'::regprocedure;

  v_tick_def text := pg_get_functiondef(v_tick_fn);
  v_ingest_def text := pg_get_functiondef(v_ingest_fn);
  v_proven_def text := pg_get_functiondef(v_proven_fn);

  v_tick_patched text;
  v_ingest_patched text;
  v_n int;

  v_old_break_cap text := $cap$AND b.break_ends_at <= b.break_started_at + interval '5 minutes'$cap$;
  v_new_break_cap text := $cap$AND b.break_ends_at <= b.break_started_at + interval '12 minutes'$cap$;
  v_old_thaw_cap text := $cap$AND t.release_target_at <= t.freeze_started_at + interval '5 minutes'$cap$;
  v_new_thaw_cap text := $cap$AND t.release_target_at <= t.freeze_started_at + interval '12 minutes'$cap$;
BEGIN
  IF md5(v_tick_def) IS DISTINCT FROM 'c4c690d3f6204a24d29a1a7ee4f1d39c' THEN
    RAISE EXCEPTION 'HARDEN_STALL_BBJ_PREIMAGE_DRIFT fn_ca_table_stall_watch_tick got %', md5(v_tick_def)
      USING ERRCODE = '55000';
  END IF;
  IF md5(v_ingest_def) IS DISTINCT FROM '9d987cc7e2d4a3a958d05dcd89137fac' THEN
    RAISE EXCEPTION 'HARDEN_STALL_BBJ_PREIMAGE_DRIFT fn_ca_table_stall_watch_ingest got %', md5(v_ingest_def)
      USING ERRCODE = '55000';
  END IF;
  IF md5(v_proven_def) IS DISTINCT FROM 'f62e5ddbd69d550b445b6d537e473d9e' THEN
    RAISE EXCEPTION 'HARDEN_STALL_BBJ_PREIMAGE_DRIFT financial_alerts_proven_over got %', md5(v_proven_def)
      USING ERRCODE = '55000';
  END IF;

  v_n := (length(v_tick_def) - length(replace(v_tick_def, v_old_break_cap, ''))) / length(v_old_break_cap);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'break cap anchor found % times in fn_ca_table_stall_watch_tick, expected 2', v_n
      USING ERRCODE = '55000';
  END IF;
  v_n := (length(v_tick_def) - length(replace(v_tick_def, v_old_thaw_cap, ''))) / length(v_old_thaw_cap);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'thaw cap anchor found % times in fn_ca_table_stall_watch_tick, expected 2', v_n
      USING ERRCODE = '55000';
  END IF;
  v_tick_patched := replace(replace(v_tick_def, v_old_break_cap, v_new_break_cap), v_old_thaw_cap, v_new_thaw_cap);
  IF replace(replace(v_tick_patched, v_new_thaw_cap, v_old_thaw_cap), v_new_break_cap, v_old_break_cap) IS DISTINCT FROM v_tick_def THEN
    RAISE EXCEPTION 'HARDEN_STALL_BBJ_ROUNDTRIP_DRIFT fn_ca_table_stall_watch_tick' USING ERRCODE = '55000';
  END IF;

  v_n := (length(v_ingest_def) - length(replace(v_ingest_def, v_old_thaw_cap, ''))) / length(v_old_thaw_cap);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'thaw cap anchor found % times in fn_ca_table_stall_watch_ingest, expected 1', v_n
      USING ERRCODE = '55000';
  END IF;
  v_ingest_patched := replace(v_ingest_def, v_old_thaw_cap, v_new_thaw_cap);
  IF replace(v_ingest_patched, v_new_thaw_cap, v_old_thaw_cap) IS DISTINCT FROM v_ingest_def THEN
    RAISE EXCEPTION 'HARDEN_STALL_BBJ_ROUNDTRIP_DRIFT fn_ca_table_stall_watch_ingest' USING ERRCODE = '55000';
  END IF;
  IF position('tournament finished; it will not deal again' in v_ingest_patched) = 0 THEN
    RAISE EXCEPTION 'HARDEN_STALL_BBJ_FINISHED_RESOLUTION_LOST fn_ca_table_stall_watch_ingest' USING ERRCODE = '55000';
  END IF;

  EXECUTE v_tick_patched;
  EXECUTE v_ingest_patched;
END
$harden_stall_and_bbj$;

CREATE OR REPLACE FUNCTION smarter_private.financial_alerts_proven_over(p_apply boolean, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
-- SETTLED ACCOUNTING, LIGHTNING AND BBJ ALERTS CLOSE ON EVIDENCE (2026-11-11, 2026-11-24).
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
--       in this call;
--   (e) processBBJPayout.exhausted and FeeReconciler.exhausted (kind=bbj_payout):
--       a public.bbj_payouts row exists for the exact (table_id, hand_number)
--       with total_amount > 0, recipient + unpaid unclaimed shares equal
--       total_amount, and no unresolved pending_fee_distributions (bbj_payout)
--       row remains for that hand.
-- A malformed identity, an unfinished or failed week, a later failure, an
-- unconserved or still-queued jackpot, or a still-late instance leaves the
-- alert open. Nothing but the alert row moves.
DECLARE
 v_now timestamptz := clock_timestamp(); v_found jsonb; v_ids uuid[] := '{}'; v_echo uuid[] := '{}'; v_n integer := 0; v_e integer := 0;
 c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
 c_ts constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}(:?[0-9]{2})?|Z)$';
 c_uint constant text := '^[0-9]+$';
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
   WHEN (a.source='processBBJPayout.exhausted'
         OR (a.source='FeeReconciler.exhausted' AND a.context->>'kind'='bbj_payout'))
    AND COALESCE(a.context->>'tableId', a.context->>'table_id') ~ c_uuid
    AND COALESCE(a.context->>'handNumber', a.context->>'hand_number') ~ c_uint THEN (
    SELECT jsonb_build_object('kind','bbj_payout_paid','payout_id',p.id,'table_id',p.table_id,
      'hand_number',p.hand_number,'total_amount',p.total_amount,'paid_at',p.created_at)
     FROM public.bbj_payouts p
     WHERE p.table_id=(COALESCE(a.context->>'tableId', a.context->>'table_id'))::uuid
      AND p.hand_number=(COALESCE(a.context->>'handNumber', a.context->>'hand_number'))::bigint
      AND (COALESCE(a.context->>'kind','') NOT IN ('main','mini') OR p.kind=a.context->>'kind')
      AND p.total_amount>0
      AND COALESCE((SELECT sum(r.amount) FROM public.bbj_payout_recipients r WHERE r.payout_id=p.id),0)
          + COALESCE((SELECT sum(u.amount) FROM public.bbj_unclaimed_shares u WHERE u.payout_id=p.id AND u.paid_at IS NULL),0)
          = p.total_amount
      AND NOT EXISTS(SELECT 1 FROM public.pending_fee_distributions q
        WHERE q.kind='bbj_payout' AND q.table_id=p.table_id AND q.hand_number=p.hand_number
          AND q.resolved_at IS NULL)
     ORDER BY p.created_at DESC LIMIT 1)
   END evidence
  FROM public.financial_alerts a
  WHERE a.resolved IS NOT TRUE
    AND a.source IN('weekly_club_accounting','union_accounting_scheduler','lightning_alerts','processBBJPayout.exhausted','FeeReconciler.exhausted')
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
      WHEN 'bbj_payout_paid' THEN 'verified: BBJ payout '||(x.evidence->>'payout_id')||' paid '||(x.evidence->>'total_amount')
       ||' chips for table '||(x.evidence->>'table_id')||' hand #'||(x.evidence->>'hand_number')||' at '||(x.evidence->>'paid_at')
       ||' with exact recipient+unclaimed conservation and zero open queue rows.'
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

COMMIT;
