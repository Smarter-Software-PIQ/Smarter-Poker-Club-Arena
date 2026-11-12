#!/usr/bin/env python3
"""Native proof: a registered V31 cell declares its range provenance and the data must agree.

Runs migration 20261112185251 on top of 20261110213931 (the round registration
it extends) against a throwaway PostgreSQL 17 cluster (never production), on
the contract v3 fixture schema. The cluster, database and registration helpers
are the ones of test-v31-round-registration.py. Proves:

  refused at registration
    * missing provenance (key absent, null, or one cell without an entry)
    * unknown range_construction, and 'forced'
    * 'root' declared after a decision that had more than one available action
    * a bet/call declared as a one-action step; a subgame without its upstream
      solve; game assumptions that disagree with the cell
    * a runtime mapping that is not the cell's own key components, or whose
      acting seat / seat positions disagree with the cell or the history
    * an unnarrowed seat that made no real decision, on a root cell, or malformed
  refused at dataset insert
    * the registered betting tree is not the dataset manifest
  refused at source ingest (first point the solved data exists)
    * the node was solved after another public history, with another rake, on
      another tree, stack or acting seat, or carries no exact node ranges
  refused at seal (held-out set not consumed)
    * declared 'natural' but both ranges are unnarrowed root ranges on every
      source board (the R8 pattern); the same for a 'subgame'
    * the same with per-combo drift of +/-0.9e-6 on every forced board (the
      pipeline's own validate_conditional_support tolerance)
    * 64 forced boards and 1 natural board, the natural one ingested first
    * declared 'root' but the ranges are narrowed
    * a seat declared unnarrowed (pure prior action) whose data is narrowed
    * a runtime mapping that names no runtime cell the dataset built
    * a cell with one source board; a source node without range evidence
  accepted
    * 'root' (first flop decision behind a one-action check), 'natural' with
      earlier decisions and genuinely narrowed ranges, 'subgame' with earlier
      history, in one round that seals and consumes its held-out set once
    * a seat declared unnarrowed by a pure prior action whose data is
      unnarrowed on every board (attestation recorded)
  history
    * dataset rows that existed before the migration, a rejected one
      included, are byte-identical after it; their ingest is not inspected
      and they still cannot be sealed without a registration

`--mutations` re-runs the scenario against deliberately weakened copies of the
migration and requires each one to be detected.
"""
import importlib.util
import itertools
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('round_registration', ROOT / 'scripts/ci/test-v31-round-registration.py')
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)

MIGRATION = ROOT / 'supabase/migrations/20261112185251_v31_a_registered_cell_declares_its_range_provenance_and_the_.sql'
GOLD = ROOT / 'scripts/ci/fixtures/v31-range-provenance/00-solved-spots-gold.sql'
TREE = '4' * 64  # insert_dataset's manifest_checksum
RANKS, SUITS = '23456789TJQKA', 'cdhs'
POSITIONS = ['SB', 'BB']  # solver seat 0 (OOP), seat 1 (IP)
q, qj = base.q, base.qj


def card_id(card):
    return RANKS.index(card[0]) * 4 + SUITS.index(card[1])


def combos():
    return [(a, b) for b in range(1, 52) for a in range(b)]  # index = b*(b-1)/2 + a


def root_range(seed):
    """An authored root range: fractional weights, about a third of the combos absent."""
    out = []
    for i, _ in enumerate(combos()):
        v = (i * 2654435761 + seed * 40503) % 1000
        out.append(0.0 if v < 330 else round(0.05 + (v % 97) / 100.0, 4))
    return out


def salt_of(board):
    return sum(ord(ch) * (k + 1) for k, ch in enumerate(board)) % 977 + 1


def on_board(vector, board, scale=1.0, narrow=None, drift=0.0):
    """The range at a node on `board`: blocked combos absent; `narrow` is a board-specific reach factor;
    `drift` moves every live combo but the first by +/-drift relative (validate_conditional_support admits 1e-6)."""
    dead = {card_id(board[i:i + 2]) for i in range(0, len(board), 2)}
    out, first = [], None
    for i, (a, b) in enumerate(combos()):
        if a in dead or b in dead:
            out.append(0.0)
            continue
        w = vector[i] * scale
        if narrow is not None:
            w *= ((i * 7919 + narrow * 104729) % 89) / 88.0
        if drift and w > 0:
            if first is None:
                first = i
            else:
                w *= 1 + drift * (1 if (i * 31 + salt_of(board)) % 2 else -1)
        out.append(w)
    return out


