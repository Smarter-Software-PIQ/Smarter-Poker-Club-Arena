-- Exact original production source snapshots, read-only capture November 16. No credentials.
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
                       ELSE o.investigation->>'resolution' END)
        || CASE WHEN it->>'rule'='critical_alert_rising' THEN jsonb_build_object(
          'canonical_alert_proof',jsonb_build_object('version',1,
            'linkage_complete',grouped.linkage_complete,'groups',COALESCE(grouped.proof_groups,'[]'::jsonb)))
          ELSE '{}'::jsonb END x
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
        ), outcomes AS MATERIALIZED (
          SELECT m.*,public.fn_sp_original_alert_proof(m.id) proof FROM members m
        )
        SELECT (SELECT jsonb_agg(to_jsonb(g) ORDER BY g.alertname) FROM (
          SELECT m.alertname,array_agg(m.id ORDER BY m.id) event_ids,count(*) total,
            count(*) FILTER(WHERE (m.proof->>'reviewed')::boolean) reviewed,
            count(*) FILTER(WHERE (m.proof->>'verified')::boolean) verified,
            jsonb_agg(jsonb_build_object('event_id',m.id,'reviewed',m.proof->'reviewed',
              'verified',m.proof->'verified','kind',m.proof->'kind','reference',m.proof->'reference') ORDER BY m.id) proofs,
            COALESCE(jsonb_agg(DISTINCT m.proof->'reference') FILTER(WHERE (m.proof->>'verified')::boolean),'[]'::jsonb) fixes
          FROM outcomes m GROUP BY m.alertname) g) proof_groups,
               count(*) members,
               count(*) FILTER(WHERE (m.proof->>'reviewed')::boolean) reviewed,
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
          FROM outcomes m LEFT JOIN public.operational_alert_events original ON original.id=m.id
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
END $function$

;
CREATE OR REPLACE FUNCTION public.fn_ca_reconcile_owned_entity_types()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['player_wallet','seat_stack_exit','club_treasury','chip_circulation',
               'bomb_award_ledger_gap','frozen_wallets_pool','insurance_bank',
               'negative_balance']::text[];
$function$

