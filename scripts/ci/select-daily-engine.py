#!/usr/bin/env python3
"""Freeze a protected first-parent candidate using evidence available by 03:30 Chicago."""
import argparse
from datetime import date, datetime, time
import io
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo
import zipfile


def command(*args):
    return subprocess.check_output(args, timeout=45)


def git(*args):
    return command('git', '--no-replace-objects', *args).decode().strip()


def api(path):
    return json.loads(command('gh', 'api', path))


def epoch(value):
    moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if moment.utcoffset() is None:
        raise ValueError('qualification evidence timestamp has no UTC offset')
    return moment.timestamp()


def cutoff(day):
    return int(datetime.combine(date.fromisoformat(day), time(3, 30),
                                ZoneInfo('America/Chicago')).timestamp())


def backup(repo, sha, limit, status):
    if not status or status['state'] != 'SUCCESS' or epoch(status['createdAt']) > limit:
        return None
    match = re.fullmatch(r'https://github\.com/' + re.escape(repo) + r'/actions/runs/(\d+)',
                         status['targetUrl'] or '')
    if not match:
        raise ValueError('unrecognized Backup status provenance')
    run = api(f'repos/{repo}/actions/runs/{match[1]}')
    if (run['path'] != '.github/workflows/backup-engine.yml' or run['head_branch'] != 'main'
            or run['conclusion'] != 'success' or epoch(run['updated_at']) > limit):
        return None
    artifacts = api(f'repos/{repo}/actions/runs/{run["id"]}/artifacts?per_page=100')
    name = f'backup-certificate-{sha}-{run["run_attempt"]}'
    matches = [a for a in artifacts['artifacts'] if a['name'] == name and not a['expired']]
    if not matches:
        return None
    if len(matches) != 1 or matches[0]['size_in_bytes'] > 2000000:
        raise ValueError('unexpected Backup evidence bundle')
    data = command('gh', 'api', f'repos/{repo}/actions/artifacts/{matches[0]["id"]}/zip')
    with zipfile.ZipFile(io.BytesIO(data)) as bundle:
        if any(x.file_size > 2000000 for x in bundle.infolist()):
            raise ValueError('unexpected Backup evidence size')
        cert = json.loads(bundle.read('certificate.json'))
        compat = json.loads(bundle.read('compatibility.json'))
    producer = run['head_sha']
    control = compat['controlSha']
    workflow = '.github/workflows/backup-engine.yml'
    if control != producer and (
            run.get('event') != 'push' or control != sha or not re.fullmatch('[0-9a-f]{40}', sha)
            or git('merge-base', producer, control) != producer
            or git('diff', '--name-only', producer, control, '--', workflow)):
        raise ValueError('Backup retarget conflicts with protected producer provenance')
    db, seed = cert['database'], cert['seed']
    if (cert['sha'] != sha or cert['verdict'] != 'pass' or cert['reasons']
            or cert['fatalLogLines'] != 0 or cert['soakSeconds'] < 1800
            or epoch(cert['certifiedAt']) > limit or compat['targetSha'] != sha
            or db['restoreValidated'] is not True
            or db['restoreErrors'] != 0 or seed['tablesFailed'] != 0
            or epoch(seed['seededAt']) < epoch(db['restoredAt'])
            or not re.fullmatch('[0-9a-f]{64}', db['dumpSha256'])
            or not re.fullmatch('[0-9a-f]{64}', db['ownersSha256'])):
        raise ValueError('successful Backup run conflicts with certificate contents')
    return {'runId': run['id'], 'attempt': run['run_attempt'], 'artifactId': matches[0]['id'], 'producerSha': producer,
            'rehearsedServingSha': cert.get('rehearsedServingSha'),
            'rollbackAdoptionSeconds': cert.get('rollbackAdoptionSeconds'),
            'forwardAdoptionSeconds': cert.get('forwardAdoptionSeconds'),
            'certifiedAt': cert['certifiedAt'], 'database': db, 'seed': seed, 'compatibility': compat}


def current_schema(control, evidence):
    """Use the Backup refresh lane's exact owners and newest-migration freshness rules."""
    owners = command('git', '--no-replace-objects', 'show', control + ':server/standby/standby-owners.sql')
    newest = git('log', '-1', '--format=%ct', control, '--', 'supabase/migrations')
    db = evidence['database']
    return (hashlib.sha256(owners).hexdigest() == db['ownersSha256']
            and newest.isdigit() and int(newest) <= epoch(db['restoredAt']))


