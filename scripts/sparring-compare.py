#!/usr/bin/env python3
"""compare.py <base results.jsonl> <cand results.jsonl>: pair two sparring runs of the same cells (same seed,
same deals) made in two trees (a code change between them), hand by hand. Prints FLIPS FIRST (first divergence
per hand from BASE by street and change class with its denominator, the OFF-vs-OFF control row from the base
tree's CTRL arm, illegal actions and fallbacks by seat class), the LEAD-3 RULING 1 guard thresholds z_fam for
this table's probe and cell counts, then per adversary and game the adversary's bb/100 vs BASE and vs CAND, the
paired CAND-BASE change with SE and verdict (WORSE = adversary wins more), and probe edges. Needs runs made with
SPARRING_PERHAND=1. Env SPARRING_TARGET="probe:a,probe:b" names the target probes. Aggregates only."""
import json, math, os, sys
from statistics import NormalDist
def load(p):
    out = {}
    for l in open(p):
        if not l.strip().startswith('{'): continue
        r = json.loads(l); out[(r['adversary'], r['variant'], r['seats'], r['stackBB'], r['pairs'], r['seed'])] = r
    return out
def ms(xs):
    n = len(xs); m = sum(xs) / n; v = sum((x - m) ** 2 for x in xs) / max(1, n - 1); return m * 100, math.sqrt(v / n) * 100
def z_fam(m):
    """LEAD-3 RULING 1: the guard bar for a family of m looks."""
    return NormalDist().inv_cdf(0.8413 ** (1.0 / m))
STREETS = ('preflop', 'flop', 'turn', 'river')
def flips(base_lines, other_lines, base_net, other_net):
    """The same count as SparringLeague.addSparringFlipHand, from two runs' public action lines."""
    f = dict(hands=0, parted=0, compared={}, flips={}, net=0)
    inc = lambda o, k: o.__setitem__(k, o.get(k, 0) + 1)
    who = lambda s: 'seat0' if s == '0' else 'horse'
    for h, (lb, lo) in enumerate(zip(base_lines, other_lines)):
        b = [e.split('/') for e in lb.split(';')] if lb else []
        o = [e.split('/') for e in lo.split(';')] if lo else []
        f['hands'] += 1
        n = min(len(b), len(o)); k = 0
        while k < n and b[k] == o[k]: k += 1
        differs = not (k == len(b) and k == len(o))
        for j in range(min(k + 1, len(b)) if differs else k): inc(f['compared'], who(b[j][0]) + '|' + b[j][1])
        if base_net[h] != other_net[h]: f['net'] += 1
        if not differs: continue
        f['parted'] += 1
        if k >= n: inc(f['flips'], 'line|length'); continue
        x, y = b[k], o[k]
        if x[0] != y[0] or x[1] != y[1]: inc(f['flips'], 'line|actor'); continue
        inc(f['flips'], who(x[0]) + '|' + x[1] + '|' + ('size' if x[2] == y[2] else x[2] + '->' + y[2]))
    return f
def flip_row(k, label, f, fm, d, ba, oa):
    tot = lambda pre, o: sum(v for kk, v in o.items() if kk.startswith(pre))
    st = ' | '.join(f"{tot('horse|' + s + '|', f['flips'])} / {f['compared'].get('horse|' + s, 0)}" for s in STREETS)
    cls = '; '.join(f"{kk.replace('|', ' ')} {v}" for kk, v in sorted(f['flips'].items(), key=lambda kv: -kv[1])[:5]) or 'none'
    dm, dse = ms(d)
    g = lambda a, c, x: a.get('bySeat', {}).get(c, {}).get(x, '?')
    print(f"| {k[0]} | {k[1]} | {k[2]} | {k[3]} | {label} | {f['parted']} / {f['hands']} | {st} | "
          f"{tot('seat0|', f['flips'])} / {tot('seat0|', f['compared'])} | {cls} | "
          f"{(str(fm['parted']) + ' / ' + str(fm['hands'])) if fm else '-'} | {f['net']} | {dm:.1f} ± {dse:.1f} | "
          f"{g(ba, 'horse', 'illegal')}/{g(oa, 'horse', 'illegal')} | {g(ba, 'horse', 'brainFallback')}/{g(oa, 'horse', 'brainFallback')} | "
          f"{g(ba, 'scripted', 'illegal')}/{g(oa, 'scripted', 'illegal')} | {g(ba, 'seat0Brain', 'illegal')}/{g(oa, 'seat0Brain', 'illegal')} | "
          f"{ba.get('scriptedSnapped', '?')}/{oa.get('scriptedSnapped', '?')} |")
