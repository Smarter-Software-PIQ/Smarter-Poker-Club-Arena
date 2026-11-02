#!/usr/bin/env python3
"""Native proof for 20261102151428_v31_evaluation_epochs_bind_the_engine_commit.

Runs the exact migration file against a throwaway PostgreSQL 17 cluster (never
production). The five replaced functions are installed from byte-exact copies
of their live definitions (scripts/ci/fixtures/v31-evaluation-epochs), so the
migration's own md5 preimage guards must pass, and every scenario then drives
the real replaced functions:

  * a receipt needs an open epoch, and only for that epoch's engine commit
  * one epoch never mixes commits; duplicates are refused or idempotent
  * a new epoch is allowed only for a different, never-evaluated commit, with
    an audited reason; every prior row stays byte-identical and immutable
  * promotion requires the exact epoch commit and its own eight receipts and
    records the promoted engine and serving commits
  * reopening after promotion, after a loss, or for an old commit is refused
  * grants of the replaced functions are unchanged; new ones are service only

`--mutations` re-runs the scenario against deliberately weakened copies of
the migration and requires every one of them to be detected.
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261102151428_v31_evaluation_epochs_bind_the_engine_commit.sql'
FIXTURES = ROOT / 'scripts/ci/fixtures/v31-evaluation-epochs'
PREIMAGE_FILES = ['00-schema.sql', '01-record-evaluation.sql', '02-mark-candidate.sql', '03-promote-dataset.sql',
                  '04-candidate-evaluations-valid.sql', '05-certification-status.sql', '06-grants.sql']
REPLACED = ['fn_gto_v31_record_evaluation(uuid,text,text,bigint)', 'fn_gto_v31_mark_candidate(uuid)',
            'fn_gto_v31_promote_dataset(uuid)', 'fn_gto_v31_candidate_evaluations_valid(uuid,text)',
            'ca_gto_v31_certification_status(uuid)']
LIVE_MD5 = {
    'fn_gto_v31_record_evaluation(uuid,text,text,bigint)': '3b101b069b9f378353790788cccd4828',
    'fn_gto_v31_mark_candidate(uuid)': 'c9df8d266f5d95a6ec6b3f31c3b06411',
    'fn_gto_v31_promote_dataset(uuid)': '85426bdfee8bbcfe7dd58f8945872d37',
    'fn_gto_v31_candidate_evaluations_valid(uuid,text)': '2c0ebbdfdeeec75b84c7287d96a97d56',
    'ca_gto_v31_certification_status(uuid)': 'f6677026ae245e1f587dc0d3f56485c6',
}
KINDS = ['paired_replay', 'league']
FAMILIES = {'cash': ['cash_ev'], 'spin': ['chip_ev', 'spin_ladder'], 'tourney_ev': ['chip_ev'],
            'tourney_icm': ['satellite', 'bubble', 'final_table', 'in_money', 'ladder']}
ROLES = ['open', 'cbet', 'probe', 'delayed_cbet', 'barrel', 'facing_bet', 'facing_raise', 'check_raise',
         'bet_raise', 'all_in']
C1, C2, C3, SERVING = 'a1' * 20, 'b2' * 20, 'c3' * 20, 'd4' * 20
REASON = 'Serving engine moved to a closure-incompatible commit; audited re-evaluation'


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


class Refused(AssertionError):
    pass


class Cluster:
    def __init__(self):
        os.environ.setdefault('LC_ALL', 'C')
        os.environ.setdefault('LANG', 'C')
        self.scratch = Path(tempfile.mkdtemp(prefix='v31-epochs-', dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')))
        # Unix socket paths are limited to ~103 bytes; keep the socket directory short.
        self.sock = Path(tempfile.mkdtemp(prefix='pge', dir=os.environ.get('PG_SOCKET_ROOT') or self.scratch))
        self.port = str(56000 + os.getpid() % 4000)
        data = self.scratch / 'data'
        subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {self.sock} -p {self.port} -c listen_addresses=''",
                        '-l', str(self.scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
        self.data = data
        self.n = 0

    def stop(self):
        subprocess.run([pg_bin('pg_ctl'), '-D', str(self.data), '-m', 'fast', 'stop'], capture_output=True)
        shutil.rmtree(self.scratch, ignore_errors=True)
        shutil.rmtree(self.sock, ignore_errors=True)

    def psql(self, db, args):
        return subprocess.run([pg_bin('psql'), '-h', str(self.sock), '-p', self.port, '-U', 'postgres', '-d', db,
                               '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', *args], capture_output=True, text=True)

    def fresh(self):
        self.n += 1
        name = f'proof{self.n}'
        r = self.psql('postgres', ['-c', f'CREATE DATABASE {name} TEMPLATE template0'])
        assert r.returncode == 0, r.stderr
        return Db(self, name)


class Db:
    def __init__(self, cluster, name):
        self.cluster, self.name = cluster, name

    def file(self, path):
        r = self.cluster.psql(self.name, ['-f', str(path)])
        if r.returncode != 0:
            raise Refused(r.stderr)

    def sql(self, text, refused=None):
        r = self.cluster.psql(self.name, ['-c', text])
        if refused is not None:
            if r.returncode == 0:
                raise AssertionError(f'expected refusal "{refused}" but succeeded: {text[:160]}')
            if refused not in r.stderr:
                raise AssertionError(f'expected refusal "{refused}", got: {r.stderr.strip()[:400]}')
            return r.stderr
        if r.returncode != 0:
            raise AssertionError(f'{text[:200]}\n{r.stderr}')
        return r.stdout.strip()


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def install(db, migration_text):
    for name in PREIMAGE_FILES:
        db.file(FIXTURES / name)
    for sig, md5 in LIVE_MD5.items():
        got = db.sql(f"SELECT md5(pg_get_functiondef('public.{sig}'::regprocedure))")
        assert got == md5, f'fixture preimage of {sig} is not byte-identical to production ({got})'
    acl_before = acls(db)
    path = Path(db.cluster.scratch) / f'{db.name}-migration.sql'
    path.write_text(migration_text)
    db.file(path)
    return acl_before


def acls(db):
    return db.sql("SELECT string_agg(p.oid::regprocedure::text||'='||coalesce(p.proacl::text,''),';' ORDER BY 1) "
                  "FROM pg_proc p WHERE p.oid IN (" + ','.join(f"'public.{s}'::regprocedure" for s in REPLACED) + ')')


def dataset(db, key, checksum_seed):
    bundle = db.sql("INSERT INTO gto_v31_input_bundles(bundle_key,bundle_checksum,range_bundle_checksum,"
                    "source_combo_order_checksum,icm_model_checksum,bundle_manifest) VALUES "
                    f"({q(key)},repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),'{{}}') RETURNING input_bundle_id")
    ds = db.sql("INSERT INTO gto_v31_datasets(dataset_key,state,quality_status,solver_version,solver_binary_checksum,"
                "pipeline_commit,pipeline_bundle_checksum,manifest_version,manifest_checksum,source_combo_order_checksum,"
                "range_bundle_checksum,icm_model_checksum,input_bundle_id,input_bundle_checksum,machine_ids,"
                "declared_coverage,quality_gates,coverage,heldout_metrics) VALUES "
                f"({q(key)},'evaluating','validated','pio-3',repeat('1',64),repeat('2',40),repeat('3',64),'m1',repeat('4',64),"
                f"repeat('d',64),repeat('c',64),repeat('e',64),'{bundle}',repeat('b',64),ARRAY['M1','M2'],'[{{}}]',"
                "'{\"max_frequency_mae\":0.05,\"max_sizing_mae\":0.05,\"max_policy_ev_mae_bb\":0.05,"
                "\"max_action_regret_bb\":0.05,\"min_regret_coverage\":0.95}','{\"complete\":true}',"
                "'{\"frequency_mae\":0.01,\"sizing_mae\":0.01,\"sizing_observations\":5,\"policy_ev_mae_bb\":0.01,"
                "\"mean_action_regret_bb\":0.01,\"regret_coverage\":0.99,\"by_family\":{\"cash\":{\"sizing_observations\":1},"
                "\"spin\":{\"sizing_observations\":1},\"tourney_ev\":{\"sizing_observations\":1},"
                "\"tourney_icm\":{\"sizing_observations\":1}}}') RETURNING dataset_id")
    for i in range(3):
        db.sql(f"INSERT INTO gto_v31_runtime_cells(dataset_id,cell_key_checksum,cell_payload_checksum,lineage_checksum) "
               f"VALUES ('{ds}',md5('{checksum_seed}k{i}'),md5('{checksum_seed}p{i}'),md5('{checksum_seed}l{i}'))")
    db.sql(f"INSERT INTO gto_v31_source_artifacts(dataset_id,source_artifact_checksum) VALUES ('{ds}',md5('{checksum_seed}s'))")
    db.sql("UPDATE gto_v31_datasets d SET dataset_checksum=(SELECT encode(digest(d.dataset_key||':'||d.pipeline_bundle_checksum"
           "||':'||d.manifest_checksum||':'||d.input_bundle_checksum||':'||string_agg(cell_key_checksum||':'||"
           "cell_payload_checksum||':'||lineage_checksum,'' ORDER BY cell_key_checksum),'sha256'),'hex') "
           f"FROM gto_v31_runtime_cells WHERE dataset_id='{ds}'), source_artifact_checksum=(SELECT encode(digest("
           "string_agg(DISTINCT source_artifact_checksum,'' ORDER BY source_artifact_checksum),'sha256'),'hex') "
           f"FROM gto_v31_source_artifacts WHERE dataset_id='{ds}') WHERE dataset_id='{ds}'")
    checksum = db.sql(f"SELECT dataset_checksum FROM gto_v31_datasets WHERE dataset_id='{ds}'")
    db.sql("INSERT INTO gto_v31_release_evaluations(dataset_id,dataset_checksum,evaluation_kind,game_family,verdict,"
           f"metrics,result_checksum) VALUES ('{ds}','{checksum}','heldout','all','pass','{{}}',repeat('f',64))")
    return ds, checksum


def result(db, checksum, kind, family, commit, epoch_no=1, bb100=0.0, day_offset=0, matchup=None, incumbent='legacy_v30'):
    scenarios = FAMILIES[family]
    hands, stderr = 12000, 1.0
    components = [{'scenario': s, 'hands': hands, 'bb100': bb100, 'stderr': stderr, 'duration_ms': 10,
                   'illegal_actions': 0, 'truncated_streets': 0, 'candidate_policy_hits': 7,
                   'candidate_execution_mismatches': 0, 'candidate_node_roles': ROLES} for s in scenarios]
    n = len(scenarios)
    total_stderr = stderr / math.sqrt(n)
    profile = 'policy_only_duplicate_deals' if kind == 'paired_replay' else 'full_brain_duplicate_deal_league'
    config_a = {'evaluation_contract': 'gto_v31_candidate.v2', 'evaluation_kind': kind, 'game_family': family,
                'dataset_checksum': checksum, 'candidate': 'v31_certified', 'evaluation_profile': profile,
                'scenarios': scenarios, 'evaluation_engine_commit': commit}
    config_b = {'incumbent_dataset_checksum': incumbent, 'candidate': 'incumbent'}
    if matchup is None:
        matchup = f'gto_v31_{kind}_{family}_{checksum}' + (f'_epoch{epoch_no}' if epoch_no > 1 else '')
    roles = '{' + ','.join(ROLES) + '}'
    return db.sql("INSERT INTO horse_league_results(run_date,matchup,hands,bb100,stderr,config_a,config_b,duration_ms,"
                  "illegal_actions,truncated_streets,candidate_policy_hits,candidate_node_roles,"
                  "candidate_benchmark_components,candidate_execution_mismatches) VALUES "
                  f"(current_date-{day_offset},{q(matchup)},{hands * n},{bb100},{total_stderr:.15f},{q(json.dumps(config_a))},"
                  f"{q(json.dumps(config_b))},{10 * n},0,0,{7 * n},'{roles}',{q(json.dumps(components))},0) RETURNING id")


def record(db, ds, kind, family, rid, refused=None):
    return db.sql(f"SELECT public.fn_gto_v31_record_evaluation('{ds}','{kind}','{family}',{rid})", refused)


def open_epoch(db, ds, commit, reason=REASON, refused=None):
    out = db.sql(f"SELECT public.fn_gto_v31_open_evaluation_epoch('{ds}',{q(commit)},'github-actions:test',{q(reason)})", refused)
    return None if refused else json.loads(out)


def record_all(db, ds, checksum, commit, epoch_no, bb100=0.0):
    for kind in KINDS:
        for family in FAMILIES:
            record(db, ds, kind, family, result(db, checksum, kind, family, commit, epoch_no, bb100))


def receipts_digest(db, ds):
    return db.sql(f"SELECT md5(string_agg(to_jsonb(e)::text,'|' ORDER BY evaluation_id)) FROM gto_v31_release_evaluations e WHERE dataset_id='{ds}'")


def scenario(cluster, migration_text):
    db = cluster.fresh()
    acl_before = install(db, migration_text)
    proof = re.search(r'^-- @live-proof: (.+)$', migration_text, re.M).group(1)
    assert db.sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
    assert acls(db) == acl_before, 'replaced functions must keep byte-identical grants'
    for fn in ['fn_gto_v31_open_evaluation_epoch(uuid,text,text,text)', 'fn_gto_v31_promote_dataset_epoch(uuid,text,text)']:
        assert db.sql(f"SELECT has_function_privilege('service_role','public.{fn}','EXECUTE')") == 't'
        for role in ['anon', 'authenticated']:
            assert db.sql(f"SELECT has_function_privilege('{role}','public.{fn}','EXECUTE')") == 'f', (fn, role)
    for role in ['anon', 'authenticated', 'service_role']:
        assert db.sql(f"SELECT has_table_privilege('{role}','public.gto_v31_evaluation_epochs','SELECT')") == 'f'

    ds, checksum = dataset(db, 'r7', 'r7')
    first = result(db, checksum, 'paired_replay', 'cash', C1)
    record(db, ds, 'paired_replay', 'cash', first, refused='no open evaluation epoch')
    open_epoch(db, ds, C1, reason='too short', refused='audited reason')
    open_epoch(db, ds, 'abc', refused='binds one full engine commit')
    e1 = open_epoch(db, ds, C1)
    assert e1['epoch_no'] == 1 and e1['opened'] is True and e1['superseded_epoch_no'] is None, e1
    again = open_epoch(db, ds, C1)
    assert again['epoch_id'] == e1['epoch_id'] and again['opened'] is False, again

    # One epoch never mixes engine commits.
    rid = record(db, ds, 'paired_replay', 'cash', first)
    assert record(db, ds, 'paired_replay', 'cash', first) == rid, 'same result is idempotent'
    other = result(db, checksum, 'paired_replay', 'cash', C1, day_offset=1)
    record(db, ds, 'paired_replay', 'cash', other, refused='already exists with another result')
    mixed = result(db, checksum, 'league', 'cash', C2, day_offset=1)
    record(db, ds, 'league', 'cash', mixed, refused='differs from the open evaluation epoch')
    db.sql("INSERT INTO gto_v31_release_evaluations(dataset_id,dataset_checksum,evaluation_kind,game_family,verdict,metrics,"
           f"source_result_id,result_checksum,evaluation_epoch_id,evaluation_engine_commit) VALUES ('{ds}','{checksum}',"
           f"'league','cash','tie','{{\"candidate_config\":{{\"evaluation_engine_commit\":\"{C2}\"}}}}',{mixed},repeat('9',64),"
           f"'{e1['epoch_id']}','{C2}')", refused='open evaluation epoch of their engine commit')
    for kind in KINDS:
        for family in FAMILIES:
            if (kind, family) != ('paired_replay', 'cash'):
                record(db, ds, kind, family, result(db, checksum, kind, family, C1, 1, 0.0))
    db.sql(f"SELECT public.fn_gto_v31_mark_candidate('{ds}')")
    assert db.sql(f"SELECT state FROM gto_v31_datasets WHERE dataset_id='{ds}'") == 'candidate'
    before = receipts_digest(db, ds)

    # Promotion is bound to the evaluated epoch's commit (a version change between
    # the checks and the promotion call is refused inside the database).
    db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C2)},{q(SERVING)})", refused='differs from the evaluated epoch')
    db.sql(f"SELECT public.fn_gto_v31_promote_dataset('{ds}')", refused='must name the evaluated engine commit')
    assert db.sql("SELECT count(*) FROM pg_proc WHERE proname='fn_gto_v31_promote_dataset'") == '1'
    assert db.sql(f"SELECT state FROM gto_v31_datasets WHERE dataset_id='{ds}'") == 'candidate'

    # A new epoch for a different commit: audited, prior rows untouched and immutable.
    open_epoch(db, ds, C2, reason='short', refused='audited reason')
    e2 = open_epoch(db, ds, C2)
    assert e2['epoch_no'] == 2 and e2['opened'] is True and e2['superseded_epoch_no'] == 1, e2
    assert receipts_digest(db, ds) == before, 'prior receipts must stay byte-identical'
    row = db.sql(f"SELECT state||'|'||paired_replay::text||'|'||coalesce(candidate_at::text,'null') FROM gto_v31_datasets WHERE dataset_id='{ds}'")
    assert row == 'evaluating|{}|null', row
    snap = json.loads(db.sql(f"SELECT superseded_candidate FROM gto_v31_evaluation_epochs WHERE epoch_id='{e1['epoch_id']}'"))
    assert snap['state'] == 'candidate' and len(snap['paired_replay']['evaluations']) == 4, snap
    db.sql(f"UPDATE gto_v31_release_evaluations SET verdict='win' WHERE dataset_id='{ds}' AND evaluation_kind='league'",
           refused='receipt is immutable')
    db.sql(f"DELETE FROM gto_v31_release_evaluations WHERE dataset_id='{ds}'", refused='receipt is immutable')
    db.sql(f"UPDATE gto_v31_evaluation_epochs SET engine_commit={q(C3)} WHERE epoch_id='{e1['epoch_id']}'",
           refused='permanent provenance')
    db.sql(f"UPDATE gto_v31_evaluation_epochs SET superseded_at=now() WHERE epoch_id='{e1['epoch_id']}'",
           refused='permanent provenance')
    db.sql(f"DELETE FROM gto_v31_evaluation_epochs WHERE epoch_id='{e1['epoch_id']}'", refused='permanent provenance')
    open_epoch(db, ds, C1, refused='evaluated at most once per dataset')

    # Epoch 2 records only C2 results under its own matchup.
    plain = result(db, checksum, 'league', 'spin', C2, epoch_no=1, day_offset=2)
    record(db, ds, 'league', 'spin', plain, refused='not bound to this candidate')
    stale = result(db, checksum, 'league', 'tourney_ev', C1, epoch_no=2, day_offset=1)
    record(db, ds, 'league', 'tourney_ev', stale, refused='differs from the open evaluation epoch')
    db.sql(f"SELECT public.fn_gto_v31_mark_candidate('{ds}')", refused='missing approved, execution-bound release evidence')
    record_all(db, ds, checksum, C2, 2, bb100=5.0)
    total = db.sql(f"SELECT count(*)||'/'||count(DISTINCT evaluation_engine_commit) FROM gto_v31_release_evaluations WHERE dataset_id='{ds}' AND evaluation_kind<>'heldout'")
    assert total == '16/2', total
    db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C2)},{q(SERVING)})", refused='dataset is not a candidate')
    db.sql(f"SELECT public.fn_gto_v31_mark_candidate('{ds}')")
    db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C1)},{q(SERVING)})", refused='differs from the evaluated epoch')
    db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C2)},'nope')", refused='full serving engine commit')
    assert db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C2)},{q(SERVING)})") == checksum
    row = db.sql(f"SELECT d.state||'|'||p.epoch_no||'|'||p.engine_commit||'|'||p.promoted_serving_commit FROM gto_v31_datasets d "
                 f"JOIN gto_v31_evaluation_epochs p ON p.dataset_id=d.dataset_id AND p.promoted_at IS NOT NULL WHERE d.dataset_id='{ds}'")
    assert row == f'active|2|{C2}|{SERVING}', row
    assert receipts_digest(db, ds) != before and db.sql(
        f"SELECT count(*) FROM gto_v31_release_evaluations WHERE dataset_id='{ds}' AND evaluation_epoch_id='{e1['epoch_id']}'") == '8'

    # Reopening after promotion is refused forever, without ever waiting on the
    # release gate a concurrent promotion holds (no lock-order deadlock).
    holder = subprocess.Popen([pg_bin('psql'), '-h', str(cluster.sock), '-p', cluster.port, '-U', 'postgres', '-d', db.name,
                               '-X', '-q', '-c', "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('smarter-poker:gto-v31-release-gate', 0)); "
                               f"SELECT 1 FROM gto_v31_datasets WHERE dataset_id='{ds}' FOR UPDATE; SELECT pg_sleep(4); COMMIT;"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1)
        out = db.sql(f"SET lock_timeout='2s'; SELECT public.fn_gto_v31_open_evaluation_epoch('{ds}',{q(C3)},'github-actions:test',{q(REASON)})",
                     refused='never reopens evaluation')
        assert 'lock timeout' not in out, out
    finally:
        holder.wait(timeout=30)
    open_epoch(db, ds, C3, refused='never reopens evaluation')
    record(db, ds, 'league', 'cash', result(db, checksum, 'league', 'cash', C3, 3), refused='not awaiting evaluation')
    db.sql(f"UPDATE gto_v31_evaluation_epochs SET promoted_serving_commit={q(C3)} WHERE epoch_id='{e2['epoch_id']}'",
           refused='permanent provenance')

    status = json.loads(db.sql(f"SET request.jwt.claim.role='service_role'; SELECT public.ca_gto_v31_certification_status('{ds}')"))['datasets'][0]
    assert status['current_epoch']['epoch_no'] == 2 and status['current_epoch']['promoted_serving_commit'] == SERVING
    assert [e['epoch_no'] for e in status['evaluation_epochs']] == [1, 2]
    assert status['evaluation_epochs'][0]['superseded_by_epoch_no'] == 2
    assert sum(1 for e in status['evaluations'] if e['evaluation_engine_commit'] == C1) == 8
    assert sum(1 for e in status['evaluations'] if e['evaluation_engine_commit'] == C2) == 8

    # A dataset that ever lost is never re-evaluated on another engine.
    lost, lost_sum = dataset(db, 'lost', 'lost')
    open_epoch(db, lost, C1)
    record(db, lost, 'paired_replay', 'cash', result(db, lost_sum, 'paired_replay', 'cash', C1, 1, -5.0, incumbent=checksum))
    open_epoch(db, lost, C2, refused='lost a release evaluation')
    # Held-out stays one per dataset.
    db.sql("INSERT INTO gto_v31_release_evaluations(dataset_id,dataset_checksum,evaluation_kind,game_family,verdict,metrics,"
           f"result_checksum) VALUES ('{lost}','{lost_sum}','heldout','all','pass','{{}}',repeat('a',64))",
           refused='gto_v31_release_evaluations_one_heldout')
    # The dataset cascade still removes its own epochs and receipts.
    db.sql(f"DELETE FROM horse_league_results WHERE matchup LIKE '%{lost_sum}%' AND id NOT IN (SELECT source_result_id FROM gto_v31_release_evaluations WHERE source_result_id IS NOT NULL)")
    db.sql(f"DELETE FROM gto_v31_datasets WHERE dataset_id='{lost}'")
    assert db.sql(f"SELECT count(*) FROM gto_v31_evaluation_epochs WHERE dataset_id='{lost}'") == '0'

    # The preimage guards refuse a changed live definition.
    db2 = cluster.fresh()
    for name in PREIMAGE_FILES:
        db2.file(FIXTURES / name)
    db2.sql("CREATE OR REPLACE FUNCTION public.fn_gto_v31_mark_candidate(p_dataset_id uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'drifted' $$")
    path = Path(cluster.scratch) / f'{db2.name}-migration.sql'
    path.write_text(migration_text)
    try:
        db2.file(path)
    except Refused as error:
        assert 'fn_gto_v31_mark_candidate_preimage_changed' in str(error), str(error)
    else:
        raise AssertionError('a drifted preimage must refuse the migration')
    assert db2.sql("SELECT to_regclass('public.gto_v31_evaluation_epochs') IS NULL") == 't'
    return 'ok'


MUTATIONS = [
    ('record ignores the epoch commit',
     "IF v_result.config_a->>'evaluation_engine_commit' IS DISTINCT FROM v_epoch.engine_commit THEN",
     "IF false THEN"),
    ('promotion ignores the evaluated commit',
     "IF v_epoch.engine_commit IS DISTINCT FROM p_engine_commit THEN", "IF false THEN"),
    ('a commit may be evaluated twice',
     "    RAISE EXCEPTION 'an engine commit is evaluated at most once per dataset';\n", "    NULL;\n"),
    ('evaluation reopens after promotion',
     [("  IF v_dataset.state NOT IN ('evaluating','candidate')\n     OR EXISTS", "  IF false\n     AND EXISTS"),
      ("   WHERE dataset_id=p_dataset_id AND state IN ('evaluating','candidate') FOR UPDATE;",
       "   WHERE dataset_id=p_dataset_id FOR UPDATE;")], None),
    ('qualification counts every epoch',
     "     AND e.game_family IN ('cash','spin','tourney_ev','tourney_icm')\n     AND e.evaluation_epoch_id=v_epoch_id;",
     "     AND e.game_family IN ('cash','spin','tourney_ev','tourney_icm');"),
    ('preimage md5 drifts', "IS DISTINCT FROM '3b101b069b9f378353790788cccd4828'", "IS DISTINCT FROM '3b101b069b9f378353790788cccd4829'"),
    ('receipts become updatable',
     "  IF TG_OP = 'UPDATE' THEN\n    RAISE EXCEPTION 'a release evaluation receipt is immutable';\n  END IF;\n", ""),
    ('a lost dataset is re-evaluated',
     "    RAISE EXCEPTION 'a dataset that lost a release evaluation is never re-evaluated on another engine';\n", "    NULL;\n"),
    ('later epochs reuse the first matchup', "THEN '_epoch'||p_epoch_no ELSE '' END", "THEN '' ELSE '' END"),
    ('a superseded candidate stays a candidate',
     "    IF v_dataset.state='candidate' THEN\n      UPDATE public.gto_v31_datasets",
     "    IF false THEN\n      UPDATE public.gto_v31_datasets"),
    ('epochs lose their identity guard',
     " OR NEW.engine_commit IS DISTINCT FROM OLD.engine_commit\n", "\n"),
    ('the open epoch may receive any commit', "        AND p.engine_commit = NEW.evaluation_engine_commit\n", ""),
]


def main():
    text = MIGRATION.read_text()
    cluster = Cluster()
    try:
        scenario(cluster, text)
        print('v31 evaluation epochs: native proof passed')
        if '--mutations' in sys.argv:
            survived = []
            for label, old, new in MUTATIONS:
                mutated = text
                for a, b in (old if isinstance(old, list) else [(old, new)]):
                    assert mutated.count(a) == 1, f'mutation anchor not unique: {label}'
                    mutated = mutated.replace(a, b)
                try:
                    scenario(cluster, mutated)
                except AssertionError as error:
                    print(f'  killed: {label} ({str(error).splitlines()[0][:120]})')
                else:
                    survived.append(label)
                    print(f'  SURVIVED: {label}')
            assert not survived, f'mutations survived: {survived}'
            print(f'v31 evaluation epochs: {len(MUTATIONS)}/{len(MUTATIONS)} mutations killed')
    finally:
        cluster.stop()


if __name__ == '__main__':
    main()
