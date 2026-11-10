"""Heads-up closing river opportunity cost in integer chip units.

The opponent can fold or call a bet. The same opposing holding applies to
both choices. Payoff bounds deliberately allow every win/tie/loss class;
a class impossible for the actual cards can make the outer bounds loose.
"""
from collections import defaultdict


def terminal_cost_bounds(prices, observed):
    """Bound the advantage of each priced alternative over the observed size."""
    if type(observed) is not int or observed < 0:
        raise ValueError('observed_wager_requires_integer_units')
    cells = defaultdict(dict)
    for row in prices:
        size, outcome, payoff = row['bet'], row['result'], row['heroIncrementalUnits']
        if (type(size) is not int or size < 0 or type(payoff) is not int
                or outcome not in ('win', 'tie', 'loss', 'fold') or outcome in cells[size]):
            raise ValueError('invalid_or_duplicate_terminal_cell')
        cells[size][outcome] = payoff
    if (observed not in cells or 0 not in cells or len(cells) < 2
            or any(len(outcomes) != 4 for outcomes in cells.values())):
        raise ValueError('incomplete_size_or_outcome_menu')

    def possible(size, showdown):
        if size == 0:
            return [cells[size][showdown]]
        return [cells[size][showdown], cells[size]['fold']]

    alternatives = []
    for size in sorted(cells):
        if size == observed:
            continue
        differences = [
            counterfactual - actual
            for showdown in ('win', 'tie', 'loss')
            for counterfactual in possible(size, showdown)
            for actual in possible(observed, showdown)
        ]
        alternatives.append({'betUnits': size, 'lowerUnits': min(differences),
                             'upperUnits': max(differences)})
    return {
        'observedBetUnits': observed, 'alternatives': alternatives,
        'regretLowerUnits': max(0, max(x['lowerUnits'] for x in alternatives)),
        'regretUpperUnits': max(0, max(x['upperUnits'] for x in alternatives)),
        'scope': 'outer_bounds_across_priced_sizes_and_fold_call_responses',
    }
