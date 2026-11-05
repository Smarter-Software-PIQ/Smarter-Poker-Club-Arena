#!/usr/bin/env python3
"""A terminal failed routine owner is released only by a locked, recorded proof.

Real seal module functions over isolated state files; host Docker, systemd,
/proc, health and database answers are supplied through the module's own probe
functions, never real host IO.
"""
from argparse import Namespace
from contextlib import redirect_stderr, redirect_stdout
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('terminal_owner_seal', ROOT / 'server/scripts/engine-release-seal.py')
seal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seal)
ORIGINAL_BOUNDED_COMMAND = seal.failed_routine_command
observer_spec = importlib.util.spec_from_file_location('terminal_owner_observer',
                                                       ROOT / 'scripts/ci/read-scoped-release-recovery.py')
observer = importlib.util.module_from_spec(observer_spec)
observer_spec.loader.exec_module(observer)

# Historical immutable source is fixture input. Hydrate its finite blob closure
# once before behavior assertions; later Git reads cannot open lazy transports.
history_spec = importlib.util.spec_from_file_location('pinned_history_sources',
                                                     ROOT / 'tests/operations/pinned-history-sources.py')
history = importlib.util.module_from_spec(history_spec)
history_spec.loader.exec_module(history)


def prepare_history(allow_fetch=False):
    history.hydrate_historical_sources(ROOT, [seal.DAILY_REFUSAL_SHA],
        ['server/scripts/' + name for name in seal.DAILY_REFUSAL_SOURCES],
        budget_seconds=90 if allow_fetch else 10, allow_fetch=allow_fetch)


def setUpModule():
    prepare_history()


# The one owner the terminal proof may release: the exact 9f census refusal.
DEAD_RUN = seal.NINEF_RUN
LIVE_RUN = '777000333-1'
A_SHA, B_SHA = 'eed06fe51dea622069c661a6213d5b031ff3a9e3', seal.NINEF_SHA
TARGET_SHA, CONTROL_SHA = 'c' * 40, 'c' * 40
A_IMAGE = 'sha256:2eb1c5a7279032240c5fff8a6b3ecf5dc6af735cc1227a51430d50dcae1b065b'
OTHER_IMAGE = 'sha256:' + 'c' * 64
CONTAINER = 'd' * 64
INVOCATION = 'e' * 32
INSTANCE = '1-2899e4d9'
GONE = {'LoadState': 'not-found', 'ActiveState': 'inactive', 'SubState': 'dead', 'MainPID': '0',
        'ControlPID': '0', 'Job': '', 'UnitFileState': ''}


