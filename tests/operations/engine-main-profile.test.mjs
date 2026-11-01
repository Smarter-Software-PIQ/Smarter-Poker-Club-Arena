import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { summarize, profileTarget, failureReason, collectOwnedInspector } from '../../scripts/ci/profile-engine-main-thread.mjs';

async function target(t) {
  // Keep the fixture witness out of the timers' optimized/inlined frames.
  const child=spawn(process.execPath,['--no-opt','--inspect=127.0.0.1:0','-e',
    'let ready=false;setInterval(function cpuSampleWitness(){let value=globalThis.witness||1;for(let i=0;i<1000000;i++)value=(value+i)|0;globalThis.witness=value;if(!ready){ready=true;process.stdout.write("witness-ready\\n");}},10)'],{stdio:['ignore','pipe','pipe']});
  t.after(async()=>{ if(child.exitCode===null && child.signalCode===null){child.kill();await once(child,'exit');} });
  const endpoint=await new Promise((resolve,reject)=>{
    let text='',output='',endpoint,witnessReady=false;
    const timer=setTimeout(()=>reject(new Error('fixture_start_timeout')),5000);
    const admit=()=>{if(endpoint&&witnessReady){clearTimeout(timer);resolve(endpoint);}};
    child.stderr.on('data',d=>{text+=d;const m=text.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);if(m){endpoint=m[0];admit();}});
    child.stdout.on('data',d=>{output+=d;if(output.includes('witness-ready\n')){witnessReady=true;admit();}});
    child.once('error',reject);
  });
  return {child,endpoint};
}

test('real V8 CPU samples are summarized and the owned inspector closes',async t=>{
  const {child,endpoint}=await target(t);
  const result=await profileTarget(endpoint,child.pid,1000);
  assert.ok(result.samples>0);assert.ok(result.sampledUs>0);
  assert.ok(result.topSelf.some(x=>x.functionName==='cpuSampleWitness'));
  assert.equal(child.exitCode,null);
  let closed=false;
  const deadline=Date.now()+2000;
  while(Date.now()<deadline && !closed){
    try { await fetch(endpoint.replace('ws:','http:').replace(/\/[^/]+$/,'/json/list')); await new Promise(r=>setTimeout(r,20)); }
    catch { closed=true; }
  }
  assert.equal(closed,true,'the owned inspector must actually stop listening');
});

test('a mismatched process is refused without closing its inspector',async t=>{
  const {child,endpoint}=await target(t);
  await assert.rejects(profileTarget(endpoint,child.pid+1,50),/profile_pid_mismatch/);
  assert.equal((await fetch(endpoint.replace('ws:','http:').replace(/\/[^/]+$/,'/json/list'))).status,200);
});

test('only loopback and bounded collection are admitted',async()=>{
  await assert.rejects(profileTarget('ws://example.com:9229/x',1,50),/profile_target_refused/);
  await assert.rejects(profileTarget('ws://127.0.0.1:9229/x',1,30001),/profile_target_refused/);
});

test('missing or invalid samples are unknown, never a successful empty profile',()=>{
  assert.throws(()=>summarize({nodes:[],samples:[],timeDeltas:[]}),/profile_samples_missing/);
  assert.throws(()=>summarize({nodes:[],samples:[1],timeDeltas:[1]}),/profile_sample_invalid/);
  const r=summarize({nodes:[{id:1,callFrame:{functionName:'witness',url:'https://private.invalid/token',lineNumber:0}}],samples:[1],timeDeltas:[50]});
  assert.equal(r.topSelf[0].file,'(runtime)');
  assert.equal(r.topSelf[0].percent,100);
});

test('a disconnected target never returns a successful profile',async t=>{
  const {child,endpoint}=await target(t);
  const timer=setTimeout(()=>child.kill(),100);
  try { await assert.rejects(profileTarget(endpoint,child.pid,300)); }
  finally { clearTimeout(timer); }
});


test('the exact stdin entry refuses invalid identity before touching a target',()=>{
  const source=readFileSync(new URL('../../scripts/ci/profile-engine-main-thread.mjs',import.meta.url),'utf8');
  const r=spawnSync(process.execPath,['--input-type=module','-','invalid-sha'],{input:source,encoding:'utf8',timeout:3000});
  assert.equal(r.status,1);assert.equal(r.stdout,'');
  assert.match(r.stderr,/^CPU profile failed; inspect owning run and inspector state before any retry\./);
  assert.match(r.stderr,/reason=expected_sha_refused/);
});

test('importing the helper from a stdin module never invokes the production entry',()=>{
  const url=new URL('../../scripts/ci/profile-engine-main-thread.mjs',import.meta.url).href;
  const r=spawnSync(process.execPath,['--input-type=module','-'],{input:'await import('+JSON.stringify(url)+'); console.log(\"imported\");',encoding:'utf8',timeout:3000});
  assert.equal(r.status,0);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'imported');
});


