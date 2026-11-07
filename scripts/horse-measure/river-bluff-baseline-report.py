#!/usr/bin/env python3
"""Render docs/horse-measure/2026-11-07/river-bluff-baseline-league.md tables from
the per-cell JSON written by server/src/scripts/riverBluffBaselineLeague.ts.
Read-only: usage  python3 river-bluff-baseline-report.py RESULTS_DIR"""
import json, glob, os, sys, math
d = sys.argv[1]
rows = []
for f in sorted(glob.glob(os.path.join(d, '*.json'))):
    r = json.load(open(f))
    r.setdefault('seats', 2 if os.path.basename(f).startswith('hu_') else 6)
    rows.append(r)
order = {'nlh': 0, 'plo4': 1, 'plo5': 2, 'plo6': 3}
pord = {'standard': 0, 'stations': 1, 'folders': 2, 'mixed': 3}
rows.sort(key=lambda r: (-r['seats'], order[r['variant']], r['format'], pord[r['pool']]))

def pct(a, b):
    return f"{100*a/b:.0f}%" if b else "-"

out = []
for seats in (6, 2):
    rs = [r for r in rows if r['seats'] == seats]
    if not rs: continue
    out.append(f"\n### {seats}-handed\n")
    out.append("| variant | format | pool | pairs | A-B bb/100 | 95% CI | div | A bb/100 | B bb/100 | baseline bluffs (A) | folded | fold needed | avg size | A river bets / weak | B river bets / weak | A WTSD | B WTSD | A weak-bet SD | B weak-bet SD |")
    out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rs:
        a, b = r['armA'], r['armB']
        n = a['baselineBluffs']
        out.append("| {v} | {f} | {p} | {pairs} | {d:+.2f} +/- {se:.2f} | [{l:+.2f}, {h:+.2f}] | {div} | {ab:+.1f} | {bbb:+.1f} | {n} | {fo} | {be} | {sz} | {arb}/{arw} | {brb}/{brw} | {aw} | {bw} | {asd} | {bsd} |".format(
            v=r['variant'], f=r['format'], p=r['pool'], pairs=r['pairs'], d=r['bb100'], se=r['stderr'],
            l=r['ci95'][0], h=r['ci95'][1], div=r['divergentPairs'], ab=a['bb100'], bbb=b['bb100'], n=n,
            fo=(f"{a['baselineBluffsFolded']} ({pct(a['baselineBluffsFolded'], n)})" if n else '0'),
            be=(f"{100*a['baselineBreakEvenSum']/n:.0f}%" if n else '-'),
            sz=(f"{a['baselineSizeSum']/n:.2f}" if n else '-'),
            net=(f"{a['baselineBluffNetBB']:+.1f}" if n else '-'),
            arb=a['riverBets'], arw=a['riverWeakBets'], brb=b['riverBets'], brw=b['riverWeakBets'],
            aw=pct(a['showdowns'], a['hands']), bw=pct(b['showdowns'], b['hands']),
            asd=f"{a['riverWeakBetsShowdown']}/{a['riverBetsShowdown']}", bsd=f"{b['riverWeakBetsShowdown']}/{b['riverBetsShowdown']}"))
    # pooled
    out.append("")
    def pool(sel, label):
        if not sel: return
        # inverse-variance? use simple hand-weighted mean with combined se
        tot = sum(r['pairs'] for r in sel)
        m = sum(r['bb100'] * r['pairs'] for r in sel) / tot
        se = math.sqrt(sum((r['stderr'] * r['pairs']) ** 2 for r in sel)) / tot
        nb = sum(r['armA']['baselineBluffs'] for r in sel)
        nf = sum(r['armA']['baselineBluffsFolded'] for r in sel)
        be = sum(r['armA']['baselineBreakEvenSum'] for r in sel)
        net = sum(r['armA']['baselineBluffNetBB'] for r in sel)
        out.append(f"| {label} | {tot} | {m:+.2f} +/- {se:.2f} | [{m-1.96*se:+.2f}, {m+1.96*se:+.2f}] | {nb} | {nf} ({pct(nf, nb)}) | {(100*be/nb if nb else 0):.0f}% |")
    out.append(f"\nPooled ({seats}-handed, hand-weighted):\n")
    out.append("| slice | pairs | A-B bb/100 | 95% CI | baseline bluffs | folded | fold needed |")
    out.append("|---|---|---|---|---|---|---|")
    for v in order:
        pool([r for r in rs if r['variant'] == v], v)
    for p in pord:
        pool([r for r in rs if r['pool'] == p], p)
    for f in ('cash', 'tournament'):
        pool([r for r in rs if r['format'] == f], f)
    pool(rs, 'all')
print("\n".join(out))
ill = sum(r['illegalActions'] for r in rows); tr = sum(r['truncatedStreets'] for r in rows); bf = sum(r['brainExceptionFallbacks'] for r in rows)
print(f"\nIllegal actions {ill}, truncated streets {tr}, brain exception fallbacks {bf} across {len(rows)} cells.")