class TerminalFailedRoutineOwner(unittest.TestCase):
    def setUp(self):
        # After the captured recovery, before the deliberately unsettled 10-hour case.
        clock = patch.object(seal.time, "time", return_value=1793622600)  # 2026-11-02 12:30 UTC
        clock.start(); self.addCleanup(clock.stop)
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        temporary = tempfile.TemporaryDirectory(prefix='terminal-owner-', dir=scratch)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        state_dir = self.root / 'state'
        (state_dir / 'results').mkdir(parents=True)
        for name, value in {'STATE_DIR': state_dir, 'STATE_FILE': state_dir / 'seal.json',
                            'AUDIT_FILE': state_dir / 'audit.jsonl', 'RESULT_DIR': state_dir / 'results',
                            'LOCK_FILE': state_dir / 'lock'}.items():
            if hasattr(seal, name):
                p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        self.request_root = self.root / 'requests'
        self.request_root.mkdir()
        env = patch.dict(os.environ, {'ENGINE_RELEASE_REQUEST_ROOT': str(self.request_root),
            'ENGINE_RELEASE_PIN_ROOT': str(self.root / 'pins'), 'ENGINE_RELEASE_INTAKE_ROOT': str(self.root / 'intake'),
            'ENGINE_RELEASE_IMAGE_LEASE_ROOT': str(self.root / 'leases'),
            'ENGINE_RELEASE_LOCK_FILE': str(state_dir / 'lock')})
        env.start(); self.addCleanup(env.stop)
        start = 1793592000
        self.start = start
        self.failure = {'schema': 1, 'runId': DEAD_RUN, 'result': 'failed', 'sha': B_SHA, 'controlSha': B_SHA,
            'invocationId': seal.NINEF_INVOCATION, 'transactionExitStatus': 1, 'recoveredDesiredSha': A_SHA,
            'recoveredDesiredImageId': A_IMAGE, 'completedAt': seal.NINEF_COMPLETED_AT}
        self.assertEqual(seal.failed_routine_digest(self.failure), seal.NINEF_FAILURE)
        self.window = dict(seal.NINEF_WINDOW)
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': seal.NINEF_POLICY_DIGEST,
            'startsAt': start, 'endsAt': start + 300, 'runId': DEAD_RUN, 'sha': B_SHA, 'controlSha': B_SHA,
            'status': 'reserved', 'failure': self.failure, 'window': self.window}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None, 'generation': 1,
            'updatedAt': start, 'routineMaintenanceCycles': {str(start): self.cycle}}
        self.intent = {'instance': '1-24d59baf', 'container': CONTAINER,
            'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(start - 3600)),
            'hostPid': 666945, 'source': A_SHA, 'runId': DEAD_RUN, 'controlSha': B_SHA, 'at': start + 19.4,
            'retryAllowed': False, 'nativeCensus': {'candidateSHA': B_SHA, 'sourceSHA256': seal.NINEF_CENSUS_SOURCE}}
        self.units, self.probes = {}, []
        self.mocks = {}
        for name, fake in {'failed_routine_unit_snapshot': self.native_unit,
                           'failed_routine_service_empty': self.service_empty,
                           'require_engine_lock': lambda _fd: None,
                           'terminal_inspect_container': self.container, 'failed_routine_command': self.command,
                           'terminal_proc_birth': self.birth, 'ninef_sources': self.sources,
                           'failed_routine_current': self.current,
                           # Production reads root-owned 0600 files only; the fixture runs unprivileged.
                           'failed_routine_json': lambda path: json.loads(Path(path).read_text())}.items():
            p = patch.object(seal, name, side_effect=fake); self.mocks[name] = p.start(); self.addCleanup(p.stop)
        self.reset()

    # host fakes
    def sources(self, _deadline, control=None, expected=None):
        if not self.sources_ok:
            seal.die('fixture source pin differs')
        return dict(expected or seal.NINEF_SOURCES)

    def current(self, args, _deadline):
        self.current_calls += 1
        return {'requestDigest': '0' * 64, 'unit': {'InvocationID': args.invocation_id},
                'drift': self.current_calls if self.current_drift else 0}

    def reset(self):
        seal.write_state(copy.deepcopy(self.base))
        seal.write_json_atomic(seal.result_path(DEAD_RUN), self.failure)
        seal.AUDIT_FILE.write_text('{"event":"original_fixture_receipt"}\n')
        for p in list(self.request_root.iterdir()) + list(seal.RESULT_DIR.glob('*.terminal-resolution.json')):
            p.unlink()
        self.units.clear(); self.probes.clear(); self.cgroup_empty = True; self.unit_flip = None
        self.sources_ok, self.current_calls, self.current_drift = True, 0, False
        self.write_intent()
        self.live = {'Id': CONTAINER, 'Image': A_IMAGE,
                     'State': {'Status': 'running', 'Pid': 758052,
                               'StartedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.start + 1600))}}
        self.health = {'releaseSha': A_SHA, 'status': 'ok', 'instanceId': INSTANCE, 'running': True,
                       'liveness': 'ok', 'maintenance': {'active': False, 'phase': 'idle', 'durableConfirmed': False}}
        self.public_health = None
        self.database = {'schema': 'terminal-owned-thaw/v1', 'sha': A_SHA, 'instanceId': INSTANCE,
                         'databaseIdle': True, 'freshLeader': True, 'ownedV3Thaw': True,
                         'announcedAt': self.window['announcedAt'], 'startsAt': self.window['startsAt'],
                         'endsAt': self.window['endsAt']}
        self.old_birth = None
        refusal = {'ok': False, 'reason': 'inspector cleanup not verified', 'retryAllowed': False,
                   'checkpointInvoked': False, 'inspectorClosed': False, 'cleanupConnections': 0,
                   'transportDetail': 'op=queryObjects,cause=request_timeout,method=Runtime.evaluate,'
                                      'allowanceMs=59000,waitedMs=59052,invoked=no'}
        self.journal = [{'MESSAGE': json.dumps(refusal), '_SYSTEMD_UNIT': f'club-arena-engine-release-v1@{DEAD_RUN}.service',
                         '_SYSTEMD_INVOCATION_ID': self.failure['invocationId'],
                         '__REALTIME_TIMESTAMP': str((self.start + 80) * 1000000)}]
        seal.TERMINAL_OWNER_SETTLE_MS = 60_000

    def native_unit(self, unit, _deadline=None):
        self.probes.append(unit)
        if unit in self.units:
            seal.die('fixture unit is not stopped/disabled')
        if self.unit_flip == unit and self.probes.count(unit) > 1:
            return {**GONE, 'Job': '9'}
        return dict(GONE)

    def service_empty(self, unit, _before, _deadline):
        if not self.cgroup_empty:
            seal.die('fixture cgroup retains a process')
        return unit

    def container(self, _deadline):
        self.probes.append('docker')
        return copy.deepcopy(self.live)

    def birth(self, _pid):
        return self.old_birth

    def command(self, command, _deadline, _limit=32768):
        self.probes.append(command[0])
        if command[0] == 'docker':
            if getattr(self,'inspector_open',False): raise ValueError('Inspector is open')
            return ''
        if command[0] == 'curl':
            local = '127.0.0.1' in command[-1]
            return json.dumps(self.health if local or self.public_health is None else self.public_health)
        if command[0] == 'journalctl':
            return '\n'.join(json.dumps(r) for r in self.journal)
        if command[0].endswith('engine-release-database-proof.py'):
            if isinstance(self.database, Exception):
                raise self.database
            return json.dumps(self.database)
        raise AssertionError(command)

    def quiet(self, call):
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()):
            call()
        return out.getvalue().strip()

    def refused(self, call):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            call()

    def resolve(self, invocation=INVOCATION):
        # Production runs as root; only the resolver sees euid 0 (the observer keeps the real owner check).
        with patch.object(seal.os, 'geteuid', return_value=0):
            return self.quiet(lambda: seal.cmd_resolve_terminal_routine_failures(
                Namespace(engine_lock_fd=9, run_id=LIVE_RUN, sha=TARGET_SHA, control_sha=CONTROL_SHA,
                          invocation_id=invocation)))

    def resolve_or_refusal(self):
        try:
            return self.resolve()
        except SystemExit:
            return 'refused'

    def owner(self, run_id=LIVE_RUN):
        return self.quiet(lambda: seal.cmd_check_routine_owner(Namespace(run_id=run_id)))

    def unit(self, prefix, extension, **fields):
        self.units[f'club-arena-engine-{prefix}-v1@{DEAD_RUN}.{extension}'] = fields

    def write_intent(self, **fields):
        (self.request_root / f'{DEAD_RUN}.legacy-checkpoint-intent').write_text(json.dumps({**self.intent, **fields}))

    def daily_fixture(self):
        self.failure={'schema':1,'runId':seal.DAILY_REFUSAL_RUN,'result':'failed','sha':seal.DAILY_REFUSAL_SHA,
            'controlSha':seal.DAILY_REFUSAL_SHA,'invocationId':'9fafe653d72d44cdafaad9e5b3667187',
            'transactionExitStatus':1,'recoveredDesiredSha':A_SHA,'recoveredDesiredImageId':A_IMAGE,'completedAt':1793613966}
        self.assertEqual(seal.failed_routine_digest(self.failure),seal.DAILY_REFUSAL_FAILURE)
        self.cycle={'kind':'hourly-reset','policyId':seal.SCHEDULE_POLICY_ID,'policyDigest':seal.NINEF_POLICY_DIGEST,
            'startsAt':1793613600,'endsAt':1793613900,'runId':seal.DAILY_REFUSAL_RUN,'sha':seal.DAILY_REFUSAL_SHA,
            'controlSha':seal.DAILY_REFUSAL_SHA,'status':'reserved','failure':self.failure}
        self.base['routineMaintenanceCycles']={'1793613600':self.cycle}
        seal.write_state(copy.deepcopy(self.base));seal.write_json_atomic(seal.result_path(seal.DAILY_REFUSAL_RUN),self.failure)
        self.database={'schema':'terminal-owned-thaw/v1','sha':A_SHA,'instanceId':INSTANCE,
            'databaseIdle':True,'freshLeader':True,'ownedV3Thaw':True,**seal.DAILY_REFUSAL_WINDOW}
        for name,value in [('docker_json',self.live),('image_identity',(A_IMAGE,A_SHA,True))]:
            p=patch.object(seal,name,return_value=value);p.start();self.addCleanup(p.stop)
        self.inspector_open=False

    def test_daily_unentered_owner_requires_real_terminal_cleanup_and_full_daily_thaw(self):
        self.daily_fixture()
        original=copy.deepcopy(self.cycle)
        self.assertEqual(self.resolve(),seal.DAILY_REFUSAL_RUN)
        state=seal.load_state();self.assertEqual(state['routineMaintenanceCycles']['1793613600'],original)
        self.assertIsNone(original.get('window'))
        resolution=state['routineFailureResolutions'][seal.DAILY_REFUSAL_RUN]
        self.assertEqual(resolution['result'],'unentered-daily-cycle-proved')
        self.assertEqual(resolution['proof']['database']['announcedAt'],1793613480003)
        before=seal.STATE_FILE.read_bytes();self.assertEqual(self.resolve(),'not-needed');self.assertEqual(seal.STATE_FILE.read_bytes(),before)
        self.assertEqual(self.owner(),'none')

    def test_daily_refusal_retains_unknown_or_live_custody(self):
        self.daily_fixture()
        for suffix in ('request','intent','activation-entry','drill','legacy-checkpoint-intent','main-inspector-retirement-intent',
                       'main-inspector-retirement-receipt','lightning-hold.json','lightning-hold.json.released',
                       'break-deadline','awaiting-certificate'):
            with self.subTest(suffix=suffix):
                path=seal.STATE_DIR/'engine-release-requests'/(seal.DAILY_REFUSAL_RUN+'.'+suffix)
                path.parent.mkdir(exist_ok=True);path.write_text('retained custody')
                self.assertEqual(self.resolve(),'not-needed');path.unlink()
        for flag in ('inspector_open','current_drift'):
            setattr(self,flag,True);self.assertEqual(self.resolve(),'not-needed');setattr(self,flag,False)
        self.cgroup_empty=False;self.assertEqual(self.resolve(),'not-needed');self.cgroup_empty=True
        self.sources_ok=False;self.assertEqual(self.resolve(),'not-needed');self.sources_ok=True
        health=copy.deepcopy(self.health)
        for mutate in (lambda:self.health.update(releaseSha=TARGET_SHA),
                       lambda:self.health['maintenance'].update(active=True),
                       lambda:setattr(self,'public_health',{**self.health,'instanceId':'1-deadbeef'})):
            mutate();self.assertEqual(self.resolve(),'not-needed');self.health=copy.deepcopy(health);self.public_health=None
        for directory,suffix in [('engine-release-generation-pins','generation'),('engine-image-leases','lease'),
                                 ('engine-intake-requests','intent'),('engine-intake-requests','request')]:
            path=seal.STATE_DIR/directory/(seal.DAILY_REFUSAL_RUN+'.'+suffix);path.parent.mkdir(exist_ok=True);path.write_text('retained')
            self.assertEqual(self.resolve(),'not-needed');path.unlink()
        notice=seal.STATE_DIR/('engine-recovery-window-'+seal.DAILY_REFUSAL_RUN+'.json');notice.write_text('{}')
        self.assertEqual(self.resolve(),'not-needed');notice.unlink()
        before=seal.STATE_FILE.read_bytes();self.database['ownedV3Thaw']=False
        self.assertEqual(self.resolve_or_refusal(),'refused');self.assertEqual(seal.STATE_FILE.read_bytes(),before)

    def test_daily_refusal_recovery_resumes_after_audit_interruption(self):
        self.daily_fixture()
        with patch.object(seal,'audit_once',side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError):self.resolve()
        receipts=list(seal.RESULT_DIR.glob(seal.DAILY_REFUSAL_RUN+'.*.terminal-resolution.json'))
        self.assertEqual(len(receipts),1);before=receipts[0].read_bytes()
        self.assertEqual(self.resolve(),seal.DAILY_REFUSAL_RUN);self.assertEqual(receipts[0].read_bytes(),before)

    def test_daily_observer_preserves_unbound_window_and_actual_thaw(self):
        import shutil
        self.daily_fixture()
        self.assertEqual(self.resolve(), seal.DAILY_REFUSAL_RUN)
        root = self.root / 'observer-root'
        results = root / 'engine-release-results'
        results.mkdir(parents=True)
        os.chmod(root, 0o700); os.chmod(results, 0o700)
        shutil.copyfile(seal.STATE_FILE, root / 'engine-release-seal.json')
        for source in (seal.result_path(seal.DAILY_REFUSAL_RUN), seal.terminal_receipt_path(seal.DAILY_REFUSAL_RUN, LIVE_RUN, INVOCATION)):
            shutil.copyfile(source, results / source.name)
        for path in [root / 'engine-release-seal.json', *results.iterdir()]:
            os.chmod(path, 0o600)
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, fd)
        reply = observer.routine_remote(observer.ROUTINE_REQUEST, fd)
        observer.validate_routine_reply(reply, observer.ROUTINE_REQUEST)
        [row] = [r for r in reply['owners'] if r['runId'] == seal.DAILY_REFUSAL_RUN]
        self.assertTrue(row['failureResolution']['present'])
        self.assertFalse(row['unresolvedOwner'])
        # Removing the receipt makes the canonical observation refuse rather than guess.
        (results / seal.terminal_receipt_path(seal.DAILY_REFUSAL_RUN, LIVE_RUN, INVOCATION).name).unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            observer.routine_remote(observer.ROUTINE_REQUEST, fd)

    def test_daily_recovery_pins_actual_original_sources_and_native_templates(self):
        import subprocess
        env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
        env.update(GIT_NO_LAZY_FETCH='1', GIT_NO_REPLACE_OBJECTS='1')
        files={name:subprocess.check_output(['git','-C',str(ROOT),'show',seal.DAILY_REFUSAL_SHA+':server/scripts/'+name],env=env)
               for name in seal.DAILY_REFUSAL_SOURCES}
        files['engine-release-unit-wrapper-v1.sh']=files['engine-release-unit-wrapper.sh']
        for source,marker,name in [
            ('install-engine-supervisor.sh','cat > "$UNIT_STAGE/club-arena-engine-release-v1@.service" <<UNIT\n','club-arena-engine-release-v1@.service'),
            ('install-engine-intake.sh',"cat > \"$UNIT_STAGE\" <<'UNIT'\n",'club-arena-engine-intake-v1@.service'),
            ('install-engine-intake.sh',"cat > \"$PATH_STAGE\" <<'UNIT'\n",'club-arena-engine-intake-v1@.path')]:
            body=files[source].decode().split(marker,1)[1].split('\nUNIT\n',1)[0]+'\n'
            body=body.replace('$UNIT_WRAPPER_V1','/usr/local/lib/club-arena/engine-release-unit-wrapper-v1.sh').replace('\\$','$')
            files[name]=body.encode()
        # Call the real shared source verifier, not the fixture host stub.
        with patch.object(seal,'failed_routine_bytes',side_effect=lambda p,*_:files[p.name]):
            # The function is retained via its module loader, independently of setUp's stub.
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            with patch.object(module,'failed_routine_bytes',side_effect=lambda p,*_:files[p.name]):
                self.assertEqual(module.ninef_sources(time.monotonic()+5,seal.DAILY_REFUSAL_SHA,seal.DAILY_REFUSAL_SOURCES),seal.DAILY_REFUSAL_SOURCES)
                files['engine-release-recover.sh']+=b'changed'
                with redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
                    module.ninef_sources(time.monotonic()+5,seal.DAILY_REFUSAL_SHA,seal.DAILY_REFUSAL_SOURCES)

    # cases
    def test_proved_terminal_owner_is_recorded_without_rewriting_history(self):
        for old_pid_birth in (None, 'reused'):
            with self.subTest(old_pid=old_pid_birth):
                self.reset()
                if old_pid_birth:
                    self.old_birth = self.start + 1500
                before_audit = seal.AUDIT_FILE.read_text()
                self.refused(self.owner)
                self.assertEqual(self.resolve(), DEAD_RUN)
                state = seal.load_state()
                self.assertEqual(state['routineMaintenanceCycles'], self.base['routineMaintenanceCycles'])
                self.assertEqual(seal.load_failure(DEAD_RUN), self.failure)
                self.assertNotIn('retiredRoutineCycles', state)
                resolution = state['routineFailureResolutions'][DEAD_RUN]
                self.assertEqual(resolution['result'], 'terminal-failure-proved')
                self.assertEqual(resolution['originalCycle'], self.cycle)
                self.assertEqual((resolution['verifiedByControlSha'], resolution['verifiedByTargetSha']),
                                 (CONTROL_SHA, TARGET_SHA))
                self.assertEqual(resolution['proof']['sourceDigests'], seal.NINEF_SOURCES)
                self.assertGreaterEqual(self.current_calls, 2, 'the current verifier was not re-read before the CAS')
                self.assertEqual(resolution['proof']['originalProcess'],
                                 'pid-reused-after-intent' if old_pid_birth else 'kernel-enoent')
                receipt = seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION)
                self.assertEqual(json.loads(receipt.read_text()), resolution)
                audit = seal.AUDIT_FILE.read_text()
                self.assertTrue(audit.startswith(before_audit))
                self.assertIn(f'routine_terminal_failure_proved:{DEAD_RUN}:{LIVE_RUN}:{INVOCATION}', audit)
                self.probes.clear()
                self.assertEqual(self.owner(), 'none')
                self.assertEqual(self.probes, [], 'the owner gate probed host state')
                self.assertEqual(self.resolve(), 'not-needed')

    def test_interrupted_proof_resumes_with_its_original_receipt_bytes(self):
        proof = seal.terminal_owner_proof(seal.load_state(), self.cycle, time.monotonic() + 45)
        original = {'schema': 1, 'result': 'terminal-failure-proved', 'originalCycle': self.cycle,
                    'verifiedByRunId': LIVE_RUN, 'verifiedByControlSha': CONTROL_SHA,
                    'verifiedByTargetSha': TARGET_SHA, 'invocationId': INVOCATION, 'observedAt': self.start + 900,
                    'proof': proof}
        seal.write_json_atomic(seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION), original)
        self.assertEqual(self.resolve(), DEAD_RUN)
        self.assertEqual(seal.load_state()['routineFailureResolutions'][DEAD_RUN], original)
        # A receipt for this invocation that disagrees with the fresh proof refuses.
        self.reset()
        seal.write_json_atomic(seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION),
                               {**original, 'proof': {**proof, 'originalProcess': 'pid-reused-after-intent'}})
        self.refused(self.resolve)
        self.assertNotIn('routineFailureResolutions', seal.load_state())

    def test_every_missing_or_unknown_proof_keeps_the_owner(self):
        bad_intent = lambda **f: lambda: self.write_intent(**f)
        cases = {
            # Relative to the real clock: the pinned 9f window is in the past, so a fixed
            # offset silently stops refusing once wall time passes it (it did at 14:05Z).
            'window not settled': lambda: setattr(seal, 'TERMINAL_OWNER_SETTLE_MS',
                int(time.time() * 1000) - self.window['endsAt'] + 3600 * 1000),
            'desired changed': lambda: seal.write_state({**seal.load_state(), 'desired': {
                'sha': A_SHA, 'imageId': OTHER_IMAGE, 'legacyUnlabelled': False}}),
            'durable failure differs': lambda: seal.write_json_atomic(
                seal.result_path(DEAD_RUN), {**self.failure, 'completedAt': 1}),
            'request retained': lambda: (self.request_root / f'{DEAD_RUN}.request').write_text('x'),
            'intent retained': lambda: (self.request_root / f'{DEAD_RUN}.intent').write_text('x'),
            'awaiting certificate retained': lambda: (self.request_root / f'{DEAD_RUN}.awaiting-certificate').write_text('x'),
            'lightning hold unreleased': lambda: (self.request_root / f'{DEAD_RUN}.lightning-hold.json').write_text('{}'),
            'activation entry retained': lambda: (self.request_root / f'{DEAD_RUN}.activation-entry').write_text('x'),
            'inspector retirement intent retained': lambda: (self.request_root /
                f'{DEAD_RUN}.main-inspector-retirement-intent').write_text('x'),
            'release unit not stopped': lambda: self.unit('release', 'service', ActiveState='active'),
            'intake path enabled': lambda: self.unit('intake', 'path', UnitFileState='enabled'),
            'service cgroup not empty': lambda: setattr(self, 'cgroup_empty', False),
            'unit changed during proof': lambda: setattr(self, 'unit_flip',
                f'club-arena-engine-release-v1@{DEAD_RUN}.service'),
            'systemd unknown': lambda: self.mocks['failed_routine_unit_snapshot'].configure_mock(
                side_effect=lambda _u, _d=None: seal.die('bus unavailable')),
            'no checkpoint intent': lambda: (self.request_root / f'{DEAD_RUN}.legacy-checkpoint-intent').unlink(),
            'unannounced window': lambda: seal.write_state({**seal.load_state(), 'routineMaintenanceCycles': {
                str(self.start): {k: v for k, v in self.cycle.items() if k != 'window'}}}),
            'unverified window': lambda: seal.write_state({**seal.load_state(), 'routineMaintenanceCycles': {
                str(self.start): {**self.cycle, 'window': {**self.window, 'verified': False}}}}),
            'checkpoint in another container': bad_intent(container='e' * 64),
            'checkpoint retry allowed': bad_intent(retryAllowed=True),
            'checkpoint before the break': bad_intent(at=self.start - 10),
            'restart before failure completed': lambda: self.live['State'].update(
                StartedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.start + 100))),
            'serving instance is the checkpointed one': lambda: (self.health.update(instanceId='1-24d59baf'),
                self.database.update(instanceId='1-24d59baf')),
            'container other image': lambda: self.live.update(Image=OTHER_IMAGE),
            'container stopped': lambda: self.live['State'].update(Status='exited'),
            'docker unknown': lambda: self.mocks['terminal_inspect_container'].configure_mock(
                side_effect=lambda _d: seal.die('docker unknown')),
            'checkpoint process not replaced': lambda: self.live['State'].update(StartedAt=self.intent['startedAt']),
            'checkpoint pid still original': lambda: self.live['State'].update(Pid=666945),
            'old pid alive from before intent': lambda: setattr(self, 'old_birth', self.start + 10),
            'checkpoint for another source': bad_intent(source=B_SHA),
            'checkpoint for another run': bad_intent(runId=LIVE_RUN),
            'checkpoint intent unreadable': lambda: (self.request_root /
                f'{DEAD_RUN}.legacy-checkpoint-intent').write_text('{not json'),
            'maintenance active': lambda: self.health['maintenance'].update(active=True, phase='counting_down'),
            'health on another source': lambda: self.health.update(releaseSha=B_SHA),
            'public health another instance': lambda: setattr(self, 'public_health',
                {**self.health, 'instanceId': '1-deadbeef'}),
            'database maintenance owner': lambda: setattr(self, 'database', RuntimeError('owner present')),
            'database other leader': lambda: self.database.update(instanceId='1-deadbeef'),
            'original thaw unproved': lambda: self.database.update(ownedV3Thaw=False),
            'no checkpoint refusal in journal': lambda: self.journal.clear(),
            'two checkpoint refusals': lambda: self.journal.append(dict(self.journal[0])),
            'checkpoint was invoked': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'checkpointInvoked': True})),
            'checkpoint result present': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'checkpoint': {}})),
            'inspector request invoked': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'transportDetail': 'op=queryObjects,invoked=yes'})),
            'refusal from another invocation': lambda: self.journal[0].update(_SYSTEMD_INVOCATION_ID='0' * 32),
            'refusal outside the break': lambda: self.journal[0].update(
                __REALTIME_TIMESTAMP=str((self.start - 600) * 1000000)),
            'thaw for another window': lambda: self.database.update(startsAt=self.window['startsAt'] + 1),
            'later checkpoint invoked row': lambda: self.journal.append({**self.journal[0], 'MESSAGE': json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'ok': True, 'checkpointInvoked': True})}),
            'refusal for another reason': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'reason': 'deadline'})),
            'inspector closed': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'inspectorClosed': True})),
            'cleanup connections left': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']), 'cleanupConnections': 1})),
            'refusal for another operation': lambda: self.journal[0].update(MESSAGE=json.dumps(
                {**json.loads(self.journal[0]['MESSAGE']),
                 'transportDetail': 'op=heapSnapshot,cause=request_timeout,invoked=no'})),
            'census for another candidate': bad_intent(nativeCensus={'candidateSHA': A_SHA,
                                                                     'sourceSHA256': seal.NINEF_CENSUS_SOURCE}),
            'census from another source': bad_intent(nativeCensus={'candidateSHA': B_SHA, 'sourceSHA256': '0' * 64}),
            'census missing': bad_intent(nativeCensus=None),
            'original sources unproved': lambda: setattr(self, 'sources_ok', False),
            'verifier changed during proof': lambda: setattr(self, 'current_drift', True),
            'verifier unknown': lambda: self.mocks['failed_routine_current'].configure_mock(
                side_effect=lambda _a, _d: seal.die('request unreadable')),
            'engine not running': lambda: self.health.update(running=False),
            'liveness not ok': lambda: self.health.update(liveness='degraded'),
            'durable break confirmed': lambda: self.health['maintenance'].update(durableConfirmed=True),
            'cycle failure invocation differs': lambda: (seal.write_state({**seal.load_state(),
                'routineMaintenanceCycles': {str(self.start): {**self.cycle,
                    'failure': {**self.failure, 'invocationId': '0' * 32}}}}),
                seal.write_json_atomic(seal.result_path(DEAD_RUN), {**self.failure, 'invocationId': '0' * 32})),
        }
        for name, arrange in cases.items():
            with self.subTest(name):
                self.reset()
                arrange()
                outcome = self.resolve_or_refusal()
                self.assertNotEqual(outcome, DEAD_RUN)
                self.assertNotIn(DEAD_RUN, seal.load_state().get('routineFailureResolutions', {}))
                self.assertFalse(list(seal.RESULT_DIR.glob('*.terminal-resolution.json')))
                self.refused(self.owner)

    def test_recovery_observer_reads_only_an_exact_receipted_terminal_record(self):
        self.assertEqual(self.resolve(), DEAD_RUN)
        resolution = seal.load_state()['routineFailureResolutions'][DEAD_RUN]
        receipt = seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION)
        os.chmod(receipt, 0o600)
        fd = os.open(seal.RESULT_DIR, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, fd)
        blank = lambda: {'present': False}
        answer, observation = observer.terminal_failure_resolution(resolution, self.cycle, self.failure, fd, blank())
        self.assertTrue(answer['present'] and answer['receiptMatches'] and answer['databaseIdleRecorded'])
        self.assertEqual(observation[0], receipt.name)
        for name, value, cycle in [
                ('changed record', {**resolution, 'observedAt': resolution['observedAt'] + 1}, self.cycle),
                ('self verified', {**resolution, 'verifiedByRunId': DEAD_RUN}, self.cycle),
                ('other cycle', resolution, {**self.cycle, 'sha': A_SHA}),
                ('sources differ', {**resolution, 'proof': {**resolution['proof'], 'sourceDigests': {}}}, self.cycle),
                ('verifier targets 9f', {**resolution, 'verifiedByTargetSha': B_SHA}, self.cycle),
                ('database unchecked', {**resolution, 'proof': {**resolution['proof'], 'database': None}}, self.cycle),
                ('instances both absent', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {k: v for k, v in resolution['proof']['runtime'].items() if k != 'instanceId'},
                    'database': {k: v for k, v in resolution['proof']['database'].items() if k != 'instanceId'}}},
                 self.cycle),
                ('database sha differs', {**resolution, 'proof': {**resolution['proof'],
                    'database': {**resolution['proof']['database'], 'sha': B_SHA}}}, self.cycle),
                ('runtime pid not int', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'hostPid': '1'}}}, self.cycle),
                ('started not a timestamp', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'startedAt': 'yesterday'}}}, self.cycle),
                ('started without zone', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'startedAt': '2026-11-02T05:54:48.403092401'}}}, self.cycle),
                ('started before failure', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'startedAt': '2026-11-02T04:05:00Z'}}}, self.cycle),
                ('instance malformed', {**resolution, 'proof': {**resolution['proof'],
                    'runtime': {**resolution['proof']['runtime'], 'instanceId': 'engine.a'},
                    'database': {**resolution['proof']['database'], 'instanceId': 'engine.a'}}}, self.cycle),
                ('extra field', {**resolution, 'note': 'x'}, self.cycle)]:
            with self.subTest(name), self.assertRaisesRegex(ValueError, 'Routine owner evidence refused'):
                observer.terminal_failure_resolution(value, cycle, self.failure, fd, blank())
        receipt.unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            observer.terminal_failure_resolution(resolution, self.cycle, self.failure, fd, blank())

    def test_no_other_failed_owner_is_ever_terminally_resolved(self):
        other = '555000111-1'
        failure = {**self.failure, 'runId': other, 'invocationId': 'f' * 32}
        cycle = {**self.cycle, 'runId': other, 'failure': failure}
        seal.write_json_atomic(seal.result_path(other), failure)
        state = {**copy.deepcopy(self.base), 'routineMaintenanceCycles': {str(self.start): cycle}}
        seal.write_state(state)
        self.assertIsNone(seal.terminal_owner_proof(state, cycle, time.monotonic() + 45))
        self.assertEqual(self.resolve(), 'not-needed')
        self.refused(self.owner)
        # A fabricated record for that owner, receipt included, is refused rather than honoured.
        record = {'schema': 1, 'result': 'terminal-failure-proved', 'originalCycle': cycle,
                  'verifiedByRunId': LIVE_RUN, 'verifiedByControlSha': CONTROL_SHA, 'verifiedByTargetSha': TARGET_SHA,
                  'invocationId': INVOCATION, 'observedAt': self.start + 900, 'proof': {}}
        seal.write_json_atomic(seal.terminal_receipt_path(other, LIVE_RUN, INVOCATION), record)
        seal.write_state({**state, 'routineFailureResolutions': {other: record}})
        self.refused(self.owner)

    def test_database_witness_requires_the_exact_v3_thaw_ledger(self):
        spec = importlib.util.spec_from_file_location('terminal_owner_db', ROOT / 'server/scripts/engine-release-database-proof.py')
        db = importlib.util.module_from_spec(spec); spec.loader.exec_module(db)
        targets = {k: i for i, k in enumerate(sorted(db.TERMINAL_THAW_TARGETS))}
        good = {'freeze_started_at': '2026-11-02T04:00:04.929+00:00', 'announced_at': '2026-11-02T03:58:04.929+00:00',
                'release_target_at': '2026-11-02T04:05:04.929+00:00', 'thawed_at': '2026-11-02T04:05:05+00:00',
                'frozen_seconds': 300, 'contract_version': 3, 'release_generation': 1,
                'ownership_token': '0b6c1f2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b', 'thawed_by': A_SHA[:8],
                'shifted': {'complete': True, '_targets_snapshotted': True, '_target_counts': dict(targets), **targets}}
        class Reply(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *_): return False
        def run(row, breaks=(b'[]', b'[]'), promise=None):
            replies = list(breaks)
            class Opener:
                def open(self, request, timeout):
                    url = request.full_url
                    if 'engine_maintenance_break' in url:
                        return Reply(replies.pop(0))
                    return Reply(b'[]' if 'release_target_at=gt' in url else json.dumps([row]).encode())
            with patch.object(db, 'build_opener', lambda *_: Opener()), \
                    patch.object(db, 'read_leader', lambda *_: (A_SHA[:8], INSTANCE, 1)), \
                    patch.object(db, 'read_maintenance_promise', return_value=promise):
                return db.verify_terminal_owned_thaw('https://db.invalid', 'k', A_SHA, INSTANCE, 15,
                                                     *(self.window[k] for k in ('announcedAt', 'startsAt', 'endsAt')))
        self.assertTrue(run(good)['ownedV3Thaw'])
        self.assertNotIn('ownership_token', json.dumps(run(good)))
        first = sorted(targets)[1]
        for name, mutate in {
            'count is boolean true': lambda r: (r['shifted'].update({first: 1}), r['shifted']['_target_counts'].update({first: True})),
            'count is boolean false': lambda r: r['shifted']['_target_counts'].update({sorted(targets)[0]: False}),
            'shifted is boolean': lambda r: r['shifted'].update({first: True}),
            'count differs': lambda r: r['shifted']['_target_counts'].update({first: 99}),
            'negative shift': lambda r: (r['shifted'].update({first: -1}), r['shifted']['_target_counts'].update({first: -1})),
            'extra ledger key': lambda r: r['shifted'].update(tournaments=0),
            'target missing': lambda r: r['shifted'].pop(first),
            'not snapshotted': lambda r: r['shifted'].update(_targets_snapshotted=False),
            'incomplete': lambda r: r['shifted'].update(complete=False),
            'token absent': lambda r: r.update(ownership_token=None),
            'token malformed': lambda r: r.update(ownership_token='not-a-uuid'),
        }.items():
            with self.subTest(name), self.assertRaises(ValueError):
                row = copy.deepcopy(good); mutate(row); run(row)
        with self.subTest('maintenance row at the closing bookend'), self.assertRaises(ValueError):
            run(good, breaks=(b'[]', b'[{"id":1}]'))

        # Exact419047 early original timer: all15 targets must still be complete,
        # and the installed contract must credit300.001 while keeping420s promise.
        original_window=self.window
        self.window={'announcedAt':1793824762499,'startsAt':1793824882499,'endsAt':1793825182499}
        early=copy.deepcopy(good)
        early.update(announced_at='2026-11-04T20:39:22.499Z',freeze_started_at='2026-11-04T20:41:22.498Z',
                     release_target_at='2026-11-04T20:46:22.499Z',thawed_at='2026-11-04T20:45:02Z',frozen_seconds=300.001)
        promise={'schema':'maintenance-promise-floor/v1','thawDefinitionMd5':'cb733d7201725719813ffd1b1e099b1b',
                 'observedAt':'2026-11-04T20:46:24Z','maintenance':None,
                 'leader':{'version':A_SHA[:8],'instanceId':INSTANCE,'heartbeatAt':'2026-11-04T20:46:24Z'}}
        try:
            with patch.object(db.time,'time',return_value=1793825184):
                self.assertTrue(run(early,promise=promise)['ownedV3Thaw'])
                for key,value in [('frozen_seconds',300),('frozen_seconds',300.002),
                        ('freeze_started_at','2026-11-04T20:41:22.497Z'),
                        ('release_target_at','2026-11-04T20:46:22.498Z'),('ownership_token',None)]:
                    with self.subTest(key=key,value=value),self.assertRaises(ValueError):
                        run({**early,key:value},promise=promise)
                for part,key,value in [(None,'thawDefinitionMd5','0'*32),(None,'maintenance',{}),
                        (None,'observedAt','2026-11-04T20:46:00Z'),('leader','instanceId','1-foreign'),
                        ('leader','heartbeatAt','2026-11-04T20:46:00Z')]:
                    bad=copy.deepcopy(promise); (bad[part] if part else bad)[key]=value
                    with self.subTest(part=part,key=key),self.assertRaises(ValueError):run(early,promise=bad)
                with self.assertRaises(ValueError):run(early)
                bad=copy.deepcopy(early);bad['shifted']['complete']=False
                with self.assertRaises(ValueError):run(bad,promise=promise)
                bad=copy.deepcopy(early);bad['shifted']['_target_counts'][first]+=1
                with self.assertRaises(ValueError):run(bad,promise=promise)
        finally:self.window=original_window

    def test_a_recorded_resolution_needs_its_identical_receipt(self):
        self.assertEqual(self.resolve(), DEAD_RUN)
        self.assertEqual(self.owner(), 'none')
        receipt = seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION)
        original = receipt.read_text()
        receipt.write_text(original.replace('"verifiedByRunId"', '"verifiedByRunId" ', 1).replace(
            str(json.loads(original)['observedAt']), str(json.loads(original)['observedAt'] + 1)))
        self.refused(self.owner)
        receipt.unlink()
        self.refused(self.owner)

    def test_a_resolved_failed_source_can_never_reserve_or_prepare_again(self):
        self.assertEqual(self.resolve(), DEAD_RUN)
        state = seal.load_state()
        self.assertTrue(seal.resolved_failed_source(state, B_SHA))
        self.assertFalse(seal.resolved_failed_source(state, A_SHA))
        self.refused(lambda: seal.cmd_reserve_routine_cycle(Namespace(
            repo=str(self.root), sha=B_SHA, control_sha=B_SHA, run_id='888000444-1')))
        self.assertEqual(seal.load_state()['routineMaintenanceCycles'], state['routineMaintenanceCycles'])

    def test_canonical_routine_observation_reports_the_recorded_terminal_owner(self):
        import shutil
        self.assertEqual(self.resolve(), DEAD_RUN)
        root = self.root / 'observer-root'
        results = root / 'engine-release-results'
        results.mkdir(parents=True)
        os.chmod(root, 0o700); os.chmod(results, 0o700)
        shutil.copyfile(seal.STATE_FILE, root / 'engine-release-seal.json')
        for source in (seal.result_path(DEAD_RUN), seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION)):
            shutil.copyfile(source, results / source.name)
        for path in [root / 'engine-release-seal.json', *results.iterdir()]:
            os.chmod(path, 0o600)
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, fd)
        reply = observer.routine_remote(observer.ROUTINE_REQUEST, fd)
        observer.validate_routine_reply(reply, observer.ROUTINE_REQUEST)
        [row] = [r for r in reply['owners'] if r['runId'] == DEAD_RUN]
        self.assertTrue(row['failureResolution']['present'])
        self.assertFalse(row['unresolvedOwner'])
        # Removing the receipt makes the canonical observation refuse rather than guess.
        (results / seal.terminal_receipt_path(DEAD_RUN, LIVE_RUN, INVOCATION).name).unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            observer.routine_remote(observer.ROUTINE_REQUEST, fd)

    def test_recorded_resolution_must_match_its_original_cycle_exactly(self):
        self.assertEqual(self.resolve(), DEAD_RUN)
        good = seal.load_state()
        for name, mutate in {
            'changed cycle': lambda r: r['originalCycle'].update(sha=A_SHA),
            'self verified': lambda r: r.update(verifiedByRunId=DEAD_RUN),
            'extra field': lambda r: r.update(note='x'),
            'wrong result': lambda r: r.update(result='retired'),
            'before window end': lambda r: r.update(observedAt=self.cycle['startsAt']),
            'database not idle': lambda r: r['proof']['database'].update(databaseIdle=False),
            'unknown process state': lambda r: r['proof'].update(originalProcess='no-checkpoint-entered'),
            'thaw not recorded': lambda r: r['proof']['database'].update(ownedV3Thaw=False),
            'refusal digest missing': lambda r: r['proof'].update(checkpointRefusalDigest=None),
            'failure digest differs': lambda r: r['proof'].update(failureDigest='0' * 64),
            'sources differ': lambda r: r['proof'].update(sourceDigests={}),
            'verifier targets 9f': lambda r: r.update(verifiedByTargetSha=B_SHA),
            'verifier control missing': lambda r: r.pop('verifiedByControlSha'),
            'runtime instance missing': lambda r: (r['proof']['runtime'].pop('instanceId'),
                                                   r['proof']['database'].pop('instanceId')),
            'runtime extra key': lambda r: r['proof']['runtime'].update(note='x'),
            'runtime pid not int': lambda r: r['proof']['runtime'].update(hostPid='758052'),
            'runtime container malformed': lambda r: r['proof']['runtime'].update(containerId='x'),
            'started not a timestamp': lambda r: r['proof']['runtime'].update(startedAt='yesterday'),
            'started without zone': lambda r: r['proof']['runtime'].update(startedAt='2026-11-02T05:54:48.403092401'),
            'started before failure': lambda r: r['proof']['runtime'].update(startedAt='2026-11-02T04:05:00Z'),
            'database sha differs': lambda r: r['proof']['database'].update(sha=B_SHA),
            'database other instance': lambda r: r['proof']['database'].update(instanceId='1-deadbeef'),
            'database boolean as int': lambda r: r['proof']['database'].update(databaseIdle=1),
        }.items():
            with self.subTest(name):
                state = copy.deepcopy(good)
                mutate(state['routineFailureResolutions'][DEAD_RUN])
                seal.write_state(state)
                self.refused(self.owner)
        seal.write_state(good)


