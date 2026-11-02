-- Minimal Supabase-shaped surface for the rabbit hunt authority regression.
DO $$ BEGIN CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.viewer',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
CREATE TABLE public.rabbit_hunt_offers(table_id uuid NOT NULL, hand_number bigint NOT NULL, cards jsonb NOT NULL, board_len int NOT NULL, eligible_user_ids uuid[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(table_id,hand_number));
CREATE TABLE public.digital_purchase_receipts(user_id uuid NOT NULL, request_id uuid NOT NULL, purchase_kind text NOT NULL, request_payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_id));
CREATE TABLE public.rabbit_hunt_reveals(user_id uuid NOT NULL, table_id uuid NOT NULL, hand_number bigint NOT NULL, charged int NOT NULL DEFAULT 0, revealed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,table_id,hand_number));
CREATE TABLE public.feature_purchases(id uuid PRIMARY KEY, user_id uuid NOT NULL, feature text NOT NULL, cost int, usage_type text, uses_remaining int, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), source text);
CREATE TABLE public.vip_feature_usage_monthly(user_id uuid NOT NULL, feature text NOT NULL, month text NOT NULL, usage_count int NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now(), PRIMARY KEY(user_id,feature,month));
