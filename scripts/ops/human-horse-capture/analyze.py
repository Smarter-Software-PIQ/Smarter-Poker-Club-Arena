#!/usr/bin/env python3
"""analyze.py OBS_DIR -> OBS_DIR/report-numbers.json (counts for the report; no outcomes read; derived only from capture files)."""
import json, sys, collections, re, hashlib
from pathlib import Path
O = Path(sys.argv[1]); C = O / 'capture'; out = O / 'report-numbers.json'
if out.exists(): raise SystemExit('refused: output exists')
R = {}
d = json.loads((C / 'window-denominators.json').read_text()); R['census'] = {k: d[k] for k in ('startUtc', 'endUtc', 'slices', 'complete', 'missingSlices', 'handsRead', 'humanHands', 'handsFileSha256')}
cells = collections.Counter(); mixed = collections.Counter()
for k, v in d['totalsOverReadSlices'].items():
    var, mode, speed, binding, cls, flag = k.split('|'); cells[(var, mode, speed, cls)] += v
    if cls == 'eligible_mixed': mixed['%s %s %s' % (var, mode, speed)] += v
R['census']['byRosterClass'] = dict(collections.Counter({c: sum(v for (a, b, s, cc), v in cells.items() if cc == c) for c in {k[3] for k in cells}}))
R['census']['eligibleMixedByCell'] = dict(sorted(mixed.items())); R['census']['handsByVariantMode'] = {'%s %s' % k: v for k, v in sorted(collections.Counter({(a, b): sum(v for (aa, bb, s, c), v in cells.items() if (aa, bb) == (a, b)) for (a, b, s, c) in cells}).items())}
L = [json.loads(l) for l in (C / 'steps.log').read_text().splitlines() if l.startswith('{"sha256"') and '"defect"' in l]
tot = collections.Counter(); rec = collections.Counter()
for l in L:
    tot.update(l.get('totals') or {}); rec.update(l.get('reconciliation') or {})
R['lightning'] = {'segments': len(L), 'allComplete': all(l['complete'] for l in L), 'anyDefect': any(l['defect'] for l in L), 'totals': dict(tot), 'reconciliationSums': dict(rec)}
W = [json.loads(l) for l in (O / 'tight-maniac/witnesses.jsonl').read_text().splitlines()]
wpath = O / 'witness-rows.jsonl' if (O / 'witness-rows.jsonl').exists() else (O / 'witness-rows-parts-1-2.jsonl')
rows = [json.loads(l) for l in wpath.read_text().splitlines() if l.startswith('{')]; wit = [r for r in rows if 'turnKey' in r]
R['witness'] = {'decisions': len(wit), 'hands': len({r['hand'] for r in wit}), 'humanAbleDecisions': sum(1 for r in wit if r.get('humansAble')), 'witnesses': len(W), 'humans': len({w['opponent'] for w in W}), 'priorExact': sum(1 for w in W if w['priorExactForHand']), 'bound': sum(1 for w in W if w['bound']), 'unjudgeable': sum(1 for w in W if w['verdict'] == 'unjudgeable'),
                'decisionsByVariantMode': {'%s %s' % k: v for k, v in sorted(collections.Counter((r['variant'], r['mode']) for r in wit).items())}, 'handsByVariantMode': {'%s %s' % k: v for k, v in sorted(collections.Counter({(a, b): len({r['hand'] for r in wit if (r['variant'], r['mode']) == (a, b)}) for a, b in {(r['variant'], r['mode']) for r in wit}}).items())}}
def act(w): return (w['proposal'] or {}).get('action'), (w['final'] or {}).get('action')
def blk(ws):
    ex = collections.Counter((w.get('execution') or {}).get('status') for w in ws)
    return {'n': len(ws), 'hands': len({w['hand'] for w in ws}), 'humans': len({w['opponent'] for w in ws}), 'byVariantModeStage': {'%s %s %s' % k: v for k, v in sorted(collections.Counter((w['match']['variant'], w['match']['mode'], w['match']['stage']) for w in ws).items())}, 'changed': sum(1 for w in ws if w['changes']), 'finalActions': dict(collections.Counter(act(w)[1] for w in ws)), 'proposalEqualsFinal': sum(1 for w in ws if act(w)[0] == act(w)[1] and (w['proposal'] or {}).get('amount') == (w['final'] or {}).get('amount')), 'verdicts': dict(collections.Counter(w['verdict'] for w in ws)), 'executionStatus': dict(ex), 'bound': sum(1 for w in ws if w['bound']), 'changeNodes': dict(collections.Counter(str((c or {}).get('node') or (c or {}).get('rule') or (c or {}).get('by') or sorted((c or {}).keys())) for w in ws for c in (w['changes'] or [])))}
