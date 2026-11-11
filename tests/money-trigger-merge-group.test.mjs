// MERGE QUEUE (2026-11-11): the trusted merge-group verdict is bound to the
// exact queued head, queue branch and migration set, and fails closed.
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groupCompletion,mergeGroupIsLive,readProtectionAndRevoke} from '../scripts/ci/money-trigger-check-report.mjs';
const time=1000000,head='a'.repeat(40),runId='1234',appId='4962039',repository='Smarter-Poker/Smarter-Poker-Club-Arena';
const branch='gh-readonly-queue/main/pr-1-'+'c'.repeat(40);
const path='supabase/migrations/20261111000000_x.sql',hash='b'.repeat(64);
const proof=()=>({headSha:head,runId,pr:null,mergeGroup:{branch,baseSha:'d'.repeat(40)},results:[{recovered:false,path,sha256:hash}]});
const rule=()=>({target:'branch',enforcement:'active',bypass_actors:[],conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},rules:[{type:'required_status_checks',parameters:{required_status_checks:[{context:'Money trigger declaration authority',integration_id:4962039}]}},{type:'merge_queue',parameters:{}}]});
const protection=()=>readProtectionAndRevoke({token:'t',repository,repositoryId:'1132369872',appId,head,runId,now:()=>time,fetchImpl:async(u,i)=>i.method==='DELETE'?{status:204}:{ok:true,json:async()=>rule()}});
const state={id:1,head,appId,group:branch,runId};
const verdict=async(extra={})=>groupCompletion({state,proof:proof(),live:true,finalSet:[`${path}:${hash}`],outcome:'success',protection:await protection(),runId,appId,now:time,...extra});
test('exact live group with the same migration set succeeds (merge_queue rule present)',async()=>assert.equal(await verdict(),'success'));
test('a group no longer in the queue fails',async()=>assert.equal(await verdict({live:false}),'failure'));
test('a changed migration set fails',async()=>assert.equal(await verdict({finalSet:[`${path}:${'e'.repeat(64)}`]}),'failure'));
test('an added migration fails',async()=>assert.equal(await verdict({finalSet:[`${path}:${hash}`,'supabase/migrations/2_y.sql:'+hash]}),'failure'));
test('an unreadable migration set fails',async()=>assert.equal(await verdict({finalSet:null}),'failure'));
test('a proof for another head fails',async()=>{const p=proof();p.headSha='f'.repeat(40);assert.equal(await verdict({proof:p}),'failure')});
test('a proof for another queue branch fails',async()=>{const p=proof();p.mergeGroup.branch='gh-readonly-queue/main/pr-2-x';assert.equal(await verdict({proof:p}),'failure')});
test('a pull-request proof cannot certify a group',async()=>{const p=proof();p.pr=7;assert.equal(await verdict({proof:p}),'failure')});
test('a proof from another run fails',async()=>{const p=proof();p.runId='9';assert.equal(await verdict({proof:p}),'failure')});
test('a failed verifier outcome fails',async()=>assert.equal(await verdict({outcome:'failure'}),'failure'));
test('no protection receipt fails',async()=>assert.equal(groupCompletion({state,proof:proof(),live:true,finalSet:[`${path}:${hash}`],outcome:'success',protection:{},runId,appId,now:time}),'failure'));
test('queue liveness reads GitHub and fails closed',async()=>{
 const ok=async()=>({ok:true,json:async()=>({data:{repository:{mergeQueue:{entries:{nodes:[{state:'AWAITING_CHECKS',headCommit:{oid:head}}]}}}}})});
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:ok}),true);
 assert.equal(await mergeGroupIsLive({repository,head:'f'.repeat(40),token:'t',fetchImpl:ok}),false);
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:async()=>({ok:false})}),false);
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:async()=>({ok:true,json:async()=>({data:{repository:{mergeQueue:null}}})})}),false);
 const unmergeable=async()=>({ok:true,json:async()=>({data:{repository:{mergeQueue:{entries:{nodes:[{state:'UNMERGEABLE',headCommit:{oid:head}}]}}}}})});
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:unmergeable}),false);
});
test('the merge-group job runs only default-branch code and only for a real merge_group source',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/money-trigger-recovery.yml',import.meta.url),'utf8');
 const job=wf.slice(wf.indexOf('  verify_merge_group:'));
 assert.match(wf,/workflow_run:\n    workflows: \[Money Trigger Merge Group Request\]\n    types: \[requested\]/);
 assert.match(job,/github\.event\.workflow_run\.event == 'merge_group'/);
 assert.match(job,/github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
 assert.match(job,/startsWith\(github\.event\.workflow_run\.head_branch, 'gh-readonly-queue\/main\/'\)/);
 assert.match(job,/ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
 assert.doesNotMatch(job,/ref: \$\{\{ github\.event\.workflow_run\.head/);
 const req=fs.readFileSync(new URL('../.github/workflows/money-trigger-merge-group-request.yml',import.meta.url),'utf8');
 assert.match(req,/permissions: \{\}/);assert.doesNotMatch(req,/secrets\./);assert.doesNotMatch(req,/environment:/);
});
