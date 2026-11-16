#!/usr/bin/env python3
"""Turn one selector result into at most two bounded exporter inputs (<=16 hands each). Writes private files; prints counts.
usage: build-export-batches.py SELECTOR_JSON EXPORTER_MJS OUT_DIR"""
import json, re, sys, hashlib
from pathlib import Path
sel = json.loads(Path(sys.argv[1]).read_text()); exporter = Path(sys.argv[2]).read_text(); out = Path(sys.argv[3])
sha = sel['sourceSha']; targets = sel['targets']
if not re.fullmatch(r'[a-f0-9]{40}', sha) or not targets or len(targets) > 32: raise SystemExit('refused: source or target count')
uuid = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
rows = []
for t in targets:
    lease, table, number = t['original_lease'], t['table_id'], t['hand_number']
    if not (uuid.match(table) and isinstance(number, int) and number > 0 and isinstance(lease, str) and lease): raise SystemExit('refused: coordinate')
    key = hashlib.sha256(f'{table.lower()}:{number}:{lease}'.encode()).hexdigest()
    if key != t['hand_key'] or not uuid.match(t['hand_id']): raise SystemExit('refused: key derivation mismatch')
    rows.append({'key': key, 'handId': t['hand_id'], 'hand': {k: t[k] for k in ('hand_number', 'game_variant', 'tournament', 'original_speed', 'has_human', 'created_at', 'cell_rank', 'pick', 'roster_class', 'binding_route')}})
if len({r['key'] for r in rows}) != len(rows): raise SystemExit('refused: duplicate key')
out.mkdir(parents=True, exist_ok=False); out.chmod(0o700)
batches = [rows[i:i + 16] for i in range(0, len(rows), 16)]
for i, batch in enumerate(batches, 1):
    p = out / f'export-batch-{i}.mjs'
    p.write_text('const selection=' + json.dumps({'sourceSha': sha, 'targets': batch}, separators=(',', ':')) + ';\n' + exporter); p.chmod(0o600)
    print(json.dumps({'batch': i, 'hands': len(batch), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}))
