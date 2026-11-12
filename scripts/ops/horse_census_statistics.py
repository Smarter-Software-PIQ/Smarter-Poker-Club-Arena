#!/usr/bin/env python3
"""Cluster-robust Liang-Zeger ratio sandwich, ANOVA/Kish ICC, DEFF, N_eff, and cluster bootstrap."""
from __future__ import annotations

import math
import random
from collections import defaultdict
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

Z_975 = 1.959963984540054

# Exact two-sided 95% Student-t critical values (t_{df, 0.975}) for df = 1..30,
# plus high-accuracy Peizer-Pratt / Cornish-Fisher expansion for df > 30.
_T_CRIT_975_EXACT = {
    1: 12.706204736432095,
    2: 4.302652729911275,
    3: 3.182446305284263,
    4: 2.7764451051977987,
    5: 2.5705818366147395,
    6: 2.4469118487916806,
    7: 2.3646242510102993,
    8: 2.3060041350333704,
    9: 2.2621571627409915,
    10: 2.2281388519649385,
    11: 2.200985160082949,
    12: 2.1788128296634177,
    13: 2.1603686564610127,
    14: 2.1447866879169273,
    15: 2.131449545559323,
    16: 2.1199052992210112,
    17: 2.1098155778331806,
    18: 2.10092204024096,
    19: 2.093024054408263,
    20: 2.0859634472658364,
    21: 2.079613844727662,
    22: 2.0738730679040147,
    23: 2.0686576104190406,
    24: 2.0638985616280105,
    25: 2.059538552753294,
    26: 2.055529438642871,
    27: 2.0518305164802833,
    28: 2.048407141795244,
    29: 2.045229642132703,
    30: 2.0422724563012373,
}


def t_crit_975(df: int) -> Optional[float]:
    if df < 1:
        return None
    if df in _T_CRIT_975_EXACT:
        return _T_CRIT_975_EXACT[df]
    z = Z_975
    z2 = z * z
    z3 = z2 * z
    z5 = z3 * z2
    z7 = z5 * z2
    g1 = (z3 + z) / 4.0
    g2 = (5.0 * z5 + 16.0 * z3 + 3.0 * z) / 96.0
    g3 = (3.0 * z7 + 19.0 * z5 + 17.0 * z3 - 15.0 * z) / 384.0
    v = float(df)
    return z + g1 / v + g2 / (v * v) + g3 / (v * v * v)


def _anova_icc(cluster_obs: List[List[float]]) -> Optional[float]:
    """One-way random-effects ANOVA moment estimator of intraclass correlation (rho)."""
    non_empty = [obs for obs in cluster_obs if len(obs) > 0]
    G = len(non_empty)
    N = sum(len(obs) for obs in non_empty)
    if G < 2 or N <= G:
        return None
    grand_mean = sum(sum(obs) for obs in non_empty) / float(N)
    ssb = 0.0
    ssw = 0.0
    sum_n2 = 0.0
    for obs in non_empty:
        ng = len(obs)
        sum_n2 += ng * ng
        mg = sum(obs) / float(ng)
        ssb += ng * ((mg - grand_mean) ** 2)
        for v in obs:
            ssw += (v - mg) ** 2
    msb = ssb / float(G - 1)
    msw = ssw / float(N - G)
    n0 = (float(N) - sum_n2 / float(N)) / float(G - 1)
    denom = msb + (n0 - 1.0) * msw
    if denom <= 0.0:
        return None
    rho = (msb - msw) / denom
    return max(-1.0, min(1.0, rho))


def compute_iid_stats(values_100: Sequence[float]) -> Dict[str, Optional[float]]:
    """Compute naive IID mean, SE, and 95% CI for observations already scaled by 100."""
    n = len(values_100)
    if n == 0:
        return {
            'n': 0,
            'mean': None,
            'sd': None,
            'var_mean': None,
            'se': None,
            'ci95_halfwidth_z': None,
            'ci95_low_z': None,
            'ci95_high_z': None,
        }
    mean = math.fsum(values_100) / float(n)
    if n < 2:
        return {
            'n': n,
            'mean': round(mean, 4),
            'sd': None,
            'var_mean': None,
            'se': None,
            'ci95_halfwidth_z': None,
            'ci95_low_z': None,
            'ci95_high_z': None,
        }
    ss = math.fsum((x - mean) ** 2 for x in values_100)
    var_obs = ss / float(n - 1)
    var_mean = var_obs / float(n)
    se = math.sqrt(var_mean)
    hw = Z_975 * se
    return {
        'n': n,
        'mean': round(mean, 4),
        'sd': round(math.sqrt(var_obs), 4),
        'var_mean': var_mean,
        'se': round(se, 4),
        'ci95_halfwidth_z': round(hw, 4),
        'ci95_low_z': round(mean - hw, 4),
        'ci95_high_z': round(mean + hw, 4),
    }


