#!/usr/bin/env python3
"""Native proof: V31 cell contract v3 at round registration (dormant).

Runs migration 20261113143100 on top of 20261110213931 (round registration)
and 20261112185251 (range provenance) against a throwaway PostgreSQL cluster
(never production), with the fixtures of test-v31-range-provenance.py. Proves:

  v2 unchanged
    * the complete range-provenance scenario (every refusal, acceptance, seal,
      ingest and legacy check of test-v31-range-provenance.py) passes with
      this migration installed
    * fn_gto_v31_cell_provenance_error and the registration guard return the
      same answer, byte for byte, before and after this migration on a corpus
      of v2 registrations and provenance entries, valid and mutated
    * every registration-time mutation of test-v31-range-provenance.py,
      applied to this migration's copy of the function, is still detected
  v3 accepted
    * a v3 round: a turn barrel after a called 0.75-pot flop bet and the same
      barrel after a called 1.5-pot flop bet (two cells, no collision), a
      node facing a 1.5-pot overbet, and the flop-root lead into the preflop
      raiser (role donk, root construction, empty public history), at 200 bb
  v3 refused
    * mixed v2 and v3 cells; an unknown contract; depth 300; a malformed
      line; a line for another street; a role that disagrees with its facing;
      a missing key; a repeated cell; a line that does not name its public
      history; a runtime mapping without, or with another, line; game
      assumptions that disagree with the 200 bb bucket; forced ranges
  feature contract coupling (review M1)
    * a dataset declaring holdem-public-hist215-v3 for a v2 registration is
      refused; a dataset declaring hist215-v1 or hist215-v2 for a v3
      registration is refused; the matched pairs are admitted
  v2 guard body (review m3)
    * every v2 refusal of the re-created registration guard and dataset-insert
      check is exercised with a v2 registration: cell shape, composition,
      checksum, owner authorization, candidate, dataset provenance, quality
      gates and each of the five threshold floors, evaluation plan, a dataset
      stamp at insert, immutability, permanence; unregistered, substituted,
      re-gated and reused datasets
  dormant
    * a registered v3 round cannot be sealed: gto_v31_runtime_cells has no
      line_class, so its built cells never equal the registered v3 cells

`--mutations` re-runs the scenario against deliberately weakened copies of the
migration and requires each one to be detected: the v3 checks, the coupling,
each v2 refusal of the re-created guard and dataset-insert check (its RAISE
turned into a DEBUG message, or a threshold line removed), and the v2 mutations of
test-v31-range-provenance.py and test-v31-round-registration.py whose anchors
this migration re-creates.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('range_provenance', ROOT / 'scripts/ci/test-v31-range-provenance.py')
rp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rp)
base = rp.base
MIGRATION = ROOT / 'supabase/migrations/20261113143100_v31_cell_contract_v3_the_registration_accepts_v3_cells_dorma.sql'
step = rp.step


def v3cell(street, texture, line, role='barrel', hero='BB', opp='SB', depth=200, facing='none', size='none'):
    value = base.cell(street, texture, role=role, hero=hero, opp=opp)
    value.update(depth_bucket=depth, facing_kind=facing, facing_size_bucket=size, cell_contract='v3', line_class=line)
    return value


def entry(cell, history, construction='natural', hero=1, **game):
    return rp.provenance(cell, construction, history, hero=hero,
                         **{'effective_stack_chips': cell['depth_bucket'] * 100, **game})


MID_LINE = [step('check', 0, available=1), step('bet', 1, 450, available=3), step('call', 0, 450, available=3),
            step('check', 0, available=1, street='turn')]
BIG_LINE = [step('check', 0, available=1), step('bet', 1, 900, available=3), step('call', 0, 900, available=3),
            step('check', 0, available=1, street='turn')]


def v3_round():
    barrel_mid = v3cell('turn', 'Bruc', 'x.b-mid.c/x')
    barrel_big = v3cell('turn', 'Bruc', 'x.b-big.c/x')
    overbet = v3cell('flop', 'Brud', 'x.b-big', role='facing_bet', hero='SB', opp='BB', facing='bet', size='big')
    donk = v3cell('flop', 'Brud', '', role='donk', hero='SB', opp='BB')
    return [entry(barrel_mid, MID_LINE), entry(barrel_big, BIG_LINE),
            entry(overbet, [step('check', 0, available=1), step('bet', 1, 900, available=3)], hero=0),
            entry(donk, [], construction='root', hero=0)]


def fresh(cluster, text):
    db, _legacy, _before = rp.fresh(cluster, rp.MIGRATION.read_text() + '\n' + text)
    return db


def v3_scenario(cluster, text):
    db = fresh(cluster, text)
    good = v3_round()
    reg = lambda key, entries, **o: rp.registration(key, 'horse-' + key, entries, **o)
    # -- refused: shape of the v3 cells (registration guard)
    v2_entry = rp.provenance(base.cell('turn', 'Bruc', role='barrel', hero='BB', opp='SB'), 'natural', MID_LINE, hero=1)
    base.register(db, reg('r901', [good[0], v2_entry]), refused='one registration is all v2 or all v3')
    for mutate, message in (
            (lambda c: c.update(cell_contract='v4'), 'cell_contract must be "v3"'),
            (lambda c: c.update(depth_bucket=300), 'depth_bucket is 10, 20, 40, 80, 150 or 200'),
            (lambda c: c.update(line_class='x.b-huge.c/x'), 'is malformed or names another street'),
            (lambda c: c.update(line_class='x.b-mid.c'), 'is malformed or names another street'),
            (lambda c: c.update(node_role='donk'), None),  # donk with none/none is coherent: checked below
            (lambda c: c.pop('line_class'), 'exactly the 13 V31 context keys, cell_contract and line_class'),
            (lambda c: c.update(street='preflop'), 'street is flop, turn or river')):
        e = json.loads(json.dumps(good[0]))
        mutate(e['cell'])
        e['runtime_mapping'] = rp.mapping(e['cell'], 1)
        if message is None:
            continue
        base.register(db, reg('r902', [e]), refused=message)
    bad_role = json.loads(json.dumps(good[2]))
    bad_role['cell'].update(node_role='donk')
    bad_role['runtime_mapping'] = rp.mapping(bad_role['cell'], 0)
    base.register(db, reg('r903', [bad_role]), refused='disagree')
    base.register(db, reg('r904', [good[0], good[0]]), refused='a cell repeats')
    # a v2 cell carrying a line but no contract is a 14-key cell: refused exactly as before
    stray = json.loads(json.dumps(v2_entry))
    stray['cell']['line_class'] = 'x'
    base.register(db, reg('r905', [stray]), refused='registered cells must be distinct V31 cell contexts with the 13 context keys')
    # -- refused: provenance of a v3 cell
    lying = json.loads(json.dumps(good[0]))
    lying['public_history'] = [step('check', 0, available=1), step('check', 1, available=2),
                               step('check', 0, available=1, street='turn')]
    base.register(db, reg('r906', [lying]), refused='does not name its public history')
    beyond = json.loads(json.dumps(good[0]))
    beyond['public_history'] = MID_LINE + [step('check', 1, available=2, street='river')]
    base.register(db, reg('r907', [beyond]), refused='does not name its public history')
    for mutate in (lambda m: m.pop('line_class'), lambda m: m.update(line_class='x.b-big.c/x'), lambda m: m.pop('cell_contract')):
        e = json.loads(json.dumps(good[0]))
        mutate(e['runtime_mapping'])
        base.register(db, reg('r908', [e]), refused='runtime_mapping must name exactly')
    base.register(db, reg('r909', [entry(good[0]['cell'], MID_LINE, effective_stack_chips=15000)]), refused='game assumptions')
    base.register(db, reg('r910', [entry(good[0]['cell'], MID_LINE, construction='forced')]), refused='"forced"')
    base.register(db, reg('r911', [entry(good[0]['cell'], MID_LINE, construction='root')]), refused='never root')
    # -- the provenance check repeats the v3 shape check on its own (defence in depth behind the guard)
    for mutate, message in ((lambda c: c.update(depth_bucket=300), 'depth_bucket is 10, 20, 40, 80, 150 or 200'),
                            (lambda c: c.update(line_class='x.b-mid.c'), 'is malformed or names another street')):
        e = json.loads(json.dumps(good[0]))
        mutate(e['cell'])
        e['runtime_mapping'] = rp.mapping(e['cell'], 1)
        got = db.sql(f"SELECT public.fn_gto_v31_cell_provenance_error({base.qj([e['cell']])}, {base.qj([e])})")
        assert message in got, got
    # -- accepted: the v3 round (200 bb, two flop sizes on one line, overbet facing, donk root)
    base.register(db, reg('r920', good))
    assert db.sql("SELECT count(*) FROM gto_v31_round_registrations WHERE round_key='r920'") == '1'
    # -- dormant: it can create its dataset, but never seal (runtime cells carry 13 keys and no line)
    ds = base.insert_dataset(db, 'horse-r920', [e['cell'] for e in good]).splitlines()[0]
    base.build_cells(db, ds, [{k: v for k, v in e['cell'].items() if k in base.KEYS} for e in good])
    base.seal(db, ds, refused='the held-out set is not consumed')
    assert db.sql(f"SELECT heldout_consumed_at IS NULL FROM gto_v31_round_registrations WHERE round_key='r920'") == 't'
    # grants: the new helper is owner only
    acl = db.sql("SELECT coalesce(proacl::text,'') FROM pg_proc WHERE proname='fn_gto_v31_cell_contract_v3_error'")
    assert acl == '{postgres=X/postgres}', acl


def insert_dataset_fc(db, key, declared, feature, refused=None):
    """base.insert_dataset, also declaring the dataset's feature contract."""
    bundle = db.sql("INSERT INTO gto_v31_input_bundles(bundle_key,bundle_checksum,range_bundle_checksum,"
                    "source_combo_order_checksum,icm_model_checksum,bundle_manifest) VALUES "
                    f"({base.q(key + '-b')},repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),'{{}}') "
                    "RETURNING input_bundle_id")
    return db.sql("INSERT INTO gto_v31_datasets(dataset_key,state,quality_status,solver_version,solver_binary_checksum,"
                  "pipeline_commit,pipeline_bundle_checksum,manifest_version,manifest_checksum,source_combo_order_checksum,"
                  "range_bundle_checksum,icm_model_checksum,input_bundle_id,input_bundle_checksum,machine_ids,"
                  "declared_coverage,quality_gates,feature_contract_version) VALUES "
                  f"({base.q(key)},'building','pending','pio-3',repeat('1',64),repeat('2',40),repeat('3',64),'m1',repeat('4',64),"
                  f"repeat('d',64),repeat('c',64),repeat('e',64),'{bundle.splitlines()[0]}',repeat('b',64),ARRAY['M1','M2'],"
                  f"{base.qj(declared)},{base.qj(base.GATES)},{'NULL' if feature is None else base.q(feature)}) RETURNING dataset_id",
                  refused=refused)


