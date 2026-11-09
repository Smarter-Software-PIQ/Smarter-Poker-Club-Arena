-- Disposable stand-ins for the production objects the bug report route touches.
-- Shapes mirror production as read on 2026-11-09; no production data.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('test.viewer', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text, full_name text, role text DEFAULT 'user');
CREATE FUNCTION public.fn_is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
  $$ SELECT COALESCE((SELECT role IN ('admin','superadmin','god') FROM public.profiles WHERE id = auth.uid()), false) $$;

CREATE TABLE public.live_help_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, conversation_id uuid,
  subject text NOT NULL, description text NOT NULL,
  priority text DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status text DEFAULT 'open', assigned_to uuid, admin_notes text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), resolved_at timestamptz);
ALTER TABLE public.live_help_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create own tickets" ON public.live_help_tickets FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY live_help_tickets_select ON public.live_help_tickets FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id OR public.fn_is_platform_admin());
GRANT INSERT, SELECT ON public.live_help_tickets TO authenticated;

CREATE TABLE public.user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, category text NOT NULL DEFAULT 'general',
  description text NOT NULL, screenshot_url text, status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_feedback_insert ON public.user_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = (SELECT auth.uid()));
CREATE POLICY user_feedback_select_own ON public.user_feedback FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
GRANT INSERT, SELECT ON public.user_feedback TO authenticated;

CREATE TABLE public.social_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  last_message_at timestamptz DEFAULT now(), last_message_preview text, is_group boolean DEFAULT false,
  is_request boolean DEFAULT false, context_entity_id uuid, context_entity_type text);
CREATE TABLE public.social_conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.social_conversations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(), last_read_at timestamptz, context_entity_id uuid, context_entity_type text,
  UNIQUE (conversation_id, user_id));
CREATE TABLE public.social_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.social_conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL, message_type text DEFAULT 'text', created_at timestamptz DEFAULT now(),
  is_deleted boolean DEFAULT false, media_metadata jsonb, request_id uuid);
ALTER TABLE public.social_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_user_id uuid, title text NOT NULL, body text NOT NULL,
  url text, tag text, status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0, failure_reason text, related_entity_id uuid, event text,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, claimed_at timestamptz);
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;

-- The production guards, byte for byte where it matters to this route.
CREATE FUNCTION public.fn_is_platform_alert_recipient(p_user uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS
  $$ SELECT COALESCE(p_user IN ('47965354-0e56-43ef-931c-ddaab82af765'::uuid,'3bb71bfe-f723-427c-aac7-a853ba04a014'::uuid),false) $$;
CREATE FUNCTION public.fn_is_platform_operational_alert(p_type text, p_title text, p_data jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(p_type='platform_admin_alert' OR p_data->>'audience'='platform_admin' OR p_type IN ('financial_incident','financial_incident_resolved','financial_attestation',
 'engine_break_failed','engine_break_recovered','guarantee_bank_short','guarantee_bank_recovered','estate_digest')
 OR ((p_type='system' OR p_type IS NULL) AND (p_title IN ('Push Health Alert','Notifications May Not Be Reaching This Device',
 'Push Notifications Are Off','Money Check Failed','Engine Restart Storm','Tables Have Stopped Dealing',
 'Production Alerts Has Stopped Reading','Tournament Schedule Active') OR p_title ~ '^Horse Fleet (Alert|Recovered): '
 OR (p_data->>'component'='club-arena-engine' AND jsonb_typeof(p_data->'alertname')='string'
 AND NULLIF(p_data->>'alertname','') IS NOT NULL))),false) $$;
CREATE FUNCTION public.fn_platform_push_recipient_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (TG_OP='INSERT' OR NEW.status IN ('pending','processing'))
    AND public.fn_is_platform_operational_alert(NEW.event,NEW.title,'{}'::jsonb) THEN
  IF NOT public.fn_is_platform_alert_recipient(NEW.recipient_user_id) THEN
   NEW.status:='skipped'; NEW.claimed_at:=NULL; NEW.failure_reason:='platform_alert_recipient_not_allowed';
  ELSIF COALESCE(NEW.title,'') NOT IN ('Push Health Alert','Notifications May Not Be Reaching This Device','Push Notifications Are Off') THEN
   NEW.status:='skipped'; NEW.claimed_at:=NULL; NEW.failure_reason:='routed_to_production_alerts';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_platform_push_recipient_guard BEFORE INSERT OR UPDATE ON public.push_outbox
  FOR EACH ROW EXECUTE FUNCTION public.fn_platform_push_recipient_guard();

CREATE TABLE public.operational_alert_events (
  id bigserial PRIMARY KEY, source text NOT NULL, event_key text NOT NULL, alertname text NOT NULL,
  status text NOT NULL, severity text NOT NULL, payload jsonb NOT NULL, UNIQUE (source, event_key));
CREATE FUNCTION public.fn_record_operational_alert(p_source text, p_event_key text, p_alertname text, p_status text, p_severity text, p_payload jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.operational_alert_events(source,event_key,alertname,status,severity,payload)
  VALUES (p_source,p_event_key,p_alertname,p_status,p_severity,p_payload)
  ON CONFLICT (source,event_key) DO UPDATE SET payload=EXCLUDED.payload RETURNING id INTO v_id;
  RETURN v_id;
END $$;

INSERT INTO public.profiles (id, username, full_name, role) VALUES
  ('47965354-0e56-43ef-931c-ddaab82af765', 'kingfish', 'Owner Fixture', 'admin'),
  ('2d1cd6c3-5700-4af9-a271-d4863fdab20d', 'smarterpoker', 'Smarter.Poker Official', 'god'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'reporter_one', 'Reporter One', 'user'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'reporter_two', NULL, 'user');

-- The report that prompted the route, as fn_submit_bug_report_to_admin stored it.
INSERT INTO public.live_help_tickets (id, user_id, subject, description, priority, created_at) VALUES
  ('7c1347ff-7e28-403c-aa4d-4335176252a7', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '[BUG] Other - Stuck At A Table', E'Stuck and cannot leave.\n\n---\nPage: /hub/messenger\nUser Agent: Fixture Agent\nReported: 2026-11-09 10:11:55+00',
   'high', '2026-11-09 10:11:55+00'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '[BUG] Old Auto Test', 'Historical row that must stay undelivered.', 'high', '2026-05-16 06:42:04+00');
