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


# ═══ V2 (2026-11-07): calls, ten-handed, and the ICM (bubble-factor) family ═══
#
#     python3 -I solve.py equity169.tsv --v2 > /tmp/nash-v2.json
#     (wrapped as server/src/engine/HorseNashPushFoldV2.data.ts)
#
# The same jam-or-fold game as solve() above, solved again so the CALLERS'
# side of the equilibrium is kept as well (solve() computes it every round
# and throws it away), for 1..9 players behind (9 = a ten-handed UTG) and
# dead ante 0/1/2bb. B = 1 is the chip-EV equilibrium and reproduces solve()
# exactly.
#
# ICM: for a bubble factor B > 1 (hero's chip LOSS is worth B times its
# gain, the standard push/fold approximation of ICM), the table holds hero's
# BEST RESPONSE with that B against the chip-EV equilibrium of everybody
# else: the jam against the chip-EV callers, the call against the chip-EV
# jam range. Only hero's own risk is repriced (the engine computes hero's B
# from the live stacks and payouts, IcmModel bubbleFactor), so a high B only
# ever tightens hero; it never models a field that folds more because of
# its own ICM, which the engine cannot read per opponent.

V2_ANTES = (0, 1, 2)
V2_BEHIND = range(1, 10)
V2_BUBBLE = (1.0, 1.5, 2.0, 3.0)
ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def solve_v2(E, W, n, S, A, rounds=600):
    """Chip-EV equilibrium, then hero's best response for each bubble factor.

    Returns {B: (jam freq per class, [call freq per class for each caller i])}.
    """
    p_avg = solve(E, W, n, S, A, rounds)
    hero_post = 0.5 if n == 1 else 0.0
    posts = [0.0] * max(0, n - 2) + ([0.5, 1.0] if n >= 2 else [1.0])
    pot0 = 1.5 + A
    Wn = W / COMBOS[:, None] / 1225.0
    WE = Wn * E
    # the callers' equilibrium ranges (chip EV) against p_avg, re-derived the
    # way solve() derives them each round (averaged best response)
    q_avg = _callers_eq(E, W, n, S, A, rounds)
    den = (W.T * p_avg[None, :]).sum(axis=1)
    num = (W.T * (1.0 - E.T) * p_avg[None, :]).sum(axis=1)
    eq_c = np.where(den > 0, num / np.maximum(den, 1e-12), 0.0)
    out = {}
    for B in V2_BUBBLE:
        if B == 1.0:
            out[B] = (p_avg, q_avg)
            continue
        calls = []
        for i in range(n):
            dead = pot0 - hero_post - posts[i]
            call_u = eq_c * (S + dead) - (1.0 - eq_c) * B * S
            calls.append((call_u > -B * posts[i]).astype(float))
        reach = np.ones(169)
        u = np.zeros(169)
        for i in range(n):
            pc = Wn @ q_avg[i]
            eqm = WE @ q_avg[i]
            dead = pot0 - hero_post - posts[i]
            u += reach * (eqm * (S + dead) - (pc - eqm) * B * S)
            reach = reach * (1.0 - pc)
        u += reach * (pot0 - hero_post)
        out[B] = ((u > -B * hero_post).astype(float), calls)
    return out


def _callers_eq(E, W, n, S, A, rounds):
    """solve() with the callers' averaged ranges returned (same iteration)."""
    hero_post = 0.5 if n == 1 else 0.0
    posts = [0.0] * max(0, n - 2) + ([0.5, 1.0] if n >= 2 else [1.0])
    pot0 = 1.5 + A
    Wn = W / COMBOS[:, None] / 1225.0
    WE = Wn * E
    p_avg = np.ones(169) * 0.5
    q_avg = [np.ones(169) * 0.3 for _ in range(n)]
    for t in range(rounds):
        den = (W.T * p_avg[None, :]).sum(axis=1)
        num = (W.T * (1.0 - E.T) * p_avg[None, :]).sum(axis=1)
        eq_c = np.where(den > 0, num / np.maximum(den, 1e-12), 0.0)
        for i in range(n):
            dead = pot0 - hero_post - posts[i]
            br = (eq_c * (2 * S + dead) > S - posts[i]).astype(float)
            q_avg[i] = q_avg[i] + (br - q_avg[i]) / (t + 2)
        reach = np.ones(169)
        ev = np.zeros(169)
        for i in range(n):
            pc = Wn @ q_avg[i]
            eqm = WE @ q_avg[i]
            dead = pot0 - hero_post - posts[i]
            ev += reach * eqm * (2 * S + dead)
            reach = reach * (1.0 - pc)
        ev += reach * (S + pot0 - hero_post)
        br = (ev > S - hero_post).astype(float)
        p_avg = p_avg + (br - p_avg) / (t + 2)
    return q_avg


def upto_code(grid, freqs):
    """Per class, the deepest grid depth reached contiguously from the bottom
    with freq >= 0.5, encoded one character per class (ALPHA[2 * depth])."""
    out = []
    for k in range(169):
        d = 0.0
        for g, fr in zip(grid, freqs):
            if fr[k] >= 0.5:
                d = g
            else:
                break
        out.append(ALPHA[int(round(2 * d))])
    return "".join(out)


def v2_job(args):
    path, n, A = args
    E, W = load(path)
    grid = [x / 2 for x in range(3, 51)]
    per_b = {B: ([], []) for B in V2_BUBBLE}
    for S in grid:
        res = solve_v2(E, W, n, S, A)
        for B in V2_BUBBLE:
            per_b[B][0].append(res[B][0])
            per_b[B][1].append(res[B][1])
    # caller kinds: the unposted seats are identical in this model (first
    # caller only), so one string serves them all; then the SB and the BB.
    idx = {}
    if n >= 3:
        idx["open"] = 0
    if n >= 2:
        idx["sb"] = n - 2
    idx["bb"] = n - 1
    out = []
    for B in V2_BUBBLE:
        jams, calls = per_b[B]
        out.append((f"{n}|{A}|{B:g}", {
            "jam": upto_code(grid, jams),
            "call": {k: upto_code(grid, [c[i] for c in calls]) for k, i in idx.items()},
            "jamPct": [round(float((pr >= 0.5) @ COMBOS) / 13.26, 2) for pr in jams],
            "callPct": {k: [round(float((c[i] >= 0.5) @ COMBOS) / 13.26, 2) for c in calls] for k, i in idx.items()},
        }))
    return out


def main_v2(path):
    from multiprocessing import Pool
    import os

    jobs = [(path, n, A) for A in V2_ANTES for n in V2_BEHIND]
    with Pool(int(os.environ.get("NASH_V2_PROCS", "6"))) as pool:
        results = [kv for part in pool.map(v2_job, jobs) for kv in part]
    grid = [x / 2 for x in range(3, 51)]
    out = {
        "model": "Nash jam-or-fold, first caller only, exact hero/caller card removal; "
        "B > 1: hero's bubble-factor best response to the chip-EV equilibrium",
        "depthGrid": grid,
        "classes": [c for c, _ in CLS],
        "alphabet": ALPHA,
        "bubbleLevels": list(V2_BUBBLE),
        "tables": {},
    }
    for key, val in sorted(results, key=lambda kv: kv[0]):
        out["tables"][key] = val
        print(key, "jam@10/15/20", val["jamPct"][grid.index(10)], val["jamPct"][grid.index(15)],
              val["jamPct"][grid.index(20)], "bbcall@10/20", val["callPct"]["bb"][grid.index(10)],
              val["callPct"]["bb"][grid.index(20)], file=sys.stderr)
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[2] == "--v2":
        main_v2(sys.argv[1])
    else:
        main()
