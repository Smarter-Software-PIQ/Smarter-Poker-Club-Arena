#!/usr/bin/env python3
"""Verify a recovered seal and prepare a separate report; never mutate a release."""
import argparse
import hashlib
import json
import re
from pathlib import Path


def build_report(repo, run, seal, runtime, health, reporter_url):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('invalid repository')
    key = f"{run['id']}-{run['run_attempt']}"
    title = re.fullmatch(r'Engine Release ([0-9a-f]{40})', run.get('display_title', ''))
    if (not title or run.get('path') != '.github/workflows/auto-deploy-hetzner.yml'
            or run.get('status') != 'completed' or run.get('conclusion') != 'failure'):
        raise ValueError('original must be a completed failed engine receiver')
    sha = title[1]
    original_url = f"https://github.com/{repo}/actions/runs/{run['id']}/attempts/{run['run_attempt']}"
    if run.get('html_url') != f"https://github.com/{repo}/actions/runs/{run['id']}":
        raise ValueError('original repository mismatch')
    if not re.fullmatch(rf'https://github.com/{re.escape(repo)}/actions/runs/[0-9]+/attempts/[0-9]+', reporter_url):
        raise ValueError('invalid reporting run URL')
    if (seal.get('schema') != 1 or seal.get('result') != 'sealed'
            or seal.get('runId') != key or seal.get('sha') != sha
            or not re.fullmatch(r'[0-9a-f]{64}', seal.get('containerId', ''))
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', seal.get('imageId', ''))
            or not re.fullmatch(r'[0-9a-f]{32}', seal.get('completionRuntime', {}).get('invocationId', ''))):
        raise ValueError('seal does not bind the original run, SHA and runtime')
    completion = seal['completionRuntime']
    for field in ('containerId', 'instanceId', 'startedAt'):
        if not seal.get(field) or completion.get(field) != seal[field]:
            raise ValueError(f'inconsistent sealed completion {field}')
    if health.get('status') != 'ok' or not re.fullmatch(r'[0-9a-f]{40}', health.get('releaseSha', '')):
        raise ValueError('fresh serving identity is unavailable')
    currently_serving = health['releaseSha'] == sha and health.get('instanceId') == seal['instanceId']
    if currently_serving and (runtime.get('Id') != seal['containerId'] or runtime.get('Image') != seal['imageId']
            or runtime.get('State', {}).get('StartedAt') != seal['startedAt']
            or runtime.get('State', {}).get('Running') is not True
            or health.get('leadership', {}).get('holder') != seal['instanceId']
            or health.get('maintenance', {}).get('active') is not False
            or health.get('maintenance', {}).get('phase') != 'idle'):
        raise ValueError('current container or thaw differs from the claimed serving seal')
    report = dict(schema='club-arena-recovered-seal-report/v1', originalRunId=key,
                  originalConclusion='failure', originalRunUrl=original_url,
                  reportingRunUrl=reporter_url, targetSha=sha, result='recovered-seal-verified',
                  instanceId=seal['instanceId'], containerId=seal['containerId'],
                  invocationId=completion['invocationId'], seal=seal,
                  sealSHA256=hashlib.sha256(json.dumps(seal, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                  historyPreserved=True, releaseMutation=False, currentlyServing=currently_serving,
                  observedServingSha=health['releaseSha'], observedInstanceId=health.get('instanceId'))
    summary = (f"## Recovered seal verified\n\n"
               f"[Original failed Actions attempt]({original_url}) remains **failure**. "
               f"This separate [reporting run]({reporter_url}) verified its sealed result; "
               "it does not change the original conclusion or append-only failure receipt.\n\n"
               f"- Original operation: `{key}`\n- Historical sealed SHA: `{sha}`\n"
               f"- Instance: `{seal['instanceId']}`\n- Container: `{seal['containerId']}`\n"
               f"- Completion invocation: `{completion['invocationId']}`\n"
               f"- Currently serving this sealed instance: `{currently_serving}`.\n"
               f"- Observed serving SHA: `{health['releaseSha']}` (instance `{health.get('instanceId')}`).\n"
               "- A historical recovered seal is not a claim about a newer release.\n"
               "- Reporting only: no engine restart, release retry, database write or payment replay.\n")
    check = dict(name='Recovered Engine Release Seal', head_sha=sha,
                 external_id=f'recovered-engine-release:{key}', details_url=reporter_url,
                 status='completed', conclusion='success',
                 output=dict(title=f'Recovered seal for failed Actions attempt {key}', summary=summary))
    return report, summary, check


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--repo', required=True)
    p.add_argument('--reporter-url', required=True)
    p.add_argument('--directory', required=True, type=Path)
    a = p.parse_args()
    inputs = [json.loads((a.directory / f'{name}.json').read_text()) for name in ('original', 'seal', 'runtime', 'health')]
    report, summary, check = build_report(a.repo, *inputs, a.reporter_url)
    for name, value in [('report', report), ('check', check)]:
        (a.directory / f'{name}.json').write_text(json.dumps(value, indent=2) + '\n')
    (a.directory / 'summary.md').write_text(summary)
