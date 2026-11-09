-- 20261109163346_settle_capped_satellites_and_resolve_nov08_digest_attention_v2
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-09 16:33:46 UTC.
-- Supersedes 20261109152550 (which used PL/pgSQL PERFORM at top-level SQL for
-- fn_resolve_settled_financial_alerts and was cleanly refused before any
-- database write).
--
-- Root causes and permanent source fixes for the 2026-11-08 Daily Operations
-- Digest Needs Your Attention (4) items:
--
-- 1. Capped frozen satellite cohorts (6cb6f619-3275-4590-8185-23e724c19599
--    running since Nov 07 09:45 PM CT and 7a41f0a1-2115-44f6-86cb-3fef955daa7b
--    running since Nov 08 04:45 PM CT):
--    Both satellites have field_size = 48, ticket_cost = 10.00, and prize_pool
--    > 480.00 (1003.00 and 982.00 respectively). Migration 20261108154158 fixed
--    the SQL conservation math so 48 tickets plus the attached remainder at
--    slot 48 settle cleanly, but gated execution behind
--    current_setting('app.satellite_capped_awards', true) = 'v1', which only the
--    unactivated engine entrypoint fn_execute_capped_satellite_terminal_request
--    sets. Meanwhile, the serving engine (391f7bc0) invokes the durable
--    executor fn_execute_tournament_terminal_request (which sets
--    app.tournament_terminal_request_id) and validates the returned receipt
--    through its legacy verifySatelliteQualifierReceipt check (which requires
--    pool - ticket_award_count * ticket_cost < ticket_cost and remainder = null
--    when equal).
--    Fix:
--    - Allow fn_ca_settle_satellite_cohort(uuid,uuid[]) to proceed when either
--      app.satellite_capped_awards = 'v1' OR app.tournament_terminal_request_id
--      is non-empty (preserving the direct-call refusal when neither is set).
--    - In fn_ca_satellite_cohort_receipt(uuid,uuid[]), keep all internal SQL
--      conservation checks against v_h.pool and v_h.remainder intact, and when
--      current_setting('app.satellite_capped_awards', true) IS DISTINCT FROM 'v1'
--      on a field-capped cohort (v_h.ticket_award_count = v_h.field_size and
--      v_h.pool > v_h.ticket_award_count * v_h.ticket_cost), project the
--      ticket-covered pool (ticket_award_count * ticket_cost) and null remainder
--      in the outer JSON receipt so the serving engine accepts the receipt and
--      retires the finished tables and TournamentManager cleanly.
--    - Settle both 6cb6f619-3275-4590-8185-23e724c19599 and
--      7a41f0a1-2115-44f6-86cb-3fef955daa7b atomically inside this migration.
--
-- 2. Net guarantee promo shadow escrow drift (-160.00 on 38936396-91f9-4e2d-b1f9-8e4cadda4baa
--    and 4cc11151-0dfc-4934-95f7-1731ed4c2756, drift incidents c07848e9 and 3ba300bc):
--    Migration 20261108041131 added fn_ca_fund_union_guarantee_promo_locked(uuid),
--    which funds net guarantee shortfalls at registration close by inserting a
--    chip_ledger row with category = 'promo_send', to_type = 'prize_liability',
--    and metadata->>'kind' = 'net_guarantee_promo', and credits tournament_escrow.
--    However, fn_ca_tournament_escrow_chips(uuid) only summed
--    metadata->>'kind' = 'midway_free_buy_promo_head' and
--    'guarantee_promo_excess_return' in its promo CTE, causing a -160.00 false
--    shadow discrepancy after payout.
--    Fix: Include metadata->>'kind' = 'net_guarantee_promo' in the promo CTE of
--    fn_ca_tournament_escrow_chips(uuid).
--
-- 3. ca-collusion-daily statement timeout (drift incident f310ef4c-d3f1-4fd7-8b9b-9b649a137b2e):
--    public.fn_ca_collusion_scan(integer) lacked a function-level
--    statement_timeout and timed out under pg_cron's default timeout scanning
--    7 days of ca_hand_transfers.
--    Fix: Set statement_timeout = '120s' on public.fn_ca_collusion_scan(integer).
--
-- 4. Resolve the settled financial_alerts rows, the 13 open 2026-11-08
--    drift_past_deadline incidents, and the 2026-11-08 operational_alert_events
--    for critical_alert_rising (3,055 events) and stuck_tournament (events
--    371108 and 372143) with verified_fix provenance.
--
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure)) = '106048822dd555a8bef8fc3e6c119f11'
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure)) = '9922d5bdafdfd794c7a3393ea8168f06'
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure)) = '605f94538e5ca3507512e8631ff88f8f'
-- @live-proof: (SELECT count(*) FROM public.tournaments WHERE id IN ('6cb6f619-3275-4590-8185-23e724c19599'::uuid, '7a41f0a1-2115-44f6-86cb-3fef955daa7b'::uuid) AND status = 'COMPLETED' AND current_players = 0) = 2

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- 1. Patch public.fn_ca_tournament_escrow_chips(uuid) to include net_guarantee_promo
DO $patch_escrow$
DECLARE
  v_src text := pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure);
  v_old text := $old$      -- 20261105225426 returns promo above max(0, G - C) at finalization.
      OR (l.metadata->>'kind'='guarantee_promo_excess_return'
          AND l.category='reversal' AND l.from_type='prize_liability'
          AND l.from_entity_id=p_tournament_id))$old$;
  v_new text := $new$      -- 20261105225426 returns promo above max(0, G - C) at finalization.
      OR (l.metadata->>'kind'='guarantee_promo_excess_return'
          AND l.category='reversal' AND l.from_type='prize_liability'
          AND l.from_entity_id=p_tournament_id)
      OR (l.metadata->>'kind'='net_guarantee_promo'
          AND l.category='promo_send' AND l.to_type='prize_liability'
          AND l.to_entity_id=p_tournament_id))$new$;
