-- 20261109224532_bug_reports_reach_the_owner_messenger_and_phone.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Owner instruction, November 9, 2026: "ALL BUGS SHOULD GO DIRECTLY TO MY
-- SMARTER.POKER MESSENGER, AND SEND A PUSH ALERT TO MY PHONE."
--
-- The defect, read from rows. Report BUG-7C1347FF (live_help_tickets
-- 7c1347ff-7e28-403c-aa4d-4335176252a7, 2026-11-09 10:11:55 UTC) reached the
-- owner as an email only. fn_submit_bug_report_to_admin stores the ticket and
-- then posts the report as a direct message from the reporter to the
-- `support` account (7f5b582a), an account that has never signed in and has
-- no device. Nothing was ever written to the owner's Messenger and no push
-- was ever queued. Club Arena's own Help form writes public.user_feedback,
-- which no reader, email or notification has ever consumed.
--
-- The fix is at the source record. Every row inserted into
-- public.live_help_tickets (World Hub and Club Commander report widget, and
-- the live-help escalation route) or public.user_feedback (Club Arena Help
-- form) is routed, in the inserting transaction, by one function:
--
--   * one message in the owner's Messenger (public.social_messages, the stack
--     /hub/messenger reads), sent by the platform service identity into one
--     dedicated direct conversation;
--   * one row in the existing durable public.push_outbox with its own event,
--     'bug_report', which the existing dispatcher delivers with its normal
--     preference, device and retry handling. It is not an operational alert:
--     fn_is_platform_operational_alert and fn_is_owner_operational_notification
--     do not match it, so the Production Alerts routing is untouched;
--   * one row in public.bug_report_deliveries keyed by the source record, the
--     durable per-report receipt (message id, outbox id, status).
--
-- Idempotent: the receipt's unique key is the source record, so a retry or a
-- second call returns the first delivery and writes nothing. No timer, sweep
-- or repair job exists or is needed: the route runs where the report is born.
-- A routing failure never loses the report: the source row still commits, the
-- receipt records 'failed' with the error, and Production Alerts is told.
--
-- The recipient and sender are one configured row, public.bug_report_routing,
-- not literals in a function body. The recipient is constrained to the
-- owner's verified accounts by the existing fn_is_platform_alert_recipient.
--
-- No hot table is locked: the only DDL on existing relations is one trigger
-- on each of two small tables (6 and 0 rows). One transaction, one reload.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Who receives bug reports, and who sends them. One row.
CREATE TABLE IF NOT EXISTS public.bug_report_routing (
  id                boolean PRIMARY KEY DEFAULT true,
  recipient_user_id uuid NOT NULL,
  sender_user_id    uuid NOT NULL,
  conversation_id   uuid,
  updated_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT bug_report_routing_single_row CHECK (id),
  CONSTRAINT bug_report_routing_distinct_parties CHECK (recipient_user_id <> sender_user_id),
  CONSTRAINT bug_report_routing_recipient_is_owner
    CHECK (public.fn_is_platform_alert_recipient(recipient_user_id))
);

COMMENT ON TABLE public.bug_report_routing IS
  'Single configured row: the owner account that receives every bug report in Messenger and by push, the platform identity that sends it, and their dedicated conversation. 2026-11-09.';

ALTER TABLE public.bug_report_routing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bug_report_routing FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bug_report_routing TO service_role;

-- Recipient: the owner's Messenger account (kingfish, the account that
-- reads and sends in Messenger daily and holds his active iPhone
-- subscription). Sender: the platform service identity (smarterpoker).
INSERT INTO public.bug_report_routing (id, recipient_user_id, sender_user_id)
VALUES (true,
        '47965354-0e56-43ef-931c-ddaab82af765'::uuid,
        '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid)
ON CONFLICT (id) DO NOTHING;

-- 2. The durable per-report receipt.
CREATE TABLE IF NOT EXISTS public.bug_report_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table      text NOT NULL,
  source_id         uuid NOT NULL,
  reference         text,
  status            text NOT NULL,
  recipient_user_id uuid,
  sender_user_id    uuid,
  conversation_id   uuid,
  message_id        uuid,
  push_outbox_id    uuid,
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at      timestamptz,
  CONSTRAINT bug_report_deliveries_one_per_report UNIQUE (source_table, source_id),
  CONSTRAINT bug_report_deliveries_source_known
    CHECK (source_table IN ('live_help_tickets', 'user_feedback')),
  CONSTRAINT bug_report_deliveries_status_known
    CHECK (status IN ('pending', 'delivered', 'failed')),
  CONSTRAINT bug_report_deliveries_delivered_is_complete
    CHECK (status <> 'delivered'
           OR (message_id IS NOT NULL AND push_outbox_id IS NOT NULL
               AND conversation_id IS NOT NULL AND recipient_user_id IS NOT NULL
               AND delivered_at IS NOT NULL))
);

