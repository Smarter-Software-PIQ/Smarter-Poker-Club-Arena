// Captured deployment grants over the genuine pinned pg_cron1.6.4 heap tables.
// The caller owns the existing private bootstrap transaction and its rollback.
const context = `current_database()='club_arena_qualification'
  AND inet_server_addr() IS NULL AND current_user='supabase_admin' AND session_user='supabase_admin'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND current_setting('search_path')='pg_catalog'
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='postgres' AND NOT rolsuper)
  AND current_setting('cron.database_name')=current_database()
  AND current_setting('cron.launch_active_jobs')='off'
  AND current_setting('cron.enable_superuser_jobs')='off'
  AND EXISTS(SELECT FROM pg_catalog.pg_extension e WHERE e.extname='pg_cron'
    AND e.extversion='1.6.4' AND e.extowner=10 AND e.extnamespace='pg_catalog'::regnamespace)
  AND EXISTS(SELECT FROM pg_catalog.pg_namespace WHERE nspname='cron' AND nspowner=10)`;
const tables = `SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='cron' AND c.relkind IN('r','p')`;
const nativeShape = `SELECT jsonb_agg(jsonb_build_object(
'name',c.relname,'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'am',am.amname,'replica',c.relreplident,'options',c.reloptions,
'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))ORDER BY a.attnum)FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
'policies',(SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,ARRAY(SELECT r.rolname FROM unnest(p.polroles)roleid LEFT JOIN pg_roles r ON r.oid=roleid ORDER BY r.rolname),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))ORDER BY p.polname)FROM pg_policy p WHERE p.polrelid=c.oid),
'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid)ORDER BY i.indexrelid::regclass::text)FROM pg_index i WHERE i.indrelid=c.oid),
'constraints',(SELECT jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid))ORDER BY k.conname)FROM pg_constraint k WHERE k.conrelid=c.oid),
 'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid)ORDER BY t.tgname)FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))ORDER BY c.relname)::text AS shape
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_am am ON am.oid=c.relam WHERE n.nspname='cron' AND c.relkind IN('r','p')`;
const shapeExact = `(SELECT md5(shape)='6a168b85b1815f3ba46fbb30212f7ef4' FROM (${nativeShape}) s)`;
const initialJob = '{supabase_admin=arwdDxtm/supabase_admin,=r/supabase_admin}';
const initialRuns = '{supabase_admin=arwdDxtm/supabase_admin,=rd/supabase_admin}';
const capturedJob =
  '{supabase_admin=arwdDxtm/supabase_admin,=r/supabase_admin,postgres=r*/supabase_admin}';
const capturedRuns =
  '{supabase_admin=arwdDxtm/supabase_admin,=rd/supabase_admin,postgres=a*r*w*d*D*x*t*m*/supabase_admin}';
const initialExact = `(SELECT count(*)=2 AND bool_and((i.objsubid=0 AND i.privtype='e'
  AND i.initprivs::text=CASE WHEN c.relname='job' THEN '${initialJob}' ELSE '${initialRuns}' END
  AND EXISTS(SELECT FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
    WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.objsubid=0
      AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e' AND e.extname='pg_cron')) IS TRUE)
  FROM (${tables}) c JOIN pg_catalog.pg_init_privs i
    ON i.classoid='pg_catalog.pg_class'::regclass AND i.objoid=c.oid)`;
const aclExact = (configured) => `(SELECT count(*)=2 AND bool_and((c.relowner=10
  AND c.relrowsecurity AND NOT c.relforcerowsecurity AND c.relacl::text=CASE c.relname
    WHEN 'job' THEN '${configured ? capturedJob : initialJob}'
    WHEN 'job_run_details' THEN '${configured ? capturedRuns : initialRuns}' END) IS TRUE)
  FROM (${tables}) c)`;
const metadata = `(SELECT jsonb_build_object(
  'classes',(SELECT jsonb_agg(to_jsonb(c)-'relacl' ORDER BY c.oid) FROM (${tables}) c),
  'attributes',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_catalog.pg_attribute a
    WHERE a.attrelid IN(SELECT oid FROM (${tables}) c)),
  'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_catalog.pg_attrdef d
    WHERE d.adrelid IN(SELECT oid FROM (${tables}) c)),
  'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid IN(SELECT oid FROM (${tables}) c)),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_policy p
    WHERE p.polrelid IN(SELECT oid FROM (${tables}) c)),
  'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_catalog.pg_index i
    WHERE i.indrelid IN(SELECT oid FROM (${tables}) c)),
  'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid IN(SELECT oid FROM (${tables}) c)),
  'initial',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.objoid,i.objsubid) FROM pg_catalog.pg_init_privs i
    WHERE i.classoid='pg_catalog.pg_class'::regclass AND i.objoid IN(SELECT oid FROM (${tables}) c)),
  'members',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.classid,d.objid,d.objsubid) FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid WHERE d.refclassid='pg_catalog.pg_extension'::regclass
      AND d.deptype='e' AND e.extname='pg_cron'),
  'defaultAcl',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_catalog.pg_default_acl d),
  'extensions',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.oid) FROM pg_catalog.pg_extension e)))`;
export const cronCapturedTableAclObservationSql = `SELECT (${context}) AND ${shapeExact}
  AND ${initialExact} AND ${aclExact(true)} AS cron_captured_table_acl_exact`;
export const cronCapturedTableAclInstallSql = `DO $cron_captured_tables$
DECLARE original_metadata jsonb;
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_CRON_TABLE_ACL_CONTEXT_REQUIRED'; END IF;
  LOCK TABLE cron.job, cron.job_run_details IN ACCESS EXCLUSIVE MODE;
  IF ${shapeExact} IS DISTINCT FROM TRUE OR ${initialExact} IS DISTINCT FROM TRUE
    OR ${aclExact(false)} IS DISTINCT FROM TRUE
    OR EXISTS(SELECT 1 FROM cron.job) OR EXISTS(SELECT 1 FROM cron.job_run_details)
  THEN RAISE EXCEPTION 'FIXTURE_CRON_TABLE_ACL_PREIMAGE_REQUIRED'; END IF;
  original_metadata := ${metadata};
  GRANT SELECT ON TABLE cron.job TO postgres WITH GRANT OPTION;
  GRANT ALL ON TABLE cron.job_run_details TO postgres WITH GRANT OPTION;
  IF (${context}) IS DISTINCT FROM TRUE OR ${shapeExact} IS DISTINCT FROM TRUE
    OR ${initialExact} IS DISTINCT FROM TRUE OR ${aclExact(true)} IS DISTINCT FROM TRUE
    OR ${metadata} IS DISTINCT FROM original_metadata
  THEN RAISE EXCEPTION 'FIXTURE_CRON_TABLE_ACL_POSTIMAGE_REQUIRED'; END IF;
END $cron_captured_tables$;`;
