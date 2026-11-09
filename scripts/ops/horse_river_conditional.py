"""Finite, declared-response Omaha river comparison; never a policy or solver.

All monetary inputs are integer chip units. Range weights and response
probabilities are interpreted as exact decimal rational numbers. No historical
opponent private cards belong in a declared range specification.
"""
from fractions import Fraction
import hashlib
import json
import math
from omaha_reference import card, share


def _number(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('invalid_numeric_assumption')
    return Fraction(str(value))


def price_checked_to_river(request):
    """Check-through versus legal bets, under full holding fold/call responses.

    Caller must supply explicit domain assertions. This validates their scope,
    not their provenance. Raises are refused rather than silently ignored.
    """
    context = request.get('context', {})
    lightning = request.get('costModel') == 'captured-lightning-bb-ante-v1'
    captured_costs = lightning or request.get('costModel') == 'captured-chip-rake-v1'
    if request.get('costModel') not in (None, 'captured-chip-rake-v1', 'captured-lightning-bb-ante-v1'):
        raise ValueError('unsupported_cost_model')
    required = {'mode': 'cash', 'street': 'river', 'structure': 'pot_limit',
                'boardCount': 1, 'playersInHand': 2, 'dealtCount': 2,
                'closingAction': True, 'toCallUnits': 0, 'rakeUnits': 0,
                'feesUnits': 0, 'anteUnits': 0, 'deadUnits': 0,
                'sidePots': False, 'bombPot': False, 'allInOrFold': False}
    if lightning:
        # Exact dealt count and dead investment are linked to the captured
        # seats and forced posts in captured_terminal_prices.
        for key in ('dealtCount', 'anteUnits', 'deadUnits'):
            if type(context.get(key)) is not int or context[key] <= 0:
                raise ValueError('unsupported_context:' + key)
            required.pop(key)
    if captured_costs:
        required.pop('rakeUnits')
        if 'rakeUnits' in context:
            raise ValueError('captured_rake_is_branch_specific')
    for key, expected in required.items():
        if key not in context or type(context[key]) is not type(expected) or context[key] != expected:
            raise ValueError('unsupported_context:' + key)
    variant = request.get('variant')
    if variant not in ('plo4', 'plo5', 'plo6'):
        raise ValueError('unsupported_variant')
    hero = list(map(card, request.get('hero', [])))
    board = list(map(card, request.get('board', [])))
    if len(board) != 5:
        raise ValueError('river_board_required')
    pot = request.get('potUnits')
    hero_stack = request.get('heroStackUnits')
    other_stack = request.get('opponentStackUnits')
    minimum = request.get('minimumBetUnits')
    for amount in (pot, hero_stack, other_stack, minimum):
        if type(amount) is not int or amount <= 0:
            raise ValueError('positive_integer_chip_units_required')
    if minimum > pot:
        raise ValueError('invalid_minimum_bet')
    bets = request.get('betSizesUnits')
    if not isinstance(bets, list) or not bets or len(bets) > 32:
        raise ValueError('finite_bet_menu_required')
    if len(set(bets)) != len(bets):
        raise ValueError('duplicate_bet_size')
    for bet in bets:
        if type(bet) is not int or bet <= 0 or bet > min(pot, hero_stack) or (bet < minimum and bet != hero_stack):
            raise ValueError('illegal_bet_size')
    terminals = provenance = None
    if captured_costs:
        from horse_river_captured_costs import captured_terminal_prices
        terminals, provenance = captured_terminal_prices(request)
    rows = request.get('range')
    if not isinstance(rows, list) or not rows or len(rows) > 4096:
        raise ValueError('finite_full_holding_range_required')
    total = Fraction(0); check = Fraction(0)
    values = {b: Fraction(0) for b in bets}; fold_rates = {b: Fraction(0) for b in bets}
    seen = set()
    for row in rows:
        holding = tuple(sorted(map(card, row.get('cards', []))))
        if holding in seen:
            raise ValueError('duplicate_range_holding')
        seen.add(holding)
        equity = Fraction(str(share(hero, holding, board, variant)))
        if not captured_costs and equity == Fraction(1, 2) and pot % 2:
            raise ValueError('odd_chip_tie_ownership_required')
        weight = _number(row.get('weight'))
        if weight <= 0:
            raise ValueError('positive_weight_required')
        responses = row.get('responses', {})
        if set(responses) != {str(b) for b in bets}:
            raise ValueError('size_specific_response_required')
        outcome = 'win' if equity == 1 else 'tie' if equity == Fraction(1, 2) else 'loss'
        total += weight; check += weight * (terminals[(0, outcome)] if captured_costs else equity * pot)
        for bet in bets:
            response = responses[str(bet)]
            if set(response) != {'fold', 'call', 'raise'}:
                raise ValueError('complete_response_required')
            f, c, r = (_number(response[k]) for k in ('fold', 'call', 'raise'))
            if min(f, c, r) < 0 or f + c + r != 1:
                raise ValueError('invalid_response_distribution')
            if r:
                raise ValueError('raise_continuation_unpriced')
            # Opponent cannot match more than its stack. Excess is returned,
            # so only the matched portion is a new investment on a call.
            matched = min(bet, other_stack)
            values[bet] += weight * (f * terminals[(bet, 'fold')] + c * terminals[(bet, outcome)] if captured_costs
                                     else f * pot + c * (equity * (pot + 2 * matched) - matched))
            fold_rates[bet] += weight * f
    def number(x):
        return {'value': float(x), 'exact': str(x)}
    result = {'model': 'declared-hu-omaha-river-fold-call-no-costs-v1',
              'inputSha256': hashlib.sha256(json.dumps(request, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest(),
              'variant': variant, 'checkThroughEvUnits': number(check / total),
              'bets': [{'betUnits': b, 'evUnits': number(values[b] / total),
                        'minusCheckUnits': number((values[b] - check) / total),
                        'foldProbability': number(fold_rates[b] / total)} for b in bets],
              'conditionalOnDeclaredRangeAndResponse': True,
              'originalRuntimeAuthenticated': False, 'qualified': False,
              'gtoVerified': False, 'activationAllowed': False}
    if captured_costs:
        result['model'] = ('declared-hu-omaha-river-lightning-bb-ante-v1' if lightning
                           else 'declared-hu-omaha-river-captured-chip-rake-v1')
        result['capturedAccounting'] = provenance
    return result


def main():
    """Private JSON request/output route; never generates opponent assumptions."""
    import argparse
    import os
    from pathlib import Path
    import stat
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        # Reject symlinks and permissions exposing private hand assumptions.
        fd = os.open(args.input, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'r') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
                raise ValueError('input_requires_private_regular_file_mode_0600_or_stricter')
            if info.st_size > 16 * 1024 * 1024:
                raise ValueError('input_exceeds_16MiB_limit')
            request = json.load(source)
        result = price_checked_to_river(request)
        parent = args.output.parent
        parent_info = parent.stat()
        if not stat.S_ISDIR(parent_info.st_mode) or parent_info.st_mode & 0o077:
            raise ValueError('output_parent_requires_private_directory_mode_0700_or_stricter')
        payload = json.dumps(result, indent=2, allow_nan=False) + '\n'
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
    except (ValueError, TypeError, KeyError, OSError) as error:
        parser.exit(2, 'Conditional river request refused: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
