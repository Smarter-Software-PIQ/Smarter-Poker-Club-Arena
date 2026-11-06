-- Readiness recognizes only the exact owner-authorized November 1 rebuy input.
-- Law 10.5 permits the horse's input device; common gameplay remains identical.
-- The existing blanket scan rejected that installed, qualified input function.
-- Preserve the broad scan for every other function and all changed definitions.
-- No rebuy, wallet, seat, gameplay, configuration or readiness verdict is forced.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_lightning_rollout_readiness(uuid)'::regprocedure))='d2e611fa3e858c45213a40c80829626c')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $repair$
DECLARE
  v_oid oid := 'public.fn_lightning_rollout_readiness(uuid)'::regprocedure;
  v_before text;
  v_after text;
  v_catalog record;
  v_old text := $old$AND regexp_replace(pg_get_functiondef(p.oid), v_strip, '', 'g') ~ v_horse);$old$;
  v_new text := $new$AND regexp_replace(pg_get_functiondef(p.oid), v_strip, '', 'g') ~ v_horse
                          AND NOT (p.oid = to_regprocedure('public.fn_lightning_auto_rebuy(uuid,uuid,timestamp with time zone)')
                            AND md5(pg_get_functiondef(p.oid)) = 'b3f9e246f51c90f4ead065cae3c51c3c'
                            AND pg_get_userbyid(p.proowner) = 'postgres'
                            AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                            AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
                                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')));$new$;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_before;
  SELECT proowner,proacl,proconfig,prosecdef,provolatile INTO v_catalog FROM pg_proc WHERE oid=v_oid;
  IF md5(v_before) <> '5ec4a89512b6f8b3b1315c55f7f56ce4'
     OR pg_get_userbyid(v_catalog.proowner) <> 'postgres'
     OR NOT v_catalog.prosecdef OR v_catalog.provolatile <> 's'
     OR v_catalog.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'Lightning readiness rebuy boundary predecessor mismatch';
  END IF;
  IF (length(v_before)-length(replace(v_before,v_old,'')))/length(v_old) <> 1 THEN
    RAISE EXCEPTION 'Lightning readiness law predicate occurrence mismatch';
  END IF;
  v_after := replace(v_before,v_old,v_new);
  EXECUTE v_after;
  IF md5(pg_get_functiondef(v_oid)) <> 'd2e611fa3e858c45213a40c80829626c'
     OR replace(pg_get_functiondef(v_oid),v_new,v_old) <> v_before
     OR EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_oid AND
       (proowner IS DISTINCT FROM v_catalog.proowner OR proacl IS DISTINCT FROM v_catalog.proacl
        OR proconfig IS DISTINCT FROM v_catalog.proconfig OR prosecdef IS DISTINCT FROM v_catalog.prosecdef
        OR provolatile IS DISTINCT FROM v_catalog.provolatile)) THEN
    RAISE EXCEPTION 'Lightning readiness rebuy boundary changed unrelated source or authority';
  END IF;
END $repair$;
COMMIT;
