CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_format(p_tournament_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE
   WHEN t.is_pko AND NOT coalesce(t.is_mystery_bounty,false)
        AND t.bounty_amount=1 AND t.guaranteed_prize=0 THEN 'pko'
   WHEN coalesce(t.is_mystery_bounty,false) AND NOT coalesce(t.is_pko,false)
        AND t.bounty_amount=0.50 THEN 'mystery'
   WHEN NOT coalesce(t.is_bounty,false) AND NOT coalesce(t.is_pko,false)
        AND NOT coalesce(t.is_mystery_bounty,false)
        AND coalesce(t.all_in_or_fold,false) THEN 'aiof'
   WHEN NOT coalesce(t.is_bounty,false) AND NOT coalesce(t.is_pko,false)
        AND NOT coalesce(t.is_mystery_bounty,false)
        AND NOT coalesce(t.all_in_or_fold,false) THEN 'regular'
   END
 FROM public.tournaments t WHERE t.id=p_tournament_id
  AND (t.union_id='fade0000-0000-0000-0000-000000000001'::uuid
       OR t.club_id='fade0000-0000-0000-0000-000000000001'::uuid)
  AND t.free_buy
  AND upper(t.tournament_type)='MTT' AND t.buy_in_amount=0 AND t.buy_in_fee=0
  AND t.satellite_target_id IS NULL AND lower(coalesce(t.variant,''))<>'satellite';
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_slot_format(p_tournament_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE s.config->>'midwayFreeBuyFormat'
   WHEN 'promo-pko-v1' THEN 'pko'
   WHEN 'midway-free-buy-aiof-v1' THEN 'aiof'
   WHEN 'midway-free-buy-mystery-v1' THEN 'mystery'
   WHEN 'midway-free-buy-regular-v1' THEN 'regular' END
 FROM public.tournaments t JOIN public.tournament_schedules s ON s.id=t.schedule_id
 WHERE t.id=p_tournament_id
   AND (t.union_id='fade0000-0000-0000-0000-000000000001'::uuid
        OR t.club_id='fade0000-0000-0000-0000-000000000001'::uuid)
   AND t.free_buy;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sp_daily_digest(p_day date DEFAULT NULL::date, p_dispatch boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_day date := COALESCE(p_day, (now() AT TIME ZONE 'America/Chicago')::date - 1);
  v_row public.sp_daily_metrics%ROWTYPE;
  v_prev jsonb; v_series jsonb; v_mtd jsonb; v_week jsonb; v_att jsonb; v_live jsonb; v_status jsonb;
  v_days_in_month int; v_days_so_far int;
  v_rake_ledger numeric; v_rake_rollup numeric;
BEGIN
  SELECT * INTO v_row FROM public.sp_daily_metrics WHERE day = v_day;
  IF NOT FOUND THEN
    PERFORM public.fn_sp_daily_metrics_snapshot(v_day);
    SELECT * INTO v_row FROM public.sp_daily_metrics WHERE day = v_day;
  END IF;
  SELECT metrics INTO v_prev FROM public.sp_daily_metrics WHERE day = v_day - 1;

  -- 7 day series of the headline numbers, oldest first
  SELECT jsonb_object_agg(k, vals) INTO v_series FROM (
    SELECT k, jsonb_agg(jsonb_build_object('day', day, 'v', val) ORDER BY day) vals FROM (
      SELECT dm.day, x.k, (dm.metrics #>> x.path)::numeric val
        FROM public.sp_daily_metrics dm
        CROSS JOIN (VALUES
          ('signups', '{growth,signups}'::text[]), ('active_humans', '{growth,active_humans}'::text[]),
          ('cash_rake', '{money,cash_rake}'::text[]), ('tournament_rake', '{money,tournament_rake}'::text[]),
          ('revenue_usd', '{sales,revenue_usd}'::text[]), ('diamonds_given', '{diamonds,given_out}'::text[]),
          ('diamonds_taken', '{diamonds,taken_in}'::text[]), ('hands', '{play,hands}'::text[]),
          ('critical_alerts', '{health,alerts_new,critical}'::text[]), ('client_errors', '{health,client_errors}'::text[])) x(k, path)
       WHERE dm.day BETWEEN v_day - 6 AND v_day) z GROUP BY k) y;

  v_days_in_month := extract(day FROM (date_trunc('month', v_day) + interval '1 month - 1 day'))::int;
  v_days_so_far := extract(day FROM v_day)::int;
  SELECT jsonb_build_object(
    'days', count(*),
    'revenue_usd', COALESCE(sum((metrics#>>'{sales,revenue_usd}')::numeric),0),
    'cash_rake', COALESCE(sum((metrics#>>'{money,cash_rake}')::numeric),0),
    'tournament_rake', COALESCE(sum((metrics#>>'{money,tournament_rake}')::numeric),0),
    'signups', COALESCE(sum((metrics#>>'{growth,signups}')::numeric),0),
    'horse_net_bb', COALESCE(sum((metrics#>>'{play,horse_net_bb}')::numeric),0))
    INTO v_mtd FROM public.sp_daily_metrics WHERE day >= date_trunc('month', v_day)::date AND day <= v_day;
  v_mtd := v_mtd || jsonb_build_object(
    'projected_revenue_usd', round((v_mtd->>'revenue_usd')::numeric / GREATEST(v_days_so_far,1) * v_days_in_month, 2),
    'projected_rake', round(((v_mtd->>'cash_rake')::numeric + (v_mtd->>'tournament_rake')::numeric) / GREATEST(v_days_so_far,1) * v_days_in_month, 2),
    'days_in_month', v_days_in_month, 'day_of_month', v_days_so_far);

  -- Monday: the full previous Monday-Sunday week
  IF extract(isodow FROM v_day) = 7 THEN
    SELECT jsonb_build_object('from', min(day), 'to', max(day), 'days', count(*),
      'revenue_usd', COALESCE(sum((metrics#>>'{sales,revenue_usd}')::numeric),0),
      'cash_rake', COALESCE(sum((metrics#>>'{money,cash_rake}')::numeric),0),
      'tournament_rake', COALESCE(sum((metrics#>>'{money,tournament_rake}')::numeric),0),
      'rakeback_paid', COALESCE(sum((metrics#>>'{money,rakeback_paid}')::numeric),0),
      'signups', COALESCE(sum((metrics#>>'{growth,signups}')::numeric),0),
      'hands', COALESCE(sum((metrics#>>'{play,hands}')::numeric),0),
      'diamonds_given', COALESCE(sum((metrics#>>'{diamonds,given_out}')::numeric),0),
      'diamonds_taken', COALESCE(sum((metrics#>>'{diamonds,taken_in}')::numeric),0),
      'minted', COALESCE(sum((metrics#>>'{money,minted}')::numeric),0),
      'burned', COALESCE(sum((metrics#>>'{money,burned}')::numeric),0))
      INTO v_week FROM public.sp_daily_metrics WHERE day BETWEEN v_day - 6 AND v_day;
  END IF;

  -- Live rules re-read now (cashouts, stuck tournaments, funding, invoices);
  -- anything new is dispatched, then everything is read back with its status.
  -- Refresh only the rollup in memory; the ledger baseline and snapshots remain intact.
  SELECT (v_row.metrics#>>'{money,ledger_rake_utc_day}')::numeric,
         (SELECT round(COALESCE(sum(rake_amount),0),2) FROM public.club_rake_daily_user WHERE day = v_day)
    INTO v_rake_ledger, v_rake_rollup;
  v_row.metrics := jsonb_set(v_row.metrics, '{money}', COALESCE(v_row.metrics->'money','{}'::jsonb) || jsonb_build_object(
    'ledger_rake_utc_day', v_rake_ledger, 'rollup_rake_utc_day', v_rake_rollup, 'rollup_rechecked_at', clock_timestamp()));
  v_live := public.fn_sp_digest_attention(v_day, v_row.metrics);
  IF p_dispatch THEN
    v_live := public.fn_sp_dispatch_attention(v_day, v_live);
    -- Keep what the email reported on the day's record, so the online view and
    -- any re-send show the same list. One entry per rule and key.
    UPDATE public.sp_daily_metrics m
       SET attention = COALESCE(m.attention,'[]'::jsonb) || COALESCE((
             SELECT jsonb_agg(l.x) FROM jsonb_array_elements(v_live) AS l(x)
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(m.attention,'[]'::jsonb)) AS o(y)
                                 WHERE o.y->>'rule' = l.x->>'rule'
                                   AND COALESCE(o.y->>'key','') = COALESCE(l.x->>'key',''))), '[]'::jsonb)
     WHERE m.day = v_day;
    v_live := '[]'::jsonb;
    SELECT attention INTO v_row.attention FROM public.sp_daily_metrics WHERE day = v_day;
  ELSE
    -- read-only callers (the online view) only see items already dispatched
    v_live := '[]'::jsonb;
  END IF;
  SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) INTO v_att FROM (
    SELECT it || jsonb_build_object(
        'status', CASE WHEN it->>'rule' = 'rake_rollup_mismatch'
                            AND abs(v_rake_ledger - v_rake_rollup) <= 1 THEN 'fixed'
                       WHEN it->>'rule' = 'rake_rollup_mismatch' AND abs(v_rake_ledger - v_rake_rollup) > 1
                       THEN CASE WHEN NOT (it ? 'alert_event_id') THEN 'tracked'
                                 WHEN o.investigation_status = 'investigating' THEN 'in_progress'
                                 ELSE 'not_picked_up' END
                       WHEN it->>'rule' = 'critical_alert_rising' THEN
                         CASE WHEN NOT grouped.linkage_complete THEN 'tracked'
                              WHEN grouped.reviewed = grouped.members THEN 'fixed'
                              WHEN grouped.investigating > 0 THEN 'in_progress'
                              ELSE 'not_picked_up' END
                       WHEN it->>'rule' = 'drift_past_deadline' THEN
                         CASE WHEN NOT drift_group.linkage_complete OR drift_group.unverified > 0 THEN 'tracked'
                              WHEN drift_group.reviewed = drift_group.members THEN 'fixed'
                              WHEN drift_group.reviewed > 0 OR drift_group.investigating > 0 THEN 'in_progress'
                              ELSE 'not_picked_up' END
                       WHEN NOT (it ? 'alert_event_id') THEN 'tracked'
                       WHEN o.investigation_status IN ('verified_fixed','historical') THEN 'fixed'
                       WHEN o.investigation_status = 'investigating' THEN 'in_progress'
                       ELSE 'not_picked_up' END,
        'resolution', CASE WHEN it->>'rule' = 'rake_rollup_mismatch'
                            AND abs(v_rake_ledger - v_rake_rollup) <= 1
                       THEN format('Current rollup matches recorded UTC-day ledger %s; original snapshot retained.', v_rake_ledger)
                       WHEN it->>'rule' = 'rake_rollup_mismatch' AND abs(v_rake_ledger - v_rake_rollup) > 1
                       THEN format('Current rollup %s differs from recorded UTC-day ledger %s; original snapshot retained.', v_rake_rollup, v_rake_ledger)
                       WHEN it->>'rule' = 'critical_alert_rising' THEN
                         CASE WHEN NOT grouped.linkage_complete
                              THEN 'Original alert linkage is incomplete; historical counts are retained. No assignment or resolution is inferred.'
                              ELSE format('%s of %s linked original alert records are resolved or reviewed; historical daily counts are retained.',grouped.reviewed,grouped.members) END
                       WHEN it->>'rule' = 'drift_past_deadline' THEN
                         CASE WHEN NOT drift_group.linkage_complete OR drift_group.unverified > 0
                              THEN 'Original incident linkage or verified closure evidence is incomplete; historical counts are retained. No resolution is inferred.'
                              ELSE format('%s of %s linked original drift incidents are verified resolved; %s remain open. Historical daily counts are retained.',drift_group.reviewed,drift_group.members,drift_group.members-drift_group.reviewed) END
                       ELSE o.investigation->>'resolution' END) x
      FROM jsonb_array_elements(COALESCE(v_row.attention,'[]'::jsonb) || v_live) AS j(it)
      LEFT JOIN public.operational_alert_events o ON o.id = (it->>'alert_event_id')::bigint
      LEFT JOIN LATERAL (
        WITH groups AS (
          SELECT q.x FROM jsonb_array_elements(CASE
            WHEN jsonb_typeof(it#>'{detail,source_events}')='array'
            THEN it#>'{detail,source_events}' ELSE '[]'::jsonb END) q(x)
        ), members AS (
          SELECT g.x->>'alertname' alertname,
                 CASE WHEN jsonb_typeof(i.x)='number' AND i.x::text ~ '^[1-9][0-9]{0,18}$'
                      THEN CASE WHEN (i.x::text)::numeric <= 9223372036854775807
                                THEN (i.x::text)::bigint END END id
            FROM groups g CROSS JOIN LATERAL jsonb_array_elements(CASE
              WHEN jsonb_typeof(g.x->'event_ids')='array' THEN g.x->'event_ids' ELSE '[]'::jsonb END) i(x)
        )
        SELECT count(*) members,
               count(*) FILTER(WHERE original.investigation_status IN ('verified_fixed','historical')
                 OR EXISTS(SELECT 1 FROM public.financial_alerts financial
                   WHERE original.source IN ('financial-alerts-backfill','financial-alerts-updates')
                     AND financial.id=CASE WHEN pg_input_is_valid(original.payload#>>'{original_event,id}','uuid')
                                           THEN (original.payload#>>'{original_event,id}')::uuid END
                     AND financial.source=original.alertname
                     AND CASE WHEN pg_input_is_valid(original.payload#>>'{original_event,created_at}','timestamp with time zone')
                              THEN financial.created_at=(original.payload#>>'{original_event,created_at}')::timestamptz ELSE false END
                     AND financial.resolved IS TRUE AND financial.resolved_at>=financial.created_at)
                 OR EXISTS(SELECT 1 FROM public.operational_alert_events closed
                   WHERE original.source='alertmanager' AND closed.source='alertmanager' AND closed.status='resolved'
                     AND closed.alertname=original.alertname
                     AND nullif(original.payload#>>'{alert,fingerprint}','') IS NOT NULL
                     AND closed.payload#>>'{alert,fingerprint}'=original.payload#>>'{alert,fingerprint}'
                     AND nullif(original.payload#>>'{alert,startsAt}','') IS NOT NULL
                     AND closed.payload#>>'{alert,startsAt}'=original.payload#>>'{alert,startsAt}'
                     AND jsonb_typeof(original.payload#>'{alert,labels}')='object'
                     AND original.payload#>>'{alert,labels,alertname}'=original.alertname
                     AND closed.payload#>'{alert,labels}'=original.payload#>'{alert,labels}'
                     AND closed.payload#>>'{alert,status}'='resolved'
                     AND COALESCE(closed.last_received_at,closed.received_at)>=COALESCE(original.last_received_at,original.received_at)
                     AND CASE WHEN pg_input_is_valid(original.payload#>>'{alert,startsAt}','timestamp with time zone')
                                   AND pg_input_is_valid(closed.payload#>>'{alert,endsAt}','timestamp with time zone')
                              THEN (closed.payload#>>'{alert,endsAt}')::timestamptz >= (original.payload#>>'{alert,startsAt}')::timestamptz
                              ELSE false END)) reviewed,
               count(*) FILTER(WHERE original.investigation_status='investigating') investigating,
               count(*)>0 AND count(*)=count(DISTINCT m.id) AND
               COALESCE(bool_and(COALESCE(original.id IS NOT NULL
                 AND COALESCE(original.alertname,'unknown')=m.alertname
                 AND original.severity='critical'
                 AND original.received_at >= (v_day::timestamp AT TIME ZONE 'America/Chicago')
                 AND original.received_at < ((v_day+1)::timestamp AT TIME ZONE 'America/Chicago')
                 AND original.payload->>'snapshot_kind' IS DISTINCT FROM 'update_new',false)),false)
               AND (SELECT count(*)>0 AND count(*)=count(DISTINCT x->>'alertname')
                 AND to_jsonb(count(*))=it#>'{detail,count}'
                 AND COALESCE(bool_and(COALESCE(jsonb_typeof(x->'alertname')='string'
                   AND x->>'alertname'<>'' AND jsonb_typeof(x->'event_ids')='array'
                   AND jsonb_array_length(CASE WHEN jsonb_typeof(x->'event_ids')='array' THEN x->'event_ids' ELSE '[]'::jsonb END)>0
                   AND x->'expected_count'=v_row.metrics#>ARRAY['health','alert_names',x->>'alertname']
                   AND x->'expected_count'=to_jsonb(jsonb_array_length(CASE WHEN jsonb_typeof(x->'event_ids')='array' THEN x->'event_ids' ELSE '[]'::jsonb END)),false)),false)
                   FROM groups) linkage_complete
          FROM members m LEFT JOIN public.operational_alert_events original ON original.id=m.id
       ) grouped ON it->>'rule'='critical_alert_rising'
      LEFT JOIN LATERAL (
        WITH members AS (
          SELECT CASE WHEN jsonb_typeof(q.x)='string' AND pg_input_is_valid(q.x#>>'{}','uuid')
                      THEN (q.x#>>'{}')::uuid END id
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(it#>'{detail,incident_ids}')='array'
                 THEN it#>'{detail,incident_ids}' ELSE '[]'::jsonb END) q(x)
        ), witness AS (
          SELECT CASE WHEN pg_input_is_valid(it#>>'{detail,as_of}','timestamp with time zone')
                      THEN (it#>>'{detail,as_of}')::timestamptz END at
        ), outcomes AS (
          SELECT m.id,d.id found_id,d.created_at,d.detected_at,d.deadline_at,d.resolved_at,d.status,
                 COALESCE(d.status='resolved' AND d.resolved_at>=d.detected_at
                   AND d.closure_basis IS DISTINCT FROM 'aged_out_unverified'
                   AND length(btrim(COALESCE(d.root_cause,'')))>=40
                   AND nullif(btrim(d.resolution),'') IS NOT NULL
                   AND d.correction_ref ~* '^(migration[[:space:]]+[^[:space:]]|PR[[:space:]]*#[0-9]|chip_ledger[[:space:]]+[^[:space:]]|correction:[^[:space:]]|(ruling:|verified:|no-change-needed:)[[:space:]]*[^[:space:]])',false) verified
            FROM members m LEFT JOIN public.ca_drift_incidents d ON d.id=m.id
        )
        SELECT count(*) members,count(*) FILTER(WHERE verified) reviewed,
               count(*) FILTER(WHERE status IN ('acknowledged','reconciling')) investigating,
               count(*) FILTER(WHERE status='resolved' AND NOT verified) unverified,
               count(*)>0 AND count(*)=count(DISTINCT id)
               AND to_jsonb(count(*))=it#>'{detail,count}'
               AND COALESCE(bool_and(COALESCE(found_id IS NOT NULL AND witness.at<=now()
                 AND created_at<=witness.at AND detected_at<=witness.at AND deadline_at<witness.at
                 AND (resolved_at IS NULL OR resolved_at>witness.at),false)),false) linkage_complete
          FROM outcomes CROSS JOIN witness
      ) drift_group ON it->>'rule'='drift_past_deadline') z;
  -- one entry per alert event
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'severity') = 'critical' DESC, x->>'rule'), '[]'::jsonb) INTO v_att FROM (
    SELECT DISTINCT ON (COALESCE(j.x->>'alert_event_id', j.x->>'title')) j.x FROM jsonb_array_elements(v_att) AS j(x)
     ORDER BY COALESCE(x->>'alert_event_id', x->>'title')) q;

  SELECT jsonb_build_object('fixed', count(*) FILTER (WHERE x->>'status' = 'fixed'),
                            'tracked', count(*) FILTER (WHERE x->>'status' = 'tracked'),
                            'in_progress', count(*) FILTER (WHERE x->>'status' = 'in_progress'),
                            'not_picked_up', count(*) FILTER (WHERE x->>'status' = 'not_picked_up'))
    INTO v_status FROM jsonb_array_elements(v_att) AS j(x);

  RETURN jsonb_build_object(
    'day', v_day,
    'day_label', to_char(v_day, 'FMDay, Mon FMDD'),
    'metrics', v_row.metrics,
    'prev', v_prev,
    'series', COALESCE(v_series, '{}'::jsonb),
    'mtd', v_mtd,
    'week', v_week,
    'attention', v_att,
    'attention_status', v_status,
    'previous_run', (SELECT jsonb_build_object('day', day, 'status', status, 'sent_at', sent_at) FROM public.sp_daily_digest_runs WHERE day = v_day - 1),
    'snapshot_computed_at', v_row.computed_at,
    'snapshot_compute_ms', v_row.compute_ms,
    'horse_roster', public.fn_ca_horse_roster_digest(v_day),
    'engine_cutover', public.fn_sp_digest_engine_cutover(v_day),
    'generated_at', clock_timestamp());
END $function$;

