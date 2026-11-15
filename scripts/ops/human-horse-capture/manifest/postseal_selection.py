"""Protocol v4 hand classification and bounded selection. Pure functions; no I/O.

Exclusions are applied FIRST. A hand is human-facing only when its dealt roster positively
shows at least one eligible human and at least one Horse. The has_human header flag never
decides eligibility; disagreement with it is counted. The final attribution still comes from
original decision frames in the report."""
import re
from collections import Counter

UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
CLASSES = ('eligible_mixed', 'excluded_human_only', 'horse_only', 'no_horse', 'unknown_roster')
SELECTABLE_FILL = ('eligible_mixed', 'horse_only', 'excluded_human_only')
SPEEDS = ('table', 'lightning')
VARIANTS = ('nlh', 'plo4', 'plo5', 'plo6')
PER_CELL, EXTRA_MIXED, MAX_HANDS = 2, 8, 32


def classify_roster(roster, excluded_ids):
    """roster: list of {'userId': str, 'is_horse': bool|None}; is_horse None = no profile row."""
    if not isinstance(roster, list) or not roster:
        return {'class': 'unknown_roster', 'reason': 'roster_missing', 'horses': 0, 'eligible': 0, 'excluded': 0, 'unknown': 0}
    horses = eligible = excluded = unknown = 0
    for member in roster:
        uid = member.get('userId') if isinstance(member, dict) else None
        if isinstance(uid, str) and uid in excluded_ids:
            excluded += 1  # exclusion first, whatever the profile says
        elif not isinstance(uid, str) or not UUID.match(uid) or member.get('is_horse') is None:
            unknown += 1
        elif member['is_horse'] is True:
            horses += 1
        elif member['is_horse'] is False:
            eligible += 1
        else:
            unknown += 1
    counts = {'horses': horses, 'eligible': eligible, 'excluded': excluded, 'unknown': unknown}
    if horses and eligible:
        return {'class': 'eligible_mixed', 'reason': 'unknown_member_present' if unknown else None, **counts}
    if unknown:
        return {'class': 'unknown_roster', 'reason': 'unidentified_member', **counts}
    if horses and excluded:
        return {'class': 'excluded_human_only', 'reason': None, **counts}
    if horses:
        return {'class': 'horse_only', 'reason': None, **counts}
    return {'class': 'no_horse', 'reason': None, **counts}


def cell_of(row):
    return (row['game_variant'], 'tournament' if row['tournament'] else 'cash', row['original_speed'])


def expected_cells():
    return [(v, m, s) for v in VARIANTS for m, s in (('cash', 'table'), ('cash', 'lightning'), ('tournament', 'table'))]


BOUND = ('accepted_terminal_sealed_source', 'lightning_journal_identity')


def bound_candidates(census_hands):
    """Census rows eligible for export: target variants bound to the sealed source or the Lightning identity."""
    return [h for h in census_hands if h['game_variant'] in VARIANTS and h['binding'] in BOUND]


def select(rows, excluded_ids):
    """rows: source-bound candidate hands. Returns (targets, diagnostics). Deterministic."""
    seen, classified = set(), []
    for row in rows:
        if row['hand_id'] in seen:
            raise ValueError('duplicate_candidate_hand')
        seen.add(row['hand_id'])
        cls = row['roster_class'] if 'roster_class' in row else classify_roster(row.get('roster'), excluded_ids)
        classified.append({**{k: v for k, v in row.items() if k != 'roster'}, 'roster_class': cls})
    order = lambda r: (SELECTABLE_FILL.index(r['roster_class']['class']), _neg(r['created_at']), r['hand_id'])
    targets, chosen = [], set()
    for cell in expected_cells():
        pool = sorted((r for r in classified if cell_of(r) == cell and r['roster_class']['class'] in SELECTABLE_FILL), key=order)
        for rank, row in enumerate(pool[:PER_CELL], 1):
            targets.append({**row, 'pick': 'cell', 'cell_rank': rank}); chosen.add(row['hand_id'])
    extras = sorted((r for r in classified if r['roster_class']['class'] == 'eligible_mixed' and r['hand_id'] not in chosen),
                    key=lambda r: (_neg(r['created_at']), r['hand_id']))[:EXTRA_MIXED]
    targets += [{**row, 'pick': 'extra_eligible_mixed', 'cell_rank': None} for row in extras]
    if len(targets) > MAX_HANDS:
        raise ValueError('selection_bound')
    by = Counter('/'.join(cell_of(r)) + '/' + r['roster_class']['class'] for r in classified)
    flag = Counter()
    for r in classified:
        c = r['roster_class']['class']
        if r.get('has_human') and c in ('horse_only', 'no_horse'): flag['flagged_human_but_no_human_in_roster'] += 1
        if r.get('has_human') and c == 'excluded_human_only': flag['flagged_human_excluded_subjects_only'] += 1
        if not r.get('has_human') and c == 'eligible_mixed': flag['eligible_mixed_not_flagged_human'] += 1
        if r.get('has_human') and c == 'unknown_roster': flag['flagged_human_unknown_roster'] += 1
    observed = {cell_of(t) for t in targets if t['pick'] == 'cell'}
    mixed_cells = {cell_of(t) for t in targets if t['roster_class']['class'] == 'eligible_mixed'}
    diagnostics = {
        'candidatesClassified': len(classified), 'byCellAndClass': dict(sorted(by.items())),
        'byClass': dict(Counter(r['roster_class']['class'] for r in classified)),
        'unknownRosterReasons': dict(Counter(r['roster_class']['reason'] for r in classified if r['roster_class']['class'] == 'unknown_roster')),
        'eligibleMixedWithUnknownMember': sum(1 for r in classified if r['roster_class']['reason'] == 'unknown_member_present'),
        'headerFlagDisagreements': dict(flag),
        'cellsWithoutAnySelectedHand': ['/'.join(c) for c in expected_cells() if c not in observed],
        'cellsWithoutEligibleMixedHand': ['/'.join(c) for c in expected_cells() if c not in mixed_cells],
        'unknownSpeedByClass': dict(Counter(r['roster_class']['class'] for r in classified if r['original_speed'] not in SPEEDS)),
        'selectedByClass': dict(Counter(t['roster_class']['class'] for t in targets)),
        'selectionBias': 'Purposive, latest-first, eligible-mixed-first, at most two hands per cell plus eight. Not a random or proportional sample; never a basis for rates.',
    }
    return targets, diagnostics


def _neg(created_at):
    # latest first for ISO-8601 strings of equal shape: invert characters
    return ''.join(chr(255 - ord(c)) for c in created_at)
