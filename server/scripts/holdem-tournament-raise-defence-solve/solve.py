"""
Hold'em tournament raise defence: the chip-EV equilibrium of the "open, defend, re-raise" preflop game the three
options holdemTournamentHeadsUpBigBlindDefenceIsPriced / holdemTournamentBlindDefenceIsPriced /
holdemTournamentCommittedRaiseIsPriced are anchored to (2026-11-24, NLH-TOURNAMENT-SWEEP L1/L2/L4).

    python3 -I solve.py <server dir> <realisation.json> <out.data.ts> [workers]

Inputs (all committed): the 169 x 169 class equity table (src/engine/HorseHoldemPreflopClassEquity.data.ts), the
Nash push/fold V2 table (the strength order of the fixed players' ranges and the ring opener's range,
src/engine/HorseNashPushFoldV2.data.ts) and the postflop realisation (realisation.json, written by
realisation-selfplay.ts from SELF-PLAY league hands: every card the engine's own simulated players'; no database is
read and no production card is used).

THE GAME (chip EV, every quantity in big blinds). Two players, the opener O (in position after the flop) and the
defender D (out of position), both with S big blinds at the start of the hand (posts included; S = the effective
stack). O posted po (0.5 when O is the small blind of a heads-up hand or of a ring hand, else 0), D posted pd (1 the
big blind, 0.5 the small blind); Dd is the dead money (antes, and the blinds of players outside the two).
  O first in:      fold | open to o | jam
  D vs the open:   fold | call | 3-bet to t = 3 o (only when t <= S / 2) | jam
  O vs D's jam:    fold | call
  O vs the 3-bet:  fold | call | 4-bet to f = 2.2 t (only when f <= 0.6 S) | jam
  D vs O's jam:    fold | call            (after the 3-bet)
  D vs the 4-bet:  fold | jam (a call of a 4-bet that size commits; it is priced as the jam)
  O vs D's jam:    fold | call            (after the 4-bet)
  D vs O's jam:    fold | call            (O's open-jam)
A call that is not all in ends the game in a postflop pot won in the share the measured realisation gives: the
out-of-position player's share of the pot is a(spr) + b(spr) x his all-in equity (clipped to [0, 1]; the self-play line of realisation.json), the in-position
player has the rest; spr = chips behind / pot after the call. An all-in is settled at the all-in equity.
Ring games (three or more dealt): the other players still to act are FIXED players, a simplified behind-player model
(not solved): each, facing an open, jams with probability J_open; facing a jam, calls with probability J_call;
J_open / J_call start as the heads-up defender's equilibrium jam share against the same open and call share
against an open-jam, then (FIXED_POINT_ROUNDS rounds) become the ring solution's own shares of the other blind as
defender against the same opener (a fixed small blind, or a player between the opener and the blinds, plays the
small-blind defender's shares; a fixed big blind the big-blind defender's) with the top J_call of hands in the Nash caller order. A fixed player who
acts before D (n_pre of them) and wakes up ends the hand for both (O and D fold: O loses o, D his post; a fixed player
calling O's jam plays O all in). After D: a squeeze-jam over D's call (n_post players) folds both; after D's fold a
fixed player's jam over the open folds O; a fixed caller of D's jam plays D all in, O folds; a fixed caller of O's
jam after D folds plays O all in. Card removal is exact between O and D (class combo counts) and ignored for the
fixed players. Re-raises after a 3-bet ignore the fixed players.

THE SOLVE. CFR+ (regret matching plus, alternating updates, linear averaging), ITERATIONS per spot, vectorised over
the 169 classes. Reported per spot: each player's best-response gain against the other's average strategy (bb per
hand: the exploitability of the solution), written into the table header and checked by the law test.

OUTPUT: src/engine/HorseHoldemTournamentRaiseDefenceSolved.data.ts: per spot (kind hu | ring:<players behind the
opener>:<defender sb|bb>, depth, open size, ante) the average strategy of every node (169 x actions, u8 / 255) and the
action values of D's 3-bet and O's 4-bet (int16, 0.01 bb), zlib + base64; plus the fixed-player strength order and the
realisation used.
"""
import base64
import json
import math
import os
import re
import sys
import zlib
from multiprocessing import Pool

import numpy as np

