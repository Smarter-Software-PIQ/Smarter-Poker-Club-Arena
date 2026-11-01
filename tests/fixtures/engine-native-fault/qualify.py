#!/usr/bin/env python3
"""Actual isolated Linux qualification. Missing prerequisites FAIL, never skip.

No production target, engine API, ptrace, Inspector or global sysctl mutation.
Raw perf data stays private in this fixture directory and is removed finally.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import resource
import shutil
import subprocess
import tempfile
import time

IMAGE = 'node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5'
MAX_FILE = 4 * 1024 * 1024
ROOT = Path(__file__).resolve().parent


def run(args, *, timeout=30, check=True):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, check=check, env={**os.environ,'DEBUGINFOD_URLS':''})


def docker(*args, **kwargs):
    return run(['docker', *args], **kwargs).stdout.decode().strip()


def wait_for(check, timeout):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = check()
        if result:
            return result
        time.sleep(.02)
    raise RuntimeError('fixture_readiness_deadline')


def identity(name):
    value = json.loads(docker('inspect', name))[0]
    pid = value['State']['Pid']
    if not value['State']['Running'] or not isinstance(pid, int) or pid < 2:
        raise RuntimeError('fixture_target_unavailable')
    # Kernel process start identity, never only a reusable numeric PID.
    start = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
    tasks = sorted(int(p.name) for p in Path(f'/proc/{pid}/task').iterdir())
    if not 1 <= len(tasks) <= 64:
        raise RuntimeError('fixture_task_census_refused')
    return {'container': value['Id'], 'image': value['Image'], 'pid': pid,
            'start': start, 'tasks': tasks}


def unchanged(name, original):
    try:
        current = identity(name)
        return all(current[k] == original[k] for k in ('container', 'image', 'pid', 'start'))
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return False


class Capture:
    def __init__(self, perf, folder, original, symfs, size='256K', ttl=5):
        self.perf, self.folder, self.original, self.symfs = perf, folder, original, symfs
        self.ttl, self.cleanup_reserve, self.deadline = ttl, 5, None
        self.pidfd = os.pidfd_open(original['pid'])
        self.file = folder / 'private-perf.data'
        self.err = folder / 'private-perf.stderr'
        self.ctl_read, self.ctl_write = os.pipe()
        self.ack_read, self.ack_write = os.pipe()
        self.stderr = self.err.open('wb')
        os.chmod(self.err, 0o600)
        command = [perf, 'record', '--quiet', '--no-inherit', '--no-buildid-cache', '--delay=-1',
                   '--control=fd:' + str(self.ctl_read) + ',' + str(self.ack_write),
                   '--event=signal:signal_generate', '--filter=sig == 11 && code == 128',
                   '--tid=' + ','.join(map(str, original['tasks'])),
                   '--call-graph=dwarf,8192', '--user-regs=ip,sp,bp',
                   '--mmap-pages=64', '--max-size=' + size,
                   '--output=' + str(self.file)]
        def private_file_limit():
            os.umask(0o077)
            resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_FILE,MAX_FILE))
        self.process = subprocess.Popen(command, pass_fds=(self.ctl_read, self.ack_write),
                                        preexec_fn=private_file_limit,
                                        stdout=subprocess.DEVNULL, stderr=self.stderr, env={**os.environ,'DEBUGINFOD_URLS':''})
        os.close(self.ctl_read); os.close(self.ack_write)
        try:
            self.control('ping')
        except BaseException:
            self.cleanup()
            raise

    def await_target_or_expiry(self):
        import select
        ready, _, _ = select.select([self.pidfd], [], [], max(0, self.deadline-time.monotonic()))
        return 'original_task_exited' if ready else 'expired_no_fault'

    def control(self, command):
        import select
        if self.process.poll() is not None:
            raise RuntimeError('perf_prerequisite_or_capture_refused')
        os.write(self.ctl_write, (command + '\n').encode())
        ready, _, _ = select.select([self.ack_read], [], [], 3)
        if not ready or os.read(self.ack_read, 64).strip() != b'ack':
            raise RuntimeError('perf_control_unconfirmed')

    def enable(self):
        self.control('enable')
        # Observation TTL starts only after the separate bounded arm acknowledgement.
        self.deadline = time.monotonic() + self.ttl

    def stop(self):
        if self.process.poll() is None:
            try: os.write(self.ctl_write,b'stop\n')
            except BrokenPipeError: pass # A size-bounded recorder may already be exiting.
        self.process.wait(timeout=self.cleanup_reserve)
        self.stderr.close()
        if self.file.exists():
            os.chmod(self.file, 0o600)
            if self.file.stat().st_size > MAX_FILE:
                raise RuntimeError('private_storage_bound_exceeded')
        if self.process.returncode != 0:
            raise RuntimeError('perf_capture_failed')

    def samples(self):
        # Raw output is parsed only inside this private isolated fixture.
        raw = run([self.perf, 'script', '--input=' + str(self.file),
                   '--symfs=' + str(self.symfs), '-F', 'comm,pid,tid,event,ip,sym,dso,trace'], timeout=10).stdout.decode(errors='replace')
        headers = [line for line in raw.splitlines() if 'signal:signal_generate:' in line]
        for line in headers:
            prefix = line.split('signal:signal_generate:', 1)[0]
            numbers = re.findall(r'(?<![A-Za-z0-9_])[0-9]+', prefix)
            if len(numbers) != 2 or int(numbers[0]) != self.original['pid'] or int(numbers[1]) not in self.original['tasks']:
                raise RuntimeError('foreign_sample_attribution')
            if not re.search(r'\bsig=11\b', line) or not re.search(r'\bcode=128\b', line):
                raise RuntimeError('non_gpf_signal_sample')
        return {'events': len(headers),
                'leaf': bool(re.search(r'(?m)^\s*[0-9a-fA-F]+\s+sp_fault_leaf(?:\+0x[0-9a-fA-F]+)?(?:\s|\()',raw)),
                'caller': bool(re.search(r'(?m)^\s*[0-9a-fA-F]+\s+sp_fault_caller(?:\+0x[0-9a-fA-F]+)?(?:\s|\()',raw))}

    def cleanup(self):
        # Only this qualification's perf subprocess; never the observed target.
        try:
            if self.process.poll() is None:
                try:
                    self.control('stop'); self.process.wait(timeout=3)
                except (OSError, RuntimeError, subprocess.SubprocessError):
                    self.process.kill(); self.process.wait(timeout=3)
        finally:
            self.stderr.close()
            for fd in (self.ctl_write, self.ack_read, self.pidfd):
                try: os.close(fd)
                except OSError: pass
            for p in (self.file, self.err):
                p.unlink(missing_ok=True)


def qualify(perf, output):
    if platform.system() != 'Linux' or platform.machine() != 'x86_64' or os.geteuid() != 0:
        raise RuntimeError('actual_root_x86_64_linux_required_no_skip')
    if not Path(perf).is_absolute() or not Path(perf).is_file():
        raise RuntimeError('fixed_perf_tool_required')
    version = run([perf, 'version'], timeout=5).stdout.decode().strip()
    if not re.fullmatch(r'perf version [0-9][A-Za-z0-9.+~_-]{0,80}', version):
        raise RuntimeError('perf_version_refused')
    trace = Path('/sys/kernel/tracing/events/signal/signal_generate/format')
    if not trace.is_file():
        raise RuntimeError('required_signal_tracepoint_unavailable_no_skip')
    fmt = trace.read_bytes()
    if len(fmt) > 16384 or not all(x in fmt for x in (b'field:int sig;', b'field:int code;', b'field:pid_t pid;')):
        raise RuntimeError('signal_tracepoint_schema_refused')
    evidence = {'schema': 'isolated-native-perf-feasibility/v1', 'productionCapture': False,
                'kernel': platform.release(), 'perfVersion': version,
                'perfBinarySHA256': hashlib.sha256(Path(perf).read_bytes()).hexdigest(),
                'tracepointFormatSHA256': hashlib.sha256(fmt).hexdigest(),
                'pinnedNodeImage': IMAGE, 'cases': [], 'cleanup': 'pending'}
    names = []; captures = []
    with tempfile.TemporaryDirectory(prefix='isolated-native-perf-') as tmp:
        base = Path(tmp); os.chmod(base, 0o700)
        try:
            docker('pull', IMAGE, timeout=180)
            seed = 'isolated-native-perf-headers-' + str(os.getpid())
            names.append(seed)
            docker('create', '--name', seed, IMAGE)
            docker('cp', seed + ':/usr/local/include/node', str(base / 'headers'))
            run(['cc', '-shared', '-fPIC', '-O0', '-g', '-fno-inline', '-fno-omit-frame-pointer',
                 '-DNODE_GYP_MODULE_NAME=fault', '-I' + str(base / 'headers'), str(ROOT / 'fault.c'), '-o', str(base / 'fault.node')])
            shutil.copyfile(ROOT / 'target.cjs', base / 'target.cjs')
            symfs=base/'symfs';(symfs/'fixture').mkdir(parents=True)
            (symfs/'usr/local/bin').mkdir(parents=True)
            shutil.copyfile(base/'fault.node',symfs/'fixture/fault.node')
            docker('cp',seed+':/usr/local/bin/node',str(symfs/'usr/local/bin/node'))
            for case in ('actual_gpf', 'foreign_healthcheck', 'expiry', 'replacement', 'storage_bound'):
                folder = base / case; folder.mkdir(mode=0o700)
                shutil.copyfile(base / 'fault.node', folder / 'fault.node')
                shutil.copyfile(base / 'target.cjs', folder / 'target.cjs')
                name = 'isolated-native-perf-' + case + '-' + str(os.getpid())
                mode = 'storm' if case == 'storage_bound' else 'wait'
                names.append(name)
                docker('run', '-d', '--name', name, '--network=none', '--read-only',
                       '--cap-drop=ALL', '--security-opt=no-new-privileges',
                       '--memory=512m', '--memory-swap=512m', '--pids-limit=64', '--ulimit', 'core=0',
                       '-v', str(folder) + ':/fixture', IMAGE, 'node', '/fixture/target.cjs', mode)
                wait_for(lambda: (folder / 'ready').exists(), 10)
                ready = json.loads((folder / 'ready').read_text())
                if ready['pid'] != 1 or not re.fullmatch(r'v22\.[0-9]+\.[0-9]+', ready['version']):
                    raise RuntimeError('actual_pinned_node_pid1_required')
                original = identity(name)
                capture = Capture(perf, folder, original, symfs, '32K' if case == 'storage_bound' else '256K', ttl=.5 if case=='expiry' else 5)
                captures.append(capture)
                if not unchanged(name, original): raise RuntimeError('target_changed_before_enable')
                capture.enable()
                started = time.monotonic()
                if case in ('actual_gpf', 'storage_bound'):
                    (folder / 'fire').touch()
                    if case == 'actual_gpf':
                        if capture.await_target_or_expiry()!='original_task_exited':raise RuntimeError('natural_gpf_deadline')
                    else:
                        capture.process.wait(timeout=max(.01,capture.deadline-time.monotonic()))
                elif case == 'foreign_healthcheck':
                    other = run(['docker', 'exec', name, 'node', '/fixture/target.cjs', 'foreign'], check=False)
                    if other.returncode != 139: raise RuntimeError('foreign_natural_gpf_not_observed')
                elif case == 'replacement':
                    docker('rm', '-f', name)
                    docker('run', '-d', '--name', name, '--network=none', '--read-only',
                       '--cap-drop=ALL', '--security-opt=no-new-privileges',
                       '--memory=512m', '--memory-swap=512m', '--pids-limit=64', '--ulimit', 'core=0',
                           '-v', str(folder) + ':/fixture', IMAGE, 'node', '/fixture/target.cjs', mode)
                    if unchanged(name, original): raise RuntimeError('replacement_not_detected')
                    run(['docker', 'exec', name, 'node', '/fixture/target.cjs', 'foreign'], check=False)
                else:
                    if capture.await_target_or_expiry()!='expired_no_fault':raise RuntimeError('expiry_not_proven')

                capture.stop()
                if case=='expiry' and time.monotonic()-started>capture.ttl+capture.cleanup_reserve+.25:
                    raise RuntimeError('expiry_and_stop_bound_exceeded')
                samples = capture.samples()
                if case == 'actual_gpf':
                    if samples['events'] != 1 or not samples['leaf'] or not samples['caller']:
                        raise RuntimeError('actual_native_fault_leaf_and_caller_unproven')
                elif case == 'storage_bound':
                    if not 1<=samples['events']<256 or capture.file.stat().st_size > MAX_FILE:
                        raise RuntimeError('actual_bounded_capture_unproven')
                elif samples['events'] != 0:
                    raise RuntimeError('foreign_expired_or_replacement_event_admitted')
                evidence['cases'].append({'case': case, 'passed': True, **samples,
                                          'elapsedSeconds': round(time.monotonic() - started, 3),
                                          'observationTTLSeconds':capture.ttl,'cleanupReserveSeconds':capture.cleanup_reserve,
                                          'ttlStarts':'after_enable_ack','controllerKillCleanupQualified':False,
                                          'isolatedImageId':original['image'],'originalTaskCount':len(original['tasks']),
                                          'originalIdentitySHA256':hashlib.sha256(json.dumps(original,sort_keys=True).encode()).hexdigest()})
                capture.cleanup(); captures.remove(capture)
                if any(folder.glob('private-perf*')): raise RuntimeError('private_capture_cleanup_unproven')
            evidence['cleanup'] = 'confirmed'
            evidence['passed'] = True
        finally:
            cleanup_failed=False
            for capture in captures:
                try: capture.cleanup()
                except (OSError,RuntimeError,subprocess.SubprocessError):cleanup_failed=True
            for name in reversed(names):
                docker('rm', '-f', name, check=False)
                if run(['docker','inspect',name],check=False).returncode==0:cleanup_failed=True
            if cleanup_failed:raise RuntimeError('fixture_cleanup_unproven')
    if evidence['cleanup'] != 'confirmed': raise RuntimeError('fixture_cleanup_unproven')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2) + '\n')
    print('Actual isolated Node PID1 native GPF qualification passed; production capture remains disabled.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--perf', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        qualify(args.perf, args.output)
    except BaseException as error:
        reason=str(error) if isinstance(error,RuntimeError) and re.fullmatch(r'[a-z0-9_]{1,100}',str(error)) else type(error).__name__
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps({'schema':'isolated-native-perf-feasibility/v1','passed':False,'productionCapture':False,'failure':reason,'cleanup':'not_certified_by_success_receipt'})+'\n')
        raise
