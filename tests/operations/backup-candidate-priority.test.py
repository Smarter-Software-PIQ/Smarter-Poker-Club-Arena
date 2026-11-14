"""The booked candidate goes first: the read-only verdict a Backup push run asks for."""
import importlib.util
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('priority', ROOT / 'scripts/ci/backup-candidate-priority.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

REPO = 'o/r'
OLD, BOOKING, LATER, MAIN = 'a' * 40, 'b' * 40, 'c' * 40, 'd' * 40
SERVING, CONTENT = 'e' * 40, 'f' * 40
OWNER = '2026-11-14-owner-offcycle-engine-0506z'
OPEN, CLOSE = 1794632760, 1794641400  # 2026-11-14T05:06:00Z, 07:30:00Z
BOOKED = ('1' * 40, '2' * 40)
BEFORE = ('3' * 40, '4' * 40)


class World:
    """A fake GitHub and engine: OLD <- BOOKING <- LATER <- MAIN on main."""

    def __init__(self):
        self.floor = {'schema': mod.OWNER_SCHEMA, 'ownerWindowId': OWNER,
                      'activationAt': '2026-11-14T05:06:00Z', 'expiresAt': '2026-11-14T07:30:00Z'}
        self.windows = [{'id': 'older', 'contains': OLD, 'notAfter': '2026-11-13T09:00:00Z'},
                        {'id': OWNER, 'contains': CONTENT, 'notBefore': '2026-11-14T05:06:00Z',
                         'notAfter': '2026-11-14T07:30:00Z'}]
        self.blobs = {OLD: BEFORE, BOOKING: BOOKED, LATER: BOOKED, MAIN: BOOKED}
        self.parents = {BOOKING: OLD, LATER: BOOKING, MAIN: LATER, OLD: '9' * 40}
        self.blobs['9' * 40] = BEFORE
        self.serving = {'releaseSha': SERVING}
        self.relation = 'behind'
        self.broken = None
        self.calls = []

    def api(self, path, raw=False):
        self.calls.append(path)
        if self.broken and re.search(self.broken, path):
            raise mod.Unknown('GitHub read failed')
        if path == f'repos/{REPO}/commits/main':
            return {'sha': MAIN}
        if path == f'repos/{REPO}/contents/server/release/activation-floor.json?ref={MAIN}':
            return self.floor
        if path == f'repos/{REPO}/contents/server/release/owner-maintenance-windows.json?ref={MAIN}':
            return {'version': 1, 'windows': self.windows}
        if path == f'repos/{REPO}/compare/{CONTENT}...{SERVING}':
            return {'status': self.relation}
        match = re.fullmatch(rf'repos/{REPO}/contents/server/release\?ref=([0-9a-f]{{40}})', path)
        if match:
            pair = self.blobs[match[1]]
            return [{'name': 'activation-floor.json', 'type': 'file', 'sha': pair[0]},
                    {'name': 'owner-maintenance-windows.json', 'type': 'file', 'sha': pair[1]},
                    {'name': 'other.json', 'type': 'file', 'sha': '7' * 40}]
        match = re.fullmatch(rf'repos/{REPO}/commits/([0-9a-f]{{40}})', path)
        if match:
            return {'sha': match[1], 'parents': [{'sha': self.parents[match[1]]}]}
        raise AssertionError('unexpected read ' + path)

    def health(self):
        if isinstance(self.serving, Exception):
            raise self.serving
        return self.serving

    def decide(self, sha, now=OPEN - 600):
        return mod.decide(REPO, sha, now, api=self.api, serving=self.health)[0]


class BackupCandidatePriority(unittest.TestCase):
    def test_fixture_clock_matches_the_booked_window(self):
        self.assertEqual(mod.epoch('2026-11-14T05:06:00Z'), OPEN)
        self.assertEqual(mod.epoch('2026-11-14T07:30:00Z'), CLOSE)

    def test_booking_candidate_and_predating_commits_while_the_window_is_upcoming_or_open(self):
        for now in (OPEN - 3000, OPEN, CLOSE - 1):
            world = World()
            self.assertEqual(world.decide(BOOKING, now), 'booking')
            self.assertEqual(world.decide(LATER, now), 'candidate')
            self.assertEqual(world.decide(MAIN, now), 'candidate')
            self.assertEqual(world.decide(OLD, now), 'predates')

    def test_verdict_names_the_window(self):
        self.assertEqual(mod.decide(REPO, BOOKING, OPEN, api=World().api, serving=World().health)[1], OWNER)

    def test_a_later_control_change_moves_the_booking(self):
        # Another lane edits the owner orders after the booking: main's controls
        # are now LATER's, the old booking commit can no longer be selected.
        world = World()
        changed = ('1' * 40, '8' * 40)
        world.blobs.update({LATER: changed, MAIN: changed})
        self.assertEqual(world.decide(BOOKING), 'predates')
        self.assertEqual(world.decide(LATER), 'booking')
        self.assertEqual(world.decide(MAIN), 'candidate')

    def test_expired_window_is_none_and_reads_nothing_more(self):
        for now in (CLOSE, CLOSE + 86400):
            world = World()
            self.assertEqual(world.decide(OLD, now), 'none')
            self.assertEqual(len(world.calls), 2)  # main, then the floor
        world = World()
        world.windows[1]['notAfter'] = '2026-11-14T06:00:00Z'  # closes at the earlier bound
        self.assertEqual(world.decide(OLD, mod.epoch('2026-11-14T06:00:00Z')), 'none')

    def test_no_owner_floor_is_none(self):
        world = World()
        world.floor = {'schema': 'engine-release-activation-floor/v1', 'expiresAt': '2026-11-14T09:05:00Z'}
        self.assertEqual(world.decide(OLD), 'none')

    def test_consumed_window_is_none(self):
        for relation in ('identical', 'ahead'):
            world = World()
            world.relation = relation
            for sha in (OLD, BOOKING, LATER):
                self.assertEqual(world.decide(sha), 'none')

    def test_unreadable_state_is_unknown_never_none_or_predates(self):
        cases = [r'commits/main$', r'activation-floor\.json', r'owner-maintenance-windows\.json',
                 r'/compare/', r'contents/server/release\?ref=' + MAIN, r'contents/server/release\?ref=' + OLD]
        for broken in cases:
            world = World()
            world.broken = broken
            self.assertEqual(world.decide(OLD), 'unknown', broken)
        world = World()
        world.broken = r'/commits/' + BOOKING
        self.assertEqual(world.decide(BOOKING), 'unknown')
        world = World()
        world.broken = r'contents/server/release\?ref=' + OLD
        self.assertEqual(world.decide(BOOKING), 'unknown')  # parent unreadable

    def test_unreadable_engine_or_relation_is_unknown(self):
        for serving in (mod.Unknown('down'), {}, {'releaseSha': 'short'}, ['x']):
            world = World()
            world.serving = serving
            self.assertEqual(world.decide(OLD), 'unknown')
        for relation in (None, '', 'unreadable'):
            world = World()
            world.relation = relation
            self.assertEqual(world.decide(OLD), 'unknown')

    def test_malformed_orders_are_unknown(self):
        world = World()
        world.windows.append(dict(world.windows[1]))  # two entries with the id
        self.assertEqual(world.decide(OLD), 'unknown')
        world = World()
        world.windows.pop()
        self.assertEqual(world.decide(OLD), 'unknown')
        world = World()
        world.floor['expiresAt'] = 'soon'
        self.assertEqual(world.decide(OLD), 'unknown')
        world = World()
        world.windows[1]['contains'] = 'main'
        self.assertEqual(world.decide(OLD), 'unknown')
        world = World()
        world.blobs[MAIN] = ('1' * 40, None)
        self.assertEqual(world.decide(OLD), 'unknown')
        self.assertEqual(mod.decide(REPO, 'main', OPEN, api=World().api, serving=World().health)[0], 'unknown')

    def test_reader_only_reads(self):
        source = (ROOT / 'scripts/ci/backup-candidate-priority.py').read_text()
        self.assertNotRegex(source, r"""--method|'-X'|'-f'|'-F'|--input|dispatches|statuses/""")
        # The rules are the release route's own.
        ready = (ROOT / 'scripts/ci/owner-window-ready.py').read_text()
        self.assertIn("closes = min(epoch(window['notAfter']), epoch(floor['expiresAt']))", ready)
        self.assertIn("if contains(window['contains'], serving):", ready)
        floor = (ROOT / 'server/scripts/engine-release-activation-floor.py').read_text()
        self.assertIn("raise ValueError('control owner authorization differs')", floor)
        self.assertIn("raise ValueError('control and target activation policies differ')", floor)


if __name__ == '__main__':
    unittest.main()
