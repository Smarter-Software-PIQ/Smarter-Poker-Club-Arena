-- 20261124152017_fix_digest_cash_residual_alert_proofs_and_cron_freeze.sql
--
-- Permanent hard-coded SQL root-cause fixes for:
--   1. daily_chip_reconciliation & house_figures midnight post-commit banking
--      boundary (+$4.40 / -$4.40 cash_residual split across Chicago days).
--      Attribute cash_rake (chip_ledger) and bbj (bbj_contributions) to the
--      Chicago day the hand ended (ca_hand_facts.played_at via materialized
--      cash_hands) while preserving indexed range scans and Diamond Arena NULL
--      safety; align fn_sp_digest_house_figures with sp_digest_daily_results_snapshots.
--   2. OpenClawOperationalAlert recovery-twin double-counting (1 of 2 -> 2 of 2)
--      in fn_sp_daily_metrics_compute, fn_sp_digest_attention, and
--      fn_sp_original_alert_proof (strictly scoped to source='openclaw').
--   3. WeeklyPayoutNotReadyHalfHourBefore (and sibling weekly-payout alerts)
--      receipt-based proof in fn_sp_original_alert_proof, removal of
--      'weekly-payout' from reliability_sources_without_resolve, weekly-payout
--      branch in reliability_proved_source_resolution, and guarded
--      reliability_transition of already-received proved stale_unverified rows.
--   4. pg_cron launcher freeze (06:40Z 157.6s PQgetResult block caused by
--      multi-statement commands + NOTICE flushing CommandComplete("SET")) and
--      continuous hand_history / hand_state_snapshots pruning I/O storm:
--      - Quiet fn_ca_ledger_replay(integer) (SET client_min_messages='warning'),
--        wrap cron #286 in smarter_private.fn_ca_ledger_replay_cron_tick() with
--        client_min_messages='error' and stagger schedule 40 6 -> 23 6 * * *.
--      - Wrap cron #155 in smarter_private.fn_rake_bbj_audit_cron_tick() with
--        client_min_messages='error' and armed statement_timeout='300s'.
--      - Bound sp_prune_hand_history(integer) page cap 250 -> 75 (+ SET
--        statement_timeout='20s'), wrap cron #117 in single-statement
--        CALL smarter_private.sp_prune_hand_history_cron_tick(), stagger
--        schedule 10 seconds -> 30 seconds.
--      - Bound sp_prune_hand_state_snapshots(integer) v_page 1000 -> 125 and
--        v_deadline 20s -> 8s (+ SET statement_timeout='20s'), wrap cron #119
--        in smarter_private.fn_prune_hand_state_snapshots_cron_tick() with
--        client_min_messages='error' and armed statement_timeout='20s'.
--
-- @probe-exempt: public.fn_sp_digest_daily_results_compute scans daily ca_hand_facts, chip_ledger and tournaments (~20-35s on production, past the 12s install budget); verified by md5 postimage read-back and native PG17 proof
-- @probe-exempt: public.fn_sp_daily_metrics_compute scans every table of the day (238-264s on production, past the 12s install budget); verified by md5 postimage read-back and native PG17 proof
-- @probe-exempt: public.sp_prune_hand_history locks hand_history_prune_cursor and takes retention advisory locks; verified by md5 postimage read-back and native PG17 proof
-- @probe-exempt: smarter_private.fn_ca_ledger_replay_cron_tick invokes fn_ca_ledger_replay(5000) (~150s on production, past the 12s install budget); verified on native PG17 proof
-- @probe-exempt: smarter_private.fn_rake_bbj_audit_cron_tick invokes fn_rake_bbj_audit(2) (~160-208s on production, past the 12s install budget); verified on native PG17 proof
-- @probe-exempt: smarter_private.fn_prune_hand_state_snapshots_cron_tick invokes sp_prune_hand_state_snapshots(10000) (up to 8s); sp_prune_hand_state_snapshots(1) is probed directly and wrapper is verified on native PG17 proof
-- @live-proof: md5(pg_get_functiondef('public.fn_sp_digest_daily_results_compute(date)'::regprocedure)) = '5eaa7fcdc0a278ba3a5cf497ece09d38'
-- @live-proof: md5(pg_get_functiondef('public.fn_sp_digest_house_figures(date)'::regprocedure)) = '421e7f6f2f1318c8a60eb1f18680b7dd'
-- @live-proof: md5(pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure)) = 'c932a574b496b1743e7d921e2bb96fee'
-- @live-proof: md5(pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure)) = 'f8b941a68e329ca4a026fe7a5d04ff28'
-- @live-proof: md5(pg_get_functiondef('public.fn_sp_original_alert_proof(bigint)'::regprocedure)) = 'd482e06ef00cc890029bbb054ca1402b'
-- @live-proof: md5(pg_get_functiondef('smarter_private.reliability_proved_source_resolution(uuid)'::regprocedure)) = '205f565996a8e5b6b4c2205f2c229527'
-- @live-proof: md5(pg_get_functiondef('public.sp_prune_hand_history(integer)'::regprocedure)) = 'da9a24d97cd0d9c8ebba0a3031c0061e'
-- @live-proof: md5(pg_get_functiondef('public.sp_prune_hand_state_snapshots(integer)'::regprocedure)) = '5f12ac91b56a98ca57128349d2c2c233'
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_ledger_replay(integer)'::regprocedure)) = '90e4b668d1327645c6c704a444fe86bf'
-- @live-proof: NOT EXISTS (SELECT 1 FROM smarter_private.reliability_sources_without_resolve WHERE source = 'weekly-payout')
-- @live-proof: NOT EXISTS (SELECT 1 FROM smarter_private.reliability_incidents i WHERE i.status = 'stale_unverified' AND i.source = 'weekly-payout' AND smarter_private.reliability_proved_source_resolution(i.id))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '8s';