def compute_ratio_cluster_stats(
    cluster_items: Dict[str, List[float]],
    iid_var_mean: Optional[float],
    bootstrap_reps: int = 2000,
    seed: int = 20261110,
    cluster_totals=None,
) -> Dict[str, Optional[float]]:
    """Liang-Zeger cluster-robust ratio estimator + pairs cluster bootstrap.

    Each cluster g has unit observations w_{g,1}, ..., w_{g,d_g} (scaled by 100),
    so S_g = sum_i w_{g,i}, d_g = len(w_g), D = sum_g d_g, mu_hat = sum_g S_g / D.
    Linearized score u_g = S_g - mu_hat * d_g;
    Var_LZ(mu_hat) = (G / (G - 1)) * (1 / D^2) * sum_g u_g^2.
    Note: when every observation is its own cluster (G = D, d_g = 1), Var_LZ == Var_IID identically.
    """
    if cluster_totals is not None:
        for total, count in cluster_totals.values():
            if not math.isfinite(total) or type(count) is not int or count < 1:
                raise ValueError('invalid_cluster_total')
        keys = sorted(cluster_totals)
    else:
        keys = sorted(k for k, v in cluster_items.items() if len(v) > 0)
    G = len(keys)
    if G == 0:
        return {'n_clusters': 0, 'total_units': 0, 'mean': None, 'se_lz': None}

    S_list = [cluster_totals[k][0] if cluster_totals is not None else math.fsum(cluster_items[k]) for k in keys]
    d_list = [cluster_totals[k][1] if cluster_totals is not None else len(cluster_items[k]) for k in keys]
    D = sum(d_list)
    total_S = math.fsum(S_list)
    mu_hat = total_S / float(D)
    max_d = max(d_list)
    sum_d2 = sum(d * d for d in d_list)
    kish_cluster_size = float(sum_d2) / float(D)

    if G < 2:
        return {
            'n_clusters': G,
            'total_units': D,
            'mean': round(mu_hat, 4),
            'largest_cluster_units': max_d,
            'largest_cluster_share': round(max_d / float(D), 4),
            'kish_weighted_cluster_size': round(kish_cluster_size, 2),
            'se_lz': None,
            'ci95_halfwidth_z': None,
            'ci95_low_z': None,
            'ci95_high_z': None,
            't_crit_975': None,
            'ci95_halfwidth_t': None,
            'ci95_low_t': None,
            'ci95_high_t': None,
            'se_bootstrap': None,
            'ci95_boot_low': None,
            'ci95_boot_high': None,
            'deff': None,
            'n_eff': None,
            'icc_anova': None,
            'icc_kish_implied': None,
            'note': 'single_cluster_variance_undefined',
            'cluster_precision': 'undefined_single_cluster',
        }

    sum_u2 = math.fsum((S_g - mu_hat * d_g) ** 2 for S_g, d_g in zip(S_list, d_list))
    var_lz = (float(G) / float(G - 1)) * sum_u2 / (float(D) * float(D))
    se_lz = math.sqrt(var_lz)
    hw_z = Z_975 * se_lz
    tc = t_crit_975(G - 1)
    hw_t = tc * se_lz if tc is not None else None

    # Deterministic pairs cluster bootstrap
    se_boot = None
    boot_low = None
    boot_high = None
    if bootstrap_reps > 0:
        rng = random.Random(seed)
        pairs = list(zip(S_list, d_list))
        boot_means: List[float] = []
        for _ in range(bootstrap_reps):
            drawn = rng.choices(pairs, k=G)
            b_d = sum(p[1] for p in drawn)
            if b_d > 0:
                b_s = math.fsum(p[0] for p in drawn)
                boot_means.append(b_s / float(b_d))
        if len(boot_means) >= 2:
            boot_means.sort()
            bm = math.fsum(boot_means) / float(len(boot_means))
            b_var = math.fsum((x - bm) ** 2 for x in boot_means) / float(len(boot_means) - 1)
            se_boot = math.sqrt(b_var)
            lo_idx = max(0, min(len(boot_means) - 1, int(math.floor(0.025 * (len(boot_means) - 1)))))
            hi_idx = max(0, min(len(boot_means) - 1, int(math.ceil(0.975 * (len(boot_means) - 1)))))
            boot_low = boot_means[lo_idx]
            boot_high = boot_means[hi_idx]

    deff = None
    n_eff = None
    icc_kish = None
    if iid_var_mean is not None and iid_var_mean > 0.0:
        deff = var_lz / iid_var_mean
        if deff > 0.0:
            n_eff = float(D) / deff
        if kish_cluster_size > 1.000001:
            icc_kish = max(-1.0, min(1.0, (deff - 1.0) / (kish_cluster_size - 1.0)))

    # Aggregate returns identify ratio variance, but cannot identify individual-seat ICC.
    icc_anova = _anova_icc([cluster_items[k] for k in keys]) if cluster_totals is None else None

    return {
        'n_clusters': G,
        'total_units': D,
        'mean': round(mu_hat, 4),
        'largest_cluster_units': max_d,
        'largest_cluster_share': round(max_d / float(D), 4),
        'kish_weighted_cluster_size': round(kish_cluster_size, 2),
        'se_lz': round(se_lz, 4),
        'ci95_halfwidth_z': round(hw_z, 4),
        'ci95_low_z': round(mu_hat - hw_z, 4),
        'ci95_high_z': round(mu_hat + hw_z, 4),
        't_crit_975': round(tc, 4) if tc is not None else None,
        'ci95_halfwidth_t': round(hw_t, 4) if hw_t is not None else None,
        'ci95_low_t': round(mu_hat - hw_t, 4) if hw_t is not None else None,
        'ci95_high_t': round(mu_hat + hw_t, 4) if hw_t is not None else None,
        'se_bootstrap': round(se_boot, 4) if se_boot is not None else None,
        'ci95_boot_low': round(boot_low, 4) if boot_low is not None else None,
        'ci95_boot_high': round(boot_high, 4) if boot_high is not None else None,
        'deff': round(deff, 4) if deff is not None else None,
        'n_eff': round(n_eff, 2) if n_eff is not None else None,
        'icc_anova': round(icc_anova, 5) if icc_anova is not None else None,
        'icc_kish_implied': round(icc_kish, 5) if icc_kish is not None else None,
        # Two clusters give one degree of freedom: the interval describes the two clusters, it does not estimate precision.
        'cluster_precision': 'descriptive_only_two_clusters' if G == 2 else 'estimated',
        '_var_lz_raw': var_lz,
    }


