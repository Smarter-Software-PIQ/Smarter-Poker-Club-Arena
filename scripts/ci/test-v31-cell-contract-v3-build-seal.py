#!/usr/bin/env python3
"""Native proof: V31 cell contract v3 cells are built and sealed, hist215-v3 is storable (dormant).

Runs migration 20261115143957 (runtime cells store cell contract v3) and then
migration 20261115162745 (this proof's subject) against a throwaway PostgreSQL
17 cluster (never production), on the production shapes in
scripts/ci/fixtures/v31-cell-contract-v3-build-seal: ten relations with every
live column, constraint and V31 trigger, and the 146 functions the migrations
patch, generate from or call, byte for byte with their live ACLs. Every
scenario that compares "before" with "after" runs the same calls on a database
with only the first migration ("old") and one with both ("new"). Proves:

  v2 unchanged (old == new, byte for byte)
    * cell key checksum, payload checksum, payload validity, cell context
      validity, declared coverage validity, the public215 training context,
      the feature identity / request / key / hand-matrix / compact-matrix
      validators, the schema, schema-of, model-width and template dispatchers
      and the encoding / audit-key dispatchers on a corpus of v2 inputs
    * a v2 matrix cell built through fn_gto_v31_build_cell: the same row, key,
      payload and source receipts; a v2 public215 envelope reaches the same
      refusal; a 13-key context on any builder answers as before
    * a v2 round seals and consumes its held-out set; a mismatched v2 round is
      refused with the same message; range evidence rows are identical
    * the sealed v1 encoding identity, and the v2 identity, are unchanged
  v3 storable (hist215-v3)
    * a hist215-v3 bundle, dataset (whole v3 cells as declared coverage) and
      public215 runtime cell are stored; old refuses each; a hist215-v3 cell
      without cell contract v3 and a hist215-v3 matrix cell are refused; a
      248-wide audit vector is stored, 247 is not
    * features_v3 = features_v2 (unchanged by the v3 keys) then the v3 block,
      on 60 seeded R8 states with v3 contexts; the v3 block equals Club
      Arena's encodePublic215V3Appended answers; compiled_raw_v3 reads
      feature index 247, refuses 246, compiled_raw_v2 refuses 248; the v3
      chain is named by encoding_implementation_v3 (27 functions) and every
      dispatcher routes hist215-v3 to it and nothing else
  v3 built, only when asked
    * two lines of one spot become two cells with distinct keys, each from its
      own line's source nodes only (receipts), and the donk root; a retry
      returns the same key; the row carries cell_contract_version v3 and its
      line; a v3 context outside declared coverage, with a bad line, or whose
      nodes are another line's is refused; the v2 builders still refuse a
      v3 context; a v3 public215 envelope reaches the v3 public215 builder
    * the legacy seal step compares v3 cells with declared coverage (a match
      passes to the breadth rule, a mismatch is refused there)
  v3 sealed
    * a registered v3 round (two flop sizes on one line, an overbet facing
      node, a donk root at 200 bb) with range provenance seals and consumes
      its held-out set once; a built line that is not the registered one is
      refused and leaves it unconsumed
  safety
    * a changed preimage refuses the whole migration; it refuses to run
      without 20261115143957; every new function keeps its source's ACL

`--mutations` re-runs the scenario against deliberately weakened copies of the
migration and requires each one to be detected.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('range_provenance', ROOT / 'scripts/ci/test-v31-range-provenance.py')
rp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rp)
base = rp.base
MIG1 = next((ROOT / 'supabase/migrations').glob('20261115143957_*.sql'))
MIGRATION = next((ROOT / 'supabase/migrations').glob('*_v31_cell_contract_v3_cells_are_built_and_sealed_and_hist215_.sql'))
FIX = ROOT / 'scripts/ci/fixtures/v31-cell-contract-v3-build-seal'
R8 = ROOT / 'scripts/ci/fixtures/v31-public215-v2-sql/02-r8-ts-vectors.json'
V1, V2, V3 = 'holdem-public-hist215-v1', 'holdem-public-hist215-v2', 'holdem-public-hist215-v3'
S3 = '26d9271d8b1b1b2400476e9cb1c22662e0086bf5111b1f2e1ce7281ef131b784'
q, qj = base.q, base.qj
H = lambda c: c * 64
SPECS = {'c': {'family': 'check', 'size_unit': 'none', 'size_value': None, 'all_in': False},
         'b50': {'family': 'bet', 'size_unit': 'pot_fraction', 'size_value': 0.5, 'all_in': False}}


class Cluster(base.Cluster):
    def db(self, text=None):
        """The fixture, migration 20261115143957, then `text` (this migration, or a copy) when given."""
        self.n += 1
        name = f'd6bs{self.n}'
        r = self.psql('postgres', ['-c', f'CREATE DATABASE {name} TEMPLATE template0'])
        assert r.returncode == 0, r.stderr
        db = base.Db(self, name)
        for f in ('00-schema.sql', '01-live-functions.sql', '02-constraints.sql'):
            db.file(FIX / f)
        db.file(MIG1)
        if text is not None:
            path = self.scratch / f'{name}-m2.sql'
            path.write_text(text)
            db.file(path)
        return db


def one(out):
    return [line for line in out.splitlines() if line.strip()][-1]


def error_line(stderr):
    """The ERROR line alone (CONTEXT lines name function line numbers, which a patch may move)."""
    return next((l.split('ERROR:', 1)[1].strip() for l in stderr.splitlines() if 'ERROR:' in l), stderr.strip()[:200])


def null(v):
    return 'NULL' if v is None else q(v)


def bundle(db, key, feature=None, schema=None, rep=None, refused=None):
    cs = hashlib.sha256(key.encode()).hexdigest()
    out = db.sql("INSERT INTO gto_v31_input_bundles(input_bundle_id,bundle_key,bundle_checksum,range_bundle_checksum,"
                 "source_combo_order_checksum,icm_model_checksum,bundle_manifest,feature_contract_version,"
                 f"policy_export_schema,policy_representation) VALUES (fn_gto_v31_input_bundle_id({q(cs)}),{q(key + '-b')},"
                 f"{q(cs)},repeat('c',64),repeat('d',64),repeat('e',64),'{{}}',{null(feature)},{null(schema)},{null(rep)}) "
                 "RETURNING input_bundle_id||','||bundle_checksum", refused=refused)
    return None if refused else one(out).split(',')


def dataset(db, key, declared, feature=None, schema=None, rep=None, replica=False, refused=None):
    b = bundle(db, key, feature, schema, rep)
    sql = ("INSERT INTO gto_v31_datasets(dataset_key,state,quality_status,solver_version,solver_binary_checksum,"
           "pipeline_commit,pipeline_bundle_checksum,manifest_version,manifest_checksum,source_combo_order_checksum,"
           "range_bundle_checksum,icm_model_checksum,input_bundle_id,input_bundle_checksum,machine_ids,declared_coverage,"
           "quality_gates,feature_contract_version,policy_export_schema,policy_representation) VALUES "
           f"({q(key)},'building','building','pio-3',repeat('1',64),repeat('2',40),repeat('3',64),'m1',{q(rp.TREE)},"
           f"repeat('d',64),repeat('c',64),repeat('e',64),{q(b[0])},{q(b[1])},ARRAY['M1','M2'],{qj(declared)},"
           f"{qj(base.GATES)},{null(feature)},{null(schema)},{null(rep)}) RETURNING dataset_id")
    if replica:
        sql = 'BEGIN; SET LOCAL session_replication_role=replica; ' + sql + '; COMMIT;'
    out = db.sql(sql, refused=refused)
    return None if refused else [l for l in out.splitlines() if len(l.strip()) == 36][0].strip()


def v2ctx(street='turn', texture='Bruc', role='barrel', facing='none', size='none', depth=80, hero='BB', opp='SB'):
    return {'street': street, 'game_family': 'cash', 'objective': 'cash_ev', 'utility_context': 'cash_ev',
            'table_size': 2, 'pot_type': 'srp', 'hero_position': hero, 'opponent_position': opp, 'depth_bucket': depth,
            'texture_class': texture, 'node_role': role, 'facing_kind': facing, 'facing_size_bucket': size}


def v3ctx(line, **kw):
    return {**v2ctx(**kw), 'cell_contract': 'v3', 'line_class': line}


def live_combos(db, board, n=6):
    return [int(x) for x in db.sql(f"SELECT string_agg(i::text,',' ORDER BY i) FROM (SELECT i FROM generate_series(0,1325) i "
                                   f"WHERE fn_gto_v31_hand_key(i,{q(board)}) IS NOT NULL ORDER BY i LIMIT {n}) t").split(',')]


def mnode(db, ctx, board, name, seed):
    """A complete pio-policy v3 source node (matrix datasets with no policy export schema)."""
    m, pev = [0.0] * 1326, [None] * 1326
    fr = {a: [0.0] * 1326 for a in SPECS}
    aev = {a: [None] * 1326 for a in SPECS}
    for k, i in enumerate(live_combos(db, board)):
        f = ((k + seed) % 5) / 4
        m[i] = 1.0
        fr['c'][i], fr['b50'][i] = 1 - f, f
        aev['c'][i], aev['b50'][i] = 0.5, 0.25
        pev[i] = round((1 - f) * 0.5 + f * 0.25, 6)
    return {'schema': 'smarter-poker.pio-policy.v3', 'node': name, 'node_checksum': hashlib.sha256((name + board).encode()).hexdigest(),
            'node_context': {**ctx, 'board': board}, 'line_proof': {'hero_solver_player': 0},
            'action_specs': SPECS, 'matchups': m, 'frequencies': fr, 'policy_evs_bb': pev, 'action_evs_bb': aev}


def gold(db, ds, machine, nodes, street, quarantined=False, tag=None):
    """A solved_spots_gold row and its source artifact, as both live ingest functions write them.
    With `tag` the row id is derived from it (so two databases build byte-identical lineage)."""
    if tag is None:
        row = db.sql("SELECT gen_random_uuid()")
    else:
        h = hashlib.sha256(f"{tag}:{machine}:{[n['node'] for n in nodes]}".encode()).hexdigest()
        row = f'{h[:8]}-{h[8:12]}-4{h[13:16]}-8{h[17:20]}-{h[20:32]}'
    scen = hashlib.sha256((row + machine).encode()).hexdigest()
    sm = {'schema': 'smarter-poker.pio-artifact.v31.1', 'nodes': nodes}
    db.sql(f"INSERT INTO solved_spots_gold(id,scenario_hash,strategy_matrix_v2,solver_version,solver_binary_checksum,machine_id,"
           "pipeline_commit,manifest_version,manifest_checksum,source_artifact_checksum,quality_status,audited_at,pipeline_bundle_checksum) "
           f"SELECT {q(row)},{q(scen)},{qj(sm)},'pio-3',repeat('1',64),{q(machine)},repeat('2',40),'m1',{q(rp.TREE)},"
           f"fn_gto_v31_source_artifact_checksum({q(scen)},{qj(sm)}),{q('quarantined' if quarantined else 'validated')},now(),repeat('3',64)")
    db.sql("INSERT INTO gto_v31_source_artifacts(dataset_id,source_row_id,machine_id,scenario_hash,game_family,stack_depth,street,"
           f"source_artifact_checksum,node_count,solved_at) SELECT {q(ds)},{q(row)},{q(machine)},{q(scen)},'cash',80,{q(street)},"
           f"source_artifact_checksum,{len(nodes)},now() FROM solved_spots_gold WHERE id={q(row)}")
    return row


def build(db, ds, ctx, refused=None, fn='fn_gto_v31_build_cell'):
    out = db.sql(f"SELECT public.{fn}({q(ds)},{qj(ctx)})", refused=refused)
    return error_line(out) if refused else one(out)


def row_of(db, ds, key):
    return json.loads(db.sql(f"SELECT to_jsonb(c)-'cell_id'-'built_at'-'dataset_id' FROM gto_v31_runtime_cells c "
                             f"WHERE dataset_id={q(ds)} AND cell_key_checksum={q(key)}"))


def receipts(db, ds, key):
    return db.sql(f"SELECT string_agg(r.machine_id||':'||r.source_node||':'||r.split, ' ' ORDER BY r.machine_id, r.source_node) "
                  f"FROM gto_v31_cell_source_receipts r JOIN gto_v31_runtime_cells c ON c.cell_id=r.cell_id "
                  f"WHERE c.dataset_id={q(ds)} AND c.cell_key_checksum={q(key)}")


# ---------------------------------------------------------------- v2 unchanged
def v2_corpus_cells():
    out = []
    for street, role, facing, size in (('flop', 'cbet', 'none', 'none'), ('turn', 'facing_bet', 'bet', 'big'),
                                       ('river', 'all_in', 'all_in', 'all_in'), ('turn', 'check_raise', 'raise', 'mid')):
        c = v2ctx(street=street, role=role, facing=facing, size=size)
        for extra in ({}, {'feature_contract_version': 'holdem-board-relative-v2'}, {'feature_contract_version': V1, 'policy_export_schema': 'smarter-poker.pio-policy.v4'},
                      {'cell_contract_version': None, 'line_class': None}, {'feature_contract_version': V2, 'policy_representation': 'public_hist215_v1',
                                                                            'policy_export_schema': 'smarter-poker.pio-policy.v4', 'public_model': {'x': 1}}):
            out.append({**c, **extra, 'action_specs': SPECS, 'hand_matrix': {'AA:0:0': {'c': 1, 'b50': 0}}, 'source_rows': 2,
                        'train_source_rows': 1, 'holdout_source_rows': 1, 'lineage_checksum': H('b')})
    return out


def v2_corpus_contexts():
    c = v2ctx()
    out = [c, v2ctx('flop', 'Brud', 'cbet'), v2ctx('river', 'Arpd', 'facing_raise', 'raise', 'small', 150), {**c, 'depth_bucket': 200},
           {**c, 'node_role': 'donk'}, {**c, 'line_class': 'x.b-mid.c/'}, {k: v for k, v in c.items() if k != 'pot_type'},
           {**c, 'table_size': 11}, {**c, 'hero_position': 'SB'}, {**c, 'street': 'preflop'}, {**c, 'facing_kind': 'bet'}, 'x', [], {}]
    return out


def differential(old, new):
    n = 0
    calls = []
    for cell in v2_corpus_cells():
        j = qj(cell)
        calls += [f"public.fn_gto_v31_cell_key_checksum({j})", f"public.fn_gto_v31_cell_payload_checksum({j}||jsonb_build_object('cell_key_checksum',public.fn_gto_v31_cell_key_checksum({j})))",
                  f"public.fn_gto_v31_cell_payload_valid({j})"]
    for ctx in v2_corpus_contexts():
        j = qj(ctx)
        calls += [f"public.fn_gto_v31_cell_context_valid({j})", f"public.fn_gto_v31_declared_coverage_valid(jsonb_build_array({j}))",
                  f"public.fn_gto_v31_public215_context(CASE WHEN jsonb_typeof({j})='object' THEN {j} END)"]
    for v in (None, 'rank-suit-count-v1', 'holdem-board-relative-v2', V1, V2, 'x'):
        calls += [f"public.fn_gto_v31_feature_request_valid(jsonb_build_object('feature_contract_version',{null(v)}::text))",
                  f"public.fn_gto_v31_hand_matrix_valid(NULL,'flop',{null(v)})",
                  f"public.fn_gto_v31_compact_matrices_valid(NULL,{qj(SPECS)},NULL,NULL,'turn',{null(v)})",
                  f"public.fn_gto_v31_public215_feature_schema({null(v)})", f"public.fn_gto_v31_public215_encoding_for({null(v)})",
                  f"public.fn_gto_v31_public215_audit_key_for({null(v)},repeat('a',64),repeat('b',64),ARRAY['2s','4s','3h'],repeat('c',64))",
                  f"public.fn_gto_v31_public215_template_valid_for('{{}}',{null(v)})"]
        if v not in ('x',):
            calls.append(f"public.fn_gto_v31_feature_identity({null(v)})")
    for s in ('0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f', 'c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4', H('1'), None):
        calls += [f"public.fn_gto_v31_public215_feature_contract_of_schema({null(s)})", f"public.fn_gto_v31_public215_model_width({null(s)})"]
    calls += ["public.fn_gto_v31_public215_encoding_implementation()", "public.fn_gto_v31_public215_encoding_implementation_v2()",
              f"public.fn_gto_v31_public215_cell_model_valid({qj({'policy_representation': 'public_hist215_v1', 'feature_contract_version': V2})})",
              f"public.fn_gto_v31_public215_bundle_valid({qj({'policy_representation': 'public_hist215_v1', 'feature_contract_version': V2})})"]
    for call in calls:
        a = old.cluster.psql(old.name, ['-c', f"SELECT coalesce(({call})::text,'<null>')"])
        b = new.cluster.psql(new.name, ['-c', f"SELECT coalesce(({call})::text,'<null>')"])
        ra = (a.returncode, a.stdout.strip(), a.stderr.strip().split('\n')[0] if a.returncode else '')
        rb = (b.returncode, b.stdout.strip(), b.stderr.strip().split('\n')[0] if b.returncode else '')
        assert ra == rb, f'v2 answer changed for {call[:200]}:\nold {ra}\nnew {rb}'
        n += 1
    return n


def v2_build(db):
    ctx = v2ctx()
    ds = dataset(db, 'v2-build', [ctx], replica=True)
    gold(db, ds, 'M1', [mnode(db, ctx, '2s4s3h9h', 'r:0:c:b50:c', 1)], 'turn', tag='v2-build')
    gold(db, ds, 'M2', [mnode(db, ctx, '7c8dKhAs', 'r:0:c:b50:c', 2)], 'turn', tag='v2-build')
    key = build(db, ds, ctx)
    assert build(db, ds, ctx) == key, 'a v2 retry returned another key'
    out = {'key': key, 'row': row_of(db, ds, key), 'receipts': receipts(db, ds, key)}
    out['refusals'] = [build(db, ds, {**ctx, 'texture_class': 'Brpd'}, refused='not in declared coverage'),
                       build(db, ds, {**ctx, 'line_class': 'x'}, refused='compact cell context is invalid')]
    pds = dataset(db, 'v2-public', [ctx], V2, 'smarter-poker.pio-policy.v4', 'public_hist215_v1', replica=True)
    out['public'] = build(db, pds, {'context': ctx, 'policy_representation': 'public_hist215_v1'}, refused='complete bounded public215 model envelope required')
    return out


# ---------------------------------------------------------------- v3 storable
def public_cell(n, ds, feature, contract=None, line=None, rep='public_hist215_v1', ctx=None):
    c = ctx or v2ctx('flop', 'Brud', 'cbet')
    cols = {'dataset_id': q(ds), 'cell_key_checksum': q(f'{n:064x}'), **{k: (str(v) if isinstance(v, int) else q(v)) for k, v in c.items() if k not in ('cell_contract', 'line_class')},
            'action_specs': qj(SPECS), 'source_rows': '2', 'train_source_rows': '1', 'holdout_source_rows': '1',
            'cell_payload_checksum': q(H('a')), 'lineage_checksum': q(H('b')), 'feature_contract_version': q(feature),
            'policy_export_schema': q('smarter-poker.pio-policy.v4'), 'policy_representation': q(rep)}
    if rep == 'public_hist215_v1':
        cols.update(hand_matrix='NULL', policy_ev_matrix='NULL', action_ev_matrix='NULL', public_model=qj({}), public_template=qj({}),
                    public_training_provenance=qj({}), public_model_build_receipt=qj({}),
                    **{k: q(H('c')) for k in ('model_checksum', 'template_checksum', 'feature_schema_checksum', 'training_provenance_checksum',
                                              'model_build_receipt_checksum', 'sql_physics_checksum')})
    if contract:
        cols.update(cell_contract_version=q(contract), line_class=q(line))
    return f"INSERT INTO gto_v31_runtime_cells({','.join(cols)}) VALUES ({','.join(cols.values())})"


def storable(old, new):
    cells = [v3ctx('x.b-mid.c/x'), v3ctx('', street='flop', texture='Brud', role='donk', depth=200)]
    pub = ('smarter-poker.pio-policy.v4', 'public_hist215_v1')
    bundle(old, 'v3-bundle', V3, *pub, refused='feature_contract_version_check')
    bundle(new, 'v3-bundle', V3, *pub)
    # (a NULL representation passes these CHECKs for v1/v2 as well: the identity rule is the live one, v3 added)
    bundle(new, 'v3-matrix-bundle', V3, 'smarter-poker.pio-policy.v4', 'matrix_v2', refused='numeric_representation_identity_chk')
    bundle(old, 'v2-matrix-bundle', V2, 'smarter-poker.pio-policy.v4', 'matrix_v2', refused='numeric_representation_identity_chk')
    dataset(old, 'v3-store', cells, V2, *pub, replica=True, refused='declared_coverage_valid_chk')
    ds = dataset(new, 'v3-store', cells, V3, *pub, replica=True)
    dataset(new, 'v3-store-bad', [{**cells[0], 'line_class': 'x.b-mid.c'}], V3, *pub, replica=True, refused='declared_coverage_valid_chk')
    new.sql(public_cell(1, ds, V3, 'v3', 'x.b-mid.c/x', ctx=cells[0]))
    new.sql(public_cell(2, ds, V3), refused='hist215_v3_cell_contract_chk')
    new.sql(public_cell(3, ds, V2, 'v3', 'x.b-big.c/x', ctx=cells[0]), refused='cell_contract_v3_chk')
    new.sql(public_cell(4, ds, V3, 'v3', 'x.b-big.c/x', rep='matrix_v2', ctx=cells[0]), refused='violates check constraint')
    # A v2 dataset of the old shape is still stored (a v2 public215 cell of hist215-v2).
    ods = dataset(old, 'v2-store', [v2ctx('flop', 'Brud', 'cbet')], V2, *pub, replica=True)
    nds = dataset(new, 'v2-store', [v2ctx('flop', 'Brud', 'cbet')], V2, *pub, replica=True)
    old.sql(public_cell(5, ods, V2))
    new.sql(public_cell(5, nds, V2))
    # 248-wide audit vectors.
    for db in (old, new):
        db.sql(f"INSERT INTO gto_v31_public_model_audits VALUES ('k1',repeat('p',64),repeat('m',64),repeat('t',64),repeat('e',64),ARRAY['2s'],1,repeat('a',64),now())")
    ins = lambda db, w, refused=None: db.sql(f"BEGIN; INSERT INTO gto_v31_public_model_audit_combos VALUES ('k1',{w},array_fill(0::float8,ARRAY[{w}]),ARRAY[0]::float8[],0,ARRAY[0]::float8[],ARRAY[1]::float8[]); COMMIT;", refused=refused)
    ins(old, 248, refused='features_check')
    ins(new, 248)
    ins(new, 247, refused='features_check')
    ins(new, 246)


# ---------------------------------------------------------------- v3 encoding chain
def ts_v3_block(ctx):
    on = {f'{k}={v}' for k, v in ctx.items() if k not in ('texture_class', 'depth_bucket', 'table_size')}
    return [1.0 if k in on else 0.0 for k in ('facing_size_bucket=big', 'node_role=donk')]


def encoding(new):
    states = json.loads(R8.read_text())[:60]
    variants = [lambda c: {**c, 'cell_contract': 'v3', 'line_class': 'x.b-mid.c/x'},
                lambda c: {**c, 'cell_contract': 'v3', 'line_class': 'x.b-big', 'node_role': 'facing_bet', 'facing_kind': 'bet', 'facing_size_bucket': 'big'},
                lambda c: {**c, 'cell_contract': 'v3', 'line_class': '', 'node_role': 'donk', 'facing_kind': 'none', 'facing_size_bucket': 'none'}]
    checked = 0
    for i, s in enumerate(states):
        t2 = s['template']
        t3 = {**t2, 'context': variants[i % 3](t2['context'])}
        args = lambda t: f"{s['combo']},{q(s['board'])},{qj(t)},ARRAY[{','.join(s['mass'])}]::numeric[]"
        v2 = json.loads(new.sql(f"SELECT public.fn_gto_v31_public215_bits(public.fn_gto_v31_public215_features_v2({args(t2)}))"))
        assert v2 == s['ts_words'][:246], f'state {i}: SQL features_v2 differs from the TS v2 vector'
        x3 = json.loads(new.sql(f"SELECT public.fn_gto_v31_public215_bits(public.fn_gto_v31_public215_features_v3({args(t3)}))"))
        v2_of_t3 = json.loads(new.sql(f"SELECT public.fn_gto_v31_public215_bits(public.fn_gto_v31_public215_features_v2({args(t3)}))"))
        assert len(x3) == 248 and x3[:246] == v2_of_t3, f'state {i}: v3 prefix is not v2'
        if i % 3 == 0:
            assert v2_of_t3 == v2, f'state {i}: cell_contract/line_class changed a v1/v2 feature'
        want = ['3ff0000000000000' if b else '0000000000000000' for b in ts_v3_block(t3['context'])]
        assert x3[246:] == want, f'state {i}: v3 block {x3[246:]} != {want}'
        checked += 1
    head = "ARRAY[ROW(0.5,ARRAY[ROW(ARRAY[247,-1,-1]::smallint[],ARRAY[0.5,0,0]::float8[],ARRAY[1,-1,-1]::smallint[],ARRAY[2,-1,-1]::smallint[],ARRAY[0,1,2]::float8[])::gto_v31_public215_tree])::gto_v31_public215_head]"
    x = lambda w, last: f"(array_fill(0::float8,ARRAY[{w - 1}])||ARRAY[{last}::float8])"
    assert new.sql(f"SELECT public.fn_gto_v31_public215_compiled_raw_v3({head},{x(248, 1)})") == '{2.5}'
    assert new.sql(f"SELECT public.fn_gto_v31_public215_compiled_raw_v3({head},{x(248, 0)})") == '{1.5}'
    new.sql(f"SELECT public.fn_gto_v31_public215_compiled_raw_v3({head},{x(246, 0)})", refused='finite248')
    new.sql(f"SELECT public.fn_gto_v31_public215_compiled_raw_v2({head},{x(248, 0)})", refused='finite246')
    ident = new.sql("SELECT pg_get_functiondef('public.fn_gto_v31_public215_encoding_implementation_v3()'::regprocedure)")
    assert ident.count("'::regprocedure") == 27, ident.count("'::regprocedure")
    e3 = new.sql("SELECT public.fn_gto_v31_public215_encoding_implementation_v3()")
    assert e3 == new.sql(f"SELECT public.fn_gto_v31_public215_encoding_for({q(V3)})")
    assert new.sql(f"SELECT public.fn_gto_v31_public215_feature_schema({q(V3)})") == S3
    assert new.sql(f"SELECT public.fn_gto_v31_public215_feature_contract_of_schema({q(S3)})") == V3
    assert new.sql(f"SELECT public.fn_gto_v31_public215_model_width({q(S3)})") == '248'
    ak = new.sql(f"SELECT public.fn_gto_v31_public215_audit_key_for({q(V3)},repeat('a',64),repeat('b',64),ARRAY['2s','4s','3h'],repeat('c',64))")
    assert ak == new.sql("SELECT public.fn_gto_v31_public215_audit_key_v3(repeat('a',64),repeat('b',64),ARRAY['2s','4s','3h'],repeat('c',64))")
    assert ak != new.sql(f"SELECT public.fn_gto_v31_public215_audit_key_for({q(V2)},repeat('a',64),repeat('b',64),ARRAY['2s','4s','3h'],repeat('c',64))")
    # dispatch of a hist215-v3 runtime row and the v3 chain's own guard
    ds = dataset(new, 'v3-chain', [v3ctx('x.b-mid.c/x')], V3, 'smarter-poker.pio-policy.v4', 'public_hist215_v1', replica=True)
    new.sql(public_cell(9, ds, V3, 'v3', 'x.b-mid.c/x', ctx=v3ctx('x.b-mid.c/x')))
    row = f"(SELECT c FROM gto_v31_runtime_cells c WHERE dataset_id={q(ds)})"
    v2row = "(SELECT c FROM gto_v31_runtime_cells c WHERE feature_contract_version='holdem-public-hist215-v2' LIMIT 1)"
    new.sql(f"SELECT public.fn_gto_v31_public215_required_audit_v3({v2row},'2s4s3h9h')", refused='public215 v3 cell required')
    new.sql(f"SELECT public.fn_gto_v31_public215_required_audit_v2({row},'2s4s3h9h')", refused='public215 v2 cell required')
    # the dispatcher sends the v3 row past both guards (to the v3 chain), the v2 row to v2
    for r, other in ((row, 'public215 v3 cell required'), (v2row, 'public215 v2 cell required')):
        err = error_line(new.sql(f"SELECT public.fn_gto_v31_public215_required_audit_for({r},'2s4s3h9h')", refused='ERROR'))
        assert 'cell required' not in err, err
    # v3 template validity: the 15-key v3 cell with v3 categories; never through v1/v2
    tpl = {**states[0]['template'], 'format': 'public_hist215_template_v1', 'root_actor': 'OOP', 'opponent_weights': ['1'] * 1326}
    for ctx, v, ok in ((v3ctx('x.b-big', street='flop', texture='Brud', role='facing_bet', facing='bet', size='big', hero='SB', opp='BB'), V3, 't'),
                       (v3ctx('', street='flop', texture='Brud', role='donk', depth=200, hero='SB', opp='BB'), V3, 't'),
                       (v3ctx('x.b-mid', street='flop', texture='Brud', role='facing_bet', facing='bet', size='mid', hero='SB', opp='BB'), V2, 'f'),
                       (v2ctx('flop', 'Brud', 'facing_bet', 'bet', 'mid', hero='SB', opp='BB'), V3, 'f'),
                       ({**v3ctx('x.b-mid', street='flop', texture='Brud', role='facing_bet', facing='bet', size='mid'), 'line_class': 'x.b-mid/x'}, V3, 'f')):
        got = new.sql(f"SELECT public.fn_gto_v31_public215_template_valid_for({qj({**tpl, 'context': ctx})},{q(v)})")
        assert got == ok, (ctx, v, got)
    return checked


# ---------------------------------------------------------------- v3 built
def v3_build(db):
    mid, big = v3ctx('x.b-mid.c/'), v3ctx('x.b-big.c/')
    donk = v3ctx('', street='flop', texture='Brud', role='donk')
    ds = dataset(db, 'v3-build', [mid, big, donk], replica=True)
    gold(db, ds, 'M1', [mnode(db, mid, '2s4s3h9h', 'r:0:c:b50:c', 1), mnode(db, big, '2s4s3h9h', 'r:0:c:b100:c', 2)], 'turn')
    gold(db, ds, 'M2', [mnode(db, mid, '7c8dKhAs', 'r:0:c:b50:c', 3), mnode(db, big, '7c8dKhAs', 'r:0:c:b100:c', 4)], 'turn')
    gold(db, ds, 'M1', [mnode(db, donk, '2c5d9h', 'r:0', 5)], 'flop')
    gold(db, ds, 'M2', [mnode(db, donk, 'JcQdKs', 'r:0', 6)], 'flop')
    k_mid, k_big, k_donk = build(db, ds, mid), build(db, ds, big), build(db, ds, donk)
    assert len({k_mid, k_big, k_donk}) == 3, 'two lines of one spot share a key'
    assert build(db, ds, mid) == k_mid, 'a v3 retry returned another key'
    assert receipts(db, ds, k_mid) == 'M1:r:0:c:b50:c:train M2:r:0:c:b50:c:holdout', receipts(db, ds, k_mid)
    assert receipts(db, ds, k_big) == 'M1:r:0:c:b100:c:train M2:r:0:c:b100:c:holdout', receipts(db, ds, k_big)
    r = row_of(db, ds, k_mid)
    assert (r['cell_contract_version'], r['line_class'], r['depth_bucket']) == ('v3', 'x.b-mid.c/', 80), r
    assert row_of(db, ds, k_donk)['node_role'] == 'donk'
    assert db.sql(f"SELECT count(*) FROM gto_v31_runtime_cells c WHERE dataset_id={q(ds)} AND public.fn_gto_v31_cell_payload_valid(to_jsonb(c))") == '3'
    assert db.sql(f"SELECT count(*) FROM gto_v31_runtime_cells c WHERE dataset_id={q(ds)} AND cell_key_checksum=public.fn_gto_v31_cell_key_checksum(to_jsonb(c))") == '3'
    # refusals
    build(db, ds, v3ctx('x.b-small.c/'), refused='not in declared coverage')
    build(db, ds, {**mid, 'line_class': 'x.b-mid.c'}, refused='cell contract v3 cell context is invalid')
    build(db, ds, {k: v for k, v in mid.items() if k != 'line_class'}, refused='cell contract v3 cell context is invalid')
    build(db, ds, mid, fn='fn_gto_v31_build_cell_matrix_v2', refused='compact cell context is invalid')
    build(db, ds, v2ctx(), fn='fn_gto_v31_build_cell_matrix_v3', refused='cell contract v3 cell context is invalid')
    small = v3ctx('x.b-small.c/')
    ds2 = dataset(db, 'v3-build-wrong-line', [small], replica=True)
    gold(db, ds2, 'M1', [mnode(db, mid, '2s4s3h9h', 'r:0:c:b50:c', 1)], 'turn')
    gold(db, ds2, 'M2', [mnode(db, mid, '7c8dKhAs', 'r:0:c:b50:c', 3)], 'turn')
    build(db, ds2, small, refused='cell needs M1 and M2')
    # the legacy seal step compares v3 cells with declared coverage
    db.sql(f"SELECT public.fn_gto_v31_seal_build({q(ds)})", refused='required Phase 4 street, family, utility, table, pot, or response coverage is incomplete')
    ds3 = dataset(db, 'v3-build-short', [mid, big], replica=True)
    gold(db, ds3, 'M1', [mnode(db, mid, '2s4s3h9h', 'r:0:c:b50:c', 1)], 'turn')
    gold(db, ds3, 'M2', [mnode(db, mid, '7c8dKhAs', 'r:0:c:b50:c', 3)], 'turn')
    build(db, ds3, mid)
    db.sql(f"SELECT public.fn_gto_v31_seal_build({q(ds3)})", refused='runtime cells do not exactly equal declared coverage')
    # the matrix v3 validator: depth 200 and donk on a v3 cell only
    # (the stored row's own jsonb: a Python round trip would rewrite numerics such as 1.000000)
    cell = f"(SELECT to_jsonb(c) FROM gto_v31_runtime_cells c WHERE dataset_id={q(ds)} AND cell_key_checksum={q(k_donk)})"
    assert db.sql(f"SELECT public.fn_gto_v31_cell_payload_valid_matrix_v3({cell})") == 't'
    assert db.sql(f"SELECT public.fn_gto_v31_cell_payload_valid_matrix_v2({cell})") == 'f', 'the v2 validator admitted donk'
    for bad in ({'cell_contract_version': None}, {'line_class': 'x/'}, {'depth_bucket': 300}):
        assert db.sql(f"SELECT public.fn_gto_v31_cell_payload_valid_matrix_v3({cell}||{qj(bad)})") == 'f', bad
    # a v3 public215 envelope reaches the v3 public215 builder
    pds = dataset(db, 'v3-public', [mid], V3, 'smarter-poker.pio-policy.v4', 'public_hist215_v1', replica=True)
    build(db, pds, {'context': mid, 'policy_representation': 'public_hist215_v1'}, refused='complete bounded public215 model envelope required')
    env = {k: {} for k in ('public_model', 'public_template', 'public_training_provenance', 'public_model_build_receipt')}
    env.update({k: H('c') for k in ('model_checksum', 'template_checksum', 'feature_schema_checksum', 'training_provenance_checksum', 'model_build_receipt_checksum')})
    env.update(context={**mid, 'line_class': 'x'}, policy_representation='public_hist215_v1')
    build(db, pds, env, refused='cell contract v3 cell context is invalid')
    env['context'] = small
    build(db, pds, env, refused='compact cell is not in declared coverage')
    return 3


# ---------------------------------------------------------------- sealed
MID_LINE = [rp.step('check', 0, available=1), rp.step('bet', 1, 450, available=3), rp.step('call', 0, 450, available=3),
            rp.step('check', 0, available=1, street='turn')]
BIG_LINE = [rp.step('check', 0, available=1), rp.step('bet', 1, 900, available=3), rp.step('call', 0, 900, available=3),
            rp.step('check', 0, available=1, street='turn')]


def v3cell(street, texture, line, role='barrel', hero='BB', opp='SB', depth=200, facing='none', size='none'):
    value = base.cell(street, texture, role=role, hero=hero, opp=opp)
    value.update(depth_bucket=depth, facing_kind=facing, facing_size_bucket=size, cell_contract='v3', line_class=line)
    return value


def entry(cell, history, construction='natural', hero=1):
    return rp.provenance(cell, construction, history, hero=hero, effective_stack_chips=cell['depth_bucket'] * 100)


BOARD_OF = {'flop': '2s4s3h', 'turn': '2s4s3hJh', 'river': '2s4s3hJhQs'}


def runtime_rows(db, ds, cells):
    """Built cells as the seal reads them: the context, the contract and line, and a minimal valid matrix."""
    for i, c in enumerate(cells):
        cols = ','.join(base.KEYS)
        vals = ','.join(str(c[k]) if isinstance(c[k], int) else q(c[k]) for k in base.KEYS)
        extra = (f",{q(c['cell_contract'])},{q(c['line_class'])}", ',cell_contract_version,line_class') if 'cell_contract' in c else ('', '')
        key = f"public.fn_gto_v31_hand_key(0,{q(BOARD_OF[c['street']])})"
        matrices = (f"jsonb_build_object({key},'{{\"c\":1,\"b50\":0}}'::jsonb),jsonb_build_object({key},0.5),"
                    f"jsonb_build_object({key},'{{\"c\":0.5,\"b50\":0.25}}'::jsonb)")
        db.sql(f"INSERT INTO gto_v31_runtime_cells(dataset_id,cell_key_checksum,cell_payload_checksum,lineage_checksum,action_specs,"
               f"source_rows,train_source_rows,holdout_source_rows,hand_matrix,policy_ev_matrix,action_ev_matrix,{cols}{extra[1]}) "
               f"VALUES ('{ds}',md5('{ds}k{i}')||md5('{ds}K{i}'),md5('{ds}p{i}')||md5('{ds}P{i}'),md5('{ds}l{i}')||md5('{ds}L{i}'),"
               f"{qj(SPECS)},2,1,1,{matrices},{vals}{extra[0]})")


def ingest_round(db, ds, good, tag=None):
    for e in good:
        for b in rp.BOARDS:
            board = b if e['cell']['street'] == 'flop' else (b + ('Jh' if 'Jh' not in b else 'Qs'))
            stack = {'line_proof.effective_stack_chips': e['game']['effective_stack_chips']}
            node = (rp.forced(e['cell'], e, board, **stack) if e['range_construction'] == 'root'
                    else rp.narrowed(e['cell'], e, board, **stack))
            gold(db, ds, 'M1', [node], e['cell']['street'], quarantined=True,
                 tag=None if tag is None else f"{tag}:{base.canonical_bytes(e['cell'])}:{board}")


def sealed(old, new):
    barrel_mid = v3cell('turn', 'Bruc', 'x.b-mid.c/x')
    barrel_big = v3cell('turn', 'Bruc', 'x.b-big.c/x')
    overbet = v3cell('flop', 'Brud', 'x.b-big', role='facing_bet', hero='SB', opp='BB', facing='bet', size='big')
    donk = v3cell('flop', 'Brud', '', role='donk', hero='SB', opp='BB')
    good = [entry(barrel_mid, MID_LINE), entry(barrel_big, BIG_LINE),
            entry(overbet, [rp.step('check', 0, available=1), rp.step('bet', 1, 900, available=3)], hero=0),
            entry(donk, [], construction='root', hero=0)]
    cells = [e['cell'] for e in good]
    # old: registrable (20261113143100) but never storable as a dataset: the declared coverage check refuses v3 cells
    base.register(old, rp.registration('r950', 'horse-r950', good))
    dataset(old, 'horse-r950', cells, refused='declared_coverage_valid_chk')
    # new: registered, created, sourced, built, sealed once
    base.register(new, rp.registration('r950', 'horse-r950', good))
    ds = dataset(new, 'horse-r950', cells)
    ingest_round(new, ds, good)
    wrong = cells[:3] + [{**donk, 'line_class': 'x'}]
    runtime_rows(new, ds, wrong)
    base.seal(new, ds, refused='the held-out set is not consumed')
    assert rp.consumed(new, 'r950') == 'f'
    new.sql(f"DELETE FROM gto_v31_runtime_cells WHERE dataset_id='{ds}'")
    runtime_rows(new, ds, cells)
    base.seal(new, ds)
    assert rp.consumed(new, 'r950') == 't', 'the v3 round did not consume its held-out set'
    base.seal(new, ds, refused='already sealed')
    assert new.sql(f"SELECT count(*) FROM gto_v31_range_evidence WHERE dataset_id='{ds}' AND kind='source_node' AND registered") == str(4 * len(rp.BOARDS))


def v2_sealed(db):
    """The range-provenance acceptance round of the v2 proof (root + natural + subgame), and one mismatch."""
    flop = base.cell('flop', 'Brud', role='cbet', hero='BB', opp='SB')
    turn = base.cell('turn', 'Bruc', role='barrel')
    river = base.cell('river', 'Arpd', role='probe', hero='BB', opp='SB')
    one_action_check = [rp.step('check', 0, available=1)]
    bet_call = [rp.step('check', 0, available=1), rp.step('bet', 1, 214), rp.step('call', 0, 214)]
    good = [rp.provenance(flop, 'root', one_action_check, hero=1), rp.provenance(turn, 'natural', bet_call, hero=0),
            rp.provenance(river, 'subgame', bet_call, hero=1, upstream='9' * 64)]
    base.register(db, rp.registration('r960', 'horse-r960', good))
    ds = dataset(db, 'horse-r960', [e['cell'] for e in good])
    ingest_round(db, ds, good, tag='v2-seal')
    runtime_rows(db, ds, [flop, turn, {**river, 'texture_class': 'Arpc'}])
    err = error_line(base.seal(db, ds, refused='the held-out set is not consumed'))
    db.sql(f"DELETE FROM gto_v31_runtime_cells WHERE dataset_id='{ds}'")
    runtime_rows(db, ds, [flop, turn, river])
    base.seal(db, ds)
    evidence = db.sql(f"SELECT md5(string_agg(kind||cell_key||registered::text||coalesce(board,'')||coalesce(oop_group,'')||coalesce(ip_group,''),'|' ORDER BY cell_key,board,kind)) "
                      f"FROM gto_v31_range_evidence WHERE dataset_id='{ds}'")
    return {'consumed': rp.consumed(db, 'r960'), 'mismatch': err, 'evidence': evidence}


# ---------------------------------------------------------------- run
def scenario(cluster, text):
    old, new = cluster.db(), cluster.db(text)
    acl = new.sql("SELECT string_agg(proname||'='||coalesce(proacl::text,''),' ' ORDER BY proname) FROM pg_proc WHERE proname IN "
                  "('fn_gto_v31_build_cell_matrix_v3','fn_gto_v31_public215_build_cell_v3','fn_gto_v31_cell_payload_valid_matrix_v3',"
                  "'fn_gto_v31_public215_features_v3','fn_gto_v31_public215_v3_appended','fn_gto_v31_public215_encoding_implementation_v3',"
                  "'fn_gto_v31_public215_template_valid_v3','fn_gto_v31_cell_contract_identity')")
    assert acl.count('={postgres=X/postgres}') == 7 and 'fn_gto_v31_cell_contract_identity={postgres=X/postgres,service_role=X/postgres}' in acl, acl
    for fn in ('fn_gto_v31_build_cell(uuid,jsonb)', 'fn_gto_v31_cell_key_checksum(jsonb)', 'fn_gto_v31_cell_context_valid(jsonb)', 'fn_gto_v31_runtime_cell_context(gto_v31_runtime_cells)'):
        a = old.sql(f"SELECT coalesce(proacl::text,'') FROM pg_proc WHERE oid='public.{fn}'::regprocedure")
        b = new.sql(f"SELECT coalesce(proacl::text,'') FROM pg_proc WHERE oid='public.{fn}'::regprocedure")
        assert a == b, (fn, a, b)
    calls = differential(old, new)
    ba, bb = v2_build(old), v2_build(new)
    assert ba == bb, 'v2 build changed: ' + '; '.join(f'{k}: old {json.dumps(ba[k])[:300]} new {json.dumps(bb[k])[:300]}' for k in ba if ba[k] != bb.get(k))
    sa, sb = v2_sealed(old), v2_sealed(new)
    assert sa == sb and sa['consumed'] == 't', f'v2 seal changed:\nold {sa}\nnew {sb}'
    storable(old, new)
    states = encoding(new)
    built = v3_build(new)
    sealed(old, new)
    return calls, states, built


def run(text):
    cluster = Cluster()
    try:
        counts = scenario(cluster, text)
        # Safety: a changed preimage refuses the whole migration; it needs 20261115143957 first.
        db = cluster.db()
        db.sql("CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_model_width(p_schema text) RETURNS integer LANGUAGE sql IMMUTABLE "
               "SET search_path TO 'pg_catalog' AS $function$ SELECT 215 $function$")
        path = cluster.scratch / 'pin.sql'
        path.write_text(text)
        r = cluster.psql(db.name, ['-f', str(path)])
        assert r.returncode != 0 and 'preimage changed' in r.stderr, r.stderr[-400:]
        assert db.sql("SELECT count(*) FROM pg_proc WHERE proname='fn_gto_v31_build_cell_matrix_v3'") == '0'
        cluster.n += 1
        bare = f'd6bs{cluster.n}'
        assert cluster.psql('postgres', ['-c', f'CREATE DATABASE {bare} TEMPLATE template0']).returncode == 0
        bdb = base.Db(cluster, bare)
        for f in ('00-schema.sql', '01-live-functions.sql', '02-constraints.sql'):
            bdb.file(FIX / f)
        r = cluster.psql(bare, ['-f', str(path)])
        assert r.returncode != 0 and 'must be installed first' in r.stderr, r.stderr[-400:]
        return counts
    finally:
        cluster.stop()


MUTATIONS = [
    ('v2 cell key changes', "              ELSE '{}'::jsonb END", "              ELSE '{\"v\":2}'::jsonb END"),
    ('v2 contexts reach the v3 builders', " IF jsonb_typeof(p_context)=''object'' AND (p_context ? ''cell_contract'' OR", " IF jsonb_typeof(p_context)=''object'' AND (true OR"),
    ('key ignores the line', "THEN jsonb_build_object('cell_contract', 'v3', 'line_class', p_cell->'line_class')", "THEN '{}'::jsonb"),
    ('seal context without the v3 cell', "||public.fn_gto_v31_cell_contract_identity(jsonb_build_object(''cell_contract_version'',c.cell_contract_version,''line_class'',c.line_class))", ''),
    ('v3 builder takes every line', "       AND n.value#>>''{node_context,line_class}''=p_context->>''line_class''\\n", ''),
    ('dispatcher sends v3 to the v2 builders', "RETURN public.fn_gto_v31_build_cell_matrix_v3(p_dataset_id,p_context);\\n END IF;", "RETURN public.fn_gto_v31_build_cell_matrix_v2(p_dataset_id,p_context);\\n END IF;"),
    ('v3 context accepted without its line check', "    RETURN public.fn_gto_v31_cell_contract_v3_error(p_context) IS NULL\\n       AND ", "    RETURN "),
    ('matrix v3 validator refuses donk', "IF v_role IN (''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'',''donk'') THEN", "IF v_role IN (''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'') THEN"),
    ('v3 block order swapped', "ARRAY['facing_size_bucket=big','node_role=donk']", "ARRAY['node_role=donk','facing_size_bucket=big']"),
    ('compiled_raw_v3 keeps 246', "[\"cardinality(p_x)<>246\", \"cardinality(p_x)<>248\", 1]", "[\"cardinality(p_x)<>246\", \"cardinality(p_x)<>246\", 1]"),
    ('encoding_for has no v3 route', " WHEN p_version=''holdem-public-hist215-v3'' THEN public.fn_gto_v31_public215_encoding_implementation_v3() ELSE", " ELSE"),
    ('hist215-v3 without cell contract v3', "    feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v3' OR cell_contract_version = 'v3') IS TRUE)", "    true) IS TRUE)"),
    ('runtime cells refuse hist215-v3', "ALTER TABLE public.gto_v31_runtime_cells\n  DROP CONSTRAINT gto_v31_runtime_cells_feature_contract_version_check,\n  ADD CONSTRAINT gto_v31_runtime_cells_feature_contract_version_check CHECK ((feature_contract_version = ANY (ARRAY['rank-suit-count-v1'::text, 'holdem-board-relative-v2'::text, 'holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text, 'holdem-public-hist215-v3'::text])))",
     "ALTER TABLE public.gto_v31_runtime_cells\n  DROP CONSTRAINT gto_v31_runtime_cells_feature_contract_version_check,\n  ADD CONSTRAINT gto_v31_runtime_cells_feature_contract_version_check CHECK ((feature_contract_version = ANY (ARRAY['rank-suit-count-v1'::text, 'holdem-board-relative-v2'::text, 'holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text])))"),
    ('range evidence ignores the v3 cell', "THEN jsonb_build_object(''cell_contract'', ''v3'', ''line_class'', n#>''{node_context,line_class}'') ELSE", "THEN ''{}''::jsonb ELSE"),
    ('legacy seal keeps the 13-key coverage', "[\"public.fn_gto_v31_seal_build_legacy_v31(uuid)\"", None),
    ('audit vectors stay 246 wide', "CHECK ((cardinality(features) = ANY (ARRAY[215, 246, 248]))) NOT VALID", "CHECK ((cardinality(features) = ANY (ARRAY[215, 246]))) NOT VALID"),
    ('v2 seal context changes', "    ||public.fn_gto_v31_cell_contract_identity(jsonb_build_object(", "    ||jsonb_build_object(''_'',1)||public.fn_gto_v31_cell_contract_identity(jsonb_build_object("),
]


def mutate(text, label, old, new):
    if new is None and label == 'legacy seal keeps the 13-key coverage':
        # drop the legacy seal's patch row entirely (it then keeps its 13-key comparison)
        start = text.index("    ('public.fn_gto_v31_seal_build_legacy_v31(uuid)'::regprocedure")
        end = text.index('\n  ) AS p(fn, pre_md5, anchors) LOOP', start)
        return text[:start].rstrip().rstrip(',') + text[end:]
    assert text.count(old) >= 1, f'mutation anchor missing: {label}'
    return text.replace(old, new)


def main():
    text = MIGRATION.read_text()
    calls, states, built = run(text)
    print(f'native proof passed: {MIGRATION.name} ({calls} v2 calls identical, {states} v3 feature vectors, {built} v3 cells built)')
    if '--mutations' in sys.argv:
        failed = []
        for label, old, new in MUTATIONS:
            mutated = mutate(text, label, old, new)
            # a mutation changes a postimage; skip the pins so behaviour itself must catch it
            mutated = mutated.replace("RAISE EXCEPTION '% postimage md5 % is not the reviewed postimage'", "RAISE NOTICE '% postimage md5 % is not the reviewed postimage'")
            try:
                run(mutated)
                failed.append(label)
                print('NOT DETECTED:', label)
            except AssertionError as error:
                print('detected:', label, '|', (str(error).splitlines() or [''])[0][:140])
        print(f'mutations detected: {len(MUTATIONS) - len(failed)} of {len(MUTATIONS)}')
        if failed:
            sys.exit(1)


if __name__ == '__main__':
    main()
