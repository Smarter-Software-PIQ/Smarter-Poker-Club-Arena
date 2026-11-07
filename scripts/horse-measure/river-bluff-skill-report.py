#!/usr/bin/env python3
"""Render the dormant river skill measurement (server/src/scripts/riverBluffSkillLeague.ts).

    python3 scripts/horse-measure/river-bluff-skill-report.py <results-dir-or-cells.json> [...]

Each argument is a directory of per-cell JSON files written by the CLI, or a
JSON list of cells (docs/horse-measure/2026-11-07/results/river-bluff-skills/
v54-cells.json). Every cell is one duplicate-dealt cell (arm A = skill on,
arm B = current main). Cells sharing (skill, seats, variant, format, pool) from
several seeds are combined hand-weighted. CI = +/- 1.96 se of the paired difference.
"""
import glob
import json
import math
import os
import sys
from collections import defaultdict


def load(dirs):
    cells = defaultdict(list)
    rows = []
    for d in dirs:
        if os.path.isfile(d):
            rows.extend(json.load(open(d)))
        else:
            rows.extend(json.load(open(f)) for f in sorted(glob.glob(os.path.join(d, '*.json'))))
    for r in rows:
        cells[(r['skill'], r['seats'], r['variant'], r['format'], r['pool'])].append(r)
    return cells


def combine(rs):
    n = sum(r['pairs'] for r in rs)
    mean = sum(r['bb100'] * r['pairs'] for r in rs) / n
    se = math.sqrt(sum((r['pairs'] * r['stderr']) ** 2 for r in rs)) / n
    acted = sum(r['armA']['skillHands'] for r in rs)
    folded = sum(r['armA']['skillFolded'] for r in rs)
    net = sum(r['armA']['skillNetBB'] for r in rs)
    div = sum(r['divergentPairs'] for r in rs)
    bluffA = sum(r['armA']['baselineBluffs'] for r in rs)
    bluffB = sum(r['armB']['baselineBluffs'] for r in rs)
    rbA = sum(r['armA']['riverBets'] for r in rs)
    rbB = sum(r['armB']['riverBets'] for r in rs)
    fires = defaultdict(int)
    for r in rs:
        for k, v in r['armA']['skillFires'].items():
            fires[k] += v
    legal = sum(r['illegalActions'] + r['truncatedStreets'] + r['brainExceptionFallbacks'] for r in rs)
    return dict(n=n, mean=mean, se=se, acted=acted, folded=folded, net=net, div=div,
                bluffA=bluffA, bluffB=bluffB, rbA=rbA, rbB=rbB, fires=fires, legal=legal,
                seeds=sorted({r['seed'] for r in rs}))


def fmt(c):
    lo, hi = c['mean'] - 1.96 * c['se'], c['mean'] + 1.96 * c['se']
    fold = f"{c['folded']} ({100 * c['folded'] / c['acted']:.0f}%)" if c['acted'] else '-'
    return (f"| {c['n']} | {c['mean']:+.2f} +/- {c['se']:.2f} | [{lo:+.2f}, {hi:+.2f}] | {c['div']} | "
            f"{c['acted']} | {fold} | {c['net']:+.1f} | {c['bluffA']}/{c['bluffB']} | {c['rbA']}/{c['rbB']} | {c['legal']} |")


def pooled(cs):
    n = sum(c['n'] for c in cs)
    mean = sum(c['mean'] * c['n'] for c in cs) / n
    se = math.sqrt(sum((c['n'] * c['se']) ** 2 for c in cs)) / n
    acted = sum(c['acted'] for c in cs)
    folded = sum(c['folded'] for c in cs)
    return n, mean, se, acted, folded


def main():
    cells = {k: combine(v) for k, v in load(sys.argv[1:]).items()}
    head = ('| variant | format | pool | pairs | A-B bb/100 | 95% CI | div | skill acted (A) | field folded | '
            'net bb of those hands | baseline bluffs A/B | river bets A/B | illegal+trunc+fallback |')
    sep = '|' + '---|' * 13
    for skill in sorted({k[0] for k in cells}):
        for seats in (6, 2):
            keys = sorted(k for k in cells if k[0] == skill and k[1] == seats)
            if not keys:
                continue
            print(f"\n### {skill}, {seats}-handed\n")
            print(head)
            print(sep)
            for k in keys:
                print(f"| {k[2]} | {k[3]} | {k[4]} " + fmt(cells[k]))
            print(f"\nPooled ({skill}, {seats}-handed, hand-weighted):\n")
            print('| slice | pairs | A-B bb/100 | 95% CI | skill acted | field folded |')
            print('|---|---|---|---|---|---|')
            slices = [('all', lambda k: True)]
            for v in ('nlh', 'plo4', 'plo5', 'plo6'):
                slices.append((v, lambda k, v=v: k[2] == v))
            for f in ('cash', 'tournament'):
                slices.append((f, lambda k, f=f: k[3] == f))
            for p in ('standard', 'stations', 'folders', 'mixed'):
                slices.append((p, lambda k, p=p: k[4] == p))
            for name, pred in slices:
                cs = [cells[k] for k in keys if pred(k)]
                if not cs:
                    continue
                n, m, se, a, fo = pooled(cs)
                fold = f"{fo} ({100 * fo / a:.0f}%)" if a else '-'
                print(f"| {name} | {n} | {m:+.2f} +/- {se:.2f} | [{m - 1.96 * se:+.2f}, {m + 1.96 * se:+.2f}] | {a} | {fold} |")
            fires = defaultdict(int)
            for k in keys:
                for f, v in cells[k]['fires'].items():
                    fires[f] += v
            print('\nArm A fire counts: ' + ', '.join(f"{f} {v}" for f, v in sorted(fires.items())))


if __name__ == '__main__':
    main()