def statuses(repo, shas):
    fields = ' '.join(f'c{i}:object(oid:"{sha}"){{... on Commit{{status{{contexts{{context state createdAt targetUrl}}}}}}}}'
                      for i, sha in enumerate(shas))
    owner, name = repo.split('/')
    query = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){' + fields + '}}'
    result = json.loads(command('gh', 'api', 'graphql', '-f', 'query=' + query,
                                '-f', 'o=' + owner, '-f', 'n=' + name))['data']['repository']
    for i, sha in enumerate(shas):
        status = result[f'c{i}']['status']
        matches = [s for s in (status or {}).get('contexts', []) if s['context'] == 'backup-engine/certified']
        yield sha, max(matches, key=lambda s: s['createdAt'], default=None)


def inventory(serving, control, target):
    included = set(git('rev-list', '--first-parent', f'{serving}..{target}').splitlines()) if target else set()
    prs = []
    for line in git('log', '--first-parent', '--format=%H %s', f'{serving}..{control}').splitlines():
        sha, subject = line.split(' ', 1)
        number = re.search(r'\(#(\d+)\)$|^Merge pull request #(\d+) ', subject)
        if number:
            prs.append({'pr': int(number[1] or number[2]), 'mergeSha': sha,
                        'state': 'included' if sha in included else 'deferred'})
    migrations = []
    for path in git('diff', '--name-only', serving, control, '--', 'supabase/migrations').splitlines():
        before = git('ls-tree', serving, '--', path)
        desired = git('ls-tree', control, '--', path)
        actual = git('ls-tree', target or serving, '--', path)
        migrations.append({'path': path, 'previousBlob': before.split()[2] if before else None,
                           'intendedBlob': desired.split()[2] if desired else None,
                           'selectedBlob': actual.split()[2] if actual else None,
                           'sourceState': 'included' if target and desired == actual else 'deferred',
                           'installation': 'requires installer receipt'})
    return {'pullRequests': prs, 'migrations': migrations}


def select(args, report):
    for sha in (args.control, args.serving):
        if not re.fullmatch('[0-9a-f]{40}', sha):
            raise ValueError('expected exact protected commit SHA')
    commits = git('rev-list', '--first-parent', args.control, '^' + args.serving).splitlines()
    if commits and git('rev-parse', commits[-1] + '^1') != args.serving:
        raise ValueError('serving release is outside the protected first-parent interval')
    if not commits and args.serving != args.control:
        raise ValueError('control is behind serving release')
    for offset in range(0, len(commits), 30):
        for sha, status in statuses(args.repo, commits[offset:offset + 30]):
            evidence = backup(args.repo, sha, report['cutoffEpoch'], status)
            if evidence is None:
                continue
            rollback = evidence.get('rollbackAdoptionSeconds')
            forward = evidence.get('forwardAdoptionSeconds')
            if (evidence.get('rehearsedServingSha') != args.serving
                    or type(rollback) is not int or not 0 <= rollback <= 135
                    or type(forward) is not int or forward < 0):
                report['deferredCandidates'].append({'sha': sha, 'reason': 'serving rollback rehearsal unavailable'})
                continue
            if not current_schema(args.control, evidence):
                report['deferredCandidates'].append({'sha': sha, 'reason': 'Backup restore predates current schema inputs'})
                continue
            helper = subprocess.run([sys.executable, '-B', 'scripts/ci/read-engine-prequalification.py',
                                     '--repo', args.repo, '--target', sha, '--control', args.control,
                                     '--cutoff', str(report['cutoffEpoch'])], capture_output=True, timeout=60)
            if helper.returncode == 3:
                report['deferredCandidates'].append({'sha': sha, 'reason': 'prequalification unavailable'})
                continue
            helper.check_returncode()
            qual = json.loads(helper.stdout)
            if qual['targetSha'] != sha or qual['controlSha'] != args.control:
                raise ValueError('prequalification identity differs')
            floor = subprocess.run([sys.executable, '-B', 'server/scripts/engine-release-activation-floor.py',
                                    'daily-compatibility', '--repo', '.', '--target', sha,
                                    '--control', args.control, '--deadline', str(report['cutoffEpoch'])], capture_output=True)
            if floor.returncode:
                report['deferredCandidates'].append({'sha': sha, 'reason': 'protected release controls differ'})
                continue
            report.update(outcome='selected', targetSha=sha, backup=evidence, qualification=qual,
                          controls=json.loads(floor.stdout))
            return


