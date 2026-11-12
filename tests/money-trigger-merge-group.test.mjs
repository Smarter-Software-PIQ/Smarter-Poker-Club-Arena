// MERGE QUEUE (2026-11-11): the trusted merge-group verdict is bound to the
// exact queued head, queue branch and migration set, and fails closed.
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groupCompletion,mergeGroupIsLive,readProtectionAndRevoke} from '../scripts/ci/money-trigger-check-report.mjs';
import {mergeGroupMigrationFiles,fixedBaseMigrationFiles} from '../scripts/ci/money-trigger-merge-group-files.mjs';
const time=1000000,head='a'.repeat(40),runId='1234',appId='4962039',repository='Smarter-Poker/Smarter-Poker-Club-Arena';
const branch='gh-readonly-queue/main/pr-1-'+'c'.repeat(40);
const path='supabase/migrations/20261111000000_x.sql',hash='b'.repeat(64);
const proof=()=>({headSha:head,runId,pr:null,mergeGroup:{branch,baseSha:'d'.repeat(40),removed:[]},results:[{recovered:false,path,sha256:hash}]});
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
 const ok=async()=>({ok:true,json:async()=>({data:{repository:{mergeQueue:{entries:{nodes:[{position:1,state:'AWAITING_CHECKS',headCommit:{oid:head},pullRequest:{number:7,isCrossRepository:false}}]}}}}})});
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:ok}),true);
 assert.equal(await mergeGroupIsLive({repository,head:'f'.repeat(40),token:'t',fetchImpl:ok}),false);
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:async()=>({ok:false})}),false);
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:async()=>({ok:true,json:async()=>({data:{repository:{mergeQueue:null}}})})}),false);
 const unmergeable=async()=>({ok:true,json:async()=>({data:{repository:{mergeQueue:{entries:{nodes:[{position:1,state:'UNMERGEABLE',headCommit:{oid:head},pullRequest:{number:7,isCrossRepository:false}}]}}}}})});
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:unmergeable}),false);
});
test('a merge group carrying any fork pull request, or an unreadable origin, is never live',async()=>{
 const other='a'.repeat(40);
 const q=nodes=>async()=>({ok:true,json:async()=>({data:{repository:{mergeQueue:{entries:{nodes}}}}})});
 const own=(position,oid,n)=>({position,state:'AWAITING_CHECKS',headCommit:{oid},pullRequest:{number:n,isCrossRepository:false}});
 // A fork entry ahead of this group is carried by it: refused.
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:q([{...own(1,other,5),pullRequest:{number:5,isCrossRepository:true}},own(2,head,7)])}),false);
 // This group's own entry from a fork: refused.
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:q([{...own(1,head,7),pullRequest:{number:7,isCrossRepository:true}}])}),false);
 // Origin missing or not a boolean: refused (fail closed).
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:q([{position:1,state:'AWAITING_CHECKS',headCommit:{oid:head}}])}),false);
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:q([{...own(1,head,7),pullRequest:{number:7,isCrossRepository:null}}])}),false);
 // A fork entry BEHIND this group is not carried by it.
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:q([own(1,head,7),{...own(2,other,9),pullRequest:{number:9,isCrossRepository:true}}])}),true);
 // Missing position: refused.
 assert.equal(await mergeGroupIsLive({repository,head,token:'t',fetchImpl:q([{state:'AWAITING_CHECKS',headCommit:{oid:head},pullRequest:{number:7,isCrossRepository:false}}])}),false);
});
test('the pull-request reporter refuses a cross-repository pull request before any check is created',()=>{
 const src=fs.readFileSync(new URL('../scripts/ci/money-trigger-check-report.mjs',import.meta.url),'utf8');
 const begin=src.slice(src.indexOf("if(process.argv[2]==='begin')"),src.indexOf("}else if(process.argv[2]==='finish')"));
 assert.ok(begin.indexOf('cross-repository pull request refused')>0&&begin.indexOf('cross-repository pull request refused')<begin.indexOf("api('check-runs','POST'"));
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

// Review finding 4 (2026-11-11): the set is bound to a fixed base and every
// migration status is either verified, bound by path, or refused.
test('a proof without its removal list cannot certify a group',async()=>{const p=proof();delete p.mergeGroup.removed;assert.equal(await verdict({proof:p}),'failure')});
test('a removed migration is part of the bound set',async()=>{
 const p=proof();p.mergeGroup.removed=['supabase/migrations/1_old.sql'];
 assert.equal(await verdict({proof:p,finalSet:[`${path}:${hash}`,'supabase/migrations/1_old.sql:removed']}),'success');
 assert.equal(await verdict({proof:p}),'failure');
 assert.equal(await verdict({finalSet:[`${path}:${hash}`,'supabase/migrations/1_old.sql:removed']}),'failure');
});
test('copied and changed migrations are verified, removals bound, other statuses refused',()=>{
 const m=(n)=>`supabase/migrations/${n}.sql`;
 const r=mergeGroupMigrationFiles([
  {filename:m('a'),status:'added'},{filename:m('b'),status:'modified'},{filename:m('c'),status:'copied'},
  {filename:m('d'),status:'changed'},{filename:m('e'),status:'removed'},
  {filename:m('f'),previous_filename:m('old_f'),status:'renamed'},
  {filename:'docs/x.md',previous_filename:m('moved_away'),status:'renamed'},
  {filename:'src/x.ts',status:'modified'},{filename:'supabase/migrations/nested/x.sql',status:'added'}]);
 assert.deepEqual(r.content,[m('a'),m('b'),m('c'),m('d'),m('f')]);
 assert.deepEqual(r.removed,[m('e'),m('moved_away'),m('old_f')]);
 assert.throws(()=>mergeGroupMigrationFiles([{filename:m('z'),status:'unchanged'}]),/unsupported migration file status/);
 assert.throws(()=>mergeGroupMigrationFiles([{filename:m('z'),status:'weird'}]),/unsupported/);
 assert.throws(()=>mergeGroupMigrationFiles(new Array(300).fill({filename:'x',status:'added'})),/truncated/);
 assert.throws(()=>mergeGroupMigrationFiles(null),/truncated/);
});
test('the fixed-base compare must still show the head strictly ahead',()=>{
 assert.deepEqual(fixedBaseMigrationFiles({status:'ahead',behind_by:0,files:[]}),{content:[],removed:[]});
 for(const cmp of [{status:'diverged',behind_by:1,files:[]},{status:'identical',behind_by:0,files:[]},{status:'behind',behind_by:2,files:[]},null])
  assert.throws(()=>fixedBaseMigrationFiles(cmp),/not ahead of its base/);
});
test('the finishing reporter re-reads against the proof base, never a moving main',()=>{
 const src=fs.readFileSync(new URL('../scripts/ci/money-trigger-check-report.mjs',import.meta.url),'utf8');
 const finish=src.slice(src.indexOf('mergeGroupIsLive({repository:repo'));
 assert.match(finish,/const base=proof\?\.mergeGroup\?\.baseSha;/);
 assert.match(finish,/api\(`compare\/\$\{base\}\.\.\.\$\{state\.head\}`\)/);
 assert.doesNotMatch(finish,/compare\/main\.\.\./);
 const prod=fs.readFileSync(new URL('../scripts/ci/produce-money-trigger-recovery.mjs',import.meta.url),'utf8');
 assert.match(prod,/group=\{branch,baseSha:cmp\.merge_base_commit\?\.sha,removed:changed\.removed\}/);
 assert.match(prod,/fixedBaseMigrationFiles\(cmp\)/);
});
