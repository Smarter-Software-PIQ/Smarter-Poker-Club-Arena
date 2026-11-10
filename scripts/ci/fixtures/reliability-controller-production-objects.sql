-- Minimal copies of the production objects the Reliability Controller touches,
-- for scripts/ci/test-reliability-controller-stage-b.py only. The column lists
-- and CHECK constraints of the tables, auth.role() and the bodies of
-- fn_record_operational_alert (its comment block removed),
-- fn_messenger_send_allowed, fn_send_message_once,
-- fn_is_platform_alert_recipient, fn_is_platform_operational_alert and
-- fn_platform_push_recipient_guard were read from production (PokerIQ)
-- through pg_catalog / pg_get_functiondef on 2026-11-09 and 2026-11-10 and
-- copied here by hand. Row level security, the other triggers on these tables
-- (including the two event-specific push_outbox triggers, which do not match
-- this event) and foreign keys to auth.users are left out. cron.* is the same
-- stand-in the other native proofs use.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA cron;
-- The existing private schema. Production: USAGE for anon, authenticated and
-- service_role (read from pg_namespace.nspacl on 2026-11-09), no default ACL.
CREATE SCHEMA smarter_private;
GRANT USAGE ON SCHEMA smarter_private TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO PUBLIC;

CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job(jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;

CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;

CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;

CREATE TABLE public.operational_alert_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (length(source) >= 1 AND length(source) <= 120),
  event_key text NOT NULL CHECK (length(event_key) >= 1 AND length(event_key) <= 512),
  alertname text NOT NULL CHECK (length(alertname) >= 1 AND length(alertname) <= 240),
  status text NOT NULL CHECK (status = ANY (ARRAY['firing'::text, 'resolved'::text, 'info'::text])),
  severity text NOT NULL CHECK (length(severity) >= 1 AND length(severity) <= 40),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'::text AND octet_length(payload::text) <= 262144),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivery_count bigint NOT NULL DEFAULT 1,
  investigation_status text NOT NULL DEFAULT 'new'::text,
  investigation jsonb NOT NULL DEFAULT '{}'::jsonb,
  investigation_touched_at timestamptz,
  UNIQUE (source, event_key)
);
ALTER TABLE public.operational_alert_events ADD CONSTRAINT operational_alert_events_investigation_status_check
  CHECK (investigation_status = ANY (ARRAY['new'::text, 'investigating'::text, 'blocked'::text, 'verified_fixed'::text, 'historical'::text, 'test'::text, 'informational'::text])) NOT VALID;

CREATE OR REPLACE FUNCTION public.fn_record_operational_alert(p_source text, p_event_key text, p_alertname text, p_status text, p_severity text, p_payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_id bigint;
BEGIN
  -- A repeat delivery bumps the receipt. It never rewrites evidence, and it
  -- never changes a destination the row already names. The one thing it adds
  -- is the destination a row recorded before its writer addressed alerts:
  -- without it, a long-running alert first recorded unaddressed stays out of
  -- the owning lane for as long as it keeps firing.
  --
  -- AN INFORMATIONAL EVENT IS RECORDED INFORMATIONAL (2026-10-15). A row
  -- whose writer says status 'info' AND severity 'info' is a record, not an
  -- incident: the hourly "Accounting Documents Issued (Owner Copy)" summary
  -- (20260927143752) and the per-release receipts of a Post-Deploy episode
  -- (the episode's own firing row is the alert). It lands as 'informational',
  -- which the fleet does not triage, instead of 'new', which it must close by
  -- hand every hour. Everything else still lands 'new'.
  INSERT INTO public.operational_alert_events(source,event_key,alertname,status,severity,payload,investigation_status)
  VALUES(p_source,p_event_key,p_alertname,p_status,p_severity,p_payload,
         CASE WHEN p_status = 'info' AND p_severity = 'info' THEN 'informational' ELSE 'new' END)
  ON CONFLICT (source,event_key) DO UPDATE
  SET last_received_at=clock_timestamp(), delivery_count=operational_alert_events.delivery_count+1,
      payload=CASE
        WHEN jsonb_typeof(operational_alert_events.payload)='object'
         AND NOT (operational_alert_events.payload ? 'target_task_id')
         AND jsonb_typeof(EXCLUDED.payload->'target_task_id')='string'
        THEN operational_alert_events.payload
             || jsonb_build_object('target_task_id',EXCLUDED.payload->'target_task_id')
        ELSE operational_alert_events.payload END
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Who may write the inbox, as on production (pg_class.relacl and pg_proc.proacl
-- read 2026-11-10): postgres and service_role only.
REVOKE ALL ON public.operational_alert_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.operational_alert_events TO service_role;
REVOKE ALL ON FUNCTION public.fn_record_operational_alert(text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_operational_alert(text, text, text, text, text, jsonb) TO service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text);

CREATE TABLE public.social_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_message_at timestamptz DEFAULT now(),
  last_message_preview text,
  is_group boolean DEFAULT false,
  group_name text,
  is_request boolean DEFAULT false,
  request_sender_id uuid,
  context_entity_id uuid,
  context_entity_type text
);

CREATE TABLE public.social_conversation_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES public.social_conversations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  last_read_at timestamptz,
  read_receipts_enabled boolean DEFAULT true,
  is_muted boolean DEFAULT false,
  is_pinned boolean DEFAULT false,
  context_entity_id uuid,
  context_entity_type text,
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE public.social_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES public.social_conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  message_type text DEFAULT 'text'::text,
  media_metadata jsonb,
  request_id uuid,
  read_at timestamptz,
  is_deleted boolean DEFAULT false,
  is_edited boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.messenger_send_requests (
  sender_id uuid NOT NULL,
  request_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sender_id, request_id)
);

