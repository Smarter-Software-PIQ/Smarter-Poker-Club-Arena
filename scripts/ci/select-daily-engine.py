#!/usr/bin/env python3
"""Freeze a protected first-parent candidate using evidence available by 03:30 Chicago."""
import argparse
import importlib.util
from datetime import date, datetime, time, timezone
import io
import hashlib
import json
import re
import subprocess
import sys
import time as clock
import types
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
            'playerReconnectedBothDirections': cert.get('playerReconnectedBothDirections'),
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
            if (evidence.get('playerReconnectedBothDirections') is not True
                    or evidence.get('rehearsedServingSha') != args.serving
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
                                    'nov7-owner' if getattr(args, 'owner_window', None) else 'daily-compatibility',
                                    '--repo', '.', '--target', sha,
                                    '--control', args.control, '--deadline', str(report.get('ownerExpiresEpoch', report['cutoffEpoch']))], capture_output=True)
            if floor.returncode:
                report['deferredCandidates'].append({'sha': sha, 'reason': 'protected release controls differ'})
                continue
            report.update(outcome='selected', targetSha=sha, backup=evidence, qualification=qual,
                          controls={"ownerWindowId": args.owner_window} if getattr(args, "owner_window", None) else json.loads(floor.stdout))
            return


# AN OPEN OWNER WINDOW STARTS ITS OWN CUTOVER (2026-11-08). A booked owner
# window used to do nothing until a person dispatched the explicit owner
# selection: the November 7 booking expired unused, and on November 8 the
# 18:20Z window sat idle for about seventy minutes and every retry after new
# evidence waited for someone to notice. The decision below only reads. When
# it says start, Stage dispatches the SAME manual owner route
# (workflow_dispatch with owner_window_id), so the pinned nov7-owner
# validator, this selector, the receiver and the host's single-use claim
# still decide everything. These constants are the guard's own:
OWNER_NOTICE_LEAD_SECONDS = 20 * 60  # tests/a-booked-window-gives-players-notice.law.test.ts
OWNER_ANNOUNCEMENT_BAND = (330, 2940)  # engine-release-seal.py require_nov7_reservation_authority
OWNER_WINDOW_SECONDS = 420  # announcement + 420 s must fit before the window closes
OWNER_TITLE = 'Owner engine window '
PUBLIC_BUILD_INFO = 'https://smarter.poker/hub/club-arena/build-info.json'
ENGINE_HEALTH = 'https://engine.smarter.poker/health'
PUBLISH_JOB = 'client-publication / production / publish-to-origin'
NOTICES = 'src/utils/ownerMaintenanceNotices.json'


def fetch_json(url):
    return json.loads(command('curl', '-fsS', '--max-time', '15', '-H', 'Cache-Control: no-cache', url))


