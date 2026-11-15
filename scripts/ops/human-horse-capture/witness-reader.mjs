// Witness chain per Horse decision in human-facing hands. Private output (IDs kept; no hole cards, no board cards written).
// The caller prepends `const selection={sourceSha,hands:[{k,h}],limitSec};`
import {readHorseJournalHandRecords, reconcileHorseJournalHand, HORSE_JOURNAL_HAND_READER_VERSION} from '/app/dist/services/horseDecisionJournal/review.js';
if(HORSE_JOURNAL_HAND_READER_VERSION!==2 || !/^[a-f0-9]{40}$/.test(selection.sourceSha) || !Array.isArray(selection.hands) || selection.hands.length<1 || selection.hands.length>2500) throw Error('refused');
let ER=null, ERerr=null; try{ const [L,M,X,F,E,I]=await Promise.all(['HorseLogic','HorseMind','HorseOpponentExploit','HorseDecisionReadFrame','HorseDecisionEffects','HorsePlanHandIdentity'].map(n=>import('/app/dist/engine/'+n+'.js'))); ER={L,M,X,F,E,I}; }catch(e){ ERerr=String(e.message).slice(0,160); }
let SR=null; try{ SR=await import('/app/dist/engine/HorseOpponentStyle.js'); }catch(e){ SR=null; }  // style reads exist from 06d45e7d; absent on older builds (style:null)
// Style read (recognition only): HorseMind.styleRead on the same read frame, and whether the tight opener / re-raiser respect predicates hold. Per-decision fire counters are process-level and not journaled.
const styleOf=(M,opp)=>{ if(!SR||typeof M.HorseMind.styleRead!=='function') return null; try{ const s=M.HorseMind.styleRead(opp); const r=x=>x==null?null:Math.round(x*1000)/1000;
  return {participation:s.participation?.side??null,participationConf:r(s.participation?.confidence),pfr:s.signals?.pfr?.side??null,pfrMean:r(s.signals?.pfr?.mean),threeBet:s.signals?.threeBet?.side??null,confidenceCap:r(s.confidenceCap),release:r(s.release?.fraction),reason:s.reason??null,
    tightOpenerRespect:!!SR.tightOpenerRespect(s),tightReRaiserRespect:!!SR.tightReRaiserRespect(s)}; }catch(e){ return {error:String(e.message).slice(0,120)}; } };
// Engine read recomputed with the serving code from the decision's own read frame (fixed input). Null with a reason when it cannot be done.
const engineRead=(b,opp)=>{ if(!opp) return null; if(!ER) return {error:ERerr}; const {L,M,X,F,E,I}=ER; try{ const req=b.snapshot, gs=req.gameState; const pc=I.horsePlanBatchBindingFromRequest(req).planContext;
  const view=F.decodeHorseDecisionReads(b.readFrame,gs.players,E.horsePlanHandKey(gs.actionHistory,pc),pc);
  return M.HorseMind.runInSandbox(view,()=>{ try{ L.HorseLogic.prepareOriginalReads(req.player,gs,{}); const r=M.HorseMind.opponentRead(opp); const style=styleOf(M,opp); if(!r) return {read:null,style};
    const eng=Object.fromEntries(Object.entries(r.stats??{}).filter(([,s])=>s&&s.engaged).map(([k,s])=>[k,{engaged:s.engaged,n:Math.round((s.n??0)*10)/10,mean:Math.round((s.mean??0)*1000)/1000}]));
    return {read:true,presumed:r.presumed===true,maniacRaiseWidth:X.maniacRaiseWidth(r),postflopManiac:X.isPostflopManiac(r),station:X.isStation(r),aggressor:X.isAggressor(r),overFolder:r.stats?.foldToBet?.engaged==='high',engaged:eng,style}; } finally { M.HorseMind.setDecisionScope(null); } });
 }catch(e){ return {error:String(e.message).slice(0,160)}; } };
