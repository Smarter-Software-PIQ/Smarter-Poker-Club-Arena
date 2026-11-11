CREATE OR REPLACE FUNCTION public.fn_resolve_settled_financial_alerts(p_apply boolean DEFAULT false, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- CLASS 5: a tournament operational alarm whose condition has ended. A
  -- "table can't start" alarm is over when that table has committed a hand
  -- since the alarm, or is closed; a "tournament dark after rebuild" alarm is
  -- over when any of its tables has committed a hand since the alarm. Either
  -- is over when the tournament reached COMPLETED or CANCELLED. Money is not
  -- this class's evidence: a completed event's payout has its own alarm
  -- (class 1, fn_payout_guarantee_check), which this never touches.
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
    -- The whole predicate again under UPDATE: a preview is not authority.
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
               'tournament_status_at_resolution', t.status)
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

  -- CLASS 6: a proven finish refusal whose tournament has since finished. The
  -- engine retries a refused finish and, once it commits, the tournament is
  -- COMPLETED with its terminal receipt (a satellite: its settlement receipt)
  -- and its escrow closed at zero after the alarm was raised. That receipt is
  -- the end of the condition the alarm described. A refusal whose outcome is
  -- unknown, or a tournament in any other state, stays open.
  SELECT COALESCE(array_agg(id), '{}') INTO v_fin_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a, public.tournaments t, public.tournament_escrow e
     WHERE a.resolved IS NOT TRUE
       AND a.source IN ('Tournament.atomic_finish_refused',
                        'Tournament.atomic_satellite_finish_refused')
       AND lower(COALESCE(a.context->>'proven_refusal', '')) IN ('true', 't', '1')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND t.status = 'COMPLETED'
       AND e.tournament_id = t.id
       AND e.terminal_closed_at IS NOT NULL
       AND e.terminal_closed_at >= a.created_at
       AND COALESCE(e.prize_balance, 0) = 0
       AND COALESCE(e.bounty_balance, 0) = 0
       AND CASE WHEN a.source = 'Tournament.atomic_satellite_finish_refused'
             THEN EXISTS (SELECT 1 FROM public.tournament_satellite_settlements s
                           WHERE s.tournament_id = t.id AND s.settled_at IS NOT NULL)
             ELSE EXISTS (SELECT 1 FROM public.tournament_terminal_settlements s
                           WHERE s.tournament_id = t.id)
           END
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_fin := COALESCE(array_length(v_fin_ids, 1), 0);

  IF p_apply THEN
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = 'verified: tournament ' || t.id::text || ' COMPLETED after this refusal; '
               || CASE WHEN a.source = 'Tournament.atomic_satellite_finish_refused'
                       THEN 'its satellite settlement receipt is written'
                       ELSE 'its terminal receipt is written' END
               || ' and its escrow closed at zero at ' || e.terminal_closed_at::text
               || ', so the refused finish was retried and committed.',
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now())
        FROM public.tournaments t, public.tournament_escrow e
       WHERE a.id = ANY(v_fin_ids)
         AND a.resolved IS NOT TRUE
       AND a.source IN ('Tournament.atomic_finish_refused',
                        'Tournament.atomic_satellite_finish_refused')
       AND lower(COALESCE(a.context->>'proven_refusal', '')) IN ('true', 't', '1')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND t.status = 'COMPLETED'
       AND e.tournament_id = t.id
       AND e.terminal_closed_at IS NOT NULL
       AND e.terminal_closed_at >= a.created_at
       AND COALESCE(e.prize_balance, 0) = 0
       AND COALESCE(e.bounty_balance, 0) = 0
       AND CASE WHEN a.source = 'Tournament.atomic_satellite_finish_refused'
             THEN EXISTS (SELECT 1 FROM public.tournament_satellite_settlements s
                           WHERE s.tournament_id = t.id AND s.settled_at IS NOT NULL)
             ELSE EXISTS (SELECT 1 FROM public.tournament_terminal_settlements s
                           WHERE s.tournament_id = t.id)
           END
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_fin_ids FROM changed;
    v_fin := COALESCE(array_length(v_fin_ids, 1), 0);
  END IF;

  -- CLASS 7: a finish whose OUTCOME WAS UNKNOWN, closed only on the single
  -- receipt that proves the finish committed exactly once.
  SELECT COALESCE(array_agg(id), '{}') INTO v_unk_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a, public.tournaments t, public.tournament_escrow e,
           public.tournament_terminal_settlements r
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'Tournament.atomic_finish_outcome_unknown'
       AND lower(COALESCE(a.context->>'outcome_unknown', '')) IN ('true', 't', '1')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND t.status = 'COMPLETED'
       AND t.satellite_target_id IS NULL
       AND e.tournament_id = t.id
       AND e.terminal_closed_at IS NOT NULL
       AND e.terminal_closed_at >= a.created_at
       AND COALESCE(e.prize_balance, 0) = 0
       AND COALESCE(e.bounty_balance, 0) = 0
       AND r.tournament_id = t.id
       AND r.settled_at IS NOT NULL
       AND r.settled_at >= a.created_at
       AND (SELECT count(*) FROM public.tournament_terminal_settlements r2
             WHERE r2.tournament_id = t.id) = 1
       AND round(COALESCE(r.prize_pool, 0), 2) = round(COALESCE(t.prize_pool, 0), 2)
       AND round(COALESCE(r.bounty_pool, 0), 2) = round(COALESCE(t.bounty_pool, 0), 2)
       AND round(COALESCE((SELECT sum(p.amount) FROM public.tournament_payouts p
                            WHERE p.tournament_id = t.id), 0), 2)
             = round(COALESCE(t.prize_pool, 0), 2)
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  ) s;
  v_unk := COALESCE(array_length(v_unk_ids, 1), 0);

  IF p_apply THEN
    -- The whole predicate again under UPDATE: a preview is not authority.
    WITH changed AS (
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = 'verified: tournament ' || t.id::text
               || ' COMPLETED after this unknown outcome and committed exactly once: one terminal receipt, settled at '
               || r.settled_at::text || ', accounts for prize pool '
               || round(COALESCE(t.prize_pool, 0), 2)::text || ' and bounty pool '
               || round(COALESCE(t.bounty_pool, 0), 2)::text
               || '; its payout rows conserve that prize pool to the cent and its escrow closed at zero at '
               || e.terminal_closed_at::text || '.',
             context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
               'resolved_by_fn', 'fn_resolve_settled_financial_alerts',
               'resolved_on', now(),
               'unknown_finish_outcome_resolution_v1', jsonb_build_object(
                 'version', 1, 'kind', 'single_terminal_receipt_conserved',
                 'tournament_id', t.id,
                 'terminal_receipt_count', (SELECT count(*) FROM public.tournament_terminal_settlements r3
                                             WHERE r3.tournament_id = t.id),
                 'receipt_settled_at', r.settled_at,
                 'prize_pool', round(COALESCE(t.prize_pool, 0), 2),
                 'bounty_pool', round(COALESCE(t.bounty_pool, 0), 2),
                 'payouts_total', round(COALESCE((SELECT sum(p.amount) FROM public.tournament_payouts p
                                                   WHERE p.tournament_id = t.id), 0), 2),
                 'escrow_terminal_closed_at', e.terminal_closed_at))
        FROM public.tournaments t, public.tournament_escrow e,
             public.tournament_terminal_settlements r
       WHERE a.id = ANY(v_unk_ids)
         AND a.resolved IS NOT TRUE
       AND a.source = 'Tournament.atomic_finish_outcome_unknown'
       AND lower(COALESCE(a.context->>'outcome_unknown', '')) IN ('true', 't', '1')
       AND t.id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                       THEN (a.context->>'tournament_id')::uuid END
       AND t.status = 'COMPLETED'
       AND t.satellite_target_id IS NULL
       AND e.tournament_id = t.id
       AND e.terminal_closed_at IS NOT NULL
       AND e.terminal_closed_at >= a.created_at
       AND COALESCE(e.prize_balance, 0) = 0
       AND COALESCE(e.bounty_balance, 0) = 0
       AND r.tournament_id = t.id
       AND r.settled_at IS NOT NULL
       AND r.settled_at >= a.created_at
       AND (SELECT count(*) FROM public.tournament_terminal_settlements r2
             WHERE r2.tournament_id = t.id) = 1
       AND round(COALESCE(r.prize_pool, 0), 2) = round(COALESCE(t.prize_pool, 0), 2)
       AND round(COALESCE(r.bounty_pool, 0), 2) = round(COALESCE(t.bounty_pool, 0), 2)
       AND round(COALESCE((SELECT sum(p.amount) FROM public.tournament_payouts p
                            WHERE p.tournament_id = t.id), 0), 2)
             = round(COALESCE(t.prize_pool, 0), 2)
      RETURNING a.id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_unk_ids FROM changed;
    v_unk := COALESCE(array_length(v_unk_ids, 1), 0);
  END IF;

  -- CLASS 8: an escrow DRIFT ALERT that a fresh re-measure refutes.
  SELECT COALESCE(array_agg(id), '{}') INTO v_drift_ids FROM (
    SELECT a.id
      FROM public.financial_alerts a
      JOIN public.tournament_escrow r
        ON r.tournament_id = CASE WHEN (a.context->>'tournament_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                  THEN (a.context->>'tournament_id')::uuid END
      CROSS JOIN LATERAL public.fn_ca_tournament_escrow(r.tournament_id) e
      CROSS JOIN LATERAL (
        SELECT round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2) AS v_diff,
               round(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in), 2) AS v_prize_gap) g
     WHERE a.resolved IS NOT TRUE
       AND a.source = 'drift_incident:fn_ca_escrow_balance_drift'
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
    -- The whole predicate again under UPDATE: a preview is not authority.
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

    -- Repeat the complete guard under UPDATE: preview membership alone is not
    -- authority after a concurrent original-alert identity or status change.
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
$function$
