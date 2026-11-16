"""Line vectors for the SQL v3 node line functions, answered by World Hub's own pio_upi.py
(line_class_v3 and analyze_node with and without cell contract v3). Usage:
  python3 -I make-line-vectors.py <world-hub checkout> <commit> <out.json>
The committed 01-line-vectors.json is this output as Prettier formats it on commit
(lint-staged): compare the two as JSON, not as bytes."""
import hashlib, json, random, sys
from pathlib import Path
WH, COMMIT, OUT = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
sys.path.insert(0, str(WH / 'scripts/horse-solver-v31'))
import pio_upi  # noqa: E402
SRC = WH / 'scripts/horse-solver-v31/pio_upi.py'
CARDS = [r + s for r in '23456789TJQKA' for s in 'cdhs']


def walk(rng, pot, stack, max_actions):
    """A candidate Pio node path (legal or not): Pio bN is the actor's total since the root."""
    tokens, contrib, total, start = ['r', '0'], [0, 0], [0, 0], [0, 0]
    actor, cur, wager, acted, streets, board = 0, 0, False, 0, 0, set()
    p = float(pot)
    for _ in range(max_actions):
        closed = acted >= 2 and not wager
        if closed and streets < 2 and rng.random() < 0.7:
            card = rng.choice([c for c in CARDS if c not in board]); board.add(card)
            tokens.append(card); streets += 1
            actor, cur, wager, acted, contrib, start = 0, 0, False, 0, [0, 0], list(total)
            continue
        if closed and rng.random() < 0.8:
            break
        r = rng.random()
        if r < 0.4:
            if wager:
                d = cur - contrib[actor]; contrib[actor] += d; total[actor] += d; p += d; wager = False
            tokens.append('c'); actor = 1 - actor; acted += 1
            continue
        if r < 0.43:
            tokens.append(rng.choice(['f', 'x', 'b0', 'bx', 'c', 'Ah']))  # malformed or illegal on purpose
            continue
        room = contrib[actor] + stack - total[actor]
        if room <= cur:
            tokens.append('c'); actor = 1 - actor; acted += 1; continue
        frac = rng.choice([0.25, 0.33, 0.5, 0.59, 0.6, 0.61, 0.75, 1.0, 1.09, 1.1, 1.11, 1.5, 2.5, 99])
        if wager:
            target = int(cur + frac * (p + cur - contrib[actor]))
        else:
            target = int(frac * p)
        target = max(target, contrib[actor] + 1, cur + 1)
        target = min(target, room)
        if rng.random() < 0.05:
            target = room + rng.choice([0, 1])  # all in, or one chip past it
        tokens.append(f'b{start[actor] + target}')
        d = target - contrib[actor]; contrib[actor] = target; total[actor] += d; p += d
        cur, wager, actor, acted = target, True, 1 - actor, acted + 1
    return ':'.join(tokens)


def line(node, pot, stack):
    try:
        return pio_upi.line_class_v3(node, root_pot_chips=pot, effective_stack_chips=stack)
    except pio_upi.PioError:
        return None


def proof(node, pot, stack, aggressor, contract):
    try:
        n = pio_upi.analyze_node(node, root_pot_chips=pot, effective_stack_chips=stack,
                                 preflop_aggressor=aggressor, cell_contract=contract)
    except pio_upi.PioError:
        return None
    return {'street': n.street, 'actor': n.actor, 'node_role': n.node_role, 'facing_kind': n.facing_kind,
            'facing_size_bucket': n.facing_size_bucket, 'facing_target_chips': n.facing_target_chips,
            'facing_actor_total_chips': n.facing_actor_total_chips}


rng = random.Random(20261115)
seen, vectors = set(), []
fixed = ['r:0', 'r:0:c', 'r:0:c:c', 'r:0:c:c:Kh', 'r:0:b325', 'r:0:b1000', 'r:0:c:b650:c:Kh', 'r:0:b20000',
         'r:0:c:c:Kh:c:c:2d', 'r:0:c:c:Kh:c:c:2d:c:c:3s', 'r:0:f', 'r:1', 'x', 'r:0:c:b325:b1300', 'r:0:b325:b1300:b20000']
for pot in (600, 650, 1000):
    for stack in (4000, 8000, 20000):
        for aggressor in (None, 0, 1):
            nodes = list(fixed) + [walk(rng, pot, stack, rng.randint(0, 9)) for _ in range(60)]
            for node in nodes:
                key = (node, pot, stack, aggressor)
                if key in seen:
                    continue
                seen.add(key)
                vectors.append({'node': node, 'pot': pot, 'stack': stack, 'aggressor': aggressor,
                                'line_class': line(node, pot, stack),
                                'v3': proof(node, pot, stack, aggressor, 'v3'),
                                'v2': proof(node, pot, stack, aggressor, None)})
F = ['street', 'actor', 'node_role', 'facing_kind', 'facing_size_bucket', 'facing_target_chips', 'facing_actor_total_chips']
row = lambda p: None if p is None else [p[k] for k in F]
compact = [[v['node'], v['pot'], v['stack'], v['aggressor'], v['line_class'], row(v['v3']), row(v['v2'])] for v in vectors]
meta = {'repository': 'Smarter-Poker/Smarter-Poker-World-Hub', 'path': 'scripts/horse-solver-v31/pio_upi.py', 'commit': COMMIT,
        'sha256': hashlib.sha256(SRC.read_bytes()).hexdigest(),
        'functions': ['line_class_v3', 'analyze_node(cell_contract="v3")', 'analyze_node(cell_contract=None)'],
        'columns': ['node', 'root_pot_chips', 'effective_stack_chips', 'preflop_aggressor', 'line_class_v3', 'analyze_node_v3', 'analyze_node_v2'],
        'proof_columns': F}
OUT.write_text('{"source": ' + json.dumps(meta, sort_keys=True) + ',\n "vectors": [\n'
               + ',\n'.join('  ' + json.dumps(v, separators=(',', ':')) for v in compact) + '\n ]}\n')
st = lambda k: sum(1 for v in vectors if v[k] is not None)
print(len(vectors), 'vectors;', st('line_class'), 'with a line;', st('v3'), 'v3 lines proven;', st('v2'), 'v2;',
      sum(1 for v in vectors if v['v3'] and v['v3']['node_role'] == 'donk'), 'donk;',
      sum(1 for v in vectors if v['v3'] and v['v3']['facing_size_bucket'] == 'big'), 'big')
