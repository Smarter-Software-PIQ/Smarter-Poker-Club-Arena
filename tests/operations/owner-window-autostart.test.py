"""An open owner window starts its own cutover, and only when it may."""
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('selector', ROOT / 'scripts/ci/select-daily-engine.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

OWNER = 'finite-owner-window'
CONTROL, CANDIDATE, SERVING, ORDERED = 'c' * 40, 'a' * 40, 'e' * 40, 'd' * 40
NOT_BEFORE, NOT_AFTER = mod.epoch('2026-11-10T18:20:00Z'), mod.epoch('2026-11-11T00:20:00Z')
READY = int(mod.epoch('2026-11-10T19:10:00Z'))  # :10:00, inside the band
FLOOR = {'schema': 'engine-release-activation-floor/v2-owner-window', 'ownerWindowId': OWNER,
         'activationAt': '2026-11-10T18:20:00Z', 'expiresAt': '2026-11-11T00:20:00Z'}
WINDOW = {'id': OWNER, 'contains': ORDERED, 'playerNoticeAt': '2026-11-10T18:00:00Z',
          'notBefore': '2026-11-10T18:20:00Z', 'notAfter': '2026-11-11T00:20:00Z'}


class World:
    """GitHub, git and the public surfaces, as the decision reads them."""
    def __init__(self, **changes):
        self.now = READY
        self.attempts = []
        self.receivers = []
        self.selected = True
        self.evidence_at = '2026-11-10T19:00:00Z'
        self.sealed = False
        self.notice_live = True
        self.admitted = True
        self.window = WINDOW
        self.__dict__.update(changes)

    def git(self, *args):
        if args[:2] == ('show', CONTROL + ':server/release/activation-floor.json'):
            return json.dumps(FLOOR)
        if args[:2] == ('show', CONTROL + ':server/release/owner-maintenance-windows.json'):
            return json.dumps({'windows': [self.window]})
        if args[0] == 'show' and args[1].endswith(':' + mod.NOTICES):
            row = {'id': OWNER, 'noticeAt': self.window['playerNoticeAt'], 'notBefore': self.window['notBefore'],
                   'notAfter': self.window['notAfter']}
            return json.dumps({'notices': [row] if self.notice_live else []})
        raise AssertionError(args)

    def api(self, path):
        if 'publish-club-arena.yml/runs' in path:
            return {'workflow_runs': [{'id': 5, 'run_attempt': 1, 'head_sha': 'b' * 40}]}
        if path.startswith('repos/o/r/actions/runs/5/'):
            return {'jobs': [{'name': mod.PUBLISH_JOB, 'conclusion': 'success', 'completed_at': '2026-11-10T18:05:00Z'}]}
        if 'stage-engine-release.yml/runs' in path:
            return {'total_count': len(self.attempts), 'workflow_runs': self.attempts}
        if 'auto-deploy-hetzner.yml/runs' in path:
            return {'workflow_runs': self.receivers}
        raise AssertionError(path)

    def fetch(self, url):
        return {'ca_sha': 'b' * 40} if url == mod.PUBLIC_BUILD_INFO else {'releaseSha': SERVING}

    def select(self, args, report):
        assert (args.control, args.serving, args.owner_window) == (CONTROL, SERVING, OWNER)
        if self.selected:
            report.update(outcome='selected', targetSha=CANDIDATE,
                          backup={'runId': 70, 'certifiedAt': self.evidence_at},
                          qualification={'qualificationRunId': 71, 'completedAt': '2026-11-10T18:30:00Z'})
        else:
            report['deferredCandidates'].append({'sha': CANDIDATE, 'reason': 'prequalification unavailable'})

    def decide(self):
        with (patch.object(mod.clock, 'time', return_value=self.now),
              patch.object(mod, 'git', side_effect=self.git),
              patch.object(mod, 'api', side_effect=self.api),
              patch.object(mod, 'fetch_json', side_effect=self.fetch),
              patch.object(mod, 'contains', side_effect=lambda a, b: self.sealed),
              patch.object(mod, 'owner_admission', side_effect=lambda c, o, n: None if self.admitted else 'expired'),
              patch.object(mod, 'select', side_effect=self.select)):
            return mod.owner_start(types.SimpleNamespace(repo='o/r', control=CONTROL))


class OwnerWindowStartsItself(unittest.TestCase):
    def test_starts_when_every_condition_holds(self):
        decision = World().decide()
        self.assertTrue(decision['start'], decision)
        self.assertEqual((decision['ownerWindowId'], decision['candidateSha']), (OWNER, CANDIDATE))

    def test_never_starts_early_late_outside_the_band_or_without_a_candidate(self):
        cases = {
            'before notBefore': (World(now=int(NOT_BEFORE) - 60), 'has not opened'),
            'after notAfter': (World(now=int(NOT_AFTER)), 'has closed'),
            'too late to fit 420 s': (World(now=int(NOT_AFTER) - 400), 'no longer fit'),
            'at :03 of the hour': (World(now=READY - 7 * 60), 'outside :05:30-:49:00'),
            'at :50 of the hour': (World(now=READY + 40 * 60), 'outside :05:30-:49:00'),
            'notice public for less than 20 minutes': (World(window=dict(WINDOW, playerNoticeAt='2026-11-10T18:55:00Z')),
                                                       'not been public for its required lead'),
            'served client lacks the notice': (World(notice_live=False), 'does not carry the booked notice'),
            'protected admission refuses': (World(admitted=False), 'protected owner admission refuses'),
            'no qualified candidate': (World(selected=False), 'no protected candidate'),
            'a receiver is already running': (World(receivers=[{'status': 'in_progress', 'display_title': 'Engine Release x'}]),
                                              'receiver is already running'),
        }
        for name, (world, reason) in cases.items():
            with self.subTest(name):
                decision = world.decide()
                self.assertFalse(decision['start'], decision)
                self.assertIn(reason, decision['reason'])

    def test_notice_lead_is_the_required_twenty_minutes(self):
        self.assertEqual(mod.OWNER_NOTICE_LEAD_SECONDS, 20 * 60)
        self.assertTrue(World(window=dict(WINDOW, playerNoticeAt='2026-11-10T18:50:00Z')).decide()['start'])
        self.assertFalse(World(window=dict(WINDOW, playerNoticeAt='2026-11-10T18:50:01Z')).decide()['start'])

    def test_reattempts_only_on_new_evidence(self):
        previous = [{'id': 9, 'status': 'completed', 'created_at': '2026-11-10T19:05:00Z',
                     'display_title': mod.OWNER_TITLE + OWNER}]
        stale = World(attempts=previous, evidence_at='2026-11-10T19:00:00Z').decide()
        self.assertFalse(stale['start'])
        self.assertIn('no new qualifying evidence', stale['reason'])
        fresh = World(attempts=previous, evidence_at='2026-11-10T19:08:00Z').decide()
        self.assertTrue(fresh['start'], fresh)
        running = World(attempts=[dict(previous[0], status='in_progress')], evidence_at='2026-11-10T19:08:00Z').decide()
        self.assertFalse(running['start'])

    def test_no_second_release_after_the_window_sealed(self):
        decision = World(sealed=True, evidence_at='2026-11-10T19:08:00Z').decide()
        self.assertFalse(decision['start'])
        self.assertIn('already has its release serving', decision['reason'])

    def test_no_booked_owner_window_starts_nothing(self):
        world = World()
        daily = {'schema': 'engine-release-activation-floor/v1'}
        original = world.git
        world.git = lambda *a: json.dumps(daily) if a[1].endswith('activation-floor.json') else original(*a)
        self.assertEqual(world.decide()['reason'], 'no owner window is booked')

    def test_unreadable_surface_never_starts(self):
        world = World()
        world.fetch = lambda url: (_ for _ in ()).throw(mod.subprocess.CalledProcessError(22, 'curl'))
        decision = world.decide()
        self.assertFalse(decision['start'])
        self.assertIn('unreadable', decision['reason'])


if __name__ == '__main__':
    unittest.main()
