-- 20261128074415_reliability_incidents_record_engine_release_sha.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- RELIABILITY INCIDENTS RECORD LIVE ENGINE releaseSha ON OBSERVATIONS AND RECOVERY.
--
-- WHAT WAS TRUE (read from production 2026-11-28):
--
--   1. smarter_private.reliability_incidents.engine_release was NULL on every
--      financial-alerts incident (including fn_ca_hand_gap_watch 1e532243 and
--      fn_ca_post_commit_lag_watch) and every engine-alerts incident (including
--      ClubArenaStatsIndexLag eb6f18a7 and OpponentHudDrift 8c8320c1).
--   2. Two distinct causes produced that gap:
--      a) operational_source_intake.record_strict wraps captured source rows
--         under p_payload->'original_event' (with financial_alerts fields under
--         original_event->'context' and engine_alerts labels under
--         original_event->'labels'). reliability_ingest_alert only read top-level
--         p_payload->>'releaseSha'/'engine_release'/'serving_sha' and top-level
--         v_labels->>'release'/'engine_release', so nested release SHAs were
--         dropped before reaching reliability_apply_signal.
--      b) reliability_apply_signal only wrote engine_release on INSERT and on
--         subsequent firing redeliveries; a resolved (recovery) signal never
--         updated engine_release or recorded it on the resolved_signal event.
--      c) fn_ca_hand_gap_watch never stamped hand_history.engine_build (the
--         40-char lowercase releaseSha written on every committed hand since
--         20261118073245) into the financial_alerts.context it opens or resolves.
--
-- WHAT THIS CHANGES (one transaction, zero hot-table locks, exact preimage + anchor patches):
--
--   1. smarter_private.reliability_ingest_alert extracts v_release from top-level
--      keys first, then falls back through reliability_payload_id (covering
--      original_event->context, original_incident, original_incident->metadata,
--      original_notification->data) for releaseSha/engine_release/engine_build/serving_sha
--      and original_event->labels->release/releaseSha/engine_release.
--   2. smarter_private.reliability_apply_signal updates engine_release on resolved
--      signals (`coalesce(p_engine_release, engine_release)`), backfills NULL
--      engine_release on non-fresh observations (`coalesce(engine_release, p_engine_release)`),
--      and records `engine_release` on the `resolved_signal` transition detail.
--      Preserves ONE INCIDENT, ONE LOCK ORDER (20261118153245) byte-for-byte.
--   3. public.fn_ca_hand_gap_watch reads the latest valid 40-hex
--      hand_history.engine_build inside the 15-minute watch window via
--      idx_hand_history_created (created_at DESC) and stamps releaseSha and
--      engine_release on both newly opened and auto-resolved financial_alerts
--      rows (plus resolved_release_sha on resolution). Preserves constant
--      message, kind x shape dedupe, and owner-page-route-only signaling.
--
-- @probe-for: smarter_private.reliability_ingest_alert
-- @probe-for: smarter_private.reliability_apply_signal
-- @probe-for: public.fn_ca_hand_gap_watch
-- @live-proof: (SELECT strpos(pg_get_functiondef('smarter_private.reliability_ingest_alert(bigint,text,text,text,text,text,jsonb,timestamptz,timestamptz,bigint,text,text)'::regprocedure), 'reliability_payload_id(v_labels, p_payload, ''releaseSha'')') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamp with time zone,bigint,text,timestamp with time zone,timestamp with time zone)'::regprocedure), 'ONE INCIDENT, ONE LOCK ORDER') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamp with time zone,bigint,text,timestamp with time zone,timestamp with time zone)'::regprocedure), '''engine_release'', p_engine_release') > 0 AND strpos(pg_get_functiondef('public.fn_ca_hand_gap_watch(timestamp with time zone)'::regprocedure), '''resolved_release_sha'', v_release_sha') > 0)

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  c_ingest_sig constant text :=
    'smarter_private.reliability_ingest_alert(bigint,text,text,text,text,text,jsonb,timestamptz,timestamptz,bigint,text,text)';
  c_apply_sig constant text :=
    'smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamp with time zone,bigint,text,timestamp with time zone,timestamp with time zone)';
  c_watch_sig constant text :=
    'public.fn_ca_hand_gap_watch(timestamp with time zone)';

  v_def text;
  v_new text;

  c_ingest_old constant text :=
    E'  v_release := nullif(left(coalesce(\n'
    || E'    CASE WHEN jsonb_typeof(p_payload->''releaseSha'') = ''string'' THEN p_payload->>''releaseSha'' END,\n'
    || E'    CASE WHEN jsonb_typeof(p_payload->''engine_release'') = ''string'' THEN p_payload->>''engine_release'' END,\n'
    || E'    CASE WHEN jsonb_typeof(p_payload->''serving_sha'') = ''string'' THEN p_payload->>''serving_sha'' END,\n'
    || E'    v_labels->>''release'', v_labels->>''engine_release'', ''''), 64), '''');';
  c_ingest_new constant text :=
    E'  v_release := nullif(left(coalesce(\n'
    || E'    CASE WHEN jsonb_typeof(p_payload->''releaseSha'') = ''string'' THEN p_payload->>''releaseSha'' END,\n'
    || E'    CASE WHEN jsonb_typeof(p_payload->''engine_release'') = ''string'' THEN p_payload->>''engine_release'' END,\n'
    || E'    CASE WHEN jsonb_typeof(p_payload->''serving_sha'') = ''string'' THEN p_payload->>''serving_sha'' END,\n'
    || E'    v_labels->>''release'', v_labels->>''engine_release'',\n'
    || E'    smarter_private.reliability_payload_id(v_labels, p_payload, ''releaseSha''),\n'
    || E'    smarter_private.reliability_payload_id(v_labels, p_payload, ''engine_release''),\n'
    || E'    smarter_private.reliability_payload_id(v_labels, p_payload, ''engine_build''),\n'
    || E'    smarter_private.reliability_payload_id(v_labels, p_payload, ''serving_sha''),\n'
    || E'    CASE WHEN jsonb_typeof(p_payload#>ARRAY[''original_event'',''labels'',''engine_release'']) = ''string'' THEN p_payload#>>ARRAY[''original_event'',''labels'',''engine_release''] END,\n'
    || E'    CASE WHEN jsonb_typeof(p_payload#>ARRAY[''original_event'',''labels'',''releaseSha'']) = ''string'' THEN p_payload#>>ARRAY[''original_event'',''labels'',''releaseSha''] END,\n'
    || E'    CASE WHEN jsonb_typeof(p_payload#>ARRAY[''original_event'',''labels'',''release'']) = ''string'' THEN p_payload#>>ARRAY[''original_event'',''labels'',''release''] END,\n'
    || E'    CASE WHEN jsonb_typeof(p_payload#>ARRAY[''original_event'',''release_sha'']) = ''string'' THEN p_payload#>>ARRAY[''original_event'',''release_sha''] END,\n'
    || E'    ''''), 64), '''');';

  c_apply_nonfresh_old constant text :=
    E'  IF NOT v_fresh THEN\n'
    || E'    -- Kept as an observation; no state changes.\n'
    || E'    v_disposition := v_why;\n'
    || E'    UPDATE smarter_private.reliability_incidents\n'
    || E'       SET last_observed_at = greatest(last_observed_at, p_event_at), updated_at = clock_timestamp()\n'
    || E'     WHERE id = i.id;';
  c_apply_nonfresh_new constant text :=
    E'  IF NOT v_fresh THEN\n'
    || E'    -- Kept as an observation; no state changes.\n'
    || E'    v_disposition := v_why;\n'
    || E'    UPDATE smarter_private.reliability_incidents\n'
    || E'       SET last_observed_at = greatest(last_observed_at, p_event_at),\n'
    || E'           engine_release = coalesce(engine_release, p_engine_release),\n'
    || E'           updated_at = clock_timestamp()\n'
    || E'     WHERE id = i.id;';

  c_apply_resolved_old constant text :=
    E'  ELSIF v_resolved THEN\n'
    || E'    UPDATE smarter_private.reliability_incidents\n'
    || E'       SET last_observed_at = greatest(last_observed_at, p_event_at), updated_at = clock_timestamp()\n'
    || E'     WHERE id = i.id;';
  c_apply_resolved_new constant text :=
    E'  ELSIF v_resolved THEN\n'
    || E'    UPDATE smarter_private.reliability_incidents\n'
    || E'       SET last_observed_at = greatest(last_observed_at, p_event_at),\n'
    || E'           engine_release = coalesce(p_engine_release, engine_release),\n'
    || E'           updated_at = clock_timestamp()\n'
    || E'     WHERE id = i.id;';

  c_apply_transition_old constant text :=
    E'        PERFORM smarter_private.reliability_transition(i.id, ''verifying'', ''the alert resolved'',\n'
    || E'          jsonb_build_object(''kind'', ''resolved_signal'', ''event_at'', p_event_at, ''episode'', p_episode));';
  c_apply_transition_new constant text :=
    E'        PERFORM smarter_private.reliability_transition(i.id, ''verifying'', ''the alert resolved'',\n'
    || E'          jsonb_strip_nulls(jsonb_build_object(''kind'', ''resolved_signal'', ''event_at'', p_event_at, ''episode'', p_episode, ''engine_release'', p_engine_release)));';

  c_watch_decl_old constant text := E'  v_attr     text;\n  r record;';
  c_watch_decl_new constant text := E'  v_attr     text;\n  v_release_sha text;\n  r record;';

  c_watch_recorded_old constant text := E'  GET DIAGNOSTICS v_recorded = ROW_COUNT;';
  c_watch_recorded_new constant text :=
    E'  GET DIAGNOSTICS v_recorded = ROW_COUNT;\n\n'
    || E'  SELECT h.engine_build INTO v_release_sha\n'
    || E'    FROM public.hand_history h\n'
    || E'   WHERE h.created_at > v_end - interval ''15 minutes''\n'
    || E'     AND h.created_at <= v_end\n'
    || E'     AND h.engine_build ~ ''^[0-9a-f]{40}$''\n'
    || E'   ORDER BY h.created_at DESC\n'
    || E'   LIMIT 1;';

  c_watch_resolve_old constant text :=
    E'      UPDATE financial_alerts fa\n'
    || E'         SET resolved = true, resolved_at = now(),\n'
    || E'             resolution = CASE WHEN l.kind IS NULL';
  c_watch_resolve_new constant text :=
    E'      UPDATE financial_alerts fa\n'
    || E'         SET resolved = true, resolved_at = now(),\n'
    || E'             context = COALESCE(fa.context, ''{}''::jsonb) || jsonb_strip_nulls(jsonb_build_object(\n'
    || E'               ''resolved_release_sha'', v_release_sha,\n'
    || E'               ''releaseSha'', COALESCE(v_release_sha, fa.context->>''releaseSha''),\n'
    || E'               ''engine_release'', COALESCE(v_release_sha, fa.context->>''engine_release''))),\n'
    || E'             resolution = CASE WHEN l.kind IS NULL';

  c_watch_open_old constant text :=
    E'              ''neither_unintended_p95_ms'', r.neither_unintended_p95_ms))\n'
    || E'    RETURNING id INTO v_alert_id;';
  c_watch_open_new constant text :=
    E'              ''neither_unintended_p95_ms'', r.neither_unintended_p95_ms)\n'
    || E'            || jsonb_strip_nulls(jsonb_build_object(\n'
    || E'              ''releaseSha'', v_release_sha,\n'
    || E'              ''engine_release'', v_release_sha)))\n'
    || E'    RETURNING id INTO v_alert_id;';

  v_anchor text;
