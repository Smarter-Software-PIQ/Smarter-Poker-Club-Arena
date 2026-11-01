#!/usr/bin/env python3
"""Real Ubuntu24 APT qualification only; never a production installer.

The running kernel is recorded honestly and need not match the tools package.
This does not qualify exact-production-kernel admission or host unit custody.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import resource
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('package_plan', ROOT / 'scripts/ci/native-perf-install.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
DEADLINE = 0
ENV = {**os.environ, 'LC_ALL': 'C', 'DEBIAN_FRONTEND': 'noninteractive', 'NEEDRESTART_MODE': 'l'}
APT_AUTH = ['-o', 'APT::Get::AllowUnauthenticated=false', '-o', 'Acquire::AllowInsecureRepositories=false',
    '-o', 'Acquire::AllowDowngradeToInsecureRepositories=false', '-o', 'Acquire::AllowWeakRepositories=false']
PHASE = 'admission'
PHASES = frozenset(('admission', 'signed_repository_update', 'package_plan', 'authenticated_download',
    'package_control_inspection', 'public_package_retention', 'service_identity_before',
    'actual_package_install', 'service_identity_after', 'installed_package_verification'))
FAILURE_REASONS = frozenset(('qualification_deadline', 'qualification_command_timeout',
    'qualification_command_nonzero', 'qualification_output_bound', 'service_inventory_unbounded',
    'real_ubuntu24_amd64_required', 'installed_version_unproven', 'tools_version_conflict',
    'tools_already_installed', 'package_archives_unproven', 'downloaded_package_binding_refused',
    'package_control_unbounded', 'package_control_unknown', 'running_service_identity_changed',
    'installed_package_unproven', 'installed_perf_unproven'))


class Failure(RuntimeError):
    def __init__(self, reason, exit_code=None):
        super().__init__(reason)
        self.reason = reason
        self.exit_code = exit_code


def closed_failure(error, phase):
    reason = error.reason if isinstance(error, Failure) else str(error)
    allowed = FAILURE_REASONS | helper.PLAN_REFUSALS
    code = error.exit_code if isinstance(error, Failure) else None
    result = {'phase': phase if phase in PHASES else 'admission',
        'reason': reason if reason in allowed else 'qualification_data_unproven',
        'exitCode': code if isinstance(code, int) and not isinstance(code, bool) and -255 <= code <= 255 else None}
    if isinstance(error, helper.PlanRefusal) and isinstance(error.package, str) and isinstance(error.version, str) \
            and helper.PACKAGE.fullmatch(error.package) and helper.DEBIAN_VERSION.fullmatch(error.version):
        result.update(refusedPackage=error.package, refusedVersion=error.version)
    installed = getattr(error, 'installed_tools', None)
    if isinstance(installed, dict) and all(name in helper.TARGETS and isinstance(version, str)
            and helper.DEBIAN_VERSION.fullmatch(version) for name, version in installed.items()):
        result['installedTools'] = installed
    return result


def run(args, cwd=None, limit=131072, accepted=(0,)):
    remaining = DEADLINE - time.monotonic()
    if remaining <= 0:
        raise Failure('qualification_deadline')
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run(args, cwd=cwd, env=ENV, stdin=subprocess.DEVNULL,
                stdout=output, stderr=subprocess.DEVNULL, timeout=min(remaining, 90), check=False)
        except subprocess.TimeoutExpired:
            raise Failure('qualification_command_timeout') from None
        output.seek(0)
        raw = output.read(limit + 1)
    if result.returncode not in accepted:
        raise Failure('qualification_command_nonzero', result.returncode)
    if len(raw) > limit:
        raise Failure('qualification_output_bound', result.returncode)
    return raw


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def services():
    units = run(['/usr/bin/systemctl', 'list-units', '--type=service', '--state=running',
        '--no-pager', '--no-legend', '--plain']).decode().splitlines()
    names = [line.split()[0] for line in units]
    if len(names) > 256:
        raise Failure('service_inventory_unbounded')
    return run(['/usr/bin/systemctl', 'show', '--property=Id,InvocationID,MainPID', *names])


def qualify(folder, public_folder):
    global PHASE
    os_info = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if os.geteuid() != 0 or os_info.get('ID') != 'ubuntu' or os_info.get('VERSION_ID', '').strip('"') != '24.04' or platform.machine() != 'x86_64':
        raise Failure('real_ubuntu24_amd64_required')
    installed = {}
    for name in helper.TARGETS:
        value = run(['/usr/bin/dpkg-query', '--show', '--showformat=${Status}\t${Version}', name], accepted=(0, 1)).decode()
        if value.startswith('install ok installed\t'):
            version = value.split('\t')[1]
            if not helper.DEBIAN_VERSION.fullmatch(version):
                raise Failure('installed_version_unproven')
            installed[name] = version
    state = helper.installed_targets(installed)
    if state != 'installation_needed':
        error = Failure(state)
        error.installed_tools = installed
        raise error
    # Fresh repository signatures and canonical APT/dpkg locks, no weakened
    # trust flags, repository rewrites, upgrades, hook suppression or retries.
    PHASE = 'signed_repository_update'
    run(['/usr/bin/apt-get', *APT_AUTH, 'update'], limit=262144)
    args = ['/usr/bin/apt-get', *APT_AUTH, '--no-install-recommends', '--no-upgrade', '--no-remove']
    requested = [name + '=' + helper.VERSION for name in helper.TARGETS]
    PHASE = 'package_plan'
    raw_plan = run([*args, '--simulate', 'install', *requested], limit=65536)
    packages = helper.plan(raw_plan)
    inspected = {**{name: helper.VERSION for name in helper.TARGETS}, **packages}
    rows = []
    PHASE = 'authenticated_download'
    for name, version in sorted(inspected.items()):
        run(['/usr/bin/apt-get', *APT_AUTH, 'download', name + '=' + version], cwd=folder)
    archives = sorted(folder.glob('*.deb'))
    if len(archives) != len(inspected) or sum(p.stat().st_size for p in archives) > 64 * 1024 * 1024:
        raise Failure('package_archives_unproven')
    PHASE = 'public_package_retention'
    # This directory contains only identity-validated PUBLIC Ubuntu DEBs.
    # The unprivileged Actions uploader must be able to traverse it.
    public_folder.mkdir(mode=0o755)
    PHASE = 'package_control_inspection'
    for archive in archives:
        fields = run(['/usr/bin/dpkg-deb', '--field', str(archive), 'Package', 'Version', 'Architecture']).decode()
        values = dict(line.split(': ', 1) for line in fields.splitlines())
        name, version = values['Package'], values['Version']
        if inspected.get(name) != version or values['Architecture'] not in ('amd64', 'all'):
            raise Failure('downloaded_package_binding_refused')
        # Retain only identity-validated PUBLIC packages, including when their
        # subsequently inspected control metadata makes qualification refuse.
        PHASE = 'public_package_retention'
        with archive.open('rb') as source, (public_folder / archive.name).open('xb') as destination:
            shutil.copyfileobj(source, destination, 1024 * 1024)
        (public_folder / archive.name).chmod(0o644)
        PHASE = 'package_control_inspection'
        control = folder / ('control-' + name)
        run(['/usr/bin/dpkg-deb', '--control', str(archive), str(control)])
        scripts = {}
        for entry in control.iterdir():
            if not entry.is_file() or entry.is_symlink() or entry.stat().st_size > 262144:
                raise Failure('package_control_unbounded')
            if entry.name not in ('control', 'md5sums', 'shlibs', 'symbols', 'triggers', 'conffiles', 'preinst', 'postinst', 'prerm', 'postrm'):
                raise Failure('package_control_unknown')
            if entry.name not in ('control', 'md5sums'):
                scripts[entry.name] = sha(entry.read_bytes())
        rows.append({'package': name, 'version': version, 'architecture': values['Architecture'],
            'newPackage': name in packages, 'sha256': sha(archive.read_bytes()), 'controlFilesSHA256': scripts})
    PHASE = 'service_identity_before'
    before = services()
    # These are disposable CI-host packages. Root reviews the resulting exact
    # package/control/hook profile before any production installer is admitted.
    PHASE = 'actual_package_install'
    run([*args, '-y', 'install', *requested], limit=262144)
    PHASE = 'service_identity_after'
    after = services()
    if before != after:
        raise Failure('running_service_identity_changed')
    PHASE = 'installed_package_verification'
    for row in rows:
        installed = run(['/usr/bin/dpkg-query', '--show', '--showformat=${Status}\t${Version}', row['package']]).decode()
        if installed != 'install ok installed\t' + row['version']:
            raise Failure('installed_package_unproven')
    actual_perf = Path('/usr/lib/linux-tools-6.8.0-147/perf')
    if not actual_perf.is_file() or not run([str(actual_perf), '--version']).startswith(b'perf version '):
        raise Failure('installed_perf_unproven')
    return {'schema': 'native-perf-package-qualification/v1', 'qualified': True,
        'os': 'ubuntu24.04', 'actualKernel': platform.release(), 'productionKernelQualified': False,
        'packageVersion': helper.VERSION, 'packages': rows, 'normalAptHooksPreserved': True,
        'needrestartMode': 'l', 'runningServiceIdentitiesUnchanged': True,
        'aptConfigurationSHA256': sha(run(['/usr/bin/apt-config', 'dump'])),
        'productionInstallationQualified': False, 'nativeCauseProven': False,
        'phase': 'complete', 'reason': 'isolated_package_install_verified', 'exitCode': 0}


def main():
    global DEADLINE
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    DEADLINE = time.monotonic() + 240
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
    outcome = {'schema': 'native-perf-package-qualification/v1', 'qualified': False,
        'reason': 'isolated_package_qualification_unproven', 'phase': PHASE, 'exitCode': None,
        'productionInstallationQualified': False}
    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='native-perf-package-') as temporary:
            outcome = qualify(Path(temporary), args.output.parent / 'public-debs')
    except Failure as error:
        outcome.update(closed_failure(error, PHASE))
    except ValueError as error:
        outcome.update(closed_failure(error, PHASE))
    except (OSError, KeyError, UnicodeError):
        outcome.update(phase=PHASE, reason='qualification_filesystem_or_data_unproven')
    finally:
        outcome['helperSHA256'] = sha((ROOT / 'scripts/ci/native-perf-install.py').read_bytes())
        outcome['fixtureSHA256'] = sha(Path(__file__).read_bytes())
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(outcome, separators=(',', ':')))
    if not outcome['qualified']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