OOP_ROOT, IP_ROOT = root_range(1), root_range(2)
BOARDS = ['2s4s3h', '7c8dKh', 'AcTd5s', '9h9d2c']
DECK = [r + s for r in '2468TQA' for s in SUITS[:2]]  # 14 cards: 364 distinct flops, the first 65 used
MANY_BOARDS = [''.join(c) for c in itertools.combinations(DECK, 3)][:65]


def step(family, player, target=0, available=2, street='flop'):
    return {'street': street, 'position': POSITIONS[player], 'solver_player': player, 'family': family,
            'target_chips': target, 'available_actions': available}


def mapping(cell, hero):
    value = {k: v for k, v in cell.items() if k != 'texture_class'}
    value.update(hero_solver_player=hero, solver_positions=list(POSITIONS))
    return value


def pure(seat):
    return {'seat': seat, 'reason': 'pure_prior_action', 'upstream_evidence_checksum': '8' * 64}


def provenance(cell, construction, history, hero=1, upstream=None, unnarrowed=(), **game):
    value = {'cell': cell, 'range_construction': construction, 'public_history': history,
             'upstream_solve_checksum': upstream, 'unnarrowed_seats': list(unnarrowed),
             'game': {'variant': 'nlh', 'players_to_flop': 2, 'pot_type': cell['pot_type'],
                      'depth_bucket': cell['depth_bucket'], 'chips_per_bb': 100, 'effective_stack_chips': 8000,
                      'root_pot_chips': 650, 'rake': [0, 0], 'betting_tree_checksum': TREE},
             'runtime_mapping': mapping(cell, hero)}
    value['game'].update(game)
    return value


def registration(round_key, dataset_key, entries, **override):
    cells = [e['cell'] for e in entries]
    return base.registration(round_key, dataset_key, cells, **{'cell_provenance': entries, **override})


def node(cell, entry, board, oop, ip, **override):
    history = [{k: v for k, v in s.items() if k != 'available_actions'} for s in entry['public_history']]
    value = {
        'schema': 'smarter-poker.pio-policy.v4', 'node': 'r:0:' + board,
        'node_context': {**cell, 'board': board, 'facing_target_chips': None, 'facing_actor_total_chips': None},
        'line_proof': {'schema': 'smarter-poker.pio-line-proof.v1', 'chips_per_bb': 100, 'root_pot_chips': 650,
                       'manifest_checksum': TREE, 'hero_solver_player': entry['runtime_mapping']['hero_solver_player'],
                       'effective_stack_chips': 8000, 'preflop_aggressor_solver_player': 0},
        'complete_public_state': {'public_history': history, 'utility': {'rake': [0, 0]}},
        'solver_ranges': {'schema': 'smarter-poker.pio-exact-node-ranges.v1', 'OOP': oop, 'IP': ip},
    }
    for path, replacement in override.items():
        target = value
        keys = path.split('.')
        for key in keys[:-1]:
            target = target[key]
        if replacement is None and keys[-1] == 'solver_ranges':
            del target[keys[-1]]
        else:
            target[keys[-1]] = replacement
    return value


def ingest(db, ds, nodes, refused=None, bypass=False):
    """What both live ingest functions do in one transaction: the gold row, then the source-artifact row."""
    row = str(uuid.uuid4())
    replica = "SET LOCAL session_replication_role=replica; " if bypass else ''
    return db.sql(f"BEGIN; {replica}INSERT INTO solved_spots_gold(id,strategy_matrix_v2) VALUES ('{row}',"
                  f"{qj({'schema': 'smarter-poker.pio-artifact.v31.1', 'nodes': nodes})}); "
                  "INSERT INTO gto_v31_source_artifacts(dataset_id,source_row_id,source_artifact_checksum,node_count) "
                  f"VALUES ('{ds}','{row}',repeat('a',64),{len(nodes)}); COMMIT;", refused=refused)


def forced(cell, entry, board, drift=0.0, **override):
    """Forced-line signature: both players keep the root range (a per-board constant apart)."""
    k = 1.0 + (salt_of(board) % 8) * 0.125
    return node(cell, entry, board, on_board(OOP_ROOT, board, scale=1 / k, drift=drift),
                on_board(IP_ROOT, board, scale=1 / k, drift=drift), **override)


def noisy_forced(cell, entry, board):
    """Forced boards carrying the per-combo drift validate_conditional_support admits (+/-0.9e-6)."""
    return forced(cell, entry, board, drift=0.9e-6)


def narrowed(cell, entry, board, seats=(0, 1), **override):
    """Action-conditioned: the named seats' reach depends on the board; the other seat keeps its root range."""
    salt = salt_of(board)
    return node(cell, entry, board,
                on_board(OOP_ROOT, board, narrow=salt if 0 in seats else None),
                on_board(IP_ROOT, board, narrow=salt + 50 if 1 in seats else None), **override)


