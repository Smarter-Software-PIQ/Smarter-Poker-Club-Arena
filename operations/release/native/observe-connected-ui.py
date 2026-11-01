#!/usr/bin/env python3
"""Private same-job observations through the existing native fixture. No release."""
import importlib.util
import json
import os
from pathlib import Path
import re
import hashlib
import selectors
import subprocess
import shutil
import signal
import stat
import sys
import tarfile
import tempfile
import time
import uuid
import zipfile

SPEC = importlib.util.spec_from_file_location('component_native', Path(__file__).with_name('qualify-components.py'))
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)
require = native.require
REPO = native.REPO
CALLER = REPO + '/.github/workflows/schema-manifest-refresh.yml@refs/heads/main'
CAPTURE_FILES = {'schema.sql', 'candidate-fixture.json', 'schema-capture-manifest.json',
                 'production-catalogue.json', 'role-catalogue.json', 'composition-manifest.json'}
ROOT = '/run/club-arena-qualification'


def context(expected):
    require(not any(os.environ.get(key) for key in
            ('DATABASE_URL', 'SUPABASE_DB_PASSWORD', 'SUPABASE_SERVICE_ROLE_KEY')),
            'RELEASE_OBSERVATION_PRODUCTION_CREDENTIAL_REFUSED')
    require(os.environ.get('GITHUB_WORKFLOW_REF') == CALLER and
            os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and
            os.environ.get('GITHUB_REF') == 'refs/heads/main' and
            os.environ.get('GITHUB_REPOSITORY_ID') == str(native.REPOSITORY_ID) and
            os.environ.get('GITHUB_SHA') == expected and re.fullmatch('[0-9a-f]{40}', expected),
            'RELEASE_OBSERVATION_PROTECTED_CONTEXT_REQUIRED')
    native.validate_repository_identity(REPO, os.environ.get('GITHUB_REPOSITORY'),
                                        native.provider('/repos/' + REPO))
    run_id, attempt = os.environ.get('GITHUB_RUN_ID', ''), os.environ.get('GITHUB_RUN_ATTEMPT', '')
    require(re.fullmatch('[1-9][0-9]*', run_id) and re.fullmatch('[1-9][0-9]*', attempt))
    run = native.provider(f'/repos/{REPO}/actions/runs/{run_id}')
    require(str(run['id']) == run_id and str(run['run_attempt']) == attempt and
            run['repository']['id'] == native.REPOSITORY_ID and
            run['head_repository']['id'] == native.REPOSITORY_ID and
            run['head_sha'] == expected and run['head_branch'] == 'main' and
            run['event'] == 'workflow_dispatch' and run['status'] == 'in_progress' and
            run['path'] == '.github/workflows/schema-manifest-refresh.yml',
            'RELEASE_OBSERVATION_OWNING_RUN_REQUIRED')
    jobs = native.provider(f'/repos/{REPO}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    matches = [job for job in jobs['jobs'] if job['name'] == 'isolated-connected-ui / native-smoke'
               and job['status'] == 'in_progress']
    require(jobs['total_count'] == len(jobs['jobs']) and len(matches) == 1,
            'RELEASE_OBSERVATION_OWNING_JOB_REQUIRED')
    return {'repository_id': native.REPOSITORY_ID, 'repository': REPO, 'run_id': run_id,
            'run_attempt': int(attempt), 'job_id': str(matches[0]['id']),
            'caller_workflow_ref': CALLER, 'control_sha': expected}


def candidate_directory(path):
    base = Path(os.environ['RUNNER_TEMP']).resolve()
    require(base.is_dir() and path == base / 'isolated-schema-candidate' and not path.is_symlink())
    return path


def cleanup_private(path):
    path = candidate_directory(path)
    if path.exists():
        require(path.is_dir() and path.stat().st_uid == os.getuid())
        shutil.rmtree(path)
    require(not path.exists() and not path.is_symlink())
    output = path.parent / 'isolated-ui-evidence'
    output.mkdir(mode=0o700, exist_ok=True)
    (output / 'private-cleanup.json').write_text(native.canonical(
        {'version': 1, 'scope': 'private-schema-candidate-cleanup', 'complete': True,
         'candidate_absent': True, 'raw_schema_uploaded': False}))


