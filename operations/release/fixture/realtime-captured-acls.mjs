// Captured deployment ACLs, not a genuine Realtime migration or upstream history claim.
// The caller owns the existing private bootstrap transaction and its rollback.
const ownerAcl = 'supabase_realtime_admin=arwdDxtm/supabase_realtime_admin';
const dashboardAcl = 'dashboard_user=arwdDxtm/supabase_realtime_admin';
const apiAcl = ['anon', 'authenticated', 'service_role'].map(
  (role) => `${role}=arw/supabase_realtime_admin`
);
const acl = (configured, parent) =>
  `{${[
    ownerAcl,
    `postgres=${configured ? 'a*r*wdDxtm' : 'arwdDxtm'}/supabase_realtime_admin`,
    dashboardAcl,
    ...(parent ? apiAcl : []),
  ].join(',')}}`;
const context = `current_database()='club_arena_qualification'
  AND inet_server_addr() IS NULL AND current_user='supabase_admin' AND session_user='supabase_admin'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND current_setting('search_path')='pg_catalog'
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
  AND to_regnamespace('_realtime') IS NULL`;
const relations = `SELECT c.* FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='realtime' AND c.relkind IN ('r','p')
    AND (c.relname='messages' OR c.relname LIKE 'messages\\_%' ESCAPE '\\' AND c.relispartition)`;
const history = `(SELECT count(*)=83 AND min(version)=20211116024918
  AND max(version)=20260827120000
  AND md5(string_agg(version::text,',' ORDER BY version))='262da2efb4aa494a7d90cf451fc9cce5'
  FROM realtime.schema_migrations)`;
const ledger = `EXISTS(SELECT FROM pg_catalog.pg_class c
  WHERE c.oid='realtime.schema_migrations'::regclass AND c.relkind='r'
    AND c.relowner=10 AND NOT c.relispartition)`;
const initialAbsent = `NOT EXISTS(SELECT FROM pg_catalog.pg_init_privs p
  WHERE p.classoid='pg_catalog.pg_class'::regclass
    AND p.objoid IN (SELECT oid FROM (${relations}) r))`;
const columns = `ARRAY['topic:text:-1:t','extension:text:-1:t','payload:jsonb:-1:f',
  'event:text:-1:f','private:bool:-1:f','updated_at:timestamp:-1:t',
  'inserted_at:timestamp:-1:t','id:uuid:-1:t','binary_payload:bytea:-1:f',
  'skip_broadcast:bool:-1:t']::text[]`;
const shape = `(SELECT count(*)=6 AND bool_and((c.relowner=
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='supabase_realtime_admin')
  AND NOT c.relforcerowsecurity AND c.relreplident='d' AND c.reloptions IS NULL
  AND (SELECT array_agg(a.attname||':'||t.typname||':'||a.atttypmod::text||':'||
      CASE WHEN a.attnotnull THEN 't' ELSE 'f' END ORDER BY a.attnum)
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)=${columns}
  AND CASE WHEN c.relname='messages' THEN c.relkind='p' AND NOT c.relispartition
      AND c.relrowsecurity AND c.relpartbound IS NULL
      AND pg_get_partkeydef(c.oid)='RANGE (inserted_at)'
      AND NOT EXISTS(SELECT FROM pg_catalog.pg_inherits WHERE inhrelid=c.oid)
    ELSE c.relkind='r' AND c.relispartition AND NOT c.relrowsecurity
      AND c.relname ~ '^messages_[0-9]{4}_[0-9]{2}_[0-9]{2}$'
      AND (SELECT count(*)=1 AND bool_and(inhparent='realtime.messages'::regclass)
        FROM pg_catalog.pg_inherits WHERE inhrelid=c.oid)
    END) IS TRUE) FROM (${relations}) c)`;
