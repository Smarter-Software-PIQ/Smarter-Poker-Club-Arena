#!/usr/bin/env python3
"""Tell the release owner that an open owner window is ready. Never start it.

PHASE 3 (owner order 2026-11-09): "Phase 3 must notify the release owner
without dispatching." A booked owner window used to sit idle until someone
noticed it (November 7 expired unused; November 8 18:20Z idled about seventy
minutes). The first fix dispatched the explicit owner selection itself, and that
broke the standing rule that no timer, watcher or scheduled agent may initiate,
retry or certify a release. This decision only READS and returns a notice for the
release owner, who then starts the explicit finite owner selection by hand
(docs/ENGINE-RELEASE-RUNBOOK.md). The pinned nov7-owner validator, the selector,
the receiver and the host's single-use claim still decide everything after that.

It reuses scripts/ci/select-daily-engine.py read-only (its git, GitHub and
selection readers) and changes no release-control input.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time as clock
import types
import zipfile

spec = importlib.util.spec_from_file_location('selector', Path(__file__).with_name('select-daily-engine.py'))
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)
git, api, epoch, command = selector.git, selector.api, selector.epoch, selector.command

OWNER_NOTICE_LEAD_SECONDS = 20 * 60  # tests/a-booked-window-gives-players-notice.law.test.ts
OWNER_ANNOUNCEMENT_BAND = (330, 2940)  # engine-release-seal.py require_nov7_reservation_authority
OWNER_WINDOW_SECONDS = 420  # announcement + 420 s must fit before the window closes
OWNER_TITLE = 'Owner engine window '  # stage-engine-release.yml run-name of the manual owner selection
ISSUE_TITLE = 'Owner Window {} Is Ready To Start'
MARKER = '<!-- owner-window-ready:{} -->'
BOT = 'github-actions[bot]'
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
    """The actual public notice the runbook requires the release owner to verify."""
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
    """The exact protected admission the manual owner route applies first."""
    spec = importlib.util.spec_from_file_location('qualification', Path(__file__).with_name('read-engine-prequalification.py'))
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    try:
        reader.owner_selection_policy(control, control, owner, now)
    except (reader.Unqualified, subprocess.CalledProcessError) as error:
        return str(error) or 'refused'
    return None


def already_told(repo, owner, key):
    """The open issue for this window, and whether it already carries this evidence."""
    title = ISSUE_TITLE.format(owner)
    issues = [i for i in api(f'repos/{repo}/issues?state=all&creator=github-actions%5Bbot%5D&per_page=100')
              if i.get('title') == title and 'pull_request' not in i]
    marker = MARKER.format(key)
    told = False
    for issue in issues:
        if marker in (issue.get('body') or ''):
            told = True
        elif issue.get('comments'):
            told = told or any(marker in (c.get('body') or '') for c in
                               api(f'repos/{repo}/issues/{issue["number"]}/comments?per_page=100'))
    open_issue = next((i['number'] for i in issues if i.get('state') == 'open'), None)
    return open_issue, told


def decide(args):
    """Read-only: is the open owner window ready, and has its owner been told?"""
    now = int(clock.time())
    decision = {'schema': 1, 'notify': False, 'ownerWindowId': None, 'evaluatedAt': now}

    def hold(reason, **extra):
        decision.update(reason=reason, **extra)
        return decision
    try:
        control = args.control
        floor = json.loads(git('show', control + ':server/release/activation-floor.json'))
        owner = floor.get('ownerWindowId')
        if floor.get('schema') != 'engine-release-activation-floor/v2-owner-window' or not owner:
            return hold('no owner window is booked')
        decision['ownerWindowId'] = owner
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', owner):
            return hold('owner window identity is invalid')
        orders = json.loads(git('show', control + ':server/release/owner-maintenance-windows.json'))
        matches = [w for w in orders.get('windows', []) if w.get('id') == owner]
        if len(matches) != 1:
            return hold('the owner order for this window is unavailable')
        window = matches[0]
        opens = max(epoch(window['notBefore']), epoch(floor['activationAt']))
        closes = min(epoch(window['notAfter']), epoch(floor['expiresAt']))
        if now < opens:
            return hold('the owner window has not opened')
        if now >= closes:
            return hold('the owner window has closed')
        if now + OWNER_WINDOW_SECONDS > closes:
            return hold('the announcement and cutover no longer fit before the window closes')
        refused = owner_admission(control, owner, now)
        if refused:
            return hold(f'the protected owner admission refuses this window now: {refused}')
        why = notice_refusal(args.repo, window, now)
        if why:
            return hold(why)
        serving = fetch_json(ENGINE_HEALTH).get('releaseSha')
        if not isinstance(serving, str) or not re.fullmatch('[0-9a-f]{40}', serving):
            return hold('the live engine release is unreadable')
        if contains(window['contains'], serving):
            return hold('this window already has its release serving')
        listing = api(f'repos/{args.repo}/actions/workflows/stage-engine-release.yml/runs?event=workflow_dispatch'
                      f'&created=%3E%3D{window["notBefore"]}&per_page=100')
        if any(r['status'] != 'completed' and r.get('display_title') == OWNER_TITLE + owner
               for r in listing['workflow_runs']):
            return hold('an owner selection for this window is already running')
        receivers = api(f'repos/{args.repo}/actions/workflows/auto-deploy-hetzner.yml/runs?event=repository_dispatch&per_page=30')
        if any(r['status'] != 'completed' and str(r.get('display_title', '')).startswith('Engine Release ')
               for r in receivers['workflow_runs']):
            return hold('an engine receiver is already running')
        report = {'cutoffEpoch': now, 'ownerExpiresEpoch': int(epoch(floor['expiresAt'])), 'deferredCandidates': []}
        selector.select(types.SimpleNamespace(repo=args.repo, control=control, serving=serving, owner_window=owner), report)
        if report.get('outcome') != 'selected':
            return hold('no protected candidate has complete current evidence',
                        deferredCandidates=report['deferredCandidates'])
        runs = [report['backup']['runId'], report['qualification']['qualificationRunId']]
        key = f'{owner}:{report["targetSha"]}:{runs[0]}:{runs[1]}'
        decision.update(candidateSha=report['targetSha'], servingSha=serving, evidenceRunIds=runs)
        issue, told = already_told(args.repo, owner, key)
        if told:
            return hold('the release owner was already told about this evidence', issue=issue)
        second = now % 3600
        band = OWNER_ANNOUNCEMENT_BAND[0] <= second <= OWNER_ANNOUNCEMENT_BAND[1]
        closing = datetime.fromtimestamp(closes, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        decision.update(notify=True, issue=issue, title=ISSUE_TITLE.format(owner),
                        reason='the open owner window is ready for its release owner',
                        body='\n'.join([
                            MARKER.format(key),
                            f'Owner window `{owner}` is open and its evidence is ready.',
                            '',
                            f'- Candidate: `{report["targetSha"]}`',
                            f'- Serving: `{serving}`',
                            f'- Backup run {runs[0]}, prequalification run {runs[1]}',
                            f'- Window closes: {closing} (announcement plus cutover need {OWNER_WINDOW_SECONDS} s)',
                            '- Announcement band :05:30-:49:00 ' + ('is open now.' if band else 'opens at the next :05:30.'),
                            '',
                            'Nothing has been started. The release owner starts the explicit finite owner selection',
                            'by hand (docs/ENGINE-RELEASE-RUNBOOK.md, "Explicit finite owner selection"); every gate',
                            'after that is the route\'s own.',
                        ]))
        return decision
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        return hold(f'owner window readiness is unreadable: {error}')


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--repo', required=True)
    parser.add_argument('--control', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    Path(args.output).write_text(json.dumps(decide(args), indent=2) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
