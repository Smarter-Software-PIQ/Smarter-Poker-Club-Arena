#!/usr/bin/env python3
"""Native Git/source admission tests; no host, Docker, or production calls."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
# Hang guard only for fixture subprocesses whose assertions never depend on
# host speed. (The one wall-clock case keeps its own bounded `timeout=8`.)
HANG_GUARD_SECONDS = 120
BASH = '/opt/homebrew/bin/bash' if Path('/opt/homebrew/bin/bash').exists() else 'bash'
HELPER = 'server/scripts/engine-release-activation-floor.py'
MANIFEST = 'server/release/activation-floor.json'
DAILY = {'schema': 'engine-release-activation-floor/v1', 'preparationAt': '2026-10-30T08:30:00Z', 'activationAt': '2026-10-30T09:00:00Z', 'expiresAt': '2026-10-30T09:05:00Z', 'timeZone': 'America/Chicago'}
# DAILY has expired (2026-10-30 04:00 Chicago is history). Since 2026-10-30 an
# expired floor reads as NO floor on every fresh admission, so tests that drive
# the real clock through a floor that must still hold use this future one.
FUTURE_DAILY = {'schema': 'engine-release-activation-floor/v1', 'preparationAt': '2027-07-15T08:30:00Z', 'activationAt': '2027-07-15T09:00:00Z', 'expiresAt': '2027-07-15T09:05:00Z', 'timeZone': 'America/Chicago'}
INTAKE = 'server/scripts/engine-release-intake.sh'
spec = importlib.util.spec_from_file_location('floor', ROOT / HELPER)
floor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(floor)


class ActivationFloor(unittest.TestCase):
    def setUp(self):
        environment = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        environment.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
        patcher = patch.dict(os.environ, environment, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        # The caller supplies TMPDIR on the external SSD on macOS.
        self.temp = tempfile.TemporaryDirectory(prefix='activation-floor-')
        self.addCleanup(self.temp.cleanup)
        # Resolved: engine-release-recover.sh names its control dir by pwd -P, and
        # on macOS the temp root is a /var -> /private/var link (no-op on Linux).
        self.repo = Path(self.temp.name).resolve()
        self.git('init', '-q')
        self.git('config', 'core.hooksPath', str(self.repo / 'no-hooks'))
        self.git('config', 'user.name', 'Isolated fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        for name in (HELPER, MANIFEST, INTAKE, 'server/scripts/engine-release-transaction.sh', 'server/scripts/engine-release-recover.sh'):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((ROOT / name).read_bytes())
        (self.repo / MANIFEST).write_text(json.dumps(DAILY))
        installer = self.repo / 'server/scripts/install-engine-supervisor.sh'
        installer.write_text('#!/usr/bin/env bash\nprintf installed > "$FIXTURE_MARKER"\n')
        installer.chmod(0o755)
        self.sha = self.commit()
        self.record = floor.policy(str(self.repo), self.sha, self.sha)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True).strip()

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture', '--allow-empty')
        sha = self.git('rev-parse', 'HEAD')
        self.git('update-ref', 'refs/remotes/origin/main', sha)
        return sha

    def future_record(self):
        (self.repo / MANIFEST).write_text(json.dumps(FUTURE_DAILY))
        self.sha = self.commit()
        return floor.policy(str(self.repo), self.sha, self.sha)

    @staticmethod
    def historical_floor(window_id):
        # The exact floor bytes a historical window's witness bound: same key
        # order and formatting as every committed floor.
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        window = next(w for w in windows['windows'] if w['id'] == window_id)
        doc = {'schema': floor.OWNER_CAPABILITY, 'preparationAt': window['notBefore'],
               'activationAt': window['notBefore'], 'expiresAt': window['notAfter'],
               'timeZone': 'America/Chicago', 'ownerWindowId': window_id,
               'clientPublicationAt': window['notBefore']}
        return window, (json.dumps(doc, indent=2) + '\n').encode()

    def owner_record(self, legacy=False, window_id='2026-11-04-tournament-immediate-relaunch-continuation'):
        source = json.loads((ROOT / MANIFEST).read_text())
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        if window_id is None:
            window = next(w for w in windows['windows'] if w['id'] == source['ownerWindowId'])
            raw = (ROOT / MANIFEST).read_bytes()
        else:
            window, raw = self.historical_floor(window_id)
        window['contains'] = self.sha
        if legacy:
            window.pop('supersedesPhase1Schedule', None)
        (self.repo / MANIFEST).write_bytes(raw)
        (self.repo / 'server/release/owner-maintenance-windows.json').write_text(json.dumps({'version': 1, 'windows': [window]}))
        self.sha = self.commit()
        return floor.policy(str(self.repo), self.sha, self.sha)

    def test_changed_owner_history_only_falls_through_after_both_exact_orders_expire(self):
        from datetime import datetime
        stamp = lambda value: int(datetime.fromisoformat(value).timestamp())
        start = stamp('2026-10-31T09:00:00+00:00')
        next_cutoff = stamp('2026-11-01T09:30:00+00:00')
        self.assertEqual(floor.daily_assessment_epoch(start, 0), next_cutoff)
        self.assertEqual(floor.daily_assessment_epoch(next_cutoff + 60, next_cutoff), next_cutoff)
        with self.assertRaisesRegex(ValueError, 'exact Chicago'):
            floor.daily_assessment_epoch(next_cutoff, next_cutoff + 60)
        record = self.owner_record()
        target = self.sha
        path = self.repo / 'server/release/owner-maintenance-windows.json'
        history = json.loads(path.read_text())
        history['windows'].append({'id': 'archived-unrelated-order'})
        path.write_text(json.dumps(history))
        control = self.commit()
        for fresh_at in (None, record['expiresEpoch'] - 1):
            with self.assertRaisesRegex(ValueError, 'control owner authorization differs'):
                floor.policy(str(self.repo), target, control, fresh_at=fresh_at)
        self.assertEqual(floor.policy(str(self.repo), target, control, fresh_at=record['expiresEpoch'])['targetSha'], target)
        (self.repo / MANIFEST).write_text(json.dumps(FUTURE_DAILY))
        future = self.commit()
        with self.assertRaisesRegex(ValueError, 'control owner authorization differs'):
            floor.policy(str(self.repo), target, future, fresh_at=record['expiresEpoch'])

    def test_nov7_exception_binds_the_exact_order_and_current_deadline(self):
        window, raw = self.historical_floor(floor.NOV7_OWNER_ID)
        path = self.repo / 'server/release/owner-maintenance-windows.json'
        path.write_text(json.dumps({'version': 1, 'windows': [window]}))
        target = self.commit()
        from datetime import datetime
        import hashlib
        start, end = (int(datetime.fromisoformat(window[k].replace('Z', '+00:00')).timestamp())
                      for k in ('notBefore', 'notAfter'))
        record = dict(schema=floor.OWNER_CAPABILITY, ownerWindowId=window['id'],
                      manifestSha256=hashlib.sha256(raw).hexdigest(), targetSha=target,
                      activationEpoch=start, expiresEpoch=end)
        floor.nov7_owner(str(self.repo), record, start, end)
        floor.nov7_owner(str(self.repo), record, end-1, end)
        for now, deadline, changes in ((start-1, end, {}), (end, end+1, {}),
                                       (start, start, {}), (start, end, {'ownerWindowId': 'old-window'}),
                                       (start, end, {'manifestSha256': '0'*64})):
            with self.assertRaises(ValueError):
                floor.nov7_owner(str(self.repo), dict(record, **changes), now, deadline)
        window['contains'] = target
        path.write_text(json.dumps({'version': 1, 'windows': [window]}))
        with self.assertRaisesRegex(ValueError, 'owner order differs'):
            floor.nov7_owner(str(self.repo), dict(record, targetSha=self.commit()), start, end)

    def test_current_owner_reservation_reaches_countdown_and_refuses_replay(self):
        # Execute the real seal reservation and countdown consumer against a
        # disposable state directory. Existing policy tests cover protected Git;
        # route its subprocess authority boundary through the actual pinned judge.
        import argparse, contextlib, io, sys
        from datetime import datetime
        spec = importlib.util.spec_from_file_location('current_owner_seal', ROOT / 'server/scripts/engine-release-seal.py')
        seal = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = seal
        spec.loader.exec_module(seal)
        window, raw = self.historical_floor(floor.NOV7_OWNER_ID)
        (self.repo / 'server/release/owner-maintenance-windows.json').write_text(json.dumps({'version': 1, 'windows': [window]}))
        target = self.commit()
        start, end = [int(datetime.fromisoformat(window[k].replace('Z', '+00:00')).timestamp()) for k in ('notBefore', 'notAfter')]
        record = dict(schema=floor.OWNER_CAPABILITY, ownerWindowId=window['id'],
                      manifestSha256=__import__('hashlib').sha256(raw).hexdigest(), targetSha=target,
                      activationEpoch=start, expiresEpoch=end)
        stamp = int(datetime.fromisoformat('2026-11-12T17:10:00+00:00').timestamp()) * 1000
        state = {'pending': None, 'finalization': None, 'desired': {'sha': seal.NOV7_PREDECESSOR}, 'highWaterSha': seal.NOV7_PREDECESSOR}
        args = argparse.Namespace(sha=target, run_id='650-1', repo=str(self.repo), cause='urgent',
                 control_sha=target, deadline=end, nov7_owner=True, scheduled_cycle_start=None,
                 certified_policy=None, predecessor_sha=None, include_eligibility=True)
        real_run = subprocess.run
        def authority(command, **kwargs):
            if command[0] == 'git': return real_run(command, **kwargs)
            self.assertEqual(command[3], 'nov7-owner')
            self.assertIn(target, command)
            floor.nov7_owner(str(self.repo), record, int(seal.time.time()), args.deadline)
            return subprocess.CompletedProcess(command, 0)
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(seal, 'STATE_DIR', self.repo))
            stack.enter_context(patch.object(seal, 'SealLock', contextlib.nullcontext))
            stack.enter_context(patch.object(seal, 'load_state', return_value=state))
            stack.enter_context(patch.object(seal, 'git_is_ancestor'))
            stack.enter_context(patch.object(seal, 'recovery_window_eligibility', return_value=('', 0)))
            stack.enter_context(patch.object(seal, 'certified_recovery_request', return_value=None))
            stack.enter_context(patch.object(seal, 'audit_once'))
            stack.enter_context(patch.object(seal.subprocess, 'run', side_effect=authority))
            stack.enter_context(patch.object(seal.time, 'time', return_value=stamp/1000))
            old_claim = self.repo / 'engine-release-owner-2026-11-10-owner-asap-engine-0650z.json'
            old_claim.write_text('consumed historical claim')
            receipt_claim = self.repo / 'engine-release-owner-2026-11-11-horse-clock-receipts-engine-0050z.json'
            receipt_claim.write_text('consumed receipt claim')
            clone_claim = self.repo / 'engine-release-owner-2026-11-11-horse-clock-clone-engine-0650z.json'
            clone_claim.write_text('consumed clone claim')
            realtime_claim = self.repo / 'engine-release-owner-2026-11-11-horse-realtime-10454-engine-1930z.json'
            realtime_claim.write_text('expired realtime claim')
            corrections_claim = self.repo / 'engine-release-owner-2026-11-12-horse-corrections-10525-engine-0030z.json'
            corrections_claim.write_text('expired corrections claim')
            out = io.StringIO()
            with contextlib.redirect_stdout(out): seal.cmd_reserve_recovery_window(args)
            self.assertEqual(out.getvalue().strip(), str(stamp))
            self.assertEqual(seal.NOV7_OWNER_CLAIM, 'engine-release-owner-' + floor.NOV7_OWNER_ID + '.json')
            claim = json.loads((self.repo / seal.NOV7_OWNER_CLAIM).read_text())
            self.assertEqual(claim, seal.nov7_claim(args.run_id, target, target, stamp))
            self.assertEqual(old_claim.read_text(), 'consumed historical claim')
            self.assertEqual(receipt_claim.read_text(), 'consumed receipt claim')
            self.assertEqual(clone_claim.read_text(), 'consumed clone claim')
            self.assertEqual(realtime_claim.read_text(), 'expired realtime claim')
            self.assertEqual(corrections_claim.read_text(), 'expired corrections claim')
            replay = io.StringIO()
            with contextlib.redirect_stdout(replay): seal.cmd_reserve_recovery_window(args)
            self.assertEqual(replay.getvalue().strip(), 'unavailable')
            # Observe the original announcement and the real countdown witness.
            presentation = dict(active=True, phase='counting_down', reason='Deployment Recovery',
                                break_id=stamp, break_ends_at=stamp+420000, scheduled_ends_at=stamp+420000)
            health = dict(releaseSha=seal.NOV7_PREDECESSOR, running=True, weeklyPayout=None,
                          maintenance=dict(active=True, durableConfirmed=True, phase='counting_down',
                          reason='Deployment Recovery', breakEndsAt=stamp+420000, presentation=presentation))
            args.announced_at = stamp
            args.promise_floor_proof = None
            with patch.object(seal.time, 'time', return_value=stamp/1000+121), patch.object(seal.sys, 'stdin', io.StringIO(json.dumps(health))), contextlib.redirect_stdout(io.StringIO()):
                seal.cmd_bind_recovery_window(args)
            # A foreign run cannot bind the claim and expiry never slides.
            args.run_id = '650-2'
            with patch.object(seal.sys, 'stdin', io.StringIO(json.dumps(health))), self.assertRaises(SystemExit):
                seal.cmd_bind_recovery_window(args)
            args.run_id = '650-1'
            with self.assertRaises(SystemExit): seal.require_nov7_reservation_authority(args, target, end*1000-419999)
            old = dict(record, ownerWindowId='2026-11-09-owner-asap-engine-2230z')
            with self.assertRaises(ValueError): floor.nov7_owner(str(self.repo), old, stamp//1000, end)
        transaction = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        self.assertEqual(transaction.count('2026-11-12-complete-missed-engine-1700z'), 4)
        self.assertNotIn('2026-11-09-owner-asap-engine-2230z', transaction)
        gate = transaction.split('nov7_owner_admitted() {', 1)[1].split('\n}', 1)[0]
        shell = 'python3() { return 0; }; nov7_owner_admitted() {' + gate + '\n}; nov7_owner_admitted'
        env = dict(os.environ, ACTIVATION_FLOOR_OWNER_WINDOW=floor.NOV7_OWNER_ID,
                   CHECKPOINT_PREDECESSOR_SHA=seal.NOV7_PREDECESSOR, PHASE1_CYCLE_START='0',
                   CONTROL_DIR=str(self.repo), REPO_DIR=str(self.repo), SHA=target,
                   CONTROL_SHA=target, MUTATION_DEADLINE_EPOCH=str(end), DRILL_MODE='')
        self.assertEqual(subprocess.run([BASH, '-c', shell], env=env).returncode, 0)
        for bad in ({'ACTIVATION_FLOOR_OWNER_WINDOW': '2026-11-09-owner-asap-engine-2230z'},
                    {'CHECKPOINT_PREDECESSOR_SHA': 'f'*40}, {'DRILL_MODE': '1'}):
            self.assertNotEqual(subprocess.run([BASH, '-c', shell], env=dict(env, **bad)).returncode, 0)

    def test_explicit_later_owner_window_precedes_fresh_phase1_but_keeps_original_entries(self):
        import contextlib
        import io
        import sys
        self.owner_record()
        path = self.repo / 'server/release/owner-maintenance-windows.json'
        windows = json.loads(path.read_text())
        windows['windows'][0]['supersedesPhase1Schedule'] = True
        windows['windows'][0]['announceAtChicagoMinutes'] = [53]
        windows['windows'][0].pop('announcementPolicy', None)
        path.write_text(json.dumps(windows))
        for name in ('server/scripts/engine-release-seal.py', 'server/src/maintenance/maintenanceSchedulePolicy.json'):
            target = self.repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / name).read_bytes())
        self.sha = self.commit()
        record = floor.policy(str(self.repo), self.sha, self.sha)
        requests = self.repo / 'requests'; requests.mkdir()
        now = record['activationEpoch'] + 1800
        deadline = record['expiresEpoch'] - 1
        args = ['floor', 'admit', '--repo', str(self.repo), '--target', self.sha,
                '--control', self.sha, '--deadline', str(deadline),
                '--request-root', str(requests), '--run-id', '123-1']
        def admit(at, until=None):
            argv = args if until is None else args[:-4] + ['--deadline', str(until)] + args[-4:]
            out = io.StringIO()
            with patch.object(sys, 'argv', argv), patch.object(floor.time, 'time', return_value=at), contextlib.redirect_stdout(out):
                floor.main()
            return json.loads(out.getvalue())
        # An expired later owner window stops applying: fresh admission returns
        # to the standing Phase1 schedule instead of refusing every release.
        self.assertEqual(admit(record['expiresEpoch'], record['expiresEpoch'] + 3600)['schema'],
                         floor.PHASE1_CAPABILITY)
        self.assertFalse((requests / '123-1.activation-entry').exists())
        selected = admit(now)
        self.assertEqual(selected['schema'], floor.OWNER_CAPABILITY)
        self.assertEqual(selected['ownerWindowId'], record['ownerWindowId'])
        self.assertTrue(selected['supersedesPhase1Schedule'])
        floor.entry_state(selected, str(requests), '123-1', True, now, deadline, announcement=True)
        original = (requests / '123-1.activation-entry').read_bytes()
        self.assertEqual(admit(now)['ownerWindowId'], record['ownerWindowId'])
        with self.assertRaises(ValueError): admit(record['expiresEpoch'] + 1)
        self.assertEqual((requests / '123-1.activation-entry').read_bytes(), original)
        # The presence of a later order must never retarget a pre-existing
        # canonical routine owner, including announcement-only custody.
        (requests / '123-1.activation-entry').unlink()
        prior = floor.phase1_policy(str(self.repo), self.sha, self.sha)
        floor.entry_state(prior, str(requests), '123-1', True, now, deadline, announcement=True)
        original = (requests / '123-1.activation-entry').read_bytes()
        self.assertEqual(admit(now)['schema'], floor.PHASE1_CAPABILITY)
        self.assertEqual((requests / '123-1.activation-entry').read_bytes(), original)
        # A flag is reviewed source, not a truthy environment bypass. Only
        # the explicit :53 announcement / :55 cutover shape is supported.
        for flag, minutes in [('true', [53]), (1, [53]), (False, [53]), (True, [58]), (True, [53, 58])]:
            with self.subTest(flag=flag, minutes=minutes):
                windows['windows'][0]['supersedesPhase1Schedule'] = flag
                windows['windows'][0]['announceAtChicagoMinutes'] = minutes
                path.write_text(json.dumps(windows)); self.sha = self.commit()
                with self.assertRaises(ValueError): floor.policy(str(self.repo), self.sha, self.sha)

    def test_earliest_certified_owner_policy_requires_explicit_unambiguous_authority(self):
        record = self.owner_record(window_id='2026-11-03-tournament-qualified-capacity-continuation')
        self.assertTrue(record['supersedesPhase1Schedule'])
        path = self.repo / 'server/release/owner-maintenance-windows.json'
        original = json.loads(path.read_text())
        self.assertEqual(original['windows'][0]['announcementPolicy'], 'earliest-certified')
        self.assertNotIn('announceAtChicagoMinutes', original['windows'][0])
        floor.check_window(record, record['activationEpoch'] + 30, record['expiresEpoch'], 'admit')
        with self.assertRaises(ValueError):
            floor.check_window(record, record['expiresEpoch'] - 419, record['expiresEpoch'], 'admit')
        for changes in ({'announcementPolicy': 'immediate'}, {'announcementPolicy': True},
                        {'announcementPolicy': None}, {'announceAtChicagoMinutes': [53]},
                        {'announceAtChicagoMinutes': []}, {'supersedesPhase1Schedule': 'true'}):
            with self.subTest(changes=changes):
                candidate = json.loads(json.dumps(original))
                candidate['windows'][0].update(changes)
                path.write_text(json.dumps(candidate)); self.sha = self.commit()
                with self.assertRaises(ValueError):
                    floor.policy(str(self.repo), self.sha, self.sha)

    def test_later_owner_transaction_preserves_custody_without_reserving_hourly_cycle(self):
        source = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        start = source.index('initialise_phase1_cycle() {')
        function = source[start:source.index('\nphase1_reset_required()', start)]
        record = {'schema': floor.OWNER_CAPABILITY, 'ownerWindowId': 'fixture',
                  'supersedesPhase1Schedule': True, 'targetSha': self.sha,
                  'controlSha': self.sha, 'expiresEpoch': int(time.time()) + 3600}
        prefix = r'''set -euo pipefail
LOCK_HELD=1; RUN_ID=123-1; RELEASE_SEAL=fixture-seal
PHASE1_CYCLE_START=0; PHASE1_CYCLE_END=0
PHASE1_WINDOW_START=0; PHASE1_WINDOW_END=0
die() { echo "$*" >&2; exit 77; }
timeout() { return 0; }
legacy_entry_read() {
  case " $* " in
    *' check-routine-owner '*) echo "$FIXTURE_PRIOR" ;;
    *' schedule-policy '*) echo '{"phase1Status":"active"}' ;;
    *' reserve-routine-cycle '*) echo 'reserved-unwanted-hourly' >&2; exit 79 ;;
    *' curl '*) echo '{}' ;;
    *) return 0 ;;
  esac
}
newer_release_in_flight() { return "$FIXTURE_FOREIGN"; }
phase1_custody_admission() { [ "$FIXTURE_CUSTODY" = 1 ] || die custody-unproven; }
recovery_window_reason() { echo no-emergency; }
'''
        def invoke(*, prior='none', foreign=1, custody=1, value=None):
            env = {**os.environ, 'REPO_DIR': str(self.repo), 'SHA': self.sha,
                   'CONTROL_SHA': self.sha, 'ACTIVATION_FLOOR_OWNER_WINDOW': 'fixture',
                   'ACTIVATION_FLOOR_JSON': json.dumps(record if value is None else value),
                   'FIXTURE_PRIOR': prior, 'FIXTURE_FOREIGN': str(foreign),
                   'FIXTURE_CUSTODY': str(custody)}
            script = prefix + 'export -n SHA CONTROL_SHA\n' + function + '\ninitialise_phase1_cycle\n' + (
                '[ "$PHASE1_POLICY_OWNED" = 1 ]\n'
                '[ "$PHASE1_CYCLE_START" = 0 ]\necho owner-window-selected\n')
            return subprocess.run([BASH, '-c', script], env=env, capture_output=True, text=True, timeout=HANG_GUARD_SECONDS)
        result = invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('owner-window-selected', result.stdout)
        for kwargs in ({'foreign': 0}, {'foreign': 2}, {'custody': 0}):
            result = invoke(**kwargs)
            self.assertEqual(result.returncode, 77, result.stderr)
            self.assertNotIn('owner-window-selected', result.stdout)
        # Existing routine ownership and ordinary floors retain their old path.
        for kwargs in ({'prior': 'owned'}, {'value': {**record, 'supersedesPhase1Schedule': False}},
                       {'value': {**record, 'ownerWindowId': 'different'}},
                       {'value': {**record, 'targetSha': 'f' * 40}},
                       {'value': {**record, 'expiresEpoch': 1}}):
            result = invoke(**kwargs)
            self.assertNotEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('owner-window-selected', result.stdout)

    def test_phase1_policy_owns_fresh_admission_without_retargeting_prior_owner(self):
        import contextlib
        import io
        import sys
        record = self.owner_record(legacy=True)
        fixture_owner = json.loads((self.repo / MANIFEST).read_text())['ownerWindowId']
        self.assertEqual(record['ownerWindowId'], fixture_owner)
        for name in ('server/scripts/engine-release-seal.py', 'server/src/maintenance/maintenanceSchedulePolicy.json'):
            path = self.repo / name; path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((ROOT / name).read_bytes())
        self.sha = self.commit()
        record = floor.policy(str(self.repo), self.sha, self.sha)
        requests = self.repo / 'requests'; requests.mkdir()
        now = record['activationEpoch'] + 1800
        deadline = record['expiresEpoch'] + 3600
        args = ['floor', 'admit', '--repo', str(self.repo), '--target', self.sha,
                '--control', self.sha, '--deadline', str(deadline),
                '--request-root', str(requests), '--run-id', '123-1']
        out = io.StringIO()
        with patch.object(sys, 'argv', args), patch.object(floor.time, 'time', return_value=now), contextlib.redirect_stdout(out):
            floor.main()
        selected = json.loads(out.getvalue())
        self.assertEqual(selected['schema'], 'engine-release-activation-floor/v3-phase1')
        self.assertEqual(selected['expiresEpoch'], 0)
        self.assertIsNone(selected['ownerWindowId'])
        self.assertEqual(floor.entry_state(selected, str(requests), '123-1', False, now, deadline), 'never-entered')
        self.assertEqual(floor.entry_state(selected, str(requests), '123-1', True, now, deadline, announcement=True), 'announced')
        # Typed Phase1 entries preserve announcement-only recovery even if
        # Git becomes unavailable; they never fall through to legacy restore.
        self.git('update-ref', '-d', 'refs/remotes/origin/main')
        out = io.StringIO()
        disposition_args = [*args]; disposition_args[1] = 'disposition'
        with patch.object(sys, 'argv', disposition_args), contextlib.redirect_stdout(out):
            floor.main()
        self.assertEqual(out.getvalue().strip(), 'announced')
        self.assertEqual(floor.entry_state(selected, str(requests), '123-1', True, now, deadline), 'entered')
        out = io.StringIO()
        with patch.object(sys, 'argv', disposition_args), contextlib.redirect_stdout(out):
            floor.main()
        self.assertEqual(out.getvalue().strip(), 'entered')
        state = self.repo / 'state'; state.mkdir()
        cycle_start = (now // 3600 + 1) * 3600
        stamp = (cycle_start - 120) * 1000
        cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
                 'policyDigest': selected['manifestSha256'], 'startsAt': cycle_start, 'endsAt': cycle_start+300,
                 'runId': '123-1', 'sha': self.sha, 'controlSha': self.sha, 'status': 'reserved',
                 'window': {'announcedAt': stamp, 'startsAt': stamp+120000, 'endsAt': stamp+420000, 'verified': True}}
        (state / 'engine-release-seal.json').write_text(json.dumps({'schema': 1, 'generation': 1,
            'desired': {'sha': self.sha, 'imageId': 'sha256:'+'a'*64}, 'highWaterSha': self.sha,
            'committedRuns': {}, 'pending': None, 'finalization': None,
            'routineMaintenanceCycles': {str(cycle_start): cycle}}))
        receipt = state / 'engine-recovery-window-123-1.json'
        receipt.write_text(json.dumps({'runId': '123-1', 'sha': self.sha, 'cause': 'urgent', 'announcedAt': stamp})); receipt.chmod(0o600)
        intent = requests / '123-1.legacy-checkpoint-intent'; intent.write_text('unknown')
        with self.assertRaises(ValueError): floor.checkpoint_no_action(selected, str(requests), str(state), '123-1')
        intent.unlink()
        self.assertEqual(floor.checkpoint_no_action(selected, str(requests), str(state), '123-1'), 'announced')
        self.assertEqual(floor.existing_entry(str(requests), '123-1', self.sha, self.sha)['phase'], 'announcement')
        self.git('update-ref', 'refs/remotes/origin/main', self.sha)
        (requests / '123-1.activation-entry').unlink()
        floor.entry_state(record, str(requests), '123-1', True, now, deadline, announcement=True)
        original = (requests / '123-1.activation-entry').read_bytes()
        out = io.StringIO()
        with patch.object(sys, 'argv', args), patch.object(floor.time, 'time', return_value=now), contextlib.redirect_stdout(out):
            floor.main()
        self.assertEqual(json.loads(out.getvalue())['ownerWindowId'], record['ownerWindowId'])
        self.assertEqual((requests / '123-1.activation-entry').read_bytes(), original)
        # The canonical complete/off policy restores daily admission, without
        # reviving the superseded53-minute owner window or its old expiry.
        (requests / '123-1.activation-entry').unlink()
        schedule_path = self.repo / 'server/src/maintenance/maintenanceSchedulePolicy.json'
        for status in ('active', 'complete', 'off'):
            policy = json.loads(schedule_path.read_text())
            policy.update(phase1Status=status, completionEvidence=None if status == 'active' else 'Verified Phase1 completion fixture')
            schedule_path.write_text(json.dumps(policy)); self.sha = self.commit()
            for mode in ('prepare', 'admit', 'entry-check', 'disposition'):
                current_args = ['floor', mode, '--repo', str(self.repo), '--target', self.sha,
                                '--control', self.sha, '--deadline', str(deadline),
                                '--request-root', str(requests), '--run-id', '123-1']
                out = io.StringIO()
                with patch.object(sys, 'argv', current_args), patch.object(floor.time, 'time', return_value=now), contextlib.redirect_stdout(out):
                    floor.main()
                if mode in ('entry-check', 'disposition'):
                    self.assertEqual(out.getvalue().strip(), 'never-entered')
                else:
                    selected = json.loads(out.getvalue())
                    self.assertEqual(selected['phase1Status'], status)
                    self.assertEqual(selected['expiresEpoch'], 0)
        # Exercise the actual recovery selector with old-engine health. A
        # reserved cycle can announce58->00 only, even if degradation exists.
        import shlex
        source = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        start = source.index('recovery_window_reason() {')
        end = source.index('\n# OWNER-ORDERED WINDOW', start)
        fn = source[start:end]
        cycle = (now // 3600 + 1) * 3600
        health = json.dumps({'running': True, 'wholeFleetStalled': True, 'maintenance': {'recoveryWindowProtocol': 'engine-recovery-window-v1'}})
        for offset, expected in ((420, ''), (120, 'phase1-hourly'), (60, '')):
            script = 'date() { echo ' + str(cycle-offset) + '; }; PHASE1_CYCLE_START=' + str(cycle) + '\n' + fn
            result = subprocess.run([BASH, '-c', script + '\nrecovery_window_reason ' + shlex.quote(health)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), expected)
        # Both independent host admit reloads retain the request identity.
        reloads = source.split('ACTIVATION_FLOOR_JSON="$(python3 ')[1:]
        self.assertEqual(len(reloads), 2)
        for reload in reloads:
            command = reload.split('|| die', 1)[0]
            self.assertIn('--request-root "$REQUEST_ROOT" --run-id "$RUN_ID"', command)
        self.assertIn('--request-root "${ENGINE_RELEASE_REQUEST_ROOT:-/var/lib/club-arena/engine-release-requests}"', (ROOT / INTAKE).read_text())

    def test_actual_floor_reads_share_legacy_entry_budget_and_retain_announcement(self):
        import shlex
        import shutil
        import sys
        record = self.owner_record()
        requests = self.repo / 'requests'; requests.mkdir()
        floor.entry_state(record, str(requests), '123-1', True,
                          record['activationEpoch'], record['expiresEpoch']+1, announcement=True)
        marker = requests / '123-1.activation-entry'
        original = marker.read_bytes()
        source = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        wrapper = source[source.index('legacy_entry_read() {'):source.index('legacy_entry_trace() {')]
        binaries = self.repo / 'delayed-bin'; binaries.mkdir()
        launched = self.repo / 'git-child-started'
        git = binaries / 'git'
        git.write_text('#!' + sys.executable + '\nimport time\nfrom pathlib import Path\n'
                       + 'Path(' + repr(str(launched)) + ').write_text("started")\n'
                       + 'time.sleep(3)\nraise SystemExit(1)\n')
        git.chmod(0o755)
        self.assertIsNotNone(shutil.which('timeout'))
        def invoke(name, *, old=False, expired=False):
            if launched.exists(): launched.unlink()
            start = source.index(name + '() {'); end = source.index('\n}', start)+2
            body = source[start:end]
            if old: body = body.replace('legacy_entry_read python3', 'python3')
            deadline = time.time_ns()//1000000 + (5000 if expired else 7000)
            script = f'''set -euo pipefail
{wrapper}
date() {{ {shlex.quote(sys.executable)} -c 'import time;print(time.time_ns()//1000000)'; }}
die() {{ exit 77; }}
LEGACY_ENTRY_DEADLINE_MS={deadline}
ACTIVATION_FLOOR_OWNER_WINDOW={record['ownerWindowId']}
CONTROL_DIR={shlex.quote(str(ROOT/'server/scripts'))}
REPO_DIR={shlex.quote(str(self.repo))}
SHA={self.sha}; CONTROL_SHA={self.sha}
MUTATION_DEADLINE_EPOCH={record['expiresEpoch']+1}
REQUEST_ROOT={shlex.quote(str(requests))}; RUN_ID=123-1
{body}
{name}
echo CHECKPOINT_MUST_NOT_RUN
'''
            started = time.monotonic()
            result = subprocess.run([BASH, '-c', script], text=True, capture_output=True,
                env={**os.environ, 'PATH':str(binaries)+os.pathsep+os.environ['PATH']}, timeout=8)
            return result, time.monotonic()-started
        # Actual old caller exceeds the shared entry work allowance on a slow Git read.
        before, elapsed = invoke('floor_reservation_stamp', old=True)
        self.assertNotEqual(before.returncode, 124)
        self.assertGreaterEqual(elapsed, 2.8)
        for name, expected in [('floor_reservation_stamp',124),('record_floor_runtime_entry',77)]:
            with self.subTest(name=name):
                result, elapsed = invoke(name)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertLess(elapsed, 2.8, result.stderr)
                self.assertNotIn('CHECKPOINT_MUST_NOT_RUN', result.stdout)
                self.assertEqual(marker.read_bytes(), original)
                result, _ = invoke(name, expired=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertFalse(launched.exists(), 'expired entry launched the helper Git read')
                self.assertEqual(marker.read_bytes(), original)

    def certified_seal(self):
        import argparse
        control = self.repo / 'server/scripts/engine-release-seal.py'
        control.write_bytes((ROOT / 'server/scripts/engine-release-seal.py').read_bytes())
        record = self.owner_record(window_id='2026-11-04-tournament-fourfold-certified-recovery')
        spec = importlib.util.spec_from_file_location('certified_fixture_seal', control)
        seal = importlib.util.module_from_spec(spec); spec.loader.exec_module(seal)
        seal.STATE_DIR = self.repo / 'state'; seal.STATE_DIR.mkdir()
        seal.STATE_FILE = seal.STATE_DIR / 'seal.json'
        seal.RESULT_DIR = seal.STATE_DIR / 'results'
        seal.AUDIT_FILE = seal.STATE_DIR / 'audit.jsonl'
        seal.LOCK_FILE = seal.STATE_DIR / 'lock'
        state = {'schema': 1, 'desired': {'sha': floor.CERTIFIED_PREDECESSOR, 'imageId': 'sha256:'+'a'*64},
                 'highWaterSha': self.sha, 'generation': 1, 'pending': None, 'finalization': None, 'committedRuns': {}}
        seal.STATE_FILE.write_text(json.dumps(state))
        args = argparse.Namespace(repo=str(self.repo), sha=self.sha, run_id='800-1', cause='urgent',
            control_sha=self.sha, certified_policy=floor.CERTIFIED_POLICY, predecessor_sha=floor.CERTIFIED_PREDECESSOR,
            scheduled_cycle_start=None, missed_window=False, include_eligibility=False)
        return seal, record, args

    def test_certified_owner_requires_exact_profile_and_entire_900_second_cycle(self):
        r = self.owner_record(window_id='2026-11-04-tournament-fourfold-certified-recovery')
        self.assertEqual(r['ownerWindowId'], floor.CERTIFIED_POLICY)
        self.assertEqual(r['certifiedRecoveryProfile'], 'eed-240s-certified-release-v1')
        self.assertEqual(r['cycleDurationSeconds'], 900)
        self.assertEqual((r['activationEpoch'], r['expiresEpoch']), (1793833200, 1793854800))
        floor.check_window(r, r['expiresEpoch']-900, r['expiresEpoch'], 'admit')
        for now, deadline in [(r['expiresEpoch']-899,r['expiresEpoch']), (r['activationEpoch'],r['activationEpoch']+899)]:
            with self.assertRaises(ValueError): floor.check_window(r,now,deadline,'admit')
        path = self.repo / 'server/release/owner-maintenance-windows.json'
        original = json.loads(path.read_text())
        for changed in [{'certifiedRecoveryProfile':'eed-80s-v1'}, {'supersedesPhase1Schedule':False},
                        {'announcementPolicy':'immediate'}, {'notAfter':'2026-11-05T06:00:00Z'}]:
            candidate=json.loads(json.dumps(original)); candidate['windows'][0].update(changed)
            path.write_text(json.dumps(candidate)); self.sha=self.commit()
            with self.assertRaises(ValueError): floor.policy(str(self.repo),self.sha,self.sha)

    def test_certified_reservation_is_durable_exact_and_never_reannounced(self):
        import contextlib, io
        seal,r,args = self.certified_seal()
        stamp = r['activationEpoch']*1000+123
        original_seal = seal.STATE_FILE.read_bytes()
        def reserve(at):
            output=io.StringIO()
            with patch.object(seal.time,'time',return_value=at/1000),contextlib.redirect_stdout(output):
                seal.cmd_reserve_recovery_window(args)
            return output.getvalue()
        self.assertEqual(reserve(stamp),str(stamp)+'\n')
        path=seal.STATE_DIR/'engine-recovery-window-800-1.json'; raw=path.read_bytes(); value=json.loads(raw)
        self.assertEqual(value['certifiedRecovery'],{'policyId':floor.CERTIFIED_POLICY,'profileId':floor.CERTIFIED_PROFILE,
            'controlSha':self.sha,'predecessorSha':floor.CERTIFIED_PREDECESSOR,'endsAt':stamp+900000})
        self.assertEqual(floor.reservation(r,str(seal.STATE_DIR),'800-1'),stamp)
        self.assertEqual(seal.recovery_window_ends_at(value),stamp+900000)
        # An unknown transport acknowledgement observes the original, even after expiry.
        self.assertEqual(reserve(stamp+901000),str(stamp)+'\n'); self.assertEqual(path.read_bytes(),raw)
        self.assertEqual(seal.STATE_FILE.read_bytes(),original_seal)
        self.assertEqual(len(seal.AUDIT_FILE.read_text().splitlines()),1)
        args.certified_policy=None; args.predecessor_sha=None
        with self.assertRaises(SystemExit): reserve(stamp+1)
        self.assertEqual(path.read_bytes(),raw)
        # The ordinary path remains exactly four fields and420 seconds.
        path.unlink(); args.run_id='801-1'
        self.assertEqual(reserve(stamp),str(stamp)+'\n')
        ordinary=json.loads((seal.STATE_DIR/'engine-recovery-window-801-1.json').read_text())
        self.assertEqual(set(ordinary),{'runId','sha','cause','announcedAt'})
        self.assertEqual(seal.recovery_window_ends_at(ordinary),stamp+420000)

    def test_certified_reservation_refuses_mismatch_and_late_new_cycle_without_writes(self):
        seal,r,args=self.certified_seal(); base=dict(vars(args))
        for changes,stamp in [({'predecessor_sha':'f'*40},r['activationEpoch']*1000),
                              ({'certified_policy':'other'},r['activationEpoch']*1000),
                              ({'cause':'engine-degraded'},r['activationEpoch']*1000),
                              ({},r['expiresEpoch']*1000-899999), ({},r['activationEpoch']*1000-1)]:
            vars(args).clear(); vars(args).update({**base,**changes})
            with patch.object(seal.time,'time',return_value=stamp/1000),self.assertRaises((SystemExit,ValueError)):
                seal.cmd_reserve_recovery_window(args)
            self.assertEqual(list(seal.STATE_DIR.glob('engine-recovery-window-*.json')),[])
        vars(args).clear();vars(args).update(base)
        with patch.object(seal.time,'time',return_value=r['activationEpoch']): seal.cmd_reserve_recovery_window(args)
        path=seal.STATE_DIR/'engine-recovery-window-800-1.json'; original=json.loads(path.read_text())
        for changes in [{'endsAt':original['announcedAt']+420000},{'controlSha':'b'*40},
                        {'predecessorSha':'c'*40},{'profileId':'eed-80s-v1'},{'extra':True}]:
            value=json.loads(json.dumps(original));value['certifiedRecovery'].update(changes);path.write_text(json.dumps(value))
            with self.assertRaises(ValueError): floor.reservation(r,str(seal.STATE_DIR),'800-1')
        # Missing original metadata cannot silently become a 900-second owner.
        value=dict(original);value.pop('certifiedRecovery');path.write_text(json.dumps(value))
        with self.assertRaises(ValueError): floor.reservation(r,str(seal.STATE_DIR),'800-1')

    def test_certified_completion_waits_for_900_seconds_and_original_terminal_receipt(self):
        seal,r,args=self.certified_seal(); stamp=r['activationEpoch']*1000
        with patch.object(seal.time,'time',return_value=stamp/1000): seal.cmd_reserve_recovery_window(args)
        value=json.loads((seal.STATE_DIR/'engine-recovery-window-800-1.json').read_text())
        self.assertFalse(seal.completed_recovery_window(args.run_id,value,stamp+900000))
        failure={'schema':1,'runId':args.run_id,'sha':self.sha,'controlSha':self.sha,'result':'failed',
                 'invocationId':'e'*32,'transactionExitStatus':1,'recoveredDesiredSha':floor.CERTIFIED_PREDECESSOR,
                 'recoveredDesiredImageId':'sha256:'+'a'*64,'completedAt':stamp//1000+421}
        seal.result_path(args.run_id).write_text(json.dumps(failure))
        self.assertFalse(seal.completed_recovery_window(args.run_id,value,stamp+420000))
        self.assertFalse(seal.completed_recovery_window(args.run_id,value,stamp+899999))
        self.assertTrue(seal.completed_recovery_window(args.run_id,value,stamp+900000))
        value['certifiedRecovery']['endsAt']=stamp+420000
        with self.assertRaises(SystemExit): seal.completed_recovery_window(args.run_id,value,stamp+900000)

    def test_certified_diagnostic_bounds_are_profile_and_predecessor_scoped(self):
        seal,_,_=self.certified_seal()
        raw={'checkpointRequired':1,'drainedCutover':0,'prepared':0,'mutationStarted':0,'lockHeld':1,
             'checkpointBudgetSeconds':320,'checkpointWorkMs':260000,'certificateExitStatus':0,
             'breakEndEpoch':1793854800,'checkpointProfile':floor.CERTIFIED_PROFILE,'predecessorSha':floor.CERTIFIED_PREDECESSOR}
        self.assertEqual(seal.diagnostic_shell_state(raw),raw)
        for changes in [{'checkpointProfile':'eed-80s-v1'},{'predecessorSha':'a'*40},
                        {'checkpointBudgetSeconds':321},{'checkpointWorkMs':260001}]:
            with self.assertRaises(ValueError): seal.diagnostic_shell_state({**raw,**changes})
        ordinary={**raw,'checkpointProfile':'eed-80s-v1','checkpointBudgetSeconds':80,'checkpointWorkMs':68750}
        self.assertEqual(seal.diagnostic_shell_state(ordinary),ordinary)

    def test_owner_window_is_exact_bounded_and_needs_full_lead(self):
        r = self.owner_record()
        self.assertEqual(r['schema'], floor.OWNER_CAPABILITY)
        floor.check_window(r, r['clientPublicationEpoch']-1, r['expiresEpoch']+1, 'publish')
        floor.check_window(r, r['clientPublicationEpoch'], r['clientPublicationEpoch']+120, 'publish')
        floor.check_window(r, r['activationEpoch'], r['activationEpoch'] + 8400, 'admit')
        for now, deadline in [(r['activationEpoch']-1,r['expiresEpoch']+1), (r['expiresEpoch']-419,r['expiresEpoch']+1), (r['activationEpoch'],r['activationEpoch']+419)]:
            with self.assertRaises(ValueError): floor.check_window(r, now, deadline, 'admit')
        path = self.repo / 'server/release/owner-maintenance-windows.json'
        doc = json.loads(path.read_text()); doc['windows'][0]['id'] = 'foreign'
        path.write_text(json.dumps(doc)); sha = self.commit()
        with self.assertRaises(ValueError): floor.policy(str(self.repo), sha, sha)

    def test_new_continuation_preserves_old_target_expiry_and_control_identity(self):
        import hashlib
        old = {'schema': floor.OWNER_CAPABILITY, 'preparationAt': '2026-10-30T00:00:00Z',
               'activationAt': '2026-10-30T00:00:00Z', 'expiresAt': '2026-10-30T06:00:00Z',
               'timeZone': 'America/Chicago', 'ownerWindowId': '2026-10-30-mtt-next-safe-hand-drain',
               'clientPublicationAt': '2026-10-30T09:00:00Z'}
        old_raw = (json.dumps(old, indent=2)+'\n').encode()
        doc = json.loads((ROOT/'server/release/owner-maintenance-windows.json').read_text())
        historical = next(w for w in doc['windows'] if w['id'] == old['ownerWindowId'])
        self.assertEqual(historical['releaseWitness']['sha256'], hashlib.sha256(old_raw).hexdigest())
        self.assertEqual((historical['notBefore'], historical['notAfter']),
                         (old['activationAt'], old['expiresAt']))
        window = {**historical, 'contains': self.sha}
        (self.repo/MANIFEST).write_bytes(old_raw)
        (self.repo/'server/release/owner-maintenance-windows.json').write_text(json.dumps({'version':1,'windows':[window]}))
        old_sha = self.commit()
        previous = floor.policy(str(self.repo), old_sha, old_sha)
        current = self.owner_record(window_id=None)
        self.assertNotEqual(current['ownerWindowId'], previous['ownerWindowId'])
        # A current carrier can belong to a later finite owner. Historical
        # target dates stay immutable rather than forcing future restamps.
        source = json.loads((ROOT/MANIFEST).read_text())
        from datetime import datetime
        epoch = lambda value: int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp())
        self.assertEqual(current['activationEpoch'], epoch(source['activationAt']))
        self.assertEqual(current['expiresEpoch'], epoch(source['expiresAt']))
        self.assertGreaterEqual(current['activationEpoch'], previous['expiresEpoch'])
        self.assertGreaterEqual(current['expiresEpoch']-current['activationEpoch'], 420)
        self.assertLessEqual(current['expiresEpoch']-current['activationEpoch'], 21600)
        self.assertEqual(current['clientPublicationEpoch'], current['activationEpoch'])
        # Preserve the incoming peer's gap control: an expired predecessor
        # cannot open a future successor early.
        gap = previous['expiresEpoch']+1
        with self.assertRaises(ValueError): floor.check_window(previous, gap, gap+8400, 'admit')
        if gap < current['activationEpoch']:
            with self.assertRaises(ValueError): floor.check_window(current, gap, gap+8400, 'admit')
        now = current['activationEpoch']
        with self.assertRaises(ValueError): floor.check_window(previous, now, now+8400, 'admit')
        floor.check_window(current, now, now+8400, 'admit')
        floor.check_window(current, current['activationEpoch'], now+8400, 'publish')
        with self.assertRaises(ValueError): floor.policy(str(self.repo), self.sha, old_sha)
        with self.assertRaises(ValueError): floor.policy(str(self.repo), old_sha, self.sha)
        # Pinned old source is unchanged by the newer authorization.
        self.assertEqual(floor.policy(str(self.repo), old_sha, old_sha), previous)
        floor.check_window(current, current['expiresEpoch']-current.get('cycleDurationSeconds',420), current['expiresEpoch'], 'admit')
        with self.assertRaises(ValueError):
            floor.check_window(current, current['expiresEpoch']-current.get('cycleDurationSeconds',420)+1, current['expiresEpoch']+1, 'admit')

    def test_census_continuation_keeps_failed_operation_window_immutable(self):
        import hashlib
        old = {'schema': floor.OWNER_CAPABILITY, 'preparationAt': '2026-11-03T14:00:00Z',
               'activationAt': '2026-11-03T14:00:00Z', 'expiresAt': '2026-11-03T17:00:00Z',
               'timeZone': 'America/Chicago', 'ownerWindowId': '2026-11-03-tournament-recovery-earliest-certified',
               'clientPublicationAt': '2026-11-03T14:00:00Z'}
        raw = (json.dumps(old, indent=2)+'\n').encode()
        doc = json.loads((ROOT/'server/release/owner-maintenance-windows.json').read_text())
        prior = next(w for w in doc['windows'] if w['id'] == old['ownerWindowId'])
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(prior['notAfter'], old['expiresAt'])
        latest, latest_raw = self.historical_floor('2026-11-03-tournament-qualified-capacity-continuation')
        self.assertEqual(latest['contains'], '0de3e5b9f6ae9b6def3a2603ef69fab5d934977d')
        self.assertEqual(latest['releaseWitness']['sha256'], hashlib.sha256(latest_raw).hexdigest())
        self.assertEqual((latest['notBefore'], latest['notAfter']), ('2026-11-03T20:30:00Z', '2026-11-03T23:30:00Z'))
        self.assertEqual(latest['announcementPolicy'], 'earliest-certified')
        self.assertNotIn('announceAtChicagoMinutes', latest)
        (self.repo/MANIFEST).write_bytes(raw)
        (self.repo/'server/release/owner-maintenance-windows.json').write_text(json.dumps({'version':1,'windows':[{**prior,'contains':self.sha}]}))
        old_sha = self.commit()
        original = floor.policy(str(self.repo), old_sha, old_sha)
        current = self.owner_record(window_id='2026-11-03-tournament-qualified-capacity-continuation')
        after_old = max(original['expiresEpoch'] + 1, current['activationEpoch'])
        with self.assertRaises(ValueError): floor.check_window(original, after_old, current['expiresEpoch'], 'admit')
        floor.check_window(current, after_old, current['expiresEpoch'], 'admit')
        self.assertEqual(floor.policy(str(self.repo), old_sha, old_sha), original)
        with self.assertRaises(ValueError): floor.policy(str(self.repo), self.sha, old_sha)
        with self.assertRaises(ValueError): floor.policy(str(self.repo), old_sha, self.sha)
        with self.assertRaises(ValueError): floor.check_window(current, current['expiresEpoch']-419, current['expiresEpoch'], 'admit')

    def test_bounded_census_delivery_preserves_prior_floor_and_fixed_expiry(self):
        import hashlib
        old = {'schema': floor.OWNER_CAPABILITY, 'preparationAt': '2026-11-03T16:35:00Z',
               'activationAt': '2026-11-03T16:35:00Z', 'expiresAt': '2026-11-03T19:35:00Z',
               'timeZone': 'America/Chicago', 'ownerWindowId': '2026-11-03-tournament-census-recovery-continuation',
               'clientPublicationAt': '2026-11-03T16:35:00Z'}
        doc = json.loads((ROOT/'server/release/owner-maintenance-windows.json').read_text())
        prior = next(w for w in doc['windows'] if w['id'] == old['ownerWindowId'])
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256((json.dumps(old, indent=2)+'\n').encode()).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), (old['activationAt'], old['expiresAt']))
        current = self.owner_record(window_id='2026-11-03-tournament-qualified-capacity-continuation')
        self.assertEqual(current['ownerWindowId'], '2026-11-03-tournament-qualified-capacity-continuation')
        floor.check_window(current, current['expiresEpoch']-420, current['expiresEpoch'], 'admit')
        for now in [current['activationEpoch']-1, current['expiresEpoch']-419, current['expiresEpoch']]:
            with self.assertRaises(ValueError): floor.check_window(current, now, current['expiresEpoch'], 'admit')

    def test_qualified_capacity_preserves_previous_floor_and_expiry(self):
        import hashlib
        old = {'schema': floor.OWNER_CAPABILITY, 'preparationAt': '2026-11-03T18:30:00Z',
               'activationAt': '2026-11-03T18:30:00Z', 'expiresAt': '2026-11-03T21:30:00Z',
               'timeZone': 'America/Chicago', 'ownerWindowId': '2026-11-03-tournament-bounded-census-delivery-continuation',
               'clientPublicationAt': '2026-11-03T18:30:00Z'}
        doc = json.loads((ROOT/'server/release/owner-maintenance-windows.json').read_text())
        prior = next(w for w in doc['windows'] if w['id'] == old['ownerWindowId'])
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256((json.dumps(old, indent=2)+'\n').encode()).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), (old['activationAt'], old['expiresAt']))
        current = self.owner_record(window_id='2026-11-03-tournament-qualified-capacity-continuation')
        self.assertEqual(current['ownerWindowId'], '2026-11-03-tournament-qualified-capacity-continuation')
        floor.check_window(current, current['expiresEpoch']-420, current['expiresEpoch'], 'admit')
        for now in [current['activationEpoch']-1, current['expiresEpoch']-419, current['expiresEpoch']]:
            with self.assertRaises(ValueError): floor.check_window(current, now, current['expiresEpoch'], 'admit')

    def test_phase1_plo_55_window_preserves_qualified_capacity_floor(self):
        import hashlib
        prior, prior_raw = self.historical_floor('2026-11-03-tournament-qualified-capacity-continuation')
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256(prior_raw).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), ('2026-11-03T20:30:00Z', '2026-11-03T23:30:00Z'))
        doc = json.loads((ROOT/'server/release/owner-maintenance-windows.json').read_text())
        window, raw = self.historical_floor('2026-11-03-phase1-plo-horse-55-2330z')
        self.assertEqual(window['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-03T23:30:00Z', '2026-11-04T05:30:00Z'))
        self.assertEqual(window['announceAtChicagoMinutes'], [53])
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertNotIn('announcementPolicy', window)
        self.assertEqual(window['contains'], '59b0d5dcc312235ab2f3e7fa9c97adbffabe271f')
        current = self.owner_record(window_id='2026-11-03-phase1-plo-horse-55-2330z')
        self.assertEqual(current['ownerWindowId'], '2026-11-03-phase1-plo-horse-55-2330z')
        self.assertTrue(current['supersedesPhase1Schedule'])
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 21600)

    def test_hybrid_phase1_55_window_binds_its_own_floor_and_the_hybrid_merge(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-05-hybrid-and-phase1-55-0645z')
        self.assertEqual(window['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-05T06:45:00Z', '2026-11-05T12:45:00Z'))
        self.assertEqual(window['announceAtChicagoMinutes'], [53])
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertNotIn('announcementPolicy', window)
        self.assertNotIn('certifiedRecoveryProfile', window)
        self.assertEqual(window['migrations'], [])
        self.assertEqual(window['contains'], 'a936a6b6a6fad00a645208c82686b4e6b05cadd6')
        fourfold, fourfold_raw = self.historical_floor('2026-11-04-tournament-fourfold-certified-recovery')
        self.assertEqual(fourfold['releaseWitness']['sha256'], hashlib.sha256(fourfold_raw).hexdigest())
        self.assertEqual(fourfold['notAfter'], '2026-11-05T05:00:00Z')
        current = self.owner_record(window_id='2026-11-05-hybrid-and-phase1-55-0645z')
        self.assertEqual(current['ownerWindowId'], '2026-11-05-hybrid-and-phase1-55-0645z')
        self.assertTrue(current['supersedesPhase1Schedule'])
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 21600)

    def test_hybrid_earliest_safe_window_binds_the_live_floor_and_keeps_the_expired_minute53_entry(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-05-hybrid-earliest-safe-1345z')
        self.assertEqual(window['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-05T13:45:00Z', '2026-11-05T19:45:00Z'))
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertNotIn('announceAtChicagoMinutes', window)
        self.assertNotIn('certifiedRecoveryProfile', window)
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        self.assertEqual(window['contains'], 'a936a6b6a6fad00a645208c82686b4e6b05cadd6')
        expired, expired_raw = self.historical_floor('2026-11-05-hybrid-and-phase1-55-0645z')
        self.assertEqual(expired['releaseWitness']['sha256'], hashlib.sha256(expired_raw).hexdigest())
        self.assertEqual(expired['notAfter'], '2026-11-05T12:45:00Z')
        current = self.owner_record(window_id='2026-11-05-hybrid-earliest-safe-1345z')
        self.assertEqual(current['ownerWindowId'], '2026-11-05-hybrid-earliest-safe-1345z')
        self.assertTrue(current['supersedesPhase1Schedule'])
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 21600)

    def test_lightning_always_runs_window_binds_the_live_floor_and_keeps_the_hybrid_entry(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-05-lightning-always-runs-1945z')
        self.assertEqual(window['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-05T19:45:00Z', '2026-11-06T01:45:00Z'))
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertNotIn('announceAtChicagoMinutes', window)
        self.assertNotIn('certifiedRecoveryProfile', window)
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        self.assertEqual(window['contains'], '1e6b597005285a55805242299025648bf8cae422')
        hybrid, hybrid_raw = self.historical_floor('2026-11-05-hybrid-earliest-safe-1345z')
        self.assertEqual(hybrid['releaseWitness']['sha256'], hashlib.sha256(hybrid_raw).hexdigest())
        self.assertEqual(hybrid['notAfter'], '2026-11-05T19:45:00Z')
        current = self.owner_record(window_id='2026-11-05-lightning-always-runs-1945z')
        self.assertEqual(current['ownerWindowId'], '2026-11-05-lightning-always-runs-1945z')
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 21600)

    def test_cash_styles_window_binds_the_live_floor_and_keeps_the_lightning_entry(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-05-cash-styles-and-deal-timing-2045z')
        self.assertEqual(window['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-05T20:45:00Z', '2026-11-06T02:45:00Z'))
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertNotIn('announceAtChicagoMinutes', window)
        self.assertNotIn('certifiedRecoveryProfile', window)
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        self.assertEqual(window['contains'], 'a8b078fbde30d698511dad0ac355bd48d7a967bd')
        lightning, lightning_raw = self.historical_floor('2026-11-05-lightning-always-runs-1945z')
        self.assertEqual(lightning['releaseWitness']['sha256'], hashlib.sha256(lightning_raw).hexdigest())
        self.assertEqual(lightning['notAfter'], '2026-11-06T01:45:00Z')
        current = self.owner_record(window_id='2026-11-05-cash-styles-and-deal-timing-2045z')
        self.assertEqual(current['ownerWindowId'], '2026-11-05-cash-styles-and-deal-timing-2045z')
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 21600)

    def test_cutover_recovery_window_binds_the_live_floor_and_keeps_the_cash_styles_entry(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-07-cutover-recovery-engine-release-1445z')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '54189b2503872b25b79f1ea68bf6f16e617fe14586311207e1a7801645df548b')
        self.assertEqual(window['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-07T14:45:00Z', '2026-11-07T20:45:00Z'))
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertNotIn('announceAtChicagoMinutes', window)
        self.assertNotIn('certifiedRecoveryProfile', window)
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        self.assertEqual(window['contains'], 'f7c2804e81b89e69c4f3fb82ab6c4413dffdaf28')
        cash, cash_raw = self.historical_floor('2026-11-05-cash-styles-and-deal-timing-2045z')
        self.assertEqual(cash['releaseWitness']['sha256'], hashlib.sha256(cash_raw).hexdigest())
        self.assertEqual(cash['notAfter'], '2026-11-06T02:45:00Z')
        current = self.owner_record(window_id='2026-11-07-cutover-recovery-engine-release-1445z')
        self.assertEqual(current['ownerWindowId'], '2026-11-07-cutover-recovery-engine-release-1445z')
        self.assertTrue(current['supersedesPhase1Schedule'])
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 21600)

    def test_provenance_archive_gate_refuses_absent_and_unreadable_catalogs(self):
        spec = importlib.util.spec_from_file_location('doors', ROOT / 'server/scripts/engine-release-window-doors.py')
        doors = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(doors)
        for catalog, expected in (({'tables':['horse_memory_before_fold_provenance']}, doors.READY),
                                  ({'tables':[]}, doors.REFUSED), ({}, doors.UNKNOWN)):
            with self.subTest(catalog=catalog), patch.object(doors, 'read_catalog', return_value=catalog):
                self.assertEqual(doors.main(['horse-fold-provenance', '--env-file', 'unused']), expected)

    def test_provenance_worker_and_database_windows_bind_the_same_corrective_release(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-07-horse-fold-provenance-engine-1800z')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'd25f21c7ceebc9ea58a9e13f64ad591e0628f11c37d1559970dcef85d9847deb')
        self.assertEqual(window['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(window['migrations'], [])
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        database, = [w for w in windows['databaseWindows'] if w['id'] == '2026-11-07-horse-fold-provenance-db-1800z']
        self.assertEqual(database['contains'], window['contains'])
        self.assertEqual((database['notBefore'],database['notAfter']), (window['notBefore'],window['notAfter']))
        self.assertEqual(database['migrations'], ['20261107160549_horse_memory_excludes_forced_folds.sql'])
        migration = ROOT / 'supabase/migrations' / database['migrations'][0]
        self.assertEqual(hashlib.sha256(migration.read_bytes()).hexdigest(),
                         'f0093f6afa8347dc122a1ed95060bfb73339ef89d34208ac9f36b82562ede266')

    def test_receipt_successor_binds_a_fresh_floor_and_preserves_single_use_custody(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-11-horse-clock-receipts-engine-0050z')
        self.assertEqual(window['id'], '2026-11-11-horse-clock-receipts-engine-0050z')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'a14a5f26ebc79a55708f7f6d78f82832e20b10483ea6b96b7cca058a7e1b4d10')
        self.assertEqual(window['releaseWitness']['sha256'], 'a14a5f26ebc79a55708f7f6d78f82832e20b10483ea6b96b7cca058a7e1b4d10')
        self.assertEqual(hashlib.sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), '8d78a5a08db6d3ee5e1dbb8b33edf65db6df3064122e0f2cee4346e6ee8a0fba')
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-11T03:40:00Z', '2026-11-11T06:30:00Z'))
        self.assertEqual(window['playerNoticeAt'], '2026-11-11T03:20:00Z')
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        self.assertIn('#10346', window['ownerOrder'])
        self.assertIn('15:34 America/Chicago', window['ownerOrder'])
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-12-complete-missed-engine-1700z')
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-12-horse-corrections-engine-0700z')
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-12-horse-corrections-10525-engine-0030z')
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-11-horse-realtime-10454-engine-1930z')
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-11-horse-clock-clone-engine-0650z')
        self.assertEqual(windows['windows'][-1]['id'], '2026-11-11-horse-clock-receipts-engine-0050z')
        current = self.owner_record(window_id='2026-11-11-horse-clock-receipts-engine-0050z')
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 10200)

    def test_clone_clock_successor_binds_a_fresh_floor_and_preserves_consumed_receipt_order(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-11-horse-clock-clone-engine-0650z')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'aeecae49960eb9659ab5bc86710d330bb6a58a47a7c732f94fe74c894002b602')
        self.assertEqual(window['releaseWitness']['sha256'], 'aeecae49960eb9659ab5bc86710d330bb6a58a47a7c732f94fe74c894002b602')
        self.assertEqual(hashlib.sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), '33667f78814157db34d96578c6c8d4362ce1582781a9f9d32775145ba8b61d4f')
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-11T08:00:00Z', '2026-11-11T10:30:00Z'))
        self.assertEqual(window['playerNoticeAt'], '2026-11-11T07:40:00Z')
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        self.assertIn('#10346', window['ownerOrder'])
        self.assertIn('#10457', window['ownerOrder'])
        self.assertEqual(window['contains'], '57d56c0d6417b08fbb847fb842c03c968a25f698')
        self.assertIn('15:34 America/Chicago', window['ownerOrder'])
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        self.assertEqual(windows['windows'][-5]['id'], '2026-11-11-horse-clock-clone-engine-0650z')
        current = self.owner_record(window_id='2026-11-11-horse-clock-clone-engine-0650z')
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 9000)

    def test_realtime_10454_binds_fresh_authority_and_preserves_consumed_clock_order(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-11-horse-realtime-10454-engine-1930z')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'd94ebce03e481c7af3c8cce08eac33f43724099626794ab770a07624d9b38e5c')
        self.assertEqual(window['releaseWitness']['sha256'], 'd94ebce03e481c7af3c8cce08eac33f43724099626794ab770a07624d9b38e5c')
        self.assertEqual(hashlib.sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), 'e16b0ff230da53a50145768f1dbb5ee9944eaa74f3e5616698759c68942c8950')
        self.assertEqual(window['contains'], '1094cd8ca7a6e99abc29bdfe89aa26c2964bd4df')
        self.assertEqual((window['playerNoticeAt'], window['notBefore'], window['notAfter']), ('2026-11-11T19:10:00Z', '2026-11-11T19:30:00Z', '2026-11-11T22:30:00Z'))
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        for required in ('#10454', '11:36:59-06:00', 'f7735cca6862b9add06841b8a41c305b3f3ebe01', 'twenty minutes', '1800-second', '285s', 'zero opportunities'):
            self.assertIn(required, window['ownerOrder'])
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        self.assertEqual(windows['windows'][-4]['id'], '2026-11-11-horse-realtime-10454-engine-1930z')
        self.assertEqual(windows['windows'][-5]['id'], '2026-11-11-horse-clock-clone-engine-0650z')
        current = self.owner_record(window_id='2026-11-11-horse-realtime-10454-engine-1930z')
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 10800)

    def test_corrections_10525_binds_fresh_authority_and_preserves_unconsumed_realtime_order(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-12-horse-corrections-10525-engine-0030z')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '9f2b6fba58ca37c6aaf77c8aa429e34e781655d49a65d15f1dafaf0386671aaa')
        self.assertEqual(window['releaseWitness']['sha256'], '9f2b6fba58ca37c6aaf77c8aa429e34e781655d49a65d15f1dafaf0386671aaa')
        self.assertEqual(hashlib.sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), '2fbe75654cb2711288b44ae3c9ef2dcc49953509643ca07e800729c1345af8b6')
        self.assertEqual(window['contains'], 'd58e1c206a521dbb33583fbb94ac7a64eceda647')
        self.assertEqual((window['playerNoticeAt'], window['notBefore'], window['notAfter']), ('2026-11-12T00:10:00Z', '2026-11-12T00:30:00Z', '2026-11-12T05:30:00Z'))
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        for required in ('#10525', 'ASAP tonight (Recommended)', 'f7735cca6862b9add06841b8a41c305b3f3ebe01', 'twenty minutes', '1800-second', '285s', 'zero opportunities', 'not extended'):
            self.assertIn(required, window['ownerOrder'])
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        self.assertEqual(windows['windows'][-3]['id'], '2026-11-12-horse-corrections-10525-engine-0030z')
        self.assertEqual(windows['windows'][-4]['id'], '2026-11-11-horse-realtime-10454-engine-1930z')
        current = self.owner_record(window_id='2026-11-12-horse-corrections-10525-engine-0030z')
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 18000)

    def test_rebooked_corrections_bind_fresh_authority_and_preserve_expired_orders(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-12-horse-corrections-engine-0700z')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '5d710e3fb907d61da071f7f31f91105afdd155bb1e5a40983bb2d119c11eaa48')
        self.assertEqual(window['releaseWitness']['sha256'], '5d710e3fb907d61da071f7f31f91105afdd155bb1e5a40983bb2d119c11eaa48')
        self.assertEqual(hashlib.sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), 'a82f04621340386100a498794d9667497d2f43f4633828e33d3f9b0f45609422')
        self.assertEqual(window['contains'], '465afb718c91e2339ec880f9bd7f580d515ced14')
        self.assertEqual((window['playerNoticeAt'], window['notBefore'], window['notAfter']), ('2026-11-12T06:40:00Z', '2026-11-12T07:00:00Z', '2026-11-12T09:15:00Z'))
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        for required in ('#10574', 'Book Thursday 1:00-3:15 AM (Recommended)', 'f7735cca6862b9add06841b8a41c305b3f3ebe01', 'twenty minutes', '1800-second', '285s', 'zero opportunities', 'not extended'):
            self.assertIn(required, window['ownerOrder'])
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        self.assertEqual(windows['windows'][-2]['id'], '2026-11-12-horse-corrections-engine-0700z')
        self.assertEqual(windows['windows'][-3]['id'], '2026-11-12-horse-corrections-10525-engine-0030z')
        current = self.owner_record(window_id='2026-11-12-horse-corrections-engine-0700z')
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 8100)

    def test_missed_engine_takeover_binds_fresh_authority_and_separate_prerequisites(self):
        import hashlib
        window, raw = self.historical_floor(floor.NOV7_OWNER_ID)
        self.assertEqual(floor.NOV7_OWNER_ID, '2026-11-12-complete-missed-engine-1700z')
        self.assertEqual(raw, (ROOT / MANIFEST).read_bytes())
        self.assertEqual(hashlib.sha256(raw).hexdigest(), floor.NOV7_MANIFEST_DIGEST)
        self.assertEqual(window['releaseWitness']['sha256'], floor.NOV7_MANIFEST_DIGEST)
        self.assertEqual(hashlib.sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), floor.NOV7_ORDER_DIGEST)
        self.assertEqual((window['playerNoticeAt'], window['notBefore'], window['notAfter']), ('2026-11-12T16:40:00Z', '2026-11-12T17:00:00Z', '2026-11-12T22:00:00Z'))
        self.assertEqual(window['contains'], '7608c4721d136aa7f3a8b1e5f3457ea68de64b39')
        self.assertEqual(window['migrations'], [])
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        self.assertEqual(windows['windows'][-2]['id'], '2026-11-12-horse-corrections-engine-0700z')
        entries = [next(w for w in windows['databaseWindows'] if w['id'] == window_id)
                   for window_id in ('2026-11-12-missed-engine-db-bank-win', '2026-11-12-missed-engine-db-rebuy')]
        for entry, version in zip(entries, ['20261111174148', '20261112013925']):
            self.assertEqual(len(entry['migrations']), 1)
            self.assertTrue(entry['migrations'][0].startswith(version + '_'))
            self.assertIn('TAKE OWNERSHIP OF THIS NOW', entry['ownerOrder'])
            self.assertIn('rolling-hour spacing', entry['ownerOrder'])

    def test_cash_room_realism_window_binds_the_live_floor_and_keeps_the_provenance_entry(self):
        import hashlib
        window, raw = self.historical_floor('2026-11-10-owner-asap-engine-2350z')
        self.assertEqual(window['id'], '2026-11-10-owner-asap-engine-2350z')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '72bbb5fe8f245ad98d7b78f883009a16a2289816bd50cf4edd3258a121dffa48')
        self.assertEqual(window['releaseWitness']['sha256'], '72bbb5fe8f245ad98d7b78f883009a16a2289816bd50cf4edd3258a121dffa48')
        canonical = json.dumps(window, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(hashlib.sha256(canonical).hexdigest(), '18b1ca2d8b8ab54ec36380c623687bbd5ba6f249e4fbdf04095e1a02a0cd2c23')
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-10T23:50:00Z', '2026-11-11T05:00:00Z'))
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertIs(window['supersedesPhase1Schedule'], True)
        self.assertEqual(window['migrations'], [])
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-12-complete-missed-engine-1700z')
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-12-horse-corrections-engine-0700z')
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-12-horse-corrections-10525-engine-0030z')
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-11-horse-realtime-10454-engine-1930z')
        self.assertEqual(windows['windows'].pop()['id'], '2026-11-11-horse-clock-clone-engine-0650z')
        self.assertEqual(windows['windows'][-2]['id'], '2026-11-10-owner-asap-engine-2350z')
        self.assertEqual(windows['windows'][-3]['id'], '2026-11-10-owner-asap-engine-0650z')
        previous_asap, previous_asap_raw = self.historical_floor('2026-11-10-owner-asap-engine-0650z')
        self.assertEqual(hashlib.sha256(previous_asap_raw).hexdigest(), 'a171baede07efd880c67e623e896fb4cee13a0fd0bb1be10310911127dd560cb')
        self.assertEqual(hashlib.sha256(json.dumps(previous_asap, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), 'e36fddfe1a9504881a218b416efb65902699efed4deb476a099eaf56e21d58fa')
        self.assertEqual(windows['windows'][-5]['id'], '2026-11-09-owner-asap-engine-2230z')
        self.assertEqual(windows['windows'][-4]['id'], '2026-11-10-owner-asap-engine-0440z')
        corrected, corrected_raw = self.historical_floor('2026-11-10-owner-asap-engine-0440z')
        self.assertEqual(hashlib.sha256(corrected_raw).hexdigest(), '62de2ae6621f8654973670bbc6d79d8595b3514773c18a498b261e0d374c5981')
        self.assertEqual(hashlib.sha256(json.dumps(corrected, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), '7c90789c59b1f4d10993f9e6246ae191e4fb941afaa5e4eba2ba7b58d14ac861')
        original, original_raw = self.historical_floor('2026-11-09-owner-asap-engine-2230z')
        self.assertEqual(hashlib.sha256(original_raw).hexdigest(), 'eab1577724880e91ae89a4f0e73fb5e3cd88bf5a7355331503f6ead38e93b2af')
        original_order = json.dumps(original, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(hashlib.sha256(original_order).hexdigest(), '8f54705ab0a0ffc15398a4633944f24d166999c6b304bec4491ad4f376d461b9')
        self.assertEqual(window['playerNoticeAt'], '2026-11-10T23:30:00Z')
        self.assertIn('ASAP today (Recommended)', window['ownerOrder'])
        self.assertIn('63c9285865a395ff3d333938e2af518b67a45288', window['ownerOrder'])
        self.assertEqual(windows['windows'][-6]['id'], '2026-11-09-owner-asap-engine-1530z')
        asap, asap_raw = self.historical_floor('2026-11-09-owner-asap-engine-1530z')
        self.assertEqual(hashlib.sha256(asap_raw).hexdigest(), '8cfd5e5343b7d688bb5249bb21efabd45d313de9b80e673d19aa829eb565037a')
        asap_order = json.dumps(asap, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(hashlib.sha256(asap_order).hexdigest(), 'f15bd75c7ce4e2866c87cd307af89fb162f0d9156407c5629f2cfb3a64ffaba4')
        self.assertEqual(windows['windows'][-7]['id'], '2026-11-08-horse-study-successor-engine-1820z')
        successor, successor_raw = self.historical_floor('2026-11-08-horse-study-successor-engine-1820z')
        self.assertEqual(hashlib.sha256(successor_raw).hexdigest(), 'b0cd81bf0f6cff39992da1f8918bce916e112e78ee7f69a33f840b5bc5b687f0')
        successor_order = json.dumps(successor, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(hashlib.sha256(successor_order).hexdigest(), '25f70505f62297bf845e1bb068507de89ca14e78be0c3b56f09fb7e7b236984a')
        self.assertEqual(windows['windows'][-8]['id'], '2026-11-07-cash-room-realism-engine-2230z')
        previous, previous_raw = self.historical_floor('2026-11-07-cash-room-realism-engine-2230z')
        self.assertEqual(hashlib.sha256(previous_raw).hexdigest(), '4e75ef16ef642d53e69139e045cabd23064a5baa55a50d0e2f13c5272ce22769')
        previous_order = json.dumps(previous, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(hashlib.sha256(previous_order).hexdigest(), '990c9ccdeb5e42b95176194099f2dac8557e207e6a7656c80c9ce8f2d481bad3')
        self.assertEqual(windows['windows'][-9]['id'], '2026-11-07-horse-fold-provenance-engine-1800z')
        current = self.owner_record(window_id='2026-11-10-owner-asap-engine-2350z')
        self.assertEqual(current['ownerWindowId'], '2026-11-10-owner-asap-engine-2350z')
        self.assertTrue(current['supersedesPhase1Schedule'])
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 18600)

    def test_process_actor_continuation_preserves_prior_floor_and_expiry(self):
        import hashlib
        old = {'schema': floor.OWNER_CAPABILITY, 'preparationAt': '2026-11-03T20:30:00Z',
               'activationAt': '2026-11-03T20:30:00Z', 'expiresAt': '2026-11-03T23:30:00Z',
               'timeZone': 'America/Chicago', 'ownerWindowId': '2026-11-03-tournament-qualified-capacity-continuation',
               'clientPublicationAt': '2026-11-03T20:30:00Z'}
        doc = json.loads((ROOT/'server/release/owner-maintenance-windows.json').read_text())
        prior = next(w for w in doc['windows'] if w['id'] == old['ownerWindowId'])
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256((json.dumps(old, indent=2)+'\n').encode()).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), (old['activationAt'], old['expiresAt']))
        current = self.owner_record(window_id='2026-11-03-tournament-process-actor-continuation')
        self.assertEqual(current['ownerWindowId'], '2026-11-03-tournament-process-actor-continuation')
        floor.check_window(current, current['expiresEpoch']-420, current['expiresEpoch'], 'admit')
        for now in [current['activationEpoch']-1, current['expiresEpoch']-419, current['expiresEpoch']]:
            with self.assertRaises(ValueError): floor.check_window(current, now, current['expiresEpoch'], 'admit')


    def test_manager_serial_continuation_preserves_prior_floor_and_expiry(self):
        import hashlib
        prior, raw = self.historical_floor('2026-11-03-tournament-process-actor-continuation')
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), ('2026-11-03T23:00:00Z','2026-11-04T02:00:00Z'))
        current = self.owner_record(window_id='2026-11-04-tournament-manager-serial-continuation')
        self.assertEqual(current['ownerWindowId'], '2026-11-04-tournament-manager-serial-continuation')
        self.assertEqual(current['expiresEpoch']-current['activationEpoch'], 10800)
        floor.check_window(current,current['expiresEpoch']-420,current['expiresEpoch'],'admit')
        for now in [current['activationEpoch']-1,current['expiresEpoch']-419,current['expiresEpoch']]:
            with self.assertRaises(ValueError): floor.check_window(current,now,current['expiresEpoch'],'admit')

    def test_census_suffix_continuation_preserves_prior_floor_and_expiry(self):
        import hashlib
        prior, raw = self.historical_floor('2026-11-04-tournament-manager-serial-continuation')
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), ('2026-11-04T01:00:00Z','2026-11-04T04:00:00Z'))
        current = self.owner_record(window_id='2026-11-04-tournament-census-suffix-continuation')
        self.assertEqual(current['ownerWindowId'], '2026-11-04-tournament-census-suffix-continuation')
        self.assertEqual(current['expiresEpoch']-current['activationEpoch'], 10800)
        floor.check_window(current,current['expiresEpoch']-420,current['expiresEpoch'],'admit')
        for now in [current['activationEpoch']-1,current['expiresEpoch']-419,current['expiresEpoch']]:
            with self.assertRaises(ValueError): floor.check_window(current,now,current['expiresEpoch'],'admit')

    def test_creation_qualification_continuation_preserves_prior_floor_and_expiry(self):
        import hashlib
        prior, raw = self.historical_floor('2026-11-04-tournament-census-suffix-continuation')
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), ('2026-11-04T03:00:00Z','2026-11-04T06:00:00Z'))
        current = self.owner_record(window_id='2026-11-04-tournament-creation-qualification-continuation')
        self.assertEqual(current['ownerWindowId'], '2026-11-04-tournament-creation-qualification-continuation')
        self.assertEqual(current['expiresEpoch']-current['activationEpoch'], 10800)
        floor.check_window(current,current['expiresEpoch']-420,current['expiresEpoch'],'admit')
        for now in [current['activationEpoch']-1,current['expiresEpoch']-419,current['expiresEpoch']]:
            with self.assertRaises(ValueError): floor.check_window(current,now,current['expiresEpoch'],'admit')

    def test_original_retirement_continuation_preserves_prior_floor_and_expiry(self):
        import hashlib
        prior, raw = self.historical_floor('2026-11-04-tournament-creation-qualification-continuation')
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), ('2026-11-04T04:30:00Z','2026-11-04T07:30:00Z'))
        current = self.owner_record(window_id='2026-11-04-tournament-original-retirement-join')
        self.assertEqual(current['ownerWindowId'], '2026-11-04-tournament-original-retirement-join')
        self.assertEqual(current['expiresEpoch']-current['activationEpoch'], 10800)
        floor.check_window(current,current['expiresEpoch']-420,current['expiresEpoch'],'admit')
        for now in [current['activationEpoch']-1,current['expiresEpoch']-419,current['expiresEpoch']]:
            with self.assertRaises(ValueError): floor.check_window(current,now,current['expiresEpoch'],'admit')

    def test_owned_renewal_observation_preserves_prior_floor_and_fixed_expiry(self):
        import hashlib
        prior, raw = self.historical_floor('2026-11-04-tournament-original-retirement-join')
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), ('2026-11-04T07:00:00Z','2026-11-04T10:00:00Z'))
        current = self.owner_record(window_id='2026-11-04-tournament-owned-renewal-observation')
        self.assertEqual(current['ownerWindowId'], '2026-11-04-tournament-owned-renewal-observation')
        self.assertEqual(current['expiresEpoch']-current['activationEpoch'], 12600)
        floor.check_window(current,current['expiresEpoch']-420,current['expiresEpoch'],'admit')
        for now in [current['activationEpoch']-1,current['expiresEpoch']-419,current['expiresEpoch']]:
            with self.assertRaises(ValueError): floor.check_window(current,now,current['expiresEpoch'],'admit')

    def test_canonical_source_continuation_preserves_prior_floor_and_fixed_expiry(self):
        import hashlib
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        window = next(w for w in windows['windows'] if w['id'] == '2026-11-04-tournament-canonical-source-continuation')
        self.assertEqual(window['contains'], 'ca851a52893d75c2041b85db298b04eeba830c4a')
        prior, raw = self.historical_floor('2026-11-04-tournament-owned-renewal-observation')
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), ('2026-11-04T08:30:00Z','2026-11-04T12:00:00Z'))
        current = self.owner_record(window_id='2026-11-04-tournament-canonical-source-continuation')
        self.assertEqual(current['ownerWindowId'], '2026-11-04-tournament-canonical-source-continuation')
        self.assertEqual(current['expiresEpoch']-current['activationEpoch'], 21600)
        floor.check_window(current,current['expiresEpoch']-420,current['expiresEpoch'],'admit')
        for now in [current['activationEpoch']-1,current['expiresEpoch']-419,current['expiresEpoch']]:
            with self.assertRaises(ValueError): floor.check_window(current,now,current['expiresEpoch'],'admit')

    def test_immediate_relaunch_continuation_preserves_history_and_full_reserves(self):
        import hashlib
        prior, raw = self.historical_floor('2026-11-04-tournament-canonical-source-continuation')
        self.assertEqual(prior['releaseWitness']['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual((prior['notBefore'], prior['notAfter']), ('2026-11-04T12:00:00Z', '2026-11-04T18:00:00Z'))
        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())
        window = next(w for w in windows['windows'] if w['id'] == '2026-11-04-tournament-immediate-relaunch-continuation')
        self.assertEqual(window['contains'], 'f986e7020b3d1f8c18a4de0c533c49c6b6401f4e')
        self.assertEqual((window['notBefore'], window['notAfter']), ('2026-11-04T17:45:00Z', '2026-11-04T23:45:00Z'))
        self.assertEqual(window['announcementPolicy'], 'earliest-certified')
        self.assertTrue(window['supersedesPhase1Schedule'])
        current = self.owner_record()
        self.assertEqual(current['ownerWindowId'], window['id'])
        self.assertEqual(current['expiresEpoch'] - current['activationEpoch'], 21600)
        for now in (current['activationEpoch'], current['activationEpoch'] + 1, current['expiresEpoch'] - 420):
            floor.check_window(current, now, current['expiresEpoch'], 'admit')
        for now in (current['activationEpoch'] - 1, current['expiresEpoch'] - 419, current['expiresEpoch']):
            with self.assertRaises(ValueError): floor.check_window(current, now, current['expiresEpoch'], 'admit')

    def test_owner_reservation_binds_run_target_cause_and_full_window(self):
        r = self.owner_record(); root = self.repo / 'state'; root.mkdir()
        path = root / 'engine-recovery-window-123-1.json'
        value = {'sha':self.sha,'runId':'123-1','cause':'urgent','announcedAt':r['activationEpoch']*1000}
        path.write_text(json.dumps(value)); path.chmod(0o600)
        self.assertEqual(floor.reservation(r,str(root),'123-1'),value['announcedAt'])
        for changed in [{'sha':'a'*40},{'runId':'124-1'},{'cause':'engine-degraded'},{'announcedAt':(r['expiresEpoch']-419)*1000}]:
            path.write_text(json.dumps({**value,**changed}))
            with self.assertRaises(ValueError): floor.reservation(r,str(root),'123-1')

    def test_actual_owner_certificate_binds_existing_window_and_refuses_shortcut(self):
        import datetime
        r = self.owner_record(); stamp = r['activationEpoch']*1000
        source = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        guard = source[source.index('import os\nfrom datetime import datetime'):source.index('remaining=int(m.get')]
        now = r['activationEpoch']+120
        class Clock(datetime.datetime):
            @classmethod
            def now(cls,tz=None): return datetime.datetime.fromtimestamp(now,tz)
        with patch('datetime.datetime',Clock), patch('time.time',return_value=now), patch.dict(os.environ,{'ACTIVATION_FLOOR_END_EPOCH':str(r['expiresEpoch']),'ACTIVATION_FLOOR_OWNER_WINDOW':r['ownerWindowId'],'FLOOR_ANNOUNCED_AT':str(stamp)}):
            exec(guard,{'m':{'reason':'Deployment Recovery','breakEndsAt':stamp+420000}})
            for m in [{'reason':'Scheduled Engine Maintenance','breakEndsAt':stamp+420000},{'reason':'Deployment Recovery','breakEndsAt':stamp+420001}]:
                with self.assertRaises(SystemExit): exec(guard,{'m':m})
            # The former daily-only guard refused this same owner window.
            before = guard[:guard.index('    if os.environ.get("ACTIVATION_FLOOR_OWNER_WINDOW")')] + '    if not daily: raise SystemExit(1)\n'
            with self.assertRaises(SystemExit): exec(before,{'m':{'reason':'Deployment Recovery','breakEndsAt':stamp+420000}})

    def test_actual_reservation_entry_survives_unknown_ack_and_checkpoint_no_action(self):
        r = self.owner_record(); root=self.repo/'requests';root.mkdir()
        source=(ROOT/'server/scripts/engine-release-transaction.sh').read_text()
        start=source.index('  FLOOR_RESERVATION_FRESH=0\n  if [ -n "${ACTIVATION_FLOOR_OWNER_WINDOW:-}" ] || [ "${PHASE1_CYCLE_START:-0}" -gt 0 ]; then')
        end=source.index('  reserve_args=',start)
        body=source[start:end]
        import shlex
        command=' '.join(shlex.quote(x) for x in ['python3',str(self.repo/HELPER),'announcement-entry','--repo',str(self.repo),'--target',self.sha,'--control',self.sha,'--deadline',str(r['expiresEpoch']+100),'--request-root',str(root),'--run-id','123-1'])
        # Actual durable helper is exercised with an explicit injected clock;
        # shell ordering exercises the actual reservation entry fragment.
        floor.entry_state(r,str(root),'123-1',True,r['activationEpoch'],r['expiresEpoch']+100,True)
        result=subprocess.run([BASH,'-c','set -eu\nACTIVATION_FLOOR_OWNER_WINDOW=fixture\nFLOOR_DISPOSITION=never-entered\nrecord_floor_runtime_entry() { '+command+'; }\n'+body+'[ "$FLOOR_DISPOSITION" = announced ]\n'],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.git('update-ref','-d','refs/remotes/origin/main')
        result=subprocess.run(['python3',str(self.repo/HELPER),'disposition','--repo',str(self.repo),'--target',self.sha,'--control',self.sha,'--deadline','1','--request-root',str(root),'--run-id','123-1'],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout.strip(),'announced')
        self.assertLess(source.index('    record_floor_runtime_entry',start),source.index('reserve-recovery-window',start))
        self.git('update-ref','refs/remotes/origin/main',self.sha)
        floor.entry_state(r,str(root),'123-1',True,r['activationEpoch']+120,r['expiresEpoch']+100)
        state=self.repo/'state';state.mkdir()
        receipt=state/'engine-recovery-window-123-1.json'
        receipt.write_text(json.dumps({'runId':'123-1','sha':self.sha,'cause':'urgent','announcedAt':r['activationEpoch']*1000}));receipt.chmod(0o600)
        intent=root/'123-1.legacy-checkpoint-intent';intent.write_text('uncertain')
        with self.assertRaises(ValueError): floor.checkpoint_no_action(r,str(root),str(state),'123-1')
        self.assertEqual(floor.entry_state(r,str(root),'123-1',False,0,0),'entered')
        intent.unlink()
        self.assertEqual(floor.checkpoint_no_action(r,str(root),str(state),'123-1'),'announced')
        self.assertEqual(floor.entry_state(r,str(root),'123-1',False,0,0),'announced')


    def test_known_no_reservation_retires_only_new_intent_and_foreign_owner_refuses(self):
        r=self.owner_record();root=self.repo/'requests';root.mkdir();state=self.repo/'state';state.mkdir()
        floor.entry_state(r,str(root),'123-1',True,r['activationEpoch'],r['expiresEpoch']+100,True)
        source=(ROOT/'server/scripts/engine-release-transaction.sh').read_text()
        start=source.index('retire_unannounced_floor_entry() {');end=source.index('\n# THE NEWEST WAITING RELEASE',start)
        body=source[start:end]
        env={**os.environ,'REQUEST_ROOT':str(root),'ENGINE_RELEASE_STATE_DIR':str(state),'RUN_ID':'123-1','FLOOR_RESERVATION_FRESH':'1','FLOOR_DISPOSITION':'announced'}
        reservation=state/'engine-recovery-window-123-1.json';reservation.write_text('{}')
        result=subprocess.run([BASH,'-c','set -eu\n'+body+'\nretire_unannounced_floor_entry'],env=env,capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0);self.assertTrue((root/'123-1.activation-entry').exists())
        reservation.unlink()
        result=subprocess.run([BASH,'-c','set -eu\n'+body+'\nretire_unannounced_floor_entry\n[ "$FLOOR_DISPOSITION" = never-entered ]'],env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr);self.assertFalse((root/'123-1.activation-entry').exists())
        start=source.index('refuse_foreign_floor_owner() {');end=source.index('\nretire_unannounced_floor_entry()',start)
        body=source[start:end]
        for status in (0,2):
            prefix='set -eu\nFLOOR_DISPOSITION=never-entered\ndie() { exit 71; }\nnewer_release_in_flight() { return '+str(status)+'; }\n'
            result=subprocess.run([BASH,'-c',prefix+body+'\nrefuse_foreign_floor_owner'],capture_output=True,text=True)
            self.assertEqual(result.returncode,71)


    def test_exact_feature_witness_survives_squash_and_shared_base_release(self):
        base=self.sha
        r=self.owner_record()
        source=(ROOT/'server/scripts/engine-release-transaction.sh').read_text()
        start=source.index('owner_window_reason() {');end=source.index('\n# The seal and the serving engine',start)
        body=source[start:end]
        # The selected window may restrict announcements to a Chicago minute
        # (the :53 notice before the :55 tournament break); evaluate at the
        # first such instant inside the window rather than at a random minute.
        windows_doc=json.loads((ROOT/'server/release/owner-maintenance-windows.json').read_text())
        selected=next(w for w in windows_doc['windows'] if w['id']==r['ownerWindowId'])
        minutes=selected.get('announceAtChicagoMinutes')
        from datetime import datetime,timezone
        from zoneinfo import ZoneInfo
        now=r['activationEpoch']+30
        while minutes and datetime.fromtimestamp(now,timezone.utc).astimezone(ZoneInfo('America/Chicago')).minute not in minutes:
            now+=60
        self.assertLess(now+420,r['expiresEpoch'])
        prefix='set -eu\ntimeout() { shift 3; "$@"; }\ndate() { echo '+str(now)+'; }\n'
        env={**os.environ,'REPO_DIR':str(self.repo),'SHA':self.sha,'ACTIVATION_FLOOR_OWNER_WINDOW':r['ownerWindowId']}
        import shlex
        fresh=selected.get('withinSecondsOfEngineStart')
        def reason(serving,uptime='fresh'):
            health={'releaseSha':serving}
            if uptime=='fresh':
                if fresh is not None: health['uptime']=fresh//2
            elif uptime is not None:
                health['uptime']=uptime
            result=subprocess.run([BASH,'-c',prefix+body+'\nowner_window_reason '+shlex.quote(json.dumps(health))],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            return result.stdout.strip()
        # The protected base already served, including the old daily manifest;
        # only this exact v2 blob consumes its new authorization.
        self.assertEqual(reason(base),'owner-ordered '+r['ownerWindowId'])
        if fresh is not None:
            # A fresh-engine window opens only while the serving process is at
            # most that old; an older, absent or malformed uptime grants nothing.
            self.assertEqual(reason(base,fresh),'owner-ordered '+r['ownerWindowId'])
            self.assertEqual(reason(base,fresh+1),'')
            self.assertEqual(reason(base,None),'')
            self.assertEqual(reason(base,'60'),'')
            self.assertEqual(reason(base,True),'')
        self.assertEqual(reason(self.sha),'')
        (self.repo/MANIFEST).unlink();removed=self.commit()
        self.assertEqual(reason(removed),'')
        # An unrelated named order cannot substitute for the selected one.
        env['ACTIVATION_FLOOR_OWNER_WINDOW']='foreign'
        self.assertEqual(reason(base),'')


    def test_preparation_and_admission_boundaries(self):
        r = self.record
        deadline = r['expiresEpoch'] + 10
        floor.check_window(r, r['preparationEpoch'], deadline, 'prepare')
        floor.check_window(r, r['activationEpoch'], deadline, 'admit')
        for now, mode in [(r['preparationEpoch'] - 1, 'prepare'),
                          (r['activationEpoch'] - 1, 'admit'),
                          (r['expiresEpoch'], 'admit')]:
            with self.subTest(now=now), self.assertRaises(ValueError):
                floor.check_window(r, now, deadline, mode)
        with self.assertRaises(ValueError):
            floor.check_window(r, r['preparationEpoch'], r['expiresEpoch'] - 1, 'prepare')

    def test_malformed_unknown_and_duplicate_metadata_refuse(self):
        source = DAILY
        for change in [{'schema': 'unknown'}, {'timeZone': 'UTC'}, {'unexpected': True},
                       {'activationAt': None}, {'expiresAt': '2026-10-30T10:00:00Z'}]:
            with self.subTest(change=change):
                (self.repo / MANIFEST).write_text(json.dumps({**source, **change}))
                sha = self.commit()
                with self.assertRaises(ValueError):
                    floor.policy(str(self.repo), sha, sha)
        (self.repo / MANIFEST).write_text('{"schema":"a","schema":"b"}')
        sha = self.commit()
        with self.assertRaises(ValueError):
            floor.policy(str(self.repo), sha, sha)

    def test_old_control_or_changed_parser_cannot_ignore_target(self):
        (self.repo / HELPER).write_text('# old parser without admission\n')
        bad = self.commit()
        with self.assertRaises(ValueError):
            floor.policy(str(self.repo), self.sha, bad)

    def test_control_must_share_exact_policy_and_preinstall_guard(self):
        (self.repo / INTAKE).write_text('INSTALL_OUTPUT=early\n')
        bad = self.commit()
        with self.assertRaises(ValueError):
            floor.policy(str(self.repo), self.sha, bad)
        (self.repo / INTAKE).write_bytes((ROOT / INTAKE).read_bytes())
        (self.repo / MANIFEST).write_text((ROOT / MANIFEST).read_text() + '\n')
        bad = self.commit()
        with self.assertRaises(ValueError):
            floor.policy(str(self.repo), self.sha, bad)

    def test_missing_manifest_is_explicit_legacy_removal_not_expiry(self):
        (self.repo / MANIFEST).unlink()
        removed = self.commit()
        self.assertIsNone(floor.policy(str(self.repo), removed, removed))
        # The original pinned request still expires; newer removal cannot alter it.
        with self.assertRaises(ValueError):
            floor.check_window(self.record, self.record['expiresEpoch'], self.record['expiresEpoch'] + 100, 'admit')
        with self.assertRaises(subprocess.SubprocessError):
            floor.policy(str(self.repo), self.sha, removed)
        requests = self.repo / 'requests'
        requests.mkdir()
        command = ['python3', str(self.repo / HELPER), 'disposition', '--repo', str(self.repo),
                   '--target', removed, '--control', removed, '--deadline', str(int(time.time()) + 1200),
                   '--request-root', str(requests), '--run-id', '123-1']
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'legacy')
        self.git('update-ref', '-d', 'refs/remotes/origin/main')
        unknown = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(unknown.returncode, 0)
        self.assertNotIn('never-entered', unknown.stdout)


    def test_actual_intake_refuses_before_installer_even_for_emergency_signals(self):
        source = (ROOT / INTAKE).read_text()
        start = source.index('TARGET_SHA="${REQUEST_LINES[0]}"')
        end = source.index('INSTALL_RC=$?') + len('INSTALL_RC=$?')
        fragment = source[start:end]
        marker = self.repo / 'installed'
        prefix = 'set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\n'
        run_id = '123-1'
        expired_sha = self.sha
        self.future_record()
        request = [self.sha, self.sha, 'https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/actions/runs/123', 'fixture', str(int(time.time()) + 86400)]
        import shlex
        prefix += 'REQUEST_LINES=(' + ' '.join(shlex.quote(v) for v in request) + ')\n'
        env = {**os.environ, 'STAGE': str(self.repo), 'REPO_DIR': str(self.repo),
               'GITHUB_RUN_ID': '123', 'RUN_ID': run_id, 'FIXTURE_MARKER': str(marker),
               'RECOVERY_URGENT': '1', 'RECOVERY_OWNER_WINDOW': 'active',
               'RECOVERY_QUARANTINED_MANAGERS': '100', 'HEALTH_LIVENESS': 'dead'}
        # A floor whose boundary has not come refuses before the very same
        # installer boundary, whatever emergency signals say.
        result = subprocess.run([BASH, '-c', prefix + fragment], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('activation floor refused', result.stderr)
        self.assertFalse(marker.exists())
        # An EXPIRED floor is no floor (2026-10-30): the same intake admits the
        # target to the routine route, says so, and the installer runs.
        expired_request = [expired_sha, expired_sha, request[2], 'fixture', request[4]]
        expired_prefix = prefix.replace('REQUEST_LINES=(' + ' '.join(shlex.quote(v) for v in request) + ')',
                                        'REQUEST_LINES=(' + ' '.join(shlex.quote(v) for v in expired_request) + ')')
        result = subprocess.run([BASH, '-c', expired_prefix + fragment], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('routine daily maintenance route applies', result.stderr)
        self.assertEqual(marker.read_text(), 'installed')
        marker.unlink()
        # Regression control executes exactly the former pre-install fragment.
        guard_start = fragment.index('# The immutable target owns')
        guard_end = fragment.index('\nset +e', guard_start)
        before = fragment[:guard_start] + fragment[guard_end:]
        result = subprocess.run([BASH, '-c', prefix + before], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(marker.read_text(), 'installed')

    def test_receiver_gate_precedes_all_control_installation_and_failure_cleanup(self):
        source = (ROOT / '.github/workflows/auto-deploy-hetzner.yml').read_text()
        prepare = source.index("- name: Admit only the immutable target's preparation window")
        ssh = source.index('- name: Establish pinned ephemeral SSH transport', prepare)
        build = source.index('- name: Prepare the scheduled immutable image', ssh)
        wait = source.index('- name: Wait for the immutable activation floor', build)
        dispatch = source.index('- name: Dispatch the staged SHA', wait)
        self.assertLess(prepare, ssh)
        self.assertLess(build, wait)
        body = source[build:dispatch]
        for forbidden in ('install-engine-supervisor.sh', 'install-engine-intake.sh', 'launch-engine-release.sh', 'engine-release-recover', 'recovery-window'):
            self.assertNotIn(forbidden, body)
        self.assertNotIn('build-engine-image.sh', body)
        self.assertIn('get desired-image-id', body)
        self.assertIn('PREPARED_IMAGE', body)
        segment = source[dispatch:source.index('- name: Remove exact staging', dispatch)]
        self.assertLess(segment.index('engine-release-activation-floor.py" admit'), segment.index('"$STAGE/server/scripts/install-engine-intake.sh"'))
        cleanup = source[source.index('- name: Remove exact staging'):source.index('\n  record-receipt:')]
        self.assertIn('[ "$RELEASE_COMPLETED" = true ]', cleanup)
        self.assertNotIn('engine-release-recover', cleanup)


    def test_installed_v1_templates_accept_current_per_run_entrypoint(self):
        source = (ROOT / 'server/scripts/install-engine-intake.sh').read_text()
        # The installed unit invokes the authenticated per-run entrypoint;
        # neither frozen template embeds a hash of that entrypoint.
        import re
        templates = re.findall(r"cat > \"\$.*?_STAGE\" <<'UNIT'\n(.*?)\nUNIT", source, re.S)
        self.assertEqual(len(templates), 2)
        self.assertIn('ExecStart=/var/lib/club-arena/control-staging/%i/server/scripts/engine-release-intake.sh --run-id %i', templates[0])
        for content in templates:
            existing = self.repo / 'installed-unit'
            candidate = self.repo / 'candidate-unit'
            existing.write_text(content)
            candidate.write_text(content)
            self.assertEqual(subprocess.run(['cmp', '-s', str(existing), str(candidate)]).returncode, 0)
            candidate.write_text(content + '\nChanged=true\n')
            self.assertNotEqual(subprocess.run(['cmp', '-s', str(existing), str(candidate)]).returncode, 0)
        self.assertIn('frozen intake v1 unit differs; install a new protocol version instead', source)
        self.assertIn('frozen intake v1 path unit differs; install a new protocol version instead', source)

    def test_client_floor_is_independent_of_backlog_and_engine_expiry(self):
        import sys
        def invoke(target, control, now, deadline):
            # Run the actual publisher CLI over real immutable Git fixtures.
            # Only the clock is fixed; policy(), parser and check_window run.
            script = ("import runpy,sys; from unittest.mock import patch; "
                      "sys.argv=sys.argv[1:]; "
                      "clock=patch('time.time',return_value=" + str(now) + "); "
                      "clock.start(); runpy.run_path(sys.argv[0],run_name='__main__')")
            return subprocess.run([sys.executable, '-B', '-c', script,
                str(ROOT / HELPER), 'publish', '--repo', str(self.repo),
                '--target', target, '--control', control, '--deadline', str(deadline)],
                capture_output=True, text=True, timeout=HANG_GUARD_SECONDS)
        for r in (self.record, self.owner_record()):
            for now in (r['preparationEpoch']-1, r['activationEpoch']-1,
                        r['activationEpoch'], r['expiresEpoch']+1):
                with self.subTest(schema=r['schema'], now=now):
                    result = invoke(r['targetSha'], r['controlSha'], now, now+120)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    expected = r if now < r['expiresEpoch'] else {'schema': 'legacy-no-activation-floor'}
                    self.assertEqual(json.loads(result.stdout), expected)
            # All engine modes retain their exact early/expired refusals.
            for mode in ('prepare', 'admit', 'runtime'):
                for now in (r['preparationEpoch']-1, r['expiresEpoch']):
                    with self.subTest(mode=mode, now=now), self.assertRaises(ValueError):
                        floor.check_window(r, now, r['expiresEpoch']+120, mode)
            for now, deadline in ((0, 120), (True, 120), (1, 1)):
                with self.assertRaises(ValueError): floor.check_window(r, now, deadline, 'publish')
        # Publication remains fail-closed on protected identity, schema and
        # exact control source. A static client never bypasses policy().
        valid = self.sha
        now = self.record['preparationEpoch']-1
        result = invoke('a'*40, valid, now, now+120)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('activation floor refused:', result.stderr)
        for path, changed in ((MANIFEST, json.dumps({**DAILY, 'schema':'unknown'})),
                              (HELPER, '# incompatible control parser\n')):
            original = (self.repo/path).read_bytes()
            (self.repo/path).write_text(changed)
            bad = self.commit()
            result = invoke(bad if path == MANIFEST else valid, bad, now, now+120)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn('activation floor refused:', result.stderr)
            (self.repo/path).write_bytes(original)
            self.commit()
        caller = (ROOT / '.github/workflows/publish-club-arena.yml').read_text()
        self.assertIn('uses: ./.github/workflows/publish-club-arena-client.yml', caller)
        source = (ROOT / '.github/workflows/publish-club-arena-client.yml').read_text()
        production = source[source.index('  production:'):]
        self.assertIn('needs.publication-floor.result == \'success\'', production)
        self.assertIn('admit, client-tests, build-and-store, publication-floor]', production)
        admission = source[source.index('  publication-floor:'):source.index('  production:')]
        self.assertIn('engine-release-activation-floor.py publish', admission)
        self.assertIn('--target "$TARGET_SHA" --control "$TARGET_SHA"', admission)
        self.assertNotIn('outputs.publish', admission)
        self.assertNotIn('secrets:', admission)

    def test_actual_daily_certificate_guards_refuse_emergency_and_expiry(self):
        import io
        import datetime
        from unittest.mock import patch
        source = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        guard = source[source.index('import os\nfrom datetime import datetime'):source.index('remaining=int(m.get')]
        for reason, now, expected in [('Scheduled Engine Maintenance', self.record['activationEpoch'], True),
                                      ('Deployment Recovery', self.record['activationEpoch'], False),
                                      ('Scheduled Engine Maintenance', self.record['expiresEpoch'], False)]:
            class Clock(datetime.datetime):
                @classmethod
                def now(cls, tz=None):
                    return datetime.datetime.fromtimestamp(now, tz)
            with patch('datetime.datetime', Clock), patch('time.time', return_value=now), \
                 patch.dict(os.environ, {'ACTIVATION_FLOOR_END_EPOCH': str(self.record['expiresEpoch'])}):
                if expected:
                    exec(guard, {'m': {'reason': reason}})
                else:
                    with self.assertRaises(SystemExit):
                        exec(guard, {'m': {'reason': reason}})
        start = source.index('request_recovery_window() {')
        end = source.index('  now="$(date +%s)"', start)
        prefix = source[start:end] + '\n  echo unexpected-write\n}\nrequest_recovery_window\n'
        result = subprocess.run([BASH, '-c', 'set -eu\nRECOVERY_REQUESTED=0\nACTIVATION_FLOOR_END_EPOCH=1\n' + prefix], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertIn('CERTIFICATE_DEADLINE="$ACTIVATION_FLOOR_END_EPOCH"', source)


    def test_expired_floor_reads_as_no_floor_on_every_fresh_read(self):
        # Pure: a live record is untouched; at and after expiry it is None and
        # says which route applies. In-flight owner reads never come here.
        import io
        from contextlib import redirect_stderr
        r = self.record
        self.assertIs(floor.effective(r, r['expiresEpoch'] - 1), r)
        self.assertIs(floor.effective(None, r['expiresEpoch']), None)
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertIsNone(floor.effective(r, r['expiresEpoch']))
            self.assertIsNone(floor.effective(r, r['expiresEpoch'] + 86400 * 365))
        self.assertIn('routine daily maintenance route applies', err.getvalue())
        self.assertIn('engine-release-activation-floor/v1 (daily)', err.getvalue())
        # An owner window names itself in the same line.
        o = self.owner_record()
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertIsNone(floor.effective(o, o['expiresEpoch']))
        self.assertIn('(' + o['ownerWindowId'] + ')', err.getvalue())
        self.assertIs(floor.effective(o, o['expiresEpoch'] - 1), o)
        # The CLI, on the real clock, over the expired fixture floor: every
        # fresh admission mode is the routine route, and no entry is created.
        self.sha = self.git('rev-parse', 'HEAD~1')
        self.git('update-ref', 'refs/remotes/origin/main', self.git('rev-parse', 'HEAD'))
        requests = self.repo / 'requests'
        requests.mkdir()
        deadline = str(int(time.time()) + 7200)
        for mode in ('prepare', 'admit', 'publish', 'wait'):
            with self.subTest(mode=mode):
                result = subprocess.run(['python3', str(self.repo / HELPER), mode, '--repo', str(self.repo),
                                         '--target', self.sha, '--control', self.sha, '--deadline', deadline],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), {'schema': 'legacy-no-activation-floor'})
                self.assertIn('routine daily maintenance route applies', result.stderr)
        for mode in ('entry-check', 'disposition', 'entry', 'announcement-entry'):
            with self.subTest(mode=mode):
                result = subprocess.run(['python3', str(self.repo / HELPER), mode, '--repo', str(self.repo),
                                         '--target', self.sha, '--control', self.sha, '--deadline', deadline,
                                         '--request-root', str(requests), '--run-id', '123-1'],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), 'legacy')
        self.assertFalse((requests / '123-1.activation-entry').exists())
        # An owner that ANNOUNCED inside the window keeps its exact record on
        # the promoting `entry` read even after the window has expired: the
        # expired-floor fallback is for fresh reads only.
        o_root = self.repo / 'owner-requests'
        o_root.mkdir()
        floor.entry_state(o, str(o_root), '77-1', True, o['activationEpoch'], o['expiresEpoch'] + 100, True)
        with patch.object(floor, 'policy', return_value=o), patch('time.time', return_value=float(o['expiresEpoch'] + 1)):
            import io
            from contextlib import redirect_stdout
            out = io.StringIO()
            with redirect_stdout(out), patch('sys.argv', ['floor', 'entry', '--repo', str(self.repo), '--target', o['targetSha'],
                                                         '--control', o['controlSha'], '--deadline', str(o['expiresEpoch'] + 100),
                                                         '--request-root', str(o_root), '--run-id', '77-1']):
                with self.assertRaises(ValueError):
                    # Promotion past expiry is refused by check_window with the
                    # exact record - not silently downgraded to 'legacy'.
                    floor.main()
            self.assertNotIn('legacy', out.getvalue())
        # A manifest that is malformed is still a refusal, never a fallback.
        (self.repo / MANIFEST).write_text(json.dumps({**DAILY, 'schema': 'engine-release-activation-floor/v9'}))
        bad = self.commit()
        result = subprocess.run(['python3', str(self.repo / HELPER), 'admit', '--repo', str(self.repo),
                                 '--target', bad, '--control', bad, '--deadline', deadline], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('activation floor refused', result.stderr)

    def test_runtime_entry_is_durable_and_expiry_never_creates_it(self):
        root = self.repo / 'requests'
        root.mkdir()
        r = self.record
        self.assertEqual(floor.entry_state(r, str(root), '123-1', False, r['expiresEpoch'], r['expiresEpoch'] + 100), 'never-entered')
        with self.assertRaises(ValueError):
            floor.entry_state(r, str(root), '123-1', True, r['expiresEpoch'], r['expiresEpoch'] + 100)
        self.assertFalse((root / '123-1.activation-entry').exists())
        self.assertEqual(floor.entry_state(r, str(root), '123-1', True, r['activationEpoch'], r['expiresEpoch'] + 100), 'entered')
        self.assertEqual(floor.entry_state(r, str(root), '123-1', False, r['expiresEpoch'], 1), 'entered')
        (root / '123-1.activation-entry').write_text('{}')
        with self.assertRaises(ValueError):
            floor.entry_state(r, str(root), '123-1', False, r['expiresEpoch'], 1)
        self.assertEqual(floor.entry_state(None, str(root), '123-1', False, 0, 0), 'legacy')

    def test_actual_recovery_skips_runtime_only_for_proved_never_entered(self):
        import shlex
        root = self.repo / 'requests'
        root.mkdir()
        control = self.repo / 'server/scripts'
        events = self.repo / 'runtime-events'
        for file in ('engine-release-seal.py', 'engine-supervisor.sh'):
            path = control / file
            path.write_text('#!/usr/bin/env bash\n[ "${1:-}" != prove-expired-recovery-announcement ] || exit 1\necho runtime >> "$FIXTURE_EVENTS"\n')
            path.chmod(0o755)
        (control / 'control-sha').write_text(self.sha + '\n')
        request = root / '123-1.request'
        request.write_text('\n'.join([self.sha, 'url', 'actor', str(control), self.sha, str(self.record['expiresEpoch'] + 100)]) + '\n')
        source = (ROOT / 'server/scripts/engine-release-recover.sh').read_text()
        fragment = source[source.index('mapfile -t FLOOR_REQUEST'):source.index('if [ "$RECOVERY_MODE" = retryable ]; then')]
        prefix = """set -euo pipefail
