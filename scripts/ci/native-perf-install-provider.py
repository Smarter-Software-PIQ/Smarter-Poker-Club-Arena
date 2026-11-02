#!/usr/bin/env python3
"""One explicit missing-tool install, or read the same retained operation.

Only the existing protected-default-branch workflow supplies SSH/configuration.
No profile, package, kernel, command or source selector is a dispatch input.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CONTROLLER = ROOT / 'scripts/ci/native-perf-install-controller.py'
PROFILE = ROOT / 'scripts/ci/native-perf-install-profile.json'
AUTH = ['-o', 'APT::Get::AllowUnauthenticated=false', '-o', 'Acquire::AllowInsecureRepositories=false',
    '-o', 'Acquire::AllowDowngradeToInsecureRepositories=false', '-o', 'Acquire::AllowWeakRepositories=false']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def command(args, *, cwd=None, input=None, timeout=30, bound=262144):
    # Spool privately; never retain unbounded child output or print SSH/APT data.
    with tempfile.TemporaryFile() as output:
        child = subprocess.run(args, input=input, stdout=output, stderr=subprocess.DEVNULL,
            cwd=cwd, timeout=timeout, env={**os.environ, 'LC_ALL': 'C'})
        output.seek(0)
        raw = output.read(bound + 1)
    if len(raw) > bound:
        raise RuntimeError('provider_output_bound')
    return child.returncode, raw


def bundle(folder, helper, profile_raw, profile_sha):
    profile = helper.profile(profile_raw, profile_sha)
    if profile['purpose'] != 'production' or profile['kernel'] != '6.8.0-147-generic':
        raise RuntimeError('production_profile_refused')
    code, _ = command(['sudo', '/usr/bin/apt-get', *AUTH, 'update'], timeout=90)
    if code:
        raise RuntimeError('signed_download_unproven')
    files = {
        'installer.py': CONTROLLER.read_bytes(),
        'native-fault-observation.py': (ROOT / 'scripts/ci/native-fault-observation.py').read_bytes(),
        'package-plan.py': (ROOT / 'scripts/ci/native-perf-install.py').read_bytes(),
        'profile.json': profile_raw,
    }
    for row in profile['packages']:
        code, _ = command(['/usr/bin/apt-get', *AUTH, 'download', row['package'] + '=' + row['version']], cwd=folder)
        if code:
            raise RuntimeError('signed_download_unproven')
        candidates = [path for path in folder.glob('*.deb') if path.stat().st_size == row['bytes']
            and sha(path.read_bytes()) == row['sha256']]
        if len(candidates) != 1:
            raise RuntimeError('public_package_binding_refused')
        files['packages/' + row['package'] + '.deb'] = candidates[0].read_bytes()
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:') as archive:
        for name, raw in files.items():
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode = len(raw), 0o600
            archive.addfile(entry, io.BytesIO(raw))
    raw = output.getvalue()
    if not 0 < len(raw) <= 66 * 1024 * 1024:
        raise RuntimeError('bundle_bound')
    return raw, files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('install', 'receipt'))
    parser.add_argument('--operation', required=True)
    parser.add_argument('--expected-engine-sha', required=True)
    parser.add_argument('--host', required=True)
    parser.add_argument('--ssh-directory', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = {'schema': 'native-perf-install-readback/v1', 'validReceipt': False,
        'installationVerified': False, 'retryAllowed': False, 'nativeCauseProven': False}
    phase = 'inputs'
    try:
        if not re.fullmatch(r'[1-9][0-9]{0,19}', args.operation) or not re.fullmatch(r'[0-9a-f]{40}', args.expected_engine_sha) or not re.fullmatch(r'[A-Za-z0-9.-]+', args.host):
            raise RuntimeError('provider_inputs_refused')
        phase = 'profile'
        spec = importlib.util.spec_from_file_location('install_receipt', CONTROLLER)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        profile_raw, source_raw = PROFILE.read_bytes(), CONTROLLER.read_bytes()
        profile_sha, source_sha = sha(profile_raw), sha(source_raw)
        profile = helper.profile(profile_raw, profile_sha)
        if profile['purpose'] != 'production' or profile['kernel'] != '6.8.0-147-generic':
            raise RuntimeError('production_profile_refused')
        ssh = ['ssh', '-F', '/dev/null', '-i', str(args.ssh_directory / 'key'), '-o', 'BatchMode=yes',
            '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'UserKnownHostsFile=' + str(args.ssh_directory / 'known_hosts'),
            '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=15',
            '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', 'root@' + args.host]
        if args.mode == 'install':
            with tempfile.TemporaryDirectory(prefix='native-perf-public-') as temporary:
                phase = 'signed_download'
                raw, files = bundle(Path(temporary), helper, profile_raw, profile_sha)
                stage = (ROOT / 'scripts/ci/native-perf-install-stage.py').read_text()
                remote = shlex.join(['/usr/bin/python3', '-I', '-B', '-c', stage, args.operation,
                    args.expected_engine_sha, sha(raw), source_sha, sha(files['package-plan.py']), profile_sha])
                # Regardless of acknowledgment, continue ONLY with this original
                # operation's read. A timeout can never submit a second install.
                phase = 'admission'
                try:
                    command([*ssh, remote], input=raw, timeout=40, bound=16384)
                except (subprocess.SubprocessError, OSError, RuntimeError):
                    pass
        remote = shlex.join(['/usr/bin/python3', '-I', '-B',
            '/var/lib/club-arena-perf-install/' + args.operation + '/installer.py',
            'receipt', '--operation', args.operation, '--wait'])
        phase = 'receipt'
        status, raw = command([*ssh, remote], timeout=220, bound=16384)
        result = helper.receipt_outcome(raw, args.operation, profile_sha, source_sha, 'production', args.expected_engine_sha, status)
    except Exception as error:
        # Unknown effects remain owned by the original numeric operation. No
        # host state, package transaction, intent or receipt is removed/retried.
        known = {'provider_inputs_refused', 'production_profile_refused', 'signed_download_unproven',
            'public_package_binding_refused', 'bundle_bound', 'provider_output_bound'}
        result.update(providerPhase=phase, reason=str(error) if str(error) in known else 'provider_unproven')
    args.output.write_text(json.dumps(result, separators=(',', ':')))
    print(json.dumps(result, separators=(',', ':')))
    if result.get('validReceipt') is not True or result.get('installationVerified') is not True:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
