#!/usr/bin/env python3
"""
Places the rows of one HVH48 audit (2026-11-19, six auditors A-F) at their decision node and writes
  <out>/<set>.nodes.jsonl  the audited decisions, for `scripts/audited-decision-replay.ts --placed`
  <out>/<set>.job.json     the hands and nodes to re-decide, for `scripts/audited-node-option-replay.ts --job`
Local files only (the audit's published decisions.csv and the hand rows the auditor exported); no database.

  python3 scripts/hvh48-audit-nodes.py --set A|B|C|D|E|F --csv <decisions.csv> --work <auditor work dir> --out <dir>

A node is (hand id, seat, street, k): k is the 0-based index of that seat's own voluntary horse_policy decision on
that street of that hand, counted in the hand's recorded action list. A row is placed by the action ordinal the
audit recorded (A, B, D, F), by the recorded timestamp (C) or in recorded order (E); a row whose action at that
place is not the audit's seat, street and action is NOT placed (counted, listed), never moved to a neighbour.

Class rule (the same for the six sets): bad = the audit's severity CLEAR or LIKELY; ok = priced by the audit
and not flagged; unjudged = DEBATABLE, unpriced or cards unknown. `better` = the action kinds of the audit's own
better action where it names one. Recorded action words: fold, check, call, bet (a wager facing nothing), raise,
all_in (an all-in that raises; an all-in that cannot raise is a call), as the replay harness writes its arms.
A decision is given to the replay job only when the Horse's own hole cards are known.
"""
import argparse, collections, csv, glob, json, os, re, sys

