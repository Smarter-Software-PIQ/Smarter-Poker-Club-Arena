import unittest

import build_attribution

SHA_1 = '3529e86663daa427b380a8ab9bd09347270c670e'
SHA_2 = '26c2e74930dd0ec05a4a86a62f04e8fe05be04d1'


class TestBuildAttribution(unittest.TestCase):
    def setUp(self):
        self.deploys = [
            {
                'engine_sha': SHA_1,
                'started_at': '2026-11-16T02:45:00Z',
                'completed_at': '2026-11-16T02:48:00Z',
                'instance_id': '1-fb955e00',
            },
            {
                'engine_sha': SHA_2,
                'started_at': '2026-11-18T10:00:00Z',
                'completed_at': '2026-11-18T10:04:00Z',
                'instance_id': '1-99aa11bb',
            },
        ]
        self.bounds = build_attribution.normalize_boundaries(self.deploys)

    def test_direct_engine_build_column_takes_precedence(self):
        hand = {
            'id': 'h1',
            'engine_build': SHA_2,
            'started_at': '2026-11-17T12:00:00Z',
        }
        sha, src = build_attribution.attribute_hand_build(hand, self.bounds)
        self.assertEqual((sha, src), (SHA_2, 'hand_history.engine_build'))

    def test_deploy_boundary_fallback_and_ambiguous_cutover(self):
        pre_hand = {'id': 'h2', 'engine_build': None, 'started_at': '2026-11-17T05:00:00Z'}
        self.assertEqual(
            build_attribution.attribute_hand_build(pre_hand, self.bounds),
            (SHA_1, 'deploy_boundary'),
        )

        cutover_hand = {'id': 'h3', 'engine_build': None, 'started_at': '2026-11-18T10:02:00Z'}
        self.assertEqual(
            build_attribution.attribute_hand_build(cutover_hand, self.bounds),
            (None, 'ambiguous_cutover'),
        )

        post_hand = {'id': 'h4', 'engine_build': None, 'started_at': '2026-11-18T11:30:00Z'}
        self.assertEqual(
            build_attribution.attribute_hand_build(post_hand, self.bounds),
            (SHA_2, 'deploy_boundary'),
        )

    def test_split_window_across_cutover_and_markdown_table(self):
        slices = build_attribution.split_window_by_builds(
            '2026-11-18T08:00:00Z',
            '2026-11-18T12:00:00Z',
            self.bounds,
        )
        self.assertEqual(len(slices), 2)
        self.assertEqual(slices[0]['releaseSha'], SHA_1)
        self.assertEqual((slices[0]['startUtc'], slices[0]['endUtc']), ('2026-11-18T08:00:00Z', '2026-11-18T10:00:00Z'))
        self.assertEqual(slices[1]['releaseSha'], SHA_2)
        self.assertEqual((slices[1]['startUtc'], slices[1]['endUtc']), ('2026-11-18T10:04:00Z', '2026-11-18T12:00:00Z'))

        hands = [
            {'id': 'a', 'engine_build': None, 'started_at': '2026-11-18T09:00:00Z'},
            {'id': 'b', 'engine_build': SHA_2, 'started_at': '2026-11-18T11:00:00Z'},
        ]
        summary = build_attribution.summarize_hand_builds(hands, self.bounds)
        self.assertTrue(summary['straddlesMultipleBuilds'])
        md = build_attribution.format_boundary_markdown(
            '2026-11-18T08:00:00Z', '2026-11-18T12:00:00Z', self.bounds, summary
        )
        self.assertIn('### Build boundary table (M9)', md)
        self.assertIn(SHA_1[:8], md)
        self.assertIn(SHA_2[:8], md)


if __name__ == '__main__':
    unittest.main()