test('CLI refusals name the gate without exporting arbitrary error payloads',()=>{
  assert.equal(failureReason(new Error('inspector_already_active')),'inspector_already_active');
  assert.equal(failureReason(new Error('private URL https://example.invalid/secret')),'unclassified_failure');
  assert.equal(failureReason(null),'unclassified_failure');
});


async function closedInspectorTarget(t) {
  const child=spawn(process.execPath,['--inspect-port=127.0.0.1:0','-e','console.log("ready");setInterval(()=>{},100)'],{stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null){child.kill();await once(child,'exit');}});
  let endpoint;
  child.stderr.on('data',d=>{const m=d.toString().match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);if(m) endpoint=m[0];});
  // Wait for user code before SIGUSR1, which would otherwise use its OS default.
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
  const discoverTarget=async()=>{
    if(!endpoint)return null;
    try {const r=await fetch(endpoint.replace('ws:','http:').replace(/\/[^/]+$/,'/json/list'),{signal:AbortSignal.timeout(1000)});return (await r.json())[0]?.webSocketDebuggerUrl || null;}
    catch(e){if(e.cause?.code==='ECONNREFUSED')return null;throw e;}
  };
  return {child,discoverTarget,openTarget:()=>child.kill('SIGUSR1')};
}

for (const failure of ['discovery','connection']) {
  test('owned inspector closes after '+failure+' failure and the real process survives',async t=>{
    const target=await closedInspectorTarget(t);
    let opened=false,failed=false;
    const discoverTarget=async()=>{
      const endpoint=await target.discoverTarget();
      if(failure==='discovery' && opened && endpoint && !failed){failed=true;throw new Error('fixture_discovery_failure');}
      return endpoint;
    };
    await assert.rejects(collectOwnedInspector(target.child.pid,{
      discoverTarget,
      openTarget:()=>{opened=true;target.openTarget();},
      collect:(endpoint,pid)=>profileTarget(endpoint.replace(/\/[^/]+$/,'/not-the-target'),pid,50),
    }),failure==='discovery'?/fixture_discovery_failure/:/inspector_connect_failed/);
    assert.equal(await target.discoverTarget(),null,'opened inspector must stop listening even when collection never connects');
    assert.equal(target.child.exitCode,null);
  });
}

test('the lifecycle refuses a preexisting real inspector without signaling or closing it',async t=>{
  const {child,endpoint}=await target(t);
  let opened=false;
  await assert.rejects(collectOwnedInspector(child.pid,{
    discoverTarget:async()=>endpoint,openTarget:()=>{opened=true;},
  }),/inspector_already_active/);
  assert.equal(opened,false);
  assert.equal((await fetch(endpoint.replace('ws:','http:').replace(/\/[^/]+$/,'/json/list'))).status,200);
});


test('unavailable cleanup preserves the first refusal and marks cleanup unknown',async t=>{
  const target=await closedInspectorTarget(t);
  let collectionFailed=false;
  let first;
  try {
    await collectOwnedInspector(target.child.pid,{
      discoverTarget:async()=>{if(collectionFailed)throw new Error('fixture_unreachable');return target.discoverTarget();},
      openTarget:target.openTarget,
      collect:async()=>{collectionFailed=true;throw new Error('inspector_connect_failed');},
    });
  } catch(error) { first=error; }
  assert.equal(first?.message,'inspector_connect_failed');
  assert.equal(first?.cleanupConfirmed,false);
  assert.ok(await target.discoverTarget(),'failed readback cannot certify closure');
  assert.equal(target.child.exitCode,null);
});


test('invalid sample refusals distinguish missing nodes, nonfinite and negative deltas without exposing values',()=>{
  const nodes=[{id:1,callFrame:{functionName:'witness',url:'node:events',lineNumber:0}}];
  for(const [samples,timeDeltas,reason] of [
    [[2],[1],'profile_sample_invalid_node'],
    [[1],[NaN],'profile_sample_invalid_delta'],
    [[1],[-1],'profile_sample_invalid_negative_delta'],
  ]) {
    let error;try{summarize({nodes,samples,timeDeltas});}catch(caught){error=caught;}
    assert.equal(failureReason(error),reason);
  }
});

