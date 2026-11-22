#!/usr/bin/env python3
"""score_decisions.py: M1/M4/M5/M11/M14 decision scorer with card firewall.

- M1: Classifies facing-bet folds/calls WITHOUT the bettor's hole cards using
  the leave-one-hand-out (LOO) mean equity against the measured bettor range in
  the same (variant, street, sizeBucket) cell, then scores EV in big blinds
  WITH the bettor's actual held cards.
- M4: Reports top-human share (`topHumanShare`) in every cell and computes the
  complete result with the top human excluded (`excludingTopHuman`).
- M5 / M14: Hand-clustered bootstrap 95% confidence interval; marks intervals
  spanning zero explicitly.
- M11: Separately counts forward changes (e.g. fold->call) and reverse changes
  (e.g. call->fold) so a one-way repair cannot introduce reverse regressions.
- Card firewall: Private inputs stay in 0400/0600 files; emitted summaries are
  verified free of card strings before writing.
"""
import collections
import hashlib
import json
import os
import random
import re
import sys
from pathlib import Path

CARD_TOKEN_RE = re.compile(r'(?<![A-Za-z0-9])[2-9TJQKA][cdhs](?![A-Za-z0-9])')


def size_bucket(bet_to_pot: float | None) -> str:
    if bet_to_pot is None or bet_to_pot <= 0:
        return 'unknown'
    if bet_to_pot < 0.40:
        return 'lt_40pct'
    if bet_to_pot < 0.60:
        return '40_60pct'
    if bet_to_pot <= 0.85:
        return '60_85pct'
    if bet_to_pot <= 1.15:
        return '85_115pct'
    return 'gt_115pct'


def anon_human(user_id: str | None) -> str:
    if not user_id:
        return 'unknown'
    return hashlib.sha256(str(user_id).encode('utf-8')).hexdigest()[:8]


def bootstrap_hand_mean_ci(
    hand_deltas: list[tuple[str, float]],
    seed: int = 20261118,
    n_boot: int = 2000,
) -> dict:
    if not hand_deltas:
        return {
            'nDecisions': 0,
            'nHands': 0,
            'totalBb': 0.0,
            'meanBbPerDecision': 0.0,
            'ci95MeanBb': [0.0, 0.0],
            'ci95TotalBb': [0.0, 0.0],
            'spansZero': True,
        }
    by_hand = collections.defaultdict(list)
    for hid, val in hand_deltas:
        by_hand[str(hid)].append(float(val))
    hand_keys = sorted(by_hand.keys())
    n_dec = len(hand_deltas)
    total_bb = sum(v for _, v in hand_deltas)
    mean_bb = total_bb / n_dec

    if len(hand_keys) == 1:
        return {
            'nDecisions': n_dec,
            'nHands': 1,
            'totalBb': round(total_bb, 4),
            'meanBbPerDecision': round(mean_bb, 4),
            'ci95MeanBb': [round(mean_bb, 4), round(mean_bb, 4)],
            'ci95TotalBb': [round(total_bb, 4), round(total_bb, 4)],
            'spansZero': True,
        }

    rng = random.Random(int(seed))
    boot_means = []
    boot_totals = []
    k = len(hand_keys)
    for _ in range(int(n_boot)):
        tot = 0.0
        cnt = 0
        for _ in range(k):
            vals = by_hand[hand_keys[rng.randrange(k)]]
            for v in vals:
                tot += v
                cnt += 1
        boot_totals.append(tot)
        boot_means.append(tot / max(1, cnt))
    boot_means.sort()
    boot_totals.sort()
    lo_idx = max(0, int(0.025 * len(boot_means)))
    hi_idx = min(len(boot_means) - 1, int(0.975 * len(boot_means)))
    lo_m, hi_m = boot_means[lo_idx], boot_means[hi_idx]
    lo_t, hi_t = boot_totals[lo_idx], boot_totals[hi_idx]
    return {
        'nDecisions': n_dec,
        'nHands': k,
        'totalBb': round(total_bb, 4),
        'meanBbPerDecision': round(mean_bb, 4),
        'ci95MeanBb': [round(lo_m, 4), round(hi_m, 4)],
        'ci95TotalBb': [round(lo_t, 4), round(hi_t, 4)],
        'spansZero': bool(lo_m <= 0.0 <= hi_m),
    }


