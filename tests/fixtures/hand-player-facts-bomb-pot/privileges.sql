-- Both readers keep SECURITY DEFINER, their pinned search_path and their
-- grants: service_role only, never anon or authenticated.
DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('ca_hand_player_facts_one', 'ca_hand_player_facts_range', 'ca_hand_player_facts')
  LOOP
    IF NOT r.prosecdef OR r.proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
      RAISE EXCEPTION '% lost SECURITY DEFINER or its search_path', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', r.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% execution grants changed', r.proname;
    END IF;
  END LOOP;
END
$priv$;
SELECT 'HAND_PLAYER_FACTS_PRIVILEGES_OK' AS result;
