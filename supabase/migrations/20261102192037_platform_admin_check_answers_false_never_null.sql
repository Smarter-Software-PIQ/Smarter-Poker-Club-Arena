-- 20261102192037_platform_admin_check_answers_false_never_null.sql
--
-- WHAT THIS CHANGES, AND WHY (#9390, urgent access control):
--
-- public.fn_is_platform_admin() returned NULL, not false, for a signed-in
-- caller with no profiles row (and would for a NULL role):
--     RETURN v_role IN ('admin','superadmin','god');   -- NULL when no row
-- Sixty-two functions gate staff work as
--     IF auth.uid() IS NULL OR NOT public.fn_is_platform_admin() THEN RAISE
-- and `NOT NULL` is NULL, so the IF was skipped and such a caller was let in.
-- A live JWT can outlive its profile (an account deleted while its token is
-- still valid), and three probe accounts in auth.users have no profile.
--
-- The answer is now an explicit boolean: true only for a profile whose role
-- is admin, superadmin or god; false for everything else, including no
-- profile, a NULL role and no caller. Every positive check is unchanged and
-- every `NOT fn_is_platform_admin()` gate now refuses. Same signature,
-- volatility, security and grants (CREATE OR REPLACE keeps the ACL).
--
-- @live-proof: position('COALESCE' in pg_get_functiondef('public.fn_is_platform_admin()'::regprocedure)) > 0 AND has_function_privilege('authenticated','public.fn_is_platform_admin()','EXECUTE') AND pg_get_function_result('public.fn_is_platform_admin()'::regprocedure) = 'boolean'

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_is_platform_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  -- No profile row, or a NULL role, is not staff: never NULL (#9390).
  RETURN COALESCE(v_role IN ('admin', 'superadmin', 'god'), false);
END;
$function$;

COMMIT;
