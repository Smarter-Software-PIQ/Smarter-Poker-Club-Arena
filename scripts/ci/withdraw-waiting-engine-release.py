#!/usr/bin/env python3
"""Withdraw one waiting original transaction, never a serving engine or wrapper.

The original v1 wrapper owns recovery, its failure tombstone and retirement.
This command supplies only the transaction's existing terminal INT boundary.
It has no image, seal-write, restart, freeze-write or alternate publisher path.
"""
import base64
import contextlib
import io
import datetime
from decimal import Decimal
from uuid import UUID
import fcntl
import errno
import json
import hashlib
import importlib.util
import ssl
from urllib.parse import urlencode
import os
from pathlib import Path
import re
import shutil
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

SHA = re.compile(r'[0-9a-f]{40}')
RUN = re.compile(r'[1-9][0-9]{0,19}-[1-9][0-9]{0,3}')
INSTANCE = re.compile(r'[1-9][0-9]*-[0-9a-f]{8}')
ROOT = Path('/var/lib/club-arena')
PARENT = Path('/usr/local/lib/club-arena')
PROC = Path('/proc')
ENGINE_LOCK = Path('/var/lock/club-arena-engine-up.lock')
SCHEMA = 'waiting-engine-release-withdrawal/v1'


def require(condition):
    if not condition:
        raise ValueError('Exact waiting release admission refused')


def selection(value):
    fields = {'runKey', 'releaseSha', 'controlSha', 'desiredSha', 'instanceId'}
    require(isinstance(value, dict) and set(value) in (fields, fields | {'mode'}))
    require('mode' not in value or value['mode'] in {'cancel_expired_announcement', 'observe_expired_announcement'})
    require(all(isinstance(v, str) for v in value.values()))
    require(RUN.fullmatch(value['runKey']) is not None)
    require(all(SHA.fullmatch(value[k]) for k in ('releaseSha', 'controlSha', 'desiredSha')))
    require(INSTANCE.fullmatch(value['instanceId']) is not None)
    require(value['releaseSha'] != value['desiredSha'])
    return dict(value)


def command(args, timeout=5):
    result = subprocess.run(args, capture_output=True, timeout=timeout, check=True)
    require(len(result.stdout) <= 65536)
    return result.stdout.decode().strip()


def regular(path, mode=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_size <= 65536)
        require(mode is None or stat.S_IMODE(before.st_mode) == mode)
        data = os.read(fd, 65537)
        after = os.fstat(fd)
        signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        require(signature(before) == signature(after) and len(data) <= 65536)
        return data.decode()
    finally:
        os.close(fd)



def canonical_seal_bytes(path):
    # Aggregate history only: individual receipts retain regular()'s64KiB cap.
    # Fixed capacity, not a universal bound on the producer's growing history.
    limit = 16 * 1024 * 1024
    deadline = time.monotonic() + 5
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0
                and stat.S_IMODE(before.st_mode) == 0o600 and before.st_size <= limit)
        chunks, total = [], 0
        while True:
            require(time.monotonic() < deadline)
            chunk = os.read(fd, min(65536, limit + 1 - total))
            if not chunk: break
            chunks.append(chunk); total += len(chunk)
            require(total <= limit)
        after = os.fstat(fd)
        signature = lambda row: (row.st_dev, row.st_ino, row.st_mode, row.st_uid,
                                row.st_size, row.st_mtime_ns, row.st_ctime_ns)
        require(signature(before) == signature(after) and total == before.st_size
                and time.monotonic() < deadline)
        return b''.join(chunks).decode()
    finally:
        os.close(fd)

def properties(unit):
    raw = command(['systemctl', 'show', unit, '-p', 'MainPID', '-p', 'InvocationID',
                   '-p', 'ActiveState', '-p', 'Result', '-p', 'ExecMainStatus'])
    result = dict(line.split('=', 1) for line in raw.splitlines())
    require(set(result) == {'MainPID', 'InvocationID', 'ActiveState', 'Result', 'ExecMainStatus'})
    return result


def process(pid):
    require(type(pid) is int and pid > 1)
    root = PROC / str(pid)
    s = (root / 'stat').read_text().rsplit(')', 1)[1].split()
    argv = (root / 'cmdline').read_bytes().rstrip(b'\0').decode().split('\0')
    return {'pid': pid, 'parent': int(s[1]), 'start': s[19], 'argv': argv}


def bash_command(argv, expected):
    return len(argv) == len(expected) + 1 and argv[0] in ('bash', '/bin/bash', '/usr/bin/bash') and argv[1:] == expected


def healthy(value, request):
    require(value.get('releaseSha') == request['desiredSha'])
    require(value.get('instanceId') == request['instanceId'])
    require(value.get('running') is True and value.get('liveness') == 'ok')
    maintenance = value.get('maintenance') or {}
    require(maintenance.get('active') is False and maintenance.get('phase') == 'idle')


def health_pair(request):
    # No redirects to a caller-selected destination; only these fixed endpoints.
    for url in ('http://127.0.0.1:8080/health', 'https://engine.smarter.poker/health'):
        with urllib.request.urlopen(url + '?withdraw=' + str(time.time_ns()), timeout=5) as response:
            require(response.geturl().split('?', 1)[0] == url)
            raw = response.read(65537)
            require(len(raw) <= 65536)
            healthy(json.loads(raw), request)


def container_identity(request):
    # Inspect only immutable identity fields. A full Docker inspect would also
    # read runtime environment values, which this operation never needs.
    template = ('{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}},'
                '"running":{{json .State.Running}},"image":{{json .Image}},'
                '"releaseSha":{{json (index .Config.Labels "sp.release.sha")}}}')
    d = json.loads(command(['docker', 'container', 'inspect', '--format', template, 'club-arena-engine']))
    require(set(d) == {'id', 'startedAt', 'running', 'image', 'releaseSha'})
    require(d['running'] is True and d['releaseSha'] == request['desiredSha'])
    require(re.fullmatch(r'[0-9a-f]{64}', d['id']) is not None)
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', d['image']) is not None)
    return {'id': d['id'], 'startedAt': d['startedAt'], 'image': d['image']}


def terminal(request, invocation=None):
    result = json.loads(regular(ROOT / 'engine-release-results' / (request['runKey'] + '.json')))
    require(result['result'] == 'failed' and result['transactionExitStatus'] == 130)
    require(result['runId'] == request['runKey'] and result['sha'] == request['releaseSha'])
    require(result['controlSha'] == request['controlSha'])
    require(result['recoveredDesiredSha'] == request['desiredSha'])
    require(re.fullmatch(r'[0-9a-f]{32}', result['invocationId']) is not None)
    require(invocation is None or result['invocationId'] == invocation)
    generation = PARENT / 'engine-control-generations' / request['controlSha']
    command([str(generation / 'engine-release-seal.py'), 'attest-failure', '--sha',
             request['releaseSha'], '--run-id', request['runKey'], '--control-sha',
             request['controlSha'], '--invocation-id', result['invocationId']])
    key = request['runKey']
    for directory, suffixes in [('engine-release-requests', ['intent', 'request', 'break-deadline', 'awaiting-certificate']),
                                ('engine-intake-requests', ['intent', 'request']),
                                ('engine-release-generation-pins', ['generation']),
                                ('engine-image-leases', ['lease'])]:
        require(all(not os.path.lexists(ROOT / directory / (key + '.' + suffix)) for suffix in suffixes))
    for unit in ('club-arena-engine-release-v1@' + key + '.service',
                 'club-arena-engine-intake-v1@' + key + '.service',
                 'club-arena-engine-intake-v1@' + key + '.path'):
        require(not os.path.lexists(Path('/etc/systemd/system/multi-user.target.wants') / unit))
        if unit.endswith('.path'):
            require(command(['systemctl', 'show', unit, '-p', 'ActiveState', '--value']) == 'inactive')
        else:
            d = properties(unit)
            require(d['ActiveState'] in ('inactive', 'failed') and d['MainPID'] == '0')
    health_pair(request)
    return {'schema': SCHEMA, **request, 'result': 'withdrawn-before-mutation',
            'invocationId': result['invocationId'], 'originalTransactionExitStatus': 130,
            'servingInstanceUnchanged': True, 'originalTerminalEdgesRetired': True}


# This narrow capability retires an expired announcement from the pinned
# generation whose original recovery cannot terminalize announcement-only work.
CANCEL_SCHEMA = 'expired-announcement-cancellation/v1'
EMPTY_CANCEL_SCHEMA = 'expired-announcement-cancellation/empty-retry-v1'
CANCEL_CONTROL = 'bd11ad35ca27843fd2f4910e5a8fc6a76d8c9d4e'
CANCEL_HASHES = {
    'engine-release-database-proof.py': '7034aa6f2d42a7a321c1e610fa517acd165367512aa8f3e62aaee719a4703155',
    'engine-release-lightning-hold.py': '401a15fa30f663b8614cf962ed4650c7f55927d29705ab9bdef9dac0638ee6e4',
    'engine-release-seal.py': '7ea266198c0a59e223ba662027352f5a45291d7d9fe25753d3c7dd2ec63916b2',
    'engine-release-transaction.sh': 'fdfb0522c0c3acd218f66544ced70550c9c1ca3e1aee5a56c79f6b1afae30c88',
    'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83',
    'engine-release-activation-floor.py': '850c6056e1eb630b8ca6729b5b654c40612f1c25d692999c8cf5fe3b985ddef2',
}
WRAPPER_HASH = 'e9abdbe2c97c3594b32a920285e78858c1e0497f00a8a7edd21b99ba0491dc9c'

# One additional expired original, not a caller-selected generation or target.
E9_RUN = '41283363258-1'
E9_CONTROL = '303d8cc7d38a97c3bcdc32a577b555232ad726bf'
E9_TARGET = 'e9f00025bd4e2670ed9d1b5714ef94135bcf0224'
E9_HASHES = {
    'engine-release-database-proof.py': '7034aa6f2d42a7a321c1e610fa517acd165367512aa8f3e62aaee719a4703155',
    'engine-release-lightning-hold.py': '401a15fa30f663b8614cf962ed4650c7f55927d29705ab9bdef9dac0638ee6e4',
    'engine-release-seal.py': '7ea266198c0a59e223ba662027352f5a45291d7d9fe25753d3c7dd2ec63916b2',
    'engine-release-transaction.sh': 'e87f2c5d97039656eb953c2155cab1b2948d93e8bbff85efa30385a95e841e20',
    'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83',
    'engine-release-activation-floor.py': '850c6056e1eb630b8ca6729b5b654c40612f1c25d692999c8cf5fe3b985ddef2',
}
E9_WRAPPER_HASH = 'e9abdbe2c97c3594b32a920285e78858c1e0497f00a8a7edd21b99ba0491dc9c'
E9_MANIFEST_HASH = '24cc5dbdfd46117934fd82d832da146c1373f7676ef6b4447455be9c599ad4a7'
PHASE1_RUN = '41400905104-1'
PHASE1_CONTROL = '197c2b733698b9eb62a90f7c91b42b263a028ef1'
PHASE1_TARGET = PHASE1_CONTROL
PHASE1_DESIRED = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
PHASE1_STAMP = 1793602682415
PHASE1_START = 1793602802414
PHASE1_END = 1793603102414
PHASE1_TOKEN = 'b7fd9bbf-95c0-4ff2-af3c-55c7ec4cd01f'
PHASE1_POLICY = '203626ce907eed185e27fac659cc391b16d6b5814fe446b4c0257207d2ba0578'
PHASE1_HASHES = {
    'engine-release-database-proof.py': '0d719753338f5e56541a0dfb23f2ecb06ae556df1e4a45215f25523f727c24c6',
    'engine-release-lightning-hold.py': '401a15fa30f663b8614cf962ed4650c7f55927d29705ab9bdef9dac0638ee6e4',
    'engine-release-seal.py': '1c21d9e35b1bf76c72df58bab7adc8c09ce2d2bd8d98d5680f8a0c934386e2bb',
    'engine-release-transaction.sh': 'c4fd7e47f65c76d60b1af2bd4d09893038516c57d335e181f0346dd58faae418',
    'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83',
    'engine-release-activation-floor.py': '62394346e0010c650298775c5e9f32eded44c7935d054dd5017fdad4d088695e',
}
MARKERLESS_ORIGINALS = {'41177442979-1': '1793440868', E9_RUN: '1793528863', PHASE1_RUN: '1793613481'}