CREATE TABLE public.messenger_blocked (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id uuid,
  blocked_id uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);

CREATE OR REPLACE FUNCTION public.fn_messenger_send_allowed(p_conversation_id uuid, p_sender_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_sender_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.social_conversation_participants p
      WHERE p.conversation_id=p_conversation_id AND p.user_id=p_sender_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.social_conversation_participants p
      JOIN public.messenger_blocked b ON
        (b.blocker_id=p_sender_id AND b.blocked_id=p.user_id)
        OR (b.blocked_id=p_sender_id AND b.blocker_id=p.user_id)
      WHERE p.conversation_id=p_conversation_id AND p.user_id<>p_sender_id
    );
$function$;

CREATE OR REPLACE FUNCTION public.fn_send_message_once(p_conversation_id uuid, p_sender_id uuid, p_request_id uuid, p_content text, p_message_type text DEFAULT 'text'::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_receipt public.messenger_send_requests%ROWTYPE;
  v_hash text;
  v_message_id uuid;
  v_type text := COALESCE(NULLIF(p_message_type,''),'text');
  v_metadata jsonb := COALESCE(p_metadata,'{}'::jsonb);
BEGIN
  IF p_sender_id IS NULL OR p_conversation_id IS NULL OR p_request_id IS NULL
     OR p_content IS NULL OR length(p_content)=0 OR length(p_content)>2000
     OR v_type NOT IN ('text','shared_post','gif','image','system')
     OR jsonb_typeof(v_metadata)<>'object' OR octet_length(v_metadata::text)>32768 THEN
    RAISE EXCEPTION 'Invalid Message Request' USING ERRCODE='22023';
  END IF;
  -- Keep sender participation through commit. Concurrent removal waits for
  -- this send, or wins first and the send fails without a message/receipt.
  PERFORM 1 FROM public.social_conversation_participants
    WHERE conversation_id=p_conversation_id AND user_id=p_sender_id FOR SHARE;
  IF NOT FOUND OR NOT public.fn_messenger_send_allowed(p_conversation_id,p_sender_id) THEN
    RAISE EXCEPTION 'Cannot Send To This Conversation' USING ERRCODE='42501';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'conversation_id',p_conversation_id,'content',p_content,
    'message_type',v_type,'media_metadata',v_metadata)::text,'UTF8')),'hex');
  INSERT INTO public.messenger_send_requests(sender_id,request_id,conversation_id,payload_hash)
    VALUES(p_sender_id,p_request_id,p_conversation_id,v_hash)
    ON CONFLICT(sender_id,request_id) DO NOTHING;
  SELECT * INTO STRICT v_receipt FROM public.messenger_send_requests
    WHERE sender_id=p_sender_id AND request_id=p_request_id FOR UPDATE;
  IF v_receipt.payload_hash<>v_hash OR v_receipt.conversation_id<>p_conversation_id THEN
    RAISE EXCEPTION 'Message Request Conflicts With Previous Send' USING ERRCODE='23505';
  END IF;
  IF v_receipt.message_id IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'message_id',v_receipt.message_id,
      'conversation_id',p_conversation_id,'replayed',true);
  END IF;
  -- Same persisted content and preview behavior as the installed legacy send,
  -- with request_id on the original INSERT for Realtime-before-HTTP matching.
  INSERT INTO public.social_messages(conversation_id,sender_id,content,message_type,media_metadata,request_id)
    VALUES(p_conversation_id,p_sender_id,p_content,v_type,
      CASE WHEN v_metadata='{}'::jsonb THEN NULL ELSE v_metadata END,p_request_id)
    RETURNING id INTO v_message_id;
  UPDATE public.social_conversations SET last_message_at=now(),
    last_message_preview=CASE WHEN v_type='shared_post'
      THEN COALESCE(v_metadata->>'preview_title','Shared Post') ELSE left(p_content,100) END,
    updated_at=now() WHERE id=p_conversation_id;
  UPDATE public.messenger_send_requests SET message_id=v_message_id
    WHERE sender_id=p_sender_id AND request_id=p_request_id;
  RETURN jsonb_build_object('success',true,'message_id',v_message_id,
    'conversation_id',p_conversation_id,'replayed',false);
