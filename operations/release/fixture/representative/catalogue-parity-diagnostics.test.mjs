import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {assertPreflightParity} from '../../native/schema-preflight.mjs';
import {nativeFailureDiagnostic, recordCatalogueParityFailure} from '../runtime-files.mjs';
import { fileURLToPath } from 'node:url';
const stage = 'fixture-preflight-schema-preflight-catalogue-parity';
const keys = ['access','roles','memberships','functions','columns','policies','constraints','triggers','indexes','rls'];
const payload = rows => ({encoding:'postgres-jsonb-text-sha256/v1',catalogue_digest:rows.length ? 'b'.repeat(64) : 'a'.repeat(64),
  catalogue_text:JSON.stringify(Object.fromEntries(keys.map(key => [key,key === 'functions' ? rows : []])))});
const privateName = 'PRIVATE_CANARY_SQL_IDENTITY_AND_VALUE';
const template = {source_contract:{current_database_contract_ready:false,exclusions:['native-preflight-pending']}};
const roles = {scope:'password-free-role-catalogue',contains_passwords_or_user_rows:false};
function failure(overrides={}) {
  try { assertPreflightParity({expected:payload([]),observed:payload([['public',privateName,'',privateName]]),
    expectedRoles:roles,observedRoles:roles,template,...overrides}); }
  catch(error) { return error; }
  assert.fail('parity must refuse');
}
test('exact parity still refuses and only source-owned closed fingerprints escape',()=>{
  const error = failure();
  assert.equal(error.name,'AssertionError');
  const result = nativeFailureDiagnostic(stage,error);
  assert.equal(result.parity.gate,'catalogue-digest');
  assert.deepEqual(result.parity.sections,[[3,0,1,1]]);
  assert.equal(result.parity.samples.length,1);
  assert.deepEqual(result.parity.samples[0].slice(2),[2,[]]);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=2048);
  assert.ok(!JSON.stringify(result).includes(privateName));
  result.parity.samples[0][1]='tampered';
  assert.match(nativeFailureDiagnostic(stage,error).parity.samples[0][1],/^[a-f0-9]{64}$/);
  const fake=Object.assign(new Error(privateName),{name:'AssertionError',parity:{gate:privateName}});
  assert.deepEqual(nativeFailureDiagnostic(stage,fake),{status:'failed',stage,error:'AssertionError'});
  assert.equal(nativeFailureDiagnostic('other-stage',error).parity,undefined);
});
test('bounded samples, malformed and oversized private input fail closed without loss of original refusal',()=>{
  const many=Array.from({length:40},(_,i)=>['public',privateName+i,'',privateName]);
  const row=nativeFailureDiagnostic(stage,failure({observed:payload(many)}));
  assert.equal(row.parity.samples.length,8);
  assert.equal(row.parity.truncated,true);
  for(const catalogue_text of ['invalid json',JSON.stringify({functions:'wrong'}),'x'.repeat(33554433)]) {
    const row=nativeFailureDiagnostic(stage,failure({observed:{...payload(many),catalogue_text}}));
    assert.deepEqual(row.parity.samples,[]);
    assert.equal(row.parity.truncated,true);
    assert.ok(!JSON.stringify(row).includes(privateName));
  }
});
test('runtime-owned annotation crosses a separately instantiated controls module and actual server injects it',async()=>{
  const separate=await import(new URL('../runtime-files.mjs?separate-controls-copy',import.meta.url));
  const plain=new assert.AssertionError({message:privateName});
  separate.recordCatalogueParityFailure(plain,'catalogue-digest',{expected:payload([]),observed:payload([])});
  assert.equal(nativeFailureDiagnostic(stage,plain).parity,undefined);
  const error=failure({recordParityFailure:recordCatalogueParityFailure});
  assert.equal(nativeFailureDiagnostic(stage,error).parity.gate,'catalogue-digest');
  const server=await readFile(new URL('../fixture-server.mjs',import.meta.url),'utf8');
  assert.ok(server.includes('recordParityFailure: recordCatalogueParityFailure,'));
  const source=await readFile(new URL('../../native/schema-preflight.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('recordParityFailure(error, gate,'));
  assert.ok(source.includes('observedRoles, template, recordParityFailure });'));
});
test('independent Python decoder accepts only exact closed bounded records and rejects canary/tampered input',()=>{
  const good=nativeFailureDiagnostic(stage,failure());
  const change = fn => {const row=structuredClone(good);fn(row);return row;};
  const invalid=[
    change(row=>row.extra=privateName), change(row=>row.parity.gate=privateName),
    change(row=>row.parity.samples[0][1]=privateName), change(row=>row.parity.samples[0][3]=[32]),
    change(row=>row.parity.version=true), change(row=>row.parity.truncated='false'),
    change(row=>row.parity.sections[0][0]=10), change(row=>row.parity.samples.push(...Array(8).fill(row.parity.samples[0]))),
    change(row=>row.parity.extra=privateName), change(row=>row.error='Error'),
    change(row=>row.stage='fixture-preflight-application-schema'), change(row=>row.parity.samples[0][2]=true),
    change(row=>row.parity.sections[0][3]=100001), change(row=>row.parity.sections[0][3]=2),
  ];
  const code="import importlib.util,json,sys;spec=importlib.util.spec_from_file_location('smoke',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);rows=json.load(sys.stdin);assert len(m.native_failures(json.dumps(rows[0])))==1;assert all(m.native_failures(json.dumps(row))==[] for row in rows[1:]);assert m.native_failures(' '*2049+json.dumps(rows[0]))==[];print('closed decoder passed')";
  const result=spawnSync('python3',['-B','-c',code,fileURLToPath(new URL('../../ci/fixture-smoke.py',import.meta.url))],{input:JSON.stringify([good,...invalid]),encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/closed decoder passed/);
});
test('fixed field ordinals and order-only mismatch survive while diagnostic failures preserve original assertion',()=>{
  const rows=[['public','one','','before'],['public','two','','same']];
  const expected={...payload(rows),catalogue_digest:'a'.repeat(64)};
  const observed=payload([['public','one','','after'],rows[1]]);
  const changed=nativeFailureDiagnostic(stage,failure({expected,observed}));
  assert.deepEqual(changed.parity.samples[0].slice(2),[0,[3]]);
  const ordered=nativeFailureDiagnostic(stage,failure({expected,observed:payload([...rows].reverse())}));
  assert.deepEqual(ordered.parity.samples[0].slice(2),[3,[]]);
  const original=failure({recordParityFailure:()=>{throw new Error(privateName);}});
  assert.equal(original.name,'AssertionError');
  assert.notEqual(original.message,privateName);
  const completeRoles={version:1,scope:roles.scope,contains_passwords_or_user_rows:false,
    roles:[],memberships:[],role_settings:[],default_acl:[]};
  const roleChanged={...completeRoles,role_settings:[{role:'private-role',database:'OWNED_DATABASE',key:'statement_timeout',value:'5s',value_md5:'private-hash'}]};
  const result=nativeFailureDiagnostic(stage,failure({observed:payload([]),expectedRoles:completeRoles,observedRoles:roleChanged}));
  assert.equal(result.parity.gate,'role-catalogue');
  assert.deepEqual(result.parity.sections,[[12,0,1,1]]);
  assert.ok(!JSON.stringify(result).includes('private-role'));
});

// Capture27's four changed sections must all remain diagnosable within eight
// samples; this is a failure-channel regression, not native catalogue proof.
test('stratified eight-sample witness retains every changed section and exact 38/28/4/1 counts',()=>{
  const original=Object.fromEntries(keys.map(key=>[key,[]]));
  for(let i=0;i<38;i++) original.access.push(['relation:S','public',privateName+i,'owner',[]]);
  for(let i=0;i<28;i++) original.constraints.push(['public',privateName,i.toString(),'CHECK (true)',true]);
  for(let i=0;i<4;i++) original.triggers.push(['public',privateName,i.toString(),'CREATE TRIGGER before','O']);
  original.indexes.push({schemaname:'public',tablename:privateName,indexname:privateName,tablespace:null,indexdef:'CREATE INDEX before'});
  const actual=structuredClone(original);
  actual.access.forEach(row=>row[4].push(['owner','owner','SELECT',false]));
  actual.constraints.forEach(row=>row[3]='CHECK (false)');
  actual.triggers.forEach(row=>row[3]='CREATE TRIGGER after');
  actual.indexes[0].indexdef='CREATE INDEX after';
  const expected={encoding:payload([]).encoding,catalogue_digest:'a'.repeat(64),catalogue_text:JSON.stringify(original)};
  const observed={...expected,catalogue_digest:'b'.repeat(64),catalogue_text:JSON.stringify(actual)};
  const row=nativeFailureDiagnostic(stage,failure({expected,observed}));
  assert.deepEqual(row.parity.sections,[[0,38,38,38],[6,28,28,28],[7,4,4,4],[8,1,1,1]]);
  assert.deepEqual(row.parity.samples.map(sample=>sample[0]),[0,6,7,8,0,6,7,0]);
  assert.deepEqual(Object.fromEntries([0,6,7,8].map(section=>[section,row.parity.samples.filter(sample=>sample[0]===section).length])),{0:3,6:2,7:2,8:1});
  assert.equal(row.parity.samples.length,8);
  assert.equal(row.parity.truncated,true);
  assert.equal(row.parity.version,1);
  assert.ok(Buffer.byteLength(JSON.stringify(row))<=2048);
  assert.ok(!JSON.stringify(row).includes(privateName));
  for(const section of [0,6,7,8]) {
    const samples=row.parity.samples.filter(sample=>sample[0]===section);
    assert.deepEqual(samples.map(sample=>sample[1]),samples.map(sample=>sample[1]).sort());
    assert.ok(samples.every(sample=>sample[2]===0));
  }
  // The independent decoder must accept the same v1 protocol with no relaxation.
  const code="import importlib.util,json,sys;spec=importlib.util.spec_from_file_location('smoke',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);row=json.load(sys.stdin);out=m.native_failures(json.dumps(row));assert len(out)==1 and out[0]['parity']==row['parity'];print('stratified decoder passed')";
  const decoded=spawnSync('python3',['-B','-c',code,fileURLToPath(new URL('../../ci/fixture-smoke.py',import.meta.url))],{input:JSON.stringify(row),encoding:'utf8',timeout:10000});
  assert.equal(decoded.status,0,decoded.stderr);
});