faced = [w for w in W if w['type'] == 'faces_human_wager']
st = lambda w: (w['engineRead'] or {}).get('style') or {}
tf = [w for w in faced if w['class'] == 'tight']
R['tight'] = {'allTypes': dict(collections.Counter(w['type'] for w in W if w['class'] == 'tight')), 'faced': blk(tf), 'facedAbsentLike': sum(1 for w in tf if w['absentLike']), 'facedCounting': sum(1 for w in tf if not w['absentLike']), 'facedForcedShares': sorted({w['forcedShare'] for w in tf if w['forcedShare'] is not None}), 'facedPriors': [dict(n=w['prior']['n'], vpip=w['prior']['vpip'], pfr=w['prior']['pfr']) for w in tf[:1]] + [dict(n=w['prior']['n'], vpip=w['prior']['vpip'], pfr=w['prior']['pfr']) for w in tf[-1:]],
              'facedEngineReadEngaged': sum(1 for w in tf if (w['engineRead'] or {}).get('read')), 'facedOverFolder': sum(1 for w in tf if (w['engineRead'] or {}).get('overFolder') is True), 'facedStylePredicate': sum(1 for w in tf if st(w).get('tightOpenerRespect') or st(w).get('tightReRaiserRespect')), 'facedStyleParticipation': dict(collections.Counter(st(w).get('participation') for w in tf)), 'facedOneOffLargeBet': sum(1 for w in tf if w['oneOffLargeBet'])}
R['styleRead'] = {'computedOn': sum(1 for w in W if w['engineRead'] and 'style' in w['engineRead']), 'errors': sum(1 for w in W if 'error' in (w['engineRead'] or {})), 'tightOpenerRespectTrue': sum(1 for w in W if st(w).get('tightOpenerRespect')), 'tightReRaiserRespectTrue': sum(1 for w in W if st(w).get('tightReRaiserRespect')),
                  'participationAll': dict(collections.Counter(st(w).get('participation') for w in W)), 'participationFaced': dict(collections.Counter(st(w).get('participation') for w in faced)), 'participationTightByClassFaced': dict(collections.Counter(w['class'] for w in faced if st(w).get('participation') == 'tight')), 'participationTightFaced': blk([w for w in faced if st(w).get('participation') == 'tight'])}
R['maniac'] = {'sustainedAll': sum(1 for w in W if w['class'] == 'maniac_sustained'), 'selectiveAll': sum(1 for w in W if w['class'] == 'maniac_selective'), 'facedEngineManiacRead': blk([w for w in faced if (w['engineRead'] or {}).get('maniacRaiseWidth') is not None and not (w['engineRead'] or {}).get('presumed') or (w['engineRead'] or {}).get('postflopManiac') is True]),
               'facedPresumed': blk([w for w in faced if (w['engineRead'] or {}).get('presumed')]), 'facedEngineManiacByClass': dict(collections.Counter(w['class'] for w in faced if ((w['engineRead'] or {}).get('maniacRaiseWidth') is not None and not (w['engineRead'] or {}).get('presumed')) or (w['engineRead'] or {}).get('postflopManiac') is True))}
R['controls'] = {'differentAggressor': blk([w for w in W if w['type'] != 'faces_human_wager' and w['class'] in ('tight', 'maniac_sustained', 'maniac_selective')]), 'weakFaced': blk([w for w in faced if w['class'] in ('unknown', 'stale', 'thin', 'changing', 'one_off_large_bet')]), 'weakFacedByClass': dict(collections.Counter(w['class'] for w in faced if w['class'] in ('unknown', 'stale', 'thin', 'changing', 'one_off_large_bet'))),
                 'ordinaryFaced': blk([w for w in faced if w['class'] == 'ordinary']), 'loosePassiveWitnesses': sum(1 for w in W if w['loosePassive']), 'loosePassiveFaced': sum(1 for w in faced if w['loosePassive']), 'facedTotal': len(faced), 'facedLearnedAfterRepair': dict(collections.Counter(str(w['learnedAfterRepair']) for w in faced)), 'facedOverFolderRead': sum(1 for w in faced if (w['engineRead'] or {}).get('overFolder') is True), 'allOverFolderRead': sum(1 for w in W if (w['engineRead'] or {}).get('overFolder') is True)}
