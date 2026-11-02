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
import re
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
HWDATA = {'package': 'hwdata', 'version': '0.379-1', 'architecture': 'all', 'bytes': 29110,
    'sha256': 'ff3b05dc5ca0d10b50683838e1fc6d355867b76664eb2890c6ee1a55522b06c9'}
PHASE = 'admission'
PHASES = frozenset(('admission', 'signed_repository_update', 'package_plan', 'authenticated_download',
    'package_control_inspection', 'public_package_retention', 'service_identity_before',
    'actual_package_install', 'service_identity_after', 'installed_package_verification'))
FAILURE_REASONS = frozenset(('qualification_deadline', 'qualification_command_timeout',
    'qualification_command_nonzero', 'qualification_output_bound', 'service_inventory_unbounded',
    'real_ubuntu24_amd64_required', 'installed_version_unproven', 'tools_version_conflict',
    'tools_already_installed', 'package_archives_unproven', 'downloaded_package_binding_refused',
    'package_control_unbounded', 'package_control_unknown', 'running_service_identity_changed',
    'installed_package_unproven', 'installed_perf_unproven', 'hwdata_candidate_refused',
    'hwdata_control_refused', 'hwdata_install_unproven', 'qualification_run_unproven'))


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


def run(args, cwd=None, limit=131072, accepted=(0,), timeout=90):
    remaining = DEADLINE - time.monotonic()
    if remaining <= 0:
        raise Failure('qualification_deadline')
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run(args, cwd=cwd, env=ENV, stdin=subprocess.DEVNULL,
                stdout=output, stderr=subprocess.DEVNULL, timeout=min(remaining, timeout), check=False)
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


def verify_hwdata(raw, fields, control_names, depends):
    if len(raw) != HWDATA['bytes'] or sha(raw) != HWDATA['sha256'] or fields != {
            'Package': HWDATA['package'], 'Version': HWDATA['version'], 'Architecture': HWDATA['architecture']}:
        raise Failure('hwdata_candidate_refused')
    if set(control_names) != {'control', 'md5sums'} or depends.strip() != 'pci.ids, usb.ids':
        raise Failure('hwdata_control_refused')


def explicit_uninstalled(name, code, stdout, stderr):
    # Qualification-only semantics. Empty output alone is never absence.
    if not isinstance(name, str) or type(code) is not int or name not in set(helper.TARGETS) | {'hwdata'}:
        return False
    return (code == 1 and stdout == b'' and stderr == ('dpkg-query: no packages found matching ' + name + '\n').encode()
        or code == 0 and stdout == b'unknown ok not-installed\t' and stderr == b'')


def profile_proposal(rows, run_id, hwdata_evidence):
    if not isinstance(run_id, str) or not re.fullmatch(r'[1-9][0-9]{0,19}', run_id):
        raise Failure('qualification_run_unproven')
    original = json.loads((ROOT / 'scripts/ci/native-perf-install-profile.json').read_bytes())
    expected_rows = {row['package']: row for row in [*original['packages'], HWDATA]}
    expected = set(expected_rows)
    if len(rows) != 4 or {row['package'] for row in rows} != expected or hwdata_evidence.get('hwdataFreshInstallVerified') is not True or hwdata_evidence.get('cleanupConfirmed') is not True or hwdata_evidence.get('hwdataSHA256') != HWDATA['sha256'] or hwdata_evidence.get('hwdataVersion') != HWDATA['version'] or hwdata_evidence.get('noUpgradesOrRemovals') is not True or hwdata_evidence.get('combinedRecoveryTransactionQualified') is not False:
        raise Failure('hwdata_install_unproven')
    if any({key: row.get(key) for key in ('package', 'version', 'architecture', 'bytes', 'sha256')} != expected_rows[row['package']] for row in rows):
        raise Failure('hwdata_candidate_refused')
    return {'schema': 'native-perf-install-profile-proposal/v1', 'qualified': True,
        'purpose': 'package-materialization-only', 'qualificationRun': run_id,
        'os': 'ubuntu', 'version': '24.04', 'arch': 'amd64', 'kernel': '6.8.0-147-generic',
        'packages': [{key: row[key] for key in ('package', 'version', 'architecture', 'bytes', 'sha256')} for row in rows],
        'productionInstallationQualified': False, 'recoveryAdmissionQualified': False,
        'combinedRecoveryTransactionQualified': False,
        'installationEvidence': 'original_three_isolated_host_and_hwdata_fresh_disposable_ubuntu'}


def services():
    units = run(['/usr/bin/systemctl', 'list-units', '--type=service', '--state=running',
        '--no-pager', '--no-legend', '--plain']).decode().splitlines()
    names = [line.split()[0] for line in units]
    if len(names) > 256:
        raise Failure('service_inventory_unbounded')
    return run(['/usr/bin/systemctl', 'show', '--property=Id,InvocationID,MainPID', *names])