def consumed(db, round_key):
    return db.sql(f"SELECT heldout_consumed_at IS NOT NULL FROM gto_v31_round_registrations WHERE round_key='{round_key}'")


LEGACY_SNAPSHOT = ("SELECT md5(string_agg(d::text, '|' ORDER BY d.dataset_key)) || ':' || count(*) "
                   "FROM gto_v31_datasets d WHERE d.dataset_key LIKE 'horse-legacy%'")


def legacy(db):
    """Datasets as they exist in production today: created before either guard, one of them rejected."""
    bundle = db.sql("INSERT INTO gto_v31_input_bundles(bundle_key,bundle_checksum,range_bundle_checksum,"
                    "source_combo_order_checksum,icm_model_checksum,bundle_manifest) VALUES "
                    "('legacy-b',repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),'{}') RETURNING input_bundle_id").splitlines()[0]
    ids = {}
    for key, state, sealed in (('horse-legacy-r8-rejected', 'rejected', 'now()'), ('horse-legacy-building', 'building', 'NULL')):
        out = db.sql("BEGIN; SET LOCAL session_replication_role=replica; INSERT INTO gto_v31_datasets(dataset_key,state,quality_status,"
                     "solver_version,solver_binary_checksum,pipeline_commit,pipeline_bundle_checksum,manifest_version,manifest_checksum,"
                     "source_combo_order_checksum,range_bundle_checksum,icm_model_checksum,input_bundle_id,input_bundle_checksum,"
                     f"machine_ids,declared_coverage,quality_gates,sealed_at) VALUES ({q(key)},{q(state)},{q(state)},'pio-3',repeat('1',64),"
                     "repeat('2',40),repeat('3',64),'m1',repeat('4',64),repeat('d',64),repeat('c',64),repeat('e',64),"
                     f"'{bundle}',repeat('b',64),ARRAY['M1','M2'],{qj([base.cell('turn', 'Legacy')])},{qj(base.GATES)},{sealed}) "
                     "RETURNING dataset_id; COMMIT;")
        ids[key] = [l for l in out.splitlines() if len(l) == 36][0]
    return ids


def fresh(cluster, migration_text):
    """Schema, the registration migration, legacy rows, then this migration; history must not move."""
    db = cluster.fresh(base.MIGRATION.read_text())
    db.file(GOLD)
    ids = legacy(db)
    before = db.sql(LEGACY_SNAPSHOT)
    path = cluster.scratch / f'{db.name}-range.sql'
    path.write_text(migration_text)
    db.file(path)
    assert db.sql(LEGACY_SNAPSHOT) == before and before.endswith(':2'), 'the migration changed an existing dataset row'
    assert db.sql("SELECT state||'/'||quality_status FROM gto_v31_datasets WHERE dataset_key='horse-legacy-r8-rejected'") == 'rejected/rejected'
    return db, ids, before