class CancelledAnnouncementOwner(unittest.TestCase):
    def setUp(self):
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        self.tmp = tempfile.TemporaryDirectory(prefix='cancelled-owner-', dir=scratch)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, value in {'STATE_DIR': self.root, 'STATE_FILE': self.root / 'engine-release-seal.json',
                'AUDIT_FILE': self.root / 'audit.jsonl', 'RESULT_DIR': self.root / 'engine-release-results',
                'LOCK_FILE': self.root / 'lock'}.items():
            p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        seal.RESULT_DIR.mkdir(mode=0o700)
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': seal.NINEF_POLICY_DIGEST, 'startsAt': 1793602800, 'endsAt': 1793603100,
            'runId': seal.CANCELLED_PHASE1_RUN, 'sha': seal.CANCELLED_PHASE1_SHA,
            'controlSha': seal.CANCELLED_PHASE1_SHA, 'status': 'reserved',
            'window': dict(seal.CANCELLED_PHASE1_WINDOW)}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None,
            'generation': 312, 'routineMaintenanceCycles': {'1793602800': self.cycle}}
        seal.write_state(copy.deepcopy(self.base))
        self.proof = {'schema': 'cancelled-routine-announcement-proof/v1', 'originalCycle': self.cycle,
            'recordHashes': dict.fromkeys(('receipt','intent','quiescent','stop-issued'), 'a' * 64),
            'retainedHashes': dict.fromkeys(('entryHash','reservationHash','releasedHoldHash'), 'b' * 64),
            'sourceHashes': dict(seal.CANCELLED_PHASE1_SOURCES), 'thaw': dict(seal.CANCELLED_PHASE1_THAW),
            'container': {'id': CONTAINER, 'startedAt': '2026-11-02T05:54:48.403092401Z', 'image': A_IMAGE},
            'instanceId': '1-2ced3e43'}
        self.commands = []
        def command(argv, deadline, limit=32768, **kw):
            self.commands.append(argv)
            if argv[0] == 'git': return '# qualified read-only helper'
            self.assertEqual(argv[1:3], ['-B', '-c'])
            self.assertEqual(argv[-1], '--phase1-cancellation-proof')
            return json.dumps(self.proof)
        for name, value in [('require_engine_lock', lambda fd: None),
                ('failed_routine_current', lambda a,d: {'same': True}),
                ('failed_routine_command', command),
                ('failed_routine_json', lambda p: json.loads(Path(p).read_text()))]:
            p = patch.object(seal, name, side_effect=value); p.start(); self.addCleanup(p.stop)

    def resolve(self):
        with patch.object(seal.os, 'geteuid', return_value=0), redirect_stdout(io.StringIO()) as out:
            args = seal.parser().parse_args(['resolve-terminal-routine-failures', '--engine-lock-fd', '9',
                '--run-id', LIVE_RUN, '--sha', TARGET_SHA, '--control-sha', CONTROL_SHA,
                '--invocation-id', INVOCATION])
            self.assertEqual(args.repo, '/opt/club-arena')
            args.handler(args)
        return out.getvalue().strip()

    def test_cancellation_resolves_without_fabricating_a_failure_and_replays(self):
        self.assertEqual(self.resolve(), seal.CANCELLED_PHASE1_RUN)
        state = seal.load_state()
        self.assertEqual(state['routineMaintenanceCycles'], self.base['routineMaintenanceCycles'])
        self.assertFalse(seal.result_path(seal.CANCELLED_PHASE1_RUN).exists())
        resolution = state['routineFailureResolutions'][seal.CANCELLED_PHASE1_RUN]
        self.assertEqual(resolution['result'], 'cancelled-announcement-proved')
        self.assertEqual(self.resolve(), 'not-needed')
        self.assertFalse(seal.routine_owner_unresolved(state, self.cycle))
        fd = os.open(seal.RESULT_DIR, os.O_RDONLY | os.O_DIRECTORY)
        try:
            answer, _ = observer.routine_failure_resolution(resolution, self.cycle, None, fd)
            self.assertTrue(answer['present'] and answer['receiptMatches'])
            for field, change in [('sourceHashes', {}), ('thaw', {}), ('container', {})]:
                bad = copy.deepcopy(resolution); bad['proof'][field] = change
                with self.assertRaises((ValueError, KeyError)):
                    observer.routine_failure_resolution(bad, self.cycle, None, fd)
        finally: os.close(fd)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            observed = observer.routine_remote(dict(observer.ROUTINE_REQUEST), root_fd)
            self.assertFalse(observed['owners'][0]['unresolvedOwner'])
            self.assertFalse(observed['owners'][0]['failurePresent'])
        finally: os.close(root_fd)
        self.assertEqual(len([a for a in self.commands if a[0] == 'git']), 2)
        self.assertTrue(all(a[4] == CONTROL_SHA + ':scripts/ci/withdraw-waiting-engine-release.py'
                            for a in self.commands if a[0] == 'git'))

    def test_receipt_audit_and_state_interruptions_resume_one_resolution(self):
        for edge in ('audit_once', 'write_state'):
            with self.subTest(edge=edge):
                seal.write_state(copy.deepcopy(self.base))
                for p in seal.RESULT_DIR.iterdir(): p.unlink()
                seal.AUDIT_FILE.unlink(missing_ok=True)
                with patch.object(seal, edge, side_effect=RuntimeError('crash')):
                    with self.assertRaises(RuntimeError): self.resolve()
                receipt = seal.terminal_receipt_path(seal.CANCELLED_PHASE1_RUN, LIVE_RUN, INVOCATION)
                before = receipt.read_bytes()
                self.assertNotIn('routineFailureResolutions', seal.load_state())
                self.assertEqual(self.resolve(), seal.CANCELLED_PHASE1_RUN)
                self.assertEqual(receipt.read_bytes(), before)
                rows = [json.loads(x) for x in seal.AUDIT_FILE.read_text().splitlines()]
                self.assertEqual(len(rows), 1)

    def test_post_window_desired_successor_resolves_and_observation_replays(self):
        self.proof['container']['startedAt'] = '2026-11-02T07:21:51.848Z'
        self.proof['instanceId'] = '1-7920f8a6'
        self.assertEqual(self.resolve(), seal.CANCELLED_PHASE1_RUN)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            observed = observer.routine_remote(dict(observer.ROUTINE_REQUEST), root_fd)
            self.assertFalse(observed['owners'][0]['unresolvedOwner'])
        finally: os.close(root_fd)
        self.assertEqual(self.resolve(), 'not-needed')

    def test_cancellation_runtime_birth_is_bounded_by_historical_proof(self):
        self.assertEqual(self.resolve(), seal.CANCELLED_PHASE1_RUN)
        resolution = seal.load_state()['routineFailureResolutions'][seal.CANCELLED_PHASE1_RUN]
        for stamp in ('2026-11-02T06:58:02.415Z', '2026-11-02T07:02:00Z',
                      '2026-11-02T07:05:02.415Z', '2099-01-01T00:00:00Z',
                      '2026-11-02T07:21:51.848', 'unknown'):
            with self.subTest(stamp=stamp):
                bad = copy.deepcopy(resolution)
                bad['proof']['container']['startedAt'] = stamp
                with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    seal.validate_cancelled_phase1_resolution(bad, self.cycle, verify_receipt=False)
                self.assertFalse(observer.cancelled_phase1_started_at(stamp, resolution['observedAt']))

    def test_changed_window_source_thaw_and_live_transaction_refuse(self):
        for field in ('pending', 'finalization', 'committed', 'window', 'source', 'thaw', 'startedAt', 'proofChanged'):
            with self.subTest(field=field):
                state = copy.deepcopy(self.base); proof = copy.deepcopy(self.proof)
                if field in ('pending','finalization'): state[field] = {'runId': LIVE_RUN, 'sha': TARGET_SHA, 'imageId': OTHER_IMAGE}
                if field == 'committed': state['committedRuns'][seal.CANCELLED_PHASE1_RUN] = {'sha': seal.CANCELLED_PHASE1_SHA, 'imageId': OTHER_IMAGE}
                if field == 'window': state['routineMaintenanceCycles']['1793602800']['window']['startsAt'] -= 1
                if field == 'source': proof['sourceHashes'] = {}
                if field == 'thaw': proof['thaw']['freezeStartedAtMs'] += 1
                if field == 'startedAt': proof['container']['startedAt'] = 'unknown'
                seal.write_state(state)
                for p in seal.RESULT_DIR.iterdir(): p.unlink()
                original = self.proof; self.proof = proof
                if field == 'proofChanged':
                    self.proof['originalCycle'] = {**self.cycle, 'sha': A_SHA}
                try:
                    with redirect_stderr(io.StringIO()), self.assertRaises((SystemExit, ValueError)):
                        self.resolve()
                    self.assertNotIn('routineFailureResolutions', json.loads(seal.STATE_FILE.read_text()))
                    self.assertEqual(list(seal.RESULT_DIR.iterdir()), [])
                finally: self.proof = original


