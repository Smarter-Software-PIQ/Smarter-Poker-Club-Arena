\set ON_ERROR_STOP 1
CREATE FUNCTION pg_temp.gate_for(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('test.viewer', coalesce(p,''), false);
  BEGIN RETURN public.staff_only_gate(); EXCEPTION WHEN insufficient_privilege THEN RETURN 'refused'; END;
END $$;
DO $$ BEGIN
  PERFORM set_config('test.viewer','',false);
  ASSERT public.fn_is_platform_admin() IS FALSE, 'no caller';
  PERFORM set_config('test.viewer','99999999-9999-9999-9999-999999999999',false);
  ASSERT public.fn_is_platform_admin() IS FALSE, 'no profile row must be false, not NULL';
  PERFORM set_config('test.viewer','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
  ASSERT public.fn_is_platform_admin() IS FALSE, 'NULL role must be false';
  PERFORM set_config('test.viewer','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
  ASSERT public.fn_is_platform_admin() IS FALSE, 'ordinary user';
  PERFORM set_config('test.viewer','dddddddd-dddd-dddd-dddd-dddddddddddd',false);
  ASSERT public.fn_is_platform_admin() IS TRUE, 'admin';
  PERFORM set_config('test.viewer','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',false);
  ASSERT public.fn_is_platform_admin() IS TRUE, 'superadmin';
  PERFORM set_config('test.viewer','ffffffff-ffff-ffff-ffff-ffffffffffff',false);
  ASSERT public.fn_is_platform_admin() IS TRUE, 'god';
  ASSERT pg_temp.gate_for(NULL) = 'refused';
  ASSERT pg_temp.gate_for('99999999-9999-9999-9999-999999999999') = 'refused', 'no-profile caller let through a NOT gate';
  ASSERT pg_temp.gate_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 'refused', 'NULL-role caller let through a NOT gate';
  ASSERT pg_temp.gate_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 'refused';
  ASSERT pg_temp.gate_for('dddddddd-dddd-dddd-dddd-dddddddddddd') = 'served', 'staff still served';
  ASSERT has_function_privilege('authenticated','public.fn_is_platform_admin()','EXECUTE'), 'grant kept';
  ASSERT has_function_privilege('service_role','public.fn_is_platform_admin()','EXECUTE'), 'grant kept';
  ASSERT NOT has_function_privilege('anon','public.fn_is_platform_admin()','EXECUTE'), 'no new grant';
END $$;
SELECT 'PLATFORM_ADMIN_CHECK_OK';