VERSION = "holdem-tournament-raise-defence-solved-v1"
ITERATIONS = 1000
DEPTHS = [6, 8, 10, 12, 14, 17, 20, 25, 30, 40]
OPENS = [2.0, 2.5]
ANTES = [0.0, 1.0]
RING = [(1, "bb"), (2, "sb"), (2, "bb"), (3, "sb"), (3, "bb"), (5, "sb"), (5, "bb")]
FIXED_POINT_ROUNDS = 3
FORCED = [("o_root", "open"), ("d_vs_open", "three_bet"), ("o_vs_3bet", "four_bet")]
FORCE_SHARE = 0.01
REACH_MIN = 0.02
THREE_BET_X = 3.0
FOUR_BET_X = 2.2
THREE_BET_MAX_SHARE = 0.5
FOUR_BET_MAX_SHARE = 0.6
NODES = [
    ("o_root", "O", ["fold", "open", "jam"]),
    ("d_vs_open", "D", ["fold", "call", "three_bet", "jam"]),
    ("o_vs_jam", "O", ["fold", "call"]),
    ("o_vs_3bet", "O", ["fold", "call", "four_bet", "jam"]),
    ("d_vs_jam_3bet", "D", ["fold", "call"]),
    ("d_vs_4bet", "D", ["fold", "jam"]),
    ("o_vs_jam_4bet", "O", ["fold", "call"]),
    ("d_vs_open_jam", "D", ["fold", "call"]),
]
# Stored: every action but fold (fold = the rest), for the nodes the engine reads; the action values of the two
# non-all-in re-raises (the engine prices fold, call and jam itself).
STORED = {"o_root": ["open", "jam"], "d_vs_open": ["call", "three_bet", "jam"], "o_vs_jam": ["call"],
          "o_vs_3bet": ["call", "four_bet", "jam"], "d_vs_jam_3bet": ["call"], "d_vs_4bet": ["jam"],
          "o_vs_jam_4bet": ["call"]}
Q_NODES = [("d_vs_open", "three_bet"), ("o_vs_3bet", "four_bet")]
# Strategy resolution: 1/64 (u8 = round(p x 64) x 4, 255 for 1).
LEVELS = 64
# Generated text is written as string pieces of this length (a few hundred string literals: the engine image build
# parses and emits every source file under a 1 GB heap, and a large object literal costs it far more than a string).
CHUNK = 1000

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
COMBOS = np.array([n for _, n in CLS], dtype=float)


def class_combos(c):
    r1, r2 = RANKS.index(c[0]), RANKS.index(c[1])
    if len(c) == 2:
        return [(r1 * 4 + a, r2 * 4 + b) for a in range(4) for b in range(a + 1, 4)]
    if c.endswith("s"):
        return [(r1 * 4 + s, r2 * 4 + s) for s in range(4)]
    return [(r1 * 4 + a, r2 * 4 + b) for a in range(4) for b in range(4) if a != b]


def compat():
    cc = [class_combos(c) for c, _ in CLS]
    W = np.zeros((169, 169))
    for a in range(169):
        for b in range(169):
            n = 0
            for x in cc[a]:
                for y in cc[b]:
                    if x[0] not in y and x[1] not in y:
                        n += 1
            W[a, b] = n
    return W


def load_equity(server):
    txt = open(os.path.join(server, "src/engine/HorseHoldemPreflopClassEquity.data.ts")).read()
    body = txt.split("U16_BASE64: string = [", 1)[1].split("].join", 1)[0]
    raw = base64.b64decode("".join(re.findall(r"'([^']*)'", body)))
    E = np.frombuffer(raw, dtype="<u2").astype(float).reshape(169, 169) / 65535.0
    return E


def nash_tables(server):
    txt = open(os.path.join(server, "src/engine/HorseNashPushFoldV2.data.ts")).read()
    alpha = re.search(r"alphabet: '([^']*)'", txt).group(1)
    out = {}
    for b in range(1, 10):
        for a in (0, 1, 2):
            key = "%d|%d|1" % (b, a)
            if "'" + key + "': {" not in txt:
                continue
            blk = txt.split("'" + key + "': {", 1)[1]
            jam = re.search(r"jam: '([^']*)'", blk).group(1)
            out[(b, a)] = [alpha.index(ch) / 2 for ch in jam]
    return out