hum = collections.defaultdict(lambda: {'witnesses': 0, 'faced': 0, 'classes': collections.Counter(), 'cells': collections.Counter(), 'hands': set(), 'prior': None})
for w in W:
    h = hum[hashlib.sha256(w['opponent'].encode()).hexdigest()[:8]]; h['witnesses'] += 1; h['faced'] += w['type'] == 'faces_human_wager'; h['classes'][w['class']] += 1; h['cells'][w['match']['variant'] + ' ' + w['match']['mode']] += 1; h['hands'].add(w['hand'])
    if w['prior']: h['prior'] = {k: w['prior'].get(k) for k in ('n', 'vpip', 'pfr')}; h['forcedShare'] = w['forcedShare']
R['humans'] = {k: {'witnesses': v['witnesses'], 'faced': v['faced'], 'hands': len(v['hands']), 'classes': dict(v['classes']), 'cells': dict(v['cells']), 'lastPrior': v['prior'], 'forcedShare': v.get('forcedShare')} for k, v in sorted(hum.items(), key=lambda x: -x[1]['witnesses'])}
top_h = next(iter(R['humans'].items()), (None, {'witnesses': 0, 'faced': 0}))
R['witness']['topHuman'] = {
    'hash8': top_h[0],
    'witnesses': top_h[1]['witnesses'],
    'share': round(top_h[1]['witnesses'] / len(W), 4) if W else 0.0,
    'singlePlayerDominated': bool(W and (top_h[1]['witnesses'] / len(W)) > 0.50),
    'witnessesExcludingTopHuman': len(W) - top_h[1]['witnesses'],
    'facedExcludingTopHuman': len(faced) - top_h[1]['faced'],
}
f = json.loads((C / 'rule-fires-window.json').read_text())['result']; fr = f['fires'] or {}
keys = ['decide', 'decide_nlh', 'decide_omaha', 'decide_tournament', 'hand_memory_domain_recorded_seen', 'horse_exact_memory_read_ok', 'horse_exact_memory_read_busy', 'horse_exact_memory_read_timeout', 'horse_exact_memory_read_ms_gt1000', 'style_tight_opener_respect_seen', 'style_tight_reraiser_respect_seen', 'style_raise_respect_seen', 'style_value_raise_respect_seen', 'style_commitment_priced_seen', 'observed_maniac_raiser_seen', 'maniac_call_down', 'maniac_short_stack_jam', 'token_call_price_scaled', 'token_call_price_river_covered', 'v88_commitment_honored', 'omaha_preflop_action_behind', 'bluff_raise_refused_no_fold_equity_seen', 'horse_continuation_omaha_called_through_straight_check', 'phase15_node_tournament_utility_changed', 'phase7_utility_override', 'v31_certified_skip_empty_store', 'plo6_maniac_price_refusal_range_play_seen', 'style_read_over_budget_seen', 'style_read_timed_seen', 'opponent_memory_donor_fresh', 'opponent_memory_donor_stale']
R['fires'] = {'receipts': f['receipts'], 'features': len(fr), 'selected': {k: fr.get(k) for k in keys}, 'forbiddenPatternHits': {k: v for k, v in fr.items() if re.search(r'pillar2|pillar_2|r7_|r8_|_r7|_r8|held_out|heldout|leak_map|leakmap', k, re.I)}, 'v31Keys': {k: v for k, v in fr.items() if 'v31' in k.lower()}, 'memoryMissing': {k: v for k, v in fr.items() if 'memory' in k and ('missing' in k or 'without' in k)}}
out.write_text(json.dumps(R, indent=1)); out.chmod(0o600); print(json.dumps(R, indent=1))
