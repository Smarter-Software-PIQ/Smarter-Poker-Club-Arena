import {spawnSync} from 'node:child_process';
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
test('first total-byte refusal retains bounded counters through safe sanitization',()=>{
  const parser=createNativeDumpDiagnostic(),prefix='D1 1 O B FUNCTION 0\n';
  push(parser,prefix);
  assert.throws(()=>parser.push(Buffer.alloc(512*1024),2),error=>error.diagnosticKind==='FD3_LIMIT');
  const proof=parser.snapshot(3);
  assert.equal(proof.bytes,Buffer.byteLength(prefix));
  assert.equal(proof.records,1);
  assert.deepEqual(proof.limit,{kind:'TOTAL_BYTES',observed_at_least:512*1024+1});
  assert.equal(proof.stream_closed,false);assert.equal(proof.pairs_complete,false);
  assert.deepEqual(safeNativeDumpDiagnostic(proof),proof);
  assert.throws(()=>push(parser,'x'.repeat(97),3),error=>error.diagnosticKind==='FD3_LIMIT');
  assert.deepEqual(parser.snapshot(3),proof);
  assert.throws(()=>parser.finish(),error=>error.diagnosticKind==='FD3_LIMIT');
  parser.clear();
});

test('first split line-byte refusal retains only a closed lower bound and never becomes complete',()=>{
  const parser=createNativeDumpDiagnostic();push(parser,'x'.repeat(96));
  assert.throws(()=>push(parser,'private-secret',2),error=>error.diagnosticKind==='FD3_LIMIT');
  const proof=parser.snapshot(3);
  assert.deepEqual(proof.limit,{kind:'LINE_BYTES',observed_at_least:97});
  assert.equal(proof.bytes,110);assert.equal(proof.records,0);
  assert.deepEqual(safeNativeDumpDiagnostic(proof),proof);
  assert.ok(!JSON.stringify(proof).includes('private-secret'));
  assert.throws(()=>parser.push(Buffer.alloc(512*1024+1),3),error=>error.diagnosticKind==='FD3_LIMIT');
  assert.deepEqual(parser.snapshot(3),proof);
  for(const limit of [{kind:'private-secret',observed_at_least:97},{kind:'LINE_BYTES',observed_at_least:98},
    {kind:'TOTAL_BYTES',observed_at_least:512*1024}])
    assert.equal(safeNativeDumpDiagnostic({...proof,limit}),null);
  for(const patch of [{stream_closed:true},{pairs_complete:true},{bytes:512*1024+1}])
    assert.equal(safeNativeDumpDiagnostic({...proof,...patch}),null);
  parser.clear();
});

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
      sequence_batch_helper_sha256:hash(await readFile(new URL('../native-dump-sequence-batch.c',import.meta.url))),
      function_batch_contract_sha256:hash(await readFile(new URL('../native-dump-function-batch-test.c',import.meta.url))),
      transport:'bounded-stock-function-sequence-metadata-v3',
      binary_sha256:hash(binary),libpq_sha256:hash(library),qualification:{passed:true,sql_bytes_equal:true,fd3_records_valid:true,cluster_absent:true,synthetic_routine_count:5513,function_batch_max:128,synthetic_sequence_count:138,sequence_metadata_sql_equal:true,metadata_interleaved_sql_equal:true,sequence_data_reader_unchanged:true,metadata_total_results_max:128,metadata_total_bytes_max:128*1024*1024,native_batch_result_faults_refused:true,dependency_interleaved_sql_equal:true,filtered_zero_one_equal:true,diagnostic_object_scope:'effective-selected-components'}};
    const save=()=>writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest),{mode:0o600});await save();
    await run({root,output,manifest,save,env:{RUNNER_TEMP:root,GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'}});
  }finally{await rm(root,{recursive:true,force:true});}
}

test('only exact qualified owned native binary and source manifest creates an execution capability',async()=>binaryFixture(async({env,output,manifest,save})=>{
  const client=await verifyNativeDumpBinary(env);assert.equal(nativeDumpCapability(client).postgres_version,'17.11');
  for(const key of ['archive_sha256','builder_sha256','helper_sha256','function_batch_helper_sha256','sequence_batch_helper_sha256','function_batch_contract_sha256','binary_sha256','libpq_sha256','control_sha']){
    const old=manifest[key];manifest[key]='b'.repeat(old.length);await save();
    await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);manifest[key]=old;
  }
  for(const [key,bad] of [['synthetic_routine_count',5512],['function_batch_max',129],['synthetic_sequence_count',137],['sequence_metadata_sql_equal',false],['metadata_interleaved_sql_equal',false],['sequence_data_reader_unchanged',false],['metadata_total_results_max',256],['metadata_total_bytes_max',256*1024*1024],['native_batch_result_faults_refused',false],['filtered_zero_one_equal',false],['dependency_interleaved_sql_equal',false],['diagnostic_object_scope','all-visits']]){
    const old=manifest.qualification[key];manifest.qualification[key]=bad;await save();
    await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);manifest.qualification[key]=old;
  }
  const oldTransport=manifest.transport;
  for(const transport of ['logging-only','consecutive-stock-function-executions-v1','bounded-stock-function-read-ahead-v2']){
    manifest.transport=transport;await save();await assert.rejects(verifyNativeDumpBinary(env),/BINARY_REFUSED/);
  }
  manifest.transport=oldTransport;
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

test('actual dump refusal preserves the first FD3 limit and cancellation facts without a success receipt',async()=>binaryFixture(async({env})=>{
  const client=await verifyNativeDumpBinary(env),prefix='D1 1 O B FUNCTION 0\n';
  const spawnProcess=()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.stdio=[null,child.stdout,child.stderr,new PassThrough()];
    child.kill=signal=>{assert.equal(signal,'SIGINT');queueMicrotask(()=>child.emit('close',1,null));return true;};
    queueMicrotask(()=>{child.stdio[3].write(prefix);child.stdio[3].write(Buffer.alloc(512*1024));
      child.stdio[3].end('later-private-secret');child.stdout.end();child.stderr.end();});
    return child;
  };
  await assert.rejects(dumpSnapshot(databaseConfiguration('postgres://postgres:synthetic-only@db.kuklfnapbkmacvwxktbh.supabase.co:5432/postgres?sslmode=require'),
    '00000003-0000001B-1',{nativeClient:client,spawnProcess}),error=>{
      assert.equal(error.message,'ISOLATED_SCHEMA_DUMP_FAILED');assert.equal(error.dumpDiagnostic.kind,'FD3_LIMIT');
      const proof=error.dumpDiagnostic.native_cost;assert.ok(proof);
      assert.equal(proof.bytes,Buffer.byteLength(prefix));assert.equal(proof.records,1);
      assert.deepEqual(proof.limit,{kind:'TOTAL_BYTES',observed_at_least:512*1024+1});
      assert.equal(proof.pairs_complete,false);assert.equal(proof.stream_closed,false);
      assert.equal(error.dumpDiagnostic.cancellation.sigint_os_accepted,true);
      assert.equal(error.dumpDiagnostic.cancellation.child_close_observed,true);
      assert.equal(error.dumpDiagnostic.cancellation.server_cancel_acknowledgement,'NOT_OBSERVED');
      assert.ok(!JSON.stringify(error).includes('private-secret'));return true;
    });
}));

// Exercise the real private build-command wrapper without a build or database.
test('native build refusal retains first closed command facts without raw compiler output',()=>{
  const script=`import importlib.util,sys,tempfile,json,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('native', 'operations/release/fixture/native-dump-diagnostic.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR') or os.environ['RUNNER_TEMP']) as folder:
 for kind,args,timeout in [('EXIT_NONZERO',[sys.executable,'-c',"import sys;print('private-secret');sys.exit(7)"],2),('DEADLINE',[sys.executable,'-c','import time;time.sleep(1)'],0.02)]:
  m.FIRST_COMMAND_FAILURE=None
  try:m.command(args,cwd=Path(folder),env=dict(os.environ),timeout=timeout)
  except Exception:pass
  else:raise AssertionError('failure expected')
  facts=m.FIRST_COMMAND_FAILURE
  assert facts['kind']==kind
  assert facts['exit_code']==(7 if kind=='EXIT_NONZERO' else None)
  assert 'private-secret' not in json.dumps(facts)
  try:m.command(['/nonexistent-private-command'],cwd=Path(folder),env=dict(os.environ))
  except Exception:pass
  assert m.FIRST_COMMAND_FAILURE==facts
print('closed command failure facts passed')`;
  for(const hosted of [false,true]){
    const env={...process.env,RUNNER_TEMP:process.env.TMPDIR ?? process.env.RUNNER_TEMP};
    assert.ok(env.RUNNER_TEMP);if(hosted)delete env.TMPDIR;
    const result=spawnSync('python3',['-B','-c',script],{encoding:'utf8',timeout:5000,env});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'closed command failure facts passed');
  }
});