def strength_order(server):
    """STRENGTH_ORDER of HorseHoldemTournamentAllInCall.ts, read from the Nash V2 table."""
    txt = open(os.path.join(server, "src/engine/HorseNashPushFoldV2.data.ts")).read()
    alpha = re.search(r"alphabet: '([^']*)'", txt).group(1)

    def table(key):
        blk = txt.split("'" + key + "': {", 1)[1]
        jam = re.search(r"jam: '([^']*)'", blk).group(1)
        bb = re.search(r"bb: '([^']*)'", blk).group(1)
        return jam, bb

    _, c8 = table("8|0|1")
    _, c1 = table("1|0|1")
    j9, _ = table("9|0|1")
    key = [(alpha.index(c8[i]), alpha.index(c1[i]), alpha.index(j9[i])) for i in range(169)]
    return sorted(range(169), key=lambda i: (-key[i][0], -key[i][1], -key[i][2], i))


def top_range(order, width):
    out = np.zeros(169)
    left = max(0.0, min(1.0, width)) * 1326
    for i in order:
        if left <= 0:
            break
        n = COMBOS[i]
        out[i] = min(1.0, left / n)
        left -= n
    return out


class Term:
    __slots__ = ("WUO", "WUD")

    def __init__(self, Wn, UO, UD):
        UO = np.broadcast_to(np.asarray(UO, dtype=float), (169, 169))
        UD = np.broadcast_to(np.asarray(UD, dtype=float), (169, 169))
        self.WUO = Wn * UO
        self.WUD = Wn * UD


class Chance:
    __slots__ = ("kids",)

    def __init__(self, kids):
        self.kids = [(p, k) for p, k in kids if p > 1e-12]


class Dec:
    __slots__ = ("name", "player", "actions", "kids", "R", "S", "Su", "q", "lastq", "force", "fixed", "reach")

    def __init__(self, name, player, pairs):
        self.name = name
        self.player = player
        self.actions = [a for a, _ in pairs]
        self.kids = [k for _, k in pairs]
        self.R = np.zeros((169, len(pairs)))
        self.S = np.zeros((169, len(pairs)))
        self.Su = np.zeros((169, len(pairs)))
        self.q = None
        self.lastq = None
        self.fixed = None
        self.reach = None
        self.force = [self.actions.index(a) for (nm, a) in FORCED if nm == name and a in self.actions]

    def sigma(self):
        if self.fixed is not None:
            return self.fixed
        R = self.R
        tot = R.sum(axis=1, keepdims=True)
        k = R.shape[1]
        return np.where(tot > 0, R / np.maximum(tot, 1e-300), 1.0 / k)

    def avg(self, unforced=False):
        if self.fixed is not None and not self.S.any():
            return self.fixed.copy()
        S = self.Su if unforced else self.S
        tot = S.sum(axis=1, keepdims=True)
        return np.where(tot > 0, S / np.maximum(tot, 1e-300), np.nan)


def force(sg, reach, lastq, a):
    """At least FORCE_SHARE of the combos reaching the node take action a: the classes that lose least by it (the
    last pass's action values), so the reply to a rarely used action is a best reply to the hands that would use it
    (an epsilon-proper refinement; the reply to an action never taken is otherwise undefined)."""
    w = reach * COMBOS
    tot = w.sum()
    if not (tot > 0):
        return sg
    have = (sg[:, a] * w).sum()
    need = FORCE_SHARE * tot - have
    if need <= 0:
        return sg
    loss = lastq.max(axis=1) - lastq[:, a]
    out = sg.copy()
    for v in np.argsort(loss, kind="stable"):
        if need <= 0:
            break
        if w[v] <= 0 or out[v, a] >= 1:
            continue
        add = min(1 - out[v, a], need / w[v])
        rest = 1 - out[v, a]
        scale = (rest - add) / rest if rest > 0 else 0.0
        for j in range(out.shape[1]):
            if j != a:
                out[v, j] *= scale
        out[v, a] += add
        need -= add * w[v]
    return out