class SecondCancelledAnnouncementOwner(unittest.TestCase):
    def setUp(self):
        clock = patch.object(seal.time, "time", return_value=1793622600)  # 12:30 UTC
        clock.start(); self.addCleanup(clock.stop)
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        self.tmp = tempfile.TemporaryDirectory(prefix='cancelled-owner-', dir=scratch)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, value in {'STATE_DIR': self.root, 'STATE_FILE': self.root / 'engine-release-seal.json',
                'AUDIT_FILE': self.root / 'audit.jsonl', 'RESULT_DIR': self.root / 'engine-release-results',
                'LOCK_FILE': self.root / 'lock'}.items():
            p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        seal.RESULT_DIR.mkdir(mode=0o700)
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': seal.NINEF_POLICY_DIGEST, 'startsAt': 1793620800, 'endsAt': 1793621100,
            'runId': seal.SECOND_CANCELLED_PHASE1_RUN, 'sha': seal.SECOND_CANCELLED_PHASE1_SHA,
            'controlSha': seal.SECOND_CANCELLED_PHASE1_SHA, 'status': 'reserved',
            'window': dict(seal.SECOND_CANCELLED_PHASE1_WINDOW)}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None,
            'generation': 312, 'routineMaintenanceCycles': {'1793620800': self.cycle}}
        seal.write_state(copy.deepcopy(self.base))
        self.proof = {'schema': 'cancelled-routine-announcement-proof/v1', 'originalCycle': self.cycle,
            'recordHashes': dict.fromkeys(('receipt','intent','quiescent','stop-issued'), 'a' * 64),
            'retainedHashes': dict.fromkeys(('entryHash','reservationHash','releasedHoldHash'), 'b' * 64),
            'sourceHashes': dict(seal.SECOND_CANCELLED_PHASE1_SOURCES), 'thaw': dict(seal.SECOND_CANCELLED_PHASE1_THAW),
            'container': {'id': CONTAINER, 'startedAt': '2026-11-02T05:54:48.403092401Z', 'image': A_IMAGE},
            'instanceId': '1-2ced3e43'}
        self.commands = []
        def command(argv, deadline, limit=32768, **kw):
            self.commands.append(argv)
            if argv[0] == 'git': return '# qualified read-only helper'
            self.assertEqual(argv[1:3], ['-B', '-c'])
            self.assertEqual(argv[-2:], ['--phase1-cancellation-proof', seal.SECOND_CANCELLED_PHASE1_RUN])
            return json.dumps(self.proof)
        for name, value in [('require_engine_lock', lambda fd: None),
                ('failed_routine_current', lambda a,d: {'same': True}),
                ('failed_routine_command', command),
                ('failed_routine_json', lambda p: json.loads(Path(p).read_text()))]:
            p = patch.object(seal, name, side_effect=value); p.start(); self.addCleanup(p.stop)

    def resolve(self):
        with patch.object(seal.os, 'geteuid', return_value=0), redirect_stdout(io.StringIO()) as out:
            args = seal.parser().parse_args(['resolve-terminal-routine-failures', '--engine-lock-fd', '9',
                '--run-id', LIVE_RUN, '--sha', TARGET_SHA, '--control-sha', CONTROL_SHA,
                '--invocation-id', INVOCATION])
            self.assertEqual(args.repo, '/opt/club-arena')
            args.handler(args)
        return out.getvalue().strip()

    def test_cancellation_resolves_without_fabricating_a_failure_and_replays(self):
        self.assertEqual(self.resolve(), seal.SECOND_CANCELLED_PHASE1_RUN)
        state = seal.load_state()
        self.assertEqual(state['routineMaintenanceCycles'], self.base['routineMaintenanceCycles'])
        self.assertFalse(seal.result_path(seal.SECOND_CANCELLED_PHASE1_RUN).exists())
        resolution = state['routineFailureResolutions'][seal.SECOND_CANCELLED_PHASE1_RUN]
        self.assertEqual(resolution['result'], 'cancelled-announcement-proved')
        self.assertEqual(self.resolve(), 'not-needed')
        self.assertFalse(seal.routine_owner_unresolved(state, self.cycle))
        fd = os.open(seal.RESULT_DIR, os.O_RDONLY | os.O_DIRECTORY)
        try:
            answer, _ = observer.routine_failure_resolution(resolution, self.cycle, None, fd)
            self.assertTrue(answer['present'] and answer['receiptMatches'])
            for field, change in [('sourceHashes', {}), ('thaw', {}), ('container', {})]:
                bad = copy.deepcopy(resolution); bad['proof'][field] = change
                with self.assertRaises((ValueError, KeyError)):
                    observer.routine_failure_resolution(bad, self.cycle, None, fd)
        finally: os.close(fd)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            observed = observer.routine_remote(dict(observer.ROUTINE_REQUEST), root_fd)
            self.assertFalse(observed['owners'][0]['unresolvedOwner'])
            self.assertFalse(observed['owners'][0]['failurePresent'])
        finally: os.close(root_fd)
        self.assertEqual(len([a for a in self.commands if a[0] == 'git']), 2)
        self.assertTrue(all(a[4] == CONTROL_SHA + ':scripts/ci/withdraw-waiting-engine-release.py'
                            for a in self.commands if a[0] == 'git'))

    def test_receipt_audit_and_state_interruptions_resume_one_resolution(self):
        for edge in ('audit_once', 'write_state'):
            with self.subTest(edge=edge):
                seal.write_state(copy.deepcopy(self.base))
                for p in seal.RESULT_DIR.iterdir(): p.unlink()
                seal.AUDIT_FILE.unlink(missing_ok=True)
                with patch.object(seal, edge, side_effect=RuntimeError('crash')):
                    with self.assertRaises(RuntimeError): self.resolve()
                receipt = seal.terminal_receipt_path(seal.SECOND_CANCELLED_PHASE1_RUN, LIVE_RUN, INVOCATION)
                before = receipt.read_bytes()
                self.assertNotIn('routineFailureResolutions', seal.load_state())
                self.assertEqual(self.resolve(), seal.SECOND_CANCELLED_PHASE1_RUN)
                self.assertEqual(receipt.read_bytes(), before)
                rows = [json.loads(x) for x in seal.AUDIT_FILE.read_text().splitlines()]
                self.assertEqual(len(rows), 1)

    def test_post_window_desired_successor_resolves_and_observation_replays(self):
        self.proof['container']['startedAt'] = '2026-11-02T12:21:51.848Z'
        self.proof['instanceId'] = '1-7920f8a6'
        self.assertEqual(self.resolve(), seal.SECOND_CANCELLED_PHASE1_RUN)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            observed = observer.routine_remote(dict(observer.ROUTINE_REQUEST), root_fd)
            self.assertFalse(observed['owners'][0]['unresolvedOwner'])
        finally: os.close(root_fd)
        self.assertEqual(self.resolve(), 'not-needed')

    def test_cancellation_runtime_birth_is_bounded_by_historical_proof(self):
        self.assertEqual(self.resolve(), seal.SECOND_CANCELLED_PHASE1_RUN)
        resolution = seal.load_state()['routineFailureResolutions'][seal.SECOND_CANCELLED_PHASE1_RUN]
        for stamp in ('2026-11-02T11:58:05.533Z', '2026-11-02T12:02:00Z',
                      '2026-11-02T12:05:05.533Z', '2099-01-01T00:00:00Z',
                      '2026-11-02T07:21:51.848', 'unknown'):
            with self.subTest(stamp=stamp):
                bad = copy.deepcopy(resolution)
                bad['proof']['container']['startedAt'] = stamp
                with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    seal.validate_cancelled_phase1_resolution(bad, self.cycle, verify_receipt=False)
                self.assertFalse(observer.cancelled_phase1_started_at(stamp, resolution['observedAt'], seal.SECOND_CANCELLED_PHASE1_RUN))

    def test_changed_window_source_thaw_and_live_transaction_refuse(self):
        for field in ('pending', 'finalization', 'committed', 'window', 'source', 'thaw', 'startedAt', 'proofChanged'):
            with self.subTest(field=field):
                state = copy.deepcopy(self.base); proof = copy.deepcopy(self.proof)
                if field in ('pending','finalization'): state[field] = {'runId': LIVE_RUN, 'sha': TARGET_SHA, 'imageId': OTHER_IMAGE}
                if field == 'committed': state['committedRuns'][seal.SECOND_CANCELLED_PHASE1_RUN] = {'sha': seal.SECOND_CANCELLED_PHASE1_SHA, 'imageId': OTHER_IMAGE}
                if field == 'window': state['routineMaintenanceCycles']['1793620800']['window']['startsAt'] -= 1
                if field == 'source': proof['sourceHashes'] = {}
                if field == 'thaw': proof['thaw']['freezeStartedAtMs'] += 1
                if field == 'startedAt': proof['container']['startedAt'] = 'unknown'
                seal.write_state(state)
                for p in seal.RESULT_DIR.iterdir(): p.unlink()
                original = self.proof; self.proof = proof
                if field == 'proofChanged':
                    self.proof['originalCycle'] = {**self.cycle, 'sha': A_SHA}
                try:
                    with redirect_stderr(io.StringIO()), self.assertRaises((SystemExit, ValueError)):
                        self.resolve()
                    self.assertNotIn('routineFailureResolutions', json.loads(seal.STATE_FILE.read_text()))
                    self.assertEqual(list(seal.RESULT_DIR.iterdir()), [])
                finally: self.proof = original


