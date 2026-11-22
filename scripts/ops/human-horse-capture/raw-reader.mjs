// Full-record journal reader for targeted offline replay and blind-review extraction.
// Private output (0400/0600 only; never public). The caller prepends `const selection={sourceSha,hands:[{k,h,handNumber?}],limitSec};`
import {readHorseJournalHandRecords, reconcileHorseJournalHand, HORSE_JOURNAL_HAND_READER_VERSION} from '/app/dist/services/horseDecisionJournal/review.js';
if (HORSE_JOURNAL_HAND_READER_VERSION !== 2 || !/^[a-f0-9]{40}$/.test(selection.sourceSha) || !Array.isArray(selection.hands) || selection.hands.length < 1 || selection.hands.length > 500) {
  throw Error('refused');
}
const dir = process.env.HORSE_DECISION_JOURNAL_DIR;
const started = Date.now();
const lim = (selection.limitSec ?? 900) * 1000;
const sum = {hands: 0, missing: 0, otherRelease: 0, records: 0, cut: 0, reviewStatus: {}};
for (const t of selection.hands) {
  if (Date.now() - started > lim) {
    sum.cut = selection.hands.length - sum.hands;
    break;
  }
  sum.hands++;
  let recs;
  try {
    recs = readHorseJournalHandRecords(dir, t.k);
  } catch (e) {
    sum.missing++;
    console.log(JSON.stringify({hand: t.h, handNumber: t.handNumber ?? null, key: t.k, error: String(e.message).slice(0, 120)}));
    continue;
  }
  if (!recs.length) {
    sum.missing++;
    console.log(JSON.stringify({hand: t.h, handNumber: t.handNumber ?? null, key: t.k, error: 'no_records'}));
    continue;
  }
  if (recs.some((r) => r.sourceRelease !== selection.sourceSha)) {
    sum.otherRelease++;
  }
  let rev = null;
  try {
    rev = reconcileHorseJournalHand(recs, t.k);
  } catch {
    rev = {status: 'review_error', gaps: []};
  }
  sum.reviewStatus[rev.status] = (sum.reviewStatus[rev.status] ?? 0) + 1;
  for (const r of recs) {
    sum.records++;
    console.log(JSON.stringify({hand: t.h, handNumber: t.handNumber ?? null, key: t.k, record: r}));
  }
  console.log(JSON.stringify({hand: t.h, handNumber: t.handNumber ?? null, key: t.k, handSummary: {records: recs.length, status: rev.status, gaps: rev.gaps ?? []}}));
}
console.log(JSON.stringify({summary: {...sum, ms: Date.now() - started}}));