def walk(n, rO, rD, trav, t):
    if isinstance(n, Term):
        return n.WUO @ rD, n.WUD.T @ rO
    if isinstance(n, Chance):
        vO = np.zeros(169)
        vD = np.zeros(169)
        for p, k in n.kids:
            a, b = walk(k, rO, rD, trav, t)
            vO += p * a
            vD += p * b
        return vO, vD
    su = n.sigma()
    sg = su
    reach = rO if n.player == "O" else rD
    if n.force and n.lastq is not None and n.fixed is None:
        for a in n.force:
            sg = force(sg, reach, n.lastq, a)
    vals = []
    for i, k in enumerate(n.kids):
        if n.player == "O":
            vals.append(walk(k, rO * sg[:, i], rD, trav, t))
        else:
            vals.append(walk(k, rO, rD * sg[:, i], trav, t))
    own = 0 if n.player == "O" else 1
    other = 1 - own
    if n.force:
        norm = WN @ rD if own == 0 else WN.T @ rO
        st = np.stack([v[own] for v in vals], axis=1)
        n.lastq = np.where(norm[:, None] > 1e-15, st / np.maximum(norm[:, None], 1e-300), 0.0)
    vown = sum(sg[:, i] * vals[i][own] for i in range(len(vals)))
    voth = sum(vals[i][other] for i in range(len(vals)))
    if trav == n.player and n.fixed is None:
        for i in range(len(vals)):
            n.R[:, i] = np.maximum(n.R[:, i] + vals[i][own] - vown, 0.0)
        n.S += t * reach[:, None] * sg
        n.Su += t * reach[:, None] * su
    return (vown, voth) if own == 0 else (voth, vown)


def strat(n):
    a = n.avg(unforced=True)
    # A class that reaches the node with less than REACH_MIN of its combos (its own actions on the way: off the
    # equilibrium path, or only by the epsilon forcing) has an average built from almost no updates: it plays the best
    # response to the opponent's average instead.
    bad = np.isnan(a[:, 0]) | (n.reach < REACH_MIN)
    if bad.any():
        # Never reached: the best response to the opponent's average (action values of the final pass).
        q = n.q
        best = np.zeros_like(a)
        best[np.arange(169), np.argmax(q, axis=1)] = 1.0
        a[bad] = best[bad]
    return a


def evaluate(n, rO, rD, cp, br=None):
    """Values with average strategies; br = 'O' or 'D' takes that player's best response instead. Stores n.q
    (action values per class, conditional on reaching the node with that class) on the final pass."""
    if isinstance(n, Term):
        return n.WUO @ rD, n.WUD.T @ rO
    if isinstance(n, Chance):
        vO = np.zeros(169)
        vD = np.zeros(169)
        for p, k in n.kids:
            a, b = evaluate(k, rO, rD, cp * p, br)
            vO += p * a
            vD += p * b
        return vO, vD
    own = 0 if n.player == "O" else 1
    if br == n.player and n.fixed is None:
        vals = [evaluate(k, rO, rD, cp, br) for k in n.kids]
        stack = np.stack([v[own] for v in vals], axis=1)
        vown = stack.max(axis=1)
        voth = sum(v[1 - own] for v in vals)
        return (vown, voth) if own == 0 else (voth, vown)
    sg = n.avg()
    sg = np.where(np.isnan(sg), 1.0 / sg.shape[1], sg)
    vals = []
    for i, k in enumerate(n.kids):
        if n.player == "O":
            vals.append(evaluate(k, rO * sg[:, i], rD, cp, br))
        else:
            vals.append(evaluate(k, rO, rD * sg[:, i], cp, br))
    if br is None:
        n.reach = (rO if n.player == "O" else rD).copy()
        # Normaliser: the opponent's reach weight against each class (with the chance product).
        Wn = WN
        opp = rD if n.player == "O" else rO
        norm = (Wn @ opp) * cp if n.player == "O" else (Wn.T @ opp) * cp
        stack = np.stack([v[own] for v in vals], axis=1)
        n.q = np.where(norm[:, None] > 1e-15, stack / np.maximum(norm[:, None], 1e-300), 0.0)
    vown = sum(sg[:, i] * vals[i][own] for i in range(len(vals)))
    voth = sum(vals[i][1 - own] for i in range(len(vals)))
    return (vown, voth) if own == 0 else (voth, vown)


