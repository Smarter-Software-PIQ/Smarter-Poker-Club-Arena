#!/usr/bin/env python3
"""plo6_maniac_price.py WITNESS_ROWS.jsonl INSTANCE OUT_JSON  (toolkit v3 support read for PLO6; v2 2026-11-15T16:00Z, session 01BbZPDh, two sets per PLO6 15:11:35Z). Report only; no cards.
Set (a) maniacPrice: six-card cash preflop Horse decisions whose journal decision carries preflopReadReceipt consumer 'maniac_price' (eligible: the arithmetic decided).
Set (b) handOffCandidates: six-card cash preflop Horse decisions with consumer 'range_play' whose receipt layers include 'maniac_raise_width' AND the price gate holds on the public
node: (aggressive actions on the street before the decision >= 2, or toCall >= 25% of the Horse's stack) and toCall < 40% of stack and the last aggressor not all in. The receipt does not
mark observed vs presumed and this read cannot arm first-pass telemetry, so set (b) rows are CANDIDATE hand-offs, not confirmed hand-offs. Persons and Horses are sha256-anonymised."""
import json, sys, hashlib, collections
from pathlib import Path
src, inst, out = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
if out.exists(): raise SystemExit('refused: output exists')
an = lambda u: u and hashlib.sha256(u.encode()).hexdigest()[:8]
rows = [json.loads(l) for l in src.read_text().splitlines() if l.startswith('{') and '"turnKey"' in l]
summ = [json.loads(l)['summary'] for l in src.read_text().splitlines() if l.startswith('{"summary"')]
six = [r for r in rows if r.get('variant') == 'plo6' and r.get('mode') == 'cash' and r.get('stage') == 'preflop']
rc_ = lambda r: r.get('preflopReadReceipt') or {}
def gate(r):
    """None when a needed public field is absent (reader before v2 fields)."""
    agg, la, tc, st = r.get('streetAggressions'), r.get('lastAggressor'), r.get('toCall'), r.get('stack')
    if agg is None or tc is None or not st or la is None or 'allIn' not in la: return None
    tc, st = float(tc), float(st)
    return bool((agg >= 2 or tc >= 0.25 * st) and tc < 0.40 * st and not la.get('allIn'))
A = [r for r in six if rc_(r).get('consumer') == 'maniac_price']
rp = [r for r in six if rc_(r).get('consumer') == 'range_play' and 'maniac_raise_width' in (rc_(r).get('layers') or [])]
B = [r for r in rp if gate(r) is True]; Bu = [r for r in rp if gate(r) is None]
def one(r):
    la = r.get('lastAggressor') or {}; rc = rc_(r); per = (r.get('engineInput') or {}).get('perHuman') or {}
    rd = (per.get(la.get('userId')) or {}).get('read') if la.get('human') else (r.get('engineInput') or {}).get('engineRead')
    ch = [c.get('node') for c in (r.get('changes') or [])]
    return {'release': r.get('release'), 'instance': inst, 'hand': r.get('hand'), 'turnKey': r.get('turnKey'), 'eventId': r.get('eventId'), 'horse': an(r.get('horse')),
            'raiser': {'who': 'person' if la.get('human') else 'Horse', 'id': an(la.get('userId')), 'action': la.get('action'), 'allIn': la.get('allIn'),
                       'read': {k: (rd or {}).get(k) for k in ('presumed', 'maniacRaiseWidth', 'read')} if rd else None},
            'maniacWidth': rc.get('maniacWidth'), 'receipt': {k: rc.get(k) for k in ('consumer', 'layers', 'strength', 'branch', 'baseCallThreshold', 'callThreshold', 'baseThreeBetThreshold', 'threeBetThreshold')},
            'vpipFloor': r.get('vpipFloor'), 'toCall': r.get('toCall'), 'pot': r.get('pot'), 'stack': r.get('stack'), 'streetAggressions': r.get('streetAggressions'), 'legal': r.get('legal'),
            'firstPassProposal': r.get('proposal'), 'firstPassFinal': r.get('final'), 'changedNodes': ch,
            'executed': r.get('execution'), 'executedEqualsFinal': bool(r.get('execution') and (r['execution'].get('action') == (r.get('final') or {}).get('action')))}
cnt = lambda S: {'n': len(S), 'byRaiser': dict(collections.Counter('person' if (r.get('lastAggressor') or {}).get('human') else 'Horse' for r in S)),
                 'executedActions': dict(collections.Counter(str((r.get('execution') or {}).get('action')) for r in S)), 'executionStatus': dict(collections.Counter(str((r.get('execution') or {}).get('status')) for r in S))}
R = {'reportOnly': True, 'version': 2, 'source': str(src), 'reader': summ, 'plo6CashPreflopDecisions': len(six),
     'a_maniacPrice': dict(cnt(A), rows=[one(r) for r in A] or 'none'),
     'b_handOffCandidates': dict(cnt(B), rangePlayWithManiacWidth=len(rp), gateUnknown=len(Bu), rows=[one(r) for r in B] or 'none', confirmed='not confirmable here: the reader cannot arm first-pass telemetry; candidates only'),
     'definitions': {'priceGate': '(streetAggressions >= 2 or toCall >= 0.25*stack) and toCall < 0.40*stack and not lastAggressor.allIn; streetAggressions = bet/raise/all_in actions on the current street before the decision (journal actionHistory, dead excluded); stack = the deciding Horse stack behind',
                     'source': 'PLO6 15:11:35Z item 1 (source 7e8688d3: HorseLogic.ts ~9402 hand-off clears maniacPriceReceiptPending; range_play receipt layers include maniac_raise_width ~10859)'},
     'limits': 'second look runs with telemetry off and can be the executed action: the executed column is the journal execution record; first pass is the decision record (policyGraph).'}
out.write_text(json.dumps(R, indent=1)); out.chmod(0o600)
print(json.dumps({'plo6CashPreflopDecisions': len(six), 'a': cnt(A), 'b': dict(cnt(B), rangePlayWithManiacWidth=len(rp), gateUnknown=len(Bu))}))
