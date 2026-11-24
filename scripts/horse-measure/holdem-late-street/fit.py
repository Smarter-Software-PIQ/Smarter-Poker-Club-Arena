#!/usr/bin/env python3
"""Fit the population priors of holdemLateStreetIsPriced from responses.sql rows (pull.py output).

Heads-up at the bettor's decision (2 players not folded), first wager of the street on the turn or the river
(toCall 0 at the bettor): the defender's next action on that street is a fold or not. Line of the bettor from the
street before: checkthrough (no wager), barrel (his own last wager), lead (the other player's), other. Size s = bet
over the pot before it, buckets <=1/3, <=2/3, <=pot, over. Fold to a raise: the first bettor's answer to a raise of
his bet on that street. Both populations (Horse and person decisions) together; the model reads "his record, else
this prior" and never branches on who he is. Writes server/src/engine/HorseHoldemLateStreetPriors.ts.

Flop (holdemFlopIsPriced, cash and Lightning): rows of flop-responses.sql after --flop, cash hands only (tourn false);
the bettor's "line" is his preflop role: barrel = he made the last preflop raise (a c-bet), lead = another player did,
checkthrough = nobody raised (a limped pot).

Bet share (the share of spots a player bets when the street's first wager is his to make), heads-up, by street,
his line and whether he is first to act or checked to: rows of reached-flop.sql after --reach (NLH cash hands that
reached the flop, whatever was bet, so a checked street is counted). The opponent line range keeps this share of his
range for his wager (HOLDEM_LATE_BET_SHARE_PRIOR); his own record moves it.

Usage: fit.py <version tag> <out.ts> <rows.ndjson>... [--flop <flop rows.ndjson>...] [--reach <reach rows.ndjson>...]
"""
import json, sys
version, out, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
def group(flag):
    if flag not in rest: return []
    i = rest.index(flag) + 1
    j = next((k for k in range(i, len(rest)) if rest[k].startswith('--')), len(rest))
    return rest[i:j]
files = rest[:next((k for k, a in enumerate(rest) if a.startswith('--')), len(rest))]
flop_files = group('--flop')
reach_files = group('--reach')
LINES = ['checkthrough', 'barrel', 'lead', 'other']
def bucket(s): return 0 if s <= 0.34 else 1 if s <= 0.67 else 2 if s <= 1.01 else 3
STREETS = ('flop', 'turn', 'river')
cnt = {st: {ln: [[0, 0] for _ in range(4)] for ln in LINES} for st in STREETS}
rcnt = {st: [0, 0] for st in STREETS}
hands = 0
flop_hands = 0
seen = set()
def is_pf_raise(a): return a.get('a') == 'raise' or (a.get('a') == 'all_in' and (a.get('m') or 0) > (a.get('t') or 0))
for fn, pairs in [(f, (('turn', 'flop'), ('river', 'turn'))) for f in files] + [(f, (('flop', 'preflop'),)) for f in flop_files]:
    for line in open(fn):
        r = json.loads(line); acts = r.get('acts') or []
        key = (pairs[0][0] == 'flop', r.get('id'))
        if key in seen: continue  # overlapping pulls: each hand once
        seen.add(key)
        if pairs[0][0] == 'flop':
            if r.get('tourn'): continue
            flop_hands += 1
        else: hands += 1
        by = {}
        for a in acts: by.setdefault(a.get('s'), []).append(a)
        for st, prev in pairs:
            A = by.get(st) or []
            if prev == 'preflop': pw = [a for a in by.get(prev) or [] if is_pf_raise(a)]
            else: pw = [a for a in by.get(prev) or [] if a.get('a') in ('bet', 'raise', 'all_in') and (a.get('m') or 0) > 0]
            for i, a in enumerate(A):
                if a.get('a') not in ('bet', 'all_in') or not (a.get('m') or 0) > 0: continue
                if (a.get('t') or 0) > 0 or (a.get('n') or 0) != 2 or not (a.get('p') or 0) > 0: continue
                ln = 'checkthrough' if not pw else ('barrel' if pw[-1].get('u') == a.get('u') else 'lead')
                if not by.get(prev): ln = 'other'
                s = a['m'] / a['p']
                resp = next((b for b in A[i + 1:] if b.get('u') != a.get('u') and b.get('a') in ('fold', 'call', 'raise', 'all_in')), None)
                if resp is None: break
                c = cnt[st][ln][bucket(s)]; c[0] += 1; c[1] += resp.get('a') == 'fold'
                if resp.get('a') in ('raise', 'all_in') and (resp.get('m') or 0) > a['m']:
                    back = next((b for b in A[A.index(resp) + 1:] if b.get('u') == a.get('u')), None)
                    if back is not None:
                        rcnt[st][0] += 1; rcnt[st][1] += back.get('a') == 'fold'
                break