def validate_capture(path, provenance):
    candidate_directory(path)
    require(path.is_dir() and path.stat().st_mode & 0o777 == 0o700)
    require({item.name for item in path.iterdir()} == CAPTURE_FILES)
    for item in path.iterdir():
        details = item.lstat()
        require(stat.S_ISREG(details.st_mode) and details.st_nlink == 1 and
                details.st_uid == os.getuid() and details.st_mode & 0o077 == 0 and
                0 < details.st_size <= (128 * 1024 * 1024 if item.name == 'schema.sql' else 32 * 1024 * 1024))
    manifest = json.loads((path / 'schema-capture-manifest.json').read_text())
    require(manifest['source_sha'] == provenance['control_sha'] and
            str(manifest['build_run_id']) == provenance['run_id'] and
            int(manifest['run_attempt']) == provenance['run_attempt'] and
            manifest['transaction'] == 'REPEATABLE READ READ ONLY' and
            manifest['private_same_job_only'] is True and manifest['public_artifact_permitted'] is False and
            manifest['current_database_contract_ready'] is False and manifest['production_writes'] is False)
    require(set(manifest['files']) == CAPTURE_FILES - {'schema-capture-manifest.json'})
    for name, item in manifest['files'].items():
        require((path / name).stat().st_size == item['bytes'] and
                native.file_digest(path / name) == item['sha256'])
    require(native.file_digest(path / 'schema.sql') == manifest['original_schema_sha256'])
    return manifest


BOOTSTRAP_LIMIT = 128 * 1024 * 1024
BOOTSTRAP_READER = """import {createHash} from 'node:crypto';
import {readFixtureBootstrapFile} from '/opt/qualification/runtime/service-preimage.mjs';
const bytes=await readFixtureBootstrapFile(process.argv[1]);
const header=Buffer.alloc(36);header.writeUInt32BE(bytes.length);createHash('sha256').update(bytes).digest().copy(header,4);
process.stdout.write(header);process.stdout.write(bytes);"""


def bounded_bootstrap_output(args, limit, deadline, *, diagnostics=False):
    # Owned foreground transport only. Never inherit credentials or print output.
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C.UTF-8',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_NO_REPLACE_OBJECTS': '1'}
    require(type(limit) is int and 0 < limit <= BOOTSTRAP_LIMIT + 36, 'RELEASE_OBSERVATION_BOOTSTRAP_OUTPUT_LIMIT')
    output = bytearray()
    process = None
    selector = selectors.DefaultSelector()
    try:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT if diagnostics else subprocess.DEVNULL, env=env, start_new_session=True)
        os.set_blocking(process.stdout.fileno(), False)
        selector.register(process.stdout, selectors.EVENT_READ)
        while selector.get_map():
            require(time.monotonic() < deadline, 'RELEASE_OBSERVATION_BOOTSTRAP_READ_DEADLINE')
            for key, _ in selector.select(min(1, max(0, deadline - time.monotonic()))):
                block = os.read(key.fd, min(65536, limit + 1 - len(output)))
                if not block:
                    selector.unregister(key.fileobj)
                    continue
                output.extend(block)
                require(len(output) <= limit, 'RELEASE_OBSERVATION_BOOTSTRAP_OUTPUT_LIMIT')
        code = process.wait(timeout=max(.001, deadline - time.monotonic()))
        require(code == 0, 'RELEASE_OBSERVATION_BOOTSTRAP_COMMAND_FAILED')
        return bytes(output)
    finally:
        selector.close()
        if process is not None:
            if process.poll() is None:
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                process.wait(timeout=5)
            if process.stdout is not None: process.stdout.close()
        output.clear()


def bootstrap_file_bytes(raw):
    require(36 < len(raw) <= BOOTSTRAP_LIMIT + 36, 'RELEASE_OBSERVATION_BOOTSTRAP_FILE_REQUIRED')
    length = int.from_bytes(raw[:4], 'big')
    require(0 < length <= BOOTSTRAP_LIMIT and len(raw) == length + 36 and
            hashlib.sha256(raw[36:]).digest() == raw[4:36], 'RELEASE_OBSERVATION_BOOTSTRAP_FILE_REQUIRED')
    return raw[36:]


def closed_bootstrap_diagnostics(owned_id, deadline):
    # Parse only existing closed fixture records from this verified owned child;
    # raw output stays bounded in memory and is never returned or persisted.
    spec = importlib.util.spec_from_file_location('bootstrap_diagnostics', Path(__file__).parent.parent / 'ci/fixture-smoke.py')
    diagnostics = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(diagnostics)
    raw = bounded_bootstrap_output(['docker', 'logs', '--tail', '64', owned_id], 65536,
        min(deadline, time.monotonic() + 5), diagnostics=True)
    return diagnostics.native_failures(raw.decode('utf-8', errors='replace'))


