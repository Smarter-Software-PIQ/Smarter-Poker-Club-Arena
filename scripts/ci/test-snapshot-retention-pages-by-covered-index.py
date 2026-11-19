"""Native PostgreSQL regression for 20261119173316 (snapshot retention pages by
its covered index).

Production 2026-11-19: about 627,000 expired snapshots hold no disposal
certificate, so every pass revisits them. The previous function read each
candidate's heap row and issued one DELETE statement per row, so a pass over
the refused backlog held a connection at its full 20 s budget for hours.

This proves, on a throwaway cluster and never production:
  * the preimage installed is the exact live definition (md5 b192cde1...);
  * the migration (preamble index, then its one transaction) deletes exactly
    the rows the previous function deletes from the same fixture;
  * the eligibility function is called only for certified rows, never for a
    refused one, and the page read is an index-only scan of the new index;
  * cursor, wrap, examined counter, rollback atomicity and ACL are unchanged;
  * a replay is refused by the preimage guard.
"""
import ast
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
OUT = Path(os.environ.get('SNAPSHOT_TEST_OUTPUT', ROOT / 'artifacts/snapshot-retention-covered-index'))
OUT.mkdir(parents=True, exist_ok=True)
cluster = Path(tempfile.mkdtemp(prefix='src-'))
sock = cluster / 's'
sock.mkdir()
owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
psql = [PG / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', sock,
        '-p', '55839', '-U', 'postgres', '-d', 'postgres']
checks = []
MIGRATION = ROOT / 'supabase/migrations/20261119173316_snapshot_retention_pages_by_covered_index.sql'
PREVIOUS = next((ROOT / 'supabase/migrations').glob('*_snapshot_retention_traverses_bounded_candidates_before_eligi.sql'))


def cmd(args, sql=None, ok=True):
    p = subprocess.run(list(map(str, args)), input=sql, text=True,
                       capture_output=True, env=env, timeout=120)
    if ok and p.returncode:
        raise RuntimeError(p.stderr)
    return p


def run(sql):
    return cmd(psql, sql).stdout.strip()


def check(name, result):
    checks.append({'name': name, 'passed': bool(result)})
    assert result, name


def calls():
    return int(run("SELECT last_value::int FROM smarter_private.disposable_calls"))


# 3,000 expired snapshots: rows 1-2400 hold no certificate (the production
# backlog shape), 2401-2600 are certified human witnesses (refused by the
# eligibility function), 2601-2800 certified horse-only (deleted),
# 2801-2900 certified horse-only with a reserved permit (retained),
# 2901-3000 certified horse-only (deleted). 200 young rows never qualify.
SEED = """TRUNCATE hand_state_snapshots, smarter_private.horse_adaptive_disposal_certificates, smarter_private.f06_hand_permits;
INSERT INTO hand_state_snapshots(id,table_id,hand_number,created_at,updated_at,players_json)
SELECT md5(g::text)::uuid,md5('table')::uuid,g,
  now()-interval '20 days'+g*interval '1 second',now()-interval '20 days',
  CASE WHEN g BETWEEN 2401 AND 2600 THEN '[{"is_horse":false}]'::jsonb ELSE '[{"is_horse":true}]'::jsonb END
  FROM generate_series(1,3000) g;
INSERT INTO hand_state_snapshots(id,table_id,hand_number,created_at,updated_at,players_json)
SELECT md5('young'||g)::uuid,md5('table')::uuid,100000+g,now()-interval '1 day',now()-interval '1 day','[{"is_horse":true}]'
  FROM generate_series(1,200) g;
INSERT INTO smarter_private.horse_adaptive_disposal_certificates
  SELECT gen_random_uuid(),table_id,hand_number FROM hand_state_snapshots WHERE hand_number BETWEEN 2401 AND 3000 OR hand_number>100000;
INSERT INTO smarter_private.f06_hand_permits SELECT md5('table')::uuid,g,'reserved' FROM generate_series(2801,2900) g;
UPDATE smarter_private.snapshot_retention_scan SET through_at='-infinity',after_id='00000000-0000-0000-0000-000000000000',examined=0;
VACUUM ANALYZE hand_state_snapshots; ANALYZE smarter_private.horse_adaptive_disposal_certificates;
"""


def drain():
    """Run calls until the pass wraps; return total deleted and calls made."""
    total, n = 0, 0
    while True:
        n += 1
        total += int(run('SELECT sp_prune_hand_state_snapshots(10000)'))
        if run("SELECT through_at='-infinity' FROM smarter_private.snapshot_retention_scan") == 't':
            return total, n
        assert n < 20, 'pass never wrapped'


