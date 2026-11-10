import unittest

from horse_wager_geometry import wager_geometry


class WagerGeometryTests(unittest.TestCase):
    def test_short_ante_stack_cannot_win_unmatched_side_pot(self):
        info = {'heroSeat': 1, 'street': 'turn', 'legalActions': ['fold', 'all_in'],
                'priorPublicActions': [{'seat': 1, 'action': 'check', 'stage': 'turn'},
                                       {'seat': 2, 'action': 'all_in', 'stage': 'turn',
                                        'isFullRaise': False}],
                'publicState': {'pot': 205, 'toCall': 100,
                                'seats': [[1, 5, 0, 5, 5, 5, 0], [2, 0, 100, 100, 0, 0, 2],
                                          [3, 50, 100, 100, 0, 0, 0]]}}
        got = wager_geometry(info)
        self.assertEqual(got['eligibleAfterCall'], 30)
        self.assertEqual(got['callCost'], 5)
        self.assertFalse(got['canIncreaseCurrentWager'])
        self.assertTrue(got['facingAnotherWagerThisStreet'])
        self.assertFalse(got['interveningWagers'][0]['fullRaise'])
        self.assertEqual(got['layersAfterCall'][-1], {'eligibleSeats': [2, 3], 'chips': 180})

    def test_bba_is_common_dead_money(self):
        info = {'heroSeat': 1, 'street': 'preflop', 'legalActions': ['fold','call','raise'],
                'publicState': {'pot': 120, 'toCall': 100,
                                'seats': [[1, 5, 0, 0, 0, 0, 0], [2, 200, 100, 120, 20, 0, 0]]}}
        got = wager_geometry(info)
        self.assertEqual(got['eligibleAfterCall'], 30)
        self.assertIsNone(got['facingAnotherWagerThisStreet'])
        self.assertEqual(got['effectiveStreetRaiseToByOpponent'], {2: 5})
        info['publicState']['pot'] = 121
        self.assertEqual(wager_geometry(info)['status'], 'unavailable')