def private_bootstrap(runtime_image, controls, inputs, temp, mode, deadline, lifecycles=None):
    require(mode in ('schema-preimage', 'schema-preflight'))
    name = 'ca-schema-' + uuid.uuid4().hex
    require(not native.command(['docker', 'container', 'ls', '-aq', '--filter', 'name=^/' + name + '$']).stdout.strip(),
            'RELEASE_OBSERVATION_OWNED_NAME_OCCUPIED')
    owned_id = None
    lifecycle = {'mode': mode, 'created': False, 'normal_shutdown': False, 'container_absent': False,
                 'ready_seen': False, 'read_complete': False, 'acknowledged': False}
    phase, first_error = 'START', None
    if lifecycles is not None:
        lifecycles.append(lifecycle)
    owner_label = 'com.smarter-poker.isolated-schema-owner=' + name
    base = ['docker', 'run', '-d', '--name', name, '--label', owner_label, '--network=none', '--user', '1000:1000',
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=1024',
            '--memory=8g', '--cpus=2',
            '--tmpfs', '/tmp:rw,nosuid,size=2g,uid=1000,gid=1000,mode=1777',
            '--tmpfs', '/run:rw,nosuid,size=2g,uid=1000,gid=1000',
            '--tmpfs', '/var/lib/postgresql:rw,nosuid,size=4g,uid=1000,gid=1000',
            '--mount', f'type=bind,source={controls},target=/opt/qualification/controls,readonly']
    if inputs is not None:
        base += ['--mount', f'type=bind,source={inputs},target=/inputs,readonly']
    ready = 'service-preimage' if mode == 'schema-preimage' else 'schema-preflight'
    files = ['service-schema.sql'] if mode == 'schema-preimage' else ['schema-preflight.json']
    try:
        created = native.command(base + [runtime_image, native.FIXTURE_SERVER, mode] +
                       (['--schema=/inputs/schema.zip'] if inputs is not None else []))
        owned_id = created.stdout.decode().strip()
        require(re.fullmatch('[0-9a-f]{64}', owned_id))
        lifecycle.update(created=True, container_id=owned_id)
        phase = 'READY'
        while True:
            require(time.monotonic() < deadline, 'RELEASE_OBSERVATION_PREFLIGHT_DEADLINE')
            result = native.command(['docker', 'exec', name, 'node', '-e',
                "require('node:fs').accessSync('" + ROOT + '/' + ready + ".ready')"], check=False, timeout=5)
            if result.returncode == 0:
                lifecycle['ready_seen'] = True
                break
            info = json.loads(native.command(['docker', 'inspect', name]).stdout)[0]
            require(info['State']['Running'] is True, 'RELEASE_OBSERVATION_PREFLIGHT_FAILED')
            time.sleep(.2)
        phase = 'READ'
        kind = 'PREIMAGE' if mode == 'schema-preimage' else 'PREFLIGHT'
        raw = bounded_bootstrap_output(['docker', 'exec', name, 'node', '--input-type=module', '-e',
            BOOTSTRAP_READER, kind], BOOTSTRAP_LIMIT + 36, min(deadline, time.monotonic() + 300))
        body = bootstrap_file_bytes(raw)
        phase = 'COPY'
        target = temp / files[0]
        try:
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(body); stream.flush(); os.fsync(stream.fileno())
            require(target.is_file() and not target.is_symlink() and target.stat().st_size == len(body) and target.stat().st_nlink == 1 and
                    target.stat().st_uid == os.getuid() and target.stat().st_mode & 0o077 == 0 and
                    native.file_digest(target) == hashlib.sha256(body).hexdigest(),
                    'RELEASE_OBSERVATION_BOOTSTRAP_COPY_REQUIRED')
        except BaseException:
            # Remove only a file created by this invocation, never a collision.
            if 'fd' in locals(): target.unlink(missing_ok=True)
            raise
        lifecycle['read_complete'] = True
        phase = 'ACK'
        native.command(['docker', 'exec', name, 'node', '-e',
                        "require('node:fs').writeFileSync('" + ROOT + '/' + ready + ".copied','')"])
        lifecycle['acknowledged'] = True
        phase = 'WAIT'
        require(native.command(['docker', 'wait', name], timeout=40).stdout.strip() == b'0')
        lifecycle['normal_shutdown'] = True
    except BaseException as error:
        first_error = error
        lifecycle['failure'] = {'phase': phase}
        if owned_id:
            try:
                info = json.loads(native.command(['docker', 'inspect', owned_id]).stdout)[0]
                require(info['Id'] == owned_id and info['Name'] == '/' + name and
                        info['Config']['Labels'].get('com.smarter-poker.isolated-schema-owner') == name)
                state = info['State']
                if type(state.get('ExitCode')) is int and 0 <= state['ExitCode'] <= 255 and not state['Running']:
                    lifecycle['failure']['container_exit_code'] = state['ExitCode']
                lifecycle['failure']['native_failures'] = closed_bootstrap_diagnostics(owned_id, time.monotonic() + 5)
                if not lifecycle['failure']['native_failures']:
                    lifecycle['failure']['diagnostics_unavailable'] = True
            except BaseException:
                lifecycle['failure']['diagnostics_unavailable'] = True
        raise
    finally:
        try:
            # Recover an unknown docker-run acknowledgement only through our
            # previously absent exact name AND unique ownership label. Never remove
            # a preexisting resource merely because a requested name collided.
            if owned_id is None:
                ids = native.command(['docker', 'container', 'ls', '-aq', '--no-trunc',
                    '--filter', 'name=^/' + name + '$', '--filter', 'label=' + owner_label]).stdout.decode().split()
                require(len(ids) <= 1)
                owned_id = ids[0] if ids else None
            if owned_id:
                info = json.loads(native.command(['docker', 'inspect', owned_id]).stdout)[0]
                require(info['Id'] == owned_id and info['Name'] == '/' + name and
                        info['Config']['Labels'].get('com.smarter-poker.isolated-schema-owner') == name)
                lifecycle.update(created=True, container_id=owned_id)
                native.command(['docker', 'rm', '-f', owned_id], check=False, timeout=30)
                require(not native.command(['docker', 'container', 'ls', '-aq', '--filter', 'id=' + owned_id]).stdout.strip(),
                        'RELEASE_OBSERVATION_PREFLIGHT_CLEANUP_REQUIRED')
                lifecycle['container_absent'] = True
            else:
                lifecycle['container_absent'] = not native.command(['docker', 'container', 'ls', '-aq', '--filter', 'name=^/' + name + '$']).stdout.strip()
                require(lifecycle['container_absent'], 'RELEASE_OBSERVATION_PREFLIGHT_CLEANUP_REQUIRED')
        except BaseException:
            lifecycle['cleanup_failed'] = True
            if first_error is None:
                lifecycle.setdefault('failure', {'phase': 'CLEANUP'})
                raise


