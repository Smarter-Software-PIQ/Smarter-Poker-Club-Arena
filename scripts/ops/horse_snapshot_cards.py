"""Identity-bound own-card recovery from receipted original snapshots.

Fixed-hole recovery plus explicit preflop-only Pineapple reconstruction.
DB creation/atomic-commit clocks are comparable;
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


def _recover_cards(hand, hero, candidates, pineapple=False):
    """Every candidate must agree; never pick a convenient snapshot winner."""
    variant = hand.get('game_variant')
    reasons, holdings, proofs = set(), set(), []
    if variant not in VARIANTS or (variant == 'pineapple' and not pineapple):
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
        cards = original_hero_cards({'game_variant': variant, 'hole_cards': {hero: row.get('hero_cards')}}, hero, pineapple_preflop=pineapple)
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


def recover_own_cards(hand, hero, candidates):
    return _recover_cards(hand, hero, candidates)


def recover_pineapple_original_three(hand, hero, candidates, discards):
    """Recover original three only; caller must restrict to pre-discard preflop.

    Two retained own cards plus the recorded own discard reconstruct the dealt
    set, never the earlier discard choice. No board or opponent card is read.
    """
    reasons, discarded, proofs = set(), set(), []
    for row, source in discards:
        # LEFT JOIN coverage rows are not records of a discard.
        if row.get('own_discard_id') is None:
            continue
        if (row.get('hand_id') != hand.get('id') or row.get('hero_id') != hero or
            row.get('table_id') != hand.get('table_id') or
            type(row.get('hand_number')) is not int or row.get('hand_number') != hand.get('hand_number')):
            reasons.add('pineapple_discard_identity_mismatch')
        raw = row.get('own_discarded_card')
        # Reuse the card validator with a harmless second distinct card.
        normalized = None
        for filler in ('2c', '3c'):
            pair = original_hero_cards({'game_variant':'nlh','hole_cards':{hero:[raw,filler]}},hero)
            if pair: normalized = pair[0];break
        if normalized is None:
            reasons.add('pineapple_original_discard_invalid')
        else: discarded.add(normalized)
        timestamp = instant(row.get('own_discard_created_at'))
        if timestamp is None or any(instant(r.get('committed_at')) is None or
                timestamp > instant(r.get('committed_at')) for r,_ in candidates):
            reasons.add('pineapple_discard_before_commit_unproven')
        proofs.append({**source,'discardId':row.get('own_discard_id'),
            'discardCreatedAt':row.get('own_discard_created_at')})
    if len(discarded) > 1:
        reasons.add('pineapple_conflicting_original_discards')
    reconstructed=[]
    for row,source in candidates:
        raw=row.get('hero_cards')
        if isinstance(raw,list) and len(raw)==2:
            if len(discarded)!=1:
                reasons.add('pineapple_original_discard_missing')
            else:raw=[*raw,next(iter(discarded))]
        copy={**row,'hero_cards':raw}
        cards=original_hero_cards({'game_variant':'pineapple','hole_cards':{hero:raw}},hero,True)
        if cards and discarded and not discarded.issubset(set(cards)):
            reasons.add('pineapple_discard_not_in_original_holding')
        reconstructed.append((copy,source))
    result=_recover_cards(hand,hero,reconstructed,pineapple=True)
    if hand.get('game_variant')!='pineapple':reasons.add('pineapple_variant_required')
    result['gaps']=sorted(set(result['gaps'])|reasons)
    if result['gaps']:result['cards']=None
    result['provenance'].update(source='hand_state_snapshots.original_pineapple_three',
        permittedDecisionScope='preflop_before_any_own_discard',ownDiscardSources=proofs,
        holdingRule='original_three_snapshot_or_retained_pair_union_recorded_own_discard')
    return result
