-- 20261126031810_an_owner_note_when_a_cutover_cycle_does_not_seal.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A ONE-LINE MESSENGER NOTE TO THE OWNER WHEN A CUTOVER CYCLE DOES NOT SEAL
-- (2026-11-25, O27 follow-up). The owner was told about a missed cycle only by
-- the 04:30 EngineCutoverMissed page; the other seven daily cycles reached
-- nobody, which is how five skipped cycles on 2026-11-23/24 and six on
-- 2026-11-25 went unnoticed until he asked. Stage's next-candidate-after-cycle
-- job, which already decides at cycle start + 25 minutes whether the cycle
-- sealed, now calls public.fn_ca_note_cycle_did_not_seal once with a
-- plain reason.
--
-- * One note per cycle: ca_cutover_cycle_notes is keyed by the cycle
--   (YYYY-MM-DD for the 04:00 anchor, YYYY-MM-DDTHH otherwise), so a replay
--   or a second caller sends nothing.
-- * Delivered as one Messenger message in the reliability controller's
--   existing owner conversation (smarter_private.reliability_owner_conversation,
--   created 20261110000020) by its existing platform sender
--   (reliability_settings.system_sender_id). No second sender, no push, no
--   SMS: a missed cycle needs no action from the owner.
-- * The settings row is locked first, as reliability_owner_conversation's
--   callers must, so two callers never create two conversations.
-- * public.fn_ca_note_cycle_did_not_seal is in public only so the workflow can
--   reach it through PostgREST with the service-role key (smarter_private is
--   not exposed); EXECUTE is revoked from PUBLIC, anon and authenticated and
--   granted to service_role alone. No table lock on a hot relation: one new
--   private table, one new function.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
--
-- Needs ACCESS EXCLUSIVE (or SHARE / SHARE ROW EXCLUSIVE) on a hot table such as
-- clubs, tables or hand_history? Then it waits for the daily 04:00 America/Chicago
-- break (CLAUDE.md section 2 rule 10). Declare it with the rule's header line
-- "install-window: daily-maintenance" (prefixed "-- @", on a line of its own),
-- and optionally name the hot relations this file locks on a second header
-- line "locks: public.clubs, public.tables" (same "-- @" prefix, comma
-- separated, schema-qualified) so the installer sends files sharing a relation
-- together. The locks line orders only; it never widens a timeout.

BEGIN;

CREATE TABLE smarter_private.ca_cutover_cycle_notes (
  cycle      text PRIMARY KEY CHECK (cycle ~ '^\d{4}-\d{2}-\d{2}(T\d{2})?$'),
  note       text NOT NULL CHECK (length(note) BETWEEN 1 AND 500),
  message_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE smarter_private.ca_cutover_cycle_notes IS
  'One owner Messenger note per three-hourly engine cutover cycle that did not seal (O27, 2026-11-25). Keyed by the cycle, so a replay sends nothing.';
REVOKE ALL ON smarter_private.ca_cutover_cycle_notes FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_ca_note_cycle_did_not_seal(p_cycle text, p_note text)
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

  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id FOR UPDATE;
  v_conv := smarter_private.reliability_owner_conversation();
  INSERT INTO public.social_messages (conversation_id, sender_id, content, message_type, media_metadata)
  VALUES (v_conv, s.system_sender_id, v_note, 'text',
          jsonb_build_object('kind', 'engine_cutover_cycle', 'cycle', p_cycle))
  RETURNING id INTO v_msg;
  UPDATE smarter_private.ca_cutover_cycle_notes SET message_id = v_msg WHERE cycle = p_cycle;
  RETURN jsonb_build_object('sent', true, 'cycle', p_cycle, 'message_id', v_msg);
END
$fn$;
COMMENT ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) IS
  'Sends the owner one Messenger note for a three-hourly engine cutover cycle that did not seal; idempotent per cycle (O27, 2026-11-25).';
REVOKE ALL ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_note_cycle_did_not_seal(text, text) TO service_role;

-- Run the new body once inside a subtransaction that is always undone
-- (scripts/ci/templates/function-probe.sql). Where the reliability settings
-- row exists (production) the whole path runs: note row, owner conversation,
-- message, and a replay that must send nothing. On a schema-only copy (the
-- pre-merge DDL-guard install) there is no row, so the body's own input
-- refusal is exercised instead.
-- @probe-for: public.fn_ca_note_cycle_did_not_seal
DO $probe$
DECLARE
  v_first jsonb;
  v_replay jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM smarter_private.reliability_settings WHERE id) THEN
    v_first := public.fn_ca_note_cycle_did_not_seal('1999-01-01T01', 'Probe note, undone with its subtransaction.');
    IF NOT coalesce((v_first->>'sent')::boolean, false) OR (v_first->>'message_id') IS NULL THEN
      RAISE EXCEPTION 'cutover note probe: the first call did not send (%)', v_first;
    END IF;
    v_replay := public.fn_ca_note_cycle_did_not_seal('1999-01-01T01', 'Again.');
    IF coalesce((v_replay->>'sent')::boolean, true) THEN
      RAISE EXCEPTION 'cutover note probe: a replay sent a second message (%)', v_replay;
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
