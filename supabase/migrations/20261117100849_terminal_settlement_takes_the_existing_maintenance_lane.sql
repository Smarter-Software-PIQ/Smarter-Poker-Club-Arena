-- Original terminal settlement participates in the existing financial freeze lane.
-- Function-only: no hot relation DDL, new lock key, payment path or retry.
-- @live-proof: EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure AND md5(pg_get_functiondef(p.oid))='3628dcabd106aeb79bdefc748d65d11e' AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND p.proconfig=ARRAY['search_path=public, pg_temp','lock_timeout=8s','statement_timeout=45s']::text[])
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $terminal_maintenance$
DECLARE p record; body text; anchor text:=E'BEGIN\n  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id;';
BEGIN
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure;
 IF md5(pg_get_functiondef(p.oid))<>'7580ca286c239ffd8c051d70379b6603'
 OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
 OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp','lock_timeout=8s','statement_timeout=45s']::text[] THEN
  RAISE EXCEPTION 'TERMINAL_MAINTENANCE_ORIGINAL_OWNER_CHANGED'; END IF;
 body:=pg_get_functiondef(p.oid);
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'TERMINAL_MAINTENANCE_ORIGINAL_BOUNDARY_CHANGED'; END IF;
 body:=replace(body,anchor,E'BEGIN\n  -- Same shared financial admission used by original purchases. The original\n  -- maintenance writer takes this key exclusively before persisting freeze.\n  PERFORM pg_catalog.pg_advisory_xact_lock_shared(530090,1);\n  IF public.fn_platform_frozen() THEN\n    RAISE EXCEPTION ''PLATFORM_FROZEN: terminal settlement waits for maintenance to end'' USING ERRCODE=''55006'';\n  END IF;\n  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id;');
 EXECUTE body;
END $terminal_maintenance$;
COMMIT;
