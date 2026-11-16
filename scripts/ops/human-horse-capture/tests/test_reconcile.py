import json, subprocess, sys, tempfile, unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / 'reconcile.py'

def write(d, name, obj):
    (d / name).write_text(obj if isinstance(obj, str) else json.dumps(obj))

class Reconcile(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory(); self.d = Path(self.t.name)
        write(self.d, 'window-denominators-hands.json', {'hands': [{'hand_id': 'A', 'has_human': True}, {'hand_id': 'B', 'has_human': True},
                                                                     {'hand_id': 'C', 'has_human': False}]})
        write(self.d, 'human-hand-keys.json', {'sourceSha': 's', 'hands': [{'h': 'A', 'k': 'ka'}, {'h': 'B', 'k': 'kb'}]})
        rows = [{'hand': 'A', 'turnKey': 't1'}, {'hand': 'A', 'turnKey': 't2'},
                {'summary': {'hands': 1, 'missing': 0, 'otherRelease': 0, 'decisions': 2, 'reviewStatus': {'reconciled': 1}}}]
        write(self.d, 'originals-witness-1.jsonl', ''.join(json.dumps(r) + '\n' for r in rows))
    def tearDown(self):
        self.t.cleanup()
    def run_tool(self):
        r = subprocess.run([sys.executable, '-B', str(TOOL), str(self.d)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr); return json.loads(r.stdout)

    def test_matching_sets_and_a_hand_without_witness_rows(self):
        write(self.d, 'human-hand-keys-part1.json', {'hands': [{'h': 'A', 'k': 'ka'}, {'h': 'B', 'k': 'kb'}]})
        o = self.run_tool()
        self.assertEqual((o['censusHumanHands'], o['inBoth'], o['censusOnly'], o['lightOnly'], o['keyMismatch']), (2, 2, [], [], []))
        self.assertEqual(o['lightNotInWitness'], ['B'])
        self.assertEqual(o['witnessHandsWithDecisions'], 1)
        self.assertEqual(o['witnessSummaries'][0]['decisions'], 2)
        self.assertFalse((self.d / 'human-hand-keys-part3.json').exists())

    def test_census_only_hand_gets_a_part3_key_file(self):
        write(self.d, 'human-hand-keys-part1.json', {'hands': [{'h': 'A', 'k': 'ka'}]})
        o = self.run_tool()
        self.assertEqual(o['censusOnly'], ['B'])
        p3 = json.loads((self.d / 'human-hand-keys-part3.json').read_text())
        self.assertEqual(p3['hands'], [{'h': 'B', 'k': 'kb'}])

    def test_key_mismatch_and_light_only_are_reported(self):
        write(self.d, 'human-hand-keys-part1.json', {'hands': [{'h': 'A', 'k': 'WRONG'}, {'h': 'B', 'k': 'kb'}, {'h': 'Z', 'k': 'kz'}]})
        o = self.run_tool()
        self.assertEqual((o['keyMismatch'], o['lightOnly']), (['A'], ['Z']))

    def test_census_human_hand_without_key_is_listed(self):
        write(self.d, 'window-denominators-hands.json', {'hands': [{'hand_id': 'A', 'has_human': True}, {'hand_id': 'B', 'has_human': True},
                                                                     {'hand_id': 'D', 'has_human': True}]})
        write(self.d, 'human-hand-keys-part1.json', {'hands': [{'h': 'A', 'k': 'ka'}, {'h': 'B', 'k': 'kb'}]})
        self.assertEqual(self.run_tool()['censusHumanWithoutKey'], ['D'])

if __name__ == '__main__':
    unittest.main()