class Current26CancelledAnnouncementOwner(unittest.TestCase):
    def setUp(self):
        clock = patch.object(seal.time, "time", return_value=1793637000)  # 16:30 UTC
        clock.start(); self.addCleanup(clock.stop)
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        self.tmp = tempfile.TemporaryDirectory(prefix='cancelled-owner-', dir=scratch)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, value in {'STATE_DIR': self.root, 'STATE_FILE': self.root / 'engine-release-seal.json',
                'AUDIT_FILE': self.root / 'audit.jsonl', 'RESULT_DIR': self.root / 'engine-release-results',
                'LOCK_FILE': self.root / 'lock'}.items():
            p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        seal.RESULT_DIR.mkdir(mode=0o700)
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': seal.NINEF_POLICY_DIGEST, 'startsAt': 1793635200, 'endsAt': 1793635500,
            'runId': seal.CURRENT26_CANCELLED_RUN, 'sha': seal.CURRENT26_CANCELLED_TARGET,
            'controlSha': seal.CURRENT26_CANCELLED_SHA, 'status': 'reserved',
            'window': dict(seal.CURRENT26_CANCELLED_WINDOW)}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None,
            'generation': 312, 'routineMaintenanceCycles': {'1793635200': self.cycle}}
        seal.write_state(copy.deepcopy(self.base))
        self.proof = {'schema': 'cancelled-routine-announcement-proof/v1', 'originalCycle': self.cycle,
            'recordHashes': dict.fromkeys(('receipt','intent','quiescent','stop-issued'), 'a' * 64),
            'retainedHashes': dict.fromkeys(('entryHash','reservationHash','releasedHoldHash'), 'b' * 64),
            'sourceHashes': dict(seal.CURRENT26_CANCELLED_SOURCES), 'thaw': dict(seal.CURRENT26_CANCELLED_THAW),
            'container': {'id': CONTAINER, 'startedAt': '2026-11-02T05:54:48.403092401Z', 'image': A_IMAGE},
            'instanceId': '1-2ced3e43'}
        self.commands = []
        def command(argv, deadline, limit=32768, **kw):
            self.commands.append(argv)
            if argv[0] == 'git': return '# qualified read-only helper'
            self.assertEqual(argv[1:3], ['-B', '-c'])
            self.assertEqual(argv[-2:], ['--phase1-cancellation-proof', seal.CURRENT26_CANCELLED_RUN])
            return json.dumps(self.proof)
        for name, value in [('require_engine_lock', lambda fd: None),
                ('failed_routine_current', lambda a,d: {'same': True}),
                ('failed_routine_command', command),
                ('failed_routine_json', lambda p: json.loads(Path(p).read_text()))]:
            p = patch.object(seal, name, side_effect=value); p.start(); self.addCleanup(p.stop)

    def resolve(self):
        with patch.object(seal.os, 'geteuid', return_value=0), redirect_stdout(io.StringIO()) as out:
            args = seal.parser().parse_args(['resolve-terminal-routine-failures', '--engine-lock-fd', '9',
                '--run-id', LIVE_RUN, '--sha', TARGET_SHA, '--control-sha', CONTROL_SHA,
                '--invocation-id', INVOCATION])
            self.assertEqual(args.repo, '/opt/club-arena')
            args.handler(args)
        return out.getvalue().strip()

    def test_cancellation_resolves_without_fabricating_a_failure_and_replays(self):
        self.assertEqual(self.resolve(), seal.CURRENT26_CANCELLED_RUN)
        state = seal.load_state()
        self.assertEqual(state['routineMaintenanceCycles'], self.base['routineMaintenanceCycles'])
        self.assertFalse(seal.result_path(seal.CURRENT26_CANCELLED_RUN).exists())
        resolution = state['routineFailureResolutions'][seal.CURRENT26_CANCELLED_RUN]
        self.assertEqual(resolution['result'], 'cancelled-announcement-proved')
        self.assertEqual(self.resolve(), 'not-needed')
        self.assertFalse(seal.routine_owner_unresolved(state, self.cycle))
        fd = os.open(seal.RESULT_DIR, os.O_RDONLY | os.O_DIRECTORY)
        try:
            answer, _ = observer.routine_failure_resolution(resolution, self.cycle, None, fd)
            self.assertTrue(answer['present'] and answer['receiptMatches'])
            for field, change in [('sourceHashes', {}), ('thaw', {}), ('container', {})]:
                bad = copy.deepcopy(resolution); bad['proof'][field] = change
                with self.assertRaises((ValueError, KeyError)):
                    observer.routine_failure_resolution(bad, self.cycle, None, fd)
        finally: os.close(fd)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            observed = observer.routine_remote(dict(observer.ROUTINE_REQUEST), root_fd)
            self.assertFalse(observed['owners'][0]['unresolvedOwner'])
            self.assertFalse(observed['owners'][0]['failurePresent'])
        finally: os.close(root_fd)
        self.assertEqual(len([a for a in self.commands if a[0] == 'git']), 2)
        self.assertTrue(all(a[4] == CONTROL_SHA + ':scripts/ci/withdraw-waiting-engine-release.py'
                            for a in self.commands if a[0] == 'git'))

    def test_receipt_audit_and_state_interruptions_resume_one_resolution(self):
        for edge in ('audit_once', 'write_state'):
            with self.subTest(edge=edge):
                seal.write_state(copy.deepcopy(self.base))
                for p in seal.RESULT_DIR.iterdir(): p.unlink()
                seal.AUDIT_FILE.unlink(missing_ok=True)
                with patch.object(seal, edge, side_effect=RuntimeError('crash')):
                    with self.assertRaises(RuntimeError): self.resolve()
                receipt = seal.terminal_receipt_path(seal.CURRENT26_CANCELLED_RUN, LIVE_RUN, INVOCATION)
                before = receipt.read_bytes()
                self.assertNotIn('routineFailureResolutions', seal.load_state())
                self.assertEqual(self.resolve(), seal.CURRENT26_CANCELLED_RUN)
                self.assertEqual(receipt.read_bytes(), before)
                rows = [json.loads(x) for x in seal.AUDIT_FILE.read_text().splitlines()]
                self.assertEqual(len(rows), 1)

    def test_post_window_desired_successor_resolves_and_observation_replays(self):
        self.proof['container']['startedAt'] = '2026-11-02T16:21:51.848Z'
        self.proof['instanceId'] = '1-7920f8a6'
        self.assertEqual(self.resolve(), seal.CURRENT26_CANCELLED_RUN)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            observed = observer.routine_remote(dict(observer.ROUTINE_REQUEST), root_fd)
            self.assertFalse(observed['owners'][0]['unresolvedOwner'])
        finally: os.close(root_fd)
        self.assertEqual(self.resolve(), 'not-needed')

    def test_cancellation_runtime_birth_is_bounded_by_historical_proof(self):
        self.assertEqual(self.resolve(), seal.CURRENT26_CANCELLED_RUN)
        resolution = seal.load_state()['routineFailureResolutions'][seal.CURRENT26_CANCELLED_RUN]
        for stamp in ('2026-11-02T15:58:05.893Z', '2026-11-02T16:02:00Z',
                      '2026-11-02T16:05:05.893Z', '2099-01-01T00:00:00Z',
                      '2026-11-02T07:21:51.848', 'unknown'):
            with self.subTest(stamp=stamp):
                bad = copy.deepcopy(resolution)
                bad['proof']['container']['startedAt'] = stamp
                with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    seal.validate_cancelled_phase1_resolution(bad, self.cycle, verify_receipt=False)
                self.assertFalse(observer.cancelled_phase1_started_at(stamp, resolution['observedAt'], seal.CURRENT26_CANCELLED_RUN))

    def test_changed_window_source_thaw_and_live_transaction_refuse(self):
        for field in ('pending', 'finalization', 'committed', 'window', 'source', 'thaw', 'startedAt', 'proofChanged'):
            with self.subTest(field=field):
                state = copy.deepcopy(self.base); proof = copy.deepcopy(self.proof)
                if field in ('pending','finalization'): state[field] = {'runId': LIVE_RUN, 'sha': TARGET_SHA, 'imageId': OTHER_IMAGE}
                if field == 'committed': state['committedRuns'][seal.CURRENT26_CANCELLED_RUN] = {'sha': seal.CURRENT26_CANCELLED_TARGET, 'imageId': OTHER_IMAGE}
                if field == 'window': state['routineMaintenanceCycles']['1793635200']['window']['startsAt'] -= 1
                if field == 'source': proof['sourceHashes'] = {}
                if field == 'thaw': proof['thaw']['freezeStartedAtMs'] += 1
                if field == 'startedAt': proof['container']['startedAt'] = 'unknown'
                seal.write_state(state)
                for p in seal.RESULT_DIR.iterdir(): p.unlink()
                original = self.proof; self.proof = proof
                if field == 'proofChanged':
                    self.proof['originalCycle'] = {**self.cycle, 'sha': A_SHA}
                try:
                    with redirect_stderr(io.StringIO()), self.assertRaises((SystemExit, ValueError)):
                        self.resolve()
                    self.assertNotIn('routineFailureResolutions', json.loads(seal.STATE_FILE.read_text()))
                    self.assertEqual(list(seal.RESULT_DIR.iterdir()), [])
                finally: self.proof = original


