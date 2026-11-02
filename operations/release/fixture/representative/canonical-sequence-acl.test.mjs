import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {schemaCataloguePayload} from '../../native/component-semantic-observations.mjs';

test('canonical catalogue selects PostgreSQL sequence default privileges for NULL relacl',async()=>{
  // Query-contract regression only. Actual PG17 results are required by the
  // mandatory native-smoke rollback probe below; this does not fabricate them.
  const queries=[];
  const payload=await schemaCataloguePayload({query:async sql=>{
    queries.push(sql);
    return sql.includes('AS catalogue') ? {rows:[{catalogue:'{}'}]} : {rows:[]};
  }});
  assert.equal(payload.catalogue_text,'{}');
  const sql=queries.find(sql=>sql.includes('AS catalogue'));
  assert.ok(sql.includes("acldefault(CASE WHEN c.relkind='S' THEN 's'::\"char\" ELSE 'r'::\"char\" END,c.relowner)"));
  assert.ok(!sql.includes("THEN 'S'::\"char\""));
  assert.ok(queries.includes('SET LOCAL search_path = pg_catalog'));
});

test('mandatory native smoke exercises genuine NULL sequence ACL with literal owner privileges and rollback absence',async()=>{
  const source=await readFile(new URL('../native-smoke.mjs',import.meta.url),'utf8');
  const start=source.indexOf('// CANONICAL_SEQUENCE_ACL_PROBE_BEGIN');
  const end=source.indexOf('// CANONICAL_SEQUENCE_ACL_PROBE_END');
  assert.ok(start>0 && end>start);
  const block=source.slice(start,end);
  for(const text of ["current_user='postgres' AND session_user='postgres'",'NOT (SELECT rolsuper',
    "to_regnamespace('fixture_canonical_sequence_acl_probe') IS NULL",'defaclnamespace=0',
    "await db.query('BEGIN')",'CREATE SEQUENCE fixture_canonical_sequence_acl_probe.owner_sequence',
    'relacl IS NULL','await schemaCataloguePayload(db)',"row[0]==='relation:S'",
    "['postgres','postgres','SELECT',false]","['postgres','postgres','UPDATE',false]",
    "['postgres','postgres','USAGE',false]","aclexplode(acldefault('s',current_user::regrole))",
    "try { await db.query('ROLLBACK'); } catch (error) { sequenceProbeFailure ??= error; }",
    'if (sequenceProbeFailure) throw sequenceProbeFailure;','[{probe_absent:true}]'])
    assert.ok(block.includes(text),text);
  assert.ok(!/COMMIT|ALTER ROLE|SET ROLE|UPDATE pg_|INSERT INTO pg_/.test(block));
  assert.ok(source.indexOf('const catalogueDigest = await schemaCatalogue(db);')>end);
  const workflow=await readFile(new URL('../../../../.github/workflows/component-fixture-native-smoke.yml',import.meta.url),'utf8');
  assert.ok(workflow.includes('node --test operations/release/fixture/representative/*.test.mjs'));
});


test('complete catalogue ACCESS ordering has an explicit locale-independent byte order',async()=>{
  // Query contract only: the separate genuine PG17 C/ICU databases establish
  // native behavior. Neither a fabricated catalogue nor this capture is a pass.
  const queries=[];
  await schemaCataloguePayload({query:async sql=>{
    queries.push(sql);
    return sql.includes('AS catalogue') ? {rows:[{catalogue:'{}'}]} : {rows:[]};
  }});
  const sql=queries.find(sql=>sql.includes('AS catalogue'));
  assert.ok(sql.includes('ORDER BY kind COLLATE "C",schema_name COLLATE "C",object_name COLLATE "C"'));
  assert.ok(!sql.includes('ORDER BY kind,schema_name,object_name'));
  assert.ok(sql.includes('jsonb_build_array(kind,schema_name,object_name,owner_name,grants)'));
  assert.ok(sql.includes('FROM aclexplode('));
  assert.ok(!/DISTINCT ON|LIMIT |OFFSET /.test(sql));
  assert.ok(queries.includes('SET LOCAL search_path = pg_catalog'));
});
