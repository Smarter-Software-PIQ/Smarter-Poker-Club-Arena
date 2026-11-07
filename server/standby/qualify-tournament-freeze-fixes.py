#!/usr/bin/env python3
"""Explicit backup-only qualification; never starts or replaces the serving engine.

Source tests run in disposable, networkless containers, not the game process.
Native probes own fresh PG17 clusters, not the restored backup database. The
restored database is inspected read-only. Keep these three evidence claims apart.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request

DEADLINE = time.monotonic() + 1200
COMMANDS = []

TESTS = [
    'src/tournament/TournamentStopRejectionOwnership.test.ts',
    'src/engine/HandSettlementAlertIdentity.test.ts',
    'src/services/supabase/handHistory.test.ts',
    'src/tournament/TournamentMoveManagerBoundary.test.ts',
    'src/tournament/tournamentSeatMoveRpc.test.ts',
    'src/engine/AnUnstartedHandReleasesItsPermit.test.ts',
]
MERGES = ['f7e02db7b7aeb57c66b2a3c84f47187bfc562b57',
          'd8642fb91a100ea6e271f1aaa8d8bcbbb3bfe1ca',
          '80ad6eae5ba10d8d1b8d93c1707b0cfe090401b9',
          'a23d08866304811ed82aa8feb0072e510ba3e1aa']
ENGINE = 'club-arena-engine-standby'
DATABASE = 'supabase_db_standby'
NETWORK = 'supabase_network_standby'
MIGRATION = 'supabase/migrations/20261106160107_a_stopped_bank_capture_retains_its_acknowledged_preparation_.sql'
READBACK = """BEGIN READ ONLY;
SELECT json_build_object('definitionMd5',md5(pg_get_functiondef(oid)),
 'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(proowner),'acl',proacl::text,
 'securityDefiner',prosecdef,'config',proconfig)