# This command handles one selected immutable operation per process. Selecting
# the second witnessed early-timer failure never broadens the original profile.
SECOND_PHASE1_RUN = '41432783729-1'
SECOND_PHASE1_CONTROL = '6d178de0dbb1bdb2d74fb9b478a11768619a0a93'
SECOND_PHASE1_HASHES = {'engine-release-database-proof.py': '0d719753338f5e56541a0dfb23f2ecb06ae556df1e4a45215f25523f727c24c6', 'engine-release-lightning-hold.py': '401a15fa30f663b8614cf962ed4650c7f55927d29705ab9bdef9dac0638ee6e4', 'engine-release-seal.py': '0811a7631975ba6a52f682324cb0fd43bb3240e7cb40b261d44490a386cd5d70', 'engine-release-transaction.sh': '2b19a4f63063275eb63d9d7d071b8caf57d8389b7d294f39402c8171cd963652', 'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83', 'engine-release-activation-floor.py': '62394346e0010c650298775c5e9f32eded44c7935d054dd5017fdad4d088695e'}

def select_second_phase1_profile():
    global PHASE1_RUN, PHASE1_CONTROL, PHASE1_TARGET, PHASE1_STAMP, PHASE1_START, PHASE1_END, PHASE1_TOKEN, PHASE1_HASHES
    PHASE1_RUN = SECOND_PHASE1_RUN
    PHASE1_CONTROL = SECOND_PHASE1_CONTROL
    PHASE1_TARGET = SECOND_PHASE1_CONTROL
    PHASE1_STAMP = 1793620685533
    PHASE1_START = 1793620805532
    PHASE1_END = 1793621105532
    PHASE1_TOKEN = 'c677673f-f968-4a21-a795-c1bcb175f6d9'
    PHASE1_HASHES = SECOND_PHASE1_HASHES
    MARKERLESS_ORIGINALS[PHASE1_RUN] = '1793629489'


# Exact announced original; component and immutable controller are distinct.
# Original refusal remains UNKNOWN; only positive custody predicates below
# establish withdrawal, never age or a guessed causal explanation.
CURRENT26_RUN = '41469215622-1'
CURRENT26_TARGET = '26aaaa3f350ca063caed717b5fcbbcf34b5ae702'
CURRENT26_CONTROL = 'fffcb62ea1f114322da964f9e580f8be3b3e3383'
CURRENT26_HASHES = {
    'engine-release-database-proof.py': 'd5b59033d68b071419a2b06aa34dc95cdc20d6ec2bed950fbeddd1035c113456',
    'engine-release-lightning-hold.py': '401a15fa30f663b8614cf962ed4650c7f55927d29705ab9bdef9dac0638ee6e4',
    'engine-release-seal.py': '990d562162089464377994decf576892ab9b23d8defca0a18389992842745fff',
    'engine-release-transaction.sh': '0a78bdb9e5b3ba761ea1daf4bbec55c42b2ee654a98d71a5850a46ef313a5abe',
    'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83',
    'engine-release-activation-floor.py': '62394346e0010c650298775c5e9f32eded44c7935d054dd5017fdad4d088695e',
}


def select_current26_profile():
    global PHASE1_RUN, PHASE1_CONTROL, PHASE1_TARGET, PHASE1_STAMP, PHASE1_START, PHASE1_END, PHASE1_TOKEN, PHASE1_HASHES
    PHASE1_RUN, PHASE1_CONTROL, PHASE1_TARGET = CURRENT26_RUN, CURRENT26_CONTROL, CURRENT26_TARGET
    PHASE1_STAMP, PHASE1_START, PHASE1_END = 1793635085893, 1793635205893, 1793635505893
    PHASE1_TOKEN = 'a993695f-4a6a-4cb3-99af-b88765f21c99'
    PHASE1_HASHES = CURRENT26_HASHES
    MARKERLESS_ORIGINALS[PHASE1_RUN] = '1793644848'


PINNED_CANCELLATION_RUNS = frozenset({'41400905104-1', SECOND_PHASE1_RUN, CURRENT26_RUN, E9_RUN, '41177442979-1'})
GENERIC_SOURCE_NAMES = ('engine-release-database-proof.py', 'engine-release-lightning-hold.py', 'engine-release-seal.py',
                        'engine-release-transaction.sh', 'engine-release-recover.sh', 'engine-release-activation-floor.py')
REPO = Path('/opt/club-arena')


def protected_sources(control):
    """Exact hashes of the owner's control as protected main recorded it."""
    require(SHA.fullmatch(control) is not None)
    git = ['git', '-C', str(REPO)]
    env = {**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'LC_ALL': 'C'}
    subprocess.run(git + ['merge-base', '--is-ancestor', control, 'refs/remotes/origin/main'],
                   capture_output=True, timeout=10, check=True, env=env)
    hashes = {}
    for name in GENERIC_SOURCE_NAMES:
        raw = subprocess.run(git + ['show', control + ':server/scripts/' + name], capture_output=True,
                             timeout=10, check=True, env=env).stdout
        require(0 < len(raw) < 262144)
        hashes[name] = digest(raw)
    return hashes


def select_generic_phase1_profile(request):
    """Any later expired v3-phase1 announcement-only owner, derived from its own
    immutable host records. No early-timer tolerance: its freeze must start and
    end exactly at the announced 2/7-minute marks. Every downstream predicate of
    the pinned phase1 profile (no committed run, unchanged runtime, no live
    unit, intent or pin after cancellation, receipt) still applies unchanged."""
    global PHASE1_RUN, PHASE1_CONTROL, PHASE1_TARGET, PHASE1_DESIRED, PHASE1_STAMP, PHASE1_START, PHASE1_END, PHASE1_TOKEN, PHASE1_HASHES
    key = request['runKey']
    require(key not in PINNED_CANCELLATION_RUNS and request.get('mode') in {'cancel_expired_announcement', 'observe_expired_announcement'})
    reservation = json.loads(regular(ROOT / ('engine-recovery-window-' + key + '.json'), 0o600))
    entry = json.loads(regular(ROOT / 'engine-release-requests' / (key + '.activation-entry'), 0o600))
    require(isinstance(reservation, dict) and set(reservation) == {'runId', 'sha', 'announcedAt', 'cause'}
            and reservation['runId'] == key and reservation['sha'] == request['releaseSha']
            and type(reservation['announcedAt']) is int and reservation['announcedAt'] > 0)
    require(isinstance(entry, dict) and entry.get('schema') == 'engine-release-activation-floor/v3-phase1'
            and entry.get('runId') == key and entry.get('targetSha') == request['releaseSha']
            and entry.get('controlSha') == request['controlSha'] and entry.get('manifestSha256') == PHASE1_POLICY
            and entry.get('phase') == 'announcement')
    PHASE1_RUN = key
    PHASE1_CONTROL = request['controlSha']
    PHASE1_TARGET = request['releaseSha']
    PHASE1_DESIRED = request['desiredSha']
    PHASE1_STAMP = reservation['announcedAt']
    PHASE1_START = PHASE1_STAMP + 120000
    PHASE1_END = PHASE1_STAMP + 420000
    PHASE1_TOKEN = None
    PHASE1_HASHES = protected_sources(PHASE1_CONTROL)
    request_path = ROOT / 'engine-release-requests' / (key + '.request')
    if os.path.lexists(request_path):
        lines = regular(request_path, 0o600).splitlines()
        require(len(lines) == 6 and re.fullmatch(r'[1-9][0-9]{9}', lines[5]) is not None)
        MARKERLESS_ORIGINALS[key] = lines[5]
    else:
        MARKERLESS_ORIGINALS.pop(key, None)



OWNER_WINDOW_PROFILE = None
EED_SHA = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'


def select_owner_window_profile(request, entry):
    """Bind a later v2 owner to its own protected source, never a historical profile."""
    global OWNER_WINDOW_PROFILE
    key, control = request['runKey'], request['controlSha']
    require(key not in PINNED_CANCELLATION_RUNS and request['desiredSha'] == EED_SHA)
    hashes = protected_sources(control)
    raw = subprocess.run(['git', '-C', str(REPO), 'show', control + ':server/release/activation-floor.json'],
        capture_output=True, check=True, timeout=10,
        env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'LC_ALL': 'C'}).stdout
    require(0 < len(raw) <= 65536)
    manifest = json.loads(raw)
    require(manifest.get('schema') == 'engine-release-activation-floor/v2-owner-window'
            and isinstance(manifest.get('ownerWindowId'), str) and bool(manifest['ownerWindowId'])
            and set(entry) == {'schema', 'runId', 'targetSha', 'controlSha', 'manifestSha256', 'phase'}
            and entry['schema'] == manifest['schema'] and entry['runId'] == key
            and entry['targetSha'] == request['releaseSha'] and entry['controlSha'] == control
            and entry['manifestSha256'] == digest(raw) and entry['phase'] == 'announcement')
    OWNER_WINDOW_PROFILE = {'request': request | {'mode': 'cancel_expired_announcement'}, 'control': control, 'target': request['releaseSha'],
        'hashes': hashes, 'wrapper': WRAPPER_HASH, 'manifest': digest(raw), 'deadline': None}


def select_profile(request):
    global OWNER_WINDOW_PROFILE
    OWNER_WINDOW_PROFILE = None
    if request['runKey'] == SECOND_PHASE1_RUN:
        select_second_phase1_profile()
    elif request['runKey'] == CURRENT26_RUN:
        select_current26_profile()
    elif (request['runKey'] not in PINNED_CANCELLATION_RUNS
          and request.get('mode') in {'cancel_expired_announcement', 'observe_expired_announcement'}):
        entry = json.loads(regular(ROOT / 'engine-release-requests' / (request['runKey'] + '.activation-entry'), 0o600))
        if entry.get('schema') == 'engine-release-activation-floor/v2-owner-window':
            select_owner_window_profile(request, entry)
        else:
            select_generic_phase1_profile(request)


def cancellation_profile(request):
    if OWNER_WINDOW_PROFILE is not None and request['runKey'] == OWNER_WINDOW_PROFILE['request']['runKey']:
        require(request == OWNER_WINDOW_PROFILE['request'])
        return OWNER_WINDOW_PROFILE
    if request['runKey'] == PHASE1_RUN:
        require(request['controlSha'] == PHASE1_CONTROL and request['releaseSha'] == PHASE1_TARGET
                and request['desiredSha'] == PHASE1_DESIRED)
        return {'control': PHASE1_CONTROL, 'target': PHASE1_TARGET, 'hashes': PHASE1_HASHES,
                'wrapper': WRAPPER_HASH, 'manifest': PHASE1_POLICY,
                'deadline': MARKERLESS_ORIGINALS.get(PHASE1_RUN)}
    if request['runKey'] == E9_RUN:
        require(request['controlSha'] == E9_CONTROL and request['releaseSha'] == E9_TARGET)
        return {'control': E9_CONTROL, 'target': E9_TARGET, 'hashes': E9_HASHES,
                'wrapper': E9_WRAPPER_HASH, 'manifest': E9_MANIFEST_HASH,
                'deadline': MARKERLESS_ORIGINALS[E9_RUN]}
    require(request['controlSha'] == request['releaseSha'] == CANCEL_CONTROL)
    return {'control': CANCEL_CONTROL, 'target': CANCEL_CONTROL, 'hashes': CANCEL_HASHES,
            'wrapper': WRAPPER_HASH, 'manifest': '6008a4314d7a80e77ad0df28c6cc4dd83777ab813f3e66192108be25e063b0ac',
            'deadline': MARKERLESS_ORIGINALS.get(request['runKey'])}

