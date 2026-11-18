#!/usr/bin/env python3
# Archive test_window.py (capture-toolkit-v2, toolkit v3), checks unchanged; repository port: imports window.py from the toolkit directory and runs
# under `python3 -m unittest discover -s tests` as well as directly (`python3 tests/test_window.py`).
import os, subprocess, sys, unittest
from datetime import datetime, timezone
TOOLKIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, TOOLKIT); import window as w

def main():
    ok = 0
    def t(name, cond):
        nonlocal ok; assert cond, name; ok += 1
    NOW = datetime(2026, 11, 15, 14, 0, tzinfo=timezone.utc)
    t('regression: 10:15Z is 1794737700, not the 08:15Z value 1794730500', w.epochs('2026-11-15T09:00:00Z', '2026-11-15T10:15:00Z', NOW)[1] == 1794737700)
    t('announcement epoch matches custodian receipt 1794748404630 ms', int(w.parse('2026-11-15T13:13:24.630Z').timestamp() * 1000) == 1794748404630)
    t('boundary 54c9aac8', w.boundary('2026-11-15T10:00:17Z', '2026-11-15T13:13:24.630Z') == ('2026-11-15T10:01:00Z', '2026-11-15T13:13:00Z'))
    t('boundary a7965514 (announcement 09:58:00Z exact minute -> 09:57:00Z)', w.boundary('2026-11-14T22:10:00Z', '2026-11-15T09:58:00Z')[1] == '2026-11-15T09:57:00Z')
    for bad in ['2026-11-15 10:15:00', '2026-11-15T10:15:00', '1794737700', '2026-11-15T10:15:00+00:00']:
        try: w.parse(bad); t('bad accepted ' + bad, False)
        except SystemExit: t('refused ' + bad, True)
    for a, b in [('2026-11-15T10:00:00Z', '2026-11-15T10:00:00Z'), ('2026-11-15T11:00:00Z', '2026-11-15T10:00:00Z'), ('2026-11-13T00:00:00Z', '2026-11-15T01:00:00Z'), ('2026-11-17T12:00:00Z', '2026-11-17T15:00:00Z')]:
        try: w.epochs(a, b, NOW); t('bad range accepted', False)
        except SystemExit: t('refused range', True)
    r = subprocess.run([sys.executable, os.path.join(TOOLKIT, 'window.py'), 'iso', '1794730500'], capture_output=True, text=True)
    t('cli iso shows the old mistake for what it was', r.stdout.strip() == '2026-11-15T08:15:00Z')
    print('test_window: %d checks pass' % ok)
    return ok

class Window(unittest.TestCase):
    def test_archive_checks(self):
        self.assertEqual(main(), 13)

if __name__ == '__main__': main()
