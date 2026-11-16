"""Terminal outcome of Lightning hands formed in the window (protocol v5 addendum, 2026-11-12, after migration 20261112000834).
Pure: the reader is injected. A voided hand is its own outcome: never a committed hand, never zero activity, never a second hand.
Outcomes: committed (settled, linked history row present) | settled_history_missing | settled_unlinked | voided |
abandoned_unresolved (instance abandoned, hand neither settled nor voided) | open_in_flight | contradictory."""
import datetime
from collections import Counter
from postseal_census import window_slices, MAX_ROWS

def classify(row):
    settled, voided = row.get('settled'), row.get('voided')
    if type(settled) is not bool or type(voided) is not bool: return 'contradictory'
    if settled and voided: return 'contradictory'
    if voided: return 'contradictory' if row.get('hand_history_id') else 'voided'
    if settled:
        if not row.get('hand_history_id'): return 'settled_unlinked'
        return 'committed' if row.get('history_row_present') is True else 'settled_history_missing'
    return 'abandoned_unresolved' if row.get('instance_state') == 'abandoned' else 'open_in_flight'

def read_outcomes(start, end, reader):
    fmt = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')
    slices, total, seen, hands = [], Counter(), set(), []
    for a, b in window_slices(start, end):
        entry = {'startUtc': fmt(a), 'endUtc': fmt(b)}
        try:
            rows = reader(a, b)
            if len(rows) > MAX_ROWS: raise RuntimeError('slice_truncated_over_6000_rows')
            ids = [r['lightning_hand_id'] for r in rows]
            if len(set(ids)) != len(ids) or seen.intersection(ids): raise RuntimeError('duplicate_lightning_hand_across_or_within_slices')
            for r in rows:
                if not a <= datetime.datetime.fromisoformat(r['formed_at']) < b: raise RuntimeError('hand_outside_slice_boundary')
            counts, kept = Counter(), []
            for r in rows:
                o = classify(r); counts[o] += 1
                if o == 'voided': counts['voided|' + ('dealt_numbered' if r.get('numbered') else 'never_dealt') + '|' + (r.get('void_reason_class') or 'unknown')[:60]] += 1
                kept.append({'lightning_hand_id': r['lightning_hand_id'], 'hand_history_id': r.get('hand_history_id'), 'outcome': o})
            seen.update(ids); hands.extend(kept); total.update(counts)
            entry.update(status='read', hands=len(rows), counts=dict(sorted(counts.items())))
        except Exception as failure:
            entry.update(status='MISSING_SERIES', reason=str(failure)[:200])
        slices.append(entry)
    return slices, total, hands

def reconcile(outcome_hands, census_hands, census_complete, outcomes_complete):
    """Link each Lightning outcome to the committed-hand census. Committed hand denominators come from the census only;
    a voided or open Lightning hand must not appear there, and no history row may be claimed by two Lightning hands."""
    census = {h['hand_id']: h for h in census_hands}
    claimed = Counter(h['hand_history_id'] for h in outcome_hands if h['hand_history_id'])
    out = Counter()
    for h in outcome_hands:
        hid, o = h['hand_history_id'], h['outcome']
        if hid and claimed[hid] > 1: out['FAIL_history_row_claimed_by_two_lightning_hands'] += 1
        elif o == 'committed':
            c = census.get(hid)
            if c is None: out['committed_outside_census_window_or_missing_slice'] += 1   # commit may land after the window; not a failure
            elif c['original_speed'] != 'lightning': out['FAIL_committed_link_is_not_a_lightning_header'] += 1
            else: out['committed_in_census'] += 1
        elif hid and hid in census: out['FAIL_uncommitted_outcome_present_in_census'] += 1
        else: out[o + '_not_in_census'] += 1
    linked = {h['hand_history_id'] for h in outcome_hands if h['outcome'] == 'committed'}
    out['census_lightning_headers_without_outcome_row'] = sum(1 for c in census_hands if c['original_speed'] == 'lightning' and c['hand_id'] not in linked)
    return {'counts': dict(sorted(out.items())), 'complete': bool(census_complete and outcomes_complete),
            'defect': any(k.startswith('FAIL_') and v for k, v in out.items()),
            'note': 'census_lightning_headers_without_outcome_row is expected for hands formed before the window start; with any missing slice every count is a lower bound.'}
