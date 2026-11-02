import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {postgresExtensionCapturedAclInstallSql as install,postgresExtensionCapturedAclObservationSql as observe} from '../postgres-extension-captured-acls.mjs';
import {dumpObjects,schemaHash} from '../schema-compose.mjs';
const source=await readFile(new URL('../postgres-extension-captured-acls.mjs',import.meta.url),'utf8');
test('captured PostgreSQL extension ACLs bind all49 genuine definitions and exact native/captured privilege preimages',()=>{
 const values=source.split('const expected = `VALUES\n')[1].split('`;')[0];
 assert.equal(createHash('sha256').update(values).digest('hex'),'292a73060e4cc4b61b02601fd6342727b1d0ec0738701542f9c7078182ebf2b3');
 const rows=values.split('\n');assert.equal(rows.length,49);
 assert.equal(rows.filter(x=>x.startsWith("  ('pgcrypto',")).length,36);
 assert.equal(rows.filter(x=>x.startsWith("  ('uuid-ossp',")).length,10);
 assert.equal(rows.filter(x=>x.startsWith("  ('pg_stat_statements',")).length,3);
 for(const marker of ['md5(pg_get_functiondef(p.oid))=e.definition_md5','md5(p.prosrc)=e.body_md5','p.proconfig IS NULL','p.initial_acl IS NOT DISTINCT FROM e.initial_acl',"p.initial_count=1 AND p.privtype='e'",'p.proleakproof=e.leakproof','p.proparallel::text=e.parallel'])assert.ok(install.includes(marker)&&observe.includes(marker),marker);
 assert.match(install,/p\.proacl::text IS NOT DISTINCT FROM e\.before_acl/);
 assert.match(observe,/p\.proacl::text IS NOT DISTINCT FROM e\.after_acl/);
});
test('private Admin context and preimage precede only bounded ordinary grants, followed by strict postimage',()=>{
 for(const marker of ["current_database()='club_arena_qualification'",'inet_server_addr() IS NULL',"current_user='supabase_admin' AND session_user='supabase_admin'","current_setting('search_path')='pg_catalog'",'oid=10','BETWEEN 170000 AND 179999'])assert.ok(install.includes(marker)&&observe.includes(marker),marker);
 assert.ok(install.indexOf('FIXTURE_POSTGRES_EXTENSION_ACL_CONTEXT_REQUIRED')<install.indexOf('FIXTURE_POSTGRES_EXTENSION_ACL_PREIMAGE_REQUIRED'));
 assert.ok(install.indexOf('FIXTURE_POSTGRES_EXTENSION_ACL_PREIMAGE_REQUIRED')<install.indexOf('GRANT EXECUTE'));
 assert.ok(install.lastIndexOf('GRANT ALL')<install.indexOf('FIXTURE_POSTGRES_EXTENSION_ACL_POSTIMAGE_REQUIRED'));
 assert.equal((install.match(/GRANT EXECUTE ON FUNCTION/g)||[]).length,2);
 assert.equal((install.match(/GRANT ALL ON TABLE/g)||[]).length,2);
 assert.match(install,/TO postgres WITH GRANT OPTION/);assert.match(install,/TO dashboard_user/);
 assert.doesNotMatch(install,/ALTER DEFAULT PRIVILEGES|UPDATE pg_|INSERT INTO pg_|DELETE FROM pg_|CREATE EXTENSION|ALTER EXTENSION|DROP |REVOKE|COMMIT|BEGIN;/);
 assert.match(observe,/AS postgres_extension_captured_acls_exact$/);
 assert.match(install,/c\.initial_acl='\{postgres=arwdDxtm\/postgres,=r\/postgres\}'/);
 assert.match(observe,/c\.relacl::text='\{postgres=a\*r\*w\*d\*D\*x\*t\*m\*\/postgres,=r\/postgres,dashboard_user=arwdDxtm\/postgres\}'/);
});
const actualNativeMissingKeys=[
  {
    "native_name": "FUNCTION \"armor\"(\"bytea\")",
    "key_sha256": "ac78edeb625dc7db3bdbd027055bf4713dbd740380a23ad697f9535b24d54203"
  },
  {
    "native_name": "FUNCTION \"armor\"(\"bytea\", \"text\"[], \"text\"[])",
    "key_sha256": "6aac84a9b6ef1fdd1181b89d24709b03593f459e6bab418d2dd740823585e4b3"
  },
  {
    "native_name": "FUNCTION \"crypt\"(\"text\", \"text\")",
    "key_sha256": "56856a93a1f5c4ce65f5db437543353e3abbf81821f4eedef52a1bc7fc56cda3"
  },
  {
    "native_name": "FUNCTION \"dearmor\"(\"text\")",
    "key_sha256": "5a37cd8268c614faab082baf31bfd0bb888c525d7ba082ab339a9c227a5b6caa"
  },
  {
    "native_name": "FUNCTION \"decrypt\"(\"bytea\", \"bytea\", \"text\")",
    "key_sha256": "42ee83ac73b0f164f84c0a39b5126511952dfe14573000682012cc9bd14d1065"
  },
  {
    "native_name": "FUNCTION \"decrypt_iv\"(\"bytea\", \"bytea\", \"bytea\", \"text\")",
    "key_sha256": "e62aeb83a9283942d25240ca16848634aeff9990808ed226502ae40a1f6cc341"
  },
  {
    "native_name": "FUNCTION \"digest\"(\"bytea\", \"text\")",
    "key_sha256": "128ed4474232e8fa19e2da8426b87c552c96bfb9b3fadf2921b6f35583215cd3"
  },
  {
    "native_name": "FUNCTION \"digest\"(\"text\", \"text\")",
    "key_sha256": "5e54fab0fa9b3deeebaaa524d7ff17b62f31283708fbed97bd09119c0a70d91c"
  },
  {
    "native_name": "FUNCTION \"encrypt\"(\"bytea\", \"bytea\", \"text\")",
    "key_sha256": "aaa42ee8da22de6d8dff1c1141518014696d7e04f21267c5f7ee9bfe61890b3f"
  },
  {
    "native_name": "FUNCTION \"encrypt_iv\"(\"bytea\", \"bytea\", \"bytea\", \"text\")",
    "key_sha256": "601b5bd301889cdf190354649ef56eabdd8df3013a7d0cb4d38150655e13ae47"
  },
  {
    "native_name": "FUNCTION \"gen_random_bytes\"(integer)",
    "key_sha256": "8b20429c9222f9c533f0cc48cbb0d412e5d3e0534d670cd0a6e4e807f7bcd739"
  },
  {
    "native_name": "FUNCTION \"gen_random_uuid\"()",
    "key_sha256": "e1e0a652bdfc380b6874b46fced7fd3a85ee1e0178c2a3d37992bbf085346983"
  },
  {
    "native_name": "FUNCTION \"gen_salt\"(\"text\")",
    "key_sha256": "12d75afe02b00531304e6996161b24e285c2e9b45193a40db41e909399d55a9d"
  },
  {
    "native_name": "FUNCTION \"gen_salt\"(\"text\", integer)",
    "key_sha256": "e90b0010bcb53329b5b59780a86e84362a790641230eb902695f97c19a09e9aa"
  },
  {
    "native_name": "FUNCTION \"hmac\"(\"bytea\", \"bytea\", \"text\")",
    "key_sha256": "1a2dc2ea675963327144ebcda13e1e71c0f949fb00119821cf5e6c463134bb8c"
  }
];
test('actual native quoted identity maps every first15 capture21 extension ACL missing key',()=>{
 assert.equal(actualNativeMissingKeys.length,15);
 for(const item of actualNativeMissingKeys){
  const key=dumpObjects('-- Name: '+item.native_name+'; Type: ACL; Schema: extensions; Owner: postgres\n--\n\n').objects[0].key;
  assert.equal(schemaHash(key),item.key_sha256);
 }
});