def scenario(cluster, migration_text):
    db, legacy_ids, before = fresh(cluster, migration_text)
    flop = base.cell('flop', 'Brud', role='cbet', hero='BB', opp='SB')
    turn = base.cell('turn', 'Bruc', role='barrel')
    river = base.cell('river', 'Arpd', role='probe', hero='BB', opp='SB')
    facing = base.cell('flop', 'Brud', role='facing_bet')
    one_action_check = [step('check', 0, available=1)]
    bet_call = [step('check', 0, available=1), step('bet', 1, 214), step('call', 0, 214)]
    good = [provenance(flop, 'root', one_action_check, hero=1),
            provenance(turn, 'natural', bet_call, hero=0),
            provenance(river, 'subgame', bet_call, hero=1, upstream='9' * 64)]

    # -- registration: missing, malformed, unknown, forced, root after a real decision
    plain = base.registration('r20', 'horse-r20', [flop])
    base.register(db, plain, refused='has exactly round_key')
    base.register(db, {**plain, 'cell_provenance': None}, refused='range provenance is missing')
    base.register(db, registration('r20', 'horse-r20', good, cell_provenance=good[:2]),
                  refused='range provenance is missing for a registered cell')
    base.register(db, registration('r20', 'horse-r20', good, cell_provenance=good[:2] + [good[1]]),
                  refused='range provenance is missing for a registered cell')
    base.register(db, registration('r20', 'horse-r20', [provenance(turn, 'authored', bet_call, hero=0)]),
                  refused='unknown range_construction authored')
    no_field = provenance(turn, 'natural', bet_call, hero=0)
    del no_field['range_construction']
    base.register(db, registration('r20', 'horse-r20', [no_field]), refused='must have exactly cell, range_construction')
    err = base.register(db, registration('r20', 'horse-r20', [provenance(turn, 'forced', bet_call, hero=0)]),
                        refused='declares range_construction "forced"')
    assert 'can never be registered' in err, err
    base.register(db, registration('r20', 'horse-r20', [provenance(turn, 'root', bet_call, hero=0)]),
                  refused='declares range_construction "root" after 2 earlier decision(s)')
    base.register(db, registration('r20', 'horse-r20', [provenance(turn, 'root', [step('check', 0), step('check', 1)], hero=0)]),
                  refused='declares range_construction "root" after 2 earlier decision(s)')
    base.register(db, registration('r20', 'horse-r20', [provenance(turn, 'root', [step('check', 0, available=1),
                                                                                    step('bet', 1, 214, available=1)], hero=0)]),
                  refused='declares a bet as a one-action step')
    base.register(db, registration('r20', 'horse-r20', [provenance(river, 'subgame', bet_call)]),
                  refused='must name the upstream solve')
    base.register(db, registration('r20', 'horse-r20', [provenance(turn, 'natural', bet_call, hero=0, upstream='9' * 64)]),
                  refused='may not name an upstream solve')
    for bad in ({'pot_type': '3bet'}, {'players_to_flop': 3}, {'variant': 'plo'}, {'rake': [0.05]}, {'rake': None},
                {'betting_tree_checksum': 'unknown'}, {'effective_stack_chips': 10000}):
        base.register(db, registration('r20', 'horse-r20', [provenance(turn, 'natural', bet_call, hero=0, **bad)]),
                      refused='game assumptions are missing or disagree with the cell')
    # runtime mapping: the cell's own components, a seat that sits at the hero position, history seats that agree
    other_key = provenance(turn, 'natural', bet_call, hero=0)
    other_key['runtime_mapping'] = mapping(flop, 0)
    base.register(db, registration('r20', 'horse-r20', [other_key]), refused='runtime_mapping must name exactly the registered cell')
    old_shape = provenance(turn, 'natural', bet_call, hero=0)
    old_shape['runtime_mapping'] = {'cell_key': turn, 'hero_solver_player': 0}
    base.register(db, registration('r20', 'horse-r20', [old_shape]), refused='runtime_mapping must name exactly the registered cell')
    base.register(db, registration('r20', 'horse-r20', [provenance(turn, 'natural', bet_call, hero=1)]),
                  refused='runtime_mapping seat disagrees with the cell: solver seat 1 sits at BB')
    swapped = provenance(turn, 'natural', [step('check', 0, available=1), {**step('bet', 1, 214), 'position': 'SB'}], hero=0)
    base.register(db, registration('r20', 'horse-r20', [swapped]), refused="disagrees with the runtime mapping's seat positions")
    malformed = provenance(turn, 'natural', bet_call, hero=0)
    malformed['public_history'] = [{'family': 'bet'}]
    base.register(db, registration('r20', 'horse-r20', [malformed]), refused='public_history step is malformed')
    # unnarrowed seats: only a seat that made a real decision, never on a root cell, well formed
    base.register(db, registration('r20', 'horse-r20', [provenance(facing, 'natural', [step('check', 0, available=1), step('bet', 1, 214)],
                                                                   hero=0, unnarrowed=[pure('OOP')])]),
                  refused='declares OOP unnarrowed by a pure prior action, but OOP made no earlier decision')
    base.register(db, registration('r20', 'horse-r20', [provenance(flop, 'root', one_action_check, unnarrowed=[pure('OOP')])]),
                  refused='is root: no seat has decided')
    base.register(db, registration('r20', 'horse-r20', [provenance(turn, 'natural', bet_call, hero=0,
                                                                   unnarrowed=[{**pure('IP'), 'reason': 'assumed'}])]),
                  refused='unnarrowed seat is malformed')
    no_list = provenance(turn, 'natural', bet_call, hero=0)
    del no_list['unnarrowed_seats']
    base.register(db, registration('r20', 'horse-r20', [no_list]), refused='must have exactly cell, range_construction')
    assert db.sql("SELECT count(*) FROM gto_v31_round_registrations") == '0'

    # -- accepted: root + natural + subgame in one round, sealed once
    base.register(db, registration('r20', 'horse-r20', good))
    ds = base.insert_dataset(db, 'horse-r20', [flop, turn, river]).splitlines()[0]
    for board in BOARDS:
        ingest(db, ds, [forced(flop, good[0], board)])                    # nobody has chosen yet: root ranges
        ingest(db, ds, [narrowed(turn, good[1], board)])                  # both seats decided: both narrowed
        ingest(db, ds, [narrowed(river, good[2], board)])                 # inputs are an upstream solve's narrowed ranges
    groups = db.sql(f"SELECT cell_key ~ 'cbet', count(DISTINCT oop_group), count(DISTINCT ip_group), count(*) "
                    f"FROM gto_v31_range_evidence WHERE dataset_id='{ds}' GROUP BY 1 ORDER BY 1 DESC")
    assert groups.splitlines() == ['t|1|1|4', 'f|8|8|8'], groups
    db.sql(f"UPDATE gto_v31_range_evidence SET oop_group=ip_group WHERE dataset_id='{ds}'", refused='append-only')
    base.build_cells(db, ds, [flop, turn, river])
    base.seal(db, ds)
    assert consumed(db, 'r20') == 't'

    def one_cell_round(n, entry, make, boards=BOARDS, seal_refused=None, built=None):
        cell = entry['cell']
        base.register(db, registration(f'r{n}', f'horse-r{n}', [entry]))
        ds_n = base.insert_dataset(db, f'horse-r{n}', [cell]).splitlines()[0]
        for board in boards:
            ingest(db, ds_n, [make(cell, entry, board)])
        base.build_cells(db, ds_n, [built or cell])
        out = base.seal(db, ds_n, refused=seal_refused)
        assert consumed(db, f'r{n}') == ('f' if seal_refused else 't'), f'r{n} held-out consumption'
        return out, ds_n

    # -- seal: the R8 pattern. Declared natural (and subgame) after bets and calls, data is the unnarrowed root range
    err, _ = one_cell_round(21, provenance(turn, 'natural', bet_call, hero=0), forced, seal_refused='forced-line signature')
    assert 'declared "natural" after a real decision by OOP' in err and 'on 4 of 4 source boards (share 1.0000' in err, err
    one_cell_round(22, provenance(river, 'subgame', bet_call, hero=1, upstream='9' * 64), forced, seal_refused='forced-line signature')
    # the same with the per-combo drift the pipeline's own tolerance admits on every forced board
    err, _ = one_cell_round(31, provenance(turn, 'natural', bet_call, hero=0), noisy_forced, seal_refused='forced-line signature')
    assert 'share 1.0000' in err, err
    # one natural board (ingested first) among 64 forced ones does not hide the forced line
    first_natural = lambda c, e, b: narrowed(c, e, b) if b == MANY_BOARDS[0] else forced(c, e, b)
    err, _ = one_cell_round(32, provenance(turn, 'natural', bet_call, hero=0), first_natural, boards=MANY_BOARDS,
                            seal_refused='forced-line signature')
    assert 'on 64 of 65 source boards (share 0.9846' in err, err
    # only the seat that never chose keeps its root range: legitimate, accepted
    ip_only = [step('check', 0, available=1), step('bet', 1, 214)]
    one_cell_round(23, provenance(facing, 'natural', ip_only, hero=0), lambda c, e, b: narrowed(c, e, b, seats=(1,)))
    # the seat that did choose keeps it: refused, naming that seat
    err, _ = one_cell_round(24, provenance(facing, 'natural', ip_only, hero=0),
                            lambda c, e, b: narrowed(c, e, b, seats=(0,)), seal_refused='forced-line signature')
    assert 'real decision by IP' in err, err
    # a pure prior action, declared: OOP checked with every hand (two actions available), data unnarrowed -> accepted
    oop_pure = [step('check', 0, available=2), step('bet', 1, 214)]
    _, ds33 = one_cell_round(33, provenance(facing, 'natural', oop_pure, hero=0, unnarrowed=[pure('OOP')]),
                             lambda c, e, b: narrowed(c, e, b, seats=(1,)))
    attested = db.sql(f"SELECT attested_seat||'/'||attested_reason||'/'||rescale_share FROM gto_v31_range_evidence "
                      f"WHERE dataset_id='{ds33}' AND kind='unnarrowed_attestation'")
    assert attested == 'OOP/pure_prior_action/1.0000', attested
    # the same data without the declaration is the forced-line signature
    one_cell_round(35, provenance(facing, 'natural', oop_pure, hero=0), lambda c, e, b: narrowed(c, e, b, seats=(1,)),
                   seal_refused='forced-line signature')
    # declared pure, but the data narrowed: refused
    one_cell_round(34, provenance(facing, 'natural', oop_pure, hero=0, unnarrowed=[pure('OOP')]), narrowed,
                   seal_refused='OOP is declared unnarrowed by a pure prior action, but only')
    # -- seal: declared root, data narrowed
    one_cell_round(25, provenance(flop, 'root', one_action_check, hero=1), lambda c, e, b: narrowed(c, e, b, seats=(1,)),
                   seal_refused='declared "root" but its source nodes carry narrowed ranges')
    # -- seal: one source board cannot be verified
    one_cell_round(26, provenance(turn, 'natural', bet_call, hero=0), narrowed, boards=BOARDS[:1],
                   seal_refused='cannot be verified on fewer than two source boards')
    # -- seal: the runtime mapping must name a runtime cell this dataset built
    one_cell_round(36, provenance(turn, 'natural', bet_call, hero=0), narrowed,
                   built={**turn, 'hero_position': 'BB', 'opponent_position': 'SB'},
                   seal_refused='runtime mapping names no runtime cell of this dataset')

    # -- seal: a source node that reached the dataset around the evidence trigger
    entry = provenance(turn, 'natural', bet_call, hero=0)
    base.register(db, registration('r27', 'horse-r27', [entry]))
    ds27 = base.insert_dataset(db, 'horse-r27', [turn]).splitlines()[0]
    for board in BOARDS[:3]:
        ingest(db, ds27, [narrowed(turn, entry, board)])
    ingest(db, ds27, [narrowed(turn, entry, BOARDS[3])], bypass=True)
    base.build_cells(db, ds27, [turn])
    base.seal(db, ds27, refused='range evidence is incomplete at seal: 4 source nodes ingested, 3 with range evidence')

    # -- dataset insert: the registered tree is not the dataset manifest
    base.register(db, registration('r28', 'horse-r28', [provenance(turn, 'natural', bet_call, hero=0, betting_tree_checksum='7' * 64)]))
    base.insert_dataset(db, 'horse-r28', [turn], refused='registered betting tree 777777777777 but the dataset manifest is 444444444444')

    # -- source ingest: history, rake, tree, stack, root pot, seat, missing exact ranges
    entry = provenance(turn, 'natural', bet_call, hero=0, rake=[0.05, 250])
    base.register(db, registration('r29', 'horse-r29', [entry]))
    ds29 = base.insert_dataset(db, 'horse-r29', [turn]).splitlines()[0]
    raked = {'complete_public_state.utility': {'rake': [0.05, 250]}}
    ingest(db, ds29, [narrowed(turn, entry, BOARDS[0])], refused='was solved with rake [0, 0] but the registration declares rake [0.05, 250]')
    ingest(db, ds29, [narrowed(turn, entry, BOARDS[0], **raked, **{'complete_public_state.public_history': []})],
           refused='was solved after public history [] but the registration declares')
    other_size = [{k: v for k, v in s.items() if k != 'available_actions'} for s in bet_call]
    other_size[1] = {**other_size[1], 'target_chips': 488}
    ingest(db, ds29, [narrowed(turn, entry, BOARDS[0], **raked, **{'complete_public_state.public_history': other_size})],
           refused='was solved after public history')
    ingest(db, ds29, [narrowed(turn, entry, BOARDS[0], **raked, **{'line_proof.manifest_checksum': '7' * 64})],
           refused='was solved on betting tree 777777777777')
    ingest(db, ds29, [narrowed(turn, entry, BOARDS[0], **raked, **{'line_proof.hero_solver_player': 1})],
           refused='acting seat')
    for path, value in (('line_proof.effective_stack_chips', 10000), ('line_proof.root_pot_chips', 700),
                        ('line_proof.chips_per_bb', 50)):
        ingest(db, ds29, [narrowed(turn, entry, BOARDS[0], **raked, **{path: value})],
               refused='stack, root pot, chip unit or acting seat')
    ingest(db, ds29, [narrowed(turn, entry, BOARDS[0], **raked, solver_ranges=None)], refused='carries no exact node ranges')
    assert db.sql(f"SELECT count(*) FROM gto_v31_source_artifacts WHERE dataset_id='{ds29}'") == '0'
    for board in BOARDS:
        ingest(db, ds29, [narrowed(turn, entry, board, **raked)])
    base.build_cells(db, ds29, [turn])
    base.seal(db, ds29)

    # -- history: legacy datasets are not inspected, not modified, and still cannot be sealed
    ingest(db, legacy_ids['horse-legacy-building'], [forced(turn, good[1], BOARDS[0])])
    assert db.sql(f"SELECT count(*) FROM gto_v31_range_evidence WHERE dataset_id='{legacy_ids['horse-legacy-building']}'") == '0'
    base.seal(db, legacy_ids['horse-legacy-building'], refused='has no round registration and cannot consume a held-out set')
    assert db.sql(LEGACY_SNAPSHOT) == before, 'a legacy dataset row changed'
    # a direct insert without the column (not the RPC) is refused by the same trigger
    db.sql("INSERT INTO gto_v31_round_registrations(round_key,dataset_key,composition,cells,cell_set_checksum,"
           "owner_authorization,candidate,dataset_provenance,acceptance_criteria,evaluation_plan) "
           "SELECT 'r30','horse-r30',composition,cells,cell_set_checksum,owner_authorization,candidate,dataset_provenance,"
           "acceptance_criteria,evaluation_plan FROM gto_v31_round_registrations WHERE round_key='r29'",
           refused='range provenance is missing')
    # a registration that somehow has no provenance can neither create a dataset nor be sealed
    db.sql("BEGIN; SET LOCAL session_replication_role=replica; INSERT INTO gto_v31_round_registrations(round_key,dataset_key,"
           "composition,cells,cell_set_checksum,owner_authorization,candidate,dataset_provenance,acceptance_criteria,evaluation_plan) "
           f"SELECT 'r30','horse-r30',composition,cells,cell_set_checksum,owner_authorization,candidate,dataset_provenance,"
           "acceptance_criteria,evaluation_plan FROM gto_v31_round_registrations WHERE round_key='r29'; COMMIT;")
    base.insert_dataset(db, 'horse-r30', [turn], refused='was registered without range provenance and cannot create a dataset')
    db.sql(f"BEGIN; SET LOCAL session_replication_role=replica; UPDATE gto_v31_round_registrations SET dataset_id='{legacy_ids['horse-legacy-building']}' "
           "WHERE round_key='r30'; COMMIT;")
    base.seal(db, legacy_ids['horse-legacy-building'], refused='has no range provenance and cannot be sealed')

    # -- the rescale test itself, and grants
    a, b = on_board(OOP_ROOT, BOARDS[0]), on_board(OOP_ROOT, BOARDS[1], scale=0.5)
    arr = lambda v: "ARRAY[" + ','.join(repr(x) for x in v) + "]::double precision[]"
    rescale = lambda x, bx, y, by: db.sql(f"SELECT public.fn_gto_v31_range_is_rescale({arr(x)},{q(bx)},{arr(y)},{q(by)})")
    assert rescale(a, BOARDS[0], b, BOARDS[1]) == 't'
    assert rescale(a, BOARDS[0], on_board(OOP_ROOT, BOARDS[1], scale=0.5, drift=0.9e-6), BOARDS[1]) == 't'
    c = list(b)
    live = next(i for i, x in enumerate(c) if x > 0 and a[i] > 0)
    c[live] *= 1.001
    assert rescale(a, BOARDS[0], c, BOARDS[1]) == 'f'
    c = list(b)
    c[live] = 0.0
    assert rescale(a, BOARDS[0], c, BOARDS[1]) == 'f'
    acl = db.sql("SELECT string_agg(p.proname||'='||coalesce(p.proacl::text,''),';' ORDER BY p.proname) FROM pg_proc p "
                 "WHERE p.proname IN ('fn_gto_v31_register_round','fn_gto_v31_record_range_evidence','fn_gto_v31_seal_matches_range_provenance')")
    assert 'fn_gto_v31_register_round={postgres=X/postgres,service_role=X/postgres}' in acl, acl
    assert 'fn_gto_v31_record_range_evidence={postgres=X/postgres}' in acl, acl
    assert 'fn_gto_v31_seal_matches_range_provenance={postgres=X/postgres}' in acl, acl
    tacl = db.sql("SELECT relacl::text FROM pg_class WHERE relname='gto_v31_range_evidence'")
    assert 'service_role=r/postgres' in tacl and 'anon' not in tacl and 'authenticated' not in tacl, tacl