def coupling_scenario(db):
    """Review M1: feature contract holdem-public-hist215-v3 iff cell contract v3, at dataset insert."""
    reg = lambda key, entries: rp.registration(key, 'horse-' + key, entries)
    v2_entry = rp.provenance(base.cell('turn', 'Bruc', role='barrel', hero='BB', opp='SB'), 'natural', MID_LINE, hero=1)
    base.register(db, reg('r930', [v2_entry]))
    v2_cells = [v2_entry['cell']]
    # direction 1: old (line-less) cell keys cannot claim the v3 feature format
    insert_dataset_fc(db, 'horse-r930', v2_cells, 'holdem-public-hist215-v3',
                      refused='declares feature contract holdem-public-hist215-v3, which requires cell contract v3')
    # direction 2: v3 (line-keyed) cells cannot claim an older public215 feature format
    good = v3_round()
    base.register(db, reg('r931', good))
    v3_cells = [e['cell'] for e in good]
    for feature in ('holdem-public-hist215-v1', 'holdem-public-hist215-v2'):
        insert_dataset_fc(db, 'horse-r931', v3_cells, feature,
                          refused='registered cell contract v3 cells, which require feature contract holdem-public-hist215-v3')
    # the matched pairs pass the coupling (production's column CHECK still refuses hist215-v3 itself: dormant)
    insert_dataset_fc(db, 'horse-r930', v2_cells, 'holdem-public-hist215-v2')
    insert_dataset_fc(db, 'horse-r931', v3_cells, 'holdem-public-hist215-v3')
    for key in ('r930', 'r931'):
        assert db.sql(f"SELECT dataset_id IS NOT NULL FROM gto_v31_round_registrations WHERE round_key='{key}'") == 't'