END;
$function$;

-- The durable push outbox and its recipient guard (aa_platform_push_recipient_guard).
CREATE OR REPLACE FUNCTION public.fn_is_platform_alert_recipient(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT COALESCE(p_user IN ('47965354-0e56-43ef-931c-ddaab82af765'::uuid,
 '3bb71bfe-f723-427c-aac7-a853ba04a014'::uuid),false);
$function$;

CREATE OR REPLACE FUNCTION public.fn_is_platform_operational_alert(p_type text, p_title text, p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT COALESCE(p_type='platform_admin_alert' OR p_data->>'audience'='platform_admin' OR p_type IN ('financial_incident','financial_incident_resolved','financial_attestation',
 'engine_break_failed','engine_break_recovered','guarantee_bank_short','guarantee_bank_recovered','estate_digest')
 OR ((p_type='system' OR p_type IS NULL) AND (p_title IN ('Push Health Alert','Notifications May Not Be Reaching This Device',
 'Push Notifications Are Off','Money Check Failed','Engine Restart Storm','Tables Have Stopped Dealing',
 'Production Alerts Has Stopped Reading','Tournament Schedule Active') OR p_title ~ '^Horse Fleet (Alert|Recovered): '
 OR (p_data->>'component'='club-arena-engine' AND jsonb_typeof(p_data->'alertname')='string'
 AND NULLIF(p_data->>'alertname','') IS NOT NULL))),false);
$function$;

CREATE TABLE public.push_outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_user_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  url text,
  icon_url text,
  badge_url text,
  tag text,
  status text NOT NULL DEFAULT 'pending'::text
    CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'skipped'::text])),
  attempts integer NOT NULL DEFAULT 0,
  failure_reason text,
  related_entity_id uuid,
  event text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  claimed_at timestamptz,
  image_url text,
  accounting_notification_id uuid,
  next_attempt_at timestamptz
);

CREATE OR REPLACE FUNCTION public.fn_platform_push_recipient_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF (TG_OP='INSERT' OR NEW.status IN ('pending','processing'))
    AND public.fn_is_platform_operational_alert(NEW.event,NEW.title,'{}'::jsonb) THEN
  IF NOT public.fn_is_platform_alert_recipient(NEW.recipient_user_id) THEN
   NEW.status:='skipped'; NEW.claimed_at:=NULL;
   NEW.failure_reason:='platform_alert_recipient_not_allowed';
  ELSIF COALESCE(NEW.title,'') NOT IN ('Push Health Alert','Notifications May Not Be Reaching This Device','Push Notifications Are Off') THEN
   NEW.status:='skipped'; NEW.claimed_at:=NULL;
   NEW.failure_reason:='routed_to_production_alerts';
  END IF;
 END IF;
 RETURN NEW;
END $function$;

CREATE TRIGGER aa_platform_push_recipient_guard BEFORE INSERT OR UPDATE ON public.push_outbox
  FOR EACH ROW EXECUTE FUNCTION public.fn_platform_push_recipient_guard();

INSERT INTO public.profiles (id, username) VALUES
  ('2d1cd6c3-5700-4af9-a271-d4863fdab20d', 'smarterpoker'),
  ('47965354-0e56-43ef-931c-ddaab82af765', 'kingfish');