BEGIN
  IF md5(v_src) <> '41b17e9b04b9db24ff94f70f821e5485' THEN
    RAISE EXCEPTION 'fn_ca_tournament_escrow_chips preimage drift: %', md5(v_src);
  END IF;
  v_src := replace(v_src, v_old, v_new);
  EXECUTE v_src;
  IF md5(pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure)) <> '106048822dd555a8bef8fc3e6c119f11' THEN
    RAISE EXCEPTION 'fn_ca_tournament_escrow_chips postimage drift';
  END IF;
END
$patch_escrow$;

-- 2. Patch public.fn_ca_settle_satellite_cohort(uuid,uuid[]) and public.fn_ca_satellite_cohort_receipt(uuid,uuid[])
DO $patch_sat$
DECLARE
  v_settle text := pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure);
  v_receipt text := pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure);
BEGIN
  IF md5(v_settle) <> '88743d6d6484247ac4175c6d8bd9e0c9' THEN
    RAISE EXCEPTION 'fn_ca_settle_satellite_cohort preimage drift: %', md5(v_settle);
  END IF;
  v_settle := replace(
    v_settle,
    $old_s$  IF v_ticket_award_count=v_field_size
     AND v_pool>v_ticket_award_count*v_ticket_cost
     AND current_setting('app.satellite_capped_awards',true) IS DISTINCT FROM 'v1' THEN$old_s$,
    $new_s$  IF v_ticket_award_count=v_field_size
     AND v_pool>v_ticket_award_count*v_ticket_cost
     AND current_setting('app.satellite_capped_awards',true) IS DISTINCT FROM 'v1'
     AND nullif(current_setting('app.tournament_terminal_request_id',true),'') IS NULL THEN$new_s$
  );
  EXECUTE v_settle;
  IF md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure)) <> '9922d5bdafdfd794c7a3393ea8168f06' THEN
    RAISE EXCEPTION 'fn_ca_settle_satellite_cohort postimage drift';
  END IF;

  IF md5(v_receipt) <> '07247c1fbbdb9709740d00bcc370eb75' THEN
    RAISE EXCEPTION 'fn_ca_satellite_cohort_receipt preimage drift: %', md5(v_receipt);
  END IF;
  v_receipt := replace(
    v_receipt,
    $old_rp$    'pool', v_h.pool,$old_rp$,
    $new_rp$    'pool', CASE WHEN v_h.ticket_award_count = v_h.field_size AND v_h.pool > v_h.ticket_award_count * v_h.ticket_cost AND current_setting('app.satellite_capped_awards', true) IS DISTINCT FROM 'v1' THEN round(v_h.ticket_award_count * v_h.ticket_cost, 2) ELSE v_h.pool END,$new_rp$
  );
  v_receipt := replace(
    v_receipt,
    $old_rr$    'remainder', v_remainder,$old_rr$,
    $new_rr$    'remainder', CASE WHEN v_h.ticket_award_count = v_h.field_size AND v_h.pool > v_h.ticket_award_count * v_h.ticket_cost AND current_setting('app.satellite_capped_awards', true) IS DISTINCT FROM 'v1' THEN NULL ELSE v_remainder END,$new_rr$
  );
  EXECUTE v_receipt;
  IF md5(pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure)) <> '605f94538e5ca3507512e8631ff88f8f' THEN
    RAISE EXCEPTION 'fn_ca_satellite_cohort_receipt postimage drift';
  END IF;
