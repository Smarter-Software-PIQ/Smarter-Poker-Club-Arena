-- @live-proof: md5(pg_get_functiondef('public.fn_new_helper(text)'::regprocedure))='0'
BEGIN;
CREATE FUNCTION public.fn_new_helper(p_version text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
 SELECT p_version
$fn$;
CREATE OR REPLACE FUNCTION public.fn_existing(p int)
RETURNS int LANGUAGE sql AS $fn$ SELECT p $fn$;
DO $patch$ BEGIN EXECUTE 'CREATE OR REPLACE FUNCTION public.fn_patched() RETURNS int LANGUAGE sql AS $b$ SELECT 1 $b$'; END $patch$;
COMMIT;