# Review m3: the v2 refusals of the re-created functions, each exercised with a v2 registration.
THRESHOLDS = ('max_frequency_mae', 'max_sizing_mae', 'max_policy_ev_mae_bb', 'max_action_regret_bb', 'min_regret_coverage')


def guard_v2_body(db):
    entry = rp.provenance(base.cell('turn', 'Bruc', role='barrel', hero='BB', opp='SB'), 'natural', MID_LINE, hero=1)
    other = rp.provenance(base.cell('turn', 'Brpd', role='barrel', hero='BB', opp='SB'), 'natural', MID_LINE, hero=1)
    reg = lambda key, entries=(entry,), **o: rp.registration(key, 'horse-' + key, list(entries), **o)
    good = reg('r940')
    t = entry['cell']
    for cells in ([t, t], [{**t, 'street': 'preflop'}], [{k: v for k, v in t.items() if k != 'pot_type'}], [{**t, 'extra': 1}], ['x']):
        base.register(db, {**good, 'cells': cells}, refused='registered cells must be distinct V31 cell contexts with the 13 context keys')
    base.register(db, {**good, 'composition': {'flop': 1, 'turn': 0, 'river': 0}}, refused='is not the composition of the registered cells')
    base.register(db, {**good, 'cell_set_checksum': 'a' * 64}, refused='registered cell-set checksum does not hash the registered cells')
    for k in ('approved_by', 'approved_at', 'source', 'quote'):
        base.register(db, {**good, 'owner_authorization': {**good['owner_authorization'], k: ' '}}, refused='owner_authorization needs')
    for k in ('summary', 'changes', 'diagnosis'):
        base.register(db, {**good, 'candidate': {**good['candidate'], k: None}}, refused='candidate needs summary, changes and diagnosis')
    for k in ('plan_checksum', 'eligibility_checksum', 'pipeline_commit', 'board_recipe', 'ranges'):
        base.register(db, {**good, 'dataset_provenance': {**good['dataset_provenance'], k: None}}, refused='dataset_provenance needs')
    base.register(db, {**good, 'acceptance_criteria': {'quality_gates': {}}}, refused='acceptance_criteria.quality_gates must be valid')
    for k in THRESHOLDS:
        loose = {**base.GATES, k: 0.94 if k == 'min_regret_coverage' else 0.06}
        base.register(db, {**good, 'acceptance_criteria': {'quality_gates': loose}}, refused='may not loosen the V31 quality thresholds')
    for plan in ({'heldout_consumptions': 2, 'steps': ['x']}, {'heldout_consumptions': '1', 'steps': ['x']}, {'heldout_consumptions': 1}):
        base.register(db, {**good, 'evaluation_plan': plan}, refused='evaluation_plan must consume the held-out set exactly once')
    base.register(db, good)
    db.sql("INSERT INTO gto_v31_round_registrations(round_key,dataset_key,composition,cells,cell_set_checksum,owner_authorization,"
           "candidate,dataset_provenance,acceptance_criteria,evaluation_plan,cell_provenance,heldout_consumed_at) SELECT 'r941','horse-r941',"
           "composition,cells,cell_set_checksum,owner_authorization,candidate,dataset_provenance,acceptance_criteria,evaluation_plan,"
           "cell_provenance,now() FROM gto_v31_round_registrations WHERE round_key='r940'", refused='is registered before its dataset exists')
    db.sql("UPDATE gto_v31_round_registrations SET candidate='{}'::jsonb WHERE round_key='r940'", refused='is immutable')
    db.sql("DELETE FROM gto_v31_round_registrations WHERE round_key='r940'", refused='is permanent')
    # dataset insert (fn_gto_v31_dataset_matches_registration, v2 body)
    base.insert_dataset(db, 'horse-r949', [t], refused='has no round registration: register the round')
    base.insert_dataset(db, 'horse-r940', [other['cell']], refused='composition differs from its registration')
    base.insert_dataset(db, 'horse-r940', [t, t], refused='composition differs from its registration')
    base.insert_dataset(db, 'horse-r940', [t], gates={**base.GATES, 'max_sizing_mae': 0.04},
                        refused='quality gates differ from its registered acceptance criteria')
    base.insert_dataset(db, 'horse-r940', [t])
    insert_dataset_fc(db, 'horse-r940', [t], None, refused='already has its dataset')