MUTATIONS = [
    ('forced is registrable', "    IF v_rc = 'forced' THEN", "    IF false THEN"),
    ('unknown construction accepted', "    IF v_rc IS NULL OR v_rc NOT IN ('root','natural','subgame') THEN",
     "    IF v_rc IS NULL OR v_rc NOT IN ('root','natural','subgame','forced','authored') THEN"),
    ('root after a real decision', "    IF v_rc = 'root' AND v_real > 0 THEN", "    IF false THEN"),
    ('a bet may be a one-action step', "      IF s->>'family' <> 'check' AND (s->>'available_actions')::integer < 2 THEN", "      IF false THEN"),
    ('missing provenance registrable', "  IF p_provenance IS NULL OR jsonb_typeof(p_provenance) IS DISTINCT FROM 'array' THEN\n    RETURN 'range provenance is missing:",
     "  IF p_provenance IS NULL THEN RETURN NULL; END IF;\n  IF jsonb_typeof(p_provenance) IS DISTINCT FROM 'array' THEN\n    RETURN 'range provenance is missing:"),
    ('forced-line data sealed as natural', "      ELSIF v_share[v_seat + 1] > 0.10 THEN", "      ELSIF false THEN"),
    ('only an all-forced cell is refused (one natural board hides it)', "      ELSIF v_share[v_seat + 1] > 0.10 THEN",
     "      ELSIF v_share[v_seat + 1] >= 1 THEN"),
    ('declared pure seat not checked against the data', "        IF v_share[v_seat + 1] < 0.90 THEN", "        IF false THEN"),
    ('unnarrowed seat without a real decision', "      IF NOT (u->>'seat' = ANY(v_decided)) THEN", "      IF false THEN"),
    ('narrowed data sealed as root', "      IF v_max_oop <> v_n OR v_max_ip <> v_n THEN", "      IF false THEN"),
    ('one seat is enough for root', "      IF v_max_oop <> v_n OR v_max_ip <> v_n THEN", "      IF v_max_oop <> v_n AND v_max_ip <> v_n THEN"),
    ('single board sealed', "    IF v_n < 2 THEN", "    IF false THEN"),
    ('evidence may be incomplete', "  IF v_nodes <> v_evidence THEN", "  IF false THEN"),
    ('rake not compared', "    IF n#>'{complete_public_state,utility,rake}' IS DISTINCT FROM p#>'{game,rake}' THEN", "    IF false THEN"),
    ('history not compared', "    IF n#>'{complete_public_state,public_history}' IS DISTINCT FROM v_history THEN", "    IF false THEN"),
    ('tree not compared at dataset insert', "   WHERE e#>>'{game,betting_tree_checksum}' IS DISTINCT FROM NEW.manifest_checksum LIMIT 1;",
     "   WHERE false LIMIT 1;"),
    ('tree not compared at ingest', "    IF n#>>'{line_proof,manifest_checksum}' IS DISTINCT FROM p#>>'{game,betting_tree_checksum}' THEN", "    IF false THEN"),
    ('stack, root pot, chip unit and seat not compared at ingest',
     "    IF n#>'{line_proof,effective_stack_chips}' IS DISTINCT FROM p#>'{game,effective_stack_chips}'",
     "    IF false AND n#>'{line_proof,effective_stack_chips}' IS DISTINCT FROM p#>'{game,effective_stack_chips}'"),
    ('support change ignored', "     AND COALESCE(bool_and((r > 0) = (o > 0)), false)\n", ""),
    ('blocked combos not excluded', "     WHERE NOT EXISTS (SELECT 1 FROM blocked x WHERE x.card IN (hi, lo)))", "     WHERE true)"),
    ('any ratio is a rescale', "* (1 + 1e-4), false)", "* 1e9, false)"),
    ('tolerance without headroom over the pipeline (1e-6)', "* (1 + 1e-4), false)", "* (1 + 1e-6), false)"),
    ('runtime mapping need not be the cell key', "       OR (m - 'hero_solver_player' - 'solver_positions') IS DISTINCT FROM ((e->'cell') - 'texture_class')\n", ""),
    ('acting seat need not sit at the hero position',
     "    IF m->'solver_positions'->v_hero IS DISTINCT FROM e#>'{cell,hero_position}'\n"
     "       OR m->'solver_positions'->(1 - v_hero) IS DISTINCT FROM e#>'{cell,opponent_position}' THEN",
     "    IF false THEN"),
    ('history seats need not match the seat positions',
     "      IF s->'position' IS DISTINCT FROM m->'solver_positions'->((s->>'solver_player')::integer) THEN", "      IF false THEN"),
    ('runtime mapping not tied to a built runtime cell', "    IF NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c",
     "    IF false AND NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c"),
    ('provenance-less registration creates a dataset', "    RAISE EXCEPTION 'V31 round % was registered without range provenance and cannot create a dataset', r.round_key;",
     "    RETURN NEW;"),
    ('provenance-less registration sealed', "    RAISE EXCEPTION 'V31 round % has no range provenance and cannot be sealed; the held-out set is not consumed', r.round_key;",
     "    RETURN NEW;"),
]


def main():
    text = MIGRATION.read_text()
    assert text.count('BEGIN;') == 1 and text.rstrip().endswith('COMMIT;'), 'migration must be one BEGIN/COMMIT transaction'
    cluster = base.Cluster()
    try:
        scenario(cluster, text)
        print('native proof: passed')
        if '--mutations' in sys.argv:
            for name, old, new in MUTATIONS:
                assert text.count(old) == 1, f'mutation anchor not unique: {name}'
                try:
                    scenario(cluster, text.replace(old, new))
                except AssertionError:
                    print(f'mutation detected: {name}')
                    continue
                raise SystemExit(f'MUTATION NOT DETECTED: {name}')
            print(f'{len(MUTATIONS)} of {len(MUTATIONS)} mutations detected')
    finally:
        cluster.stop()


if __name__ == '__main__':
    main()
