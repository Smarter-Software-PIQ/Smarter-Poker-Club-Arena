-- 20261108171801_terminal_receipts_resolve_satellite_and_recovery_alerts
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 17:18:02 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- A satellite or recovery alarm survives the original table manager. Let the
-- existing financial alert resolver prove completion from the terminal receipt
-- and closed escrow. Unknown qualifier outcomes also require the exact cohort.
-- @live-proof: position('receipt_proven_tournament_alerts' IN pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_resolve_settled_financial_alerts(boolean,integer)'::regprocedure);
  declare_anchor constant text := '  v_twins     integer := 0;';
  update_anchor constant text := $anchor$  IF p_apply THEN
    UPDATE public.financial_alerts a
       SET resolved = true,
           resolved_at = now(),
           context = COALESCE(a.context, '{}'::jsonb) || jsonb_build_object(
             'resolution', 'settled after the alert was raised; the prize path credited this player for this event',$anchor$;
  result_anchor constant text := $anchor$    'escrow_drift_incident_twins_upgraded', v_twins,$anchor$;
  total_anchor constant text := $anchor$ + v_fin + v_unk + v_drift,$anchor$;
  receipt_class constant text := $class$
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
                       'Tournament.satellite_qualifiers_outcome_unknown',
                       'GameServer.tournament_repeated_recovery_refused',
                       'fn_ca_tournament_dark_while_running')
      AND t.status='COMPLETED' AND t.current_players=0
      AND e.terminal_closed_at>=a.created_at
      AND e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0
      AND (
        (s.receipt_version=3 AND s.settled_at>=a.created_at
          AND s.source_escrow_closed_at=e.terminal_closed_at AND s.pool=t.prize_pool
          AND cardinality(s.qualifier_ids)>0
          AND (a.source <> 'Tournament.satellite_qualifiers_outcome_unknown'
            OR CASE WHEN jsonb_typeof(a.context->'qualifier_ids')='array' THEN
                 jsonb_array_length(a.context->'qualifier_ids')=cardinality(s.qualifier_ids)
                 AND (a.context->'qualifier_ids') @> to_jsonb(s.qualifier_ids)
                 AND to_jsonb(s.qualifier_ids) @> (a.context->'qualifier_ids')
               ELSE false END))
        OR (a.source IN ('GameServer.tournament_repeated_recovery_refused','fn_ca_tournament_dark_while_running')
          AND f.settled_at>=a.created_at AND f.completed_at>=a.created_at
          AND f.escrow_closed_at=e.terminal_closed_at
          AND f.prize_pool=t.prize_pool AND f.cash_payout_total=f.prize_pool
          AND f.bounty_payout_total=f.bounty_pool)
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

$class$;
BEGIN
  IF cardinality(string_to_array(definition, declare_anchor)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(definition, update_anchor)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(definition, result_anchor)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(definition, total_anchor)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TOURNAMENT_ALERT_RESOLVER_PREIMAGE_CHANGED';
  END IF;
  definition := replace(definition, declare_anchor,
    declare_anchor || E'\n  v_receipted integer := 0;\n  v_receipted_ids uuid[] := ''{}'';');
  definition := replace(definition, update_anchor, receipt_class || update_anchor);
  definition := replace(definition, result_anchor,
    result_anchor || E'\n    ''receipt_proven_tournament_alerts'', v_receipted,');
  EXECUTE replace(definition, total_anchor, ' + v_fin + v_unk + v_drift + v_receipted,');
END
$patch$;

COMMIT;