CREATE FUNCTION pg_temp.fix_subst(
  p_sig text,
  p_before text,
  p_after text,
  p_old text[],
  p_new text[],
  p_counts integer[],
  p_allow_cfg_change boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $h$
DECLARE
  v_def text;
  v_new text;
  v_n integer;
  i integer;
  v_acl text;
  v_owner text;
  v_secdef boolean;
  v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned preimage (md5 %)', p_sig, md5(v_def);
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1)
     OR array_length(p_old, 1) IS DISTINCT FROM array_length(p_counts, 1) THEN
    RAISE EXCEPTION '%: anchors, replacements and counts do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> p_counts[i] THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected %', p_sig, i, v_n, p_counts[i];
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;
  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;
  EXECUTE v_new;
  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: replaced function does not read back as postimage (md5 %)',
      p_sig, md5(pg_get_functiondef(p_sig::regprocedure));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = p_sig::regprocedure
       AND p.proacl::text IS NOT DISTINCT FROM v_acl
       AND pg_get_userbyid(p.proowner) = v_owner
       AND p.prosecdef = v_secdef
       AND (p_allow_cfg_change OR p.proconfig IS NOT DISTINCT FROM v_cfg)
  ) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

-- ── 1. daily_chip_reconciliation & house_figures midnight banking boundary ───

SELECT pg_temp.fix_subst(
  'public.fn_sp_digest_daily_results_compute(date)',
  'd1431c83171b53c6c1210d08cd5567e4', '5eaa7fcdc0a278ba3a5cf497ece09d38',
  ARRAY[
$o1$), tday AS MATERIALIZED ($o1$,
$o2$ SELECT COALESCE((SELECT sum(amount) FROM ledger WHERE category='rake' AND from_type='table_stack'),0) cash_rake,
 COALESCE((SELECT sum(amount) FROM ledger WHERE category='rake' AND from_type='prize_liability'),0) tournament_rake,
 COALESCE((SELECT sum(b.amount) FROM public.bbj_contributions b,win WHERE b.created_at>=win.s AND b.created_at<win.e AND b.club_id IS DISTINCT FROM win.da),0) bbj,$o2$
  ],
  ARRAY[
$n1$), cash_hands AS MATERIALIZED (
 SELECT DISTINCT hand_id FROM facts
), tday AS MATERIALIZED ($n1$,
$n2$ SELECT COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l,win WHERE l.created_at>=win.s AND l.created_at<win.e+interval '24 hours' AND l.status='posted' AND l.club_id IS DISTINCT FROM win.da AND l.from_type='table_stack' AND (l.category='rake' OR (l.category='burn' AND l.to_type='chip_retirement')) AND ((l.hand_id IS NULL AND l.created_at<win.e) OR l.hand_id IN (SELECT hand_id FROM cash_hands))),0) cash_rake,
 COALESCE((SELECT sum(amount) FROM ledger WHERE category='rake' AND from_type='prize_liability'),0) tournament_rake,
 COALESCE((SELECT sum(b.amount) FROM public.bbj_contributions b,win WHERE b.created_at>=win.s AND b.created_at<win.e+interval '24 hours' AND b.club_id IS DISTINCT FROM win.da AND ((b.hand_id IS NULL AND b.created_at<win.e) OR b.hand_id IN (SELECT hand_id FROM cash_hands))),0) bbj,$n2$
  ],
  ARRAY[1, 1]
);