def contains(ancestor, sha):
    result = subprocess.run(['git', '--no-replace-objects', 'merge-base', '--is-ancestor', ancestor, sha],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    if result.returncode not in (0, 1):
        raise ValueError('cannot compare release ancestry')
    return result.returncode == 0


def carries_notice(sha, window):
    try:
        rows = json.loads(git('show', sha + ':' + NOTICES)).get('notices', [])
    except (subprocess.SubprocessError, ValueError, AttributeError):
        return False
    return any(row.get('id') == window['id'] and row.get('noticeAt') == window['playerNoticeAt']
               and row.get('notBefore') == window['notBefore'] and row.get('notAfter') == window['notAfter']
               for row in rows)


def notice_refusal(repo, window, now):
    """The actual public notice, as the runbook requires of the release owner:
    the client players are served carries this booking now, and the client
    that was served the required lead ago carried it too."""
    horizon = now - OWNER_NOTICE_LEAD_SECONDS
    if not isinstance(window.get('playerNoticeAt'), str) or epoch(window['playerNoticeAt']) > horizon:
        return 'the player notice has not been public for its required lead'
    live = fetch_json(PUBLIC_BUILD_INFO).get('ca_sha')
    if not isinstance(live, str) or not re.fullmatch('[0-9a-f]{40}', live) or not carries_notice(live, window):
        return 'the served client does not carry the booked notice'
    stamp = datetime.fromtimestamp(horizon, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    runs = api(f'repos/{repo}/actions/workflows/publish-club-arena.yml/runs?branch=main&status=success'
               f'&created=%3C%3D{stamp}&per_page=30')['workflow_runs']
    for run in runs:
        jobs = api(f'repos/{repo}/actions/runs/{run["id"]}/attempts/{run["run_attempt"]}/jobs?per_page=100')['jobs']
        if not any(job['name'] == PUBLISH_JOB and job['conclusion'] == 'success' and job.get('completed_at')
                   and epoch(job['completed_at']) <= horizon for job in jobs):
            continue
        if carries_notice(run['head_sha'], window):
            return None
        return 'the client served the required lead ago did not carry the notice'
    return 'no client publication is known to have served the notice for its required lead'


def owner_admission(control, owner, now):
    """The exact protected admission the dispatched owner route applies first."""
    spec = importlib.util.spec_from_file_location('qualification', Path(__file__).with_name('read-engine-prequalification.py'))
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    try:
        reader.owner_selection_policy(control, control, owner, now)
    except (reader.Unqualified, subprocess.CalledProcessError) as error:
        return str(error) or 'refused'
    return None


def owner_start(args):
    """Decide, read-only, whether the open owner window may start now."""
    now = int(clock.time())
    decision = {'schema': 1, 'start': False, 'ownerWindowId': None, 'evaluatedAt': now}

    def refuse(reason, **extra):
        decision.update(reason=reason, **extra)
        return decision
    try:
        control = args.control
        floor = json.loads(git('show', control + ':server/release/activation-floor.json'))
        owner = floor.get('ownerWindowId')
        if floor.get('schema') != 'engine-release-activation-floor/v2-owner-window' or not owner:
            return refuse('no owner window is booked')
        decision['ownerWindowId'] = owner
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', owner):
            return refuse('owner window identity is invalid')
        orders = json.loads(git('show', control + ':server/release/owner-maintenance-windows.json'))
        matches = [w for w in orders.get('windows', []) if w.get('id') == owner]
        if len(matches) != 1:
            return refuse('the owner order for this window is unavailable')
        window = matches[0]
        opens = max(epoch(window['notBefore']), epoch(floor['activationAt']))
        closes = min(epoch(window['notAfter']), epoch(floor['expiresAt']))
        if now < opens:
            return refuse('the owner window has not opened')
        if now >= closes:
            return refuse('the owner window has closed')
        if not OWNER_ANNOUNCEMENT_BAND[0] <= now % 3600 <= OWNER_ANNOUNCEMENT_BAND[1]:
            return refuse('an announcement now would fall outside :05:30-:49:00')
        if now + OWNER_WINDOW_SECONDS > closes:
            return refuse('the announcement and cutover no longer fit before the window closes')
        refused = owner_admission(control, owner, now)
        if refused:
            return refuse(f'the protected owner admission refuses this window now: {refused}')
        why = notice_refusal(args.repo, window, now)
        if why:
            return refuse(why)
        serving = fetch_json(ENGINE_HEALTH).get('releaseSha')
        if not isinstance(serving, str) or not re.fullmatch('[0-9a-f]{40}', serving):
            return refuse('the live engine release is unreadable')
        # Every release this window admits contains its ordered commit
        # (engine-release-activation-floor.py policy), so once one has sealed
        # the window has nothing left to release.
        if contains(window['contains'], serving):
            return refuse('this window already has its release serving')
        listing = api(f'repos/{args.repo}/actions/workflows/stage-engine-release.yml/runs?event=workflow_dispatch'
                      f'&created=%3E%3D{window["notBefore"]}&per_page=100')
        if listing['total_count'] > len(listing['workflow_runs']):
            return refuse('the owner selection history is incomplete')
        attempts = [r for r in listing['workflow_runs'] if r.get('display_title') == OWNER_TITLE + owner]
        if any(r['status'] != 'completed' for r in attempts):
            return refuse('an owner selection for this window is already running')
        receivers = api(f'repos/{args.repo}/actions/workflows/auto-deploy-hetzner.yml/runs?event=repository_dispatch&per_page=30')
        if any(r['status'] != 'completed' and str(r.get('display_title', '')).startswith('Engine Release ')
               for r in receivers['workflow_runs']):
            return refuse('an engine receiver is already running')
        report = {'cutoffEpoch': now, 'ownerExpiresEpoch': int(epoch(floor['expiresAt'])), 'deferredCandidates': []}
        select(types.SimpleNamespace(repo=args.repo, control=control, serving=serving, owner_window=owner), report)
        if report.get('outcome') != 'selected':
            return refuse('no protected candidate has complete current evidence',
                          deferredCandidates=report['deferredCandidates'])
        landed = max(epoch(report['backup']['certifiedAt']), epoch(report['qualification']['completedAt']))
        decision.update(candidateSha=report['targetSha'], servingSha=serving, evidenceLandedAt=int(landed),
                        evidenceRunIds=[report['backup']['runId'], report['qualification']['qualificationRunId']],
                        previousAttempts=[r['id'] for r in attempts])
        # A later attempt needs NEW qualifying evidence: a Backup certificate or
        # qualification that completed after the newest attempt was created.
        if attempts and landed <= max(epoch(r['created_at']) for r in attempts):
            return refuse('no new qualifying evidence since the last attempt')
        decision['start'] = True
        decision['reason'] = 'the open owner window is ready to start'
        return decision
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        return refuse(f'owner window readiness is unreadable: {error}')


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
    parser.add_argument('--owner-window')
    parser.add_argument('--selection-run-id')
    parser.add_argument('--selection', type=Path, help='Inspect an already frozen daily-selection.json')
    parser.add_argument('--pr', type=int, action='append', default=[])
    parser.add_argument('--migration', action='append', default=[])
    for key in ('control', 'serving', 'date', 'output'):
        parser.add_argument('--' + key)
    parser.add_argument("--stage")
    parser.add_argument('--owner-start', action='store_true', help='Decide whether the open owner window may start')
    args = parser.parse_args()
    if args.owner_start:
        if not (args.control and args.output):
            parser.error('owner start requires --control and --output')
        decision = owner_start(args)
        Path(args.output).write_text(json.dumps(decision, indent=2) + '\n')
        return 0
    if args.selection:
        report = json.loads(args.selection.read_text())
        print(json.dumps({'targetSha': report['targetSha'], 'controlSha': report['controlSha'],
                          'intent': check_intent(report, args.repo, args.pr, args.migration)}, indent=2))
        return 0
    if not all((args.control, args.serving, args.date or args.owner_window, args.output)):
        parser.error('selection requires --control, --serving, --date and --output')
    report = {'schema': 1, 'outcome': 'keep-serving', 'targetSha': None, 'deferredCandidates': [],
              'servingSha': args.serving, 'stageSha': args.stage or args.control, 'controlSha': None, 'cutoffEpoch': cutoff(args.date) if args.date else None}
    try:
        if not re.fullmatch('[0-9a-f]{40}', args.control):
            raise ValueError('expected exact protected Stage SHA')
        if args.owner_window:
            if args.date or not args.selection_run_id:
                raise ValueError('owner selection requires original Stage run, not a daily date')
            spec = importlib.util.spec_from_file_location('qualification', Path(__file__).with_name('read-engine-prequalification.py'))
            reader = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(reader)
            report['cutoffEpoch'] = reader.selection_cutoff(args.repo, args.selection_run_id)
            run = reader.api(f'repos/{args.repo}/actions/runs/{args.selection_run_id}')
            if (run['head_sha'] != args.control or run['event'] != 'workflow_dispatch'
                    or run['run_attempt'] != 1 or run['head_branch'] != 'main'
                    or run['path'] != '.github/workflows/stage-engine-release.yml'
                    or run['repository']['full_name'].lower() != args.repo.lower()
                    or run['head_repository']['full_name'].lower() != args.repo.lower()):
                raise ValueError('owner selection requires original protected Stage dispatch')
            try:
                owner = reader.owner_selection_policy(args.control, args.control, args.owner_window, report['cutoffEpoch'])
                report['ownerExpiresEpoch'] = int(epoch(owner['expiresAt']))
            except reader.Unqualified as error:
                raise ValueError(str(error)) from error
            report['ownerWindowId'] = args.owner_window
        else:
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
