// Counts only. No card, board, amount or opponent identity is written out. The caller prepends `const selection={sourceSha,keys:[...],probe:bool};`
import {readHorseJournalHandRecords, HORSE_JOURNAL_HAND_READER_VERSION} from '/app/dist/services/horseDecisionJournal/review.js';
if(HORSE_JOURNAL_HAND_READER_VERSION!==2 || !/^[a-f0-9]{40}$/.test(selection.sourceSha) || !Array.isArray(selection.keys) || selection.keys.length<1 || selection.keys.length>4000) throw Error('refused');
const dir=process.env.HORSE_DECISION_JOURNAL_DIR; if(!dir) throw Error('no_dir');
const started=Date.now(), limitMs=(selection.limitSec??1100)*1000; const rows=new Map(); const keySet=new Set();
let hands=0, found=0, missing=0, otherRelease=0, decisions=0, cut=0, shape=null;
const body=r=>{const j=r.record??r.body??r.record_json??r.json??r; return typeof j==='string'?JSON.parse(j):j;};
for(const k of selection.keys){
  if(!/^[a-f0-9]{64}$/.test(k)) throw Error('key');
  if(Date.now()-started>limitMs){cut=selection.keys.length-hands; break;}
  hands++; let recs; try{recs=readHorseJournalHandRecords(dir,k);}catch(e){missing++; continue;}
  if(!recs.length){missing++; continue;} found++;
  for(const r of recs){
    if(r.kind!=='decision') continue;
    if(r.sourceRelease!==selection.sourceSha){otherRelease++; continue;}
    const b=body(r); const d=b.decision??{}; const s=b.snapshot??{}; const gs=s.gameState??{};
    if(selection.probe && !shape) shape={record:Object.keys(r),body:Object.keys(b),snapshot:Object.keys(s),player:Object.keys(s.player??{}),modeValues:[gs.gameMode,gs.format],humanIdsType:Array.isArray(gs.humanUserIds)?gs.humanUserIds.length:typeof gs.humanUserIds,gameState:Object.keys(gs).slice(0,60),decision:Object.keys(d)};
    const pl=s.player??{}; const uid=pl.userId??pl.user_id??pl.id??s.userId??'unknown';
    const id=`${uid}|${gs.gameVariant??s.gameVariant??'unknown'}|${gs.gameMode??gs.format??'unknown'}`;
    let row=rows.get(id); if(!row){row={decisions:0,humanPresent:0,rangeConsumption:0,planContext:0,keys:{}}; rows.set(id,row);}
    row.decisions++; decisions++; if(Array.isArray(gs.humanUserIds)&&gs.humanUserIds.length>0) row.humanPresent++; if(b.rangeConsumption!=null) row.rangeConsumption++; if(b.planContext!=null) row.planContext++;
    for(const key of Object.keys(d)){ if(d[key]==null) continue; keySet.add(key); row.keys[key]=(row.keys[key]??0)+1; }
  }
}
console.log(JSON.stringify({summary:{hands,found,missing,otherRelease,decisions,cutByTimeLimit:cut,ms:Date.now()-started,observedDecisionKeys:[...keySet].sort()},shape}));
if(!selection.probe) for(const [id,row] of rows) console.log(JSON.stringify({id,...row}));
else console.log(JSON.stringify({rows:rows.size,sampleIds:[...rows.keys()].slice(0,3).map(x=>x.replace(/^[^|]*/,'<id>'))}));