;
CREATE OR REPLACE FUNCTION public.reconcile_ledger_nightly()
 RETURNS TABLE(total_checked integer, ok_count integer, warn_count integer, critical_count integer, worst_drift numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  v_total   INT := 0;
  v_ok      INT := 0;
  v_warn    INT := 0;
  v_crit    INT := 0;
  v_worst   NUMERIC := 0;
  v_frozen  NUMERIC;
  v_now     NUMERIC;
  v_left    NUMERIC;
BEGIN
  DELETE FROM public.ledger_reconcile_log WHERE run_date = CURRENT_DATE AND entity_type = ANY (public.fn_ca_reconcile_owned_entity_types());

  SELECT frozen_total INTO v_frozen
    FROM public.ca_frozen_pool_baseline WHERE pool = 'public.wallets';
  -- The frozen pool is the PRE-FREEZE rows. Post-freeze rows belong to
  -- certification accounts whose harness chips cycle through the no-club
  -- fallback and are deleted by the certification cleanup; they are not the
  -- stranded pool. And a pre-freeze row can LEAVE, because public.wallets
  -- cascades from profiles and auth.users - a deleted row is not a write, so
  -- recorded departures are added back before comparing. An attributable
  -- teardown nets to zero; an unrecorded change still pages. This is the same
  -- arithmetic fn_ca_quick_reconcile has used since 2026-09-02.
  SELECT COALESCE(SUM(balance), 0) INTO v_now FROM public.wallets
   WHERE created_at < '2026-08-22';
  SELECT COALESCE(SUM(deleted_balance), 0) INTO v_left
    FROM public.ca_frozen_pool_deletions WHERE pool = 'public.wallets';
  v_now := v_now + COALESCE(v_left, 0);
  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  VALUES (
    'frozen_wallets_pool', NULL, COALESCE(v_frozen, 0), v_now,
    CASE WHEN v_frozen IS NULL THEN 'critical'
         WHEN v_now = v_frozen  THEN 'ok'
         ELSE 'critical' END,
    jsonb_build_object(
      'source', 'reconcile_ledger_nightly',
      'rule', 'pool frozen 2026-08-21: any movement means a money path is writing to the dead pool',
      'baseline', v_frozen, 'observed', v_now));

  /* CLUB TREASURY, MEASURED FROM THE LINE (2026-08-31).
     The arithmetic lives in fn_ca_treasury_positions() (2026-09-21) so that
     the escalator can re-measure a stored finding with the SAME formula this
     records. Do not inline it again here: two copies of a tuned formula is
     how one of them silently stops matching. */
  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  SELECT 'club_treasury', p.club_id, p.ledger_balance, p.stored_balance, p.severity,
    jsonb_build_object('source', 'reconcile_ledger_nightly',
                       'unbaselined', p.unbaselined,
                       'note', CASE WHEN p.unbaselined
                         THEN 'no ca_treasury_baseline row for this club, so its opening balance is unknown and no drift is computed; trg_ca_club_gets_a_baseline writes one for every club created from 2026-09-08'
                         END,
                       'basis', 'ca_treasury_baseline + post-cutover chip_ledger flow',
                       'opening_balance', p.opening,
                       'credited_since', p.credited,
                       'debited_since', p.debited,
                       'cutover', p.cutover)
  FROM public.fn_ca_treasury_positions() p;

  -- INSURANCE + EV-CASHOUT BANK (2026-08-28)
  WITH led AS (
    SELECT bank_type, bank_entity_id,
           SUM(COALESCE(premium,0) - COALESCE(payout,0)) AS bal,
           COUNT(*) AS contracts
    FROM public.insurance_transactions
    WHERE bank_entity_id IS NOT NULL
    GROUP BY bank_type, bank_entity_id
  ),
  joined AS (
    SELECT l.bank_type, l.bank_entity_id, l.bal AS ledger_balance, l.contracts,
           COALESCE(
             CASE WHEN l.bank_type = 'union'
                  THEN (SELECT w.insurance_wallet FROM public.union_wallets w
                         WHERE w.union_id = l.bank_entity_id)
                  ELSE (SELECT c.insurance_balance FROM public.club_wallets c
                         WHERE c.club_id = l.bank_entity_id) END,
             0) AS stored_balance
    FROM led l
  )
  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  SELECT 'insurance_bank', j.bank_entity_id, j.ledger_balance, j.stored_balance,
    CASE
      WHEN ABS(j.stored_balance - j.ledger_balance) = 0     THEN 'ok'
      WHEN ABS(j.stored_balance - j.ledger_balance) <= 0.01 THEN 'warn'
      ELSE 'critical'
    END,
    jsonb_build_object('source', 'reconcile_ledger_nightly',
                       'bank_type', j.bank_type, 'contracts', j.contracts)
  FROM joined j;

  -- INSURANCE FUNNEL INTEGRITY (added 2026-08-28): every offer must resolve.
  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  SELECT 'insurance_offer_unresolved', u.player_id, u.offered, u.resolved, 'critical',
         jsonb_build_object('source', 'reconcile_ledger_nightly',
                            'table_id', u.table_id, 'hand_number', u.hand_number,
                            'last_offer', u.last_offer)
  FROM public.fn_unresolved_insurance_offers('1 day'::interval) u;

  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  SELECT 'seat_stack_exit', x.user_id, x.stack, 0, 'critical',
         jsonb_build_object(
           'source', 'fn_unaccounted_seat_exits',
           'exit_id', x.exit_id, 'table_id', x.table_id,
           'club_id', x.club_id, 'exit_kind', x.exit_kind,
           'db_role', x.db_role, 'app_name', x.app_name,
           'occurred_at', x.occurred_at)
  FROM public.fn_unaccounted_seat_exits('1 day'::interval) x;

  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  SELECT 'chip_circulation', c.club_id, c.on_the_felt, c.total, 'ok',
         jsonb_build_object(
           'source', 'fn_club_chip_circulation',
           'club_name', c.club_name,
           'member_wallets', c.member_wallets,
           'on_the_felt', c.on_the_felt,
           'treasury', c.treasury)
  FROM public.fn_club_chip_circulation() c
  WHERE c.total <> 0;

  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  SELECT 'cashout_escrow_stuck', e.player_id, e.amount, 0, 'critical',
         jsonb_build_object(
           'source', 'cashier_integrity',
           'escrow_id', e.id, 'cashout_id', e.cashout_request_id,
           'club_id', e.club_id, 'request_status', cr.status,
           'shape', CASE WHEN e.released_at IS NULL THEN 'unreleased_on_closed_request'
                         ELSE 'released_on_pending_request' END)
  FROM public.chip_escrow e
  JOIN public.cashout_requests cr ON cr.id = e.cashout_request_id
  WHERE (e.released_at IS NULL AND cr.status <> 'pending')
     OR (e.released_at IS NOT NULL AND cr.status = 'pending');

  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  SELECT 'negative_balance', t.entity_id, t.amount, 0, 'critical',
         jsonb_build_object('source', 'cashier_integrity', 'pool', t.pool, 'club_id', t.club_id)
  FROM (
    SELECT a.user_id AS entity_id, a.agent_wallet_balance AS amount, 'agent_wallet' AS pool, a.club_id
      FROM public.agents a WHERE COALESCE(a.agent_wallet_balance, 0) < 0
    UNION ALL
    SELECT a.user_id, a.promo_wallet_balance, 'promo_wallet', a.club_id
      FROM public.agents a WHERE COALESCE(a.promo_wallet_balance, 0) < 0
    UNION ALL
    SELECT m.user_id, m.chip_balance, 'player_wallet', m.club_id
      FROM public.club_members m WHERE COALESCE(m.chip_balance, 0) < 0
    UNION ALL
    SELECT c.id, c.chip_treasury, 'club_treasury', c.id
      FROM public.clubs c WHERE COALESCE(c.chip_treasury, 0) < 0
  ) t;

  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  SELECT 'over_claimed_send', ct.from_user_id,
         COALESCE((ct.metadata ->> 'claimed_back')::numeric, 0), ct.amount, 'critical',
         jsonb_build_object('source', 'cashier_integrity',
                            'transaction_id', ct.id, 'club_id', ct.club_id)
  FROM public.chip_transactions ct
  WHERE ct.transaction_type = 'agent_wallet_send'
    AND COALESCE((ct.metadata ->> 'claimed_back')::numeric, 0) > ct.amount;

  -- BOMB-POT AWARD LEDGER (added 2026-08-29)
  INSERT INTO public.ledger_reconcile_log
    (entity_type, entity_id, ledger_balance, stored_balance, severity, metadata)
  SELECT 'bomb_award_ledger_gap', NULL, g.net_winnings, g.ledger_total, 'critical',
         jsonb_build_object(
           'source', 'fn_bomb_pot_ledger_gaps',
           'hand_history_id', g.hand_history_id,
           'table_id', g.table_id,
           'hand_number', g.hand_number,
           'occurred_at', g.occurred_at,
           'board_count', g.board_count,
           'trigger_reason', g.trigger_reason,
           'award_units', g.award_units)
  FROM public.fn_bomb_pot_ledger_gaps('1 day'::interval) g;

  SELECT
    COUNT(*)::INT                                          AS total,
    COUNT(*) FILTER (WHERE severity = 'ok')::INT           AS ok,
    COUNT(*) FILTER (WHERE severity = 'warn')::INT         AS warn,
    COUNT(*) FILTER (WHERE severity = 'critical')::INT     AS crit,
    COALESCE(MAX(ABS(stored_balance - ledger_balance)), 0) AS worst
  INTO v_total, v_ok, v_warn, v_crit, v_worst
  FROM public.ledger_reconcile_log
  WHERE run_date = CURRENT_DATE;

  total_checked  := v_total;
  ok_count       := v_ok;
  warn_count     := v_warn;
  critical_count := v_crit;
  worst_drift    := v_worst;
  RETURN NEXT;
END;
$function$


;
CREATE OR REPLACE FUNCTION public.fn_mirror_notification_to_push_outbox()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE notice public.notifications%ROWTYPE; receipt record; existing public.push_outbox%ROWTYPE;
 v_tag text;v_pending int;state text:='pending';reason text;
 c_max_pending CONSTANT int:=20;c_max_age CONSTANT interval:=interval '30 minutes';
 v_alert_state text;v_alert_error text;v_alert_constraint text;
BEGIN
 -- Delivery rows are inserted AFTER their notification. Wait until the whole
 -- transaction is ready to commit before granting the canonical exception.
 IF TG_NAME<>'trg_accounting_push_after_delivery' AND NEW.type='accounting_invoice' THEN RETURN NEW; END IF;
 SELECT * INTO notice FROM public.notifications WHERE id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT d.invoice_id,d.recipient_id,d.delivery_mode,m.conversation_id,m.message_type,m.media_metadata,
  i.invoice_number,i.net_amount,i.invoice_type INTO receipt
 FROM public.accounting_invoice_deliveries d JOIN public.settlement_invoices i ON i.id=d.invoice_id
 JOIN public.social_messages m ON m.id=d.message_id WHERE d.notification_id=notice.id;
 IF FOUND THEN
  -- A real receipt foreign key, exact recipient and issued document are
  -- required. Arbitrary accounting-looking JSON cannot bypass normal caps.
  IF receipt.recipient_id IS DISTINCT FROM notice.user_id
   OR notice.data->>'invoice_id' IS DISTINCT FROM receipt.invoice_id::text
   OR notice.data->>'invoice_number' IS DISTINCT FROM receipt.invoice_number
   OR notice.data->'amount' IS DISTINCT FROM to_jsonb(receipt.net_amount)
   OR receipt.message_type IS DISTINCT FROM 'invoice'
   OR receipt.media_metadata->>'invoice_id' IS DISTINCT FROM receipt.invoice_id::text
   OR COALESCE(notice.data->>'conversation_id',notice.data->>'conversationId') IS DISTINCT FROM receipt.conversation_id::text
   OR NOT EXISTS(SELECT 1 FROM public.social_conversation_participants p WHERE p.conversation_id=receipt.conversation_id AND p.user_id=notice.user_id)
  THEN RAISE EXCEPTION 'accounting_push_receipt_provenance_invalid' USING ERRCODE='23514'; END IF;
  IF receipt.delivery_mode='weekly_detail' OR notice.type='accounting_invoice_detail' THEN
   state:='skipped';reason:='accounting_archived_detail';
  ELSIF notice.type IS DISTINCT FROM 'accounting_invoice' THEN
   RAISE EXCEPTION 'accounting_push_notification_type_invalid' USING ERRCODE='23514';
  ELSIF notice.data->>'_push' IS NOT NULL THEN
   state:='skipped';reason:='accounting_source_suppressed:'||(notice.data->>'_push');
  ELSIF notice.created_at<now()-c_max_age THEN
   state:='skipped';reason:='accounting_historical_notification';
  ELSIF notice.user_id='47965354-0e56-43ef-931c-ddaab82af765'::uuid
   AND NOT (receipt.invoice_type='cashier_cashout' AND receipt.media_metadata->'cashier'->>'event_kind'='hold'
            AND receipt.media_metadata->'cashier'->>'assigned_agent_id'=notice.user_id::text) THEN
   -- Same owner-operational recipient fn_is_owner_operational_notification()
   -- hard-codes (kept as a literal here, not a shared call, because that
   -- classifier also gates on p_type and would return false for
   -- 'accounting_invoice' -- this is not a second source of truth for WHO
   -- the owner is, only a second reference to the same fixed id). This is
   -- his issuer-side owner/union-owner copy of a receipt whose real payee is
   -- someone else; it must NOT be added to fn_is_owner_operational_
   -- notification's type list, or the capture trigger fires once per
   -- receipt (hundreds per settlement) instead of once per hour, and the
   -- non-accounting mirror predicate below would wrongly suppress it too.
   state:='skipped';reason:='owner_accounting_routed_to_production_alerts';
  END IF;
  SELECT * INTO existing FROM public.push_outbox WHERE accounting_notification_id=notice.id;
  IF FOUND THEN
   IF existing.recipient_user_id IS DISTINCT FROM notice.user_id OR existing.related_entity_id IS DISTINCT FROM notice.id
    OR existing.event IS DISTINCT FROM 'accounting_invoice' THEN RAISE EXCEPTION 'accounting_push_receipt_collision' USING ERRCODE='23514'; END IF;
   IF receipt.invoice_type IN('cashier_cashout','accounting_correction','credit_limit_change') AND ROW(existing.title,existing.body,existing.url,existing.tag) IS DISTINCT FROM
     ROW(left(notice.title,120),left(COALESCE(notice.message,notice.title),500),
       COALESCE(NULLIF(btrim(notice.link),''),NULLIF(btrim(notice.action_url),''),'/hub'),
       'accounting_invoice:'||receipt.conversation_id::text)
   THEN RAISE EXCEPTION 'cashier_push_content_mismatch' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  -- No exception swallowing here. The invoice, message, notification, linked
  -- transfer and durable outbox receipt commit together or all roll back.
  -- Normal dispatcher preference, quiet-hour, device and consent gates remain.
  INSERT INTO public.push_outbox(recipient_user_id,title,body,url,event,tag,status,failure_reason,related_entity_id,accounting_notification_id)
  VALUES(notice.user_id,left(notice.title,120),left(COALESCE(notice.message,notice.title),500),
   COALESCE(NULLIF(btrim(notice.link),''),NULLIF(btrim(notice.action_url),''),'/hub'),
   'accounting_invoice','accounting_invoice:'||receipt.conversation_id::text,state,reason,notice.id,notice.id);
  IF reason='owner_accounting_routed_to_production_alerts' THEN
   -- Informational only, coalesced to one row per UTC hour. Must never be
   -- able to roll back the invoice/message/notification/outbox insert above.
   BEGIN
    PERFORM public.fn_record_operational_alert('owner-accounting-notifications',
     'owner-accounting:'||to_char(date_trunc('hour',now() AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24'),
     'Accounting Documents Issued (Owner Copy)','info','info',
     jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','first_notification_id',notice.id,'invoice_number',receipt.invoice_number,
      'invoice_type',receipt.invoice_type,'amount',receipt.net_amount,
      'conversation_id',receipt.conversation_id,
      'hour',to_char(date_trunc('hour',now() AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24')));
   EXCEPTION WHEN OTHERS THEN
    -- The store refused the hour's event (operational_alert_events refuses an
    -- unaddressed row under this source) or could not take it. A WARNING
    -- reaches nobody, so the fleet gets its own addressed row for the hour,
    -- from a nested block: that can fail too, and still never rolls back the
    -- document above or touches the receipt this branch already wrote.
    GET STACKED DIAGNOSTICS v_alert_state=RETURNED_SQLSTATE,v_alert_error=MESSAGE_TEXT,v_alert_constraint=CONSTRAINT_NAME;
    RAISE WARNING 'owner_accounting_alert_record_failed for notification %: %',notice.id,v_alert_error;
    BEGIN
     PERFORM public.fn_record_operational_alert('owner-accounting-notifications',
      'owner-accounting-unstored:'||to_char(date_trunc('hour',now() AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24'),
      'Owner Accounting Alert Not Stored','firing','warning',
      jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','unstored_event_key',
       'owner-accounting:'||to_char(date_trunc('hour',now() AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24'),
       'first_notification_id',notice.id,'sqlstate',v_alert_state,'error',left(v_alert_error,1000),
       'constraint',NULLIF(v_alert_constraint,''),
       'hour',to_char(date_trunc('hour',now() AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24')));
    EXCEPTION WHEN OTHERS THEN
     RAISE WARNING 'owner_accounting_alert_unstored_record_failed for notification %: %',notice.id,SQLERRM;
    END;
   END;
  END IF;
  IF receipt.invoice_type IN('cashier_cashout','accounting_correction','credit_limit_change') AND NOT EXISTS(SELECT 1 FROM public.push_outbox o
    WHERE o.accounting_notification_id=notice.id AND o.related_entity_id=notice.id
      AND o.recipient_user_id=notice.user_id AND o.event='accounting_invoice'
      AND o.status=state AND o.failure_reason IS NOT DISTINCT FROM reason
      AND o.title=left(notice.title,120) AND o.body=left(COALESCE(notice.message,notice.title),500)
      AND o.url=COALESCE(NULLIF(btrim(notice.link),''),NULLIF(btrim(notice.action_url),''),'/hub')
      AND o.tag='accounting_invoice:'||receipt.conversation_id::text)
  THEN RAISE EXCEPTION 'cashier_push_receipt_missing' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;

 -- A reserved accounting label with no actual delivery link is invalid,
 -- including a caller that forces this constraint before the link is written.
 -- Fail the transaction rather than silently dropping its accounting push.
 IF notice.type='accounting_invoice' THEN
  RAISE EXCEPTION 'accounting_push_delivery_link_missing' USING ERRCODE='23514';
 END IF;
 IF notice.type='accounting_invoice_detail' THEN RETURN NEW; END IF;
 -- Existing non-accounting notification policy stays intact.
 IF notice.data IS NOT NULL AND notice.data->>'_push' IS NOT NULL THEN RETURN NEW; END IF;
 IF notice.user_id IS NULL OR notice.title IS NULL OR btrim(notice.title)='' THEN RETURN NEW; END IF;
 IF notice.created_at IS NOT NULL AND notice.created_at<now()-c_max_age THEN RETURN NEW; END IF;
 IF notice.type IN('waitlist_seat_open','waitlist_offer_expired','seat_available','waitlist_ready','table_ready') THEN
  v_tag:='seat_offer:'||COALESCE(NULLIF(btrim(COALESCE(notice.data->>'table_id','')),''),notice.id::text);
 ELSIF notice.type IN('system','daily_challenge','venue_alert','bonus','vip','live','poker_news','diamond','achievement') THEN
  v_tag:=notice.type||':'||notice.user_id::text;
 ELSE
  v_tag:=notice.type||':'||COALESCE(NULLIF(btrim(COALESCE(notice.data->>'conversationId','')),''),NULLIF(btrim(COALESCE(notice.data->>'conversation_id','')),''),notice.actor_id::text,notice.id::text);
 END IF;
 BEGIN
  SELECT count(*) INTO v_pending FROM public.push_outbox WHERE recipient_user_id=notice.user_id AND status IN('pending','processing');
  IF v_pending>=c_max_pending THEN RETURN NEW; END IF;
  INSERT INTO public.push_outbox(recipient_user_id,title,body,url,event,tag,status,related_entity_id)
   VALUES(notice.user_id,left(notice.title,120),left(COALESCE(notice.message,notice.title),500),COALESCE(NULLIF(btrim(notice.link),''),NULLIF(btrim(notice.action_url),''),'/hub'),notice.type,v_tag,'pending',notice.id);
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'mirror_notification_to_push_outbox failed for notification %: %',notice.id,SQLERRM;
 END;
 RETURN NEW;
END $function$

;