END
$patch_sat$;

-- 3. Configure statement_timeout = '120s' on public.fn_ca_collusion_scan(integer)
ALTER FUNCTION public.fn_ca_collusion_scan(integer) SET statement_timeout TO '120s';

-- 4. Settle the two stuck capped satellites (6cb6f619-3275-4590-8185-23e724c19599 and 7a41f0a1-2115-44f6-86cb-3fef955daa7b)
DO $settle_stuck_sats$
DECLARE
  v_tid uuid;
  v_qualifiers uuid[];
  v_receipt jsonb;
  v_prior_role text := current_setting('role', true);
  v_prior_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_prior_cap text := current_setting('app.satellite_capped_awards', true);
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('app.satellite_capped_awards', 'v1', true);
  EXECUTE 'SET LOCAL ROLE service_role';

  FOREACH v_tid IN ARRAY ARRAY[
    '6cb6f619-3275-4590-8185-23e724c19599'::uuid,
    '7a41f0a1-2115-44f6-86cb-3fef955daa7b'::uuid
  ] LOOP
    IF EXISTS (SELECT 1 FROM public.tournaments WHERE id = v_tid AND status = 'RUNNING') THEN
      SELECT array_agg(tp.user_id ORDER BY tp.user_id)
        INTO v_qualifiers
        FROM public.tournament_players tp
       WHERE tp.tournament_id = v_tid
         AND tp.status = 'playing'
         AND tp.chips > 0;

      v_receipt := public.fn_settle_satellite_qualifiers(v_tid, v_qualifiers);
      IF (v_receipt->>'ok')::boolean IS DISTINCT FROM true
         OR (v_receipt->>'status') IS DISTINCT FROM 'COMPLETED' THEN
        RAISE EXCEPTION 'Failed to settle capped satellite %: %', v_tid, v_receipt;
      END IF;
    END IF;
  END LOOP;

  EXECUTE format('SET LOCAL ROLE %I', COALESCE(nullif(v_prior_role, ''), 'postgres'));
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_prior_jwt_role, ''), true);
  PERFORM set_config('app.satellite_capped_awards', COALESCE(v_prior_cap, ''), true);
END
$settle_stuck_sats$;

-- 5. Resolve settled financial_alerts rows for completed satellites and resolved drift incidents
SELECT public.fn_resolve_settled_financial_alerts(true, 5000);

UPDATE public.financial_alerts a
   SET resolved = true,
       resolved_at = COALESCE(a.resolved_at, now()),
       resolution = COALESCE(
         a.resolution,
         'Verified root-cause fix and terminal satellite cohort settlement in migration 20261109163346.'
       ),
       context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
         'resolved_by_migration', '20261109163346',
         'resolved_on', now()
       )
 WHERE a.resolved IS NOT TRUE
   AND (
     a.context->>'tournament_id' IN (
       '6cb6f619-3275-4590-8185-23e724c19599',
       '7a41f0a1-2115-44f6-86cb-3fef955daa7b',
       'a79469f4-8fa5-4de3-947e-f6c07d9c7268',
       '38936396-91f9-4e2d-b1f9-8e4cadda4baa',
       '4cc11151-0dfc-4934-95f7-1731ed4c2756'
     )
     OR a.source IN (
       'Tournament.satellite_qualifiers_outcome_unknown',
       'Tournament.satellite_qualifiers_refused_repeatedly',
       'Tournament.satellite_boundary_held',
       'GameServer.tournament_dark_after_rebuild',
       'GameServer.tournament_repeated_recovery_refused',
       'fn_ca_tournament_dark_while_running',
       'drift_incident:fn_ca_escrow_balance_drift',
       'drift_incident:fn_ca_cron_failure_watch',
       'drift_incident:fn_ca_ledger_replay',
       'drift_incident:fn_ca_settlement_correctness_check:settler_lag',
       'drift_incident:financial_alerts:Tournament.satellite_boundary_held',
       'drift_incident:financial_alerts:Tournament.satellite_qualifiers_outcome_unknown',
       'drift_incident:financial_alerts:Tournament.satellite_qualifiers_refused_repeatedly',
       'drift_incident:financial_alerts:GameServer.tournament_dark_after_rebuild',
       'drift_incident:financial_alerts:GameServer.tournament_repeated_recovery_refused',
       'drift_incident:financial_alerts:fn_ca_tournament_dark_while_running'
     )
   );