COMMENT ON TABLE public.bug_report_deliveries IS
  'One receipt per bug report source row: the Messenger message and push outbox row that carried it to the owner, or the error that stopped it. 2026-11-09.';

ALTER TABLE public.bug_report_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bug_report_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bug_report_deliveries TO authenticated, service_role;

DROP POLICY IF EXISTS bug_report_deliveries_staff_read ON public.bug_report_deliveries;
CREATE POLICY bug_report_deliveries_staff_read ON public.bug_report_deliveries
  FOR SELECT TO authenticated
  USING (public.fn_is_platform_admin());

-- 3. The one route. Idempotent per source row.
CREATE OR REPLACE FUNCTION public.fn_route_bug_report_to_owner(p_source_table text, p_source_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  cfg           public.bug_report_routing%ROWTYPE;
  d             public.bug_report_deliveries%ROWTYPE;
  v_user        uuid;
  v_subject     text;
  v_description text;
  v_priority    text;
  v_page        text;
  v_created     timestamptz;
  v_category    text;
  v_kind        text;
  v_reference   text;
  v_username    text;
  v_full_name   text;
  v_reporter    text;
  v_content     text;
  v_conv        uuid;
  v_msg         uuid;
  v_outbox      uuid;
  v_outbox_status text;
  v_outbox_reason text;
BEGIN
  IF p_source_id IS NULL OR p_source_table IS NULL
     OR p_source_table NOT IN ('live_help_tickets', 'user_feedback') THEN
    RAISE EXCEPTION 'bug_report_route_unknown_source' USING ERRCODE = '22023';
  END IF;

  -- The configured row is also the serialization point: two reports never
  -- create two conversations, and a repeat call waits for the first.
  SELECT * INTO cfg FROM public.bug_report_routing WHERE id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bug_report_routing_not_configured' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.bug_report_deliveries (source_table, source_id, status)
  VALUES (p_source_table, p_source_id, 'pending')
  ON CONFLICT (source_table, source_id) DO NOTHING;

  SELECT * INTO d FROM public.bug_report_deliveries
   WHERE source_table = p_source_table AND source_id = p_source_id
   FOR UPDATE;

  IF d.status = 'delivered' THEN
    RETURN jsonb_build_object(
      'status', 'delivered', 'already_delivered', true, 'delivery_id', d.id,
      'reference', d.reference, 'conversation_id', d.conversation_id,
      'message_id', d.message_id, 'push_outbox_id', d.push_outbox_id);
  END IF;

  IF p_source_table = 'live_help_tickets' THEN
    SELECT t.user_id, t.subject, t.description, t.priority, t.created_at
      INTO v_user, v_subject, v_description, v_priority, v_created
      FROM public.live_help_tickets t WHERE t.id = p_source_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bug_report_source_missing' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_subject, '') LIKE '[BUG]%' THEN
      v_kind := 'Bug Report';
      v_reference := 'BUG-' || upper(left(p_source_id::text, 8));
    ELSE
      v_kind := 'Help Ticket';
      v_reference := 'HELP-' || upper(left(p_source_id::text, 8));
    END IF;
    v_subject := btrim(regexp_replace(COALESCE(v_subject, ''), '^\[BUG\]\s*', ''));
    -- fn_submit_bug_report_to_admin appends "---, Page, User Agent, Reported"
    -- to the description. Lift the page out and keep the reporter's words.
    v_page := NULLIF(btrim(substring(COALESCE(v_description, '') from E'\n---\nPage: ([^\n]*)')), '');
    v_description := btrim(split_part(COALESCE(v_description, ''), E'\n\n---\nPage: ', 1));
  ELSE
    SELECT f.user_id, f.category, f.description, f.created_at
      INTO v_user, v_category, v_description, v_created
      FROM public.user_feedback f WHERE f.id = p_source_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bug_report_source_missing' USING ERRCODE = 'P0002';
    END IF;
    v_kind := CASE lower(COALESCE(v_category, ''))
                WHEN 'bug' THEN 'Bug Report'
                WHEN 'suggestion' THEN 'Suggestion'
                ELSE 'Support Request' END;
    v_reference := 'CA-' || upper(left(p_source_id::text, 8));
    v_subject := 'Club Arena ' || v_kind;
    v_page := 'Club Arena Help';
    v_priority := NULL;
    v_description := btrim(COALESCE(v_description, ''));
  END IF;

  IF v_subject = '' THEN v_subject := 'No Subject'; END IF;
  IF v_description = '' THEN v_description := 'No Description Provided'; END IF;

  IF v_user IS NULL THEN
    v_reporter := 'Anonymous User';
  ELSE
    SELECT NULLIF(btrim(p.username), ''), NULLIF(btrim(p.full_name), '')
      INTO v_username, v_full_name
      FROM public.profiles p WHERE p.id = v_user;
    v_reporter := COALESCE(v_full_name, v_username, 'Unknown User')
      || CASE WHEN v_username IS NOT NULL THEN ' (@' || v_username || ')' ELSE '' END;
  END IF;

  v_content :=
       v_kind || CASE WHEN v_priority IS NOT NULL THEN ' [' || upper(v_priority) || ']' ELSE '' END || E'\n'
    || 'Subject: ' || v_subject || E'\n'
    || 'Reference: ' || v_reference || E'\n'
    || 'Reporter: ' || v_reporter || E'\n'
    || 'Priority: ' || COALESCE(initcap(v_priority), 'Not Provided') || E'\n'
    || 'Page: ' || COALESCE(v_page, 'Not Provided') || E'\n'
    || 'Reported: ' || to_char(COALESCE(v_created, clock_timestamp()) AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' Central' || E'\n\n'
    || left(v_description, 6000) || E'\n\n'
    || CASE WHEN p_source_table = 'live_help_tickets'
            THEN 'Open Ticket Queue: https://smarter.poker/horses?tab=players' || E'\n'
            ELSE '' END
    || 'Record: ' || p_source_table || ' ' || p_source_id::text
    || CASE WHEN v_username IS NOT NULL
            THEN E'\n' || 'Reporter Profile: https://smarter.poker/hub/user/' || v_username
            ELSE '' END;

  -- The dedicated owner conversation. Reused while both parties are in it.
  v_conv := cfg.conversation_id;
  IF v_conv IS NOT NULL AND (
       SELECT count(*) FROM public.social_conversation_participants p
        WHERE p.conversation_id = v_conv
          AND p.user_id IN (cfg.recipient_user_id, cfg.sender_user_id)) <> 2 THEN
    v_conv := NULL;
  END IF;
  IF v_conv IS NULL THEN
    INSERT INTO public.social_conversations (is_group) VALUES (false) RETURNING id INTO v_conv;
    INSERT INTO public.social_conversation_participants (conversation_id, user_id)
    VALUES (v_conv, cfg.sender_user_id), (v_conv, cfg.recipient_user_id);
    UPDATE public.bug_report_routing
       SET conversation_id = v_conv, updated_at = clock_timestamp()
     WHERE id;
  END IF;

  INSERT INTO public.social_messages (conversation_id, sender_id, content, message_type, media_metadata)
  VALUES (v_conv, cfg.sender_user_id, v_content, 'text',
          jsonb_build_object('kind', 'bug_report', 'source_table', p_source_table,
                             'source_id', p_source_id, 'reference', v_reference,
                             'priority', v_priority, 'reporter_user_id', v_user))
  RETURNING id INTO v_msg;

  -- Its own first-class event in the existing durable outbox. The existing
  -- dispatcher claims, gates, sends and retries it like any other row.
  INSERT INTO public.push_outbox (recipient_user_id, title, body, url, event, tag, status, related_entity_id)
  VALUES (cfg.recipient_user_id,
          left(v_kind || ': ' || v_subject, 120),
          left(v_reporter
               || CASE WHEN v_priority IS NOT NULL THEN ' [' || upper(v_priority) || ']' ELSE '' END
               || ': ' || regexp_replace(v_description, '\s+', ' ', 'g'), 500),
          '/hub/messenger?conversation=' || v_conv::text,
          'bug_report',
          'bug_report:' || p_source_id::text,
          'pending',
          p_source_id)
  RETURNING id, status, failure_reason INTO v_outbox, v_outbox_status, v_outbox_reason;

  -- A guard that diverts this row is a defect in the route, not a delivery.
  IF v_outbox_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'bug_report_push_refused_by_guard: % (%)', v_outbox_status, COALESCE(v_outbox_reason, 'no reason')
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.bug_report_deliveries
     SET status = 'delivered', reference = v_reference,
         recipient_user_id = cfg.recipient_user_id, sender_user_id = cfg.sender_user_id,
         conversation_id = v_conv, message_id = v_msg, push_outbox_id = v_outbox,
         attempts = attempts + 1, last_error = NULL, delivered_at = clock_timestamp()
   WHERE id = d.id;

  RETURN jsonb_build_object(
    'status', 'delivered', 'already_delivered', false, 'delivery_id', d.id,
    'reference', v_reference, 'conversation_id', v_conv,
    'message_id', v_msg, 'push_outbox_id', v_outbox);
END
$fn$;

COMMENT ON FUNCTION public.fn_route_bug_report_to_owner(text, uuid) IS
  'Delivers one bug report source row to the owner: one Messenger message, one push_outbox row (event bug_report) and one bug_report_deliveries receipt. Idempotent per source row. 2026-11-09.';

REVOKE ALL ON FUNCTION public.fn_route_bug_report_to_owner(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_route_bug_report_to_owner(text, uuid) TO service_role;

-- 4. The route runs where the report is born, so no client can skip it.
CREATE OR REPLACE FUNCTION public.fn_bug_report_route_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_state text;
  v_error text;
BEGIN
  BEGIN
    PERFORM public.fn_route_bug_report_to_owner(TG_TABLE_NAME::text, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- The report itself is never lost to a delivery fault. The block above
    -- rolled back whole (no half message, no orphan push); record the fault
    -- on the report's own receipt and tell Production Alerts.
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_error = MESSAGE_TEXT;
    BEGIN
      INSERT INTO public.bug_report_deliveries AS r (source_table, source_id, status, attempts, last_error)
      VALUES (TG_TABLE_NAME::text, NEW.id, 'failed', 1, left(v_state || ': ' || v_error, 1000))
      ON CONFLICT (source_table, source_id) DO UPDATE
        SET status = 'failed', attempts = r.attempts + 1, last_error = EXCLUDED.last_error
        WHERE r.status <> 'delivered';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'bug_report_delivery_receipt_failed for % %: %', TG_TABLE_NAME, NEW.id, SQLERRM;
    END;
    BEGIN
      PERFORM public.fn_record_operational_alert(
        'bug-report-routing',
        'bug-report-undelivered:' || TG_TABLE_NAME::text || ':' || NEW.id::text,
        'Bug Report Not Delivered To Owner Messenger', 'firing', 'warning',
        jsonb_build_object('target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
                           'source_table', TG_TABLE_NAME::text, 'source_id', NEW.id,
                           'sqlstate', v_state, 'error', left(v_error, 1000)));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'bug_report_delivery_alert_failed for % %: %', TG_TABLE_NAME, NEW.id, SQLERRM;
    END;
    RAISE WARNING 'bug_report_route_failed for % %: % %', TG_TABLE_NAME, NEW.id, v_state, v_error;
  END;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_bug_report_route_on_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_bug_report_reaches_owner ON public.live_help_tickets;
CREATE TRIGGER zz_bug_report_reaches_owner
  AFTER INSERT ON public.live_help_tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_bug_report_route_on_insert();

DROP TRIGGER IF EXISTS zz_bug_report_reaches_owner ON public.user_feedback;
CREATE TRIGGER zz_bug_report_reaches_owner
  AFTER INSERT ON public.user_feedback
  FOR EACH ROW EXECUTE FUNCTION public.fn_bug_report_route_on_insert();

-- 5. The report that prompted this, through the same idempotent route, once.
-- The five older tickets (three May auto-tests and two May reports filed from
-- the owner's own accounts) are deliberately not replayed.
DO $backfill$
DECLARE
  c_ticket CONSTANT uuid := '7c1347ff-7e28-403c-aa4d-4335176252a7';
  v_result jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.live_help_tickets WHERE id = c_ticket) THEN
    v_result := public.fn_route_bug_report_to_owner('live_help_tickets', c_ticket);
    IF v_result ->> 'status' IS DISTINCT FROM 'delivered'
       OR (SELECT count(*) FROM public.bug_report_deliveries
            WHERE source_table = 'live_help_tickets' AND source_id = c_ticket
              AND status = 'delivered') <> 1 THEN
      RAISE EXCEPTION 'bug_report_backfill_not_delivered: %', v_result;
    END IF;
  END IF;
END
$backfill$;

-- 6. Postconditions: abort rather than install half a route.
DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.bug_report_routing) <> 1 THEN
    RAISE EXCEPTION 'bug_report_routing_must_hold_exactly_one_row';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgname = 'zz_bug_report_reaches_owner' AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND t.tgrelid IN ('public.live_help_tickets'::regclass, 'public.user_feedback'::regclass)) <> 2 THEN
    RAISE EXCEPTION 'bug_report_triggers_not_installed';
  END IF;
  IF public.fn_is_platform_operational_alert('bug_report', 'Bug Report: Example', '{}'::jsonb) THEN
    RAISE EXCEPTION 'bug_report_must_not_be_an_operational_alert';
  END IF;
END
$verify$;

COMMIT;