def evaluate_cell_denominators(
    hand_rows: Sequence[dict],
    bootstrap_reps: int = 2000,
    seed: int = 20261110,
) -> dict:
    """Evaluate BOTH table-hand bb/100 and Horse seat-hand bb/100 under IID and clusterings.

    Each item in `hand_rows` must provide:
      - 'hand_id': str
      - 'horse_net_bb': float
      - 'horse_seat_net_bbs': list[float], or None when only the group return is known
      - 'horse_seat_count': positive int, required when individual returns are unknown
      - 'session_cluster': str             (table_id for ordinary/MTT; (pool, day_utc, primary_human) for Lightning)
      - 'primary_human_id': str
    """
    hand_obs_100: List[float] = []
    seat_obs_100: List[float] = []

    hand_by_session: Dict[str, List[float]] = defaultdict(list)
    hand_by_human: Dict[str, List[float]] = defaultdict(list)

    seat_by_hand: Dict[str, List[float]] = defaultdict(list)
    seat_by_session: Dict[str, List[float]] = defaultdict(list)
    seat_by_human: Dict[str, List[float]] = defaultdict(list)
    totals_by_hand = {}
    totals_by_session = defaultdict(lambda: [0.0, 0])
    totals_by_human = defaultdict(lambda: [0.0, 0])
    missing_seat_outcomes = 0

    for r in hand_rows:
        x_hand = 100.0 * float(r['horse_net_bb'])
        hand_obs_100.append(x_hand)
        sc = r['session_cluster']
        hu = r['primary_human_id']
        hid = r['hand_id']
        hand_by_session[sc].append(x_hand)
        hand_by_human[hu].append(x_hand)

        seats = r['horse_seat_net_bbs']
        count = r.get('horse_seat_count', len(seats) if seats is not None else None)
        if type(count) is not int or count < 1 or not math.isfinite(x_hand):
            raise ValueError('invalid_hand_total_or_seat_count')
        if hid in totals_by_hand:
            raise ValueError('duplicate_hand_id')
        if seats is not None and (len(seats) != count or
                any(not math.isfinite(float(y)) for y in seats) or
                not math.isclose(math.fsum(seats), float(r['horse_net_bb']), abs_tol=1e-7)):
            raise ValueError('seat_returns_disagree_with_hand_total')
        totals_by_hand[hid] = (x_hand, count)
        for bucket, key in ((totals_by_session, sc), (totals_by_human, hu)):
            bucket[key][0] += x_hand
            bucket[key][1] += count
        if seats is None:
            missing_seat_outcomes += count
        seats_100 = [100.0 * float(y) for y in seats] if seats is not None else []
        seat_obs_100.extend(seats_100)
        seat_by_hand[hid].extend(seats_100)
        seat_by_session[sc].extend(seats_100)
        seat_by_human[hu].extend(seats_100)

    iid_hand = compute_iid_stats(hand_obs_100)
    iid_seat = compute_iid_stats(seat_obs_100)
    n_seats = sum(v[1] for v in totals_by_hand.values())
    sum_bb = math.fsum(float(r['horse_net_bb']) for r in hand_rows)
    if missing_seat_outcomes:
        # Do not publish a subset's variance as full-corpus variance or manufacture seats.
        iid_seat = {k: None for k in iid_seat}
        iid_seat.update(n=n_seats, mean=round(100 * sum_bb / n_seats, 4),
                        note='individual_seat_returns_unavailable')

    lz_hand_session = compute_ratio_cluster_stats(
        hand_by_session, iid_hand['var_mean'], bootstrap_reps=bootstrap_reps, seed=seed + 1
    )
    lz_hand_human = compute_ratio_cluster_stats(
        hand_by_human, iid_hand['var_mean'], bootstrap_reps=bootstrap_reps, seed=seed + 2
    )

    lz_seat_hand = compute_ratio_cluster_stats(
        seat_by_hand, iid_seat['var_mean'], bootstrap_reps=0, seed=seed + 3,
        cluster_totals=totals_by_hand if missing_seat_outcomes else None
    )
    lz_seat_session = compute_ratio_cluster_stats(
        seat_by_session, iid_seat['var_mean'], bootstrap_reps=bootstrap_reps, seed=seed + 4,
        cluster_totals=totals_by_session if missing_seat_outcomes else None
    )
    lz_seat_human = compute_ratio_cluster_stats(
        seat_by_human, iid_seat['var_mean'], bootstrap_reps=bootstrap_reps, seed=seed + 5,
        cluster_totals=totals_by_human if missing_seat_outcomes else None
    )

    var_seat_hand_raw = lz_seat_hand.get('_var_lz_raw')
    n_hands = len(hand_obs_100)
    for cl_obj in (lz_seat_session, lz_seat_human):
        v_cl = cl_obj.get('_var_lz_raw')
        if v_cl is not None and var_seat_hand_raw is not None and var_seat_hand_raw > 0.0:
            deff_vh = v_cl / var_seat_hand_raw
            cl_obj['deff_vs_hand_ratio_iid'] = round(deff_vh, 4)
            cl_obj['n_eff_hands'] = round(float(n_hands) / deff_vh, 2) if deff_vh > 0.0 else None
        else:
            cl_obj['deff_vs_hand_ratio_iid'] = None
            cl_obj['n_eff_hands'] = None

    for cl_obj in (lz_hand_session, lz_hand_human, lz_seat_hand, lz_seat_session, lz_seat_human):
        cl_obj.pop('_var_lz_raw', None)

    # Strip internal float var_mean from public IID output
    iid_hand_out = {k: v for k, v in iid_hand.items() if k != 'var_mean'}
    iid_seat_out = {k: v for k, v in iid_seat.items() if k != 'var_mean'}

    return {
        'n_hands': n_hands,
        'n_horse_seat_hands': n_seats,
        'individual_seat_outcomes_missing': missing_seat_outcomes,
        'individual_seat_outcomes_known': len(seat_obs_100),
        'mean_horses_per_hand': round(n_seats / float(n_hands), 4) if n_hands else None,
        'horse_net_bb_total': round(sum_bb, 4),
        'table_hand_bb_per_100': {
            'definition': '(sum_horse_net_bb / N_hands) * 100',
            'estimate': iid_hand_out['mean'],
            'iid': iid_hand_out,
            'cluster_table_or_lightning_session': lz_hand_session,
            'cluster_primary_human': lz_hand_human,
        },
        'horse_seat_hand_bb_per_100': {
            'definition': '(sum_horse_net_bb / N_horse_seat_hands) * 100',
            'estimate': iid_seat_out['mean'],
            'iid': iid_seat_out,
            'cluster_hand_id': lz_seat_hand,
            'cluster_table_or_lightning_session': lz_seat_session,
            'cluster_primary_human': lz_seat_human,
        },
    }