def v2_corpus():
    """Registrations and provenance entries of the v2 contract, valid and mutated, plus v3-shaped strays."""
    flop = base.cell('flop', 'Brud', role='cbet', hero='BB', opp='SB')
    turn = base.cell('turn', 'Bruc', role='barrel', hero='BB', opp='SB')
    facing = base.cell('flop', 'Brud', role='facing_bet', hero='SB', opp='BB')
    facing.update(facing_kind='bet', facing_size_bucket='mid')
    entries = [rp.provenance(flop, 'root', [step('check', 0, available=1)]),
               rp.provenance(turn, 'natural', MID_LINE, hero=1),
               rp.provenance(facing, 'natural', [step('check', 0, available=1), step('bet', 1, 450, available=3)], hero=0)]
    mutations = [
        lambda e: None, lambda e: e.pop('game'), lambda e: e.update(range_construction='forced'),
        lambda e: e.update(range_construction='authored'), lambda e: e.update(range_construction='root'),
        lambda e: e['runtime_mapping'].update(node_role='open'), lambda e: e['runtime_mapping'].pop('street'),
        lambda e: e['runtime_mapping'].update(hero_solver_player=1 - e['runtime_mapping']['hero_solver_player']),
        lambda e: e['runtime_mapping'].update(line_class='x'), lambda e: e['runtime_mapping'].update(cell_contract='v3'),
        lambda e: e['game'].update(depth_bucket=150), lambda e: e['game'].update(effective_stack_chips=1),
        lambda e: e['game'].update(rake=[2, 0]), lambda e: e['game'].update(betting_tree_checksum='0' * 64),
        lambda e: e.update(public_history=[{'street': 'flop'}]), lambda e: e.update(upstream_solve_checksum='9' * 64),
        lambda e: e.update(unnarrowed_seats=[rp.pure('OOP')]), lambda e: e.update(public_history='x'),
        lambda e: e.update(public_history=e['public_history'] + [step('bet', 0, 10, available=1, street='turn')]),
        lambda e: e['cell'].update(line_class='x'), lambda e: e['cell'].update(cell_contract='v3'),
        lambda e: e['cell'].update(cell_contract='v3', line_class='x', depth_bucket=200),
    ]
    out = []
    for e in entries:
        for m in mutations:
            v = json.loads(json.dumps(e))
            try:
                m(v)
            except (KeyError, TypeError):
                continue
            out.append(v)
    return out


