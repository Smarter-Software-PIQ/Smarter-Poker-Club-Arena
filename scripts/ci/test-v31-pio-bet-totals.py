#!/usr/bin/env python3
"""Native proof for 20261107210122_v31_db_reads_pio_bet_tokens_as_root_totals.

Runs the exact migration file against a throwaway PostgreSQL 17 cluster (never
production). The three patched functions and their helpers are installed from
byte-exact copies of their live definitions (scripts/ci/fixtures/
v31-pio-bet-totals), so the migration's md5 preimage guards must pass.

PioSOLVER 3.8 names a wager `bN` by the actor's TOTAL chips since the root
(r:0:c:b250:c:7d:c:b500 is a 250-chip turn bet after a 250-chip flop call).
The proof:

  * fail-before: on the live preimages the Pio-verified line derives a 500
    street target, a cumulative turn jam is refused, a street bet's bucket is
    mis-read, and the v3 validator refuses the corrected exporter's node
  * pass-after: the same calls derive Pio's street state, matching an
    independent Python simulation of every decision node of a generated tree
    of legal Pio lines (cumulative tokens) across flop, turn and river
  * control: every node with no wager after earlier-street money (all flop
    nodes, checked-through earlier streets) derives byte-identical line proofs
    and complete public states before and after
  * the migration refuses a drifted preimage and a replay, keeps the live
    ACLs, volatility and security, and its in-transaction self-test runs

`--mutations` re-runs the proof against deliberately weakened copies of the
migration (postimage pins and self-test removed so only this proof can catch
them) and requires every one to be detected.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261107210122_v31_db_reads_pio_bet_tokens_as_root_totals.sql'
FIXTURES = ROOT / 'scripts/ci/fixtures/v31-pio-bet-totals'
FIXTURE_FILES = ['00-roles.sql', '01-helpers.sql', '02-node-line-proof.sql', '03-complete-public-state.sql',
                 '04-source-node-v3-fields-valid.sql', '05-grants.sql']
LIVE_MD5 = {
    'fn_gto_texture_class(text)': 'd1b591b67406199bffcfb0054a86d8f7',
    'fn_gto_texture_class_any(text)': '75804ee178a36428526c49b15e632269',
    'fn_gto_v31_action_specs_valid(jsonb)': '4b861f87df0162700684f35b05a8f424',
    'fn_gto_v31_json_safe_integer(jsonb,numeric,numeric)': 'eecec31edec3b1bf867516e8646dc6b4',
    'fn_gto_v31_physical_positions_valid(jsonb)': '0dd2c584f18766982d1a4556694a2f73',
    'fn_gto_v31_source_node_scalar_types_valid(jsonb)': '699c27375f8d10972575bb5698458c99',
    'fn_gto_v31_node_line_proof(text,integer,numeric,numeric)': 'e9b86de252bc516c4661c2692178e458',
    'fn_gto_v31_complete_public_state(jsonb)': '7696a9230d4681ff75dd203d33140381',
    'fn_gto_v31_source_node_v3_fields_valid(jsonb)': '7e6ff79ee50bea0ca0f4b7826652f9f8',
}
PATCHED = ['fn_gto_v31_node_line_proof(text,integer,numeric,numeric)', 'fn_gto_v31_complete_public_state(jsonb)',
           'fn_gto_v31_source_node_v3_fields_valid(jsonb)']
LIVE_ACL = '{postgres=X/postgres,service_role=X/postgres}'
CARDS = ['7d', '2h']
BOARD = 'QsJh2c'


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
        self.scratch = Path(tempfile.mkdtemp(prefix='v31-pio-totals-',
                                             dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')))
        self.sock = Path(tempfile.mkdtemp(prefix='pgt', dir=os.environ.get('PG_SOCKET_ROOT') or '/tmp'))
        self.port = str(52000 + os.getpid() % 4000)
        self.data = self.scratch / 'data'
        subprocess.run([pg_bin('initdb'), '-D', str(self.data), '-U', 'postgres', '-A', 'trust'],
                       check=True, capture_output=True)
        subprocess.run([pg_bin('pg_ctl'), '-D', str(self.data), '-o',
                        f"-k {self.sock} -p {self.port} -c listen_addresses=''",
                        '-l', str(self.scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
        self.n = 0

    def stop(self):
        subprocess.run([pg_bin('pg_ctl'), '-D', str(self.data), '-m', 'fast', 'stop'], capture_output=True)
        shutil.rmtree(self.scratch, ignore_errors=True)
        shutil.rmtree(self.sock, ignore_errors=True)

    def psql(self, db, args):
        return subprocess.run([pg_bin('psql'), '-h', str(self.sock), '-p', self.port, '-U', 'postgres', '-d', db,
                               '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', *args],
                              capture_output=True, text=True)

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
        return r.stderr

    def sql(self, text):
        r = self.cluster.psql(self.name, ['-c', text])
        if r.returncode != 0:
            raise AssertionError(f'{text[:200]}\n{r.stderr}')
        return r.stdout.strip()


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def md5s(db, sigs):
    return {s: db.sql(f"SELECT md5(pg_get_functiondef('public.{s}'::regprocedure))") for s in sigs}


def facts(db):
    return db.sql("SELECT string_agg(p.oid::regprocedure::text||'='||coalesce(p.proacl::text,'')||'/'||p.provolatile::text"
                  "||'/'||p.prosecdef,';' ORDER BY 1) FROM pg_proc p WHERE p.oid IN ("
                  + ','.join(f"'public.{s}'::regprocedure" for s in PATCHED) + ')')


def install_preimages(db):
    for name in FIXTURE_FILES:
        db.file(FIXTURES / name)
    got = md5s(db, LIVE_MD5)
    assert got == LIVE_MD5, f'fixture preimages are not byte-identical to production: {got}'
    for s in PATCHED:
        assert db.sql(f"SELECT proacl::text FROM pg_proc WHERE oid='public.{s}'::regprocedure") == LIVE_ACL


def apply(db, text):
    path = db.cluster.scratch / f'{db.name}-migration.sql'
    path.write_text(text)
    return db.file(path)


# ---------------------------------------------------------------- Pio tree --
def pio_tree(root_pot, stack, pf_aggressor):
    """Every decision node of a small legal Pio tree, with tokens written the
    way Pio 3.8 writes them (actor's total since the root) and the street
    state the corrected exporter derives (pio_upi.analyze_node)."""
    out = []

    def walk(tokens, street, actor, contrib, spent, start, target, wager, closed, prev, depth, aggr):
        if closed:
            if street == 2:
                return
            walk(tokens + [CARDS[street]], street + 1, 0, [0, 0], spent[:], spent[:], 0, False, False,
                 None, 0, None)
            return
        pot = root_pot + spent[0] + spent[1]
        early_money = any(start)
        out.append({'node': ':'.join(['r', '0'] + tokens), 'street': ['flop', 'turn', 'river'][street],
                    'actor': actor, 'wager': wager, 'early_money': early_money,
                    'facing_target': aggr['target'] if wager else None,
                    'facing_total': aggr['total'] if wager else None, 'pot': pot,
                    'spent': spent[:], 'contrib': contrib[:]})
        if depth >= 3:
            return
        # check / call
        c2, s2 = contrib[:], spent[:]
        if wager:
            delta = target - c2[actor]
            c2[actor] += delta
            s2[actor] += delta
            walk(tokens + ['c'], street, 1 - actor, c2, s2, start, 0, False, True, 'call', depth + 1, None)
        else:
            walk(tokens + ['c'], street, 1 - actor, c2, s2, start, 0, False, prev == 'check', 'check',
                 depth + 1, None)
        # wagers: a half-pot bet / 3x raise and the all-in, as street targets
        total = contrib[actor] + stack - spent[actor]
        sizes = {total}
        if wager:
            sizes.add(target * 3)
        else:
            sizes.add(max(100, pot // 2))  # never below one big blind (100 chips)
        for street_target in sorted(sizes):
            if street_target <= target or street_target > total:
                continue
            c3, s3 = contrib[:], spent[:]
            s3[actor] += street_target - c3[actor]
            c3[actor] = street_target
            token = f'b{street_target + start[actor]}'
            walk(tokens + [token], street, 1 - actor, c3, s3, start, street_target, True, False, 'bet',
                 depth + 1, {'target': street_target, 'total': total})

    walk([], 0, 0, [0, 0], [0, 0], [0, 0], 0, False, False, None, 0, None)
    return out


def derive(db, nodes, pf, root, stack):
    values = ','.join(f'({q(n["node"])})' for n in nodes)
    pf_sql = 'NULL' if pf is None else str(pf)
    rows = db.sql("SELECT coalesce(json_agg(json_build_object('node',v.node,'lp',public.fn_gto_v31_node_line_proof("
                  f"v.node,{pf_sql},{root},{stack})) ORDER BY v.node),'[]') FROM (VALUES {values}) v(node)")
    return {r['node']: r['lp'] for r in json.loads(rows)}


def state_node(node, board, hero, pf, root, stack, ctx_target=None, ctx_total=None):
    positions = ['BB', 'SB']
    return {'node': node, 'node_context': {'board': board, 'table_size': 2,
                                           'hero_position': positions[hero], 'opponent_position': positions[1 - hero],
                                           'facing_target_chips': ctx_target, 'facing_actor_total_chips': ctx_total},
            'line_proof': {'chips_per_bb': 100, 'root_pot_chips': root, 'effective_stack_chips': stack,
                           'preflop_aggressor_solver_player': pf, 'hero_solver_player': hero},
            'complete_public_state': {'utility': {}}}


def states(db, payloads):
    values = ','.join(f'({q(json.dumps(p))}::jsonb)' for p in payloads)
    rows = db.sql("SELECT coalesce(json_agg(json_build_object('node',v.n->>'node','st',"
                  f"public.fn_gto_v31_complete_public_state(v.n)) ORDER BY v.n->>'node'),'[]') FROM (VALUES {values}) v(n)")
    return {r['node']: r['st'] for r in json.loads(rows)}


V3_NODE_SQL = """
SELECT public.fn_gto_v31_source_node_v3_fields_valid(jsonb_build_object(
 'schema','smarter-poker.pio-policy.v3','node','r:0:c:b250:c:7d:c:b500',
 'node_checksum',repeat('1',64),'source_combo_order_checksum',repeat('2',64),'range_bundle_checksum',repeat('3',64),
 'node_context',jsonb_build_object('street','turn','game_family','cash','objective','cash_ev',
   'utility_context','cash_ev','table_size',2,'pot_type','srp','hero_position','BB','opponent_position','SB',
   'depth_bucket',80,'texture_class',public.fn_gto_texture_class_any('QsJh2c7d'),'node_role','facing_bet',
   'facing_kind','bet','facing_size_bucket','small','board','QsJh2c7d',
   'facing_target_chips',%s,'facing_actor_total_chips',7750),
 'line_proof',jsonb_build_object('schema','smarter-poker.pio-line-proof.v1','manifest_checksum',repeat('a',64),
   'hero_solver_player',0,'preflop_aggressor_solver_player',1,'root_pot_chips',500,
   'effective_stack_chips',8000,'chips_per_bb',100),
 'action_specs','{"c":{"family":"call","size_unit":"none","size_value":null,"all_in":false},
                  "f":{"family":"fold","size_unit":"none","size_value":null,"all_in":false}}'::jsonb,
 'frequencies',jsonb_build_object('c',z.a,'f',z.a),'action_evs_bb',jsonb_build_object('c',n.a,'f',n.a),
 'policy_evs_bb',n.a,'matchups',z.a))
