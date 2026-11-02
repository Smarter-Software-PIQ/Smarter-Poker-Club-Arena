// Captured object ACL configuration for genuine PostgreSQL17 extension members.
// No provider substitute or default-privilege change. Caller owns transaction.
const expected = `VALUES
  ('pg_stat_statements','pg_stat_statements','showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone','507a52a27907a48b0018326a15b3c595','efc777e0683dac6630ac957139c0b528','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pg_stat_statements','pg_stat_statements_info','OUT dealloc bigint, OUT stats_reset timestamp with time zone','1ab5e3c4a7d6213abb0022730b9931ce','94c99563b2a3ef63d7a5eb59e70814b3','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pg_stat_statements','pg_stat_statements_reset','userid oid, dbid oid, queryid bigint, minmax_only boolean','a3efe1fd4fbffb0c0f99da1ed283f7d8','faddd06e4d458f900aae2e136a037d43','v','s','{postgres=X/postgres}','{postgres=X*/postgres,dashboard_user=X/postgres}','{postgres=X/postgres}',false,true,false),
  ('pgcrypto','armor','bytea','8b26fd3b767373f628d8296b22c58569','a45f37224c831b79e0dfc3d8c6feb4e0','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','armor','bytea, text[], text[]','f8332991aecc898370b20b7d68b3f08c','a45f37224c831b79e0dfc3d8c6feb4e0','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','crypt','text, text','f92effa5862ce095a56289da31c7f2f2','ea9cb21d4668638c79f471dc607df1b4','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','dearmor','text','8e4be29a02a595ea10e204c070e18b75','698d71f03c675ff58762990312109ea6','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','decrypt','bytea, bytea, text','18e4fb227e3460385309c2c880ce6346','fa3fd67f1c168f498eab6165f27bdb1b','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','decrypt_iv','bytea, bytea, bytea, text','6378f3a8f61df6ae8edd0837fd8cb4d7','00048a7838901c86900226f25d8fd1ef','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','digest','bytea, text','85b88685f74a398b1ff164ad33eeaaca','926ba3fbdb45dc078b3e3cafddc392cc','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','digest','text, text','95de9cf8798b911a1fe38c27bdb570de','926ba3fbdb45dc078b3e3cafddc392cc','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','encrypt','bytea, bytea, text','bd196881d3cc43555e5b197d6050cc68','a865200e3e17395d9b3774d4e7a19832','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','encrypt_iv','bytea, bytea, bytea, text','524e5bac5ae4a00c5a3ec1d72b98798f','17a521e43efce20dd4703e9d243d4f4d','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','gen_random_bytes','integer','a7569a34c9be929beb24ef5670d42636','393a992bef3cadec88b224bd3dace51c','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','gen_random_uuid','','6504babb8130d35e393998bd2856ec61','b2825f0b165931d2f718b16cd4dc7cb1','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,false,false),
  ('pgcrypto','gen_salt','text','0ab5bda2fff1fa217935db57c0fe0738','83471500bcebc23b61302a74e64e0613','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','gen_salt','text, integer','60f792dd2967e22964c0ffcec9d34342','1ceb3513947cb5b72265001042040f51','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','hmac','bytea, bytea, text','791ceef3f202e631f7cc11017fbf00de','439ec46f1dc8e4c4b39837540788374e','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','hmac','text, text, text','361d12259351f9df05ddf92c6bfd4224','439ec46f1dc8e4c4b39837540788374e','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_armor_headers','text, OUT key text, OUT value text','a018f2bd7bcaae86efe1a9e7bd9a383b','3954d7fda83ff251e09f7301df4decfe','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_key_id','bytea','622562b45d5a075400d293c5a48c18e9','4b72a26a9f6422f60ea2f6d4f053e2be','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_decrypt','bytea, bytea','1d596379caf583a571a96539f01eb16b','dd08bd1c245bc68b737103263d12bf24','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_decrypt','bytea, bytea, text','85340917f0f739c0b8d6a6673e5012c3','dd08bd1c245bc68b737103263d12bf24','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_decrypt','bytea, bytea, text, text','fc84f59fd544cf2c70a3e65dbfdff1e7','dd08bd1c245bc68b737103263d12bf24','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_decrypt_bytea','bytea, bytea','9b91d112df744c646565d7e80ec151ea','7e9d4fce9c6b6c044e314c928d957e9d','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_decrypt_bytea','bytea, bytea, text','00666f7e5e717d5ef4c7035a7858b380','7e9d4fce9c6b6c044e314c928d957e9d','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_decrypt_bytea','bytea, bytea, text, text','07ee5afa371340ba85ae1d93e9dc8ad1','7e9d4fce9c6b6c044e314c928d957e9d','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_encrypt','text, bytea','ef3c54e0a325783028c30a31d604253d','7472cedacad809d059f35b3823e16d62','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_encrypt','text, bytea, text','bb91bfabebc1894a30d0f4fae6dccffe','7472cedacad809d059f35b3823e16d62','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_encrypt_bytea','bytea, bytea','5ef5954cdbe5741e2c1906898a6057c7','fb27931d690d0cbd38dfc1d2269d8167','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_pub_encrypt_bytea','bytea, bytea, text','3062cd7c3d17815975f8720cbeabf0b6','fb27931d690d0cbd38dfc1d2269d8167','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_sym_decrypt','bytea, text','bd9033545bf69e27880836cc8611fb46','00337fc8a344a450412a6e8501b90406','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_sym_decrypt','bytea, text, text','46b4eb4a8190cf3f5a7285f992ba7d87','00337fc8a344a450412a6e8501b90406','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_sym_decrypt_bytea','bytea, text','365cce063e993d3823812d7ed2eed4bd','ae33cd2d0dea9f8d3899631bdfcc3bcc','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_sym_decrypt_bytea','bytea, text, text','247ac244802a2c8c9db4747d2ae0f515','ae33cd2d0dea9f8d3899631bdfcc3bcc','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_sym_encrypt','text, text','89a109c79b6e5729b983220d745175c8','a911e6ce3232c550abbafb7ba5c13d70','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_sym_encrypt','text, text, text','51bcff8be418bd39d9a0e71cbaf6e42a','a911e6ce3232c550abbafb7ba5c13d70','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_sym_encrypt_bytea','bytea, text','43fc83685de8a47784c8891e0c7eaf40','f5f1ad766d41dae19429bb6d8a8bc093','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('pgcrypto','pgp_sym_encrypt_bytea','bytea, text, text','f7f923af916f7b9c973ff303af271329','f5f1ad766d41dae19429bb6d8a8bc093','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_generate_v1','','f2a7d7708f4ce5e8429ee5e57fa19842','21ed6db9a12cddb2b4389c47fb0b626b','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_generate_v1mc','','c404a846ca36b0d8f46d268dbc4be0c3','76430797001a6b05b94db0b23ce06c14','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_generate_v3','namespace uuid, name text','7992559096f41242be92bb50ac5fca6e','a9f592e3ddc55c988db12cf19466c845','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_generate_v4','','a3045e99488d2d755e53c33e5b0fb5d1','bf35f7759293b23de18e6ecfa57aaf98','v','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_generate_v5','namespace uuid, name text','eac48925db03b4f5baa93a49e4e5c994','652ae453dac795e196ce8300f1bad8f8','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_nil','','d5bf098ffa5f31313539aed0d5b80b18','4c1c0f60c981170458b623f250003a49','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_ns_dns','','b1fb4043e40048f831decdb42d7c7e91','446d755e248c9f38a23e5a728a387962','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_ns_oid','','59d0fa7c59e1f7aa25dd2d1c7cb70090','27b7b58039b58cc86c36e0841276e121','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_ns_url','','dffa53f4caafe3259e10923916be5802','983b2b683b5313c28b90893fb744e61b','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false),
  ('uuid-ossp','uuid_ns_x500','','c6106df49914220b7eba8704d9770c25','4097345620c46079cbdf0010d8fabb46','i','s',NULL,'{=X/postgres,postgres=X*/postgres,dashboard_user=X/postgres}',NULL,false,true,false)`;
