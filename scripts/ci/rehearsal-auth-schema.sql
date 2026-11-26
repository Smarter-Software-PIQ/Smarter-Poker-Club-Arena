-- Production's auth schema as the application's objects use it, for the rehearsal
-- copy (restore-schema-for-rehearsal.sh). Read read-only on 2026-11-18. The
-- supabase/postgres image creates a minimal auth schema; GoTrue completes it on a
-- real stack (the Backup standby runs GoTrue, the rehearsal copy does not). The
-- archive (pg_dump -n of the application schemas) carries views that read
-- auth.users.email_confirmed_at and is_anonymous (smarter_private.sp_real_humans) and
-- policies that call auth.jwt() (public.video_generation_queue), so without these the
-- restore stops. Every auth.users column (generated columns excluded) and every auth
-- function, each exactly as production has it.

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS id uuid;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS aud character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS invited_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS confirmation_token character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS recovery_token character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS recovery_sent_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_token_new character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_sent_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_super_admin boolean;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_change text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_change_token character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_change_sent_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_token_current character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_confirm_status smallint;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS reauthentication_token character varying(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS reauthentication_sent_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_sso_user boolean;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean;

CREATE OR REPLACE FUNCTION auth.email()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$function$;

CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$;

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

-- realtime.send as production has it (read read-only on 2026-11-19): signature
-- only. The supabase/postgres image does not carry it, and a body that calls it
-- (process_tournament_rebuy enqueues purchase_committed) was refused on the copy
-- by ca_function_calls_must_resolve while it resolves on production. The copy
-- never broadcasts, so the body does nothing; the image's own wins if present.
CREATE SCHEMA IF NOT EXISTS realtime;
DO $realtime_send$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
     RETURNS void LANGUAGE plpgsql AS $body$ BEGIN END $body$;
  END IF;
END $realtime_send$;

-- auth.sessions as production has it (read read-only on 2026-11-26), less the
-- aal column, whose auth.aal_level type the image may not carry and no
-- application object reads. fn_ca_live_session_id and ca_claim_active_login read
-- it to tell a live sign-in from a revoked one; without it plpgsql_check refused
-- ca_claim_active_login on the copy (42P01) while it resolves on production, and
-- a migration probe of any device function could not run. The copy holds no
-- sessions, so every probe sees a signed-out caller. The image's own wins if present.
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  factor_id uuid,
  not_after timestamp with time zone,
  refreshed_at timestamp without time zone,
  user_agent text,
  ip inet,
  tag text,
  oauth_client_id uuid,
  refresh_token_hmac_key text,
  refresh_token_counter bigint,
  scopes text
);
