#!/usr/bin/env python3
"""Merge contiguous census segments (the maintained census refuses windows over 2 hours) into one hands file for the selector.
usage: merge_census.py START_UTC END_UTC OUT_HANDS_JSON OUT_SUMMARY_JSON SEG_JSON... (each SEG is a window-denominators segment; its -hands.json sits beside it)"""
import json, sys, hashlib
from pathlib import Path
start, end, out_h, out_s = sys.argv[1:5]; segs = [Path(p) for p in sys.argv[5:]]
if Path(out_h).exists() or Path(out_s).exists(): raise SystemExit('refused: output exists')
S = [json.loads(p.read_text()) for p in segs]; H = [json.loads(p.with_name(p.stem + '-hands.json').read_text()) for p in segs]
if S[0]['startUtc'] != start or S[-1]['endUtc'] != end or any(S[i]['endUtc'] != S[i + 1]['startUtc'] for i in range(len(S) - 1)): raise SystemExit('refused: segments are not contiguous over the window')
if len({s['sourceSha'] for s in S}) != 1: raise SystemExit('refused: mixed source')
hands = [h for x in H for h in x['hands']]; ids = [h['hand_id'] for h in hands]
if len(ids) != len(set(ids)): raise SystemExit('refused: duplicate hand across segments')
missing = [m for s in S for m in s['missingSlices']]; tot = {}
for s in S:
    for k, v in s['totalsOverReadSlices'].items(): tot[k] = tot.get(k, 0) + v
hb = json.dumps({'startUtc': start, 'endUtc': end, 'sourceSha': S[0]['sourceSha'], 'complete': not missing, 'missingSlices': missing, 'hands': hands}, sort_keys=True).encode()
Path(out_h).write_bytes(hb); Path(out_h).chmod(0o600)
summ = {'kind': 'merged_window_hand_denominators', 'startUtc': start, 'endUtc': end, 'sourceSha': S[0]['sourceSha'], 'segments': [{'file': p.name, 'startUtc': s['startUtc'], 'endUtc': s['endUtc'], 'handsRead': s['handsRead'], 'missingSlices': s['missingSlices'], 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p, s in zip(segs, S)],
        'slices': sum(len(s['slices']) for s in S), 'complete': not missing, 'missingSlices': missing, 'totalsOverReadSlices': dict(sorted(tot.items())), 'handsRead': len(hands), 'humanHands': sum(1 for h in hands if h.get('has_human')), 'handsFileSha256': hashlib.sha256(hb).hexdigest(),
        'deviation': 'The maintained census and Lightning readers refuse windows over 2 hours; the declared window is read as contiguous half-open 2-hour segments with unchanged one-minute slices and one attempt each.'}
Path(out_s).write_text(json.dumps(summ, indent=1)); Path(out_s).chmod(0o600); print(json.dumps({k: summ[k] for k in ('slices', 'complete', 'handsRead', 'humanHands', 'handsFileSha256')}))
