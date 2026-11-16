// Finite read-only private acquisition. The caller prepends a validated selection object.
import {readHorseJournalHandRecords, reconcileHorseJournalHand, HORSE_JOURNAL_HAND_READER_VERSION} from '/app/dist/services/horseDecisionJournal/review.js';
if(HORSE_JOURNAL_HAND_READER_VERSION !== 2 || process.env.GIT_COMMIT_SHA !== selection.sourceSha || !process.env.HORSE_DECISION_JOURNAL_DIR) throw Error('source_or_reader_refused');
if(!/^[a-f0-9]{40}$/.test(selection.sourceSha) || !Array.isArray(selection.targets) || selection.targets.length < 1 || selection.targets.length > 16 || new Set(selection.targets.map(t=>t.key)).size !== selection.targets.length) throw Error('selection_refused');
let bytes=0; const started=Date.now();
for(const target of selection.targets){
 if(!/^[a-f0-9]{64}$/.test(target.key) || Date.now()-started > 30000) throw Error('selection_bound');
 const records=readHorseJournalHandRecords(process.env.HORSE_DECISION_JOURNAL_DIR,target.key);
 bytes+=records.reduce((n,r)=>n+r.bytes,0);
 if(bytes>32*1024*1024) throw Error('byte_bound');
 if(records.some(r=>r.sourceRelease!==selection.sourceSha)) throw Error('mixed_source_refused');
 const review=reconcileHorseJournalHand(records,target.key);
 console.log(JSON.stringify({key:target.key,handId:target.handId,hand:target.hand,sourceSha:selection.sourceSha,records,review}));
}
