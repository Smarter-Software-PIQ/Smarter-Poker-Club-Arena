import unittest
from datetime import datetime, timedelta
import segments

P = lambda s: datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ')

class Segments(unittest.TestCase):
    def test_twelve_hour_window_is_six_contiguous_two_hour_segments(self):
        pts = segments.points('2026-11-14T22:10:00Z', '2026-11-15T10:10:00Z')
        self.assertEqual(len(pts), 7)
        pairs = segments.pairs('2026-11-14T22:10:00Z', '2026-11-15T10:10:00Z')
        self.assertTrue(all(a[1] == b[0] for a, b in zip(pairs, pairs[1:])))
        self.assertTrue(all(P(b) - P(a) <= timedelta(hours=2) for a, b in pairs))
        self.assertEqual((pairs[0][0], pairs[-1][1]), ('2026-11-14T22:10:00Z', '2026-11-15T10:10:00Z'))

    def test_short_last_segment_and_the_cutover_shortened_window(self):
        self.assertEqual(segments.points('2026-11-14T01:00:00Z', '2026-11-14T06:16:00Z'),
                         ['2026-11-14T01:00:00Z', '2026-11-14T03:00:00Z', '2026-11-14T05:00:00Z', '2026-11-14T06:16:00Z'])

    def test_exactly_two_hours_is_one_segment_and_one_hour_pairs(self):
        self.assertEqual(len(segments.pairs('2026-11-14T00:00:00Z', '2026-11-14T02:00:00Z')), 1)
        self.assertEqual(len(segments.pairs('2026-11-14T00:00:00Z', '2026-11-14T02:30:00Z', 1)), 3)

    def test_refusals(self):
        with self.assertRaises(SystemExit): segments.points('2026-11-14T02:00:00Z', '2026-11-14T02:00:00Z')
        with self.assertRaises(SystemExit): segments.points('2026-11-14T03:00:00Z', '2026-11-14T02:00:00Z')
        with self.assertRaises(SystemExit): segments.points('2026-11-14T00:00:00Z', '2026-11-16T00:00:01Z')

if __name__ == '__main__':
    unittest.main()
