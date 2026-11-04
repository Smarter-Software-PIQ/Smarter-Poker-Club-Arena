"""One read of a pinned original addon, through the existing profiler carrier."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ENGINE = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
INSTANCE = '1-3d854040'
RUN = '41873097694-1'
SOURCE = 'ff995c8955cfa3de5e70871b3139bd246c9f76e89b848e48ba052149b434c4dc'
MODULE = '/app/.legacy-census-checkpoint-' + RUN + '/legacy-census.node'
INTENT = Path('/var/lib/club-arena/engine-release-requests/' + RUN + '.legacy-checkpoint-intent')
LOCK = '/var/lock/club-arena-engine-up.lock'


def identity():
    # No Config.Env or other application values are requested.
    template = '{{json .Id}} {{json .Image}} {{json .State.StartedAt}} {{json .State.Pid}} {{json .State.Running}} {{json (index .Config.Labels "org.opencontainers.image.revision")}}'
    raw = subprocess.run(['docker', 'inspect', '--format', template, 'club-arena-engine'],
                         check=True, capture_output=True, text=True, timeout=5).stdout.strip()
    decoder = json.JSONDecoder()
    fields = []
    while raw:
        value, end = decoder.raw_decode(raw)
        fields.append(value)
        raw = raw[end:].lstrip()
    if len(fields) != 6:
        raise ValueError('identity')
    return fields


def read_intent():
    fd = os.open(INTENT, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_mode & 0o022:
            raise ValueError('intent')
        data = os.read(fd, 32769)
        after = os.fstat(fd)
        if len(data) > 32768 or (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError('intent')
        return data
    finally:
        os.close(fd)


def validate_intent(intent, current):
    native = intent.get('nativeCensus', {})
    if (intent.get('runId') != RUN or intent.get('source') != ENGINE or
            intent.get('instance') != INSTANCE or intent.get('retryAllowed') is not False or
            current[4] is not True or current[5] != ENGINE or
            current[0] != intent.get('container') or current[2] != intent.get('startedAt') or
            type(current[3]) is not int or current[3] != intent.get('hostPid') or
            not re.fullmatch(r'[0-9a-f]{64}', str(current[0])) or
            not re.fullmatch(r'sha256:[0-9a-f]{64}', str(current[1])) or
            native.get('path') != MODULE or native.get('sourceSHA256') != SOURCE):
        raise ValueError('binding')


def observe(expected, script, expected_script_hash):
    if expected != ENGINE or len(script) > 131072 or not script or hashlib.sha256(script).hexdigest() != expected_script_hash:
        raise ValueError('source')
    fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
    try:
        lock_stat = os.fstat(fd)
        if not stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_mode & 0o022:
            raise ValueError('lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = read_intent()
        intent = json.loads(raw)
        before = identity()
        validate_intent(intent, before)
        result = subprocess.run(['docker', 'exec', '-i', before[0], 'env', '-u', 'NODE_OPTIONS', '-u',
                                 'NODE_PATH', 'node', '--no-inspect', '--input-type=module',
                                 '-', ENGINE, 'legacy_census_receipt'], input=script,
                                capture_output=True, timeout=75)
        # Readback runs even when the in-process observation refused.
        after = identity()
        if after != before or read_intent() != raw:
            raise ValueError('changed')
        validate_intent(intent, after)
        if result.returncode != 0 or len(result.stdout) > 8192:
            raise ValueError('unavailable')
        receipt = json.loads(result.stdout)
        if (set(receipt) != {'schema', 'observationOnly', 'runId', 'expectedSha', 'instanceId',
                            'sourceSHA256', 'inspectorClosed', 'diagnostics'} or
                receipt.get('schema') != 'original-census-diagnostics/v1' or
                receipt.get('observationOnly') is not True or receipt.get('runId') != RUN or
                receipt.get('expectedSha') != ENGINE or receipt.get('instanceId') != INSTANCE or
                receipt.get('sourceSHA256') != SOURCE or receipt.get('inspectorClosed') is not True):
            raise ValueError('receipt')
        return {**receipt, 'containerId': before[0], 'imageId': before[1],
                'startedAt': before[2], 'hostPid': before[3]}
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        receipt = observe(sys.argv[1], sys.stdin.buffer.read(131073), sys.argv[2])
        print(json.dumps(receipt, separators=(',', ':')))
    except Exception:
        # Neither arbitrary subprocess output nor the private intent is exported.
        print('{"schema":"original-census-diagnostics/v1","observationOnly":true,"status":"UNKNOWN","reason":"original_census_unproven"}')
        sys.exit(1)
