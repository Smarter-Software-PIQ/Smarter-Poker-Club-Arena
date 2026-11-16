import unittest
from metrics_window import window_delta
A = '''# TYPE process_start_time_seconds gauge
process_start_time_seconds 100
# TYPE poker_horse_telemetry_opportunities_total counter
poker_horse_telemetry_opportunities_total{rule="call_floor",outcome="eligible"} 5
poker_horse_telemetry_opportunities_total{rule="flop_cap",outcome="eligible"} 9
poker_horse_gone_total 3
# TYPE poker_horse_gone_total counter
# TYPE poker_horse_upgrade_manifest_info gauge
poker_horse_upgrade_manifest_info{version="1",release_sha="abc"} 1
# TYPE poker_horse_decision_worker_ready gauge
poker_horse_decision_worker_ready 1
'''
B = A.replace('"eligible"} 5', '"eligible"} 12').replace('"eligible"} 9', '"eligible"} 4').replace('poker_horse_gone_total 3\n', '') + 'poker_horse_new_total 2\n# TYPE poker_horse_new_total counter\n'
H = {'instanceId': '2-aa', 'releaseSha': 'abc'}
class Window(unittest.TestCase):
    def test_deltas_resets_and_missing_series(self):
        d = window_delta(A, B, H, H)
        c = d['counters']
        self.assertTrue(d['processStable'])
        self.assertEqual(c['poker_horse_telemetry_opportunities_total{rule="call_floor",outcome="eligible"}']['delta'], 7)
        self.assertEqual(c['poker_horse_telemetry_opportunities_total{rule="flop_cap",outcome="eligible"}'], {'delta': None, 'reason': 'counter_reset'})
        self.assertEqual(c['poker_horse_gone_total']['reason'], 'missing_at_end')
        self.assertEqual(c['poker_horse_new_total']['reason'], 'missing_at_start')
        self.assertNotIn('poker_horse_decision_worker_ready', c)
        self.assertIn('poker_horse_upgrade_manifest_info{version="1",release_sha="abc"}', d['info'])
    def test_restart_makes_every_delta_unknown(self):
        for b, hb in ((B.replace('process_start_time_seconds 100', 'process_start_time_seconds 200'), H), (B, {'instanceId': '3-bb', 'releaseSha': 'abc'}),
                      (B, {'instanceId': '2-aa', 'releaseSha': 'def'}), (B, {})):
            d = window_delta(A, b, H, hb)
            self.assertFalse(d['processStable'])
            self.assertTrue(all(v['delta'] is None for v in d['counters'].values()))
if __name__ == '__main__':
    unittest.main()