SYSTEMD = Path('/etc/systemd/system')
CGROUP = Path('/sys/fs/cgroup')
THAW_STEPS = {'sit_out_at', 'hold_expires_at', 'addon_period_ends_at', 'reversible_until',
              'reveal_deadline_at', 'rebuy_prompt_until', 'bomb_pot_next_due_at',
              'cash_stay_last_tick_at', 'cash_rejoin_expires_at', 'level_started_at',
              'cluster_break_eligible_since', 'cluster_move_expires_at',
              'reconnect_presence', 'reconnect_snapshots', 'lightning_drain_deadline_at'}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def save_once(path, value):
    raw = json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n'
    if os.path.lexists(path):
        require(regular(path, 0o600) == raw)
        return
    # Atomic immutable create, never replace another writer's state.
    temporary = path.with_name('.' + path.name + '.' + str(os.getpid()))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, path, follow_symlinks=False)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def source_hash(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_size < 262144)
        raw = os.read(fd, 262144)
        after = os.fstat(fd)
        identity = lambda row: (row.st_dev, row.st_ino, row.st_mode, row.st_uid, row.st_size, row.st_mtime_ns, row.st_ctime_ns)
        require(identity(after) == identity(before) and len(raw) == before.st_size)
        return digest(raw)
    finally: os.close(fd)


def cancel_units(key):
    return ['club-arena-engine-release-v1@' + key + '.service',
            'club-arena-engine-intake-v1@' + key + '.service',
            'club-arena-engine-intake-v1@' + key + '.path']


def own_wants_edge(unit):
    edge = SYSTEMD / 'multi-user.target.wants' / unit
    if not os.path.lexists(edge): return edge
    require(edge.is_symlink())
    template = unit.split('@', 1)[0] + '@.' + unit.rsplit('.', 1)[1]
    require(os.readlink(edge) in {str(SYSTEMD / template), str(SYSTEMD / unit), '../' + template, '../' + unit})
    return edge


def unit_snapshot(unit, service_context=False):
    is_path = unit.endswith('.path')
    names = (['InvocationID', 'ActiveState', 'SubState', 'Result'] if is_path else
             ['MainPID', 'InvocationID', 'ActiveState', 'SubState', 'Result',
              'ExecMainCode', 'ExecMainStatus', 'ControlGroup'])
    if service_context:
        require(not is_path)
        names += ['Slice', 'ControlPID']
    args = ['systemctl', 'show', unit, '--all']
    for name in names: args += ['-p', name]
    value = dict(line.split('=', 1) for line in command(args).splitlines())
    require(set(value) == set(names))
    if is_path:
        # Path units have no Service process/Exec/cgroup properties. Null records
        # inapplicability; native GetUnitProcesses supplies actual empty proof.
        value.update(unitType='path', MainPID=None, ExecMainCode=None, ExecMainStatus=None, ControlGroup=None)
    return value


def prove_empty_exec_properties(unit, fields):
    require(bool(fields) and set(fields) <= {'ExecStart', 'ExecStop', 'ExecStopPost'})
    prefix = ['busctl', '--system', '--timeout=5s']
    get_unit = prefix + ['call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1',
                         'org.freedesktop.systemd1.Manager', 'GetUnit', 's', unit]
    resolved = shlex.split(command(get_unit))
    require(len(resolved) == 2 and resolved[0] == 'o'
            and re.fullmatch(r'/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+', resolved[1]) is not None)
    prop = prefix + ['get-property', 'org.freedesktop.systemd1', resolved[1]]
    identity = prop + ['org.freedesktop.systemd1.Unit', 'Id']
    require(shlex.split(command(identity)) == ['s', unit])
    for field in sorted(fields):
        require(shlex.split(command(prop + ['org.freedesktop.systemd1.Service', field])) == ['a(sasbttttuii)', '0'])
    require(shlex.split(command(identity)) == ['s', unit] and shlex.split(command(get_unit)) == resolved)


def loaded_stop_contract(unit, key, allow_masked=False, bindings=None):
    if allow_masked and bindings and unit in bindings and masked([unit]):
        state = unit_snapshot(unit)
        if state['MainPID'] == '0' and state['ActiveState'] in {'inactive', 'failed'}:
            if manager_unit_absent(unit):
                require(cgroup_empty(bindings[unit]))
                require(manager_unit_absent(unit))
                return {'maskedEmpty': True}
    fields = ['ExecStart', 'ExecStop', 'ExecStopPost', 'KillMode', 'FragmentPath', 'DropInPaths',
              'RequiredBy', 'RequisiteOf', 'BoundBy', 'ConsistsOf', 'PropagatesStopTo']
    args = ['systemctl', 'show', unit, '--all']
    for field in fields: args += ['-p', field]
    result = dict(line.split('=', 1) for line in command(args).splitlines())
    missing = set(fields) - set(result)
    if missing:
        # systemctl's Exec-array printer omits empty arrays even with --all.
        # Only a positive typed D-Bus empty array for this exact unit fills one.
        prove_empty_exec_properties(unit, missing)
        result.update({field: '' for field in missing})
    require(set(result) == set(fields))
    require(result['KillMode'] == 'control-group' and result['DropInPaths'] == '')
    require(all(result[field] == '' for field in ['ExecStop', 'RequiredBy', 'RequisiteOf', 'BoundBy', 'ConsistsOf', 'PropagatesStopTo']))
    if allow_masked and result['FragmentPath'] in {'/dev/null', str(SYSTEMD / unit)}:
        # systemd retains the mask link source as FragmentPath when loading it.
        require(masked([unit]))
        require(all(result[field] == '' for field in ['ExecStart', 'ExecStop', 'ExecStopPost']))
        return {'maskedEmpty': True}
    require(result['FragmentPath'] == str(SYSTEMD / 'club-arena-engine-release-v1@.service'))
    wrapper = str(PARENT / 'engine-release-unit-wrapper-v1.sh')
    for field, expected in [('ExecStart', wrapper + ' start ' + key),
                            ('ExecStopPost', wrapper + ' recover ' + key + ' ${SERVICE_RESULT} ${EXIT_CODE} ${EXIT_STATUS}')]:
        raw = result[field]
        require(raw.count('path=') == 1 and raw.count('argv[]=') == 1)
        path = re.search(r'(?:\{ |; )path=([^;]+) ;', raw)
        argv = re.search(r'argv\[\]=([^;]+) ;', raw)
        require(path is not None and path.group(1).strip() == wrapper and argv is not None)
        actual = argv.group(1).strip()
        for name in ('SERVICE_RESULT', 'EXIT_CODE', 'EXIT_STATUS'):
            actual = actual.replace('$' + name, '${' + name + '}')
        require(actual == expected and 'ignore_errors=no' in raw)
    # Runtime timing/status fields in Exec* change; only command/configuration
    # authority is retained and compared after the masks are loaded.
    return {field: result[field] for field in fields if field not in {'ExecStart', 'ExecStopPost'}}


def cgroup_empty(path):
    require(isinstance(path, str) and path.startswith('/system.slice/') and '..' not in path.split('/'))
    target = CGROUP / path.lstrip('/')
    try: os.lstat(target)
    except FileNotFoundError as error:
        require(error.errno == errno.ENOENT)
        return True
    require(target.resolve(strict=True) == target and target.is_dir())
    values = dict(line.split() for line in (target / 'cgroup.events').read_text().splitlines())
    return values.get('populated') == '0'


def manager_unit_absent(unit):
    raw = command(['busctl', '--system', '--timeout=5s', 'call', 'org.freedesktop.systemd1',
                   '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
                   'ListUnitsByPatterns', 'asas', '0', '1', unit])
    values = shlex.split(raw)
    require(len(values) >= 2 and values[0] == 'a(ssssssouso)' and values[1].isdigit())
    if values[1] == '0': require(len(values) == 2)
    return values == ['a(ssssssouso)', '0']


def canonical_service_cgroup(unit):
    require(unit.endswith('.service') and '@' in unit)
    prefix = unit.split('@', 1)[0]
    require(re.fullmatch(r'[A-Za-z0-9-]+', prefix) is not None)
    expected_slice = 'system-' + prefix.replace('-', r'\x2d') + '.slice'
    # v255 cg_slice_to_path uses literal '-' hierarchy separators; escaped
    # template hyphens remain literal \x2d bytes in a single slice component.
    stem = expected_slice[:-6]
    parts = stem.split('-')
    require(all(parts) and len(parts) == 2 and parts[0] == 'system')
    slice_path = '/'.join('-'.join(parts[:i]) + '.slice' for i in range(1, len(parts)+1))
    return expected_slice, '/' + slice_path + '/' + unit


def configured_service_cgroup(unit, snapshot):
    expected_slice, group = canonical_service_cgroup(unit)
    require(snapshot['Slice'] == expected_slice)
    require(command(['systemctl', 'show', '--all', '-p', 'ControlGroup', '--', '-.slice']) == 'ControlGroup=/')
    if snapshot['ControlGroup']: require(snapshot['ControlGroup'] == group)
    return group


def capture_service_cgroups(units, original):
    bindings = {}
    for service in units[:2]:
        context = unit_snapshot(service, service_context=True)
        if service == units[0]:
            require({key: value for key, value in context.items() if key not in {'Slice', 'ControlPID'}} == original)
        else:
            require(context['MainPID'] == '0' and context['ControlPID'] == '0'
                    and context['ActiveState'] in {'inactive', 'failed'})
        bindings[service] = configured_service_cgroup(service, context)
    return bindings