SELECT pg_temp.fix_subst(
  'public.fn_sp_digest_house_figures(date)',
  '31b4231617a7e7c2f35f0834a7a52f66', '421e7f6f2f1318c8a60eb1f18680b7dd',
  ARRAY[
$o1$ SELECT m.day,
 COALESCE((m.metrics#>>'{money,bbj_contributions}')::numeric,0) bbj,
 COALESCE((m.metrics#>>'{money,cash_rake}')::numeric,0) cash_rake,
 (m.metrics#>>'{play,horse_net_bb}')::numeric horse_net_bb_utc
 FROM public.sp_daily_metrics m, win
 WHERE m.day BETWEEN LEAST(win.wk,win.mo) AND win.d$o1$
  ],
  ARRAY[
$n1$ SELECT m.day,
 COALESCE((dr.result->'reconciliation'->>'bbj')::numeric,(m.metrics#>>'{money,bbj_contributions}')::numeric,0) bbj,
 COALESCE((dr.result->'reconciliation'->>'cash_rake')::numeric,(m.metrics#>>'{money,cash_rake}')::numeric,0) cash_rake,
 (m.metrics#>>'{play,horse_net_bb}')::numeric horse_net_bb_utc
 FROM public.sp_daily_metrics m CROSS JOIN win
 LEFT JOIN public.sp_digest_daily_results_snapshots dr ON dr.day=m.day
 WHERE m.day BETWEEN LEAST(win.wk,win.mo) AND win.d$n1$
  ],
  ARRAY[1]
);

-- ── 2. OpenClaw recovery-twin exclusion & 3. weekly-payout receipt proof ─────

SELECT pg_temp.fix_subst(
  'public.fn_sp_daily_metrics_compute(date)',
  'defe7f21cf46a34c59ff1d374b455e25', 'c932a574b496b1743e7d921e2bb96fee',
  ARRAY[
$o1$NOT COALESCE((source LIKE 'local.%-runtime' AND status='resolved' AND jsonb_typeof(payload->'resolves')='string'),false)$o1$
  ],
  ARRAY[
$n1$NOT COALESCE((source LIKE 'local.%-runtime' AND status='resolved' AND jsonb_typeof(payload->'resolves')='string') OR (source='openclaw' AND status='resolved' AND NOT (payload ? 'resolved_at') AND (jsonb_typeof(payload->'resolves')='string' OR COALESCE(payload->>'message','') ~* '(^✅|\yRECOVERED\y)')),false)$n1$
  ],
  ARRAY[4]
);

SELECT pg_temp.fix_subst(
  'public.fn_sp_digest_attention(date,jsonb)',
  '37787e6b6afcf24e0289741858ebb855', 'f8b941a68e329ca4a026fe7a5d04ff28',
  ARRAY[
$o1$NOT COALESCE((source LIKE 'local.%-runtime' AND status='resolved' AND jsonb_typeof(payload->'resolves')='string'),false) AS failure_observation$o1$
  ],
  ARRAY[
$n1$NOT COALESCE((source LIKE 'local.%-runtime' AND status='resolved' AND jsonb_typeof(payload->'resolves')='string') OR (source='openclaw' AND status='resolved' AND NOT (payload ? 'resolved_at') AND (jsonb_typeof(payload->'resolves')='string' OR COALESCE(payload->>'message','') ~* '(^✅|\yRECOVERED\y)')),false) AS failure_observation$n1$
  ],
  ARRAY[1]
);

SELECT pg_temp.fix_subst(
  'public.fn_sp_original_alert_proof(bigint)',
  'eaf7347f7c480c46d043c0cfd00789f8', 'd482e06ef00cc890029bbb054ca1402b',
  ARRAY[
$o1$    IF FOUND THEN kind:='midway_slot_receipt'; reference:='Completed original Midway slot with terminal receipt '||witness; END IF;
  END IF;$o1$
  ],
  ARRAY[
$n1$    IF FOUND THEN kind:='midway_slot_receipt'; reference:='Completed original Midway slot with terminal receipt '||witness; END IF;
  ELSIF original.source='openclaw' AND original.status='resolved'
    AND NOT (original.payload ? 'resolved_at')
    AND (jsonb_typeof(original.payload->'resolves')='string'
         OR COALESCE(original.payload->>'message','') ~* '(^✅|\yRECOVERED\y)') THEN
    SELECT f.id::text INTO witness FROM public.operational_alert_events f
    WHERE f.source='openclaw' AND f.id<>original.id
      AND f.status='resolved' AND f.investigation_status='verified_fixed'
      AND (f.payload->>'resolved_by_event'=original.id::text
        OR (jsonb_typeof(original.payload->'resolves')='string'
            AND f.event_key=original.payload->>'resolves'))
    ORDER BY f.id DESC LIMIT 1;
    IF FOUND THEN kind:='openclaw_recovery_twin'; reference:='Recovery twin of verified OpenClaw alert '||witness; END IF;
  ELSIF original.source='weekly-payout'
    AND original.alertname IN ('WeeklyPayoutNotReadyHalfHourBefore','WeeklyPayoutSlotRefused','WeeklyPayoutScopeDeferred','WeeklyPayoutScopeMoneyStatementLost')
    AND original.status='resolved'
    AND pg_input_is_valid(original.payload->>'period_end','timestamp with time zone')
    AND pg_input_is_valid(original.payload->>'resolved_at','timestamp with time zone')
    AND (original.payload->>'resolved_at')::timestamptz>=original.received_at THEN
    IF (SELECT count(DISTINCT u.milestone) FROM smarter_private.weekly_payout_owner_updates u
         WHERE u.period_end=(original.payload->>'period_end')::timestamptz
           AND u.milestone IN ('agents_paid','clubs_paid','players_paid')
           AND u.sent_at>=original.received_at)=3
       AND (CASE WHEN jsonb_typeof(original.payload->'scopes')='array' AND jsonb_array_length(original.payload->'scopes')>0 THEN
              NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(original.payload->'scopes') s
                CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(s->'scope')='object' THEN s->'scope' ELSE s END AS sc) x
                WHERE NOT (
                  NULLIF(x.sc->>'kind','') IS NOT NULL
                  AND pg_input_is_valid(x.sc->>'id','uuid')
                  AND pg_input_is_valid(COALESCE(x.sc->>'period_end',original.payload->>'period_end'),'timestamp with time zone')
                  AND EXISTS (
                    SELECT 1 FROM public.union_accounting_runs r
                    WHERE r.scope_kind=x.sc->>'kind'
                      AND r.scope_id=(x.sc->>'id')::uuid
                      AND r.period_end=COALESCE(x.sc->>'period_end',original.payload->>'period_end')::timestamptz
                      AND r.status='complete'
                      AND r.finished_at>=original.received_at
                      AND COALESCE((r.result->>'success')::boolean,false)
                  )
                )
              )
            ELSE
              EXISTS (
                SELECT 1 FROM public.union_accounting_runs r
                WHERE r.period_end=(original.payload->>'period_end')::timestamptz
                  AND r.status='complete'
                  AND r.finished_at>=original.received_at
                  AND COALESCE((r.result->>'success')::boolean,false)
              )
            END) THEN
      kind:='weekly_payout_paid_receipt';
      reference:='Weekly payout paid and accounting run completed for period_end '||(original.payload->>'period_end');
    ELSIF jsonb_typeof(original.payload->'scopes')='array'
      AND jsonb_array_length(original.payload->'scopes')>0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(original.payload->'scopes') s
        CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(s->'scope')='object' THEN s->'scope' ELSE s END AS sc) x
        WHERE NOT (
          NULLIF(x.sc->>'kind','') IS NOT NULL
          AND pg_input_is_valid(x.sc->>'id','uuid')
          AND pg_input_is_valid(x.sc->>'period_start','timestamp with time zone')
          AND pg_input_is_valid(COALESCE(x.sc->>'period_end',original.payload->>'period_end'),'timestamp with time zone')
          AND smarter_private.weekly_prepared_payout_plans(
                x.sc->>'kind',
                (x.sc->>'id')::uuid,
                (x.sc->>'period_start')::timestamptz,
                COALESCE(x.sc->>'period_end',original.payload->>'period_end')::timestamptz
              ) IS TRUE
        )
      ) THEN
      kind:='weekly_payout_ready_receipt';
      reference:='Weekly payout prepared plans verified ready for period_end '||(original.payload->>'period_end');
    END IF;
  END IF;$n1$
  ],
  ARRAY[1]
);

DELETE FROM smarter_private.reliability_sources_without_resolve
 WHERE source = 'weekly-payout';

SELECT pg_temp.fix_subst(
  'smarter_private.reliability_proved_source_resolution(uuid)',
  'bb4e07bc55faff6411be487d464ba1be', '205f565996a8e5b6b4c2205f2c229527',
  ARRAY[
$o1$i.source IN ('owner-operational-notifications','sp-critical-pager','sp-daily-digest','ca-stall-watch')$o1$,
$o2$           OR (e.source='ca-stall-watch' AND e.alertname='TableStoppedDealing'
               AND pg_input_is_valid(e.payload->>'table_id','uuid')
               AND (NOT EXISTS (SELECT 1 FROM public.tables tb
                     WHERE tb.id=(e.payload->>'table_id')::uuid AND coalesce(tb.lifecycle,'')<>'closed'
                       AND tb.status IN ('waiting','running','active') AND NOT coalesce(tb.is_deleted,false))
                 OR EXISTS (SELECT 1 FROM public.hand_history h
                     WHERE h.table_id=(e.payload->>'table_id')::uuid AND h.created_at>m.last_firing_at))))));$o2$
  ],
  ARRAY[
$n1$i.source IN ('owner-operational-notifications','sp-critical-pager','sp-daily-digest','ca-stall-watch','weekly-payout')$n1$,
$n2$           OR (e.source='ca-stall-watch' AND e.alertname='TableStoppedDealing'
               AND pg_input_is_valid(e.payload->>'table_id','uuid')
               AND (NOT EXISTS (SELECT 1 FROM public.tables tb
                     WHERE tb.id=(e.payload->>'table_id')::uuid AND coalesce(tb.lifecycle,'')<>'closed'
                       AND tb.status IN ('waiting','running','active') AND NOT coalesce(tb.is_deleted,false))
                 OR EXISTS (SELECT 1 FROM public.hand_history h
                     WHERE h.table_id=(e.payload->>'table_id')::uuid AND h.created_at>m.last_firing_at)))
           OR (e.source='weekly-payout'
               AND e.alertname IN ('WeeklyPayoutNotReadyHalfHourBefore','WeeklyPayoutSlotRefused','WeeklyPayoutScopeDeferred','WeeklyPayoutScopeMoneyStatementLost')
               AND public.fn_sp_original_alert_proof(e.id)->>'kind' IN ('weekly_payout_paid_receipt','weekly_payout_ready_receipt')))));$n2$
  ],
  ARRAY[1, 1]
);

