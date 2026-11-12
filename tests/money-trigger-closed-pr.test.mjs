// 2026-11-12: a pull request merged seconds after the event that started its
// trusted run made the reporter fail with "invalid PR state" (runs 43267133049,
// 43282451815, 43296884003). A closed pull request now stands the run down:
// no check run, no catalogue read, no report, no failure, and never a success.
// The process cases run the REAL scripts with only fetch replaced.
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {beginAdmission,stoodDown,writeSkip,SKIP_FILE} from '../scripts/ci/money-trigger-closed-pr.mjs';
import {completion,readProtectionAndRevoke} from '../scripts/ci/money-trigger-check-report.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo='Smarter-Software-PIQ/Smarter-Poker-Club-Arena',repoId='1132369872',appId='4962039',runId='555',head='a'.repeat(40);
const pull=(over={})=>({number:9,state:'open',merged:false,base:{ref:'main'},head:{sha:head,repo:{full_name:repo,id:Number(repoId)}},...over});
function run(script,arg,pr,dir,env={}){
 const log=path.join(dir,'calls.jsonl');
 const r=spawnSync(process.execPath,['--import',path.join(root,'tests/fixtures/money-trigger-stub-fetch.mjs'),path.join(root,'scripts/ci',script),...(arg?[arg]:[])],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,GITHUB_REPOSITORY:repo,GITHUB_REPOSITORY_ID:repoId,PR_NUMBER:'9',REPORTER_APP_ID:appId,REPORTER_TOKEN:'reporter',GITHUB_TOKEN:'job',GITHUB_RUN_ID:runId,GITHUB_EVENT_NAME:'pull_request_target',GITHUB_OUTPUT:path.join(dir,'out'),STUB_PR:JSON.stringify(pr),STUB_LOG:log,...env}});
 const calls=fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
 return {status:r.status,out:r.stdout+r.stderr,calls};
}
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'mt-closed-'));
const writes=c=>c.filter(x=>x.method!=='GET');

test('an open pull request on main is admitted exactly as before',()=>assert.equal(beginAdmission(pull(),repo,repoId),'open'));
test('a merged pull request stands down',()=>assert.equal(beginAdmission(pull({state:'closed',merged:true}),repo,repoId),'closed'));
test('a closed, unmerged pull request stands down',()=>assert.equal(beginAdmission(pull({state:'closed'}),repo,repoId),'closed'));
test('a base other than main is still refused, open or closed',()=>{
 assert.throws(()=>beginAdmission(pull({base:{ref:'dev'}}),repo,repoId),/invalid PR state/);
 assert.throws(()=>beginAdmission(pull({state:'closed',merged:true,base:{ref:'dev'}}),repo,repoId),/invalid PR state/);
});
test('an unknown state is still refused',()=>assert.throws(()=>beginAdmission(pull({state:'draft'}),repo,repoId),/invalid PR state/));
test('an open fork pull request is still refused',()=>assert.throws(()=>beginAdmission(pull({head:{sha:head,repo:{full_name:'x/y',id:1}}}),repo,repoId),/cross-repository/));

