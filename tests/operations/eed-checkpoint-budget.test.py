#!/usr/bin/env python3
"""Execute maintained EED allocation, admission and deadline arithmetic, without host I/O."""
import json
import os
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
EED = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'


def function(name, next_name=None):
    start = SOURCE.index(name + '() {')
    if next_name:
        return SOURCE[start:SOURCE.index(next_name + '() {', start)]
    end = SOURCE.index('\n}\n', start) + 3
    return SOURCE[start:end]


def shell(program):
    return subprocess.run(['bash', '-c', 'set -eu\n' + program], text=True,
                          capture_output=True, timeout=5)


class Allocation(unittest.TestCase):
    def profile(self, predecessor):
        # Actual source initial values, with no production script preamble run.
        constants = '\n'.join(re.findall(
            r'^(?:CHECKPOINT_EED_SHA|BREAK_CUTOVER_PROOF_SECONDS|BREAK_ROLLBACK_RESERVE_SECONDS|BREAK_DEADLINE_SLACK_SECONDS|BREAK_WINDOW_MS)=[^\n]+',
            SOURCE, re.M))
        p = shell(constants + '\nMIN_BREAK_REMAINING_MS=285000\n'
                  'die() { echo "$*" >&2; exit 1; }\n' + function('select_legacy_checkpoint_budget') +
                  '\nselect_legacy_checkpoint_budget ' + predecessor +
                  '\nprintf "%s %s %s %s %s %s\\n" "$LEGACY_CHECKPOINT_PROFILE" '
                  '"$LEGACY_CHECKPOINT_BUDGET_SECONDS" "$LEGACY_MIN_BREAK_REMAINING_MS" '
                  '"$LEGACY_ENTRY_ALLOWANCE_MS" "$BREAK_ENTRY_BUDGET_CEILING_MS" '
                  '"$BREAK_ROLLBACK_RESERVE_SECONDS"')
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip().split()

    def test_exact_eed_reallocates_only_candidate_opportunity(self):
        self.assertEqual(self.profile(EED), ['eed-80s-v1', '80', '205000', '15000', '0', '135'])
        self.assertEqual(205000 - 135000, 70000)
        self.assertEqual(80000 + 205000, 285000)

    def test_every_other_profile_keeps_original_allocation(self):
        for predecessor in re.findall(r'^CHECKPOINT_(?:758|A0|8825)_SHA=(\w+)', SOURCE, re.M) + ['unknown', EED[:-1]+'0']:
            with self.subTest(predecessor=predecessor):
                self.assertEqual(self.profile(predecessor), ['legacy-40s-v1', '40', '245000', '15000', '0', '135'])

    def test_selection_precedes_notice_and_checkpoint_entry(self):
        selection = SOURCE.index('select_legacy_checkpoint_budget "$CHECKPOINT_PREDECESSOR_SHA"')
        self.assertGreater(selection, SOURCE.index("die 'sealed checkpoint predecessor is unreadable'"))
        self.assertLess(selection, SOURCE.index('if [ "$LEGACY_CHECKPOINT_REQUIRED" = 1 ] && [ "$CHECKPOINT_PREDECESSOR_SHA" = "$CHECKPOINT_EED_SHA" ]; then', selection))
        self.assertIn('MIN_BREAK_REMAINING_MS=$(((BREAK_CUTOVER_PROOF_SECONDS + BREAK_ROLLBACK_RESERVE_SECONDS + BREAK_DEADLINE_SLACK_SECONDS) * 1000))', SOURCE)
        self.assertIn('BREAK_CUTOVER_PROOF_SECONDS=150', SOURCE)
        self.assertIn('BREAK_ROLLBACK_RESERVE_SECONDS=135', SOURCE)

    def test_locked_legacy_change_cannot_reallocate_or_extend_the_entry(self):
        start = SOURCE.index('    CHECKPOINT_PREDECESSOR_SHA="$(legacy_entry_read timeout')
        end = SOURCE.index('\n  fi', start)
        branch = SOURCE[start:end]
        constants = '\n'.join(re.findall(r'^(?:LEGACY_CHECKPOINT_SHA|CHECKPOINT_(?:758|A0|8825|EED)_SHA)=[^\n]+', SOURCE, re.M))
        for selected, locked, expected in [(EED, EED, 0), (EED, '8825af51817f379c4261658ca29ecc9d8d81932d', 19),
                                           ('8825af51817f379c4261658ca29ecc9d8d81932d', EED, 19), (EED, 'newer-nonlegacy', 0)]:
            with self.subTest(selected=selected, locked=locked):
                p = shell(constants + '\nCHECKPOINT_ALLOCATION_PREDECESSOR_SHA=' + selected +
                    '\nLEGACY_CHECKPOINT_REQUIRED=1\nLEGACY_ENTRY_DEADLINE_MS=99999\nRELEASE_SEAL=seal\n'
                    'die() { echo "$*" >&2; exit 19; }\nlegacy_entry_read() { "$@"; }\n'
                    'timeout() { shift 3; "$@"; }\nseal() { echo ' + locked + '; }\n' + branch +
                    '\nprintf "%s %s" "$LEGACY_CHECKPOINT_REQUIRED" "$LEGACY_ENTRY_DEADLINE_MS"')
                self.assertEqual(p.returncode, expected, p.stderr)
                if expected == 0:
                    self.assertEqual(p.stdout, '0 0' if locked == 'newer-nonlegacy' else '1 99999')
                else:
                    self.assertIn('refusing a new checkpoint allocation', p.stderr)

    def test_heap_fit_real_predicate_rounding_unknown_and_new_boundaries(self):
        body = function('legacy_census_fits')
        start = body.index("python3 -c '\n") + len("python3 -c '\n")
        program = body[start:body.index("\n'", start)]
        allowance = re.search(r'^LEGACY_CENSUS_ALLOWANCE_MS=(\d+)', SOURCE, re.M).group(1)
        self.assertEqual(int(allowance), 80000-15000-5000-1000)
        for heap, expected in [(3791, 0), (4915, 0), (4916, 1), (6000, 1), (None, 3), (True, 3), (-1, 3)]:
            with self.subTest(heap=heap):
                p = subprocess.run(['python3', '-c', program], text=True, capture_output=True,
                    input=json.dumps({'releaseSha': EED, 'memory': {'heapUsedMb': heap}}), timeout=5,
                    env={**os.environ, 'EXPECTED_SHA': EED, 'MS_PER_MB': '12', 'ALLOWANCE_MS': allowance})
                self.assertEqual(p.returncode, expected, p.stderr)

    def test_candidate_command_cannot_spend_rollback_even_with_long_request(self):
        helper = function('break_proof_seconds') + '\n' + function('bounded_break_command')
        for remaining, expected in [(205, '68s'), (215, '78s'), (138, '1s')]:
            with self.subTest(remaining=remaining):
                p = shell('BREAK_END_EPOCH=1000\nBREAK_ROLLBACK_RESERVE_SECONDS=135\n'
                    'date() { echo ' + str(1000-remaining) + '; }\n'
                    'remaining_seconds() { echo 1000; }\n'
                    'legacy_entry_read() { "$@"; }\n'
                    'timeout() { printf "%s\\n" "$3"; }\n' + helper + '\nbounded_break_command 150 true')
                self.assertEqual(p.returncode, 0, p.stderr)
                self.assertEqual(p.stdout.strip(), expected)
        p = shell('BREAK_END_EPOCH=1000\nBREAK_ROLLBACK_RESERVE_SECONDS=135\n'
            'date() { echo 863; }\nremaining_seconds() { echo 1000; }\n' + helper + '\nbounded_break_command 150 true')
        self.assertEqual(p.returncode, 124)

    def test_only_exact_retained_guard_uses_smaller_post_checkpoint_floor(self):
        exact = (ROOT/'server/scripts/retained-original-checkpoint-guard.mjs').read_text()
        other = (ROOT/'server/scripts/legacy-engine-checkpoint-guard.mjs').read_text()
        self.assertIn("const release = '" + EED + "';", exact)
        self.assertIn('const reserveMs = 205000;', exact)
        self.assertIn('const reserveMs = 245000;', other)
        self.assertIn("'insufficient maintenance-break budget for final database proof'", SOURCE)
        self.assertIn('[ "$DB_TIMEOUT" -ge 17 ]', SOURCE)


if __name__ == '__main__':
    unittest.main()
