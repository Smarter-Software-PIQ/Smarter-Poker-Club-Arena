#!/usr/bin/env python3
"""Read certificate contents and measured Backup time for the existing evening report."""
import argparse
import hashlib
import importlib.util
import io
import json
import re
import subprocess
import zipfile
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from statistics import median
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('installed', ROOT / 'server/scripts/engine-release-installed-migrations.py')
installed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installed)
BACKUP = '.github/workflows/backup-engine.yml'
LIMIT = 4_000_000
UNKNOWN = 'UNKNOWN'


def get(repo, path, binary=False):
    data = subprocess.check_output(['gh', 'api', '--method', 'GET', f'repos/{repo}/{path}'], timeout=25)
    return data if binary else json.loads(data)


def when(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.utcoffset() is None:
        raise ValueError('timestamp lacks timezone')
    return result


def next_cutoff(now):
    local = now.astimezone(ZoneInfo('America/Chicago'))
    day = local.date() + timedelta(days=local.time() >= time(3, 30))
    return datetime.combine(day, time(3, 30), local.tzinfo).astimezone(timezone.utc)


def target_run(repo, entry):
    url = (entry.get('certificate') or {}).get('targetUrl') or ''
    match = re.fullmatch(r'https://github\.com/' + re.escape(repo) + r'/actions/runs/([1-9]\d*)', url)
    return int(match[1]) if match else None


def certificate(repo, run_id, sha):
    run = get(repo, f'actions/runs/{run_id}')
    if (run['id'] != run_id or run['path'] != BACKUP or run['head_branch'] != 'main'
            or run['conclusion'] != 'success'):
        raise ValueError('status does not identify a successful Backup run on main')
    name = f'backup-certificate-{sha}-{run["run_attempt"]}'
    listing = get(repo, f'actions/runs/{run_id}/artifacts?name={name}&per_page=2')
    matches = listing['artifacts']
    if listing['total_count'] != 1 or len(matches) != 1:
        raise ValueError('physical certificate for this target and attempt is unavailable')
    artifact = matches[0]
    if artifact['name'] != name or artifact['expired'] or not 0 < artifact['size_in_bytes'] <= LIMIT:
        raise ValueError('certificate artifact expired or invalid')
    data = get(repo, f'actions/artifacts/{int(artifact["id"])}/zip', True)
    if len(data) > LIMIT or 'sha256:' + hashlib.sha256(data).hexdigest() != artifact['digest']:
        raise ValueError('certificate archive digest mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as bundle:
        if len(bundle.namelist()) != len(set(bundle.namelist())) or sum(x.file_size for x in bundle.infolist()) > LIMIT:
            raise ValueError('certificate archive invalid')
        cert = json.loads(bundle.read('certificate.json'))
        compat = json.loads(bundle.read('compatibility.json'))
        evidence = bundle.read('schema-evidence.json')
    db = cert['database']
    if (cert['sha'] != sha or compat['targetSha'] != sha or cert['verdict'] != 'pass'
            or db.get('schemaEvidenceValidated') is not True or db.get('restoreValidated') is not True):
        raise ValueError('certificate does not bind the exact target and validated restore')
    bound = installed.bound_evidence(evidence, db['schemaEvidenceSha256'], db['dumpSha256'])
    return installed.rows_of(bound['migrations']), run['head_sha']


def candidate_missing(required, production):
    return [{'version': v, 'name': n} for v, n in sorted(required.items()) if production.get(v) not in (n, n[:55])]


def missing(production, copy):
    diff = installed.compare(copy, production)
    return dict(missingInBackup=[
        {'version': v, 'name': production[v]} for v in diff['missing']], extraInBackup=diff['extra'],
        renamedInBackup=diff['differs'])


def jobs(repo, run_id):
    # The unversioned jobs endpoint defaults to the latest attempt.
    page = get(repo, f'actions/runs/{run_id}/jobs?per_page=100')
    if page['total_count'] != len(page['jobs']):
        raise ValueError('incomplete Backup job list')
    return {j['name']: j for j in page['jobs']}


def timing(repo, runs, walked, now):
    cutoff = next_cutoff(now)
    result = dict(cutoffUtc=cutoff.isoformat(), minutesToCutoff=round((cutoff-now).total_seconds()/60, 1),
                  state=UNKNOWN, samples=[])
    active = [r for r in runs if r['status'] == 'in_progress']
    if len(active) != 1:
        result['reason'] = 'no single executing Backup run'
        return result
    active = active[0]
    linked = [w['sha'] for w in walked if w['certified'] == 'pending' and target_run(repo, w) == active['id']]
    result.update(runId=active['id'], runUrl=active['url'], workflowHead=active['headSha'],
                  targetSha=linked[0] if len(linked) == 1 else None)
    current = jobs(repo, active['id'])
    # Compare elapsed time from the same phase start. Completed/short inherited
    # plans never supply baseline durations. Queue or plan time is not a soak.
    phase = next((p for p in ('certify', 'refresh') if current.get(p, {}).get('status') == 'in_progress'), None)
    if not phase:
        result['reason'] = 'Backup refresh/certification has not started'
        return result
    refreshing = lambda rows: any(s['name'] == 'Ship to the standby host and restore' and
                                  s.get('conclusion') == 'success' for s in rows.get('refresh', {}).get('steps', []))
    for r in runs:
        if r['conclusion'] != 'success' or r['status'] != 'completed':
            continue
        history = jobs(repo, r['id'])
        certified = history.get('certify', {})
        if certified.get('conclusion') != 'success' or not any(
                s['name'] == 'Build, boot, crash, soak and judge on the Backup Engine' and s.get('conclusion') == 'success'
                for s in certified.get('steps', [])):
            continue
        if phase == 'refresh' and not refreshing(history):
            continue
        seconds = (when(certified['completed_at']) - when(history[phase]['started_at'])).total_seconds()
        if seconds > 0:
            result['samples'].append({'runId': r['id'], 'seconds': seconds})
        if len(result['samples']) == 3:
            break
    if not result['samples']:
        result['reason'] = 'no comparable completed physical Backup in recent history'
        return result
    finish = when(current[phase]['started_at']) + timedelta(seconds=median(s['seconds'] for s in result['samples']))
    if finish <= now:
        result['reason'] = 'active phase already exceeds measured median'
        return result
    result.update(state='estimated', phase=phase, estimatedFinishUtc=finish.isoformat(),
                  marginMinutes=round((cutoff-finish).total_seconds()/60, 1))
    return result


def report(plan):
    repo = plan['repo']
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
        raise ValueError('invalid repository')
    walked = (plan.get('walk') or {}).get('walked', [])
    lane = plan['backupLane']
    now = when(plan['generatedAt'])
    result = {'state': UNKNOWN}
    try:
        if lane['state'] == UNKNOWN:
            raise ValueError(lane['reason'])
        result['timing'] = timing(repo, lane.get('runs', []), walked, now)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        result['timing'] = {'state': UNKNOWN, 'reason': str(exc), 'cutoffUtc': next_cutoff(now).isoformat()}
    try:
        sha = (plan.get('walk') or {}).get('candidate')
        if not sha:
            raise ValueError('no certified candidate identified in the report')
        entry = next(w for w in walked if w['sha'] == sha)
        run_id = target_run(repo, entry)
        result.update(targetSha=sha, certificateRunId=run_id,
                      certificateUrl=entry['certificate']['targetUrl'] if run_id else None)
        if plan['queue']['state'] == UNKNOWN:
            raise ValueError(plan['queue']['reason'])
        rows = plan['queue']['installedRows']
        production = installed.rows_of(rows)
        required = installed.required_by(str(ROOT), plan['production']['releaseSha'], sha, installed.window_versions(str(ROOT), sha))
        result['candidateMissingInProduction'] = candidate_missing(required, production)
        if not run_id:
            raise ValueError('certificate has no attributable Backup run')
        copy, head = certificate(repo, run_id, sha)
        result.update(workflowHead=head, **missing(production, copy))
        result['state'] = 'mismatch' if any(result[k] for k in ('candidateMissingInProduction','missingInBackup','extraInBackup','renamedInBackup')) else 'matched'
    except (OSError, ValueError, KeyError, TypeError, StopIteration, zipfile.BadZipFile, subprocess.SubprocessError) as exc:
        result['reason'] = str(exc)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(report(json.loads(args.snapshot.read_text()))))
