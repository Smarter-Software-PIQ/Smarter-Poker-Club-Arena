import json, subprocess, sys, tempfile, unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / 'merge_census.py'
SHA = 'a' * 40

def seg(d, name, start, end, hands, sha=SHA, missing=()):
    s = {'startUtc': start, 'endUtc': end, 'sourceSha': sha, 'missingSlices': list(missing), 'slices': [{'startUtc': start}],
         'handsRead': len(hands), 'totalsOverReadSlices': {'nlh|cash': len(hands)}}
    p = d / (name + '.json'); p.write_text(json.dumps(s))
    (d / (name + '-hands.json')).write_text(json.dumps({'hands': [{'hand_id': h, 'has_human': h.startswith('m')} for h in hands]}))
    return p

def run(d, start, end, *segs):
    return subprocess.run([sys.executable, '-B', str(TOOL), start, end, str(d / 'out-hands.json'), str(d / 'out.json'), *map(str, segs)],
                          capture_output=True, text=True)

class MergeCensus(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory(); self.d = Path(self.t.name)
    def tearDown(self):
        self.t.cleanup()

    def test_contiguous_segments_merge_with_totals_and_human_count(self):
        a = seg(self.d, 's1', '2026-11-14T00:00:00Z', '2026-11-14T02:00:00Z', ['m1', 'h1'])
        b = seg(self.d, 's2', '2026-11-14T02:00:00Z', '2026-11-14T03:00:00Z', ['h2'], missing=['2026-11-14T02:10:00Z'])
        r = run(self.d, '2026-11-14T00:00:00Z', '2026-11-14T03:00:00Z', a, b)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = json.loads((self.d / 'out.json').read_text())
        self.assertEqual((s['handsRead'], s['humanHands'], s['complete'], s['totalsOverReadSlices']['nlh|cash']), (3, 1, False, 3))
        self.assertEqual(s['missingSlices'], ['2026-11-14T02:10:00Z'])

    def test_refuses_gap_between_segments(self):
        a = seg(self.d, 's1', '2026-11-14T00:00:00Z', '2026-11-14T01:00:00Z', ['h1'])
        b = seg(self.d, 's2', '2026-11-14T01:01:00Z', '2026-11-14T02:00:00Z', ['h2'])
        r = run(self.d, '2026-11-14T00:00:00Z', '2026-11-14T02:00:00Z', a, b)
        self.assertNotEqual(r.returncode, 0); self.assertIn('not contiguous', r.stderr)
        self.assertFalse((self.d / 'out.json').exists())

    def test_refuses_window_not_covered(self):
        a = seg(self.d, 's1', '2026-11-14T00:00:00Z', '2026-11-14T01:00:00Z', ['h1'])
        r = run(self.d, '2026-11-14T00:00:00Z', '2026-11-14T02:00:00Z', a)
        self.assertNotEqual(r.returncode, 0); self.assertIn('not contiguous', r.stderr)

    def test_refuses_mixed_source(self):
        a = seg(self.d, 's1', '2026-11-14T00:00:00Z', '2026-11-14T01:00:00Z', ['h1'])
        b = seg(self.d, 's2', '2026-11-14T01:00:00Z', '2026-11-14T02:00:00Z', ['h2'], sha='b' * 40)
        r = run(self.d, '2026-11-14T00:00:00Z', '2026-11-14T02:00:00Z', a, b)
        self.assertNotEqual(r.returncode, 0); self.assertIn('mixed source', r.stderr)

    def test_refuses_duplicate_hand_across_segments(self):
        a = seg(self.d, 's1', '2026-11-14T00:00:00Z', '2026-11-14T01:00:00Z', ['h1'])
        b = seg(self.d, 's2', '2026-11-14T01:00:00Z', '2026-11-14T02:00:00Z', ['h1'])
        r = run(self.d, '2026-11-14T00:00:00Z', '2026-11-14T02:00:00Z', a, b)
        self.assertNotEqual(r.returncode, 0); self.assertIn('duplicate hand', r.stderr)

    def test_refuses_to_overwrite_an_output(self):
        a = seg(self.d, 's1', '2026-11-14T00:00:00Z', '2026-11-14T01:00:00Z', ['h1'])
        (self.d / 'out.json').write_text('{}')
        r = run(self.d, '2026-11-14T00:00:00Z', '2026-11-14T01:00:00Z', a)
        self.assertNotEqual(r.returncode, 0); self.assertIn('output exists', r.stderr)
        self.assertEqual((self.d / 'out.json').read_text(), '{}')

if __name__ == '__main__':
    unittest.main()
