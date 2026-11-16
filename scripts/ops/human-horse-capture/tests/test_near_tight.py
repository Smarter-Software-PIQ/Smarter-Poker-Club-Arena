#!/usr/bin/env python3
# Archive test_near_tight.py (capture-toolkit-v2, toolkit v3), checks unchanged; repository port: near_tight.py from the toolkit directory, scratch under
# HVH_TEST_TMP (default: the system temporary directory) and always removed; runs under unittest discover and directly.
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
TOOL = Path(__file__).resolve().parents[1] / 'near_tight.py'

def main():
    d = Path(tempfile.mkdtemp(dir=os.environ.get('HVH_TEST_TMP') or None))
    try:
        (d / 'tight-maniac').mkdir()
        def w(i, cls, vpip, typ='faces_human_wager', absent=False, opp='u1'):
            return {'id': i, 'turnKey': 't' + i, 'type': typ, 'class': cls, 'absentLike': absent, 'opponent': opp, 'prior': {'vpip': vpip, 'pfr': 0.09, 'n': 500}, 'match': {'variant': 'nlh', 'mode': 'cash', 'stage': 'preflop'}, 'engineRead': {'style': {'participation': 'neutral'}}, 'proposal': None, 'final': None, 'changes': []}
        W = [w('1', 'tight', 0.17), w('2', 'tight', 0.17, absent=True), w('3', 'ordinary', 0.16, opp='u2'), w('4', 'tight', 0.12, opp='u3'), w('5', 'tight', 0.17, typ='human_live_not_faced')]
        (d / 'tight-maniac/witnesses.jsonl').write_text('\n'.join(json.dumps(x) for x in W))
        rc = {'version': 1, 'consumer': 'range_play', 'baseThreeBetThreshold': 0.7, 'threeBetThreshold': 0.75, 'baseCallThreshold': 0.5, 'callThreshold': 0.5, 'baseFourBetThreshold': None, 'fourBetThreshold': None}
        rows = [{'turnKey': 't1', 'preflopReadReceipt': rc}, {'turnKey': 't4', 'preflopReadReceipt': dict(rc, threeBetThreshold=0.7)}]
        (d / 'witness-rows.jsonl').write_text('\n'.join(json.dumps(x) for x in rows))
        p = subprocess.run([sys.executable, str(TOOL), str(d), str(d / 'o.json')], capture_output=True, text=True); assert p.returncode == 0, p.stderr
        R = json.loads((d / 'o.json').read_text()); t, b = R['tightFaced'], R['nearTightBand']
        checks = [t['n'] == 3, t['counting'] == 2, t['withReceipt'] == 2, t['receiptMovedBar'] == 1, b['n'] == 3, b['humans'] == 2, all(r['opponent'] != 'u1' for r in R['tightFacedRows']),
                  subprocess.run([sys.executable, str(TOOL), str(d), str(d / 'o.json')], capture_output=True).returncode != 0]
        assert all(checks), checks
    finally:
        shutil.rmtree(d)
    print('test_near_tight: %d checks pass' % len(checks))
    return len(checks)

class NearTight(unittest.TestCase):
    def test_archive_checks(self):
        self.assertEqual(main(), 8)

if __name__ == '__main__': main()
