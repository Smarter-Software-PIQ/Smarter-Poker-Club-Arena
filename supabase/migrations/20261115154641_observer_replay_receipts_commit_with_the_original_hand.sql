-- Completed viewing is part of the original retained hand request and
-- commits atomically with its archive. No postcommit writer, outbox or repair.
-- The private inserter remains postgres-only, with identical award handling.
-- @live-proof: (position('_observed_hands' in pg_get_functiondef('public.fn_ca_insert_hand_with_awards(jsonb,jsonb)'::regprocedure)) > 0 AND NOT has_function_privilege('authenticated','public.fn_ca_insert_hand_with_awards(jsonb,jsonb)','EXECUTE') AND NOT has_function_privilege('service_role','public.fn_ca_insert_hand_with_awards(jsonb,jsonb)','EXECUTE'))
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $migration$
DECLARE original text; replacement text;
BEGIN
 SELECT pg_get_functiondef(oid) INTO original FROM pg_proc
   WHERE oid='public.fn_ca_insert_hand_with_awards(jsonb,jsonb)'::regprocedure
     AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres}';
 IF original IS NULL OR md5(original)<>'e7f05bb7d61360be7424c5f429066047' THEN
   RAISE EXCEPTION 'Original hand inserter authority changed';
 END IF;
 replacement := replace(original, '  RETURN v_id;', $receipt$  IF p_row ? '_observed_hands' THEN
    IF jsonb_typeof(p_row->'_observed_hands') IS DISTINCT FROM 'array' OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_row->'_observed_hands') r
      WHERE (r->>'hand_number')::bigint IS DISTINCT FROM (p_row->>'hand_number')::bigint
        OR r->>'viewer_id' IS NULL OR r->>'table_id' IS NULL
    ) THEN RAISE EXCEPTION 'Invalid completed observer receipt' USING ERRCODE='22023'; END IF;
    INSERT INTO public.ca_observed_hands(viewer_id,hand_id,table_id,hand_number)
      SELECT (r->>'viewer_id')::uuid,v_id,(r->>'table_id')::uuid,(r->>'hand_number')::bigint
      FROM jsonb_array_elements(p_row->'_observed_hands') r
      ON CONFLICT (viewer_id,table_id,hand_id) DO NOTHING;
  END IF;
  RETURN v_id;$receipt$);
 IF replacement=original THEN RAISE EXCEPTION 'Original hand return changed'; END IF;
 EXECUTE replacement;
END $migration$;
COMMIT;
