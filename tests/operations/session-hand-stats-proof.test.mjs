import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitSessionHandStatsProof, assertSessionHandStatsProof, SESSION_HAND_STATS_TITLE } from '../../scripts/ci/session-hand-stats-proof.mjs';
const sha='a'.repeat(40);
const urls=['https://smarter.poker/hub/club-arena/build-info.json','https://ca-static.smarter.poker/build-info.json'];
const pin={sha,builds:urls.map(url=>({url,sha,build:{ca_sha:sha}}))};
function fixture(){
 const evidence={clientSha:sha,syntheticTransport:true,actualDatabaseProof:false,actualPublishedAssets:true,reservedActor:true,syntheticAuthentication:false,forwardedWrites:0,reloadVerified:true,finalSettlementVerified:true,surfaces:['cash','tournament'].flatMap(scope=>['player-hub','full-session-stats','final-results'].map(surface=>({scope,surface,expected:scope==='cash'?1:71,rendered:scope==='cash'?1:71}))),bracket:['before','after'].flatMap(point=>urls.map(url=>({point,origin:url.slice(0,-'/build-info.json'.length),sha,reason:null})))};
 const result={status:'passed',retry:0,errors:[],attachments:[{name:'published-session-hand-stats',contentType:'application/json',body:Buffer.from(JSON.stringify(evidence)).toString('base64')}]};
 const report={errors:[],suites:[{file:'production-session-hand-stats.spec.ts',specs:[{file:'production-session-hand-stats.spec.ts',title:SESSION_HAND_STATS_TITLE,ok:true,tests:[{projectName:'chromium',status:'expected',expectedStatus:'passed',results:[result]}]}]}]};
 return {evidence,result,report};
}
test('six published counts require exact origins, first pass and verified cleanup',()=>{
 const {report}=fixture();assert.equal(assertSessionHandStatsProof(report,pin,pin,{verified:true}).passed,1);
 assert.throws(()=>assertSessionHandStatsProof(report,pin,pin,{verified:false}));
 assert.throws(()=>assertSessionHandStatsProof(report,pin,{...pin,sha:'b'.repeat(40)},{verified:true}));
 for(let i=0;i<6;i++){const f=fixture();f.evidence.surfaces[i].rendered++;f.result.attachments[0].body=Buffer.from(JSON.stringify(f.evidence)).toString('base64');assert.throws(()=>assertSessionHandStatsProof(f.report,pin,pin,{verified:true}));}
 const local=fixture();local.evidence.syntheticAuthentication=true;local.result.attachments[0].body=Buffer.from(JSON.stringify(local.evidence)).toString('base64');assert.throws(()=>assertSessionHandStatsProof(local.report,pin,pin,{verified:true}));
 const f=fixture();f.result.retry=1;assert.throws(()=>assertSessionHandStatsProof(f.report,pin,pin,{verified:true}));
});
test('dispatch cannot select arbitrary payload or untrusted ref',()=>{
 const env={GITHUB_EVENT_NAME:'repository_dispatch',HAND_STATS_PROOF_ACTION:'run-session-hand-stats-proof',GITHUB_REPOSITORY:'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',GITHUB_REPOSITORY_ID:'1132369872',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha};
 assert.equal(admitSessionHandStatsProof({},env),true);assert.throws(()=>admitSessionHandStatsProof({test:'arbitrary'},env));assert.throws(()=>admitSessionHandStatsProof({},{...env,GITHUB_REF:'refs/heads/task'}));
});