def check_intent(report, repo, prs, migrations):
    """Evaluate supplied identities against an existing immutable selection."""
    target = report.get('targetSha')
    checked = []
    for number in prs:
        if number <= 0:
            raise ValueError('PR number must be positive')
        try:
            pr = api(f'repos/{repo}/pulls/{number}')
        except (OSError, ValueError, subprocess.SubprocessError):
            checked.append({'pr': number, 'headSha': None, 'mergeSha': None, 'state': 'blocked',
                            'reason': 'GitHub PR identity unavailable'})
            continue
        merged = pr.get('merge_commit_sha') if pr.get('merged_at') else None
        state = 'deferred'
        if not target:
            state = 'blocked'
        elif merged:
            if not re.fullmatch('[0-9a-f]{40}', merged):
                raise ValueError('invalid PR merge identity')
            known = subprocess.run(['git', 'cat-file', '-e', merged + '^{commit}'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if known.returncode == 0:
                result = subprocess.run(['git', 'merge-base', '--is-ancestor', merged, target])
                if result.returncode not in (0, 1):
                    raise ValueError('cannot compare PR ancestry')
                if result.returncode == 0:
                    state = 'included'
            elif epoch(pr['merged_at']) <= report['cutoffEpoch']:
                state = 'blocked'
        elif pr['state'] == 'closed':
            state = 'blocked'
        checked.append({'pr': number, 'headSha': pr['head']['sha'], 'mergeSha': merged, 'state': state})
    for path in migrations:
        if not re.fullmatch(r'supabase/migrations/[A-Za-z0-9_.-]+\.sql', path):
            raise ValueError('migration must be an exact protected SQL path')
        expected = git('ls-tree', report['controlSha'], '--', path) if report.get('controlSha') else ''
        selected = git('ls-tree', target, '--', path) if target else ''
        state = 'blocked' if not expected or not target else 'included' if selected == expected else 'deferred'
        checked.append({'migration': path, 'intendedBlob': expected.split()[2] if expected else None,
                        'selectedBlob': selected.split()[2] if selected else None, 'state': state,
                        'installation': 'requires installer receipt'})
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--selection', type=Path, help='Inspect an already frozen daily-selection.json')
    parser.add_argument('--pr', type=int, action='append', default=[])
    parser.add_argument('--migration', action='append', default=[])
    for key in ('control', 'serving', 'date', 'output'):
        parser.add_argument('--' + key)
    args = parser.parse_args()
    if args.selection:
        report = json.loads(args.selection.read_text())
        print(json.dumps({'targetSha': report['targetSha'], 'controlSha': report['controlSha'],
                          'intent': check_intent(report, args.repo, args.pr, args.migration)}, indent=2))
        return 0
    if not all((args.control, args.serving, args.date, args.output)):
        parser.error('selection requires --control, --serving, --date and --output')
    report = {'schema': 1, 'outcome': 'keep-serving', 'targetSha': None, 'deferredCandidates': [],
              'servingSha': args.serving, 'stageSha': args.control, 'controlSha': None, 'cutoffEpoch': cutoff(args.date)}
    try:
        if not re.fullmatch('[0-9a-f]{40}', args.control):
            raise ValueError('expected exact protected Stage SHA')
        args.control = git('rev-list', '--first-parent', '-1', '--before=@' + str(report['cutoffEpoch']), args.control)
        if not args.control:
            raise ValueError('no protected first-parent control existed at the selection cutoff')
        report['controlSha'] = args.control
        select(args, report)
        if report['outcome'] == 'keep-serving':
            report['reason'] = 'No newer protected candidate has complete current evidence by the cutoff.'
        report.update(inventory(args.serving, args.control, report['targetSha']))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        report.update(outcome='blocked', targetSha=None, reason=str(error))
    Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    return 2 if report['outcome'] == 'blocked' else 0


if __name__ == '__main__':
    sys.exit(main())
