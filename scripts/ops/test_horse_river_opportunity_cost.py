import unittest

from horse_river_opportunity_cost import terminal_cost_bounds


class OpportunityCostTests(unittest.TestCase):
    def setUp(self):
        self.prices = [
            {'bet': size, 'result': outcome, 'heroIncrementalUnits': units}
            for size, payoffs in ((0, [100, 50, 0, 100]), (25, [125, 50, -25, 100]))
            for outcome, units in zip(('win', 'tie', 'loss', 'fold'), payoffs)
        ]

    def test_check_and_bet_share_the_same_showdown(self):
        check = terminal_cost_bounds(self.prices, 0)
        self.assertEqual(check['alternatives'], [{'betUnits': 25, 'lowerUnits': -25, 'upperUnits': 100}])
        bet = terminal_cost_bounds(self.prices, 25)
        self.assertEqual((bet['regretLowerUnits'], bet['regretUpperUnits']), (0, 25))

    def test_refuses_missing_duplicate_and_unpriced(self):
        for cells, observed in ((self.prices[:-1], 25), (self.prices + self.prices[:1], 0),
                                (self.prices, 24), (self.prices, False)):
            with self.assertRaises(ValueError):
                terminal_cost_bounds(cells, observed)
