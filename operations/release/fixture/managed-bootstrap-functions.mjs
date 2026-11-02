import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Maintained public-source bootstrap + explicitly captured search_path/ACL configuration.
// Not an extension provider or migration-history substitute. The caller owns BEGIN,
// bounded timeouts, error-stop ROLLBACK and a fresh post-COMMIT observer.
const source = readFileSync(new URL('./managed-bootstrap-functions.sql', import.meta.url), 'utf8');
if (createHash('sha256').update(source).digest('hex') !==
    '1480e77893be0e39f25a4ce30a1066937a0331c3f109c98125b145ed47c30bd6')
  throw new Error('FIXTURE_MANAGED_BOOTSTRAP_SOURCE_MISMATCH');
const managedBootstrapFunctionTargets = Object.freeze([
  ['grant_pg_cron_access','53a44336da0ac1dd62d89dbd988e6d1d','3a3917aad6ddd66182bf45b7490c3029',true],
  ['grant_pg_graphql_access','4e6d7efe4aed1b3b92063b648aa7a0cf','dd3f3e2bb94cff45ef24b9cecb6af1c8',false],
  ['grant_pg_net_access','1d06ef4fb47bb0ab6e6f8818a62013bb','2ee4e6920eeba3068bcfa838105352e2',true],
  ['pgrst_ddl_watch','afaad7193dcf8f81e728d2bedb85e43e','7f27b8118fea5c88b0164331292859e3',false],
  ['pgrst_drop_watch','4357772baf5cfcd5c6d7049585b3a537','bc09cc3003d66f91844af4cb05e203b7',false],
  ['set_graphql_placeholder','8da9dff6b2ae47498209d341acaeb60b','a2bc2d00b2cc2f5e8d2d6b8d73e2c360',false],
].map((row) => Object.freeze(row)));
const values = managedBootstrapFunctionTargets.map(([name, definition, body, dashboard]) =>
  `('${name}','${definition}','${body}',${dashboard})`).join(',\n');
const names = managedBootstrapFunctionTargets.map(([name]) => `'${name}'`).join(',');
const rows = `SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
  ON n.oid=p.pronamespace WHERE n.nspname='extensions' AND p.proname IN (${names})`;
const context = `current_database()='club_arena_qualification'
  AND inet_server_addr() IS NULL AND current_user='supabase_admin' AND session_user='supabase_admin'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND current_setting('search_path')='pg_catalog' AND current_setting('quote_all_identifiers')='off'
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolcanlogin)
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='dashboard_user' AND NOT rolsuper AND NOT rolcanlogin)
  AND EXISTS(SELECT FROM pg_catalog.pg_language WHERE lanname='plpgsql' AND lanispl AND lanpltrusted)
  AND EXISTS(SELECT FROM pg_catalog.pg_namespace WHERE nspname='extensions'
    AND nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')
    AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(nspacl) a)=
      ARRAY['anon=U/postgres','authenticated=U/postgres','dashboard_user=UC/postgres',
        'postgres=UC/postgres','service_role=U/postgres']::text[])
  AND (SELECT count(*)=1 AND bool_and((defaclnamespace='extensions'::regnamespace
    AND defaclacl::text='{postgres=X*/supabase_admin}') IS TRUE)
    FROM pg_catalog.pg_default_acl WHERE defaclrole=10 AND defaclobjtype='f'
      AND defaclnamespace IN (0,'extensions'::regnamespace))`;
const exact = `(WITH expected(name,definition_md5,body_md5,dashboard) AS (VALUES ${values})
  SELECT count(*)=6 AND bool_and((p.pronargs=0 AND p.prokind='f' AND p.proowner=10
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    AND p.prorettype='pg_catalog.event_trigger'::regtype AND NOT p.proretset
    AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof
    AND p.provolatile='v' AND p.proparallel='u' AND p.procost=100 AND p.prorows=0
    AND p.proargtypes=''::oidvector AND p.proallargtypes IS NULL
    AND p.proargmodes IS NULL AND p.proargnames IS NULL AND p.proargdefaults IS NULL
    AND p.proconfig=ARRAY['search_path=""']::text[]
    AND md5(pg_get_functiondef(p.oid))=e.definition_md5 AND md5(p.prosrc)=e.body_md5
    AND p.proacl::text=CASE WHEN e.dashboard THEN
      '{=X/supabase_admin,supabase_admin=X*/supabase_admin,dashboard_user=X/supabase_admin}'
      ELSE '{=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X*/supabase_admin}' END
    AND NOT EXISTS(SELECT FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass
      AND d.objid=p.oid AND d.deptype='e')
    AND NOT EXISTS(SELECT FROM pg_catalog.pg_init_privs i WHERE i.classoid='pg_catalog.pg_proc'::regclass
      AND i.objoid=p.oid)) IS TRUE)
  FROM (${rows}) p JOIN expected e ON e.name=p.proname)`;
// Ordinary function CREATE/configuration must leave genuine extension inventory,
// namespaces, defaults and existing event-trigger attachments byte-exact.
const preserved = `(SELECT jsonb_build_object(
  'extensions',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.oid) FROM pg_catalog.pg_extension e),
  'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_catalog.pg_default_acl d),
  'namespaces',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_catalog.pg_namespace n),
  'event_triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_catalog.pg_event_trigger t)))`;
export const observationSql = `SELECT ((${context}) AND ${exact}) IS TRUE AS managed_bootstrap_functions_exact`;
export const installSql = `DO $managed_bootstrap_install$
DECLARE original_metadata jsonb;
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_MANAGED_BOOTSTRAP_CONTEXT_REQUIRED'; END IF;
  IF EXISTS(${rows})
  THEN RAISE EXCEPTION 'FIXTURE_MANAGED_BOOTSTRAP_ABSENCE_REQUIRED'; END IF;
  original_metadata := ${preserved};
${source}
  IF (${context}) IS DISTINCT FROM TRUE OR ${exact} IS DISTINCT FROM TRUE
    OR ${preserved} IS DISTINCT FROM original_metadata
  THEN RAISE EXCEPTION 'FIXTURE_MANAGED_BOOTSTRAP_POSTIMAGE_REQUIRED'; END IF;
END $managed_bootstrap_install$;`;
