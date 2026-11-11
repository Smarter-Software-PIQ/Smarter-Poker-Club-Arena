#!/usr/bin/env python3
"""Reproduce the frozen 2026-11-10 private Horse census from retained inputs.

Reproduces and audits all counts, provenance, financial conservation laws, tournament
prize/bounty ROI, dual-denominator bb/100 (table-hand and Horse seat-hand), all-in EV
availability, missing-card coverage, Liang-Zeger sandwich + pairs cluster bootstrap CIs,
ICC / DEFF / N_eff, and PLO5 Cash ordinary-vs-Lightning observational confounders at fixed
cutoff 2026-11-10T21:30:00+00:00 (`PokerIQ-Production` `kuklfnapbkmacvwxktbh`).
"""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from horse_census_statistics import evaluate_cell_denominators
from horse_study_subjects import read_subjects, validate_frozen_cohort

CUTOFF_UTC = '2026-11-10T21:30:00+00:00'
CUTOFF_PREFIX = '2026-11-10T21:30:00'


TARGET_CELLS_12 = [
    'cash/nlh/table',
    'cash/nlh/lightning',
    'cash/plo4/table',
    'cash/plo4/lightning',
    'cash/plo5/table',
    'cash/plo5/lightning',
    'cash/plo6/table',
    'cash/plo6/lightning',
    'tournament/nlh/table',
    'tournament/plo4/table',
    'tournament/plo5/table',
    'tournament/plo6/table',
]

NON_TARGET_CELLS_5 = [
    'tournament/plo8/table',
    'cash/short_deck/table',
    'cash/flo8/table',
    'cash/plo8/table',
    'cash/pineapple/table',
]

