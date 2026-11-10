"""Price passive PLO5/PLO6 decisions against an identified human.

Inputs are original initiative rows and their independently bound wager geometry.
Report sensitivity per opportunity in BB. Each scenario assumes check-through on
later streets, no deductions, and a single fold/call response to the minimum
priced increase. Never interpret these unweighted scenarios as observed regret.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import json
import math
from pathlib import Path


def conditional_deltas(pot, call, extra):
    """Increment over calling/checking with the same distribution of holdings."""
    for fold in (0, 0.25, 0.5):
        for folded_share, called_share in ((0, 0), (0.4, 0.2), (0.75, 0.45),
                                           (0.9, 0.65), (1, 1)):
            # Where a raise gets a fold, a call would retain equity in pot + call.
            # Where called, only the newly matched extra investment differs.
            fold_delta = (pot + call) * (1 - folded_share)
            call_delta = extra * (2 * called_share - 1)
            yield fold * fold_delta + (1 - fold) * call_delta


def ranking(initiative_rows, geometry_rows):
    candidates = {}
    opportunity_ids = set()
    bound_ids = set()
    counts = defaultdict(Counter)
    for row in initiative_rows:
        mode, variant, _ = row['domain'].split('/')
        if variant not in ('plo5', 'plo6'):
            raise ValueError('unexpected_variant')
        if (row['category'] != 'strong_facing_wager' or not row['facingIdentifiedHumanBet']
                or row['street'] not in ('flop', 'turn') or not row['prices']):
            continue
        if row['id'] in opportunity_ids:
            raise ValueError('duplicate_candidate_decision')
        opportunity_ids.add(row['id'])
        key = (row['domain'], row['street'], row['ante'])
        counts[key]['opportunities'] += 1
        counts[key]['recorded_' + row['recordedAction']] += 1
        if row['recordedAction'] != 'call':
            continue
        if mode != 'cash':
            counts[key]['requires_payout_utility'] += 1
        elif row['liveOpponents'] != 1:
            counts[key]['requires_joint_response_model'] += 1
        else:
            candidates[row['id']] = (row, key)

    for geo in geometry_rows:
        if geo['decisionId'] in bound_ids:
            raise ValueError('duplicate_bound_geometry')
        pending = candidates.pop(geo['decisionId'], None)
        if pending is None:
            continue
        bound_ids.add(geo['decisionId'])
        row, key = pending
        if geo['inputDigest'] != row['info'] or geo['domain'] != row['domain']:
            raise ValueError('original_geometry_identity_mismatch')
        g = geo['geometry']
        if (g.get('status') != 'captured' or not g.get('canIncreaseCurrentWager')
                or not math.isclose(g['callCost'], row['call'], rel_tol=0, abs_tol=0.00001)
                or not math.isclose(g['eligibleAfterCall'], row['pot'] + row['call'],
                                    rel_tol=0, abs_tol=0.00001)
                or not g['layersAfterCall']
                or any(len(layer['eligibleSeats']) != 2 for layer in g['layersAfterCall'])):
            counts[key]['requires_different_pot_geometry'] += 1
            continue
        target = min(row['prices'], key=lambda price: price['to'])
        extra = target['maxMatchedExtraChips']
        if min(extra, row['bb'], row['call']) <= 0:
            raise ValueError('nonpositive_decision_price')
        changes = list(conditional_deltas(row['pot'], row['call'], extra))
        group = counts[key]
        group['scenario_priced_calls'] += 1
        group['sum_min_delta_bb'] += min(changes) / row['bb']
        group['sum_max_delta_bb'] += max(changes) / row['bb']
    if candidates:
        raise ValueError('missing_decision_geometry')
    result = []
    for key, group in sorted(counts.items()):
        n = group['scenario_priced_calls']
        result.append(dict(domain=key[0], street=key[1], ante=key[2],
                           opportunities=group['opportunities'],
                           observedActions={k[9:]: v for k, v in group.items()
                                            if k.startswith('recorded_')},
                           pricedCalls=n, unpricedCallReasons={k: v for k, v in group.items()
                                                              if k.startswith('requires_')},
                           meanScenarioMinDeltaBB=group['sum_min_delta_bb'] / n if n else None,
                           meanScenarioMaxDeltaBB=group['sum_max_delta_bb'] / n if n else None,
                           measuredStrategyLossBB=None))
    return sorted(result, key=lambda r: -r['opportunities'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--initiative', type=Path, required=True)
    parser.add_argument('--geometry', type=Path, required=True)
    args = parser.parse_args()
    with gzip.open(args.initiative, 'rt') as first, gzip.open(args.geometry, 'rt') as second:
        groups = ranking(map(json.loads, first), map(json.loads, second))
    print(json.dumps({'scope': __doc__, 'groups': groups}, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
