import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeDumpDiagnostic,safeNativeDumpDiagnostic,nativeDumpCapability,verifyNativeDumpBinary} from '../schema-native-dump-diagnostic.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {dumpSnapshot,databaseConfiguration,catalogueDefinitionCounts} from '../schema-snapshot.mjs';

test('definition count is derived only from already captured private metadata without publishing definitions',()=>{
  const proof=catalogueDefinitionCounts({catalogue_text:JSON.stringify({functions:[['private-function','private-definition']]})});
  assert.deepEqual(proof,{public_auth_functions:1});assert.ok(!JSON.stringify(proof).includes('private'));
  assert.equal(catalogueDefinitionCounts({catalogue_text:'private-secret'}),null);
  assert.equal(catalogueDefinitionCounts({catalogue_text:'{}'}),null);
});

const push=(parser,text,ms=1)=>parser.push(Buffer.from(text),ms);
test('native fixed records pair objects and queries and retain only closed aggregate facts',()=>{
  const parser=createNativeDumpDiagnostic();
  push(parser,'D1 1 O B FUNCTION 0\nD1 2 Q B FUNCTION 10\nD1 3 Q E FUNC');
  push(parser,'TION 1010\nD1 4 Q B FUNCTION 1100\nD1 5 Q E FUNCTION 3100\nD1 6 O E FUNCTION 3200\n',2);
  parser.finish();const proof=parser.snapshot(4);
  assert.equal(proof.pairs_complete,true);
  assert.equal(proof.version,2);assert.equal(proof.object_scope,'effective-selected-components');assert.equal(proof.query_scope,'actual-network-requests');
  for(const patch of [{object_scope:undefined},{query_scope:'cached-results'},{version:1}])
    assert.equal(safeNativeDumpDiagnostic({...proof,...patch}),null);
  const {object_scope,query_scope,...legacy}=proof;legacy.version=1;
  assert.deepEqual(safeNativeDumpDiagnostic(legacy),legacy);
  assert.deepEqual(proof.types.FUNCTION,{objects_started:1,objects_completed:1,object_elapsed_us:3200,
    queries_started:2,queries_completed:2,query_elapsed_us:3000,query_max_us:2000});
  assert.deepEqual(safeNativeDumpDiagnostic({...proof,private:'private-secret'}),proof);
  assert.equal(safeNativeDumpDiagnostic({...proof,types:{FUNCTION:{private:'secret'}}}),null);
  parser.clear();assert.throws(()=>parser.snapshot(4),/PROTOCOL_REFUSED/);
});

test('cancellation retains unpaired observation without inventing query or server completion',()=>{
  const parser=createNativeDumpDiagnostic();
  push(parser,'D1 1 O B FUNCTION 0\nD1 2 Q B FUNCTION 10\n',3);parser.finish();
  const proof=parser.snapshot(40);
  assert.equal(proof.pairs_complete,false);assert.equal(proof.types.FUNCTION.queries_completed,0);
  assert.deepEqual(proof.last_unpaired_query,{type:'FUNCTION',started_at_us:10,unpaired_since_received_ms:37});
});

