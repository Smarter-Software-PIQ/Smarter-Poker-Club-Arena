-- The old fn_is_platform_admin body, as live before #9390, on a minimal schema.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.viewer',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text DEFAULT 'user');
INSERT INTO public.profiles VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','user'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',NULL),
 ('dddddddd-dddd-dddd-dddd-dddddddddddd','admin'),
 ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','superadmin'),
 ('ffffffff-ffff-ffff-ffff-ffffffffffff','god');
CREATE FUNCTION public.fn_is_platform_admin() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  RETURN v_role IN ('admin', 'superadmin', 'god');
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_is_platform_admin() TO authenticated, service_role;
-- A gate written the way 62 live functions are.
CREATE FUNCTION public.staff_only_gate() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_is_platform_admin() THEN
    RAISE EXCEPTION 'staff only' USING ERRCODE = '42501';
  END IF;
  RETURN 'served';
END $function$;