def share_oop(e, spr):
    xs = REAL["sprCentres"]
    a = np.interp(spr, xs, REAL["a"])
    b = np.interp(spr, xs, REAL["b"])
    return np.clip(a + b * e, 0.0, 1.0)


def build(S, o, A, ring, hu_shares):
    """ring: None (heads-up) or (players behind the opener, 'sb' | 'bb')."""
    E = EQ
    Wn = WN
    if ring is None:
        po, pd, Dd = 0.5, 1.0, A
        n_pre = n_post = 0
        Jo = Jc = 0.0
        pf = 0.0
    else:
        k, dside = ring
        po = 0.5 if k == 1 else 0.0
        pd = 1.0 if dside == "bb" else 0.5
        if k == 1:
            n_pre, n_post, Dd, pf = 0, 0, A, 0.0
        elif dside == "bb":
            n_pre, n_post, Dd, pf = k - 1, 0, A + 0.5, 0.5 / (k - 1)
        else:
            n_pre, n_post, Dd, pf = k - 2, 1, A + 1.0, 1.0
        Jo, Jc = hu_shares
    topc = top_range(ORDER, Jc)
    den = WN @ topc
    Etop = np.where(den > 0, (WN * EQ) @ topc / np.maximum(den, 1e-300), 0.5)
    allin_O = E * (2 * S + Dd) - S
    allin_D = (1 - E) * (2 * S + Dd) - S
    pre_keep_o = (1 - Jo) ** n_pre
    post_keep_o = (1 - Jo) ** n_post
    pre_keep_c = (1 - Jc) ** n_pre
    post_keep_c = (1 - Jc) ** n_post
    potw = 2 * S + Dd + pd - pf  # O all in against a fixed caller, D folded
    T = lambda uo, ud: Term(Wn, uo, ud)
    O_called_by_fixed = T((Etop * potw - S)[:, None], -pd)
    t = THREE_BET_X * o
    f = FOUR_BET_X * t
    # D vs O's open-jam.
    d_vs_open_jam = Dec("d_vs_open_jam", "D", [
        ("fold", Chance([(1 - post_keep_c, O_called_by_fixed), (post_keep_c, T(pd + Dd, -pd))])),
        ("call", T(allin_O, allin_D)),
    ])
    # The open is called: postflop.
    spr1 = (S - o) / (2 * o + Dd)
    shD1 = share_oop(1 - E, spr1)
    call1 = T((1 - shD1) * (2 * o + Dd) - o, shD1 * (2 * o + Dd) - o)
    o_vs_jam = Dec("o_vs_jam", "O", [("fold", T(-o, o + Dd)), ("call", T(allin_O, allin_D))])
    d_pairs = [
        ("fold", Chance([(1 - post_keep_o, T(-o, -pd)), (post_keep_o, T(pd + Dd, -pd))])),
        ("call", Chance([(1 - post_keep_o, T(-o, -o)), (post_keep_o, call1)])),
    ]
    if t <= THREE_BET_MAX_SHARE * S:
        spr3 = (S - t) / (2 * t + Dd)
        shD3 = share_oop(1 - E, spr3)
        call3 = T((1 - shD3) * (2 * t + Dd) - t, shD3 * (2 * t + Dd) - t)
        d_vs_jam_3bet = Dec("d_vs_jam_3bet", "D", [("fold", T(t + Dd, -t)), ("call", T(allin_O, allin_D))])
        o3 = [("fold", T(-o, o + Dd)), ("call", call3)]
        if f <= FOUR_BET_MAX_SHARE * S:
            o_vs_jam_4bet = Dec("o_vs_jam_4bet", "O", [("fold", T(-f, f + Dd)), ("call", T(allin_O, allin_D))])
            d_vs_4bet = Dec("d_vs_4bet", "D", [("fold", T(t + Dd, -t)), ("jam", o_vs_jam_4bet)])
            o3.append(("four_bet", d_vs_4bet))
        o3.append(("jam", d_vs_jam_3bet))
        d_pairs.append(("three_bet", Dec("o_vs_3bet", "O", o3)))
    Dpot = S * 2 + o + Dd - pf  # D all in against a fixed caller, O folded
    D_called_by_fixed = T(-o, (Etop * Dpot - S)[None, :])
    d_pairs.append(("jam", Chance([(1 - post_keep_c, D_called_by_fixed), (post_keep_c, o_vs_jam)])))
    d_vs_open = Dec("d_vs_open", "D", d_pairs)
    root = Dec("o_root", "O", [
        ("fold", T(-po, -pd)),
        ("open", Chance([(1 - pre_keep_o, T(-o, -pd)), (pre_keep_o, d_vs_open)])),
        ("jam", Chance([(1 - pre_keep_c, O_called_by_fixed), (pre_keep_c, d_vs_open_jam)])),
    ])
    if ring is not None and ring[0] >= 2:
        # Ring opener (not the small blind): his non-all-in open range is FIXED at his chip-EV Nash jam range for his
        # players behind, depth (25bb at most: the table's end) and dead ante (HorseNashPushFoldV2, the engine's own table): with the blinds and the
        # players between as fixed players the opener's open is not reliably solvable here (the solve leaves it
        # unused and the defence would answer an arbitrary sliver of hands). The defence and the opener's later
        # replies are the equilibrium of the game from the open on, given that range.
        p = nash_jam(ring[0], S, A)
        root.fixed = np.stack([1 - p, p, np.zeros(169)], axis=1)
    return root


