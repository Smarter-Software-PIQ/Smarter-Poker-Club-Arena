#!/usr/bin/env python3
"""Select the inspection sample from the COMPLETE window census (no header caps), then read journal coordinates for the
selected hands only. One coordinate statement, one attempt. Prints diagnostics and counts only.
usage: run-postseal-selector.py REPO LINKDIR COORD_TEMPLATE SUBJECT_CONFIG CENSUS_HANDS_JSON OUT_JSON"""
import importlib.util, json, os, re, subprocess, sys, hashlib, datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from postseal_selection import select, bound_candidates
REPO, LINK, TEMPLATE, SUBJ, HANDS, OUT = map(Path, sys.argv[1:7])
if OUT.exists(): raise SystemExit('refused: output exists')
census = json.loads(HANDS.read_text()); SHA = census['sourceSha']
uuid = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
if not re.fullmatch(r'[a-f0-9]{40}', SHA): raise SystemExit('refused: source')
excluded = set(json.loads(SUBJ.read_text())['excludedSubjectIds'])
targets, diagnostics = select(bound_candidates(census['hands']), excluded)
diagnostics['selectedFromCompleteWindow'] = census['complete']; diagnostics['missingSlices'] = census['missingSlices']
out = {'protocolRevision': 4, 'startUtc': census['startUtc'], 'endUtc': census['endUtc'], 'sourceSha': SHA,
       'censusHandsSha256': hashlib.sha256(HANDS.read_bytes()).hexdigest(), 'subjectConfigSha256': hashlib.sha256(SUBJ.read_bytes()).hexdigest(),
       'ranAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'selectionDiagnostics': diagnostics, 'targets': [], 'coordinateRefusals': []}
if targets:
    ids = [t['hand_id'] for t in targets]
    if not all(uuid.match(i) for i in ids) or len(ids) > 32: raise SystemExit('refused: ids')
    sql = TEMPLATE.read_text().replace('{{IDS}}', ','.join(f"'{i}'::uuid" for i in ids)).replace('{{SOURCE_SHA}}', SHA)
    spec = importlib.util.spec_from_file_location('native_export', REPO / 'scripts/dr/native-supabase-export.py')
    native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
    native.linked_project(LINK, 'kuklfnapbkmacvwxktbh'); env = native.cli_environment(os.environ.get('HVH_SUPABASE_CLI', '/opt/homebrew/bin/supabase'), LINK)
    env['PGSSLROOTCERT'] = str(REPO / 'scripts/ci/certificates/supabase-prod-ca-2021.crt'); env['PGAPPNAME'] = 'human-horse-postseal-coordinates-v4'
    env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000'
    r = subprocess.run([os.environ.get('HVH_PSQL', '/opt/homebrew/bin/psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, env=env, capture_output=True, text=True, timeout=40)
    if r.returncode != 0:
        out['coordinateRead'] = 'FAILED: ' + next((l for l in r.stderr.splitlines() if 'ERROR:' in l), 'unknown_sql_error')
    else:
        coords = {c['hand_id']: c for c in (json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith('{'))}
        for t in targets:
            c = coords.get(t['hand_id'])
            if not c or not c['binding_route'] or not c['original_lease'] or not c['post_commit_completed'] or (c['binding_route'] == 'accepted_terminal' and not c['anchor_ok']):
                out['coordinateRefusals'].append({'hand_id': t['hand_id'], 'reason': 'coordinate_unavailable_or_unbound'}); continue
            key = hashlib.sha256(f"{c['table_id'].lower()}:{c['hand_number']}:{c['original_lease']}".encode()).hexdigest()
            out['targets'].append({**t, 'table_id': c['table_id'], 'hand_number': c['hand_number'], 'original_lease': c['original_lease'], 'hand_key': key, 'binding_route': c['binding_route']})
        out['coordinateRead'] = 'read'
b = json.dumps(out, indent=1, sort_keys=True).encode(); OUT.write_bytes(b); OUT.chmod(0o600)
print(json.dumps({'sha256': hashlib.sha256(b).hexdigest(), 'selected': len(targets), 'targets': len(out['targets']), 'coordinateRead': out.get('coordinateRead'),
                  'coordinateRefusals': len(out['coordinateRefusals']), 'selectionDiagnostics': diagnostics}, indent=1))