def validate_schema_preflight(preflight, capture):
    mapping = preflight.get('catalogue_restore_mapping')
    keys = {'version', 'rule', 'original_digest', 'restored_digest', 'columns_count',
            'public_columns_count', 'changed_rows_count', 'changed_rows_digest',
            'changed_rows_digest_encoding'}
    require(isinstance(mapping, dict) and set(mapping) == keys,
            'RELEASE_OBSERVATION_RESTORE_MAPPING_REQUIRED')
    require(type(mapping['version']) is int and mapping['version'] == 1 and mapping['rule'] == 'public-live-column-rank/v1' and
            mapping['changed_rows_digest_encoding'] == 'utf8-json-stringify-ordered-object-array/v1' and
            mapping['original_digest'] == capture['original_catalogue_digest'] and
            all(isinstance(mapping[key], str) and re.fullmatch('[0-9a-f]{64}', mapping[key])
                for key in ('original_digest', 'restored_digest', 'changed_rows_digest')) and
            all(type(mapping[key]) is int and mapping[key] >= 0
                for key in ('columns_count', 'public_columns_count', 'changed_rows_count')) and
            mapping['changed_rows_count'] <= mapping['public_columns_count'] <= mapping['columns_count'],
            'RELEASE_OBSERVATION_RESTORE_MAPPING_REQUIRED')
    require((mapping['changed_rows_count'] == 0) ==
            (mapping['restored_digest'] == mapping['original_digest']),
            'RELEASE_OBSERVATION_RESTORE_MAPPING_REQUIRED')
    if mapping['changed_rows_count'] == 0:
        require(mapping['changed_rows_digest'] == native.digest(b'[]'),
                'RELEASE_OBSERVATION_RESTORE_MAPPING_REQUIRED')
    require(preflight.get('success') is True and preflight.get('product_certificate') is False and
            preflight.get('original_catalogue_digest') == capture['original_catalogue_digest'] and
            preflight.get('catalogue_digest') == mapping['restored_digest'] and
            preflight.get('role_catalogue_equal') is True and
            preflight.get('effective_acl_catalogue_equal') is True and
            preflight.get('ordinary_auth', {}).get('postgrest_own_profile') is True and
            preflight.get('no_game_or_club_created') is True and
            preflight.get('current_database_contract_ready') is True,
            'RELEASE_OBSERVATION_FULL_PREFLIGHT_REQUIRED')
    return mapping['restored_digest'], mapping


