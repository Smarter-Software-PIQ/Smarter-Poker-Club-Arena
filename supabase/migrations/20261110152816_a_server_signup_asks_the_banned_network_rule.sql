-- 20261110152816_a_server_signup_asks_the_banned_network_rule.sql
-- Reserved by scripts/new-migration.mjs.
--
-- WHY. The before-user-created hook (20261109235402) refuses a signup from a
-- banned network on every path Supabase Auth runs it: signup, OTP and magic
-- link, OAuth, SAML, web3, anonymous, invite and generate_link. GoTrue's
-- POST /admin/users (adminUserCreate, supabase/auth master 1357a5b90faa)
-- does not run it. Club Commander's public registration route creates the
-- owner's account through that admin call, so a request from a banned network
-- could create an account there with a new mailbox. That route is where a
-- trustworthy client address is known (Vercel's edge sets it), so it asks the
-- same rule before it creates anything.
--
-- WHAT. EXECUTE on the hook function for service_role, the role that route
-- already uses for the admin call. The function returns only "{}" or the
-- refusal; it does not reveal which networks are listed, and
-- banned_signup_networks stays closed to service_role, anon and authenticated.
-- anon and authenticated still may not execute it.
--
-- No row is written, moved or rewritten. Not a repair job.
-- @live-proof: has_function_privilege('service_role', 'public.fn_a_banned_network_cannot_create_an_account(jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_a_banned_network_cannot_create_an_account(jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_a_banned_network_cannot_create_an_account(jsonb)', 'EXECUTE') AND NOT has_table_privilege('service_role', 'public.banned_signup_networks', 'SELECT')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

GRANT EXECUTE ON FUNCTION public.fn_a_banned_network_cannot_create_an_account(jsonb) TO service_role;

COMMIT;
