#!/usr/bin/env python3
"""Unit and end-to-end verification tests for the Data Census & Statistical Audit."""
from __future__ import annotations

import json
import math
import re
import unittest
from pathlib import Path

from horse_census_statistics import (
    Z_975,
    _anova_icc,
    compute_iid_stats,
    compute_ratio_cluster_stats,
    evaluate_cell_denominators,
    t_crit_975,
)
import tempfile

from horse_census_audit import (
    checked_seat_totals,
    conservation_inference,
    read_refund_evidence,
    refund_adjusted_cost,
    run_audit,
)
from horse_study_subjects import read_subjects, validate_frozen_cohort

class TestStatEstimators(unittest.TestCase):
    def test_frozen_recipe_refuses_other_cohorts_and_missing_private_subjects(self):
        with self.assertRaisesRegex(ValueError, 'private_subject_config_required'):
            read_subjects(None)
        with self.assertRaisesRegex(ValueError, 'unsupported_frozen_cutoff'):
            validate_frozen_cohort({'cutoffUtc': '2026-11-12T00:00:00Z'}, {})
        with self.assertRaisesRegex(ValueError, 'frozen_subject_selection_mismatch'):
            validate_frozen_cohort({'cutoffUtc': '2026-11-10T21:30:00+00:00'},
                                  {'excludedSubjectIds': []})

    def rows(self, missing=False):
        return [dict(hand_id=str(i), horse_net_bb=sum(seats),
                     horse_seat_net_bbs=None if missing and i == 1 else seats,
                     horse_seat_count=len(seats), session_cluster=str(i // 2),
                     primary_human_id=str(i % 2))
                for i, seats in enumerate(([10., -4.], [7., -9., 3.], [-20., 6.], [8.]))]

    def test_group_totals_preserve_ratio_variance_without_inventing_seat_outcomes(self):
        observed = evaluate_cell_denominators(self.rows(), bootstrap_reps=100)
        partial = evaluate_cell_denominators(self.rows(True), bootstrap_reps=100)
        self.assertEqual(partial['individual_seat_outcomes_missing'], 3)
        self.assertEqual(partial['n_horse_seat_hands'], 8)
        self.assertEqual(partial['horse_net_bb_total'], 1)
        seat = partial['horse_seat_hand_bb_per_100']
        self.assertEqual(seat['estimate'], 12.5)
        for name in ('se', 'sd', 'ci95_low_z', 'ci95_high_z'):
            self.assertIsNone(seat['iid'][name])
        for name in ('cluster_hand_id', 'cluster_table_or_lightning_session', 'cluster_primary_human'):
            original = observed['horse_seat_hand_bb_per_100'][name]
            self.assertEqual(seat[name]['se_lz'], original['se_lz'])
            self.assertEqual(seat[name]['se_bootstrap'], original['se_bootstrap'])
            self.assertIsNone(seat[name]['icc_anova'])
            self.assertIsNone(seat[name]['deff'])

    def test_no_missing_participant_is_assigned_zero(self):
        with self.assertRaisesRegex(ValueError, 'participant_return_unavailable'):
            checked_seat_totals({'human': 4}, {'horse'}, {'human'}, set(), 2)
        with self.assertRaisesRegex(ValueError, 'invalid_big_blind'):
            checked_seat_totals({'horse': -4, 'human': 4}, {'horse'}, {'human'}, set(), 0)

    def test_conservation_inference_is_not_independent_evidence(self):
        result = conservation_inference(4, 0, 1, 10, 9)
        self.assertEqual(result['horse_net_chips'], -5)
        self.assertIsNone(result['independent_residual'])
        self.assertIsNone(result['horse_seat_net_bbs'])
        with self.assertRaisesRegex(ValueError, 'pot_awards'):
            conservation_inference(4, 0, 1, 10, 7)

    def test_duplicate_hands_and_inconsistent_seat_returns_are_refused(self):
        rows = self.rows()
        with self.assertRaisesRegex(ValueError, 'duplicate_hand_id'):
            evaluate_cell_denominators(rows + [rows[0]], bootstrap_reps=0)
        rows[0]['horse_net_bb'] += 1
        with self.assertRaisesRegex(ValueError, 'seat_returns_disagree'):
            evaluate_cell_denominators(rows, bootstrap_reps=0)

    def refund_file(self, **changes):
        unregistration = dict(tournament_id='t1', actor_class='horse', start_authority='scheduled_clock', n=3,
                              refunded_chips=30, returned_ticket_value=0, with_funding_receipt=3,
                              funding_amount_for_unregistered=30)
        unregistration.update(changes.pop('unregistration', {}))
        value = dict(cutoffUtc='2026-11-10T21:30:00+00:00', tournamentCount=2, acquiredAtUtc='2026-11-11T00:00:00+00:00',
                     laterRefundsAfterCutoff=[{'n': 0, 'paid': 0}], unregistrations=[unregistration],
                     refundTranches=[dict(tournament_id='t1', actor_class='horse', source='fn_unregister_from_tournament', paid=30),
                                     dict(tournament_id='t2', actor_class='horse', source='atomic_cancel_tournament', paid=99)])
        value.update(changes)
        path = Path(self.enterContext(tempfile.TemporaryDirectory())) / 'refunds.json'
        path.write_text(json.dumps(value))
        return path

    def test_recorded_unregistration_refunds_are_netted_and_never_inferred(self):
        self.assertIsNone(read_refund_evidence(None, {'t1', 't2'}))
        evidence = read_refund_evidence(self.refund_file(), {'t1', 't2'})
        self.assertEqual(evidence['refunds'], {('t1', 'horse'): 30.0})
        self.assertEqual(evidence['registrations'], {('t1', 'horse'): 3})
        self.assertEqual(evidence['otherSources'], {'t2': ['atomic_cancel_tournament']})
        self.assertRegex(evidence['sha256'], '^[0-9a-f]{64}$')
        self.assertEqual(refund_adjusted_cost(100.0, 30.0, True), 70.0)
        self.assertEqual(refund_adjusted_cost(100.0, 0.0, False), 100.0)
        with self.assertRaisesRegex(ValueError, 'refund_without_recorded_funding'):
            refund_adjusted_cost(100.0, 30.0, False)
        with self.assertRaisesRegex(ValueError, 'refund_exceeds_recorded_funding'):
            refund_adjusted_cost(20.0, 30.0, True)

    def test_unbound_or_out_of_scope_refund_evidence_is_refused(self):
        cases = [
            ('refund_evidence_cutoff_mismatch', dict(cutoffUtc='2026-11-12T00:00:00+00:00')),
            ('refund_evidence_tournament_scope_mismatch', dict(tournamentCount=3)),
            ('refund_evidence_sections_required', dict(refundTranches=None)),
            ('refund_evidence_row_out_of_scope', dict(unregistration=dict(tournament_id='other'))),
            ('refund_evidence_amount_invalid', dict(unregistration=dict(refunded_chips=-1))),
            ('ticket_return_accounting_unsupported', dict(unregistration=dict(returned_ticket_value=5))),
            ('refund_not_bound_to_recorded_funding', dict(unregistration=dict(with_funding_receipt=2))),
            ('refund_not_bound_to_recorded_funding', dict(unregistration=dict(funding_amount_for_unregistered=20))),
            ('refund_tranche_cross_check_failed', dict(refundTranches=[])),
        ]
        for message, changes in cases:
            with self.subTest(message=message, changes=changes), self.assertRaisesRegex(ValueError, message):
                read_refund_evidence(self.refund_file(**changes), {'t1', 't2'})

    def test_frozen_evidence_cannot_be_output(self):
        with self.assertRaisesRegex(ValueError, 'output_must_not_modify'):
            run_audit(Path('/frozen'), Path('/previous'), Path('/frozen/new'))

    def test_singleton_clusters_equal_iid_identically(self) -> None:
        obs = [float((i * 17) % 53 - 26) * 10.0 for i in range(120)]
        iid = compute_iid_stats(obs)
        singleton_clusters = {f'c_{i}': [v] for i, v in enumerate(obs)}
        lz = compute_ratio_cluster_stats(singleton_clusters, iid['var_mean'], bootstrap_reps=200, seed=42)
        self.assertEqual(lz['n_clusters'], 120)
        self.assertEqual(lz['total_units'], 120)
        self.assertAlmostEqual(lz['mean'], iid['mean'], places=4)
        self.assertAlmostEqual(lz['se_lz'], iid['se'], places=4)
        self.assertAlmostEqual(lz['deff'], 1.0, places=4)
        self.assertAlmostEqual(lz['n_eff'], 120.0, places=2)
        self.assertIsNone(lz['icc_kish_implied'])

    def test_replicated_within_cluster_observations_give_unit_icc(self) -> None:
        # G = 25 clusters, each with m = 4 identical observations
        clusters = {}
        all_obs = []
        for g in range(25):
            val = float((g - 12) * 20.0)
            clusters[f'g_{g:02d}'] = [val, val, val, val]
            all_obs.extend([val, val, val, val])
        iid = compute_iid_stats(all_obs)
        lz = compute_ratio_cluster_stats(clusters, iid['var_mean'], bootstrap_reps=0, seed=7)
        self.assertAlmostEqual(_anova_icc(list(clusters.values())), 1.0, places=5)
        self.assertAlmostEqual(lz['icc_anova'], 1.0, places=5)
        # Exact finite-sample ratio: (N - 1) / (G - 1) = 99 / 24 = 4.125
        self.assertAlmostEqual(lz['deff'], 99.0 / 24.0, places=4)
        self.assertAlmostEqual(lz['n_eff'], 100.0 / (99.0 / 24.0), places=2)

    def test_two_stage_horse_seat_vs_hand_and_session_covariance(self) -> None:
        # 20 sessions x 10 hands/session x 4 Horses/hand.
        # Within each hand, Horse 0 wins +50bb from Horse 1 (-50bb) plus a shared session edge s_g.
        rows = []
        for g in range(20):
            session_shift = 4.0 if (g % 2 == 0) else -4.0
            for h in range(10):
                seats = [50.0 + session_shift, -50.0 + session_shift, session_shift, session_shift]
                rows.append({
                    'hand_id': f'h_{g}_{h}',
                    'horse_net_bb': sum(seats),
                    'horse_seat_net_bbs': seats,
                    'session_cluster': f'sess_{g}',
                    'primary_human_id': f'hu_{g % 5}',
                })
        res = evaluate_cell_denominators(rows, bootstrap_reps=300, seed=99)
        self.assertEqual(res['n_hands'], 200)
        self.assertEqual(res['n_horse_seat_hands'], 800)
        self.assertAlmostEqual(res['mean_horses_per_hand'], 4.0, places=4)
        self.assertAlmostEqual(
            res['table_hand_bb_per_100']['estimate'],
            res['horse_seat_hand_bb_per_100']['estimate'] * 4.0,
            places=3,
        )
        # Hand-level aggregation cancels the +/-50bb Horse-vs-Horse transfer (deff < 1 vs seat IID)
        seat_hand = res['horse_seat_hand_bb_per_100']['cluster_hand_id']
        seat_sess = res['horse_seat_hand_bb_per_100']['cluster_table_or_lightning_session']
        self.assertLess(seat_hand['deff'], 0.30)
        # Session clustering inflates variance strongly vs hand-ratio IID (deff_vs_hand_ratio_iid > 5)
        self.assertGreater(seat_sess['deff_vs_hand_ratio_iid'], 5.0)
        # Deterministic bootstrap check
        res2 = evaluate_cell_denominators(rows, bootstrap_reps=300, seed=99)
        self.assertEqual(
            res['table_hand_bb_per_100']['cluster_table_or_lightning_session']['se_bootstrap'],
            res2['table_hand_bb_per_100']['cluster_table_or_lightning_session']['se_bootstrap'],
        )

    def test_small_cluster_t_crit_and_single_cluster_fail_closed(self) -> None:
        self.assertIsNone(t_crit_975(0))
        self.assertAlmostEqual(t_crit_975(1), 12.706204736432095, places=9)
        self.assertAlmostEqual(t_crit_975(10), 2.2281388519649385, places=9)
        self.assertGreater(t_crit_975(100), Z_975)

        single = compute_ratio_cluster_stats({'only_cluster': [10.0, -20.0, 40.0]}, 100.0)
        self.assertEqual(single['n_clusters'], 1)
        self.assertIsNone(single['se_lz'])
        self.assertIsNone(single['deff'])
        self.assertIsNone(single['n_eff'])
        self.assertEqual(single['note'], 'single_cluster_variance_undefined')
