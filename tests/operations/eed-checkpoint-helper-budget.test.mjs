import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { legacyCheckpointAllocation, legacyCensusTimeAdmission, bindLegacyCensusModules, retireLegacyCensusBinding,
  LEGACY_CENSUS_NATIVE_SOURCE_SHA256 } from '../../server/scripts/legacy-engine-checkpoint.mjs';
const EED='eed06fe51dea622069c661a6213d5b031ff3a9e3';
test('EED allocation preserves total admission and rollback while old profiles remain unchanged',()=>{
 const e=legacyCheckpointAllocation(EED);assert.equal(e.entryMs,80000);assert.equal(e.reserveMs,205000);
 assert.equal(e.entryMs+e.reserveMs,285000);assert.equal(e.reserveMs-135000,70000);
 assert.equal(e.censusMs,80000-15000-e.cleanupMs-e.receiptMs);assert.equal(e.profile,'eed-80s-v1');
 for(const sha of ['8825af51817f379c4261658ca29ecc9d8d81932d',EED.slice(0,8),'unknown']){
  const old=legacyCheckpointAllocation(sha);assert.equal(old.entryMs,40000);assert.equal(old.reserveMs,245000);assert.equal(old.profile,null);
 }
});
test('extended serialized binding requires exact runtime, native hash and literal profile; cleanup stays owned',()=>{
 const previous=process.env.GIT_COMMIT_SHA;const key='__legacyEngineCensus_'+'a'.repeat(32);
 const native={sourceSHA256:LEGACY_CENSUS_NATIVE_SOURCE_SHA256};
 try{
  process.env.GIT_COMMIT_SHA=EED;
  assert.throws(()=>bindLegacyCensusModules.call({},key,Date.now()+60000,native));
  assert.throws(()=>bindLegacyCensusModules.call({},key,Date.now()+60000,native,'arbitrary'));
  assert.throws(()=>bindLegacyCensusModules.call({},key,Date.now()+60000,{sourceSHA256:'0'.repeat(64)},'eed-80s-v1'));
  process.env.GIT_COMMIT_SHA='0'.repeat(40);
  assert.throws(()=>bindLegacyCensusModules.call({},key,Date.now()+60000,native,'eed-80s-v1'));
  process.env.GIT_COMMIT_SHA=EED;const deadline=Date.now()+60000;
  assert.equal(bindLegacyCensusModules.call({},key,deadline,native,'eed-80s-v1'),true);
  assert.throws(()=>retireLegacyCensusBinding(key,deadline+1));
  assert.equal(retireLegacyCensusBinding(key,deadline),true);assert.equal(Object.hasOwn(globalThis,key),false);
 }finally{delete globalThis[key];if(previous===undefined)delete process.env.GIT_COMMIT_SHA;else process.env.GIT_COMMIT_SHA=previous;}
});
test('actual shell predecessor selection enforces EED-only allocation before intent',()=>{
 const source=readFileSync(new URL('../../server/scripts/legacy-engine-checkpoint.sh',import.meta.url),'utf8');
 const start=source.indexOf('CHECKPOINT_ALLOCATION_MS=40000');const end=source.indexOf('\nif [ "$LEGACY_SHA" = 8825',start);
 assert.ok(start>0&&end>start);const block=source.slice(start,end);
 for(const [sha,delay,ok] of [[EED,60000,true],['8825af51817f379c4261658ca29ecc9d8d81932d',60000,false],[EED,90000,false],['8825af51817f379c4261658ca29ecc9d8d81932d',30000,true]]){
  const result=spawnSync('bash',['-c','die(){ exit 13; }; date(){ printf \"%s\\n\" \"$FIXED_NOW\"; }; '+block],{encoding:'utf8',env:{...process.env,CHECKPOINT_NOW_MS:String(Date.now()),FIXED_NOW:String(Date.now()),LEGACY_SHA:sha,CHECKPOINT_DEADLINE_MS:String(Date.now()+delay)}});
  assert.equal(result.status===0,ok);
 }
});

test('fresh census budget preserves12ms per decimal MB and refuses lost remaining time',()=>{
 assert.equal(legacyCensusTimeAdmission(3100000000,59000),true);
 assert.equal(legacyCensusTimeAdmission(3100000000,30300),false);
 assert.equal(legacyCensusTimeAdmission(5000000000,80000),false);
 assert.equal(legacyCensusTimeAdmission(1000000,24),true);
 assert.equal(legacyCensusTimeAdmission(1000000,23),false);
 for(const bytes of [0,-1,NaN,Infinity,'3100000000',1.5])assert.equal(legacyCensusTimeAdmission(bytes,59000),false);
});

