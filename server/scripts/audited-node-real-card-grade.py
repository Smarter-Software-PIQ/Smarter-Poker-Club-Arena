#!/usr/bin/env python3
"""REPLAY-V2 real-card grade of changed decisions (criterion 6 of CRITERIA-REPLAYV2.md). Read-only, local files only.
usage: audited-node-real-card-grade.py <set> <arm> <replay.jsonl> <job.json> <cards.json> <fold-prior.json> <out.json>
Value of each action from the decision point, in bb, with every live hand's REAL cards; hero's pot share = equity over
the unseen runout given the board at the decision (exact on the river, 600 seeded runouts otherwise), no later betting.
Cards: Horse = the job's private-table cards; person = cards shown at showdown (hand_history.hole_cards), else
ca_hand_facts.hole_cards only when he put chips in voluntarily in that hand (call/bet/raise/all-in); otherwise the
decision is not graded. A wager's response: heads-up, the villain folds with probability p (measured fold of his kind,
person or Horse, family, mode, street, bet-or-raise, size bucket; fitted before the audit days) when his real hand is
weak on that board, else calls; multiway: everyone calls (p 0). Preflop wager changes against a live non-all-in
opponent are not graded (no preflop response model); preflop fold/call/all-in-call changes are."""
import json, sys, math, itertools, collections, random
S, ARM, REPLAY, JOB, CARDS, PRIOR, OUT = sys.argv[1:8]
RV = {r: i for i, r in enumerate('23456789TJQKA', 2)}
SU = {'c': 'c', 'd': 'd', 'h': 'h', 's': 's', 'clubs': 'c', 'diamonds': 'd', 'hearts': 'h', 'spades': 's'}
def card(c):
    if isinstance(c, dict): r, s = str(c['rank']), str(c['suit'])
    else:
        c = str(c)
        for k in ('clubs', 'diamonds', 'hearts', 'spades'):
            if c.endswith(k): r, s = c[:-len(k)], k; break
        else: r, s = c[:-1], c[-1]
    if r == '10': r = 'T'
    return (RV[r.upper()], SU[s])
def pboard(s):
    return [card(s[i:i+2]) for i in range(0, len(s or ''), 2)]
def rank5(cs):
    rs = sorted((c[0] for c in cs), reverse=True); flush = len({c[1] for c in cs}) == 1
    cnt = collections.Counter(rs); g = sorted(cnt.items(), key=lambda kv: (-kv[1], -kv[0])); u = sorted(cnt, reverse=True)
    st = 0
    if len(u) == 5:
        if u[0] - u[4] == 4: st = u[0]
        elif u == [14, 5, 4, 3, 2]: st = 5
    if st and flush: return (8, st)
    if g[0][1] == 4: return (7, g[0][0], g[1][0])
    if g[0][1] == 3 and g[1][1] == 2: return (6, g[0][0], g[1][0])
    if flush: return (5,) + tuple(rs)
    if st: return (4, st)
    if g[0][1] == 3: return (3, g[0][0]) + tuple(k for k, _ in g[1:])
    if g[0][1] == 2 and g[1][1] == 2: return (2, g[0][0], g[1][0], g[2][0])
    if g[0][1] == 2: return (1, g[0][0]) + tuple(k for k, _ in g[1:])
    return (0,) + tuple(rs)
def best(hole, board, omaha):
    if omaha:
        return max(rank5(list(h) + list(b)) for h in itertools.combinations(hole, 2) for b in itertools.combinations(board, 3))
    cs = list(hole) + list(board)
    return max(rank5(c) for c in itertools.combinations(cs, 5))
DECK = [(r, s) for r in range(2, 15) for s in 'cdhs']
def equity(hero, opps, board, omaha, seed):
    known = set(hero) | set(board) | {c for o in opps for c in o}
    rest = [c for c in DECK if c not in known]; need = 5 - len(board)
    if need == 0: runs = [()]
    else:
        rnd = random.Random(seed); runs = [tuple(rnd.sample(rest, need)) for _ in range(600)]
    tot = 0.0
    for r in runs:
        b = list(board) + list(r); h = best(hero, b, omaha); os_ = [best(o, b, omaha) for o in opps]
        top = max([h] + os_)
        if h == top: tot += 1.0 / (1 + sum(1 for x in os_ if x == top))
    return tot / len(runs)