for(const [name,pr] of [['merged',pull({state:'closed',merged:true})],['closed without merge',pull({state:'closed'})]]){
 test(`real scripts, pull request ${name} before the run began: no check, no proof, no report, no failure`,()=>{
  const dir=tmp();
  const b=run('money-trigger-check-report.mjs','begin',pr,dir);
  assert.equal(b.status,0,b.out);assert.equal(writes(b.calls).length,0,'begin must not create a check run');
  assert.ok(fs.existsSync(path.join(dir,SKIP_FILE)));assert.ok(!fs.existsSync(path.join(dir,'money-trigger-check-state.json')));
  fs.rmSync(path.join(dir,'calls.jsonl'));
  const p=run('produce-money-trigger-recovery.mjs',null,pr,dir,{SUPABASE_URL:'https://kuklfnapbkmacvwxktbh.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'never-used'});
  assert.equal(p.status,0,p.out);assert.equal(p.calls.length,0,'the proof step must read nothing');
  assert.ok(!fs.existsSync(path.join(dir,'money-trigger-recovery.json')),'no proof may exist');
  const f=run('money-trigger-check-report.mjs','finish',pr,dir,{VERIFY_OUTCOME:'success',PROTECTION_READER_TOKEN:'reader'});
  assert.equal(f.status,0,f.out);
  assert.deepEqual(writes(f.calls).map(x=>`${x.method} ${x.url}`),['DELETE https://api.github.com/installation/token'],'only the reader revocation; no check update');
  assert.ok(!fs.existsSync(path.join(dir,'money-trigger-check-result.json')),'no success or any other verdict is recorded');
 });
}
test('real script, open pull request: begin creates the in-progress check on the captured head, as before',()=>{
 const dir=tmp();const b=run('money-trigger-check-report.mjs','begin',pull(),dir);
 assert.equal(b.status,0,b.out);
 assert.deepEqual(writes(b.calls).map(x=>x.method),['POST']);
 const state=JSON.parse(fs.readFileSync(path.join(dir,'money-trigger-check-state.json'),'utf8'));
 assert.equal(state.head,head);assert.equal(state.runId,runId);assert.ok(!fs.existsSync(path.join(dir,SKIP_FILE)));
});
test('real script, open fork pull request: refused, no check created',()=>{
 const dir=tmp();const b=run('money-trigger-check-report.mjs','begin',pull({head:{sha:head,repo:{full_name:'x/y',id:1}}}),dir);
 assert.notEqual(b.status,0);assert.match(b.out,/cross-repository/);assert.equal(writes(b.calls).length,0);
});
test('real script, finish with nothing started and no stand-down still fails',()=>{
 const dir=tmp();const f=run('money-trigger-check-report.mjs','finish',pull(),dir,{VERIFY_OUTCOME:'success'});
 assert.notEqual(f.status,0);assert.match(f.out,/no started check/);
});
test('a stand-down from another run or another pull request is not honoured',()=>{
 const dir=tmp();
 writeSkip({pr:9,merged:true,runId:'111',file:path.join(dir,SKIP_FILE)});
 assert.equal(stoodDown({pr:'9',runId,file:path.join(dir,SKIP_FILE)}),false);
 assert.notEqual(run('money-trigger-check-report.mjs','finish',pull({state:'closed',merged:true}),dir,{VERIFY_OUTCOME:'success'}).status,0);
 writeSkip({pr:8,merged:true,runId,file:path.join(dir,SKIP_FILE)});
 assert.equal(stoodDown({pr:'9',runId,file:path.join(dir,SKIP_FILE)}),false);
 const p=run('produce-money-trigger-recovery.mjs',null,pull({state:'closed',merged:true}),dir);
 assert.notEqual(p.status,0);assert.match(p.out,/unsupported PR/);
 fs.writeFileSync(path.join(dir,SKIP_FILE),'not json');assert.equal(stoodDown({pr:'9',runId,file:path.join(dir,SKIP_FILE)}),false);
});
test('a head that advanced, or a pull request closed during the run, still gets no success',async()=>{
 const rule=()=>({target:'branch',enforcement:'active',bypass_actors:[],conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},rules:[{type:'required_status_checks',parameters:{required_status_checks:[{context:'Money trigger declaration authority',integration_id:4962039}]}},{type:'merge_queue',parameters:{}}]});
 const receipt=()=>readProtectionAndRevoke({token:'t',repository:repo,repositoryId:repoId,appId,head,runId,now:()=>1000,fetchImpl:async(u,i)=>i.method==='DELETE'?{status:204}:{ok:true,json:async()=>rule()}});
 const proof={headSha:head,runId,results:[{recovered:false}]};
 assert.equal(completion({capturedHead:head,currentHead:head,outcome:'success',proof,protection:await receipt(),runId,appId,now:1000}),'success');
 assert.equal(completion({capturedHead:head,currentHead:'b'.repeat(40),outcome:'success',proof,protection:await receipt(),runId,appId,now:1000}),'failure');
 assert.equal(completion({capturedHead:head,currentHead:null,outcome:'success',proof,protection:await receipt(),runId,appId,now:1000}),'failure');
});
