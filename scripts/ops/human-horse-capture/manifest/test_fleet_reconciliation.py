import unittest
from unittest import mock
import fleet_reconciliation as fr
H = {'releaseSha': 'S', 'liveHorseDecision': {'workerCount': 2, 'workers': [{'index': i, 'phase': 'ready', 'solverStores': {'postflopV31': 0}} for i in (0, 1)]}}
A = {'f': {'unit': 'horse_decision', 'formats': ['tournament'], 'variants': 'nlh', 'situation': 's'}}
X = {'f': {'unit': 'excluded', 'formats': None, 'variants': None, 'situation': 's'}}
def fleet(seen, inv=None, name='f'):
    return {'observationEpoch': {'servingReleaseSha': 'S'}, 'featureList': [name],
            'featureSummaries': {name: {'naturally_observed': {'true': seen}, 'committed': {'true': seen}, 'invoked': {'true': seen if inv is None else inv}}}}
class T(unittest.TestCase):
    def one(self, anc, fl, appl=A, **k):
        name = fl['featureList'][0]
        with mock.patch.object(fr, 'in_release', side_effect=lambda r, sha, s: anc[0] if sha == 'c' else anc[1]):
            return fr.rows('r', fl, {name: 'c'}, {name: appl['f']}, 'S', k.pop('health', H), **k)[0]
    def test_absent_source_is_pending_delivery_not_failure(self):
        r = self.one((False, False), fleet(0))
        self.assertEqual((r['result'], r['activationManifestContract']), ('PENDING_DELIVERY_not_in_serving_release', 'N/A_producer_not_in_serving_release'))
    def test_unobserved_and_partial_and_lane_scope(self):
        c = {'laneUnretired': {'both': 3, 'cash': 5, 'events': 2}, 'byRetiredStatus': {'unretired/available': 10}}
        r = self.one((True, True), fleet(0), config=c)
        self.assertEqual((r['result'], r['laneEligibleHorses'], r['effectiveRuntimeConfiguration'], r['activationManifestContract']),
                         ('UNOBSERVED_live_exercise', '5 by stored lane', 'UNVERIFIED', 'UNVERIFIED_no_manifest_evidence'))
        self.assertEqual(self.one((True, True), fleet(1))['result'], 'OBSERVED_PARTIAL')
        self.assertEqual(self.one((True, True), fleet(1))['laneEligibleHorses'], 'UNKNOWN_no_configuration_readback')
    def test_worker_health_contract_is_separate_from_manifest(self):
        w = {'f': {'unit': 'worker', 'formats': None, 'variants': None, 'situation': 's'}}
        r = self.one((True, False), fleet(0), w)
        self.assertEqual((r['result'], r['activationManifestContract'], r['laneEligibleHorses']), ('PASS_per_worker_health_contract', 'N/A_producer_not_in_serving_release', None))
        bad = {'releaseSha': 'S', 'liveHorseDecision': {'workerCount': 3, 'workers': H['liveHorseDecision']['workers']}}
        self.assertEqual(self.one((True, False), fleet(0), w, health=bad)['result'], 'NOT_PASS_per_worker_health_contract')
        self.assertEqual(self.one((True, False), fleet(0), w, health={'releaseSha': 'S'})['result'], 'UNVERIFIED_no_per_worker_rows_per_worker_health_contract')
    def test_excluded_states(self):
        self.assertEqual(self.one((False, False), fleet(0), X)['result'], 'N/A_source_not_in_serving_release')
        self.assertEqual(self.one((True, True), fleet(0), X)['result'], 'UNVERIFIED_disabled_state')
        m = {'servingSha': 'S', 'verdict': 'PASS', 'workers': [{}] * 2}
        self.assertEqual(self.one((True, True), fleet(0), X, manifests=m)['result'], 'PASS_kept_off')
        self.assertEqual(self.one((True, True), fleet(0, inv=1), X, manifests=m)['result'], 'FAIL_excluded_feature_observed')
        self.assertEqual(self.one((None, False), fleet(0, name='excluded_r7_r8_x'), X)['result'], 'PASS_stores_zero_on_every_worker')
    def test_evidence_for_another_release_refuses(self):
        with self.assertRaisesRegex(ValueError, 'health_not_for_serving_release'): self.one((True, True), fleet(0), health={'releaseSha': 'X'})
        with self.assertRaisesRegex(ValueError, 'manifest_evidence_not_for_serving_release'):
            self.one((True, True), fleet(0), manifests={'servingSha': 'X', 'verdict': 'PASS', 'workers': []})
        with self.assertRaisesRegex(ValueError, 'feature_map_mismatch'): fr.rows('r', fleet(0), {}, A, 'S', H)
