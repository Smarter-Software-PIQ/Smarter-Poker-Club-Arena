-- Minimal Supabase shape for the shared-hand doors: the three API roles,
-- auth.uid() and auth.role() from the request claims, and profiles.status.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, status text);
INSERT INTO public.profiles VALUES
  ('11111111-1111-1111-1111-111111111111', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'deleted');
-- The live telemetry-exposure sweep's list of deliberately public definers.
CREATE TABLE public.ca_browser_definer_allowlist (proname text PRIMARY KEY, reason text NOT NULL);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