FROM (SELECT jsonb_agg(0) a FROM generate_series(1,1326)) z, (SELECT jsonb_agg(NULL::int) a FROM generate_series(1,1326)) n
"""

CONFIGS = [(500, 8000, 1), (100, 1000, None), (300, 2000, 0)]


def proof(cluster, text):
    db = cluster.fresh()
    install_preimages(db)
    acl_before = facts(db)

    # ---- fail-before on the live preimages
    pio = db.sql("SELECT public.fn_gto_v31_node_line_proof('r:0:c:b250:c:7d:c:b500',1,500,8000)->>'facing_target_chips'")
    assert pio == '500', f'preimage did not reproduce the defect (Pio line target {pio})'
    jam = db.sql("SELECT public.fn_gto_v31_node_line_proof('r:0:b100:b300:c:2d:c:b1000',NULL,100,1000) IS NULL")
    assert jam == 't', 'preimage did not refuse the cumulative turn jam'
    bucket = db.sql("SELECT public.fn_gto_v31_node_line_proof('r:0:b500:c:7d:c:b1250',1,500,8000)->>'derived_facing_size_bucket'")
    assert bucket == 'mid', f'preimage did not mis-bucket the street bet ({bucket})'
    assert db.sql(V3_NODE_SQL % '250') == 'f', 'preimage v3 validator accepted the street target'

    trees, before_lp, before_st = {}, {}, {}
    for root, stack, pf in CONFIGS:
        nodes = pio_tree(root, stack, pf)
        trees[(root, stack, pf)] = nodes
        before_lp[(root, stack, pf)] = derive(db, nodes, pf, root, stack)
        before_st[(root, stack, pf)] = states(db, [state_node(n['node'], BOARD + ''.join(CARDS[:['flop', 'turn', 'river'].index(n['street'])]),
                                                              n['actor'], pf, root, stack) for n in nodes])
    defect_nodes = sum(1 for k, nodes in trees.items() for n in nodes
                       if n['early_money'] and n['wager'] and n['facing_target'] is not None
                       and (before_lp[k][n['node']] or {}).get('facing_target_chips') != n['facing_target'])

    # ---- apply
    notices = apply(db, text)
    if 'V31_PIO_BET_TOTALS_SELFTEST' in text:
        assert 'V31_PIO_BET_TOTALS_SELFTEST_OK' in notices, 'the in-migration self-test did not run'
    assert facts(db) == acl_before, f'ACL/volatility/security changed: {facts(db)}'

    # ---- pass-after
    lp = json.loads(db.sql("SELECT public.fn_gto_v31_node_line_proof('r:0:c:b250:c:7d:c:b500',1,500,8000)"))
    assert (lp['street'], lp['current_actor_solver_player'], lp['derived_node_role'], lp['derived_facing_size_bucket'],
            lp['facing_target_chips'], lp['facing_actor_total_chips']) == ('turn', 0, 'facing_bet', 'small', 250, 7750), lp
    jam = json.loads(db.sql("SELECT public.fn_gto_v31_node_line_proof('r:0:b100:b300:c:2d:c:b1000',NULL,100,1000)"))
    assert jam and jam['derived_node_role'] == 'all_in' and jam['facing_target_chips'] == 700, jam
    bucket = db.sql("SELECT public.fn_gto_v31_node_line_proof('r:0:b500:c:7d:c:b1250',1,500,8000)->>'derived_facing_size_bucket'")
    assert bucket == 'small', f'street bet still mis-bucketed ({bucket})'
    assert db.sql("SELECT public.fn_gto_v31_node_line_proof('r:0:c:b250:c:7d:c:b250',1,500,8000) IS NULL") == 't', \
        'a total at or below earlier-street spending was admitted as a wager'
    assert db.sql(V3_NODE_SQL % '250') == 't', 'v3 validator refused the Pio street target'
    assert db.sql(V3_NODE_SQL % '500') == 'f', 'v3 validator admitted the cumulative token as the street target'
    assert db.sql(V3_NODE_SQL % '249') == 'f', 'v3 validator admitted a wrong street target'

    checked = identical = 0
    for (root, stack, pf), nodes in trees.items():
        after_lp = derive(db, nodes, pf, root, stack)
        after_st = states(db, [state_node(n['node'], BOARD + ''.join(CARDS[:['flop', 'turn', 'river'].index(n['street'])]),
                                          n['actor'], pf, root, stack) for n in nodes])
        for n in nodes:
            got = after_lp[n['node']]
            if n['wager']:
                assert got is not None, f'facing node refused after the fix: {n["node"]} ({root},{stack},{pf})'
            if got is not None:
                checked += 1
                assert (got['street'], got['current_actor_solver_player'], got['facing_target_chips'],
                        got['facing_actor_total_chips']) == (n['street'], n['actor'], n['facing_target'],
                                                             n['facing_total']), (n, got)
            st = after_st[n['node']]
            if st is not None:
                assert st['pot_chips'] == n['pot'] and st['total_spent_chips'] == n['spent'] \
                    and st['contributions_chips'] == n['contrib'], (n, st)
            elif got is not None:
                raise AssertionError(f'complete state refused a derivable node {n["node"]}')
            if not n['early_money']:
                assert got == before_lp[(root, stack, pf)][n['node']], f'control line proof changed: {n["node"]}'
                assert st == before_st[(root, stack, pf)][n['node']], f'control public state changed: {n["node"]}'
                identical += 1

    # ---- the migration refuses a replay (its preimage is gone) and changes nothing
    post = md5s(db, PATCHED)
    try:
        apply(db, text)
    except Refused as error:
        assert 'preimage changed' in str(error), str(error)[:300]
    else:
        raise AssertionError('a replay of the migration was accepted')
    assert md5s(db, PATCHED) == post

    # ---- a drifted preimage refuses the whole migration
    db2 = cluster.fresh()
    install_preimages(db2)
    db2.sql("CREATE OR REPLACE FUNCTION public.fn_gto_v31_complete_public_state(p_node jsonb) RETURNS jsonb "
            "LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$ SELECT NULL::jsonb $f$")
    before = md5s(db2, PATCHED)
    try:
        apply(db2, text)
    except Refused as error:
        assert 'preimage changed' in str(error), str(error)[:300]
    else:
        raise AssertionError('a drifted preimage must refuse the migration')
    assert md5s(db2, PATCHED) == before, 'a refused migration left a partial patch'
    return defect_nodes, checked, identical


def unguarded(text):
    """Remove the postimage md5 pins and the self-test, so a mutation can only be caught by this proof."""
    a = "    IF md5(pg_get_functiondef(r.fn)) IS DISTINCT FROM r.post_md5 THEN"
    assert text.count(a) == 1
    text = text.replace(a, "    IF false THEN")
    start, end = text.index('-- Self-test of the new reading'), text.index('$selftest$;') + len('$selftest$;')
    return text[:start] + text[end:]


MUTATIONS = [
    ('line proof keeps the street reading',
     "       ||chr(10)||'          -(v_spent[v_actor+1]-v_contributions[v_actor+1]); -- Pio bN: total since root'),",
     "       ||';'),"),
    ('line proof subtracts the whole spend',
     "-(v_spent[v_actor+1]-v_contributions[v_actor+1]); -- Pio", "-(v_spent[v_actor+1]); -- Pio"),
    ('complete state keeps the street reading',
     "'target:=substring(token FROM 2)::numeric-(spent[actor+1]-contribution[actor+1]); -- Pio bN: total since root'),",
     "'target:=substring(token FROM 2)::numeric;'),"),
    ('v3 validator keeps the token equality',
     "       ||'-(v_effective_stack_chips-v_facing_actor_total) -- Pio bN: total since root'||chr(10))",
     "       ||chr(10))"),
    ('v3 validator adds the earlier spend', "||'-(v_effective_stack_chips-v_facing_actor_total)",
     "||'+(v_effective_stack_chips-v_facing_actor_total)"),
    ('preimage guard is dropped', "    IF md5(def) IS DISTINCT FROM patch.pre_md5 THEN", "    IF false THEN"),
    ('authenticated gains execute',
     "GRANT EXECUTE ON FUNCTION public.fn_gto_v31_complete_public_state(jsonb) TO service_role;",
     "GRANT EXECUTE ON FUNCTION public.fn_gto_v31_complete_public_state(jsonb) TO service_role, authenticated;"),
]


def main():
    text = MIGRATION.read_text()
    cluster = Cluster()
    try:
        defect, checked, identical = proof(cluster, text)
        print(f'v31 pio bet totals: native proof passed (preimage mis-derived {defect} later-street facing nodes; '
              f'{checked} derived nodes match the Pio simulation; {identical} control nodes byte-identical)')
        if '--mutations' in sys.argv:
            base = unguarded(text)
            survived = []
            for label, old, new in MUTATIONS:
                assert base.count(old) == 1, f'mutation anchor not unique: {label}'
                try:
                    proof(cluster, base.replace(old, new))
                except AssertionError as error:
                    print(f'  killed: {label} ({str(error).strip().splitlines()[0][:120]})')
                else:
                    survived.append(label)
                    print(f'  SURVIVED: {label}')
            assert not survived, f'mutations survived: {survived}'
            print(f'v31 pio bet totals: {len(MUTATIONS)}/{len(MUTATIONS)} mutations killed')
    finally:
        cluster.stop()


if __name__ == '__main__':
    main()