def protected_service_template(request, service):
    """Read the original protected installer's literal v1 template, never execute it."""
    names = cancel_units(request['runKey'])
    require(service in names[:2])
    release = service == names[0]
    installer = 'install-engine-supervisor.sh' if release else 'install-engine-intake.sh'
    git = ['git', '-C', str(REPO)]
    env = {**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_NO_LAZY_FETCH': '1', 'LC_ALL': 'C'}
    subprocess.run(git + ['merge-base', '--is-ancestor', request['controlSha'], 'refs/remotes/origin/main'],
                   capture_output=True, timeout=10, check=True, env=env)
    raw = subprocess.run(git + ['show', request['controlSha'] + ':server/scripts/' + installer],
                         capture_output=True, timeout=10, check=True, env=env).stdout
    require(0 < len(raw) < 262144)
    marker = ('cat > "$UNIT_STAGE/club-arena-engine-release-v1@.service" <<UNIT\n' if release
              else 'cat > "$UNIT_STAGE" <<\'UNIT\'\n')
    text = raw.decode('utf8'); require(text.count(marker) == 1)
    body = text.split(marker, 1)[1].split('\nUNIT\n', 1)
    require(len(body) == 2)
    body = body[0] + '\n'
    if release:
        require(body.count('$UNIT_WRAPPER_V1') == 2)
        body = body.replace('$UNIT_WRAPPER_V1', str(PARENT / 'engine-release-unit-wrapper-v1.sh')).replace('\\$', '$')
    # The v1 templates use systemd's default per-template slice. An explicit
    # override is a different contract and cannot reconstruct an older binding.
    require(not any(line.lstrip().startswith(('Slice=', 'Delegate=', 'ControlGroup=')) for line in body.splitlines()))
    return body.encode()


def recover_masked_service_cgroups(request, intent, units):
    """Recover pre-binding live intents from exact source and native empty units.

    Historical intent bytes stay immutable. A mask's empty Slice is never
    interpreted as the template's configuration or as proof of emptiness.
    """
    require(OWNER_WINDOW_PROFILE is not None and request == OWNER_WINDOW_PROFILE['request'])
    require(masked(units))
    require(command(['systemctl', 'show', '--all', '-p', 'ControlGroup', '--', '-.slice']) == 'ControlGroup=/')
    bindings = {unit: canonical_service_cgroup(unit)[1] for unit in units[:2]}
    require(intent['originalUnit']['ControlGroup'] == bindings[units[0]])
    for unit in units[:2]:
        template = unit.split('@', 1)[0] + '@.service'
        require(source_hash(SYSTEMD / template) == digest(protected_service_template(request, unit)))
        # Check all applicable per-type, dash-prefix, template and instance
        # drop-in names in the manager's system unit search directories.
        prefix = unit.split('@', 1)[0]
        names = {'service.d', template + '.d', unit + '.d'}
        names |= {prefix[:i + 1] + '.service.d' for i, char in enumerate(prefix) if char == '-'}
        for directory in [SYSTEMD, Path('/run/systemd/system'), Path('/usr/local/lib/systemd/system'), Path('/usr/lib/systemd/system')]:
            require(not any(os.path.lexists(directory / name) for name in names))
        before = unit_snapshot(unit, service_context=True)
        require(before['MainPID'] == before['ControlPID'] == '0' and before['ActiveState'] in {'inactive', 'failed'})
        require(before['Slice'] in {'', 'system.slice', canonical_service_cgroup(unit)[0]}
                and before['ControlGroup'] in {'', bindings[unit]})
        require(prove_unit_empty(unit, bindings) ==
                {key: value for key, value in before.items() if key not in {'Slice', 'ControlPID'}})
        require(cgroup_empty(bindings[unit]))
        require(unit_snapshot(unit, service_context=True) == before)
    return bindings


def prove_unloaded_unit_empty(unit, before, bindings=None):
    require(before['ActiveState'] in {'inactive', 'failed'})
    if unit.endswith('.path'):
        require(before.get('unitType') == 'path' and before['MainPID'] is None)
        companion = unit[:-5] + '.service'
        companion_state = prove_unit_empty(companion, bindings)
        require(companion_state['ActiveState'] in {'inactive', 'failed'})
        require(manager_unit_absent(unit))
        require(manager_unit_absent(unit))
        return before
    if bindings and unit in bindings:
        group = bindings[unit]
    else:
        context = unit_snapshot(unit, service_context=True)
        require({key:value for key,value in context.items() if key not in {'Slice','ControlPID'}} == before)
        require(context['MainPID'] == '0' and context['ControlPID'] == '0')
        group = configured_service_cgroup(unit, context)
    require(manager_unit_absent(unit))
    require(cgroup_empty(group))
    require(manager_unit_absent(unit))
    return before


def prove_unit_empty(unit, bindings=None):
    """Positive native enumeration includes cgroup descendants and main/control PIDs."""
    before = unit_snapshot(unit)
    is_path = unit.endswith('.path')
    require(before['MainPID'] is None and before.get('unitType') == 'path' if is_path else before['MainPID'] == '0')
    prefix = ['busctl', '--system', '--timeout=5s']
    lookup = prefix + ['call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1',
                       'org.freedesktop.systemd1.Manager', 'GetUnit', 's', unit]
    try:
        resolved = shlex.split(command(lookup))
    except subprocess.CalledProcessError:
        return prove_unloaded_unit_empty(unit, before, bindings)
    require(len(resolved) == 2 and resolved[0] == 'o'
            and re.fullmatch(r'/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+', resolved[1]) is not None)
    try:
        prop = prefix + ['get-property', 'org.freedesktop.systemd1', resolved[1]]
        identity = prop + ['org.freedesktop.systemd1.Unit', 'Id']
        require(shlex.split(command(identity)) == ['s', unit])
        if not is_path:
            require(shlex.split(command(prop + ['org.freedesktop.systemd1.Service', 'ControlPID'])) == ['u', '0'])
        require(shlex.split(command(prefix + ['call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1',
            'org.freedesktop.systemd1.Manager', 'GetUnitProcesses', 's', unit])) == ['a(sus)', '0'])
        if before['ControlGroup']: require(cgroup_empty(before['ControlGroup']))
        require(shlex.split(command(identity)) == ['s', unit] and shlex.split(command(lookup)) == resolved)
        require(unit_snapshot(unit) == before)
        return before
    except subprocess.CalledProcessError:
        return prove_unloaded_unit_empty(unit, before, bindings)


def empty_retry_admission(unit, state, key, evidence):
    require(key in MARKERLESS_ORIGINALS and 'engine-release-requests/'+key+'.awaiting-certificate' not in evidence['originals'])
    require(state['MainPID'] == '0' and state['ActiveState'] == 'activating' and state['SubState'] == 'auto-restart')
    raw = command(['systemctl', 'show', unit, '--all', '-p', 'Type', '-p', 'Restart', '-p', 'RestartUSec'])
    require(dict(line.split('=', 1) for line in raw.splitlines()) ==
            {'Type': 'oneshot', 'Restart': 'on-failure', 'RestartUSec': '30s'})
    require(prove_unit_empty(unit) == state)


def quiet_units(units, original_group, native_empty=False, bindings=None):
    states = [unit_snapshot(unit) for unit in units]
    require(all((row['MainPID'] == '0' or (row.get('unitType') == 'path' and row['MainPID'] is None)) and row['ActiveState'] in {'inactive', 'failed'}
                and (not row['ControlGroup'] or cgroup_empty(row['ControlGroup'])) for row in states))
    if native_empty:
        require([prove_unit_empty(unit, bindings) for unit in units] == states)
        if original_group is not None: require(cgroup_empty(original_group))
    else:
        require(cgroup_empty(original_group))
        for unit, row in zip(units, states):
            if row.get('unitType') == 'path': require(prove_unit_empty(unit, bindings) == row)
    return states


def masked(units):
    return all(os.path.islink(SYSTEMD / unit) and os.readlink(SYSTEMD / unit) == '/dev/null'
               and command(['systemctl', 'show', unit, '-p', 'LoadState', '--value']) == 'masked' for unit in units)


def time_ms(value):
    require(isinstance(value, str))
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None)
    return round(parsed.timestamp() * 1000)


def prove_thaw(rows, active, stamp, now, control=CANCEL_CONTROL, owner_request=None, promise=None):
    require(isinstance(rows, list) and len(rows) == 1 and active == [])
    row = rows[0]
    starts, ends = stamp + 120000, stamp + 420000
    if control == PHASE1_CONTROL:
        # Historical recovery only, never an activation tolerance. This exact
        # predecessor's scheduled callback fired one millisecond early.
        require(stamp == PHASE1_STAMP and (PHASE1_TOKEN is None or row.get('ownership_token') == PHASE1_TOKEN)
                and row.get('release_generation') == 1)
        starts, ends = PHASE1_START, PHASE1_END
    owner = owner_request is not None
    if owner:
        require(owner_request['desiredSha'] == EED_SHA and control == owner_request['controlSha'])
        for field in ('announced_at', 'freeze_started_at', 'release_target_at'):
            require(datetime.datetime.fromisoformat(row[field].replace('Z', '+00:00')).microsecond % 1000 == 0)
        require(str(UUID(row.get('ownership_token'))).lower() == row['ownership_token'].lower())
        raw_start = time_ms(row.get('freeze_started_at'))
        require(raw_start in (starts, starts - 1))
        require(isinstance(promise, dict) and promise.get('schema') == 'maintenance-promise-floor/v1'
                and promise.get('thawDefinitionMd5') == 'cb733d7201725719813ffd1b1e099b1b'
                and promise.get('maintenance', {}) is None
                and 0 <= now - time_ms(promise.get('observedAt')) <= 10000)
        leader = promise.get('leader')
        require(isinstance(leader, dict) and leader.get('version') == EED_SHA[:8]
                and leader.get('instanceId') == owner_request['instanceId']
                and 0 <= now - time_ms(leader.get('heartbeatAt')) <= 15000
                and row.get('release_generation') == 1 and row.get('thawed_by') == EED_SHA[:8]
                and Decimal(str(row.get('frozen_seconds'))) == Decimal(ends - raw_start) / 1000)
        starts = raw_start
    require(row.get('contract_version') == 3 and time_ms(row.get('announced_at')) == stamp
            and time_ms(row.get('freeze_started_at')) == starts)
    target = time_ms(row.get('release_target_at'))
    require(target == ends and target < now and starts <= time_ms(row.get('thawed_at')) <= now
            and re.fullmatch(r'[0-9a-fA-F-]{36}', row.get('ownership_token', '')) is not None
            and type(row.get('release_generation')) is int and row['release_generation'] > 0)
    shifted = row.get('shifted')
    require(isinstance(shifted, dict) and shifted.get('complete') is True and shifted.get('_targets_snapshotted') is True and THAW_STEPS <= set(shifted))
    targets = shifted.get('_target_counts')
    require(isinstance(targets, dict) and set(targets) == THAW_STEPS
            and all(type(targets[key]) is int and targets[key] >= 0 and type(shifted[key]) is int
                    and shifted[key] == targets[key] for key in THAW_STEPS))
    if owner:
        require(set(shifted) == THAW_STEPS | {'complete', '_targets_snapshotted', '_target_counts'})
    require(abs(float(row['frozen_seconds']) * 1000 - (target - starts)) <= 2)
    return {'announcedAtMs': stamp, 'freezeStartedAtMs': starts,
            'releasedThroughMs': target, 'ownershipToken': row['ownership_token'],
            'generation': row['release_generation'],
            **({'thawRecordedAtMs': time_ms(row['thawed_at'])} if control == PHASE1_CONTROL else {})}


