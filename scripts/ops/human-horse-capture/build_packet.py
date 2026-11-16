#!/usr/bin/env python3
"""Tight/maniac packet from witness-reader rows and per-opponent priors (TIGHT-MANIAC-METHOD-v1 + addenda). Outcomes are never read.
usage: build_packet.py WITNESS_JSONL PRIORS_JSON OUT_DIR [INSTANCE_ID] [FACED_ORIGINS_JSON]
PRIORS_JSON: list of {user_id, fam, trn, asof_ms, n, vpip, six, rate, last_at_ms, n24, v24, r24, nold, vold, rold} (observations strictly before asof)."""
import json, sys, hashlib, collections
from pathlib import Path
DAY = 86400000
def fam(v):
    v = (v or '').lower()
    return 'hilo' if '8' in v else 'omaha' if v.startswith('plo') else 'limit' if v.startswith('flh') else 'holdem'
def classify(p, asof_ms):
    """Analysis class from the frozen method. p may be None (no prior rows)."""
    if not p or p['n'] < 20: return 'unknown'
    if p['last_at_ms'] >= asof_ms: raise ValueError('prior not strictly before the decision')
    if asof_ms - p['last_at_ms'] > 7 * DAY: return 'stale'
    hold = p['fam'] in ('holdem', 'limit')  # addendum 4 I: limit Hold'em uses Hold'em thresholds; hi-lo uses Omaha
    lo = (0.18 if p.get('six', 1) >= 0.5 else 0.30) if hold else 0.35
    hi = 0.50 if hold else 0.85
    def man(v, r): return v is not None and r is not None and v >= hi and r >= 0.50
    def cls(n, v, r):
        if n < 20: return None
        return 'tight' if v is not None and v <= lo else 'maniac' if man(v, r) else 'ordinary'
    a, b = cls(p.get('n24', 0), p.get('v24'), p.get('r24')), cls(p.get('nold', 0), p.get('vold'), p.get('rold'))
    if a and b and a != b: return 'changing'
    if p['n'] < 50: return 'thin'
    if p['vpip'] <= lo: return 'tight'
    if man(p['vpip'], p.get('rate')):
        return 'maniac_sustained' if man(p.get('v24'), p.get('r24')) and man(p.get('vold'), p.get('rold')) else 'maniac_selective'
    return 'ordinary'
def verdict(cls, w):
    changed = bool(w.get('changes')); ex = w.get('execution') or {}
    if not ex or w.get('review', {}).get('status') != 'reconciled': return 'unjudgeable'
    one_off = cls not in ('maniac_sustained', 'maniac_selective') and ((w.get('lastAggressor') or {}).get('betToPotBefore') or 0) >= 1.0
    weak = cls in ('unknown', 'stale', 'thin', 'changing') or one_off
    if weak: return 'abstention_consistent' if not changed else 'change_on_weak_evidence_needs_replay'
    er = (w.get('engineInput') or {}).get('engineRead') or {}
    if 'error' in er: return 'unjudgeable'
    eng_maniac = er.get('maniacRaiseWidth') is not None or er.get('postflopManiac') is True
    if cls == 'tight' and eng_maniac: return 'conflicting_engine_reads_maniac_analysis_tight'
    if cls == 'tight':
        if er.get('overFolder') is True:
            if w.get('_preRepairProfile'): return 'overfolder_pre_repair_bias_not_counted'
            return 'overfolder_no_pressure_question_for_owner' if not changed else 'overfolder_change_needs_replay'
        st = er.get('style') or {}
        if st.get('tightOpenerRespect') or st.get('tightReRaiserRespect'):   # 06d45e7d style read #6 (recognition); absent key on older builds leaves the old path unchanged
            return 'tight_style_read_no_change_needs_replay' if not changed else 'tight_style_change_needs_replay'
        return 'tight_outside_overfolder_scope_owner_question'
    if cls.startswith('maniac') and not eng_maniac and not er.get('presumed'): return 'maniac_not_read_by_engine_question_for_owner' if not changed else 'maniac_change_without_engine_read_needs_replay'
    if cls.startswith('maniac'): return 'maniac_no_change_question_for_owner' if not changed else 'maniac_change_needs_replay'
    return 'ordinary'
def band(x, cuts): 
    for i, c in enumerate(cuts):
        if x <= c: return i
    return len(cuts)
