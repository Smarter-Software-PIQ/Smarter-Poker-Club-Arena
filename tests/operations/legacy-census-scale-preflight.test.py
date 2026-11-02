#!/usr/bin/env python3
"""Controller boundary qualification only. Never executes the native scale case."""
import copy
import importlib.util
import io
import json
import os
import re
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('scale', ROOT / 'server/scripts/legacy-census-scale-preflight.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def valid_result():
    return {'schema':'legacy-native-scale-fixture/v1', 'ok':True,
            'qualification':'synthetic-full-cardinality-census-phase-only', 'fixtureSHA256':'f'*64,
            'collectorSHA256':m.digest((m.ROOT/'legacy-engine-checkpoint.mjs').read_bytes()),
            'compositionSHA256':m.digest((m.ROOT/'legacy-census-scale-composition.mjs').read_bytes()),
            'transport':{'ok':True,'closed':True,'outerMs':19000},
            'count':35000000, 'prototypeRestored':True, 'matched':11, 'node':'v22.23.2',
            'v8':'12.4.254.21-node.56', 'platform':'linux', 'arch':'x64',
            'sourceSHA256':'4c6cbd7027b907beadd69dfd6611da2c9072cecfb7add9cc931e99ab5628b8f1',
            'prototypeCacheBytes':1048576, 'binarySHA256':'b'*64, 'before':{'used':3913011648, 'available':322107592,
            'process':50471874560}, 'queryMs':19000, 'fixtureMs':34000,
            'cgroupPeak':5*1024**3, 'maxRSSKiB':4000000,
            'attempt':{'predicateVisits':35010000, 'arrayAllocated':True, 'deadlineRefused':False},
            'cgroup':{'memoryMax':str(m.CAP), 'swapMax':'0', 'cpuMax':'100000 100000', 'pidsMax':'32'}}


class Response(io.BytesIO):
    status = 200


class ScaleBoundary(unittest.TestCase):
    def test_actual_child_json_stdout_and_inspector_stderr_are_separate(self):
        real_popen = subprocess.Popen
        payload = json.dumps(valid_result())
        child = 'import sys;sys.stderr.write("Debugger listening on ws://127.0.0.1:1/redacted\\nFor help, see: https://nodejs.org/en/docs/inspector\\n");sys.stderr.flush();sys.stdout.write(' + repr(payload) + ')'
        def process(args, **kwargs):
            self.assertEqual(args[:2], ['docker', 'run'])
            return real_popen([sys.executable, '-c', child], **kwargs)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'output'
            with patch.object(m.subprocess, 'Popen', side_effect=process), patch.object(m, 'cleanup', return_value=True):
                record = m.measure(1, 'own', 'k'*64, 'sha256:'+'a'*64, 'f'*64, output, 1)
            self.assertIsNone(record['error'], record['error'])
            self.assertEqual(json.loads(output.read_text()), valid_result())
            self.assertTrue(output.with_name('output.stderr').read_bytes().startswith(b'Debugger listening'))
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(output.with_name('output.stderr').stat().st_mode & 0o777, 0o600)
            self.assertIs(record['executionAcknowledged'], True)
            self.assertIs(record['cleanupProved'], True)

    def test_actual_child_shared_cap_hang_and_failure_channels(self):
        for code, limit, expected in [
            ('import sys;sys.stdout.write("x"*80);sys.stdout.flush();sys.stderr.write("y"*80)', 128, RuntimeError),
            ('import sys,time;sys.stderr.write("before hang\\n");sys.stderr.flush();time.sleep(30)', m.OUTPUT_CAP, subprocess.TimeoutExpired),
        ]:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as folder:
                out, err = Path(folder)/'out', Path(folder)/'err'
                with out.open('xb',buffering=0) as stdout, err.open('xb',buffering=0) as stderr, patch.object(m,'OUTPUT_CAP',limit):
                    with self.assertRaises(expected):
                        m.capture_fixture([sys.executable,'-c',code],stdin=subprocess.DEVNULL,
                            stdout=stdout,stderr=stderr,timeout=0.25,preexec_fn=None)
                self.assertLessEqual(out.stat().st_size + err.stat().st_size, limit)
                if expected is subprocess.TimeoutExpired:
                    self.assertEqual(err.read_bytes(), b'before hang\n')
        with tempfile.TemporaryDirectory() as folder:
            out, err = Path(folder)/'out', Path(folder)/'err'
            with out.open('xb',buffering=0) as stdout, err.open('xb',buffering=0) as stderr:
                result = m.capture_fixture([sys.executable,'-c','import sys;sys.stdout.write("out");sys.stderr.write("failure");sys.exit(7)'],
                    stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,timeout=1,preexec_fn=None)
            self.assertEqual(result.returncode,7)
            self.assertEqual((out.read_bytes(),err.read_bytes()),(b'out',b'failure'))

    def test_composed_transport_rejects_coercion_and_nonfinite_or_unexpected_shape(self):
        for forged in [True, False, '1', None, [], {}, float('inf'), float('nan'), 0, -1, 30001, 10**1000]:
            value=valid_result()
            value['transport']['outerMs']=forged
            with self.subTest(forged=forged), self.assertRaises(RuntimeError):
                m.validate_result(value,'f'*64)
        for forged in [None, [], True, {'ok':True,'closed':True},
                       {'ok':True,'closed':True,'outerMs':1,'extra':True}]:
            value=valid_result();value['transport']=forged
            with self.subTest(shape=forged), self.assertRaises(RuntimeError):
                m.validate_result(value,'f'*64)

    def test_actual_measurement_validation_never_treats_smaller_case_as_scale(self):
        value = valid_result()
        m.validate_result(value, 'f'*64)
        alterations = [('count',34999999), ('queryMs',20001), ('fixtureMs',35001), ('prototypeCacheBytes',0),
                       ('collectorSHA256','0'*64), ('transport',{'ok':True,'closed':False,'outerMs':1}),
                       ('transport',{'ok':True,'closed':True,'outerMs':30001}), ('prototypeRestored',False), ('node','v26.0.0'), ('matched',10)]
        for key, replacement in alterations:
            bad = copy.deepcopy(value)
            bad[key] = replacement
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                m.validate_result(bad, 'f'*64)
        for key, replacement in [('used',3913011647), ('available',322107593), ('process',31337647615)]:
            bad = copy.deepcopy(value)
            bad['before'][key] = replacement
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                m.validate_result(bad, 'f'*64)
        bad = copy.deepcopy(value)
        bad['cgroup']['swapMax'] = 'max'
        with self.assertRaises(RuntimeError):
            m.validate_result(bad, 'f'*64)

    def serving_commands(self, classification=None, pending='none'):
        revision = next(iter(m.LEGACY))
        container = ' '.join(json.dumps(v) for v in ['a'*64,'sha256:'+'b'*64,'running','2026-10-31T00:00:00Z',revision])
        return revision, [subprocess.CompletedProcess([],0,container,''),
                          subprocess.CompletedProcess([],0,classification or 'desired '+revision,''),
                          subprocess.CompletedProcess([],0,pending,'')]

    def test_actual_serving_identity_requires_seal_and_health_agreement(self):
        revision, commands = self.serving_commands()
        body = json.dumps({'running':True,'releaseSha':revision,'instanceId':'1-12345678'}).encode()
        with patch.object(m,'command',side_effect=commands), patch.object(m.urllib.request,'urlopen',return_value=Response(body)):
            self.assertEqual(m.serving('42-1')['revision'], revision)
        for classification in ['drift', 'pending '+revision, 'desired '+'c'*40]:
            _, commands = self.serving_commands(classification)
            with patch.object(m,'command',side_effect=commands), self.assertRaisesRegex(RuntimeError,'seal disagree'):
                m.serving('42-1')
        _, commands = self.serving_commands()
        wrong_body = json.dumps({'running':True,'releaseSha':'c'*40,'instanceId':'1-12345678'}).encode()
        with patch.object(m,'command',side_effect=commands), patch.object(m.urllib.request,'urlopen',return_value=Response(wrong_body)), self.assertRaisesRegex(RuntimeError,'health.*disagree'):
            m.serving('42-1')

    def test_unknown_and_competing_pending_owner_refuse(self):
        for pending in ['active 43-1 false 9999999999','expired 42-1 false 1',
                        'active 42-1 true 9999999999', 'none garbage']:
            _, commands = self.serving_commands(pending=pending)
            with patch.object(m,'command',side_effect=commands), self.assertRaisesRegex(RuntimeError,'pending'):
                m.serving('42-1')

    def test_degraded_503_keeps_identity_contract(self):
        revision, commands = self.serving_commands()
        body = json.dumps({'running':True,'releaseSha':revision,'instanceId':'1-12345678'}).encode()
        error = m.urllib.error.HTTPError('http://127.0.0.1:8080/health',503,'degraded',{},io.BytesIO(body))
        with patch.object(m,'command',side_effect=commands), patch.object(m.urllib.request,'urlopen',side_effect=error):
            self.assertEqual(m.serving('42-1')['revision'],revision)

    def test_cleanup_requires_exact_owned_label_and_authoritative_absence(self):
        wrong = subprocess.CompletedProcess([],0,json.dumps('a'*64)+' '+json.dumps('wrong'),'')
        with patch.object(m,'command',return_value=wrong) as cmd, self.assertRaisesRegex(RuntimeError,'ownership'):
            m.cleanup('own','k'*64,time.monotonic()+5)
        self.assertEqual(cmd.call_count,1)
        unknown = subprocess.CompletedProcess([],1,'','daemon unavailable')
        with patch.object(m,'command',return_value=unknown), self.assertRaisesRegex(RuntimeError,'unknown'):
            m.cleanup('own','k'*64,time.monotonic()+5)
        # An unrecognised inspect failure whose daemon listing still shows the
        # name, or whose listing itself fails, stays unknown.
        listed = subprocess.CompletedProcess([],0,'b'*64+'\n','')
        with patch.object(m,'command',side_effect=[unknown,listed]), self.assertRaisesRegex(RuntimeError,'unknown'):
            m.cleanup('own','k'*64,time.monotonic()+5)
        own0 = subprocess.CompletedProcess([],0,json.dumps('a'*64)+' '+json.dumps('k'*64),'')
        # Lowercase not-found wording (newer Docker CLIs) is absence.
        lower = subprocess.CompletedProcess([],1,'[]','error: no such object: own')
        with patch.object(m,'command',side_effect=[own0,subprocess.CompletedProcess([],0,'',''),lower]):
            self.assertTrue(m.cleanup('own','k'*64,time.monotonic()+5))
        # Any other wording is absence only when the daemon lists nothing by
        # this exact name; the listing is anchored to the full name.
        other = subprocess.CompletedProcess([],1,'','Error response from daemon: object not present')
        empty = subprocess.CompletedProcess([],0,'','')
        with patch.object(m,'command',side_effect=[own0,subprocess.CompletedProcess([],0,'',''),other,empty]) as cmd:
            self.assertTrue(m.cleanup('own','k'*64,time.monotonic()+5))
        self.assertEqual(cmd.call_args_list[3].args[0][:2],['docker','ps'])
        self.assertIn('name=^/?own$',cmd.call_args_list[3].args[0])
        own = subprocess.CompletedProcess([],0,json.dumps('a'*64)+' '+json.dumps('k'*64),'')
        absent = subprocess.CompletedProcess([],1,'','Error: No such object: own')
        with patch.object(m,'command',side_effect=[own,subprocess.CompletedProcess([],0,'',''),absent]) as cmd:
            m.cleanup('own','k'*64,time.monotonic()+5)
        self.assertEqual(cmd.call_args_list[1].args[0],['docker','rm','-f','own'])

    def test_unresolved_one_shot_intent_cleans_without_running_again(self):
        with tempfile.TemporaryDirectory(prefix='native-scale-controller-') as directory:
            state = Path(directory)
            identity = {'revision':next(iter(m.LEGACY))}
            with patch.object(m,'STATE',state), patch.object(m.os,'geteuid',return_value=0), patch.object(m.sys,'platform','linux'), patch.object(m,'serving',return_value=identity), patch.object(m,'candidate_identity',return_value={}), patch.object(m,'secure_directory'), patch.object(m.os,'fstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()), patch.object(m.Path,'exists',return_value=True), patch.object(m,'read_state',return_value={'status':'refused'}) as read, patch.object(m,'command') as command:
                with self.assertRaisesRegex(RuntimeError,'binding refused'):
                    m.main('sha256:'+'a'*64,'42-1',str(int(time.time())+600))
                command.assert_not_called()
                self.assertEqual(read.call_count,1)
            # Existing intent only: cleanup uses only its exact image-bound name,
            # then refuses permanently without invoking a second fixture.
            def exists(path):
                return str(path).endswith('.intent')
            def read_intent(path):
                key = path.name[:-7]
                fixture_sha = m.digest((m.ROOT/'legacy-census-scale-fixture.mjs').read_bytes())
                binding = {'schema':'legacy-native-scale-binding/v1','image':'sha256:'+'a'*64,
                           'fixtureSHA256':fixture_sha,'controllerSHA256':m.digest(Path(m.__file__).read_bytes()),'profile':m.PROFILE,
                           'collectorSHA256':m.digest((m.ROOT/'legacy-engine-checkpoint.mjs').read_bytes()),
                           'compositionSHA256':m.digest((m.ROOT/'legacy-census-scale-composition.mjs').read_bytes())}
                return {'binding':binding,'container':'ca-native-scale-'+key[:32]}
            with patch.object(m,'STATE',state), patch.object(m.os,'geteuid',return_value=0), patch.object(m.sys,'platform','linux'), patch.object(m,'serving',return_value=identity), patch.object(m,'candidate_identity',return_value={}), patch.object(m,'secure_directory'), patch.object(m.os,'fstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()), patch.object(m.Path,'exists',exists), patch.object(m,'read_state',side_effect=read_intent), patch.object(m,'cleanup',return_value=True) as cleanup, patch.object(m,'command') as command:
                with self.assertRaisesRegex(RuntimeError,'no automatic repeat'):
                    m.main('sha256:'+'a'*64,'42-1',str(int(time.time())+600))
                cleanup.assert_called_once()
                command.assert_not_called()

    def test_positive_receipt_reuses_without_container_and_insufficient_host_refuses(self):
        with tempfile.TemporaryDirectory(prefix='native-scale-controller-') as directory:
            state = Path(directory)
            identity = {'revision':next(iter(m.LEGACY))}
            fixture_sha = m.digest((m.ROOT/'legacy-census-scale-fixture.mjs').read_bytes())
            binding = {'schema':'legacy-native-scale-binding/v1','image':'sha256:'+'a'*64,
                       'fixtureSHA256':fixture_sha,'controllerSHA256':m.digest(Path(m.__file__).read_bytes()),'profile':m.PROFILE,
                           'collectorSHA256':m.digest((m.ROOT/'legacy-engine-checkpoint.mjs').read_bytes()),
                           'compositionSHA256':m.digest((m.ROOT/'legacy-census-scale-composition.mjs').read_bytes())}
            result = valid_result()
            result['fixtureSHA256'] = fixture_sha
            receipt = {'binding':binding,'candidate':{},'status':'qualified','cleanupProved':True,
                       'elapsedMs':39000,'result':result}
            with patch.object(m,'STATE',state), patch.object(m.os,'geteuid',return_value=0), patch.object(m.sys,'platform','linux'), patch.object(m,'serving',return_value=identity), patch.object(m,'candidate_identity',return_value={}), patch.object(m,'secure_directory'), patch.object(m.os,'fstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()), patch.object(m.Path,'exists',return_value=True), patch.object(m,'read_state',return_value=receipt), patch.object(m,'command') as command, patch('sys.stdout',new_callable=io.StringIO) as stdout:
                m.main('sha256:'+'a'*64,'42-1',str(int(time.time())+600))
                command.assert_not_called()
                self.assertIn('reused-qualified',stdout.getvalue())
            original = Path.read_text
            def read(path, *args, **kwargs):
                return 'MemAvailable:       1000000 kB\n' if str(path) == '/proc/meminfo' else original(path,*args,**kwargs)
            with patch.object(m,'STATE',state), patch.object(m.os,'geteuid',return_value=0), patch.object(m.sys,'platform','linux'), patch.object(m,'serving',return_value=identity), patch.object(m,'candidate_identity',return_value={}), patch.object(m,'secure_directory'), patch.object(m.os,'fstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()), patch.object(m.Path,'exists',return_value=False), patch.object(m.Path,'read_text',read), patch.object(m,'write_state') as write, patch.object(m,'command') as command:
                with self.assertRaisesRegex(RuntimeError,'real host headroom'):
                    m.main('sha256:'+'a'*64,'42-1',str(int(time.time())+600))
                command.assert_not_called()
                write.assert_not_called()

    def test_real_term_int_hup_enter_main_finally_and_leave_nonretryable_receipt(self):
        for signum, observed in [(signal.SIGTERM,True), (signal.SIGINT,True), (signal.SIGHUP,True), (signal.SIGTERM,False)]:
            with self.subTest(signal=signum, observed=observed), tempfile.TemporaryDirectory(prefix='native-scale-signal-') as directory:
                state = Path(directory)
                identity = {'revision':next(iter(m.LEGACY))}
                original = Path.read_text
                def read(path, *args, **kwargs):
                    return 'MemAvailable:       60000000 kB\n' if str(path) == '/proc/meminfo' else original(path,*args,**kwargs)
                def interrupt(*args, **kwargs):
                    os.kill(os.getpid(), signum)
                    self.fail('signal did not refuse')
                previous = signal.signal(signum, m.refuse_signal)
                try:
                    with patch.object(m,'STATE',state), patch.object(m.os,'geteuid',return_value=0), patch.object(m.sys,'platform','linux'), patch.object(m,'serving',return_value=identity), patch.object(m,'candidate_identity',return_value={}), patch.object(m,'secure_directory'), patch.object(m.os,'fstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()), patch.object(m.Path,'read_text',read), patch.object(m,'capture_fixture',side_effect=interrupt), patch.object(m,'cleanup',return_value=observed) as cleanup:
                        with self.assertRaisesRegex(RuntimeError,'interrupted by signal'):
                            m.main('sha256:'+'a'*64,'42-1',str(int(time.time())+600))
                        cleanup.assert_called_once()
                    receipt = json.loads(next(state.glob('*.json')).read_text())
                    self.assertEqual(receipt['status'],'refused')
                    self.assertIs(receipt['cleanupProved'],observed)
                    self.assertIs(receipt['executionAcknowledged'],False)
                    if not observed:
                        self.assertIn('creation acknowledgement unknown',receipt['error'])
                    self.assertIn('interrupted by signal',receipt['error'])
                    self.assertEqual(len(list(state.glob('*.intent'))),1)
                finally:
                    signal.signal(signum,previous)

    def test_new_state_namespace_is_durable_before_intent(self):
        with tempfile.TemporaryDirectory(prefix='native-scale-directory-') as directory:
            state = Path(directory)/'state'
            with patch.object(m.Path,'lstat',return_value=type('S',(),{'st_mode':0o040700,'st_uid':0})()), patch.object(m.os,'open',wraps=os.open) as opened, patch.object(m.os,'fsync',wraps=os.fsync) as synced:
                m.secure_directory(state)
                self.assertEqual([call.args[0] for call in opened.call_args_list], [state,state.parent])
                self.assertEqual(synced.call_count,2)
            self.assertTrue(state.is_dir())

    # 2026-11-01, receiver 41272015208: a slow Docker instant timed the client
    # out at 34.99 s, the fixture never reported, `docker rm -f` was capped at
    # 1.5 s, and the image was refused for ever. These pin each half.
    def test_timeline_keeps_every_pinned_budget_and_puts_the_fixture_inside_the_client(self):
        self.assertEqual((m.PROFILE['queryMs'], m.PROFILE['fixtureAndCleanupMs'], m.PROFILE['cleanupReserveMs']),
                         (20000, 40000, 5000))
        self.assertEqual(m.CLIENT_S, 35)
        self.assertEqual(m.FIXTURE_S, 33)
        self.assertEqual(m.PROFILE['measurementsPerImage'], 2)
        bad = valid_result()
        bad['fixtureMs'] = 35001
        with self.assertRaises(RuntimeError):
            m.validate_result(bad, 'f'*64)
        # Every marker is a refusal the identity-checked fixture or addon can print.
        fixture = (ROOT/'server/scripts/legacy-census-scale-fixture.mjs').read_bytes()
        addon = (ROOT/'server/scripts/native/legacy-census.cc').read_bytes()
        composition = (ROOT/'server/scripts/legacy-census-scale-composition.mjs').read_bytes()
        for marker in m.DEADLINE_MARKERS:
            self.assertTrue(marker in fixture or marker in addon or marker in composition, marker)

    def own_commands(self, killed):
        own = subprocess.CompletedProcess([],0,json.dumps('a'*64)+' '+json.dumps('k'*64),'')
        absent = subprocess.CompletedProcess([],1,'','Error: No such object: own')
        ok = subprocess.CompletedProcess([],0,'','')
        return [own] + ([subprocess.CompletedProcess([],1,'','is not running')] if killed else []) + [ok, absent]

    def test_cleanup_kills_then_removes_with_the_whole_reserve(self):
        with patch.object(m,'command',side_effect=self.own_commands(True)) as cmd:
            seen = {}
            self.assertTrue(m.cleanup('own','k'*64,time.monotonic()+5,kill=True,seen=seen))
        self.assertTrue(seen['observed'])
        self.assertEqual([call.args[0][:2] for call in cmd.call_args_list],
                         [['docker','inspect'],['docker','kill'],['docker','rm'],['docker','inspect']])
        # No 1.5 s cap: removal of a large container gets the real reserve.
        self.assertGreater(cmd.call_args_list[2].kwargs['timeout'], 3.5)
        self.assertGreater(cmd.call_args_list[1].kwargs['timeout'], 3.5)
        # Exhausted reserve is a named refusal, never an unbounded command.
        with patch.object(m,'command') as cmd, self.assertRaisesRegex(RuntimeError,'deadline exhausted'):
            m.cleanup('own','k'*64,time.monotonic()+1)
        cmd.assert_not_called()
        # A removal that never completes leaves the observation recorded.
        own = subprocess.CompletedProcess([],0,json.dumps('a'*64)+' '+json.dumps('k'*64),'')
        seen = {}
        with patch.object(m,'command',side_effect=[own, subprocess.TimeoutExpired(['docker'],4)]), self.assertRaises(subprocess.TimeoutExpired):
            m.cleanup('own','k'*64,time.monotonic()+5,seen=seen)
        self.assertTrue(seen['observed'])

    def run_measure(self, run, commands):
        with tempfile.TemporaryDirectory(prefix='native-scale-measure-') as directory:
            output = Path(directory)/'out'
            with patch.object(m,'capture_fixture',side_effect=run) as docker, patch.object(m,'command',side_effect=commands) as cmd:
                record = m.measure(1,'own','k'*64,'sha256:'+'a'*64,'f'*64,output,1)
            return record, docker, cmd

    def test_client_timeout_is_a_timed_out_measurement_with_proved_kill(self):
        started = time.time()
        def slow(args, **kwargs):
            raise subprocess.TimeoutExpired(args, kwargs['timeout'])
        record, docker, cmd = self.run_measure(slow, self.own_commands(True))
        args, kwargs = docker.call_args.args[0], docker.call_args.kwargs
        # The fixture's own deadline is 2 s inside the 35 s client deadline.
        self.assertAlmostEqual(int(args[-3])/1000 - started, 33, delta=1)
        self.assertEqual(args[-2:], [m.digest((m.ROOT/'legacy-engine-checkpoint.mjs').read_bytes()),
                                    m.digest((m.ROOT/'legacy-census-scale-composition.mjs').read_bytes())])
        self.assertAlmostEqual(kwargs['timeout'], 35, delta=1)
        self.assertEqual([call.args[0][1] for call in cmd.call_args_list], ['inspect','kill','rm','inspect'])
        self.assertIs(record['timedOut'], True)
        self.assertIs(record['cleanupProved'], True)
        self.assertIs(record['executionAcknowledged'], False)
        self.assertIn('client exceeded its 35 second budget', record['error'])
        self.assertEqual(m.fresh_remeasurement(record), 'available')

    def test_fixture_reports_its_own_deadline_and_fit_failures_stay_fit_failures(self):
        def deadline(args, **kwargs):
            kwargs['stdout'].write(b'Error: fixed allocation exceeded disposable fixture deadline\n')
            return subprocess.CompletedProcess(args, 1)
        record, _, cmd = self.run_measure(deadline, self.own_commands(False))
        self.assertEqual([call.args[0][1] for call in cmd.call_args_list], ['inspect','rm','inspect'])
        self.assertIs(record['timedOut'], True)
        self.assertIn('refused at its own deadline', record['error'])
        self.assertEqual(m.fresh_remeasurement(record), 'available')
        for output, code in [(b'Error: native census memory headroom refused\n',1), (b'',137),
                             (b'AssertionError: representative used-heap floor not reached\n',1)]:
            def fit(args, **kwargs):
                kwargs['stdout'].write(output)
                return subprocess.CompletedProcess(args, code)
            record, _, _ = self.run_measure(fit, self.own_commands(False))
            with self.subTest(output=output):
                self.assertIs(record['timedOut'], False)
                self.assertEqual(m.fresh_remeasurement(record), 'none')
        # A timeout whose cleanup is unknown never earns a re-measurement.
        def slow(args, **kwargs):
            raise subprocess.TimeoutExpired(args, kwargs['timeout'])
        unknown = subprocess.CompletedProcess([],1,'','daemon unavailable')
        record, _, _ = self.run_measure(slow, [unknown, unknown])
        self.assertIs(record['cleanupProved'], False)
        self.assertEqual(m.fresh_remeasurement(record), 'none')

    def gate(self, state, deadline_s=600):
        identity = {'revision':next(iter(m.LEGACY))}
        original = Path.read_text
        def read(path, *args, **kwargs):
            return 'MemAvailable:       60000000 kB\n' if str(path) == '/proc/meminfo' else original(path,*args,**kwargs)
        def load(path):
            return json.loads(Path(path).read_text())
        return [patch.object(m,'STATE',state), patch.object(m.os,'geteuid',return_value=0),
                patch.object(m.sys,'platform','linux'), patch.object(m,'serving',return_value=identity),
                patch.object(m,'candidate_identity',return_value={}), patch.object(m,'secure_directory'),
                patch.object(m.os,'fstat',return_value=type('S',(),{'st_mode':0o100600,'st_uid':0})()),
                patch.object(m.Path,'read_text',read), patch.object(m,'read_state',side_effect=load)]

    def record(self, attempt, timed_out=False, qualified=False, cleanup=True, observed=True):
        result = valid_result()
        result['fixtureSHA256'] = m.digest((m.ROOT/'legacy-census-scale-fixture.mjs').read_bytes())
        return {'attempt':attempt, 'container':'c', 'elapsedMs':39000 if qualified else 40000, 'exitCode':0,
                'cleanupProved':cleanup, 'executionAcknowledged':not timed_out, 'observedOwnedContainer':observed,
                'result':result if qualified else None, 'hostAvailableBytes':1, 'timedOut':timed_out,
                'error':None if qualified and cleanup else ('docker run client exceeded its 35 second budget' if timed_out else 'disposable fixed scale fixture failed')}

    def main_with(self, state, measurements, deadline_s=600, run='42-1', cleanup=True):
        from contextlib import ExitStack
        with ExitStack() as stack:
            for item in self.gate(state):
                stack.enter_context(item)
            measure = stack.enter_context(patch.object(m,'measure',side_effect=measurements))
            clean = stack.enter_context(patch.object(m,'cleanup',return_value=cleanup))
            stdout = stack.enter_context(patch('sys.stdout',new_callable=io.StringIO))
            error = None
            try:
                m.main('sha256:'+'a'*64, run, str(int(time.time())+deadline_s))
            except RuntimeError as exc:
                error = str(exc)
            receipt = json.loads(next(state.glob('*.json')).read_text()) if list(state.glob('*.json')) else None
            return error, receipt, measure, clean, stdout.getvalue()

    def test_one_timeout_earns_exactly_one_fresh_measurement_in_the_same_run(self):
        with tempfile.TemporaryDirectory(prefix='native-scale-fresh-') as directory:
            state = Path(directory)
            error, receipt, measure, _, out = self.main_with(state, [self.record(1,timed_out=True), self.record(2,qualified=True)])
            self.assertIsNone(error)
            self.assertIn('qualified-on-fresh-remeasurement', out)
            self.assertEqual(measure.call_count, 2)
            self.assertEqual([call.args[0] for call in measure.call_args_list], [1,2])
            self.assertTrue(measure.call_args_list[1].args[1].endswith('-2'))
            self.assertEqual((receipt['status'], receipt['freshRemeasurement'], len(receipt['attempts'])), ('qualified','used',2))
            self.assertEqual(len(list(state.glob('*.intent'))), 2)
            # The qualified receipt is reused, never measured again.
            error, _, measure, _, out = self.main_with(state, [])
            self.assertIsNone(error)
            self.assertIn('reused-qualified', out)
            measure.assert_not_called()

    def test_a_second_timeout_refuses_for_good(self):
        with tempfile.TemporaryDirectory(prefix='native-scale-second-') as directory:
            state = Path(directory)
            error, receipt, measure, _, _ = self.main_with(state, [self.record(1,timed_out=True), self.record(2,timed_out=True)])
            self.assertIn('after its one fresh re-measurement', error)
            self.assertEqual((receipt['status'], receipt['freshRemeasurement']), ('refused','used'))
            self.assertEqual(measure.call_count, 2)
            error, _, measure, _, _ = self.main_with(state, [], run='43-1')
            self.assertIn('refused for good', error)
            measure.assert_not_called()

    def test_a_fit_failure_never_measures_again(self):
        with tempfile.TemporaryDirectory(prefix='native-scale-fit-') as directory:
            state = Path(directory)
            error, receipt, measure, _, _ = self.main_with(state, [self.record(1)])
            self.assertIn('scale preactivation gate refused', error)
            self.assertEqual((receipt['freshRemeasurement'], measure.call_count), ('none', 1))
            error, _, measure, _, _ = self.main_with(state, [], run='43-1')
            self.assertIn('refused for good', error)
            measure.assert_not_called()

    def test_without_budget_the_timeout_stays_retryable_by_a_new_receiver_run(self):
        with tempfile.TemporaryDirectory(prefix='native-scale-budget-') as directory:
            state = Path(directory)
            real = m.time.time
            clock = {'skew': 0}
            def first_takes_the_budget(*args):
                clock['skew'] = 545  # 600 s admission minus a 40 s measurement and more
                return self.record(1,timed_out=True)
            with patch.object(m.time,'time',side_effect=lambda: real()+clock['skew']):
                error, receipt, measure, _, _ = self.main_with(state, first_takes_the_budget)
            self.assertIn('remains for a new receiver run', error)
            self.assertEqual((receipt['status'], receipt['freshRemeasurement'], measure.call_count), ('refused','available',1))
            self.assertEqual(len(list(state.glob('*.intent'))), 1)
            # A new receiver run with its own admission measures once more.
            error, receipt, measure, _, _ = self.main_with(state, [self.record(2,qualified=True)], run='43-1')
            self.assertIsNone(error)
            self.assertEqual([call.args[0] for call in measure.call_args_list], [2])
            self.assertEqual((receipt['freshRemeasurement'], len(receipt['attempts'])), ('used', 2))

    def test_a_fresh_measurement_that_left_no_receipt_is_never_repeated(self):
        with tempfile.TemporaryDirectory(prefix='native-scale-crash-') as directory:
            state = Path(directory)
            # KeyboardInterrupt stands in for SIGKILL: no record, no receipt update.
            with self.assertRaises(KeyboardInterrupt):
                self.main_with(state, [self.record(1,timed_out=True), KeyboardInterrupt()])
            self.assertEqual(len(list(state.glob('*.intent'))), 2)
            error, _, measure, clean, _ = self.main_with(state, [], run='43-1')
            self.assertIn('refused for good', error)
            measure.assert_not_called()
            self.assertTrue(clean.call_args.args[0].endswith('-2'))

    def test_unproved_first_cleanup_is_proved_before_the_fresh_measurement(self):
        with tempfile.TemporaryDirectory(prefix='native-scale-later-') as directory:
            state = Path(directory)
            first = self.record(1,timed_out=True,cleanup=False,observed=True)
            first['error'] += '; disposable cleanup not proved'
            error, receipt, measure, clean, _ = self.main_with(state, [first, self.record(2,qualified=True)])
            self.assertIsNone(error)
            clean.assert_called_once()
            self.assertIn('cleanupProvedLater', receipt['attempts'][0])
        # Neither seen nor acknowledged: absence cannot exclude a late create.
        with tempfile.TemporaryDirectory(prefix='native-scale-unseen-') as directory:
            state = Path(directory)
            first = self.record(1,timed_out=True,cleanup=False,observed=False)
            error, receipt, measure, _, _ = self.main_with(state, [first])
            self.assertEqual((receipt['freshRemeasurement'], measure.call_count), ('none', 1))

    def test_connected_source_enforces_existing_route_and_containment(self):
        helper = (ROOT/'server/scripts/prewarm-engine-image.sh').read_text()
        installer = (ROOT/'server/scripts/install-engine-supervisor.sh').read_text()
        workflow = (ROOT/'.github/workflows/auto-deploy-hetzner.yml').read_text()
        source = Path(m.__file__).read_text()
        required=re.search(r'REQUIRED_FILES=\((.*?)\n\)',installer,re.S).group(1).split()
        compared=re.search(r'for asset in (legacy-census-scale-.*?); do',workflow).group(1).split()
        for name in ['legacy-census-scale-preflight.py','legacy-census-scale-fixture.mjs',
                     'legacy-census-scale-composition.mjs','legacy-engine-checkpoint.mjs']:
            self.assertIn(name,required)
            self.assertIn(name,compared)
        self.assertIn('archive \"$CONTROL_SHA\" server/scripts',workflow)
        self.assertIn('COPY scripts/legacy-engine-checkpoint.mjs scripts/legacy-census-scale-composition.mjs ./native/legacy-census/',(ROOT/'server/Dockerfile').read_text())
        self.assertIn('legacy-census-scale-preflight.py',helper)
        self.assertLess(workflow.index('for asset in legacy-census-scale'),workflow.index('name: Dispatch the staged SHA'))
        for flag in ["'--network', 'none'","'--read-only'","'--no-healthcheck'","'--memory-swap'",
                     "'--log-driver', 'none'","'-i', '/usr/local/bin/node'",'fcntl.LOCK_NB','exclusive=True']:
            self.assertIn(flag,source)
        self.assertNotIn('--env-file',source)
        self.assertIn('COPY scripts/legacy-census-scale-fixture.mjs ./native/legacy-census/scale-fixture.mjs', (ROOT/'server/Dockerfile').read_text())


if __name__ == '__main__':
    unittest.main()
