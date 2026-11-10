-- Supabase platform objects the production definitions call. These are the
-- published Supabase definitions (they read the PostgREST request settings).
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub',true),''),(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role',true),''),(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'role'))::text$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claim',true),''),NULLIF(current_setting('request.jwt.claims',true),''))::jsonb$$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb,created_at timestamptz DEFAULT now());
-- SINK: Supabase Realtime broadcast. A publisher only; it returns nothing the
-- money path reads. Production: realtime.send(payload jsonb, event text, topic text, private boolean).
CREATE SCHEMA realtime;
CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean DEFAULT true) RETURNS void LANGUAGE sql AS $$SELECT$$;
