"""Tables for server/src/scripts/riverLayerAblationLeague.ts results (2026-11-08).

  python3 river-layer-ablation-report.py DIR [DIR...]

One row per cell (layer, seats, variant, format, pool): pairs, A-B bb/100 with
its 95% half-width, the CI, divergent pairs, hands in which arm A's layer acted,
and the legality counters; then an inverse-variance pooled row per layer and
seat count, two ways: pair-weighted (every pair counts once, the mean of all
paired differences; unbiased, the headline) and inverse-variance over cells
with a non-zero standard error (shown for comparison: with a handful of
changed hands per cell the per-cell SE is itself noisy and the cells whose few
changed hands were small losses get most of the weight). A cell is FLAGGED
when its CI lies wholly below zero.
"""
import glob, json, math, os, sys
from collections import defaultdict

rows = []
for d in sys.argv[1:]:
    for f in sorted(glob.glob(os.path.join(d, '*.json'))):
        r = json.load(open(f))
        if 'bb100' not in r:
            continue
        rows.append(r)
rows.sort(key=lambda r: (r.get('layer', ''), r['seats'], r['variant'], r['format'], r['pool'], r['seed']))
print('| layer | seats | variant | format | pool | seed | pairs | A-B bb/100 | 95% CI | div | acted | illegal/trunc/fb | flag |')
print('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
pool = defaultdict(lambda: [0.0, 0.0, 0])
pw = defaultdict(lambda: [0.0, 0.0, 0])
for r in rows:
    lo, hi = r['ci95']
    flag = 'BELOW ZERO' if hi < 0 else ''
    print(f"| {r.get('layer','')} | {r['seats']} | {r['variant']} | {r['format']} | {r['pool']} | {r['seed']} | {r['pairs']} | "
          f"{r['bb100']:+.2f} +/- {1.96*r['stderr']:.2f} | [{lo:+.2f}, {hi:+.2f}] | {r['divergentPairs']} | {r['armA']['skillHands']} | "
          f"{r['illegalActions']}/{r['truncatedStreets']}/{r['brainExceptionFallbacks']} | {flag} |")
    k = (r.get('layer', ''), r['seats'])
    pw[k][0] += r['pairs'] * r['bb100']; pw[k][1] += (r['pairs'] * r['stderr']) ** 2; pw[k][2] += r['pairs']
    if r['stderr'] > 0:
        w = 1 / r['stderr'] ** 2
        pool[k][0] += w * r['bb100']; pool[k][1] += w; pool[k][2] += r['pairs']
print()
print('| layer | seats | pairs | pair-weighted A-B bb/100 | 95% CI | inverse-variance | 95% CI |')
print('| --- | --- | --- | --- | --- | --- | --- |')
for k in sorted(pw):
    layer, seats = k
    s1, v1, n = pw[k]
    m1, se1 = s1 / n, math.sqrt(v1) / n
    if k in pool and pool[k][1] > 0:
        sw, w, _ = pool[k]; m2, se2 = sw / w, 1 / math.sqrt(w)
        iv = f'{m2:+.2f} +/- {1.96*se2:.2f} | [{m2-1.96*se2:+.2f}, {m2+1.96*se2:+.2f}]'
    else:
        iv = '- | -'
    print(f'| {layer} | {seats} | {n} | {m1:+.2f} +/- {1.96*se1:.2f} | [{m1-1.96*se1:+.2f}, {m1+1.96*se1:+.2f}] | {iv} |')
