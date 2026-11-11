import unittest
from horse_plo_opportunity_ranking import conditional_deltas, ranking


class InitiativePricingTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(id='hand:3', info='digest', domain='cash/plo5/lightning',
                        street='turn', ante='big_blind', call=5, pot=20, bb=1,
                        category='strong_facing_wager', facingIdentifiedHumanBet=True,
                        recordedAction='call', liveOpponents=1,
                        prices=[{'to': 15, 'maxMatchedExtraChips': 10}])
        self.geo = dict(decisionId='hand:3', inputDigest='digest', domain=self.row['domain'],
                        geometry=dict(status='captured', canIncreaseCurrentWager=True,
                                      callCost=5, eligibleAfterCall=25,
                                      layersAfterCall=[{'eligibleSeats': [2, 4]}]))

    def test_fold_and_call_branches(self):
        values = list(conditional_deltas(20, 5, 10))
        self.assertEqual(values[0], -10)
        self.assertEqual(values[4], 10)
        self.assertEqual(values[10], 7.5)
        group, = ranking([self.row], [self.geo])
        self.assertEqual(group['pricedCalls'], 1)
        self.assertIsNone(group['measuredStrategyLossBB'])

    def test_ineligible_layers_and_multiway_remain_in_denominator(self):
        self.geo['geometry']['layersAfterCall'].append({'eligibleSeats': [2]})
        group, = ranking([self.row, {**self.row, 'id': 'other:4', 'liveOpponents': 2}], [self.geo])
        self.assertEqual(group['opportunities'], 2)
        self.assertEqual(group['pricedCalls'], 0)
        self.assertIsNone(group['meanScenarioMinDeltaBB'])

    def test_missing_or_wrong_frame_is_rejected(self):
        for rows in ([], [{**self.geo, 'inputDigest': 'other'}]):
            with self.assertRaises(ValueError):
                ranking([self.row], rows)