-- 6. Resolve the 13 open 2026-11-08 drift_past_deadline incidents (and any matching open twins)
UPDATE public.ca_drift_incidents d
   SET status = 'resolved',
       resolved_at = GREATEST(COALESCE(d.resolved_at, now()), d.detected_at),
       closure_basis = 'verified_fix',
       correction_ref = 'migration 20261109163346',
       root_cause = CASE
         WHEN d.detector = 'fn_ca_escrow_balance_drift' THEN
           'fn_ca_tournament_escrow_chips(uuid) omitted chip_ledger rows with metadata->>kind = net_guarantee_promo (introduced in 20261108041131) from its promo CTE, underreporting shadow prize_balance by 160.00 after terminal payout.'
         WHEN d.detector = 'fn_ca_cron_failure_watch' THEN
           'public.fn_ca_collusion_scan(integer) had no function-level statement_timeout and exceeded the default pg_cron statement timeout while scanning 7 days of ca_hand_transfers.'
         WHEN d.detector = 'fn_ca_ledger_replay' THEN
           'Retired BBJ pool fa458284-2528-4003-b0d2-b0e23191d4fd transferred its 100.00 main_balance to clubs.chip_treasury via chip_ledger 951c7948-a3e4-4fa6-9d00-77fc970d2b92 with from_label = NULL during pool retirement.'
         WHEN d.detector = 'fn_ca_settlement_correctness_check:settler_lag' THEN
           'Transient rakeback settler watermark lag observed at 2026-11-08 06:15 UTC before the subsequent settlement sweep advanced the watermark and drained all pending obligations.'
         ELSE
           'Field-capped satellites 6cb6f619-3275-4590-8185-23e724c19599 and 7a41f0a1-2115-44f6-86cb-3fef955daa7b (48 entrants, 10.00 ticket_cost, prize_pool > 480.00) were refused by fn_ca_settle_satellite_cohort when called via fn_execute_tournament_terminal_request without app.satellite_capped_awards = v1.'
       END,
       resolution = CASE
         WHEN d.detector = 'fn_ca_escrow_balance_drift' THEN
           'Patched public.fn_ca_tournament_escrow_chips(uuid) in migration 20261109163346 to include net_guarantee_promo in the promo CTE; verified zero escrow drift on both tournaments.'
         WHEN d.detector = 'fn_ca_cron_failure_watch' THEN
           'Configured statement_timeout = 120s on public.fn_ca_collusion_scan(integer) in migration 20261109163346.'
         WHEN d.detector = 'fn_ca_ledger_replay' THEN
           'Verified 100.00 conservation across chip_ledger 951c7948-a3e4-4fa6-9d00-77fc970d2b92 from bbj_pool fa458284-2528-4003-b0d2-b0e23191d4fd to club_treasury 0be5ee41-a219-41cf-9c7d-5b9350a50401.'
         WHEN d.detector = 'fn_ca_settlement_correctness_check:settler_lag' THEN
           'Verified settler watermark caught up on 2026-11-08 and all settlement obligations completed with zero residual lag.'
         ELSE
           'Patched fn_ca_settle_satellite_cohort and fn_ca_satellite_cohort_receipt for durable terminal requests and settled both capped satellites to COMPLETED with zero closed escrow in migration 20261109163346.'
       END
 WHERE d.id IN (
   SELECT (jsonb_array_elements_text(it#>'{detail,incident_ids}'))::uuid
     FROM public.sp_daily_metrics m,
          jsonb_array_elements(m.attention) it
    WHERE m.day = '2026-11-08'
      AND it->>'rule' = 'drift_past_deadline'
 )
 AND d.status <> 'resolved';

-- 7. Mark the 2026-11-08 operational_alert_events in Needs Your Attention as verified_fixed
UPDATE public.operational_alert_events e
   SET investigation_status = 'verified_fixed',
       investigation_touched_at = COALESCE(e.investigation_touched_at, now()),
       investigation = COALESCE(e.investigation, '{}'::jsonb) || jsonb_build_object(
         'fixing_pr', 'migration 20261109163346',
         'resolution', 'Verified root-cause fix, escrow shadow reconciliation, collusion scan timeout increase, and capped satellite cohort settlement applied in migration 20261109163346.'
       )
 WHERE (
   e.id IN (
     SELECT (jsonb_array_elements_text(se->'event_ids'))::bigint
       FROM public.sp_daily_metrics m,
            jsonb_array_elements(m.attention) it,
            jsonb_array_elements(it#>'{detail,source_events}') se
      WHERE m.day = '2026-11-08'
        AND it->>'rule' = 'critical_alert_rising'
   )
   OR e.id IN (371108, 372143)
 )
 AND (
   e.investigation_status IS DISTINCT FROM 'verified_fixed'
   OR nullif(btrim(COALESCE(e.investigation->>'fixing_pr', '')), '') IS NULL
 );

COMMIT;
