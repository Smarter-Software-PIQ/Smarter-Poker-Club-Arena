"""An open owner window tells its release owner once per evidence, and starts nothing."""
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('owner_window_ready', ROOT / 'scripts/ci/owner-window-ready.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

OWNER = 'finite-owner-window'
CONTROL, CANDIDATE, SERVING, ORDERED = 'c' * 40, 'a' * 40, 'e' * 40, 'd' * 40
NOT_BEFORE, NOT_AFTER = mod.epoch('2026-11-10T18:20:00Z'), mod.epoch('2026-11-11T00:20:00Z')
READY = int(mod.epoch('2026-11-10T19:10:00Z'))
FLOOR = {'schema': 'engine-release-activation-floor/v2-owner-window', 'ownerWindowId': OWNER,
         'activationAt': '2026-11-10T18:20:00Z', 'expiresAt': '2026-11-11T00:20:00Z'}
WINDOW = {'id': OWNER, 'contains': ORDERED, 'playerNoticeAt': '2026-11-10T18:00:00Z',
          'notBefore': '2026-11-10T18:20:00Z', 'notAfter': '2026-11-11T00:20:00Z'}
KEY = f'{OWNER}:{CANDIDATE}:70:71'


class World:
    """GitHub, git and the public surfaces, as the decision reads them."""
    def __init__(self, **changes):
        self.now = READY
        self.selections = []
        self.receivers = []
        self.issues = []
        self.comments = {}
        self.selected = True
        self.sealed = False
        self.notice_live = True
        self.admitted = True
        self.window = WINDOW
        self.paths = []
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
        self.paths.append(path)
        if 'publish-club-arena.yml/runs' in path:
            return {'workflow_runs': [{'id': 5, 'run_attempt': 1, 'head_sha': 'b' * 40}]}
        if path.startswith('repos/o/r/actions/runs/5/'):
            return {'jobs': [{'name': mod.PUBLISH_JOB, 'conclusion': 'success', 'completed_at': '2026-11-10T18:05:00Z'}]}
        if 'stage-engine-release.yml/runs' in path:
            return {'total_count': len(self.selections), 'workflow_runs': self.selections}
        if 'auto-deploy-hetzner.yml/runs' in path:
            return {'workflow_runs': self.receivers}
        if path.startswith('repos/o/r/issues?'):
            return self.issues
        if '/comments' in path:
            return self.comments.get(int(path.split('/')[4]), [])
        raise AssertionError(path)

    def fetch(self, url):
        return {'ca_sha': 'b' * 40} if url == mod.PUBLIC_BUILD_INFO else {'releaseSha': SERVING}

    def select(self, args, report):
        assert (args.control, args.serving, args.owner_window) == (CONTROL, SERVING, OWNER)
        if self.selected:
            report.update(outcome='selected', targetSha=CANDIDATE, backup={'runId': 70, 'certifiedAt': '2026-11-10T19:00:00Z'},
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
              patch.object(mod.selector, 'select', side_effect=self.select)):
            return mod.decide(types.SimpleNamespace(repo='o/r', control=CONTROL))


def issue(number, state='open', body='', comments=0):
    return {'number': number, 'state': state, 'title': mod.ISSUE_TITLE.format(OWNER), 'body': body, 'comments': comments}


class OwnerWindowOnlyNotifies(unittest.TestCase):
    def test_tells_the_owner_when_every_condition_holds(self):
        world = World()
        decision = world.decide()
        self.assertTrue(decision['notify'], decision)
        self.assertIsNone(decision['issue'])
        self.assertIn(mod.MARKER.format(KEY), decision['body'])
        self.assertIn('Nothing has been started', decision['body'])
        self.assertNotIn('start', decision)
        self.assertFalse(any('dispatches' in p or 'rerun' in p or 'cancel' in p for p in world.paths))

    def test_tells_nobody_early_late_or_without_a_candidate(self):
        cases = {
            'before notBefore': (World(now=int(NOT_BEFORE) - 60), 'has not opened'),
            'after notAfter': (World(now=int(NOT_AFTER)), 'has closed'),
            'too late to fit 420 s': (World(now=int(NOT_AFTER) - 400), 'no longer fit'),
            'notice public for less than 20 minutes': (World(window=dict(WINDOW, playerNoticeAt='2026-11-10T18:55:00Z')),
                                                       'not been public for its required lead'),
            'served client lacks the notice': (World(notice_live=False), 'does not carry the booked notice'),
            'protected admission refuses': (World(admitted=False), 'protected owner admission refuses'),
            'no qualified candidate': (World(selected=False), 'no protected candidate'),
            'window already sealed': (World(sealed=True), 'already has its release serving'),
            'owner selection running': (World(selections=[{'status': 'in_progress', 'display_title': mod.OWNER_TITLE + OWNER}]),
                                        'already running'),
            'receiver running': (World(receivers=[{'status': 'in_progress', 'display_title': 'Engine Release x'}]),
                                 'receiver is already running'),
        }
        for name, (world, reason) in cases.items():
            with self.subTest(name):
                decision = world.decide()
                self.assertFalse(decision['notify'], decision)
                self.assertIn(reason, decision['reason'])

    def test_once_per_evidence_on_the_open_issue(self):
        told = World(issues=[issue(12, comments=1)], comments={12: [{'body': mod.MARKER.format(KEY)}]}).decide()
        self.assertFalse(told['notify'])
        self.assertIn('already told', told['reason'])
        closed = World(issues=[issue(11, state='closed', body=mod.MARKER.format(KEY))]).decide()
        self.assertFalse(closed['notify'])
        fresh = World(issues=[issue(12, body=mod.MARKER.format(f'{OWNER}:{CANDIDATE}:60:71'))]).decide()
        self.assertTrue(fresh['notify'], fresh)
        self.assertEqual(fresh['issue'], 12)

    def test_unreadable_surface_tells_nobody(self):
        world = World()
        world.fetch = lambda url: (_ for _ in ()).throw(mod.subprocess.CalledProcessError(22, 'curl'))
        decision = world.decide()
        self.assertFalse(decision['notify'])
        self.assertIn('unreadable', decision['reason'])


if __name__ == '__main__':
    unittest.main()
