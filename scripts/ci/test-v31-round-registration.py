#!/usr/bin/env python3
"""Native proof: a V31 round is registered before it runs and its composition is enforced.

Runs migration 20261110213931 against a throwaway PostgreSQL 17 cluster (never
production), on the contract v3 fixture schema plus byte-exact copies of the
live canonical/digest/gate functions it calls. Then proves:

  * the R8 deviation is refused: a round registered as 70 flop / 23 turn /
    7 river cannot create a dataset declaring 0 / 67 / 33, nor one that swaps a
    single cell for another of the same street (no silent substitution)
  * a dataset without a registration is refused; a registration is used once
  * the dataset's quality gates must equal the registered acceptance criteria,
    and a registration may tighten but never loosen the standing thresholds
  * at seal, the runtime cells actually built must be the registered set; a
    match stamps heldout_consumed_at, a mismatch leaves it unconsumed, and a
    sealed dataset cannot be sealed again
  * a registration is immutable (no update of content, no delete, no
    truncate) and needs owner authorization, candidate, provenance and a
    one-consumption evaluation plan
  * the SQL cell-set checksum equals the Python pipeline's
    public_hist215.digest(sorted(cells, key=canonical_bytes)) byte for byte
  * grants: the RPC is service_role only, helpers are owner only

`--mutations` re-runs the scenario against deliberately weakened copies of the
migration and requires each one to be detected.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261110213931_v31_a_round_is_registered_and_its_composition_is_enforced.sql'
SCHEMA = ROOT / 'scripts/ci/fixtures/v31-evaluation-contract-v3/00-schema.sql'
LIVE = ROOT / 'scripts/ci/fixtures/v31-round-registration/01-live-functions.sql'
GATES = {"max_frequency_mae": 0.05, "max_sizing_mae": 0.05, "max_policy_ev_mae_bb": 0.05,
         "max_action_regret_bb": 0.05, "min_regret_coverage": 0.95}
KEYS = ['street', 'game_family', 'objective', 'utility_context', 'table_size', 'pot_type', 'hero_position',
        'opponent_position', 'depth_bucket', 'texture_class', 'node_role', 'facing_kind', 'facing_size_bucket']


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


class Cluster:
    def __init__(self):
        os.environ['LC_ALL'] = 'C'
        os.environ['LANG'] = 'C'
        self.scratch = Path(tempfile.mkdtemp(prefix='v31-reg-', dir=os.environ.get('RUNNER_TEMP') or None))
        self.sock = Path(tempfile.mkdtemp(prefix='pgreg', dir='/tmp'))
        self.port = str(56000 + os.getpid() % 4000)
        self.data = self.scratch / 'data'
        subprocess.run([pg_bin('initdb'), '-D', str(self.data), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
        subprocess.run([pg_bin('pg_ctl'), '-D', str(self.data), '-o', f"-k {self.sock} -p {self.port} -c listen_addresses=''",
                        '-l', str(self.scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
        self.n = 0

    def stop(self):
        subprocess.run([pg_bin('pg_ctl'), '-D', str(self.data), '-m', 'fast', 'stop'], capture_output=True)
        shutil.rmtree(self.scratch, ignore_errors=True)
        shutil.rmtree(self.sock, ignore_errors=True)

    def psql(self, db, args):
        return subprocess.run([pg_bin('psql'), '-h', str(self.sock), '-p', self.port, '-U', 'postgres', '-d', db,
                               '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', *args], capture_output=True, text=True)

    def fresh(self, migration_text):
        self.n += 1
        name = f'reg{self.n}'
        r = self.psql('postgres', ['-c', f'CREATE DATABASE {name} TEMPLATE template0'])
        assert r.returncode == 0, r.stderr
        db = Db(self, name)
        db.file(SCHEMA)
        db.file(LIVE)
        path = self.scratch / f'{name}.sql'
        path.write_text(migration_text)
        db.file(path)
        return db


class Db:
    def __init__(self, cluster, name):
        self.cluster, self.name = cluster, name

    def file(self, path):
        r = self.cluster.psql(self.name, ['-f', str(path)])
        if r.returncode != 0:
            raise AssertionError(f'{path.name}: {r.stderr}')

    def sql(self, text, refused=None):
        r = self.cluster.psql(self.name, ['-c', text])
        if refused is not None:
            if r.returncode == 0:
                raise AssertionError(f'expected refusal "{refused}" but succeeded: {text[:160]}')
            if refused not in r.stderr:
                raise AssertionError(f'expected refusal "{refused}", got: {r.stderr.strip()[:400]}')
            return r.stderr
        if r.returncode != 0:
            raise AssertionError(f'{text[:300]}\n{r.stderr}')
        return r.stdout.strip()


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def qj(value):
    return q(json.dumps(value)) + '::jsonb'


def cell(street, texture, role='barrel', hero='SB', opp='BB', size=2):
    return {'street': street, 'game_family': 'cash', 'objective': 'cash_ev', 'utility_context': 'cash_ev',
            'table_size': size, 'pot_type': 'srp', 'hero_position': hero, 'opponent_position': opp,
            'depth_bucket': 80, 'texture_class': texture, 'node_role': role, 'facing_kind': 'none',
            'facing_size_bucket': 'none'}


def cells_of(flop, turn, river, salt=''):
    out = []
    for street, n in (('flop', flop), ('turn', turn), ('river', river)):
        for i in range(n):
            out.append(cell(street, f'T{salt}{i:03d}'))
    return out


def canonical_bytes(value):
    # public_hist215.canonical_bytes for the shapes a cell context has
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def python_checksum(cells):
    ordered = sorted(cells, key=canonical_bytes)
    return hashlib.sha256(canonical_bytes(ordered)).hexdigest()


def composition(cells):
    return {s: sum(1 for c in cells if c['street'] == s) for s in ('flop', 'turn', 'river')}


def registration(round_key, dataset_key, cells, gates=GATES, **override):
    value = {
        'round_key': round_key, 'dataset_key': dataset_key, 'composition': composition(cells), 'cells': cells,
        'cell_set_checksum': python_checksum(cells),
        'owner_authorization': {'approved_by': 'Dan', 'approved_at': '2026-11-10T21:09:00Z',
                                'source': 'claude.ai chat 2026-11-10 15:09 CST',
                                'quote': 'I authorize development of a corrected successor'},
        'candidate': {'summary': 'proof', 'changes': ['x'], 'diagnosis': 'proof'},
        'dataset_provenance': {'plan_checksum': 'a' * 64, 'eligibility_checksum': 'f' * 64, 'pipeline_commit': 'b' * 40,
                               'board_recipe': '57 M1 + 8 M2', 'ranges': 'c' * 64},
        'acceptance_criteria': {'quality_gates': gates},
        'evaluation_plan': {'heldout_consumptions': 1, 'steps': ['seal once']},
    }
    value.update(override)
    return value


def register(db, value, refused=None):
    return db.sql(f"SELECT public.fn_gto_v31_register_round({qj(value)})", refused=refused)


def insert_dataset(db, key, declared, gates=GATES, refused=None):
    bundle = db.sql("INSERT INTO gto_v31_input_bundles(bundle_key,bundle_checksum,range_bundle_checksum,"
                    "source_combo_order_checksum,icm_model_checksum,bundle_manifest) VALUES "
                    f"({q(key + '-b')},repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),'{{}}') "
                    "RETURNING input_bundle_id")
    return db.sql("INSERT INTO gto_v31_datasets(dataset_key,state,quality_status,solver_version,solver_binary_checksum,"
                  "pipeline_commit,pipeline_bundle_checksum,manifest_version,manifest_checksum,source_combo_order_checksum,"
                  "range_bundle_checksum,icm_model_checksum,input_bundle_id,input_bundle_checksum,machine_ids,"
                  "declared_coverage,quality_gates) VALUES "
                  f"({q(key)},'building','pending','pio-3',repeat('1',64),repeat('2',40),repeat('3',64),'m1',repeat('4',64),"
                  f"repeat('d',64),repeat('c',64),repeat('e',64),'{bundle.splitlines()[0]}',repeat('b',64),ARRAY['M1','M2'],"
                  f"{qj(declared)},{qj(gates)}) RETURNING dataset_id", refused=refused)


def build_cells(db, ds, cells):
    for i, c in enumerate(cells):
        cols = ','.join(KEYS)
        vals = ','.join(q(c[k]) for k in KEYS)
        db.sql(f"INSERT INTO gto_v31_runtime_cells(dataset_id,cell_key_checksum,cell_payload_checksum,lineage_checksum,{cols}) "
               f"VALUES ('{ds}',md5('{ds}k{i}')||md5('{ds}K{i}'),md5('{ds}p{i}'),md5('{ds}l{i}'),{vals})")


def seal(db, ds, refused=None):
    return db.sql(f"UPDATE gto_v31_datasets SET sealed_at=now(), state='rejected' WHERE dataset_id='{ds}'", refused=refused)


def scenario(db):
    # SQL checksum == Python pipeline checksum (byte-identical canonical order)
    approved = cells_of(70, 23, 7)
    sql_sum = db.sql(f"SELECT public.fn_gto_v31_cell_set_checksum({qj(list(reversed(approved)))})")
    assert sql_sum == python_checksum(approved), 'SQL and Python cell-set checksums differ'
    assert json.loads(db.sql(f"SELECT public.fn_gto_v31_cell_composition({qj(approved)})")) == {'flop': 70, 'turn': 23, 'river': 7}

    # The R8 deviation: registered 70/23/7, declared 0/67/33 -> refused, with both compositions in the message
    register(db, registration('r8', 'horse-r8-proof', approved))
    err = insert_dataset(db, 'horse-r8-proof', cells_of(0, 67, 33), refused='composition differs from its registration')
    assert '70 flop / 23 turn / 7 river' in err and '0 flop / 67 turn / 33 river' in err, err
    # one substituted cell of the same street -> refused (no silent substitution)
    swapped = approved[:-1] + [cell('river', 'Zswap')]
    insert_dataset(db, 'horse-r8-proof', swapped, refused='composition differs from its registration')
    # a missing cell -> refused
    insert_dataset(db, 'horse-r8-proof', approved[:-1], refused='composition differs from its registration')
    # gates differing from the registered acceptance criteria -> refused
    insert_dataset(db, 'horse-r8-proof', approved, gates={**GATES, 'max_policy_ev_mae_bb': 0.04},
                   refused='quality gates differ from its registered acceptance criteria')
    # no registration -> refused
    insert_dataset(db, 'horse-unregistered', approved, refused='has no round registration')

    # exact match (any order) -> accepted and linked once
    ds = insert_dataset(db, 'horse-r8-proof', list(reversed(approved))).splitlines()[0]
    assert db.sql(f"SELECT dataset_id FROM gto_v31_round_registrations WHERE round_key='r8'") == ds
    insert_dataset(db, 'horse-r8-proof', approved, refused='a registration is used once')

    # seal with built cells != registration -> refused, not consumed
    build_cells(db, ds, approved[:-1] + [cell('river', 'Zbuilt')])
    err = seal(db, ds, refused='built cells differ from its registration at seal')
    assert db.sql("SELECT heldout_consumed_at IS NULL FROM gto_v31_round_registrations WHERE round_key='r8'") == 't'
    db.sql(f"DELETE FROM gto_v31_runtime_cells WHERE dataset_id='{ds}'")
    build_cells(db, ds, approved)
    seal(db, ds)
    assert db.sql("SELECT heldout_consumed_at IS NOT NULL FROM gto_v31_round_registrations WHERE round_key='r8'") == 't'
    seal(db, ds, refused='already sealed')

    # a dataset of an earlier round (no registration) cannot be sealed around the rule
    # emulate a row created before the migration (triggers bypassed inside one transaction)
    bundle = db.sql("INSERT INTO gto_v31_input_bundles(bundle_key,bundle_checksum,range_bundle_checksum,"
                    "source_combo_order_checksum,icm_model_checksum,bundle_manifest) VALUES "
                    "('legacy-b',repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),'{}') RETURNING input_bundle_id").splitlines()[0]
    old = db.sql("BEGIN; SET LOCAL session_replication_role=replica; INSERT INTO gto_v31_datasets(dataset_key,state,quality_status,"
                 "solver_version,solver_binary_checksum,pipeline_commit,pipeline_bundle_checksum,manifest_version,manifest_checksum,"
                 "source_combo_order_checksum,range_bundle_checksum,icm_model_checksum,input_bundle_id,input_bundle_checksum,"
                 "machine_ids,declared_coverage,quality_gates) VALUES ('horse-legacy','building','pending','pio-3',repeat('1',64),"
                 "repeat('2',40),repeat('3',64),'m1',repeat('4',64),repeat('d',64),repeat('c',64),repeat('e',64),"
                 f"'{bundle}',repeat('b',64),ARRAY['M1','M2'],{qj(approved)},{qj(GATES)}) RETURNING dataset_id; COMMIT;")
    old = [l for l in old.splitlines() if len(l) == 36][0]
    seal(db, old, refused='has no round registration and cannot consume a held-out set')

    # registration rules
    r2 = cells_of(30, 50, 20, salt='b')
    register(db, registration('r9', 'horse-r9-proof', r2, composition={'flop': 30, 'turn': 50, 'river': 19}),
             refused='is not the composition of the registered cells')
    register(db, registration('r9', 'horse-r9-proof', r2, cell_set_checksum='0' * 64),
             refused='cell-set checksum does not hash the registered cells')
    register(db, registration('r9', 'horse-r9-proof', r2, gates={**GATES, 'max_policy_ev_mae_bb': 0.06}),
             refused='may not loosen the V31 quality thresholds')
    register(db, registration('r9', 'horse-r9-proof', r2, owner_authorization={'approved_by': 'Dan'}),
             refused='owner_authorization needs')
    register(db, registration('r9', 'horse-r9-proof', r2, evaluation_plan={'heldout_consumptions': 2, 'steps': []}),
             refused='consume the held-out set exactly once')
    register(db, registration('r9', 'horse-r9-proof', r2 + [r2[0]]), refused='distinct V31 cell contexts')
    no_census = registration('r9', 'horse-r9-proof', r2)
    no_census['dataset_provenance'] = {k: v for k, v in no_census['dataset_provenance'].items() if k != 'eligibility_checksum'}
    register(db, no_census, refused='eligibility_checksum')
    tight = registration('r9', 'horse-r9-proof', r2, acceptance_criteria={'quality_gates': {**GATES, 'max_policy_ev_mae_bb': 0.04}})
    register(db, tight)
    register(db, registration('r9', 'horse-r9-other', r2), refused='duplicate key')

    # immutability
    db.sql("UPDATE gto_v31_round_registrations SET composition='{\"flop\":1,\"turn\":0,\"river\":0}' WHERE round_key='r9'",
           refused='is immutable')
    db.sql("UPDATE gto_v31_round_registrations SET heldout_consumed_at=now() WHERE round_key='r9'", refused='is immutable')
    db.sql("DELETE FROM gto_v31_round_registrations WHERE round_key='r9'", refused='is permanent')
    db.sql("TRUNCATE gto_v31_round_registrations", refused='is permanent')

    # grants
    acl = db.sql("SELECT string_agg(p.proname||'='||coalesce(p.proacl::text,''),';' ORDER BY p.proname) FROM pg_proc p "
                 "WHERE p.proname IN ('fn_gto_v31_register_round','fn_gto_v31_cell_set_checksum','fn_gto_v31_seal_matches_registration')")
    assert 'fn_gto_v31_register_round={postgres=X/postgres,service_role=X/postgres}' in acl, acl
    assert 'fn_gto_v31_cell_set_checksum={postgres=X/postgres}' in acl, acl
    tacl = db.sql("SELECT relacl::text FROM pg_class WHERE relname='gto_v31_round_registrations'")
    assert 'service_role=r/postgres' in tacl and 'anon' not in tacl and 'authenticated' not in tacl, tacl


MUTATIONS = [
    ('insert check removed', "  IF public.fn_gto_v31_cell_set_checksum(NEW.declared_coverage) IS DISTINCT FROM r.cell_set_checksum\n     OR jsonb_array_length(NEW.declared_coverage) <> jsonb_array_length(r.cells) THEN",
     "  IF false THEN"),
    ('composition-only comparison', "  IF public.fn_gto_v31_cell_set_checksum(NEW.declared_coverage) IS DISTINCT FROM r.cell_set_checksum\n     OR jsonb_array_length(NEW.declared_coverage) <> jsonb_array_length(r.cells) THEN",
     "  IF v_comp IS DISTINCT FROM r.composition THEN"),
    ('seal check removed', "  IF public.fn_gto_v31_cell_set_checksum(v_cells) IS DISTINCT FROM r.cell_set_checksum\n     OR jsonb_array_length(v_cells) <> jsonb_array_length(r.cells) THEN",
     "  IF false THEN"),
    ('gate floor removed', "     OR (NEW.acceptance_criteria#>>'{quality_gates,max_policy_ev_mae_bb}')::numeric > 0.05", ''),
    ('unregistered allowed', "    RAISE EXCEPTION 'V31 dataset % has no round registration: register", "    RETURN NEW; RAISE EXCEPTION 'V31 dataset % has no round registration: register"),
    ('registration mutable', "    IF (to_jsonb(NEW) - ARRAY['dataset_id','heldout_consumed_at'])", "    IF false AND (to_jsonb(NEW) - ARRAY['dataset_id','heldout_consumed_at'])"),
    ('legacy seal allowed', "    RAISE EXCEPTION 'V31 dataset % has no round registration and cannot consume", "    RETURN NEW; RAISE EXCEPTION 'V31 dataset % has no round registration and cannot consume"),
]


def main():
    text = MIGRATION.read_text()
    assert text.count('BEGIN;') == 1 and text.rstrip().endswith('COMMIT;'), 'migration must be one BEGIN/COMMIT transaction'
    cluster = Cluster()
    try:
        scenario(cluster.fresh(text))
        print('native proof: passed')
        if '--mutations' in sys.argv:
            for name, old, new in MUTATIONS:
                assert text.count(old) == 1, f'mutation anchor not unique: {name}'
                try:
                    scenario(cluster.fresh(text.replace(old, new)))
                except AssertionError:
                    print(f'mutation detected: {name}')
                    continue
                raise SystemExit(f'MUTATION NOT DETECTED: {name}')
    finally:
        cluster.stop()


if __name__ == '__main__':
    main()
