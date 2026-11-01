#!/usr/bin/env python3
"""Build and qualify exact-source native logging and function transport batching.

No database configuration is accepted. The only database this builder opens is
its newly created disposable Unix-only cluster, before the capture secret exists.
All command output and synthetic schema bytes remain private and are removed.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time

VERSION = '17.11'
ARCHIVE_SHA = '5367f6fb2ec97efe1eb2e0c7926bb33438e51b0bd3a9733b88498056a7dc9a7e'
ARCHIVE_URL = 'https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.gz'
PREFIX = 'postgresql-17.11/'
BUILD_STAGE = 'INPUT'
FIRST_FAILURE_STAGE = None
FIRST_COMMAND_FAILURE = None
STAGES = {'INPUT','DOWNLOAD','SOURCE_GUARDS','CONFIGURE','GENERATED_HEADERS','STOCK_BUILD','LIBPQ_INSTALL',
          'DIAGNOSTIC_BUILD','VERSION','SYNTHETIC_RUNTIME','SYNTHETIC_CLUSTER','SYNTHETIC_SEED',
          'SYNTHETIC_STOCK','SYNTHETIC_DIAGNOSTIC','SQL_EQUIVALENCE','SYNTHETIC_CLEANUP','OUTPUT','CLEANUP'}


class DiagnosticFailure(RuntimeError):
    def __init__(self):
        super().__init__('ISOLATED_DUMP_DIAGNOSTIC_REFUSED')
        self.stage = BUILD_STAGE if BUILD_STAGE in STAGES else 'UNKNOWN'

SOURCE_HASHES = {
    'src/bin/pg_dump/pg_dump.c': '8576b36741608e0a956b51e98e1b41b76877a95eb9091300b66c2eaa0faf78f8',
    'src/bin/pg_dump/pg_backup_db.c': 'de1f74446644029acef871ec5ef114793bbc3127de65815e3790f1f4072b839a',
    'src/bin/pg_dump/pg_backup_db.h': 'e76710ce71cc5fa8ef6599cfc44d4c740e187c5f4b8d94a7aa08dd4058426049',
}
DECLARATIONS = '''\n/* Fixed private diagnostic channel; logging only. */
extern void ca_diag_init(void);
extern void ca_diag_object_begin(int group);
extern void ca_diag_object_end(void);
extern void ca_diag_query_begin(void);
extern void ca_diag_query_end(void);
'''
OBJECT_LOOP = '''\tfor (i = 0; i < numObjs; i++)
\t\tdumpDumpableObject(fout, dobjs[i]);'''
DIAG_LOOP = '''\tca_batch_objects = dobjs;
\tca_batch_objects_count = numObjs;
\tfor (i = 0; i < numObjs; i++)
\t{
\t\tint ca_group = 4;
\t\tca_batch_position = i;
\t\t/* Skipped components issue no query and have no object-cost frame. */
\t\tif ((dobjs[i]->dump & dobjs[i]->components) == 0)
\t\t{
\t\t\tdumpDumpableObject(fout, dobjs[i]);
\t\t\tcontinue;
\t\t}
\t\tswitch (dobjs[i]->objType)
\t\t{
\t\t\tcase DO_FUNC: case DO_AGG: ca_group = 1; break;
\t\t\tcase DO_TABLE: case DO_INDEX: case DO_CONSTRAINT: ca_group = 2; break;
\t\t\tcase DO_TYPE: case DO_SHELL_TYPE: ca_group = 3; break;
\t\t\tdefault: break;
\t\t}
\t\tca_diag_object_begin(ca_group);
\t\tdumpDumpableObject(fout, dobjs[i]);
\t\tca_diag_object_end();
\t}'''


def require(value):
    if not value:
        raise DiagnosticFailure()


def retain_first_failure(error):
    global FIRST_FAILURE_STAGE
    if FIRST_FAILURE_STAGE is None:
        stage = error.stage if isinstance(error, DiagnosticFailure) else BUILD_STAGE
        FIRST_FAILURE_STAGE = stage if stage in STAGES else 'UNKNOWN'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def transformations():
    return {
        'src/bin/pg_dump/pg_dump.c': [
            ('\tConnectDatabase(fout, &dopt.cparams, false);',
             '\tca_diag_init();\n\tConnectDatabase(fout, &dopt.cparams, false);'),
            (OBJECT_LOOP, DIAG_LOOP),
            ('static void help(const char *progname);',
             '#include "native-dump-function-batch.c"\n\nstatic void help(const char *progname);'),
            ('\tres = ExecuteSqlQueryForSingleRow(fout, query->data);\n\n\tproretset =',
             '\tres = ca_function_batch_result(fout, finfo);\n\n\tproretset ='),
        ],
        'src/bin/pg_dump/pg_backup_db.c': [
            ('static void\nnotice_processor(void *arg, const char *message)',
             '#include "native-dump-diagnostic.c"\n\nstatic void\nnotice_processor(void *arg, const char *message)'),
            ('\tres = PQexec(AH->connection, query);',
             '\tca_diag_query_begin();\n\tres = PQexec(AH->connection, query);\n\tca_diag_query_end();'),
        ],
        'src/bin/pg_dump/pg_backup_db.h': [
            ('#endif\n',
             DECLARATIONS + '\n#endif\n'),
        ],
    }


def patch_files(originals):
    patched = {}
    for name, original in originals.items():
        require(digest(original) == SOURCE_HASHES[name])
        text = original.decode('utf-8')
        for old, new in transformations()[name]:
            expected = 2 if old == '\tres = PQexec(AH->connection, query);' else 1
            require(text.count(old) == expected and new not in text)
            text = text.replace(old, new)
        restored = text
        for old, new in reversed(transformations()[name]):
            restored = restored.replace(new, old)
        # Exact inverse includes every original SQL and control-flow byte.
        require(restored.encode('utf-8') == original)
        patched[name] = text.encode('utf-8')
    return patched


def valid_source_member(member):
    if Path(member.name).is_absolute() or '..' in Path(member.name).parts:
        return False
    if member.name == PREFIX.rstrip('/'):
        return member.isdir()
    return member.name.startswith(PREFIX) and (member.isfile() or member.isdir() or member.issym())


def archive_sources(archive):
    require(digest(archive.read_bytes()) == ARCHIVE_SHA)
    with tarfile.open(archive, 'r:gz') as files:
        return {name: files.extractfile(PREFIX + name).read() for name in SOURCE_HASHES}


def self_test(archive):
    global BUILD_STAGE, FIRST_FAILURE_STAGE
    originals = archive_sources(archive)
    with tarfile.open(archive, 'r:gz') as files:
        require(all(valid_source_member(member) for member in files.getmembers()))
    root = tarfile.TarInfo(PREFIX.rstrip('/')); root.type = tarfile.DIRTYPE
    require(valid_source_member(root))
    for name in [PREFIX.rstrip('/'), PREFIX + '../outside', '/'+PREFIX+'outside', PREFIX.rstrip('/')+'-other/file']:
        require(not valid_source_member(tarfile.TarInfo(name)))
    patched = patch_files(originals)
    require(set(patched) == set(SOURCE_HASHES))
    for name in originals:
        changed = {**originals, name: originals[name] + b'\n'}
        try:
            patch_files(changed)
        except RuntimeError:
            pass
        else:
            require(False)
    require(all(b'PQexec(AH->connection, query)' in patched[name]
                for name in ['src/bin/pg_dump/pg_backup_db.c']))
    good = b'D1 1 O B FUNCTION 0\nD1 2 Q B FUNCTION 1\nD1 3 Q E FUNCTION 2\nD1 4 O E FUNCTION 3\n'
    require(validate_frames(good) == 4)
    for bad in [good.replace(b'D1 2', b'D1 9'), good.replace(b'Q E FUNCTION', b'Q E TYPE'),
                good.replace(b'FUNCTION 2', b'FUNCTION 0'), good + b'private-secret\n', good[:-1],
                good.replace(b'FUNCTION 3', b'FUNCTION 45000001')]:
        try:
            validate_frames(bad)
        except RuntimeError:
            pass
        else:
            require(False)
    closed_peer_handoff_check()
    foreign_cleanup_check(archive.parent)
    saved = BUILD_STAGE, FIRST_FAILURE_STAGE
    try:
        BUILD_STAGE, FIRST_FAILURE_STAGE = 'CONFIGURE', None
        retain_first_failure(RuntimeError())
        BUILD_STAGE = 'CLEANUP'
        retain_first_failure(RuntimeError())
        require(FIRST_FAILURE_STAGE == 'CONFIGURE')
    finally:
        BUILD_STAGE, FIRST_FAILURE_STAGE = saved
    return {'source_inverse_exact': True, 'changed_source_refused': True,
            'fixed_frame_boundaries_refuse': True, 'closed_peer_fd3_handoff': True, 'first_failure_stage_preserved': True, 'foreign_operation_preserved': True, 'actual_archive_members_validated': True, 'archive_member_boundaries_refuse': True}


def command(args, *, cwd, env, timeout=120, data=None):
    # Stream finite private build output: never inherit or publish raw logs.
    output, errors = bytearray(), bytearray()
    selector = selectors.DefaultSelector()
    proc = None
    failure_kind = 'SPAWN'
    try:
        with tempfile.TemporaryFile(dir=cwd) as incoming:
            if data is not None: incoming.write(data)
            incoming.seek(0)
            proc = subprocess.Popen(args, cwd=cwd, env=env, stdin=incoming,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    start_new_session=True)
            for source, target in [(proc.stdout, output), (proc.stderr, errors)]:
                os.set_blocking(source.fileno(), False)
                selector.register(source, selectors.EVENT_READ, target)
            failure_kind = 'DEADLINE'
            until = time.monotonic() + timeout
            while selector.get_map():
                require(time.monotonic() < until)
                for key, _ in selector.select(min(1, max(0, until - time.monotonic()))):
                    block = os.read(key.fd, 65536)
                    if not block:
                        selector.unregister(key.fileobj)
                        continue
                    key.data.extend(block)
                    if len(output) > 8 * 1024 * 1024 or len(errors) > 8 * 1024 * 1024:
                        failure_kind = 'OUTPUT_LIMIT'
                        require(False)
            code = proc.wait(timeout=max(0.1, until - time.monotonic()))
            failure_kind = 'EXIT_NONZERO'
            require(code == 0)
            return bytes(output)
    except Exception:
        global FIRST_COMMAND_FAILURE
        if FIRST_COMMAND_FAILURE is None:
            code = proc.poll() if proc is not None else None
            FIRST_COMMAND_FAILURE = {'kind': failure_kind,
                'exit_code': code if type(code) is int and 0 <= code <= 255 else None,
                'stdout_bytes': min(len(output), 8 * 1024 * 1024 + 65536),
                'stderr_bytes': min(len(errors), 8 * 1024 * 1024 + 65536)}
        raise
    finally:
        selector.close()
        if proc is not None and proc.poll() is None:
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            proc.wait(timeout=5)
        output.clear()
        errors.clear()


def clean_env(root):
    return {'PATH': os.environ['PATH'], 'HOME': str(root / 'home'),
            'TMPDIR': str(root / 'tmp'), 'npm_config_cache': str(root / 'cache'),
            'LANG': 'C', 'LC_ALL': 'C'}


def normalize_sql(value):
    matches = re.findall(rb'^\\restrict ([A-Za-z0-9]{1,128})$', value, re.MULTILINE)
    require(len(matches) == 1)
    token = matches[0]
    require(value.count(b'\\restrict ' + token + b'\n') == 1 and
            value.count(b'\\unrestrict ' + token + b'\n') == 1)
    return value.replace(b'\\restrict ' + token + b'\n', b'\\restrict NONCE\n').replace(
        b'\\unrestrict ' + token + b'\n', b'\\unrestrict NONCE\n')


def validate_frames(data):
    require(0 < len(data) <= 512 * 1024 and data.endswith(b'\n'))
    previous = 0
    sequence = 0
    obj = None
    query = None
    query_count = 0
    for line in data.splitlines():
        require(len(line) < 96)
        match = re.fullmatch(rb'D1 ([1-9][0-9]{0,5}) ([OQ]) ([BE]) (FUNCTION|RELATION|TYPE|OTHER) (0|[1-9][0-9]{0,7})', line)
        require(match is not None)
        seq, level, boundary, group, elapsed = match.groups()
        seq, elapsed = int(seq), int(elapsed)
        require(seq == sequence + 1 and seq <= 100000 and previous <= elapsed <= 45000000)
        sequence, previous = seq, elapsed
        if level == b'O':
            require(query is None)
            if boundary == b'B':
                require(obj is None)
                obj = group
            else:
                require(obj == group)
                obj = None
        elif boundary == b'B':
            require(obj == group and query is None)
            query = group
        else:
            require(obj == group and query == group)
            query = None
            query_count += 1
    require(obj is None and query is None and query_count > 0)
    return sequence


def diagnostic_dump(executable, args, env, cwd):
    parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    selector = selectors.DefaultSelector()
    proc = None
    output = bytearray()
    errors = bytearray()
    frames = bytearray()
    try:
        # fd3 is an explicit Unix socket and is inherited only by this child.
        def fd3():
            os.dup2(child.fileno(), 3)
        proc = subprocess.Popen([str(executable), *args], cwd=cwd, env=env,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, pass_fds=tuple(sorted({3, child.fileno()})),
                                preexec_fn=fd3)
        child.close()
        for source, target in [(proc.stdout, output), (proc.stderr, errors), (parent, frames)]:
            source.setblocking(False) if isinstance(source, socket.socket) else os.set_blocking(source.fileno(), False)
            selector.register(source, selectors.EVENT_READ, target)
        until = time.monotonic() + 45
        while selector.get_map():
            require(time.monotonic() < until)
            for key, _ in selector.select(min(1, max(0, until - time.monotonic()))):
                data = os.read(key.fd, 65536)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                key.data.extend(data)
                require(len(output) <= 8 * 1024 * 1024 and len(errors) <= 65536 and len(frames) <= 512 * 1024)
        require(proc.wait(timeout=2) == 0)
        return bytes(output), validate_frames(bytes(frames))
    finally:
        selector.close()
        child.close()
        parent.close()
        if proc is not None and proc.poll() is None:
            try: proc.kill()
            except ProcessLookupError: pass
            proc.wait(timeout=5)
        output.clear()
        errors.clear()
        frames.clear()


def reserve_fd3(child_fd):
    try:
        os.fstat(3)
        return False
    except OSError:
        os.dup2(child_fd, 3)
        return True


def closed_peer_handoff_check():
    parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    parent.close()
    reserved_fd3 = reserve_fd3(child.fileno())
    try:
        result = subprocess.run([sys.executable, '-c',
            'import socket; s=socket.socket(fileno=3); assert s.family==socket.AF_UNIX; print("FD3_OK")'],
            env={'PATH':os.environ['PATH']}, capture_output=True, timeout=5,
            pass_fds=tuple(sorted({3, child.fileno()})),
            preexec_fn=lambda: os.dup2(child.fileno(), 3))
        require(result.returncode == 0 and result.stdout == b'FD3_OK\n' and result.stderr == b'')
    finally:
        child.close()
        if reserved_fd3: os.close(3)


def negative_native_fd(executable, args, env, cwd):
    # Both failures are owned synthetic invocations, not production probes.
    result = subprocess.run([str(executable), *args], cwd=cwd, env=env,
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=5, close_fds=True)
    require(result.returncode != 0 and result.stdout == b'' and len(result.stderr) < 1024 and
            b'ISOLATED_DUMP_DIAGNOSTIC_FD' in result.stderr)
    with tempfile.TemporaryFile(dir=cwd) as wrong_kind:
        def bad_fd3(): os.dup2(wrong_kind.fileno(), 3)
        result = subprocess.run([str(executable), *args], cwd=cwd, env=env,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=5,
                                pass_fds=tuple(sorted({3, wrong_kind.fileno()})), preexec_fn=bad_fd3)
        require(result.returncode != 0 and result.stdout == b'' and len(result.stderr) < 1024 and
                b'ISOLATED_DUMP_DIAGNOSTIC_FD' in result.stderr)
    parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    parent.close()
    # Popen validates pass_fds before preexec. Keep an owned fd3 valid even
    # when closing the peer happened to free descriptor3 in this process.
    reserved_fd3 = reserve_fd3(child.fileno())
    try:
        def fd3(): os.dup2(child.fileno(), 3)
        result = subprocess.run([str(executable), *args], cwd=cwd, env=env,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=5,
                                pass_fds=tuple(sorted({3, child.fileno()})), preexec_fn=fd3)
        require(result.returncode != 0 and result.stdout == b'' and len(result.stderr) < 65536 and
                b'ISOLATED_DUMP_DIAGNOSTIC_WRITE' in result.stderr)
    finally:
        child.close()
        if reserved_fd3: os.close(3)


def qualify_batch_contract(repo, work, env):
    # Native isolated result-contract faults, not a database or production probe.
    directory = work / 'batch-contract'
    directory.mkdir()
    for name in ['native-dump-function-batch.c', 'native-dump-function-batch-test.c']:
        shutil.copyfile(repo / 'operations/release/fixture' / name, directory / name)
    executable = directory / 'contract'
    command(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror',
             'native-dump-function-batch-test.c', '-o', str(executable)], cwd=directory, env=env)
    for count in [0, 1, 127, 128, 129, 5507]:
        command([str(executable), 'valid', str(count)], cwd=directory, env=env, timeout=5)
    for mode in ['send', 'extra', 'missing', 'status', 'rows', 'fields', 'name', 'bytes', 'order']:
        result = subprocess.run([str(executable), mode, '129'], cwd=directory, env=env,
                                capture_output=True, timeout=5)
        require(result.returncode == 23 and result.stdout == b'' and result.stderr == b'')
    process = subprocess.Popen([str(executable), 'interrupt', '129'], cwd=directory,
                               env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdout, selectors.EVENT_READ)
            require(ready.select(timeout=5))
            require(os.read(process.stdout.fileno(), 5) == b'WAIT\n')
        process.send_signal(signal.SIGINT)
        stdout, stderr = process.communicate(timeout=5)
        require(process.returncode == -signal.SIGINT and stdout == b'' and stderr == b'')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
    shutil.rmtree(directory)
    return True


def qualify(repo, work, output, env, stock_executable):
    global BUILD_STAGE
    BUILD_STAGE = 'SYNTHETIC_RUNTIME'
    require(qualify_batch_contract(repo, work, env))
    runtime = work / 'runtime'
    runtime.mkdir()
    existing = repo / 'scripts/ci/probes/chip-journal-atomicity/postgres-runtime'
    for file in ['package.json', 'package-lock.json', 'query.mjs']:
        shutil.copyfile(existing / file, runtime / file)
    command(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=runtime, env=env, timeout=180)
    package = runtime / 'node_modules/@embedded-postgres/linux-x64'
    command(['node', 'scripts/hydrate-symlinks.js'], cwd=package, env=env)
    pg = package / 'native/bin'
    lib_env = {**env, 'LD_LIBRARY_PATH': str(package / 'native/lib')}
    data = work / 'data'
    unix = work / 'socket'
    unix.mkdir(mode=0o700)
    started = False
    try:
        BUILD_STAGE = 'SYNTHETIC_CLUSTER'
        command([str(pg / 'initdb'), '-D', str(data), '-U', 'diagnostic_test', '-A', 'trust', '--no-locale', '-E', 'UTF8'], cwd=work, env=lib_env)
        started = True
        command([str(pg / 'pg_ctl'), '-D', str(data), '-l', str(work / 'postgres.log'), '-o',
                 "-h '' -k '" + str(unix) + "' -p 55449", '-w', 'start'], cwd=work, env=lib_env)
        local = {**lib_env, 'PGHOST': str(unix), 'PGPORT': '55449', 'PGUSER': 'diagnostic_test', 'PGDATABASE': 'postgres'}
        sql = ("CREATE ROLE diagnostic_reader; CREATE SCHEMA diagnostic_schema; "
               "CREATE TABLE diagnostic_schema.sample(id integer PRIMARY KEY, label text); "
               "GRANT USAGE ON SCHEMA diagnostic_schema TO diagnostic_reader; "
               "GRANT SELECT(id) ON diagnostic_schema.sample TO diagnostic_reader; "
               "ALTER DEFAULT PRIVILEGES IN SCHEMA diagnostic_schema GRANT SELECT ON TABLES TO diagnostic_reader;\n")
        sql += '\n'.join(f'CREATE FUNCTION diagnostic_schema.f_{i}() RETURNS integer LANGUAGE sql AS $$SELECT {i}$$;' for i in range(5500))
        sql += """
