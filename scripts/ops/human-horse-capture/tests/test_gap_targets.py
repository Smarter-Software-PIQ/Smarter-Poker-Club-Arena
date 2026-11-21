import unittest

import gap_targets

SHA_BUILD = '26c2e74930dd0ec05a4a86a62f04e8fe05be04d1'


class TestGapTargets(unittest.TestCase):
    def test_all_six_spot_classifiers_and_non_top_human_filter(self):
        # Dominant human plays 5 quiet hands so they become top_human_id
        hands = [
            {
                'id': f'dom-{i}',
                'k': f'{i:064x}',
                'game_variant': 'plo4',
                'game_mode': 'cash',
                'engine_build': SHA_BUILD,
                'human_user_ids': ['dominant-u'],
                'horse_user_ids': ['horse-1'],
                'actions': [
                    {'stage': 'preflop', 'userId': 'dominant-u', 'action': 'call'},
                    {'stage': 'preflop', 'userId': 'horse-1', 'action': 'check'},
                ],
            }
            for i in range(1, 6)
        ]

        # Dominant human HU flop first bet -> MUST NOT get 'non_top_human_hu_flop_first_bet'
        hands.append({
            'id': 'dom-flop-bet',
            'k': 'a' * 64,
            'game_variant': 'plo4',
            'game_mode': 'cash',
            'engine_build': SHA_BUILD,
            'human_user_ids': ['dominant-u'],
            'horse_user_ids': ['horse-1'],
            'actions': [
                {'stage': 'preflop', 'userId': 'dominant-u', 'action': 'raise'},
                {'stage': 'preflop', 'userId': 'horse-1', 'action': 'call'},
                {'stage': 'flop', 'userId': 'horse-1', 'action': 'check'},
                {'stage': 'flop', 'userId': 'dominant-u', 'action': 'bet'},
            ],
        })

        # (a) + (b) + (c): non-top human HU flop first bet -> called by horse -> turn second barrel -> river check-to bet
        hands.append({
            'id': 'spot-a-b',
            'k': 'b' * 64,
            'game_variant': 'plo5',
            'game_mode': 'cash',
            'engine_build': SHA_BUILD,
            'human_user_ids': ['human-2'],
            'horse_user_ids': ['horse-1'],
            'actions': [
                {'stage': 'preflop', 'userId': 'human-2', 'action': 'raise'},
                {'stage': 'preflop', 'userId': 'horse-1', 'action': 'call'},
                {'stage': 'flop', 'userId': 'horse-1', 'action': 'check'},
                {'stage': 'flop', 'userId': 'human-2', 'action': 'bet'},
                {'stage': 'flop', 'userId': 'horse-1', 'action': 'call'},
                {'stage': 'turn', 'userId': 'horse-1', 'action': 'check'},
                {'stage': 'turn', 'userId': 'human-2', 'action': 'bet'},
                {'stage': 'turn', 'userId': 'horse-1', 'action': 'call'},
                {'stage': 'river', 'userId': 'horse-1', 'action': 'check'},
                {'stage': 'river', 'userId': 'human-2', 'action': 'bet'},
            ],
        })

        # (d) Human 4-bet over Horse 3-bet + (e) rare cell (plo6 / lightning)
        hands.append({
            'id': 'spot-d-e',
            'k': 'c' * 64,
            'game_variant': 'plo6',
            'game_mode': 'lightning',
            'engine_build': SHA_BUILD,
            'human_user_ids': ['human-3'],
            'horse_user_ids': ['horse-2'],
            'actions': [
                {'stage': 'preflop', 'userId': 'human-3', 'action': 'raise'},
                {'stage': 'preflop', 'userId': 'horse-2', 'action': 'raise'},
                {'stage': 'preflop', 'userId': 'human-3', 'action': 'raise'},
            ],
        })

        # (f) Double-board bomb pot reaching showdown + fixed-limit check
        hands.append({
            'id': 'spot-f',
            'k': 'd' * 64,
            'game_variant': 'plo4',
            'game_mode': 'cash',
            'is_bomb_pot': True,
            'board_count': 2,
            'went_to_showdown': True,
            'engine_build': SHA_BUILD,
            'human_user_ids': ['human-4'],
            'horse_user_ids': ['horse-1'],
            'actions': [
                {'stage': 'flop', 'userId': 'horse-1', 'action': 'check'},
                {'stage': 'flop', 'userId': 'human-4', 'action': 'check'},
            ],
        })

        res = gap_targets.select_gap_targets(hands, target_per_human_hu_flop=1, min_non_top_humans=1)
        by_id = {h['h']: set(h['spots']) for h in res['hands']}
        self.assertNotIn('dom-flop-bet', by_id)
        self.assertEqual(
            by_id['spot-a-b'],
            {'non_top_human_hu_flop_first_bet', 'turn_second_barrel_after_flop_call', 'checked_to_river_bet'},
        )
        self.assertEqual(
            by_id['spot-d-e'],
            {'human_reraise_vs_horse_3bet_or_4bet', 'rare_human_cell'},
        )
        self.assertEqual(by_id['spot-f'], {'double_board_bomb_pot_showdown'})
        self.assertTrue(res['nonTopHumanHuFlopProgress']['quotaMet'])


if __name__ == '__main__':
    unittest.main()
