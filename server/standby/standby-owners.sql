-- Same owner as production (postgres) for every application object, so
-- SECURITY DEFINER functions run as the identity production runs them as.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('public','ca_archive','discovery_private','operational_source_intake','ops','ops_rollback','smarter_private','zz_archive')
              AND c.relkind IN ('r','p','v','m','f','S')
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                AND d.objid = c.oid AND (d.deptype = 'e' OR
                  (c.relkind = 'S' AND d.refclassid = 'pg_class'::regclass
                    AND d.refobjsubid > 0 AND d.deptype IN ('a','i'))))
            -- ALTER TABLE transfers its serial/identity sequences automatically.
            -- Only standalone counters change here; excluded tables keep theirs.
            ORDER BY (c.relkind = 'S'), n.nspname, c.relname
  LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO postgres',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
      r.nspname, r.relname);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig, p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('public','ca_archive','discovery_private','operational_source_intake','ops','ops_rollback','smarter_private','zz_archive')
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO postgres', CASE r.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END, r.sig);
  END LOOP;
  FOR r IN SELECT nspname FROM pg_namespace
            WHERE nspname IN ('public','ca_archive','discovery_private','operational_source_intake','ops','ops_rollback','smarter_private','zz_archive')
  LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO postgres', r.nspname);
  END LOOP;
END $$;