recovery_remaining() { echo 100; }
bounded_recovery_command() { shift; "$@"; }
flock() { echo lock >> "$FIXTURE_EVENTS"; }
docker() { echo docker >> "$FIXTURE_EVENTS"; }
"""
        # Reuse the maintained fixture-only Bash3 mapfile adapter; Linux
        # executes the production builtin. No release behavior is replaced.
        import ast
        adapter_tree = ast.parse((ROOT / 'tests/operations/engine-drill-admission.py').read_text())
        adapter = next(ast.literal_eval(node.value) for node in adapter_tree.body
                       if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PORTABLE_ROOT' for t in node.targets))
        prefix += adapter[adapter.index('if ! help mapfile'):] + '\n'
        env = {**os.environ, 'REQUEST_ROOT': str(root), 'RUN_ID': '123-1', 'CONTROL_DIR': str(control),
               'REPO_DIR': str(self.repo), 'ENGINE_LOCK': str(self.repo / 'lock'), 'FIXTURE_EVENTS': str(events),
               'RECOVERY_DEADLINE_EPOCH': '9999999999', 'CONTAINER': 'fixture', 'PUBLIC_URL': 'fixture'}
        # The fixture floor has expired, so a fresh request on it is a routine
        # (legacy) request and recovery restores the sealed runtime as before
        # any floor existed - it is never refused and never 'never-entered'.
        result = subprocess.run([BASH, '-c', prefix + fragment], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('routine daily maintenance route applies', result.stderr)
        self.assertIn('runtime', events.read_text())
        events.unlink()
        # A floor that still holds: a request that never entered has no
        # authority to restore the live predecessor.
        live = self.future_record()
        (control / 'control-sha').write_text(self.sha + '\n')
        request.write_text('\n'.join([self.sha, 'url', 'actor', str(control), self.sha, str(live['expiresEpoch'] + 100)]) + '\n')
        result = subprocess.run([BASH, '-c', prefix + fragment], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(events.exists())
        floor.entry_state(live, str(root), '123-1', True, live['activationEpoch'], live['expiresEpoch'] + 100)
        self.git('update-ref', '-d', 'refs/remotes/origin/main')
        result = subprocess.run([BASH, '-c', prefix + fragment], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('runtime', events.read_text())
        events.unlink()
        (root / '123-1.activation-entry').write_text('{}')
        result = subprocess.run([BASH, '-c', prefix + fragment], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(events.exists())
        # A durable announcement is ownership, not permission to restore an
        # untouched predecessor. Exercise the actual recovery branch.
        r = self.owner_record()
        (root / '123-1.activation-entry').unlink()
        (control / 'control-sha').write_text(self.sha + '\n')
        request.write_text('\n'.join([self.sha, 'url', 'actor', str(control), self.sha, str(r['expiresEpoch']+100)])+'\n')
        floor.entry_state(r,str(root),'123-1',True,r['activationEpoch'],r['expiresEpoch']+100,True)
        result = subprocess.run([BASH, '-c', prefix + fragment], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode,75,result.stderr)
        self.assertEqual(events.read_text().splitlines(), ['lock'])
        self.assertTrue(request.exists())


    def test_expired_original_announcement_finishes_only_through_its_failed_receipt(self):
        import shlex
        import sys
        control = self.repo / 'server/scripts'
        for name in ('engine-release-seal.py', 'engine-release-database-proof.py', 'engine-release-lightning-hold.py'):
            path = control / name
            path.write_bytes((ROOT / 'server/scripts' / name).read_bytes()); path.chmod(0o755)
        record = self.owner_record()
        for name in ('engine-release-recover.sh',): (control / name).chmod(0o755)
        state_root = self.repo / 'state'; state_root.mkdir()
        requests = self.repo / 'requests'; requests.mkdir()
        pins = self.repo / 'pins'; pins.mkdir()
        leases = self.repo / 'leases'; leases.mkdir()
        results = state_root / 'results'; results.mkdir()
        run, invocation = '41904788070-1', 'e' * 32
        stamp = 1793824762499  # Original20:39:22.499, not an invented later window.
        desired = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
        image = 'sha256:2eb1c5a7279032240c5fff8a6b3ecf5dc6af735cc1227a51430d50dcae1b065b'
        base = {'schema': 1, 'desired': {'sha': desired, 'imageId': image, 'legacyUnlabelled': False},
                'highWaterSha': desired, 'generation': 1, 'updatedAt': 1793824800,
                'pending': None, 'finalization': None, 'committedRuns': {}}
        (control / 'control-sha').write_text(self.sha + '\n')
        lines = [self.sha, 'https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/actions/runs/41904788070',
                 'fixture', str(control), self.sha, str(record['expiresEpoch'] + 100)]
        request = requests / (run + '.request')
        def reset():
            (state_root / 'seal.json').write_text(json.dumps(base))
            for path in list(requests.iterdir()) + list(results.iterdir()) + list(pins.iterdir()): path.unlink()
            request.write_text('\n'.join(lines) + '\n'); request.chmod(0o600)
            (requests / (run + '.intent')).write_bytes(request.read_bytes())
            (pins / (run + '.generation')).write_text(str(control) + '\n' + self.sha + '\n')
            (leases / (run + '.lease')).write_text('fixture')
            floor.entry_state(record, str(requests), run, True, record['activationEpoch'], record['expiresEpoch']+100, True)
            reservation = state_root / ('engine-recovery-window-' + run + '.json')
            reservation.write_text(json.dumps({'runId': run, 'sha': self.sha, 'cause': 'urgent', 'announcedAt': stamp}))
            reservation.chmod(0o600)
        reset()
        # Real source parser, seal state, immutable failure/audit, actual wrapper
        # failure branch and full recovery/cleanup. Only native host interfaces
        # (root metadata, systemd, Docker, cgroup, DB/health) are supplied locally.
        driver = self.repo / 'native-host-fixture.py'
        driver.write_text(r"""