def nash_jam(behind, S, A):
    """1 where the class jams at depth S in the Nash V2 table (players behind, dead ante A, no bubble factor); the
    table ends at 25bb, so a deeper opener is given his 25bb range."""
    jam = NASH[(min(9, behind), int(round(A)))]
    d = min(S, NASH_MAX_DEPTH)
    return np.array([1.0 if jam[i] >= d - 1e-9 else 0.0 for i in range(169)])


NASH_MAX_DEPTH = 25.0


def decs(n, out=None):
    out = {} if out is None else out
    if isinstance(n, Dec):
        out[n.name] = n
        for k in n.kids:
            decs(k, out)
    elif isinstance(n, Chance):
        for _, k in n.kids:
            decs(k, out)
    return out


def solve_spot(args):
    S, o, A, ring, hu_shares = args
    root = build(S, o, A, ring, hu_shares)
    ones = np.ones(169)
    for it in range(1, ITERATIONS + 1):
        walk(root, ones, ones, "O", it)
        walk(root, ones, ones, "D", it)
    vO, vD = evaluate(root, ones, ones, 1.0)
    bO, _ = evaluate(root, ones, ones, 1.0, br="O")
    _, bD = evaluate(root, ones, ones, 1.0, br="D")
    gainO = float(bO.sum() - vO.sum())
    gainD = float(bD.sum() - vD.sum())
    nodes = decs(root)
    # The forced averages (the epsilon-forced action included): the range the reply to a rarely used action answers.
    forced = {}
    for n in nodes.values():
        if n.force:
            fa = n.avg()
            fa = np.where(np.isnan(fa), 0.0, fa)
            forced[n.name] = {n.actions[a]: fa[:, a].tolist() for a in n.force}
    # The tables as stored (unforced average, never-reached classes by best response, 1/64 steps): each player's
    # best-response gain against the other playing them, the number the law test checks.
    for n in nodes.values():
        st = strat(n)
        q = np.round(st * LEVELS) / LEVELS
        fold = 1 - q[:, 1:].sum(axis=1)
        q[:, 0] = np.maximum(fold, 0)
        q = q / q.sum(axis=1, keepdims=True)
        n.S = q.copy()
    qO, qD = evaluate(root, ones, ones, 1.0)
    qbO, _ = evaluate(root, ones, ones, 1.0, br="O")
    _, qbD = evaluate(root, ones, ones, 1.0, br="D")
    gainOq = float(qbO.sum() - qO.sum())
    gainDq = float(qbD.sum() - qD.sum())
    out = {"S": S, "o": o, "A": A, "ring": ring, "valueO": float(vO.sum()), "valueD": float(vD.sum()),
           "fixed": None if hu_shares is None else [round(float(x), 5) for x in hu_shares],
           "gainO": gainO, "gainD": gainD, "gainOq": gainOq, "gainDq": gainDq, "nodes": {}}
    for name, n in nodes.items():
        out["nodes"][name] = {"actions": n.actions, "strategy": n.S.tolist(), "q": n.q.tolist(),
                              "forced": forced.get(name, {})}
    return out


