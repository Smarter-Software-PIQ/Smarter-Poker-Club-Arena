-- 20261109235402_a_banned_network_cannot_create_an_account.sql
-- Reserved by scripts/new-migration.mjs.
--
-- WHY. The owner ordered a removed player's network addresses blocked from
-- creating another account. The Vercel firewall denies them on the World Hub,
-- but an account is created by Supabase Auth, which the browser and the apps
-- call directly and which never passes Vercel. A request from a denied
-- address with a different mailbox met no rule at all.
--
-- WHAT. Supabase Auth's before-user-created hook hands its function the
-- address Auth itself observed for the request (metadata.ip_address), before
-- the auth.users row exists. This is that function. It answers with the
-- documented error object for an address inside a listed network and with an
-- empty object for every other request, including one whose address is
-- missing or unreadable: an unreadable address must never stop every signup.
--   * banned_signup_networks: the listed networks. Row level security, no
--     policy, no grant to anon, authenticated or service_role.
--   * fn_a_banned_network_cannot_create_an_account(jsonb): SECURITY DEFINER,
--     executable by supabase_auth_admin only.
-- Installing this file changes no behaviour: Auth calls the function only
-- once the hook is enabled in the project's Auth configuration, and that is
-- done and read back separately. No address is listed here.
-- @live-proof: to_regclass('public.banned_signup_networks') IS NOT NULL AND has_function_privilege('supabase_auth_admin', 'public.fn_a_banned_network_cannot_create_an_account(jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_a_banned_network_cannot_create_an_account(jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_a_banned_network_cannot_create_an_account(jsonb)', 'EXECUTE') AND NOT has_table_privilege('anon', 'public.banned_signup_networks', 'SELECT, INSERT, UPDATE, DELETE') AND NOT has_table_privilege('authenticated', 'public.banned_signup_networks', 'SELECT, INSERT, UPDATE, DELETE') AND NOT has_table_privilege('service_role', 'public.banned_signup_networks', 'SELECT, INSERT, UPDATE, DELETE') AND public.fn_a_banned_network_cannot_create_an_account('{"metadata":{"ip_address":"not an address"}}'::jsonb) = '{}'::jsonb
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE TABLE public.banned_signup_networks (
  network           cidr PRIMARY KEY,
  reason            text NOT NULL,
  banned_profile_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.banned_signup_networks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.banned_signup_networks FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.banned_signup_networks IS
  'Networks that may not create an account. Read by the Supabase Auth before-user-created hook function fn_a_banned_network_cannot_create_an_account. Written by the database owner.';

CREATE FUNCTION public.fn_a_banned_network_cannot_create_an_account(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_address inet;
BEGIN
  BEGIN
    v_address := NULLIF(btrim(event -> 'metadata' ->> 'ip_address'), '')::inet;
  EXCEPTION WHEN invalid_text_representation THEN
    v_address := NULL;
  END;
  IF v_address IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.banned_signup_networks b WHERE v_address <<= b.network) THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign Up Is Not Available From This Network'));
  END IF;
  RETURN '{}'::jsonb;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_a_banned_network_cannot_create_an_account(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_a_banned_network_cannot_create_an_account(jsonb) TO supabase_auth_admin;

COMMIT;