def _call_ev_bb(pot_before_call: float, call_cost: float, equity: float, realization: float, bb: float) -> float:
    total_pot = pot_before_call + call_cost
    return ((equity * realization * total_pot) - call_cost) / bb


def score_spots(
    rows: list[dict],
    seed: int = 20261118,
    n_boot: int = 2000,
    expected_direction: tuple[str, str] = ('fold', 'call'),
) -> dict:
    """Score decision rows following M1, M4, M5, M11, and M14."""
    # Group equities by cell=(variant, street, sizeBucket) for leave-one-hand-out range classification (M1)
    cell_hand_eq: dict[tuple[str, str, str], dict[str, list[float]]] = collections.defaultdict(
        lambda: collections.defaultdict(list)
    )
    normalized = []
    for r in rows:
        hand_id = str(r['hand'])
        variant = str(r.get('variant') or 'unknown').lower()
        street = str(r.get('street') or r.get('stage') or 'unknown').lower()
        bb = float(r.get('bigBlind') or 1.0)
        if bb <= 0:
            raise ValueError(f'bigBlind must be > 0 in hand {hand_id}')
        pot_before = float(r['potBeforeCall'])
        call_cost = float(r['callCost'])
        if call_cost <= 0 or pot_before < 0:
            raise ValueError(f'invalid potBeforeCall/callCost in hand {hand_id}')
        bet_ratio = r.get('betToPot')
        if bet_ratio is None and r.get('betSize') is not None:
            denom = max(bb, pot_before - float(r['betSize']))
            bet_ratio = float(r['betSize']) / denom
        sb = str(r.get('sizeBucket') or size_bucket(float(bet_ratio) if bet_ratio is not None else None))
        actual_eq = float(r['equityVsActualHand'])
        range_eq_obs = float(r.get('rangeSampleEquity', actual_eq))
        realization = float(r.get('realization', 1.0))
        base_act = str(r['baseAction']).lower()
        cand_act = str(r.get('candidateAction', base_act)).lower()
        opp_hash = anon_human(r.get('opponentId') or r.get('opponent'))

        cell = (variant, street, sb)
        cell_hand_eq[cell][hand_id].append(range_eq_obs)
        normalized.append({
            'hand': hand_id,
            'cell': cell,
            'bb': bb,
            'potBefore': pot_before,
            'callCost': call_cost,
            'price': call_cost / (pot_before + call_cost),
            'actualEq': actual_eq,
            'realization': realization,
            'baseAction': base_act,
            'candidateAction': cand_act,
            'oppHash': opp_hash,
        })

    # Precompute cell totals so leave-one-hand-out excludes every observation from the same hand
    cell_totals = {}
    for cell, by_h in cell_hand_eq.items():
        tot_sum = sum(sum(vs) for vs in by_h.values())
        tot_cnt = sum(len(vs) for vs in by_h.values())
        cell_totals[cell] = (tot_sum, tot_cnt)

    scored = []
    for item in normalized:
        cell = item['cell']
        tot_sum, tot_cnt = cell_totals[cell]
        same_hand = cell_hand_eq[cell][item['hand']]
        rem_cnt = tot_cnt - len(same_hand)
        loo_eq = ((tot_sum - sum(same_hand)) / rem_cnt) if rem_cnt > 0 else None
        classified_call_profitable = (
            (loo_eq * item['realization']) > item['price'] if loo_eq is not None else None
        )

        call_ev = _call_ev_bb(
            item['potBefore'], item['callCost'], item['actualEq'], item['realization'], item['bb']
        )
        base_ev = call_ev if item['baseAction'] == 'call' else 0.0
        cand_ev = call_ev if item['candidateAction'] == 'call' else 0.0
        delta_ev = cand_ev - base_ev

        scored.append({
            **item,
            'looRangeEq': loo_eq,
            'classifiedUnderfoldingOrWrongFold': (
                item['baseAction'] == 'fold' and classified_call_profitable is True
            ),
            'callEvActualBb': call_ev,
            'deltaEvActualBb': delta_ev,
        })

    def summarize_subset(items: list[dict]) -> dict:
        opp_counts = collections.Counter(x['oppHash'] for x in items)
        top_opp, top_cnt = opp_counts.most_common(1)[0] if opp_counts else ('none', 0)
        top_share = (top_cnt / len(items)) if items else 0.0

        changed = [x for x in items if x['baseAction'] != x['candidateAction']]
        fwd_from, fwd_to = expected_direction
        fwd = [x for x in changed if (x['baseAction'], x['candidateAction']) == (fwd_from, fwd_to)]
        rev = [x for x in changed if (x['baseAction'], x['candidateAction']) != (fwd_from, fwd_to)]

        folds = [x for x in items if x['baseAction'] == 'fold']
        loo_flagged_folds = [x for x in folds if x['classifiedUnderfoldingOrWrongFold']]

        non_top_changed = [x for x in changed if x['oppHash'] != top_opp]
        non_top_folds = [x for x in folds if x['oppHash'] != top_opp]

        return {
            'spots': len(items),
            'hands': len({x['hand'] for x in items}),
            'distinctHumans': len(opp_counts),
            'topHuman': {
                'opponentHash8': top_opp,
                'spots': top_cnt,
                'share': round(top_share, 4),
                'singlePlayerDominated': bool(top_share > 0.50),
            },
            'foldContextOnly': {
                'folds': len(folds),
                'foldRate': round(len(folds) / len(items), 4) if items else 0.0,
                'meanRequiredPrice': round(sum(x['price'] for x in items) / len(items), 4) if items else 0.0,
                'meanFoldedRealizedEquityActual': (
                    round(sum(x['actualEq'] * x['realization'] for x in folds) / len(folds), 4)
                    if folds
                    else None
                ),
                'callingEveryFoldActual': bootstrap_hand_mean_ci(
                    [(x['hand'], x['callEvActualBb']) for x in folds], seed=seed, n_boot=n_boot
                ),
            },
            'looRangeClassifiedFolds': {
                'flaggedCount': len(loo_flagged_folds),
                'scoredAgainstActualHands': bootstrap_hand_mean_ci(
                    [(x['hand'], x['callEvActualBb']) for x in loo_flagged_folds], seed=seed, n_boot=n_boot
                ),
            },
            'candidateChanges': {
                'changedTotal': len(changed),
                'forwardChanges': len(fwd),
                'reverseChanges': len(rev),
                'directionClean': len(rev) == 0,
                'allChangedEvActual': bootstrap_hand_mean_ci(
                    [(x['hand'], x['deltaEvActualBb']) for x in changed], seed=seed, n_boot=n_boot
                ),
                'excludingTopHuman': {
                    'spots': len(items) - top_cnt,
                    'folds': len(non_top_folds),
                    'changed': len(non_top_changed),
                    'distinctHumans': max(0, len(opp_counts) - (1 if top_cnt else 0)),
                    'changedEvActual': bootstrap_hand_mean_ci(
                        [(x['hand'], x['deltaEvActualBb']) for x in non_top_changed], seed=seed, n_boot=n_boot
                    ),
                },
            },
        }

    by_cell = {}
    cells_grouped = collections.defaultdict(list)
    for s in scored:
        v, st, sb = s['cell']
        cells_grouped[f'{v}:{st}:{sb}'].append(s)
    for k in sorted(cells_grouped):
        by_cell[k] = summarize_subset(cells_grouped[k])

    result = {
        'version': 1,
        'seed': int(seed),
        'bootstrapIterations': int(n_boot),
        'expectedDirection': list(expected_direction),
        'overall': summarize_subset(scored),
        'byCell': by_cell,
    }
    serialized = json.dumps(result, indent=1)
    if CARD_TOKEN_RE.search(serialized):
        raise RuntimeError('card firewall breach: card token detected in aggregate output')
    return result


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        sys.stderr.write('usage: score_decisions.py SPOTS_JSONL OUT_JSON [SEED]\n')
        return 2
    in_path = Path(argv[1])
    out_path = Path(argv[2])
    seed = int(argv[3]) if len(argv) > 3 else 20261118
    if out_path.exists():
        sys.stderr.write(f'refused: {out_path} exists\n')
        return 1
    rows = [
        json.loads(line)
        for line in in_path.read_text(encoding='utf-8').splitlines()
        if line.strip().startswith('{')
    ]
    summary = score_spots(rows, seed=seed)
    fd = os.open(str(out_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    try:
        os.write(fd, (json.dumps(summary, indent=1) + '\n').encode('utf-8'))
    finally:
        os.close(fd)
    sys.stdout.write(json.dumps({
        'spots': summary['overall']['spots'],
        'changed': summary['overall']['candidateChanges']['changedTotal'],
        'reverseChanges': summary['overall']['candidateChanges']['reverseChanges'],
        'topHumanShare': summary['overall']['topHuman']['share'],
    }) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