class GenericCancelledAnnouncementOwner(unittest.TestCase):
    """Any later expired announcement-only owner resolves with no per-run code."""
    RUN = '41599999999-1'  # a hypothetical later owner: no code names it
    TARGET, CONTROL = '26aaaa3f350ca063caed717b5fcbbcf34b5ae702', 'fffcb62ea1f114322da964f9e580f8be3b3e3383'
    WINDOW = {'announcedAt': 1793635085893, 'startsAt': 1793635205893, 'endsAt': 1793635505893, 'verified': True}
    THAW = {'announcedAtMs': 1793635085893, 'freezeStartedAtMs': 1793635205893, 'releasedThroughMs': 1793635505893,
            'ownershipToken': 'a993695f-4a6a-4cb3-99af-b88765f21c99', 'generation': 1, 'thawRecordedAtMs': 1793635427493}
    SOURCES = {name: format(i, 'x') * 64 for i, name in enumerate(sorted(seal.CANCELLED_PHASE1_SOURCES), 1)}

    def setUp(self):
        clock = patch.object(seal.time, "time", return_value=1793638800)  # 17:00 UTC, after the window
        clock.start(); self.addCleanup(clock.stop)
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        self.tmp = tempfile.TemporaryDirectory(prefix='generic-cancelled-', dir=scratch)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, value in {'STATE_DIR': self.root, 'STATE_FILE': self.root / 'engine-release-seal.json',
                'AUDIT_FILE': self.root / 'audit.jsonl', 'RESULT_DIR': self.root / 'engine-release-results',
                'LOCK_FILE': self.root / 'lock'}.items():
            p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        seal.RESULT_DIR.mkdir(mode=0o700)
        (self.root / 'engine-release-cancellations').mkdir(mode=0o700)
        self.withdrawal = self.root / 'engine-release-cancellations' / (self.RUN + '.receipt.json')
        self.withdrawal.write_text('{}')
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': seal.NINEF_POLICY_DIGEST, 'startsAt': 1793635200, 'endsAt': 1793635500,
            'runId': self.RUN, 'sha': self.TARGET, 'controlSha': self.CONTROL, 'status': 'reserved',
            'window': dict(self.WINDOW)}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None,
            'generation': 312, 'routineMaintenanceCycles': {'1793635200': self.cycle}}
        seal.write_state(copy.deepcopy(self.base))
        self.proof = {'schema': 'cancelled-routine-announcement-proof/v1', 'originalCycle': self.cycle,
            'recordHashes': dict.fromkeys(('receipt','intent','quiescent','stop-issued'), 'a' * 64),
            'retainedHashes': dict.fromkeys(('entryHash','reservationHash','releasedHoldHash'), 'b' * 64),
            'sourceHashes': dict(self.SOURCES), 'thaw': dict(self.THAW),
            'container': {'id': CONTAINER, 'startedAt': '2026-11-02T15:03:36.03811103Z', 'image': A_IMAGE},
            'instanceId': '1-b22cba29'}
        self.protected = dict(self.SOURCES)
        self.commands = []
        def command(argv, deadline, limit=32768, **kw):
            self.commands.append(argv)
            if argv[0] == 'git': return '# qualified read-only helper'
            self.assertEqual(argv[1:3], ['-B', '-c'])
            self.assertEqual(argv[-2:], ['--phase1-cancellation-proof', self.RUN])
            return json.dumps(self.proof)
        for name, value in [('require_engine_lock', lambda fd: None),
                ('failed_routine_current', lambda a,d: {'same': True}),
                ('failed_routine_command', command),
                ('generic_cancelled_sources', lambda repo, control, deadline: dict(self.protected)),
                ('failed_routine_json', lambda p: json.loads(Path(p).read_text()))]:
            p = patch.object(seal, name, side_effect=value); p.start(); self.addCleanup(p.stop)

    def resolve(self):
        with patch.object(seal.os, 'geteuid', return_value=0), redirect_stdout(io.StringIO()) as out:
            args = seal.parser().parse_args(['resolve-terminal-routine-failures', '--engine-lock-fd', '9',
                '--run-id', LIVE_RUN, '--sha', TARGET_SHA, '--control-sha', CONTROL_SHA,
                '--invocation-id', INVOCATION])
            args.handler(args)
        return out.getvalue().strip()

    def unresolved(self):
        self.assertEqual(self.resolve(), 'not-needed')
        state = json.loads(seal.STATE_FILE.read_text())
        self.assertNotIn('routineFailureResolutions', state)
        self.assertEqual(list(seal.RESULT_DIR.iterdir()), [])

    def test_later_owner_resolves_without_code_change_and_replays(self):
        self.assertEqual(self.resolve(), self.RUN)
        state = seal.load_state()
        self.assertEqual(state['routineMaintenanceCycles'], self.base['routineMaintenanceCycles'])
        self.assertFalse(seal.result_path(self.RUN).exists())
        resolution = state['routineFailureResolutions'][self.RUN]
        self.assertEqual(resolution['result'], 'cancelled-announcement-proved')
        self.assertEqual(resolution['proof']['sourceHashes'], self.SOURCES)
        self.assertEqual(self.resolve(), 'not-needed')
        self.assertFalse(seal.routine_owner_unresolved(state, self.cycle))
        fd = os.open(seal.RESULT_DIR, os.O_RDONLY | os.O_DIRECTORY)
        try:
            answer, _ = observer.routine_failure_resolution(resolution, self.cycle, None, fd)
            self.assertTrue(answer['present'] and answer['receiptMatches'])
            for field, change in [('sourceHashes', {}), ('thaw', {}), ('container', {})]:
                bad = copy.deepcopy(resolution); bad['proof'][field] = change
                with self.assertRaises((ValueError, KeyError)):
                    observer.routine_failure_resolution(bad, self.cycle, None, fd)
        finally: os.close(fd)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            observed = observer.routine_remote(dict(observer.ROUTINE_REQUEST), root_fd)
            self.assertFalse(observed['owners'][0]['unresolvedOwner'])
        finally: os.close(root_fd)

    def test_every_missing_or_changed_safety_proof_keeps_the_owner(self):
        cases = ['no-withdrawal', 'unexpired', 'committed', 'pending', 'finalization', 'failed-owner',
                 'early-freeze', 'thaw-window', 'source', 'image', 'birth-inside-window', 'proof-cycle',
                 'helper-refuses', 'self']
        for case in cases:
            with self.subTest(case=case):
                state = copy.deepcopy(self.base); proof = copy.deepcopy(self.proof)
                self.withdrawal.write_text('{}')
                self.protected = dict(self.SOURCES)
                clock = 1793638800; run_id = LIVE_RUN
                if case == 'no-withdrawal': self.withdrawal.unlink()
                if case == 'unexpired': clock = 1793635400
                if case == 'committed': state['committedRuns'][self.RUN] = {'sha': self.TARGET, 'imageId': OTHER_IMAGE}
                if case in ('pending', 'finalization'): state[case] = {'runId': LIVE_RUN, 'sha': TARGET_SHA, 'imageId': OTHER_IMAGE}
                if case == 'failed-owner': state['routineMaintenanceCycles']['1793635200']['failure'] = {'result': 'failed'}
                if case == 'early-freeze':
                    w = state['routineMaintenanceCycles']['1793635200']['window']
                    w['startsAt'] -= 1; w['endsAt'] -= 1
                if case == 'thaw-window': proof['thaw']['freezeStartedAtMs'] -= 1
                if case == 'source': self.protected['engine-release-seal.py'] = 'f' * 64
                if case == 'image': proof['container']['image'] = OTHER_IMAGE
                if case == 'birth-inside-window': proof['container']['startedAt'] = '2026-11-02T16:01:00Z'
                if case == 'proof-cycle': proof['originalCycle'] = {**self.cycle, 'sha': A_SHA}
                if case == 'self': run_id = self.RUN
                original = self.proof; self.proof = proof
                if case == 'helper-refuses':
                    self.proof = 'not json'
                try:
                    if case in ('committed', 'failed-owner'):
                        # These shapes are not even a valid routine history to load.
                        seal.STATE_FILE.write_text(json.dumps(state))
                    else:
                        seal.write_state(state)
                    for p in seal.RESULT_DIR.iterdir(): p.unlink()
                    with patch.object(seal.time, 'time', return_value=clock), \
                            patch.object(seal.os, 'geteuid', return_value=0), \
                            redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()):
                        try:
                            args = seal.parser().parse_args(['resolve-terminal-routine-failures', '--engine-lock-fd', '9',
                                '--run-id', run_id, '--sha', TARGET_SHA, '--control-sha', CONTROL_SHA,
                                '--invocation-id', INVOCATION])
                            args.handler(args)
                        except SystemExit:
                            pass
                    self.assertNotEqual(out.getvalue().strip(), self.RUN)
                    self.assertNotIn('routineFailureResolutions', json.loads(seal.STATE_FILE.read_text()))
                    self.assertEqual(list(seal.RESULT_DIR.iterdir()), [])
                finally:
                    self.proof = original

    def test_recorded_generic_resolution_is_revalidated_on_every_load(self):
        self.assertEqual(self.resolve(), self.RUN)
        good = json.loads(seal.STATE_FILE.read_text())
        for field, change in [('thaw', {**self.THAW, 'freezeStartedAtMs': self.THAW['freezeStartedAtMs'] + 1}),
                              ('sourceHashes', {}), ('container', {**self.proof['container'], 'startedAt': 'unknown'})]:
            with self.subTest(field=field):
                bad = copy.deepcopy(good)
                bad['routineFailureResolutions'][self.RUN]['proof'][field] = change
                seal.STATE_FILE.write_text(json.dumps(bad))
                with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    seal.routine_cycles(seal.load_state())
        seal.STATE_FILE.write_text(json.dumps(good))
        self.assertEqual(len(seal.routine_cycles(seal.load_state())), 1)

    def test_pinned_owners_never_take_the_generic_path(self):
        for owner in (seal.NINEF_RUN, seal.DAILY_REFUSAL_RUN, seal.PREATTACH_RUN, seal.FAILED_ROUTINE_RUN,
                      seal.CANCELLED_PHASE1_RUN, seal.SECOND_CANCELLED_PHASE1_RUN):
            with self.subTest(owner=owner):
                cycle = {**self.cycle, 'runId': owner}
                self.assertFalse(seal.generic_cancelled_candidate(self.base, cycle))