def own_thaw(stamp, control=CANCEL_CONTROL, owner_request=None):
    # The fixed canonical store is used only inside this protected host helper.
    # Only bounded GETs, no RPC or production write, and redirects are refused.
    require(control in {CANCEL_CONTROL, E9_CONTROL, PHASE1_CONTROL} or
            (owner_request is not None and cancellation_profile(owner_request)['control'] == control))
    helper = PARENT / 'engine-control-generations' / control / 'engine-release-database-proof.py'
    hashes = (cancellation_profile(owner_request)['hashes'] if owner_request is not None else
              {CANCEL_CONTROL: CANCEL_HASHES, E9_CONTROL: E9_HASHES, PHASE1_CONTROL: PHASE1_HASHES}[control])
    require(source_hash(helper) == hashes[helper.name])
    spec = importlib.util.spec_from_file_location('qualified_withdrawal_database_reader', helper)
    reader = importlib.util.module_from_spec(spec)
    original_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(reader)
    finally:
        sys.dont_write_bytecode = original_bytecode
    values = reader.read_fixed_env(Path('/opt/club-arena/server/.env'))
    require(values.get('SUPABASE_URL', '').rstrip('/') == 'https://kuklfnapbkmacvwxktbh.supabase.co'
            and bool(values.get('SUPABASE_SERVICE_ROLE_KEY')))
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    def get(table, query):
        url = values['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + table + '?' + urlencode(query)
        key = values['SUPABASE_SERVICE_ROLE_KEY']
        request = urllib.request.Request(url, headers={'apikey': key, 'authorization': 'Bearer ' + key,
                                                     'cache-control': 'no-cache, no-store'})
        with opener.open(request, timeout=5) as response:
            raw = response.read(32769)
            require(len(raw) <= 32768)
            return json.loads(raw)
    stamp_iso = datetime.datetime.fromtimestamp(stamp / 1000, datetime.timezone.utc).isoformat()
    rows = get('engine_maintenance_thaws', {'select': 'contract_version,announced_at,freeze_started_at,release_target_at,thawed_at,ownership_token,release_generation,shifted,frozen_seconds,thawed_by',
                                          'announced_at': 'eq.' + stamp_iso, 'limit': '2'})
    active = get('engine_maintenance_break', {'select': 'id', 'id': 'eq.true', 'limit': '2'})
    if owner_request is not None:
        require(get('engine_maintenance_thaws', {'select': 'release_target_at', 'contract_version': 'eq.3',
            'release_target_at': 'gt.' + datetime.datetime.now(datetime.timezone.utc).isoformat(), 'limit': '1'}) == [])
    promise = get('rpc/fn_engine_maintenance_promise_proof', {}) if owner_request is not None else None
    return prove_thaw(rows, active, stamp, round(time.time() * 1000), control, owner_request, promise)


def observe_seal_state(generation):
    """Reuse pinned validation without SealLock, directory creation or writes."""
    path = ROOT / 'engine-release-seal.json'
    before = canonical_seal_bytes(path)
    spec = importlib.util.spec_from_file_location('qualified_withdrawal_seal_observer', generation / 'engine-release-seal.py')
    helper = importlib.util.module_from_spec(spec)
    original_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(helper)
        helper.STATE_FILE = path
        with contextlib.redirect_stderr(io.StringIO()):
            try: value = helper.load_state()
            except SystemExit: raise ValueError('Pinned seal read refused') from None
    finally:
        sys.dont_write_bytecode = original_bytecode
    require(canonical_seal_bytes(path) == before)
    return value


def phase1_seal_evidence(generation):
    state = observe_seal_state(generation)
    require(state.get('pending') is None and state.get('finalization') is None
            and PHASE1_RUN not in state.get('committedRuns', {})
            and state['desired']['sha'] == PHASE1_DESIRED)
    cycle_start = (PHASE1_STAMP + 120000) // 3600000 * 3600
    cycle = state.get('routineMaintenanceCycles', {}).get(str(cycle_start))
    expected = {'kind': 'hourly-reset', 'policyId': 'phase1-hourly-01a1944f',
                'policyDigest': PHASE1_POLICY, 'startsAt': cycle_start, 'endsAt': cycle_start + 300,
                'runId': PHASE1_RUN, 'sha': PHASE1_TARGET, 'controlSha': PHASE1_CONTROL,
                'status': 'reserved', 'window': {'announcedAt': PHASE1_STAMP,
                    'startsAt': PHASE1_STAMP + 120000, 'endsAt': PHASE1_STAMP + 420000, 'verified': True}}
    require(cycle == expected)
    return cycle


def announcement_evidence(request, after_stop=False, read_only=False):
    profile = cancellation_profile(request)
    control, target = profile['control'], profile['target']
    key = request['runKey']
    owner = OWNER_WINDOW_PROFILE is not None and key == OWNER_WINDOW_PROFILE['request']['runKey']
    generation = PARENT / 'engine-control-generations' / control
    require(generation.resolve(strict=True) == generation)
    for name, expected in profile['hashes'].items(): require(source_hash(generation / name) == expected)
    require(source_hash(PARENT / 'engine-release-unit-wrapper-v1.sh') == profile['wrapper'])
    reqroot = ROOT / 'engine-release-requests'
    originals = {}
    marker_missing = not os.path.lexists(reqroot / (key + '.awaiting-certificate'))
    for suffix in ['request', 'intent', 'awaiting-certificate']:
        if suffix == 'awaiting-certificate' and marker_missing:
            continue
        raw = regular(reqroot / (key + '.' + suffix), 0o600)
        originals['engine-release-requests/' + key + '.' + suffix] = digest(raw.encode())
        if suffix == 'request': lines = raw.splitlines(); request_raw = raw
        elif suffix == 'intent': require(raw == request_raw)
        else: require(raw.strip() == request['releaseSha'])
    require(len(lines) == 6 and lines[0] == request['releaseSha'] and lines[3:5] == [str(generation), control])
    if key == E9_RUN:
        require(lines[5] == profile['deadline'] and time.time() > int(profile['deadline']))
    if key == CURRENT26_RUN:
        require(lines[5] == profile['deadline'])
    if marker_missing and not after_stop:
        # The pinned transaction removes this advisory marker on entry/exit.
        # Only this expired original's positive announced disposition replaces it.
        require(profile['deadline'] is not None and lines[5] == profile['deadline']
                and (time.time() * 1000 > PHASE1_STAMP + 420000 if key == PHASE1_RUN
                     else time.time() > int(profile['deadline'])))
        require(command(['python3', '-B', str(generation / 'engine-release-activation-floor.py'),
                         'disposition', '--repo', '/opt/club-arena', '--target', target,
                         '--control', control, '--deadline', lines[5],
                         '--request-root', str(reqroot), '--run-id', key]) == 'announced')
    entry_raw = regular(reqroot / (key + '.activation-entry'), 0o600)
    entry = json.loads(entry_raw)
    require(set(entry) == {'schema', 'runId', 'targetSha', 'controlSha', 'manifestSha256', 'phase'}
            and entry['schema'] == ('engine-release-activation-floor/v3-phase1' if key == PHASE1_RUN
                                    else 'engine-release-activation-floor/v2-owner-window') and entry['runId'] == key
            and entry['targetSha'] == target and entry['controlSha'] == control and entry['phase'] == 'announcement')
    require(entry['manifestSha256'] == profile['manifest'])
    reservation_raw = regular(ROOT / ('engine-recovery-window-' + key + '.json'), 0o600)
    reservation = json.loads(reservation_raw)
    require(set(reservation) == {'runId', 'sha', 'announcedAt', 'cause'} and reservation['runId'] == key
            and reservation['sha'] == target and reservation['cause'] == 'urgent')
    stamp = reservation['announcedAt']
    require(type(stamp) is int and stamp + 420000 < time.time() * 1000)
    if key == CURRENT26_RUN:
        # Expired custody, not fresh publication: the immutable fffcb CLI first
        # revalidates an obsolete v2 publication floor before its Phase1 branch.
        # These are its actual reservation witnesses, checked directly against
        # the exact original canonical cycle, without rewriting that cycle.
        require(stamp == 1793635085893)
        phase1_seal_evidence(generation)
    else:
        # Historical profiles retain their exact original qualification route.
        require(command(['python3', '-B', str(generation / 'engine-release-activation-floor.py'), 'reservation', '--repo', '/opt/club-arena',
                         '--target', target, '--control', control, '--deadline', lines[5],
                         '--run-id', key, '--request-root', str(reqroot), '--state-root', str(ROOT)]) == str(stamp))
    for suffix in ['break-deadline', 'legacy-checkpoint-intent', 'main-inspector-retirement-intent', 'lightning-hold.json'] + (['main-inspector-retirement-receipt', 'drill'] if owner else []):
        require(not os.path.lexists(reqroot / (key + '.' + suffix)))
    released_path = reqroot / (key + '.lightning-hold.json.released')
    released_raw = regular(released_path, 0o600)
    spec = importlib.util.spec_from_file_location('qualified_withdrawal_hold_reader', generation / 'engine-release-lightning-hold.py')
    helper = importlib.util.module_from_spec(spec)
    original_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(helper)
    finally:
        sys.dont_write_bytecode = original_bytecode
    released = helper.own_record(released_path, key)
    require(released is not None and released['phase'] == 'released')
    seal = generation / 'engine-release-seal.py'
    if key == PHASE1_RUN:
        phase1_seal_evidence(generation)
    if read_only or owner:
        state = observe_seal_state(generation)
        require(not isinstance(state.get('pending'), dict) and state['desired']['sha'] == request['desiredSha'])
        if owner:
            require(state.get('pending') is None and state.get('finalization') is None
                    and key not in state.get('committedRuns', {}))
    else:
        require(command([str(seal), 'pending-owner']) == 'none')
        require(command([str(seal), 'get', 'desired-sha']) == request['desiredSha'])
    pin = ROOT / 'engine-release-generation-pins' / (key + '.generation')
    require(regular(pin, 0o600) == str(generation) + '\n' + control + '\n')
    originals[str(pin.relative_to(ROOT))] = digest(regular(pin, 0o600).encode())
    for directory, suffix in [('engine-intake-requests', 'intent'), ('engine-intake-requests', 'request'), ('engine-image-leases', 'lease')]:
        path = ROOT / directory / (key + '.' + suffix)
        if os.path.lexists(path):
            raw = regular(path, 0o600)
            require(raw.splitlines() == ([request['releaseSha']] if directory == 'engine-image-leases'
                                        else [lines[0], lines[4], lines[1], lines[2], lines[5]]))
            originals[str(path.relative_to(ROOT))] = digest(raw.encode())
    require(not os.path.lexists(ROOT / 'engine-release-results' / (key + '.json')))
    return {**({'desiredImageId': state['desired']['imageId']} if owner else {}),
            'originals': originals, 'entryHash': digest(entry_raw.encode()),
            'reservationHash': digest(reservation_raw.encode()), 'releasedHoldHash': digest(released_raw.encode()), 'thaw': own_thaw(stamp, control, request) if owner else own_thaw(stamp, control)}


def unchanged_evidence(actual, expected, key):
    actual = dict(actual); expected = dict(expected)
    left = actual.pop('originals'); right = expected.pop('originals')
    missing = set(right) - set(left)
    require(actual == expected and set(left) <= set(right)
            and missing <= {'engine-release-requests/' + key + '.awaiting-certificate'}
            and all(value == right[name] for name, value in left.items()))


def validate_cancellation_reply(answer, request):
    require(isinstance(answer, dict) and answer.get('schema') in {CANCEL_SCHEMA, EMPTY_CANCEL_SCHEMA} and answer.get('request') == request
            and answer.get('result') == 'cancelled-expired-announcement' and answer.get('servingInstanceUnchanged') is True
            and answer.get('originalTerminalEdgesRetired') is True and answer.get('quiescent') is True
            and answer.get('stopDisposition') in {'requested', 'not-needed-already-quiescent'})
    if answer['schema'] == EMPTY_CANCEL_SCHEMA:
        require(answer.get('stopDisposition') == 'not-needed-already-quiescent')
    require(isinstance(answer.get('actualUnitStates'), list) and len(answer['actualUnitStates']) == 3)
    require(all((row.get('MainPID') == '0' or (row.get('unitType') == 'path' and row.get('MainPID') is None)) and row.get('ActiveState') in {'inactive', 'failed'} for row in answer['actualUnitStates']))


def cancellation_directory(directory):
    directory.mkdir(mode=0o700, exist_ok=True)
    require(directory.resolve(strict=True) == directory and directory.stat().st_uid == 0)


def cancellation_child_class(argv, key, evidence):
    control = (OWNER_WINDOW_PROFILE['control'] if OWNER_WINDOW_PROFILE is not None
               and key == OWNER_WINDOW_PROFILE['request']['runKey'] else CANCEL_CONTROL)
    generation = PARENT / 'engine-control-generations' / control
    if bash_command(argv, [str(generation / 'engine-release-transaction.sh'), '--run-id', key]):
        return 'pinned_transaction'
    marker = 'engine-release-requests/' + key + '.awaiting-certificate'
    if (key == '41177442979-1' and marker not in evidence['originals']
            and bash_command(argv, [str(generation / 'engine-release-recover.sh'),
                                    '--run-id', key, '--mode', 'retryable'])):
        return 'pinned_announcement_recovery'
    return 'unproven'


def phase1_runtime_birth(request, container, thaw):
    if request['runKey'] != PHASE1_RUN:
        return
    birth = time_ms(container['startedAt'])
    recorded = thaw['thawRecordedAtMs']
    require(type(recorded) is int and PHASE1_START <= recorded < time.time() * 1000)
    require(0 < birth < time.time() * 1000 and
            (birth < PHASE1_STAMP or birth > max(PHASE1_STAMP + 420000, recorded)))


def collect_cancellation_admission(request, units, container, read_only=False):
    evidence_read = lambda: announcement_evidence(request, read_only=True) if read_only else announcement_evidence(request)
    key = request['runKey']
    evidence = evidence_read()
    if OWNER_WINDOW_PROFILE is not None and key == OWNER_WINDOW_PROFILE['request']['runKey']:
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', str(evidence.get('desiredImageId'))) is not None
                and container.get('image') == evidence['desiredImageId'])
    phase1_runtime_birth(request, container, evidence['thaw'])
    stop_contract = loaded_stop_contract(units[0], key)
    state = unit_snapshot(units[0])
    require(state['ActiveState'] in {'active', 'activating'} and INVOCATION_PATTERN(state['InvocationID']))
    # This additional original is admitted only while positively process-empty.
    # A live or racing invocation cannot become new signal authority.
    if key in {E9_RUN, PHASE1_RUN}:
        require(state['MainPID'] == '0')
    if state['MainPID'] == '0':
        empty_retry_admission(units[0], state, key, evidence)
        unit_cgroups = {}
        for service in units[:2]:
            context = unit_snapshot(service, service_context=True)
            require(context['MainPID'] == '0' and context['ControlPID'] == '0')
            unit_cgroups[service] = configured_service_cgroup(service, context)
        for unit in units[1:]:
            row = prove_unit_empty(unit)
            require(row['ActiveState'] in {'inactive', 'failed'})
        require(evidence_read() == evidence and container_identity(request) == container)
        health_pair(request); empty_retry_admission(units[0], state, key, evidence)
        intent = {'schema': EMPTY_CANCEL_SCHEMA, 'admission': 'positive-empty-auto-restart',
                  'request': request, 'container': container, 'evidence': evidence,
                  'originalUnit': state, 'originalProcess': None, 'originalChild': None, 'stopContract': stop_contract, 'unitCgroups': unit_cgroups}
    else:
        parent = process(int(state['MainPID']))
        require(bash_command(parent['argv'], [str(PARENT / 'engine-release-unit-wrapper-v1.sh'), 'start', key]))
        require(state['ControlGroup'].startswith('/system.slice/') and state['ControlGroup'].endswith('/' + units[0]))
        require((PROC / str(parent['pid']) / 'cgroup').read_text().strip() == '0::' + state['ControlGroup'])
        children = (PROC / str(parent['pid']) / 'task' / str(parent['pid']) / 'children').read_text().split()
        candidates = [process(int(pid)) for pid in children]
        matches = [row for row in candidates if cancellation_child_class(row['argv'], key, evidence) != 'unproven']
        require(len(matches) == 1 and matches[0]['parent'] == parent['pid'])
        require((PROC / str(matches[0]['pid']) / 'cgroup').read_text().strip() == '0::' + state['ControlGroup'])
        engine_pid = command(['docker', 'container', 'inspect', '--format', '{{.State.Pid}}', 'club-arena-engine'])
        require(engine_pid.isdigit() and int(engine_pid) > 1)
        require(not (PROC / engine_pid / 'cgroup').read_text().strip().startswith('0::' + state['ControlGroup']))
        require(all((row['MainPID'] == '0' or (row.get('unitType') == 'path' and row['MainPID'] is None)) and row['ActiveState'] in {'inactive', 'failed'} for row in [unit_snapshot(unit) for unit in units[1:]]))
        require(evidence_read() == evidence and container_identity(request) == container)
        health_pair(request); require(unit_snapshot(units[0]) == state and process(parent['pid']) == parent)
        bindings = capture_service_cgroups(units, state)
        require(unit_snapshot(units[0]) == state and process(parent['pid']) == parent
                and process(matches[0]['pid']) == matches[0])
        intent = {'schema': CANCEL_SCHEMA, 'request': request, 'container': container, 'evidence': evidence,
                  'originalUnit': state, 'originalProcess': parent, 'originalChild': matches[0], 'stopContract': stop_contract,
                  'unitCgroups': bindings}
    return intent