test('native feasibility is PR-only and cannot change the manual Inspector route',()=>{
  const workflow=readFileSync('.github/workflows/profile-engine-main-thread.yml','utf8');
  const native=workflow.split('  native-feasibility:\n')[1]?.split('  profile:\n')[0];
  assert.ok(native,'maintained carrier must invoke actual Linux qualification');
  assert.match(native,/if: github\.event_name == 'pull_request'/);
  assert.match(native,/python3 tests\/fixtures\/engine-native-fault\/qualify\.py/);
  assert.match(native,/if-no-files-found: error/);
  const resolvePerf=native.match(/dpkg-query --listfiles linux-perf \| python3 -c '([^']+)'/)?.[1];
  assert.ok(resolvePerf,'resolve the current installed perf package, not a legacy kernel-tools directory');
  for(const [input,expected] of [['/usr/bin/perf\n/usr/share/doc/linux-perf\n','/usr/bin/perf'],['/usr/lib/linux-tools/old/perf\n',null],['/usr/bin/perf\n/usr/bin/perf\n',null]]) {
    const result=spawnSync('python3',['-c',resolvePerf],{input,encoding:'utf8'});
    if(expected) {assert.equal(result.status,0);assert.equal(result.stdout.trim(),expected);}
    else assert.notEqual(result.status,0,'missing or ambiguous package binary must refuse');
  }

  const manual=workflow.split('  profile:\n')[1];
  assert.match(manual,/needs: verify/);
  assert.match(manual,/docker exec -i club-arena-engine node --input-type=module/);
  assert.doesNotMatch(manual,/qualify\.py|perf record|native-feasibility/);
  const fixture=readFileSync('tests/fixtures/engine-native-fault/qualify.py','utf8');
  const image=readFileSync('server/Dockerfile','utf8').match(/^FROM (node:22-slim@sha256:[0-9a-f]{64})$/m)?.[1];
  assert.ok(image);assert.ok(fixture.includes(`IMAGE = '${image}'`));
  const syntax=spawnSync('python3',['-c','import pathlib; compile(pathlib.Path("tests/fixtures/engine-native-fault/qualify.py").read_text(),"native-qualification","exec")'],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
});

