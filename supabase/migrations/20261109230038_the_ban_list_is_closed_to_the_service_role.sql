-- 20261109230038_the_ban_list_is_closed_to_the_service_role.sql
-- Reserved by scripts/new-migration.mjs.
-- 20261109224452 created public.banned_signup_emails and revoked it from
-- PUBLIC, anon and authenticated, but not from service_role, which kept every
-- privilege through the schema's default grants. Nothing the server runs reads
-- or writes the ban list: the auth.users gate is a SECURITY DEFINER trigger
-- owned by postgres, and a ban is written by the database owner. Close the
-- list to service_role as the explicit-table-access rule requires. A later
-- tool that needs it gets its own narrow grant in its own migration.
-- No row is read, written or moved here.
-- @live-proof: NOT has_table_privilege('service_role', 'public.banned_signup_emails', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AND NOT has_table_privilege('anon', 'public.banned_signup_emails', 'SELECT, INSERT, UPDATE, DELETE') AND NOT has_table_privilege('authenticated', 'public.banned_signup_emails', 'SELECT, INSERT, UPDATE, DELETE')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
REVOKE ALL ON public.banned_signup_emails FROM service_role;
COMMIT;
