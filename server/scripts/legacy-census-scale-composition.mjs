// Disposable synthetic census phase only. No application or operator inputs.
import assert from 'node:assert/strict';
import inspector from 'node:inspector';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { bindLegacyCensusModules, collectMarkedLegacyCensus, retireLegacyCensusBinding } from './legacy-engine-checkpoint.mjs';

if (!isMainThread && workerData?.scaleCensusClient === true) {
  const endpoint = new URL(workerData.url);
  assert.equal(endpoint.protocol, 'ws:'); assert.equal(endpoint.hostname, '127.0.0.1');
  const socket = new WebSocket(endpoint);
  let id=0, pending, closed=false, outerMs=0;
  const request = (method,params,allowance) => new Promise((resolve,reject) => {
    const started=performance.now();
    const timer=setTimeout(() => { pending=undefined; reject(Error(method+' deadline')); }, Math.min(allowance,Math.max(1,workerData.fullDeadline-Date.now())));
    pending={id:++id,resolve,reject,timer,method,started};
    socket.send(JSON.stringify({id,method,params}));
  });
  socket.addEventListener('message', event => {
    const answer=JSON.parse(String(event.data));
    if(answer.id!==pending?.id)return;
    const active=pending;pending=undefined;clearTimeout(active.timer);
    if(active.method==='Runtime.evaluate')outerMs=performance.now()-active.started;
    if(answer.error||answer.result?.exceptionDetails)active.reject(Error('external census evaluation refused'));
    else active.resolve(answer.result);
  });
  socket.addEventListener('close',()=>{
    closed=true;
    if(pending){const active=pending;pending=undefined;clearTimeout(active.timer);active.reject(Error('external census closed before reply'));}
  });
  let ok=false,reason;
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('external census connect deadline')),Math.max(1,Math.min(30000,workerData.fullDeadline-Date.now())));
      socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('external census transport'));},{once:true});
    });
    await request('Runtime.evaluate',{expression:workerData.expression,disableBreaks:true,awaitPromise:false,objectGroup:'synthetic-scale-census'},30000);
    await request('Runtime.releaseObjectGroup',{objectGroup:'synthetic-scale-census'},5000);
    ok=true;
  }catch(error){reason=String(error?.message??error);}
  finally{
    if(pending)clearTimeout(pending.timer);
    await new Promise(resolve=>{
      const timer=setTimeout(resolve,Math.max(1,Math.min(5000,workerData.fullDeadline-Date.now())));
      const finish=()=>{clearTimeout(timer);resolve();};
      if(closed)finish();else{socket.addEventListener('close',finish,{once:true});socket.close();}
    });
  }
  parentPort.postMessage({ok:ok&&closed,closed,outerMs,reason});
}

export async function composedScaleCensus(types, native, fullDeadline) {
  assert.equal(isMainThread,true);assert.equal(inspector.url(),undefined);
  const key='__legacyEngineCensus_'+randomBytes(16).toString('hex');
  const resultKey=key+'_result';
  const deadline=Math.min(Date.now()+20000,fullDeadline);
  assert.ok(deadline>Date.now());
  const modules={gameServer:{GameServer:types[0]},engine:{ServerTableEngine:types[1]},manager:{TournamentManager:types[2]},lightningWorker:{LightningClusterWorker:types[3]},lightningHost:{LightningHandHost:types[4]}};
  bindLegacyCensusModules.call(modules,key,deadline,native);
  let client;
  try{
    inspector.open(0,'127.0.0.1');
    const transport=await new Promise((resolve,reject)=>{
      client=new Worker(new URL(import.meta.url),{workerData:{scaleCensusClient:true,url:inspector.url(),fullDeadline,
        expression:`globalThis[${JSON.stringify(resultKey)}]=(${collectMarkedLegacyCensus.toString()})(${JSON.stringify(key)},${deadline});undefined`}});
      client.once('message',resolve);client.once('error',reject);
      client.once('exit',code=>{if(code!==0)reject(Error('external census client exited'));});
    });
    assert.equal(transport.ok,true,transport.reason);assert.equal(transport.closed,true);
    assert.ok(transport.outerMs>0&&transport.outerMs<=30000);
    const result=globalThis[resultKey];assert.ok(Array.isArray(result));
    assert.equal(Object.hasOwn(globalThis,key),false);
    return {result,transport};
  }finally{
    await client?.terminate();
    delete globalThis[resultKey];
    inspector.close();
    retireLegacyCensusBinding(key,deadline);
    assert.equal(inspector.url(),undefined);
  }
}