const consecutive = `(SELECT count(*)=5 AND max(day)-min(day)=4
  AND count(DISTINCT day)=5 AND bool_and((
    to_char(day,'YYYY_MM_DD')=substring(relname FROM 10)
    AND pg_get_expr(relpartbound,oid)=format(
      'FOR VALUES FROM (%L) TO (%L)',day::text||' 00:00:00',(day+1)::text||' 00:00:00')) IS TRUE)
  FROM (SELECT c.*,to_date(substring(c.relname FROM 10),'YYYY_MM_DD') AS day
    FROM (${relations}) c WHERE c.relispartition) p)`;
const aclExact = (configured) => `(SELECT count(*)=6 AND bool_and((c.relacl::text=
  CASE WHEN c.relname='messages' THEN '${acl(configured, true)}'
    ELSE '${acl(configured, false)}' END) IS TRUE) FROM (${relations}) c)`;
// This preserves complete relation/column/default/index/constraint/inheritance metadata,
// initial privileges and the exact ledger. Only these six table ACLs may change.
const metadata = `(SELECT jsonb_build_object(
  'relations',(SELECT jsonb_agg(to_jsonb(c)-'relacl' ORDER BY c.oid) FROM (${relations}) c),
  'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum)
    FROM pg_catalog.pg_attribute a WHERE a.attrelid IN (SELECT oid FROM (${relations}) c)),
  'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_catalog.pg_attrdef d
    WHERE d.adrelid IN (SELECT oid FROM (${relations}) c)),
  'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid IN (SELECT oid FROM (${relations}) c)),
  'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_catalog.pg_index i
    WHERE i.indrelid IN (SELECT oid FROM (${relations}) c)),
  'inherits',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.inhrelid,i.inhseqno)
    FROM pg_catalog.pg_inherits i WHERE i.inhrelid IN (SELECT oid FROM (${relations}) c)),
  'ledger',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.version) FROM realtime.schema_migrations m)))`;
export const realtimeCapturedAclObservationSql = `SELECT (${context}) AND ${ledger}
  AND ${history} AND ${shape} AND ${consecutive} AND ${initialAbsent}
  AND ${aclExact(true)} AS realtime_captured_acl_exact`;
export const realtimeCapturedAclInstallSql = `DO $realtime_captured_acl$
DECLARE item record; original_metadata jsonb;
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_REALTIME_ACL_CONTEXT_REQUIRED'; END IF;
  IF ${ledger} IS DISTINCT FROM TRUE OR ${history} IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_REALTIME_ACL_CONTEXT_REQUIRED'; END IF;
  LOCK TABLE realtime.messages IN ACCESS EXCLUSIVE MODE;
  IF ${shape} IS DISTINCT FROM TRUE OR ${consecutive} IS DISTINCT FROM TRUE
    OR ${initialAbsent} IS DISTINCT FROM TRUE OR ${aclExact(false)} IS DISTINCT FROM TRUE
    OR EXISTS(SELECT 1 FROM realtime.messages)
  THEN RAISE EXCEPTION 'FIXTURE_REALTIME_ACL_PREIMAGE_REQUIRED'; END IF;
  original_metadata := ${metadata};
  SET LOCAL ROLE supabase_realtime_admin;
  FOR item IN SELECT relname FROM (${relations}) c ORDER BY relname LOOP
    EXECUTE format('GRANT SELECT, INSERT ON TABLE realtime.%I TO postgres WITH GRANT OPTION',item.relname);
  END LOOP;
  RESET ROLE;
  IF (${context}) IS DISTINCT FROM TRUE OR ${history} IS DISTINCT FROM TRUE
    OR ${shape} IS DISTINCT FROM TRUE OR ${consecutive} IS DISTINCT FROM TRUE
    OR ${initialAbsent} IS DISTINCT FROM TRUE OR ${aclExact(true)} IS DISTINCT FROM TRUE
    OR ${metadata} IS DISTINCT FROM original_metadata
  THEN RAISE EXCEPTION 'FIXTURE_REALTIME_ACL_POSTIMAGE_REQUIRED'; END IF;
END $realtime_captured_acl$;`;
