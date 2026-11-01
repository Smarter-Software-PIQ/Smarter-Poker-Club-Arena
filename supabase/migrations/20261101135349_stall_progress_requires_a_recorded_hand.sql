-- 20261101135349_stall_progress_requires_a_recorded_hand
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-01 13:53:49 UTC.
--
-- A missing silent-table sample does not prove that the table progressed.
-- Fourteen October 31 episodes were closed with that label without any hand
-- recorded between detection and closure. Keep the existing observer, but
-- require a positive exact-table committed hand and retain its identity.
-- The existing (table_id,created_at,id) index bounds the witness lookup.
-- No game, money, schedule, retention or engine activation is changed.
-- @live-proof: position('progress_hand_id' IN pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $migration$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure);
  v_old_loop text := 'FOR r IN SELECT w.* FROM smarter_private.ca_table_stall_watch w WHERE NOT (w.table_id = ANY (v_silent)) LOOP';
  v_new_loop text := $replacement$FOR r IN
      SELECT w.*, progress.id AS progress_hand_id, progress.created_at AS progress_hand_at
        FROM smarter_private.ca_table_stall_watch w
        LEFT JOIN public.operational_alert_events episode ON episode.id = w.alert_id
        LEFT JOIN LATERAL (
          SELECT h.id, h.created_at FROM public.hand_history h
           WHERE h.table_id = w.table_id
             AND h.created_at > CASE
               WHEN pg_input_is_valid(episode.payload->>'detected_at', 'timestamp with time zone')
               THEN (episode.payload->>'detected_at')::timestamptz END
             AND h.created_at <= p_now
           ORDER BY h.created_at DESC, h.id DESC LIMIT 1
        ) progress ON w.alert_id IS NOT NULL
       WHERE NOT (w.table_id = ANY (v_silent))
         AND (w.alert_id IS NULL OR progress.id IS NOT NULL)
    LOOP$replacement$;
  v_old_receipt text := $anchor$'stopped_for_seconds', round(extract(epoch FROM (p_now - r.first_seen_at))))$anchor$;
  v_new_receipt text := $replacement$'progress_hand_id', r.progress_hand_id, 'progress_hand_at', r.progress_hand_at,
                           'stopped_for_seconds', round(extract(epoch FROM (p_now - r.first_seen_at))))$replacement$;
BEGIN
  IF (length(v_def) - length(replace(v_def,v_old_loop,''))) / length(v_old_loop) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one absence-based stall progress loop';
  END IF;
  IF (length(v_def) - length(replace(v_def,v_old_receipt,''))) / length(v_old_receipt) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one stall progress receipt';
  END IF;
  EXECUTE replace(replace(v_def,v_old_loop,v_new_loop),v_old_receipt,v_new_receipt);
END;
$migration$;
COMMIT;
