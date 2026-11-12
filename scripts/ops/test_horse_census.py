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
    cohort_roi_pct,
    reconstruction_sensitivity,
    entry_cohort,
    refund_adjusted_cost,
    run_audit,
    tournament_funding_asset,
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

    def refund_file(self, refund=None, unregistration=None, extra_refunds=(), extra_unregistrations=(), **changes):
        bound = dict(entitlement_id='e1', tournament_id='t1', actor_class='horse', source='fn_unregister_from_tournament',
                     registration_id='r1', refund_amount=30, funding_amount=30, credit_amount=30,
                     funding_operation='entry', funding_asset='chips', entitlement_tournament_match=True,
                     entitlement_user_match=True, funding_receipt_found=True, funding_tournament_match=True,
                     funding_user_match=True, funding_registration_match=True, funding_ledger_match=True,
                     credit_user_match=True, unregistration_receipt_found=True, unregistration_identity_match=True)
        bound.update(refund or {})
        receipt = dict(registration_id='r1', tournament_id='t1', actor_class='horse', refunded_chips=30,
                       returned_ticket_value=0, entitlement_count=1)
        receipt.update(unregistration or {})
        cancelled = dict(entitlement_id='e9', tournament_id='t2', actor_class='horse', source='atomic_cancel_tournament',
                         refund_amount=99)
        free = dict(registration_id='r0', tournament_id='t1', actor_class='eligible_human', refunded_chips=0,
                    returned_ticket_value=0, entitlement_count=0)
        value = dict(schema='horse-census-refund-evidence-v2', cutoffUtc='2026-11-10T21:30:00+00:00', tournamentCount=2,
                     acquiredAtUtc='2026-11-11T00:00:00+00:00', refundsAfterCutoff={'n': 0, 'paid': 0},
                     unregistrations=[receipt, free, *extra_unregistrations], refunds=[bound, cancelled, *extra_refunds])
        value.update(changes)
        path = Path(self.enterContext(tempfile.TemporaryDirectory())) / 'refunds.json'
        path.write_text(json.dumps(value))
        return path, bound, receipt

    def test_bound_unregistration_refunds_are_netted_and_never_inferred(self):
        self.assertIsNone(read_refund_evidence(None, {'t1', 't2'}))
        evidence = read_refund_evidence(self.refund_file()[0], {'t1', 't2'})
        self.assertEqual(evidence['refunds'], {('t1', 'horse'): 30.0})
        self.assertEqual(evidence['registrations'], {('t1', 'horse'): 1, ('t1', 'eligible_human'): 1})
        self.assertEqual(evidence['assets'], {'t1': ['chips']})
        self.assertEqual(evidence['otherSources'], {'t2': ['atomic_cancel_tournament']})
        self.assertEqual((evidence['boundRefundRows'], evidence['partialRefundRows']), (1, 0))
        self.assertRegex(evidence['sha256'], '^[0-9a-f]{64}$')
        self.assertEqual(refund_adjusted_cost(100.0, 30.0, True), 70.0)
        self.assertEqual(refund_adjusted_cost(100.0, 0.0, False), 100.0)
        with self.assertRaisesRegex(ValueError, 'refund_without_recorded_funding'):
            refund_adjusted_cost(100.0, 30.0, False)
        with self.assertRaisesRegex(ValueError, 'refund_exceeds_recorded_funding'):
            refund_adjusted_cost(20.0, 30.0, True)

    def test_partial_refunds_rebuys_and_addons_bind_to_their_own_receipts(self):
        _, bound, receipt = self.refund_file()
        rebuy = dict(bound, entitlement_id='e2', funding_operation='rebuy', refund_amount=10, funding_amount=25, credit_amount=10)
        addon = dict(bound, entitlement_id='e3', funding_operation='addon', refund_amount=5, funding_amount=5, credit_amount=5)
        path, _, _ = self.refund_file(extra_refunds=[rebuy, addon],
                                      unregistration=dict(refunded_chips=45, entitlement_count=3))
        evidence = read_refund_evidence(path, {'t1', 't2'})
        self.assertEqual(evidence['refunds'], {('t1', 'horse'): 45.0})
        self.assertEqual(evidence['partialRefundRows'], 1)
        self.assertEqual(evidence['refundsByFundingOperationAndAsset'],
                         {'addon/chips': 5.0, 'entry/chips': 30.0, 'rebuy/chips': 10.0})

    def test_duplicate_unbound_or_out_of_scope_refund_evidence_is_refused(self):
        _, bound, receipt = self.refund_file()
        cases = [
            ('refund_evidence_schema_unsupported', dict(schema=None)),
            ('refund_evidence_cutoff_mismatch', dict(cutoffUtc='2026-11-12T00:00:00+00:00')),
            ('refund_evidence_tournament_scope_mismatch', dict(tournamentCount=3)),
            ('refund_evidence_sections_required', dict(refunds=None)),
            ('duplicate_refund_evidence', dict(extra_refunds=[dict(bound)])),
            ('duplicate_unregistration_receipt', dict(extra_unregistrations=[dict(receipt)])),
            ('refund_evidence_row_out_of_scope', dict(refund=dict(tournament_id='other'))),
            ('refund_evidence_amount_invalid', dict(refund=dict(refund_amount=-1))),
            ('ticket_return_accounting_unsupported', dict(unregistration=dict(returned_ticket_value=5))),
            ('refund_not_bound_to_recorded_funding', dict(refund=dict(funding_ledger_match=False))),
            ('refund_not_bound_to_recorded_funding', dict(refund=dict(funding_user_match=None))),
            ('refund_not_bound_to_recorded_funding', dict(refund=dict(funding_operation='prize'))),
            ('refund_not_bound_to_recorded_funding', dict(refund=dict(funding_asset=None))),
            ('refund_registration_mismatch', dict(refund=dict(registration_id='r0'))),
            ('refund_registration_mismatch', dict(refund=dict(registration_id='missing'))),
            ('refund_exceeds_recorded_funding', dict(refund=dict(funding_amount=20))),
            ('refund_credit_mismatch', dict(refund=dict(credit_amount=29))),
            ('refund_receipt_cross_check_failed', dict(unregistration=dict(refunded_chips=31))),
            ('refund_receipt_cross_check_failed', dict(unregistration=dict(entitlement_count=2))),
            ('refund_receipt_cross_check_failed', dict(refunds=[])),
        ]
        for message, changes in cases:
            with self.subTest(message=message, changes=changes), self.assertRaisesRegex(ValueError, message):
                read_refund_evidence(self.refund_file(**changes)[0], {'t1', 't2'})

    def test_currency_comes_from_recorded_receipts_not_the_union_flag(self):
        entry = dict(operation='entry', asset='chips', amount_sum=90.0)
        self.assertEqual(tournament_funding_asset([entry, dict(entry, operation='rebuy')]), 'chips')
        self.assertEqual(tournament_funding_asset([dict(entry, asset='diamonds')]), 'diamonds')
        self.assertEqual(tournament_funding_asset([]), 'unrecorded')
        source = Path(__file__).with_name('horse_census_audit.py').read_text()
        self.assertNotIn("t.get('is_xmtt')", source)
        for message, rows in [
            ('mixed_asset_tournament_funding', [entry, dict(entry, asset='diamonds')]),
            ('recorded_funding_is_not_gross_charges', [dict(entry, amount_sum=-5.0)]),
            ('recorded_funding_is_not_gross_charges', [dict(entry, operation='refund')]),
            ('recorded_funding_asset_unsupported', [dict(entry, asset=None)]),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                tournament_funding_asset(rows)

    def test_return_on_cost_is_reported_only_for_paid_entry_events(self):
        self.assertEqual(entry_cohort({'free_buy': False}), 'paid_entry')
        self.assertEqual(entry_cohort({'free_buy': True}), 'free_buy')
        for bad in ({}, {'free_buy': None}, {'free_buy': 0}):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, 'tournament_free_buy_flag_required'):
                entry_cohort(bad)
        self.assertEqual(cohort_roi_pct('paid_entry', 200.0, 150.0), -25.0)
        self.assertIsNone(cohort_roi_pct('paid_entry', 0.0, 10.0))
        # rebuys and add-ons inside a zero-entry event are not an entry-cost denominator
        self.assertIsNone(cohort_roi_pct('free_buy', 21745.0, 35546.13))
        self.assertIsNone(cohort_roi_pct('pooled', 200.0, 150.0))

    def test_reconstruction_tiers_show_what_excluding_weaker_evidence_does(self):
        out = reconstruction_sensitivity({'recorded': [100, -50.0, -40.0], 'reconstructed': [10, 20.0, 5.0], 'inferred': [2, 30.0, 12.0]})
        self.assertEqual(out['directly_recorded'], {'hands': 100, 'horse_net_chips': -50.0, 'horse_net_bb': -40.0, 'table_hand_bb_per_100': -40.0})
        self.assertEqual(out['recorded_plus_reconstructed']['horse_net_chips'], -30.0)
        self.assertEqual(out['all_tiers_published_total'], {'hands': 112, 'horse_net_chips': 0.0, 'horse_net_bb': -23.0, 'table_hand_bb_per_100': round(-23.0 / 112 * 100, 4)})
        self.assertNotIn('table_hand_bb_per_100', out['inferred_by_conservation_only'])
        self.assertIsNone(reconstruction_sensitivity({'recorded': [0, 0.0, 0.0], 'reconstructed': [0, 0.0, 0.0], 'inferred': [0, 0.0, 0.0]})['directly_recorded']['table_hand_bb_per_100'])

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
        self.assertEqual(single['cluster_precision'], 'undefined_single_cluster')
        two = compute_ratio_cluster_stats({'a': [10.0, -20.0], 'b': [40.0, 5.0]}, 100.0)
        self.assertEqual(two['n_clusters'], 2)
        self.assertEqual(two['cluster_precision'], 'descriptive_only_two_clusters')
        three = compute_ratio_cluster_stats({'a': [10.0], 'b': [40.0], 'c': [-5.0]}, 100.0)
        self.assertEqual(three['cluster_precision'], 'estimated')
