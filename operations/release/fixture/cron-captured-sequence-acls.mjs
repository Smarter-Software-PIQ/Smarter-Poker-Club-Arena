// Captured owner-only privileges over the two genuine pg_cron sequences.
// Extension context records the matching initial ACL, preserving pg_dump output.
// The caller owns the private bootstrap transaction and rollback.
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
const sequences = `SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='cron' AND c.relkind='S'`;
const nativeAcl = '{supabase_admin=rwU/supabase_admin,=r/supabase_admin}';
const capturedAcl = '{supabase_admin=rwU/supabase_admin}';
const helper = 'fixture_cron_sequence_acl_baseline';
const helperAbsent = `NOT EXISTS(SELECT FROM pg_catalog.pg_extension WHERE extname='${helper}')`;
const shapeExact = `(SELECT count(*)=2 AND bool_and((c.relname IN('jobid_seq','runid_seq')
  AND c.relowner=10 AND c.relpersistence='p' AND NOT c.relispartition AND c.reloptions IS NULL
  AND s.seqtypid='pg_catalog.int8'::regtype AND s.seqstart=1 AND s.seqincrement=1
  AND s.seqmin=1 AND s.seqmax=9223372036854775807 AND s.seqcache=1 AND NOT s.seqcycle
  AND EXISTS(SELECT FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
    WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.objsubid=0
      AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e' AND e.extname='pg_cron')) IS TRUE)
  FROM (${sequences}) c JOIN pg_catalog.pg_sequence s ON s.seqrelid=c.oid)`;
const aclExact = configured => `(SELECT count(*)=2 AND bool_and((c.relacl::text='${configured ? capturedAcl : nativeAcl}'
  AND i.objsubid=0 AND i.privtype='e' AND i.initprivs::text=c.relacl::text) IS TRUE)
  FROM (${sequences}) c JOIN pg_catalog.pg_init_privs i
    ON i.classoid='pg_catalog.pg_class'::regclass AND i.objoid=c.oid)`;
// All cron metadata and all creator defaults/extensions remain unchanged except
// the two exact current/initial ACLs asserted separately above.
const relations = `SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='cron'`;
const metadata = `(SELECT jsonb_build_object(
  'classes',(SELECT jsonb_agg((CASE WHEN c.relkind='S' THEN to_jsonb(c)-'relacl' ELSE to_jsonb(c) END)
    -'relpages'-'reltuples'-'relallvisible'-'relallfrozen'-'relfrozenxid'-'relminmxid' ORDER BY c.oid) FROM (${relations}) c),
  'sequences',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.seqrelid) FROM pg_catalog.pg_sequence s
    WHERE s.seqrelid IN(SELECT oid FROM (${sequences}) c)),
  'attributes',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_catalog.pg_attribute a
    WHERE a.attrelid IN(SELECT oid FROM (${relations}) c)),
  'defaults',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.oid) FROM pg_catalog.pg_attrdef a
    WHERE a.adrelid IN(SELECT oid FROM (${relations}) c)),
  'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid IN(SELECT oid FROM (${relations}) c)),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_policy p
    WHERE p.polrelid IN(SELECT oid FROM (${relations}) c)),
  'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_catalog.pg_index i
    WHERE i.indrelid IN(SELECT oid FROM (${relations}) c)),
  'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid IN(SELECT oid FROM (${relations}) c)),
  'initial',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.classoid,i.objoid,i.objsubid) FROM pg_catalog.pg_init_privs i
    WHERE NOT(i.classoid='pg_catalog.pg_class'::regclass AND i.objoid IN(SELECT oid FROM (${sequences}) c))),
  'sequenceDependencies',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype)
    FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid IN(SELECT oid FROM (${sequences}) c)),
  'members',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.classid,d.objid,d.objsubid) FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid WHERE d.refclassid='pg_catalog.pg_extension'::regclass
      AND d.deptype='e' AND e.extname='pg_cron'),
  'defaultAcl',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_catalog.pg_default_acl d),
  'extensions',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.oid) FROM pg_catalog.pg_extension e)))`;
export const cronCapturedSequenceAclObservationSql = `SELECT (${context}) AND ${shapeExact}
  AND ${aclExact(true)} AND (${helperAbsent}) AS cron_captured_sequence_acl_exact`;
export const cronCapturedSequenceAclInstallSql = `DO $cron_captured_sequences$
DECLARE original_metadata jsonb;
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_CRON_SEQUENCE_ACL_CONTEXT_REQUIRED'; END IF;
  IF ${shapeExact} IS DISTINCT FROM TRUE OR ${aclExact(false)} IS DISTINCT FROM TRUE
    OR (${helperAbsent}) IS DISTINCT FROM TRUE
    OR EXISTS(SELECT 1 FROM cron.job) OR EXISTS(SELECT 1 FROM cron.job_run_details)
    OR (SELECT count(*)=1 AND bool_and((version='1.0' AND superuser AND NOT trusted
      AND NOT relocatable AND schema='pg_catalog' AND requires IS NULL) IS TRUE)
      FROM pg_catalog.pg_available_extension_versions WHERE name='${helper}') IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_CRON_SEQUENCE_ACL_PREIMAGE_REQUIRED'; END IF;
  original_metadata := ${metadata};
  EXECUTE 'CREATE EXTENSION ${helper} WITH SCHEMA pg_catalog VERSION ''1.0''';
  IF (SELECT count(*)=1 AND bool_and((e.extowner=10 AND e.extversion='1.0'
    AND e.extnamespace='pg_catalog'::regnamespace AND NOT EXISTS(SELECT FROM pg_catalog.pg_depend d
      WHERE d.refclassid='pg_catalog.pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e')) IS TRUE)
    FROM pg_catalog.pg_extension e WHERE e.extname='${helper}') IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_CRON_SEQUENCE_ACL_EMPTY_HELPER_REQUIRED'; END IF;
  EXECUTE 'DROP EXTENSION ${helper} RESTRICT';
  IF (${context}) IS DISTINCT FROM TRUE OR ${shapeExact} IS DISTINCT FROM TRUE
    OR ${aclExact(true)} IS DISTINCT FROM TRUE OR (${helperAbsent}) IS DISTINCT FROM TRUE
    OR ${metadata} IS DISTINCT FROM original_metadata
  THEN RAISE EXCEPTION 'FIXTURE_CRON_SEQUENCE_ACL_POSTIMAGE_REQUIRED'; END IF;
END $cron_captured_sequences$;`;