def cancel_announced(request):
    require(os.getuid() == 0)
    key = request['runKey']; units = cancel_units(key)
    quiescence_deadline = None
    directory = ROOT / 'engine-release-cancellations'
    cancellation_directory(directory)
    lockfd = os.open(directory / (key + '.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    enginefd = os.open(ENGINE_LOCK, os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(enginefd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        receipt_path = directory / (key + '.receipt.json')
        intent_path = directory / (key + '.intent.json')
        issued_path = directory / (key + '.stop-issued.json')
        quiet_path = directory / (key + '.quiescent.json')
        if os.path.lexists(receipt_path):
            receipt = json.loads(regular(receipt_path, 0o600)); validate_cancellation_reply(receipt, request)
            require(masked(units)); quiet_units(units, receipt['originalControlGroup'], receipt['schema'] == EMPTY_CANCEL_SCHEMA, receipt.get('unitCgroups'))
            require(container_identity(request) == receipt['container']); health_pair(request)
            if key == PHASE1_RUN: phase1_cancellation_proof()
            return receipt
        for unit in units: own_wants_edge(unit)
        health_pair(request); container = container_identity(request)
        if os.path.lexists(intent_path):
            intent = json.loads(regular(intent_path, 0o600))
            require(intent['request'] == request and intent['container'] == container)
        else:
            intent = collect_cancellation_admission(request, units, container)
            save_once(intent_path, intent)
        allowed = {'engine-release-requests/' + key + '.' + suffix for suffix in ('request', 'intent', 'awaiting-certificate')}
        allowed |= {'engine-release-generation-pins/' + key + '.generation', 'engine-image-leases/' + key + '.lease'}
        allowed |= {'engine-intake-requests/' + key + '.' + suffix for suffix in ('request', 'intent')}
        empty_admission = intent.get('schema') == EMPTY_CANCEL_SCHEMA
        schema = intent['schema']
        require(set(intent) == {'schema', 'request', 'container', 'evidence', 'originalUnit', 'originalProcess', 'originalChild', 'stopContract'} | ({'admission', 'unitCgroups'} if empty_admission else ({'unitCgroups'} if 'unitCgroups' in intent else set()))
                and schema in {CANCEL_SCHEMA, EMPTY_CANCEL_SCHEMA})
        if empty_admission:
            require(intent['admission'] == 'positive-empty-auto-restart' and intent['originalProcess'] is None and intent['originalChild'] is None)
            require(intent['originalUnit']['MainPID'] == '0' and intent['originalUnit']['SubState'] == 'auto-restart')
        bindings = intent.get('unitCgroups')
        if bindings is None and OWNER_WINDOW_PROFILE is not None:
            binding_path = directory / (key + '.unit-cgroups.json')
            intent_hash = digest(regular(intent_path, 0o600).encode())
            if not os.path.lexists(binding_path):
                unchanged_evidence(announcement_evidence(request, after_stop=True), intent['evidence'], key)
                recovered = recover_masked_service_cgroups(request, intent, units)
                # Preserve the recovered native binding before any terminal
                # unlink, without changing the historical intent or stop hash.
                save_once(binding_path, {'schema': 'engine-release-cancellation-cgroup/v1',
                                        'intentHash': intent_hash, 'unitCgroups': recovered})
            recorded = json.loads(regular(binding_path, 0o600))
            require(set(recorded) == {'schema', 'intentHash', 'unitCgroups'}
                    and recorded['schema'] == 'engine-release-cancellation-cgroup/v1'
                    and recorded['intentHash'] == intent_hash
                    and recorded['unitCgroups'] == {unit: canonical_service_cgroup(unit)[1] for unit in units[:2]})
            bindings = recorded['unitCgroups']
        if bindings is not None:
            require(isinstance(bindings, dict) and set(bindings) == set(units[:2]))
            for service, group in bindings.items():
                require(isinstance(group, str) and group.startswith('/system.slice/') and group.endswith('/'+service) and '..' not in group.split('/'))
        original_group = intent['originalUnit']['ControlGroup'] or (None if empty_admission else '')
        require(set(intent['evidence']['originals']) <= allowed and all(re.fullmatch('[0-9a-f]{64}', value) for value in intent['evidence']['originals'].values()))
        if empty_admission and not os.path.lexists(issued_path):
            require(key in MARKERLESS_ORIGINALS and 'engine-release-requests/'+key+'.awaiting-certificate' not in intent['evidence']['originals'])
            require(announcement_evidence(request) == intent['evidence'])
            require(container_identity(request) == intent['container']); health_pair(request)
            loaded_stop_contract(units[0], key, allow_masked=masked(units), bindings=bindings)
            # Mask only. Even a successor racing this point is never signalled.
            for unit in units:
                path = SYSTEMD / unit
                if os.path.lexists(path): require(path.is_symlink() and os.readlink(path) == '/dev/null')
                else: os.symlink('/dev/null', path); fsync_directory(SYSTEMD)
            command(['systemctl', 'daemon-reload']); require(masked(units))
            quiescence_deadline = time.monotonic() + 60
            while True:
                try: quiet_units(units, original_group, native_empty=True, bindings=bindings); break
                except (ValueError, OSError, subprocess.SubprocessError):
                    if time.monotonic() >= quiescence_deadline:
                        raise ValueError('Empty retry masked; natural quiescence remains unknown; no stop issued')
                    time.sleep(1)
            unchanged_evidence(announcement_evidence(request, after_stop=True), intent['evidence'], key)
        # A bounded expired retry may end after its immutable intent was saved.
        # Prevent another retry without rebinding or signalling a new invocation.
        current = unit_snapshot(units[0])
        if (not empty_admission and not os.path.lexists(issued_path) and current != intent['originalUnit']
                and not (current['MainPID'] == '0' and current['ActiveState'] in {'inactive', 'failed'})):
            require(key == '41177442979-1' and 'engine-release-requests/'+key+'.awaiting-certificate' not in intent['evidence']['originals'])
            for original in [intent['originalProcess'], intent['originalChild']]:
                try:
                    process(original['pid'])
                except FileNotFoundError:
                    # A missing stat/cmdline file is not proof that the PID is gone.
                    try: os.stat(PROC / str(original['pid']), follow_symlinks=False)
                    except FileNotFoundError as error:
                        require(error.errno == errno.ENOENT)
                    else: raise ValueError('Original process directory remains present')
                else:
                    raise ValueError('Original process is present or reused; cancellation remains unproven')
            require(announcement_evidence(request) == intent['evidence'])
            require(container_identity(request) == intent['container']); health_pair(request)
            loaded_stop_contract(units[0], key, allow_masked=masked(units), bindings=bindings)
            for unit in units:
                path = SYSTEMD / unit
                if os.path.lexists(path): require(path.is_symlink() and os.readlink(path) == '/dev/null')
                else: os.symlink('/dev/null', path); fsync_directory(SYSTEMD)
            command(['systemctl', 'daemon-reload'])
            require(masked(units))
            current = unit_snapshot(units[0])
            if not (current['MainPID'] == '0' and current['ActiveState'] in {'inactive', 'failed'}):
                raise ValueError('Changed invocation masked; waiting for natural quiescence without issuing stop')
            quiet_units(units, original_group, empty_admission, bindings)
            unchanged_evidence(announcement_evidence(request, after_stop=True), intent['evidence'], key)
        if not os.path.lexists(issued_path):
            current = unit_snapshot(units[0])
            already_quiet = current['MainPID'] == '0' and current['ActiveState'] in {'inactive', 'failed'}
            if empty_admission: require(already_quiet)
            if already_quiet:
                quiet_units(units, original_group, empty_admission, bindings)
                unchanged_evidence(announcement_evidence(request, after_stop=True), intent['evidence'], key)
            else:
                require(announcement_evidence(request) == intent['evidence'])
                require(current == intent['originalUnit'])
                require(process(intent['originalProcess']['pid']) == intent['originalProcess'])
                require(process(intent['originalChild']['pid']) == intent['originalChild'])
            # Per-instance masks survive reboot. No engine or template unit is selected.
            for unit in units:
                path = SYSTEMD / unit
                if os.path.lexists(path): require(path.is_symlink() and os.readlink(path) == '/dev/null')
                else: os.symlink('/dev/null', path); fsync_directory(SYSTEMD)
            command(['systemctl', 'daemon-reload'])
            require(masked(units))
            if already_quiet:
                quiet_units(units, original_group, empty_admission, bindings)
                unchanged_evidence(announcement_evidence(request, after_stop=True), intent['evidence'], key)
            else:
                loaded_stop_contract(units[0], key, allow_masked=True)
                require(announcement_evidence(request) == intent['evidence'])
                require(unit_snapshot(units[0]) == intent['originalUnit'])
                require(process(intent['originalProcess']['pid']) == intent['originalProcess'])
                require(process(intent['originalChild']['pid']) == intent['originalChild'])
            health_pair(request); require(container_identity(request) == container)
            save_once(issued_path, {'schema': schema, 'intentHash': digest(regular(intent_path, 0o600).encode()),
                                   'stopDisposition': 'not-needed-already-quiescent' if already_quiet else 'requested'})
            # One stop of this exact release only. A lost response never sends it again.
            if not already_quiet:
                try: command(['systemctl', 'stop', '--no-block', units[0]], timeout=5)
                except (OSError, subprocess.SubprocessError): pass
        else:
            issued = json.loads(regular(issued_path, 0o600))
            require(set(issued) == {'schema', 'intentHash', 'stopDisposition'} and issued['schema'] == schema
                    and issued['intentHash'] == digest(regular(intent_path, 0o600).encode())
                    and issued['stopDisposition'] in {'requested', 'not-needed-already-quiescent'})
        if empty_admission:
            require(json.loads(regular(issued_path, 0o600))['stopDisposition'] == 'not-needed-already-quiescent')
        require(masked(units))
        deadline = quiescence_deadline if quiescence_deadline is not None else time.monotonic() + 60
        while True:
            try: states = quiet_units(units, original_group, empty_admission, bindings); break
            except (ValueError, OSError, subprocess.SubprocessError):
                if time.monotonic() >= deadline: raise ValueError('Cancellation stop outcome unknown; no repeat stop')
                time.sleep(1)
        require(container_identity(request) == container); health_pair(request)
        if not os.path.lexists(quiet_path):
            unchanged_evidence(announcement_evidence(request, after_stop=True), intent['evidence'], key)
            save_once(quiet_path, {'schema': schema, 'actualUnitStates': states})
        quiet = json.loads(regular(quiet_path, 0o600))
        # Once the honest quiescence receipt exists, cleanup can resume after any
        # partial unlink. Historical window and announcement entry never change.
        require(digest(regular(ROOT / 'engine-release-requests' / (key + '.activation-entry'), 0o600).encode()) == intent['evidence']['entryHash'])
        require(digest(regular(ROOT / ('engine-recovery-window-' + key + '.json'), 0o600).encode()) == intent['evidence']['reservationHash'])
        require(digest(regular(ROOT / 'engine-release-requests' / (key + '.lightning-hold.json.released'), 0o600).encode()) == intent['evidence']['releasedHoldHash'])
        for relative, expected in intent['evidence']['originals'].items():
            path = ROOT / relative
            if os.path.lexists(path):
                require(digest(regular(path, 0o600).encode()) == expected)
                path.unlink(); fsync_directory(path.parent)
        for unit in units:
            edge = own_wants_edge(unit)
            if os.path.lexists(edge):
                edge.unlink(); fsync_directory(edge.parent)
        require(all(not os.path.lexists(ROOT / relative) for relative in allowed))
        require(masked(units)); quiet_units(units, original_group, empty_admission, bindings)
        require(container_identity(request) == container); health_pair(request)
        if key == PHASE1_RUN:
            require(own_thaw(PHASE1_STAMP, PHASE1_CONTROL) == intent['evidence']['thaw'])
            phase1_seal_evidence(PARENT / 'engine-control-generations' / PHASE1_CONTROL)
        receipt = {'schema': schema, 'request': request, 'result': 'cancelled-expired-announcement',
                   'servingInstanceUnchanged': True, 'originalTerminalEdgesRetired': True, 'quiescent': True,
                   'container': container, 'originalControlGroup': original_group,
                   'actualUnitStates': quiet['actualUnitStates'], 'stopDisposition': json.loads(regular(issued_path, 0o600))['stopDisposition'], 'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        if bindings is not None: receipt['unitCgroups'] = bindings
        save_once(receipt_path, receipt)
        return receipt
    finally:
        os.close(enginefd); os.close(lockfd)


def INVOCATION_PATTERN(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{32}', value) is not None



def current26_kernel_identity(pid, container, receipt_ms):
    """Positive live PID1 incarnation; never infer death from a health timestamp."""
    require(type(pid) is int and pid > 1 and re.fullmatch('[0-9a-f]{64}', container))
    root = PROC / str(pid)
    raw = (root / 'stat').read_bytes()
    prefix, separator, tail = raw.rpartition(b')')
    fields = tail.split()
    require(separator and prefix.startswith(str(pid).encode() + b' (') and len(fields) >= 20
            and fields[0] in {b'R', b'S', b'D', b'I'} and fields[19].isdigit())
    starts = int(fields[19])
    births = [line.split()[1] for line in (PROC / 'stat').read_text().splitlines() if line.startswith('btime ')]
    ticks = os.sysconf('SC_CLK_TCK')
    require(len(births) == 1 and births[0].isdigit() and type(ticks) is int and ticks > 0)
    birth = int(births[0]) + starts / ticks
    require(receipt_ms < birth * 1000 <= time.time() * 1000)
    rows = [line.split()[1:] for line in (root / 'status').read_text().splitlines() if line.startswith('NSpid:')]
    require(len(rows) == 1 and len(rows[0]) >= 2 and all(value.isdigit() for value in rows[0])
            and int(rows[0][0]) == pid and int(rows[0][-1]) == 1)
    namespace = os.readlink(root / 'ns/pid')
    require(re.fullmatch(r'pid:\[[1-9][0-9]*\]', namespace))
    groups = (root / 'cgroup').read_text().splitlines()
    require(len(groups) == 1 and groups[0].startswith('0::/'))
    group = groups[0][3:]
    require('..' not in group.split('/') and
            ('docker-' + container + '.scope' in group.split('/') or group == '/docker/' + container))
    return {'pid': pid, 'startTicks': starts, 'bootTime': int(births[0]),
            'namespace': namespace, 'namespacePids': rows[0], 'cgroup': group}


def current26_cancelled_runtime(request, receipt):
    """Revalidate this cancelled original after a natural same-container restart.

    Historical receipt/intent bytes are untouched. A new live PID1 in the same
    Docker container's newer incarnation proves the old runtime ended. This is
    read-only custody evidence, never cancellation replay or restart authority.
    """
    # Also the generic later owner: the same proof, with its own receipt image.
    require(request['runKey'] == CURRENT26_RUN or request['runKey'] not in PINNED_CANCELLATION_RUNS)
    live = container_identity(request)
    if live == receipt['container']:
        health_pair(request)
        return {'request': request, 'container': live, 'process': None}
    old = receipt['container']
    observed = time_ms(receipt['observedAt'])
    require(live['id'] == old['id'] and live['image'] == old['image']
            and (request['runKey'] != CURRENT26_RUN or
                 old['image'] == 'sha256:2eb1c5a7279032240c5fff8a6b3ecf5dc6af735cc1227a51430d50dcae1b065b')
            and time_ms(old['startedAt']) < observed < time_ms(live['startedAt']) <= time.time() * 1000)
    template = ('{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}},'
                '"running":{{json .State.Running}},"image":{{json .Image}},'
                '"pid":{{json .State.Pid}},"status":{{json .State.Status}}}')
    def native():
        value = json.loads(command(['docker', 'container', 'inspect', '--format', template, 'club-arena-engine']))
        require(set(value) == {'id','startedAt','running','image','pid','status'}
                and value['running'] is True and value['status'] == 'running'
                and {key: value[key] for key in ('id','startedAt','image')} == live
                and type(value['pid']) is int and value['pid'] > 1)
        return value
    initial = native()
    process = current26_kernel_identity(initial['pid'], live['id'], observed)
    url = 'http://127.0.0.1:8080/health'
    with urllib.request.urlopen(url + '?withdraw=' + str(time.time_ns()), timeout=5) as response:
        require(response.geturl().split('?', 1)[0] == url)
        raw = response.read(65537); require(len(raw) <= 65536)
        value = json.loads(raw)
    instance = value.get('instanceId')
    require(isinstance(instance, str) and INSTANCE.fullmatch(instance) and instance != request['instanceId'])
    current = request | {'instanceId': instance}
    healthy(value, current); health_pair(current)
    require(native() == initial and current26_kernel_identity(initial['pid'], live['id'], observed) == process
            and container_identity(current) == live)
    return {'request': current, 'container': live, 'process': process}

def phase1_cancellation_proof():
    """Read-only final evidence consumed by the owning sealed transaction.

    This does not cancel, mask, unlink, write a seal or manufacture a failure.
    The explicit withdrawal must already have reached its immutable receipt.
    """
    require(os.getuid() == 0)
    generation = PARENT / 'engine-control-generations' / PHASE1_CONTROL
    for name, expected in PHASE1_HASHES.items(): require(source_hash(generation / name) == expected)
    require(source_hash(PARENT / 'engine-release-unit-wrapper-v1.sh') == WRAPPER_HASH)
    directory = ROOT / 'engine-release-cancellations'
    records = {name: regular(directory / (PHASE1_RUN + '.' + name + '.json'), 0o600)
               for name in ('receipt', 'intent', 'quiescent', 'stop-issued')}
    receipt, intent, quiet, issued = (json.loads(records[name]) for name in ('receipt', 'intent', 'quiescent', 'stop-issued'))
    request = selection(receipt['request'])
    require(request['runKey'] == PHASE1_RUN and request.get('mode') == 'cancel_expired_announcement')
    cancellation_profile(request)
    validate_cancellation_reply(receipt, request)
    require(receipt['schema'] == intent['schema'] == quiet['schema'] == issued['schema'] == EMPTY_CANCEL_SCHEMA
            and intent['request'] == request and intent['container'] == receipt['container']
            and intent['admission'] == 'positive-empty-auto-restart'
            and intent['originalProcess'] is None and intent['originalChild'] is None
            and issued['stopDisposition'] == receipt['stopDisposition'] == 'not-needed-already-quiescent'
            and issued['intentHash'] == digest(records['intent'].encode())
            and quiet['actualUnitStates'] == receipt['actualUnitStates']
            and intent['unitCgroups'] == receipt['unitCgroups'])
    evidence = intent['evidence']
    reqroot = ROOT / 'engine-release-requests'
    retained = {'entryHash': reqroot / (PHASE1_RUN + '.activation-entry'),
                'reservationHash': ROOT / ('engine-recovery-window-' + PHASE1_RUN + '.json'),
                'releasedHoldHash': reqroot / (PHASE1_RUN + '.lightning-hold.json.released')}
    for name, path in retained.items(): require(digest(regular(path, 0o600).encode()) == evidence[name])
    for directory_name, suffixes in (
            ('engine-release-requests', ('request', 'intent', 'awaiting-certificate', 'break-deadline',
                'legacy-checkpoint-intent', 'main-inspector-retirement-intent', 'main-inspector-retirement-receipt',
                'lightning-hold.json', 'drill')),
            ('engine-intake-requests', ('request', 'intent')),
            ('engine-release-generation-pins', ('generation',)), ('engine-image-leases', ('lease',)),
            ('engine-release-results', ('json',))):
        for suffix in suffixes: require(not os.path.lexists(ROOT / directory_name / (PHASE1_RUN + '.' + suffix)))
    units = cancel_units(PHASE1_RUN)
    require(masked(units))
    for unit in units:
        require(not os.path.lexists(own_wants_edge(unit)))
    quiet_units(units, receipt['originalControlGroup'], True, receipt['unitCgroups'])
    runtime = None
    if PHASE1_RUN == CURRENT26_RUN or PHASE1_RUN not in PINNED_CANCELLATION_RUNS:
        runtime = current26_cancelled_runtime(request, receipt)
    else:
        require(container_identity(request) == receipt['container']); health_pair(request)
    thaw = own_thaw(PHASE1_STAMP, PHASE1_CONTROL)
    require(thaw == evidence['thaw'])
    phase1_runtime_birth(runtime['request'] if runtime else request,
                         runtime['container'] if runtime else receipt['container'], thaw)
    cycle = phase1_seal_evidence(generation)
    quiet_units(units, receipt['originalControlGroup'], True, receipt['unitCgroups'])
    if runtime:
        require(current26_cancelled_runtime(request, receipt) == runtime)
    else:
        require(container_identity(request) == receipt['container'])
    for name, raw in records.items(): require(regular(directory / (PHASE1_RUN + '.' + name + '.json'), 0o600) == raw)
    return {'schema': 'cancelled-routine-announcement-proof/v1', 'originalCycle': cycle,
            'recordHashes': {name: digest(raw.encode()) for name, raw in records.items()},
            'retainedHashes': {name: evidence[name] for name in retained}, 'sourceHashes': PHASE1_HASHES,
            'thaw': thaw, 'container': runtime['container'] if runtime else receipt['container'],
            'instanceId': runtime['request']['instanceId'] if runtime else request['instanceId']}



DIAGNOSTIC_SCHEMA = 'withdrawal-predicate-observation/v1'
DIAGNOSTIC_STAGES = {'selection', 'health_pair', 'container_identity', 'announcement_evidence', 'source_hash',
    'regular', 'observe_seal_state', 'own_thaw', 'prove_thaw', 'loaded_stop_contract', 'unit_snapshot', 'empty_retry_admission',
    'phase1_runtime_birth', 'configured_service_cgroup', 'canonical_service_cgroup', 'capture_service_cgroups',
    'protected_service_template', 'recover_masked_service_cgroups', 'prove_unit_empty', 'prove_unloaded_unit_empty', 'manager_unit_absent',
    'own_wants_edge', 'collect_cancellation_admission', 'cancel_announced', 'cancellation_directory', 'process',
    'quiet_units', 'masked', 'remote', 'main'}
DIAGNOSTIC_CODES = {'predicate_refused', 'read_unavailable', 'command_unproved', 'deadline', 'unknown'}


def diagnostic_error(error):
    stage, line = 'remote', None
    frame = error.__traceback__
    while frame:
        if frame.tb_frame.f_code.co_filename == __file__ and frame.tb_frame.f_code.co_name in DIAGNOSTIC_STAGES:
            stage, line = frame.tb_frame.f_code.co_name, frame.tb_lineno
        frame = frame.tb_next
    code = ('deadline' if isinstance(error, subprocess.TimeoutExpired) else
            'command_unproved' if isinstance(error, subprocess.SubprocessError) else
            'read_unavailable' if isinstance(error, OSError) else
            'predicate_refused' if isinstance(error, (ValueError, KeyError, TypeError)) else 'unknown')
    return {'stage': stage, 'line': line, 'code': code}


def validate_diagnostic(value, request):
    require(isinstance(value, dict) and set(value) == {'schema','request','readOnly','result','retryAllowed','failure'})
    require(value['schema'] == DIAGNOSTIC_SCHEMA and value['request'] == request and value['retryAllowed'] is False)
    require(value['readOnly'] is (request.get('mode') == 'observe_expired_announcement'))
    require(value['result'] in {'predicates_passed_at_read','unproved'})
    error = value['failure']
    if value['result'] == 'predicates_passed_at_read': require(value['readOnly'] is True and error is None)
    else:
        require(isinstance(error, dict) and set(error) == {'stage','line','code'}
                and error['stage'] in DIAGNOSTIC_STAGES and error['code'] in DIAGNOSTIC_CODES
                and (error['line'] is None or type(error['line']) is int and 1 <= error['line'] <= 10000))
    return value


def observe_cancellation(request):
    answer = {'schema':DIAGNOSTIC_SCHEMA, 'request':request, 'readOnly':True,
              'result':'unproved', 'retryAllowed':False, 'failure':None}
    original_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        require(os.getuid() == 0)
        canonical = request | {'mode':'cancel_expired_announcement'}
        units = cancel_units(request['runKey'])
        for unit in units: own_wants_edge(unit)
        health_pair(canonical)
        container = container_identity(canonical)
        collect_cancellation_admission(canonical, units, container, read_only=True)
        answer['result'] = 'predicates_passed_at_read'
    except Exception as error:
        answer['failure'] = diagnostic_error(error)
    finally:
        sys.dont_write_bytecode = original_bytecode
    return validate_diagnostic(answer, request)


def remote(request):
    select_profile(request)
    if request.get('mode') == 'observe_expired_announcement': return observe_cancellation(request)
    if request.get('mode') == 'cancel_expired_announcement':
        return cancel_announced(request)
    require(os.getuid() == 0 and hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'))
    result_path = ROOT / 'engine-release-results' / (request['runKey'] + '.json')
    if os.path.lexists(result_path):
        return terminal(request)  # Lost acknowledgement never repeats the signal.
    key = request['runKey']
    generation = PARENT / 'engine-control-generations' / request['controlSha']
    require(generation.resolve(strict=True) == generation)
    require(regular(generation / 'control-sha').strip() == request['controlSha'])
    request_path = ROOT / 'engine-release-requests' / (key + '.request')
    expected_pin = str(generation) + '\n' + request['controlSha'] + '\n'
    lock_fd = os.open(ENGINE_LOCK, os.O_RDWR | os.O_NOFOLLOW)
    try:
        require(stat.S_ISREG(os.fstat(lock_fd).st_mode) and os.fstat(lock_fd).st_uid == 0)
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        lines = regular(request_path, 0o600).splitlines()
        require(len(lines) == 6 and lines[0] == request['releaseSha'])
        require(lines[3:5] == [str(generation), request['controlSha']])
        require(regular(ROOT / 'engine-release-generation-pins' / (key + '.generation'), 0o600) == expected_pin)
        require(regular(ROOT / 'engine-release-requests' / (key + '.awaiting-certificate')).strip() == request['releaseSha'])
        require(not os.path.lexists(ROOT / 'engine-release-requests' / (key + '.break-deadline')))
        seal = str(generation / 'engine-release-seal.py')
        require(command([seal, 'pending-owner']) == 'none')
        require(command([seal, 'get', 'desired-sha']) == request['desiredSha'])
        unit = 'club-arena-engine-release-v1@' + key + '.service'
        state = properties(unit)
        require(state['ActiveState'] in ('active', 'activating'))
        require(re.fullmatch(r'[0-9a-f]{32}', state['InvocationID']) is not None)
        parent = process(int(state['MainPID']))
        require(bash_command(parent['argv'], [str(PARENT / 'engine-release-unit-wrapper-v1.sh'), 'start', key]))
        children = (PROC / str(parent['pid']) / 'task' / str(parent['pid']) / 'children').read_text().split()
        matches = [process(int(pid)) for pid in children]
        matches = [p for p in matches if bash_command(p['argv'], [str(generation / 'engine-release-transaction.sh'), '--run-id', key])]
        require(len(matches) == 1 and matches[0]['parent'] == parent['pid'])
        child = matches[0]
        pid_fd = os.pidfd_open(child['pid'])
        try:
            before = container_identity(request)
            health_pair(request)
            command([str(generation / 'engine-release-database-proof.py'), '--env-file',
                     '/opt/club-arena/server/.env', '--sha', request['desiredSha'],
                     '--instance-id', request['instanceId'], '--timeout-seconds', '15',
                     '--poll-seconds', '5', '--max-heartbeat-age-seconds', '15'], timeout=17)
            require(properties(unit) == state and process(parent['pid']) == parent and process(child['pid']) == child)
            require(command([seal, 'pending-owner']) == 'none')
            require(container_identity(request) == before)
            health_pair(request)
            # Signal the pidfd-bound transaction, never its wrapper, unit or cgroup.
            signal.pidfd_send_signal(pid_fd, signal.SIGINT)
        finally:
            os.close(pid_fd)
    finally:
        os.close(lock_fd)  # Original wrapper must immediately regain its recovery lock.
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            answer = terminal(request, state['InvocationID'])
            require(container_identity(request) == before)
            return answer
        except (ValueError, OSError, subprocess.SubprocessError, KeyError):
            time.sleep(1)
    raise ValueError('Original terminal outcome remains unknown; do not replay')


def main():
    if sys.argv[1:] == ['--phase1-cancellation-proof', CURRENT26_RUN]:
        select_current26_profile()
        print(json.dumps(phase1_cancellation_proof(), sort_keys=True))
        return
    if sys.argv[1:] == ['--phase1-cancellation-proof', SECOND_PHASE1_RUN]:
        select_second_phase1_profile()
        print(json.dumps(phase1_cancellation_proof(), sort_keys=True))
        return
    if sys.argv[1:] == ['--phase1-cancellation-proof']:
        print(json.dumps(phase1_cancellation_proof(), sort_keys=True))
        return
    if (len(sys.argv) == 3 and sys.argv[1] == '--phase1-cancellation-proof'
            and RUN.fullmatch(sys.argv[2]) and sys.argv[2] not in PINNED_CANCELLATION_RUNS):
        # The owner's own immutable receipt names the request; the proof below
        # revalidates every field of it against the retained host records.
        receipt = json.loads(regular(ROOT / 'engine-release-cancellations' / (sys.argv[2] + '.receipt.json'), 0o600))
        request = selection(receipt.get('request') if isinstance(receipt, dict) else None)
        require(request['runKey'] == sys.argv[2] and request.get('mode') == 'cancel_expired_announcement')
        select_generic_phase1_profile(request)
        print(json.dumps(phase1_cancellation_proof(), sort_keys=True))
        return
    if len(sys.argv) == 3 and sys.argv[1] == '--remote':
        request = selection(json.loads(base64.b64decode(sys.argv[2], validate=True)))
        try: answer = remote(request)
        except Exception as error:
            answer = {'schema':DIAGNOSTIC_SCHEMA, 'request':request, 'readOnly':False,
                      'result':'unproved', 'retryAllowed':False, 'failure':diagnostic_error(error)}
            print(json.dumps(validate_diagnostic(answer, request)))
            raise SystemExit(1)
        print(json.dumps(answer))
        return
    require(len(sys.argv) == 1 and os.environ.get('GITHUB_EVENT_NAME') == 'repository_dispatch')
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    require(event.get('action') == 'withdraw-club-arena-engine')
    request = selection(event.get('client_payload', {}).get('withdrawal'))
    host, key, pin = [os.environ.get(k, '') for k in ('HETZNER_HOST', 'HETZNER_SSH_PRIVATE_KEY', 'HETZNER_HOST_KEY')]
    require(re.fullmatch(r'[A-Za-z0-9.-]+', host) is not None and not host.startswith('-') and key.strip() and pin.strip())
    directory = Path(tempfile.mkdtemp(prefix='engine-withdrawal-', dir=os.environ['RUNNER_TEMP']))
    try:
        for name, content in [('key', key), ('known_hosts', pin)]:
            path = directory / name
            path.write_text(content + '\n')
            path.chmod(0o600)
        for args in [['ssh-keygen', '-y', '-f', str(directory / 'key')], ['ssh-keygen', '-l', '-f', str(directory / 'known_hosts')]]:
            subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=5)
        encoded = base64.b64encode(json.dumps(request).encode()).decode()
        args = ['ssh', '-i', str(directory / 'key'), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
                '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
                '-o', 'UserKnownHostsFile=' + str(directory / 'known_hosts'), '-o', 'ConnectTimeout=10',
                'root@' + host, "python3 - --remote '" + encoded + "'"]
        reply = subprocess.run(args, input=Path(__file__).read_bytes(), capture_output=True, timeout=150)
        require(len(reply.stdout) <= 4096)
        answer = json.loads(reply.stdout)
        if isinstance(answer, dict) and answer.get('schema') == DIAGNOSTIC_SCHEMA:
            validate_diagnostic(answer, request)
            destination = Path('artifacts/engine-withdrawal'); destination.mkdir(parents=True, exist_ok=True)
            (destination / 'diagnostic.json').write_text(json.dumps(answer, indent=2)+'\n')
            print(json.dumps(answer))
            require(reply.returncode == 0 and request.get('mode') == 'observe_expired_announcement')
            return
        require(reply.returncode == 0)
        if request.get('mode') == 'cancel_expired_announcement':
            validate_cancellation_reply(answer, request)
            destination = Path('artifacts/engine-withdrawal')
            destination.mkdir(parents=True, exist_ok=True)
            (destination / 'receipt.json').write_text(json.dumps(answer, indent=2) + '\n')
            print('Exact expired announcement cancelled; serving engine unchanged.')
            return
        require(set(answer) == set(request) | {'schema', 'result', 'invocationId',
                'originalTransactionExitStatus', 'servingInstanceUnchanged', 'originalTerminalEdgesRetired'})
        require(all(answer.get(k) == v for k, v in request.items()))
        require(answer.get('schema') == SCHEMA and answer.get('result') == 'withdrawn-before-mutation')
        require(answer.get('originalTransactionExitStatus') == 130)
        require(re.fullmatch(r'[0-9a-f]{32}', answer.get('invocationId', '')) is not None)
        require(answer.get('servingInstanceUnchanged') is True and answer.get('originalTerminalEdgesRetired') is True)
        answer['observedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        destination = Path('artifacts/engine-withdrawal')
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'receipt.json').write_text(json.dumps(answer, indent=2) + '\n')
        print('Original waiting transaction withdrawn; exact serving instance unchanged.')
    finally:
        shutil.rmtree(directory)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Withdrawal unproved. Read the original exact run before any further action.', file=sys.stderr)
        sys.exit(1)