def shares(sol):
    """Combo-weighted shares of D's jam (and non-all-in 3-bet) against the open and D's call against an open-jam
    (fixed players)."""
    n = sol["nodes"]
    dv = np.array(n["d_vs_open"]["strategy"])
    acts = n["d_vs_open"]["actions"]
    jam = dv[:, acts.index("jam")] + (dv[:, acts.index("three_bet")] if "three_bet" in acts else 0)
    call = np.array(n["d_vs_open_jam"]["strategy"])[:, 1]
    return float((jam * COMBOS).sum() / 1326), float((call * COMBOS).sum() / 1326)


def init(server, realpath):
    global EQ, WN, ORDER, REAL, NASH
    NASH = nash_tables(server)
    EQ = load_equity(server)
    W = compat()
    WN = W / W.sum()
    ORDER = strength_order(server)
    REAL = json.load(open(realpath))


def main():
    server, realpath, outpath = sys.argv[1], sys.argv[2], sys.argv[3]
    workers = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    init(server, realpath)
    hu_args = [(S, o, A, None, None) for A in ANTES for o in OPENS for S in DEPTHS]
    with Pool(workers, initializer=init, initargs=(server, realpath)) as pool:
        hu = pool.map(solve_spot, hu_args)
        hu_by = {(r["S"], r["o"], r["A"]): r for r in hu}
        # The fixed players start from the heads-up shares, then take the ring solution's own: a fixed small blind
        # (or a player between the opener and the blinds) plays the shares the small-blind defender solved for the
        # same opener, depth, size and ante; a fixed big blind the big-blind defender's (FIXED_POINT_ROUNDS rounds).
        keys = [(S, o, A, ring) for ring in RING for A in ANTES for o in OPENS for S in DEPTHS]
        sh = {key: shares(hu_by[key[:3]]) for key in keys}
        for _ in range(FIXED_POINT_ROUNDS):
            ring_res = pool.map(solve_spot, [key + (sh[key],) for key in keys])
            by = {(r["S"], r["o"], r["A"], tuple(r["ring"])): r for r in ring_res}
            for key in keys:
                k, side = key[3]
                if k == 1:
                    continue
                other = (key[0], key[1], key[2], (k, "sb" if side == "bb" else "bb"))
                if other in by:
                    sh[key] = shares(by[other])
            print("fixed-point round done", flush=True)
    write(outpath, hu + ring_res, realpath)
    if len(sys.argv) > 5:
        json.dump(hu + ring_res, open(sys.argv[5], "w"))