def weak(vc, board, omaha):
    """his real hand is weak here: no better than a weak made hand and no 8+ outs to a straight or better."""
    if len(board) < 3: return False
    b = best(vc, board, omaha); cls = b[0]
    if omaha:
        if cls >= 3: return False
    else:
        if cls >= 2: return False
        if cls == 1:
            top = max(c[0] for c in board); pr = b[1]
            board_pair = collections.Counter(c[0] for c in board).most_common(1)[0][1] >= 2
            if not board_pair and (pr >= top): return False
    if len(board) >= 5: return True
    known = set(vc) | set(board); outs = 0
    for c in DECK:
        if c in known: continue
        if best(vc, list(board) + [c], omaha)[0] >= 4: outs += 1
    return outs < 8
P = json.load(open(PRIOR))
def pfold(fam, mode, street, kind, horse, x):
    b = sum(1 for e in (0.4, 0.6, 0.85, 1.2) if x >= e)
    who = 'horse' if horse else 'person'
    cells = {int(k.split('|')[5]): v for k, v in P.items() if k.split('|')[:5] == [fam, mode, street, kind, who]}
    n = sum(v[0] for v in cells.values()); f = sum(v[1] for v in cells.values())
    pooled = (f + 1) / (n + 2)
    v = cells.get(b)
    return pooled if not v else (v[1] + 2 * pooled) / (v[0] + 2)
job = json.load(open(JOB)); cards = json.load(open(CARDS))
where = {}
for it in job['hands']:
    h = it['hand']; acts = {a['ord']: a for a in h['actions']}
    for n in it['nodes']: where[(h['handId'], n['seat'], n['street'], n['k'])] = (h, acts[n['ord']])
VOL = {'call', 'bet', 'raise', 'all_in'}
def person_cards(h, uid, seat):
    c = cards.get(h['handId']) or {}
    if (c.get('shown') or {}).get(uid): return c['shown'][uid], 'shown'
    put = any(a.get('seat') == seat and a.get('action') in VOL and a.get('origin') != 'forced' for a in h['actions'])
    if put and (c.get('facts') or {}).get(uid): return c['facts'][uid], 'facts'
    return None, None
