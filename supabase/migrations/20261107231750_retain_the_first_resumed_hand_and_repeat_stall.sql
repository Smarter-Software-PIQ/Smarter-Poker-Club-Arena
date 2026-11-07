-- 20261107231750_retain_the_first_resumed_hand_and_repeat_stall
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 23:17:50 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- Observe progress independently of the existing two-hand closure gate.
-- @live-proof: (SELECT md5(prosrc)='256de1031afe8682569c7fcf9e8ecb5d' FROM pg_proc WHERE oid='public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure) AND to_regclass('public.ca_stall_resolved_table_episode_idx') IS NOT NULL

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE INDEX ca_stall_resolved_table_episode_idx ON public.operational_alert_events
  ((payload->>'table_id'), id DESC)
  WHERE source = 'ca-stall-watch' AND alertname = 'TableStoppedDealing' AND status = 'resolved';

DO $migration$
DECLARE
  body text := pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure);
  progress_anchor text := '  IF v_can_resolve THEN';
  repeat_anchor text := '      UPDATE smarter_private.ca_table_stall_watch SET alert_id = v_alert_id, alerted_at = p_now';
BEGIN
  IF (length(body)-length(replace(body,progress_anchor,'')))/length(progress_anchor) <> 1 OR
     (length(body)-length(replace(body,repeat_anchor,'')))/length(repeat_anchor) <> 1 THEN
    RAISE EXCEPTION 'unexpected stall observer source';
  END IF;
  body := replace(body, progress_anchor, $progress$
  -- Watch rows bound the work. The first durable hand is useful even when
  -- only one hand returned and sustained recovery cannot yet be proved.
  WITH first_hand AS (
    SELECT e.id AS episode_id, h.id, h.created_at,
           (e.payload->>'detected_at')::timestamptz AS detected_at
      FROM smarter_private.ca_table_stall_watch w
      JOIN public.operational_alert_events e ON e.id = w.alert_id
      CROSS JOIN LATERAL (
        SELECT h.id, h.created_at FROM public.hand_history h
         WHERE h.table_id = w.table_id AND h.created_at <= p_now
           AND h.created_at > CASE WHEN pg_input_is_valid(e.payload->>'detected_at','timestamptz')
                                   THEN (e.payload->>'detected_at')::timestamptz END
         ORDER BY h.created_at, h.id LIMIT 1
      ) h
     WHERE e.status = 'firing' AND NOT (e.payload ? 'first_progress_hand_id')
  )
  UPDATE public.operational_alert_events e
     SET payload = e.payload || jsonb_build_object('first_progress_hand_id', f.id,
         'first_progress_hand_at', f.created_at,
         'detection_to_first_hand_ms', extract(epoch FROM (f.created_at-f.detected_at))*1000)
    FROM first_hand f WHERE e.id = f.episode_id;
$progress$ || progress_anchor);
  body := replace(body, repeat_anchor, $recurrence$
      IF v_alert_id IS NOT NULL THEN
        -- Link adjacent episodes once, within the transaction opening the new one.
        WITH predecessor AS (
          SELECT e.id FROM public.operational_alert_events e
           WHERE e.source = 'ca-stall-watch' AND e.alertname = 'TableStoppedDealing'
             AND e.status = 'resolved' AND e.payload->>'table_id' = r.table_id::text
             AND e.id < v_alert_id ORDER BY e.id DESC LIMIT 1
        ), linked AS (
          UPDATE public.operational_alert_events e SET payload = e.payload ||
             jsonb_build_object('next_stall_alert_id', v_alert_id, 'next_stall_detected_at', p_now)
            FROM predecessor p WHERE e.id = p.id AND NOT (e.payload ? 'next_stall_alert_id')
          RETURNING e.id
        )
        UPDATE public.operational_alert_events e SET payload = e.payload ||
             jsonb_build_object('previous_stall_alert_id', linked.id)
          FROM linked WHERE e.id = v_alert_id;
      END IF;
$recurrence$ || repeat_anchor);
  EXECUTE body;
END
$migration$;
COMMIT;
