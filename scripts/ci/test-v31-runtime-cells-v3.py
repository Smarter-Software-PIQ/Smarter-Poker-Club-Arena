#!/usr/bin/env python3
"""Native proof: gto_v31_runtime_cells stores cell contract v3 cells (dormant).

Runs migration MIGRATION on the production shapes in
scripts/ci/fixtures/v31-runtime-cells-v3 (the live table with every live
constraint and trigger, and the two live reader functions byte for byte)
against a throwaway PostgreSQL 17 cluster (never production). Proves:

  v2 unchanged
    * the fixture reproduces the live md5 of both readers and of the four
      constraints the migration replaces (so the pins are tested, not assumed)
    * existing v2 rows load before the migration and are untouched by it
    * fn_gto_v31_active_cells and fn_gto_v31_evaluation_cells return exactly
      the same rows, byte for byte, before and after the migration
    * every v2 refusal still refuses (depth 200, role donk, a duplicate key)
  v3 stored
    * a v3 dataset holds 200 bb cells, a donk root, and two lines of one spot
    * the v3 readers return every row with its contract and line; the v2
      readers return no v3 cell (an active v3 dataset reads as empty)
  v3 refused
    * a line without a contract, a contract without a line, contract 'v4', a
      malformed line, a line for another street, a v3 row declaring
      hist215-v1 or -v2, donk facing a bet, depth 300, a repeated v3 key, a
      rewrite of the contract or line
  registration
    * fn_gto_v31_registration_cell_contract answers null, 'v2' and 'v3' and is
      refused to anon and authenticated callers
  safety
    * the migration refuses a changed reader (preimage pin)
`--mutations` re-runs the scenario against weakened copies of the migration
and requires each one to be detected.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('round_registration', ROOT / 'scripts/ci/test-v31-round-registration.py')
rr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rr)
MIGRATION = next((ROOT / 'supabase/migrations').glob('*_v31_runtime_cells_store_cell_contract_v3_dormant.sql'))
FIXTURES = ROOT / 'scripts/ci/fixtures/v31-runtime-cells-v3'
q, qj = rr.q, rr.qj
H = lambda c: c * 64
V2_ACTIVE = '11111111-1111-4111-8111-111111111111'
V2_EVAL = '22222222-2222-4222-8222-222222222222'
V3_DS = '33333333-3333-4333-8333-333333333333'


class Cluster(rr.Cluster):
    def fresh_plain(self):
        self.n += 1
        name = f'cells{self.n}'
        r = self.psql('postgres', ['-c', f'CREATE DATABASE {name} TEMPLATE template0'])
        assert r.returncode == 0, r.stderr
        db = rr.Db(self, name)
        db.file(FIXTURES / '00-schema.sql')
        db.file(FIXTURES / '01-live-functions.sql')
        return db

    def migrate(self, db, text):
        path = self.scratch / f'{db.name}-migration.sql'
        path.write_text(text)
        db.file(path)


def dataset(db, ds, key, state, feature=None):
    public = feature in ('holdem-public-hist215-v1', 'holdem-public-hist215-v2')
    ident = (q(feature) if feature else 'NULL', q('smarter-poker.pio-policy.v4') if public else 'NULL',
             q('public_hist215_v1') if public else 'NULL')
    b = db.sql(f"INSERT INTO gto_v31_input_bundles(bundle_checksum,feature_contract_version,policy_export_schema,policy_representation) VALUES ({q(H('2'))},{','.join(ident)}) RETURNING input_bundle_id")
    db.sql(f"INSERT INTO gto_v31_datasets(dataset_id,dataset_key,dataset_checksum,source_artifact_checksum,input_bundle_id,input_bundle_checksum,state,coverage,feature_contract_version,policy_export_schema,policy_representation) "
           f"VALUES ({q(ds)},{q(key)},{q(H('9'))},{q(H('8'))},{q(b.splitlines()[0])},{q(H('2'))},{q(state)},'{{\"cells\":3}}',{','.join(ident)})")


def cell(n, ds, street='flop', depth=80, role='cbet', facing='none', size='none', contract=None, line=None,
         feature=None, public=False, texture='Brud'):
    cols = {'dataset_id': q(ds), 'cell_key_checksum': q(f'{n:064x}'), 'street': q(street), 'game_family': q('cash'),
            'objective': q('cash_ev'), 'utility_context': q('cash_ev'), 'table_size': '2', 'pot_type': q('srp'),
            'hero_position': q('BB'), 'opponent_position': q('SB'), 'depth_bucket': str(depth),
            'texture_class': q(texture), 'node_role': q(role), 'facing_kind': q(facing), 'facing_size_bucket': q(size),
            'action_specs': qj({'c': {'family': 'check'}}), 'source_rows': '2', 'train_source_rows': '1',
            'holdout_source_rows': '1', 'cell_payload_checksum': q(H('a')), 'lineage_checksum': q(H('b'))}
    if feature:
        cols['feature_contract_version'] = q(feature)
    if public:
        cols.update(policy_representation=q('public_hist215_v1'), policy_export_schema=q('smarter-poker.pio-policy.v4'),
                    public_model=qj({}), public_template=qj({}), public_training_provenance=qj({}),
                    public_model_build_receipt=qj({}), model_checksum=q(H('c')), template_checksum=q(H('c')),
                    feature_schema_checksum=q(H('c')), training_provenance_checksum=q(H('c')),
                    model_build_receipt_checksum=q(H('c')), sql_physics_checksum=q(H('c')))
    else:
        cols.update(hand_matrix=qj({'AA': {'c': 1}}), policy_ev_matrix=qj({}), action_ev_matrix=qj({}))
    if contract is not None:
        cols['cell_contract_version'] = q(contract)
    if line is not None:
        cols['line_class'] = q(line)
    return f"INSERT INTO gto_v31_runtime_cells({','.join(cols)}) VALUES ({','.join(cols.values())})"


def readers(db, suffix=''):
    out = {}
    out['active'] = db.sql(f"SELECT COALESCE(json_agg(t),'[]') FROM (SELECT * FROM fn_gto_v31_active_cells{suffix}(0,500)) t")
    for ds in (V2_EVAL, V3_DS):
        out[ds] = db.sql(f"SELECT COALESCE(json_agg(t),'[]') FROM (SELECT * FROM fn_gto_v31_evaluation_cells{suffix}({q(ds)},0,500)) t")
    return out


def scenario(db, cluster, text):
    # Pins are real: the fixture reproduces production's md5s.
    for fn, m in (('fn_gto_v31_active_cells(integer,integer)', '917c8085678328fc74fe769e95c59190'),
                  ('fn_gto_v31_evaluation_cells(uuid,integer,integer)', '41417b2db70833c68796610c296fb56b')):
        assert db.sql(f"SELECT md5(pg_get_functiondef('{fn}'::regprocedure))") == m, fn
    for con, m in (('gto_v31_runtime_cells_depth_bucket_check', 'cedf856b8fb44e4349195540e92d5920'),
                   ('gto_v31_runtime_cells_node_role_check', '95bc518d9cbbdb61cb7658c1e7e0edf4'),
                   ('gto_v31_runtime_cells_check4', 'c895ef2439525875343a366e4ee4b618'),
                   ('gto_v31_runtime_cells_dataset_id_street_game_family_objecti_key', 'bf13c20c93535fd41d1450233fd3fb4e')):
        assert db.sql(f"SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conname={q(con)}") == m, con
    # Existing v2 data, read before the migration.
    dataset(db, V2_ACTIVE, 'v2.active', 'active')
    dataset(db, V2_EVAL, 'v2.eval', 'evaluating', 'holdem-public-hist215-v1')
    dataset(db, V3_DS, 'v3.eval', 'evaluating')
    for i, (street, depth, role, facing, size) in enumerate([('flop', 80, 'cbet', 'none', 'none'), ('turn', 150, 'facing_bet', 'bet', 'big'),
                                                            ('river', 10, 'all_in', 'all_in', 'all_in')]):
        db.sql(cell(100 + i, V2_ACTIVE, street, depth, role, facing, size))
    db.sql(cell(200, V2_EVAL, feature='holdem-public-hist215-v1', public=True))
    before = readers(db)
    assert len(json.loads(before['active'])) == 3 and len(json.loads(before[V2_EVAL])) == 1
    cluster.migrate(db, text)
    after = readers(db)
    assert after == before, 'v2 readers changed their answer'
    # v2 refusals unchanged.
    db.sql(cell(300, V2_ACTIVE, depth=200), refused='depth_bucket_check')
    db.sql(cell(301, V2_ACTIVE, role='donk'), refused='violates check constraint')
    db.sql(cell(302, V2_ACTIVE), refused='objecti_key')
    # v3 stored: 200 bb, the donk root, two lines of one spot.
    v3rows = [cell(400, V3_DS, 'turn', 200, 'barrel', contract='v3', line='x.b-mid.c/'),
              cell(401, V3_DS, 'turn', 200, 'barrel', contract='v3', line='x.b-big.c/'),
              cell(402, V3_DS, 'flop', 200, 'donk', contract='v3', line=''),
              cell(403, V3_DS, 'river', 150, 'facing_bet', 'bet', 'big', contract='v3', line='x.x/x.x/x.b-big')]
    for row in v3rows:
        db.sql(row)
    v3 = json.loads(readers(db, '_v3')[V3_DS])
    assert sorted((r['line_class'], r['depth_bucket'], r['node_role'], r['cell_contract_version']) for r in v3) == sorted(
        [('x.b-mid.c/', 200, 'barrel', 'v3'), ('x.b-big.c/', 200, 'barrel', 'v3'), ('', 200, 'donk', 'v3'), ('x.x/x.x/x.b-big', 150, 'facing_bet', 'v3')]), v3
    # v3 readers return the v2 rows too, identical but for two null columns.
    for key in ('active', V2_EVAL):
        rows3 = json.loads(readers(db, '_v3')[key])
        assert all(r.pop('cell_contract_version') is None and r.pop('line_class') is None for r in rows3)
        assert rows3 == json.loads(before[key]), key
    # The v2 readers never see a v3 cell, even when the v3 dataset is active.
    assert json.loads(readers(db)[V3_DS]) == []
    db.sql(f"UPDATE gto_v31_datasets SET state='retired' WHERE dataset_id={q(V2_ACTIVE)}")
    db.sql(f"UPDATE gto_v31_datasets SET state='active' WHERE dataset_id={q(V3_DS)}")
    assert json.loads(readers(db)['active']) == [], 'v2 reader served a v3 cell'
    assert len(json.loads(readers(db, '_v3')['active'])) == 4
    # v3 refusals.
    for n, row, why in [
        (500, cell(500, V3_DS, 'turn', line='x/'), 'cell_contract_v3_chk'),
        (501, cell(501, V3_DS, 'turn', contract='v3'), 'cell_contract_v3_chk'),
        (502, cell(502, V3_DS, 'turn', contract='v4', line='x/'), 'cell_contract_v3_chk'),
        (503, cell(503, V3_DS, 'turn', contract='v3', line='x.q/'), 'cell_contract_v3_chk'),
        (504, cell(504, V3_DS, 'turn', contract='v3', line='x'), 'cell_contract_v3_chk'),
        (505, cell(505, V3_DS, 'flop', contract='v3', line='/'), 'cell_contract_v3_chk'),
        (506, cell(506, V3_DS, contract='v3', line='', feature='holdem-public-hist215-v1', public=True), 'cell_contract_v3_chk'),
        (507, cell(507, V3_DS, contract='v3', line='', feature='holdem-public-hist215-v2', public=True), 'cell_contract_v3_chk'),
        (508, cell(508, V3_DS, role='donk', facing='bet', size='mid', contract='v3', line=''), 'check4'),
        (509, cell(509, V3_DS, depth=300, contract='v3', line=''), 'depth_bucket_check'),
        (510, cell(510, V3_DS, 'turn', 200, 'barrel', contract='v3', line='x.b-mid.c/'), 'objecti_key'),
        (511, cell(511, V3_DS, contract='v3', line='x' * 300), 'cell_contract_v3_chk'),
    ]:
        db.sql(row, refused=why)
    db.sql(f"UPDATE gto_v31_runtime_cells SET line_class='x.b-small.c/' WHERE cell_key_checksum={q(f'{400:064x}')}", refused='immutable')
    db.sql(f"UPDATE gto_v31_runtime_cells SET cell_contract_version=NULL, line_class=NULL WHERE cell_key_checksum={q(f'{400:064x}')}", refused='immutable')
    db.sql(f"UPDATE gto_v31_runtime_cells SET cell_contract_version='v3', line_class='' WHERE cell_key_checksum={q(f'{100:064x}')}", refused='immutable')
    # Registration answers.
    reg = lambda k: db.sql(f"SELECT COALESCE(fn_gto_v31_registration_cell_contract({q(k)})::text,'null')")
    assert reg('none.key') == 'null'
    db.sql(f"INSERT INTO gto_v31_round_registrations(round_key,dataset_key,cells,dataset_id) VALUES ('r2','v2.eval',{qj([{'street': 'flop'}])},{q(V2_EVAL)})")
    db.sql(f"INSERT INTO gto_v31_round_registrations(round_key,dataset_key,cells,dataset_id) VALUES ('r3','v3.eval',{qj([{'cell_contract': 'v3'}, {'cell_contract': 'v3'}])},{q(V3_DS)})")
    db.sql(f"INSERT INTO gto_v31_round_registrations(round_key,dataset_key,cells) VALUES ('rm','mixed.key',{qj([{'cell_contract': 'v3'}, {}])})")
    assert json.loads(reg('v2.eval'))['cell_contract'] == 'v2'
    r3 = json.loads(reg('v3.eval'))
    assert r3 == {'contract': 'smarter-poker.gto-v31-registration-cell-contract.v1', 'dataset_key': 'v3.eval', 'dataset_id': V3_DS, 'cell_contract': 'v3'}, r3
    assert json.loads(reg('mixed.key'))['cell_contract'] == 'v2'
    for role in ('anon', 'authenticated'):
        db.sql(f"SET ROLE {role}; SELECT fn_gto_v31_registration_cell_contract('v3.eval')", refused='permission denied')
    db.sql("SET ROLE service_role; SET request.jwt.claim.role='service_role'; SELECT fn_gto_v31_registration_cell_contract('v3.eval')")
    for fn in ('fn_gto_v31_active_cells_v3(0,500)', f"fn_gto_v31_evaluation_cells_v3({q(V3_DS)},0,500)"):
        db.sql(f"SET ROLE anon; SELECT * FROM {fn}", refused='permission denied')
    acl = db.sql("SELECT string_agg(proname||'='||proacl::text, ' ' ORDER BY proname) FROM pg_proc WHERE proname LIKE 'fn_gto_v31_%_cells%'")
    assert acl.count('service_role=X/postgres') == 4 and 'anon' not in acl and 'authenticated' not in acl, acl


def run(text):
    cluster = Cluster()
    try:
        db = cluster.fresh_plain()
        scenario(db, cluster, text)
        # Safety: a changed reader is refused before anything happens.
        db2 = cluster.fresh_plain()
        db2.sql("CREATE OR REPLACE FUNCTION public.fn_gto_v31_active_cells(p_offset integer DEFAULT 0, p_limit integer DEFAULT 500) "
                "RETURNS SETOF record LANGUAGE sql AS $$ SELECT NULL::record WHERE false $$", refused='cannot change return type')
        db2.sql("COMMENT ON FUNCTION public.fn_gto_v31_active_cells(integer,integer) IS 'x'")
        db2.sql("ALTER FUNCTION public.fn_gto_v31_active_cells(integer,integer) SET work_mem='64kB'")
        path = cluster.scratch / 'pin.sql'
        path.write_text(text)
        r = cluster.psql(db2.name, ['-f', str(path)])
        assert r.returncode != 0 and 'preimage changed' in r.stderr, r.stderr[-400:]
        assert db2.sql("SELECT count(*) FROM pg_attribute WHERE attrelid='public.gto_v31_runtime_cells'::regclass AND attname='line_class'") == '0'
    finally:
        cluster.stop()


MUTATIONS = [
    ('v2 readers still return v3 cells', "E'\\n   WHERE c.cell_contract_version IS NULL AND d.state=''active'' AND'", "E'\\n   WHERE d.state=''active'' AND'"),
    ('depth 200 for any row', "OR (cell_contract_version = 'v3' AND depth_bucket = 200)", "OR depth_bucket = 200"),
    ('donk for any row', "cell_contract_version = 'v3' AND node_role = 'donk'", "node_role = 'donk'"),
    ('unknown lets a v2 row through', "    OR (cell_contract_version = 'v3' AND depth_bucket = 200)) IS TRUE),", "    OR (cell_contract_version = 'v3' AND depth_bucket = 200))),"),
    ('no street check on the line', "= CASE street WHEN 'flop' THEN 0 WHEN 'turn' THEN 1 WHEN 'river' THEN 2 END", ">= 0"),
    ('no feature coupling', "OR feature_contract_version NOT IN ('holdem-public-hist215-v1', 'holdem-public-hist215-v2'))", "OR true)"),
    ('line not in the key', "     cell_contract_version, line_class);", "     cell_contract_version);"),
    ('contract and line mutable', "RAISE EXCEPTION 'a runtime cell''s cell contract and line class are immutable';", "NULL;"),
    ('registration: any v3 cell counts', "OR c->>'cell_contract' IS DISTINCT FROM 'v3')", ")"),
    ('registration open to every role', "GRANT EXECUTE ON FUNCTION public.fn_gto_v31_registration_cell_contract(text) TO service_role;", "GRANT EXECUTE ON FUNCTION public.fn_gto_v31_registration_cell_contract(text) TO PUBLIC;"),
]


def main():
    text = MIGRATION.read_text()
    run(text)
    print('native proof passed:', MIGRATION.name)
    if '--mutations' in sys.argv:
        failed = []
        for label, old, new in MUTATIONS:
            assert text.count(old) >= 1, f'mutation anchor missing: {label}'
            mutated = text.replace(old, new)
            # A mutated reader changes its postimage; skip the postimage pin so
            # the behaviour itself must catch the mutation.
            mutated = mutated.replace("RAISE EXCEPTION '% postimage md5 % is not the reviewed postimage'", "RAISE NOTICE '% postimage md5 % is not the reviewed postimage'")
            try:
                run(mutated)
                failed.append(label)
                print('NOT DETECTED:', label)
            except AssertionError as error:
                print('detected:', label, '|', str(error).splitlines()[0][:120] if str(error) else '')
        print(f'mutations detected: {len(MUTATIONS) - len(failed)} of {len(MUTATIONS)}')
        if failed:
            sys.exit(1)


if __name__ == '__main__':
    main()
