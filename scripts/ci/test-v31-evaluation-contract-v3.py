#!/usr/bin/env python3
"""Native proof for the V31 evaluation contract v3 migration.

Runs the exact migration file against a throwaway PostgreSQL 17 cluster (never
production). Every function the migration patches is installed from a
byte-exact copy of its live definition (scripts/ci/fixtures/
v31-evaluation-contract-v3, read 2026-11-06), so the migration's md5 preimage
guards must pass and its postimage checks must hold. Then:

  * an existing dataset stays contract v2 and runs the unchanged v2 path end
    to end (eight receipts, mark candidate, promote); a new dataset is v3, a
    v2 insert and any change of contract are refused
  * the v3 plan derives exactly the tables, cells and pairs the TypeScript
    evaluator derives (GtoV31EvaluationContractV3.ts), byte for byte
  * a complete v3 receipt set records, marks a candidate and promotes with
    1 + 2 x families receipts and the dataset's own node roles and heldout
    families
  * every v3 rule refuses its violation: a missing, extra or reordered table,
    a table or memory-off run under 300 decisions or with the wrong hands, a
    league table without its memory-off run, a paired replay with one, an
    unexecuted / foreign / duplicated cell, a family without cells, totals
    that do not reconcile, a v2 config on a v3 dataset
  * the seal patch: v3 breadth is per carried family and objective; the
    heldout family list and the role list are the v2 constants for v2
  * grants of the patched functions are unchanged; new functions are owner
    only except the plan RPC (service_role)

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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
BREADTH_MIGRATION = MIGRATIONS / '20261110050500_v31_v3_breadth_is_the_streets_the_playbook_carries.sql'
FIXTURES = ROOT / 'scripts/ci/fixtures/v31-evaluation-contract-v3'
LIVE_MD5 = {
    'fn_gto_v31_record_evaluation(uuid,text,text,bigint)': '6c75961616dd0c48513a11b6aa0fba3b',
    'fn_gto_v31_candidate_evaluations_valid(uuid,text)': '3cb0fadb5fbb21e61eaab662e67ba35b',
    'fn_gto_v31_mark_candidate(uuid)': '02261b345a2bbd1987b8a4abbbc2d4f9',
    'fn_gto_v31_promote_dataset_epoch(uuid,text,text)': 'f87350cb2e4dca44921f419529d0e847',
    'fn_gto_v31_public215_seal_prepared(uuid)': '5004de7facc7f759bb6b8bc993f597b2',
    'ca_gto_v31_certification_status(uuid)': 'ae20103b60c148df94db32092e816610',
}
PATCHED = list(LIVE_MD5)
KINDS = ['paired_replay', 'league']
V2_FAMILIES = {'cash': ['cash_ev'], 'spin': ['chip_ev', 'spin_ladder'], 'tourney_ev': ['chip_ev'],
               'tourney_icm': ['satellite', 'bubble', 'final_table', 'in_money', 'ladder']}
ROLES = ['open', 'cbet', 'probe', 'delayed_cbet', 'barrel', 'facing_bet', 'facing_raise', 'check_raise',
         'bet_raise', 'all_in']
C1, SERVING = 'a1' * 20, 'd4' * 20
REASON = 'Contract v3 native proof: audited evaluation of this engine commit'


def migration_path():
    found = sorted(MIGRATIONS.glob('*_v31_evaluation_contract_v3_tests_the_playbooks_own_tables.sql'))
    if len(found) != 1:
        raise SystemExit(f'expected exactly one contract v3 migration, found {found}')
    return found[0]


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
        self.scratch = Path(tempfile.mkdtemp(prefix='v31-v3-', dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')))
        self.sock = Path(tempfile.mkdtemp(prefix='pgv3', dir=os.environ.get('PG_SOCKET_ROOT') or '/tmp'))
        self.port = str(52000 + os.getpid() % 4000)
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
                raise AssertionError(f'expected refusal "{refused}" but succeeded: {text[:200]}')
            if refused not in r.stderr:
                raise AssertionError(f'expected refusal "{refused}", got: {r.stderr.strip()[:500]}')
            return r.stderr
        if r.returncode != 0:
            raise AssertionError(f'{text[:300]}\n{r.stderr}')
        return r.stdout.strip()


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def acls(db, sigs):
    return db.sql("SELECT string_agg(p.oid::regprocedure::text||'='||coalesce(p.proacl::text,''),';' ORDER BY 1) "
                  "FROM pg_proc p WHERE p.oid IN (" + ','.join(f"'public.{s}'::regprocedure" for s in sigs) + ')')


def install_fixtures(db):
    for path in sorted(FIXTURES.glob('*.sql')):
        db.file(path)
    for sig, md5 in LIVE_MD5.items():
        got = db.sql(f"SELECT md5(pg_get_functiondef('public.{sig}'::regprocedure))")
        assert got == md5, f'fixture preimage of {sig} is not byte-identical to production ({got})'


def apply_migration(db, text):
    path = Path(db.cluster.scratch) / f'{db.name}-migration.sql'
    path.write_text(text)
    db.file(path)


# ── datasets ────────────────────────────────────────────────────────────────

GATES = ('{"max_frequency_mae":0.05,"max_sizing_mae":0.05,"max_policy_ev_mae_bb":0.05,'
         '"max_action_regret_bb":0.05,"min_regret_coverage":0.95}')


def heldout(families):
    return json.dumps({'frequency_mae': 0.01, 'sizing_mae': 0.01, 'sizing_observations': 5, 'policy_ev_mae_bb': 0.01,
                       'mean_action_regret_bb': 0.01, 'regret_coverage': 0.99,
                       'by_family': {f: {'sizing_observations': 1} for f in families}})


def dataset(db, key, cells, families, state='evaluating'):
    bundle = db.sql("INSERT INTO gto_v31_input_bundles(bundle_key,bundle_checksum,range_bundle_checksum,"
                    "source_combo_order_checksum,icm_model_checksum,bundle_manifest) VALUES "
                    f"({q(key)},repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),'{{}}') RETURNING input_bundle_id")
    ds = db.sql("INSERT INTO gto_v31_datasets(dataset_key,state,quality_status,solver_version,solver_binary_checksum,"
                "pipeline_commit,pipeline_bundle_checksum,manifest_version,manifest_checksum,source_combo_order_checksum,"
                "range_bundle_checksum,icm_model_checksum,input_bundle_id,input_bundle_checksum,machine_ids,"
                "declared_coverage,quality_gates,coverage,heldout_metrics) VALUES "
                f"({q(key)},'{state}','validated','pio-3',repeat('1',64),repeat('2',40),repeat('3',64),'m1',repeat('4',64),"
                f"repeat('d',64),repeat('c',64),repeat('e',64),'{bundle}',repeat('b',64),ARRAY['M1','M2'],'[{{}}]',"
                f"'{GATES}','{{\"complete\":true}}',{q(heldout(families))}) RETURNING dataset_id")
    for i, c in enumerate(cells):
        cols = ','.join(c)
        vals = ','.join(q(v) for v in c.values())
        db.sql(f"INSERT INTO gto_v31_runtime_cells(dataset_id,cell_key_checksum,cell_payload_checksum,lineage_checksum,{cols}) "
               f"VALUES ('{ds}',md5('{key}k{i}')||md5('{key}K{i}'),md5('{key}p{i}'),md5('{key}l{i}'),{vals})")
    db.sql(f"INSERT INTO gto_v31_source_artifacts(dataset_id,source_artifact_checksum) VALUES ('{ds}',md5('{key}s'))")
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


def cells_of(db, ds, family):
    out = db.sql(f"SELECT string_agg(cell_key_checksum,',' ORDER BY cell_key_checksum COLLATE \"C\") FROM gto_v31_runtime_cells "
                 f"WHERE dataset_id='{ds}' AND game_family={q(family)}")
    return out.split(',') if out else []


def insert_result(db, kind, family, checksum, config_a, components, hands, hits, bb100, stderr, duration,
                  roles, matchup=None, epoch_no=1, day_offset=0):
    if matchup is None:
        matchup = f'gto_v31_{kind}_{family}_{checksum}' + (f'_epoch{epoch_no}' if epoch_no > 1 else '')
    config_b = {'incumbent_dataset_checksum': 'legacy_v30', 'candidate': 'incumbent'}
    return db.sql("INSERT INTO horse_league_results(run_date,matchup,hands,bb100,stderr,config_a,config_b,duration_ms,"
                  "illegal_actions,truncated_streets,candidate_policy_hits,candidate_node_roles,"
                  "candidate_benchmark_components,candidate_execution_mismatches) VALUES "
                  f"(current_date-{day_offset},{q(matchup)},{hands},{bb100},{stderr:.15f},{q(json.dumps(config_a))},"
                  f"{q(json.dumps(config_b))},{duration},0,0,{hits},'{{{','.join(roles)}}}',{q(json.dumps(components))},0) RETURNING id")


def v2_result(db, checksum, kind, family, commit=C1, bb100=0.0):
    scenarios = V2_FAMILIES[family]
    hands, stderr = 12000, 1.0
    components = [{'scenario': s, 'hands': hands, 'bb100': bb100, 'stderr': stderr, 'duration_ms': 10,
                   'illegal_actions': 0, 'truncated_streets': 0, 'candidate_policy_hits': 7,
                   'candidate_execution_mismatches': 0, 'candidate_node_roles': ROLES} for s in scenarios]
    n = len(scenarios)
    profile = 'policy_only_duplicate_deals' if kind == 'paired_replay' else 'full_brain_duplicate_deal_league'
    config_a = {'evaluation_contract': 'gto_v31_candidate.v2', 'evaluation_kind': kind, 'game_family': family,
                'dataset_checksum': checksum, 'candidate': 'v31_certified', 'evaluation_profile': profile,
                'scenarios': scenarios, 'evaluation_engine_commit': commit}
    return insert_result(db, kind, family, checksum, config_a, components, hands * n, 7 * n, bb100,
                         stderr / math.sqrt(n), 10 * n, ROLES)


def v3_tables_py(cells, family):
    """The TypeScript derivation (gtoV31V3Tables), restated."""
    keys = sorted({f"{c['utility_context']}_{c['table_size']}max_{c['depth_bucket']}bb" for c in cells
                   if c['game_family'] == family}, key=lambda s: s.encode())
    six = [c['depth_bucket'] for c in cells if c['game_family'] == family == 'cash' and c['table_size'] == 6]
    if six:
        keys.append(f'human_cash_ev_6max_{max(six)}bb')
    return keys


def v3_result(db, ds, checksum, kind, family, tables, cells, commit=C1, bb100=0.0, mutate=None, epoch_no=1,
              day_offset=0):
    """A complete, valid v3 result; `mutate(components, extra)` breaks one rule."""
    n = len(tables)
    pairs = max(10000, math.ceil(50000 / n))
    hands = 2 * pairs
    per = [[] for _ in range(n)]
    for i, cell in enumerate(cells):
        per[i % n].append(cell)
    components = []
    for i, t in enumerate(tables):
        c = {'scenario': t, 'hands': hands, 'bb100': bb100, 'stderr': 0.5, 'duration_ms': 1000,
             'illegal_actions': 0, 'truncated_streets': 0, 'candidate_policy_hits': 400,
             'candidate_execution_mismatches': 0, 'candidate_node_roles': ['cbet', 'facing_bet'],
             'candidate_cells': sorted(per[i] or cells[:1])}
        if kind == 'league':
            c['memory_off'] = {'hands': hands, 'bb100': -bb100, 'stderr': 0.5, 'duration_ms': 900,
                               'illegal_actions': 0, 'truncated_streets': 0, 'candidate_policy_hits': 380,
                               'candidate_execution_mismatches': 0, 'candidate_cells': sorted(per[i] or cells[:1])}
        components.append(c)
    extra = {'config': {}, 'hands': None, 'hits': None, 'duration': None, 'roles': None, 'matchup': None}
    if mutate:
        mutate(components, extra)
    profile = 'policy_only_duplicate_deals' if kind == 'paired_replay' else 'full_brain_duplicate_deal_league'
    config_a = {'evaluation_contract': 'gto_v31_candidate.v3', 'evaluation_kind': kind, 'game_family': family,
                'dataset_checksum': checksum, 'candidate': 'v31_certified', 'evaluation_profile': profile,
                'scenarios': [c['scenario'] for c in components] if mutate else tables,
                'evaluation_engine_commit': commit, **extra['config']}
    total_hands = sum(c['hands'] for c in components) if extra['hands'] is None else extra['hands']
    total_hits = sum(c['candidate_policy_hits'] for c in components) if extra['hits'] is None else extra['hits']
    total_bb = sum(c['bb100'] * c['hands'] for c in components) / max(1, sum(c['hands'] for c in components))
    total_se = math.sqrt(sum((c['stderr'] * c['hands']) ** 2 for c in components)) / max(1, sum(c['hands'] for c in components))
    duration = sum(c['duration_ms'] for c in components) if extra['duration'] is None else extra['duration']
    roles = sorted({r for c in components for r in c['candidate_node_roles']}) if extra['roles'] is None else extra['roles']
    return insert_result(db, kind, family, checksum, config_a, components, total_hands, total_hits, total_bb, total_se,
                         duration, roles, matchup=extra['matchup'], epoch_no=epoch_no, day_offset=day_offset)


def record(db, ds, kind, family, rid, refused=None):
    return db.sql(f"SELECT public.fn_gto_v31_record_evaluation('{ds}','{kind}','{family}',{rid})", refused)


def open_epoch(db, ds, commit=C1):
    return json.loads(db.sql(f"SELECT public.fn_gto_v31_open_evaluation_epoch('{ds}',{q(commit)},'github-actions:test',{q(REASON)})"))


def state(db, ds):
    return db.sql(f"SELECT state FROM gto_v31_datasets WHERE dataset_id='{ds}'")


CASH_CELLS = [
    {'street': 'flop', 'game_family': 'cash', 'objective': 'cash_ev', 'utility_context': 'cash_ev', 'table_size': 2,
     'depth_bucket': 80, 'node_role': 'cbet'},
    {'street': 'turn', 'game_family': 'cash', 'objective': 'cash_ev', 'utility_context': 'cash_ev', 'table_size': 2,
     'depth_bucket': 80, 'node_role': 'facing_bet'},
    {'street': 'river', 'game_family': 'cash', 'objective': 'cash_ev', 'utility_context': 'cash_ev', 'table_size': 6,
     'depth_bucket': 100, 'node_role': 'cbet'},
    {'street': 'flop', 'game_family': 'cash', 'objective': 'cash_ev', 'utility_context': 'cash_ev', 'table_size': 6,
     'depth_bucket': 80, 'node_role': 'facing_bet'},
    {'street': 'flop', 'game_family': 'cash', 'objective': 'cash_ev', 'utility_context': 'cash_ev', 'table_size': 10,
     'depth_bucket': 100, 'node_role': 'cbet'},
]


def scenario(cluster, migration_text):
    db = cluster.fresh()
    install_fixtures(db)
    acl_before = acls(db, PATCHED)
    # An existing (pre-migration) dataset: it must keep contract v2.
    legacy, legacy_sum = dataset(db, 'r7', [dict(c, street=s) for c in CASH_CELLS[:1] for s in ('flop', 'turn', 'river')],
                                 list(V2_FAMILIES))
    apply_migration(db, migration_text)
    proof = re.search(r'^-- @live-proof: (.+)$', migration_text, re.M).group(1)
    proof = proof.replace("created_at<'2026-11-07'", 'true')
    assert db.sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
    assert acls(db, PATCHED) == acl_before, 'patched functions must keep byte-identical grants'
    new_fns = ['fn_gto_v31_v3_families(uuid)', 'fn_gto_v31_required_families(uuid)', 'fn_gto_v31_required_roles(uuid)',
               'fn_gto_v31_v3_breadth_ok(uuid)', 'fn_gto_v31_v3_tables(uuid,text)', 'fn_gto_v31_v3_cells(uuid,text)',
               'fn_gto_v31_v3_pairs(integer)', 'fn_gto_v31_v3_run_valid(jsonb,integer,text[])',
               'fn_gto_v31_record_evaluation_v3(uuid,text,text,bigint)',
               'fn_gto_v31_candidate_evaluations_valid_v3(uuid,text)', 'fn_gto_v31_evaluation_contract_guard()']
    for fn in new_fns:
        for role in ['anon', 'authenticated', 'service_role']:
            assert db.sql(f"SELECT has_function_privilege('{role}','public.{fn}','EXECUTE')") == 'f', (fn, role)
    assert db.sql("SELECT has_function_privilege('service_role','public.fn_gto_v31_evaluation_plan(uuid)','EXECUTE')") == 't'
    for role in ['anon', 'authenticated']:
        assert db.sql(f"SELECT has_function_privilege('{role}','public.fn_gto_v31_evaluation_plan(uuid)','EXECUTE')") == 'f'

    # ── contract column ──
    assert db.sql(f"SELECT evaluation_contract FROM gto_v31_datasets WHERE dataset_id='{legacy}'") == 'gto_v31_candidate.v2'
    db.sql(f"UPDATE gto_v31_datasets SET evaluation_contract='gto_v31_candidate.v3' WHERE dataset_id='{legacy}'",
           refused='evaluation contract is immutable')
    db.sql("INSERT INTO gto_v31_datasets(dataset_key,solver_version,solver_binary_checksum,pipeline_commit,"
           "pipeline_bundle_checksum,manifest_version,manifest_checksum,source_combo_order_checksum,range_bundle_checksum,"
           "icm_model_checksum,input_bundle_id,input_bundle_checksum,machine_ids,declared_coverage,quality_gates,"
           "evaluation_contract) VALUES ('v2-new','p','1','2','3','m','4','d','c','e',gen_random_uuid(),'b',ARRAY['M1'],"
           "'[]','{}','gto_v31_candidate.v2')", refused='certified under evaluation contract v3')

    # ── v2 path unchanged, end to end ──
    open_epoch(db, legacy)
    db.sql(f"SELECT public.fn_gto_v31_evaluation_plan('{legacy}')")
    plan = json.loads(db.sql(f"SELECT public.fn_gto_v31_evaluation_plan('{legacy}')"))
    assert plan == {'evaluation_contract': 'gto_v31_candidate.v2', 'families': {}}, plan
    assert db.sql(f"SELECT public.fn_gto_v31_required_families('{legacy}')::text") == '{cash,spin,tourney_ev,tourney_icm}'
    assert db.sql(f"SELECT cardinality(public.fn_gto_v31_required_roles('{legacy}'))") == '10'
    for kind in KINDS:
        for family in V2_FAMILIES:
            record(db, legacy, kind, family, v2_result(db, legacy_sum, kind, family))
    assert db.sql(f"SELECT public.fn_gto_v31_candidate_evaluations_valid('{legacy}','{legacy_sum}')") == 't'
    db.sql(f"SELECT public.fn_gto_v31_mark_candidate('{legacy}')")
    assert state(db, legacy) == 'candidate'
    assert db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{legacy}',{q(C1)},{q(SERVING)})") == legacy_sum
    assert state(db, legacy) == 'active'
    db.sql(f"UPDATE gto_v31_datasets SET state='retired', retired_at=now() WHERE dataset_id='{legacy}'")

    status = json.loads(db.sql(f"SET request.jwt.claim.role='service_role'; SELECT public.ca_gto_v31_certification_status('{legacy}')"))['datasets'][0]
    assert status['evaluation_contract'] == 'gto_v31_candidate.v2', status['evaluation_contract']
    assert status['required_families'] == list(V2_FAMILIES), status['required_families']

    # ── v3: plan and derivation ──
    ds, csum = dataset(db, 'r8', CASH_CELLS, ['cash'])
    assert db.sql(f"SELECT evaluation_contract FROM gto_v31_datasets WHERE dataset_id='{ds}'") == 'gto_v31_candidate.v3'
    open_epoch(db, ds)
    plan = json.loads(db.sql(f"SELECT public.fn_gto_v31_evaluation_plan('{ds}')"))
    tables = v3_tables_py(CASH_CELLS, 'cash')
    assert tables == ['cash_ev_10max_100bb', 'cash_ev_2max_80bb', 'cash_ev_6max_100bb', 'cash_ev_6max_80bb',
                      'human_cash_ev_6max_100bb'], tables
    cells = cells_of(db, ds, 'cash')
    assert plan == {'evaluation_contract': 'gto_v31_candidate.v3',
                    'families': {'cash': {'tables': tables, 'cells': cells, 'pairs_per_table': 10000,
                                          'min_table_decisions': 300}}}, plan
    assert db.sql("SELECT public.fn_gto_v31_v3_pairs(1)||','||public.fn_gto_v31_v3_pairs(3)||','||public.fn_gto_v31_v3_pairs(8)") \
        == '50000,16667,10000'
    assert db.sql(f"SELECT public.fn_gto_v31_required_families('{ds}')::text") == '{cash}'
    assert db.sql(f"SELECT public.fn_gto_v31_required_roles('{ds}')::text") == '{cbet,facing_bet}'
    assert db.sql(f"SELECT public.fn_gto_v31_v3_breadth_ok('{ds}')") == 't'
    status = json.loads(db.sql(f"SET request.jwt.claim.role='service_role'; SELECT public.ca_gto_v31_certification_status('{ds}')"))['datasets'][0]
    assert status['evaluation_contract'] == 'gto_v31_candidate.v3' and status['required_families'] == ['cash'], status

    # ── v3: every rule refuses its violation ──
    def bad(kind, mutate, why='contract v3 tables, floors'):
        rid = v3_result(db, ds, csum, kind, 'cash', tables, cells, mutate=mutate, day_offset=1)
        record(db, ds, kind, 'cash', rid, refused=why)
        db.sql(f'DELETE FROM horse_league_results WHERE id={rid}')

    def drop_last(cs, x): cs.pop()
    def add_table(cs, x): cs.append(dict(cs[0], scenario='cash_ev_9max_40bb'))
    def swap(cs, x): cs[0], cs[1] = cs[1], cs[0]
    def few_hits(cs, x): cs[2]['candidate_policy_hits'] = 299
    def few_hands(cs, x): cs[1]['hands'] -= 2
    def illegal(cs, x): cs[0]['illegal_actions'] = 1
    def mismatch(cs, x): cs[0]['candidate_execution_mismatches'] = 1
    def no_cells(cs, x):
        cs[0]['candidate_cells'] = []
    def foreign(cs, x): cs[0]['candidate_cells'] = cs[0]['candidate_cells'] + ['f' * 64]
    def dup(cs, x): cs[0]['candidate_cells'] = cs[0]['candidate_cells'] * 2
    def unreached(cs, x):
        for c in cs:
            c['candidate_cells'] = [v for v in c['candidate_cells'] if v != cells[-1]] or [cells[0]]
    def bad_role(cs, x): cs[0]['candidate_node_roles'] = ['cbet', 'limp']
    def bad_total(cs, x): x['hits'] = sum(c['candidate_policy_hits'] for c in cs) + 1
    def bad_duration(cs, x): x['duration'] = 1
    def v2_config(cs, x): x['config'] = {'evaluation_contract': 'gto_v31_candidate.v2'}
    def extra_key(cs, x): cs[0]['note'] = 'x'
    def no_memory_off(cs, x): cs[0].pop('memory_off')
    def weak_memory_off(cs, x): cs[0]['memory_off']['candidate_policy_hits'] = 10
    def short_memory_off(cs, x): cs[0]['memory_off']['hands'] = 100
    def memory_off_extra(cs, x): cs[0]['memory_off']['note'] = 1
    def paired_memory_off(cs, x): cs[0]['memory_off'] = dict(cs[0], scenario=None)
    def config_tables(cs, x): x['config'] = {'scenarios': tables[::-1]}
    def foreign_off(cs, x): cs[0]['memory_off']['candidate_cells'] = cs[0]['memory_off']['candidate_cells'] + ['f' * 64]

    for kind in KINDS:
        for m in [drop_last, add_table, swap, few_hits, few_hands, illegal, mismatch, no_cells, foreign, dup,
                  unreached, bad_role, bad_total, bad_duration, v2_config, extra_key, config_tables]:
            bad(kind, m)
    for m in [no_memory_off, weak_memory_off, short_memory_off, memory_off_extra, foreign_off]:
        bad('league', m)
    bad('paired_replay', paired_memory_off)
    spin = v3_result(db, ds, csum, 'league', 'spin', ['chip_ev_3max_20bb'], cells, day_offset=1)
    record(db, ds, 'league', 'spin', spin, refused='has no cells in family spin')
    db.sql(f'DELETE FROM horse_league_results WHERE id={spin}')
    db.sql(f"SELECT public.fn_gto_v31_mark_candidate('{ds}')", refused='missing approved, execution-bound release evidence')

    # ── v3: the complete set records, marks a candidate and promotes ──
    for kind in KINDS:
        rid = v3_result(db, ds, csum, kind, 'cash', tables, cells)
        eid = record(db, ds, kind, 'cash', rid)
        assert record(db, ds, kind, 'cash', rid) == eid, 'same result is idempotent'
    assert db.sql(f"SELECT public.fn_gto_v31_candidate_evaluations_valid('{ds}','{csum}')") == 't'
    db.sql(f"SELECT public.fn_gto_v31_mark_candidate('{ds}')")
    assert state(db, ds) == 'candidate'
    assert db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C1)},{q(SERVING)})") == csum
    assert state(db, ds) == 'active'

    # ── a narrower candidate may not replace an incumbent's family ──
    both = CASH_CELLS + [dict(c, game_family='spin', objective='chip_ev', utility_context='chip_ev', table_size=3,
                               depth_bucket=20) for c in CASH_CELLS[:3]]
    db.sql(f"UPDATE gto_v31_datasets SET state='retired', retired_at=now() WHERE dataset_id='{ds}'")
    wide, wsum = dataset(db, 'r9-wide', both, ['cash', 'spin'], state='active')
    narrow, nsum = dataset(db, 'r9-narrow', CASH_CELLS, ['cash'])
    open_epoch(db, narrow)
    for kind in KINDS:
        rid = v3_result(db, narrow, nsum, kind, 'cash', tables, cells_of(db, narrow, 'cash'))
        db.sql(f"UPDATE horse_league_results SET config_b=jsonb_set(config_b,'{{incumbent_dataset_checksum}}',to_jsonb({q(wsum)}::text)) WHERE id={rid}")
        record(db, narrow, kind, 'cash', rid)
    assert db.sql(f"SELECT public.fn_gto_v31_candidate_evaluations_valid('{narrow}','{nsum}')") == 'f', \
        'a candidate that drops an incumbent family must not qualify'

    # ── seal patch: v3 breadth per carried family/objective ──
    holes, _ = dataset(db, 'r10-holes', [CASH_CELLS[0], CASH_CELLS[1]], ['cash'], state='building')
    assert db.sql(f"SELECT public.fn_gto_v31_v3_breadth_ok('{holes}')") == 'f', 'no river cell: breadth must fail'
    seal = db.sql("SELECT pg_get_functiondef('public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure)")
    assert "IF v_dataset.evaluation_contract='gto_v31_candidate.v3' THEN" in seal
    assert 'ELSIF NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street=' in seal
    assert 'FOREACH v_family IN ARRAY public.fn_gto_v31_required_families(p_dataset_id) LOOP' in seal
    assert seal.count("required Phase 4 street, family, utility, table, pot, or response coverage is incomplete") == 1
    seal_identity = db.sql("SELECT prosecdef::text||provolatile::text||array_to_string(proconfig,';') FROM pg_proc WHERE oid='public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure")
    # ── breadth patch (2026-11-10): breadth is the streets the playbook carries ──
    # R8 carried turn and river only and was refused at seal_dataset by the flop/turn/river rule.
    apply_migration(db, BREADTH_MIGRATION.read_text())
    assert db.sql(f"SELECT public.fn_gto_v31_v3_breadth_ok('{holes}')") == 't', \
        'a playbook that carries flop and turn for every family/objective it has is complete within its own scope'
    spin_flop = dict(CASH_CELLS[0], game_family='spin', objective='chip_ev', utility_context='chip_ev')
    uneven, _ = dataset(db, 'r10-uneven', [CASH_CELLS[0], CASH_CELLS[1], CASH_CELLS[2], spin_flop], ['cash', 'spin'], state='building')
    assert db.sql(f"SELECT public.fn_gto_v31_v3_breadth_ok('{uneven}')") == 'f', \
        'a family/objective missing a street another one carries must fail breadth'
    even, _ = dataset(db, 'r10-even', [CASH_CELLS[1], CASH_CELLS[2], dict(spin_flop, street='turn'), dict(spin_flop, street='river')],
                      ['cash', 'spin'], state='building')
    assert db.sql(f"SELECT public.fn_gto_v31_v3_breadth_ok('{even}')") == 't', \
        'turn and river for every carried family/objective is complete without flop'
    seal2 = db.sql("SELECT pg_get_functiondef('public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure)")
    assert seal2.count('must cover every street the playbook carries') == 1 and 'must cover flop, turn and river' not in seal2
    assert "IF v_dataset.evaluation_contract='gto_v31_candidate.v3' THEN" in seal2 and 'IF NOT public.fn_gto_v31_v3_breadth_ok(p_dataset_id) THEN' in seal2
    assert db.sql("SELECT prosecdef::text||provolatile::text||array_to_string(proconfig,';') FROM pg_proc WHERE oid='public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure") == \
        seal_identity, 'seal_prepared must keep its security, volatility and SET clauses'
    db.cluster.psql(db.name, ['-c', 'SELECT 1'])
    return 'ok'


MUTATIONS = {
    'no table-list check': ("     OR p_result.config_a->'scenarios' IS DISTINCT FROM to_jsonb(v_tables)\n", ''),
    'no decision floor': ("     OR (p_run->>'candidate_policy_hits')::bigint < 300\n", ''),
    'no memory-off run': ("      IF NOT public.fn_gto_v31_v3_run_valid(v_c->'memory_off',v_pairs,v_cells)\n         OR",
                          '      IF'),
    'no cell coverage': ('     AND v_reached IS NOT DISTINCT FROM v_cells;', '     ;'),
    'no foreign-cell check': ("                         OR NOT (x.v#>>'{}' = ANY(p_cells)))", ')'),
    'no hands check': ("  IF (p_run->>'hands')::bigint <> 2*p_pairs::bigint\n     OR", '  IF'),
    'no family scope': ("  IF NOT (p_game_family = ANY(public.fn_gto_v31_v3_families(p_dataset_id))) THEN",
                        '  IF false THEN'),
    'no incumbent family rule': ('                 WHERE NOT (f.v = ANY(v_families))) THEN', '                 WHERE false) THEN'),
    'mutable contract': ("  ELSIF NEW.evaluation_contract IS DISTINCT FROM OLD.evaluation_contract THEN",
                         '  ELSIF false THEN'),
    'v3 breadth skips a street': ("CROSS JOIN unnest(ARRAY['flop','turn','river']) s(street)",
                                  "CROSS JOIN unnest(ARRAY['flop','turn']) s(street)"),
}


def main():
    path = migration_path()
    text = path.read_text()
    cluster = Cluster()
    try:
        print('scenario:', scenario(cluster, text))
        if '--mutations' in sys.argv:
            for name, (old, new) in MUTATIONS.items():
                assert text.count(old) == 1, f'mutation anchor for "{name}" must occur exactly once'
                weakened = text.replace(old, new)
                try:
                    scenario(cluster, weakened)
                except (AssertionError, Refused) as error:
                    print(f'mutation detected: {name} ({str(error).splitlines()[0][:120]})')
                    continue
                raise SystemExit(f'mutation NOT detected: {name}')
    finally:
        cluster.stop()
    print('v31 evaluation contract v3: native proof passed')


if __name__ == '__main__':
    main()
