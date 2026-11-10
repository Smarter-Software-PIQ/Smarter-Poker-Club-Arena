-- Runs after the migration has been applied twice. Every failure raises.
\set ON_ERROR_STOP 1
DO $$
DECLARE
  c_owner CONSTANT uuid := '47965354-0e56-43ef-931c-ddaab82af765';
  c_sender CONSTANT uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  c_backfill CONSTANT uuid := '7c1347ff-7e28-403c-aa4d-4335176252a7';
  c_old CONSTANT uuid := '11111111-1111-4111-8111-111111111111';
  d public.bug_report_deliveries%ROWTYPE;
  m public.social_messages%ROWTYPE;
  o public.push_outbox%ROWTYPE;
  v_conv uuid; v_ticket uuid; v_feedback uuid; v_again jsonb; v_n int;
BEGIN
  -- 1. Backfill: exactly once, even though the migration ran twice.
  SELECT * INTO d FROM public.bug_report_deliveries WHERE source_table='live_help_tickets' AND source_id=c_backfill;
  IF d.status IS DISTINCT FROM 'delivered' OR d.reference <> 'BUG-7C1347FF' OR d.attempts <> 1 THEN
    RAISE EXCEPTION 'backfill receipt wrong: %', to_jsonb(d); END IF;
  SELECT count(*) INTO v_n FROM public.social_messages WHERE media_metadata->>'source_id'=c_backfill::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'backfill wrote % messages', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.push_outbox WHERE related_entity_id=c_backfill AND event='bug_report';
  IF v_n <> 1 THEN RAISE EXCEPTION 'backfill queued % pushes', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.bug_report_deliveries WHERE source_id=c_old) THEN
    RAISE EXCEPTION 'a historical ticket was replayed'; END IF;

  SELECT * INTO m FROM public.social_messages WHERE id=d.message_id;
  SELECT * INTO o FROM public.push_outbox WHERE id=d.push_outbox_id;
  v_conv := d.conversation_id;
  IF m.sender_id <> c_sender OR m.conversation_id <> v_conv OR m.message_type <> 'text' THEN
    RAISE EXCEPTION 'message identity wrong'; END IF;
  IF (SELECT array_agg(user_id ORDER BY user_id) FROM public.social_conversation_participants WHERE conversation_id=v_conv)
       IS DISTINCT FROM (SELECT array_agg(u ORDER BY u) FROM unnest(ARRAY[c_owner,c_sender]) u) THEN
    RAISE EXCEPTION 'conversation audience is not exactly owner and platform identity'; END IF;
  IF m.content NOT LIKE E'Bug Report [HIGH]\nSubject: Other - Stuck At A Table\nReference: BUG-7C1347FF\nReporter: Reporter One (@reporter_one)\nPriority: High\nPage: /hub/messenger\nReported: 2026-11-09 04:11 Central\n\nStuck and cannot leave.\n\nOpen Ticket Queue: https://smarter.poker/horses?tab=players\nRecord: live_help_tickets 7c1347ff-7e28-403c-aa4d-4335176252a7\nReporter Profile: https://smarter.poker/hub/user/reporter_one' THEN
    RAISE EXCEPTION 'message content wrong: %', m.content; END IF;
  IF m.content LIKE '%User Agent%' OR m.content ~ '[—]' THEN RAISE EXCEPTION 'message carries the trailer or an em dash'; END IF;
  IF o.recipient_user_id <> c_owner OR o.status <> 'pending' OR o.failure_reason IS NOT NULL
     OR o.title <> 'Bug Report: Other - Stuck At A Table'
     OR o.body <> 'Reporter One (@reporter_one) [HIGH]: Stuck and cannot leave.'
     OR o.url <> '/hub/messenger?conversation=' || v_conv::text
     OR o.tag <> 'bug_report:' || c_backfill::text THEN
    RAISE EXCEPTION 'push row wrong: %', to_jsonb(o); END IF;

  -- 2. An explicit repeat call is a no-op that returns the first delivery.
  v_again := public.fn_route_bug_report_to_owner('live_help_tickets', c_backfill);
  IF (v_again->>'already_delivered')::boolean IS NOT TRUE OR v_again->>'message_id' <> d.message_id::text
     OR (SELECT count(*) FROM public.social_messages) <> 1 OR (SELECT count(*) FROM public.push_outbox) <> 1 THEN
    RAISE EXCEPTION 'repeat call was not idempotent: %', v_again; END IF;

  -- 3. A reporter inserting a ticket under RLS cannot skip the route and
  --    needs no privilege on Messenger, the outbox or the receipt.
  PERFORM set_config('test.viewer', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.live_help_tickets (user_id, subject, description, priority)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cannot Find My Club', 'Where is it?', 'low') RETURNING id INTO v_ticket;
  INSERT INTO public.user_feedback (user_id, category, description)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bug', 'The table froze.') RETURNING id INTO v_feedback;
  BEGIN
    PERFORM public.fn_route_bug_report_to_owner('live_help_tickets', v_ticket);
    RAISE EXCEPTION 'a player could call the route directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM public.bug_report_routing;
    RAISE EXCEPTION 'a player could read the routing row';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM public.bug_report_deliveries) <> 0 THEN
    RAISE EXCEPTION 'a non-staff player can read delivery receipts'; END IF;
  RESET ROLE;

  SELECT * INTO d FROM public.bug_report_deliveries WHERE source_table='live_help_tickets' AND source_id=v_ticket;
  IF d.status IS DISTINCT FROM 'delivered' OR d.reference NOT LIKE 'HELP-%' OR d.conversation_id <> v_conv THEN
    RAISE EXCEPTION 'help ticket receipt wrong: %', to_jsonb(d); END IF;
  SELECT * INTO m FROM public.social_messages WHERE id=d.message_id;
  IF m.content NOT LIKE E'Help Ticket [LOW]\nSubject: Cannot Find My Club\n%Reporter: reporter_two (@reporter_two)\n%Page: Not Provided\n%' THEN
    RAISE EXCEPTION 'help ticket content wrong: %', m.content; END IF;

  SELECT * INTO d FROM public.bug_report_deliveries WHERE source_table='user_feedback' AND source_id=v_feedback;
  IF d.status IS DISTINCT FROM 'delivered' OR d.reference NOT LIKE 'CA-%' OR d.conversation_id <> v_conv THEN
    RAISE EXCEPTION 'club arena receipt wrong: %', to_jsonb(d); END IF;
  SELECT * INTO m FROM public.social_messages WHERE id=d.message_id;
  SELECT * INTO o FROM public.push_outbox WHERE id=d.push_outbox_id;
  IF m.content NOT LIKE E'Bug Report\nSubject: Club Arena Bug Report\n%Priority: Not Provided\nPage: Club Arena Help\n%The table froze.%Record: user_feedback %'
     OR m.content LIKE '%Open Ticket Queue%' OR o.title <> 'Bug Report: Club Arena Bug Report' OR o.status <> 'pending' THEN
    RAISE EXCEPTION 'club arena delivery wrong: % / %', m.content, to_jsonb(o); END IF;

  -- 4. An anonymous report is delivered too.
  INSERT INTO public.live_help_tickets (user_id, subject, description, priority)
  VALUES (NULL, '[BUG] Login Page', 'Blank screen.', 'critical') RETURNING id INTO v_ticket;
  SELECT m2.* INTO m FROM public.bug_report_deliveries r JOIN public.social_messages m2 ON m2.id=r.message_id
   WHERE r.source_id=v_ticket AND r.status='delivered';
  IF m.content NOT LIKE E'Bug Report [CRITICAL]\n%Reporter: Anonymous User\n%' OR m.content LIKE '%Reporter Profile%' THEN
    RAISE EXCEPTION 'anonymous delivery wrong: %', m.content; END IF;

  -- One conversation, one message and one push per report so far.
  IF (SELECT count(*) FROM public.social_conversations) <> 1
     OR (SELECT count(*) FROM public.social_messages) <> 4
     OR (SELECT count(*) FROM public.push_outbox WHERE event='bug_report' AND status='pending') <> 4
     OR (SELECT count(*) FROM public.bug_report_deliveries WHERE status='delivered') <> 4 THEN
    RAISE EXCEPTION 'counts drifted'; END IF;

  -- 5. A delivery fault never loses the report: the row commits, the receipt
  --    says failed with the reason, Production Alerts is told, nothing half-written.
  ALTER TABLE public.push_outbox ADD CONSTRAINT fixture_fault CHECK (event <> 'bug_report') NOT VALID;
  INSERT INTO public.live_help_tickets (user_id, subject, description, priority)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[BUG] During A Fault', 'Still stored.', 'medium') RETURNING id INTO v_ticket;
  SELECT * INTO d FROM public.bug_report_deliveries WHERE source_id=v_ticket;
  IF d.status IS DISTINCT FROM 'failed' OR d.last_error NOT LIKE '23514:%' OR d.message_id IS NOT NULL THEN
    RAISE EXCEPTION 'fault receipt wrong: %', to_jsonb(d); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.live_help_tickets WHERE id=v_ticket)
     OR (SELECT count(*) FROM public.social_messages) <> 4
     OR NOT EXISTS (SELECT 1 FROM public.operational_alert_events
                     WHERE source='bug-report-routing' AND event_key='bug-report-undelivered:live_help_tickets:'||v_ticket::text
                       AND payload->>'target_task_id'='01a09b86-5ba8-7290-8657-1041f13dd3ca') THEN
    RAISE EXCEPTION 'fault handling lost the ticket, half-wrote or stayed silent'; END IF;
  -- Once the fault is gone, the same route completes the same receipt, once.
  ALTER TABLE public.push_outbox DROP CONSTRAINT fixture_fault;
  PERFORM public.fn_route_bug_report_to_owner('live_help_tickets', v_ticket);
  PERFORM public.fn_route_bug_report_to_owner('live_help_tickets', v_ticket);
  SELECT * INTO d FROM public.bug_report_deliveries WHERE source_id=v_ticket;
  IF d.status <> 'delivered' OR d.attempts <> 2 OR d.last_error IS NOT NULL
     OR (SELECT count(*) FROM public.social_messages WHERE media_metadata->>'source_id'=v_ticket::text) <> 1
     OR (SELECT count(*) FROM public.push_outbox WHERE related_entity_id=v_ticket) <> 1 THEN
    RAISE EXCEPTION 'recovery was not exactly once: %', to_jsonb(d); END IF;

  -- 6. The Production Alerts routing is untouched: an operational push to the
  --    owner is still diverted, and the recipient cannot be a non-owner.
  INSERT INTO public.push_outbox (recipient_user_id, title, body, event)
  VALUES (c_owner, 'Engine Restart Storm', 'x', 'platform_admin_alert') RETURNING * INTO o;
  IF o.status <> 'skipped' OR o.failure_reason <> 'routed_to_production_alerts' THEN
    RAISE EXCEPTION 'operational alert routing was weakened'; END IF;
  BEGIN
    UPDATE public.bug_report_routing SET recipient_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    RAISE EXCEPTION 'bug reports could be pointed at a non-owner account';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 7. If the owner leaves the conversation, the next report opens a fresh one.
  DELETE FROM public.social_conversation_participants WHERE conversation_id=v_conv AND user_id=c_owner;
  INSERT INTO public.user_feedback (user_id, category, description) VALUES (NULL, 'suggestion', 'Add A Feature.') RETURNING id INTO v_feedback;
  SELECT * INTO d FROM public.bug_report_deliveries WHERE source_id=v_feedback;
  IF d.status <> 'delivered' OR d.conversation_id = v_conv
     OR (SELECT conversation_id FROM public.bug_report_routing) <> d.conversation_id THEN
    RAISE EXCEPTION 'conversation was not re-established: %', to_jsonb(d); END IF;
  RAISE NOTICE 'BUG_REPORT_ROUTING_OK';
END $$;
