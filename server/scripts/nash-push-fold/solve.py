"""
V71 (2026-10-31): chip-EV Nash push/fold for an unopened hold'em pot.

    python3 -I solve.py equity169.tsv > /tmp/nash.json
    (wrapped as server/src/engine/HorseNashPushFold.data.ts, NASH_PUSH_FOLD,
    then npx prettier --write; a .ts module because the engine image emits
    with noResolve and only lists its JSON resources explicitly)

Model (the standard "jam or fold, first caller only" chip-EV game, as used by
the classic Nash push/fold charts, e.g. HoldemResources Calculator's chip-EV
mode and the SAGE/Nash tables; see the V71 changelog):

  * Every live stack is S big blinds INCLUDING any blind it posted (the depth
    HorseLogic measures as (stack + bet) / bb). Antes are dead money already
    in the pot, A big blinds in total (A = 1 for a big-blind ante).
  * Hero, folded to, either jams S or folds. n players are still to act
    behind (n-2 unposted seats, then the SB and the BB; n = 1 is the SB
    against the BB). Each caller, in turn, calls or folds; the first call
    closes the action (an overcall is not modelled).
  * EV is chips at the end of the hand. Card removal between hero and each
    caller is exact (compatible combo counts); callers are independent.
  * Equilibrium by averaged best response (fictitious play), 600 rounds.

Output: per (players behind 1..8, dead ante 0 | 1 | 2 bb): for each of the 169 classes,
the deepest grid depth (0.5bb steps, 1.5..25) at which the hand still jams
at every depth from the bottom of the grid up to it (the "push up to X bb"
form of the classic charts) at dead antes A = 0, 1 and 2 big blinds, plus the combo-weighted jam share per depth.
"""
import json
import sys

import numpy as np

RANKS = "AKQJT98765432"


def classes():
    out = []
    for i in range(13):
        for j in range(13):
            if i == j:
                out.append((RANKS[i] + RANKS[j], 6))
            elif j > i:
                out.append((RANKS[i] + RANKS[j] + "s", 4))
            else:
                out.append((RANKS[j] + RANKS[i] + "o", 12))
    return out


CLS = classes()
IDX = {c: k for k, (c, _) in enumerate(CLS)}
COMBOS = np.array([n for _, n in CLS], dtype=float)


def load(path):
    E = np.zeros((169, 169))
    W = np.zeros((169, 169))
    with open(path) as f:
        for line in f:
            a, b, e, w = line.split("\t")
            E[IDX[a], IDX[b]] = float(e) if e != "nan" else 0.5
            W[IDX[a], IDX[b]] = float(w)
    return E, W


def solve(E, W, n, S, A, rounds=600):
    """n players behind; returns hero jam frequency per class."""
    # posted blinds: hero posts 0.5 when he is the SB (n == 1), else 0.
    hero_post = 0.5 if n == 1 else 0.0
    posts = [0.0] * max(0, n - 2) + ([0.5, 1.0] if n >= 2 else [1.0])
    pot0 = 1.5 + A  # blinds + dead ante
    # Wn[a, b]: probability a specific a-combo faces b (combo pair count / combos(a) / 1225)
    Wn = W / COMBOS[:, None] / 1225.0
    WE = Wn * E
    p = np.ones(169) * 0.5
    q = [np.ones(169) * 0.3 for _ in range(n)]
    p_avg = p.copy()
    q_avg = [x.copy() for x in q]
    for t in range(rounds):
        # callers' best responses to the average jam range
        WT = Wn.T  # [b, a]: weight of a given b, up to a per-b constant
        den = (W.T * p_avg[None, :]).sum(axis=1)  # sum_a W[a,b] p[a]
        num = (W.T * (1.0 - E.T) * p_avg[None, :]).sum(axis=1)  # caller equity = 1 - E[a,b]
        eq_c = np.where(den > 0, num / np.maximum(den, 1e-12), 0.0)
        for i in range(n):
            dead = pot0 - hero_post - posts[i]
            call_ev = eq_c * (2 * S + dead)
            fold_ev = S - posts[i]
            br = (call_ev > fold_ev).astype(float)
            q_avg[i] = q_avg[i] + (br - q_avg[i]) / (t + 2)
        # hero's best response to the average calling ranges
        reach = np.ones(169)
        ev = np.zeros(169)
        for i in range(n):
            pc = Wn @ q_avg[i]  # P(caller i holds a calling hand | hero class)
            eqm = WE @ q_avg[i]  # P(calls) * E[equity | calls]
            dead = pot0 - hero_post - posts[i]
            ev += reach * eqm * (2 * S + dead)
            reach = reach * (1.0 - pc)
        ev += reach * (S + pot0 - hero_post)
        fold = S - hero_post
        br = (ev > fold).astype(float)
        p_avg = p_avg + (br - p_avg) / (t + 2)
    return p_avg


def main():
    E, W = load(sys.argv[1])
    grid = [x / 2 for x in range(3, 51)]  # 1.5 .. 25
    out = {
        "model": "chip-EV Nash jam-or-fold, first caller only, exact hero/caller card removal",
        "depthGrid": grid,
        "classes": [c for c, _ in CLS],
        "tables": {},
    }
    for A in (0, 1, 2):
        for n in range(1, 9):
            pushes = [solve(E, W, n, S, A) for S in grid]
            upto = []
            for k in range(169):
                d = 0.0
                for g, pr in zip(grid, pushes):
                    if pr[k] >= 0.5:
                        d = g
                    else:
                        break
                upto.append(d)
            widths = [round(float((pr >= 0.5) @ COMBOS) / 13.26, 2) for pr in pushes]
            key = f"{n}|{A}"
            out["tables"][key] = {"pushUpTo": upto, "jamPct": widths}
            print(key, "w@5/10/15", widths[grid.index(5)], widths[grid.index(10)], widths[grid.index(15)], file=sys.stderr)
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
