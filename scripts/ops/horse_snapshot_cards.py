"""Identity-bound own-card recovery from receipted original snapshots.

Only fixed-hole variants. DB creation/atomic-commit clocks are comparable;
engine history timestamps are retained but are not calibrated DB bounds.
"""
from datetime import datetime
from horse_hand_analysis import actor_id, original_hero_cards, VARIANTS


def instant(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo is not None else None
    except ValueError:
        return None


def seat(value):
    if type(value) is int and value >= 0:
        return value
    if isinstance(value, str) and value.isdecimal():
        return int(value)
    return None


def recover_own_cards(hand, hero, candidates):
    """Every candidate must agree; never pick a convenient snapshot winner."""
    variant = hand.get('game_variant')
    reasons, holdings, proofs = set(), set(), []
    if variant not in VARIANTS or variant == 'pineapple':
        reasons.add('snapshot_fixed_hole_variant_required')
    players = [p for p in hand.get('players', []) if isinstance(p, dict) and actor_id(p) == hero]
    expected_seat = seat(players[0].get('seat')) if len(players) == 1 else None
    if expected_seat is None:
        reasons.add('snapshot_actor_seat_unbound')
    for row, source in candidates:
        config = row.get('original_config')
        config = config if isinstance(config, dict) else {}
        if (not hand.get('id') or not hand.get('table_id') or
            row.get('hand_id') != hand.get('id') or row.get('hero_id') != hero or
            row.get('expected_table_id') != hand.get('table_id') or
            row.get('table_id') != hand.get('table_id') or
            config.get('tableId') != hand.get('table_id') or
            type(hand.get('hand_number')) is not int or
            type(row.get('hand_number')) is not int or type(config.get('handNumber')) is not int or
            row.get('hand_number') != hand.get('hand_number') or
            config.get('handNumber') != hand.get('hand_number') or
            row.get('game_variant') != variant or config.get('gameVariant') != variant or
            seat(row.get('hero_seat')) != expected_seat):
            reasons.add('snapshot_identity_mismatch')
        created, committed = instant(row.get('snapshot_created_at')), instant(row.get('committed_at'))
        if not row.get('snapshot_id') or created is None or committed is None or created > committed:
            reasons.add('snapshot_original_before_commit_unproven')
        cards = original_hero_cards({'game_variant': variant, 'hole_cards': {hero: row.get('hero_cards')}}, hero)
        if cards is None:
            reasons.add('snapshot_own_cards_invalid')
        else:
            holdings.add(tuple(sorted(cards)))
        proofs.append({**source, 'snapshotId': row.get('snapshot_id'),
            'snapshotCreatedAt': row.get('snapshot_created_at'),
            'snapshotUpdatedAt': row.get('snapshot_updated_at'),
            'atomicCommittedAt': row.get('committed_at'),
            'historyStartedAt': row.get('hand_started_at'),
            'historyEndedAt': row.get('hand_ended_at')})
    if len(holdings) > 1:
        reasons.add('snapshot_conflicting_own_holdings')
    if not candidates:
        reasons.add('snapshot_original_unavailable')
    return {'cards': list(next(iter(holdings))) if not reasons and len(holdings) == 1 else None,
            'gaps': sorted(reasons), 'provenance': {
                'source': 'hand_state_snapshots.original_fixed_hole',
                'identity': {'handId': hand.get('id'), 'tableId': hand.get('table_id'),
                    'handNumber': hand.get('hand_number'), 'actorId': hero, 'seat': expected_seat,
                    'variant': variant},
                'clockRule': 'database_created_at_not_after_atomic_commit;engine_clock_not_compared',
                'snapshots': proofs}}
