import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {APPLICATION_POLICY_WITNESSES,applicationPolicyWitness} from '../schema-application-policies.mjs';
import {composeSchema,dumpObjects,schemaHash,schemaCompositionFailureSite,schemaCompositionManagedMissingWitness} from '../schema-compose.mjs';
const prefix='-- PostgreSQL database dump\n',footer='-- PostgreSQL database dump complete\n';
const auth=['email()','jwt()','role()','uid()'].map(name=>`-- Name: ${name}; Type: FUNCTION; Schema: auth; Owner: postgres\n--\n\nSELECT NULL::text;\n\n`).join('');
const cron=await readFile(new URL('./genuine-cron-schema.fixture.sql',import.meta.url),'utf8');
const managed=auth+cron;
const policies=APPLICATION_POLICY_WITNESSES.map(item=>item.block).join('');
const hashList=['afaa7516e20b12e085906a313a149f952f5ca434edf334b8085a4df5dc0ae6c6','408fc9eca4f9f4e266b63082ce426d80ea96deb548ed822b4c0b09c9d907fb95','a285eebd3319051b6f25700e34f88c75d4e5482461fa48351a7d9fc885762aea','d5b9e4e7dc96c177f01c8bbb5463e3e492c4f44347a2e6eb3de9e7065278d134','4f9d40fc8c155888065680f99ad94fe10ab4e4582a31f14db2df67c45d77960a','2a37dc8f2fc0b08a90d611a0d55ba2077aed850eda40678a409a49b0b5783453','9a86f1f974cbd32994c76316865e5c89b601e902815beb040c46fc34d2207816','7e0aa80acaa3f3835fd459da504498ef5388218820b0f9ccb40597347827dc89','45098a31fad407444ba94c5882461d6f675bd9d1e15a478f99d03c3939c695cc','0af394c30a6b17c4a2c8850fc02c09a534a96f99d5c96ac2cf55e667c616c435','ec11b60daf405025eab81cf4da5e554b87db230a0c6d7a0eda4636be06e813da'];

test('connected source receipt includes the exact imported application policy classifier',async()=>{
  const driver=await readFile(new URL('../../native/observe-connected-ui.py',import.meta.url),'utf8');
  const closure=driver.slice(driver.indexOf('    controls_closure = ['),driver.indexOf("    native.command(['git', '-C', str(repo), 'ls-files', '--error-unmatch', *controls_closure])"));
  assert.ok(closure.includes("'operations/release/fixture/schema-application-policies.mjs'"));
  assert.ok(driver.includes("provenance['controls_source_sha256'] = {name: native.file_digest(repo / name) for name in controls_closure}"));
});

test('eleven policy witnesses retain exact native declarations and protected CREATE/ALTER provenance',async()=>{
  assert.equal(APPLICATION_POLICY_WITNESSES.length,11);
  assert.deepEqual(APPLICATION_POLICY_WITNESSES.map(x=>x.block_sha256),hashList);
  assert.equal(APPLICATION_POLICY_WITNESSES.filter(x=>!x.permissive).length,1);
  assert.equal(APPLICATION_POLICY_WITNESSES.reduce((n,x)=>n+x.sources.length,0),13);
  assert.equal(schemaHash(dumpObjects(APPLICATION_POLICY_WITNESSES[0].block).objects[0].key),'6aeec6366575d01ceb993c12bdbcf88ba4672166696c1525f8a76ffb125b3b0e');
  for(const witness of APPLICATION_POLICY_WITNESSES){
    assert.equal(schemaHash(witness.block),witness.block_sha256);
    assert.ok(witness.block.includes(witness.definition+'\n'));
    assert.ok(Object.isFrozen(witness)&&Object.isFrozen(witness.sources)&&Object.isFrozen(witness.roles));
    for(const source of witness.sources){
      const bytes=await readFile(new URL('../../../../'+source.path,import.meta.url));
      assert.equal(schemaHash(bytes),source.sha256);
      const escaped=witness.policy_name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const pattern=new RegExp('\\b(?:CREATE|ALTER)\\s+POLICY\\s+(?:"'+escaped+'"|'+escaped+')(?=\\s)[\\s\\S]*?;','gi');
      const declarations=[...bytes.toString().matchAll(pattern)];assert.equal(declarations.length,1);
      assert.equal(schemaHash(declarations[0][0]),source.statement_sha256);
    }
  }
});

