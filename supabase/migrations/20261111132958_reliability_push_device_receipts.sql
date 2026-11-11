-- 20261111132958_reliability_push_device_receipts.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- RELIABILITY CONTROLLER: A PUSH IS PROVEN BY THE DEVICE, NOT BY THE PROVIDER
-- ============================================================================
--
-- reliability_notifications.push_state stops at 'provider_accepted': FCM or
-- Apple answered 2xx. Both answer 2xx for a device that is asleep, offline or
-- long gone, so that state says nothing about the owner's phone.
-- push_subscriptions.last_receipt_at (20260901030900) is per endpoint, not per
-- push: it cannot say WHICH push a device painted, and its route is
-- session-less and keyed on the endpoint string alone.
--
-- This adds a per-push, per-device receipt that only the receiving device can
-- produce:
--
-- 1. smarter_private.push_device_receipts: one row per (push_outbox row,
--    subscription). The World Hub dispatcher mints a random 256-bit token at
--    send time, stores only its SHA-256 here through
--    public.fn_mint_push_receipt, and puts the token in the encrypted Web Push
--    payload for that one device. Nobody else ever sees the token: it is not
--    in push_outbox, not in any log, and not derivable from the outbox id.
-- 2. public.fn_record_push_receipt(outbox_id, token_sha256, stage): called by
--    POST /api/push/delivery-receipt after the service worker acknowledges.
--    'received' = the worker ran the push event; 'displayed' = the OS accepted
--    showNotification. Idempotent: the first received_at and displayed_at are
--    kept, a repeat answers 'duplicate', and a wrong token or unknown id are
--    the same 'not_found' so the caller learns nothing about which it was.
-- 3. smarter_private.reliability_notification_device_receipts: the mirror the
--    health and incident readers join. delivery_state is 'displayed' or
--    'device_received' when a device acknowledged that notification's push,
--    otherwise the existing push_state. reliability_notifications and its
--    push_state CHECK are NOT altered: push_state is written by
--    reliability_refresh_push_states inside reliability_tick, which this track
--    does not own, and 20261110144203's @live-proof requires a 'sent' outbox
--    row to mirror exactly 'provider_accepted'.
--
-- Scope: only push_outbox events named reliability_* are minted. Both
-- functions are SECURITY DEFINER, service_role only. No tick, classify,
-- transition, deliver_notifications or refresh function is redefined; no
-- trigger is added to public.push_outbox or public.push_subscriptions; no
-- foreign key is taken on those hot tables (each function checks existence
-- instead). No timer, cron or cleanup loop is added.
--
-- Order of delivery: this file installs first and is inert (nothing mints).
-- The World Hub change that mints the token and the service worker
-- acknowledgement ship together after it; a mint failure there never blocks
-- the send.
--
-- Native proof: scripts/ci/test-push-receipt.py (PostgreSQL 17, never
-- production).

-- @live-proof: (to_regclass('smarter_private.push_device_receipts') IS NOT NULL AND to_regclass('smarter_private.reliability_notification_device_receipts') IS NOT NULL AND to_regprocedure('public.fn_mint_push_receipt(uuid,uuid,text)') IS NOT NULL AND to_regprocedure('public.fn_record_push_receipt(uuid,text,text)') IS NOT NULL AND has_function_privilege('service_role', 'public.fn_record_push_receipt(uuid,text,text)', 'EXECUTE') AND has_function_privilege('service_role', 'public.fn_mint_push_receipt(uuid,uuid,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_record_push_receipt(uuid,text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_record_push_receipt(uuid,text,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_mint_push_receipt(uuid,uuid,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_mint_push_receipt(uuid,uuid,text)', 'EXECUTE') AND NOT has_table_privilege('anon', 'smarter_private.push_device_receipts', 'SELECT') AND NOT has_table_privilege('authenticated', 'smarter_private.push_device_receipts', 'SELECT') AND NOT has_table_privilege('authenticated', 'smarter_private.reliability_notification_device_receipts', 'SELECT'))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF to_regclass('smarter_private.reliability_notifications') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'smarter_private' AND table_name = 'reliability_notifications'
                       AND column_name = 'push_outbox_id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION 'PUSH_RECEIPT_PREIMAGE: smarter_private.reliability_notifications.push_outbox_id (uuid) is required';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'push_outbox'
         AND column_name IN ('id', 'recipient_user_id', 'event', 'status')) <> 4
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
            AND column_name IN ('id', 'user_id', 'is_active')) <> 3 THEN
    RAISE EXCEPTION 'PUSH_RECEIPT_PREIMAGE: public.push_outbox or public.push_subscriptions changed shape';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. The receipt table
