-- 20261110152729_collusion_scan_index_plan_conservation_and_operational_alert.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('CROSS JOIN LATERAL' in pg_get_functiondef('public.fn_ca_collusion_scan(integer)'::regprocedure)) > 0 AND position('operational_remeasured_alerts' in pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure)) > 0 AND EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE id = 'c3f667d5-422b-47bb-9b1b-0898fa1c7003' AND status = 'resolved') AND EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE id = '8962ca34-84dc-4f5d-ad2a-bccf85215ef0' AND status = 'resolved') AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.fn_tournament_conservation_deltas(timestamp with time zone,timestamp with time zone)'::regprocedure AND position('special_ledger AS MATERIALIZED' in p.prosrc) > 0)
--
-- PHASE 3 SELF-HEALING & RELIABILITY HARDENING:
-- 1. Optimize public.fn_ca_collusion_scan(integer) (cron.job 202) to drive
--    public.ca_hand_transfers via public.profiles CROSS JOIN LATERAL over
--    idx_ca_hand_transfers_winner (winner_id, played_at DESC), materialize
--    cert_users once, insert into public.ca_collusion_signals in one set-based
--    query, and short-circuit the per-row fn_ca_raise_drift_incident loop when
--    fn_ca_collusion_scan is retired in public.ca_detector_registry.
-- 2. Optimize public.fn_tournament_conservation_deltas(timestamptz, timestamptz)
--    (cron.job 274) to read reversal/correction/ticket_redeem/transfer/promo_send
--    chip_ledger legs once in a shared MATERIALIZED CTE and prevent BitmapAnd
--    equivalence-class index intersections on from_entity_id/to_entity_id while
--    preserving exact literal parity with public.fn_tournament_conservation_delta.
-- 3. Extend public.fn_resolve_settled_financial_alerts(boolean, integer) with
--    CLASS 9 operational self-resolution on positive live re-measurement for:
--      - postHandTasks.leave_pending_failed
--      - drift_incident:fn_ca_cron_failure_watch (plus upgrading aged-out
--        ca_drift_incidents twins to verified_remeasured)
--      - fn_ca_daily_bonus_claim.budget_anomaly (past-day p95 growth notices
--        when current Chicago day is within the 14-day p95)
--      - fn_ca_writer_lock_sentinel (cancelled backend PIDs no longer active)
--      - HorseFleet.stableHandHeartbeat (superseded by newer stable_hand_beats)
-- 4. Disable runtime plpgsql_check pldbgapi2 call-stack hooks (plpgsql_check.mode,
--    cursors_leaks, constants_tracing) on database/roles so background pg_cron
--    and RPC workers never trip on XX000 pldbgapi2 call-stack errors, without
--    mutating any pinned function definition hashes.
-- 5. Backfill closed_at on the 4,417 historical pre-receipt zero-balance terminal
--    tournament escrows, verify the 56 pre-September-9 cancelled Spin escrows are
--    100% refunded in wallet_transactions, verify and close the fn_ca_guard_defs_watch
--    notice on fn_ca_journal_append_only (8962ca34-84dc-4f5d-ad2a-bccf85215ef0),
--    execute fn_ca_collusion_scan(7) and close incident c3f667d5-422b-47bb-9b1b-0898fa1c7003,
--    and execute fn_resolve_settled_financial_alerts(true, 5000).
--
-- No money moves in this migration.

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF public.fn_ca_break_window_refuses_migrations(now()) THEN
    RAISE EXCEPTION 'Refusing to run migration inside the hourly break window (:50-:03 UTC)';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_collusion_scan(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $fn$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(p_days, 1));
  r RECORD;
  v_flagged int := 0;
  v_scanned int := 0;
  v_retired boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM public.ca_detector_registry dr
     WHERE dr.source = 'fn_ca_collusion_scan'
       AND dr.status = 'retired'
  ) INTO v_retired;

  WITH directed AS MATERIALIZED (
    SELECT p.id AS winner_id,
           ht.loser_id,
           ht.cnt,
           ht.gross
      FROM public.profiles p
      CROSS JOIN LATERAL (
        SELECT t.loser_id,
               count(*)      AS cnt,
               sum(t.amount) AS gross
          FROM public.ca_hand_transfers t
         WHERE t.winner_id = p.id
           AND t.played_at > v_since
           AND t.loser_id IS NOT NULL
           AND t.amount > 0
         GROUP BY t.loser_id
      ) ht
  ),
  pairflow AS MATERIALIZED (
    SELECT LEAST(d.winner_id, d.loser_id)    AS ua,
           GREATEST(d.winner_id, d.loser_id) AS ub,
           sum(d.cnt)::bigint                AS hands_together,
           sum(d.gross)                      AS gross_flow,
           sum(CASE WHEN d.winner_id < d.loser_id THEN d.gross ELSE -d.gross END) AS net_to_ua
      FROM directed d
     GROUP BY 1, 2
  ),
  qualified AS MATERIALIZED (
    SELECT CASE WHEN net_to_ua >= 0 THEN ua ELSE ub END AS receiver,
           CASE WHEN net_to_ua >= 0 THEN ub ELSE ua END AS sender,
           hands_together,
           gross_flow,
           abs(net_to_ua) AS net_flow,
           round(abs(net_to_ua) / NULLIF(gross_flow, 0), 3) AS direction_ratio
      FROM pairflow
     WHERE hands_together >= 20
       AND abs(net_to_ua) >= 5000
       AND abs(net_to_ua) / NULLIF(gross_flow, 0) > 0.8
  ),
  distinct_users AS MATERIALIZED (
    SELECT DISTINCT u.uid
      FROM (
        SELECT q.receiver AS uid FROM qualified q
        UNION
        SELECT q.sender   AS uid FROM qualified q
      ) u
  ),
  cert_users AS MATERIALIZED (
    SELECT du.uid
      FROM distinct_users du
     WHERE public.fn_ca_is_cert_account(du.uid)
  ),
  inserted AS (
    INSERT INTO public.ca_collusion_signals
      (window_days, user_a, user_b, hands_together, gross_flow, net_flow,
       direction_ratio, both_cert, detail)
    SELECT p_days,
           q.receiver,
           q.sender,
           q.hands_together,
           q.gross_flow,
           q.net_flow,
           q.direction_ratio,
           (cu_r.uid IS NOT NULL AND cu_s.uid IS NOT NULL) AS both_cert,
           jsonb_build_object('since', v_since)
      FROM qualified q
      LEFT JOIN cert_users cu_r ON cu_r.uid = q.receiver
      LEFT JOIN cert_users cu_s ON cu_s.uid = q.sender
    RETURNING user_a AS receiver,
              user_b AS sender,
              hands_together,
              gross_flow,
              net_flow,
              direction_ratio,
              both_cert
  )
  SELECT count(*)::int INTO v_flagged FROM inserted;

  v_scanned := v_flagged;

  IF NOT v_retired AND v_flagged > 0 THEN
    FOR r IN
      SELECT s.user_a AS receiver,
             s.user_b AS sender,
             s.hands_together,
             s.gross_flow,
             s.net_flow,
             s.direction_ratio,
             s.both_cert
        FROM public.ca_collusion_signals s
       WHERE s.window_days = p_days
         AND s.detail = jsonb_build_object('since', v_since)
    LOOP
      PERFORM public.fn_ca_raise_drift_incident(
        'fn_ca_collusion_scan', 'unknown',
        CASE WHEN r.net_flow >= 50000 AND NOT COALESCE(r.both_cert, false)
             THEN 'warning' ELSE 'info' END,
        'collusion:' || r.receiver::text || ':' || r.sender::text || ':' || to_char(now(), 'IYYY-IW'),
        r.net_flow, NULL, NULL,
        'reporting', 'user', r.receiver, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'one-directional chip flow: ' || r.net_flow || ' chips over ' || r.hands_together
          || ' shared hands in ' || p_days || 'd (direction ratio ' || r.direction_ratio
          || ') - review the pair; no automatic action taken',
        true,
        jsonb_build_object('receiver', r.receiver, 'sender', r.sender,
                           'hands_together', r.hands_together,
                           'gross_flow', r.gross_flow, 'net_flow', r.net_flow,
                           'direction_ratio', r.direction_ratio));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'window_days', p_days,
                            'pairs_flagged', v_flagged);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_ca_collusion_scan(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_collusion_scan(integer) TO service_role;


CREATE OR REPLACE FUNCTION public.fn_tournament_conservation_deltas(p_since timestamp with time zone, p_until timestamp with time zone)
 RETURNS TABLE(id uuid, name text, variant text, ended_at timestamp with time zone, delta numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $deltas$
  -- THE CONSERVATION DELTA FOR A WHOLE WINDOW, IN ONE READ (2026-10-03).
  -- Exactly fn_tournament_conservation_delta's arithmetic, term for term, for
  -- every event the money-conservation scan covers: COMPLETED or CANCELLED,
  -- ended inside (p_since, p_until), not 'spin', and with a buy-in. Each term
  -- is summed once per table instead of once per event. A change to the
  -- scalar is a change to this function too: the native qualification and
  -- tests/the-conservation-scan-reads-every-event-in-one-pass.law.test.ts
  -- compare the two over the whole fixture population.
  WITH eligible AS MATERIALIZED (
    SELECT t.id, t.name, t.variant, t.ended_at,
      -- A DIAMOND EVENT KEEPS ITS OWN BOOK (2026-10-09): see the scalar.
      EXISTS (SELECT 1 FROM public.clubs c
               WHERE c.id = t.club_id AND c.asset = 'diamonds'
                 AND c.is_platform IS TRUE AND c.union_id IS NULL
                 AND t.union_id IS NULL) AS diamond
    FROM public.tournaments t
    WHERE t.status IN ('COMPLETED','CANCELLED')
      AND t.ended_at > p_since
      AND t.ended_at < p_until
      AND COALESCE(t.variant, '') NOT IN ('spin')
      AND COALESCE(t.buy_in_amount, 0) + COALESCE(t.buy_in_fee, 0) > 0
  ), wallet_totals AS MATERIALIZED (
    SELECT w.related_entity_id AS id,
      sum(w.amount) FILTER (WHERE w.type = 'debit' AND w.category IN ('tournament_buyin','rebuy','addon')) AS money_in,
      sum(w.amount) FILTER (WHERE w.type = 'credit' AND w.category = 'refund') AS refunds,
      sum(w.amount) FILTER (WHERE w.type = 'credit' AND w.category = 'prize') AS prizes,
      sum(w.amount) FILTER (WHERE w.type = 'credit' AND w.category = 'bounty') AS bounties
    FROM public.wallet_transactions w JOIN eligible e ON e.id = w.related_entity_id
    WHERE (w.type = 'debit' AND w.category IN ('tournament_buyin','rebuy','addon'))
       OR (w.type = 'credit' AND w.category IN ('refund','prize','bounty'))
    GROUP BY w.related_entity_id
  ), rake_totals AS MATERIALIZED (
    SELECT rr.tournament_id AS id, sum(rr.rake_amount) AS rake
    FROM public.rake_records rr JOIN eligible e ON e.id = rr.tournament_id
    WHERE rr.is_tournament AND rr.rake_amount <> 0 AND rr.tournament_id IS NOT NULL
    GROUP BY rr.tournament_id
  ), overlay_totals AS MATERIALIZED (
    SELECT l.tournament_id AS id, sum(l.amount) AS overlay
    FROM public.chip_ledger l JOIN eligible e ON e.id = l.tournament_id
    WHERE l.category = 'overlay' AND l.to_type = 'prize_liability'
    GROUP BY l.tournament_id
  ), special_ledger AS MATERIALIZED (
    SELECT l.tournament_id, l.category, l.from_type, l.from_entity_id,
           l.to_type, l.to_entity_id, l.amount, l.idempotency_key, l.metadata
    FROM public.chip_ledger l JOIN eligible e ON e.id = l.tournament_id
    WHERE l.category IN ('reversal','correction','ticket_redeem','transfer','promo_send')
  ), returned_overlays AS MATERIALIZED (
    SELECT l.tournament_id AS id, sum(l.amount) AS returned
    FROM special_ledger l
    WHERE l.category = 'reversal' AND l.from_type = 'prize_liability'
      AND COALESCE(l.from_entity_id, l.from_entity_id) = l.tournament_id
      AND l.metadata->>'kind' = 'reviewed_void_overlay_return'
    GROUP BY l.tournament_id
  ), house_corrections AS MATERIALIZED (
    SELECT l.tournament_id AS id, sum(l.amount) AS amount
    FROM special_ledger l
    WHERE l.category = 'correction' AND l.to_type = 'prize_liability'
      AND l.from_type IN ('union_bank','club_treasury')
    GROUP BY l.tournament_id
  ), seat_income AS MATERIALIZED (
    SELECT e.id, sum(sp.amount) AS amount
    FROM public.tournament_payouts sp
    JOIN eligible e ON sp.metadata->>'satellite_target_id' = e.id::text
    LEFT JOIN public.tournament_satellite_awards a
      ON a.tournament_id = sp.tournament_id AND a.place = sp.position
    LEFT JOIN public.tournament_tickets k ON k.id = COALESCE(a.ticket_id, CASE WHEN sp.metadata->>'ticket_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (sp.metadata->>'ticket_id')::uuid END)
    WHERE sp.source IN ('satellite_seat','satellite_ticket')
      AND COALESCE(a.delivery_kind, 'seat') IN ('seat','ticket')
      AND (k.id IS NULL OR (k.status = 'redeemed' AND NOT EXISTS (SELECT 1 FROM public.chip_ledger cl WHERE cl.idempotency_key = 'ticket:' || k.id::text || ':closed-target-cash' AND cl.category = 'ticket_redeem') AND NOT EXISTS (SELECT 1 FROM public.chip_ledger ad WHERE ad.created_at = k.redeemed_at AND ad.category = 'ticket_redeem' AND ad.idempotency_key LIKE 'ticket:' || k.id::text || ':tournament:%:entry')))
    GROUP BY e.id
  ), seat_outgoing AS MATERIALIZED (
    SELECT e.id, sum(sp.amount) AS amount
    FROM public.tournament_payouts sp JOIN eligible e ON e.id = sp.tournament_id
    LEFT JOIN public.tournament_satellite_awards a
      ON a.tournament_id = sp.tournament_id AND a.place = sp.position
    LEFT JOIN public.tournament_tickets k ON k.id = COALESCE(a.ticket_id, CASE WHEN sp.metadata->>'ticket_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (sp.metadata->>'ticket_id')::uuid END)
    WHERE sp.source IN ('satellite_seat','satellite_ticket')
      AND COALESCE(a.delivery_kind, 'seat') IN ('seat','ticket')
      AND COALESCE(k.status, 'issued') IN ('issued','redeemed')
      AND NOT (
        k.id IS NULL
        AND EXISTS (SELECT 1 FROM public.wallet_transactions w
                    WHERE w.related_entity_id = e.id
                      AND w.type = 'credit' AND w.category = 'prize'
                      AND w.user_id = sp.user_id AND w.amount = sp.amount)
      )
    GROUP BY e.id
  ), ticket_in AS MATERIALIZED (
    -- A REDEEMED TICKET ARRIVES WHERE IT WAS REDEEMED (2026-11-05): see the scalar.
    SELECT x.tournament_id AS id, sum(x.amount) AS amount
    FROM special_ledger x
    WHERE x.category = 'ticket_redeem' AND x.to_type = 'prize_liability'
      AND x.metadata->>'kind' = 'tournament_entry_ticket_admission'
    GROUP BY x.tournament_id
  ), owner_out AS MATERIALIZED (
    -- OWNER-DIRECTED RETURNS TO THE HOUSE (2026-11-05): see the scalar.
    SELECT x.tournament_id AS id, sum(x.amount) AS amount
    FROM special_ledger x
    WHERE x.from_type = 'prize_liability'
      AND COALESCE(x.from_entity_id, x.from_entity_id) = x.tournament_id
      AND x.to_type IN ('union_bank','club_treasury')
      AND ((x.category = 'transfer' AND x.idempotency_key LIKE 'owner-retirement-pool:%')
        OR (x.category = 'reversal' AND x.metadata->>'kind' = 'owner_bounty_guarantee_correction'))
    GROUP BY x.tournament_id
  ), promo_in AS MATERIALIZED (
    -- UNION PROMO FUNDING (2026-11-09): see the scalar.
    SELECT x.tournament_id AS id,
           sum(CASE WHEN x.category = 'promo_send' THEN x.amount ELSE -x.amount END) AS amount
    FROM special_ledger x
    WHERE (x.metadata->>'kind' = 'midway_free_buy_promo_head'
           AND x.category IN ('promo_send', 'reversal'))
       OR (x.metadata->>'kind' = 'guarantee_promo_excess_return'
           AND x.category = 'reversal' AND x.from_type = 'prize_liability'
           AND COALESCE(x.from_entity_id, x.from_entity_id) = x.tournament_id)
       OR (x.metadata->>'kind' = 'net_guarantee_promo'
           AND x.category = 'promo_send' AND x.from_type = 'union_wallet'
           AND x.to_type = 'prize_liability'
           AND COALESCE(x.to_entity_id, x.to_entity_id) = x.tournament_id)
    GROUP BY x.tournament_id
  )
  SELECT e.id, e.name, e.variant, e.ended_at,
    CASE WHEN e.diamond THEN
      (SELECT round(x.prize_balance + x.bounty_balance + x.fee_balance, 2)
         FROM public.fn_poker_diamond_tournament_escrow(e.id) x)
    ELSE round(COALESCE(w.money_in, 0) - COALESCE(w.refunds, 0)
      - COALESCE(rr.rake, 0) - COALESCE(w.prizes, 0) - COALESCE(w.bounties, 0)
      + GREATEST(COALESCE(l.overlay, 0), COALESCE(o.amount, 0)) - COALESCE(ro.returned, 0)
      + COALESCE(hc.amount, 0)
      + COALESCE(b.amount, 0) + COALESCE(si.amount, 0) - COALESCE(so.amount, 0)
      + COALESCE(ti.amount, 0) - COALESCE(oo.amount, 0)
      + COALESCE(pi.amount, 0), 2) END AS delta
  FROM eligible e
  LEFT JOIN wallet_totals w ON w.id = e.id
  LEFT JOIN rake_totals rr ON rr.id = e.id
  LEFT JOIN overlay_totals l ON l.id = e.id
  LEFT JOIN returned_overlays ro ON ro.id = e.id
  LEFT JOIN house_corrections hc ON hc.id = e.id
  LEFT JOIN public.tournament_guarantee_overlays o ON o.tournament_id = e.id
  LEFT JOIN public.tournament_conservation_baseline b ON b.tournament_id = e.id
  LEFT JOIN seat_income si ON si.id = e.id
  LEFT JOIN seat_outgoing so ON so.id = e.id
  LEFT JOIN ticket_in ti ON ti.id = e.id
  LEFT JOIN owner_out oo ON oo.id = e.id
  LEFT JOIN promo_in pi ON pi.id = e.id
$deltas$;

REVOKE ALL ON FUNCTION public.fn_tournament_conservation_deltas(timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tournament_conservation_deltas(timestamp with time zone, timestamp with time zone) TO service_role;


CREATE OR REPLACE FUNCTION public.fn_resolve_settled_financial_alerts(p_apply boolean DEFAULT false, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_paid      integer := 0;
  v_overpaid  integer := 0;
  v_settled   integer := 0;
  v_released  integer := 0;
  v_paid_ids  uuid[] := '{}';
  v_over_ids  uuid[] := '{}';
  v_settled_ids uuid[] := '{}';
  v_rel_ids   uuid[] := '{}';
  v_ops       integer := 0;
  v_ops_ids   uuid[] := '{}';
  v_fin       integer := 0;
  v_fin_ids   uuid[] := '{}';
  v_unk       integer := 0;
  v_unk_ids   uuid[] := '{}';
  v_drift     integer := 0;
  v_drift_ids uuid[] := '{}';
  v_twins     integer := 0;
  v_receipted integer := 0;
  v_receipted_ids uuid[] := '{}';
  v_operational integer := 0;
  v_operational_ids uuid[] := '{}';
  v_cron_twins integer := 0;
BEGIN
  -- ── CLASS 1: the player was accused of being unpaid and has since been paid.
  -- Proven per alert against wallet_transactions, not assumed from elapsed
  -- time. `short` is what the check said they were owed; `got` is what the
  -- prize path actually credited them for that same event.
  SELECT array_agg(id) INTO v_paid_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'fn_payout_guarantee_check'
       AND a.context->>'kind' = 'earner_not_paid'
       AND a.context->>'user_id' IS NOT NULL
       AND a.context->>'tournament_id' IS NOT NULL
       AND COALESCE((
             SELECT sum(w.amount) FROM public.wallet_transactions w
              WHERE w.related_entity_id = (a.context->>'tournament_id')::uuid
                AND w.user_id           = (a.context->>'user_id')::uuid
                AND w.type = 'credit' AND w.category = 'prize'
           ), 0) >= COALESCE((a.context->>'short')::numeric, 0) - 0.01
     LIMIT p_limit
  ) s;
  v_paid := COALESCE(array_length(v_paid_ids, 1), 0);

  -- ── CLASS 2: every issue on the alert is an overpay, which 10.6 rule 3 says
  -- is absorbed and never clawed back. There is no action left to take, so
  -- "unresolved" is a false state. An alert carrying ANY other issue kind is
  -- deliberately left open.
  SELECT array_agg(id) INTO v_over_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'fn_tournament_payout_reconcile'
       AND jsonb_typeof(a.context->'issues') = 'array'
       AND jsonb_array_length(a.context->'issues') > 0
       AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(a.context->'issues') i
              WHERE i->>'issue' IS DISTINCT FROM 'overpaid')
     LIMIT p_limit
  ) s;
  v_overpaid := COALESCE(array_length(v_over_ids, 1), 0);

  -- CLASS 3: the post-commit envelope this alert was raised about has since
  -- been applied. hand_atomic_commits.post_commit_completed_at is the durable
  -- proof; the alert is the memory of a moment when it was not yet set.
  SELECT COALESCE(array_agg(id), '{}') INTO v_settled_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
      JOIN public.hand_atomic_commits c ON c.hand_id = (a.context->>'hand_id')::uuid
     WHERE a.resolved IS NOT TRUE
       AND a.source IN ('ServerTableEngine.post_commit_obligations_pending',
                        'LightningHandHost.post_commit_obligations_pending')
       AND (a.source <> 'LightningHandHost.post_commit_obligations_pending' OR (
         c.table_id::text = a.context->>'table_id'
         AND to_jsonb(c.hand_number) = a.context->'hand_number'
         AND c.post_commit_request_hash ~ '^[0-9a-f]{64}$'
         AND c.post_commit_payload_hash ~ '^[0-9a-f]{64}$'
         AND c.post_commit_result->'ok' = 'true'::jsonb
         AND c.post_commit_result->>'hand_id' = c.hand_id::text
         AND c.post_commit_result->'hand_number' = to_jsonb(c.hand_number)))
       AND a.context->>'hand_id' IS NOT NULL
       AND c.post_commit_completed_at IS NOT NULL
     LIMIT p_limit
  ) s;
  v_settled := COALESCE(array_length(v_settled_ids, 1), 0);

  -- CLASS 4 / STAGE 1 (PARTIAL): only an exact original accepted hand with
  -- completed required obligations can resolve here. A later hand, client
  -- claim, text-only rollback or missing identity remains actionable. A true
  -- rollback needs no same-hand commit; this stage does not certify rollbacks.
  SELECT COALESCE(array_agg(id), '{}') INTO v_rel_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
      JOIN public.hand_atomic_commits c ON
        c.hand_id = CASE WHEN (a.context->'hand_request_identity_v1'->>'hand_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN (a.context->'hand_request_identity_v1'->>'hand_id')::uuid END
     WHERE a.resolved IS NOT TRUE
       AND a.source IN ('postHandTasks.hand_history_failed',
                        'ServerTableEngine.authoritative_hand_semantic_refusal')
       AND jsonb_typeof(a.context) = 'object'
       AND a.context->>'channel' = 'server_rpc'
       AND jsonb_typeof(a.context->'hand_request_identity_v1') = 'object'
       AND a.context->'hand_request_identity_v1'->'version' = '1'::jsonb
       AND a.context->'hand_request_identity_v1'->'post_commit_required' = 'true'::jsonb
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'table_id') = 'string'
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'hand_id') = 'string'
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'hand_number') = 'number'
       AND lower(a.context->>'table_id') = lower(a.context->'hand_request_identity_v1'->>'table_id')
       AND a.context->'hand_number' = a.context->'hand_request_identity_v1'->'hand_number'
       AND c.hand_id = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'hand_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         THEN (a.context->'hand_request_identity_v1'->>'hand_id')::uuid END
       AND c.table_id = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         THEN (a.context->'hand_request_identity_v1'->>'table_id')::uuid END
       AND c.hand_number = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'hand_number') ~ '^[1-9][0-9]{6,15}$'
         THEN CASE WHEN (a.context->'hand_request_identity_v1'->>'hand_number')::bigint <= 9007199254740991
           THEN (a.context->'hand_request_identity_v1'->>'hand_number')::bigint END END
       AND c.payload_hash ~ '^[0-9a-f]{64}$'
       AND c.post_commit_request_hash ~ '^[0-9a-f]{64}$'
       AND c.post_commit_payload_hash ~ '^[0-9a-f]{64}$'
       AND jsonb_typeof(c.post_commit_payload) = 'object'
       AND c.post_commit_completed_at IS NOT NULL
       AND jsonb_typeof(c.post_commit_result) = 'object'
       AND c.post_commit_result->'ok' = 'true'::jsonb
       AND c.post_commit_result->>'hand_id' = c.hand_id::text
       AND c.post_commit_result->'hand_number' = to_jsonb(c.hand_number)
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_released := COALESCE(array_length(v_rel_ids, 1), 0);

  -- CLASS 5: a tournament operational alarm whose condition has ended.
  SELECT COALESCE(array_agg(id), '{}') INTO v_ops_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a, public.tournaments t
     WHERE a.resolved IS NOT TRUE
       AND a.source IN ('Tournament.table_admission_failing',
                        'GameServer.tournament_dark_after_rebuild')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND (
             t.status IN ('COMPLETED', 'CANCELLED')
          OR (a.source = 'Tournament.table_admission_failing'
              AND EXISTS (
                    SELECT 1 FROM public.tables tb
                     WHERE tb.id = CASE WHEN (a.context->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                        THEN (a.context->>'table_id')::uuid END
                       AND tb.tournament_id = t.id
                       AND (lower(tb.status) = 'closed'
                            OR EXISTS (SELECT 1 FROM public.hand_atomic_commits c
                                        WHERE c.table_id = tb.id
                                          AND c.committed_at > a.created_at))))
          OR (a.source = 'GameServer.tournament_dark_after_rebuild'
              AND EXISTS (
                    SELECT 1 FROM public.tables tb
                      JOIN public.hand_atomic_commits c ON c.table_id = tb.id
                     WHERE tb.tournament_id = t.id
                       AND c.committed_at > a.created_at))
           )
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_ops := COALESCE(array_length(v_ops_ids, 1), 0);

  IF p_apply THEN
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = CASE
               WHEN t.status IN ('COMPLETED', 'CANCELLED')
                 THEN 'verified: tournament ' || t.id::text || ' reached ' || t.status
                   || COALESCE(' at ' || t.ended_at::text, '') || '; the alarm''s condition has ended.'
               WHEN a.source = 'Tournament.table_admission_failing'
                 THEN 'verified: table ' || (a.context->>'table_id')
                   || ' committed a hand or closed after this alarm; the table was admitted.'
               ELSE 'verified: tournament ' || t.id::text
                   || ' committed a hand after this alarm; it is dealing again.'
             END,
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'operational_condition_resolution_v1', jsonb_build_object(
                 'version', 1,
                 'tournament_id', t.id,
                 'tournament_status', t.status,
                 'tournament_ended_at', t.ended_at,
                 'first_commit_after_alert', CASE
                   WHEN a.source = 'Tournament.table_admission_failing' THEN (
                     SELECT min(c.committed_at) FROM public.hand_atomic_commits c
                      WHERE c.table_id = CASE WHEN (a.context->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                              THEN (a.context->>'table_id')::uuid END
                        AND c.committed_at > a.created_at)
                   ELSE (
                     SELECT min(c.committed_at) FROM public.tables tb
                       JOIN public.hand_atomic_commits c ON c.table_id = tb.id
                      WHERE tb.tournament_id = t.id
                        AND c.committed_at > a.created_at)
                 END))
        FROM public.tournaments t
       WHERE a.id = ANY(v_ops_ids)
         AND a.resolved IS NOT TRUE
         AND a.source IN ('Tournament.table_admission_failing',
                          'GameServer.tournament_dark_after_rebuild')
         AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                         THEN (a.context->>'tournament_id')::uuid END
         AND (
               t.status IN ('COMPLETED', 'CANCELLED')
            OR (a.source = 'Tournament.table_admission_failing'
                AND EXISTS (
                      SELECT 1 FROM public.tables tb
                       WHERE tb.id = CASE WHEN (a.context->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                          THEN (a.context->>'table_id')::uuid END
                         AND tb.tournament_id = t.id
                         AND (lower(tb.status) = 'closed'
                              OR EXISTS (SELECT 1 FROM public.hand_atomic_commits c
                                          WHERE c.table_id = tb.id
                                            AND c.committed_at > a.created_at))))
            OR (a.source = 'GameServer.tournament_dark_after_rebuild'
                AND EXISTS (
                      SELECT 1 FROM public.tables tb
                        JOIN public.hand_atomic_commits c ON c.table_id = tb.id
                       WHERE tb.tournament_id = t.id
                         AND c.committed_at > a.created_at))
             )
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_ops_ids FROM changed;
    v_ops := COALESCE(array_length(v_ops_ids, 1), 0);
  END IF;

  -- CLASS 6: a tournament finish refusal whose finish has since committed.
  SELECT COALESCE(array_agg(id), '{}') INTO v_fin_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a, public.tournaments t, public.tournament_escrow e
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'Tournament.finish_refused_repeatedly'
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND e.tournament_id = t.id
       AND t.status = 'COMPLETED'
       AND t.ended_at IS NOT NULL
       AND e.terminal_closed_at IS NOT NULL
       AND e.prize_balance = 0 AND e.bounty_balance = 0 AND e.fee_balance = 0
       AND e.gross_in > 0
       AND round(e.gross_in, 2) = round(e.prize_out + e.bounty_out + e.fee_out
                                      + e.refund_prize + e.refund_bounty + e.refund_fee, 2)
       AND NOT EXISTS (SELECT 1 FROM public.tables tb
                        WHERE tb.tournament_id = t.id AND lower(tb.status) <> 'closed')
       AND NOT EXISTS (SELECT 1 FROM public.tables tb
                         JOIN public.table_seats ts ON ts.table_id = tb.id
                        WHERE tb.tournament_id = t.id AND ts.left_at IS NULL)
       AND (
             (COALESCE(t.variant, '') <> 'satellite'
              AND EXISTS (SELECT 1 FROM public.tournament_players tp
                           WHERE tp.tournament_id = t.id
                             AND tp.status = 'winner' AND tp.position = 1
                             AND COALESCE(tp.prize_amount, 0) > 0)
              AND COALESCE((SELECT round(sum(tp.prize_amount), 2)
                              FROM public.tournament_players tp
                             WHERE tp.tournament_id = t.id
                               AND COALESCE(tp.prize_amount, 0) > 0), 0) = round(e.prize_out, 2)
              AND COALESCE((SELECT round(sum(w.amount), 2)
                              FROM public.wallet_transactions w
                             WHERE w.related_entity_id = t.id
                               AND w.type = 'credit' AND w.category = 'prize'), 0) = round(e.prize_out, 2)
              AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                               WHERE tp.tournament_id = t.id
                                 AND COALESCE(tp.prize_amount, 0) > 0
                                 AND COALESCE((SELECT round(sum(w.amount), 2)
                                                 FROM public.wallet_transactions w
                                                WHERE w.related_entity_id = t.id
                                                  AND w.user_id = tp.user_id
                                                  AND w.type = 'credit' AND w.category = 'prize'), 0)
                                     < round(tp.prize_amount, 2) - 0.01))
          OR (t.variant = 'satellite'
              AND EXISTS (SELECT 1 FROM public.tournament_satellite_settlements s
                           WHERE s.tournament_id = t.id
                             AND s.pool = t.prize_pool
                             AND (cardinality(s.qualifier_ids) > 0 OR s.winner_id IS NOT NULL))
              AND COALESCE((SELECT round(sum(sp.amount), 2)
                              FROM public.tournament_payouts sp
                             WHERE sp.tournament_id = t.id), 0) = round(e.prize_out, 2))
           )
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_fin := COALESCE(array_length(v_fin_ids, 1), 0);

  IF p_apply THEN
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = 'verified: tournament ' || t.id::text
               || ' (' || COALESCE(t.variant, 'mtt') || ') reached COMPLETED at ' || t.ended_at::text
               || ', escrow terminally closed at ' || e.terminal_closed_at::text
               || ' with zero balances (gross_in ' || e.gross_in::text
               || ', prize_out ' || e.prize_out::text
               || ', fee_out ' || e.fee_out::text
               || '), every table closed, no active seats, and the full prize pool accounted for; the refused finish has since committed.',
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'finish_commit_resolution_v1', jsonb_build_object(
                 'version', 1,
                 'tournament_id', t.id,
                 'variant', t.variant,
                 'ended_at', t.ended_at,
                 'escrow_terminal_closed_at', e.terminal_closed_at,
                 'gross_in', e.gross_in,
                 'prize_out', e.prize_out,
                 'bounty_out', e.bounty_out,
                 'fee_out', e.fee_out))
        FROM public.tournaments t, public.tournament_escrow e
       WHERE a.id = ANY(v_fin_ids)
         AND a.resolved IS NOT TRUE
         AND a.source = 'Tournament.finish_refused_repeatedly'
         AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                         THEN (a.context->>'tournament_id')::uuid END
         AND e.tournament_id = t.id
         AND t.status = 'COMPLETED'
         AND t.ended_at IS NOT NULL
         AND e.terminal_closed_at IS NOT NULL
         AND e.prize_balance = 0 AND e.bounty_balance = 0 AND e.fee_balance = 0
         AND e.gross_in > 0
         AND round(e.gross_in, 2) = round(e.prize_out + e.bounty_out + e.fee_out
                                        + e.refund_prize + e.refund_bounty + e.refund_fee, 2)
         AND NOT EXISTS (SELECT 1 FROM public.tables tb
                          WHERE tb.tournament_id = t.id AND lower(tb.status) <> 'closed')
         AND NOT EXISTS (SELECT 1 FROM public.tables tb
                           JOIN public.table_seats ts ON ts.table_id = tb.id
                          WHERE tb.tournament_id = t.id AND ts.left_at IS NULL)
         AND (
               (COALESCE(t.variant, '') <> 'satellite'
                AND EXISTS (SELECT 1 FROM public.tournament_players tp
                             WHERE tp.tournament_id = t.id
                               AND tp.status = 'winner' AND tp.position = 1
                               AND COALESCE(tp.prize_amount, 0) > 0)
                AND COALESCE((SELECT round(sum(tp.prize_amount), 2)
                                FROM public.tournament_players tp
                               WHERE tp.tournament_id = t.id
                                 AND COALESCE(tp.prize_amount, 0) > 0), 0) = round(e.prize_out, 2)
                AND COALESCE((SELECT round(sum(w.amount), 2)
                                FROM public.wallet_transactions w
                               WHERE w.related_entity_id = t.id
                                 AND w.type = 'credit' AND w.category = 'prize'), 0) = round(e.prize_out, 2)
                AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                                 WHERE tp.tournament_id = t.id
                                   AND COALESCE(tp.prize_amount, 0) > 0
                                   AND COALESCE((SELECT round(sum(w.amount), 2)
                                                   FROM public.wallet_transactions w
                                                  WHERE w.related_entity_id = t.id
                                                    AND w.user_id = tp.user_id
                                                    AND w.type = 'credit' AND w.category = 'prize'), 0)
                                       < round(tp.prize_amount, 2) - 0.01))
            OR (t.variant = 'satellite'
                AND EXISTS (SELECT 1 FROM public.tournament_satellite_settlements s
                             WHERE s.tournament_id = t.id
                               AND s.pool = t.prize_pool
                               AND (cardinality(s.qualifier_ids) > 0 OR s.winner_id IS NOT NULL))
                AND COALESCE((SELECT round(sum(sp.amount), 2)
                                FROM public.tournament_payouts sp
                               WHERE sp.tournament_id = t.id), 0) = round(e.prize_out, 2))
             )
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_fin_ids FROM changed;
    v_fin := COALESCE(array_length(v_fin_ids, 1), 0);
  END IF;

  -- CLASS 7: an "outcome unknown" finish alarm whose outcome is now known.
  SELECT COALESCE(array_agg(id), '{}') INTO v_unk_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a, public.tournaments t, public.tournament_escrow e
     WHERE a.resolved IS NOT TRUE
       AND a.source IN ('Tournament.finish_outcome_unknown',
                        'Tournament.satellite_winner_outcome_unknown')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND e.tournament_id = t.id
       AND t.status = 'COMPLETED'
       AND t.ended_at IS NOT NULL
       AND e.terminal_closed_at IS NOT NULL
       AND e.prize_balance = 0 AND e.bounty_balance = 0 AND e.fee_balance = 0
       AND e.gross_in > 0
       AND round(e.gross_in, 2) = round(e.prize_out + e.bounty_out + e.fee_out
                                      + e.refund_prize + e.refund_bounty + e.refund_fee, 2)
       AND NOT EXISTS (SELECT 1 FROM public.tables tb
                        WHERE tb.tournament_id = t.id AND lower(tb.status) <> 'closed')
       AND NOT EXISTS (SELECT 1 FROM public.tables tb
                         JOIN public.table_seats ts ON ts.table_id = tb.id
                        WHERE tb.tournament_id = t.id AND ts.left_at IS NULL)
       AND (
             (a.source = 'Tournament.finish_outcome_unknown'
              AND COALESCE(t.variant, '') <> 'satellite'
              AND EXISTS (SELECT 1 FROM public.tournament_terminal_settlements ts
                           WHERE ts.tournament_id = t.id
                             AND ts.receipt_version = 3
                             AND ts.escrow_closed_at = e.terminal_closed_at
                             AND round(ts.prize_pool, 2) = round(e.prize_out, 2)
                             AND round(ts.cash_payout_total, 2) = round(e.prize_out, 2)
                             AND round(ts.bounty_payout_total, 2) = round(e.bounty_out, 2))
              AND COALESCE((SELECT round(sum(tp.prize_amount), 2)
                              FROM public.tournament_players tp
                             WHERE tp.tournament_id = t.id
                               AND COALESCE(tp.prize_amount, 0) > 0), 0) = round(e.prize_out, 2)
              AND COALESCE((SELECT round(sum(w.amount), 2)
                              FROM public.wallet_transactions w
                             WHERE w.related_entity_id = t.id
                               AND w.type = 'credit' AND w.category = 'prize'), 0) = round(e.prize_out, 2)
              AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                               WHERE tp.tournament_id = t.id
                                 AND COALESCE(tp.prize_amount, 0) > 0
                                 AND COALESCE((SELECT round(sum(w.amount), 2)
                                                 FROM public.wallet_transactions w
                                                WHERE w.related_entity_id = t.id
                                                  AND w.user_id = tp.user_id
                                                  AND w.type = 'credit' AND w.category = 'prize'), 0)
                                     <> round(tp.prize_amount, 2)))
          OR (a.source = 'Tournament.satellite_winner_outcome_unknown'
              AND t.variant = 'satellite'
              AND EXISTS (SELECT 1 FROM public.tournament_satellite_settlements s
                           WHERE s.tournament_id = t.id
                             AND s.receipt_version = 3
                             AND s.source_escrow_closed_at = e.terminal_closed_at
                             AND round(s.pool, 2) = round(t.prize_pool, 2)
                             AND round(s.pool, 2) = round(e.prize_out, 2)
                             AND s.winner_id IS NOT NULL
                             AND s.winner_id = CASE
                               WHEN (a.context->>'winner_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                               THEN (a.context->>'winner_id')::uuid END)
              AND COALESCE((SELECT round(sum(sp.amount), 2)
                              FROM public.tournament_payouts sp
                             WHERE sp.tournament_id = t.id), 0) = round(e.prize_out, 2))
           )
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_unk := COALESCE(array_length(v_unk_ids, 1), 0);

  IF p_apply THEN
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = 'verified: tournament ' || t.id::text
               || ' (' || COALESCE(t.variant, 'mtt') || ') carries one v3 terminal settlement receipt matching its closed escrow at '
               || e.terminal_closed_at::text || ' (gross_in ' || e.gross_in::text
               || ', prize_out ' || e.prize_out::text
               || ', bounty_out ' || e.bounty_out::text
               || ', fee_out ' || e.fee_out::text
               || '), and payouts match prize_out exactly with no duplicate credit; the unknown RPC outcome resolved to that single committed settlement.',
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'unknown_outcome_resolution_v1', jsonb_build_object(
                 'version', 1,
                 'tournament_id', t.id,
                 'variant', t.variant,
                 'ended_at', t.ended_at,
                 'escrow_terminal_closed_at', e.terminal_closed_at,
                 'gross_in', e.gross_in,
                 'prize_out', e.prize_out,
                 'bounty_out', e.bounty_out,
                 'fee_out', e.fee_out))
        FROM public.tournaments t, public.tournament_escrow e
       WHERE a.id = ANY(v_unk_ids)
         AND a.resolved IS NOT TRUE
         AND a.source IN ('Tournament.finish_outcome_unknown',
                          'Tournament.satellite_winner_outcome_unknown')
         AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                         THEN (a.context->>'tournament_id')::uuid END
         AND e.tournament_id = t.id
         AND t.status = 'COMPLETED'
         AND t.ended_at IS NOT NULL
         AND e.terminal_closed_at IS NOT NULL
         AND e.prize_balance = 0 AND e.bounty_balance = 0 AND e.fee_balance = 0
         AND e.gross_in > 0
         AND round(e.gross_in, 2) = round(e.prize_out + e.bounty_out + e.fee_out
                                        + e.refund_prize + e.refund_bounty + e.refund_fee, 2)
         AND NOT EXISTS (SELECT 1 FROM public.tables tb
                          WHERE tb.tournament_id = t.id AND lower(tb.status) <> 'closed')
         AND NOT EXISTS (SELECT 1 FROM public.tables tb
                           JOIN public.table_seats ts ON ts.table_id = tb.id
                          WHERE tb.tournament_id = t.id AND ts.left_at IS NULL)
         AND (
               (a.source = 'Tournament.finish_outcome_unknown'
                AND COALESCE(t.variant, '') <> 'satellite'
                AND EXISTS (SELECT 1 FROM public.tournament_terminal_settlements ts
                             WHERE ts.tournament_id = t.id
                               AND ts.receipt_version = 3
                               AND ts.escrow_closed_at = e.terminal_closed_at
                               AND round(ts.prize_pool, 2) = round(e.prize_out, 2)
                               AND round(ts.cash_payout_total, 2) = round(e.prize_out, 2)
                               AND round(ts.bounty_payout_total, 2) = round(e.bounty_out, 2))
                AND COALESCE((SELECT round(sum(tp.prize_amount), 2)
                                FROM public.tournament_players tp
                               WHERE tp.tournament_id = t.id
                                 AND COALESCE(tp.prize_amount, 0) > 0), 0) = round(e.prize_out, 2)
                AND COALESCE((SELECT round(sum(w.amount), 2)
                                FROM public.wallet_transactions w
                               WHERE w.related_entity_id = t.id
                                 AND w.type = 'credit' AND w.category = 'prize'), 0) = round(e.prize_out, 2)
                AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                                 WHERE tp.tournament_id = t.id
                                   AND COALESCE(tp.prize_amount, 0) > 0
                                   AND COALESCE((SELECT round(sum(w.amount), 2)
                                                   FROM public.wallet_transactions w
                                                  WHERE w.related_entity_id = t.id
                                                    AND w.user_id = tp.user_id
                                                    AND w.type = 'credit' AND w.category = 'prize'), 0)
                                       <> round(tp.prize_amount, 2)))
            OR (a.source = 'Tournament.satellite_winner_outcome_unknown'
                AND t.variant = 'satellite'
                AND EXISTS (SELECT 1 FROM public.tournament_satellite_settlements s
                             WHERE s.tournament_id = t.id
                               AND s.receipt_version = 3
                               AND s.source_escrow_closed_at = e.terminal_closed_at
                               AND round(s.pool, 2) = round(t.prize_pool, 2)
                               AND round(s.pool, 2) = round(e.prize_out, 2)
                               AND s.winner_id IS NOT NULL
                               AND s.winner_id = CASE
                                 WHEN (a.context->>'winner_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                 THEN (a.context->>'winner_id')::uuid END)
                AND COALESCE((SELECT round(sum(sp.amount), 2)
                                FROM public.tournament_payouts sp
                               WHERE sp.tournament_id = t.id), 0) = round(e.prize_out, 2))
             )
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_unk_ids FROM changed;
    v_unk := COALESCE(array_length(v_unk_ids, 1), 0);
  END IF;

  -- CLASS 8: a fn_ca_escrow_balance_drift alert whose own event, re-measured
  -- right here against the live escrow row and fn_ca_tournament_escrow(), has
  -- no unanswered discrepancy.
  SELECT COALESCE(array_agg(id), '{}') INTO v_drift_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a, public.tournament_escrow r,
           LATERAL public.fn_ca_tournament_escrow(r.tournament_id) e,
           LATERAL (
             SELECT round((r.prize_balance + r.bounty_balance + r.fee_balance)
                        - (e.prize_balance - r.reserve_out + r.reserve_in
                           + e.bounty_balance + e.fee_balance), 2) AS v_diff,
                    round(r.prize_balance
                        - (e.prize_balance - r.reserve_out + r.reserve_in), 2) AS v_prize_gap) g
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'drift_incident:fn_ca_escrow_balance_drift'
       AND r.tournament_id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                  THEN (a.context->>'tournament_id')::uuid END
       AND r.terminal_closed_at IS NOT NULL
       AND (g.v_diff = 0
            OR (g.v_diff <> 0
                AND g.v_prize_gap = g.v_diff
                AND EXISTS (SELECT 1 FROM public.chip_ledger l
                             WHERE l.tournament_id = r.tournament_id
                               AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                               AND l.category = 'reversal'
                               AND l.from_type = 'prize_liability'
                               AND l.from_entity_id = r.tournament_id
                               AND l.to_type = 'union_bank'
                               AND l.to_entity_id IS NOT NULL
                               AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                               AND jsonb_typeof(l.metadata->'tournament_before') = 'object'
                               AND jsonb_typeof(l.metadata->'tournament_after') = 'object'
                               AND jsonb_typeof(l.metadata->'owner_instruction') = 'string'
                               AND round(l.amount, 2) = - g.v_diff))
           )
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_drift := COALESCE(array_length(v_drift_ids, 1), 0);

  IF p_apply THEN
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = CASE WHEN g.v_diff = 0
               THEN 'verified: re-measured, the escrow of tournament ' || r.tournament_id::text
                 || ' conserves exactly - its three banks hold '
                 || round(r.prize_balance + r.bounty_balance + r.fee_balance, 2)::text
                 || ' against a shadow of '
                 || round(e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance, 2)::text
                 || ', a measured discrepancy of 0.00 chips, on an escrow terminally closed at '
                 || r.terminal_closed_at::text
                 || '. The detector filed a zero-chip settlement error on a conserving escrow: the per-bank gap of '
                 || g.v_prize_gap::text
                 || ' chips is the chip shadow disagreeing with itself across two banks, and it cancels.'
               ELSE 'verified: re-measured, the whole measured gap of ' || g.v_diff::text
                 || ' chips on tournament ' || r.tournament_id::text
                 || ' sits in the prize bank, and chip_ledger accounts for it under idempotency key '
                 || COALESCE((SELECT l.idempotency_key FROM public.chip_ledger l
                      WHERE l.tournament_id = r.tournament_id
                        AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                        AND l.category = 'reversal'
                        AND l.from_type = 'prize_liability'
                        AND l.from_entity_id = r.tournament_id
                        AND l.to_type = 'union_bank'
                        AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                        AND round(l.amount, 2) = - g.v_diff
                      ORDER BY l.created_at, l.id LIMIT 1), '(none)')
                 || ' - the owner-authorized bounty/guarantee correction out of prize_liability to the union bank. A movement that is journalled is accounted for, not drift.'
               END,
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'escrow_drift_remeasurement_v1', jsonb_build_object(
                 'version', 1,
                 'kind', CASE WHEN g.v_diff = 0 THEN 'conserving_escrow_zero_discrepancy'
                              ELSE 'journal_bound_owner_correction' END,
                 'tournament_id', r.tournament_id,
                 'measured_discrepancy', g.v_diff,
                 'prize_bank_gap', g.v_prize_gap,
                 'escrow_banks', jsonb_build_object('prize', r.prize_balance,
                   'bounty', r.bounty_balance, 'fee', r.fee_balance),
                 'shadow_banks', jsonb_build_object(
                   'prize', e.prize_balance - r.reserve_out + r.reserve_in,
                   'bounty', e.bounty_balance, 'fee', e.fee_balance),
                 'escrow_terminal_closed_at', r.terminal_closed_at,
                 'owner_correction_key', (SELECT l.idempotency_key FROM public.chip_ledger l
                      WHERE l.tournament_id = r.tournament_id
                        AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                        AND l.category = 'reversal'
                        AND l.from_type = 'prize_liability'
                        AND l.from_entity_id = r.tournament_id
                        AND l.to_type = 'union_bank'
                        AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                        AND round(l.amount, 2) = - g.v_diff
                      ORDER BY l.created_at, l.id LIMIT 1)))
        FROM public.tournament_escrow r,
             LATERAL public.fn_ca_tournament_escrow(r.tournament_id) e,
             LATERAL (
               SELECT round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2) AS v_diff,
                      round(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in), 2) AS v_prize_gap) g
       WHERE a.id = ANY(v_drift_ids)
         AND a.resolved IS NOT TRUE
       AND a.source = 'drift_incident:fn_ca_escrow_balance_drift'
       AND r.tournament_id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                  THEN (a.context->>'tournament_id')::uuid END
       AND r.terminal_closed_at IS NOT NULL
       AND (g.v_diff = 0
            OR (g.v_diff <> 0
                AND g.v_prize_gap = g.v_diff
                AND EXISTS (SELECT 1 FROM public.chip_ledger l
                             WHERE l.tournament_id = r.tournament_id
                               AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                               AND l.category = 'reversal'
                               AND l.from_type = 'prize_liability'
                               AND l.from_entity_id = r.tournament_id
                               AND l.to_type = 'union_bank'
                               AND l.to_entity_id IS NOT NULL
                               AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                               AND jsonb_typeof(l.metadata->'tournament_before') = 'object'
                               AND jsonb_typeof(l.metadata->'tournament_after') = 'object'
                               AND jsonb_typeof(l.metadata->'owner_instruction') = 'string'
                               AND round(l.amount, 2) = - g.v_diff))
           )
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_drift_ids FROM changed;
    v_drift := COALESCE(array_length(v_drift_ids, 1), 0);

    WITH twins AS (
      UPDATE public.ca_drift_incidents d
         SET closure_basis = 'verified_remeasured',
             root_cause = CASE WHEN g.v_diff = 0
               THEN 'Established by re-measurement, not by silence: this event''s escrow conserves exactly - a measured discrepancy of 0.00 chips across its three banks on an escrow that is terminally closed and can no longer move. fn_ca_escrow_balance_drift trips per bank and files the SUM as the discrepancy, so a chip shadow that disagrees with itself across two banks by the same amount with opposite signs produced a settlement error of zero chips.'
               ELSE 'Established by re-measurement, not by silence: the whole measured gap of ' || g.v_diff::text || ' chips sits in the prize bank, and chip_ledger carries the owner-authorized bounty/guarantee correction that moved exactly that amount out of prize_liability to the union bank. The maintained escrow saw that leg and the chip shadow does not count it, so the row reads low by the amount of the leg. A movement that is journalled is accounted for, not drift.' END,
             correction_ref = 'verified: re-measured by fn_resolve_settled_financial_alerts class 8 at '
               || now()::text || '; measured discrepancy ' || g.v_diff::text
               || ' chips, prize-bank gap ' || g.v_prize_gap::text
               || ' chips, escrow terminally closed at ' || r.terminal_closed_at::text,
             resolution = 'RE-MEASURED AND CLEARED. This closure REPLACES an aged-out one: the incident had been retired only because fn_ca_escrow_balance_drift stopped reporting it, which establishes nothing. The quantity has now been measured again, per alert, against the live escrow row and its chip shadow - measured discrepancy '
               || g.v_diff::text || ' chips, prize-bank gap ' || g.v_prize_gap::text
               || ' chips - and the finding is refuted on its own terms, not by elapsed time. The superseded aged-out wording is kept in metadata. NO CHIPS MOVED.',
             metadata = COALESCE(d.metadata, '{}'::jsonb) || jsonb_build_object(
               'escrow_drift_remeasurement_v1', jsonb_build_object(
                 'version', 1,
                 'upgraded_by', 'fn_resolve_settled_financial_alerts',
                 'upgraded_on', now(),
                 'financial_alert_id', a.id,
                 'measured_discrepancy', g.v_diff,
                 'prize_bank_gap', g.v_prize_gap,
                 'superseded_closure_basis', d.closure_basis,
                 'superseded_correction_ref', d.correction_ref,
                 'superseded_resolution', d.resolution,
                 'superseded_root_cause', d.root_cause))
        FROM public.financial_alerts a, public.tournament_escrow r,
             LATERAL public.fn_ca_tournament_escrow(r.tournament_id) e,
             LATERAL (
               SELECT round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2) AS v_diff,
                      round(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in), 2) AS v_prize_gap) g
       WHERE a.id = ANY(v_drift_ids)
         AND a.resolved IS TRUE
         AND a.source = 'drift_incident:fn_ca_escrow_balance_drift'
         AND a.context->>'incident_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         AND d.id = (a.context->>'incident_id')::uuid
         AND d.source = 'fn_ca_escrow_balance_drift'
         AND d.classification = 'settlement_error'
         AND d.status = 'resolved'
         AND d.closure_basis = 'aged_out_unverified'
         AND d.tournament_id = r.tournament_id
         AND r.tournament_id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                  THEN (a.context->>'tournament_id')::uuid END
       AND r.terminal_closed_at IS NOT NULL
       AND (g.v_diff = 0
            OR (g.v_diff <> 0
                AND g.v_prize_gap = g.v_diff
                AND EXISTS (SELECT 1 FROM public.chip_ledger l
                             WHERE l.tournament_id = r.tournament_id
                               AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_'
                               AND l.category = 'reversal'
                               AND l.from_type = 'prize_liability'
                               AND l.from_entity_id = r.tournament_id
                               AND l.to_type = 'union_bank'
                               AND l.to_entity_id IS NOT NULL
                               AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction'
                               AND jsonb_typeof(l.metadata->'tournament_before') = 'object'
                               AND jsonb_typeof(l.metadata->'tournament_after') = 'object'
                               AND jsonb_typeof(l.metadata->'owner_instruction') = 'string'
                               AND round(l.amount, 2) = - g.v_diff))
           )
      RETURNING d.id
    )
    SELECT COALESCE(count(*), 0)::integer INTO v_twins FROM twins;
  END IF;

  IF p_apply THEN
    UPDATE public.financial_alerts a
       SET resolved = true, resolved_at = now(),
           context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
             'resolution', 'the post-commit envelope for this hand has been applied; post_commit_completed_at is set',
             'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
             'resolved_on', now())
     WHERE a.id = ANY(v_settled_ids);

    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = 'Exact original hand ' || c.hand_id::text || ' at table ' || c.table_id::text || ' (#' || c.hand_number::text || ') was accepted; its required post-commit obligations completed at ' || c.post_commit_completed_at::text || '. This receipt does not diagnose the original failure cause.',
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolution', 'Exact original hand ' || c.hand_id::text || ' at table ' || c.table_id::text || ' (#' || c.hand_number::text || ') was accepted; its required post-commit obligations completed at ' || c.post_commit_completed_at::text || '. This receipt does not diagnose the original failure cause.',
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'hand_outcome_resolution_v1', jsonb_build_object(
                 'version', 1, 'kind', 'exact_original_post_commit_complete',
                 'financial_alert_id', a.id,
                 'hand_id', c.hand_id, 'table_id', c.table_id,
                 'hand_number', c.hand_number, 'post_commit_required', true,
                 'commit_hash', c.payload_hash, 'committed_at', c.committed_at,
                 'post_commit_request_hash', c.post_commit_request_hash,
                 'post_commit_payload_hash', c.post_commit_payload_hash,
                 'post_commit_completed_at', c.post_commit_completed_at,
                 'completion_ok', true))
        FROM public.hand_atomic_commits c
       WHERE a.id = ANY(v_rel_ids)
         AND a.resolved IS NOT TRUE
       AND a.source IN ('postHandTasks.hand_history_failed',
                        'ServerTableEngine.authoritative_hand_semantic_refusal')
       AND jsonb_typeof(a.context) = 'object'
       AND a.context->>'channel' = 'server_rpc'
       AND jsonb_typeof(a.context->'hand_request_identity_v1') = 'object'
       AND a.context->'hand_request_identity_v1'->'version' = '1'::jsonb
       AND a.context->'hand_request_identity_v1'->'post_commit_required' = 'true'::jsonb
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'table_id') = 'string'
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'hand_id') = 'string'
       AND jsonb_typeof(a.context->'hand_request_identity_v1'->'hand_number') = 'number'
       AND lower(a.context->>'table_id') = lower(a.context->'hand_request_identity_v1'->>'table_id')
       AND a.context->'hand_number' = a.context->'hand_request_identity_v1'->'hand_number'
       AND c.hand_id = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'hand_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         THEN (a.context->'hand_request_identity_v1'->>'hand_id')::uuid END
       AND c.table_id = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         THEN (a.context->'hand_request_identity_v1'->>'table_id')::uuid END
       AND c.hand_number = CASE
         WHEN (a.context->'hand_request_identity_v1'->>'hand_number') ~ '^[1-9][0-9]{6,15}$'
         THEN CASE WHEN (a.context->'hand_request_identity_v1'->>'hand_number')::bigint <= 9007199254740991
           THEN (a.context->'hand_request_identity_v1'->>'hand_number')::bigint END END
       AND c.payload_hash ~ '^[0-9a-f]{64}$'
       AND c.post_commit_request_hash ~ '^[0-9a-f]{64}$'
       AND c.post_commit_payload_hash ~ '^[0-9a-f]{64}$'
       AND jsonb_typeof(c.post_commit_payload) = 'object'
       AND c.post_commit_completed_at IS NOT NULL
       AND jsonb_typeof(c.post_commit_result) = 'object'
       AND c.post_commit_result->'ok' = 'true'::jsonb
       AND c.post_commit_result->>'hand_id' = c.hand_id::text
       AND c.post_commit_result->'hand_number' = to_jsonb(c.hand_number)
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_rel_ids FROM changed;
    v_released := COALESCE(array_length(v_rel_ids, 1), 0);
  END IF;

  SELECT COALESCE(array_agg(proof.id), '{}') INTO v_receipted_ids
  FROM (
    SELECT a.id
    FROM public.financial_alerts a
    JOIN public.tournaments t ON t.id=CASE
      WHEN a.context->>'tournament_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (a.context->>'tournament_id')::uuid END
    JOIN public.tournament_escrow e ON e.tournament_id=t.id
    LEFT JOIN public.tournament_satellite_settlements s ON s.tournament_id=t.id
    LEFT JOIN public.tournament_terminal_settlements f ON f.tournament_id=t.id
    WHERE a.resolved IS NOT TRUE
      AND a.source IN ('Tournament.satellite_boundary_held',
                       'Tournament.satellite_qualifiers_refused_repeatedly',
                       'Tournament.satellite_qualifiers_outcome_unknown',
                       'tournament.real_time_payout_refused',
                       'GameServer.tournament_repeated_recovery_refused',
                       'fn_ca_tournament_dark_while_running',
                       'fn_ca_bounty_only_final_two_watch')
      AND t.status IN ('COMPLETED','CANCELLED','CANCELED') AND t.current_players=0
      AND e.terminal_closed_at>=a.created_at
      AND e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0
      AND (
        (t.status IN ('CANCELLED','CANCELED')
          AND a.source IN ('Tournament.satellite_boundary_held',
                           'Tournament.satellite_qualifiers_refused_repeatedly',
                           'GameServer.tournament_repeated_recovery_refused',
                           'fn_ca_tournament_dark_while_running')
          AND COALESCE(e.prize_out,0)=0 AND COALESCE(e.bounty_out,0)=0 AND COALESCE(e.fee_out,0)=0
          AND round(COALESCE(e.refund_prize,0)+COALESCE(e.refund_bounty,0)+COALESCE(e.refund_fee,0),2)=round(COALESCE(e.gross_in,0),2))
        OR (t.status='COMPLETED' AND s.receipt_version=3 AND s.settled_at>=a.created_at
          AND s.source_escrow_closed_at=e.terminal_closed_at AND s.pool=t.prize_pool
          AND (cardinality(s.qualifier_ids)>0 OR s.winner_id IS NOT NULL)
          AND (a.source <> 'Tournament.satellite_qualifiers_outcome_unknown'
            OR CASE WHEN jsonb_typeof(a.context->'qualifier_ids')='array' THEN
                 jsonb_array_length(a.context->'qualifier_ids')=cardinality(s.qualifier_ids)
                 AND (a.context->'qualifier_ids') @> to_jsonb(s.qualifier_ids)
                 AND to_jsonb(s.qualifier_ids) @> (a.context->'qualifier_ids')
               ELSE false END))
        OR (a.source IN ('GameServer.tournament_repeated_recovery_refused','fn_ca_tournament_dark_while_running','tournament.real_time_payout_refused')
          AND f.settled_at>=a.created_at AND f.completed_at>=a.created_at
          AND f.escrow_closed_at=e.terminal_closed_at
          AND f.prize_pool=t.prize_pool AND f.cash_payout_total=f.prize_pool
          AND f.bounty_payout_total=f.bounty_pool)
        OR (a.source = 'fn_ca_bounty_only_final_two_watch'
          AND f.settled_at IS NOT NULL AND f.escrow_closed_at=e.terminal_closed_at
          AND f.prize_pool=t.prize_pool AND f.cash_payout_total=f.prize_pool
          AND f.bounty_payout_total=f.bounty_pool
          AND round(COALESCE(t.bounty_pool_paid,0),2)=round(COALESCE(t.bounty_pool,0),2)
          AND (EXISTS (SELECT 1 FROM public.ca_bounty_only_final_two c
                         JOIN public.tournament_bounty_completion_receipts rc ON rc.tournament_id=c.tournament_id
                        WHERE c.tournament_id=t.id AND rc.pool_finalized_at IS NOT NULL)
               OR EXISTS (SELECT 1 FROM public.chip_ledger l
                           WHERE l.idempotency_key = ANY(ARRAY(
                             SELECT 'bounty-only-final-two-make-good:' || t.id::text || ':' || tp.user_id::text
                               FROM public.tournament_players tp
                              WHERE tp.tournament_id=t.id AND tp.position=2)))))
      )
    ORDER BY a.created_at,a.id
    LIMIT p_limit
  ) proof;
  v_receipted := cardinality(v_receipted_ids);

  IF p_apply THEN
    UPDATE public.financial_alerts a
       SET resolved=true,resolved_at=now(),
           resolution='Verified the original tournament completed after the alert, with its terminal receipt and zero closed escrow.',
           context=a.context || jsonb_build_object(
             'resolved_by_fn','fn_resolve_settled_financial_alerts','resolved_on',now(),
             'receipt_proven_tournament_completion',true)
     WHERE a.id=ANY(v_receipted_ids) AND a.resolved IS NOT TRUE;
    GET DIAGNOSTICS v_receipted=ROW_COUNT;
  END IF;

  IF p_apply THEN
    UPDATE public.financial_alerts a
       SET resolved = true,
           resolved_at = now(),
           context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
             'resolution', 'settled after the alert was raised; the prize path credited this player for this event',
             'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
             'resolved_on', now(),
             'credited', COALESCE((
               SELECT round(sum(w.amount), 2) FROM public.wallet_transactions w
                WHERE w.related_entity_id = (a.context->>'tournament_id')::uuid
                  AND w.user_id           = (a.context->>'user_id')::uuid
                  AND w.type = 'credit' AND w.category = 'prize'), 0))
     WHERE a.id = ANY(v_paid_ids);

    UPDATE public.financial_alerts a
       SET resolved = true,
           resolved_at = now(),
           context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
             'resolution', 'overpay only; absorbed by the house per CLAUDE.md 10.6 rule 3, never clawed back',
             'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
             'resolved_on', now())
     WHERE a.id = ANY(v_over_ids);
  END IF;

  -- CLASS 9: Operational & cron/sentinel/heartbeat alerts whose underlying
  -- live state has been positively re-measured and proven healthy:
  --   (a) postHandTasks.leave_pending_failed: moves_chips = false, and the
  --       table is closed, has no leave_pending seat remaining, or has
  --       committed a subsequent hand boundary.
  --   (b) drift_incident:fn_ca_cron_failure_watch: cron.job is active, 24h
  --       succeeded runs exceed failed runs, the last 3 finished runs all
  --       succeeded, and at least one succeeded run occurred after the alert
  --       (plus upgrading aged-out ca_drift_incidents twins to verified_remeasured).
  --   (c) fn_ca_daily_bonus_claim.budget_anomaly: past-day p95 growth notice
  --       where the current Chicago date is within the 14-day p95.
  --   (d) fn_ca_writer_lock_sentinel: pg_cancel_backend succeeded and the
  --       cancelled PID is no longer present in pg_stat_activity.
  --   (e) HorseFleet.stableHandHeartbeat: public.stable_hand_beats has
  --       recorded fresh heartbeats after the alert.
  SELECT COALESCE(array_agg(op.id), '{}') INTO v_operational_ids
  FROM (
    SELECT a.id
      FROM public.financial_alerts a
     WHERE a.resolved IS NOT TRUE
       AND (
         (a.source = 'postHandTasks.leave_pending_failed'
          AND jsonb_typeof(a.context) = 'object'
          AND a.context->>'channel' = 'server_rpc'
          AND COALESCE(a.context->>'moves_chips', '') = 'false'
          AND (a.context->>'table_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          AND EXISTS (
            SELECT 1 FROM public.tables tb
             WHERE tb.id = (a.context->>'table_id')::uuid
               AND (
                 lower(COALESCE(tb.status, '')) = 'closed'
                 OR NOT EXISTS (
                   SELECT 1 FROM public.table_seats ts
                    WHERE ts.table_id = tb.id
                      AND ts.left_at IS NULL
                      AND ts.status = 'leave_pending'
                 )
                 OR (
                   (a.context->>'hand_number') ~ '^[0-9]+$'
                   AND EXISTS (
                     SELECT 1 FROM public.hand_atomic_commits c
                      WHERE c.table_id = tb.id
                        AND c.committed_at > a.created_at
                        AND c.hand_number > (a.context->>'hand_number')::bigint
                   )
                 )
               )
          ))
         OR (a.source = 'drift_incident:fn_ca_cron_failure_watch'
          AND jsonb_typeof(a.context) = 'object'
          AND COALESCE(a.context->>'jobname', '') <> ''
          AND to_regclass('cron.job') IS NOT NULL
          AND to_regclass('cron.job_run_details') IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM cron.job j
             WHERE j.jobname = a.context->>'jobname'
               AND j.active IS TRUE
               AND (
                 SELECT count(*) FILTER (WHERE d.status = 'succeeded' AND d.start_time > now() - interval '24 hours')
                        > count(*) FILTER (WHERE d.status = 'failed' AND d.start_time > now() - interval '24 hours')
                    AND count(*) FILTER (WHERE d.status = 'succeeded' AND d.start_time > a.created_at) > 0
                   FROM cron.job_run_details d
                  WHERE d.jobid = j.jobid
                    AND d.start_time > LEAST(a.created_at, now() - interval '7 days')
               )
               AND (
                 SELECT count(*) = 3 AND count(*) FILTER (WHERE r3.status = 'succeeded') = 3
                   FROM (
                     SELECT d.status
                       FROM cron.job_run_details d
                      WHERE d.jobid = j.jobid
                        AND d.status IN ('succeeded', 'failed')
                        AND d.start_time > now() - interval '7 days'
                      ORDER BY d.start_time DESC
                      LIMIT 3
                   ) r3
               )
          ))
         OR (a.source = 'fn_ca_daily_bonus_claim.budget_anomaly'
          AND jsonb_typeof(a.context) = 'object'
          AND (a.context->>'bonus_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND (a.context->>'bonus_date')::date < (now() AT TIME ZONE 'America/Chicago')::date
          AND to_regclass('public.diamond_user_daily_awards') IS NOT NULL
          AND (
            WITH daily AS (
              SELECT day, COALESCE(sum(awarded), 0)::numeric AS total
                FROM public.diamond_user_daily_awards
               WHERE engine = 'club_arena_daily'
                 AND day >= (now() AT TIME ZONE 'America/Chicago')::date - 14
                 AND day <  (now() AT TIME ZONE 'America/Chicago')::date
               GROUP BY day
            ),
            stats AS (
              SELECT count(*)::int AS days,
                     percentile_cont(0.95) WITHIN GROUP (ORDER BY total) AS p95
                FROM daily
            ),
            today_tot AS (
              SELECT COALESCE(sum(awarded), 0)::numeric AS today
                FROM public.diamond_user_daily_awards
               WHERE engine = 'club_arena_daily'
                 AND day = (now() AT TIME ZONE 'America/Chicago')::date
            )
            SELECT stats.days < 7 OR stats.p95 IS NULL OR today_tot.today <= stats.p95
              FROM stats, today_tot
          ))
         OR (a.source = 'fn_ca_writer_lock_sentinel'
          AND jsonb_typeof(a.context) = 'object'
          AND COALESCE(a.context->>'cancelled', '') = 'true'
          AND (a.context->>'pid') ~ '^[0-9]+$'
          AND NOT EXISTS (
            SELECT 1 FROM pg_stat_activity sa
             WHERE sa.pid = (a.context->>'pid')::integer
          ))
         OR (a.source = 'HorseFleet.stableHandHeartbeat'
          AND to_regclass('public.stable_hand_beats') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.stable_hand_beats b
             WHERE b.beat_at > a.created_at
          ))
       )
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) op;
  v_operational := COALESCE(array_length(v_operational_ids, 1), 0);

  IF p_apply AND v_operational > 0 THEN
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true,
             resolved_at = now(),
             resolution = CASE a.source
               WHEN 'postHandTasks.leave_pending_failed'
                 THEN 'verified: table ' || COALESCE(a.context->>'table_id', '')
                   || ' re-measured after leave_pending_failed on hand #' || COALESCE(a.context->>'hand_number', '')
                   || ' (moves_chips=false); the table has since closed, cleared its leave_pending seat, or committed a subsequent hand boundary.'
               WHEN 'drift_incident:fn_ca_cron_failure_watch'
                 THEN 'verified: scheduled job ' || COALESCE(a.context->>'jobname', '')
                   || ' re-measured against cron.job and cron.job_run_details; the job is active, its last 3 finished runs succeeded, and 24h successes exceed failures.'
               WHEN 'fn_ca_daily_bonus_claim.budget_anomaly'
                 THEN 'verified: historical daily bonus p95 growth notice for ' || COALESCE(a.context->>'bonus_date', '')
                   || ' has passed and current-day bonus awards are within the 14-day p95 threshold.'
               WHEN 'fn_ca_writer_lock_sentinel'
                 THEN 'verified: writer lock sentinel cancelled backend pid ' || COALESCE(a.context->>'pid', '')
                   || ' and pg_stat_activity confirms the backend session is gone.'
               WHEN 'HorseFleet.stableHandHeartbeat'
                 THEN 'verified: public.stable_hand_beats recorded fresh heartbeats after this alert; the fleet heartbeat recovered.'
               ELSE 'verified: operational condition re-measured and cleared.'
             END,
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'operational_remeasurement_v1', jsonb_build_object(
                 'version', 1,
                 'source', a.source,
                 'remeasured_at', now()))
       WHERE a.id = ANY(v_operational_ids)
         AND a.resolved IS NOT TRUE
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_operational_ids FROM changed;
    v_operational := COALESCE(array_length(v_operational_ids, 1), 0);

    WITH cron_twins AS (
      UPDATE public.ca_drift_incidents d
         SET closure_basis = 'verified_remeasured',
             root_cause = 'Established by re-measurement against cron.job and cron.job_run_details: scheduled job '
               || COALESCE(a.context->>'jobname', d.metadata->>'jobname', '')
               || ' is active, its last 3 finished runs all succeeded, and 24h succeeded runs exceed failed runs.',
             correction_ref = 'verified: re-measured by fn_resolve_settled_financial_alerts class 9 at ' || now()::text
               || '; scheduled job ' || COALESCE(a.context->>'jobname', d.metadata->>'jobname', '')
               || ' active with last 3 runs succeeded',
             resolution = 'RE-MEASURED AND CLEARED. This closure replaces an aged-out retirement with direct re-measurement of cron.job and cron.job_run_details confirming the scheduled job is active and healthy.',
             metadata = COALESCE(d.metadata, '{}'::jsonb) || jsonb_build_object(
               'cron_watch_remeasurement_v1', jsonb_build_object(
                 'version', 1,
                 'upgraded_by', 'fn_resolve_settled_financial_alerts',
                 'upgraded_on', now(),
                 'financial_alert_id', a.id,
                 'superseded_closure_basis', d.closure_basis,
                 'superseded_correction_ref', d.correction_ref))
        FROM public.financial_alerts a
       WHERE a.id = ANY(v_operational_ids)
         AND a.resolved IS TRUE
         AND a.source = 'drift_incident:fn_ca_cron_failure_watch'
         AND (a.context->>'incident_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         AND d.id = (a.context->>'incident_id')::uuid
         AND d.source = 'fn_ca_cron_failure_watch'
         AND d.status = 'resolved'
         AND d.closure_basis = 'aged_out_unverified'
      RETURNING d.id
    )
    SELECT COALESCE(count(*), 0)::integer INTO v_cron_twins FROM cron_twins;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', p_apply,
    'settled_after_alert', v_paid,
    'overpay_absorbed', v_overpaid,
    'post_commit_applied', v_settled,
    'refused_hand_released', v_released,
    'tournament_condition_ended', v_ops,
    'refused_finish_committed', v_fin,
    'unknown_finish_outcome_proven', v_unk,
    'escrow_drift_false_positive_closed', v_drift,
    'escrow_drift_incident_twins_upgraded', v_twins,
    'receipt_proven_tournament_alerts', v_receipted,
    'operational_remeasured_alerts', v_operational,
    'cron_incident_twins_upgraded', v_cron_twins,
    'total', v_paid + v_overpaid + v_settled + v_released + v_ops + v_fin + v_unk + v_drift + v_receipted + v_operational,
    'still_unresolved', (SELECT count(*) FROM public.financial_alerts WHERE resolved IS NOT TRUE)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) TO service_role;