class PreattachmentOwner(unittest.TestCase):
    # Reuse only fixture plumbing, not its other-owner test cases.
    for name in ('sources','current','reset','native_unit','service_empty','container','birth',
                 'quiet','refused','resolve','resolve_or_refusal','owner','write_intent'):
        locals()[name] = getattr(TerminalFailedRoutineOwner, name)

    def setUp(self):
        TerminalFailedRoutineOwner.setUp(self)
        # This later captured refusal and its successor both precede 14:30 UTC.
        clock = patch.object(seal.time, "time", return_value=1793629800)
        clock.start(); self.addCleanup(clock.stop)
        self.dead = seal.PREATTACH_RUN
        self.request_root = seal.STATE_DIR / 'engine-release-requests'
        self.request_root.mkdir()
        self.live = {'Id':CONTAINER,'Image':A_IMAGE,'State':{'Running':True,'Status':'running',
            'StartedAt':'2026-11-02T13:10:18.979153938Z','Pid':12345}}
        identity = f"{CONTAINER} {A_IMAGE} true {self.live['State']['StartedAt']} 12345"
        proposal = {'schema':'main-inspector-retirement/v1',
            'endpoint':'ws://127.0.0.1:9229/11111111-1111-4111-8111-111111111111',
            'binding':{'schema':'main-inspector-socket-binding/v1','pid':1,'startTicks':'10',
                'namespace':'net:[100]','listener':{'family':'tcp','local':'0100007F:240D','inode':'77'}}}
        import hashlib
        for key,value in {'PREATTACH_CONTAINER':hashlib.sha256(identity.encode()).hexdigest(),
            'PREATTACH_PROPOSAL':hashlib.sha256(json.dumps(proposal,separators=(',',':')).encode()).hexdigest()}.items():
            p=patch.object(seal,key,value);p.start();self.addCleanup(p.stop)
        self.claim={'schema':'main-inspector-retirement-claim/v1','runId':self.dead,
            'invocationId':seal.PREATTACH_INVOCATION,'controlSha':seal.PREATTACH_SHA,
            'requestDeadline':1793638383,'target':seal.PREATTACH_SHA,'requestSha256':'9'*64,
            'nativeUnit':{'InvocationID':seal.PREATTACH_INVOCATION,'ActiveState':'activating','SubState':'start'},
            'source':A_SHA,'instance':'1-2790e861','containerIdentity':identity,'proposal':proposal,
            'proposalSha256':seal.PREATTACH_PROPOSAL,'deadlineMs':1793627940000,'retryAllowed':False}
        self.claim_path=self.request_root/(self.dead+'.main-inspector-retirement-intent')
        self.claim_path.write_text(json.dumps(self.claim))
        self.failure={'schema':1,'runId':self.dead,'result':'failed','sha':seal.PREATTACH_SHA,
            'controlSha':seal.PREATTACH_SHA,'invocationId':seal.PREATTACH_INVOCATION,'transactionExitStatus':1,
            'recoveredDesiredSha':A_SHA,'recoveredDesiredImageId':A_IMAGE,'completedAt':1793627937}
        self.cycle={'kind':'hourly-reset','policyId':seal.SCHEDULE_POLICY_ID,'policyDigest':seal.NINEF_POLICY_DIGEST,
            'startsAt':1793628000,'endsAt':1793628300,'runId':self.dead,'sha':seal.PREATTACH_SHA,
            'controlSha':seal.PREATTACH_SHA,'status':'reserved','failure':self.failure}
        self.base['routineMaintenanceCycles']={'1793628000':self.cycle}
        seal.write_state(self.base);seal.write_json_atomic(seal.result_path(self.dead),self.failure)
        self.health['instanceId']=self.claim['instance']
        self.database={'schema':'failed-routine-database-idle/v1','sha':A_SHA,'instanceId':self.claim['instance'],
            'databaseIdle':True,'freshLeader':True}
        self.journal=[{'MESSAGE':json.dumps(seal.PREATTACH_DIAGNOSTIC),
            '_SYSTEMD_UNIT':f'club-arena-engine-release-v1@{self.dead}.service',
            '_SYSTEMD_INVOCATION_ID':seal.PREATTACH_INVOCATION,'__REALTIME_TIMESTAMP':'1793627936000000'}]
        p=patch.object(seal,'failed_routine_current_identity',side_effect=self.current);p.start();self.addCleanup(p.stop)
        self.mocks['failed_routine_current'].side_effect=self.entry
        self.entry_seen=False

    def command(self,command,deadline,limit=32768):
        if command[:3]==['docker','container','inspect']:
            return json.dumps(self.live)
        if command[:3]==['docker','image','inspect']:
            return json.dumps({'Id':A_IMAGE,'Config':{'Env':['GIT_COMMIT_SHA='+A_SHA]}})
        if command[0]=='docker' and 'preattach-proof' in command:
            return json.dumps(getattr(self,'binding_override',self.claim['proposal']['binding']))
        return TerminalFailedRoutineOwner.command(self,command,deadline,limit)

    def entry(self,args,deadline):
        # The real readonly attestation must succeed BEFORE the ordinary gate.
        self.quiet(lambda:seal.cmd_attest_preattach_resolution(Namespace(
            run_id=self.dead,claim_digest=seal.failed_routine_digest(self.claim))))
        self.entry_seen=True
        return self.current(args,deadline)

    def test_original_claim_and_failure_survive_distinct_disposition_and_duplicate(self):
        before=self.claim_path.read_bytes()
        self.assertEqual(self.resolve(),self.dead)
        self.assertTrue(self.entry_seen)
        state=seal.load_state();r=state['routineFailureResolutions'][self.dead]
        self.assertEqual(r['result'],'preattach-refusal-proved')
        self.assertIs(r['proof']['nativeCloseInvoked'],False)
        self.assertEqual(state['routineMaintenanceCycles']['1793628000'],self.cycle)
        self.assertEqual(self.claim_path.read_bytes(),before)
        self.assertFalse((self.request_root/(self.dead+'.main-inspector-retirement-receipt')).exists())
        self.assertEqual(self.owner(),'none')
        self.assertEqual(self.resolve(),'not-needed')
        self.assertEqual(seal.load_state(),state)

    def test_missing_or_changed_native_facts_never_dispose(self):
        good=copy.deepcopy(self.journal)
        cases=[None]
        for key in ['closeRequested','closeAcknowledged','connectionClosed']:
            row=copy.deepcopy(good);v=json.loads(row[0]['MESSAGE']);v['native'][key]=True;row[0]['MESSAGE']=json.dumps(v);cases.append(row)
        for key,value in [('stage','connect'),('reason','deadline_exhausted')]:
            row=copy.deepcopy(good);v=json.loads(row[0]['MESSAGE']);v['native'][key]=value;row[0]['MESSAGE']=json.dumps(v);cases.append(row)
        row=copy.deepcopy(good);v=json.loads(row[0]['MESSAGE']);v['childExit']='unknown';row[0]['MESSAGE']=json.dumps(v);cases.append(row)
        row=copy.deepcopy(good);row[0]['_SYSTEMD_INVOCATION_ID']='0'*32;cases.append(row)
        cases.append(good+good)
        for journal in cases:
            with self.subTest(journal=journal):
                self.journal=journal or []
                self.refused(self.resolve)
                self.assertFalse(list(seal.RESULT_DIR.glob('*.terminal-resolution.json')))
                self.assertNotIn('routineFailureResolutions',seal.load_state())
        self.journal=good

    def test_active_owner_retained_edges_and_claim_drift_refuse(self):
        for suffix in ('request','intent','legacy-checkpoint-intent','main-inspector-retirement-receipt',
                       'activation-entry','lightning-hold.json','awaiting-certificate'):
            with self.subTest(suffix=suffix):
                p=self.request_root/(self.dead+'.'+suffix);p.write_text('{}')
                self.refused(self.resolve);p.unlink()
                self.assertFalse(list(seal.RESULT_DIR.glob('*.terminal-resolution.json')))
        self.cgroup_empty=False;self.refused(self.resolve);self.cgroup_empty=True
        original=self.claim_path.read_bytes()
        for key,value in [('retryAllowed',True),('source','f'*40),('invocationId','f'*32),
                          ('proposalSha256','f'*64),('requestDeadline',0),('instance','1-deadbeef')]:
            with self.subTest(key=key):
                self.claim_path.write_text(json.dumps({**self.claim,key:value}));self.refused(self.resolve)
        self.claim_path.write_bytes(original)

    def test_runtime_health_binding_and_database_must_match(self):
        self.binding_override={};self.refused(self.resolve);del self.binding_override
        self.public_health={**self.health,'instanceId':'1-deadbeef'};self.refused(self.resolve);self.public_health=None
        self.database['databaseIdle']=False;self.refused(self.resolve);self.database['databaseIdle']=True
        self.health['maintenance']['active']=True;self.refused(self.resolve);self.health['maintenance']['active']=False
        self.current_drift=True;self.refused(self.resolve);self.current_drift=False
        self.sources_ok=False;self.refused(self.resolve);self.sources_ok=True
        self.assertFalse(list(seal.RESULT_DIR.glob('*.terminal-resolution.json')))

    def test_interrupted_disposition_write_converges_without_close_receipt(self):
        real=seal.write_json_atomic
        def fail(path,value):
            if str(path).endswith('.preattach-disposition.json'):raise OSError('fixture power loss')
            real(path,value)
        with patch.object(seal,'write_json_atomic',side_effect=fail),self.assertRaises(OSError):self.resolve()
        self.assertEqual(len(list(seal.RESULT_DIR.glob('*.terminal-resolution.json'))),1)
        self.assertNotIn('routineFailureResolutions',seal.load_state())
        self.live['State'].update(Pid=45678,StartedAt='2026-11-02T14:10:00Z')
        self.health['instanceId']=self.database['instanceId']='1-deadbeef'
        self.old_birth=None
        self.assertEqual(self.resolve(),self.dead)
        self.assertFalse((self.request_root/(self.dead+'.main-inspector-retirement-receipt')).exists())

    def test_interrupted_seal_cas_resumes_with_another_verifier_preserving_receipt(self):
        with patch.object(seal,'write_state',side_effect=OSError('fixture power loss')),self.assertRaises(OSError):self.resolve()
        disposition=seal.RESULT_DIR/(self.dead+'.preattach-disposition.json')
        before=disposition.read_bytes()
        self.live['State'].update(Pid=45678,StartedAt='2026-11-02T14:10:00Z')
        self.health['instanceId']=self.database['instanceId']='1-deadbeef'
        self.old_birth=None
        self.assertEqual(self.resolve(invocation='f'*32),self.dead)
        self.assertEqual(disposition.read_bytes(),before)
        r=seal.load_state()['routineFailureResolutions'][self.dead]
        self.assertEqual(r['invocationId'],INVOCATION)
        self.assertEqual(len(list(seal.RESULT_DIR.glob('*.terminal-resolution.json'))),1)

    def test_successor_requires_positive_old_process_death_and_closed_inspector(self):
        self.live['State'].update(Pid=45678,StartedAt='2026-11-02T14:10:00Z')
        runtime={'containerId':CONTAINER,'startedAt':self.live['State']['StartedAt'],'instanceId':'1-deadbeef'}
        self.database['instanceId']=runtime['instanceId']
        self.health['instanceId']=runtime['instanceId']
        self.old_birth=1793627900;self.refused(self.resolve)
        self.old_birth=None
        self.inspector_open=True
        with self.assertRaises(ValueError):self.resolve()
        self.inspector_open=False
        self.assertEqual(self.resolve(),self.dead)
        proof=seal.load_state()['routineFailureResolutions'][self.dead]['proof']
        self.assertEqual(proof['runtime']['mode'],'successor-inspector-closed')
        self.assertEqual(proof['runtime']['originalProcess'],'kernel-enoent')

    def test_successor_metadata_obeys_the_shared_absolute_deadline(self):
        with patch.object(seal,'failed_routine_command',side_effect=ORIGINAL_BOUNDED_COMMAND), \
                patch.object(seal.subprocess,'Popen',side_effect=AssertionError('expired proof cannot spawn')):
            self.refused(lambda:seal.failed_routine_runtime(time.monotonic()-1,bounded=True))

    def test_canonical_observer_reads_distinct_disposition_and_refuses_missing_receipt(self):
        import shutil
        self.assertEqual(self.resolve(),self.dead)
        root=self.root/'canonical';root.mkdir(mode=0o700)
        results=root/'engine-release-results';results.mkdir(mode=0o700)
        shutil.copyfile(seal.STATE_FILE,root/'engine-release-seal.json')
        for source in seal.RESULT_DIR.iterdir():shutil.copyfile(source,results/source.name)
        for path in [root/'engine-release-seal.json',*results.iterdir()]:os.chmod(path,0o600)
        fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY);self.addCleanup(os.close,fd)
        with patch.object(observer,'PREATTACH_CONTAINER',seal.PREATTACH_CONTAINER):
            reply=observer.routine_remote(observer.ROUTINE_REQUEST,fd)
            observer.validate_routine_reply(reply,observer.ROUTINE_REQUEST)
            row=next(r for r in reply['owners'] if r['runId']==self.dead)
            self.assertFalse(row['unresolvedOwner'])
            self.assertTrue(row['failureResolution']['noAnnouncementRecorded'])
            receipt=next(results.glob('*.terminal-resolution.json'));receipt.unlink()
            with self.assertRaises(observer.ScopedRefusal) as error:observer.routine_remote(observer.ROUTINE_REQUEST,fd)
            self.assertEqual((error.exception.phase,error.exception.code),('routine_disposition','file_missing'))
        # Oversize remains refused, now with a closed diagnostic. No cap bump.
        (root/'engine-release-seal.json').write_bytes(b' '*(observer.ROUTINE_SEAL_MAX_BYTES+1))
        with self.assertRaises(observer.ScopedRefusal) as error:observer.routine_remote(observer.ROUTINE_REQUEST,fd)
        self.assertEqual((error.exception.phase,error.exception.code),('routine_seal_read','file_size'))
        out=observer.refusal(observer.ROUTINE_REQUEST,error.exception)
        observer.validate_refusal(out,observer.ROUTINE_REQUEST)

    def test_resolution_rejects_boolean_coercion_and_changed_claim(self):
        self.assertEqual(self.resolve(),self.dead)
        r=seal.load_state()['routineFailureResolutions'][self.dead]
        for key in ['databaseIdle','freshLeader']:
            value=copy.deepcopy(r);value['proof']['runtime'][key]=1
            self.refused(lambda:seal.validate_preattach_resolution(value,self.cycle,verify_receipt=False))
        self.claim_path.write_text(json.dumps({**self.claim,'requestSha256':'8'*64}))
        self.refused(self.owner)