DO $received_weekly_payout_resolutions$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.id
      FROM smarter_private.reliability_incidents i
     WHERE i.status = 'stale_unverified'
       AND i.source = 'weekly-payout'
       AND smarter_private.reliability_proved_source_resolution(i.id)
     ORDER BY i.id
       FOR UPDATE OF i
  LOOP
    PERFORM smarter_private.reliability_transition(
      r.id,
      'verifying',
      'proved weekly payout receipt already received',
      jsonb_build_object('kind', 'resolved_signal', 'basis', 'proved_weekly_payout_receipt')
    );
  END LOOP;
END $received_weekly_payout_resolutions$;

-- ── 4. Eliminate 06:40Z pg_cron launcher freeze & pruning I/O storm ──────────

SELECT pg_temp.fix_subst(
  'public.sp_prune_hand_history(integer)',
  '637890ae88e74d2cc436f2ca602843f3', 'da9a24d97cd0d9c8ebba0a3031c0061e',
  ARRAY[
$o1$ SET search_path TO 'public', 'pg_temp'
AS $function$$o1$,
$o2$LIMIT LEAST(GREATEST(p_batch,1),250)$o2$
  ],
  ARRAY[
$n1$ SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$$n1$,
$n2$LIMIT LEAST(GREATEST(p_batch,1),75)$n2$
  ],
  ARRAY[1, 2],
  true
);