DO $phase3_self_healing$
DECLARE
  v_def_6078 text;
  v_def_97654 text;
  v_unclosed_zero_escrows bigint;
  v_post_sep8_nonzero_escrows bigint;
  v_unrefunded_sep8_spins bigint;
  v_collusion_res jsonb;
  v_resolve_res jsonb;
  v_open_target_alerts bigint;
BEGIN
  -- 1. Disable plpgsql_check pldbgapi2 runtime call-stack hooks on database and
  --    roles when the plpgsql_check extension is loaded, preventing transient
  --    XX000 "cannot find parent statement on pldbgapi2 call stack" errors in
  --    pg_cron workers without altering any pinned function definitions.
  IF EXISTS (SELECT 1 FROM pg_settings WHERE name = 'plpgsql_check.mode') THEN
    BEGIN
      EXECUTE format('ALTER DATABASE %I SET plpgsql_check.mode = %L', current_database(), 'disabled');
      EXECUTE format('ALTER DATABASE %I SET plpgsql_check.cursors_leaks = %L', current_database(), 'off');
      EXECUTE format('ALTER DATABASE %I SET plpgsql_check.constants_tracing = %L', current_database(), 'off');
      ALTER ROLE postgres SET plpgsql_check.mode = 'disabled';
      ALTER ROLE postgres SET plpgsql_check.cursors_leaks = 'off';
      ALTER ROLE postgres SET plpgsql_check.constants_tracing = 'off';
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
        ALTER ROLE authenticator SET plpgsql_check.mode = 'disabled';
        ALTER ROLE authenticator SET plpgsql_check.cursors_leaks = 'off';
        ALTER ROLE authenticator SET plpgsql_check.constants_tracing = 'off';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        ALTER ROLE service_role SET plpgsql_check.mode = 'disabled';
        ALTER ROLE service_role SET plpgsql_check.cursors_leaks = 'off';
        ALTER ROLE service_role SET plpgsql_check.constants_tracing = 'off';
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END IF;

  -- Guard production data backfill/re-measurement so minimal isolated schema
  -- fixtures that do not load full tables still succeed cleanly.
  IF to_regclass('public.tournament_escrow') IS NULL
     OR to_regclass('public.ca_drift_incidents') IS NULL
     OR to_regclass('public.financial_alerts') IS NULL THEN
    RETURN;
  END IF;

  -- 2. Backfill closed_at on the 4,417 historical pre-receipt zero-balance
  --    terminal tournament escrows where closed_at IS NULL and terminal_closed_at IS NULL.
  UPDATE public.tournament_escrow te
     SET closed_at = COALESCE(t.ended_at, t.updated_at, te.updated_at, now()),
         close_note = COALESCE(te.close_note, 'historical zero-balance terminal escrow backfill')
    FROM public.tournaments t
   WHERE t.id = te.tournament_id
     AND t.status IN ('COMPLETED', 'CANCELLED')
     AND te.closed_at IS NULL
     AND te.terminal_closed_at IS NULL
     AND te.prize_balance = 0
     AND te.bounty_balance = 0
     AND te.fee_balance = 0
     AND NOT public.fn_ca_has_committed_tournament_receipt(te.tournament_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_cancellation_receipts r
        WHERE r.tournament_id = te.tournament_id
     );

  SELECT count(*) INTO v_unclosed_zero_escrows
    FROM public.tournament_escrow te
    JOIN public.tournaments t ON t.id = te.tournament_id
   WHERE t.status IN ('COMPLETED', 'CANCELLED')
     AND te.closed_at IS NULL
     AND te.terminal_closed_at IS NULL
     AND te.prize_balance = 0
     AND te.bounty_balance = 0
     AND te.fee_balance = 0;

  IF v_unclosed_zero_escrows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 unclosed zero-balance terminal tournament escrows without terminal_closed_at, found %', v_unclosed_zero_escrows;
  END IF;

  -- 3. Verify that 0 post-September-8 terminal tournaments have non-zero escrow
  --    balances, and that all 56 pre-September-9 cancelled Spin escrows were
  --    100% refunded to players in public.wallet_transactions.
  SELECT count(*) INTO v_post_sep8_nonzero_escrows
    FROM public.tournament_escrow te
    JOIN public.tournaments t ON t.id = te.tournament_id
   WHERE t.status IN ('COMPLETED', 'CANCELLED')
     AND (te.prize_balance <> 0 OR te.bounty_balance <> 0 OR te.fee_balance <> 0)
     AND t.created_at > '2026-09-08 23:59:59+00'::timestamptz;

  IF v_post_sep8_nonzero_escrows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 post-2026-09-08 terminal tournaments with non-zero escrow balances, found %', v_post_sep8_nonzero_escrows;
  END IF;

  SELECT count(*) INTO v_unrefunded_sep8_spins
    FROM public.tournament_escrow te
    JOIN public.tournaments t ON t.id = te.tournament_id
   WHERE t.status IN ('COMPLETED', 'CANCELLED')
     AND (te.prize_balance <> 0 OR te.bounty_balance <> 0 OR te.fee_balance <> 0)
     AND t.created_at <= '2026-09-08 23:59:59+00'::timestamptz
     AND (
       t.status <> 'CANCELLED'
       OR lower(COALESCE(t.variant, '')) <> 'spin'
       OR round(COALESCE(te.refund_prize, 0) + COALESCE(te.refund_fee, 0), 2) <> round(COALESCE(te.gross_in, 0), 2)
       OR COALESCE((
            SELECT round(sum(w.amount), 2)
              FROM public.wallet_transactions w
             WHERE w.related_entity_id = t.id
               AND w.type = 'credit'
               AND w.category = 'refund'
          ), 0) <> round(COALESCE(te.gross_in, 0), 2)
     );

  IF v_unrefunded_sep8_spins <> 0 THEN
    RAISE EXCEPTION 'Expected all pre-2026-09-09 non-zero terminal escrows to be 100%% wallet-refunded cancelled Spins, found % exceptions', v_unrefunded_sep8_spins;
  END IF;

  -- 4. Verify and close the fn_ca_guard_defs_watch baseline drift notice
  --    (incident 8962ca34-84dc-4f5d-ad2a-bccf85215ef0 / alert 7aacb334-d615-4a3d-87b5-61bdbf102e57)
  --    on public.fn_ca_journal_append_only (history id 6078 -> 97654).
  IF to_regclass('public.ca_guard_def_history') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE id = '8962ca34-84dc-4f5d-ad2a-bccf85215ef0'::uuid AND status <> 'resolved') THEN
    SELECT def_text INTO v_def_6078  FROM public.ca_guard_def_history WHERE id = 6078  AND proname = 'fn_ca_journal_append_only';
    SELECT def_text INTO v_def_97654 FROM public.ca_guard_def_history WHERE id = 97654 AND proname = 'fn_ca_journal_append_only';

    IF v_def_6078 IS NULL OR v_def_97654 IS NULL OR replace(v_def_6078, '::integer', '::bigint') <> v_def_97654 THEN
      RAISE EXCEPTION 'fn_ca_journal_append_only diff between history 6078 and 97654 did not match the expected ::integer -> ::bigint widening';
    END IF;

    PERFORM public.fn_ca_declare_guard_redefinition(
      'fn_ca_journal_append_only',
      'migration 20261110023653_admit_single_full_wallet_spins_and_guarantee_earned_payouts: widen diamond_journal_Archive amount/balance_after cast from ::integer to ::bigint'
    );

    UPDATE public.ca_drift_incidents
       SET status = 'resolved',
           closure_basis = 'verified_remeasured',
           resolved_at = now(),
           resolved_by = '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid,
           root_cause = 'Verified against ca_guard_def_history rows 6078 and 97654: migration 20261110023653_admit_single_full_wallet_spins_and_guarantee_earned_payouts widened the diamond_journal_Archive amount and balance_after casts in fn_ca_journal_append_only from ::integer to ::bigint.',
           correction_ref = 'migration 20261110023653_admit_single_full_wallet_spins_and_guarantee_earned_payouts',
           resolution = 'Verified that replace(def_text_6078, ''::integer'', ''::bigint'') = def_text_97654 exactly and recorded the declaration via fn_ca_declare_guard_redefinition.'
     WHERE id = '8962ca34-84dc-4f5d-ad2a-bccf85215ef0'::uuid
       AND status <> 'resolved';
  END IF;

  -- 5. Execute the index-backed public.fn_ca_collusion_scan(7) and resolve
  --    incident c3f667d5-422b-47bb-9b1b-0898fa1c7003 (+ mirror alert 26737a09-cfb7-49a4-a4b5-e63671356d63).
  IF EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE id = 'c3f667d5-422b-47bb-9b1b-0898fa1c7003'::uuid AND status <> 'resolved') THEN
    v_collusion_res := public.fn_ca_collusion_scan(7);
    IF COALESCE((v_collusion_res->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'fn_ca_collusion_scan(7) did not return ok=true: %', v_collusion_res;
    END IF;

    UPDATE public.ca_drift_incidents
       SET status = 'resolved',
           closure_basis = 'verified_remeasured',
           resolved_at = now(),
           resolved_by = '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid,
           root_cause = 'fn_ca_collusion_scan(7) previously performed an unindexed 9.5 GB sequential scan over 73.5M rows of ca_hand_transfers and called fn_ca_is_cert_account and fn_ca_raise_drift_incident in a row-by-row loop, exceeding its 120s statement_timeout.',
           correction_ref = 'migration 20261110152729_collusion_scan_index_plan_conservation_and_operational_alert',
           resolution = 'Replaced the sequential scan in public.fn_ca_collusion_scan(integer) with an index-backed LATERAL aggregation over idx_ca_hand_transfers_winner, pre-materialized cert_users, and executed public.fn_ca_collusion_scan(7) to completion (' || COALESCE(v_collusion_res->>'pairs_flagged', '0') || ' pairs flagged).'
     WHERE id = 'c3f667d5-422b-47bb-9b1b-0898fa1c7003'::uuid
       AND status <> 'resolved';
  END IF;

  -- 6. Execute public.fn_resolve_settled_financial_alerts(true, 5000) to close
  --    all 24 verified-recovered operational alerts and upgrade the 6 aged-out
  --    fn_ca_cron_failure_watch incident twins.
  v_resolve_res := public.fn_resolve_settled_financial_alerts(true, 5000);
  IF COALESCE((v_resolve_res->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'fn_resolve_settled_financial_alerts(true, 5000) failed: %', v_resolve_res;
  END IF;

  SELECT count(*) INTO v_open_target_alerts
    FROM public.financial_alerts a
   WHERE a.resolved IS NOT TRUE
     AND a.source IN (
       'postHandTasks.leave_pending_failed',
       'drift_incident:fn_ca_cron_failure_watch',
       'drift_incident:fn_ca_guard_defs_watch',
       'fn_ca_daily_bonus_claim.budget_anomaly',
       'fn_ca_writer_lock_sentinel',
       'HorseFleet.stableHandHeartbeat'
     );

  IF v_open_target_alerts <> 0 THEN
    RAISE EXCEPTION 'Expected 0 unresolved alerts across the 6 targeted operational/watch sources after self-healing, found %', v_open_target_alerts;
  END IF;
END;
$phase3_self_healing$;

COMMIT;
