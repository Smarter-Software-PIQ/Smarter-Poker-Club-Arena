-- A shared tournament registration can be legitimately in progress when the
-- floor watchdog wakes. An exclusive waiter then queues later shared entries.
-- Preserve the original command lock for every real hold, late receipt or alert.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_operator_floor_hold_watchdog()'::regprocedure)) = '355f84a4eedd35ae0079a8a5d277d895')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $migration$
DECLARE
  original text := pg_get_functiondef('public.fn_ca_operator_floor_hold_watchdog()'::regprocedure);
  candidate text;
BEGIN
  IF md5(original) <> 'a75ce8a90eaf1bbf6f6b28187233628e' THEN
    RAISE EXCEPTION 'Floor watchdog changed; revalidate its three sources of pending work';
  END IF;
  candidate := replace(original, $lock$  -- The same lane every floor command takes, so a park, a resume and this
$lock$, $idle$  <<reconcile_floor>>
  BEGIN
  -- A single snapshot can prove an idle tick without queueing an exclusive
  -- floor lock behind admissions. A new park or close after this snapshot
  -- remains the owning command's work. Any visible work is rechecked below
  -- under the original lock before a receipt, release or alert can change.
  IF NOT EXISTS (SELECT 1 FROM public.ca_operator_floor_hold WHERE id = true)
     AND NOT EXISTS (SELECT 1 FROM public.financial_alerts
                       WHERE source = 'fn_ca_operator_floor_hold_watchdog' AND NOT resolved)
     AND NOT EXISTS (
       SELECT 1
       FROM public.ca_operator_table_closes c
       JOIN public.ca_launch_operator_scopes m ON m.operation_id = c.operation_id AND m.actor_id = c.actor_id
       JOIN public.ca_engine_operator_commands cc ON cc.id = c.operation_id AND cc.actor_id = c.actor_id
            AND cc.domain = 'floor' AND cc.action = 'close_cash' AND cc.status = 'completed'
       JOIN public.tables t ON t.id = c.table_id AND t.tournament_id IS NULL
            AND (t.club_id = ANY(m.club_ids) OR t.union_id = ANY(m.club_ids))
       JOIN LATERAL (
         SELECT r.* FROM public.ca_operator_floor_hold_releases r
          WHERE r.scoped AND r.actor_id = c.actor_id AND r.released_at >= cc.created_at
          ORDER BY r.released_at DESC LIMIT 1) r ON true
   WHERE c.status = 'closed'
        AND NOT EXISTS (SELECT 1 FROM public.ca_operator_floor_hold)
        AND public.fn_ca_launch_cash_close_resumed(c.table_id, c.operation_id) IS NOT TRUE
     ) THEN
    EXIT reconcile_floor;
  END IF;

  -- The same lane every floor command takes, so a park, a resume and this
$idle$);
  candidate := replace(candidate, $result$  RETURN jsonb_build_object(
    'ok', true, 'checked_at', v_now$result$, $end$  END reconcile_floor;

  RETURN jsonb_build_object(
    'ok', true, 'checked_at', v_now$end$);
  IF md5(candidate) <> '355f84a4eedd35ae0079a8a5d277d895' THEN
    RAISE EXCEPTION 'Floor watchdog candidate did not preserve the original reconciliation path';
  END IF;
  EXECUTE candidate;
END;
$migration$;

COMMIT;