// Execute the real private CDP transport against an isolated clock/socket.
// No inspector, native collection, host I/O or elapsed wall-clock wait occurs.
function transportFixture() {
 const source=readFileSync(new URL('../../server/scripts/legacy-engine-checkpoint.mjs',import.meta.url),'utf8');
 const errors=source.slice(source.indexOf('class CheckpointTransportError'),source.indexOf('async function inspectorTarget'));
 const transport=source.slice(source.indexOf('function connectInspector('),source.indexOf('/** One checkpoint attempt;'));
 let now=1000,next=0;const timers=new Map(),sent=[],listeners=new Map();
 const socket={readyState:1,addEventListener(name,fn){const a=listeners.get(name)??[];a.push(fn);listeners.set(name,a);},
  send(value){sent.push(JSON.parse(value));},close(){this.readyState=3;for(const fn of listeners.get('close')??[])fn();}};
 const connect=runInNewContext(errors+transport+';connectInspector',{
  Date:{now:()=>now},Buffer,WebSocket:{OPEN:1},
  setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}
 });
 const connection=connect('ws://isolated',100000,()=>socket);
 for(const fn of listeners.get('open')??[])fn();
 return {connection,sent,timers,setNow(value){now=value;},fire(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();},
  answer(value={}){const id=sent.at(-1).id;for(const fn of listeners.get('message')??[])fn({data:JSON.stringify({id,result:value})});}};
}
test('real CDP query cap extends only the exact query operation and stays inside its absolute deadline',async()=>{
 const source=readFileSync(new URL('../../server/scripts/legacy-engine-checkpoint.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('allocation.profile && nativeArtifact ? allocation.censusMs : 35000'));
 for(const [method,operation,cap,deadline,expected] of [
  ['Runtime.evaluate','queryObjects',59000,100000,59000],
  ['Runtime.evaluate','queryObjects',35000,100000,35000],
  ['Runtime.evaluate','queryObjects',59000,21000,20000],
  ['Runtime.getProperties','properties',35000,100000,35000]
 ]){
  const f=transportFixture();await f.connection.opened;
  const result=f.connection.request(method,{},deadline,operation,cap);
  assert.equal(f.timers.values().next().value.ms,expected);assert.equal(f.sent.length,1);
  f.answer({ok:true});assert.equal((await result).ok,true);assert.equal(f.timers.size,0);f.connection.close();
 }
});
test('real CDP refuses arbitrary caps and wrong operations without sending or allocating a request timer',async()=>{
 for(const [method,operation,cap] of [['Runtime.evaluate','queryObjects',60000],['Runtime.evaluate','guard',59000],['Runtime.getProperties','queryObjects',59000]]){
  const f=transportFixture();await f.connection.opened;
  await assert.rejects(f.connection.request(method,{},100000,operation,cap),/allocation refused/);
  assert.equal(f.sent.length,0);assert.equal(f.timers.size,0);f.connection.close();
 }
 const f=transportFixture();await f.connection.opened;
 await assert.rejects(f.connection.request('Runtime.evaluate',{},1000,'queryObjects',59000),/outcome unknown/);
 assert.equal(f.sent.length,0);assert.equal(f.timers.size,0);f.connection.close();
});
test('extended CDP timeout never resends, extends absolute time or retains cleanup timers',async()=>{
 const f=transportFixture();await f.connection.opened;
 const result=f.connection.request('Runtime.evaluate',{},100000,'queryObjects',59000);
 const rejected=assert.rejects(result,error=>error.transportDetail?.includes('allowanceMs=59000'));
 f.setNow(11000);f.fire();assert.equal(f.timers.values().next().value.ms,49000);assert.equal(f.sent.length,1);
 f.setNow(60000);f.fire();await rejected;assert.equal(f.sent.length,1);assert.equal(f.timers.size,0);
 // Cleanup still owns the same connection and cancels a pending ordinary request.
 const pending=f.connection.request('Runtime.getProperties',{},90000,'cleanup');
 const disconnected=assert.rejects(pending,/disconnected/);f.connection.close();await disconnected;
 assert.equal(f.sent.length,2);assert.equal(f.timers.size,0);
});
