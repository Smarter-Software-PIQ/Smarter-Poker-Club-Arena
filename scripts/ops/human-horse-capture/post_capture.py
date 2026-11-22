#!/usr/bin/env python3
"""Post-capture helpers. Each subcommand writes one new file and refuses an existing one.
 batches            CAPTURE_DIR                      -> witness-batch-N.mjs (all human-facing hands), rollup-batch.mjs (human-facing + systematic Horse-only sample)
 raw_batches        KEYS_JSON CAPTURE_DIR [PER_BATCH]-> raw-batch-N.mjs (~100 hands/batch using raw-reader.mjs for full-record extraction)
 priors             WITNESS_JSONL OUT_JSON           -> priors (+pfr) and forced share per (human, family, format), strictly before each human's first witness hand
 fires              START_UTC END_UTC OUT_JSON       -> rule fires from flush receipts by collected_at
 cohort             START_UTC END_UTC OUT_JSON       -> per-Horse hands dealt in the window by variant and format, for all unretired Horses
 origins            WITNESS_JSONL OUT_JSON           -> origin of each faced human wager from hand_history.actions (input to build_packet)
 gap_targets        START_UTC END_UTC OUT_JSON       -> targeted missing-spot hand keys with engine_build attribution (gap_targets.py)
 score_folds        SPOTS_JSONL OUT_JSON [SEED]      -> LOO range-classified actual-hand EV scorer + top-human share (score_decisions.py)
 blind_batches      CANDIDATES_JSONL OUT_DIR [SEED]  -> 1:1 action-matched blind-review batches of 10 + 0600 private key (blind_review.py)
 score_blind_labels LABELS_JSON KEY_JSON OUT_JSON    -> canonical reviewer label normalization + Bar e' scorer (blind_review.py)
 build_boundaries   START_UTC END_UTC OUT_JSON       -> engine build attribution + cutover sub-window splitter (build_attribution.py)
HVH_SHA (serving source) is required in the environment."""
import json, sys, hashlib, re, os
from pathlib import Path
import pg
T = Path(__file__).resolve().parent; SHA = os.environ.get('HVH_SHA') or sys.exit('HVH_SHA (40-hex serving source) is required')
if not re.fullmatch(r'[0-9a-f]{40}', SHA): sys.exit('HVH_SHA must be 40 hex')
def new(p):
    p = Path(p)
    if p.exists(): raise SystemExit('refused: %s exists' % p)
    return p
