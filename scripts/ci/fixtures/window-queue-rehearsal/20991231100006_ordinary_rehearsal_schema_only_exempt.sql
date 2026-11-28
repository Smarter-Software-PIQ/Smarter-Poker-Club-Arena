-- @rehearsal-schema-only-exempt: fixture checks live production rows absent from a schema-only restore
BEGIN;
DO $probe$
BEGIN
  RAISE EXCEPTION 'live row fixture missing on empty schema-only restore';
END $probe$;
COMMIT;