BEGIN
  -- 1. Patch smarter_private.reliability_ingest_alert
  v_def := pg_get_functiondef(c_ingest_sig::regprocedure);
  IF md5(v_def) <> '41548fbfd18a2f04ed9028cd44c78b8b' THEN
    RAISE EXCEPTION 'reliability_ingest_alert pre-image drifted: %', md5(v_def);
  END IF;
  IF (length(v_def) - length(replace(v_def, c_ingest_old, ''))) / length(c_ingest_old) <> 1 THEN
    RAISE EXCEPTION 'reliability_ingest_alert anchor did not match exactly once';
  END IF;
  v_new := replace(v_def, c_ingest_old, c_ingest_new);
  EXECUTE v_new;

  -- 2. Patch smarter_private.reliability_apply_signal
  v_def := pg_get_functiondef(c_apply_sig::regprocedure);
  IF md5(v_def) <> '22fd63bb07ecb155a11bb1d1e099ff79' THEN
    RAISE EXCEPTION 'reliability_apply_signal pre-image drifted: %', md5(v_def);
  END IF;
  FOREACH v_anchor IN ARRAY ARRAY[c_apply_nonfresh_old, c_apply_resolved_old, c_apply_transition_old] LOOP
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'reliability_apply_signal anchor did not match exactly once: %', v_anchor;
    END IF;
  END LOOP;
  v_new := replace(v_def, c_apply_nonfresh_old, c_apply_nonfresh_new);
  v_new := replace(v_new, c_apply_resolved_old, c_apply_resolved_new);
  v_new := replace(v_new, c_apply_transition_old, c_apply_transition_new);
  EXECUTE v_new;

  -- 3. Patch public.fn_ca_hand_gap_watch
  v_def := pg_get_functiondef(c_watch_sig::regprocedure);
  IF md5(v_def) <> '186ba323508b3419241974e34bf8e54e' THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_watch pre-image drifted: %', md5(v_def);
  END IF;
  FOREACH v_anchor IN ARRAY ARRAY[c_watch_decl_old, c_watch_recorded_old, c_watch_resolve_old, c_watch_open_old] LOOP
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'fn_ca_hand_gap_watch anchor did not match exactly once: %', v_anchor;
    END IF;
  END LOOP;
  v_new := replace(v_def, c_watch_decl_old, c_watch_decl_new);
  v_new := replace(v_new, c_watch_recorded_old, c_watch_recorded_new);
  v_new := replace(v_new, c_watch_resolve_old, c_watch_resolve_new);
  v_new := replace(v_new, c_watch_open_old, c_watch_open_new);
  EXECUTE v_new;
