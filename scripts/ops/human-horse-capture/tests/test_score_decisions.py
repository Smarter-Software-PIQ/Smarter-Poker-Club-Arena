import unittest

import score_decisions


class TestScoreDecisions(unittest.TestCase):
    def test_loo_range_classification_avoids_peeking_and_river_bluff_underfrequency_trap(self):
        # E7 / M1 check: on river pot-sized bets (price = 100 / 300 = 0.3333),
        # suppose 3 hands have strong value bets (hero equity 0.10) and 1 hand is a rare bluff
        # where hero has 0.80 vs the actual bluff. Leave-one-hand-out range equity for the bluff
        # hand is mean(0.10, 0.10, 0.10) = 0.10 < 0.3333, so LOO does NOT falsely classify
        # the fold on h4 as wrong against the bettor's range!
        rows = [
            {
                'hand': f'h{i}',
                'variant': 'plo4',
                'street': 'river',
                'bigBlind': 2.0,
                'potBeforeCall': 200.0,
                'callCost': 100.0,
                'betToPot': 1.0,
                'equityVsActualHand': 0.10,
                'realization': 1.0,
                'baseAction': 'fold',
                'candidateAction': 'fold',
                'opponentId': f'human-{i}',
            }
            for i in range(1, 4)
        ] + [
            {
                'hand': 'h4',
                'variant': 'plo4',
                'street': 'river',
                'bigBlind': 2.0,
                'potBeforeCall': 200.0,
                'callCost': 100.0,
                'betToPot': 1.0,
                'equityVsActualHand': 0.80,
                'realization': 1.0,
                'baseAction': 'fold',
                'candidateAction': 'fold',
                'opponentId': 'human-4',
            }
        ]
        res = score_decisions.score_spots(rows, seed=42, n_boot=400)
        ov = res['overall']
        self.assertEqual(ov['looRangeClassifiedFolds']['flaggedCount'], 0)
        # Calling every fold loses money overall (-35 bb + +70 bb? Wait: 3*(0.1*300-100)/2 = -105 bb, + (0.8*300-100)/2 = +70 bb -> -35 bb)
        self.assertAlmostEqual(ov['foldContextOnly']['callingEveryFoldActual']['totalBb'], -35.0, places=3)

    def test_top_human_share_excluding_top_human_and_reverse_change_detection(self):
        # 4 spots vs dominant human 'whale' (fold->call profitable) and 2 spots vs other humans,
        # including 1 reverse change (call->fold) to verify M11 directionClean=False.
        rows = []
        for i in range(4):
            rows.append({
                'hand': f'w{i}',
                'variant': 'plo5',
                'street': 'flop',
                'bigBlind': 2.0,
                'potBeforeCall': 100.0,
                'callCost': 50.0,
                'betToPot': 0.50,
                'equityVsActualHand': 0.50,
                'realization': 0.90,
                'baseAction': 'fold',
                'candidateAction': 'call',
                'opponentId': 'dominant-human',
            })
        rows.append({
            'hand': 'o1',
            'variant': 'plo5',
            'street': 'flop',
            'bigBlind': 2.0,
            'potBeforeCall': 100.0,
            'callCost': 50.0,
            'betToPot': 0.50,
            'equityVsActualHand': 0.48,
            'realization': 0.90,
            'baseAction': 'fold',
            'candidateAction': 'call',
            'opponentId': 'other-human-1',
        })
        rows.append({
            'hand': 'o2',
            'variant': 'plo5',
            'street': 'flop',
            'bigBlind': 2.0,
            'potBeforeCall': 100.0,
            'callCost': 50.0,
            'betToPot': 0.50,
            'equityVsActualHand': 0.45,
            'realization': 0.90,
            'baseAction': 'call',
            'candidateAction': 'fold',
            'opponentId': 'other-human-2',
        })

        res = score_decisions.score_spots(rows, seed=99, n_boot=500)
        ov = res['overall']
        self.assertAlmostEqual(ov['topHuman']['share'], 4 / 6, places=4)
        self.assertTrue(ov['topHuman']['singlePlayerDominated'])
        cc = ov['candidateChanges']
        self.assertEqual(cc['changedTotal'], 6)
        self.assertEqual(cc['forwardChanges'], 5)
        self.assertEqual(cc['reverseChanges'], 1)
        self.assertFalse(cc['directionClean'])

        ex = cc['excludingTopHuman']
        self.assertEqual(ex['spots'], 2)
        self.assertEqual(ex['changed'], 2)
        self.assertEqual(ex['distinctHumans'], 2)

    def test_card_firewall_blocks_card_tokens_in_cell_names(self):
        bad_rows = [
            {
                'hand': 'h1',
                'variant': 'AsKh',
                'street': 'flop',
                'bigBlind': 2.0,
                'potBeforeCall': 40.0,
                'callCost': 20.0,
                'betToPot': 0.5,
                'equityVsActualHand': 0.5,
                'baseAction': 'fold',
                'candidateAction': 'call',
                'opponentId': 'u1',
            }
        ]
        # Note: variant is lowercased ('askh'), so put 'As' into sizeBucket which preserves case!
        bad_rows[0]['sizeBucket'] = 'leak_As_Kh'
        with self.assertRaisesRegex(RuntimeError, 'card firewall breach'):
            score_decisions.score_spots(bad_rows)


if __name__ == '__main__':
    unittest.main()