def qualify(folder, public_folder):
    global PHASE, DEADLINE
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
    inspected = {**{name: helper.VERSION for name in helper.TARGETS}, **packages, 'hwdata': HWDATA['version']}
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
        if name == 'hwdata':
            verify_hwdata(archive.read_bytes(), values, [entry.name for entry in control.iterdir()],
                run(['/usr/bin/dpkg-deb', '--field', str(archive), 'Depends']).decode())
        rows.append({'package': name, 'version': version, 'architecture': values['Architecture'], 'bytes': archive.stat().st_size,
            'newPackage': name in packages, 'sha256': sha(archive.read_bytes()), 'controlFilesSHA256': scripts})
    PHASE = 'service_identity_before'
    before = services()
    # These are disposable CI-host packages. Root reviews the resulting exact
    # package/control/hook profile before any production installer is admitted.
    PHASE = 'actual_package_install'
    # Preparation keeps its original240s cap. The new child owns300s
    # execution plus180s cleanup; never launch it on a depleted prior budget.
    DEADLINE = time.monotonic() + 480
    # Same actual host-owned installer transaction as production, configured
    # honestly for this isolated host kernel. No direct APT install bypass.
    run(['/usr/bin/python3', '-B', str(ROOT / 'tests/fixtures/engine-native-fault/qualify_perf_install.py'),
        '--scene', str(ROOT / 'tests/fixtures/engine-native-fault/qualify_host_unit.py'),
        '--profile', str(ROOT / 'scripts/ci/native-perf-install-profile.json'),
        '--packages', str(public_folder),
        '--output', str(public_folder.parent / 'installer-qualification.json')], timeout=480)
    # This child owns230s plus10s cleanup; allow5s process/report reserve.
    DEADLINE = time.monotonic() + 245
    common = next(row for row in rows if row['package'] == 'linux-tools-common')
    archive = next(path for path in public_folder.glob('*.deb') if sha(path.read_bytes()) == common['sha256'])
    hwdata_archive = next(path for path in public_folder.glob('*.deb') if sha(path.read_bytes()) == HWDATA['sha256'])
    run(['/usr/bin/python3', '-B', str(ROOT / 'tests/fixtures/engine-native-fault/qualify_perf_missing_archive.py'),
        '--deb', str(archive), '--sha256', common['sha256'], '--hwdata-deb', str(hwdata_archive),
        '--output', str(public_folder.parent / 'missing-archive-qualification.json')], timeout=245)
    hwdata_evidence = json.loads((public_folder.parent / 'missing-archive-qualification.json').read_bytes())
    if hwdata_evidence.get('qualified') is not True or hwdata_evidence.get('hwdataFreshInstallVerified') is not True or hwdata_evidence.get('cleanupConfirmed') is not True:
        raise Failure('hwdata_install_unproven')
    DEADLINE = time.monotonic() + 90  # Existing final service/package readbacks.
    PHASE = 'service_identity_after'
    after = services()
    if before != after:
        raise Failure('running_service_identity_changed')
    PHASE = 'installed_package_verification'
    for row in rows:
        if row['package'] == 'hwdata':
            continue  # Fresh installation is proved in the disposable Ubuntu.
        installed = run(['/usr/bin/dpkg-query', '--show', '--showformat=${Status}\t${Version}', row['package']]).decode()
        if installed != 'install ok installed\t' + row['version']:
            raise Failure('installed_package_unproven')
    actual_perf = Path('/usr/lib/linux-tools-6.8.0-147/perf')
    if not actual_perf.is_file() or not run([str(actual_perf), '--version']).startswith(b'perf version '):
        raise Failure('installed_perf_unproven')
    proposal = profile_proposal(rows, os.environ.get('GITHUB_RUN_ID', ''), hwdata_evidence)
    return {'schema': 'native-perf-package-qualification/v1', 'qualified': True,
        'os': 'ubuntu24.04', 'actualKernel': platform.release(), 'productionKernelQualified': False,
        'packageVersion': helper.VERSION, 'packages': rows, 'hwdataFreshInstallVerified': True,
        'profileProposal': proposal, 'normalAptHooksPreserved': True,
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
        outcome['sourceBindings'] = {name: sha((ROOT / name).read_bytes()) for name in (
            'scripts/ci/native-perf-install-controller.py', 'scripts/ci/native-perf-install-stage.py',
            'scripts/ci/native-perf-install-provider.py', 'scripts/ci/native-perf-install-profile.json',
            'scripts/ci/native-fault-observation.py', 'scripts/ci/native-perf-terminal-diagnostics.py',
            'tests/fixtures/engine-native-fault/qualify_perf_install.py',
            'tests/fixtures/engine-native-fault/qualify_perf_missing_archive.py',
            '.github/workflows/profile-engine-main-thread.yml')}
        if outcome.get('qualified') is True:
            outcome['profileProposal'].update(sourceBindings=outcome['sourceBindings'],
                qualificationFixtureSHA256=outcome['fixtureSHA256'], packagePlanSHA256=outcome['helperSHA256'])
            outcome['profileProposalSHA256'] = sha(json.dumps(outcome['profileProposal'], sort_keys=True, separators=(',', ':')).encode())
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(outcome, separators=(',', ':')))
    if not outcome['qualified']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