bs = {st: {ln: {'first': [0, 0], 'checkedTo': [0, 0]} for ln in LINES} for st in STREETS}
reach_hands = 0
seen_r = set()
for fn in reach_files:
    for line in open(fn):
        r = json.loads(line)
        if r.get('tourn') or r.get('id') in seen_r: continue
        seen_r.add(r.get('id')); reach_hands += 1
        by = {}
        for a in r.get('acts') or []: by.setdefault(a.get('s'), []).append(a)
        for st in STREETS:
            prev = {'flop': 'preflop', 'turn': 'flop', 'river': 'turn'}[st]
            A = [a for a in by.get(st) or [] if a.get('a') in ('bet', 'check', 'raise', 'all_in', 'call', 'fold')]
            if not A or (A[0].get('n') or 0) != 2: continue
            if prev == 'preflop': pw = [a for a in by.get(prev) or [] if is_pf_raise(a)]
            else: pw = [a for a in by.get(prev) or [] if a.get('a') in ('bet', 'raise', 'all_in') and (a.get('m') or 0) > 0]
            def line_of(u):
                if not by.get(prev): return 'other'
                if not pw: return 'checkthrough'
                return 'barrel' if pw[-1].get('u') == u else 'lead'
            for pos, a in (('first', A[0]), ('checkedTo', A[1] if len(A) > 1 and A[0].get('a') == 'check' else None)):
                if a is None or (a.get('t') or 0) > 0: continue
                c = bs[st][line_of(a.get('u'))][pos]
                c[0] += 1; c[1] += a.get('a') in ('bet', 'all_in') and (a.get('m') or 0) > 0
def rate(c, k=20, prior=0.45): return (c[1] + k * prior) / (c[0] + k)
fold = {st: {ln: [round(rate(c), 4) for c in cnt[st][ln]] for ln in LINES} for st in cnt}
n = {st: {ln: [c[0] for c in cnt[st][ln]] for ln in LINES} for st in cnt}
fr = {st: round(rate(rcnt[st], 20, 0.35), 4) for st in rcnt}
ts = f"""/**
 * Population priors of holdemLateStreetIsPriced (HorseHoldemLateStreetIsPriced.ts), GENERATED by
 * scripts/horse-measure/holdem-late-street/fit.py from responses.sql rows ({hands} NLH hands) and, for the flop,
 * flop-responses.sql rows ({flop_hands} NLH cash hands). Do not edit by hand: refit and regenerate. Heads-up fold of
 * the defender to the first wager of the street, by the bettor's line (flop: his preflop role; turn/river: the street
 * before) and the size bucket (<=1/3, <=2/3, <=pot, over), shrunk 20 decisions toward 0.45; fold to a raise of one's
 * own bet, shrunk toward 0.35. Horse and person decisions together (the model reads his record first, else this).
 */
export const HOLDEM_LATE_PRIORS_VERSION = {json.dumps(version)};
export const HOLDEM_LATE_FOLD_PRIOR: Readonly<Record<'flop' | 'turn' | 'river', Readonly<Record<'checkthrough' | 'barrel' | 'lead' | 'other', readonly number[]>>>> = {json.dumps(fold)};
/** decisions behind each cell of HOLDEM_LATE_FOLD_PRIOR */
export const HOLDEM_LATE_FOLD_PRIOR_N = {json.dumps(n)};
export const HOLDEM_LATE_FOLD_TO_RAISE_PRIOR: Readonly<Record<'flop' | 'turn' | 'river', number>> = {json.dumps(fr)};
export const HOLDEM_LATE_FOLD_TO_RAISE_PRIOR_N = {json.dumps({st: rcnt[st][0] for st in rcnt})};
"""
ts += f"""/** Bet share of the player whose wager it is (first to act, or checked to), heads-up, by street and his line, from
 * reached-flop.sql rows ({reach_hands} NLH cash hands), shrunk 20 spots toward 0.45. */
export const HOLDEM_LATE_BET_SHARE_PRIOR: Readonly<Record<'flop' | 'turn' | 'river', Readonly<Record<'checkthrough' | 'barrel' | 'lead' | 'other', Readonly<Record<'first' | 'checkedTo', number>>>>>> = {json.dumps({st: {ln: {pos: round(rate(c), 4) for pos, c in bs[st][ln].items()} for ln in LINES} for st in bs})};
export const HOLDEM_LATE_BET_SHARE_PRIOR_N = {json.dumps({st: {ln: {pos: c[0] for pos, c in bs[st][ln].items()} for ln in LINES} for st in bs})};
"""
open(out, 'w').write(ts)
print(json.dumps({'hands': hands, 'flopHands': flop_hands, 'reachHands': reach_hands, 'betShare': bs, 'fold': fold, 'n': n, 'foldToRaise': fr, 'rn': rcnt}, indent=0))
