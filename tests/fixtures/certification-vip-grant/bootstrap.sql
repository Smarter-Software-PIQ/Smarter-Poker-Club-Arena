DO $$ BEGIN CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz);
CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text DEFAULT 'user', is_admin boolean DEFAULT false, is_horse boolean DEFAULT false, is_vip boolean DEFAULT false, vip_tier text, vip_expires_at timestamptz);
CREATE TABLE public.vip_subscriptions(user_id uuid, status text);
CREATE FUNCTION public.fn_ca_is_fixture_account(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p AND u.email LIKE '%.invalid') $$;
-- reserved certification accounts and real players
INSERT INTO auth.users VALUES
 ('11111111-0000-0000-0000-000000000001','ca-customization-cert-postdeploy-1-a@example.invalid',null),
 ('11111111-0000-0000-0000-000000000002','ca-customization-cert-postdeploy-2-a@example.invalid',null),
 ('11111111-0000-0000-0000-000000000003','ca-customization-cert-postdeploy-3-a@example.invalid',now()),
 ('11111111-0000-0000-0000-000000000004','rh-verify-vip-x@smarter-poker.invalid',null),
 ('11111111-0000-0000-0000-000000000005','player@example.com',null),
 ('11111111-0000-0000-0000-000000000006','ca-customization-cert-postdeploy-6-a@example.invalid',null),
 ('11111111-0000-0000-0000-000000000007','ca-customization-cert-postdeploy-7-a@example.invalid',null),
 ('11111111-0000-0000-0000-000000000008','ca-customization-cert-postdeploy-8-a@example.invalid',null);
INSERT INTO public.profiles(id) SELECT id FROM auth.users;
UPDATE public.profiles SET is_vip=true, vip_tier='lifetime' WHERE id='11111111-0000-0000-0000-000000000006';
UPDATE public.profiles SET is_admin=true WHERE id='11111111-0000-0000-0000-000000000007';
INSERT INTO public.vip_subscriptions VALUES ('11111111-0000-0000-0000-000000000008','active');