def published_web_source(run, info, engine_sha):
    """Independent immutable web producer; the engine has its own protected SHA.
    Actual ancestry for BOTH is checked against this protected control below.
    """
    web_sha = run.get('head_sha')
    require(isinstance(engine_sha, str) and re.fullmatch('[0-9a-f]{40}', engine_sha) and
            isinstance(web_sha, str) and re.fullmatch('[0-9a-f]{40}', web_sha) and
            run['repository']['id'] == native.REPOSITORY_ID and
            run['head_repository']['id'] == native.REPOSITORY_ID and
            run['event'] == 'push' and run['head_branch'] == 'main' and
            run['conclusion'] == 'success' and
            run['path'] == '.github/workflows/publish-club-arena.yml' and
            info['name'] == 'club-arena-dist-' + web_sha)
    return web_sha


COMPOSITION_SITES = frozenset({
    'UNKNOWN', 'DUMP_BOUNDARIES', 'DUMP_HEADER', 'DUMP_NAME_SHAPE', 'DUMP_DUPLICATE_KEY',
    'SCHEMA_CREDENTIAL_PATTERN', 'SCHEMA_DENIED_TYPE', 'NATIVE_OBJECT_MISSING',
    'NATIVE_OWNER_DIFFERENT', 'NATIVE_BLOCK_DIFFERENT', 'APPLICATION_HOOK',
    'APPLICATION_HOOK_IN_NATIVE', 'MANAGED_OBJECT_MISSING', 'MANAGED_OWNER_DIFFERENT',
    'MANAGED_BLOCK_DIFFERENT', 'AUTH_HELPER_REQUIRED', 'CRON_CONTRACT_REQUIRED'})
COMPOSITION_PHASES = frozenset({'import', 'input-read', 'compose', 'sql-write', 'manifest-write', 'unknown'})
COMPOSITION_COMMAND = """
import {readFile,writeFile} from 'node:fs/promises';
const [modulePath,a,b,c,d,diagnostic]=process.argv.slice(1);
let phase='import', classify=()=> 'UNKNOWN';
try {
  const module=await import(modulePath); classify=module.schemaCompositionFailureSite;
  phase='input-read'; const capture=await readFile(a,'utf8'), service=await readFile(b,'utf8');
  phase='compose'; const r=module.composeSchema(capture,service);
  phase='sql-write'; await writeFile(c,r.sql,{flag:'wx',mode:0o600});
  phase='manifest-write'; await writeFile(d,JSON.stringify(r.manifest),{flag:'wx',mode:0o600});
} catch(error) {
  const site=phase==='compose' ? classify(error) : 'UNKNOWN';
  const value={version:1,scope:'exact-service-composition-failure',phase,site};
  try { await writeFile(diagnostic,JSON.stringify(value),{flag:'wx',mode:0o600}); } catch {}
  process.exitCode=1;
}
"""


def composition_failure(path):
    unknown = {'version': 1, 'scope': 'exact-service-composition-failure', 'phase': 'unknown', 'site': 'UNKNOWN'}
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and
                    before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == 0o600 and 0 < before.st_size <= 512)
            raw = os.read(fd, 513)
            after = os.fstat(fd)
            require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and len(raw) == before.st_size)
        finally:
            os.close(fd)
        def unique(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result)
                result[key] = value
            return result
        value = json.loads(raw, object_pairs_hook=unique)
        require(isinstance(value, dict) and set(value) == set(unknown) and type(value['version']) is int and
                value['version'] == 1 and value['scope'] == unknown['scope'] and
                isinstance(value['phase'], str) and value['phase'] in COMPOSITION_PHASES and
                isinstance(value['site'], str) and value['site'] in COMPOSITION_SITES and
                (value['phase'] == 'compose' or value['site'] == 'UNKNOWN'))
        return value
    except (OSError, ValueError, TypeError, RuntimeError):
        return unknown