const dir=process.env.HORSE_DECISION_JOURNAL_DIR; const P=r=>typeof r.body==='string'?JSON.parse(r.body):r.body;
const AGG=new Set(['bet','raise','all_in','allin','all-in']); const started=Date.now(); const lim=(selection.limitSec??1100)*1000;
const sum={hands:0,missing:0,otherRelease:0,decisions:0,humanAble:0,vsHumanAggressor:0,cut:0,reviewStatus:{}};
for(const t of selection.hands){
  if(Date.now()-started>lim){sum.cut=selection.hands.length-sum.hands; break;}
  sum.hands++; let recs; try{recs=readHorseJournalHandRecords(dir,t.k);}catch(e){sum.missing++; console.log(JSON.stringify({hand:t.h,key:t.k,error:String(e.message).slice(0,80)})); continue;}
  if(!recs.length){sum.missing++; console.log(JSON.stringify({hand:t.h,key:t.k,error:'no_records'})); continue;}
  if(recs.some(r=>r.sourceRelease!==selection.sourceSha)){sum.otherRelease++;}
  let rev=null; try{rev=reconcileHorseJournalHand(recs,t.k);}catch(e){rev={status:'review_error'};}
  sum.reviewStatus[rev.status]=(sum.reviewStatus[rev.status]??0)+1;
  const exec=new Map(); for(const r of recs) if(r.kind==='execution'){const b=P(r); exec.set(r.turnKey,b);}
  const acc=recs.find(r=>r.kind==='accepted_hand'); const accB=acc?P(acc):null;
  for(const r of recs){ if(r.kind!=='decision'||r.sourceRelease!==selection.sourceSha) continue; const b=P(r); const s=b.snapshot; if(!s) continue; const gs=s.gameState; sum.decisions++;
    const humans=new Set(gs.humanUserIds??[]); const pl=new Map((gs.players??[]).map(p=>[p.user_id,p]));
    const able=[...humans].filter(u=>{const p=pl.get(u); return p&&!p.is_folded&&!p.is_all_in&&!p.is_sitting_out;});
    const hist=(gs.actionHistory??[]); const street=hist.filter(x=>x.stage===gs.stage&&!x.dead); let lastAgg=null; for(const x of street) if(AGG.has(String(x.action).toLowerCase())) lastAgg=x;
    if(!lastAgg&&gs.stage==='preflop') lastAgg=null;
    const inHand=u=>{const p=pl.get(u); return !!p&&!p.is_folded&&!p.is_sitting_out;}; const live=u=>inHand(u)&&!pl.get(u).is_all_in;
    const faced=lastAgg&&Number(gs.toCall??0)>0?lastAgg.userId:null; const opp=faced&&humans.has(faced)?faced:null; if(able.length) sum.humanAble++; if(opp) sum.vsHumanAggressor++;
    const REPAIR=Date.parse('2026-11-13T08:08:00Z');
    const humansInHand=[...humans].map(u=>{const p=pl.get(u); const mine=hist.filter(x=>x.userId===u); const origins=[...new Set(mine.map(x=>x.origin??'unknown'))];
      return {userId:u,dealt:!!p,folded:!!p?.is_folded,allIn:!!p?.is_all_in,sittingOut:!!p?.is_sitting_out,faced:u===faced,type:u===faced?'faces_human_wager':(p&&live(u)?'human_live_not_faced':'human_out_or_all_in'),
        origins,actedVoluntarily:mine.some(x=>x.origin==='player'||x.origin==='pre_action')};});
    let frame=null; try{frame=JSON.parse(b.readFrame?.json??'null');}catch{}
    const tallies=u=>{ if(!frame||!u) return null; const hit=(frame.exploit??[]).filter(([k])=>String(k).includes(u)); if(!hit.length) return {present:false};
      return {present:true,entries:hit.map(([k,v])=>{let a=v; try{a=JSON.parse(v);}catch{} return {scope:String(k).split('|')[0],fields:Array.isArray(a)?a.length:null,decayedHands:Array.isArray(a)&&typeof a[0]==='number'?Math.round(a[0]*10)/10:null};}),
        stats:(()=>{const s=(frame.stats??[]).find(([k])=>k===u); if(!s) return null; let a=s[1]; try{a=JSON.parse(a);}catch{} return Array.isArray(a)?{fields:a.length,first:a[0]}:null;})()}; };
    const d=b.decision; const tr=(d.policyGraph?.transitions??[]); const e=exec.get(r.turnKey);
    const potBefore=Number(gs.pot??0); const big=lastAgg&&potBefore>0? Number(lastAgg.amount??0)/Math.max(1,potBefore-Number(lastAgg.amount??0)) : null;
    console.log(JSON.stringify({hand:t.h,key:t.k,turnKey:r.turnKey,eventId:r.eventId,producerId:r.producerId,atMs:r.atMs,release:r.sourceRelease,horse:s.player?.user_id,variant:gs.gameVariant,mode:gs.gameMode,stage:gs.stage,
      toCall:gs.toCall,pot:gs.pot,bigBlind:gs.bigBlind,stack:s.player?.stack,playersIn:(gs.players??[]).filter(p=>!p.is_folded).length,legal:gs.legalActions,
      humansAble:able,humansInHand,facedInHand:faced?inHand(faced):null,dealtCount:(gs.dealtSeatIds??gs.players??[]).length,lastAggressor:lastAgg?{userId:lastAgg.userId,action:lastAgg.action,stage:lastAgg.stage,human:humans.has(lastAgg.userId),origin:lastAgg.origin??null,betToPotBefore:big}:null,opponent:opp,
      engineInput:{observer:b.observerReads?{disposition:b.observerReads.disposition,history:b.observerReads.history,historyHands:b.observerReads.historyHands,learnedThroughMs:b.observerReads.learnedThroughMs,cutoffMs:b.observerReads.cutoffMs}:null,opponentTallies:tallies(opp),engineRead:engineRead(b,opp),perHuman:Object.fromEntries(humansInHand.filter(h=>h.dealt).map(h=>[h.userId,{read:engineRead(b,h.userId),tallies:tallies(h.userId)}])),learnedAfterRepair:(b.observerReads?.learnedThroughMs??0)>REPAIR,planReads:b.planReads?.status??null},
      receipts:Object.keys(d).filter(k=>d[k]!=null&&!['action','amount','thinkTime'].includes(k)),preflopContext:d.preflopAuthority?.context??null,preflopEvents:Array.isArray(d.preflopAuthority?.events)?d.preflopAuthority.events.map(e=>({branch:e.branch,strength:e.strength,threeBetThreshold:e.threeBetThreshold,effectiveThreeBetThreshold:e.effectiveThreeBetThreshold,premiumValue:e.premiumValue,pressure:e.pressure})):null,
      proposal:tr[0]?.after??null,changes:tr.filter(x=>x.changed).map(x=>({node:x.node,after:x.after})),final:d.policyGraph?.finalAction??{action:d.action,amount:d.amount},
      execution:e?{status:e.executionStatus,action:e.executedAction,amount:e.executedAmount,intended:(e.acceptedActions??[]).some(a=>a.intended),committed:e.committedHand?.status,anchorActor:e.handAnchor?.actorId,ordinal:e.handAnchor?.actionOrdinal}:null,
      acceptedHand:accB?{committedHandId:accB.committedHandId,actions:(accB.actions??[]).length}:null,review:{status:rev.status,matched:rev.matchedActions,accepted:rev.acceptedHorseActions,gaps:(rev.gaps??[]).length}}));
  }
}
console.log(JSON.stringify({summary:{...sum,ms:Date.now()-started}}));
