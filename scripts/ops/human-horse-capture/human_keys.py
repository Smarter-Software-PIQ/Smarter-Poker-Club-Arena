#!/usr/bin/env python3
"""Journal keys for every human-facing hand of the merged census. Read-only, batches of 200 ids, one attempt each.
usage: human_keys.py REPO LINKDIR HANDS_JSON SOURCE_SHA OUT_JSON"""
import importlib.util, json, os, subprocess, sys
from pathlib import Path
REPO, LINK, HANDS, SHA, OUT = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], Path(sys.argv[5])
if OUT.exists(): raise SystemExit('refused: output exists')
spec = importlib.util.spec_from_file_location('native_export', REPO / 'scripts/dr/native-supabase-export.py'); native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
native.linked_project(LINK, 'kuklfnapbkmacvwxktbh'); env = native.cli_environment(os.environ.get('HVH_SUPABASE_CLI', '/opt/homebrew/bin/supabase'), LINK)
env['PGSSLROOTCERT'] = str(REPO / 'scripts/ci/certificates/supabase-prod-ca-2021.crt'); env['PGAPPNAME'] = 'human-horse-window-human-keys'
env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=2000'
ids = [h['hand_id'] for h in json.loads(HANDS.read_text())['hands'] if h.get('has_human')]; rows = []; failed = []
for i in range(0, len(ids), 200):
    chunk = ids[i:i + 200]; lst = ','.join("'%s'" % x for x in chunk if all(c in '0123456789abcdef-' for c in x))
    sql = ("select row_to_json(q) from (select c.hand_id h, encode(sha256(convert_to(lower(c.table_id::text)||':'||c.hand_number::text||':'||coalesce(c.post_commit_payload#>>'{accepted_hand_facts,horse_accepted_terminal,originalLease}',c.post_commit_payload#>>'{accepted_hand_facts,horse_journal_identity,lease_generation}'),'UTF8')),'hex') k, "
           "(c.post_commit_completed_at is not null) committed, (extract(epoch from coalesce(hh.started_at,hh.created_at))*1000)::bigint start_ms from public.hand_atomic_commits c join public.hand_history hh on hh.id=c.hand_id where c.hand_id in (%s)) q;" % lst)
    r = subprocess.run([os.environ.get('HVH_PSQL', '/opt/homebrew/bin/psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, env=env, capture_output=True, text=True, timeout=40)
    if r.returncode != 0: failed.append(i); continue
    rows += [json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith('{')]
ok = [r for r in rows if r.get('k')]
OUT.write_text(json.dumps({'sourceSha': SHA, 'humanHands': len(ids), 'withKey': len(ok), 'withoutKey': len(rows) - len(ok), 'notReturned': len(ids) - len(rows), 'failedBatches': failed, 'hands': ok})); OUT.chmod(0o600)
print(json.dumps({'humanHands': len(ids), 'withKey': len(ok), 'withoutKey': len(rows) - len(ok), 'notReturned': len(ids) - len(rows), 'failedBatches': failed}))