rows = []; skipped = collections.Counter(); seen = 0
for line in open(REPLAY):
    o = json.loads(line)
    if 'meta' in o: continue
    off, on = o['arms'].get('off', {}), o['arms'].get(ARM, {})
    if not off or not on or off.get('error') or on.get('error'): continue
    if off.get('action') == on.get('action') and (off.get('action') in ('fold', 'check', 'call') or off.get('amount') == on.get('amount')): continue
    seen += 1
    k = (o['hand'], o['seat'], o['street'], o['k']); w = where.get(k)
    if not w: skipped['no node'] += 1; continue
    h, act = w; pn = act.get('publicNode')
    if not pn: skipped['no state'] += 1; continue
    variant = (pn.get('variant') or h['variant']).lower()
    if variant not in ('nlh', 'plo4', 'plo5', 'plo6') and not variant.startswith('plo'): skipped['variant ' + variant] += 1; continue
    if variant.startswith('plo8') or 'hilo' in variant or 'hi_lo' in variant: skipped['hi-lo'] += 1; continue
    omaha = variant.startswith('plo'); fam = 'omaha' if omaha else 'holdem'
    hero_seat = pn.get('actorSeat') or o['seat']
    pl = {p['seat']: p for p in h['players']}
    live = [s for s in pn['seats'] if s[0] != hero_seat and (s[6] & 1) == 0 and (s[6] & 4) == 0]
    if not live: skipped['no opponent'] += 1; continue
    hero = h['horseHoleCards'].get(pl[hero_seat]['userId'])
    if not hero: skipped['hero cards unknown'] += 1; continue
    opps = []; kinds = []; src = []
    for s in live:
        p = pl.get(s[0])
        if not p: break
        if p['isHorse']:
            c = h['horseHoleCards'].get(p['userId']); sc = 'horse'
        else:
            c, sc = person_cards(h, p['userId'], s[0])
        if not c: break
        opps.append([card(x) for x in c]); kinds.append(p['isHorse']); src.append(sc)
    if len(opps) != len(live): skipped['opponent cards unknown'] += 1; continue
    facing = 'people' if not any(kinds) else 'horse_only' if all(kinds) else 'mixed'
    board = pboard((pn.get('boards') or [''])[0])
    if (pn.get('boardCount') or 1) > 1 or pn.get('bombPot'): skipped['multi-board / bomb'] += 1; continue
    heroc = [card(x) for x in hero]
    eq = equity(heroc, opps, board, omaha, hash(k) & 0xffffffff)
    bb = float(pn['bigBlind']); pot = float(pn['pot']) / bb
    seat = {s[0]: s for s in pn['seats']}
    heroIn = float(seat[hero_seat][2]) / bb; heroStack = float(seat[hero_seat][1]) / bb
    cur = float(pn['currentBet']) / bb
    mode = 'tournament' if pn.get('mode') == 'tournament' else 'cash'
    street = pn.get('street') or o['street']
    hu = len(live) == 1
    v_in = float(live[0][2]) / bb if hu else 0.0; v_stack = float(live[0][1]) / bb if hu else 0.0
    v_allin = hu and (live[0][6] & 2) != 0
    vweak = hu and weak(opps[0], board, omaha)
    reach = heroIn + heroStack  # the most hero can have in on this street
    def unmatched(to):
        # ADDENDUM 1 fix: chips an opponent already has in on this street beyond what hero matches go back to him
        return sum(max(0.0, float(s[2]) / bb - to) for s in live)
    def value(x):
        kind = x.get('action'); amt = x.get('amount')
        if kind == 'fold': return 0.0
        if kind == 'check': return pot * eq
        if kind == 'call' or (kind == 'all_in' and reach <= cur + 1e-9):
            c = max(0.0, min(cur - heroIn, heroStack)); return eq * (pot - unmatched(heroIn + c) + c) - c
        # the harness records a raise size in bb (street total)
        to = reach if kind == 'all_in' else min(float(amt or 0), reach)
        add = max(0.0, min(to - heroIn, heroStack))
        pot_m = pot - unmatched(heroIn + add)
        if street == 'preflop' and not (hu and (v_allin or v_stack <= 1e-9)) and not all((s[6] & 2) for s in live):
            raise ValueError('preflop wager vs a live non-all-in opponent')
        if hu:
            his = max(0.0, min(heroIn + add - v_in, v_stack)); matched = max(0.0, min(add, v_in + his - heroIn))
            p = pfold(fam, mode, street, 'raise' if v_in > 0 else 'bet', kinds[0], his / max(1e-9, pot + add - his)) if (vweak and his > 0) else 0.0
            return p * pot + (1 - p) * (eq * (pot_m + matched + his) - matched)
        tot_his = sum(max(0.0, min(heroIn + add - float(s[2]) / bb, float(s[1]) / bb)) for s in live)
        return eq * (pot_m + add + tot_his) - add
    try:
        d = value(on) - value(off)
    except ValueError as e:
        skipped[str(e)] += 1; continue
    persons = sorted(pl[s[0]]['userId'] for s in live if not pl[s[0]]['isHorse'])
    rows.append(dict(hand=o['hand'], seat=o['seat'], street=street, facing=facing, persons=persons, off=off.get('action'), on=on.get('action'),
                     delta=round(d, 4), eq=round(eq, 4), vweak=vweak, hu=hu, cards=src, variant=variant, mode=mode))
def stat(rs):
    if not rs: return dict(n=0)
    xs = [r['delta'] for r in rs]; m = sum(xs) / len(xs)
    se = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1)) / math.sqrt(len(xs)) if len(xs) > 1 else None
    return dict(n=len(xs), mean_bb=round(m, 3), se_bb=None if se is None else round(se, 3), total_bb=round(sum(xs), 2),
                mean_minus_se=None if se is None else round(m - se, 3))
res = dict(set=S, arm=ARM, changed_seen=seen, skipped=dict(skipped))
for f in ('people', 'horse_only', 'mixed'):
    rs = [r for r in rows if r['facing'] == f]
    top = collections.Counter(p for r in rs for p in r['persons']).most_common(1)
    res[f] = dict(graded=stat(rs), by_transition=dict(collections.Counter(f"{r['street']} {r['off']}>{r['on']}" for r in rs).most_common()),
                  cards=dict(collections.Counter(c for r in rs for c in r['cards'])),
                  top_person=dict(id_prefix=top[0][0][:8], n=top[0][1]) if top else None,
                  without_top=stat([r for r in rs if not top or top[0][0] not in r['persons']]))
res['rows'] = rows
json.dump(res, open(OUT, 'w'), indent=1, default=str)
print(json.dumps({k: v for k, v in res.items() if k != 'rows'}, default=str))
