-- 20261128151139_a_missed_cycle_note_is_recorded_in_the_alert_store.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Production Alerts incident
-- cycle-not-sealed-owner-note-unrouted, first recorded 2026-11-27):
--
-- 20261126031810 sends the owner one Messenger note per three-hourly engine
-- cutover cycle that did not seal. That note is an operational event, and the
-- standing rule is that every operational event is recorded in
-- public.operational_alert_events, addressed to the Production Alerts fleet,
-- so a lane investigates it. The function wrote the note and nothing else:
-- by 2026-11-28 15:10Z seven cycles had been noted (2026-11-26T10, T13, T19,
-- T22, 2026-11-27T07, T13 and 2026-11-28T07) and the store held no row for
-- any of them, so no lane was ever handed a missed cycle. Intake did not see
-- it either, because it reads the owner's notifications and push_outbox, and
-- this sender writes social_messages.
--
-- * The note row now carries the id of the store row it raised (alert_id).
--   No foreign key: an orphan id in a note log is harmless, a lock on the
--   store is not.
-- * fn_ca_note_cycle_did_not_seal records the cycle through the store's own
--   idempotent recorder, public.fn_record_operational_alert, keyed
--   'cycle-not-sealed:<cycle>' under source engine-cutover-watch (the source
--   EngineCutoverMissed already uses), addressed to the fleet, BEFORE it sends
--   the Messenger line, and refuses to send if the store returned no id. A
--   note can therefore never reach the owner without its store row; both
--   commit or neither does. Severity is 'warning', which
--   public.fn_ca_owner_page_kind maps to no owner page (read 2026-11-27), so
--   the store row does not page the owner a second time for the same cycle.
-- * The cycles already noted are recorded once, from their own note rows, by
--   the same recorder and key, and the migration aborts unless every note row
--   ends with its alert_id.
-- * Nothing else changes: same signature, same SECURITY DEFINER, same grants,
--   same one-note-per-cycle key, same owner conversation and sender.
--
-- One transaction, no lock on a hot relation (one ALTER on a private
-- seven-row table, one CREATE OR REPLACE FUNCTION).

BEGIN;

ALTER TABLE smarter_private.ca_cutover_cycle_notes ADD COLUMN alert_id bigint;
COMMENT ON COLUMN smarter_private.ca_cutover_cycle_notes.alert_id IS
  'public.operational_alert_events id raised for this cycle (source engine-cutover-watch, key cycle-not-sealed:<cycle>). No foreign key by design.';

CREATE OR REPLACE FUNCTION public.fn_ca_note_cycle_did_not_seal(p_cycle text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  s smarter_private.reliability_settings;
  v_note text;
  v_conv uuid;
  v_msg uuid;
  v_alert bigint;
BEGIN
  IF p_cycle IS NULL OR p_cycle !~ '^\d{4}-\d{2}-\d{2}(T\d{2})?$' THEN
    RAISE EXCEPTION 'cycle must be YYYY-MM-DD or YYYY-MM-DDTHH, got %', p_cycle;
  END IF;
  v_note := btrim(regexp_replace(coalesce(p_note, ''), '[\r\n]+', ' ', 'g'));
  IF length(v_note) = 0 OR length(v_note) > 500 THEN
    RAISE EXCEPTION 'note must be 1 to 500 characters';
  END IF;

  INSERT INTO smarter_private.ca_cutover_cycle_notes (cycle, note)
  VALUES (p_cycle, v_note)
  ON CONFLICT (cycle) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'already noted', 'cycle', p_cycle);
  END IF;

  v_alert := public.fn_record_operational_alert(
    'engine-cutover-watch', 'cycle-not-sealed:' || p_cycle, 'EngineCutoverCycleNotSealed',
    'firing', 'warning', jsonb_build_object(
      'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
      'summary', v_note, 'cycle', p_cycle,
      'caller', 'stage-engine-release next-candidate-after-cycle'));
  IF v_alert IS NULL THEN
    RAISE EXCEPTION 'cycle % was not recorded in operational_alert_events; no note sent', p_cycle;
  END IF;

  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id FOR UPDATE;
  v_conv := smarter_private.reliability_owner_conversation();
  INSERT INTO public.social_messages (conversation_id, sender_id, content, message_type, media_metadata)
  VALUES (v_conv, s.system_sender_id, v_note, 'text',
          jsonb_build_object('kind', 'engine_cutover_cycle', 'cycle', p_cycle, 'alert_id', v_alert))
  RETURNING id INTO v_msg;
  UPDATE smarter_private.ca_cutover_cycle_notes
     SET message_id = v_msg, alert_id = v_alert
   WHERE cycle = p_cycle;
  RETURN jsonb_build_object('sent', true, 'cycle', p_cycle, 'message_id', v_msg, 'alert_id', v_alert);
