#!/usr/bin/env python3
"""People-only replay set (REPLAY-V2). Splits a placed node set and its replay (scripts/audited-node-option-replay.ts
run with --history, whose lines carry `facing`) by who the decision faced: people = every live opponent is a person
(profiles.is_horse false in the placed hand), horses = every live opponent a Horse, mixed = both. Each part is a
<nodes, replay> pair the committed scorer reads as is (scripts/audited-decision-replay.ts --placed ... --replay ...),
so the people-only row is scored apart and the Horse-facing row kept as a secondary table.
usage: audited-node-facing-split.py <nodes.jsonl> <replay.jsonl> <out-prefix>
writes <out-prefix>.{people,horses,mixed}.{nodes,replay}.jsonl and prints the counts."""
import json, sys
nodes_path, replay_path, prefix = sys.argv[1:4]
key = lambda o: f"{o['hand']}:{o['seat']}:{o['street']}:{o['k']}"
meta, rows = None, []
for line in open(replay_path):
    o = json.loads(line)
    if 'meta' in o: meta = o
    else: rows.append(o)
if meta is None or not (meta['meta'].get('memory') or {}).get('on'):
    sys.exit('refused: the replay was not run with opponent memory (--history); its lines carry no facing')
kind = {key(r): (r.get('facing') or {}).get('kind') for r in rows}
nodes = [json.loads(l) for l in open(nodes_path)]
counts = {}
for kd in ('people', 'horse_only', 'mixed'):
    ks = {k for k, v in kind.items() if v == kd}
    with open(f'{prefix}.{kd}.nodes.jsonl', 'w') as f:
        for n in nodes:
            if key(n) in ks: f.write(json.dumps(n) + '\n')
    with open(f'{prefix}.{kd}.replay.jsonl', 'w') as f:
        f.write(json.dumps(meta) + '\n')
        for r in rows:
            if key(r) in ks: f.write(json.dumps(r) + '\n')
    counts[kd] = len(ks)
counts['no_facing'] = sum(1 for v in kind.values() if v is None)
print(json.dumps(counts))
