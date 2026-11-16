#!/usr/bin/env python3
# Archive test_plo6_maniac_price.py (capture-toolkit-v2, v2 two sets), checks unchanged; repository port: plo6_maniac_price.py from the toolkit directory,
# scratch under HVH_TEST_TMP (default: the system temporary directory) and always removed; runs under unittest discover and directly.
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
TOOL = Path(__file__).resolve().parents[1] / 'plo6_maniac_price.py'

def main():
    d = Path(tempfile.mkdtemp(dir=os.environ.get('HVH_TEST_TMP') or None))
    try:
        base = {'release': 'r', 'hand': 'h1', 'eventId': 'e', 'horse': 'H1', 'variant': 'plo6', 'mode': 'cash', 'stage': 'preflop', 'toCall': 3, 'pot': 4.5, 'stack': 100, 'legal': ['fold', 'call', 'raise'], 'vpipFloor': 0.2,
                'streetAggressions': 1, 'lastAggressor': {'userId': 'P1', 'human': True, 'action': 'raise', 'allIn': False}, 'engineInput': {'perHuman': {'P1': {'read': {'presumed': False, 'maniacRaiseWidth': 0.6, 'read': True}}}},
                'proposal': {'action': 'fold'}, 'final': {'action': 'call'}, 'changes': [{'node': 'variant_policy'}], 'execution': {'status': 'intended', 'action': 'call'}}
        W = ['maniac_raise_width']
        R = [dict(base, turnKey='t1', preflopReadReceipt={'consumer': 'maniac_price', 'maniacWidth': 0.6, 'layers': ['x']}),
             dict(base, turnKey='t2', preflopReadReceipt={'consumer': 'range_play'}), dict(base, turnKey='t3', variant='plo5', preflopReadReceipt={'consumer': 'maniac_price'}),
             dict(base, turnKey='t4', mode='tournament', preflopReadReceipt={'consumer': 'maniac_price'}), dict(base, turnKey='t5', stage='flop', preflopReadReceipt={'consumer': 'maniac_price'}),
             # set (b): range_play with maniac_raise_width
             dict(base, turnKey='b1', streetAggressions=2, preflopReadReceipt={'consumer': 'range_play', 'layers': W}),                 # 2 raises, 3% of stack: candidate
             dict(base, turnKey='b2', toCall=30, preflopReadReceipt={'consumer': 'range_play', 'layers': W}),                            # 30% of stack, 1 raise: candidate
             dict(base, turnKey='b3', toCall=45, streetAggressions=3, preflopReadReceipt={'consumer': 'range_play', 'layers': W}),       # 45% >= 40%: not
             dict(base, turnKey='b4', streetAggressions=2, lastAggressor={'userId': 'H9', 'human': False, 'action': 'raise', 'allIn': True}, preflopReadReceipt={'consumer': 'range_play', 'layers': W}),  # all in: not
             dict(base, turnKey='b5', preflopReadReceipt={'consumer': 'range_play', 'layers': W}),                                      # 1 raise, 3%: not
             dict(base, turnKey='b6', streetAggressions=None, preflopReadReceipt={'consumer': 'range_play', 'layers': W}),               # unknown gate
             dict(base, turnKey='b7', toCall=25, preflopReadReceipt={'consumer': 'range_play', 'layers': W}),                            # exactly 25%: candidate
             dict(base, turnKey='b8', toCall=40, streetAggressions=2, preflopReadReceipt={'consumer': 'range_play', 'layers': W}),       # exactly 40%: not
             dict(base, turnKey='b9', variant='plo5', streetAggressions=2, preflopReadReceipt={'consumer': 'range_play', 'layers': W})]  # plo5: not six-card
        (d / 'w.jsonl').write_text('\n'.join(json.dumps(x) for x in R) + '\n{"summary":{"hands":1}}\n')
        p = subprocess.run([sys.executable, str(TOOL), str(d / 'w.jsonl'), 'I', str(d / 'o.json')], capture_output=True, text=True); assert p.returncode == 0, p.stderr
        o = json.loads((d / 'o.json').read_text()); a = o['a_maniacPrice']; r = a['rows'][0]; b = o['b_handOffCandidates']
        p2 = subprocess.run([sys.executable, str(TOOL), str(d / 'w.jsonl'), 'I', str(d / 'o.json')], capture_output=True, text=True)
        c = [a['n'] == 1, o['plo6CashPreflopDecisions'] == 10, r['raiser']['who'] == 'person', r['raiser']['id'] != 'P1', r['horse'] != 'H1', r['raiser']['read']['maniacRaiseWidth'] == 0.6,
             r['executedEqualsFinal'] is True, r['changedNodes'] == ['variant_policy'], 'cards' not in json.dumps(o),
             b['rangePlayWithManiacWidth'] == 8, sorted(x['turnKey'] for x in b['rows']) == ['b1', 'b2', 'b7'], b['gateUnknown'] == 1, b['byRaiser'] == {'person': 3}, 'candidates only' in b['confirmed'],
             p2.returncode != 0 and 'refused' in (p2.stderr + p2.stdout)]
        assert all(c), c
    finally:
        shutil.rmtree(d)
    print('test_plo6_maniac_price: %d checks pass' % len(c))
    return len(c)

class Plo6ManiacPrice(unittest.TestCase):
    def test_archive_checks(self):
        self.assertEqual(main(), 15)

if __name__ == '__main__': main()
