#!/usr/bin/env python3
"""detail.py <results.jsonl> [n]: per cell and arm, where the chips move: top deviation tags (probe edge by the spot
where the probe first left the Horse line: street|hu/multi|lead/checkedto/facing|initiative|action, bb/100 of all hands),
top chip-flow keys (adversary net bb/100 by how the hand ended and its last wager), Horse fold share to the adversary's
wagers by street and size, and the measured adversary frequencies. Aggregates only."""
import json, sys
n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
for line in open(sys.argv[1]):
    r = json.loads(line)
    for a in r['arms']:
        e = '' if a.get('edgeBb100') is None else f" edge {a['edgeBb100']:.1f}±{a['edgeSe']:.1f}"
        v = '' if a.get('vsArm0Bb100') is None else f" vsBASE {a['vsArm0Bb100']:.1f}±{a['vsArm0Se']:.1f}"
        print(f"== {r['adversary']} {r['variant']} {r['seats']}max {r['stackBB']}bb n={r['pairs']} [{a['label']}] adv {a['bb100']:.1f}±{a['se']:.1f}{e}{v}")
        if a.get('deviationEdge'):
            print('   deviation edge: ' + '; '.join(f"{k} {x['edgeBb100']:+.1f} (h{x['hands']})" for k, x in list(a['deviationEdge'].items())[:n]))
        print('   chip flow: ' + '; '.join(f"{k} {x:+.1f}" for k, x in list(a['chipFlow'].items())[:n]))
        f = a.get('horseFoldToBet', {})
        print('   Horse folds to its wagers: ' + ', '.join(f"{k} {x['fold']/x['n']:.0%}/{x['n']}" for k, x in sorted(f.items()) if x['n'] >= 30))
        print('   adv freq: ' + ', '.join(f"{k} {x:.0%}" for k, x in a['stats'].items()))
    if r.get('tellTable'):
        t = sorted(r['tellTable'].items(), key=lambda kv: -kv[1]['wagers'])
        print('   Horse value share by line/size: ' + '; '.join(f"{k} {x['valueShare']:.0%}/{x['wagers']}" for k, x in t[:12]))
