"""Public before-choice geometry. All pot math uses integer cents."""
from decimal import Decimal


def cents(value):
    if type(value) not in (float, int):
        raise ValueError
    units = Decimal(str(value)) * 100
    if not units.is_finite() or units < 0 or units != units.to_integral_value():
        raise ValueError
    return int(units)


def wager_geometry(info):
    state = info.get('publicState') or {}
    source = state.get('seats')
    hero = info.get('heroSeat')
    try:
        if not isinstance(source, list) or not 2 <= len(source) <= 10:
            raise ValueError
        seats = {}
        for row in source:
            seat, stack, wager, total, dead, ante, flags = row
            if type(seat) is not int or seat in seats or type(flags) is not int or not 0 <= flags <= 7:
                raise ValueError
            stack, wager, total, dead, ante = map(cents, (stack, wager, total, dead, ante))
            if not ante <= dead <= total or wager > total - dead:
                raise ValueError
            seats[seat] = (stack, wager, total, dead, ante, flags)
        if hero not in seats or seats[hero][5] & 7:
            raise ValueError
        pot = cents(state.get('pot'))
        price = cents(state.get('toCall'))
        if sum(s[2] for s in seats.values()) != pot:
            return {'status': 'unavailable', 'reason': 'contributions_do_not_reconcile_to_pot'}
    except (TypeError, ValueError):
        return {'status': 'unavailable', 'reason': 'original_seat_or_price_geometry_missing'}
    stack, wager = seats[hero][:2]
    call = min(price, stack)
    opponents = {n: min(stack + wager, s[0] + s[1]) / 100
                 for n, s in seats.items() if n != hero and not s[5] & 1}
    # PokerEngine.calculatePots separates pooled dead blinds/BBA from individual
    # matched antes. Partition the hypothetical call without assuming later action.
    live = {n for n, s in seats.items() if not s[5] & 1}
    total = {n: s[2] + (call if n == hero else 0) for n, s in seats.items()}
    invested = {n: total[n] - s[3] + s[4] for n, s in seats.items()}
    dead = sum(s[3] - s[4] for s in seats.values())
    layers = []
    orphan = previous = 0
    for level in sorted(set(invested.values()) - {0}):
        contributors = {n for n, amount in invested.items() if amount >= level}
        eligible = sorted(contributors & live)
        amount = (level - previous) * len(contributors)
        previous = level
        if eligible:
            layers.append([eligible, amount])
        else:
            orphan += amount
    if layers:
        layers[0][1] += orphan
        if dead:
            layers.insert(0, [sorted(n for n in live if total[n] > 0), dead])
    elif dead + orphan:
        layers.append([sorted(live), dead + orphan])
    merged = []
    for eligible, amount in layers:
        if merged and merged[-1][0] == eligible:
            merged[-1][1] += amount
        else:
            merged.append([eligible, amount])
    eligible_amount = sum(amount for eligible, amount in merged if hero in eligible)
    legal = info.get('legalActions')
    prior = info.get('priorPublicActions')
    facing_again = None
    intervening = None
    if isinstance(prior, list):
        street = [a for a in prior if a.get('stage', a.get('street')) == info.get('street')]
        previous_choices = [i for i, a in enumerate(street) if a.get('seat') == hero
                            and a.get('action') in ('check','call','bet','raise','all_in','fold')
                            and a.get('origin') != 'forced']
        facing_again = bool(previous_choices) and price > 0
        if facing_again:
            intervening = [{'action': a.get('action'), 'seat': a.get('seat'),
                            'fullRaise': a.get('isFullRaise')} for a in street[previous_choices[-1]+1:]
                           if a.get('action') in ('bet','raise','all_in')]
    return {'status': 'captured', 'effectiveStreetRaiseToByOpponent': opponents,
            'callCost': call / 100, 'eligibleAfterCall': eligible_amount / 100,
            'grossCallBreakEvenShare': call / eligible_amount if call and eligible_amount else None,
            'layersAfterCall': [{'eligibleSeats': e, 'chips': a / 100} for e, a in merged],
            'facingAnotherWagerThisStreet': facing_again, 'interveningWagers': intervening,
            'canIncreaseCurrentWager': (('raise' in legal or 'bet' in legal or
                ('all_in' in legal and stack > price)) if isinstance(legal, list) and legal else None)}
