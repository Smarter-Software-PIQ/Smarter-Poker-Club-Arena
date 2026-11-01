import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const source=new URL('../../scripts/ci/native-fault-observation.py',import.meta.url);
function python(body){
  const result=spawnSync('python3',['-B','-c',`import importlib.util,json,os\nspec=importlib.util.spec_from_file_location('controller',${JSON.stringify(source.pathname)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n${body}`],{encoding:'utf8',timeout:5000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('closed operation identity prevents path, shell and arbitrary target selection',()=>{
  const r=python(`values=['1','12345678901234567890','0','../1','1;true','a','1\\n','1'*21]\nrows=[]\nfor v in values:\n try: rows.append(m.operation(v))\n except RuntimeError:rows.append('refused')\nprint(json.dumps(rows))`);
  assert.deepEqual(r,['1','12345678901234567890',...Array(6).fill('refused')]);
});
test('host manager owns finite lifetime and only its dedicated helper control group',()=>{
  const args=python(`print(json.dumps(m.unit_arguments('123',m.STATE/'123'/'controller.py')))`);
  for(const value of ['--service-type=exec','--property=RuntimeMaxSec=160','--property=TimeoutStopSec=5','--property=KillMode=control-group','--property=Restart=no','--property=LimitFSIZE=268435456'])assert.ok(args.includes(value),value);
  assert.ok(args.some(v=>v.includes('ExecStopPost=')&&v.includes('stop-post --operation 123')));
  assert.equal(args.some(v=>/kill|signal|restart.*engine/.test(v)&&!v.includes('KillMode')),false);
  assert.deepEqual(args.slice(-5),['/usr/bin/python3','/var/lib/club-arena-native-fault/123/controller.py','collect','--operation','123']);
});
test('terminal receipt requires same InvocationID, terminal state, empty helper cgroup and raw cleanup independently',()=>{
 const result=python(`record={'invocation':'a'*32,'cleanup':'removed','result':{'verdict':'UNKNOWN','reason':'native_fault_coordinates','coordinates':[]}}\nstate={'InvocationID':'a'*32,'ActiveState':'inactive','SubState':'dead'}\nrows=[m.terminal_witness('1',record,state,True,True)]\nfor key,value in [('InvocationID','b'*32),('ActiveState','active'),('SubState','running')]:\n changed=dict(state);changed[key]=value;rows.append(m.terminal_witness('1',record,changed,True,True))\nrows.extend([m.terminal_witness('1',record,state,False,True),m.terminal_witness('1',record,state,True,False),m.terminal_witness('1',{**record,'cleanup':'pending'},state,True,True)])\nprint(json.dumps(rows))`);
 assert.equal(result[0].cleanupConfirmed,true);
 for(const row of result.slice(1)){assert.equal(row.cleanupConfirmed,false);assert.equal(row.verdict,'UNKNOWN');assert.deepEqual(row.coordinates,[]);}
});
test('private absolute native addresses become only exact ELF build-relative coordinates',()=>{
 const value=python(`original={'pid':123,'tasks':{'123':'99'}}\ncustody={'maps':[{'start':4096,'end':8192,'offset':0,'path':'/usr/local/bin/node'}],'modules':{'/usr/local/bin/node':{'class':'node','buildID':'a'*40,'sha256':'b'*64}}}\nraw='node 123/123 signal:signal_generate: sig=11 code=128\\n 1010 ExactNativeSymbol+0x1 (/usr/local/bin/node)\\n 9000 secretToken=PRIVATE (/untrusted/player/path)\\n'\nprint(json.dumps(m.decoded_coordinates(raw,original,custody)))`);
 assert.equal(value.eventCount,1);assert.equal(value.coordinates[0].offset,16);assert.equal(value.coordinates[0].buildID,'a'.repeat(40));
 assert.equal(value.productionCauseProven,false);assert.equal(value.verdict,'UNKNOWN');assert.equal(value.unresolvedFrameCount,1);
 assert.equal(value.taskCoverage,'original_snapshot_only_new_threads_unknown');
 const exported=JSON.stringify(value);for(const secret of ['1010','9000','PRIVATE','/usr/local','/untrusted','123'])assert.equal(exported.includes(secret),false,secret);
});
test('foreign task and nonkernel signal cannot form a native witness',()=>{
 const rows=python(`original={'pid':123,'tasks':{'123':'99'}}\nrows=[]\nfor header in ['node 124/123 signal:signal_generate: sig=11 code=128','node 123/124 signal:signal_generate: sig=11 code=128','node 123/123 signal:signal_generate: sig=11 code=1']:\n try:m.decoded_coordinates(header,original,{'maps':[],'modules':{}});rows.append('accepted')\n except RuntimeError:rows.append('refused')\nprint(json.dumps(rows))`);assert.deepEqual(rows,Array(3).fill('refused'));
});
test('import is inert and production does not signal, reconfigure or install tools',()=>{
 const text=readFileSync(source,'utf8');assert.equal(python("print(json.dumps({'mode':m.CONTAINER,'seconds':m.OBSERVATION_SECONDS}))").seconds,120);
 for(const pattern of [/os\.kill\(/,/pidfd_send_signal/,/ptrace/,/sysctl/,/apt-get/,/sched_process_fork/])assert.doesNotMatch(text,pattern);
 assert.match(text,/Engine lock is closed/);assert.match(text,/same_target\(original\)/);
});
test('terminal export refuses private or malformed coordinate fields',()=>{
 const result=python(`base={'verdict':'UNKNOWN','reason':'native_fault_coordinates','coordinates':[]}\nrows=[m.public_result(base)]\nfor row in [{'event':0,'module':'node','buildID':'a'*40,'binarySHA256':'b'*64,'offset':16,'symbol':None,'privatePID':98765},{'event':0,'module':'/private/path','buildID':'a'*40,'binarySHA256':'b'*64,'offset':16,'symbol':None}]:\n try: m.public_result({**base,'coordinates':[row]});rows.append('accepted')\n except RuntimeError:rows.append('refused')\nrows.append(m.public_result({**base,'reason':'SECRET private raw stderr'}))\nprint(json.dumps(rows))`);
 assert.deepEqual(result.slice(1,3),['refused','refused']);assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
test('only current-boot PID1 terminal journal event can preserve invocation evidence after GC',()=>{
 const values=python(`record={'invocation':'a'*32,'target':{'boot':'b'*32},'admittedMonotonicUS':100,'cleanupMonotonicUS':200}\nrow={'_PID':'1','_UID':'0','_TRANSPORT':'journal','_BOOT_ID':'b'*32,'UNIT':m.unit_name('123'),'INVOCATION_ID':'a'*32,'MESSAGE_ID':m.MANAGER_SUCCESS,'__MONOTONIC_TIMESTAMP':'201'}\nrows=[m.journal_terminal_witness('123',record,[row])]\nfor key,value in [('_PID','2'),('_UID','1'),('_TRANSPORT','stdout'),('_BOOT_ID','c'*32),('UNIT',m.unit_name('124')),('INVOCATION_ID','c'*32),('MESSAGE_ID','be02cf6855d2428ba40df7e9d022f03d'),('__MONOTONIC_TIMESTAMP','199')]:\n rows.append(m.journal_terminal_witness('123',record,[{**row,key:value}]))\nrows.extend([m.journal_terminal_witness('123',record,[]),m.journal_terminal_witness('123',record,[row]*32),m.journal_terminal_witness('123',record,[row,row])])\nprint(json.dumps(rows))`);
 assert.equal(values[0],true);assert.deepEqual(values.slice(1),Array(values.length-1).fill(false));
});
test('workflow preserves Inspector defaults and only closed manual native modes',()=>{
 const text=readFileSync(new URL('../../.github/workflows/profile-engine-main-thread.yml',import.meta.url),'utf8');
 assert.match(text,/default: inspector/);assert.match(text,/options: \[inspector, native_fault, native_receipt\]/);
 assert.match(text,/inputs.mode == 'inspector'/);assert.match(text,/75s ssh/);
 assert.match(text,/220s ssh/);assert.match(text,/native-observation:[\s\S]*timeout-minutes: 5/);
 assert.match(text,/existing_operation_read_receipt|Unknown acknowledgement/);
 assert.doesNotMatch(text,/apt-get[^\n]*(?:native-observation|HETZNER)/);
});
test('original TID start identities are mandatory while new-thread coverage stays explicitly unknown',()=>{
 const rows=python(`base={'container':'c','image':'i','startedAt':'t','pid':5,'start':'99','boot':'b','sha':'s','healthInstance':'1-12345678','mountDestinations':[],'tasks':{'5':'99','6':'100'}}\nrows=[]\nfor tasks in [{'5':'99','6':'100','7':'101'},{'5':'99'},{'5':'99','6':'101'}]:\n m.target_identity=lambda expected,tasks=tasks:{**base,'tasks':tasks}\n rows.append(m.same_target(base))\nprint(json.dumps(rows))`);
 assert.deepEqual(rows,[true,false,false]);
});
test('production ACK reader accepts only the exact fragmented live recorder frame',()=>{
 const rows=python(`import threading,time\nrows=[]\nfor chunks,close in [([b'ack\\n\\0'],False),([b'a',b'ck\\n',b'\\0'],False),([b'ack\\n\\0'],True),([b'ack\\n\\0x'],False)]:\n r,w=os.pipe()\n if close:os.write(w,b''.join(chunks));os.close(w)\n def writer():\n  if not close:\n   for part in chunks:os.write(w,part);time.sleep(.01)\n thread=threading.Thread(target=writer);thread.start()\n try:m.read_ack(r,1);rows.append('accepted')\n except RuntimeError:rows.append('refused')\n thread.join();os.close(r)\n if not close:os.close(w)\nprint(json.dumps(rows))`);
 assert.deepEqual(rows,['accepted','accepted','refused','refused']);
});
test('failure diagnostics retain only closed refusal categories',()=>{
 const values=python(`rows=[m.refusal_category(RuntimeError('perf_control_timeout')),m.refusal_category(RuntimeError('native_unwind_refused')),m.refusal_category(PermissionError('PRIVATE')),m.refusal_category(RuntimeError('PRIVATE'),b'operation not permitted secret=PRIVATE'),m.refusal_category(RuntimeError('PRIVATE'),b'PRIVATE')]\nprint(json.dumps(rows))`);
 assert.deepEqual(values,['control','decode','permission','permission','other']);assert.equal(JSON.stringify(values).includes('PRIVATE'),false);
});
test('prepared operation with no unit returns a closed unproven receipt',()=>{
 const value=python(`class FakePath:\n def __truediv__(self,other):return self\n def read_text(self):return 'b'*32\n def exists(self):return False\nrecord={'invocation':None,'target':{'boot':'b'*32,'sha':'c'*40},'cleanup':'pending'}\nm.STATE=m.RAW=FakePath();m.Path=lambda *args:FakePath()\nm.trusted_directory=lambda value:value\nm.read_json=lambda path:record\nm.systemd_state=lambda op:{'InvocationID':'','ActiveState':'inactive','SubState':'dead','LoadState':'not-found','ControlGroup':''}\nm.os.path.lexists=lambda path:False\nprint(json.dumps(m.receipt('1')))`);
 assert.equal(value.verdict,'UNKNOWN');assert.equal(value.cleanupConfirmed,false);assert.equal(value.sameInvocation,false);assert.equal(value.managerTerminalEvidence,'unproven');
});
test('only trusted image native module paths have closed addon custody eligibility',()=>{
 const value=python(`paths=['/usr/local/bin/node','/usr/lib/x86_64-linux-gnu/libc.so.6','/app/native/build/public_hist215_wtl.node','/app/../private.node','/fixture/fault.node','/app/native/bound.node']\nprint(json.dumps([m.mapped_module_class(p,{'mountDestinations':['/app/native/bound.node']}) for p in paths]))`);
 assert.deepEqual(value,['node','libc','addon',null,null,null]);
});
test('known refusal code is retained and arbitrary exception text is never exported',()=>{
 const value=python(`print(json.dumps([m.closed_refusal(RuntimeError('engine_health_identity_refused')),m.closed_refusal(RuntimeError('PRIVATE secret=123')),m.closed_refusal(TypeError('PRIVATE'))]))`);
 assert.deepEqual(value,['engine_health_identity_refused','native_operation_unproven','native_operation_unproven']);
});
test('actual docker command reads only the fixed least-scope identity projection',()=>{
 const value=python(`import tempfile,pathlib,sys\nwith tempfile.TemporaryDirectory(dir=os.environ['TMPDIR'],prefix='native-docker-boundary-') as folder:\n root=pathlib.Path(folder);fake=root/'docker';arguments=root/'arguments.json'\n fake.write_text('#!'+sys.executable+'\\nimport json,os,sys\\nopen(os.environ["NATIVE_FIXTURE_ARGS"],"w").write(json.dumps(sys.argv[1:]))\\nprint(json.dumps([dict(Id="owned")]))\\n')\n fake.chmod(0o700);os.environ['PATH']=str(root)+os.pathsep+os.environ['PATH'];os.environ['NATIVE_FIXTURE_ARGS']=str(arguments)\n result=m.projected_container();print(json.dumps({'args':json.loads(arguments.read_text()),'result':result}))`);
 assert.deepEqual(value.args.slice(0,2),['inspect','--format']);assert.equal(value.args.at(-1),'club-arena-engine');assert.equal(value.args.length,4);assert.deepEqual(value.result,[{Id:'owned'}]);
 const format=value.args[2];for(const forbidden of ['.Env','.Health','Source','json .Config}}','json .State}}'])assert.equal(format.includes(forbidden),false,forbidden);
 for(const required of ['.Id','.Image','.State.Pid','.State.StartedAt','.Config.Cmd','org.opencontainers.image.revision','8080/tcp','$m.Destination','$m.RW'])assert.ok(format.includes(required),required);
});
test('retained ELF custody refuses real short, zero and corrupted writes',()=>{
 const rows=python(`import tempfile,pathlib,time,hashlib\nrows=[]\nwith tempfile.TemporaryDirectory(dir=os.environ['TMPDIR'],prefix='native-module-write-') as folder:\n root=pathlib.Path(folder);data=b'actual retained ELF bytes'*64;source=root/'source';source.write_bytes(data)\n original_write=os.write\n for mode in ['full','short','zero','corrupt']:\n  fd=os.open(source,os.O_RDONLY)\n  def write(out,block):\n   if mode=='short':return original_write(out,block[:len(block)//2])\n   if mode=='zero':return 0\n   return original_write(out,b'x'*len(block) if mode=='corrupt' else block)\n  m.os.write=write\n  try:\n   digest=m.copy_module_bytes(fd,root/mode,len(data),time.monotonic()+2)\n   rows.append('attested' if digest==hashlib.sha256(data).hexdigest() and (root/mode).read_bytes()==data else 'invalid')\n  except RuntimeError as error:rows.append(m.closed_refusal(error))\n  finally:m.os.write=original_write;os.close(fd)\nprint(json.dumps(rows))`);
 assert.deepEqual(rows,['attested','module_copy_short_write','module_copy_short_write','retained_module_attestation_refused']);
});