END
$fn$;
COMMENT ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) IS
  'Records a three-hourly engine cutover cycle that did not seal in operational_alert_events (addressed to the Production Alerts fleet), then sends the owner one Messenger note; idempotent per cycle (O27 2026-11-25; store write 2026-11-28).';
REVOKE ALL ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) TO service_role;

-- The cycles noted before the store write existed are recorded once, from
-- their own note rows, by the same recorder and key the function uses.
DO $record$
DECLARE
  r record;
  v_alert bigint;
BEGIN
  FOR r IN SELECT cycle, note, message_id, created_at
             FROM smarter_private.ca_cutover_cycle_notes
            WHERE alert_id IS NULL ORDER BY cycle LOOP
    v_alert := public.fn_record_operational_alert(
      'engine-cutover-watch', 'cycle-not-sealed:' || r.cycle, 'EngineCutoverCycleNotSealed',
      'firing', 'warning', jsonb_build_object(
        'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
        'summary', r.note, 'cycle', r.cycle,
        'caller', 'stage-engine-release next-candidate-after-cycle',
        'at', r.created_at, 'message_id', r.message_id,
        'recorded_by', '20261128151139 (note sent before the store write existed)'));
    IF v_alert IS NULL THEN
      RAISE EXCEPTION 'cycle % was not recorded in operational_alert_events', r.cycle;
    END IF;
    UPDATE smarter_private.ca_cutover_cycle_notes SET alert_id = v_alert WHERE cycle = r.cycle;
  END LOOP;
  IF EXISTS (SELECT 1 FROM smarter_private.ca_cutover_cycle_notes WHERE alert_id IS NULL) THEN
    RAISE EXCEPTION 'a noted cutover cycle is still missing its store row';
  END IF;
END $record$;

-- Run the new body once inside a subtransaction that is always undone
-- (scripts/ci/templates/function-probe.sql). Where the reliability settings
-- row exists (production) the whole path runs: store row addressed to the
-- fleet, note row carrying its id, message, and a replay that must send and
-- record nothing more. On a schema-only copy (the pre-merge DDL-guard
-- install) there is no row, so the body's own input refusal is exercised.
-- @probe-for: public.fn_ca_note_cycle_did_not_seal
DO $probe$
DECLARE
  v_first jsonb;
  v_replay jsonb;
  v_rows integer;
BEGIN
  IF EXISTS (SELECT 1 FROM smarter_private.reliability_settings WHERE id) THEN
    v_first := public.fn_ca_note_cycle_did_not_seal('1999-01-01T01', 'Probe note, undone with its subtransaction.');
    IF NOT coalesce((v_first->>'sent')::boolean, false) OR (v_first->>'message_id') IS NULL
       OR (v_first->>'alert_id') IS NULL THEN
      RAISE EXCEPTION 'cutover note probe: the first call did not send and record (%)', v_first;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.operational_alert_events
                    WHERE id = (v_first->>'alert_id')::bigint
                      AND source = 'engine-cutover-watch'
                      AND event_key = 'cycle-not-sealed:1999-01-01T01'
                      AND payload->>'target_task_id' = '01a09b86-5ba8-7290-8657-1041f13dd3ca') THEN
      RAISE EXCEPTION 'cutover note probe: no addressed store row for the cycle (%)', v_first;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM smarter_private.ca_cutover_cycle_notes
                    WHERE cycle = '1999-01-01T01'
                      AND alert_id = (v_first->>'alert_id')::bigint) THEN
      RAISE EXCEPTION 'cutover note probe: the note row does not carry its store id';
    END IF;
    v_replay := public.fn_ca_note_cycle_did_not_seal('1999-01-01T01', 'Again.');
    IF coalesce((v_replay->>'sent')::boolean, true) THEN
      RAISE EXCEPTION 'cutover note probe: a replay sent a second message (%)', v_replay;
    END IF;
    SELECT count(*) INTO v_rows FROM public.operational_alert_events
     WHERE source = 'engine-cutover-watch' AND event_key = 'cycle-not-sealed:1999-01-01T01';
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'cutover note probe: expected one store row for the cycle, found %', v_rows;
    END IF;
  ELSE
    BEGIN
      PERFORM public.fn_ca_note_cycle_did_not_seal('not-a-cycle', 'x');
      RAISE EXCEPTION 'cutover note probe: an invalid cycle was accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'cycle must be YYYY-MM-DD or YYYY-MM-DDTHH%' THEN RAISE; END IF;
    END;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