function compactRecord(seq,kind,edge,type,us){
  const record=Buffer.alloc(12);record.write('D2');record.writeUInt32BE(seq,2);
  record[6]=(['FUNCTION','RELATION','TYPE','OTHER'].indexOf(type)<<2)|(kind==='Q'?2:0)|(edge==='E'?1:0);
  record.writeUInt32BE(us,7);record[11]=10;return record;
}
test('compact native wire preserves every legacy semantic fact across arbitrary chunk boundaries',()=>{
  const frames=[[1,'O','B','FUNCTION',0],[2,'Q','B','FUNCTION',10],[3,'Q','E','FUNCTION',1010],[4,'O','E','FUNCTION',1020]];
  const old=createNativeDumpDiagnostic();old.push(Buffer.from(frames.map(f=>`D1 ${f.join(' ')}\n`).join('')),1);old.finish();
  const bytes=Buffer.concat(frames.map(f=>compactRecord(...f)));
  for(const size of [1,2,3,7,12,13,48]){
    const parser=createNativeDumpDiagnostic();for(let i=0;i<bytes.length;i+=size)parser.push(bytes.subarray(i,i+size),1);
    parser.finish();const a=parser.snapshot(2),b=old.snapshot(2);assert.equal(a.bytes,48);delete a.bytes;delete b.bytes;
    assert.deepEqual(a,b);parser.clear();
  }
  old.clear();
});
test('compact wire fits forty thousand real typed edges inside unchanged512KiB cap and refuses malformed facts',()=>{
  const records=[];for(let i=0;i<20000;i++)records.push(compactRecord(i*2+1,'O','B','FUNCTION',i*2),compactRecord(i*2+2,'O','E','FUNCTION',i*2+1));
  const parser=createNativeDumpDiagnostic();parser.push(Buffer.concat(records),1);parser.finish();const proof=parser.snapshot(2);
  assert.equal(proof.bytes,480000);assert.equal(proof.records,40000);assert.equal(proof.types.FUNCTION.objects_completed,20000);assert.equal(proof.pairs_complete,true);parser.clear();
  for(const mutate of [b=>b[6]=16,b=>b[11]=0,b=>b.writeUInt32BE(0,2),b=>b.writeUInt32BE(45000001,7)]){
    const bad=compactRecord(1,'O','B','FUNCTION',0);mutate(bad);const p=createNativeDumpDiagnostic();assert.throws(()=>p.push(bad,1));p.clear();
  }
  for(const size of [1,2,11]){const p=createNativeDumpDiagnostic();p.push(compactRecord(1,'O','B','FUNCTION',0).subarray(0,size),1);assert.throws(()=>p.finish());p.clear();}
  const capped=createNativeDumpDiagnostic();assert.throws(()=>capped.push(Buffer.alloc(512*1024+1),1),e=>e.diagnosticKind==='FD3_LIMIT');capped.clear();
});