def differential(cluster, text):
    """The same calls on the pre-migration and post-migration functions give the same answers for v2 inputs."""
    old = fresh(cluster, '')
    new = fresh(cluster, text)
    compared = same = 0
    for e in v2_corpus():
        cells = [e['cell']] if isinstance(e.get('cell'), dict) else []
        sql = f"SELECT coalesce(public.fn_gto_v31_cell_provenance_error({base.qj(cells)}, {base.qj([e])}), '<null>')"
        a, b = old.sql(sql), new.sql(sql)
        compared += 1
        v3_shaped = 'cell_contract' in e.get('cell', {})
        if v3_shaped:
            # the old function refused a v3-shaped cell through its key checks; the new one may only refuse it too
            assert b != '<null>' or a != '<null>' or False, (e, a, b)
            assert b != '<null>', f'a v3-shaped stray was admitted: {e}'
            continue
        assert a == b, f'v2 provenance answer changed:\n{json.dumps(e)}\nold {a}\nnew {b}'
        same += 1
    for i, e in enumerate(v2_corpus()):
        if not isinstance(e.get('cell'), dict) or 'cell_contract' in e['cell']:
            continue
        value = rp.registration(f'r7{i:03d}', f'horse-d{i}', [e])
        results = []
        for db in (old, new):
            r = cluster.psql(db.name, ['-c', f"BEGIN; SELECT public.fn_gto_v31_register_round({base.qj(value)}); ROLLBACK;"])
            results.append((r.returncode, r.stderr.strip().splitlines()[0] if r.stderr.strip() else ''))
        assert results[0] == results[1], f'v2 registration outcome changed:\n{json.dumps(e)}\n{results}'
        compared += 1
        same += 1
    # malformed registration cell arrays (the guard's own v2 check)
    t = base.cell('turn', 'Bruc')
    for cells in ([], [t, t], [{**t, 'street': 'preflop'}], [{k: v for k, v in t.items() if k != 'pot_type'}],
                  [{**t, 'extra': 1}], ['x'], [{**t, 'line_class': 'x'}], [{**t, 'cell_contract': 'v3'}]):
        value = {**rp.registration('r699', 'horse-m', [rp.provenance(t, 'natural', [], hero=1)]), 'cells': cells}
        results = []
        for db in (old, new):
            r = cluster.psql(db.name, ['-c', f"BEGIN; SELECT public.fn_gto_v31_register_round({base.qj(value)}); ROLLBACK;"])
            results.append((r.returncode, r.stderr.strip().splitlines()[0] if r.stderr.strip() else ''))
        if any(isinstance(c, dict) and 'cell_contract' in c for c in cells):
            assert results[1][0] != 0, f'a v3-shaped stray registration was admitted: {cells}'
        else:
            assert results[0] == results[1], f'v2 guard outcome changed for {cells}: {results}'
            same += 1
        compared += 1
    return compared, same