SELECT pg_temp.fix_subst(
  'public.sp_prune_hand_state_snapshots(integer)',
  '8c5c03bd932747bd926670d1b8eb5581', '5f12ac91b56a98ca57128349d2c2c233',
  ARRAY[
$o1$ SET search_path TO 'public'
AS $function$$o1$,
$o2$v_deadline timestamptz := clock_timestamp() + interval '20 seconds';$o2$,
$o3$v_page := LEAST(1000, v_limit - v_seen);$o3$
  ],
  ARRAY[
$n1$ SET search_path TO 'public'
 SET statement_timeout TO '20s'
AS $function$$n1$,
$n2$v_deadline timestamptz := clock_timestamp() + interval '8 seconds';$n2$,
$n3$v_page := LEAST(125, v_limit - v_seen);$n3$
  ],
  ARRAY[1, 1, 1],
  true
);

-- Quiet fn_ca_ledger_replay's five DROP TABLE IF EXISTS temp-table NOTICEs
-- without modifying its body (preserving every ledger-replay law pin).
DO $quiet_ledger_replay$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef('public.fn_ca_ledger_replay(integer)'::regprocedure));
  IF v_md5 = '90e4b668d1327645c6c704a444fe86bf' THEN
    RETURN;
  END IF;
  IF v_md5 IS DISTINCT FROM 'a6dd975e58b6dd8043d2771d9505fc6d' THEN
    RAISE EXCEPTION 'public.fn_ca_ledger_replay(integer) preimage drifted (md5 %)', v_md5;
  END IF;
  ALTER FUNCTION public.fn_ca_ledger_replay(integer) SET client_min_messages = 'warning';
  IF md5(pg_get_functiondef('public.fn_ca_ledger_replay(integer)'::regprocedure))
     IS DISTINCT FROM '90e4b668d1327645c6c704a444fe86bf' THEN
    RAISE EXCEPTION 'public.fn_ca_ledger_replay(integer) postimage mismatch (md5 %)',
      md5(pg_get_functiondef('public.fn_ca_ledger_replay(integer)'::regprocedure));
  END IF;
