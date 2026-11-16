#!/usr/bin/env python3
"""Per-Horse feature roll-up: reader rows (sampled decisions, counts only) joined to the cohort participation read.
usage: rollup_aggregate.py ROWS_1.jsonl[,ROWS_2.jsonl,...] COHORT_JSON OUT_JSON (batches are summed)"""
import json, sys, collections
from pathlib import Path
rows = [json.loads(l) for f in sys.argv[1].split(',') for l in Path(f).read_text().splitlines() if l.startswith('{')]; coh = json.loads(Path(sys.argv[2]).read_text()); out = Path(sys.argv[3])
if out.exists(): raise SystemExit('refused: output exists')
ss = [r['summary'] for r in rows if 'summary' in r]
summ = None if not ss else {**{k: sum(s.get(k, 0) for s in ss) for k in ss[0] if isinstance(ss[0][k], (int, float)) and not isinstance(ss[0][k], bool)}, 'observedDecisionKeys': sorted({k for s in ss for k in s.get('observedDecisionKeys', [])}), 'batches': len(ss)}; per = collections.defaultdict(lambda: {'sampledDecisions': 0, 'humanPresent': 0, 'rangeConsumption': 0, 'planContext': 0, 'keys': collections.Counter(), 'cells': {}})
for r in rows:
    if 'id' not in r: continue
    u, v, m = r['id'].split('|'); p = per[u]; p['sampledDecisions'] += r['decisions']; p['humanPresent'] += r.get('humanPresent', 0); p['rangeConsumption'] += r['rangeConsumption']; p['planContext'] += r['planContext']; p['keys'].update(r['keys']); p['cells'][v + '|' + m] = p['cells'].get(v + '|' + m, 0) + r['decisions']
part = collections.defaultdict(lambda: {'hands': 0, 'cells': {}})
for x in coh.get('rows') or []:
    part[x['u']]['hands'] += x['hands']; part[x['u']]['cells'][x['v'] + '|' + ('tournament' if x['trn'] else 'cash')] = x['hands']
cohort_n = (coh.get('cohort') or {}).get('n'); ids = set(part) | set(per)
horses = {u: {'handsInWindow': part[u]['hands'] if u in part else 0, 'handCells': part[u]['cells'] if u in part else {}, **({k: (dict(v) if k == 'keys' else v) for k, v in per[u].items()} if u in per else {'sampledDecisions': 0}),
              'status': 'sampled' if u in per else 'participated, not sampled' if u in part else 'no decision in window'} for u in ids}
res = {'cohort': coh.get('cohort'), 'participationStatus': coh.get('status'), 'readerSummary': summ, 'horsesWithHands': len(part), 'horsesSampled': len(per), 'sampledNotInCohortRead': len(set(per) - set(part)),
       'cohortWithoutHands': None if cohort_n is None or coh.get('status') != 'read' else cohort_n - len(part), 'observedDecisionKeys': summ and summ.get('observedDecisionKeys'),
       'keyCoverage': {k: sum(1 for h in horses.values() if (h.get('keys') or {}).get(k)) for k in (summ or {}).get('observedDecisionKeys', [])}, 'horses': horses,
       'note': 'Counts only. Access for all 1,000 is Feature Activation\'s census; this file reports participation and sampled invocation separately. A Horse that played but was not sampled is neither pass nor fail.'}
out.write_text(json.dumps(res)); out.chmod(0o600); print(json.dumps({k: res[k] for k in ('cohort', 'participationStatus', 'horsesWithHands', 'horsesSampled', 'sampledNotInCohortRead', 'cohortWithoutHands', 'keyCoverage')}))