def batches(cap, sample_target=3000, per_batch=1200):
    cap = Path(cap); hk = json.loads((cap / 'human-hand-keys.json').read_text()); hands = [{'k': h['k'], 'h': h['h']} for h in hk['hands']]
    reader = (T / 'witness-reader.mjs').read_text(); out = []; pending = []
    for i in range(0, max(1, len(hands)), 1000):
        chunk = hands[i:i + 1000]
        if not chunk: break
        pending.append((new(cap / ('witness-batch-%d.mjs' % (i // 1000 + 1))), 'const selection=' + json.dumps({'sourceSha': SHA, 'hands': chunk, 'limitSec': 1100}) + ';\n' + reader)); out.append({'file': pending[-1][0].name, 'hands': len(chunk)})
    census = json.loads((cap / 'window-denominators-hands.json').read_text())['hands']
    horse = sorted((h['hand_id'] for h in census if not h.get('has_human')), key=lambda x: hashlib.sha256(x.encode()).hexdigest())
    budget = max(0, int(sample_target) - len(hands)); pick = horse[:budget]; keys = [h['k'] for h in hands]; failed = 0
    for i in range(0, len(pick), 200):
        lst = ','.join("'%s'" % x for x in pick[i:i + 200] if re.fullmatch(r'[0-9a-f-]{36}', x))
        r, err = pg.rows("select row_to_json(q) from (select encode(sha256(convert_to(lower(c.table_id::text)||':'||c.hand_number::text||':'||coalesce(c.post_commit_payload#>>'{accepted_hand_facts,horse_accepted_terminal,originalLease}',c.post_commit_payload#>>'{accepted_hand_facts,horse_journal_identity,lease_generation}'),'UTF8')),'hex') k from public.hand_atomic_commits c where c.hand_id in (%s)) q;" % lst, 20000)
        if r is None: failed += 1; continue
        keys += [x['k'] for x in r if x.get('k')]
    keys = keys[:8000]; per = int(per_batch); rb = [(new(cap / ('rollup-batch-%d.mjs' % (i // per + 1))), keys[i:i + per]) for i in range(0, len(keys), per)]
    for wp, body in pending: wp.write_text(body); wp.chmod(0o600)  # nothing is written until every input is ready
    for p, ks in rb: p.write_text('const selection=' + json.dumps({'sourceSha': SHA, 'keys': ks, 'limitSec': 1100}) + ';\n' + (T / 'rollup-reader.mjs').read_text()); p.chmod(0o600)
    print(json.dumps({'witnessBatches': out, 'rollupBatches': [{'file': p.name, 'keys': len(ks)} for p, ks in rb], 'rollupKeys': len(keys), 'humanFacing': len(hands), 'horseOnlySampled': len(keys) - len(hands), 'horseOnlyPopulation': len(horse), 'sampleRule': 'first N by sha256(hand_id)', 'failedKeyBatches': failed}))
def priors(wp, outp):
    outp = new(outp); first = {}; hstart = {}; hh = {}
    for l in Path(wp).read_text().splitlines():
        if not l.startswith('{'): continue
        r = json.loads(l)
        if 'turnKey' not in r: continue
        hstart[r['hand']] = min(hstart.get(r['hand'], r['atMs']), r['atMs'])
        for h in r.get('humansInHand') or []:
            if h.get('dealt'): hh.setdefault(r['hand'], set()).add(h['userId'])
    exact = sorted({(u, hstart[hand]) for hand, us in hh.items() for u in us})   # one prior per (human, hand): strictly before that hand
    for u, a in exact: first[u] = min(first.get(u, a), a)
    pairs = sorted(first.items()); res = []; forced = {}; failed = {'priors': [], 'forced': []}
    pt = (T / 'priors.sql.template').read_text(); ft = (T / 'forced-share.sql.template').read_text()
    for i in range(0, len(exact), 40):
        v = ','.join("('%s'::uuid, %d::bigint)" % (u, a) for u, a in exact[i:i + 40] if re.fullmatch(r'[0-9a-f-]{36}', u))
        r, err = pg.rows(pt.replace('{{PAIRS}}', v), 25000)
        if r is None: failed['priors'] += [u for u, _ in exact[i:i + 40]]; continue
        res += [x for row in r for x in (row if isinstance(row, list) else [row]) if x]
    for i in range(0, len(pairs), 5):
        v = ','.join("('%s'::uuid, %d::bigint)" % (u, a) for u, a in pairs[i:i + 5] if re.fullmatch(r'[0-9a-f-]{36}', u))
        r, err = pg.rows(ft.replace('{{PAIRS}}', v), 25000)
        if r is None: failed['forced'] += [u for u, _ in pairs[i:i + 5]]; continue
        for row in r:
            for x in (row if isinstance(row, list) else [row]):
                if x: forced[(x['user_id'], x['fam'], bool(x['trn']))] = x['forced_share']
    for x in res: x['forced_share'] = forced.get((x['user_id'], x['fam'], bool(x['trn'])))
    outp.write_text(json.dumps(res)); outp.chmod(0o600)
    print(json.dumps({'humans': len(pairs), 'humanHandPairs': len(exact), 'priorRows': len(res), 'withForcedShare': sum(1 for x in res if x['forced_share'] is not None), 'failed': {k: len(v) for k, v in failed.items()}}))
def fires(start, end, outp):
    outp = new(outp)
    r, err = pg.rows("select row_to_json(q) from (with r as materialized (select e->>'feature' f, (e->>'fires')::numeric n from horse_brain_flush_receipts r, jsonb_array_elements(r.fires) e where r.collected_at >= '%s' and r.collected_at < '%s') select (select count(*) from horse_brain_flush_receipts where collected_at >= '%s' and collected_at < '%s') receipts, (select jsonb_object_agg(f,n) from (select f, sum(n) n from r group by 1) x) fires) q;" % (start, end, start, end), 60000)
    outp.write_text(json.dumps({'startUtc': start, 'endUtc': end, 'status': 'read' if r is not None else 'missing', 'reason': err, 'result': r and r[0]})); outp.chmod(0o600)
    print(json.dumps({'status': 'read' if r is not None else 'missing', 'reason': err, 'receipts': r and r[0].get('receipts'), 'features': r and len(r[0].get('fires') or {})}))
def cohort(start, end, outp):
    outp = new(outp)
    r, err = pg.rows("select row_to_json(q) from (select f.user_id u, f.game_variant v, (f.tournament_id is not null) trn, count(*) hands from public.ca_hand_facts f join public.ca_horse_fleet_register g on g.horse_id=f.user_id and g.retired_at is null where f.played_at >= '%s' and f.played_at < '%s' group by 1,2,3) q;" % (start, end), 120000)
    c, e2 = pg.rows("select row_to_json(q) from (select count(*) n, md5(string_agg(p.id::text,',' order by p.id::text)) md5 from public.profiles p join public.ca_horse_fleet_register g on g.horse_id=p.id where p.is_horse and g.retired_at is null) q;", 20000)
    outp.write_text(json.dumps({'startUtc': start, 'endUtc': end, 'status': 'read' if r is not None else 'missing', 'reason': err, 'cohort': c and c[0], 'rows': r})); outp.chmod(0o600)
    print(json.dumps({'status': 'read' if r is not None else 'missing', 'reason': err, 'cohort': c and c[0], 'rows': r and len(r), 'horsesWithHands': r and len({x['u'] for x in r})}))
def origins(wp, outp):
    """Origin of each faced human wager, from hand_history.actions (the decision snapshot carries none). One row per (hand, human) the witness rows mark as faced."""
    outp = new(outp); pairs = set()
    for l in Path(wp).read_text().splitlines():
        if not l.startswith('{'): continue
        r = json.loads(l)
        for h in r.get('humansInHand') or []:
            if 'turnKey' in r and h.get('faced'): pairs.add((r['hand'], h['userId']))
    pairs = sorted(p for p in pairs if all(re.fullmatch(r'[0-9a-f-]{36}', x) for x in p)); res = {}; failed = 0
    for i in range(0, len(pairs), 100):
        v = ','.join("('%s'::uuid,'%s')" % p for p in pairs[i:i + 100])
        r, err = pg.rows("select row_to_json(q) from (select v.h hand, v.u opponent, (select coalesce(jsonb_agg(distinct a->>'origin'), '[]'::jsonb) from public.hand_history hh, jsonb_array_elements(hh.actions) a where hh.id = v.h and a->>'userId' = v.u and lower(a->>'action') in ('bet','raise','allin','all_in','all-in')) o from (values %s) v(h,u)) q;" % v, 25000)
        if r is None: failed += len(pairs[i:i + 100]); continue
        for x in r: res[(x['hand'], x['opponent'])] = sorted(y for y in (x['o'] or []) if y)
    out = [{'hand': h, 'opponent': u, 'aggressiveOrigins': res.get((h, u))} for h, u in pairs]   # None = not read: the packet treats it as unknown origin
    outp.write_text(json.dumps(out)); outp.chmod(0o600)
    print(json.dumps({'pairs': len(pairs), 'read': len(res), 'failed': failed, 'originSets': sorted({','.join(v) for v in res.values()})}))
def keys_light(start, end, outp):
    """Human hand keys straight from hand_history (has_human) and hand_atomic_commits, without the census: lets the originals be read first, before the database-heavy census. Same key formula as human_keys.py; the census later reconciles the set."""
    outp = new(outp); hands = []; failed = []
    for a, b in __import__('segments').pairs(start, end, 1):
        r, err = pg.rows("select row_to_json(q) from (select c.hand_id h, encode(sha256(convert_to(lower(c.table_id::text)||':'||c.hand_number::text||':'||coalesce(c.post_commit_payload#>>'{accepted_hand_facts,horse_accepted_terminal,originalLease}',c.post_commit_payload#>>'{accepted_hand_facts,horse_journal_identity,lease_generation}'),'UTF8')),'hex') k, (c.post_commit_completed_at is not null) committed, (extract(epoch from coalesce(hh.started_at,hh.created_at))*1000)::bigint start_ms from public.hand_history hh join public.hand_atomic_commits c on c.hand_id=hh.id where hh.has_human and hh.created_at >= '%s' and hh.created_at < '%s') q;" % (a, b), 20000)
        if r is None: failed.append([a, b, err]); continue
        hands += r
    ok = [h for h in hands if h.get('k')]
    outp.write_text(json.dumps({'sourceSha': SHA, 'source': 'hand_history.has_human (light; census reconciles)', 'startUtc': start, 'endUtc': end, 'humanHands': len(hands), 'withKey': len(ok), 'withoutKey': len(hands) - len(ok), 'failedSegments': failed, 'hands': ok})); outp.chmod(0o600)
    print(json.dumps({'humanHands': len(hands), 'withKey': len(ok), 'failedSegments': failed}))
def keys_variant(start, end, variant, outp):
    """v3 support read keys: every committed CASH hand of one variant (Horse-only included), same key formula as keys_light. For bounded lane asks (e.g. PLO6 maniac_price)."""
    import re as _re
    if not _re.fullmatch(r'[a-z0-9_]{2,16}', variant): raise SystemExit('refused: variant')
    outp = new(outp); hands = []; failed = []
    for a, b in __import__('segments').pairs(start, end, 1):
        r, err = pg.rows("select row_to_json(q) from (select c.hand_id h, encode(sha256(convert_to(lower(c.table_id::text)||':'||c.hand_number::text||':'||coalesce(c.post_commit_payload#>>'{accepted_hand_facts,horse_accepted_terminal,originalLease}',c.post_commit_payload#>>'{accepted_hand_facts,horse_journal_identity,lease_generation}'),'UTF8')),'hex') k, hh.has_human human, (extract(epoch from coalesce(hh.started_at,hh.created_at))*1000)::bigint start_ms from public.hand_history hh join public.hand_atomic_commits c on c.hand_id=hh.id where hh.game_variant = '%s' and hh.tournament_id is null and hh.created_at >= '%s' and hh.created_at < '%s') q;" % (variant, a, b), 20000)
        if r is None: failed.append([a, b, err]); continue
        hands += r
    ok = [h for h in hands if h.get('k')]
    outp.write_text(json.dumps({'sourceSha': SHA, 'source': 'hand_history %s cash (support read)' % variant, 'startUtc': start, 'endUtc': end, 'hands_total': len(hands), 'withKey': len(ok), 'failedSegments': failed, 'hands': ok})); outp.chmod(0o600)
    print(json.dumps({'hands': len(hands), 'withKey': len(ok), 'human': sum(1 for h in ok if h.get('human')), 'failedSegments': failed}))
def keys_batch(keys_json, outp):
    """Witness batch straight from a keys file (keys_light), for the originals-first order."""
    outp = new(outp); hk = json.loads(Path(keys_json).read_text()); hands = [{'k': h['k'], 'h': h['h']} for h in hk['hands']]
    if not hands or len(hands) > 2500: raise SystemExit('refused: %d hands' % len(hands))
    outp.write_text('const selection=' + json.dumps({'sourceSha': SHA, 'hands': hands, 'limitSec': 1100}) + ';\n' + (T / 'witness-reader.mjs').read_text()); outp.chmod(0o600)
    print(json.dumps({'file': str(outp), 'hands': len(hands)}))
def raw_batches(keys_json, cap, per_batch=100):
    """Full-record raw-reader batches (~100 hands/batch) for targeted offline replay and blind-review extraction."""
    cap = Path(cap); per = int(per_batch)
    if per < 1 or per > 500: raise SystemExit('refused: per_batch %d must be 1..500' % per)
    hk = json.loads(Path(keys_json).read_text())
    hands = [{'k': h['k'], 'h': h['h'], 'handNumber': h.get('handNumber') or h.get('hand_number')} for h in hk['hands'] if h.get('k')]
    if not hands: raise SystemExit('refused: 0 hands with journal key')
    reader = (T / 'raw-reader.mjs').read_text(); pending = []
    for i in range(0, len(hands), per):
        chunk = hands[i:i + per]
        pending.append((new(cap / ('raw-batch-%d.mjs' % (i // per + 1))), 'const selection=' + json.dumps({'sourceSha': SHA, 'hands': chunk, 'limitSec': 900}) + ';\n' + reader, len(chunk)))
    for p, body, _ in pending: p.write_text(body); p.chmod(0o600)
    print(json.dumps({'rawBatches': [{'file': p.name, 'hands': cnt} for p, _, cnt in pending], 'totalHands': len(hands), 'perBatch': per}))
def gap_targets_cmd(start, end, outp):
    rc = __import__('gap_targets').main(['gap_targets.py', 'query', start, end, outp])
    if rc != 0: raise SystemExit(rc)
def score_folds_cmd(spots_jsonl, outp, seed='20261118'):
    rc = __import__('score_decisions').main(['score_decisions.py', spots_jsonl, outp, str(seed)])
    if rc != 0: raise SystemExit(rc)
def blind_batches_cmd(candidates_jsonl, out_dir, seed='20261118', batch_size='10'):
    rc = __import__('blind_review').main(['blind_review.py', 'build', candidates_jsonl, out_dir, str(seed), str(batch_size)])
    if rc != 0: raise SystemExit(rc)
def score_blind_labels_cmd(labels_json, key_json, outp, seed='20261118'):
    rc = __import__('blind_review').main(['blind_review.py', 'score', labels_json, key_json, outp, str(seed)])
    if rc != 0: raise SystemExit(rc)
def build_boundaries_cmd(start, end, outp):
    rc = __import__('build_attribution').main(['build_attribution.py', 'check', start, end, outp])
    if rc != 0: raise SystemExit(rc)
if __name__ == '__main__':
    {'batches': batches, 'raw_batches': raw_batches, 'priors': priors, 'fires': fires, 'cohort': cohort, 'origins': origins, 'keys_light': keys_light, 'keys_variant': keys_variant, 'keys_batch': keys_batch, 'gap_targets': gap_targets_cmd, 'score_folds': score_folds_cmd, 'blind_batches': blind_batches_cmd, 'score_blind_labels': score_blind_labels_cmd, 'build_boundaries': build_boundaries_cmd}[sys.argv[1]](*sys.argv[2:])