test('perf control accepts exact NUL-terminated C ACK frames and refuses partial or foreign replies within one deadline',()=>{
  const source=String.raw`
import importlib.util,os,threading,time,types
spec=importlib.util.spec_from_file_location('q','tests/fixtures/engine-native-fault/qualify.py');q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
for chunks,accepted in [([b'ack\n\0'],True),([b'a',b'ck\n',b'\0'],True),([b'ack\n'],False),([b'other\n\0'],False),([b'ack\n\0ack\n\0'],False)]:
 r,w=os.pipe();done=threading.Event()
 def send():
  try:
   for chunk in chunks:os.write(w,chunk);time.sleep(.005)
   if accepted:done.wait(.2)
  except BrokenPipeError:pass
  finally:os.close(w)
 t=threading.Thread(target=send);t.start()
 try:
  try:q.read_perf_ack(r,.1);result=True
  except RuntimeError:result=False
  assert result==accepted
 finally:os.close(r);done.set();t.join()
r,w=os.pipe();os.write(w,b'ack\n\0');os.close(w)
try:
 try:q.read_perf_ack(r,.1);raise AssertionError('ACK followed by recorder EOF accepted')
 except RuntimeError as e:assert str(e)=='perf_control_unconfirmed'
finally:os.close(r)
r,w=os.pipe();start=time.monotonic()
try:
 try:q.read_perf_ack(r,.02);raise AssertionError('unanswered control accepted')
 except RuntimeError as e:assert str(e)=='perf_control_timeout'
 assert time.monotonic()-start<.2
finally:os.close(r);os.close(w)
c=q.Capture.__new__(q.Capture);c.process=types.SimpleNamespace(poll=lambda:None)
r,c.ctl_write=os.pipe();c.ack_read,w=os.pipe()
try:os.write(w,b'ack\n\0');c.control('ping')
finally:
 for fd in (r,c.ctl_write,c.ack_read,w):os.close(fd)
for text,category in [(b'Permission denied PRIVATE', 'permission'),(b'unknown tracepoint PRIVATE','tracepoint'),(b'unrecognized option PRIVATE','unsupported_option'),(b'cannot unwind PRIVATE','unwind'),(b'PRIVATE','other')]:
 assert q.classify_perf_refusal(text)==category
assert q.classify_perf_refusal(b'',True)=='control_timeout'
assert q.classify_perf_refusal(b'x'*8193)=='other'

# Actual command boundary: DWARF must select its supported default register set.
import pathlib,tempfile
saved_control=q.Capture.control;saved_popen=q.subprocess.Popen
r,w=os.pipe();q.os.pidfd_open=lambda pid:r
commands=[]
q.Capture.control=lambda self,command:None
q.subprocess.Popen=lambda command,**kwargs:(commands.append(command) or types.SimpleNamespace(poll=lambda:0))
try:
 with tempfile.TemporaryDirectory() as folder:
  c=q.Capture('/fixed/perf',pathlib.Path(folder),{'pid':123,'tasks':[123]},pathlib.Path(folder))
  assert '--call-graph=dwarf,8192' in commands[0]
  assert not any(arg.startswith('--user-regs') for arg in commands[0])
  c.cleanup()
finally:
 os.close(w);q.Capture.control=saved_control;q.subprocess.Popen=saved_popen
# Failed-case facts remain closed; diagnostic name mentions never become frame proof.
sample=q.Capture.__new__(q.Capture);sample.perf='/fixed/perf';sample.file=types.SimpleNamespace(stat=lambda:types.SimpleNamespace(st_size=256),__str__=lambda self:'/private/data');sample.symfs=pathlib.Path('/private/symfs');sample.original={'pid':123,'tasks':[123]}
raw=b'node 123/123 signal:signal_generate: sig=11 code=128 pid=123\n deadbeef sp_fault_leaf+0x1 (/fixture/fault.node)\n feedface sp_fault_caller+0x1 (/fixture/fault.node)\n abcdef01 PRIVATE_SYMBOL (/PRIVATE_DSO)\n'
saved_run=q.run
q.run=lambda command,**kwargs:types.SimpleNamespace(returncode=0,stdout=raw if command[1]=='script' else b'1111111111111111111111111111111111111111 /fixture/fault.node\n',stderr=b'PRIVATE unwind not found')
try:
 facts=sample.samples();assert facts['events']==1 and facts['leaf'] and facts['caller']
 import json
 encoded=json.dumps(facts);assert all(value not in encoded for value in ['PRIVATE','deadbeef','feedface','abcdef01'])
 raw=b'node 123/123 signal:signal_generate: sig=11 code=128 pid=123 sp_fault_leaf\n'
 facts=sample.samples();assert facts['fixedNameMentions']['leaf'] and not facts['leaf']
finally:q.run=saved_run
`;
  const result=spawnSync('python3',['-c',source],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(result.status,0,result.stderr);
});

test('pinned Node PID1 retry signals require two complete events from one original task and native site',()=>{
  const source=String.raw`
import importlib.util,json
spec=importlib.util.spec_from_file_location('q','tests/fixtures/engine-native-fault/qualify.py');q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
assert q.validate_node_fixture({'pid':1,'version':'v22.23.2'})=='v22.23.2'
for ready in [{'pid':1,'version':'v22.23.1'},{'pid':2,'version':'v22.23.2'},{'pid':True,'version':'v22.23.2'},{}]:
 try:q.validate_node_fixture(ready);raise AssertionError('unpinned subject accepted')
 except RuntimeError:pass
original={'pid':123,'tasks':[123,124]}
exit_original={'container':'fixture','image':'immutable'}
exited={'Id':'fixture','Image':'immutable','State':{'Running':False,'Restarting':False,'ExitCode':139,'OOMKilled':False}}
assert q.fault_exit_witness(exited,exit_original)['faultExitProven']
for state in [{**exited['State'],'ExitCode':0},{**exited['State'],'OOMKilled':True},{**exited['State'],'OOMKilled':0},{**exited['State'],'Running':True},{}]:
 assert not q.fault_exit_witness({**exited,'State':state},exit_original)['faultExitProven']
assert not q.fault_exit_witness({**exited,'Id':'foreign'},exit_original)['faultExitProven']
def event(tid=123,leaf='deadbeef',caller='feedface'):
 return f'node 123/{tid} signal:signal_generate: sig=11 code=128 pid={tid}\n'+(f' {leaf} sp_fault_leaf+0x1 (/fixture/fault.node)\n' if leaf else '')+(f' {caller} sp_fault_caller+0x2 (/fixture/fault.node)\n' if caller else '')
a=event();facts=q.fault_event_witness(a+a,original)
assert facts['events']==2 and facts['completeEventWitnesses']==2 and facts['onePid1FaultWitness']
assert facts['distinctOriginalTasks']==1 and facts['distinctNativeSites']==1
encoded=json.dumps(facts);assert all(value not in encoded for value in ['deadbeef','feedface','123','124'])
for raw in [a,a+a+a,a+event(tid=124),a+event(leaf='beadbead'),a+event(caller='beadbead'),a+event(leaf=None),a+event(caller=None),event(caller=None)+event(leaf=None),a+' deadbeef sp_fault_leaf+0x1 (/fixture/fault.node)\n'+a]:
 assert not q.fault_event_witness(raw,original)['onePid1FaultWitness']
try:q.fault_event_witness(a+event(tid=999),original);raise AssertionError('foreign task accepted')
except RuntimeError as e:assert str(e)=='foreign_sample_attribution'
for raw in [a*257,None]:
 try:q.fault_event_witness(raw,original);raise AssertionError('render/event bound accepted')
 except RuntimeError:pass
`;
  const result=spawnSync('python3',['-c',source],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(result.status,0,result.stderr);
});
