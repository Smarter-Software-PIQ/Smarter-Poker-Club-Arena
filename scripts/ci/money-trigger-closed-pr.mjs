// A pull request that is already closed when its trusted run starts.
//
// 2026-11-12: three runs failed in one afternoon (43267133049, 43282451815,
// 43296884003) because a pull request was merged one to six seconds after the
// event that started the run. The reporter refused it as "invalid PR state"
// and the run went red although nothing was wrong: the same head already held
// a successful check from the run that admitted the merge.
//
// A closed pull request has nothing left to prove and can never be given a
// success. So the trusted run stands down: it creates no check run, reads no
// catalogue, reports nothing, and ends without failing. Reopening the pull
// request starts a fresh run (the workflow listens for "reopened").
//
// The marker is written only by the trusted begin step, inside a job whose
// workspace is main's checkout (pull_request_target never checks out pull
// request code), and is honoured only for the same run and the same pull
// request number.
import fs from 'node:fs';
export const SKIP_FILE='money-trigger-check-skipped.json';
// Decide what begin does with the pull request it was started for.
// Every refusal that existed for an open pull request is kept.
export function beginAdmission(pr,repo,repositoryId){
 if(pr?.base?.ref!=='main')throw Error('invalid PR state');
 if(pr.state==='closed')return 'closed';
 if(pr.state!=='open')throw Error('invalid PR state');
 if(pr.head?.repo?.full_name!==repo||String(pr.head?.repo?.id)!==String(repositoryId))throw Error('cross-repository pull request refused');
 return 'open';
}
export function writeSkip({pr,merged,runId,file=SKIP_FILE}){
 fs.writeFileSync(file,JSON.stringify({pr:Number(pr),state:'closed',merged:merged===true,runId:String(runId)}));
}
// True only for the marker this same run wrote for this same pull request.
export function stoodDown({pr,runId,file=SKIP_FILE}){
 if(!fs.existsSync(file))return false;
 try{
  const m=JSON.parse(fs.readFileSync(file,'utf8'));
  return m.state==='closed'&&/^\d+$/.test(String(runId||''))&&m.runId===String(runId)&&/^\d+$/.test(String(pr||''))&&m.pr===Number(pr);
 }catch{return false}
}