CLASSES = ['tight', 'maniac_sustained', 'maniac_selective', 'changing', 'one_off_large_bet', 'unknown', 'stale', 'thin', 'ordinary']
def verdict2(v):
    """Verifier's two values (addendum 4)."""
    if v == 'unjudgeable' or v.startswith('unverified'): return 'unjudgeable'
    return 'adjustment' if ('change' in v and 'no_change' not in v) else 'baseline kept'
def main(wp, pp, out, instance=None, origins=None):
    out = Path(out); out.mkdir(parents=True, exist_ok=False)
    pri = collections.defaultdict(list)
    for p in json.loads(Path(pp).read_text()): pri[(p['user_id'], p['fam'], bool(p['trn']))].append(p)
    orig_sha = hashlib.sha256(Path(wp).read_bytes()).hexdigest()
    # The decision snapshot carries no origin on a human's bet or raise; for the faced wager the origin is taken from hand_history.actions (post_capture / tight-maniac-faced-origins.json).
    dbo = {(x['hand'], x['opponent']): x['aggressiveOrigins'] or [] for x in json.loads(Path(origins).read_text())} if origins else {}
    rows = [json.loads(l) for l in Path(wp).read_text().splitlines() if l.strip().startswith('{')]
    wit = [r for r in rows if 'turnKey' in r]; res = []; counts = collections.Counter(); opp = collections.Counter()
    hand_start = {}
    for r in wit: hand_start[r['hand']] = min(hand_start.get(r['hand'], r['atMs']), r['atMs'])
    for r in wit:
        hu = 'heads_up' if (r.get('dealtCount') or r['playersIn']) == 2 else 'three_plus'
        counts[('human_facing' if r.get('humansAble') else 'horse_only_or_human_unable', r['variant'], r['mode'], hu)] += 1
        f, t, asof = fam(r['variant']), r['mode'] != 'cash', hand_start[r['hand']]
        changed = bool(r.get('changes')); ex = r.get('execution') or {}
        for h in r.get('humansInHand') or []:
            if not h.get('dealt'): continue
            cand = [p for p in pri.get((h['userId'], f, t), []) if p['asof_ms'] <= asof]
            p = max(cand, key=lambda p: p['asof_ms']) if cand else None
            c = classify(p, asof); faced = h['type'] == 'faces_human_wager'
            exact = p is None or p['asof_ms'] == asof   # None = no prior rows at all for this hand's query
            one = faced and ((r['lastAggressor'] or {}).get('betToPotBefore') or 0) >= 1.0 and not c.startswith('maniac')
            per = (r['engineInput'].get('perHuman') or {}).get(h['userId']) or {}
            w = dict(r, engineInput=dict(r['engineInput'], engineRead=per.get('read')), _preRepairProfile=bool(p is not None and not t and (p.get('n_post_repair') or 0) == 0))
            v = verdict(c, w) if faced else ('different_aggressor_control_baseline' if not changed else 'different_aggressor_change_needs_replay') if c in ('tight', 'maniac_sustained', 'maniac_selective') else (('ordinary_baseline' if not changed else 'ordinary_change_not_attributed') if c == 'ordinary' else ('abstention_consistent' if not changed else 'change_on_weak_evidence_needs_replay')) if ex and r['review']['status'] == 'reconciled' else 'unjudgeable'
            if not exact and c in ('tight', 'maniac_sustained', 'maniac_selective', 'changing', 'thin'): v = 'unverified_prior_snapshot_not_at_hand'
            vol, osrc = h.get('actedVoluntarily'), 'decision snapshot'
            if faced and (r['hand'], h['userId']) in dbo:
                o = dbo[(r['hand'], h['userId'])]; vol, osrc = any(x in ('player', 'pre_action') for x in o), 'hand_history.actions'
            forced = p.get('forced_share') if p else None
            absent_like = c == 'tight' and (not vol or forced is None or forced >= 0.25)
            lp = bool(p and p['n'] >= 50 and p.get('vpip') and p.get('pfr') is not None and p['pfr'] / p['vpip'] <= 0.25)
            bb = r.get('bigBlind') or 1; price = (r.get('toCall') or 0) / max(1, (r.get('pot') or 0) + (r.get('toCall') or 0))
            res.append({'id': 'HVH-TM-%04d' % (len(res) + 1), 'type': h['type'], 'hand': r['hand'], 'key': r['key'], 'turnKey': r['turnKey'], 'eventId': r['eventId'], 'release': r['release'], 'instanceId': instance, 'producerId': r['producerId'], 'atMs': r['atMs'],
                        'originalPath': str(wp), 'originalSha256': orig_sha, 'horse': r['horse'], 'opponent': h['userId'], 'opponentStatus': {k: h[k] for k in ('folded', 'allIn', 'faced', 'origins', 'actedVoluntarily')},
                        'class': 'one_off_large_bet' if one and c in ('ordinary',) else c, 'oneOffLargeBet': one, 'loosePassive': lp, 'absentLike': absent_like, 'forcedShare': forced, 'actedVoluntarily': vol, 'originSource': osrc,
                        'prior': p and {k: p.get(k) for k in ('n', 'n_post_repair', 'vpip', 'pfr', 'rate', 'n24', 'nold', 'last_at_ms')}, 'preRepairProfile': w['_preRepairProfile'], 'priorAsOfMs': p and p['asof_ms'], 'handStartMs': asof, 'priorExactForHand': exact, 'forcedShareAsOf': 'first witness hand of the window', 'engineRead': per.get('read'), 'engineTallies': per.get('tallies'), 'learnedAfterRepair': r['engineInput'].get('learnedAfterRepair'),
                        'observer': r['engineInput'].get('observer'), 'receipts': r.get('receipts'),
                        'match': {'variant': r['variant'], 'mode': r['mode'], 'stage': r['stage'], 'headsUp': hu, 'stackBand': band((r.get('stack') or 0) / bb, [12, 25, 60, 150]), 'priceBand': band(price, [0.10, 0.25, 0.40]), 'playersIn': r['playersIn']},
                        'proposal': r['proposal'], 'changes': r['changes'], 'final': r['final'], 'execution': r['execution'], 'committedHandId': (r.get('acceptedHand') or {}).get('committedHandId'), 'review': r['review'],
                        'bound': bool(ex) and ex.get('anchorActor') == r['horse'] and r['review']['status'] == 'reconciled' and (not faced or r.get('facedInHand') is True),
                        'verdict': v, 'verdict2': verdict2(v)})
            opp[(res[-1]['class'], h['type'], r['variant'], r['mode'], hu)] += 1
    (out / 'witnesses.jsonl').write_text(''.join(json.dumps(x) + '\n' for x in res))
    by_class = collections.Counter(); 
    for (c, ty, v, m, hu), n in opp.items(): by_class[(c, ty)] += n
    zeros = {c + '|' + ty: by_class.get((c, ty), 0) for c in CLASSES for ty in ('faces_human_wager', 'human_live_not_faced', 'human_out_or_all_in')}
    summ = {'decisions': len(wit), 'witnesses': len(res), 'byScope': {'|'.join(k): v for k, v in sorted(counts.items())}, 'byClassAndType': zeros,
            'opportunities': {'|'.join(k): v for k, v in sorted(opp.items())}, 'verdicts': dict(collections.Counter(x['verdict'] for x in res)), 'verdict2': dict(collections.Counter(x['verdict2'] for x in res)),
            'tightCountingTowardRecognition': sum(1 for x in res if x['class'] == 'tight' and not x['absentLike']), 'tightAbsentLike': sum(1 for x in res if x['class'] == 'tight' and x['absentLike']),
            'loosePassiveWitnesses': sum(1 for x in res if x['loosePassive']), 'allBound': all(x['bound'] for x in res), 'unbound': sum(1 for x in res if not x['bound']),
            'originalSha256': orig_sha, 'witnessesSha256': hashlib.sha256((out / 'witnesses.jsonl').read_bytes()).hexdigest(),
            'limit': 'engineRead is the serving code recomputed on the decision\'s own read frame; null means no read engaged. Attribution of an action change to a read needs the owner\'s replay. human_live_not_faced covers humans still to act and callers together. The analysis prior is computed per (human, hand), strictly before that hand; where only an earlier snapshot exists for a classed opponent the witness is unverified_prior_snapshot_not_at_hand. The forced-fold share is one snapshot per human, as of their first witness hand. The analysis prior (database facts) and the engine\'s actual read at each decision (engineRead, from that decision\'s own read frame) are separate fields and are never merged.'}
    (out / 'summary.json').write_text(json.dumps(summ, indent=1)); print(json.dumps(summ))
if __name__ == '__main__': main(*sys.argv[1:6])
