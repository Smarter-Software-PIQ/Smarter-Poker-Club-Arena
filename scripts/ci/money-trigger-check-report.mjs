import {isClubArenaRepository} from './repository-identity.mjs';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {assertProtection} from './assert-money-trigger-protection.mjs';
import {beginAdmission,writeSkip,stoodDown} from './money-trigger-closed-pr.mjs';
export const CHECK_NAME='Money trigger declaration authority';
const protectionReads=new WeakMap();
// A receipt exists only in this trusted process, after both a real ruleset
// read and successful token revocation. No JSON/input/env flag can mint it.
export async function readProtectionAndRevoke({token,repository,repositoryId,appId,head,runId,fetchImpl=fetch,now=Date.now}){
 if(!token)throw Error('missing narrowly scoped protection reader token');
 let observedAt;
 try{
  if(!isClubArenaRepository(repository,repositoryId)||!/^\d+$/.test(runId||'')||!/^[a-f0-9]{40}$/.test(head||''))throw Error('invalid protection read identity');
  const response=await fetchImpl(`https://api.github.com/repos/${repository}/rulesets/21163380`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`protection read failed ${response.status}`);
  assertProtection(await response.json(),appId);
  observedAt=now();
 }finally{
  // Use this token only for the fixed GET above and its own revocation.
  // The action's automatic cleanup remains enabled if this process is killed.
  const revoked=await fetchImpl('https://api.github.com/installation/token',{method:'DELETE',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(revoked.status!==204)throw Error(`protection reader revocation failed ${revoked.status}`);
 }
 const receipt=Object.freeze({});
 protectionReads.set(receipt,{repository,repositoryId,appId,head,runId,observedAt});
 return receipt;
}
export function completion({capturedHead,currentHead,outcome,proof,protection,runId,appId,now=Date.now()}){
 const read=protection&&typeof protection==='object'?protectionReads.get(protection):null;
 if(read)protectionReads.delete(protection);
 if(!read||!isClubArenaRepository(read.repository,read.repositoryId)||read.head!==capturedHead||read.runId!==runId||read.appId!==appId||!Number.isFinite(read.observedAt)||now<read.observedAt||now>=read.observedAt+300000)return 'failure';
 if(outcome!=='success'||currentHead!==capturedHead||proof?.headSha!==capturedHead||proof?.runId!==runId)return 'failure';
 if(proof.results.some(x=>x.recovered)){
  const observed=Date.parse(proof.catalogObservedAt),expiry=Date.parse(proof.expiresAt);
  if(!Number.isFinite(observed)||expiry!==observed+300000||now<observed||now>=expiry)return 'failure';
 }
 return 'success';
}
// MERGE QUEUE (2026-11-11). A merge-group verdict is bound to the exact queued
// head SHA, its queue branch and the exact migration set (path and bytes) that
// commit adds over main. It is a success only when the group is still live in
// the queue with that head, the trusted proof names the same head, branch and
// run, and the migration set read again at finish equals the proof's. Anything
// unreadable, stale or different is a failure: fail closed.
export function groupCompletion({state,proof,live,finalSet,outcome,protection,runId,appId,now=Date.now()}){
 const branchOk=typeof state?.group==='string'&&proof?.mergeGroup?.branch===state.group&&proof?.pr===null;
 const removed=proof?.mergeGroup?.removed;
 const proofSet=Array.isArray(proof?.results)&&Array.isArray(removed)?[...proof.results.map(r=>`${r.path}:${r.sha256}`),...removed.map(p=>`${p}:removed`)].sort():null;
 const setOk=Array.isArray(finalSet)&&proofSet!==null&&finalSet.length===proofSet.length&&[...finalSet].sort().every((x,i)=>x===proofSet[i]);
 const currentHead=live===true&&branchOk&&setOk?state.head:null;
 return completion({capturedHead:state?.head,currentHead,outcome,proof,protection,runId,appId,now});
}
export async function mergeGroupIsLive({repository,head,token,fetchImpl=fetch}){
 const [owner,name]=String(repository).split('/');
 const r=await fetchImpl('https://api.github.com/graphql',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000),body:JSON.stringify({query:'query($o:String!,$n:String!){repository(owner:$o,name:$n){mergeQueue(branch:"main"){entries(first:100){nodes{position state headCommit{oid} pullRequest{number isCrossRepository}}}}}}',variables:{o:owner,n:name}})});
 if(!r.ok)return false;
 const nodes=(await r.json())?.data?.repository?.mergeQueue?.entries?.nodes;
 if(!Array.isArray(nodes))return false;
 const entry=nodes.find(n=>n?.headCommit?.oid===head);
 if(!entry||entry.state==='UNMERGEABLE'||!Number.isInteger(entry.position))return false;
 // A merge group carries every entry ahead of it. A pull request from a fork
 // is never vouched for: if any entry up to and including this one is
 // cross-repository, or its origin cannot be read, the group is not live.
 return nodes.filter(n=>Number.isInteger(n?.position)&&n.position<=entry.position)
  .every(n=>n?.pullRequest?.isCrossRepository===false);
}
async function main(){
 const repo=process.env.GITHUB_REPOSITORY,number=process.env.PR_NUMBER,appId=process.env.REPORTER_APP_ID;
 const groupMode=['begin-group','finish-group'].includes(process.argv[2]);
 if(!isClubArenaRepository(repo,process.env.GITHUB_REPOSITORY_ID)||(!groupMode&&!/^\d+$/.test(number||''))||!/^\d+$/.test(appId||''))throw Error('invalid reporting identity');
 const token=process.env.REPORTER_TOKEN;if(!token)throw Error('missing restricted reporter token');
 async function api(p,method='GET',body,accept='application/vnd.github+json'){const r=await fetch(`https://api.github.com/repos/${repo}/${p}`,{method,headers:{Authorization:`Bearer ${method==='GET'?process.env.GITHUB_TOKEN:token}`,Accept:accept,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(`reporting failed ${r.status}`);return r.json()}
 if(process.argv[2]==='begin'){
  // Defence in depth beside the workflow's own fork refusal: a fork's pull
  // request never receives this check, so it can never satisfy it
  // (beginAdmission keeps that refusal and the main-only base).
  const pr=await api(`pulls/${number}`);
  if(beginAdmission(pr,repo,process.env.GITHUB_REPOSITORY_ID)==='closed'){
   // Closed before this run began (merged seconds after the event that
   // started it, or closed): no check run is created and no success exists.
   writeSkip({pr:number,merged:pr.merged,runId:process.env.GITHUB_RUN_ID});
   console.log(`::notice::Pull request #${number} was already ${pr.merged===true?'merged':'closed'} when this run began: no check is created and nothing is reported.`);
   return;
  }
  // Kept inline as well: the refusal stands directly before the only call that creates a check.
  if(pr.head?.repo?.full_name!==repo||String(pr.head?.repo?.id)!==String(process.env.GITHUB_REPOSITORY_ID))throw Error('cross-repository pull request refused');
  const result=await api('check-runs','POST',{name:CHECK_NAME,head_sha:pr.head.sha,status:'in_progress',external_id:`money-trigger-${process.env.GITHUB_RUN_ID}`,details_url:`https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`});
  if(result.head_sha!==pr.head.sha||String(result.app?.id)!==appId)throw Error('wrong check source/head');
  fs.writeFileSync('money-trigger-check-state.json',JSON.stringify({id:result.id,head:pr.head.sha,appId,pr:Number(number),runId:process.env.GITHUB_RUN_ID}));
 }else if(process.argv[2]==='finish'){
  if(!fs.existsSync('money-trigger-check-state.json')){
   if(stoodDown({pr:number,runId:process.env.GITHUB_RUN_ID})){
    // The run stood down at begin. Nothing was started, so nothing is
    // reported. A protection reader minted meanwhile is revoked at once and
    // never used to read; the action's own cleanup remains as the backstop.
    const reader=process.env.PROTECTION_READER_TOKEN;delete process.env.PROTECTION_READER_TOKEN;
    if(reader){try{const r=await fetch('https://api.github.com/installation/token',{method:'DELETE',headers:{Authorization:`Bearer ${reader}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});if(r.status!==204)console.error(`protection reader revocation returned ${r.status}; automatic cleanup remains`);}catch{console.error('protection reader revocation failed; automatic cleanup remains');}}
    console.log(`::notice::Pull request #${number} was closed before this run began: no check was started and none is reported.`);
    return;
   }
   throw Error('no started check; no success can be reported');
  }
  const state=JSON.parse(fs.readFileSync('money-trigger-check-state.json'));
  const proof=fs.existsSync('money-trigger-recovery.json')?JSON.parse(fs.readFileSync('money-trigger-recovery.json')):null;
  let protection;
  try{protection=await readProtectionAndRevoke({token:process.env.PROTECTION_READER_TOKEN,repository:repo,repositoryId:process.env.GITHUB_REPOSITORY_ID,appId,head:state.head,runId:state.runId});}
  catch{console.error('Full protection read or reader revocation failed; no success can be reported.');}
  finally{delete process.env.PROTECTION_READER_TOKEN;}
  const pr=await api(`pulls/${number}`);
  const capturedIdentity=state.runId===process.env.GITHUB_RUN_ID&&state.appId===appId&&state.pr===Number(number);
  const conclusion=completion({capturedHead:state.head,currentHead:pr.state==='open'?pr.head.sha:null,outcome:capturedIdentity?process.env.VERIFY_OUTCOME:'failure',proof,protection,runId:process.env.GITHUB_RUN_ID,appId});
  const result=await api(`check-runs/${state.id}`,'PATCH',{status:'completed',conclusion,output:{title:CHECK_NAME,summary:conclusion==='success'?'Exact captured PR-head SQL and current App-bound no-bypass main protection verified by trusted default-branch code; protection reader revoked before completion. Recovered objects matched current history, trigger and registry evidence.':'Verification failed, was canceled, became stale, or PR head advanced. No success for the new head.'}});
  if(result.head_sha!==state.head||String(result.app?.id)!==appId||result.conclusion!==conclusion)throw Error('report acknowledgement differs');
  fs.writeFileSync('money-trigger-check-result.json',JSON.stringify({head:state.head,checkId:result.id,appId:result.app.id,conclusion,name:CHECK_NAME}));
  if(conclusion!=='success')process.exitCode=1;
 }else if(process.argv[2]==='begin-group'){
  const head=process.env.GROUP_HEAD_SHA,branch=process.env.GROUP_BRANCH||'';
  if(process.env.GITHUB_EVENT_NAME!=='workflow_run'||process.env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(head||'')||!/^gh-readonly-queue\/main\/[A-Za-z0-9._\/-]+$/.test(branch))throw Error('invalid merge group identity');
  const result=await api('check-runs','POST',{name:CHECK_NAME,head_sha:head,status:'in_progress',external_id:`money-trigger-group-${process.env.GITHUB_RUN_ID}`,details_url:`https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`});
  if(result.head_sha!==head||String(result.app?.id)!==appId)throw Error('wrong check source/head');
  fs.writeFileSync('money-trigger-check-state.json',JSON.stringify({id:result.id,head,appId,group:branch,runId:process.env.GITHUB_RUN_ID}));
 }else if(process.argv[2]==='finish-group'){
  if(!fs.existsSync('money-trigger-check-state.json'))throw Error('no started check; no success can be reported');
  const state=JSON.parse(fs.readFileSync('money-trigger-check-state.json'));
  const proof=fs.existsSync('money-trigger-recovery.json')?JSON.parse(fs.readFileSync('money-trigger-recovery.json')):null;
  let protection;
  try{protection=await readProtectionAndRevoke({token:process.env.PROTECTION_READER_TOKEN,repository:repo,repositoryId:process.env.GITHUB_REPOSITORY_ID,appId,head:state.head,runId:state.runId});}
  catch{console.error('Full protection read or reader revocation failed; no success can be reported.');}
  finally{delete process.env.PROTECTION_READER_TOKEN;}
  let live=false,finalSet=null;
  try{
   live=await mergeGroupIsLive({repository:repo,head:state.head,token:process.env.GITHUB_TOKEN});
   // Re-read against the FIXED base the trusted proof recorded, not a moving
   // main: a group ahead of this one merging mid-run must not change the set.
   const base=proof?.mergeGroup?.baseSha;
   if(/^[a-f0-9]{40}$/.test(base||'')&&base!==state.head){
    const {fixedBaseMigrationFiles}=await import('./money-trigger-merge-group-files.mjs');
    const changed=fixedBaseMigrationFiles(await api(`compare/${base}...${state.head}`));
    const {readMigrationContent}=await import('./read-migration-content.mjs');
    const {sha256}=await import('./money-trigger-recovery.mjs');
    const read=[];
    for(const p of changed.content)read.push(`${p}:${sha256(await readMigrationContent((q,a)=>api(q,'GET',undefined,a),p,state.head))}`);
    for(const p of changed.removed)read.push(`${p}:removed`);
    finalSet=read;
   }
  }catch{console.error('Merge group liveness or migration set could not be re-read; no success can be reported.');}
  const capturedIdentity=state.runId===process.env.GITHUB_RUN_ID&&state.appId===appId;
  const conclusion=groupCompletion({state,proof,live,finalSet,outcome:capturedIdentity?process.env.VERIFY_OUTCOME:'failure',protection,runId:process.env.GITHUB_RUN_ID,appId});
  const result=await api(`check-runs/${state.id}`,'PATCH',{status:'completed',conclusion,output:{title:CHECK_NAME,summary:conclusion==='success'?'Exact queued merge-group head and migration set verified by trusted default-branch code against current App-bound no-bypass main protection; protection reader revoked before completion.':'Verification failed, was canceled, became stale, the group left the queue, or its migration set changed. No success for this merge group.'}});
  if(result.head_sha!==state.head||String(result.app?.id)!==appId||result.conclusion!==conclusion)throw Error('report acknowledgement differs');
  fs.writeFileSync('money-trigger-check-result.json',JSON.stringify({head:state.head,checkId:result.id,appId:result.app.id,conclusion,name:CHECK_NAME,group:state.group}));
  if(conclusion!=='success')process.exitCode=1;
 }else throw Error('expected begin/finish/begin-group/finish-group');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