class GenericUnenteredFailedOwner(unittest.TestCase):
    """A later owner that reserved its hour and failed before any announcement
    resolves by positive proof with no per-run code (41511864834-1 shape)."""
    RUN = '41599999998-1'  # hypothetical: no code names it
    TARGET = 'b3014ef4abca410de57464385a800241c9cc8d69'
    START = 1793649600  # 20:00 UTC
    NATIVE = {'club-arena-engine-release-v1@41599999998-1.service': {'ActiveState': 'failed'}}
    RUNTIME = {'containerId': CONTAINER, 'startedAt': '2026-11-02T19:35:05.1Z', 'instanceId': '1-03b3ab60'}

    def setUp(self):
        clock = patch.object(seal.time, 'time', return_value=self.START + 300 + 120)
        clock.start(); self.addCleanup(clock.stop)
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        self.tmp = tempfile.TemporaryDirectory(prefix='generic-unentered-', dir=scratch)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, value in {'STATE_DIR': self.root, 'STATE_FILE': self.root / 'engine-release-seal.json',
                'AUDIT_FILE': self.root / 'audit.jsonl', 'RESULT_DIR': self.root / 'engine-release-results',
                'LOCK_FILE': self.root / 'lock'}.items():
            p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        seal.RESULT_DIR.mkdir(mode=0o700)
        self.failure = {'completedAt': self.START + 365, 'controlSha': self.TARGET,
            'invocationId': '2d353b539c0945429f9bb084ed39362b', 'recoveredDesiredImageId': A_IMAGE,
            'recoveredDesiredSha': A_SHA, 'result': 'failed', 'runId': self.RUN, 'schema': 1,
            'sha': self.TARGET, 'transactionExitStatus': 1}
        seal.result_path(self.RUN).write_text(json.dumps(self.failure))
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': seal.NINEF_POLICY_DIGEST, 'startsAt': self.START, 'endsAt': self.START + 300,
            'runId': self.RUN, 'sha': self.TARGET, 'controlSha': self.TARGET, 'status': 'reserved',
            'failure': dict(self.failure)}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None,
            'generation': 313, 'routineMaintenanceCycles': {str(self.START): self.cycle}}
        seal.write_state(copy.deepcopy(self.base))
        self.native_ok = True; self.runtime_ok = True; self.database_ok = True
        def native(deadline, owner=None, retained_preattach=False):
            self.assertEqual(owner, self.RUN)
            if not self.native_ok: seal.die('trace remains')
            return dict(self.NATIVE)
        def runtime(deadline, bounded=False):
            if not self.runtime_ok: seal.die('runtime not idle')
            return dict(self.RUNTIME)
        def database(rt, deadline):
            if not self.database_ok: seal.die('database not idle')
        for name, value in [('require_engine_lock', lambda fd: None),
                ('failed_routine_current', lambda a, d: {'same': True}),
                ('failed_routine_native_proof', native), ('failed_routine_runtime', runtime),
                ('failed_routine_database', database),
                ('failed_routine_json', lambda p: json.loads(Path(p).read_text()))]:
            p = patch.object(seal, name, side_effect=value); p.start(); self.addCleanup(p.stop)

    def resolve(self, run_id=LIVE_RUN, sha=TARGET_SHA):
        with patch.object(seal.os, 'geteuid', return_value=0), redirect_stdout(io.StringIO()) as out, \
                redirect_stderr(io.StringIO()):
            args = seal.parser().parse_args(['resolve-terminal-routine-failures', '--engine-lock-fd', '9',
                '--run-id', run_id, '--sha', sha, '--control-sha', sha, '--invocation-id', INVOCATION])
            args.handler(args)
        return out.getvalue().strip()

    def test_unentered_owner_resolves_without_code_change_and_replays(self):
        original = copy.deepcopy(self.cycle)
        self.assertEqual(self.resolve(), self.RUN)
        state = seal.load_state()
        self.assertEqual(state['routineMaintenanceCycles'][str(self.START)], original)
        self.assertNotIn('window', original)
        resolution = state['routineFailureResolutions'][self.RUN]
        self.assertEqual(resolution['result'], 'unentered-cycle-proved')
        self.assertEqual(resolution['proof']['runtime'], self.RUNTIME)
        self.assertEqual(resolution['proof']['failureDigest'], seal.failed_routine_digest(self.failure))
        self.assertFalse(seal.routine_owner_unresolved(state, original))
        receipt = seal.terminal_receipt_path(self.RUN, LIVE_RUN, INVOCATION)
        self.assertEqual(json.loads(receipt.read_text()), resolution)
        before = seal.STATE_FILE.read_bytes()
        self.assertEqual(self.resolve(), 'not-needed')
        self.assertEqual(seal.STATE_FILE.read_bytes(), before)
        fd = os.open(seal.RESULT_DIR, os.O_RDONLY | os.O_DIRECTORY)
        try:
            answer, _ = observer.routine_failure_resolution(resolution, original, self.failure, fd)
            self.assertTrue(answer['present'] and answer['receiptMatches'] and answer['noAnnouncementRecorded'])
            bad = copy.deepcopy(resolution); bad['proof']['database'] = {}
            with self.assertRaises((ValueError, KeyError)):
                observer.routine_failure_resolution(bad, original, self.failure, fd)
        finally:
            os.close(fd)

    def test_every_missing_or_changed_safety_proof_keeps_the_owner(self):
        cases = ['unexpired', 'committed', 'pending', 'finalization', 'announced', 'no-failure',
                 'durable-differs', 'desired-moved', 'trace-remains', 'runtime-not-idle',
                 'database-not-idle', 'self', 'verifier-is-owner-source', 'pinned']
        for case in cases:
            with self.subTest(case=case):
                state = copy.deepcopy(self.base)
                cycle = state['routineMaintenanceCycles'][str(self.START)]
                seal.result_path(self.RUN).write_text(json.dumps(self.failure))
                self.native_ok = self.runtime_ok = self.database_ok = True
                clock = self.START + 300 + 120; run_id = LIVE_RUN; sha = TARGET_SHA; raw = False
                if case == 'unexpired': clock = self.START + 300 + 30
                if case == 'committed':
                    state['committedRuns'][self.RUN] = {'sha': self.TARGET, 'imageId': OTHER_IMAGE}; raw = True
                if case in ('pending', 'finalization'):
                    state[case] = {'runId': LIVE_RUN, 'sha': TARGET_SHA, 'imageId': OTHER_IMAGE}
                if case == 'announced':
                    cycle['window'] = {'announcedAt': self.START * 1000 - 120000, 'startsAt': self.START * 1000,
                                       'endsAt': self.START * 1000 + 300000, 'verified': True}; raw = True
                if case == 'no-failure': del cycle['failure']; raw = True
                if case == 'durable-differs':
                    seal.result_path(self.RUN).write_text(json.dumps({**self.failure, 'completedAt': 1}))
                if case == 'desired-moved': state['desired'] = {'sha': TARGET_SHA, 'imageId': OTHER_IMAGE,
                                                                'legacyUnlabelled': False}
                if case == 'trace-remains': self.native_ok = False
                if case == 'runtime-not-idle': self.runtime_ok = False
                if case == 'database-not-idle': self.database_ok = False
                if case == 'self': run_id = self.RUN
                if case == 'verifier-is-owner-source': sha = self.TARGET
                if case == 'pinned':
                    cycle['runId'] = seal.DAILY_REFUSAL_RUN; cycle['failure']['runId'] = seal.DAILY_REFUSAL_RUN
                    raw = True
                if raw:
                    seal.STATE_FILE.write_text(json.dumps(state))
                else:
                    seal.write_state(state)
                for p in seal.RESULT_DIR.glob('*.terminal-resolution.json'): p.unlink()
                with patch.object(seal.time, 'time', return_value=clock):
                    try:
                        answer = self.resolve(run_id, sha)
                    except SystemExit:
                        answer = 'refused'
                self.assertNotEqual(answer, self.RUN)
                self.assertNotIn('routineFailureResolutions', json.loads(seal.STATE_FILE.read_text()))
                self.assertEqual(list(seal.RESULT_DIR.glob('*.terminal-resolution.json')), [])

    def test_recorded_unentered_resolution_is_revalidated_on_every_load(self):
        self.assertEqual(self.resolve(), self.RUN)
        good = json.loads(seal.STATE_FILE.read_text())
        for field, change in [('database', {}), ('runtime', {**self.RUNTIME, 'startedAt': 'unknown'}),
                              ('failureDigest', 'f' * 64)]:
            with self.subTest(field=field):
                bad = copy.deepcopy(good)
                bad['routineFailureResolutions'][self.RUN]['proof'][field] = change
                seal.STATE_FILE.write_text(json.dumps(bad))
                with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    seal.routine_cycles(seal.load_state())
        seal.STATE_FILE.write_text(json.dumps(good))
        self.assertEqual(len(seal.routine_cycles(seal.load_state())), 1)

    def test_pinned_and_announced_owners_never_take_the_unentered_path(self):
        for owner in sorted(seal.pinned_routine_owners()):
            with self.subTest(owner=owner):
                cycle = {**self.cycle, 'runId': owner, 'failure': {**self.failure, 'runId': owner}}
                self.assertFalse(seal.generic_unentered_candidate(self.base, cycle))
        announced = {**self.cycle, 'window': {'announcedAt': 1, 'startsAt': 2, 'endsAt': 3, 'verified': True}}
        self.assertFalse(seal.generic_unentered_candidate(self.base, announced))


class RoutineCycleAdmissionLead(unittest.TestCase):
    """An hour whose only announcement minute has passed is never reserved."""

    def setUp(self):
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        self.tmp = tempfile.TemporaryDirectory(prefix='cycle-lead-', dir=scratch)
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        for name, value in {'STATE_DIR': root, 'STATE_FILE': root / 'engine-release-seal.json',
                'AUDIT_FILE': root / 'audit.jsonl', 'RESULT_DIR': root / 'engine-release-results',
                'LOCK_FILE': root / 'lock'}.items():
            p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        seal.RESULT_DIR.mkdir(mode=0o700)
        policy = {'phase1Status': 'active', 'policyId': 'phase1-hourly-01a1944f', 'digest': seal.NINEF_POLICY_DIGEST}
        for name, value in [('current_cycle_policy', lambda repo, sha, control: dict(policy)),
                            ('resolved_failed_source', lambda state, sha: False)]:
            p = patch.object(seal, name, side_effect=value); p.start(); self.addCleanup(p.stop)

    def reserve(self, now, run):
        seal.AUDIT_FILE.unlink(missing_ok=True)  # each case is an independent seal
        seal.write_state({'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None, 'generation': 1})
        with patch.object(seal.time, 'time', return_value=now), redirect_stdout(io.StringIO()) as out:
            args = seal.parser().parse_args(['reserve-routine-cycle', '--repo', '/nonexistent', '--sha', TARGET_SHA,
                                             '--control-sha', CONTROL_SHA, '--run-id', run])
            args.handler(args)
        return json.loads(out.getvalue())['startsAt']

    def test_late_admission_owns_the_following_hour(self):
        hour = 1793649600  # 20:00 UTC
        self.assertEqual(self.reserve(hour - 3600 + 1, '1-1'), hour)            # 19:00:01
        self.assertEqual(self.reserve(hour - 181, '2-1'), hour)                 # 19:56:59
        self.assertEqual(self.reserve(hour - 180, '3-1'), hour)                 # 19:57:00
        self.assertEqual(self.reserve(hour - 179, '4-1'), hour + 3600)          # 19:57:01
        self.assertEqual(self.reserve(hour - 39, '5-1'), hour + 3600)           # 19:59:21, the 41511864834-1 case
        self.assertEqual(self.reserve(hour, '6-1'), hour + 3600)                # 20:00:00


class GenericPreguardCheckpointRefusalOwner(unittest.TestCase):
    """A later owner that bound a window, wrote its one-shot checkpoint intent,
    and refused before guardCall with inspectorClosed:true resolves by proof
    (41535679597-1 shape)."""
    RUN = '41535679597-1'
    TARGET = '1adb1eaa2c974969ef32c0330bbd3aed94e97a99'
    START = 1793660400  # 23:00 UTC
    WINDOW = {'announcedAt': 1793660286156, 'startsAt': 1793660406156, 'endsAt': 1793660706156, 'verified': True}
    NATIVE = {'club-arena-engine-release-v1@41535679597-1.service': {'ActiveState': 'failed'}}
    RUNTIME = {'containerId': CONTAINER, 'startedAt': '2026-11-02T19:35:05.1Z', 'instanceId': '1-b8912ba6'}

    def setUp(self):
        clock = patch.object(seal.time, 'time', return_value=self.START + 300 + 120)
        clock.start(); self.addCleanup(clock.stop)
        scratch = os.environ.get('TMPDIR')
        if sys.platform == 'darwin' and not scratch:
            scratch = '/Volumes/SmarterWork/agent-work'
        self.tmp = tempfile.TemporaryDirectory(prefix='generic-preguard-', dir=scratch)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, value in {'STATE_DIR': self.root, 'STATE_FILE': self.root / 'engine-release-seal.json',
                'AUDIT_FILE': self.root / 'audit.jsonl', 'RESULT_DIR': self.root / 'engine-release-results',
                'LOCK_FILE': self.root / 'lock'}.items():
            p = patch.object(seal, name, value); p.start(); self.addCleanup(p.stop)
        seal.RESULT_DIR.mkdir(mode=0o700)
        self.requests = self.root / 'engine-release-requests'
        self.requests.mkdir(mode=0o700)
        self.failure = {'completedAt': self.START + 45, 'controlSha': self.TARGET,
            'invocationId': 'e1036679d4b745429f9bb084ed39362b', 'recoveredDesiredImageId': A_IMAGE,
            'recoveredDesiredSha': A_SHA, 'result': 'failed', 'runId': self.RUN, 'schema': 1,
            'sha': self.TARGET, 'transactionExitStatus': 1}
        seal.result_path(self.RUN).write_text(json.dumps(self.failure))
        self.intent = {'instance': '1-b8912ba6', 'container': CONTAINER, 'startedAt': '2026-11-02T19:35:05.1Z',
            'hostPid': 4242, 'source': A_SHA, 'runId': self.RUN, 'controlSha': self.TARGET,
            'at': self.WINDOW['startsAt'] / 1000 + 25, 'retryAllowed': False,
            'nativeCensus': {'candidateSHA': self.TARGET, 'prototypeCacheBytes': 1048576}}
        (self.requests / f'{self.RUN}.legacy-checkpoint-intent').write_text(json.dumps(self.intent))
        self.cycle = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
            'policyDigest': seal.NINEF_POLICY_DIGEST, 'startsAt': self.START, 'endsAt': self.START + 300,
            'runId': self.RUN, 'sha': self.TARGET, 'controlSha': self.TARGET, 'status': 'reserved',
            'window': dict(self.WINDOW), 'failure': dict(self.failure)}
        self.base = {'schema': 1, 'desired': {'sha': A_SHA, 'imageId': A_IMAGE, 'legacyUnlabelled': False},
            'highWaterSha': A_SHA, 'committedRuns': {}, 'pending': None, 'finalization': None,
            'generation': 315, 'routineMaintenanceCycles': {str(self.START): self.cycle}}
        seal.write_state(copy.deepcopy(self.base))
        self.db_reply = {'schema': 'terminal-owned-thaw/v1', 'sha': A_SHA, 'instanceId': '1-b8912ba6',
            'databaseIdle': True, 'freshLeader': True, 'ownedV3Thaw': True,
            'announcedAt': self.WINDOW['announcedAt'], 'startsAt': self.WINDOW['startsAt'],
            'endsAt': self.WINDOW['endsAt']}
        for name, value in [('require_engine_lock', lambda fd: None),
                ('failed_routine_current', lambda a, d: {'same': True}),
                ('generic_preguard_checkpoint_native_proof', lambda d, o: dict(self.NATIVE)),
                ('generic_preguard_checkpoint_refusal', lambda r, f, w, d: 'c' * 64),
                ('failed_routine_runtime', lambda d, bounded=False: dict(self.RUNTIME)),
                ('failed_routine_command', lambda cmd, d, *a, **kw: json.dumps(self.db_reply)),
                ('failed_routine_json', lambda p: json.loads(Path(p).read_text()))]:
            p = patch.object(seal, name, side_effect=value); p.start(); self.addCleanup(p.stop)

    def resolve(self):
        with patch.object(seal.os, 'geteuid', return_value=0), redirect_stdout(io.StringIO()) as out, \
                redirect_stderr(io.StringIO()):
            args = seal.parser().parse_args(['resolve-terminal-routine-failures', '--engine-lock-fd', '9',
                '--run-id', LIVE_RUN, '--sha', TARGET_SHA, '--control-sha', TARGET_SHA,
                '--invocation-id', INVOCATION])
            args.handler(args)
        return out.getvalue().strip()

    def test_resolves_and_validates_preguard_checkpoint_refusal_owner(self):
        original = copy.deepcopy(self.cycle)
        self.assertEqual(self.resolve(), self.RUN)
        state = seal.load_state()
        self.assertFalse(seal.routine_owner_unresolved(state, state['routineMaintenanceCycles'][str(self.START)]))
        resolution = state['routineFailureResolutions'][self.RUN]
        self.assertEqual(resolution['result'], 'preguard-checkpoint-refusal-proved')
        fd = os.open(seal.RESULT_DIR, os.O_RDONLY | os.O_DIRECTORY)
        try:
            answer, _ = observer.routine_failure_resolution(resolution, original, self.failure, fd)
            self.assertTrue(answer['present'] and answer['receiptMatches'] and answer['databaseIdleRecorded'])
        finally:
            os.close(fd)


if __name__ == '__main__':
    if sys.argv[1:] == ['--prepare-history']:
        prepare_history(allow_fetch=True)
    else:
        unittest.main()