import importlib.util,json,os,sys
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('owned_seal',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=m.failed_routine_command
mode=os.environ.get('FIXTURE_CASE','positive')
def command(args,deadline,limit=32768,**kwargs):
    if '--terminal-owned-thaw' not in args: return original(args,deadline,limit,**kwargs)
    if mode=='thaw': m.die('fixture incomplete own thaw')
    return json.dumps({'schema':'terminal-owned-thaw/v1','sha':m.FAILED_ROUTINE_DESIRED,'instanceId':'1-9349c742',
        'databaseIdle':True,'freshLeader':True,'ownedV3Thaw':True,
        **{k:int(args[args.index(flag)+1]) for k,flag in [('announcedAt','--window-announced-ms'),('startsAt','--window-starts-ms'),('endsAt','--window-ends-ms')]}})
calls=0
def runtime(*args,**kwargs):
    global calls
    calls+=1
    return {'containerId':'d'*64,'startedAt':'2026-11-04T19:58:58Z','instanceId':'1-9349c742' if mode!='changed-runtime' or calls==1 else '1-ffffffff'}
original_read=Path.read_text
original_stat=Path.lstat
original_fstat=os.fstat
def fstat(fd):
    value=list(original_fstat(fd));value[4]=0;return os.stat_result(value)
def read(path,*args,**kwargs):
    return '0::/original-owner\n' if str(path)=='/proc/self/cgroup' else original_read(path,*args,**kwargs)
def stat(path,*args,**kwargs):
    value=list(original_stat(path,*args,**kwargs));value[4]=0;return os.stat_result(value)
with patch.object(m.os,'geteuid',return_value=0),patch.object(m,'require_engine_lock'),\
     patch.object(m,'failed_routine_bytes',side_effect=lambda path,limit=65536:Path(path).read_bytes()),\
     patch.object(m,'native_unit',return_value={'LoadState':'loaded','ActiveState':'activating','SubState':'start','MainPID':'12','ControlPID':'0',
        'InvocationID':('f'*32 if mode=='foreign-unit' else os.environ['INVOCATION_ID']),'ControlGroup':'/original-owner'}),\
     patch.object(Path,'read_text',read),patch.object(Path,'lstat',stat),patch.object(os,'fstat',fstat),\
     patch.object(m,'failed_routine_runtime',side_effect=runtime),patch.object(m,'failed_routine_command',side_effect=command),\
     patch.object(m,'container_identity',return_value=('running',m.FAILED_ROUTINE_IMAGE)),\
     patch.object(m,'image_identity',return_value=(m.FAILED_ROUTINE_IMAGE,m.FAILED_ROUTINE_DESIRED,False)),\
     patch.object(m.time,'time',return_value=1793825200):
    sys.argv=sys.argv[1:];m.main()
""")
        bin_dir = self.repo / 'bin'; bin_dir.mkdir()
        python = bin_dir / 'python3'
        python.write_text('#!/usr/bin/env bash\n' +
            'if [[ "${1:-}" == */engine-release-seal.py ]]; then exec ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(driver)) + ' "$@"; fi\n' +
            'if [ "${1:-}" = - ] && [ "${2:-}" = /etc/systemd/system/multi-user.target.wants ]; then set -- - "$FIXTURE_ROOT"; fi\n' +
            'exec ' + shlex.quote(sys.executable) + ' "$@"\n'); python.chmod(0o755)
        for name, body in {'id':'echo 0', 'stat':'echo 0:600', 'flock':'exit 0',
                           'systemctl':'[ "$1" = disable ]',
                           'docker':'echo forbidden-runtime-command >&2; exit 91'}.items():
            path = bin_dir / name; path.write_text('#!/usr/bin/env bash\n' + body + '\n'); path.chmod(0o755)
        (control / 'retain-engine-images.sh').write_text('#!' + BASH + '\nexit 0\n')
        (control / 'retain-engine-images.sh').chmod(0o755)
        import ast
        adapter_tree = ast.parse((ROOT / 'tests/operations/engine-drill-admission.py').read_text())
        adapter = next(ast.literal_eval(n.value) for n in adapter_tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PORTABLE_ROOT' for t in n.targets))
        bash_env = self.repo / 'bash-env'; bash_env.write_text(adapter[adapter.index('if ! help mapfile'):])
        env = {**os.environ,'BASH_ENV':str(bash_env),'PATH':str(bin_dir)+os.pathsep+os.environ['PATH'],'PYTHONDONTWRITEBYTECODE':'1',
            'ENGINE_RELEASE_STATE_DIR':str(state_root),'ENGINE_RELEASE_STATE_FILE':str(state_root/'seal.json'),
            'ENGINE_RELEASE_LOCK_FILE':str(state_root/'seal.lock'),'ENGINE_RELEASE_AUDIT_FILE':str(state_root/'audit.jsonl'),
            'ENGINE_RELEASE_RESULT_DIR':str(results),'ENGINE_RELEASE_REQUEST_ROOT':str(requests),'ENGINE_RELEASE_PIN_ROOT':str(pins),
            'ENGINE_RELEASE_IMAGE_LEASE_ROOT':str(leases),'ENGINE_LOCK_FILE':str(self.repo/'engine.lock'),
            'REPO_DIR':str(self.repo),'INVOCATION_ID':invocation,'FIXTURE_ROOT':str(self.repo),'FIXTURE_CASE':'positive'}
        recover = [BASH, str(control/'engine-release-recover.sh'),'--run-id',run,'--mode','retryable']
        original = request.read_bytes()
        for bad in ('thaw','changed-runtime','foreign-unit'):
            result = subprocess.run(recover,env={**env,'FIXTURE_CASE':bad},capture_output=True,text=True,timeout=HANG_GUARD_SECONDS)
            self.assertEqual(result.returncode,75,result.stdout+result.stderr)
            self.assertEqual(request.read_bytes(),original)
            self.assertFalse(list(results.iterdir()))
        for suffix in ('legacy-checkpoint-intent','break-deadline','main-inspector-retirement-intent','lightning-hold.json'):
            path=requests/(run+'.'+suffix);path.write_text('unknown')
            result=subprocess.run(recover,env=env,capture_output=True,text=True,timeout=HANG_GUARD_SECONDS)
            self.assertNotEqual(result.returncode,0,result.stdout+result.stderr);path.unlink()
            self.assertEqual(request.read_bytes(),original)
        # A missing original reservation/entry is not no-entry success.
        reservation=state_root/('engine-recovery-window-'+run+'.json');saved=reservation.read_bytes();reservation.unlink()
        result=subprocess.run(recover,env=env,capture_output=True,text=True,timeout=HANG_GUARD_SECONDS)
        self.assertEqual(result.returncode,75,result.stdout+result.stderr)
        reservation.write_bytes(saved);reservation.chmod(0o600)
        # Run the ACTUAL wrapper failure branch, including both real recoveries,
        # record-failure and attest-failure, ending in its permanent exit1.
        wrapper=(ROOT/'server/scripts/engine-release-unit-wrapper.sh').read_text()
        start=wrapper.index('  # A permanent proof/application failure first restores')
        end=wrapper.index('\nfi\n\nRECOVERY_MODE=retryable',start)
        prefix='set -euo pipefail\nTRANSACTION_RC=1\nRUN_KEY='+shlex.quote(run)+'\nGENERATION='+shlex.quote(str(control))+'\nREQUEST_CONTROL_SHA='+self.sha+'\nCONTAINER=fixture\nREQUEST_LINES=('+shlex.quote(self.sha)+')\n'
        result=subprocess.run([BASH,'-c',prefix+wrapper[start:end]],env=env,capture_output=True,text=True,timeout=HANG_GUARD_SECONDS)
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertIn('expired-original-announcement-thawed',result.stdout)
        self.assertFalse(request.exists());self.assertFalse((requests/(run+'.activation-entry')).exists())
        self.assertFalse((pins/(run+'.generation')).exists());self.assertFalse((leases/(run+'.lease')).exists())
        failure=json.loads((results/(run+'.json')).read_text())
        self.assertEqual((failure['result'],failure['sha'],failure['controlSha'],failure['invocationId']),('failed',self.sha,self.sha,invocation))
        self.assertEqual(json.loads((state_root/'seal.json').read_text()),base)
        self.assertEqual(reservation.read_bytes(),saved)  # Immutable original reservation is never rewritten.
        audit=(state_root/'audit.jsonl').read_text();self.assertIn('failure_recorded',audit)
        # Resume the same terminal cleanup after its first pin/intent deletions.
        # Its actual immutable failure permits only these already-completed edges.
        saved_failure=(results/(run+'.json')).read_bytes()
        reset();(results/(run+'.json')).write_bytes(saved_failure)
        (pins/(run+'.generation')).unlink();(requests/(run+'.intent')).unlink()
        released=requests/(run+'.lightning-hold.json.released')
        receipt={'schema':'engine-release-lightning-hold/v2','run_id':run,'generation':1,'phase':'released',
            **{key:[] for key in ('candidates','held','already','unknown','resume_pending','released')},
            'refused':{},'resume_refused':{}}
        released.write_text(json.dumps(receipt));released.chmod(0o600)
        result=subprocess.run(recover[:-1]+['terminal'],env=env,capture_output=True,text=True,timeout=HANG_GUARD_SECONDS)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertFalse(request.exists());self.assertEqual(reservation.read_bytes(),saved)
        self.assertEqual((results/(run+'.json')).read_bytes(),saved_failure)

    def test_fresh_prework_cannot_restore_live_engine_and_entry_is_after_certificate(self):
        source = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        start = source.index('if [ "$FLOOR_DISPOSITION" = never-entered ] || [ "$FLOOR_DISPOSITION" = announced ]; then\n  # No runtime restoration')
        end = source.index('# Once this exact run crossed', start)
        body = source[start:end]
        result = subprocess.run([BASH, '-c', 'set -eu\nFLOOR_DISPOSITION=never-entered\nACTIVATION_FLOOR_END_EPOCH=9999999999\nprove_rollback_readiness() { echo read-only; }\n' + body], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), '')
        prework = source[source.index('FLOOR_DISPOSITION="$(python3'):start]
        self.assertIn('[ "$PENDING_STATE" != none ]', prework)
        first_entry = source.index('    record_floor_runtime_entry\n    LEGACY_CHECKPOINT_ATTEMPTED=1')
        self.assertLess(source.index('ENTRY_STARTED_MS="$(date +%s%3N)"'), first_entry)
        self.assertLess(first_entry, source.index('    "$LEGACY_CHECKPOINT" "$RUN_ID"', first_entry))
        recovery = (ROOT / 'server/scripts/engine-release-recover.sh').read_text()
        marker = recovery.index('rm -f -- "$REQUEST_ROOT/$RUN_ID.activation-entry"')
        self.assertLess(recovery.index('attest-terminal'), marker)
        self.assertLess(marker, recovery.index('rm -f -- "$REQUEST_FILE"'))
        wrapper = (ROOT / 'server/scripts/engine-release-unit-wrapper.sh').read_text()
        self.assertIn('"$GENERATION/engine-release-recover.sh" --run-id "$RUN_KEY" --mode retryable', wrapper)


    def test_actual_confirmed_checkpoint_no_action_retires_only_fresh_entry(self):
        import shlex
        root = self.repo / 'requests'
        root.mkdir()
        floor.entry_state(self.record, str(root), '123-1', True, self.record['activationEpoch'], self.record['expiresEpoch'] + 100)
        source = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
        start = source.index('      [ ! -e "$REQUEST_ROOT/$RUN_ID.legacy-checkpoint-intent" ]')
        end = source.index('      LEGACY_CHECKPOINT_ATTEMPTED=0', start)
        body = source[start:end]
        prefix = 'set -eu\ndie() { exit 1; }\n'
        env = {**os.environ, 'REQUEST_ROOT': str(root), 'RUN_ID': '123-1', 'FLOOR_DISPOSITION': 'never-entered'}
        (root / '123-1.legacy-checkpoint-intent').write_text('uncertain')
        result = subprocess.run([BASH, '-c', prefix + body], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(floor.entry_state(self.record, str(root), '123-1', False, 0, 0), 'entered')
        (root / '123-1.legacy-checkpoint-intent').unlink()
        result = subprocess.run([BASH, '-c', prefix + body], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(floor.entry_state(self.record, str(root), '123-1', False, 0, 0), 'never-entered')


if __name__ == '__main__':
    unittest.main()