test('only exact source-bound application policy blocks are retained by composition',()=>{
  const result=composeSchema(prefix+managed+policies+footer,prefix+managed+footer);
  assert.equal(result.sql,prefix+policies+footer);
  assert.equal(result.manifest.application_policies.length,11);
  assert.equal(result.manifest.current_database_contract_ready,false);
  for(const item of dumpObjects(policies).objects)assert.equal(applicationPolicyWitness(item).block_sha256,item.sha256);
  let nativePolicy;try{composeSchema(prefix+managed+policies+footer,prefix+managed+policies+footer);}catch(error){nativePolicy=error;}
  assert.equal(schemaCompositionFailureSite(nativePolicy),'APPLICATION_POLICY_IN_NATIVE');
});

test('changed roles, mode, command, predicates, headers, unknown policies and appended DDL refuse exactly',()=>{
  for(const witness of APPLICATION_POLICY_WITNESSES){
    const variants=[
      witness.block.replace('"authenticated"','"service_role"'),
      witness.block.replace('Owner: supabase_realtime_admin','Owner: postgres'),
      witness.block.replace('CREATE POLICY','create policy'),
      witness.block.replace(';\n','; ALTER TABLE realtime.messages DISABLE ROW LEVEL SECURITY;\n'),
      witness.permissive?witness.block.replace(' FOR SELECT',' AS RESTRICTIVE FOR SELECT'):witness.block.replace(' AS RESTRICTIVE',''),
      witness.block.replace(' FOR SELECT',' FOR UPDATE').replace(' FOR INSERT',' FOR SELECT'),
      witness.block.includes(' USING (')?witness.block.replace(' USING (',' USING (false AND '):witness.block.replace(' WITH CHECK (',' WITH CHECK (true OR '),
      witness.block.replace(witness.definition, witness.command==='a'
        ? witness.definition.slice(0,witness.definition.indexOf(' WITH CHECK '))+' WITH CHECK (true);'
        : witness.definition.slice(0,witness.definition.indexOf(' USING '))+' USING (false);'),
    ];
    for(const block of variants){
      assert.notEqual(block,witness.block);
      assert.throws(()=>applicationPolicyWitness(dumpObjects(block).objects[0]),/SCHEMA_APPLICATION_POLICY_REFUSED/);
      assert.throws(()=>composeSchema(prefix+managed+block+footer,prefix+managed+footer),/SCHEMA_APPLICATION_POLICY_REFUSED/);
    }
  }
  const unknown=APPLICATION_POLICY_WITNESSES[0].block.replaceAll('authorized staff receive player history signals','unknown policy');
  assert.throws(()=>applicationPolicyWitness(dumpObjects(unknown).objects[0]),/SCHEMA_APPLICATION_POLICY_REFUSED/);
  const changed=APPLICATION_POLICY_WITNESSES[0].block+'SELECT 1;\n';
  assert.throws(()=>applicationPolicyWitness(dumpObjects(changed).objects[0]),/SCHEMA_APPLICATION_POLICY_REFUSED/);
});

test('policy classification does not mask an earlier managed-missing refusal or add policies to its count',()=>{
  const missing='-- Name: native_missing(); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin\n--\n\nSELECT 1;\n\n';
  const invalid=APPLICATION_POLICY_WITNESSES[0].block.replace('"authenticated"','"service_role"');
  let error;try{composeSchema(prefix+managed+missing+policies+invalid.replaceAll('authorized staff receive player history signals','different policy')+footer,prefix+managed+footer);}catch(e){error=e;}
  assert.equal(schemaCompositionFailureSite(error),'MANAGED_OBJECT_MISSING');
  assert.equal(schemaCompositionManagedMissingWitness(error).total,1);
  let earlyPolicy;try{composeSchema(prefix+managed+invalid+missing+footer,prefix+managed+footer);}catch(e){earlyPolicy=e;}
  assert.equal(schemaCompositionFailureSite(earlyPolicy),'APPLICATION_POLICY');
});