END $quiet_ledger_replay$;

-- Wrapper functions & procedure for pg_cron jobs (#286, #155, #117, #119).
CREATE OR REPLACE FUNCTION smarter_private.fn_ca_ledger_replay_cron_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'smarter_private'
SET client_min_messages TO 'warning'
SET statement_timeout TO '540s'
AS $fn$
BEGIN
  IF pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('ca-ledger-replay')) THEN
    RETURN (public.fn_ca_ledger_replay(5000))::text;
  END IF;
  RETURN 'locked';
END;
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_ledger_replay_cron_tick() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION smarter_private.fn_rake_bbj_audit_cron_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'smarter_private'
SET client_min_messages TO 'warning'
SET statement_timeout TO '300s'
AS $fn$
BEGIN
  IF pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('rake-bbj-invariant-audit')) THEN
    RETURN (public.fn_rake_bbj_audit(2))::text;
  END IF;
  RETURN 'skipped: previous run still in progress';
END;
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_rake_bbj_audit_cron_tick() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION smarter_private.fn_prune_hand_state_snapshots_cron_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'smarter_private'
SET client_min_messages TO 'warning'
SET statement_timeout TO '20s'
AS $fn$
BEGIN
  IF pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('sp-prune-hand-state-snapshots')) THEN
    RETURN (public.sp_prune_hand_state_snapshots(10000) >= 0)::text;
  END IF;
  RETURN 'skipped: previous run still in progress';