ap = argparse.ArgumentParser()
ap.add_argument('--set', required=True, choices=list('ABCDEF'))
ap.add_argument('--csv', required=True)
ap.add_argument('--work', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()
W = a.work
SUIT = {'c': 'clubs', 'd': 'diamonds', 'h': 'hearts', 's': 'spades'}
VOL = {'fold', 'check', 'call', 'bet', 'raise', 'all_in'}
STREETS = {'preflop', 'flop', 'turn', 'river'}


def cards_of(v):
    """'As Kd', 'AsKd', ['As', ...] or [{'rank','suit'}] -> [{'rank','suit'}]"""
    if not v:
        return []
    if isinstance(v, list):
        if v and isinstance(v[0], dict):
            return [{'rank': c['rank'], 'suit': c['suit']} for c in v]
        v = ' '.join(v)
    return [{'rank': r, 'suit': SUIT[s]} for r, s in re.findall(r'(10|[2-9TJQKA])([cdhs])', v.replace('10', 'T'))]


def jl(p):
    with open(p) as f:
        return [json.loads(l) for l in f if l.strip()]


def word(action, amount, pn):
    if action in ('fold', 'check', 'call'):
        return action
    if action == 'all_in':
        row = next((s for s in pn['seats'] if s[0] == pn.get('actorSeat')), None)
        reach = row[1] + row[2] if row else float('inf')
        if pn['toCall'] > 0 and (reach <= pn['currentBet'] + 1e-9 or (amount is not None and amount <= pn['currentBet'] + 1e-9)):
            return 'call'
        return 'all_in'
    return 'raise' if pn['toCall'] > 0 else 'bet'


def better_of(s):
    s = (s or '').strip().lower()
    if not s or s == 'actual' or s.startswith('size'):
        return []
    if s.startswith('fold'):
        return ['fold']
    if s.startswith('check'):
        return ['check']
    if s.startswith('call'):
        return ['call']
    return ['bet', 'raise', 'all_in']  # raise:N, bet:N, 3bet, 4bet, raise3x, bet33, bet 2/3, raise_to_N, all_in, jam


def cls_of(sev, priced):
    sev = (sev or '').strip().upper()
    if sev in ('CLEAR', 'LIKELY'):
        return 'bad'
    if sev in ('', 'OK') and priced:
        return 'ok'
    return 'unjudged'


# ── per set: hands (raw hand_history rows), hole cards, audit rows ───────────
hands = {}      # hand id -> raw row
holes = collections.defaultdict(dict)  # hand id -> user id -> cards
horse_ids = None  # known Horse user ids, when the auditor exported them
rows = []       # {hand, seat?, uid?, street, action, ord?, ts?, sev, priced, better, finding, id, loss}
with open(a.csv) as f:
    C = list(csv.DictReader(f))

if a.set == 'A':
    for p in sorted(glob.glob(f'{W}/raw/b*.json')):
        for h in json.load(open(p)):
            hands[h['id']] = h
    for r in json.load(open(f'{W}/raw/reviews.json')):
        holes[r['hand_id']][r['horse_user_id']] = cards_of(r['hole_cards'])
    flagged = {(r['hand_id'], int(r['ord'])): r for r in C}
    priced = {tuple(l['jid'].rsplit(':', 1)) for l in jl(f'{W}/out/jobmeta.jsonl')}
    priced = {(h, int(o)) for h, o in priced if o != 'None'} | set(flagged)
    for d in jl(f'{W}/out/decisions.jsonl'):
        key = (d['hand_id'], d['ord'])
        if d.get('cards'):
            holes[d['hand_id']][d['uid']] = cards_of(d['cards'])
        if key not in priced:
            continue
        r = flagged.get(key)
        rows.append(dict(hand=d['hand_id'], seat=d['seat'], street=d['street'], action=d['raw_action'], ord=d['ord'],
                         sev=r['severity'] if r else '', priced=True, better=better_of(r['best']) if r else [],
                         finding=r['class'] if r else '', id=f"A:{d['hand_id']}:{d['ord']}", loss=r['ev_loss_bb'] if r else ''))
elif a.set == 'B':
    for h in jl(f'{W}/slice.jsonl'):
        hands[h['id']] = h
    for hid, m in json.load(open(f'{W}/cards.json')).items():
        for u, cs in m.items():
            holes[hid][u] = cards_of(cs)
    horse_ids = set()
    for r in jl(f'{W}/facts.jsonl'):
        if r.get('is_horse'):
            horse_ids.add(r['user_id'])
    D = jl(f'{W}/decisions.jsonl')
    ords = json.load(open(f'{W}/ords.json'))
    priced = {l['i'] for l in jl(f'{W}/priced.0.jsonl')}
    flagged = {int(r['i']): r for r in C}
    for i, d in enumerate(D):
        if i not in priced and i not in flagged:
            continue
        r = flagged.get(i)
        if d.get('cards'):
            holes[d['hand']][d['uid']] = cards_of(d['cards'])
        b = []
        if r:
            c = r['cls']
            b = ['call'] if c.startswith('FOLD_PRICE_MET') else ['fold'] if c.startswith('CALL_') else \
                ['check'] if c.startswith('BLUFF_INTO') else ['bet', 'raise', 'all_in'] if c.startswith(('MISSED', 'RIVER_NUT_FLAT', 'PREFLOP_PREMIUM_FOLD')) else []
        rows.append(dict(hand=d['hand'], seat=d['seat'], street=d['street'], action=d['action'], ord=ords[i],
                         sev=r['severity'] if r else '', priced=True, better=b, finding=r['cls'] if r else '',
                         id=f'B:{i}', loss=r['ev_loss_bb'] if r else ''))
elif a.set == 'C':
    for h in jl(f'{W}/hands.jsonl'):
        hands[h['id']] = h
    for r in json.load(open(f'{W}/facts.json')):
        if r.get('hole_cards'):
            holes[r['hand_id']][r['user_id']] = cards_of(r['hole_cards'])
    horse_ids = {p['id'] for p in json.load(open(f'{W}/profiles.json')) if p.get('is_horse')}
    meta = {f"d{m['n']}": m for m in jl(f'{W}/meta.jsonl')}
    for r in C:
        m = meta[r['id']]
        if m.get('hole'):
            holes[m['hand']][m['uid']] = cards_of(m['hole'])
        rows.append(dict(hand=m['hand'], seat=m['seat'], street=m['street'], action=r['action'], ts=m['t'],
                         sev=r['severity'], priced=r['status'] == 'priced', better=better_of(r['better']),
                         finding=r['mistake'], id=f"C:{r['id']}", loss=r['loss_bb']))
elif a.set == 'D':
    for h in json.load(open(f'{W}/slice.json')):
        hands[h['id']] = h
    for r in json.load(open(f'{W}/facts.json')):
        if r.get('hole_cards'):
            holes[r['hand_id']][r['user_id']] = cards_of(r['hole_cards'])
    for r in C:
        if r['hero']:
            holes[r['hand_id']][r['horse_id']] = cards_of(r['hero'])
        rows.append(dict(hand=r['hand_id'], seat=int(r['seat']) if r['seat'] != '' else None, street=r['street'], action=r['action'],
                         ord=int(r['ordinal']) if r['ordinal'] != '' else None, sev=r['severity'],
                         priced=r['flagged'] in ('0', '1'), better=better_of(r['best']) if r['flagged'] == '1' else [],
                         finding=r['mistake_class'], id=f"D:{r['hand_id']}:{r['ordinal']}", loss=r['loss_bb']))
elif a.set == 'E':
    for h in jl(f'{W}/hands.jsonl'):
        hands[h['id']] = h
    for r in jl(f'{W}/facts.jsonl'):
        if r.get('hole_cards'):
            holes[r['hand_id']][r['user_id']] = cards_of(r['hole_cards'])
    for i, r in enumerate(C):
        rows.append(dict(hand=r['hand_id'], seat=int(r['seat']), street=r['street'], action=r['action'],
                         sev=r['severity'], priced=r['cls'] != 'UNPRICED_NO_CARDS' and r['spot'] != 'facing_allin_unknown_cards',
                         better=better_of(r['best']) if r['severity'] else [], finding=r['cls'], id=f'E:{i}',
                         loss=r['loss_bb'], hole=r['hole']))
elif a.set == 'F':
    for h in json.load(open(f'{W}/hands.json')):
        hands[h['id']] = h
    for r in json.load(open(f'{W}/review_holes.json')):
        holes[r['h']][r['u']] = cards_of(r['hole_cards'])
    for r in C:
        rows.append(dict(hand=r['hand_id'], seat=int(r['seat']), street=r['street'], action=r['action'],
                         ord=int(r['ordinal']), sev=r['severity'] if r['severity'] in ('CLEAR', 'LIKELY', 'DEBATABLE', 'OK') else 'UNPRICED',
                         priced=r['severity'] == 'OK' or r['cards_known'] == 'True', better=better_of(r['best_base']) if r['severity'] in ('CLEAR', 'LIKELY') else [],
                         finding=r['class'], id=f"F:{r['hand_id']}:{r['ordinal']}", loss=r['loss_base'], hole=r['hole'], uid=r['horse']))

# hole cards the hand row itself carries (showdown / stored Horse cards)
for hid, h in hands.items():
    hc = h.get('hole_cards')
    if isinstance(hc, dict):
        for u, cs in hc.items():
            if cs and u not in holes[hid]:
                holes[hid][u] = cards_of(cs)

# ── place every row ──────────────────────────────────────────────────────────
used = set()
nodes, unplaced, jobs = [], [], collections.defaultdict(list)
stat = collections.Counter()
for r in rows:
    h = hands.get(r['hand'])
    if not h:
        unplaced.append((r['id'], 'hand not exported')); continue
    acts = h['actions']
    vol = [(i, x) for i, x in enumerate(acts) if x.get('origin') == 'horse_policy' and x.get('action') in VOL and x.get('stage') in STREETS]
    if r['seat'] is None:  # D: an unpriced row carries no seat; the recorded action at its ordinal does
        if r.get('ord') is None or r['ord'] >= len(acts):
            unplaced.append((r['id'], 'no seat and no ordinal')); continue
        r['seat'] = acts[r['ord']]['seat']
    seat = int(r['seat'])
    cand = [(i, x) for i, x in vol if x['seat'] == seat and x['stage'] == r['street'] and (r['hand'], i) not in used]
    pick = None
    if r.get('ord') is not None:
        pick = next(((i, x) for i, x in cand if i == r['ord']), None)
    elif r.get('ts') is not None:
        pick = next(((i, x) for i, x in cand if str(x.get('timestamp')) == str(r['ts'])), None)
    else:
        pick = cand[0] if cand else None
    if not pick or pick[1]['action'] != r['action']:
        unplaced.append((r['id'], 'no recorded action of that seat, street and action at that place')); continue
    i, x = pick
    used.add((r['hand'], i))
    pn = x.get('publicNode')
    if not pn:
        unplaced.append((r['id'], 'no public snapshot')); continue
    k = [j for j, y in vol if y['seat'] == seat and y['stage'] == r['street']].index(i)
    uid = x.get('userId')
    if r.get('hole') and uid:
        holes[r['hand']].setdefault(uid, cards_of(r['hole']))
    horses_here = {y.get('userId') for y in acts if str(y.get('origin', '')).startswith('horse')}
    if horse_ids is not None:
        horses_here |= {p['userId'] for p in h['players'] if p['userId'] in horse_ids}
    seat_user = {p['seat']: p['userId'] for p in h['players']}
    live = [s[0] for s in pn['seats'] if not (int(s[6]) & 1) and s[0] != seat]
    persons = sorted(seat_user[s] for s in live if s in seat_user and seat_user[s] not in horses_here)
    cls = cls_of(r['sev'], r['priced'])
    rec = word(x['action'], float(x.get('amount') or 0), pn)
    known = bool(holes[r['hand']].get(uid))
    node = dict(hand=r['hand'], seat=seat, street=r['street'], k=k, recorded=dict(action=rec, amount=float(x.get('amount') or 0)),
                verdict=(r['sev'] or ('OK' if r['priced'] else 'UNPRICED')), cls=cls, better=r['better'], finding=r['finding'],
                id=r['id'], set=a.set, persons=persons, cards_known=known, to_call=pn['toCall'], variant=pn.get('variant') or h.get('game_variant'),
                mode=pn.get('mode'), nlive=len(live) + 1, loss_bb=r['loss'], hn=h.get('hand_number'))
    nodes.append(node)
    stat[cls] += 1
    if known:
        jobs[r['hand']].append(dict(ord=i, seat=seat, street=r['street'], k=k))
        stat['replayable'] += 1
        stat['replayable_' + cls] += 1

os.makedirs(a.out, exist_ok=True)
with open(f'{a.out}/{a.set}.nodes.jsonl', 'w') as f:
    for n in nodes:
        f.write(json.dumps(n) + '\n')
job = dict(set=a.set, hands=[])
for hid, ns in jobs.items():
    h = hands[hid]
    horses_here = {y.get('userId') for y in h['actions'] if str(y.get('origin', '')).startswith('horse')}
    if horse_ids is not None:
        horses_here |= {p['userId'] for p in h['players'] if p['userId'] in horse_ids}
    acts = []
    for i, x in enumerate(h['actions']):
        y = dict(x); y['ord'] = i; y['amount'] = float(x.get('amount') or 0); acts.append(y)
    pn0 = next((x['publicNode'] for x in h['actions'] if x.get('publicNode')), {})
    job['hands'].append(dict(hand=dict(
        handId=hid, variant=h.get('game_variant') or pn0.get('variant'), handNumber=h.get('hand_number'),
        tournamentId=h.get('tournament_id'), bigBlind=float(h['big_blind']), smallBlind=float(h['small_blind']),
        buttonSeat=h.get('button_seat'), board=h.get('board'), bombPot=bool(h.get('bomb_pot')), runItTwice=bool(h.get('rit_boards')),
        players=[dict(seat=p['seat'], userId=p['userId'], isHorse=p['userId'] in horses_here) for p in h['players']],
        horseHoleCards={u: c for u, c in holes[hid].items() if u in horses_here and c}, actions=acts), nodes=ns))
with open(f'{a.out}/{a.set}.job.json', 'w') as f:
    json.dump(job, f)
print(f"set {a.set}: {len(C)} csv rows, {len(rows)} audited decisions, {len(nodes)} placed, {len(unplaced)} not placed; "
      f"bad {stat['bad']}, ok {stat['ok']}, unjudged {stat['unjudged']}; replayable (own cards known) {stat['replayable']} "
      f"(bad {stat['replayable_bad']}, ok {stat['replayable_ok']}, unjudged {stat['replayable_unjudged']}) in {len(jobs)} hands")
for u in collections.Counter(w for _, w in unplaced).items():
    print('  not placed:', u)
