import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {request,invocation,health,receipt,remoteCommand} from './v31-explicit-load.mjs';
const p={operation:'reload',sourceSha:'a'.repeat(40),requestId:'11111111-1111-4111-8111-111111111111',datasetId:'22222222-2222-4222-8222-222222222222',checksum:'b'.repeat(64),cellCount:107,workerCount:8};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64');
const env={GITHUB_REPOSITORY:'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',GITHUB_REPOSITORY_ID:'1132369872',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1'};
const h=(q=p)=>({status:'ok',releaseSha:q.sourceSha,liveHorseDecision:{phase:'ready',workerCount:8,solverStores:{postflopV31:q.cellCount,postflopV31Dataset:{id:q.datasetId,checksum:q.checksum}}}});
const good=(operation='reload',q=p,cells=q.cellCount)=>({format:'v31_explicit_store_control_receipt_v1',operation,sourceSha:q.sourceSha,observedAt:new Date().toISOString(),receipt:{requestId:q.requestId,datasetId:q.datasetId,checksum:q.checksum,expectedCells:cells,state:'complete',workers:Array.from({length:8},(_,worker)=>({worker,type:'V31_STORE_CONTROL_ACK',operation,requestId:q.requestId,ok:true,count:cells,dataset:{id:q.datasetId,checksum:q.checksum},error:null}))}});
// R8 public215 dataset: 100 sealed runtime cells (R7 above has 107).
const r8={...p,datasetId:'1dc9a1b8-a78b-46c9-86f6-9b9bfa0d8c3b',checksum:'d'.repeat(64),cellCount:100};
test('only a bounded complete identity and first explicit protected operation are admitted',()=>{
 assert.deepEqual(request(encode(p)),p);invocation(env);
 for(const patch of [{operation:'promote'},{cellCount:0},{cellCount:10001},{cellCount:100.5},{cellCount:'100'},{cellCount:null},{workerCount:7},{sourceSha:'unsafe;cmd'},{requestId:'bad'},{checksum:'0'.repeat(64)},{extra:true}])assert.throws(()=>request(encode({...p,...patch})));
 assert.throws(()=>request(encode(p)+'='));assert.throws(()=>request(Buffer.from(JSON.stringify(p).replace('{','{\"operation\":\"status\",')).toString('base64')));
 for(const patch of [{GITHUB_EVENT_NAME:'schedule'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REPOSITORY_ID:'1'}])assert.throws(()=>invocation({...env,...patch}));
});
test('actual load and same-identity fresh status each require all eight original acknowledgments',()=>{
 assert.equal(receipt(p,good()).receipt.workers.length,8);assert.equal(receipt({...p,operation:'status'},good('status')).operation,'status');
 for(const edit of [v=>v.receipt.workers.pop(),v=>v.receipt.workers[1].worker=0,v=>v.receipt.workers[0].ok=false,v=>v.receipt.workers[0].count=106,v=>v.receipt.workers[0].operation='status',v=>v.receipt.state='partial',v=>v.sourceSha='c'.repeat(40),v=>v.receipt.workers[0].dataset.checksum='c'.repeat(64),v=>v.observedAt='2020-01-01T00:00:00Z']){const v=good();edit(v);assert.throws(()=>receipt(p,v));}
});
test('before requires eight healthy serving workers and after additionally proves exact loaded identity',()=>{
 health(p,h(),true);const before=h();before.liveHorseDecision.solverStores={};health(p,before,false);assert.throws(()=>health(p,before,true));
 for(const edit of [v=>v.releaseSha='c'.repeat(40),v=>v.liveHorseDecision.workerCount=7,v=>v.liveHorseDecision.solverStores.postflopV31=106]){const v=h();edit(v);assert.throws(()=>health(p,v,true));}
});
test('fixed provider invocation preserves the live container and cannot build, promote or restart',()=>{
 const c=remoteCommand(p);
 for(const operation of ['reload','status']){const command=remoteCommand({...p,operation}),inner=command.slice(9,-1).replaceAll("'\\''","'");assert.equal(spawnSync('bash',['-n'],{input:inner,encoding:'utf8'}).status,0,'actual generated Bash must parse');}
 for(const s of ['flock -n 9','TZ=America/Chicago','reloadPublic215Stores.js reload','result_code=$?','"$before" = "$after"'])assert.ok(c.includes(s));
 assert.ok(remoteCommand({...p,operation:'status'}).includes('reloadPublic215Stores.js status'));
 assert.doesNotMatch(c,/docker (?:run|build|pull|restart|stop|rm)|systemctl|--env-file|Config.Env|\.env|promot/);
 assert.throws(()=>remoteCommand({...p,checksum:'unsafe;command'}));
 const w=readFileSync(new URL('../../.github/workflows/v31-explicit-load.yml',import.meta.url),'utf8');
 assert.match(w,/workflow_dispatch:/);assert.match(w,/GITHUB_RUN_ATTEMPT/);assert.match(w,/--health-after/);assert.match(w,/StrictHostKeyChecking=yes/);
 assert.doesNotMatch(w,/schedule:|workflow_run:|repository_dispatch:|continue-on-error:|cancel-in-progress: true/);
});
test('cellCount follows each dataset sealed census: R7 107 and R8 100 admitted, any mismatch refused',()=>{
 for(const q of [p,r8]){
  assert.deepEqual(request(encode(q)),q);
  for(const operation of ['reload','status']){const o={...q,operation};assert.equal(receipt(o,good(operation,o)).receipt.expectedCells,q.cellCount);}
  health(q,h(q),true);
  assert.ok(remoteCommand(q).includes(q.datasetId));
 }
 // Request bound to one census, engine/worker/health evidence for another, is refused.
 assert.throws(()=>receipt(r8,good('reload',r8,107)));assert.throws(()=>receipt(p,good('reload',p,100)));
 const ack=good('reload',r8);ack.receipt.workers[3].count=107;assert.throws(()=>receipt(r8,ack));
 assert.throws(()=>health(r8,h({...r8,cellCount:107}),true));assert.throws(()=>health(p,h({...p,cellCount:100}),true));
 assert.throws(()=>health(r8,h({...r8,cellCount:99}),true));
});
