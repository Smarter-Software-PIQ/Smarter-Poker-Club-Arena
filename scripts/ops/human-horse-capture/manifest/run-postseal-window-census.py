#!/usr/bin/env python3
"""Complete-window hand denominators for protocol v4: every committed header in the declared window, in 1-minute slices,
classified with the same exclusion-first rule as the selector. One attempt per slice; a failed or truncated slice is a
missing series, never zero. Writes private counts only (no rosters). usage:
run-postseal-window-census.py REPO LINKDIR TEMPLATE SUBJECT_CONFIG START_UTC END_UTC SOURCE_SHA OUT_JSON"""
import importlib.util, json, os, re, subprocess, sys, hashlib, datetime
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from postseal_selection import classify_roster
REPO, LINK, TEMPLATE, SUBJ = map(Path, sys.argv[1:5]); START, END, SHA = sys.argv[5:8]; OUT = Path(sys.argv[8])
iso = r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$'
if not (re.fullmatch(iso, START) and re.fullmatch(iso, END) and re.fullmatch(r'[a-f0-9]{40}', SHA)) or OUT.exists():
    raise SystemExit('refused')
excluded = set(json.loads(SUBJ.read_text())['excludedSubjectIds'])
parse = lambda s: datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
fmt = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')
start, end = parse(START), parse(END)
if not datetime.timedelta(0) < end - start <= datetime.timedelta(hours=2): raise SystemExit('refused: window length')
spec = importlib.util.spec_from_file_location('native_export', REPO / 'scripts/dr/native-supabase-export.py')
native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
native.linked_project(LINK, 'kuklfnapbkmacvwxktbh'); env = native.cli_environment(os.environ.get('HVH_SUPABASE_CLI', '/opt/homebrew/bin/supabase'), LINK)
env['PGSSLROOTCERT'] = str(REPO / 'scripts/ci/certificates/supabase-prod-ca-2021.crt'); env['PGAPPNAME'] = 'human-horse-postseal-census-v4'
env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000'
template = TEMPLATE.read_text()
def reader(slice_start, slice_end):
    sql = template.replace('{{START_UTC}}', fmt(slice_start)).replace('{{END_UTC}}', fmt(slice_end)).replace('{{SOURCE_SHA}}', SHA)
    r = subprocess.run([os.environ.get('HVH_PSQL', '/opt/homebrew/bin/psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, env=env, capture_output=True, text=True, timeout=30)
    if r.returncode != 0: raise RuntimeError(next((l for l in r.stderr.splitlines() if 'ERROR:' in l), 'unknown_sql_error'))
    return [json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith('{')]
from postseal_census import read_window
slices, total, hands = read_window(start, end, reader, excluded)
missing = [s for s in slices if s['status'] != 'read']
out = {'protocolRevision': 4, 'kind': 'complete_window_hand_denominators', 'startUtc': START, 'endUtc': END, 'sourceSha': SHA,
       'templateSha256': hashlib.sha256(TEMPLATE.read_bytes()).hexdigest(), 'ranAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
       'keyOrder': 'variant|mode|original_speed|binding|roster_class|header_flag', 'slices': slices,
       'complete': not missing, 'missingSlices': [s['startUtc'] for s in missing],
       'totalsOverReadSlices': dict(sorted(total.items())), 'handsRead': sum(total.values()),
       'limitations': ['Hand counts are opportunity denominators for hands, not for decisions or feature eligibility.',
                       'Roster class comes from the dealt roster and profiles; final human-facing attribution needs original decision frames.',
                       'A missing slice makes every total a lower bound and every rate over the window unknown.']}
b = json.dumps(out, indent=1, sort_keys=True).encode(); OUT.write_bytes(b); OUT.chmod(0o600)
HANDS = OUT.with_name(OUT.stem + '-hands.json')
hb = json.dumps({'startUtc': START, 'endUtc': END, 'sourceSha': SHA, 'complete': not missing, 'missingSlices': [s['startUtc'] for s in missing], 'hands': hands}, sort_keys=True).encode(); HANDS.write_bytes(hb); HANDS.chmod(0o600)
print(json.dumps({'sha256': hashlib.sha256(b).hexdigest(), 'handsFileSha256': hashlib.sha256(hb).hexdigest(), 'complete': out['complete'], 'missingSlices': out['missingSlices'], 'handsRead': out['handsRead']}))
