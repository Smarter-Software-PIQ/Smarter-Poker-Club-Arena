#!/usr/bin/env python3
"""Bounded candidate-only scale qualification in the existing prewarm route.

Never imports application code, opens Inspector, starts an engine or reads its
configuration. A positive receipt qualifies this immutable synthetic fixture,
not production custody or a maintenance certificate. Unknown cleanup is terminal.
An image is measured at most twice, ever: the second, fresh measurement exists
only when the first ran out of wall clock and its container is proved gone.
A fit failure, an identity change or a second timeout refuses for good.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import signal
import stat
import subprocess
import sys
import time
import urllib.request
import urllib.error

GIB = 1024 ** 3
CAP = 36 * GIB
HOST_MARGIN = 8 * GIB
OUTPUT_CAP = 128 * 1024
ROOT = Path(__file__).resolve().parent
STATE = Path('/var/lib/club-arena/native-census-scale')
LABEL = 'com.smarterpoker.qualification.native-census-scale'
LEGACY = frozenset((
    '2f4e33560bcd23bfb5cc731f31816b2c2e2847e5',
    '758610f3f844406bbbaee2f5100ced36d84fb943',
    'a0ab287d902879280f0c915e44f5222c5db4d7df',
    '8825af51817f379c4261658ca29ecc9d8d81932d',
    'eed06fe51dea622069c661a6213d5b031ff3a9e3'))
PROFILE = {'memoryBytes': CAP, 'swapBytes': 0, 'cpu': 1, 'pids': 32,
           'hostMarginBytes': HOST_MARGIN, 'queryMs': 20000, 'fixtureAndCleanupMs': 40000,
           'cleanupReserveMs': 5000, 'cardinality': 35000000, 'oldSpaceMiB': 4000,
           'semiSpaceMiB': 1, 'outputCapBytes': OUTPUT_CAP,
           'fixtureDeadlineMarginMs': 2000, 'measurementsPerImage': 2}
# Inside one 40 s measurement: the Docker client owns the first 35 s (the
# whole budget less the 5 s cleanup reserve) and the fixture's own wall-clock
# deadline sits 2 s inside the client's, so a slow fixture refuses itself and
# reports before the client is killed. The fixture refuses 1 s before that.
CLIENT_S = (PROFILE['fixtureAndCleanupMs'] - PROFILE['cleanupReserveMs']) / 1000
FIXTURE_S = CLIENT_S - PROFILE['fixtureDeadlineMarginMs'] / 1000
CLEANUP_STEP_RESERVE_S = 0.5
# The same admission the first measurement needs before it may start.
ADMISSION_S = 60
# Every wall-clock refusal the fixture and its native addon can make. Both
# files are identity-checked inside the container (fixture SHA-256 argument,
# addon manifest), so these bytes are known; anything else is a fit failure.
DEADLINE_MARKERS = (b'fixed allocation exceeded disposable fixture deadline',
                    b'native census deadline or topology refused',
                    b'native query component exceeded 20 seconds',
                    b'Number(outerDeadline) > Date.now()',
                    b'assert.ok(deadline > Date.now())')


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def command(args, timeout=5, check=True):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, text=True)
    require(len(result.stdout) + len(result.stderr) <= OUTPUT_CAP, 'metadata output exceeded bound')
    if check:
        require(result.returncode == 0, 'bounded metadata command failed: ' + args[0])
    return result


def serving(run_id):
    # Only selected fields, never Config.Env or a full production inspect.
    template = '{{json .Id}} {{json .Image}} {{json .State.Status}} {{json .State.StartedAt}} {{json (index .Config.Labels "org.opencontainers.image.revision")}}'
    fields = command(['docker', 'inspect', '--format', template, 'club-arena-engine']).stdout.strip()
    decoder = json.JSONDecoder()
    values = []
    while fields:
        item, end = decoder.raw_decode(fields)
        values.append(item)
        fields = fields[end:].lstrip()
    require(len(values) == 5, 'serving container identity malformed')
    container, image, status, started, revision = values
    require(re.fullmatch(r'[0-9a-f]{64}', container or '') and
            re.fullmatch(r'sha256:[0-9a-f]{64}', image or '') and status == 'running' and
            re.fullmatch(r'[0-9a-f]{40}', revision or '') and started, 'serving container identity unknown')
    seal = command([sys.executable, str(ROOT / 'engine-release-seal.py'),
                    'classify-running', '--with-sha']).stdout.strip().split()
    require(seal == ['desired', revision], 'actual serving image and desired seal disagree')
    pending = command([sys.executable, str(ROOT / 'engine-release-seal.py'), 'pending-owner']).stdout.strip().split()
    require(pending == ['none'] or (len(pending) == 4 and pending[0] == 'active' and
            pending[1] == run_id and pending[2] == 'false' and pending[3].isdigit() and
            int(pending[3]) > time.time()), 'unknown or competing pending release owner')
    try:
        response = urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=5)
    except urllib.error.HTTPError as exc:
        # A degraded 503 preserves the same authoritative identity body.
        require(exc.code == 503, 'serving health refused')
        response = exc
    with response:
        require(response.status in (200, 503), 'serving health refused')
        raw = response.read(1024 * 1024 + 1)
    require(len(raw) <= 1024 * 1024, 'serving health exceeded bound')
    health = json.loads(raw)
    require(health.get('running') is True and health.get('releaseSha') == revision and
            re.fullmatch(r'[1-9][0-9]*-[0-9a-f]{8}', str(health.get('instanceId', ''))),
            'local health and protected serving identity disagree')
    # Retain no tables, hands, environment or health business payload.
    return {'container': container, 'image': image, 'revision': revision,
            'startedAt': started, 'instanceId': health['instanceId']}


def candidate_identity(image):
    template = '{{json .Id}} {{json (index .Config.Labels "org.opencontainers.image.revision")}} {{json (index .Config.Labels "com.smarterpoker.engine.source-tree")}} {{json (index .Config.Labels "com.smarterpoker.engine.build-contract")}}'
    raw = command(['docker', 'image', 'inspect', '--format', template, image]).stdout.strip()
    decoder, values = json.JSONDecoder(), []
    while raw:
        value, end = decoder.raw_decode(raw)
        values.append(value)
        raw = raw[end:].lstrip()
    require(len(values) == 4 and values[0] == image and
            all(re.fullmatch(r'[0-9a-f]{40}', str(value)) for value in values[1:3]) and
            values[3] == 'clean-server-archive-v1', 'candidate immutable image metadata refused')
    return dict(zip(('image', 'revision', 'serverTree', 'buildContract'), values))


def secure_directory(path):
    # Every component must already be root-owned and not group/world writable.
    for part in [*reversed(path.parents), path]:
        if part == path and not part.exists():
            part.mkdir(mode=0o700)
            # Persist the namespace before the one-shot intent can authorize
            # Docker creation; fsync(intent/STATE) alone misses this mkdir.
            for directory in (part, part.parent):
                fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
        info = part.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'qualification state directory ownership refused')


def read_state(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022 and
                info.st_size <= OUTPUT_CAP, 'qualification receipt custody refused')
        return json.load(stream)


def write_state(path, value, exclusive=False):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    temporary = path if exclusive else path.with_suffix('.pending')
    fd = os.open(temporary, flags, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    if not exclusive:
        os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def daemon_lists_no_container(name, timeout):
    # Authoritative absence that does not depend on CLI wording: the daemon
    # answered (exit 0) and lists no container by this exact name.
    listing = command(['docker', 'ps', '--all', '--no-trunc', '--filter', 'name=^/?' + re.escape(name) + '$',
                       '--format', '{{.ID}}'], timeout=timeout, check=False)
    return listing.returncode == 0 and listing.stdout.strip() == ''


def inspect_own(name, key, timeout):
    result = command(['docker', 'inspect', '--format',
                      '{{json .Id}} {{json (index .Config.Labels "' + LABEL + '")}}', name],
                     timeout=timeout, check=False)
    if result.returncode:
        # 2026-10-31: the first production run (receiver 41226449485) removed
        # its container and then refused here, because the host Docker CLI's
        # not-found wording did not match the exact capitalised strings. A
        # not-found answer in any case is absence; anything else is confirmed
        # against the daemon's own listing, and an unconfirmed answer is still
        # unknown.
        stderr = result.stderr.lower()
        require('no such object' in stderr or 'no such container' in stderr or
                daemon_lists_no_container(name, timeout),
                'owned disposable container state unknown')
        return False
    values = result.stdout.strip().split()
    require(len(values) == 2 and json.loads(values[1]) == key and
            re.fullmatch(r'[0-9a-f]{64}', json.loads(values[0])), 'disposable container ownership refused')
    return True


def cleanup(name, key, deadline, kill=False, seen=None):
    # 2026-11-01 (receiver 41272015208): each command used to be capped at
    # 1.5 s although the profile reserves 5 s for cleanup, so `docker rm -f`
    # of a ~6.7 GB container still running behind a killed client timed out
    # and the cleanup could never be proved. Every step now spends the real
    # remaining reserve, holding back only what the later steps need. A
    # client that never acknowledged the exit leaves a running container:
    # it is killed explicitly first, then removed, then proved absent.
    def remaining(reserve):
        value = deadline - time.monotonic() - reserve
        require(value > 0, 'disposable cleanup deadline exhausted')
        return value
    observed = inspect_own(name, key, remaining(CLEANUP_STEP_RESERVE_S * 3))
    if seen is not None:
        seen['observed'] = seen.get('observed', False) or observed
    if observed:
        if kill:
            # A container that already exited answers non-zero here; the
            # forced removal below and the absence proof stay authoritative.
            command(['docker', 'kill', name], timeout=remaining(CLEANUP_STEP_RESERVE_S * 2), check=False)
        command(['docker', 'rm', '-f', name], timeout=remaining(CLEANUP_STEP_RESERVE_S))
    require(not inspect_own(name, key, remaining(0)), 'disposable cleanup not proved')
    return observed


def validate_result(result, fixture_sha):
    require(result.get('schema') == 'legacy-native-scale-fixture/v1' and result.get('ok') is True and
            result.get('qualification') == 'synthetic-cardinality-and-memory-only' and
            result.get('fixtureSHA256') == fixture_sha and result.get('count') == 35000000 and
            result.get('prototypeRestored') is True and result.get('matched') == 11 and
            result.get('node') == 'v22.23.2' and result.get('v8') == '12.4.254.21-node.56' and
            result.get('platform') == 'linux' and result.get('arch') in ('x64', 'arm64') and
            result.get('sourceSHA256') == 'cbd7279fc6595a31bd2044769d2ad85684d63713351acd0bb602dbfcdbdce31e' and
            re.fullmatch(r'[0-9a-f]{64}', result.get('binarySHA256', '')),
            'scale fixture identity or completeness refused')
    before, attempt = result['before'], result['attempt']
    require(before['used'] >= 3913011648 and 32 * 1024 ** 2 + 772608 <= before['available'] <= 322107592 and
            before['process'] >= 8 * before['used'] + 32 * 1024 ** 2 and
            0 < result['queryMs'] <= 20000 and 0 < result['fixtureMs'] <= 35000 and
            0 < result['cgroupPeak'] <= CAP and result['maxRSSKiB'] > 0 and
            attempt['predicateVisits'] >= 35000000 and attempt['arrayAllocated'] is True and
            attempt['deadlineRefused'] is False and result['cgroup'] == {
                'memoryMax': str(CAP), 'swapMax': '0', 'cpuMax': '100000 100000', 'pidsMax': '32'},
            'actual scale measurements, resource controls or reserve refused')


class FixtureDeadline(Exception):
    """The measurement ran out of wall clock: a slow host, not a census that does not fit."""


def admit_measurement(run_id, before_serving):
    require(serving(run_id) == before_serving, 'serving identity changed before allocation')
    available = re.search(r'^MemAvailable:\s+([0-9]+) kB$', Path('/proc/meminfo').read_text(), re.M)
    require(available and int(available[1]) * 1024 >= CAP + HOST_MARGIN,
            'real host headroom below 36 GiB allocation plus 8 GiB live-host margin')
    return int(available[1]) * 1024


def measure(attempt, name, key, image, fixture_sha, output_path, host_available):
    """One bounded disposable measurement. Returns its record; never repeats."""
    started = time.monotonic()
    cleanup_deadline = started + PROFILE['fixtureAndCleanupMs'] / 1000
    client_deadline = started + CLIENT_S
    fixture_deadline_ms = int((time.time() + FIXTURE_S) * 1000)
    result, exit_code, acknowledged, cleanup_ok = None, None, False, False
    seen = {'observed': False}
    # (message, timing). Only an outcome whose every refusal is wall clock may
    # earn the one fresh re-measurement; fit, identity and signal refusals and
    # unproved cleanup never do.
    errors, cleanup_errors = [], []
    try:
        def cap_output():
            resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_CAP, OUTPUT_CAP))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        with open(output_path, 'xb', buffering=0) as output:
            os.chmod(output_path, 0o600)
            args = ['docker', 'run', '--pull', 'never', '--name', name, '--label', LABEL+'='+key,
                    '--restart', 'no', '--no-healthcheck', '--network', 'none', '--read-only', '--memory', str(CAP),
                    '--memory-swap', str(CAP), '--cpus', '1', '--pids-limit', '32', '--log-driver', 'none',
                    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534',
                    '--tmpfs', '/tmp:rw,noexec,nosuid,size=1m', '--ulimit', 'core=0:0',
                    '--entrypoint', '/usr/bin/env', image, '-i', '/usr/local/bin/node',
                    '--max-old-space-size=4000', '--max-semi-space-size=1',
                    '/app/native/legacy-census/scale-fixture.mjs', fixture_sha, str(fixture_deadline_ms)]
            try:
                execution = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                           timeout=max(0.1, client_deadline - time.monotonic()),
                                           preexec_fn=cap_output)
            except subprocess.TimeoutExpired:
                errors.append(('docker run client exceeded its %d second budget' % CLIENT_S, True))
                raise FixtureDeadline()
            acknowledged = True
            exit_code = execution.returncode
        require(output_path.stat().st_size <= OUTPUT_CAP, 'fixture output exceeded bound')
        if exit_code != 0:
            if any(marker in output_path.read_bytes() for marker in DEADLINE_MARKERS):
                errors.append(('disposable fixed scale fixture refused at its own deadline', True))
                raise FixtureDeadline()
            raise RuntimeError('disposable fixed scale fixture failed')
        result = json.loads(output_path.read_text())
        validate_result(result, fixture_sha)
    except FixtureDeadline:
        pass
    except Exception as exc:
        errors.append((str(exc), False))
    finally:
        try:
            seen['observed'] = cleanup(name, key, cleanup_deadline, kill=not acknowledged, seen=seen) or seen['observed']
            # Absence after an unknown Docker client outcome cannot exclude
            # a create still completing in the daemon. Never certify it.
            require(acknowledged or seen['observed'],
                    'container creation acknowledgement unknown; cleanup remains unknown')
            cleanup_ok = True
        except Exception as exc:
            cleanup_errors.append(str(exc))
    elapsed = (time.monotonic() - started) * 1000
    if elapsed > PROFILE['fixtureAndCleanupMs']:
        errors.append(('full disposable fixture/cleanup exceeded 40 seconds', True))
    messages = [message for message, _ in errors] + cleanup_errors
    return {'attempt': attempt, 'container': name, 'elapsedMs': elapsed, 'exitCode': exit_code,
            'cleanupProved': cleanup_ok, 'executionAcknowledged': acknowledged,
            'observedOwnedContainer': seen['observed'], 'result': result,
            'hostAvailableBytes': host_available,
            'timedOut': bool(errors) and all(timing for _, timing in errors),
            'error': '; '.join(messages) or None}


def receipt_for(binding, candidate, run_id, attempts, fresh):
    # The top-level fields describe the latest measurement, in the shape every
    # existing reader takes; `attempts` keeps the whole durable history.
    latest = attempts[-1]
    qualified = latest['error'] is None and latest['cleanupProved'] is True
    return {'binding':binding, 'candidate':candidate, 'status':'qualified' if qualified else 'refused',
            'runId':run_id, 'at':time.time(), 'elapsedMs':latest['elapsedMs'],
            'cleanupProved':latest['cleanupProved'], 'executionAcknowledged':latest['executionAcknowledged'],
            'observedOwnedContainer':latest['observedOwnedContainer'],
            'servingBefore':latest['servingBefore'], 'servingAfter':latest['servingAfter'],
            'result':latest['result'], 'hostAvailableBytes':latest['hostAvailableBytes'],
            'error':latest['error'], 'attempts':attempts, 'freshRemeasurement':fresh}


def fresh_remeasurement(record):
    # 'available' only for a wall-clock refusal whose container is proved
    # gone, or can still be proved gone because it was seen or its exit was
    # acknowledged. Everything else is bound to the image for good.
    if record['error'] is None and record['cleanupProved'] is True:
        return 'unused'
    if record['timedOut'] is True and (record['cleanupProved'] is True or
                                       record['observedOwnedContainer'] is True or
                                       record['executionAcknowledged'] is True):
        return 'available'
    return 'none'


def main(image, run_id, deadline):
    require(os.geteuid() == 0 and sys.platform == 'linux', 'supported Linux provider identity required')
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', image) and
            re.fullmatch(r'[1-9][0-9]*(-[1-9][0-9]*)?', run_id) and str(deadline).isdigit(), 'invalid scale identity')
    require(int(deadline) - time.time() > ADMISSION_S, 'insufficient preactivation scale preparation budget')
    before_serving = serving(run_id)
    if before_serving['revision'] not in LEGACY:
        require(serving(run_id) == before_serving, 'serving identity changed during nonlegacy classification')
        print('ENGINE_NATIVE_SCALE=' + json.dumps({'status':'not-required-authoritative-nonlegacy',
                                                  'serving': before_serving}, sort_keys=True))
        return
    candidate = candidate_identity(image)
    fixture_sha = digest((ROOT / 'legacy-census-scale-fixture.mjs').read_bytes())
    binding = {'schema':'legacy-native-scale-binding/v1', 'image':image, 'fixtureSHA256':fixture_sha,
               'controllerSHA256':digest(Path(__file__).read_bytes()), 'profile':PROFILE}
    key = digest(json.dumps(binding, sort_keys=True).encode())
    name = 'ca-native-scale-' + key[:32]
    names = {1: name, 2: name + '-2'}
    reserve = PROFILE['cleanupReserveMs'] / 1000
    secure_directory(STATE)
    lock_fd = os.open(STATE / 'resource.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'r+') as lock:
        info = os.fstat(lock.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'qualification resource lock custody refused')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        receipt_path = STATE / (key + '.json')
        intents = {1: STATE / (key + '.intent'), 2: STATE / (key + '.attempt-2.intent')}
        outputs = {1: STATE / (key + '.output'), 2: STATE / (key + '.attempt-2.output')}

        def run_measurement(attempt):
            host_available = admit_measurement(run_id, before_serving)
            # Exclusive creation: each measurement's intent can exist once.
            write_state(intents[attempt], {'binding':binding, 'container':names[attempt], 'runId':run_id,
                                           'attempt':attempt, 'hostAvailableBytes':host_available,
                                           'at':time.time()}, exclusive=True)
            record = measure(attempt, names[attempt], key, image, fixture_sha, outputs[attempt], host_available)
            record.update({'runId':run_id, 'servingBefore':before_serving, 'servingAfter':None})
            try:
                record['servingAfter'] = serving(run_id)
                require(record['servingAfter'] == before_serving, 'serving identity changed during qualification')
            except Exception as exc:
                record['error'] = (record['error'] + '; ' if record['error'] else '') + str(exc)
                record['timedOut'] = False
            return record

        def settle_and_refuse(attempts):
            # Prove every unproved cleanup with its own exact image-bound
            # name, including a fresh measurement that left no receipt, then
            # refuse for good.
            pending = [item['attempt'] for item in attempts if item.get('cleanupProved') is not True]
            if len(attempts) == 1 and intents[2].exists():
                pending.append(2)
            for attempt in pending:
                intent = read_state(intents[attempt])
                require(intent.get('binding') == binding and intent.get('container') == names[attempt],
                        'unresolved scale cleanup custody refused')
                require(cleanup(names[attempt], key, time.monotonic() + reserve),
                        'prior creation acknowledgement remains unknown; no automatic repeat')
            raise RuntimeError('scale outcome for this image is refused for good; no automatic repeat')

        if receipt_path.exists():
            receipt = read_state(receipt_path)
            require(receipt.get('binding') == binding, 'existing scale receipt binding refused')
            if receipt.get('status') == 'qualified':
                require(receipt.get('candidate') == candidate and receipt.get('cleanupProved') is True and
                        0 < receipt.get('elapsedMs', 0) <= PROFILE['fixtureAndCleanupMs'],
                        'existing scale outcome is not a qualified receipt; no automatic retry')
                validate_result(receipt['result'], fixture_sha)
                require(serving(run_id) == before_serving, 'serving identity changed before receipt reuse')
                print('ENGINE_NATIVE_SCALE=' + json.dumps({'status':'reused-qualified', 'receipt':str(receipt_path),
                                                          'binding':binding}, sort_keys=True))
                return
            attempts = receipt.get('attempts')
            require(receipt.get('status') == 'refused' and receipt.get('candidate') == candidate and
                    isinstance(attempts, list) and 1 <= len(attempts) <= PROFILE['measurementsPerImage'] and
                    [item.get('attempt') if isinstance(item, dict) else None for item in attempts] ==
                    list(range(1, len(attempts) + 1)), 'existing scale receipt history refused')
            if not (len(attempts) == 1 and receipt.get('freshRemeasurement') == 'available' and
                    fresh_remeasurement(attempts[0]) == 'available' and not intents[2].exists()):
                settle_and_refuse(attempts)
            first = attempts[0]
        elif intents[1].exists():
            intent = read_state(intents[1])
            require(intent.get('binding') == binding and intent.get('container') == name,
                    'existing one-shot intent custody refused')
            require(cleanup(name, key, time.monotonic() + reserve),
                    'prior creation acknowledgement remains unknown; no automatic repeat')
            raise RuntimeError('prior scale intent has no positive receipt; own cleanup proved, no automatic repeat')
        else:
            first = run_measurement(1)
            attempts = [first]
            fresh = fresh_remeasurement(first)
            write_state(receipt_path, receipt_for(binding, candidate, run_id, attempts, fresh))
            if fresh == 'unused':
                print('ENGINE_NATIVE_SCALE=' + json.dumps({'status':'qualified', 'receipt':str(receipt_path),
                                                          'binding':binding, 'result':first['result']}, sort_keys=True))
                return
            require(fresh == 'available', 'scale preactivation gate refused: ' + str(first['error']))
        # The first measurement ran out of wall clock on a host that was slow
        # at that instant. Its container must be proved gone before the one
        # fresh measurement of the same image, which needs the same admission
        # the first one did; without it the refusal stays retryable by a new
        # receiver run, and the fresh measurement can still happen only once.
        if first['cleanupProved'] is not True:
            require(cleanup(names[1], key, time.monotonic() + reserve) or
                    first['executionAcknowledged'] is True or first['observedOwnedContainer'] is True,
                    'first measurement creation acknowledgement unknown; no fresh re-measurement')
            first['cleanupProved'] = True
            first['cleanupProvedLater'] = {'runId':run_id, 'at':time.time()}
            write_state(receipt_path, receipt_for(binding, candidate, first['runId'], attempts, 'available'))
        require(int(deadline) - time.time() > ADMISSION_S,
                'scale preactivation gate refused: ' + str(first['error']) +
                '; one fresh re-measurement of this image remains for a new receiver run')
        second = run_measurement(2)
        attempts.append(second)
        receipt = receipt_for(binding, candidate, run_id, attempts, 'used')
        write_state(receipt_path, receipt)
        require(receipt['status'] == 'qualified',
                'scale preactivation gate refused after its one fresh re-measurement: ' + str(second['error']))
        print('ENGINE_NATIVE_SCALE=' + json.dumps({'status':'qualified-on-fresh-remeasurement',
                                                  'receipt':str(receipt_path), 'binding':binding,
                                                  'result':second['result']}, sort_keys=True))


def refuse_signal(signum, _frame):
    # Raise inside the owning operation so its bounded finally cleanup runs.
    # SIGKILL/power loss still retains the durable one-shot intent for readback.
    raise RuntimeError('disposable qualification interrupted by signal ' + str(signum))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, refuse_signal)
    signal.signal(signal.SIGINT, refuse_signal)
    signal.signal(signal.SIGHUP, refuse_signal)
    try:
        require(len(sys.argv) == 4, 'usage: legacy-census-scale-preflight.py IMAGE RUN DEADLINE')
        main(*sys.argv[1:])
    except Exception as exc:
        print('[native-census-scale] REFUSED: ' + str(exc), file=sys.stderr)
        raise SystemExit(1)
