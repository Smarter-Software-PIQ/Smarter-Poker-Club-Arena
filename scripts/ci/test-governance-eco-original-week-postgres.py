#!/usr/bin/env python3
"""Exercise original-week closure against exact production sweep/resolver bodies."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--pg-bin', type=Path, required=True)
parser.add_argument('--scratch', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
args.scratch.mkdir(parents=True, exist_ok=True)
base = Path(tempfile.mkdtemp(prefix='eco-', dir=args.scratch))
started = False


def run(command, sql=None):
    result = subprocess.run(list(map(str, command)), input=sql, text=True,
                            capture_output=True, timeout=90,
                            env={**os.environ, 'TMPDIR': str(base)})
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.strip()


def query(sql):
    return run([args.pg_bin / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                '-h', base, '-U', 'postgres', '-d', 'postgres'], sql)


try:
    assert ' 17.' in run([args.pg_bin / 'postgres', '--version'])
    run([args.pg_bin / 'initdb', '-D', base / 'db', '-U', 'postgres',
         '-A', 'trust', '--no-locale', '--encoding=UTF8'])
    run([args.pg_bin / 'pg_ctl', '-D', base / 'db', '-l', base / 'log',
         '-o', f"-h '' -k {base}", '-w', 'start'])
    started = True
    query((root / 'scripts/ci/fixtures/governance-eco-original-week/schema.sql').read_text())
    query((root / 'scripts/ci/fixtures/governance-eco-original-week/before.sql').read_text())
    seed = """INSERT INTO ca_drift_incidents(id,source,dedupe_key,status,metadata,created_at,
      last_seen_at,detected_at) VALUES('f6593b8d-51fb-4114-9c66-d819f5b43cdc',
      'fn_ca_conservation_sweep:fn_union_governance_check',
      'sweep:fn_union_governance_check:2026-11-02','open',
      jsonb_build_object('rows',jsonb_build_array(jsonb_build_object(
        'invariant','union_eco_not_recorded','severity','warning','offenders',1,
        'detail','Unions with ECO enabled and no union_eco_ledger row for the settlement week that has CLOSED: that week''s win tax / loss rebate is not reproducible. The ledger is written at close, so the week in progress is not asked about'))),
      '2026-11-02 10:52Z','2026-11-08 22:52Z','2026-11-02 10:52Z');
      INSERT INTO ca_detector_runs VALUES('fn_ca_conservation_sweep',now()-interval '2 min','{}'),
        ('fn_ca_conservation_sweep',now()-interval '1 min','{}');"""
    query(seed)
    query('SELECT fn_ca_resolve_cleared_incidents()')
    assert query("SELECT status FROM ca_drift_incidents LIMIT 1") == 'resolved'
    migration = root / 'supabase/migrations/20261109152239_governance_eco_incidents_keep_their_original_week.sql'
    query(migration.read_text())
    assert query("SELECT status FROM ca_drift_incidents LIMIT 1") == 'open'
    assert query("SELECT count(*) FROM ca_incident_events WHERE kind='reopened' AND detail#>>'{prior_resolution,status}'='resolved'") == '1'
    query('SELECT fn_ca_resolve_cleared_incidents()')
    assert query("SELECT status FROM ca_drift_incidents LIMIT 1") == 'open'
    # Rollover and running books cannot prove the original invariant.
    query("""INSERT INTO union_accounting_runs VALUES('union','fade0000-0000-0000-0000-000000000001',
      '2026-10-26 07:00Z','2026-11-02 08:00Z','running','{"success":true,"accounting_version":"3"}');
      INSERT INTO union_eco_ledger VALUES('fade0000-0000-0000-0000-000000000001',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','2026-11-02 08:00Z','2026-11-09 08:00Z');""")
    proof = 'SELECT fn_ca_governance_eco_proven(metadata) FROM ca_drift_incidents LIMIT 1'
    assert query(proof) == 'f'
    # A lone club ECO row cannot pass while the original books remain partial.
    query("INSERT INTO union_eco_ledger VALUES('fade0000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','2026-10-26 07:00Z','2026-11-02 08:00Z')")
    assert query(proof) == 'f'
    query("UPDATE union_accounting_runs SET status='complete'")
    assert query(proof) == 't'
    # Wrong canonical end and malformed obligations fail closed.
    query("UPDATE ca_drift_incidents SET metadata=jsonb_set(metadata,'{eco_obligations,0,period_end}','\"2026-11-02T07:00Z\"')")
    assert query(proof) == 'f'
    query("UPDATE ca_drift_incidents SET metadata=jsonb_set(metadata,'{eco_obligations,0,period_end}','\"2026-11-02T08:00Z\"')")
    assert query("SELECT fn_ca_governance_eco_proven('{\"eco_obligations\":[{\"union_id\":\"bad\"}]}')") == 'f'
    assert query("SELECT fn_ca_governance_eco_proven('{\"eco_obligations\":[]}')") == 'f'
    # The actual sweep carries the old obligation when only another invariant fires.
    query("UPDATE fixture_clock SET at='2026-11-09 15:00Z'; UPDATE fixture_rows SET rows='[{\"invariant\":\"other_governance\"}]'")
    query('SELECT fn_ca_conservation_sweep()')
    assert query("SELECT metadata#>>'{eco_obligations,0,period_end}' FROM fixture_raised WHERE source='fn_ca_conservation_sweep:fn_union_governance_check' ORDER BY n DESC LIMIT 1") == '2026-11-02T08:00Z'
    query('SELECT fn_ca_resolve_cleared_incidents()')
    assert query("SELECT status FROM ca_drift_incidents LIMIT 1") == 'resolved'
    print(json.dumps({'passed': True, 'false_closure_reproduced': True,
                      'exact_original_reopened': True, 'running_and_rollover_refused': True,
                      'partial_club_books_refused': True, 'closed_original_accepted': True,
                      'wrong_dst_end_refused': True, 'refreshed_metadata_retains_original': True}))
finally:
    if started:
        run([args.pg_bin / 'pg_ctl', '-D', base / 'db', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(base)