test('native record grammar refuses private bytes, overlap, reordered events and unbounded streams',()=>{
  const cases=[
    'private-secret\n','D1 1 Q B FUNCTION 0\n','D1 1 O B private-secret 0\n',
    'D1 1 O B FUNCTION 0\nD1 1 O E FUNCTION 1\n',
    'D1 1 O B FUNCTION 10\nD1 2 O E FUNCTION 9\n',
    'D1 1 O B FUNCTION 0\nD1 2 O B OTHER 1\n',
    'D1 1 O B FUNCTION 0\nD1 2 Q B FUNCTION 1\nD1 3 Q B FUNCTION 2\n',
    'D1 1 O B FUNCTION 0\nD1 2 O E OTHER 1\n',
    'D1 1 O B FUNCTION 45000001\n','D1 0001 O B FUNCTION 0\n',
    'D1 1 O B FUNCTION 0\r\n','D1 1 O B FUNCTION 0\nD1 2 Q E FUNCTION 1\n',
  ];
  for(const text of cases){
    const parser=createNativeDumpDiagnostic();
    assert.throws(()=>push(parser,text),error=>{
      assert.equal(error.message,'ISOLATED_NATIVE_DUMP_PROTOCOL_REFUSED');
      assert.ok(!JSON.stringify(error).includes('private-secret'));return true;
    });parser.clear();
  }
  for(const bytes of [Buffer.alloc(512*1024+1),Buffer.alloc(97,65)]){
    const parser=createNativeDumpDiagnostic();
    assert.throws(()=>parser.push(bytes,0),error=>error.diagnosticKind==='FD3_LIMIT');
  }
  for(const text of ['', 'D1 1 O B FUNCTION 0']){
    const parser=createNativeDumpDiagnostic();push(parser,text);assert.throws(()=>parser.finish(),/PROTOCOL_REFUSED/);
  }
  assert.throws(()=>nativeDumpCapability({executable:'/private-secret'}),/BINARY_REFUSED/);
});

async function binaryFixture(run){
  assert.ok(process.env.TMPDIR?.startsWith('/Volumes/SmarterWork/') || process.env.RUNNER_TEMP);
  const root=await mkdtemp(path.join(process.env.RUNNER_TEMP ?? process.env.TMPDIR,'native-dump-source-test-'));
  const output=path.join(root,'isolated-schema-native'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const binary=Buffer.from('synthetic-only-qualified-binary'),library=Buffer.from('synthetic-only-libpq');
  try{
    await mkdir(path.join(output,'bin'),{recursive:true});await mkdir(path.join(output,'lib'));
    await writeFile(path.join(output,'bin/pg_dump'),binary,{mode:0o500});
    await writeFile(path.join(output,'lib/libpq.so.5'),library,{mode:0o500});
    const manifest={version:1,scope:'isolated-native-dump-diagnostic',source_version:'17.11',control_sha:'a'.repeat(40),run_id:'123',run_attempt:1,
      archive_sha256:'5367f6fb2ec97efe1eb2e0c7926bb33438e51b0bd3a9733b88498056a7dc9a7e',
      builder_sha256:hash(await readFile(new URL('../native-dump-diagnostic.py',import.meta.url))),
      helper_sha256:hash(await readFile(new URL('../native-dump-diagnostic.c',import.meta.url))),
      function_batch_helper_sha256:hash(await readFile(new URL('../native-dump-function-batch.c',import.meta.url))),
      function_batch_contract_sha256:hash(await readFile(new URL('../native-dump-function-batch-test.c',import.meta.url))),
      transport:'consecutive-stock-function-executions-v1',
      binary_sha256:hash(binary),libpq_sha256:hash(library),qualification:{passed:true,sql_bytes_equal:true,fd3_records_valid:true,cluster_absent:true,synthetic_routine_count:5507,function_batch_max:128,native_batch_result_faults_refused:true,filtered_zero_one_equal:true,diagnostic_object_scope:'effective-selected-components'}};
    const save=()=>writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest),{mode:0o600});await save();
    await run({root,output,manifest,save,env:{RUNNER_TEMP:root,GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'}});
  }finally{await rm(root,{recursive:true,force:true});}
}

test('only exact qualified owned native binary and source manifest creates an execution capability',async()=>binaryFixture(async({env,output,manifest,save})=>{
  const client=await verifyNativeDumpBinary(env);assert.equal(nativeDumpCapability(client).postgres_version,'17.11');
  for(const key of ['archive_sha256','builder_sha256','helper_sha256','function_batch_helper_sha256','function_batch_contract_sha256','binary_sha256','libpq_sha256','control_sha']){
    const old=manifest[key];manifest[key]='b'.repeat(old.length);await save();
    await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);manifest[key]=old;
  }
  for(const [key,bad] of [['synthetic_routine_count',5506],['function_batch_max',129],['native_batch_result_faults_refused',false],['filtered_zero_one_equal',false],['diagnostic_object_scope','all-visits']]){
    const old=manifest.qualification[key];manifest.qualification[key]=bad;await save();
    await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);manifest.qualification[key]=old;
  }
  const oldTransport=manifest.transport;manifest.transport='logging-only';await save();
  await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);manifest.transport=oldTransport;
  manifest.run_id='999';await save();await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);manifest.run_id='123';
  manifest.run_attempt=2;await save();await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);manifest.run_attempt=1;
  manifest.qualification.sql_bytes_equal=false;await save();await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);
  manifest.qualification.sql_bytes_equal=true;await save();
  await rm(path.join(output,'bin/pg_dump'));await symlink(path.join(output,'lib/libpq.so.5'),path.join(output,'bin/pg_dump'));
  await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);
}));