-- ---------------------------------------------------------------------------
CREATE TABLE smarter_private.push_device_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  push_outbox_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  event text NOT NULL,
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  minted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  received_at timestamptz,
  displayed_at timestamptz,
  ack_count integer NOT NULL DEFAULT 0 CHECK (ack_count BETWEEN 0 AND 1000),
  CONSTRAINT push_device_receipts_one_per_device UNIQUE (push_outbox_id, subscription_id),
  CONSTRAINT push_device_receipts_token_unique UNIQUE (token_sha256),
  CONSTRAINT push_device_receipts_displayed_implies_received CHECK (displayed_at IS NULL OR received_at IS NOT NULL)
);

COMMENT ON TABLE smarter_private.push_device_receipts IS
  'Per push, per device acknowledgement. Only the SHA-256 of a token minted at send time is stored; the token travels only inside the encrypted push payload. received_at/displayed_at are written once, by public.fn_record_push_receipt, from the receiving device. See 20261111132958.';

ALTER TABLE smarter_private.push_device_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.push_device_receipts FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Mint (dispatcher, at send time) and record (device acknowledgement)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_mint_push_receipt(p_outbox_id uuid, p_subscription_id uuid, p_token_sha256 text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $fn$
DECLARE
  v_recipient uuid;
  v_event text;
  v_rows integer;
BEGIN
  IF p_outbox_id IS NULL OR p_subscription_id IS NULL
     OR p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  -- Only a row the dispatcher holds right now, and only reliability events.
  SELECT o.recipient_user_id, o.event INTO v_recipient, v_event
    FROM public.push_outbox o
   WHERE o.id = p_outbox_id AND o.status = 'processing' AND o.event LIKE 'reliability\_%';
  IF v_recipient IS NULL THEN
    RETURN false;
  END IF;

  -- The device must be an active subscription of that row's own recipient.
  PERFORM 1 FROM public.push_subscriptions s
    WHERE s.id = p_subscription_id AND s.user_id = v_recipient AND s.is_active;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- A resend replaces the token only while that device has not acknowledged.
  INSERT INTO smarter_private.push_device_receipts AS r
         (push_outbox_id, subscription_id, recipient_user_id, event, token_sha256)
  VALUES (p_outbox_id, p_subscription_id, v_recipient, v_event, p_token_sha256)
  ON CONFLICT (push_outbox_id, subscription_id) DO UPDATE
     SET token_sha256 = EXCLUDED.token_sha256, minted_at = clock_timestamp()
   WHERE r.received_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$fn$;

CREATE FUNCTION public.fn_record_push_receipt(p_outbox_id uuid, p_token_sha256 text, p_stage text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $fn$
DECLARE
  r smarter_private.push_device_receipts;
  v_now timestamptz := clock_timestamp();
  v_new boolean;
BEGIN
  IF p_stage IS NULL OR p_stage NOT IN ('received', 'displayed') THEN
    RETURN jsonb_build_object('ok', false, 'result', 'invalid');
  END IF;
  IF p_outbox_id IS NULL OR p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'result', 'not_found');
  END IF;

  SELECT * INTO r FROM smarter_private.push_device_receipts
   WHERE push_outbox_id = p_outbox_id AND token_sha256 = p_token_sha256
   FOR UPDATE;
  IF NOT FOUND THEN
    -- A wrong token and an unknown id are deliberately the same answer.
    RETURN jsonb_build_object('ok', false, 'result', 'not_found');
  END IF;

  v_new := r.received_at IS NULL OR (p_stage = 'displayed' AND r.displayed_at IS NULL);

  UPDATE smarter_private.push_device_receipts
     SET received_at = coalesce(received_at, v_now),
         displayed_at = CASE WHEN p_stage = 'displayed' THEN coalesce(displayed_at, v_now) ELSE displayed_at END,
         ack_count = least(ack_count + 1, 1000)
   WHERE id = r.id
  RETURNING * INTO r;

  RETURN jsonb_build_object(
    'ok', true,
    'result', CASE WHEN v_new THEN 'recorded' ELSE 'duplicate' END,
    'stage', CASE WHEN r.displayed_at IS NOT NULL THEN 'displayed' ELSE 'received' END);
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_mint_push_receipt(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_record_push_receipt(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mint_push_receipt(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_push_receipt(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The mirror the health and incident readers join
-- ---------------------------------------------------------------------------
CREATE VIEW smarter_private.reliability_notification_device_receipts
WITH (security_invoker = true) AS
SELECT n.id AS notification_id,
       n.incident_id,
       n.kind,
       n.push_outbox_id,
       n.push_state,
       coalesce(d.devices_minted, 0) AS devices_minted,
       coalesce(d.devices_received, 0) AS devices_received,
       coalesce(d.devices_displayed, 0) AS devices_displayed,
       d.first_received_at,
       d.first_displayed_at,
       CASE WHEN coalesce(d.devices_displayed, 0) > 0 THEN 'displayed'
            WHEN coalesce(d.devices_received, 0) > 0 THEN 'device_received'
            ELSE n.push_state END AS delivery_state
  FROM smarter_private.reliability_notifications n
  LEFT JOIN LATERAL (
    SELECT count(*) AS devices_minted,
           count(r.received_at) AS devices_received,
           count(r.displayed_at) AS devices_displayed,
           min(r.received_at) AS first_received_at,
           min(r.displayed_at) AS first_displayed_at
      FROM smarter_private.push_device_receipts r
     WHERE r.push_outbox_id = n.push_outbox_id
  ) d ON n.push_outbox_id IS NOT NULL;

COMMENT ON VIEW smarter_private.reliability_notification_device_receipts IS
  'reliability_notifications with device acknowledgement. delivery_state: displayed / device_received when a receiving device acknowledged the push, else push_state (provider_accepted is not delivery). devices_minted = 0 on a sent push means it went out before the receipt path or without a token. See 20261111132958.';

REVOKE ALL ON TABLE smarter_private.reliability_notification_device_receipts FROM PUBLIC, anon, authenticated, service_role;

DO $post$
BEGIN
  IF has_function_privilege('anon', 'public.fn_record_push_receipt(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_record_push_receipt(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_mint_push_receipt(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_mint_push_receipt(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_record_push_receipt(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_mint_push_receipt(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUSH_RECEIPT_POSTIMAGE: receipt function privileges are unsafe';
  END IF;
  IF has_table_privilege('anon', 'smarter_private.push_device_receipts', 'SELECT')
     OR has_table_privilege('authenticated', 'smarter_private.push_device_receipts', 'SELECT')
     OR has_table_privilege('authenticated', 'smarter_private.push_device_receipts', 'UPDATE')
     OR has_table_privilege('authenticated', 'smarter_private.reliability_notification_device_receipts', 'SELECT')
     OR has_table_privilege('anon', 'smarter_private.reliability_notification_device_receipts', 'SELECT') THEN
    RAISE EXCEPTION 'PUSH_RECEIPT_POSTIMAGE: receipt table or view is readable by a client role';
  END IF;
  IF EXISTS (SELECT 1 FROM smarter_private.reliability_notification_device_receipts
              WHERE delivery_state IS DISTINCT FROM push_state) THEN
    RAISE EXCEPTION 'PUSH_RECEIPT_POSTIMAGE: no receipt exists yet, so delivery_state must equal push_state';
  END IF;
END
$post$;

COMMIT;
