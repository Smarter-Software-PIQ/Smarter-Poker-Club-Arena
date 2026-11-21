#!/usr/bin/env python3
"""compare.py <base results.jsonl> <cand results.jsonl>: pair two sparring runs of the same cells (same seed,
same deals) made in two trees (a code change between them), hand by hand. Prints, per adversary and game, the
adversary's bb/100 vs BASE and vs CAND, the paired CAND-BASE change with SE and verdict (WORSE = adversary wins
more), and probe edges. Needs runs made with SPARRING_PERHAND=1. Aggregates only."""
import json, math, sys
def load(p):
    out = {}
    for l in open(p):
        r = json.loads(l); out[(r['adversary'], r['variant'], r['seats'], r['stackBB'], r['pairs'], r['seed'])] = r
    return out
def ms(xs):
    n = len(xs); m = sum(xs) / n; v = sum((x - m) ** 2 for x in xs) / max(1, n - 1); return m * 100, math.sqrt(v / n) * 100
b, c = load(sys.argv[1]), load(sys.argv[2])
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