const context = `current_database()='club_arena_qualification' AND inet_server_addr() IS NULL
 AND current_user='supabase_admin' AND session_user='supabase_admin'
 AND current_setting('search_path')='pg_catalog'
 AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
 AND EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
 AND EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper)
 AND EXISTS(SELECT FROM pg_roles WHERE rolname='dashboard_user' AND NOT rolsuper)
 AND NOT EXISTS(SELECT FROM pg_roles WHERE rolname='fixture_postgres_extension_owner')`;
const providers = `(SELECT count(*)=3 AND bool_and((extowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
 AND extnamespace='extensions'::regnamespace AND extversion=CASE extname
 WHEN 'pgcrypto' THEN '1.3' WHEN 'uuid-ossp' THEN '1.1' ELSE '1.11' END) IS TRUE)
 FROM pg_extension WHERE extname IN('pgcrypto','uuid-ossp','pg_stat_statements'))`;
const inventory = `SELECT p.*,e.extname,i.initprivs::text AS initial_acl,i.privtype,
 (SELECT count(*) FROM pg_init_privs j WHERE j.classoid='pg_proc'::regclass AND j.objoid=p.oid) AS initial_count
 FROM pg_proc p JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid
 AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
 JOIN pg_extension e ON e.oid=d.refobjid
 LEFT JOIN pg_init_privs i ON i.classoid='pg_proc'::regclass AND i.objoid=p.oid AND i.objsubid=0
 WHERE e.extname IN('pgcrypto','uuid-ossp','pg_stat_statements')`;
