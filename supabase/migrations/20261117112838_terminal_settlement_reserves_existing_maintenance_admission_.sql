-- Terminal settlements share the existing bounded maintenance reservation.
-- Ordinary hands retain only global lane 1; independent terminal scopes remain concurrent.
-- @live-proof: EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure AND md5(pg_get_functiondef(p.oid))='fc2dd75d5e2c2c7bb9ebbda2dc9d7794' AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND p.proconfig=ARRAY['search_path=public, pg_temp','lock_timeout=8s','statement_timeout=45s']::text[])
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $terminal_reservation$
DECLARE p record; body text; needle text:='  PERFORM pg_catalog.pg_advisory_xact_lock_shared(530090,1);';
BEGIN
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure;
 IF md5(pg_get_functiondef(p.oid))<>'3628dcabd106aeb79bdefc748d65d11e'
 OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
 OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp','lock_timeout=8s','statement_timeout=45s']::text[] THEN
  RAISE EXCEPTION 'TERMINAL_RESERVATION_ORIGINAL_OWNER_CHANGED'; END IF;
 body:=pg_get_functiondef(p.oid);
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'TERMINAL_RESERVATION_ORIGINAL_BOUNDARY_CHANGED'; END IF;
 body:=replace(body,needle,E'  -- The existing maintenance writer reserves lane 2 exclusively before lane 1.\n  -- Decline behind that reservation; never queue ordinary hand continuations.\n  IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(530090,2) THEN\n    RAISE EXCEPTION ''TERMINAL_MAINTENANCE_RESERVATION_BUSY'' USING ERRCODE=''55P03'';\n  END IF;\n'||needle);
 EXECUTE body;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure;
 IF md5(pg_get_functiondef(p.oid))<>'fc2dd75d5e2c2c7bb9ebbda2dc9d7794'
 OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
 OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp','lock_timeout=8s','statement_timeout=45s']::text[] THEN
  RAISE EXCEPTION 'TERMINAL_RESERVATION_POSTIMAGE_CHANGED'; END IF;
END $terminal_reservation$;
COMMIT;