FROM pg_proc WHERE oid=to_regprocedure('smarter_private.f06_mixed_custody_snapshot(uuid,uuid,jsonb)');
ROLLBACK;"""


def run(argv, *, cwd=None, log=None, timeout=1800):
    timeout = min(timeout, DEADLINE - time.monotonic())
    if timeout <= 0:
        raise RuntimeError('qualification exceeded its 20-minute total execution budget')
    COMMANDS.append({'argv': argv, 'cwd': str(cwd) if cwd else None})
    if log:
        with open(log, 'w') as stream:
            subprocess.run(argv, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT,
                           check=True, timeout=timeout)
        return ''
    return subprocess.run(argv, cwd=cwd, text=True, capture_output=True,
                          check=True, timeout=timeout).stdout.strip()


def postgres_build_base(image_id):
    # Docker run accepts a local image ID. Dockerfile FROM needs a repository
    # digest, and a multi-platform index must select the backup's architecture.
    identity_format = '{{.Id}} {{.Os}}/{{.Architecture}}'
    metadata = run(['docker', 'image', 'inspect', '-f', identity_format + ' {{json .RepoDigests}}', image_id])
    inspected_id, platform, raw_digests = metadata.split(' ', 2)
    if inspected_id != image_id or not re.fullmatch(r'linux/[a-z0-9_]+', platform):
        raise RuntimeError('backup PostgreSQL image identity or platform differs')
    for reference in json.loads(raw_digests) or []:
        if re.fullmatch(r'[a-z0-9][a-z0-9./:_-]+@sha256:[0-9a-f]{64}', reference):
            resolved = run(['docker', 'image', 'inspect', '-f', identity_format, reference])
            if resolved == f'{image_id} {platform}':
                return reference, platform
    raise RuntimeError('no immutable repository digest resolves to the running backup PostgreSQL image')


def identity(sha):
    run(['systemctl', 'is-active', '--quiet', 'standby-egress-lock'])
    subnet = run(['docker', 'network', 'inspect', NETWORK, '-f',
                  '{{(index .IPAM.Config 0).Subnet}}'])
    run(['iptables', '-C', 'DOCKER-USER', '-s', subnet, '-j', 'REJECT'])
    container = json.loads(run(['docker', 'inspect', '--format',
        '[{"Id":{{json .Id}},"Image":{{json .Image}},"State":{{json .State}},'
        '"Config":{"Labels":{{json .Config.Labels}}}}]', ENGINE]))[0]
    label = container['Config']['Labels'].get('com.smarterpoker.standby.sha')
    with urllib.request.urlopen('http://127.0.0.1:18080/health', timeout=10) as response:
        health = json.load(response)
    if label != sha or health.get('releaseSha') != sha:
        raise RuntimeError('backup running SHA differs from requested qualification SHA')
    if (container['State'].get('Running') is not True
            or container['State'].get('Health', {}).get('Status', 'healthy') != 'healthy'
            or health.get('liveness') not in ('ok', 'standby')
            or not isinstance(health.get('instanceId'), str) or not health['instanceId']):
        raise RuntimeError('backup running/healthy instance identity is not proved')
    return {'releaseSha': sha, 'instanceId': health['instanceId'],
            'containerId': container['Id'], 'imageId': container['Image'],
            'running': True}


def readback():
    raw = run(['docker', 'exec', DATABASE, 'psql', '-XqAt', '-v',
               'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-c', READBACK])
    result = json.loads(raw)
    if result != {'definitionMd5': '77139e22bafa9d6d2d47f54ae25be663',
                  'bodyMd5': '00230601eeb8de97fafcbed4074a782d',
                  'owner': 'postgres', 'acl': '{postgres=X/postgres}',
                  'securityDefiner': True,
                  'config': ['search_path=pg_catalog, public, smarter_private']}:
        raise RuntimeError('restored stopped-bank definition or authority differs')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sha')
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.sha):
        parser.error('exact 40-hex SHA required')
    repo = Path('/opt/club-arena')
    state = Path('/var/lib/club-arena-standby')
    before = identity(args.sha)
    for commit in MERGES:
        run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', commit, args.sha])
    (state / 'qualifications').mkdir(exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix=args.sha + '-', dir=state / 'qualifications'))
    scratch = output / 'scratch'
    scratch.mkdir()
    source = scratch / 'source'
    source.mkdir()
    report = {'schema': 'tournament-freeze-backup-qualification/v1', 'sha': args.sha,
              'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'runningBefore': before, 'passed': False,
              'scope': 'Exact-source branch tests and disposable native probes on backup host; '
                       'not failure injection into running engine or production gameplay proof',
              'migrationHistory': 'not required: schema export excludes supabase_migrations',
              'tests': TESTS}
    report['qualificationScriptSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    tags = []
    containers = ['freeze-node-' + output.name, 'freeze-hand-' + output.name,
                  'freeze-f06-' + output.name]
    try:
        report['restoredFunctionBefore'] = readback()
        archive = scratch / 'source.tar'
        run(['git', '-C', str(repo), 'archive', '--format=tar', '-o', str(archive),
             args.sha, 'server', 'src', 'scripts', 'supabase', 'tests', 'docs', '.github',
             'package.json', 'package-lock.json', 'tsconfig.json'])
        run(['tar', '-xf', str(archive), '-C', str(source)])
        report['archiveSha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
        report['migrationSha256'] = hashlib.sha256((source / MIGRATION).read_bytes()).hexdigest()
        report['sourceTrees'] = {p: run(['git', '-C', str(repo), 'rev-parse', args.sha + ':' + p])
                                 for p in ['server', 'src', 'scripts', 'supabase', 'tests', 'docs', '.github']}
        dockerfile = (source / 'server/Dockerfile').read_text()
        base = re.search(r'^FROM (node:22[^\s]+@sha256:[0-9a-f]{64})', dockerfile, re.M)
        if not base:
            raise RuntimeError('candidate has no immutable Node22 base')
        node_tag = 'standby-freeze-node:' + output.name
        native_tag = 'standby-freeze-pg:' + output.name
        tags = [node_tag, native_tag]
        (source / 'Qualification.node').write_text(
            'FROM ' + base.group(1) + '\nRUN apt-get update && apt-get install -y --no-install-recommends g++'
            ' && rm -rf /var/lib/apt/lists/*\nCOPY . /source\nWORKDIR /source/server\n'
            'RUN npm ci --include=dev --no-audit --no-fund && node scripts/build-public-hist215-native.mjs\n')
        run(['docker', 'build', '-f', 'Qualification.node', '-t', node_tag, '.'],
            cwd=source, log=output / 'node-build.log')
        report['nodeQualificationImage'] = run(['docker', 'image', 'inspect', '-f', '{{.Id}}', node_tag])
        run(['docker', 'run', '--rm', '--name', containers[0], '--network', 'none', '--cpus', '2', '--memory', '4g',
             '--mount', 'type=bind,source=' + str(output) + ',target=/evidence',
             '-e', 'VITEST_MAX_THREADS=2', node_tag, 'node', 'node_modules/vitest/vitest.mjs',
             'run', *TESTS, '--reporter=json', '--outputFile=/evidence/runtime-tests.json'],
            log=output / 'runtime-tests.log')
        result = json.loads((output / 'runtime-tests.json').read_text())
        executed = {r['name'].removeprefix('/source/server/') for r in result.get('testResults', [])}
        if (not result.get('success') or result.get('numFailedTests')
                or result.get('numPendingTests') or not result.get('numPassedTests')
                or executed != set(TESTS)):
            raise RuntimeError('focused test verdict is not a passing executed result')
        report['sourceBranchTests'] = {'passed': result['numPassedTests'], 'failed': result['numFailedTests']}
        pg_image = run(['docker', 'inspect', '-f', '{{.Image}}', DATABASE])
        report['postgresBaseImage'] = pg_image
        pg_reference, pg_platform = postgres_build_base(pg_image)
        report['postgresBaseReference'] = pg_reference
        report['postgresBasePlatform'] = pg_platform
        pg_uid = int(run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'id',
                          pg_image, '-u', 'postgres']))
        pg_gid = int(run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'id',
                          pg_image, '-g', 'postgres']))
        (source / 'Qualification.pg').write_text(
            'FROM ' + pg_reference + '\nUSER root\nRUN apk add --no-cache python3\n'
            'COPY --chown=postgres:postgres . /source\nUSER postgres\nWORKDIR /source\n'
            'ENV PG_BIN=/nix/var/nix/profiles/default/bin\nENTRYPOINT ["python3"]\n')
        run(['docker', 'build', '--platform', pg_platform, '-f', 'Qualification.pg', '-t', native_tag, '.'],
            cwd=source, log=output / 'native-build.log')
        report['nativeQualificationImage'] = run(['docker', 'image', 'inspect', '-f', '{{.Id}}', native_tag])
        evidence = output / 'native'
        evidence.mkdir(mode=0o700)
        os.chown(evidence, pg_uid, pg_gid)
        common = ['docker', 'run', '--rm', '--network', 'none', '--cpus', '2', '--memory', '4g',
                  '--mount', 'type=bind,source=' + str(evidence) + ',target=/evidence']
        run([*common, '--name', containers[1], native_tag, 'scripts/ci/test-hand-submission.py', '--pg-bin',
             '/nix/var/nix/profiles/default/bin', '--evidence', '/evidence/hand'],
            log=output / 'hand-native.log')
        run([*common, '--name', containers[2], native_tag, 'scripts/ci/test-f06-shared-hand-lane.py', '--output', '/evidence/f06'],
            log=output / 'f06-native.log')
        hand = json.loads((evidence / 'hand/result.json').read_text())
        f06 = json.loads((evidence / 'f06/RESULTS.json').read_text())
        if (hand.get('status') != 'passed' or f06.get('passed') is not True
                or f06.get('ownedClusterRemoved') is not True
                or f06.get('stoppedCancelled', {}).get('passed') is not True):
            raise RuntimeError('native source verdict missing or failed')
        report['nativeHandAssertions'] = hand['assertions']
        report['nativeF06Cases'] = len(f06['cases'])
        report['restoredFunctionAfter'] = readback()
        report['runningAfter'] = identity(args.sha)
        if report['runningAfter'] != before:
            raise RuntimeError('backup process identity changed during qualification')
        report['passed'] = True
    except Exception as error:
        report['failure'] = str(error)
    finally:
        # docker client timeout does not stop its container. Remove only this
        # invocation's disposable names before touching its scratch directory.
        for container in containers:
            subprocess.run(['docker', 'rm', '-f', container], capture_output=True)
        for tag in tags:
            subprocess.run(['docker', 'image', 'rm', tag], capture_output=True)
        shutil.rmtree(scratch)
        report['endedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        report['commands'] = COMMANDS
        (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'report': str(output / 'result.json'), **report}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