test('instrumented dump consumes private fd3, retains query costs and refuses malformed or incomplete success',async()=>binaryFixture(async({env})=>{
  const client=await verifyNativeDumpBinary(env);
  for(const mode of ['valid','malformed','unpaired']){
    let observed;
    const spawnProcess=(command,args,options)=>{
      observed={command,args,options};const child=new EventEmitter();
      child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdio=[null,child.stdout,child.stderr,new PassThrough()];
      child.kill=()=>{queueMicrotask(()=>child.emit('close',1,null));return true;};
      queueMicrotask(()=>{
        child.stdio[3].end(mode==='malformed'?'private-secret\n':
          'D1 1 O B FUNCTION 0\nD1 2 Q B FUNCTION 1\n'+(mode==='valid'?'D1 3 Q E FUNCTION 20\nD1 4 O E FUNCTION 21\n':''));
        child.stdout.end('-- PostgreSQL database dump\n');child.stderr.end();child.emit('close',mode==='valid'?1:0,null);
      });return child;
    };
    await assert.rejects(dumpSnapshot(databaseConfiguration('postgres://postgres:synthetic-only@db.kuklfnapbkmacvwxktbh.supabase.co:5432/postgres?sslmode=require'),
      '00000003-0000001B-1',{nativeClient:client,spawnProcess}),error=>{
      assert.equal(error.message,'ISOLATED_SCHEMA_DUMP_FAILED');
      if(mode==='valid')assert.equal(error.dumpDiagnostic.native_cost.types.FUNCTION.query_elapsed_us,19);
      else assert.equal(error.dumpDiagnostic.kind,'FD3_PROTOCOL');
      assert.ok(!JSON.stringify(error).includes('private-secret'));return true;
    });
    assert.equal(observed.command,client.executable);assert.equal(observed.options.env.LD_LIBRARY_PATH,client.library);
    assert.equal(observed.args.includes('--verbose'),false);assert.equal(observed.options.stdio[3],'pipe');
  }
}));

test('zero-frame failed startup retains its real TLS cause while zero-frame success refuses',async()=>binaryFixture(async({env})=>{
 const client=await verifyNativeDumpBinary(env);
 for(const code of [0,1]){
  const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdio=[null,child.stdout,child.stderr,new PassThrough()];child.kill=()=>true;
   queueMicrotask(()=>{child.stdio[3].end();child.stdout.end();child.stderr.end('pg_dump: SSL error: certificate verify failed at private-host\n');child.emit('close',code,null);});return child;};
  await assert.rejects(dumpSnapshot(databaseConfiguration('postgres://postgres:synthetic-only@db.kuklfnapbkmacvwxktbh.supabase.co:5432/postgres?sslmode=require'),'00000003-0000001B-1',{nativeClient:client,spawnProcess}),error=>{
   assert.equal(error.dumpDiagnostic.kind,code===0?'FD3_PROTOCOL':'TLS_VERIFICATION');assert.equal(error.dumpDiagnostic.native_cost.pairs_complete,false);assert.equal(error.dumpDiagnostic.native_cost.records,0);assert.ok(!JSON.stringify(error).includes('private-host'));return true;
  });
 }
}));