test('actual native C producer and both independent decoders agree on compact wire',async()=>{
  const root=await mkdtemp(path.join(process.env.TMPDIR ?? process.env.RUNNER_TEMP,'compact-native-wire-'));
  try{
    const source=path.join(root,'wire.c'),binary=path.join(root,'wire');
    const helper=new URL('../native-dump-diagnostic.c',import.meta.url).pathname;
    await writeFile(source,'#include <stdbool.h>\n#include <stdlib.h>\nstatic void pg_fatal(const char *format,...) {(void)format;_Exit(71);}\n#include '+JSON.stringify(helper)+'\nint main(void){ca_diag_init();ca_diag_object_begin(1);ca_diag_query_begin();ca_diag_query_end();ca_diag_object_end();return 0;}\n');
    const built=spawnSync('cc',['-std=c11','-D_POSIX_C_SOURCE=200809L','-Wall','-Wextra','-Werror',source,'-o',binary],{encoding:'utf8',timeout:15000});
    assert.equal(built.status,0,built.stderr);
    const native=spawnSync(binary,[],{stdio:['ignore','pipe','pipe','pipe'],timeout:5000});
    assert.equal(native.status,0,native.stderr?.toString());const frames=native.output[3];assert.equal(frames.length,48);
    const parser=createNativeDumpDiagnostic();parser.push(frames,1);parser.finish();assert.equal(parser.snapshot(2).types.FUNCTION.queries_completed,1);parser.clear();
    const script="import importlib.util,sys;spec=importlib.util.spec_from_file_location('n','operations/release/fixture/native-dump-diagnostic.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(m.validate_frames(sys.stdin.buffer.read()))";
    const valid=spawnSync('python3',['-B','-c',script],{input:frames,encoding:'utf8',timeout:5000});assert.equal(valid.status,0,valid.stderr);assert.equal(valid.stdout.trim(),'4');
    const invalid=Buffer.from(frames);invalid[6]=16;
    assert.notEqual(spawnSync('python3',['-B','-c',script],{input:invalid,encoding:'utf8',timeout:5000}).status,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

// The direct target bypasses src/Makefile's interdirectory serialization.
test('both native direct target builds serialize shared prerequisite writers within original deadlines',()=>{
  const script=`import ast
from pathlib import Path
root=ast.parse(Path('operations/release/fixture/native-dump-diagnostic.py').read_text())
build=next(n for n in root.body if isinstance(n,ast.FunctionDef) and n.name=='build')
commands=[]
for node in ast.walk(build):
 if not isinstance(node,ast.Call) or not isinstance(node.func,ast.Name) or node.func.id!='command' or not node.args:continue
 try:args=ast.literal_eval(node.args[0])
 except (ValueError,TypeError):continue
 if args[:3]==['make','-C','src/bin/pg_dump']:
  timeout=next(ast.literal_eval(k.value) for k in node.keywords if k.arg=='timeout')
  commands.append((args,timeout))
assert commands==[(['make','-C','src/bin/pg_dump','-j1','pg_dump'],420),(['make','-C','src/bin/pg_dump','-j1','pg_dump'],120)]
print('original bounded serialized stock and diagnostic target builds')`;
  const result=spawnSync('python3',['-B','-c',script],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
});


test('actual native C read-ahead preserves mixed-object consumption and all bounded refusals',()=>{
  const script=`import importlib.util,os,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('native','operations/release/fixture/native-dump-diagnostic.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR') or os.environ['RUNNER_TEMP']) as folder:
 assert m.qualify_batch_contract(Path.cwd(),Path(folder),dict(os.environ))
print('bounded native read-ahead contract passed')`;
  const result=spawnSync('python3',['-B','-c',script],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'bounded native read-ahead contract passed');
});