b, c = load(sys.argv[1]), load(sys.argv[2])
keys = [k for k in sorted(b) if k in c and 'perHand' in b[k]['arms'][0] and 'perHand' in c[k]['arms'][0]]
if any('perHandLine' in b[k]['arms'][0] and 'perHandLine' in c[k]['arms'][0] for k in keys):
    print('FLIPS FIRST. First divergence per hand from BASE on the same deal. Street columns: hands that parted at a '
          'Horse-seat decision on that street / Horse-seat decisions compared on that street (both arms on the same '
          'line up to there). CTRL = OFF-vs-OFF control (the BASE tree and option set again): law = 0 parted, 0.0 chips. '
          'Hard flags read the Horse seats (h); s = the adversary script, b = the Horse brain in seat 0.')
    print('| adversary | game | seats | bb | arm | hands parted / hands | preflop | flop | turn | river | seat 0 first | '
          'change classes | mirror deal parted | net differs (hands) | arm-BASE bb/100 | illegal h BASE/arm | '
          'fallback h BASE/arm | illegal s BASE/arm | illegal b BASE/arm | snapped |')
    print('|' + '---|' * 20)
    for k in keys:
        ba, ca = b[k]['arms'][0], c[k]['arms'][0]
        others = [('CAND', ca)] + [(a['label'], a) for a in b[k]['arms'][1:] if a['label'] == 'CTRL']
        for label, oa in others:
            if 'perHandLine' not in ba or 'perHandLine' not in oa: continue
            f = flips(ba['perHandLine'], oa['perHandLine'], ba['perHand'], oa['perHand'])
            fm = flips(ba['perHandMirrorLine'], oa['perHandMirrorLine'], ba['perHandMirror'], oa['perHandMirror']) if 'perHandMirrorLine' in ba and 'perHandMirrorLine' in oa else None
            flip_row(k, label, f, fm, [y - x for x, y in zip(ba['perHand'], oa['perHand'])], ba, oa)
    print()
rows = []
for k in keys:
    ba, ca = b[k]['arms'][0], c[k]['arms'][0]
    dm, dse = ms([y - x for x, y in zip(ba['perHand'], ca['perHand'])])
    rows.append((k, ba, ca, dm, dse))
targets = set(x.strip() for x in os.environ.get('SPARRING_TARGET', '').split(',') if x.strip())
by = {}
for k, ba, ca, dm, dse in rows:
    by.setdefault(k[0], []).append((dm, dse))
guards = [a for a in by if a not in targets]
if guards:
    P = len(guards); C = max(len(by[a]) for a in guards)
    print(f"GUARD THRESHOLDS (LEAD-3 RULING 1) for this table: guard probes P = {P}, cells per probe C = {C}"
          f"{' (largest; cell counts differ)' if any(len(v) != C for v in by.values()) else ''}. "
          f"GUARD-POOLED fails above z_fam(P) = {z_fam(P):.2f}; GUARD-CELL fails above z_fam(P x C) = z_fam({P * C}) = {z_fam(P * C):.2f}. "
          f"Target probes (SPARRING_TARGET): {', '.join(sorted(targets)) if targets else 'none declared, every adversary counted as a guard'}. "
          f"A cell with no chip difference counts in P and C with z = 0; the pooled mean is over the cells with a difference.")
    print('| adversary | role | cells | pooled CAND-BASE bb/100 | pooled z | vs z_fam(P) | largest cell z | vs z_fam(P x C) |')
    print('|---|---|---|---|---|---|---|---|')
    for a, v in by.items():
        # a cell with no chip difference (0.0 +/- 0.0) counts in P and C with z = 0; the pooled mean is over the other cells
        d = [(m, s) for m, s in v if s > 0]
        w = sum(1 / (s * s) for _, s in d); mean = sum(m / (s * s) for m, s in d) / w if w else 0.0; se = math.sqrt(1 / w) if w else 0.0
        z = mean / se if se else 0.0; zmax = max([m / s for m, s in d] + ([0.0] if len(d) < len(v) else [])); g = a not in targets
        print(f"| {a} | {'guard' if g else 'target'} | {len(v)} | {mean:.1f} ± {se:.1f} | {z:.2f} | "
              f"{('ABOVE' if z > z_fam(P) else 'within') if g else '-'} | {zmax:.2f} | {('ABOVE' if zmax > z_fam(P * C) else 'within') if g else '-'} |")
    print()
print('| adversary | game | seats | bb | hands | adv vs BASE bb/100 | adv vs CAND bb/100 | CAND-BASE (paired) | verdict | probe edge BASE | probe edge CAND |')
print('|---|---|---|---|---|---|---|---|---|---|---|')
for k in sorted(b):
    if k not in c: continue
    ba, ca = b[k]['arms'][0], c[k]['arms'][0]
    if 'perHand' not in ba or 'perHand' not in ca: print(f'| {k[0]} | missing perHand |'); continue
    d = [y - x for x, y in zip(ba['perHand'], ca['perHand'])]
    dm, dse = ms(d); z = dm / dse if dse > 0 else 0
    v = 'NO CHANGE' if abs(z) < 2 else ('WORSE' if z > 0 else 'BETTER')
    e = lambda a: '-' if a.get('edgeBb100') is None else f"{a['edgeBb100']:.1f} ± {a['edgeSe']:.1f}"
    print(f"| {k[0]} | {k[1]} | {k[2]} | {k[3]} | {k[4]} | {ba['bb100']:.1f} ± {ba['se']:.1f} | {ca['bb100']:.1f} ± {ca['se']:.1f} | {dm:.1f} ± {dse:.1f} | {v} | {e(ba)} | {e(ca)} |")