def write(outpath, sols, realpath):
    blobs = bytearray()
    index = []
    worst = 0.0
    for s in sols:
        kind = "hu" if s["ring"] is None else "ring:%d:%s" % tuple(s["ring"])
        worst = max(worst, s["gainOq"], s["gainDq"])
        entry = {"kind": kind, "S": s["S"], "o": s["o"], "A": s["A"], "gainO": round(s["gainOq"], 5),
                 "gainD": round(s["gainDq"], 5), "fixed": s["fixed"], "offset": len(blobs), "nodes": {}}
        for name, _, acts in NODES:
            nd = s["nodes"].get(name)
            if nd is None or name not in STORED:
                continue
            keep = [a for a in STORED[name] if a in nd["actions"]]
            st = np.array(nd["strategy"])[:, [nd["actions"].index(a) for a in keep]]
            q = np.round(st * LEVELS)
            u8 = np.where(q >= LEVELS, 255, q * (256 // LEVELS)).astype(np.uint8)
            entry["nodes"][name] = {"actions": keep, "at": len(blobs)}
            blobs += u8.T.tobytes()  # action-major: 169 bytes per stored action
            for a, col in nd.get("forced", {}).items():
                c = np.round(np.array(col) * LEVELS)
                entry["nodes"][name]["f_" + a] = len(blobs)
                blobs += np.where(c >= LEVELS, 255, c * (256 // LEVELS)).astype(np.uint8).tobytes()
        for name, act in Q_NODES:
            nd = s["nodes"].get(name)
            if nd is None or act not in nd["actions"]:
                continue
            q = np.array(nd["q"])[:, nd["actions"].index(act)]
            i16 = np.clip(np.round(q * 100), -32768, 32767).astype("<i2")
            entry["nodes"][name]["q_" + act] = len(blobs)
            blobs += i16.tobytes()
        index.append(entry)
    comp = base64.b64encode(zlib.compress(bytes(blobs), 9)).decode()
    real = json.load(open(realpath))
    lines = [comp[i:i + CHUNK] for i in range(0, len(comp), CHUNK)]
    with open(outpath, "w") as fh:
        fh.write("/**\n * GENERATED by server/scripts/holdem-tournament-raise-defence-solve/solve.py (CFR+, %d iterations per spot).\n" % ITERATIONS)
        fh.write(" * Do not edit by hand. The chip-EV equilibrium of the open / defend / re-raise game (model: the script header).\n")
        fh.write(" * Worst best-response gain of either player against the other playing these tables (as stored), over\n")
        fh.write(" * every spot: %.4f bb per hand.\n */\n" % worst)
        fh.write("export const HOLDEM_RAISE_DEFENCE_SOLVED_VERSION = '%s' as const;\n" % VERSION)
        fh.write("export const HOLDEM_RAISE_DEFENCE_SOLVED_ITERATIONS = %d;\n" % ITERATIONS)
        fh.write("export const HOLDEM_RAISE_DEFENCE_SOLVED_WORST_GAIN_BB = %.5f;\n" % worst)
        fh.write("export const HOLDEM_RAISE_DEFENCE_SOLVED_GRID = %s as const;\n" % json.dumps(
            {"depths": DEPTHS, "opens": OPENS, "antes": ANTES, "ring": [list(r) for r in RING],
             "threeBetX": THREE_BET_X, "fourBetX": FOUR_BET_X, "threeBetMaxShare": THREE_BET_MAX_SHARE,
             "fourBetMaxShare": FOUR_BET_MAX_SHARE}))
        fh.write("/** The fixed players' strength order (STRENGTH_ORDER of HorseHoldemTournamentAllInCall). */\n")
        fh.write("export const HOLDEM_RAISE_DEFENCE_SOLVED_ORDER: readonly number[] = %s;\n" % json.dumps(ORDER))
        fh.write("/** The self-play realisation the solve used (realisation-selfplay.ts). */\n")
        fh.write("export const HOLDEM_RAISE_DEFENCE_REALISATION = %s as const;\n" % json.dumps(
            {"version": real["version"], "sprCentres": real["sprCentres"], "a": real["a"], "b": real["b"],
             "n": real["n"]}))
        fh.write("export interface SolvedSpotIndex { kind: string; S: number; o: number; A: number; gainO: number; gainD: number; fixed: [number, number] | null; offset: number;\n")
        fh.write("  nodes: Record<string, { actions: string[]; at: number; q_three_bet?: number; q_four_bet?: number; f_open?: number; f_three_bet?: number; f_four_bet?: number }> }\n")
        # The index as JSON text in CHUNK-character pieces (parsed once by the reader): an object literal of 320 spots
        # costs the engine image's type check (1 GB heap) far more than a string does.
        ij = json.dumps(index, separators=(",", ":"))
        fh.write("/** The spot index (SolvedSpotIndex[]), JSON text; HorseHoldemTournamentRaiseDefenceSolved parses it. */\n")
        fh.write("export const HOLDEM_RAISE_DEFENCE_SOLVED_INDEX_JSON: string = [\n")
        assert "'" not in ij and "\\" not in ij
        for k in range(0, len(ij), CHUNK):
            fh.write("  '%s',\n" % ij[k:k + CHUNK])
        fh.write("].join('');\n")
        fh.write("/** zlib (deflate) of the strategy bytes (u8 / 255, multiples of 1/64; action-major, 169 per stored action,\n")
        fh.write(" * fold = the rest; f_<action>: the epsilon-forced average of a rarely used action, the range the opponent's\n")
        fh.write(" * reply to it answers) and action values (int16 LE, 0.01 bb). */\n")
        fh.write("export const HOLDEM_RAISE_DEFENCE_SOLVED_Z64: string = [\n")
        for ln in lines:
            fh.write("  '%s',\n" % ln)
        fh.write("].join('');\n")
    print("spots", len(sols), "bytes", len(blobs), "zlib b64", len(comp), "worst gain", worst)


if __name__ == "__main__":
    main()
