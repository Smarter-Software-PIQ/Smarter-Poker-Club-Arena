-- 20261102132659_stall_recovery_needs_sustained_dealing
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 13:26:59 UTC.
--
-- The installed observer requires one hand after detection, but one isolated
-- hand followed by another stall still passes when the engine drops the sample.
-- Its intended-wait branch also resolves an existing episode without a hand.
-- Reproduced through the original ingest in private PostgreSQL 17: one hand
-- resolves the episode. Require two exact-table episode witnesses (the minimum
-- that distinguishes continued dealing from one resumed hand), with the latest
-- inside the observer's existing stall threshold. No new arbitrary time window.
-- A wait explains the signal; it does not close the original episode.
-- This changes observation bookkeeping only, never gameplay, custody, money,
-- scheduling, historical episodes or incident closure. Signal recovery explicitly
-- leaves root-cause verification false. Existing indexed lookup reads at most two.
-- @live-proof: position('previous_progress_hand_id' IN pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $migration$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure);
  v_old text;
  v_new text;
BEGIN
  v_old := 'SELECT w.*, progress.id AS progress_hand_id, progress.created_at AS progress_hand_at';
  v_new := 'SELECT w.*, progress.id AS progress_hand_id, progress.created_at AS progress_hand_at,
             previous.id AS previous_progress_hand_id, previous.created_at AS previous_progress_hand_at';
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'missing original recorded-hand selector'; END IF;
  v_def := replace(v_def, v_old, v_new);
  v_old := $old$) progress ON w.alert_id IS NOT NULL
       WHERE NOT (w.table_id = ANY (v_silent))
         AND (w.alert_id IS NULL OR progress.id IS NOT NULL)$old$;
  v_new := $new$) progress ON w.alert_id IS NOT NULL
        LEFT JOIN LATERAL (
          SELECT h.id, h.created_at FROM public.hand_history h
           WHERE h.table_id = w.table_id
             AND h.created_at > CASE
               WHEN pg_input_is_valid(episode.payload->>'detected_at', 'timestamp with time zone')
               THEN (episode.payload->>'detected_at')::timestamptz END
             AND (h.created_at, h.id) < (progress.created_at, progress.id)
           ORDER BY h.created_at DESC, h.id DESC LIMIT 1
        ) previous ON progress.id IS NOT NULL
       WHERE NOT (w.table_id = ANY (v_silent))
         AND (w.alert_id IS NULL OR (previous.id IS NOT NULL
           AND progress.created_at > p_now - make_interval(secs => p_threshold_ms / 1000.0)))$new$;
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'missing original recorded-hand boundary'; END IF;
  v_def := replace(v_def, v_old, v_new);
  v_old := $old$'resolution', 'table progressed',
                           'progress_hand_id', r.progress_hand_id, 'progress_hand_at', r.progress_hand_at,$old$;
  v_new := $new$'resolution', 'recorded dealing resumed; root cause unverified',
                           'root_cause_verified', false,
                           'previous_progress_hand_id', r.previous_progress_hand_id,
                           'previous_progress_hand_at', r.previous_progress_hand_at,
                           'progress_hand_id', r.progress_hand_id, 'progress_hand_at', r.progress_hand_at,$new$;
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'missing original progress receipt'; END IF;
  v_def := replace(v_def, v_old, v_new);
  v_old := $old$UPDATE public.operational_alert_events SET status = 'resolved', last_received_at = p_now,
             payload = payload || jsonb_build_object('resolved_at', p_now, 'resolution', 'became ' || v_reason)
       WHERE id = v_alert_id AND status = 'firing';
      UPDATE smarter_private.ca_table_stall_watch SET alert_id = NULL, alerted_at = NULL WHERE table_id = r.table_id;$old$;
  v_new := $new$UPDATE public.operational_alert_events
         SET payload = payload || jsonb_build_object('intended_wait_reason', v_reason,
               'intended_wait_observed_at', p_now, 'root_cause_verified', false)
       WHERE id = v_alert_id AND status = 'firing'
         AND payload->>'intended_wait_reason' IS DISTINCT FROM v_reason;$new$;
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'missing original intended-wait closure'; END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$migration$;
COMMIT;
