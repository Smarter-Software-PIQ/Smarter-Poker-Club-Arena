#!/usr/bin/env python3
"""reconcile.py CAPTURE_DIR -> prints JSON: census human set vs light keys (parts) vs witness originals. Writes human-hand-keys-part3.json only when census-only hands exist."""
import json, sys, glob, hashlib
from pathlib import Path
C = Path(sys.argv[1])
census = json.loads((C / 'human-hand-keys.json').read_text()); ch = {h['h']: h for h in census['hands']}
den = json.loads((C / 'window-denominators-hands.json').read_text())['hands']; dh = {h['hand_id'] for h in den if h.get('has_human')}
light = {}
part_files = sorted(glob.glob(str(C / 'human-hand-keys-part[12].json')))
if part_files:
    for f in part_files:
        for h in json.loads(Path(f).read_text())['hands']: light[h['h']] = h
else:
    light = dict(ch)
wit = {}; summ = []
for f in sorted(glob.glob(str(C / 'originals-witness-*.jsonl'))):
    for l in Path(f).read_text().splitlines():
        if not l.startswith('{'): continue
        r = json.loads(l)
        if 'summary' in r: summ.append({'file': Path(f).name, **{k: r['summary'].get(k) for k in ('hands', 'missing', 'otherRelease', 'decisions', 'reviewStatus')}})
        elif 'hand' in r: wit.setdefault(r['hand'], 0); wit[r['hand']] += 1 if 'turnKey' in r else 0
keymis = sorted(h for h in set(ch) & set(light) if ch[h]['k'] != light[h]['k'])
census_only = sorted(set(ch) - set(light)); light_only = sorted(set(light) - set(ch)); no_key = sorted(dh - set(ch))
out = {'censusHumanHands': len(dh), 'censusWithKey': len(ch), 'censusHumanWithoutKey': no_key, 'lightKeys': len(light), 'inBoth': len(set(ch) & set(light)), 'keyMismatch': keymis,
       'censusOnly': census_only, 'lightOnly': light_only, 'witnessHandsSeen': len(wit), 'witnessHandsWithDecisions': sum(1 for v in wit.values() if v), 'lightNotInWitness': sorted(set(light) - set(wit)), 'witnessSummaries': summ,
       'handsFileSha256': hashlib.sha256((C / 'window-denominators-hands.json').read_bytes()).hexdigest()}
if census_only:
    p = C / 'human-hand-keys-part3.json'
    if not p.exists(): p.write_text(json.dumps({'sourceSha': census.get('sourceSha'), 'source': 'census-only human hands (reconcile.py)', 'hands': [{'h': h, 'k': ch[h]['k']} for h in census_only]})); p.chmod(0o600)
print(json.dumps(out, indent=1))