const functionExact = (post) => `(WITH expected(extname,name,args,definition_md5,body_md5,volatility,parallel,before_acl,after_acl,initial_acl,security_definer,strict,leakproof)
 AS (${expected}), actual AS (${inventory})
 SELECT (SELECT count(*)=49 FROM actual) AND count(*)=49 AND bool_and((
 p.pronamespace='extensions'::regnamespace AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
 AND p.prokind='f' AND p.prosecdef=e.security_definer AND p.proisstrict=e.strict
 AND p.proleakproof=e.leakproof AND p.provolatile::text=e.volatility AND p.proparallel::text=e.parallel
 AND p.proconfig IS NULL AND md5(pg_get_functiondef(p.oid))=e.definition_md5
 AND md5(p.prosrc)=e.body_md5 AND p.proacl::text IS NOT DISTINCT FROM e.${post?'after_acl':'before_acl'}
 AND p.initial_acl IS NOT DISTINCT FROM e.initial_acl
 AND CASE WHEN e.initial_acl IS NULL THEN p.initial_count=0 ELSE p.initial_count=1 AND p.privtype='e' END
 ) IS TRUE) FROM expected e JOIN actual p ON p.extname=e.extname AND p.proname=e.name
 AND pg_get_function_identity_arguments(p.oid)=e.args)`;
const views = `SELECT c.*,i.initprivs::text AS initial_acl,i.privtype,
 (SELECT count(*) FROM pg_init_privs j WHERE j.classoid='pg_class'::regclass AND j.objoid=c.oid) AS initial_count
 FROM pg_class c JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid
 AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
 JOIN pg_extension e ON e.oid=d.refobjid
 LEFT JOIN pg_init_privs i ON i.classoid='pg_class'::regclass AND i.objoid=c.oid AND i.objsubid=0
 WHERE e.extname IN('pgcrypto','uuid-ossp','pg_stat_statements') AND c.relkind='v'`;
const viewExact = (post) => `(SELECT count(*)=2 AND bool_and((
 c.relnamespace='extensions'::regnamespace AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
 AND c.relname IN('pg_stat_statements','pg_stat_statements_info') AND c.reloptions IS NULL
 AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
 AND md5(pg_get_viewdef(c.oid))=CASE c.relname WHEN 'pg_stat_statements' THEN 'ad1495ce5b4c54e4501e907a1f6aae8c' ELSE '1807985dc152d2828720e1272d549775' END
 AND c.relacl::text='${post?'{postgres=a*r*w*d*D*x*t*m*/postgres,=r/postgres,dashboard_user=arwdDxtm/postgres}':'{postgres=arwdDxtm/postgres,=r/postgres}'}'
 AND c.initial_acl='{postgres=arwdDxtm/postgres,=r/postgres}' AND c.initial_count=1 AND c.privtype='e'
 AND NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attacl IS NOT NULL)
 ) IS TRUE) FROM (${views}) c)`;
export const postgresExtensionCapturedAclObservationSql = `SELECT (${context}) AND ${providers}
 AND ${functionExact(true)} AND ${viewExact(true)} AS postgres_extension_captured_acls_exact`;
export const postgresExtensionCapturedAclInstallSql = `DO $postgres_extension_acl$
DECLARE item record;
BEGIN
 IF (${context}) IS DISTINCT FROM TRUE OR ${providers} IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'FIXTURE_POSTGRES_EXTENSION_ACL_CONTEXT_REQUIRED'; END IF;
 IF ${functionExact(false)} IS DISTINCT FROM TRUE OR ${viewExact(false)} IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'FIXTURE_POSTGRES_EXTENSION_ACL_PREIMAGE_REQUIRED'; END IF;
 FOR item IN SELECT p.oid,p.pronamespace,p.proname FROM (${inventory}) p ORDER BY p.oid LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres WITH GRANT OPTION',item.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO dashboard_user',item.oid::regprocedure);
 END LOOP;
 GRANT ALL ON TABLE extensions.pg_stat_statements,extensions.pg_stat_statements_info TO postgres WITH GRANT OPTION;
 GRANT ALL ON TABLE extensions.pg_stat_statements,extensions.pg_stat_statements_info TO dashboard_user;
 IF ${functionExact(true)} IS DISTINCT FROM TRUE OR ${viewExact(true)} IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'FIXTURE_POSTGRES_EXTENSION_ACL_POSTIMAGE_REQUIRED'; END IF;
END $postgres_extension_acl$;`;