def scenario(cluster, text):
    rp.scenario(cluster, rp.MIGRATION.read_text() + '\n' + text)  # every v2 check of the range-provenance proof
    v3_scenario(cluster, text)
    db = fresh(cluster, text)
    coupling_scenario(db)
    guard_v2_body(db)


# Registration-time v2 mutations of test-v31-range-provenance.py and test-v31-round-registration.py whose code
# this migration re-creates (fn_gto_v31_cell_provenance_error, the registration guard, the dataset-insert check):
# applied to this migration's copy, each must still be detected. An anchor this migration does not contain names
# a function it does not re-create and is skipped (counted and printed).
V2_MUTATIONS = [('range-provenance: ' + n, o, w) for n, o, w in rp.MUTATIONS] + \
               [('round-registration: ' + n, o, w) for n, o, w in base.MUTATIONS]
V2_ANCHORS = {name for name, _, _ in V2_MUTATIONS}

# Review m3: each v2 refusal of the re-created guard and dataset-insert check, disabled one at a time (its RAISE
# EXCEPTION becomes a RAISE DEBUG with the same arguments, which psql does not print; a threshold floor line is removed).
V2_BODY_RAISES = [
    "RAISE EXCEPTION 'a V31 round registration is permanent'",
    "RAISE EXCEPTION 'a V31 round registration is immutable;",
    "RAISE EXCEPTION 'a V31 round is registered before its dataset exists'",
    "RAISE EXCEPTION 'registered cells must be distinct V31 cell contexts with the 13 context keys'",
    "RAISE EXCEPTION 'registered composition % is not the composition",
    "RAISE EXCEPTION 'registered cell-set checksum does not hash",
    "RAISE EXCEPTION 'owner_authorization needs",
    "RAISE EXCEPTION 'candidate needs",
    "RAISE EXCEPTION 'dataset_provenance needs",
    "RAISE EXCEPTION 'acceptance_criteria.quality_gates must be valid",
    "RAISE EXCEPTION 'a registration may not loosen",
    "RAISE EXCEPTION 'evaluation_plan must consume",
    "RAISE EXCEPTION 'V31 dataset % has no round registration: register",
    "RAISE EXCEPTION 'V31 round % already has its dataset",
    "RAISE EXCEPTION 'V31 round % composition differs",
    "RAISE EXCEPTION 'V31 round % quality gates differ",
]
V2_BODY_MUTATIONS = [('v2 body: ' + r.split("'")[1][:60], r, r.replace('RAISE EXCEPTION', 'RAISE DEBUG')) for r in V2_BODY_RAISES]
V2_BODY_MUTATIONS += [
    ('v2 body: threshold floor ' + k + ' removed',
     (f"  IF (NEW.acceptance_criteria#>>'{{quality_gates,{k}}}')::numeric > 0.05\n     OR" if k == THRESHOLDS[0]
      else f"     OR (NEW.acceptance_criteria#>>'{{quality_gates,{k}}}')::numeric {'<' if k == 'min_regret_coverage' else '>'} {'0.95' if k == 'min_regret_coverage' else '0.05'}"),
     ("  IF" if k == THRESHOLDS[0] else ''))
    for k in THRESHOLDS]