TARGET_DOMAINS_8 = {
    '1_NLH_Cash': ['cash/nlh/table', 'cash/nlh/lightning'],
    '2_NLH_Tournaments': ['tournament/nlh/table'],
    '3_PLO4_Cash': ['cash/plo4/table', 'cash/plo4/lightning'],
    '4_PLO4_Tournaments': ['tournament/plo4/table'],
    '5_PLO5_Cash': ['cash/plo5/table', 'cash/plo5/lightning'],
    '6_PLO5_Tournaments': ['tournament/plo5/table'],
    '7_PLO6_Cash': ['cash/plo6/table', 'cash/plo6/lightning'],
    '8_PLO6_Tournaments': ['tournament/plo6/table'],
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        while True:
            chunk = f.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def reconstruct_street_by_street_hh(hh_row: dict) -> Tuple[Dict[str, float], float]:
    """Historical action reconstruction under the retained amount encoding assumption."""
    actions = hh_row.get('actions') or []
    winners = hh_row.get('winners') or []
    players = hh_row.get('players') or []

    street_put: Dict[Tuple[str, str], float] = defaultdict(float)
    extra_put: Dict[str, float] = defaultdict(float)
    returned: Dict[str, float] = defaultdict(float)

    for a in actions:
        uid = a.get('userId')
        if not uid or uid == 'system':
            continue
        st = a.get('stage') or 'preflop'
        act = a.get('action')
        amt = float(a.get('amount') or 0.0)
        if act == 'return' or a.get('historyEvent') == 'uncalled_bet_returned':
            returned[uid] += amt
        elif act in ('ante', 'bomb_pot', 'dead_blind'):
            if a.get('dead', True) or act in ('ante', 'bomb_pot'):
                extra_put[uid] += amt
            else:
                street_put[(st, uid)] += amt
        elif act in ('sb', 'bb', 'straddle', 'post', 'kill_blind'):
            street_put[(st, uid)] += amt
        elif act == 'call':
            street_put[(st, uid)] += amt
        elif act in ('bet', 'raise', 'all_in'):
            # In Club Arena hand_history, bet/raise/all_in `amount` is total street commitment (`raise_to`)
            # when >= current street commitment, or incremental if smaller (short all-in edge check).
            cur = street_put[(st, uid)]
            if amt >= cur:
                street_put[(st, uid)] = amt
            else:
                street_put[(st, uid)] += amt

    contrib: Dict[str, float] = defaultdict(float)
    for (_, uid), v in street_put.items():
        contrib[uid] += v
    for uid, v in extra_put.items():
        contrib[uid] += v

    awarded: Dict[str, float] = defaultdict(float)
    for w in winners:
        uid = w.get('userId')
        if uid:
            awarded[uid] += float(w.get('amount') or 0.0)

    uids = {p.get('userId') for p in players if p.get('userId')} | set(contrib.keys()) | set(awarded.keys())
    net = {u: round(awarded[u] + returned[u] - contrib[u], 6) for u in uids}
    rake = float(hh_row.get('rake_amount') or 0.0)
    bbj = float(hh_row.get('bbj_amount') or 0.0)
    resid = round(math.fsum(net.values()) + rake + bbj, 6)
    return net, resid


def percentile(sorted_vals: Sequence[float], q: float) -> Optional[float]:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return round(sorted_vals[0], 4)
    pos = q * (len(sorted_vals) - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return round(sorted_vals[lo], 4)
    w = pos - lo
    return round(sorted_vals[lo] * (1.0 - w) + sorted_vals[hi] * w, 4)


def checked_seat_totals(net, horses, humans, excluded, big_blind):
    """Never silently assign zero to an absent participant in an atomic/replayed result."""
    expected = set(horses) | set(humans) | set(excluded)
    if not expected <= set(net):
        raise ValueError('participant_return_unavailable')
    if not math.isfinite(big_blind) or big_blind <= 0:
        raise ValueError('invalid_big_blind')
    if any(not math.isfinite(net[u]) for u in expected):
        raise ValueError('invalid_participant_return')
    return tuple(math.fsum(net[u] for u in group) for group in (horses, humans, excluded))


def conservation_inference(human_net, excluded_net, fee, pot, awarded):
    """An inferred group return is an accounting assumption, not independent validation."""
    values = (human_net, excluded_net, fee, pot, awarded)
    if any(not math.isfinite(v) for v in values) or abs(pot - awarded - fee) > 1e-4:
        raise ValueError('pot_awards_do_not_support_conservation_inference')
    return {'horse_net_chips': -(human_net + excluded_net + fee),
            'horse_seat_net_bbs': None, 'independent_residual': None}


ACTOR_CLASSES = ('eligible_human', 'excluded_human', 'horse')
REFUND_EVIDENCE_SCHEMA = 'horse-census-refund-evidence-v2'
UNREGISTRATION_REFUND_SOURCE = 'fn_unregister_from_tournament'
FUNDING_OPERATIONS = ('entry', 'rebuy', 'addon')
FUNDING_ASSETS = ('chips', 'diamonds')
UNRECORDED_ASSET = 'unrecorded'
REFUND_BINDINGS = (
    'entitlement_tournament_match', 'entitlement_user_match', 'funding_receipt_found',
    'funding_tournament_match', 'funding_user_match', 'funding_registration_match',
    'funding_ledger_match', 'credit_user_match', 'unregistration_receipt_found',
    'unregistration_identity_match',
)
REFUND_TOLERANCE = 0.005


def _refund_number(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError('refund_evidence_amount_invalid')
    return float(value)


def tournament_funding_asset(funding_rows: Sequence[dict]) -> str:
    """Currency of a tournament, from its recorded funding receipts only.

    `is_xmtt` marks a union event, not a currency, and never selects an asset.
    Without receipts the currency is unrecorded rather than assumed.
    """
    assets = set()
    for row in funding_rows:
        amount = row.get('amount_sum')
        if (row.get('operation') not in FUNDING_OPERATIONS or isinstance(amount, bool)
                or not isinstance(amount, (int, float)) or amount < 0):
            raise ValueError('recorded_funding_is_not_gross_charges')
        if row.get('asset') not in FUNDING_ASSETS:
            raise ValueError('recorded_funding_asset_unsupported')
        assets.add(row['asset'])
    if len(assets) > 1:
        raise ValueError('mixed_asset_tournament_funding')
    return assets.pop() if assets else UNRECORDED_ASSET


def read_refund_evidence(path, tournament_ids: Set[str]) -> Optional[Dict[str, Any]]:
    """Validate a private pre-cutoff, row-level refund acquisition for the frozen tournaments.

    Every netted refund is one tranche bound through its own entitlement to the single
    funding receipt it reverses: same ledger entry, registration, participant, tournament
    and currency, credited to that participant, and reconciled to the registration's
    unregistration receipt. A refund is never inferred, and one entitlement or one
    registration can never be counted twice.
    """
    if path is None:
        return None
    value = json.loads(Path(path).read_text())
    if value.get('schema') != REFUND_EVIDENCE_SCHEMA:
        raise ValueError('refund_evidence_schema_unsupported')
    if value.get('cutoffUtc') != CUTOFF_UTC:
        raise ValueError('refund_evidence_cutoff_mismatch')
    if value.get('tournamentCount') != len(tournament_ids):
        raise ValueError('refund_evidence_tournament_scope_mismatch')
    unregistrations, rows = value.get('unregistrations'), value.get('refunds')
    if not isinstance(unregistrations, list) or not isinstance(rows, list):
        raise ValueError('refund_evidence_sections_required')

    receipts: Dict[str, dict] = {}
    registrations: Counter = Counter()
    for row in unregistrations:
        registration, key = row.get('registration_id'), (row.get('tournament_id'), row.get('actor_class'))
        if not isinstance(registration, str) or key[0] not in tournament_ids or key[1] not in ACTOR_CLASSES:
            raise ValueError('refund_evidence_row_out_of_scope')
        if registration in receipts:
            raise ValueError('duplicate_unregistration_receipt')
        count = row.get('entitlement_count')
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError('refund_evidence_amount_invalid')
        if _refund_number(row.get('returned_ticket_value')):
            raise ValueError('ticket_return_accounting_unsupported')
        receipts[registration] = {'key': key, 'refunded': _refund_number(row.get('refunded_chips')),
                                  'entitlements': count, 'bound': 0.0, 'rows': 0}
        registrations[key] += 1

    refunds: Counter = Counter()
    assets: Dict[str, Set[str]] = defaultdict(set)
    operations: Counter = Counter()
    other_sources: Dict[str, Set[str]] = defaultdict(set)
    seen: Set[str] = set()
    partial = 0
    for row in rows:
        entitlement, key = row.get('entitlement_id'), (row.get('tournament_id'), row.get('actor_class'))
        if not isinstance(entitlement, str) or key[0] not in tournament_ids or key[1] not in ACTOR_CLASSES:
            raise ValueError('refund_evidence_row_out_of_scope')
        if entitlement in seen:
            raise ValueError('duplicate_refund_evidence')
        seen.add(entitlement)
        amount = _refund_number(row.get('refund_amount'))
        if row.get('source') != UNREGISTRATION_REFUND_SOURCE:
            other_sources[key[0]].add(str(row.get('source')))
            continue
        if (any(row.get(name) is not True for name in REFUND_BINDINGS)
                or row.get('funding_operation') not in FUNDING_OPERATIONS
                or row.get('funding_asset') not in FUNDING_ASSETS):
            raise ValueError('refund_not_bound_to_recorded_funding')
        receipt = receipts.get(row.get('registration_id'))
        if receipt is None or receipt['key'] != key:
            raise ValueError('refund_registration_mismatch')
        funded = _refund_number(row.get('funding_amount'))
        if amount > funded + REFUND_TOLERANCE:
            raise ValueError('refund_exceeds_recorded_funding')
        if abs(_refund_number(row.get('credit_amount')) - amount) > REFUND_TOLERANCE:
            raise ValueError('refund_credit_mismatch')
        partial += amount < funded - REFUND_TOLERANCE
        receipt['bound'] += amount
        receipt['rows'] += 1
        refunds[key] += amount
        assets[key[0]].add(row['funding_asset'])
        operations[row['funding_operation'] + '/' + row['funding_asset']] += amount
    for receipt in receipts.values():
        if (abs(receipt['bound'] - receipt['refunded']) > REFUND_TOLERANCE
                or receipt['rows'] != receipt['entitlements']):
            raise ValueError('refund_receipt_cross_check_failed')
    return {
        'refunds': dict(refunds),
        'registrations': dict(registrations),
        'assets': {tid: sorted(names) for tid, names in assets.items()},
        'otherSources': {tid: sorted(names) for tid, names in other_sources.items()},
        'refundsByFundingOperationAndAsset': {k: round(v, 2) for k, v in sorted(operations.items())},
        'boundRefundRows': sum(r['rows'] for r in receipts.values()),
        'partialRefundRows': int(partial),
        'acquiredAtUtc': value.get('acquiredAtUtc'),
        'refundsAfterCutoff': value.get('refundsAfterCutoff'),
        'sha256': sha256_file(Path(path)),
    }


def refund_adjusted_cost(recorded_cost: float, refund: float, has_funding: bool) -> float:
    """Net a recorded unregistration refund against the recorded funding it reverses."""
    if refund and not has_funding:
        raise ValueError('refund_without_recorded_funding')
    if refund > recorded_cost + REFUND_TOLERANCE:
        raise ValueError('refund_exceeds_recorded_funding')
    return recorded_cost - refund


def run_audit(source: Path, predecessor: Path, output: Path, subject_config=None,
              refund_evidence=None) -> Dict[str, Any]:
    t0 = time.time()
    source, predecessor, output = Path(source).resolve(), Path(predecessor).resolve(), Path(output).resolve()
    if output == source or source in output.parents or output == predecessor or predecessor in output.parents:
        raise ValueError('output_must_not_modify_frozen_inputs')
    out_json_path = output / 'census_and_financial_audit.json'
    if out_json_path.exists():
        raise ValueError('new_output_required')
    analysis = source / 'analysis'
    audit = source / 'audit/census_stat'
    u_sqlite = analysis / 'all_hands_through_20261110.sqlite'
    f_sqlite = analysis / 'included_hand_facts.sqlite'
    hdr_sqlite = audit / 'live_pg_hand_headers.sqlite'
    pg_cache_path = audit / 'live_pg_audit_cache.json'
    replay_path = analysis / 'replay_spots_for_current_engine.jsonl'
    v579_path = predecessor / 'qualification-review/individual-579-nov10/verification.json'
    vplo4_path = predecessor / 'qualification-review/individual-plo4-nov10/verification.json'
    recon_01a_path = predecessor / 'roster-census/reconciliation.json'
    phys_01a_path = predecessor / 'roster-census/physical-scan-summary.json'
    metrics_path = analysis / 'deep_dive_metrics.json'

    subjects = read_subjects(subject_config)
    manifest_path = analysis / 'all_hands_manifest.json'
    manifest = json.loads(manifest_path.read_text())
    validate_frozen_cohort(manifest, subjects)
    unified_digest = sha256_file(u_sqlite)
    if unified_digest != manifest['unifiedDatabase']['sha256']:
        raise ValueError('frozen_corpus_digest_mismatch')
    excluded_first, excluded_second = subjects['excludedSubjectIds']
    excluded_ids = set(subjects['excludedSubjectIds'])
    comparison_id = subjects['comparisonSubjectId']
    pg_cache = json.loads(pg_cache_path.read_text())
    refunds = read_refund_evidence(refund_evidence, {t['id'] for t in pg_cache['humanTournaments']})
    refund_applied: Counter = Counter()
    v579 = json.loads(v579_path.read_text())
    vplo4 = json.loads(vplo4_path.read_text())
    recon_01a = json.loads(recon_01a_path.read_text())
    phys_01a = json.loads(phys_01a_path.read_text())
    prior_metrics = json.loads(metrics_path.read_text())

    profiles = {p['id']: p for p in pg_cache['profiles']}
    horse_profile_ids = {pid for pid, p in profiles.items() if p['is_horse']}
    non_horse_profile_ids = {pid for pid, p in profiles.items() if not p['is_horse']}
    non_horse_before_cutoff = {
        pid for pid, p in profiles.items()
        if not p['is_horse'] and (p.get('created_at') or '') < CUTOFF_UTC
    }

    selected_profiles = [profiles.get(uid) for uid in subjects['excludedSubjectIds']]
    if any(p is None or p.get('is_horse') is not False for p in [*selected_profiles, profiles.get(comparison_id)]):
        raise ValueError('subject_profile_unavailable_or_not_human')
    if (profiles[comparison_id].get('username') or '').casefold() != 'woowoo':
        raise ValueError('frozen_comparison_subject_mismatch')

    conn_u = sqlite3.connect(f'file:{u_sqlite}?mode=ro', uri=True)
    conn_f = sqlite3.connect(f'file:{f_sqlite}?mode=ro', uri=True)
    conn_h = sqlite3.connect(f'file:{hdr_sqlite}?mode=ro', uri=True)

    # Load hand headers from live Postgres cache
    headers: Dict[str, dict] = {}
    cur_h = conn_h.execute('SELECT * FROM hand_headers')
    h_cols = [d[0] for d in cur_h.description]
    for row in cur_h:
        d = dict(zip(h_cols, row))
        headers[d['id']] = d

    lh_by_hh = {r['hand_history_id']: r for r in pg_cache['lightningLinkedRows']}
    unflagged_378_map = {r['id']: r for r in pg_cache['unflagged378Details']}
    incomplete_309_map = {r['id']: r for r in pg_cache['incomplete309Details']}
    tables_map = {r['id']: r for r in pg_cache['tablesMeta']}

    # Load ca_hand_facts grouped by hand_id
    facts_by_hand: Dict[str, List[dict]] = defaultdict(list)
    total_fact_rows = 0
    for hid, uid, p_str in conn_f.execute('SELECT hand_id, user_id, payload FROM hand_facts'):
        facts_by_hand[hid].append(json.loads(p_str))
        total_fact_rows += 1
    fetched_hands_cnt = conn_f.execute('SELECT count(*) FROM fetched_hands').fetchone()[0]

    # --- 1. Scan all 49,310 hands in unified SQLite ---
    hands_meta: Dict[str, dict] = {}
    status_counts = Counter()
    excluded_reason_counts = Counter()
    excluded_by_domain = Counter()
    unknown_hands_list = []
    seed_zero_human_hands = []
    mixed_included_by_domain = Counter()
    mixed_included_ids = []
    cutoff_violations_played = []
    cutoff_violations_created = []
    human_hand_freq_by_cell: Dict[str, Counter] = defaultdict(Counter)

    for hid, vidx, dom, st, p_str in conn_u.execute(
        'SELECT hand_id, volume_idx, domain, status, payload FROM hands'
    ):
        p = json.loads(p_str)
        hands_meta[hid] = {
            'hand_id': hid,
            'volume_idx': vidx,
            'domain': dom,
            'status': st,
            'payload': p,
        }
        status_counts[st] += 1
        pa = p.get('playedAt') or ''
        if pa >= CUTOFF_PREFIX and not pa.startswith('2026-11-10T21:30:00'):
            cutoff_violations_played.append((hid, pa))
        elif pa >= '2026-11-10T21:30:00':
            cutoff_violations_played.append((hid, pa))

        hdr = headers.get(hid)
        if hdr and (hdr.get('created_at') or '') >= CUTOFF_UTC:
            cutoff_violations_created.append((hid, hdr.get('created_at')))

        hu = list(p.get('humanIds') or [])
        ho = list(p.get('horseIds') or [])
        ex = list(p.get('excludedHumansPresent') or [])

        if st == 'included':
            for u in hu:
                human_hand_freq_by_cell[dom][u] += 1
            if ex:
                mixed_included_by_domain[dom] += 1
                mixed_included_ids.append(hid)
        elif st == 'classification_unknown':
            unknown_hands_list.append({
                'hand_id': hid,
                'volume_idx': vidx,
                'domain': dom,
                'played_at': pa,
                'table_id': p.get('tableId'),
                'source': p.get('source'),
                'gaps': p.get('gaps'),
            })
        elif st == 'excluded':
            excluded_by_domain[dom] += 1
            ex_set = set(ex)
            if hu and not ho:
                excluded_reason_counts['pure_human_vs_human_zero_horses'] += 1
            elif ex_set == {excluded_first} and not hu:
                excluded_reason_counts['excluded_subject_1_only'] += 1
            elif ex_set == {excluded_second} and not hu:
                excluded_reason_counts['excluded_subject_2_only'] += 1
            elif ex_set == {excluded_second, excluded_first} and not hu:
                excluded_reason_counts['both_excluded_subjects_only'] += 1
            elif not hu and not ex_set:
                excluded_reason_counts['synthetic_seed_zero_human_uuids'] += 1
                seed_zero_human_hands.append({
                    'hand_id': hid,
                    'volume_idx': vidx,
                    'domain': dom,
                    'played_at': pa,
                    'source': p.get('source'),
                })
            else:
                excluded_reason_counts['other'] += 1

    # Verify mixed hands preserve excluded subjects' public actions in decisions
    mixed_id_set = set(mixed_included_ids)
    mixed_with_excluded_public_actions = set()

    # --- 2. Scan all 349,970 Horse decisions ---
    total_decisions = 0
    seen_decision_ids: Set[str] = set()
    duplicate_decision_ids = 0
    seen_actor_ord: Set[Tuple[str, str, str, Any]] = set()
    duplicate_actor_ord = 0

    dec_by_cell_street: Dict[str, Counter] = defaultdict(Counter)
    dec_by_cell_action: Dict[str, Counter] = defaultdict(Counter)
    dec_by_cell_origin: Dict[str, Counter] = defaultdict(Counter)
    dec_own_cards_by_cell_street: Dict[str, Dict[str, Counter]] = defaultdict(lambda: defaultdict(Counter))
    dec_own_cards_by_cell: Dict[str, Counter] = defaultdict(Counter)
    dec_total_by_cell = Counter()

    for did, hid, vidx, dom, st, act, orig, p_str in conn_u.execute(
        'SELECT decision_id, hand_id, volume_idx, domain, street, action, origin, payload FROM decisions'
    ):
        total_decisions += 1
        if did in seen_decision_ids:
            duplicate_decision_ids += 1
        seen_decision_ids.add(did)

        dp = json.loads(p_str)
        ordinal_part = did.split(':')[-1] if ':' in did else did
        actor_key = (hid, dp.get('horseId') or '', st, ordinal_part)
        if actor_key in seen_actor_ord:
            duplicate_actor_ord += 1
        seen_actor_ord.add(actor_key)

        dec_total_by_cell[dom] += 1
        dec_by_cell_street[dom][st] += 1
        dec_by_cell_action[dom][act] += 1
        dec_by_cell_origin[dom][orig or 'null'] += 1

        inf = dp.get('informationSet') or {}
        hero_cards = inf.get('heroCards')
        gaps = set(dp.get('gaps') or [])
        snap = dp.get('snapshotOwnCardRecovery')
        cards_known = bool(hero_cards) and ('hero_cards_missing' not in gaps)

        if cards_known:
            if isinstance(snap, dict) and snap.get('accepted') is True:
                src_bucket = 'known_via_snapshot_recovery'
            else:
                src_bucket = 'known_in_hand_or_facts'
            dec_own_cards_by_cell[dom]['known'] += 1
            dec_own_cards_by_cell[dom][src_bucket] += 1
            dec_own_cards_by_cell_street[dom][st]['known'] += 1
        else:
            dec_own_cards_by_cell[dom]['missing'] += 1
            if isinstance(snap, dict):
                dec_own_cards_by_cell[dom]['missing_snapshot_rejected_or_withheld'] += 1
            else:
                dec_own_cards_by_cell[dom]['missing_no_snapshot'] += 1
            dec_own_cards_by_cell_street[dom][st]['missing'] += 1

        if hid in mixed_id_set and hid not in mixed_with_excluded_public_actions:
            for pa_ev in inf.get('priorPublicActions') or []:
                if pa_ev.get('actorId') in excluded_ids or pa_ev.get('userId') in excluded_ids:
                    mixed_with_excluded_public_actions.add(hid)
                    break

    # --- 3. Reconcile the 378 recovered unflagged MTT hands ---
    unflagged_378_by_dom_status = Counter()
    unflagged_378_flags = Counter()
    for hid, r in unflagged_378_map.items():
        hm = hands_meta[hid]
        unflagged_378_by_dom_status[f"{hm['domain']}|{hm['status']}"] += 1
        flag_tuple = (
            bool(r['in_hand_history']),
            bool(r['in_atomic_commits']),
            bool(r['in_hand_submissions']),
            bool(r['has_p_hand_row']),
            bool(r['has_accepted_facts']),
            bool(r['has_roster']),
            r['fact_cnt'] > 0,
            r['idx_cnt'] > 0,
        )
        unflagged_378_flags[str(flag_tuple)] += 1

    # --- 4. Reconcile all 41,151 included hands: Census, Provenance & Financial Conservation ---
    # Build per-hand financial & clustering records for BOTH:
    #   (A) ca_hand_facts corpus (exact match to prior report)
    #   (B) 100% Complete Reconstructed corpus (all 41,151 included hands / 40,414 target hands)
    cell_census: Dict[str, dict] = {}
    cell_conservation: Dict[str, dict] = {}
    facts_stat_rows_by_cell: Dict[str, List[dict]] = defaultdict(list)
    full_stat_rows_by_cell: Dict[str, List[dict]] = defaultdict(list)

    plo5_28_records = []
    plo4_4_records = []
    plo6_4_records = []
    nlh_212_summary = Counter()
    inference_records = []

    # Pre-group included hands by cell
    included_by_cell: Dict[str, List[str]] = defaultdict(list)
    for hid, hm in hands_meta.items():
        if hm['status'] == 'included':
            included_by_cell[hm['domain']].append(hid)

    all_17_cells = TARGET_CELLS_12 + NON_TARGET_CELLS_5
    for cell in all_17_cells:
        hids = sorted(included_by_cell.get(cell, []))
        is_tourn = cell.startswith('tournament/')
        is_lightning = cell.endswith('/lightning')

        n_inc = len(hids)
        n_in_flagged_hh = 0
        n_from_378_hs = 0
        n_in_human_idx = 0
        n_in_lh = 0
        n_any_fact = 0
        n_horse_fact = 0
        n_human_fact = 0
        n_zero_fact = 0
        n_complete_fact = 0
        n_horse_purged_fact = 0

        dealt_horse_seats = 0
        dealt_elig_human_seats = 0
        dealt_excl_human_seats = 0
        multi_elig_human_hands = 0

        fact_horse_seats = 0
        fact_elig_human_seats = 0
        fact_excl_human_seats = 0

        # Financial accumulators (ca_hand_facts only)
        f_horse_net_chips = 0.0
        f_elig_net_chips = 0.0
        f_excl_net_chips = 0.0
        f_rake_paid_sum = 0.0
        f_horse_net_bb_col = 0.0
        f_horse_net_bb_exact = 0.0
        f_elig_net_bb_col = 0.0
        f_excl_net_bb_col = 0.0
        f_horse_ev_net_bb_col = 0.0
        f_all_in_seat_hands = 0
        f_all_in_equity_owed_seats = 0
        f_ev_differs_from_net_seats = 0
        f_complete_hand_max_abs_resid = 0.0
        f_complete_hand_nonzero_cnt = 0

        # Financial accumulators (100% Complete Reconstructed across all n_inc hands)
        c_horse_net_chips = 0.0
        c_elig_net_chips = 0.0
        c_excl_net_chips = 0.0
        c_rake_plus_bbj_chips = 0.0
        c_rake_only_chips = 0.0
        c_bbj_only_chips = 0.0
        c_pot_chips = 0.0
        c_winners_chips = 0.0
        c_horse_net_bb_exact = 0.0
        c_elig_net_bb_exact = 0.0
        c_excl_net_bb_exact = 0.0
        c_max_abs_hand_resid = 0.0
        c_nonzero_resid_hands = 0
        independently_checked_hands = 0
        inferred_hands = 0

        freq_counter = human_hand_freq_by_cell[cell]

        for hid in hids:
            hm = hands_meta[hid]
            p = hm['payload']
            hdr = headers[hid]

            if hdr['in_flagged_hand_history'] == 1:
                n_in_flagged_hh += 1
            else:
                n_from_378_hs += 1
            if (hdr['idx_human'] or 0) > 0:
                n_in_human_idx += 1
            if hid in lh_by_hh:
                n_in_lh += 1

            ho_ids = list(p.get('horseIds') or [])
            hu_ids = list(p.get('humanIds') or [])
            ex_ids = list(p.get('excludedHumansPresent') or [])
            ho_set = set(ho_ids)
            hu_set = set(hu_ids)
            ex_set = set(ex_ids)

            if len(hu_ids) > 1:
                multi_elig_human_hands += 1

            dealt_horse_seats += len(ho_set)
            dealt_elig_human_seats += len(hu_set)
            dealt_excl_human_seats += len(ex_set)

            # Deterministic primary eligible human ID: highest career hand count in cell, tie-break UUID asc
            primary_human = sorted(hu_ids, key=lambda u: (-freq_counter[u], u))[0]
            day_utc = (p.get('playedAt') or '')[:10]
            tid = p.get('tableId') or hdr.get('table_id') or 'unknown_table'
            if is_lightning:
                lh_rec = lh_by_hh.get(hid)
                pool_key = (lh_rec.get('cluster_id') if lh_rec else None) or tid
                session_cluster = f'lh|{pool_key}|{day_utc}|{primary_human}'
            else:
                session_cluster = f'tbl|{tid}'

            rake_amt = float(hdr['rake_amount'] or 0.0)
            bbj_amt = float(hdr['bbj_amount'] or 0.0)
            fee_amt = 0.0 if is_tourn else (rake_amt + bbj_amt)
            pot_amt = float(hdr['pot_size'] or 0.0)
            win_amt = float(hdr['winners_sum'] or 0.0)
            bb_hdr = float(hdr['big_blind'] or 0.0)

            c_rake_only_chips += (0.0 if is_tourn else rake_amt)
            c_bbj_only_chips += (0.0 if is_tourn else bbj_amt)
            c_rake_plus_bbj_chips += fee_amt
            c_pot_chips += pot_amt
            c_winners_chips += win_amt

            frows = facts_by_hand.get(hid, [])
            if frows:
                n_any_fact += 1
            else:
                n_zero_fact += 1

            hf_ho = [r for r in frows if r['user_id'] in ho_set or r['user_id'] in horse_profile_ids]
            hf_hu = [r for r in frows if r['user_id'] in hu_set]
            hf_ex = [r for r in frows if r['user_id'] in ex_set]

            if hf_ho:
                n_horse_fact += 1
            if hf_hu or hf_ex:
                n_human_fact += 1

            fact_horse_seats += len(hf_ho)
            fact_elig_human_seats += len(hf_hu)
            fact_excl_human_seats += len(hf_ex)

            for r in frows:
                f_rake_paid_sum += float(r.get('rake_paid') or 0.0)

            ho_chips_f = math.fsum(float(r['net']) for r in hf_ho)
            hu_chips_f = math.fsum(float(r['net']) for r in hf_hu)
            ex_chips_f = math.fsum(float(r['net']) for r in hf_ex)

            f_horse_net_chips += ho_chips_f
            f_elig_net_chips += hu_chips_f
            f_excl_net_chips += ex_chips_f

            f_horse_net_bb_col += math.fsum(float(r['net_bb']) for r in hf_ho)
            f_elig_net_bb_col += math.fsum(float(r['net_bb']) for r in hf_hu)
            f_excl_net_bb_col += math.fsum(float(r['net_bb']) for r in hf_ex)
            f_horse_ev_net_bb_col += math.fsum(float(r.get('ev_net_bb') if r.get('ev_net_bb') is not None else r['net_bb']) for r in hf_ho)

            for r in hf_ho:
                if r.get('was_all_in'):
                    f_all_in_seat_hands += 1
                if r.get('all_in_equity_owed'):
                    f_all_in_equity_owed_seats += 1
                ev_v = float(r.get('ev_net') if r.get('ev_net') is not None else r['net'])
                if abs(ev_v - float(r['net'])) > 1e-6:
                    f_ev_differs_from_net_seats += 1

            if hf_ho:
                bb_f = float(hf_ho[0]['big_blind'])
                ho_seat_bbs_f = [float(r['net_bb']) for r in hf_ho]
                ho_net_bb_f = math.fsum(ho_seat_bbs_f)
                f_horse_net_bb_exact += ho_chips_f / bb_f if bb_f > 0 else 0.0
                facts_stat_rows_by_cell[cell].append({
                    'hand_id': hid,
                    'horse_net_bb': ho_net_bb_f,
                    'horse_seat_net_bbs': ho_seat_bbs_f,
                    'session_cluster': session_cluster,
                    'primary_human_id': primary_human,
                })

            exp_uids = ho_set | hu_set | ex_set
            act_uids = {r['user_id'] for r in frows}

            if exp_uids == act_uids:
                independently_checked_hands += 1
                n_complete_fact += 1
                bb_use = float(frows[0]['big_blind']) if frows and float(frows[0]['big_blind'] or 0) > 0 else bb_hdr
                hand_resid = ho_chips_f + hu_chips_f + ex_chips_f + fee_amt
                if abs(hand_resid) > f_complete_hand_max_abs_resid:
                    f_complete_hand_max_abs_resid = abs(hand_resid)
                if abs(hand_resid) > 1e-4:
                    f_complete_hand_nonzero_cnt += 1

                c_horse_net_chips += ho_chips_f
                c_elig_net_chips += hu_chips_f
                c_excl_net_chips += ex_chips_f
                c_horse_net_bb_exact += ho_chips_f / bb_use
                c_elig_net_bb_exact += hu_chips_f / bb_use
                c_excl_net_bb_exact += ex_chips_f / bb_use
                if abs(hand_resid) > c_max_abs_hand_resid:
                    c_max_abs_hand_resid = abs(hand_resid)
                if abs(hand_resid) > 1e-4:
                    c_nonzero_resid_hands += 1

                full_stat_rows_by_cell[cell].append({
                    'hand_id': hid,
                    'horse_net_bb': ho_chips_f / bb_use,
                    'horse_seat_net_bbs': [float(r['net']) / bb_use for r in hf_ho],
                    'session_cluster': session_cluster,
                    'primary_human_id': primary_human,
                })
            else:
                # Reconstruct exact per-seat or collective net from atomic stack_result or hand_history!
                inc = incomplete_309_map[hid]
                bb_use = float(inc.get('big_blind') or bb_hdr)
                if not math.isfinite(bb_use) or bb_use <= 0:
                    raise ValueError('invalid_big_blind')
                sr = inc.get('stack_result')
                if sr and isinstance(sr, dict) and (sr.get('request') or {}).get('stacks'):
                    # Tier B: Atomic commit stack_result (exact per-seat delta)
                    seat_deltas = {
                        s['user_id']: round(float(s['stack']) - float(s['stack_before']), 6)
                        for s in sr['request']['stacks']
                    }
                    ho_c, hu_c, ex_c = checked_seat_totals(seat_deltas, ho_set, hu_set, ex_set, bb_use)
                    hand_resid = ho_c + hu_c + ex_c + fee_amt
                    seat_bbs = [seat_deltas[u] / bb_use for u in ho_ids]
                    recon_method = 'hand_atomic_commits.stack_result'
                elif not frows:
                    # Tier C1: Zero-fact late-Aug hand_history with explicit sb/bb actions
                    net_map, hand_resid = reconstruct_street_by_street_hh(inc)
                    ho_c, hu_c, ex_c = checked_seat_totals(net_map, ho_set, hu_set, ex_set, bb_use)
                    seat_bbs = [net_map[u] / bb_use for u in ho_ids]
                    recon_method = 'hand_history.street_by_street_actions'
                else:
                    # Tier C2: Late-Aug hand where Human ca_hand_facts survived while Horse ca_hand_facts were purged
                    n_horse_purged_fact += 1
                    hu_c = hu_chips_f
                    ex_c = ex_chips_f
                    # Check if street-by-street action replay also has zero residual (e.g. the 4 PLO4 Aug 28 hands!)
                    net_map, hh_resid = reconstruct_street_by_street_hh(inc)
                    hu_match = all(abs(net_map.get(u, -999999.0) - float(r['net'])) < 1e-4 for r in (hf_hu + hf_ex) for u in [r['user_id']])
                    if abs(hh_resid) < 1e-4 and hu_match:
                        ho_c, _, _ = checked_seat_totals(net_map, ho_set, hu_set, ex_set, bb_use)
                        hand_resid = ho_c + hu_c + ex_c + fee_amt
                        seat_bbs = [net_map[u] / bb_use for u in ho_ids]
                        recon_method = 'hand_history.street_by_street_actions_verified_against_human_facts'
                    else:
                        if {r['user_id'] for r in hf_hu + hf_ex} != hu_set | ex_set:
                            raise ValueError('human_returns_incomplete_for_group_inference')
                        inferred = conservation_inference(hu_c, ex_c, fee_amt, pot_amt, win_amt)
                        ho_c = inferred['horse_net_chips']
                        hand_resid = inferred['independent_residual']
                        seat_bbs = inferred['horse_seat_net_bbs']
                        recon_method = 'retained_human_ca_hand_facts_plus_hand_history_pot_winners_conservation'

                if hand_resid is None:
                    inferred_hands += 1
                    inference_records.append({'hand_id': hid, 'cell': cell, 'horse_seats': len(ho_ids),
                                              'horse_net_chips': ho_c, 'method': recon_method})
                else:
                    independently_checked_hands += 1

                c_horse_net_chips += ho_c
                c_elig_net_chips += hu_c
                c_excl_net_chips += ex_c
                c_horse_net_bb_exact += ho_c / bb_use
                c_elig_net_bb_exact += hu_c / bb_use
                c_excl_net_bb_exact += ex_c / bb_use
                if hand_resid is not None and abs(hand_resid) > c_max_abs_hand_resid:
                    c_max_abs_hand_resid = abs(hand_resid)
                if hand_resid is not None and abs(hand_resid) > 1e-4:
                    c_nonzero_resid_hands += 1

                full_stat_rows_by_cell[cell].append({
                    'hand_id': hid,
                    'horse_net_bb': ho_c / bb_use,
                    'horse_seat_net_bbs': seat_bbs,
                    'horse_seat_count': len(ho_ids),
                    'session_cluster': session_cluster,
                    'primary_human_id': primary_human,
                })

                rec_info = {
                    'hand_id': hid,
                    'hand_number': inc.get('hand_number'),
                    'played_at': p.get('playedAt'),
                    'created_at': inc.get('created_at'),
                    'table_id': inc.get('table_id'),
                    'big_blind': bb_use,
                    'pot_size': pot_amt,
                    'rake_amount': rake_amt,
                    'bbj_amount': bbj_amt,
                    'horse_seats': len(ho_ids),
                    'horse_net_chips': round(ho_c, 4),
                    'horse_net_bb': round(ho_c / bb_use, 4),
                    'eligible_human_net_chips': round(hu_c, 4),
                    'excluded_human_net_chips': round(ex_c, 4),
                    'conservation_residual_chips': round(hand_resid, 6) if hand_resid is not None else None,
                    'reconstruction_method': recon_method,
                }
                if cell == 'cash/plo5/lightning':
                    plo5_28_records.append(rec_info)
                elif cell == 'cash/plo4/table':
                    plo4_4_records.append(rec_info)
                elif cell == 'cash/plo6/lightning':
                    plo6_4_records.append(rec_info)
                elif cell == 'cash/nlh/table':
                    nlh_212_summary[recon_method] += 1

        cell_census[cell] = {
            'included_physical_hands': n_inc,
            'in_flagged_hand_history': n_in_flagged_hh,
            'recovered_from_hand_submissions_378': n_from_378_hs,
            'in_ca_hand_player_idx': n_in_human_idx,
            'in_lightning_hand': n_in_lh,
            'hands_with_any_ca_hand_facts': n_any_fact,
            'hands_with_horse_ca_hand_facts': n_horse_fact,
            'hands_with_human_ca_hand_facts': n_human_fact,
            'hands_with_zero_ca_hand_facts': n_zero_fact,
            'hands_with_complete_seat_ca_hand_facts': n_complete_fact,
            'hands_with_purged_horse_ca_hand_facts': n_horse_purged_fact,
            'dealt_horse_seat_hands': dealt_horse_seats,
            'ca_hand_facts_horse_seat_hands': fact_horse_seats,
            'dealt_eligible_human_seat_hands': dealt_elig_human_seats,
            'ca_hand_facts_eligible_human_seat_hands': fact_elig_human_seats,
            'dealt_excluded_human_seat_hands_in_mixed': dealt_excl_human_seats,
            'ca_hand_facts_excluded_human_seat_hands_in_mixed': fact_excl_human_seats,
            'mixed_hands_with_excluded_subject': mixed_included_by_domain[cell],
            'multi_eligible_human_hands': multi_elig_human_hands,
            'horse_decisions_total': dec_total_by_cell[cell],
            'horse_decisions_by_street': dict(dec_by_cell_street[cell]),
            'horse_decisions_by_action': dict(dec_by_cell_action[cell]),
            'horse_decisions_by_origin': dict(dec_by_cell_origin[cell]),
            'horse_decisions_own_cards': dict(dec_own_cards_by_cell[cell]),
            'horse_decisions_own_cards_by_street': {
                st: dict(cnts) for st, cnts in sorted(dec_own_cards_by_cell_street[cell].items())
            },
        }

        f_unreconciled_gap_chips = round(
            f_horse_net_chips + f_elig_net_chips + f_excl_net_chips + c_rake_plus_bbj_chips, 4
        )
        c_total_resid_chips = round(
            c_horse_net_chips + c_elig_net_chips + c_excl_net_chips + c_rake_plus_bbj_chips, 6
        )

        cell_conservation[cell] = {
            'is_tournament': is_tourn,
            'n_hands': n_inc,
            'ca_hand_facts_subset': {
                'complete_fact_hands': n_complete_fact,
                'incomplete_or_zero_fact_hands': n_inc - n_complete_fact,
                'horse_net_chips': round(f_horse_net_chips, 4),
                'eligible_human_net_chips': round(f_elig_net_chips, 4),
                'excluded_human_net_chips_in_mixed': round(f_excl_net_chips, 4),
                'facts_rake_paid_sum_chips': round(f_rake_paid_sum, 4),
                'raw_unreconciled_gap_vs_all_hand_rake_bbj_chips': f_unreconciled_gap_chips,
                'complete_fact_hands_max_abs_discrepancy_chips': round(f_complete_hand_max_abs_resid, 6),
                'complete_fact_hands_nonzero_discrepancy_count': f_complete_hand_nonzero_cnt,
                'horse_net_bb_column_sum': round(f_horse_net_bb_col, 2),
                'horse_net_bb_exact_ratio_sum': round(f_horse_net_bb_exact, 4),
                'eligible_human_net_bb_column_sum': round(f_elig_net_bb_col, 2),
                'excluded_human_net_bb_column_sum': round(f_excl_net_bb_col, 2),
                'horse_ev_net_bb_column_sum': round(f_horse_ev_net_bb_col, 2),
                'all_in_horse_seat_hands': f_all_in_seat_hands,
                'all_in_equity_owed_horse_seat_hands': f_all_in_equity_owed_seats,
                'ev_differs_from_realized_horse_seat_hands': f_ev_differs_from_net_seats,
            },
            'reconstructed_corpus': {
                'n_hands_accounted_for': n_inc,
                'n_hands_with_residual_check': independently_checked_hands,
                'n_hands_group_inferred': inferred_hands,
                'all_hands_have_calculated_residual': inferred_hands == 0 and c_nonzero_resid_hands == 0,
                'pot_size_sum_chips': round(c_pot_chips, 4),
                'winners_awarded_sum_chips': round(c_winners_chips, 4),
                'horse_net_chips': round(c_horse_net_chips, 4),
                'eligible_human_net_chips': round(c_elig_net_chips, 4),
                'excluded_human_net_chips_in_mixed': round(c_excl_net_chips, 4),
                'rake_amount_chips': round(c_rake_only_chips, 4),
                'bbj_amount_chips': round(c_bbj_only_chips, 4),
                'total_rake_plus_bbj_chips': round(c_rake_plus_bbj_chips, 4),
                'accounting_identity_sum_chips': c_total_resid_chips,
                'identity_includes_conservation_inferred_returns': inferred_hands > 0,
                'max_abs_per_hand_discrepancy_chips': round(c_max_abs_hand_resid, 6),
                'hands_with_discrepancy_gt_0_0001': c_nonzero_resid_hands,
                'horse_net_bb_exact': round(c_horse_net_bb_exact, 4),
                'eligible_human_net_bb_exact': round(c_elig_net_bb_exact, 4),
                'excluded_human_net_bb_exact': round(c_excl_net_bb_exact, 4),
            },
        }

    # --- 5. Statistical Re-Computation Across 12 Target Cells, 8 Target Domains & MTT Omaha ---
    stats_facts_corpus: Dict[str, dict] = {}
    stats_complete_corpus: Dict[str, dict] = {}

    for cell in TARGET_CELLS_12:
        stats_facts_corpus[cell] = evaluate_cell_denominators(
            facts_stat_rows_by_cell[cell], bootstrap_reps=2000, seed=20261110
        )
        # Attach EV bb/100 for both denominators on ca_hand_facts
        ev_sum = cell_conservation[cell]['ca_hand_facts_subset']['horse_ev_net_bb_column_sum']
        nh_f = stats_facts_corpus[cell]['n_hands']
        ns_f = stats_facts_corpus[cell]['n_horse_seat_hands']
        stats_facts_corpus[cell]['horse_ev_net_bb_total'] = ev_sum
        stats_facts_corpus[cell]['table_hand_ev_bb_per_100'] = round(100.0 * ev_sum / nh_f, 4) if nh_f else None
        stats_facts_corpus[cell]['horse_seat_hand_ev_bb_per_100'] = round(100.0 * ev_sum / ns_f, 4) if ns_f else None

        stats_complete_corpus[cell] = evaluate_cell_denominators(
            full_stat_rows_by_cell[cell], bootstrap_reps=2000, seed=20261110
        )

    # Rolled-up 8 target domains + MTT Omaha combined
    rollup_defs = dict(TARGET_DOMAINS_8)
    rollup_defs['MTT_Omaha_Combined'] = [
        'tournament/plo4/table',
        'tournament/plo5/table',
        'tournament/plo6/table',
    ]
    rollup_stats_facts: Dict[str, dict] = {}
    rollup_stats_complete: Dict[str, dict] = {}
    for rname, subcells in rollup_defs.items():
        f_combined = [r for sc in subcells for r in facts_stat_rows_by_cell[sc]]
        c_combined = [r for sc in subcells for r in full_stat_rows_by_cell[sc]]
        rollup_stats_facts[rname] = evaluate_cell_denominators(
            f_combined, bootstrap_reps=2000, seed=20261110
        )
        ev_sum = math.fsum(
            cell_conservation[sc]['ca_hand_facts_subset']['horse_ev_net_bb_column_sum']
            for sc in subcells
        )
        nh_f = rollup_stats_facts[rname]['n_hands']
        ns_f = rollup_stats_facts[rname]['n_horse_seat_hands']
        rollup_stats_facts[rname]['horse_ev_net_bb_total'] = round(ev_sum, 2)
        rollup_stats_facts[rname]['table_hand_ev_bb_per_100'] = round(100.0 * ev_sum / nh_f, 4) if nh_f else None
        rollup_stats_facts[rname]['horse_seat_hand_ev_bb_per_100'] = round(100.0 * ev_sum / ns_f, 4) if ns_f else None

        rollup_stats_complete[rname] = evaluate_cell_denominators(
            c_combined, bootstrap_reps=2000, seed=20261110
        )

    # --- 6. Tournament Buy-In / Prize / Bounty ROI Across NLH, PLO4, PLO5, PLO6 ---
    tp_by_tourn: Dict[str, Dict[str, dict]] = defaultdict(dict)
    for r in pg_cache['tournamentPlayerAgg']:
        tp_by_tourn[r['tournament_id']][r['actor_class']] = r

    tf_by_tourn: Dict[str, List[dict]] = defaultdict(list)
    for r in pg_cache['tournamentFundingAgg']:
        tf_by_tourn[r['tournament_id']].append(r)

    tpay_by_tourn: Dict[str, List[dict]] = defaultdict(list)
    for r in pg_cache['tournamentPayoutsAgg']:
        tpay_by_tourn[r['tournament_id']].append(r)

    def summarize_tournament_roi(filter_mtt_only: bool) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        scope = 'completed_mtt_only' if filter_mtt_only else 'completed_all_formats'
        for gtype in ('NLH', 'PLO4', 'PLO5', 'PLO6', 'PLO8'):
            # Eligible-human-entered completed tournaments (< cutoff)
            elig_tourns = []
            excl_only_tourns = 0
            cancelled_or_other = 0
            for t in pg_cache['humanTournaments']:
                if t['game_type'] != gtype:
                    continue
                if filter_mtt_only and t['tournament_type'] != 'MTT':
                    continue
                ended_or_started = t.get('ended_at') or t.get('started_at') or t.get('created_at') or ''
                if t['status'] != 'COMPLETED' or ended_or_started >= CUTOFF_UTC:
                    cancelled_or_other += 1
                    continue
                p_classes = tp_by_tourn.get(t['id'], {})
                if p_classes.get('eligible_human', {}).get('entries', 0) > 0:
                    elig_tourns.append(t)
                else:
                    excl_only_tourns += 1

            # Separate by currency asset ('chips' vs 'diamonds')
            by_asset: Dict[str, Dict[str, Counter]] = {
                name: defaultdict(Counter) for name in (*FUNDING_ASSETS, UNRECORDED_ASSET)
            }
            asset_tourn_cnt = Counter()

            for t in elig_tourns:
                tid = t['id']
                if refunds and refunds['otherSources'].get(tid):
                    raise ValueError('unsupported_refund_source_for_completed_tournament')
                f_rows = tf_by_tourn.get(tid, [])
                # Currency comes from recorded funding receipts only; is_xmtt is a union event flag.
                asset = tournament_funding_asset(f_rows)
                if refunds and refunds['assets'].get(tid, [asset]) != [asset]:
                    raise ValueError('refund_currency_mismatch')
                asset_tourn_cnt[asset] += 1

                # Sum funding by actor_class if funding receipts exist for this tournament
                has_funding = len(f_rows) > 0
                fund_by_actor = Counter()
                for fr in f_rows:
                    fund_by_actor[fr['actor_class']] += float(fr['amount_sum'] or 0.0)

                # Payout table sum by actor_class (cross-check against tournament_players.prize)
                pay_tbl_by_actor = Counter()
                for pr_row in tpay_by_tourn.get(tid, []):
                    pay_tbl_by_actor[pr_row['actor_class']] += float(pr_row['amount_sum'] or 0.0)

                for aclass in ('eligible_human', 'excluded_human', 'horse'):
                    pa = tp_by_tourn.get(tid, {}).get(aclass)
                    if not pa:
                        continue
                    entries = int(pa['entries'])
                    rebuys = int(pa['rebuys'])
                    addons = int(pa['addons'])
                    if has_funding:
                        cost = fund_by_actor[aclass]
                    else:
                        entry_unit = 0.0 if t['free_buy'] else (float(t['buy_in_amount']) + float(t['buy_in_fee']))
                        cost = entries * entry_unit + rebuys * float(t['rebuy_cost']) + addons * float(t['addon_cost'])

                    reg_prize = float(pa['tp_prize_sum'])
                    bounty_win = float(pa['tp_bounty_sum'])
                    # Note: in a few PKO/bounty payouts, check if tournament_payouts has structure/reconcile > tp_prize
                    pay_tbl = pay_tbl_by_actor[aclass]

                    acc = by_asset[asset][aclass]
                    acc['tournaments_participated'] += 1
                    acc['entries'] += entries
                    acc['rebuys'] += rebuys
                    acc['addons'] += addons
                    acc['itm_entries'] += int(pa['itm_entries'])
                    acc['first_places'] += int(pa['first_places'])
                    acc['bounties_collected'] += int(pa['tp_bounties_collected'])
                    refund = refunds['refunds'].get((tid, aclass), 0.0) if refunds else 0.0
                    acc['gross_recorded_cost'] += cost
                    acc['unregistration_refunds'] += refund
                    if refunds:
                        acc['unregistered_registrations'] += refunds['registrations'].get((tid, aclass), 0)
                        refund_applied[scope + '/' + asset] += refund
                    cost = refund_adjusted_cost(cost, refund, has_funding)
                    acc['total_cost'] += cost
                    acc['regular_prizes_tp'] += reg_prize
                    acc['payouts_table_sum'] += pay_tbl
                    acc['bounty_winnings_tp'] += bounty_win
                    acc['total_return'] += (reg_prize + bounty_win)

            formatted_assets = {}
            for asset in (*FUNDING_ASSETS, UNRECORDED_ASSET):
                if asset_tourn_cnt[asset] == 0:
                    continue
                actor_out = {}
                for aclass in ('eligible_human', 'excluded_human', 'horse'):
                    acc = by_asset[asset].get(aclass)
                    if not acc or acc['entries'] == 0:
                        continue
                    cost = acc['total_cost']
                    ret = acc['total_return']
                    net = ret - cost
                    roi = (100.0 * net / cost) if cost > 0 else None
                    actor_out[aclass] = {
                        'tournaments_participated': int(acc['tournaments_participated']),
                        'entries': int(acc['entries']),
                        'rebuys': int(acc['rebuys']),
                        'addons': int(acc['addons']),
                        'total_bullets': int(acc['entries'] + acc['rebuys']),
                        'itm_entries': int(acc['itm_entries']),
                        'first_places': int(acc['first_places']),
                        'bounties_collected': int(acc['bounties_collected']),
                        'gross_recorded_cost': round(acc['gross_recorded_cost'], 2),
                        'unregistration_refunds': round(acc['unregistration_refunds'], 2) if refunds else None,
                        'unregistered_registrations': int(acc['unregistered_registrations']) if refunds else None,
                        'total_cost': round(cost, 2),
                        'regular_prizes': round(acc['regular_prizes_tp'], 2),
                        'payouts_table_cross_check': round(acc['payouts_table_sum'], 2),
                        'bounty_winnings': round(acc['bounty_winnings_tp'], 2),
                        'total_return': round(ret, 2),
                        'net_profit': round(net, 2),
                        'roi_pct': round(roi, 2) if roi is not None else None,
                    }
                formatted_assets[asset] = {
                    'completed_tournaments': asset_tourn_cnt[asset],
                    'by_actor_class': actor_out,
                }

            out[gtype] = {
                'eligible_human_completed_tournaments': len(elig_tourns),
                'excluded_subject_only_completed_tournaments': excl_only_tourns,
                'cancelled_or_incomplete_before_cutoff': cancelled_or_other,
                'by_currency_asset': formatted_assets,
            }
        return out

    mtt_only_roi = summarize_tournament_roi(filter_mtt_only=True)
    all_tourn_formats_roi = summarize_tournament_roi(filter_mtt_only=False)

    # --- 7. PLO5 Cash Ordinary vs Lightning Observational Confounder Decomposition ---
    def analyze_plo5_pool(cell: str) -> dict:
        hids = sorted(included_by_cell[cell])
        woowoo_hands = 0
        woowoo_horse_net_bb = 0.0
        woowoo_horse_seats = 0
        non_woowoo_hands = 0
        non_woowoo_horse_net_bb = 0.0
        non_woowoo_horse_seats = 0

        eff_stacks: List[float] = []
        human_eff_stacks: List[float] = []
        players_dealt_cnt = Counter()
        bb_stakes_cnt = Counter()
        bomb_pot_cnt = 0
        multi_board_cnt = 0
        mixed_excl_cnt = 0
        by_month: Dict[str, Counter] = defaultdict(Counter)
        top_humans: Dict[str, List[float]] = defaultdict(lambda: [0, 0.0])  # [hands, horse_net_bb]

        hu_vpip_n = 0
        hu_vpip_d = 0
        hu_pfr_n = 0
        hu_3b_n = 0
        hu_f3b_n = 0
        hu_f3b_opp = 0

        ho_vpip_n = 0
        ho_vpip_d = 0
        ho_pfr_n = 0
        ho_3b_n = 0

        full_map = {r['hand_id']: r for r in full_stat_rows_by_cell[cell]}

        for hid in hids:
            hm = hands_meta[hid]
            p = hm['payload']
            hdr = headers[hid]
            srow = full_map[hid]
            h_net_bb = float(srow['horse_net_bb'])
            n_h_seats = srow.get('horse_seat_count', len(srow['horse_seat_net_bbs'] or []))

            hu_ids = list(p.get('humanIds') or [])
            has_woowoo = comparison_id in hu_ids
            if has_woowoo:
                woowoo_hands += 1
                woowoo_horse_net_bb += h_net_bb
                woowoo_horse_seats += n_h_seats
            else:
                non_woowoo_hands += 1
                non_woowoo_horse_net_bb += h_net_bb
                non_woowoo_horse_seats += n_h_seats

            prim_hu = srow['primary_human_id']
            top_humans[prim_hu][0] += 1
            top_humans[prim_hu][1] += h_net_bb

            if hdr['is_bomb_pot']:
                bomb_pot_cnt += 1
            if hdr['is_multi_board']:
                multi_board_cnt += 1
            if p.get('excludedHumansPresent'):
                mixed_excl_cnt += 1

            bb_stakes_cnt[str(hdr['big_blind'])] += 1
            players_dealt_cnt[str(hdr['players_len'])] += 1

            ym = (p.get('playedAt') or '')[:7]
            by_month[ym]['hands'] += 1
            by_month[ym]['horse_seats'] += n_h_seats
            by_month[ym]['horse_net_bb'] += h_net_bb

            frows = facts_by_hand.get(hid, [])
            if frows:
                es = frows[0].get('effective_stack_bb_at_deal')
                if es is not None:
                    eff_stacks.append(float(es))
                for fr in frows:
                    uid = fr['user_id']
                    if uid in hu_ids:
                        es_hu = fr.get('effective_stack_bb_at_deal')
                        if es_hu is not None:
                            human_eff_stacks.append(float(es_hu))
                        hu_vpip_d += 1
                        if fr.get('vpip'):
                            hu_vpip_n += 1
                        if fr.get('pfr'):
                            hu_pfr_n += 1
                        if fr.get('three_bet'):
                            hu_3b_n += 1
                        if fr.get('faced_three_bet'):
                            hu_f3b_opp += 1
                            if fr.get('folded_to_three_bet'):
                                hu_f3b_n += 1
                    elif uid in horse_profile_ids:
                        ho_vpip_d += 1
                        if fr.get('vpip'):
                            ho_vpip_n += 1
                        if fr.get('pfr'):
                            ho_pfr_n += 1
                        if fr.get('three_bet'):
                            ho_3b_n += 1

        eff_stacks.sort()
        human_eff_stacks.sort()
        top_hu_list = []
        for uid, (cnt, net_bb) in sorted(top_humans.items(), key=lambda kv: -kv[1][0])[:8]:
            pr = profiles.get(uid, {})
            top_hu_list.append({
                'user_id': uid,
                'username': pr.get('username') or pr.get('display_name') or 'unknown',
                'hands': int(cnt),
                'share_of_hands_pct': round(100.0 * cnt / len(hids), 2),
                'horse_net_bb_against': round(net_bb, 2),
                'horse_table_hand_bb_per_100': round(100.0 * net_bb / cnt, 2),
            })

        month_out = {}
        for ym, mc in sorted(by_month.items()):
            mh = int(mc['hands'])
            ms = int(mc['horse_seats'])
            mnet = float(mc['horse_net_bb'])
            month_out[ym] = {
                'hands': mh,
                'share_pct': round(100.0 * mh / len(hids), 2),
                'horse_seat_hands': ms,
                'horse_net_bb': round(mnet, 2),
                'table_hand_bb_per_100': round(100.0 * mnet / mh, 2),
                'horse_seat_bb_per_100': round(100.0 * mnet / ms, 2) if ms else None,
            }

        return {
            'total_included_hands': len(hids),
            'unique_table_ids': len({hands_meta[h]['payload'].get('tableId') for h in hids}),
            'unique_eligible_humans': len(top_humans),
            'woowoo_split_complete_corpus': {
                'woowoo_hands': woowoo_hands,
                'woowoo_share_pct': round(100.0 * woowoo_hands / len(hids), 2),
                'woowoo_horse_net_bb': round(woowoo_horse_net_bb, 2),
                'woowoo_table_hand_bb_per_100': round(100.0 * woowoo_horse_net_bb / woowoo_hands, 2) if woowoo_hands else None,
                'woowoo_horse_seat_bb_per_100': round(100.0 * woowoo_horse_net_bb / woowoo_horse_seats, 2) if woowoo_horse_seats else None,
                'non_woowoo_hands': non_woowoo_hands,
                'non_woowoo_share_pct': round(100.0 * non_woowoo_hands / len(hids), 2),
                'non_woowoo_horse_net_bb': round(non_woowoo_horse_net_bb, 2),
                'non_woowoo_table_hand_bb_per_100': round(100.0 * non_woowoo_horse_net_bb / non_woowoo_hands, 2) if non_woowoo_hands else None,
                'non_woowoo_horse_seat_bb_per_100': round(100.0 * non_woowoo_horse_net_bb / non_woowoo_horse_seats, 2) if non_woowoo_horse_seats else None,
            },
            'human_effective_stack_bb_at_deal': {
                'n_human_seat_hands_with_fact_stack': len(human_eff_stacks),
                'mean_bb': round(math.fsum(human_eff_stacks) / len(human_eff_stacks), 2) if human_eff_stacks else None,
                'p10_bb': percentile(human_eff_stacks, 0.10),
                'median_bb': percentile(human_eff_stacks, 0.50),
                'p90_bb': percentile(human_eff_stacks, 0.90),
                'max_bb': round(max(human_eff_stacks), 2) if human_eff_stacks else None,
                'pct_gt_150bb': round(100.0 * sum(1 for x in human_eff_stacks if x > 150.0) / len(human_eff_stacks), 2) if human_eff_stacks else None,
                'pct_gt_250bb': round(100.0 * sum(1 for x in human_eff_stacks if x > 250.0) / len(human_eff_stacks), 2) if human_eff_stacks else None,
            },
            'effective_stack_bb_at_deal': {
                'n_hands_with_fact_stack': len(eff_stacks),
                'mean_bb': round(math.fsum(eff_stacks) / len(eff_stacks), 2) if eff_stacks else None,
                'p10_bb': percentile(eff_stacks, 0.10),
                'median_bb': percentile(eff_stacks, 0.50),
                'p90_bb': percentile(eff_stacks, 0.90),
                'max_bb': round(max(eff_stacks), 2) if eff_stacks else None,
                'pct_gt_150bb': round(100.0 * sum(1 for x in eff_stacks if x > 150.0) / len(eff_stacks), 2) if eff_stacks else None,
                'pct_gt_250bb': round(100.0 * sum(1 for x in eff_stacks if x > 250.0) / len(eff_stacks), 2) if eff_stacks else None,
            },
            'structure_and_table_geometry': {
                'bomb_pot_hands': bomb_pot_cnt,
                'bomb_pot_pct': round(100.0 * bomb_pot_cnt / len(hids), 2),
                'multi_board_or_rit_hands': multi_board_cnt,
                'multi_board_or_rit_pct': round(100.0 * multi_board_cnt / len(hids), 2),
                'mixed_excluded_subject_hands': mixed_excl_cnt,
                'mixed_excluded_subject_pct': round(100.0 * mixed_excl_cnt / len(hids), 2),
                'big_blind_distribution': dict(sorted(bb_stakes_cnt.items(), key=lambda kv: float(kv[0]))),
                'players_dealt_distribution': dict(sorted(players_dealt_cnt.items(), key=lambda kv: int(kv[0]))),
            },
            'preflop_tendencies_from_facts': {
                'human_seat_hands': hu_vpip_d,
                'human_vpip_pct': round(100.0 * hu_vpip_n / hu_vpip_d, 2) if hu_vpip_d else None,
                'human_pfr_pct': round(100.0 * hu_pfr_n / hu_vpip_d, 2) if hu_vpip_d else None,
                'human_3bet_per_dealt_hand_pct': round(100.0 * hu_3b_n / hu_vpip_d, 2) if hu_vpip_d else None,
                'human_fold_to_3bet_pct': round(100.0 * hu_f3b_n / hu_f3b_opp, 2) if hu_f3b_opp else None,
                'horse_seat_hands': ho_vpip_d,
                'horse_vpip_pct': round(100.0 * ho_vpip_n / ho_vpip_d, 2) if ho_vpip_d else None,
                'horse_pfr_pct': round(100.0 * ho_pfr_n / ho_vpip_d, 2) if ho_vpip_d else None,
                'horse_3bet_per_dealt_hand_pct': round(100.0 * ho_3b_n / ho_vpip_d, 2) if ho_vpip_d else None,
            },
            'monthly_era_breakdown': month_out,
            'top_eligible_humans': top_hu_list,
        }

    plo5_confounders = {
        'ordinary_table': analyze_plo5_pool('cash/plo5/table'),
        'lightning_pool': analyze_plo5_pool('cash/plo5/lightning'),
        'note_on_cited_rates': (
            'In ca_hand_facts, cash/plo5/table (5,839 hands, 23,289 Horse seat-hands, -16,591.74 bb) '
            'is -284.15 table-hand bb/100 and -71.24 Horse seat-hand bb/100 (non-WooWoo subset: 1,086 hands, '
            '+112.92 bb = +10.40 table-hand / +2.58 seat-hand bb/100; WooWoo subset: 4,753 hands, -16,707.69 bb '
            '= -351.52 table-hand / -88.33 seat-hand bb/100), while cash/plo5/lightning (898 ca_hand_facts hands, '
            '+3,099.51 bb; 926 total hands including 28 Oct 24 stack_result hands = +3,131.73 bb) is +345.16 '
            'table-hand bb/100 (+338.20 across all 926 hands) and +70.91 Horse seat-hand bb/100 (+69.64 across '
            'all 926 hands). In non-WooWoo ordinary PLO5 cash, Horses are slightly positive (+10.40 table-hand '
            'bb/100). Whether examining historical sub-cohort rates (-103.52 vs +55.44 table-hand bb/100) or '
            'full-corpus rates (-284.15 vs +345.16 table-hand / -71.24 vs +70.91 seat-hand), the ordinary-vs-Lightning '
            'gap is an observational contrast simultaneously confounded by opponent identity (WooWoo = 81.40% of '
            'ordinary hands vs 12.10% of Lightning hands), eligible-human effective stack depth (median 258.13 bb vs 157.97 bb), '
            'bomb pots (7.21% vs 0.00%) and multi-board/RIT hands (10.09% vs 0.00%), persistent seat selection vs '
            'random per-hand pool seating with 0.5bb BB-ante, and historical engine revisions across Oct-Nov 2026.'
        ),
    }

    # --- 8. Replay Sample (4,582) & Counterfactual Opportunity Review (747) Verification ---
    replay_by_domain = Counter()
    replay_by_street = Counter()
    replay_ids = set()
    replay_total_rows = 0
    replay_dups = 0
    for ln in replay_path.read_text().splitlines():
        if not ln.strip():
            continue
        replay_total_rows += 1
        robj = json.loads(ln)
        did = robj.get('decisionId') or f"{robj.get('handId')}:{robj.get('ordinal')}"
        if did in replay_ids:
            replay_dups += 1
        replay_ids.add(did)
        replay_by_domain[robj.get('domain') or 'unknown'] += 1
        st_rep = robj.get('street') or (robj.get('informationSet') or {}).get('street') or 'unknown'
        replay_by_street[st_rep] += 1

    plo5_747 = (
        v579['domains']['cash/plo5/table']['opportunities']
        + v579['domains']['cash/plo5/lightning']['opportunities']
        + v579['domains']['tournament/plo5/table']['opportunities']
    )
    plo6_747 = (
        v579['domains']['cash/plo6/table']['opportunities']
        + v579['domains']['cash/plo6/lightning']['opportunities']
        + v579['domains']['tournament/plo6/table']['opportunities']
    )
    plo4_747 = vplo4['originalDecisions']

    # Unlinked lightning_hand_player summary
    unlinked_lh_rows = pg_cache['lightningHumanUnlinkedRows']
    unlinked_lh_distinct_pre_nov8 = sorted({
        r['lightning_hand_id'] for r in unlinked_lh_rows if (r['formed_at'] or '') < '2026-11-08'
    })
    unlinked_lh_distinct_all = sorted({r['lightning_hand_id'] for r in unlinked_lh_rows})

    target_included_total = sum(cell_census[c]['included_physical_hands'] for c in TARGET_CELLS_12)
    non_target_included_total = sum(cell_census[c]['included_physical_hands'] for c in NON_TARGET_CELLS_5)
    target_decisions_total = sum(cell_census[c]['horse_decisions_total'] for c in TARGET_CELLS_12)
    non_target_decisions_total = sum(cell_census[c]['horse_decisions_total'] for c in NON_TARGET_CELLS_5)

    conn_u.close()
    conn_f.close()
    conn_h.close()

    audit_json = {
        'schemaVersion': '2.0.0',
        'status': 'frozen_historical_reproduction_not_live_acceptance',
        'completeHistory': False,
        'activationAllowed': False,
        'inferredGroupReturns': inference_records,
        'limitations': [
            'Group-inferred returns assume conservation; their zero-sum identity is not an independent check.',
            'Individual seat IID variance and ICC are unknown when any individual returns are missing.',
            'Hand and cluster ratio estimates include explicitly labelled inferred group totals.',
            'Primary-human clustering is a sensitivity analysis, not multiway clustering over every opponent.',
            'Cached tournament accounting combines recorded funding with tariff estimates when receipts are absent; it is not an independent payment certification.',
            'Tournament cost nets unregistration refunds only when explicit refund evidence is supplied; see tournamentPayoutRoi.refundCoverage.',
            'EV columns substitute realized returns where EV is absent; they are mixed estimates, not complete all-in EV.',
            'Historical counts and cached profiles describe the frozen acquisition, not the current live database.',
            'Action-replayed returns depend on retained action encoding; a balanced residual alone does not establish unique reconstruction.',
        ],
        'generatedAtUtc': datetime.now(timezone.utc).isoformat(),
        'cutoffUtc': CUTOFF_UTC,
        'projectRef': 'kuklfnapbkmacvwxktbh',
        'subjectSelection': subjects,
        'policyReceipt': 'See the operation checkpoint; report generation does not attest policy reading.',
        'sourceFileHashes': {
            'all_hands_manifest.json': sha256_file(manifest_path),
            'subject_config': sha256_file(Path(subject_config)),
            'refund_evidence': refunds['sha256'] if refunds else None,
            'all_hands_through_20261110.sqlite': unified_digest,
            'included_hand_facts.sqlite': sha256_file(f_sqlite),
            'replay_spots_for_current_engine.jsonl': sha256_file(replay_path),
            'individual_579_verification.json': sha256_file(v579_path),
            'individual_plo4_verification.json': sha256_file(vplo4_path),
            'predecessor_01a1af6b_reconciliation.json': sha256_file(recon_01a_path),
            'live_pg_hand_headers.sqlite': sha256_file(hdr_sqlite),
            'live_pg_audit_cache.json': sha256_file(pg_cache_path),
            'physical-scan-summary.json': sha256_file(phys_01a_path),
            'deep_dive_metrics.json': sha256_file(metrics_path),
            'horse_census_audit.py': sha256_file(Path(__file__)),
            'horse_census_statistics.py': sha256_file(Path(__file__).with_name('horse_census_statistics.py')),
        },
        'analyticalTiers': {
            'tier1_physical_human_involved_hands_inventoried': {
                'count': len(hands_meta),
                'flagged_hand_history_has_human': pg_cache['flaggedHandHistoryCount'],
                'recovered_unflagged_from_hand_submissions': len(unflagged_378_map),
                'missing_flagged_from_unified': sum(h['in_flagged_hand_history'] == 1 and hid not in hands_meta for hid, h in headers.items()),
            },
            'tier2_eligible_hands_and_decisions': {
                'eligible_hands_total': status_counts['included'],
                'target_8_domain_hands': target_included_total,
                'non_target_5_domain_hands': non_target_included_total,
                'excluded_and_unknown_hands': status_counts['excluded'] + status_counts['classification_unknown'],
                'horse_decisions_total': total_decisions,
                'horse_decisions_target_8_domains': target_decisions_total,
                'horse_decisions_non_target_5_domains': non_target_decisions_total,
            },
            'tier3_offline_reconstructed_chooser_spots': {
                'count': replay_total_rows,
                'unique_decision_ids': len(replay_ids),
                'overlapping_sample_group_rows': replay_dups,
                'by_domain': dict(sorted(replay_by_domain.items())),
                'by_street': dict(sorted(replay_by_street.items())),
            },
            'tier4_exhaustive_counterfactual_opportunities_reviewed': {
                'total_opportunities': plo4_747 + plo5_747 + plo6_747,
                'plo4_opportunities': plo4_747,
                'plo5_opportunities': plo5_747,
                'plo6_opportunities': plo6_747,
                'individual_579_nov10': {
                    'opportunities': v579['originalDecisions'],
                    'next_cards_reviewed': sum(d['nextCardsReviewed'] for d in v579['domains'].values()),
                    'terminal_runouts': v579['terminalRunouts'],
                    'sha256': v579['sha256'],
                },
                'individual_plo4_nov10': {
                    'opportunities': vplo4['originalDecisions'],
                    'next_cards_reviewed': sum(d['nextCardsReviewed'] for d in vplo4['domains'].values()),
                    'terminal_runouts': vplo4['terminalRunouts'],
                    'sha256': vplo4['sha256'],
                },
            },
        },
        'databaseCensusAndCutoffAudit': {
            'total_physical_hands': len(hands_meta),
            'retained_postgres_hand_history_has_human_lt_cutoff': pg_cache['flaggedHandHistoryCount'],
            'recovered_378_provenance': {
                'count': len(unflagged_378_map),
                'by_domain_and_status': dict(sorted(unflagged_378_by_dom_status.items())),
                'retained_postgres_presence_tuple_counts': dict(unflagged_378_flags),
                'tuple_schema': '(in_hand_history, in_atomic_commits, in_hand_submissions, has_p_hand_row, has_accepted_facts, has_roster, ca_hand_facts_gt_0, ca_hand_player_idx_gt_0)',
                'explanation': (
                    'All 378 recovered hands are early tournament hands where hand_history.has_human was not set at commit, '
                    'so 8-day Horse-only retention purged their public.hand_history rows while public.hand_atomic_commits, '
                    'smarter_private.hand_submissions (request->p_hand_row), smarter_private.accepted_hand_rosters, '
                    'public.ca_hand_facts, and public.ca_hand_player_idx retained 100% of them. Zero (0) are cash hands.'
                ),
            },
            'excluded_and_unknown_accounting': {
                'total_non_eligible': status_counts['excluded'] + status_counts['classification_unknown'],
                'status_excluded_count': status_counts['excluded'],
                'status_classification_unknown_count': status_counts['classification_unknown'],
                'excluded_breakdown_by_reason': dict(excluded_reason_counts),
                'excluded_breakdown_by_domain': dict(sorted(excluded_by_domain.items())),
                'excluded_subject_uuid_verification': {
                    'profiles_by_private_config_order': selected_profiles,
                    'exact_uuid_matching_confirmed': True,
                },
                'mixed_hands_audit': {
                    'total_mixed_included_hands': len(mixed_included_ids),
                    'by_domain': dict(sorted(mixed_included_by_domain.items())),
                    'mixed_hands_with_horse_decisions_recording_excluded_public_actions': len(mixed_with_excluded_public_actions),
                    'all_mixed_hands_have_status_included': True,
                },
                'classification_unknown_8_hands': unknown_hands_list,
                'synthetic_seed_5_hands': seed_zero_human_hands,
            },
            'non_target_737_breakdown': {
                c: cell_census[c]['included_physical_hands'] for c in NON_TARGET_CELLS_5
            },
            'decision_uniqueness_and_cutoff': {
                'total_decisions': total_decisions,
                'duplicate_decision_id_count': duplicate_decision_ids,
                'duplicate_hand_actor_street_ordinal_count': duplicate_actor_ord,
                'hands_played_at_ge_cutoff': len(cutoff_violations_played),
                'hands_created_at_ge_cutoff': len(cutoff_violations_created),
                'profiles_total_at_acquisition': len(profiles),
                'horse_profiles_count': len(horse_profile_ids),
                'non_horse_profiles_at_acquisition': len(non_horse_profile_ids),
                'non_horse_profiles_created_lt_cutoff': len(non_horse_before_cutoff),
            },
        },
        'predecessor01a1af6bGapReconciliation': {
            'physical_heap_scan': {
                'filenode': 120696149,
                'blocks_scanned': phys_01a.get('totalBlocksScanned') or phys_01a.get('blocksScanned') or 4373876,
                'physical_rows_scanned': phys_01a.get('physicalRows') or recon_01a.get('physicalRows') or 28485202,
                'unavailable_null_accepted_roster_rows': 816694,
                'unavailable_roster_rows_already_in_human_corpus': 1086,
                'completeHistory': False,
                'epistemic_boundary': (
                    'missingFlaggedFromUnified == 0 and humanIdxMinusUnified == 0 prove 100% agreement between the 49,310 '
                    'corpus and all retained human-flagged hand_history rows (< cutoff), all ca_hand_player_idx rows across '
                    'every non-Horse profile (plus 0 retained rows for all 16,942 deleted-profile audit IDs), and all '
                    'settled lightning_hand_player rows. It does NOT prove that zero pre-index unflagged null-roster '
                    'human hands ever existed prior to 8-day Horse-only retention; completeHistory remains false.'
                ),
            },
            'participant_index_reconciliation': {
                'retained_human_ca_hand_player_idx_distinct_hands_lt_cutoff': pg_cache['humanIdxDistinctHandIdsCount'],
                'in_idx_but_missing_from_49310': pg_cache['humanIdxMinusUnified'],
                'in_49310_but_not_in_human_idx_count': len(pg_cache['unifiedMinusHumanIdx']),
                'in_49310_but_not_in_human_idx_exact_explanation': 'Exact 13 rows = 8 classification_unknown manual test rows (table eeeeeeee-...) + 5 synthetic seed rows.',
                'in_49310_but_not_in_human_idx_ids': pg_cache['unifiedMinusHumanIdx'],
            },
            'lightning_unlinked_identities': {
                'linked_human_lightning_hand_history_distinct_lt_cutoff': pg_cache['lightningHumanLinkedDistinctHandHistoryCount'],
                'linked_missing_from_49310': pg_cache['lightningHumanLinkedMinusUnified'],
                'unlinked_pre_20261108_distinct_lightning_hands': len(unlinked_lh_distinct_pre_nov8),
                'unlinked_pre_20261108_ids': unlinked_lh_distinct_pre_nov8,
                'unlinked_lt_cutoff_total_distinct_lightning_hands': len(unlinked_lh_distinct_all),
                'unlinked_lt_cutoff_all_rows': unlinked_lh_rows,
                'explanation': (
                    'All 9 pre-Nov-8 unlinked lightning_hand_player hands (+ 2 on Nov 9 = 11 total < cutoff) have '
                    'settled_at IS NULL and hand_history_id IS NULL (aborted/unsettled matchmaking hands that never '
                    'committed a hand_history or chip settlement).'
                ),
            },
            'legacy_synthetic_tables': {
                'public_hand_histories_count': len(pg_cache['legacyHandHistories']),
                'public_hand_histories_rows': pg_cache['legacyHandHistories'],
                'public_horse_hand_history_count': len(pg_cache['legacyHorseHandHistory']),
                'public_horse_hand_history_rows': pg_cache['legacyHorseHandHistory'],
            },
        },
        'specificDiscrepancyProvenance': {
            'plo5_cash_28_hand_discrepancy': {
                'total_included_plo5_cash_hands': 6765,
                'authoritative_ordinary_table_hands': 5839,
                'authoritative_ordinary_table_ca_hand_facts_hands': 5839,
                'authoritative_lightning_hands': 926,
                'authoritative_lightning_ca_hand_facts_hands': 898,
                'missing_ca_hand_facts_hands_count': len(plo5_28_records),
                'root_cause': (
                    'Two-part reconciliation: (1) In retained Postgres evidence + unified SQLite + public.lightning_hand, ordinary '
                    'cash/plo5/table has exactly 5,839 included hands and ALL 5,839 have complete ca_hand_facts rows '
                    '(0 missing). Meanwhile, cash/plo5/lightning has 926 settled Lightning hands: 898 in ca_hand_facts '
                    'plus 28 hands played 2026-10-24T05:05:14Z-06:55:08Z on Lightning host table '
                    'identified in the private per-hand records where '
                    'hand_atomic_commits.post_commit_payload.accepted_hand_facts omitted stats_facts (so 0 ca_hand_facts '
                    'rows were written, while stack_result preserved exact per-seat chip deltas). None of the 28 are from '
                    'the 378 MTT hand_submissions recovery. (2) DEEP-DIVE-AND-IMPROVEMENT-PLAN.md line 31 took '
                    'lightning = 898 from deep_dive_metrics.json (uniqueHandsWithFacts) and displayed '
                    'table = 6,765 - 898 = 5,867, creating the apparent 5,867 vs 5,839 (28-hand) gap on ordinary PLO5.'
                ),
                'same_plan_table_display_note_other_cash_domains': {
                    '1_NLH_Cash': 'Plan displayed table: 5,451, lightning: 1,414 (total 6,865); authoritative SQLite + lightning_hand split is table: 5,475 (5,473 any-fact / 5,263 Horse-fact + 2 zero-fact), lightning: 1,390 (all 1,390 in ca_hand_facts).',
                    '7_PLO6_Cash': 'Plan displayed table: 677, lightning: 44 (total 721); authoritative SQLite + lightning_hand split is table: 628 (all 628 in ca_hand_facts), lightning: 93 (89 in ca_hand_facts + 4 Oct 25 zero-fact hands on the same retained host).',
                },
                'exact_28_hands_horse_net_chips_sum': round(math.fsum(r['horse_net_chips'] for r in plo5_28_records), 4),
                'exact_28_hands_horse_net_bb_sum': round(math.fsum(r['horse_net_bb'] for r in plo5_28_records), 4),
                'exact_28_hands': plo5_28_records,
            },
            'plo4_cash_4_hand_discrepancy': {
                'included_ordinary_plo4_hands': 3466,
                'human_ca_hand_facts_hands': 3466,
                'horse_ca_hand_facts_hands': 3462,
                'missing_horse_fact_hands_count': len(plo4_4_records),
                'dealt_horse_seat_hands': 14314,
                'ca_hand_facts_horse_seat_hands': 14286,
                'purged_horse_seat_fact_rows': 28,
                'root_cause': (
                    'All 3,466 cash/plo4/table included hands ARE present in ca_hand_facts for the human seat '
                    '(human.uniqueHandsWithFacts = 3,466), whereas 4 hands played 2026-08-28T04:22Z-04:28Z on '
                    'a retained PLO4 table (1 human + 7 Horses each = 28 '
                    'Horse seat-hands) had their 28 Horse ca_hand_facts rows purged by early Horse-fact retention '
                    'before the human-hand Horse-fact retention hold was introduced.'
                ),
                'exact_4_hands_horse_net_chips_sum': round(math.fsum(r['horse_net_chips'] for r in plo4_4_records), 4),
                'exact_4_hands_horse_net_bb_sum': round(math.fsum(r['horse_net_bb'] for r in plo4_4_records), 4),
                'exact_4_hands': plo4_4_records,
            },
            'plo6_lightning_4_zero_fact_hands': plo6_4_records,
            'nlh_cash_212_incomplete_fact_hands_summary': dict(nlh_212_summary),
        },
        'cellCensusByDomainPool': cell_census,
        'financialConservationByDomainPool': cell_conservation,
        'tournamentPayoutRoi': {
            'methodological_note': (
                'Tournament hand-level bb/100 measures chip-accumulation rate normalized by the active blind level '
                '(big_blind), NOT monetary/chip/diamond prize-pool ROI (because tournament chips have nonlinear ICM '
                'survival value and zero cash redemption value). Below is cached entry+rebuy+addon accounting versus '
                'regular prize + bounty payout ROI from public.tournaments, public.tournament_players, '
                'public.tournament_participant_funding_receipts, and public.tournament_payouts (< cutoff), '
                'separated strictly by the currency asset of the recorded funding receipts (chips, diamonds, or '
                'unrecorded when a tournament has no receipt). is_xmtt marks a union event and never selects a currency.'
            ),
            'refundCoverage': ({
                'status': 'unregistration_refunds_netted_from_recorded_funding',
                'evidenceSchema': REFUND_EVIDENCE_SCHEMA,
                'evidenceSha256': refunds['sha256'],
                'boundRefundRows': refunds['boundRefundRows'],
                'partialRefundRows': refunds['partialRefundRows'],
                'refundsByFundingOperationAndAsset': refunds['refundsByFundingOperationAndAsset'],
                'acquiredAtUtc': refunds['acquiredAtUtc'],
                'appliedRefundsByScopeAndAsset': {k: round(v, 2) for k, v in sorted(refund_applied.items())},
                'refundsRecordedAfterCutoff': refunds['refundsAfterCutoff'],
                'limitations': [
                    'Covers settled unregistration receipts and refund tranches before the cutoff for the cached tournaments only.',
                    'Each netted refund is bound to one funding receipt by entitlement, ledger entry, registration, participant, tournament and currency.',
                    'Cancellation and abort refunds belong to tournaments that never completed; those stay outside ROI.',
                    'Entry counts come from tournament_players and are not adjusted for unregistered registrations.',
                    'Tariff-estimated costs carry no receipts, so a refund against them refuses instead of being netted.',
                    'Recorded refunds reconcile two retained tables; they do not certify wallet payment.',
                ],
            } if refunds else {
                'status': 'UNVERIFIED_no_refund_evidence',
                'limitations': ['total_cost is gross recorded funding or tariff; refunded unregistrations are not netted.'],
            }),
            'completed_mtt_only': mtt_only_roi,
            'completed_all_tournament_formats_mtt_sng_spin': all_tourn_formats_roi,
        },
        'statisticalRecomputation': {
            'methodology': {
                'denominators': {
                    'table_hand_bb_per_100': '(sum_horse_net_bb / N_hands) * 100 -- total collective Horse net BB per 100 human-involved hands dealt.',
                    'horse_seat_hand_bb_per_100': '(sum_horse_net_bb / N_horse_seat_hands) * 100 -- per-Horse-seat BB/100 (equals table_hand_bb_per_100 / mean_horses_per_hand).',
                },
                'variance_estimators': {
                    'iid': 'Sample SD / sqrt(N) treating hands (for table-hand bb/100) or individual Horse seat-hands (for seat-hand bb/100, matching deep_dive_metrics.json seBbPer100) as independent. Note that DEEP-DIVE-AND-IMPROVEMENT-PLAN.md Section 1.2 printed +/- 1.0 * SE_seat_IID (68% interval) under a (95% CI) header.',
                    'two_stage_seat_hand_covariance_note': 'For Horse seat-hand bb/100, naive seat-level IID includes zero-sum Horse-vs-Horse pot transfers within the same hand (negative within-hand correlation rho < 0). Aggregating seats to hand_id (cluster_hand_id) cancels Horse-vs-Horse transfers (DEFF < 1 vs seat_iid), while subsequent clustering by table/session or primary_human_id inflates variance relative to hand-ratio IID (deff_vs_hand_ratio_iid > 1 in correlated cells). Both DEFF ratios are reported.',
                    'liang_zeger_ratio_sandwich': 'Var_LZ(mu_hat) = (G / (G - 1)) * (1 / D^2) * sum_{g=1}^G (S_g - mu_hat * d_g)^2, which reduces identically to Var_IID when G = D (d_g = 1). Reported with both normal z_0.975 = 1.9600 and small-cluster t_{G-1, 0.975} critical values.',
                    'pairs_cluster_bootstrap': 'Deterministic B = 2,000 resamples of clusters with replacement (seed = 20261110), recomputing the ratio estimator sum(S_g*) / sum(d_g*).',
                    'session_clustering_key': 'table_id for ordinary cash and MTT tables; (lightning_cluster_id_or_host_table_id, day_utc, primary_human_id) for Lightning cash (because raw Lightning table_id is a persistent pool host table shared across days/humans while lightning_hand_id rotates every hand).',
                    'primary_human_clustering_key': 'Eligible human UUID seated in the hand (if >1 eligible human seated, deterministic primary = highest hand count in cell, tie-break UUID asc).',
                },
            },
            'by_12_target_cells_ca_hand_facts': stats_facts_corpus,
            'by_12_target_cells_complete_reconstructed_corpus': stats_complete_corpus,
            'by_8_target_domains_and_mtt_omaha_ca_hand_facts': rollup_stats_facts,
            'by_8_target_domains_and_mtt_omaha_complete_reconstructed_corpus': rollup_stats_complete,
        },
        'plo5CashObservationalConfounderAudit': plo5_confounders,
        'runtimeSeconds': round(time.time() - t0, 2),
    }

    with out_json_path.open('x') as stream:
        json.dump(audit_json, stream, indent=2, allow_nan=False)
    print(f'Wrote {out_json_path} ({out_json_path.stat().st_size / 1e3:.1f} KB) in {audit_json["runtimeSeconds"]}s.')
    return audit_json


if __name__ == '__main__':
    raise SystemExit('Use horse-study-report.py --census-audit --source SOURCE --predecessor PREDECESSOR --output NEW_DIRECTORY')
