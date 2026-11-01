#!/usr/bin/env python3
"""Source-bound remote bootstrap, sent only by the existing protected carrier.

CLI arguments are generated from its protected checkout, not user-selected
paths. Receipt mode must call the retained exact controller without staging.
Production accepts only the protected production-purpose profile and kernel.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile

MAX_BUNDLE = 66 * 1024 * 1024
NATIVE_SHA = '020c6c74be9e6942feadb2b9b3eca80db41f8af1515deaa48f9b8ba5d6d76a72'


def stage(op, engine, bundle_sha, installer_sha, planner_sha, profile_sha, raw):
    assert os.geteuid() == 0 and sys.platform == 'linux'
    assert re.fullmatch(r'[1-9][0-9]{0,19}', op) and re.fullmatch(r'[0-9a-f]{40}', engine)
    assert all(re.fullmatch(r'[0-9a-f]{64}', item) for item in (bundle_sha, installer_sha, planner_sha, profile_sha))
    assert 0 < len(raw) <= MAX_BUNDLE and hashlib.sha256(raw).hexdigest() == bundle_sha
    files = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as archive:
        for member in archive:
            assert member.isfile() and member.name not in files
            assert member.name in ('installer.py', 'native-fault-observation.py', 'package-plan.py', 'profile.json') or re.fullmatch(r'packages/[a-z0-9][a-z0-9+.-]{0,95}\.deb', member.name)
            assert 0 < member.size <= 64 * 1024 * 1024 and len(files) < 36
            files[member.name] = archive.extractfile(member).read(member.size + 1)
            assert len(files[member.name]) == member.size
    expected = {'installer.py': installer_sha, 'native-fault-observation.py': NATIVE_SHA,
        'package-plan.py': planner_sha, 'profile.json': profile_sha}
    for name, digest in expected.items():
        assert hashlib.sha256(files[name]).hexdigest() == digest
    installer = {'__name__': 'qualified_installer_profile', '__file__': '<qualified-installer-source>'}
    exec(compile(files['installer.py'], '<qualified-installer-source>', 'exec'), installer)
    qualified = installer['profile'](files['profile.json'], profile_sha)
    # Production provider has no purpose/kernel/profile selector. Its source
    # profile/hash is protected, and fixture-purpose profiles never stage here.
    assert qualified['purpose'] == 'production' and qualified['kernel'] == '6.8.0-147-generic'
    native = {'__name__': 'qualified_identity', '__file__': '<qualified-source>'}
    exec(compile(files['native-fault-observation.py'], '<qualified-source>', 'exec'), native)
    original = native['target_identity'](engine)
    info = native['prerequisite_os']()
    assert info == {'id': 'ubuntu', 'versionId': '24.04', 'kernelRelease': '6.8.0-147-generic'} and os.uname().machine == 'x86_64'
    assert native['same_target'](original)
    root = Path('/var/lib/club-arena-perf-install')
    native['trusted_directory'](root, create=True)
    folder = root / op
    # No restaging/overwrite after an unknown SSH acknowledgement.
    folder.mkdir(mode=0o700)
    (folder / 'packages').mkdir(mode=0o700)
    for name, content in files.items():
        destination = folder / name
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    for directory in (folder / 'packages', folder, root):
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    # This subprocess acknowledges admission only. Host systemd owns any
    # subsequent package operation independently of SSH/controller lifetime.
    return subprocess.run(['/usr/bin/python3', '-I', '-B', str(folder / 'installer.py'),
        'admit', '--operation', op, '--expected-engine-sha', engine, '--profile-sha', profile_sha],
        stdin=subprocess.DEVNULL, timeout=20, check=False).returncode


if __name__ == '__main__':
    try:
        raise SystemExit(stage(*sys.argv[1:], sys.stdin.buffer.read(MAX_BUNDLE + 1)))
    except Exception:
        print(json.dumps({'schema': 'native-perf-install/v1', 'installationVerified': False,
            'reason': 'staging_outcome_unproven', 'retryAllowed': False}))
        raise SystemExit(1)