def compose_private_schema(repo, candidate, temp, report):
    require(report.get('stage') == 'exact-service-composition', 'RELEASE_OBSERVATION_COMPOSITION_STAGE_REQUIRED')
    diagnostic = temp / 'composition-failure.json'
    result = native.command(['node', '--input-type=module', '-e', COMPOSITION_COMMAND,
        (repo / 'operations/release/fixture/schema-compose.mjs').as_uri(),
        str(candidate / 'schema.sql'), str(temp / 'service-schema.sql'),
        str(temp / 'composed.sql'), str(temp / 'composition-manifest.json'), str(diagnostic)], check=False)
    if result.returncode != 0:
        report['composition_failure'] = composition_failure(diagnostic)
    require(result.returncode == 0 and not diagnostic.exists(), 'RELEASE_SEMANTIC_NATIVE_EXECUTION_FAILED')


def write_schema_zip(path, sql, template):
    with zipfile.ZipFile(path, 'x') as archive:
        archive.writestr('schema.sql', sql)
        archive.writestr('fixture.json', native.canonical(template))


def observe(repo, output, expected, runtime_image, smoke_receipt, *, work_deadline):
    # All phases are foreground and bounded. Cleanup is outside the work budget.
    started = time.monotonic()
    deadline = work_deadline
    require(started + 2900 < deadline, 'RELEASE_OBSERVATION_TOTAL_BUDGET_REQUIRED')
    provenance = context(expected)
    require(native.command(['git', '-C', str(repo), 'rev-parse', 'HEAD']).stdout.decode().strip() == expected)
    native.command(['git', '-C', str(repo), 'diff', '--exit-code', 'HEAD'])
    provenance['control_tree'] = native.command(['git', '-C', str(repo), 'rev-parse', 'HEAD^{tree}']).stdout.decode().strip()
    controls_closure = ['operations/release/ci/fixture-smoke.py',
        'operations/release/fixture/schema-snapshot.mjs',
        'operations/release/fixture/schema-native-dump-diagnostic.mjs',
        'operations/release/fixture/native-dump-diagnostic.py',
        'operations/release/fixture/native-dump-diagnostic.c',
        'scripts/ci/certificates/supabase-prod-ca-2021.crt',
        'operations/release/fixture/schema-compose.mjs', 'operations/release/fixture/schema-application-hooks.mjs',
        'operations/release/fixture/current-application-roles.mjs',
        'operations/release/fixture/schema-catalogue-restore-map.mjs',
        'operations/release/native/schema-preflight.mjs',
        'operations/release/native/component-semantic-observations.mjs',
        'operations/release/native/qualify-components.py',
        'operations/release/native/tournament-player-ui-suite.mjs',
        'operations/release/native/rit-player-ui-suite.mjs']
    native.command(['git', '-C', str(repo), 'ls-files', '--error-unmatch', *controls_closure])
    require(all((repo / name).is_file() and not (repo / name).is_symlink() for name in controls_closure))
    provenance['controls_source_sha256'] = {name: native.file_digest(repo / name) for name in controls_closure}
    provenance['runtime_source_manifest_sha256'] = native.fact_digest(smoke_receipt['source_sha256'])
    candidate = candidate_directory(Path(os.environ['RUNNER_TEMP']).resolve() / 'isolated-schema-candidate')
    capture = validate_capture(candidate, provenance)
    report = {'version': 1, 'scope': 'isolated-connected-ui-observations', 'product_certificate': False,
              'success': False, 'executed': 0, 'failed': 0, 'skipped': 0, 'retries': 0,
              'provenance': provenance, 'runtime_image': runtime_image,
              'schema_original_sha256': capture['original_schema_sha256'],
              'original_catalogue_digest': capture['original_catalogue_digest'],
              'stage': 'genuine-service-preimage', 'cleanup': {'complete': False}, 'scenes': [], 'preflight_lifecycles': []}
    engine_tag = 'club-arena-isolated-engine:' + uuid.uuid4().hex
    engine_image = None
    engine_build_armed = False
    cases_complete = False
    cleanup = {'version': 1, 'fixtures': [], 'complete': False, 'images_removed': False}
    # A one-shot foreground work deadline leaves the enclosing job's cleanup
    # reserve. It never starts, retries or advances a release or another scene.
    require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0))
    previous_handler = signal.getsignal(signal.SIGALRM)
    def expired(signum, frame):
        raise TimeoutError('RELEASE_OBSERVATION_WORK_DEADLINE')
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, max(.001, deadline - time.monotonic()))
    try:
        with tempfile.TemporaryDirectory(prefix='isolated-ui-', dir=os.environ['RUNNER_TEMP']) as temp_name:
            temp = Path(temp_name)
            private_bootstrap(runtime_image, repo, None, temp, 'schema-preimage', min(deadline, time.monotonic() + 300), report['preflight_lifecycles'])
            report['stage'] = 'exact-service-composition'
            compose_private_schema(repo, candidate, temp, report)
            inputs = temp / 'inputs'
            inputs.mkdir(mode=0o755)
            template = json.loads((candidate / 'candidate-fixture.json').read_text())
            write_schema_zip(inputs / 'schema.zip', (temp / 'composed.sql').read_bytes(), template)
            for file in ('production-catalogue.json', 'role-catalogue.json'):
                shutil.copyfile(candidate / file, inputs / file)
            (inputs / 'observation-control.json').write_text(native.canonical({'version': 1, 'control_sha': expected}))
            for file in inputs.iterdir():
                file.chmod(0o444)
            report['stage'] = 'full-schema-native-preflight'
            private_bootstrap(runtime_image, repo, inputs, temp, 'schema-preflight', min(deadline, time.monotonic() + 400), report['preflight_lifecycles'])
            preflight = json.loads((temp / 'schema-preflight.json').read_text())
            restored_digest, restore_mapping = validate_schema_preflight(preflight, capture)
            report['catalogue_restore_mapping'] = restore_mapping
            report['expected_restored_catalogue_digest'] = restored_digest
            (output / 'schema-preflight-receipt.json').write_text(native.canonical(preflight))
            # Readiness is now derived from actual full restore/parity and real
            # ordinary Auth facts, never from capture flags or smoke success.
            template['source_contract'].update(current_database_contract_ready=True, exclusions=[])
            (inputs / 'schema.zip').unlink()
            write_schema_zip(inputs / 'schema.zip', (temp / 'composed.sql').read_bytes(), template)
            report['stage'] = 'immutable-web-and-source-engine'
            web_run = os.environ['FIXTURE_WEB_ARTIFACT_RUN_ID']
            web_id = os.environ['FIXTURE_WEB_ARTIFACT_ID']
            require(re.fullmatch('[1-9][0-9]*', web_run) and re.fullmatch('[1-9][0-9]*', web_id))
            info = native.provider(f'/repos/{REPO}/actions/artifacts/{web_id}')
            run = native.provider(f'/repos/{REPO}/actions/runs/{web_run}')
            engine_sha = os.environ['FIXTURE_ENGINE_SOURCE_SHA']
            web_sha = published_web_source(run, info, engine_sha)
            web = {'source_sha': web_sha, 'artifact_id': web_id, 'build_run_id': web_run,
                   'archive_digest': info['digest']}
            archive = temp / 'original-web.zip'
            native.download_artifact(web, archive)
            with zipfile.ZipFile(archive) as files:
                web['manifest_digest'] = native.digest(files.read('.release-manifest.sha256'))
                web['identity'] = 'sha256:' + web['manifest_digest']
            native.validate_web(archive, web, template['supabase_host'])
            native.command(['git', '-C', str(repo), 'merge-base', '--is-ancestor', engine_sha, expected])
            native.command(['git', '-C', str(repo), 'merge-base', '--is-ancestor', web_sha, expected])
            context_tar = temp / 'engine-source.tar'
            context_paths = ['server/Dockerfile', 'server/package.json', 'server/package-lock.json',
                'server/tsconfig.json', 'server/tsconfig.runtime.json', 'server/tsconfig.emit.json',
                'server/src', 'server/native/public_hist215_wtl.cc',
                'server/scripts/build-public-hist215-native.mjs', 'server/release-evidence']
            native.command(['git', '-C', str(repo), 'archive', '--format=tar', '--output=' + str(context_tar),
                            engine_sha, *context_paths])
            with tarfile.open(context_tar) as files:
                require(all((member.isfile() or member.isdir()) and not member.name.startswith('/') and
                            '..' not in Path(member.name).parts and '.env' not in Path(member.name).name
                            for member in files.getmembers()))
                files.extractall(temp / 'engine-source', filter='data')
            source = temp / 'engine-source' / 'server'
            require('ENV ENGINE_ALERT_JOURNAL_DIR=/var/lib/club-arena/engine-alerts' in (source / 'Dockerfile').read_text())
            require(time.monotonic() + 2200 < deadline, 'RELEASE_OBSERVATION_BUILD_BUDGET_REQUIRED')
            require(not native.command(['docker', 'image', 'ls', '-q', '--no-trunc', engine_tag]).stdout.strip(),
                    'RELEASE_OBSERVATION_ENGINE_TAG_OCCUPIED')
            engine_build_armed = True
            native.command(['docker', 'build', '--platform=linux/amd64',
                            '--label', 'com.smarter-poker.isolated-engine-owner=' + engine_tag,
                            '--build-arg', 'GIT_COMMIT_SHA=' + engine_sha,
                            '--tag', engine_tag, str(source)], timeout=900)
            image = json.loads(native.command(['docker', 'image', 'inspect', engine_tag]).stdout)[0]
            engine_image = image['Id']
            require(image['Os'] == 'linux' and image['Architecture'] == 'amd64' and
                    re.fullmatch('sha256:[0-9a-f]{64}', engine_image) and
                    image['Config']['Labels']['org.opencontainers.image.revision'] == engine_sha and
                    image['Config']['Labels'].get('com.smarter-poker.isolated-engine-owner') == engine_tag)
            tuple_value = {'club-arena-engine': {'source_sha': engine_sha, 'identity': engine_image},
                           'club-arena-web': {key: web[key] for key in ('source_sha', 'identity', 'manifest_digest')}}
            schema = {'fixture_sha256': native.file_digest(temp / 'composed.sql'),
                      'catalogue_digest': restored_digest}
            plan = {'tuples': [tuple_value], 'schema': schema}
            web_key = native.fact_digest({'target': 'club-arena-web', **tuple_value['club-arena-web']})
            shutil.copyfile(archive, inputs / (web_key + '.zip'))
            (inputs / 'plan.json').write_text(native.canonical(plan))
            for file in inputs.iterdir(): file.chmod(0o444)
            report.update({'tuple': tuple_value, 'schema': schema, 'web_provenance': web,
                           'engine_source_archive_sha256': native.file_digest(context_tar),
                           'composition_manifest_sha256': native.file_digest(temp / 'composition-manifest.json')})
            require(time.monotonic() + 1300 < deadline, 'RELEASE_OBSERVATION_BOTH_SCENES_BUDGET_REQUIRED')
            for index, mode in enumerate(('tournament-player-ui', 'rit-player-ui')):
                require(time.monotonic() + 600 < deadline, 'RELEASE_OBSERVATION_SCENE_BUDGET_REQUIRED')
                report['stage'] = mode
                result = native.execute_combination(index=0, tuple_value=tuple_value, plan=plan, scenario=mode,
                    operation=str(uuid.uuid4()), temp=inputs, controls=repo, runtime_image=runtime_image,
                    supabase_host=template['supabase_host'], cleanup_report=cleanup, output=output)
                report['scenes'].append({'mode': mode, 'native': result, 'cleanup': cleanup['fixtures'][-1]})
                report['executed'] += result['executed']
            require(report['executed'] == 15 and len(report['scenes']) == 2)
            cases_complete = True
            report['stage'] = 'outer-runtime-cleanup'
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        errors = []
        try:
            if engine_build_armed:
                ids = native.command(['docker', 'image', 'ls', '-q', '--no-trunc', engine_tag]).stdout.decode().split()
                if ids:
                    require(len(set(ids)) == 1)
                    actual = json.loads(native.command(['docker', 'image', 'inspect', engine_tag]).stdout)[0]
                    require(actual['Config']['Labels'].get('com.smarter-poker.isolated-engine-owner') == engine_tag)
                    native.command(['docker', 'image', 'rm', engine_tag], check=False, timeout=30)
                require(not native.command(['docker', 'image', 'ls', '-q', '--no-trunc', engine_tag]).stdout.strip())
                if engine_image:
                    require(engine_image not in native.command(['docker', 'image', 'ls', '-aq', '--no-trunc']).stdout.decode().split())
        except Exception:
            errors.append('engine-image')
        try:
            cleanup_private(candidate)
        except Exception:
            errors.append('private-candidate')
        cleanup.update(complete=not errors and all(item['complete'] for item in cleanup['fixtures']) and
                       all(item['container_absent'] is True for item in report['preflight_lifecycles']),
                       images_removed='engine-image' not in errors, runtime_image_removed=False)
        report['cleanup'] = cleanup
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        if errors:
            report['stage'] = 'cleanup-failed'
        # Never child errors, raw SQL/catalogues, sessions or provider URLs.
        (output / 'connected-ui-observations.json').write_text(native.canonical(report))
        require(not errors, 'RELEASE_OBSERVATION_CLEANUP_REQUIRED')
    return {'report': report, 'cases_complete': cases_complete}



if __name__ == '__main__':
    try:
        require(len(sys.argv) == 3 and sys.argv[1] == '--cleanup-private')
        cleanup_private(Path(sys.argv[2]))
    except Exception:
        print('RELEASE_OBSERVATION_PRIVATE_CLEANUP_FAILED', file=sys.stderr)
        sys.exit(1)