CREATE FUNCTION diagnostic_schema.f_default(a integer DEFAULT 7) RETURNS integer LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path TO pg_catalog AS $$SELECT a$$;
CREATE FUNCTION diagnostic_schema.f_default(a text) RETURNS text LANGUAGE plpgsql AS $$BEGIN RETURN a; END$$;
CREATE FUNCTION diagnostic_schema.f_out(IN a integer, OUT b integer) LANGUAGE sql AS $$SELECT a$$;
CREATE FUNCTION diagnostic_schema.f_variadic(VARIADIC a integer[]) RETURNS integer LANGUAGE sql AS $$SELECT cardinality(a)$$;
CREATE FUNCTION diagnostic_schema.f_body(a integer) RETURNS integer LANGUAGE SQL RETURN a+1;
CREATE PROCEDURE diagnostic_schema.p_one(IN a integer) LANGUAGE SQL AS $$SELECT a$$;
COMMENT ON FUNCTION diagnostic_schema.f_default(integer) IS 'native private batch fixture';
REVOKE ALL ON FUNCTION diagnostic_schema.f_default(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION diagnostic_schema.f_default(integer) TO diagnostic_reader;
CREATE SCHEMA diagnostic_empty;
CREATE TYPE diagnostic_empty.zero_function_enum AS ENUM ('one','two');
CREATE SCHEMA diagnostic_single;
CREATE FUNCTION diagnostic_single.one() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;
"""
        BUILD_STAGE = 'SYNTHETIC_SEED'
        command(['node', str(runtime / 'query.mjs')], cwd=work, env=local, data=sql.encode())
        args = ['--no-password', '--schema-only', '--format=plain', '--quote-all-identifiers',
                '--no-comments', '--no-security-labels', '--no-subscriptions', '--lock-wait-timeout=1000']
        dump_env = {**local, 'LD_LIBRARY_PATH': str(output / 'lib')}
        BUILD_STAGE = 'SYNTHETIC_STOCK'
        stock = command([str(stock_executable), *args], cwd=work, env=dump_env, timeout=45)
        BUILD_STAGE = 'SYNTHETIC_DIAGNOSTIC'
        instrumented, count = diagnostic_dump(output / 'bin/pg_dump', args, dump_env, work)
        negative_native_fd(output / 'bin/pg_dump', args, dump_env, work)
        # Filter boundaries preserve zero/one-function and exact source-selected scope.
        for schema in ['diagnostic_empty', 'diagnostic_single']:
            filtered_args = args + ['--schema=' + schema]
            filtered_stock = command([str(stock_executable), *filtered_args], cwd=work, env=dump_env, timeout=45)
            filtered, _ = diagnostic_dump(output / 'bin/pg_dump', filtered_args, dump_env, work)
            require(normalize_sql(filtered_stock) == normalize_sql(filtered))
        BUILD_STAGE = 'SQL_EQUIVALENCE'
        require(normalize_sql(stock) == normalize_sql(instrumented))
        require(b'GRANT SELECT("id")' in stock and b'ALTER DEFAULT PRIVILEGES' in stock and b'CREATE FUNCTION' in stock)
        return {'passed': True, 'sql_bytes_equal': True, 'fd3_records_valid': True,
                'fd3_record_count': count, 'server_major': 17, 'cluster_absent': True,
                'synthetic_routine_count': 5507, 'function_batch_max': 128,
                'filtered_zero_one_equal': True, 'native_batch_result_faults_refused': True, 'diagnostic_object_scope': 'effective-selected-components'}
    except Exception as error:
        retain_first_failure(error)
        raise
    finally:
        BUILD_STAGE = 'SYNTHETIC_CLEANUP'
        if started and (data / 'postmaster.pid').exists():
            command([str(pg / 'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', 'stop'], cwd=work, env=lib_env, timeout=20)
        require(not (data / 'postmaster.pid').exists())
        shutil.rmtree(runtime)
        if data.exists(): shutil.rmtree(data)
        shutil.rmtree(unix)


def operation_identity():
    run = os.environ.get('GITHUB_RUN_ID', '')
    attempt = os.environ.get('GITHUB_RUN_ATTEMPT', '')
    require(re.fullmatch('[1-9][0-9]{0,19}', run) and re.fullmatch('[1-9][0-9]{0,5}', attempt))
    return {'run_id': run, 'run_attempt': int(attempt)}


def build(repo, output):
    global BUILD_STAGE
    require(sys.platform == 'linux' and os.geteuid() != 0 and os.environ.get('GITHUB_ACTIONS') == 'true')
    require('DATABASE_URL' not in os.environ)
    operation = operation_identity()
    runner = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    require(output.is_absolute() and output.parent.resolve() == runner and output.name == 'isolated-schema-native' and not output.exists())
    repo = repo.resolve(strict=True)
    source_sha = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    require(re.fullmatch('[a-f0-9]{40}', source_sha))
    output.mkdir(mode=0o700)
    ownership = {**operation, 'version': 1, 'scope': 'isolated-native-dump-diagnostic',
                 'owned_output': True, 'builder_uid': os.getuid(), 'control_sha': source_sha}
    (output / 'manifest.json').write_text(json.dumps(ownership) + '\n')
    (output / 'manifest.json').chmod(0o600)
    completed = False
    try:
        work = Path(tempfile.mkdtemp(prefix='.build-', dir=output))
        for name in ['home', 'tmp', 'cache']: (work / name).mkdir(mode=0o700)
        env = clean_env(work)
        archive = work / 'source.tar.gz'
        BUILD_STAGE = 'DOWNLOAD'
        # curl enforces a true total transfer deadline, including slow-drip
        # responses; the outer owned process also has a finite kill budget.
        command(['curl', '--fail', '--silent', '--show-error', '--location',
                 '--proto', '=https', '--proto-redir', '=https', '--max-time', '60',
                 '--max-filesize', str(32 * 1024 * 1024), '--output', str(archive), ARCHIVE_URL],
                cwd=work, env=env, timeout=65)
        require(0 < archive.stat().st_size <= 32 * 1024 * 1024)
        BUILD_STAGE = 'SOURCE_GUARDS'
        originals = archive_sources(archive)
        patched = patch_files(originals)
        with tarfile.open(archive, 'r:gz') as files:
            require(all(valid_source_member(member) for member in files.getmembers()))
            files.extractall(work, filter='data')
        source = work / 'postgresql-17.11'
        helper = repo / 'operations/release/fixture/native-dump-diagnostic.c'
        BUILD_STAGE = 'CONFIGURE'
        command([str(source / 'configure'), '--with-ssl=openssl', '--without-readline', '--without-icu', '--without-zlib', '--prefix=' + str(output)], cwd=source, env=env, timeout=180)
        # The explicit pg_dump target does not inherit top-level all's
        # generated-header ordering. Complete it before parallel object builds.
        BUILD_STAGE = 'GENERATED_HEADERS'
        command(['make', '-C', 'src/backend', 'generated-headers'], cwd=source, env=env, timeout=120)
        BUILD_STAGE = 'STOCK_BUILD'
        command(['make', '-C', 'src/bin/pg_dump', '-j2', 'pg_dump'], cwd=source, env=env, timeout=420)
        stock_executable = work / 'stock-pg_dump'
        shutil.copyfile(source / 'src/bin/pg_dump/pg_dump', stock_executable)
        stock_executable.chmod(0o700)
        BUILD_STAGE = 'LIBPQ_INSTALL'
        command(['make', '-C', 'src/interfaces/libpq', 'install'], cwd=source, env=env, timeout=60)
        # Same configured source/libpq: add logging and bounded function transport batching.
        for name, content in patched.items(): (source / name).write_bytes(content)
        shutil.copyfile(helper, source / 'src/bin/pg_dump/native-dump-diagnostic.c')
        batch_helper = repo / 'operations/release/fixture/native-dump-function-batch.c'
        shutil.copyfile(batch_helper, source / 'src/bin/pg_dump/native-dump-function-batch.c')
        BUILD_STAGE = 'DIAGNOSTIC_BUILD'
        command(['make', '-C', 'src/bin/pg_dump', '-j2', 'pg_dump'], cwd=source, env=env, timeout=120)
        (output / 'bin').mkdir(mode=0o700)
        shutil.copyfile(source / 'src/bin/pg_dump/pg_dump', output / 'bin/pg_dump')
        (output / 'bin/pg_dump').chmod(0o500)
        # Replace the install-time symlink with the exact regular library bytes.
        library = (output / 'lib/libpq.so.5').resolve(strict=True)
        content = library.read_bytes()
        (output / 'lib/libpq.so.5').unlink()
        (output / 'lib/libpq.so.5').write_bytes(content)
        (output / 'lib/libpq.so.5').chmod(0o500)
        BUILD_STAGE = 'VERSION'
        require(command([str(output / 'bin/pg_dump'), '--version'], cwd=work, env=env).strip() == b'pg_dump (PostgreSQL) 17.11')
        proof = qualify(repo, work, output, env, stock_executable)
        require(not (work / 'data/postmaster.pid').exists())
        shutil.rmtree(work)
        BUILD_STAGE = 'OUTPUT'
        manifest = {**ownership, 'source_version': VERSION,
                    'archive_sha256': ARCHIVE_SHA, 'control_sha': source_sha,
                    'builder_sha256': digest(Path(__file__).read_bytes()), 'helper_sha256': digest(helper.read_bytes()),
                    'function_batch_helper_sha256': digest(batch_helper.read_bytes()),
                    'function_batch_contract_sha256': digest((repo / 'operations/release/fixture/native-dump-function-batch-test.c').read_bytes()),
                    'transport': 'consecutive-stock-function-executions-v1',
                    'binary_sha256': digest((output / 'bin/pg_dump').read_bytes()),
                    'libpq_sha256': digest((output / 'lib/libpq.so.5').read_bytes()), 'qualification': proof}
        # Keep only the two executable inputs and manifest for the capture.
        for item in list(output.iterdir()):
            if item.name not in ['bin', 'lib', 'manifest.json'] and not item.name.startswith('.build-'): shutil.rmtree(item) if item.is_dir() else item.unlink()
        for item in list((output / 'lib').iterdir()):
            if item.name != 'libpq.so.5': shutil.rmtree(item) if item.is_dir() else item.unlink()
        (output / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True) + '\n')
        (output / 'manifest.json').chmod(0o600)
        completed = True
        print(json.dumps({'scope': manifest['scope'], 'status': 'passed', 'source_inverse_exact': True,
                          'native_sql_bytes_equal': True, 'fd3_records_valid': True, 'cluster_absent': True}))
    except Exception as error:
        retain_first_failure(error)
        raise
    finally:
        if not completed: cleanup(output)


def cleanup(output):
    global BUILD_STAGE
    BUILD_STAGE = 'CLEANUP'
    operation = operation_identity()
    runner = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    require(output.is_absolute() and output.parent.resolve() == runner and output.name == 'isolated-schema-native')
    if not output.exists():
        require(not output.is_symlink())
        return
    require(output.is_dir() and not output.is_symlink() and output.stat().st_uid == os.getuid())
    manifest_file = output / 'manifest.json'
    require(manifest_file.is_file() and not manifest_file.is_symlink() and manifest_file.stat().st_nlink == 1 and
            manifest_file.stat().st_uid == os.getuid() and manifest_file.stat().st_size <= 16384)
    manifest = json.loads(manifest_file.read_text())
    require(manifest.get('owned_output') is True and manifest.get('builder_uid') == os.getuid() and
            manifest.get('scope') == 'isolated-native-dump-diagnostic' and
            manifest.get('run_id') == operation['run_id'] and manifest.get('run_attempt') == operation['run_attempt'] and
            re.fullmatch('[a-f0-9]{40}', manifest.get('control_sha', '')))
    # A previous interrupted build can leave only its own private Unix cluster.
    # Stop that exact declared data directory before removing the owned tree.
    for work in output.glob('.build-*'):
        require(work.is_dir() and not work.is_symlink() and work.stat().st_uid == os.getuid())
        data = work / 'data'
        if (data / 'postmaster.pid').exists():
            package = work / 'runtime/node_modules/@embedded-postgres/linux-x64'
            pg_ctl = package / 'native/bin/pg_ctl'
            require(pg_ctl.is_file())
            env = {**clean_env(work), 'LD_LIBRARY_PATH': str(package / 'native/lib')}
            command([str(pg_ctl), '-D', str(data), '-m', 'immediate', '-w', 'stop'], cwd=work, env=env, timeout=20)
            require(not (data / 'postmaster.pid').exists())
    shutil.rmtree(output)
    require(not output.exists())


def foreign_cleanup_check(parent):
    keys = ['RUNNER_TEMP', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']
    previous = {key: os.environ.get(key) for key in keys}
    try:
        with tempfile.TemporaryDirectory(prefix='native-owner-source-test-', dir=parent) as folder:
            root = Path(folder).resolve()
            output = root / 'isolated-schema-native'
            output.mkdir(mode=0o700)
            manifest = {'owned_output': True, 'builder_uid': os.getuid(),
                        'scope': 'isolated-native-dump-diagnostic', 'control_sha': 'a' * 40,
                        'run_id': '999', 'run_attempt': 1}
            (output / 'manifest.json').write_text(json.dumps(manifest))
            os.environ.update(RUNNER_TEMP=str(root), GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='1')
            try:
                cleanup(output)
            except RuntimeError:
                pass
            else:
                require(False)
            require(output.is_dir() and json.loads((output / 'manifest.json').read_text()) == manifest)
    finally:
        for key, value in previous.items():
            if value is None: os.environ.pop(key, None)
            else: os.environ[key] = value


if __name__ == '__main__':
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '--self-test':
            print(json.dumps(self_test(Path(sys.argv[2]))))
        elif len(sys.argv) == 3 and sys.argv[1] == '--cleanup':
            cleanup(Path(sys.argv[2]))
        elif len(sys.argv) == 4 and sys.argv[1] == '--build':
            build(Path(sys.argv[2]), Path(sys.argv[3]))
        else:
            require(False)
    except Exception as error:
        print(json.dumps({'scope':'isolated-native-dump-diagnostic','status':'failed',
                          'stage':FIRST_FAILURE_STAGE if FIRST_FAILURE_STAGE is not None else
                            error.stage if isinstance(error, DiagnosticFailure) else 'UNKNOWN',
                          'code':'ISOLATED_DUMP_DIAGNOSTIC_REFUSED',
                          **({'command_failure': FIRST_COMMAND_FAILURE} if FIRST_COMMAND_FAILURE is not None else {})}), file=sys.stderr)
        sys.exit(1)