END
$patch$;

REVOKE ALL ON FUNCTION smarter_private.reliability_ingest_alert(bigint, text, text, text, text, text, jsonb, timestamptz, timestamptz, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_apply_signal(text, boolean, text, text, text, text, text, text, jsonb, jsonb, text, text, boolean, timestamptz, bigint, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_watch(timestamptz) FROM PUBLIC, anon, authenticated;

-- Rolled-back behavioral probe: prove nested financial_alerts releaseSha
-- attribution reaches reliability_incidents on open and recovery without
-- inserting into public.operational_alert_events (whose AFTER INSERT trigger
-- would double-ingest the same (inbox_event_id, delivery_count, status) key)
-- or colliding with any live open incident (isolated via context.scope_id).
DO $probe$
DECLARE
  v_open_sha constant text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  v_rec_sha  constant text := 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  v_key      constant text := 'probe-release-sha-' || md5(clock_timestamp()::text);
  v_id       constant bigint := -9223372036854775001;
  v_now      constant timestamptz := clock_timestamp();
  v_inc_id   uuid;
  v_rel      text;
  v_ev_rel   text;
BEGIN
  BEGIN
    v_inc_id := smarter_private.reliability_ingest_alert(
      v_id, 'financial-alerts-backfill', v_key, 'fn_ca_hand_gap_watch', 'firing', 'critical',
      jsonb_build_object(
        'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
        'original_event', jsonb_build_object(
          'id', v_key,
          'source', 'fn_ca_hand_gap_watch',
          'context', jsonb_build_object(
            'scope_id', v_key,
            'kind', 'tournament',
            'shape', 'probe_shape',
            'releaseSha', v_open_sha
          )
        )
      ),
      v_now, v_now, 1, 'new', 'INSERT'
    );
    IF v_inc_id IS NULL THEN
      RAISE EXCEPTION 'probe failed: open reliability_ingest_alert returned NULL';
    END IF;
    SELECT engine_release INTO v_rel FROM smarter_private.reliability_incidents WHERE id = v_inc_id;
    IF v_rel IS DISTINCT FROM v_open_sha THEN
      RAISE EXCEPTION 'probe failed: expected open engine_release %, got %', v_open_sha, v_rel;
    END IF;

    v_inc_id := smarter_private.reliability_ingest_alert(
      v_id, 'financial-alerts-updates', v_key || ':resolved', 'fn_ca_hand_gap_watch', 'resolved', 'info',
      jsonb_build_object(
        'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
        'original_event', jsonb_build_object(
          'id', v_key,
          'source', 'fn_ca_hand_gap_watch',
          'resolved', true,
          'context', jsonb_build_object(
            'scope_id', v_key,
            'kind', 'tournament',
            'shape', 'probe_shape',
            'releaseSha', v_rec_sha
          )
        )
      ),
      v_now, v_now + interval '1 second', 1, 'new', 'STATUS_CHANGE'
    );
    IF v_inc_id IS NULL THEN
      RAISE EXCEPTION 'probe failed: recovery reliability_ingest_alert returned NULL';
    END IF;
    SELECT engine_release INTO v_rel FROM smarter_private.reliability_incidents WHERE id = v_inc_id;
    IF v_rel IS DISTINCT FROM v_rec_sha THEN
      RAISE EXCEPTION 'probe failed: expected recovery engine_release %, got %', v_rec_sha, v_rel;
    END IF;

    SELECT e.detail->>'engine_release' INTO v_ev_rel
      FROM smarter_private.reliability_incident_events e
     WHERE e.incident_id = v_inc_id AND e.kind = 'resolved_signal'
     ORDER BY e.id DESC LIMIT 1;
    IF v_ev_rel IS DISTINCT FROM v_rec_sha THEN
      RAISE EXCEPTION 'probe failed: expected resolved_signal engine_release %, got %', v_rec_sha, v_ev_rel;
    END IF;

    RAISE EXCEPTION 'probe-unwind';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'probe-unwind' THEN
      RAISE;
    END IF;
  END;
END
$probe$;

COMMIT;