END;
$fn$;
REVOKE ALL ON FUNCTION smarter_private.fn_prune_hand_state_snapshots_cron_tick() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE PROCEDURE smarter_private.sp_prune_hand_history_cron_tick()
LANGUAGE plpgsql
AS $proc$
BEGIN
  COMMIT;
  IF pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('sp-prune-hand-history')) THEN
    PERFORM public.sp_prune_hand_history(5000);
  END IF;
  COMMIT;
  PERFORM smarter_private.progress_superseded_action_retention();
  COMMIT;
  PERFORM smarter_private.discover_superseded_action_retention();
  COMMIT;
END;
$proc$;
REVOKE ALL ON PROCEDURE smarter_private.sp_prune_hand_history_cron_tick() FROM PUBLIC, anon, authenticated, service_role;

-- Alter the four existing pg_cron jobs cleanly via cron.alter_job (no new jobs).
DO $alter_cron_jobs$
DECLARE
  v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL
     OR to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'cron.job or cron.alter_job is missing';
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'ca-ledger-replay-nightly';
  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'cron job ca-ledger-replay-nightly not found';
  END IF;
  PERFORM cron.alter_job(
    v_jobid,
    schedule := '23 6 * * *',
    command  := $cmd$SET client_min_messages = 'error'; SET statement_timeout = '600s'; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; SELECT smarter_private.fn_ca_ledger_replay_cron_tick();$cmd$
  );

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'rake-bbj-invariant-audit-hourly';
  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'cron job rake-bbj-invariant-audit-hourly not found';
  END IF;
  PERFORM cron.alter_job(
    v_jobid,
    command := $cmd$SET client_min_messages = 'error'; SET statement_timeout = '300s'; SELECT smarter_private.fn_rake_bbj_audit_cron_tick();$cmd$
  );

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sp_prune_hand_history_10m';
  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'cron job sp_prune_hand_history_10m not found';
  END IF;
  PERFORM cron.alter_job(
    v_jobid,
    schedule := '30 seconds',
    command  := $cmd$CALL smarter_private.sp_prune_hand_history_cron_tick();$cmd$
  );

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sp_prune_hand_state_snapshots_2m';
  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'cron job sp_prune_hand_state_snapshots_2m not found';
  END IF;
  PERFORM cron.alter_job(
    v_jobid,
    command := $cmd$SET client_min_messages = 'error'; SET statement_timeout = '20s'; SELECT smarter_private.fn_prune_hand_state_snapshots_cron_tick();$cmd$
  );
END $alter_cron_jobs$;

-- Verify preserved invariants across all spliced functions before COMMIT.
DO $verify_invariants$
BEGIN
  IF position('max_degraded_run' in pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'fn_sp_daily_metrics_compute lost max_degraded_run';
  END IF;
  IF position('max_degraded_run' in pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure)) = 0
     OR position('drift_incident:|financial_alerts:' in pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'fn_sp_digest_attention lost preserved guards';
  END IF;
  IF position('horse_retention_days' in pg_get_functiondef('public.sp_prune_hand_history(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'sp_prune_hand_history lost horse_retention_days policy read';
  END IF;
END $verify_invariants$;

-- Pre-commit rolled-back probes for fast modified functions.
-- @probe-for: public.fn_sp_digest_house_figures
DO $probe$
BEGIN
  PERFORM public.fn_sp_digest_house_figures(DATE '2099-01-01');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_sp_digest_attention
DO $probe$
BEGIN
  PERFORM public.fn_sp_digest_attention(DATE '2099-01-01', '{}'::jsonb);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_sp_original_alert_proof
DO $probe$
BEGIN
  PERFORM public.fn_sp_original_alert_proof(-1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: smarter_private.reliability_proved_source_resolution
DO $probe$
BEGIN
  PERFORM smarter_private.reliability_proved_source_resolution('00000000-0000-0000-0000-000000000000'::uuid);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.sp_prune_hand_state_snapshots
DO $probe$
BEGIN
  PERFORM public.sp_prune_hand_state_snapshots(1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
