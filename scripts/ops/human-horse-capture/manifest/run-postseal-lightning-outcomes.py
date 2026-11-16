#!/usr/bin/env python3
"""Lightning terminal outcomes for the declared window, reconciled to the committed-hand census. Read-only; one attempt per 1-minute slice.
usage: run-postseal-lightning-outcomes.py REPO LINKDIR TEMPLATE START_UTC END_UTC CENSUS_HANDS_JSON OUT_JSON"""
import importlib.util, json, os, re, subprocess, sys, hashlib, datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lightning_outcomes import read_outcomes, reconcile
REPO, LINK, TEMPLATE = map(Path, sys.argv[1:4]); START, END = sys.argv[4:6]; CENSUS, OUT = Path(sys.argv[6]), Path(sys.argv[7])
iso = r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$'
if not (re.fullmatch(iso, START) and re.fullmatch(iso, END)) or OUT.exists(): raise SystemExit('refused')
parse = lambda s: datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
fmt = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')
start, end = parse(START), parse(END)
if not datetime.timedelta(0) < end - start <= datetime.timedelta(hours=2): raise SystemExit('refused: window length')
census = json.loads(CENSUS.read_text())
if (census['startUtc'], census['endUtc']) != (START, END): raise SystemExit('refused: census is for another window')
spec = importlib.util.spec_from_file_location('native_export', REPO / 'scripts/dr/native-supabase-export.py')
native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
native.linked_project(LINK, 'kuklfnapbkmacvwxktbh'); env = native.cli_environment(os.environ.get('HVH_SUPABASE_CLI', '/opt/homebrew/bin/supabase'), LINK)
env['PGSSLROOTCERT'] = str(REPO / 'scripts/ci/certificates/supabase-prod-ca-2021.crt'); env['PGAPPNAME'] = 'human-horse-postseal-lightning-outcomes-v5'
env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000'
template = TEMPLATE.read_text()
def reader(a, b):
    sql = template.replace('{{START_UTC}}', fmt(a)).replace('{{END_UTC}}', fmt(b))
    r = subprocess.run([os.environ.get('HVH_PSQL', '/opt/homebrew/bin/psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, env=env, capture_output=True, text=True, timeout=30)
    if r.returncode != 0: raise RuntimeError(next((l for l in r.stderr.splitlines() if 'ERROR:' in l), 'unknown_sql_error'))
    return [json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith('{')]
slices, total, hands = read_outcomes(start, end, reader)
missing = [s['startUtc'] for s in slices if s['status'] != 'read']
out = {'protocolRevision': 5, 'kind': 'lightning_terminal_outcomes_for_hands_formed_in_window', 'startUtc': START, 'endUtc': END,
       'templateSha256': hashlib.sha256(TEMPLATE.read_bytes()).hexdigest(), 'ranAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
       'slices': slices, 'complete': not missing, 'missingSlices': missing, 'totalsOverReadSlices': dict(sorted(total.items())),
       'reconciliationToCommittedCensus': reconcile(hands, census['hands'], census['complete'], not missing),
       'limitations': ['Committed-hand denominators come from the hand census only; voided, abandoned and open Lightning hands are reported here and are never added to them.',
                       'A voided hand has no commit; Horse decisions taken inside it have no accepted terminal and are not attributed.',
                       'No chip movement is read or inferred from an outcome.', 'open_in_flight at read time may settle or void later; it is unresolved, not zero.']}
b = json.dumps(out, indent=1, sort_keys=True).encode(); OUT.write_bytes(b); OUT.chmod(0o600)
print(json.dumps({'sha256': hashlib.sha256(b).hexdigest(), 'complete': out['complete'], 'totals': out['totalsOverReadSlices'], 'reconciliation': out['reconciliationToCommittedCensus']['counts'], 'defect': out['reconciliationToCommittedCensus']['defect']}))