MUTATIONS = [
    ('v3 key set not checked', "     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_cell) k) IS DISTINCT FROM\n        ARRAY['cell_contract',",
     "     OR false AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_cell) k) IS DISTINCT FROM\n        ARRAY['cell_contract',"),
    ('unknown v3 contract accepted', "  IF p_cell->'cell_contract' IS DISTINCT FROM '\"v3\"'::jsonb THEN", "  IF false THEN"),
    ('depth 300 accepted', "NOT IN ('10','20','40','80','150','200') THEN", "NOT IN ('10','20','40','80','150','200','300') THEN"),
    ('malformed line accepted', "     OR p_cell->>'line_class' !~ '^((x|c|a|", "     OR false AND p_cell->>'line_class' !~ '^((x|c|a|"),
    ('line street not checked', "     OR length(p_cell->>'line_class') - length(replace(p_cell->>'line_class', '/', '')) <> v_street - 1 THEN",
     "     OR false THEN"),
    ('role and facing not checked', "  IF NOT ((v_role IN ('open','cbet','probe','delayed_cbet','barrel','donk') AND v_kind = 'none' AND v_bucket = 'none')",
     "  IF false AND NOT ((v_role IN ('open','cbet','probe','delayed_cbet','barrel','donk') AND v_kind = 'none' AND v_bucket = 'none')"),
    ('guard admits any v3 shape', "     WHERE public.fn_gto_v31_cell_contract_v3_error(e) IS NOT NULL LIMIT 1;", "     WHERE false LIMIT 1;"),
    ('guard admits a repeated v3 cell', "    IF k IS NOT NULL\n       OR (SELECT count(DISTINCT public.fn_gto_v31_public215_canonical(e))",
     "    IF k IS NOT NULL\n       OR false AND (SELECT count(DISTINCT public.fn_gto_v31_public215_canonical(e))"),
    ('line not compared with the history', "      IF v_line IS DISTINCT FROM regexp_replace(", "      IF false AND v_line IS DISTINCT FROM regexp_replace("),
    ('history beyond the cell street ignored', "         OR (SELECT count(*) FROM jsonb_array_elements(e->'public_history') h\n              WHERE array_position",
     "         OR false AND (SELECT count(*) FROM jsonb_array_elements(e->'public_history') h\n              WHERE array_position"),
    ('v3 mapping need not name the line', "                          'hero_solver_player','line_class','node_role','objective','opponent_position','pot_type',",
     "                          'hero_solver_player','node_role','objective','opponent_position','pot_type',"),
    ('provenance skips the v3 shape check', "      IF public.fn_gto_v31_cell_contract_v3_error(e->'cell') IS NOT NULL THEN", "      IF false THEN"),
    ('coupling: v2 cells may declare hist215-v3', "  IF NEW.feature_contract_version = 'holdem-public-hist215-v3'\n", "  IF false AND NEW.feature_contract_version = 'holdem-public-hist215-v3'\n"),
    ('coupling: v3 cells may declare hist215-v1 or v2', "  IF NEW.feature_contract_version IN ('holdem-public-hist215-v1','holdem-public-hist215-v2')\n",
     "  IF false AND NEW.feature_contract_version IN ('holdem-public-hist215-v1','holdem-public-hist215-v2')\n"),
]


def main():
    text = MIGRATION.read_text()
    assert text.count('BEGIN;') == 1 and text.rstrip().endswith('COMMIT;'), 'migration must be one BEGIN/COMMIT transaction'
    cluster = base.Cluster()
    try:
        scenario(cluster, text)
        compared, same = differential(cluster, text)
        print(f'native proof: passed (v2 differential: {compared} calls compared, {same} v2 answers identical)')
        if '--mutations' in sys.argv:
            detected = skipped = 0
            for name, old, new in MUTATIONS + V2_BODY_MUTATIONS + V2_MUTATIONS:
                if name in V2_ANCHORS and text.count(old) != 1:
                    skipped += 1  # this v2 check lives in a function this migration does not re-create
                    continue
                assert text.count(old) == 1, f'mutation anchor not unique: {name}'
                try:
                    scenario(cluster, text.replace(old, new))
                except AssertionError:
                    print(f'mutation detected: {name}')
                    detected += 1
                    continue
                raise SystemExit(f'MUTATION NOT DETECTED: {name}')
            print(f'{detected} of {detected} mutations detected ({skipped} v2 anchors name functions this migration does not re-create)')
    finally:
        cluster.stop()


if __name__ == '__main__':
    main()