try:
    cmd(owner + [PG / 'initdb', '-D', cluster / 'd', '-U', 'postgres', '--auth-local=trust',
                 '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
    cmd(owner + [PG / 'pg_ctl', '-D', cluster / 'd', '-l', cluster / 'log', '-o',
                 f"-k {sock} -p 55839 -c listen_addresses='' -c shared_buffers=16MB", '-w', 'start'])
    module = ast.parse((ROOT / 'scripts/ci/test-snapshot-prune-reads-its-age-bound.py').read_text())
    schema = next(ast.literal_eval(n.value) for n in module.body
                  if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'SCHEMA' for t in n.targets))
    run(schema)
    run((ROOT / 'scripts/ci/fixtures/snapshot-prune-bounded-preimage.sql').read_text())
    run('REVOKE ALL ON FUNCTION sp_prune_hand_state_snapshots(integer) FROM PUBLIC; GRANT EXECUTE ON FUNCTION sp_prune_hand_state_snapshots(integer) TO service_role;')
    run(PREVIOUS.read_text())
    check('preimage-is-the-live-definition',
          run("SELECT md5(pg_get_functiondef('sp_prune_hand_state_snapshots(integer)'::regprocedure))") == 'b192cde11e809c4477e9b009a353178a')

    # Baseline: the previous definition, same fixture.
    run(SEED)
    before = calls()
    old_deleted, _ = drain()
    old_calls = calls() - before
    old_survivors = run('SELECT md5(string_agg(id::text,\',\' ORDER BY id)) FROM hand_state_snapshots')
    check('baseline-deletes-the-300-eligible-rows', old_deleted == 300)
    check('baseline-calls-eligibility-for-refused-uncertified-rows-too', old_calls > 2500)

    meta = run("SELECT oid::text||':'||proacl::text FROM pg_proc WHERE oid='sp_prune_hand_state_snapshots(integer)'::regprocedure")
    migration = MIGRATION.read_text()
    check('migration-refused-without-its-index',
          cmd(psql, migration[migration.index('\nBEGIN;\n') + 1:], False).returncode != 0)
    # psql sends each statement separately: the CONCURRENTLY preamble runs
    # outside any transaction, then the one transaction, as the applier does.
    run(migration)
    check('function-identity-and-access-preserved', meta == run(
        "SELECT oid::text||':'||proacl::text FROM pg_proc WHERE oid='sp_prune_hand_state_snapshots(integer)'::regprocedure"))
    check('live-proof-true', run("SELECT to_regclass('public.idx_hand_state_snapshots_retention_cover') IS NOT NULL AND position('SNAPSHOT RETENTION PAGES BY ITS COVERED INDEX' in pg_get_functiondef('public.sp_prune_hand_state_snapshots(integer)'::regprocedure)) > 0") == 't')

    run(SEED)
    before = calls()
    new_deleted, new_runs = drain()
    new_calls = calls() - before
    check('same-rows-deleted-as-the-previous-definition',
          new_deleted == old_deleted and run('SELECT md5(string_agg(id::text,\',\' ORDER BY id)) FROM hand_state_snapshots') == old_survivors)
    check('eligibility-called-only-for-certified-unreserved-rows', new_calls == 500)
    check('human-and-reserved-witnesses-retained',
          run("SELECT count(*) FROM hand_state_snapshots WHERE hand_number BETWEEN 2401 AND 2600 OR hand_number BETWEEN 2801 AND 2900") == '300')
    check('examined-counts-every-expired-row-once-per-pass',
          run('SELECT examined FROM smarter_private.snapshot_retention_scan') == '3000')
    plan = run("""EXPLAIN SELECT s.id,s.created_at,s.table_id,s.hand_number FROM hand_state_snapshots s
      WHERE s.created_at >= '-infinity' AND (s.created_at,s.id) > ('-infinity'::timestamptz,'00000000-0000-0000-0000-000000000000'::uuid)
        AND s.created_at < statement_timestamp()-interval '8 days' ORDER BY s.created_at,s.id LIMIT 1000""")
    check('page-is-an-index-only-scan-of-the-cover', 'Index Only Scan using idx_hand_state_snapshots_retention_cover' in plan)

    # p_batch still bounds one call; a short page continues from the cursor.
    run(SEED)
    check('p-batch-bounds-one-call', run('SELECT sp_prune_hand_state_snapshots(2500); SELECT examined FROM smarter_private.snapshot_retention_scan') == '0\n2500')
    check('next-call-continues-from-cursor', run('SELECT sp_prune_hand_state_snapshots(2500)') == '300')
    check('pass-ends-then-wraps', run("SELECT sp_prune_hand_state_snapshots(2500); SELECT through_at='-infinity' FROM smarter_private.snapshot_retention_scan") == '0\nt')

    # A row that becomes disposable later is found on the next pass.
    run("UPDATE hand_state_snapshots SET players_json='[{\"is_horse\":true}]' WHERE hand_number=2401;")
    cursor = run('SELECT row_to_json(s) FROM smarter_private.snapshot_retention_scan s')
    run('BEGIN; SELECT sp_prune_hand_state_snapshots(10000); ROLLBACK;')
    check('cursor-and-deletion-roll-back-together',
          cursor == run('SELECT row_to_json(s) FROM smarter_private.snapshot_retention_scan s')
          and run('SELECT count(*) FROM hand_state_snapshots WHERE hand_number=2401') == '1')
    check('previously-held-row-revisited', run('SELECT sp_prune_hand_state_snapshots(10000)') == '1')
    check('young-rows-untouched', run('SELECT count(*) FROM hand_state_snapshots WHERE hand_number>100000') == '200')
    check('migration-replay-refused', cmd(psql, migration, False).returncode != 0)
    print(json.dumps({'checks': checks, 'production_mutations': False,
                      'old_eligibility_calls': old_calls, 'new_eligibility_calls': new_calls,
                      'calls_to_drain_pass': new_runs}))
finally:
    (OUT / 'RESULTS.json').write_text(json.dumps({'checks': checks, 'production_mutations': False}, indent=2))
    cmd(owner + [PG / 'pg_ctl', '-D', cluster / 'd', '-m', 'immediate', '-w', 'stop'], ok=False)
    shutil.rmtree(cluster)
