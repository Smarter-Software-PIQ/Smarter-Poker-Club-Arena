#!/usr/bin/env python3
"""A held migration does not block the commit below it (O29, 2026-11-26).

WHY. On 2026-11-25 22:54 CST (2026-11-26 04:54Z) main gained 6f062e8f0d1d,
which adds migration 20261126021630. It merged inside the migration hold
before the 01:00 CST cycle and the nightly release schema freeze, so the
dispatcher would not install it until 04:15 CST. The Backup run for that push
(45758112198) ended with the O7 answer "DEFERRED ... carries uninstalled
ordinary migration(s)". One commit below sat a5e971803865: current release
controls, no uninstalled migration, ahead of the serving build. Nothing
certified it, so the 01:00 CST cycle kept serving and for more than five hours
no commit on main could be certified.

WHAT. Called by the `due` step of .github/workflows/backup-engine.yml when it
is about to hand the host back for held migrations. It answers, once, with the
newest shippable commit that does not carry them:

  first    = the OLDEST first-parent commit between the serving build and the
             run's control that ADDED any pending migration file
  base     = first^ (first parent), or the run's own target when that target
             already sits below `first`
  fallback = the newest first-parent commit at or below `base` touching
             server/ or any CONTROL_INPUTS path (the O13 rule)

and accepts the fallback only when every one of these was READ, not assumed:
it is strictly ahead of the serving build, its release-control projection
equals the control's (the same `projection` the selector compares), and no
migration it carries itself is still uninstalled.

The run's control is never moved: select-daily-engine.py admits a certificate
whose control differs from its producer only for a forward push retarget, so
a run whose control is not its own commit is never stepped down.

Exit codes (CLAUDE.md 10.86, "could not tell" is its own answer):
  0  fallback=<sha> printed; certify it instead
  1  reason=<why> printed; no shippable commit below, hand back as before
  3  reason=<why> printed; a read failed, hand back as before
"""
import argparse
import json
import re
import runpy
import subprocess
import sys
from urllib.request import urlopen

sys.dont_write_bytecode = True

STEP, NONE, UNKNOWN = 0, 1, 3
HEX = re.compile(r'[0-9a-f]{40}')
VERSION = re.compile(r'\d{14}')
MIGRATIONS = 'supabase/migrations'
HEALTH_URL = 'https://engine.smarter.poker/health'


class Unreadable(Exception):
    """A read failed. Never an answer about the commit."""


def decide(*, sha, control, producer, serving, pending, input_sha, git, projection, control_inputs,
           pending_reader):
    """(code, fallback_or_reason). Readers raise Unreadable when they cannot tell.

    git(*args) -> (returncode, stdout); projection(sha) -> str;
    control_inputs() -> list of paths; pending_reader(sha) -> list of versions.
    """
    try:
        return _decide(sha, control, producer, serving, pending, input_sha, git, projection,
                       control_inputs, pending_reader)
    except Unreadable as exc:
        return UNKNOWN, str(exc) or 'a read failed'


def _decide(sha, control, producer, serving, pending, input_sha, git, projection, control_inputs,
            pending_reader):
    if input_sha:
        return NONE, 'an explicit sha input is certified exactly as named'
    if not (HEX.fullmatch(sha or '') and HEX.fullmatch(control or '') and HEX.fullmatch(producer or '')):
        return UNKNOWN, 'the target, control or producer commit is not an exact sha'
    versions = [v for v in (pending or []) if v]
    if not versions:
        return NONE, 'no pending migration was named'
    if any(not VERSION.fullmatch(v) for v in versions):
        return UNKNOWN, 'a pending migration version is not 14 digits'
    if not HEX.fullmatch(serving or ''):
        return UNKNOWN, 'the serving build could not be read'
    if control != producer:
        return NONE, ('this run was retargeted (control %s is not its own commit %s); a stepped-down '
                      'certificate would fail producer provenance' % (control[:12], producer[:12]))

    def ancestor(older, newer):
        code, _ = git('merge-base', '--is-ancestor', older, newer)
        if code not in (0, 1):
            raise Unreadable('git could not compare %s with %s' % (older[:12], newer[:12]))
        return code == 0

    def out(*args):
        code, text = git(*args)
        if code != 0:
            raise Unreadable('git %s failed' % args[0])
        return text.strip()

    if not ancestor(sha, control):
        return NONE, 'the target is not behind this run\'s control'
    if not ancestor(serving, control):
        return NONE, 'the serving build %s is not behind this run\'s control' % serving[:12]
    line = out('rev-list', '--first-parent', '%s..%s' % (serving, control)).split()
    order = {commit: index for index, commit in enumerate(line)}  # 0 is the newest
    first = None
    for version in versions:
        added = out('log', '--first-parent', '--diff-filter=A', '--format=%H', '%s..%s' % (serving, control),
                    '--', '%s/%s_*.sql' % (MIGRATIONS, version)).split()
        if not added:
            return NONE, ('migration %s was not added between the serving build and this run\'s control; '
                          'there is no commit below it to certify' % version)
        oldest = added[-1]
        if oldest not in order:
            raise Unreadable('the commit adding %s is not on the first-parent line' % version)
        if first is None or order[oldest] > order[first]:
            first = oldest
    base = out('rev-parse', '--verify', '--quiet', first + '^1^{commit}')
    if not HEX.fullmatch(base):
        raise Unreadable('the parent of %s could not be read' % first[:12])
    if ancestor(sha, base):
        start = sha  # the target already sits below the held migration
    elif ancestor(base, sha):
        start = base
    else:
        return NONE, 'the target is not on the line below %s' % first[:12]
    paths = [p for p in control_inputs() if p]
    if not paths:
        raise Unreadable('CONTROL_INPUTS could not be read')
    fallback = out('log', '-1', '--first-parent', '--format=%H', start, '--', 'server', *paths)
    if not HEX.fullmatch(fallback):
        return NONE, 'no server or release-control commit exists below %s' % first[:12]
    if fallback == serving or not ancestor(serving, fallback):
        return NONE, ('the newest server or release-control commit below %s is %s, which is not ahead of the '
                      'serving build %s; nothing to ship' % (first[:12], fallback[:12], serving[:12]))
    if projection(fallback) != projection(control):
        return NONE, ('%s, the newest commit below %s, carries release controls that differ from the '
                      'control\'s; it could never be selected' % (fallback[:12], first[:12]))
    still = [v for v in pending_reader(fallback) if v]
    if still:
        return NONE, '%s itself carries uninstalled migration(s) %s' % (fallback[:12], ','.join(still[:5]))
    return STEP, fallback


def serving_release(url=HEALTH_URL, timeout=15):
    """The running engine's exact releaseSha, or '' when it cannot be read."""
    try:
        with urlopen(url, timeout=timeout) as response:  # noqa: S310 - fixed https URL (a file in tests)
            doc = json.loads(response.read().decode('utf-8'))
        value = doc.get('releaseSha') if doc.get('running') is True else ''
    except Exception:  # noqa: BLE001 - unreadable health is unknown, never an answer
        return ''
    return value if isinstance(value, str) and HEX.fullmatch(value) else ''


def real_git(*args):
    try:
        result = subprocess.run(['git', '--no-replace-objects', *args], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        raise Unreadable('git %s could not run (%s)' % (args[0], type(exc).__name__))
    return result.returncode, result.stdout


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--sha', required=True)
    parser.add_argument('--control', required=True)
    parser.add_argument('--producer', required=True, help='the commit this run started on (GITHUB_SHA)')
    parser.add_argument('--serving', default='', help='the sealed build after a seal; empty reads /health')
    parser.add_argument('--health-url', default=HEALTH_URL)
    parser.add_argument('--pending', default='', help='comma-separated pending migration versions')
    parser.add_argument('--input-sha', default='', help='the workflow_dispatch sha input, when one was given')
    parser.add_argument('--prequal', default='scripts/ci/read-engine-prequalification.py')
    parser.add_argument('--installed-tool', default='server/scripts/engine-release-installed-migrations.py')
    parser.add_argument('--production', default='', help='a production JSON file (tests); default: DATABASE_URL')
    args = parser.parse_args(argv)
    module = {}

    def prequal():
        if not module:
            try:
                module.update(runpy.run_path(args.prequal))
            except BaseException as exc:  # noqa: BLE001 - SystemExit included: unreadable, never an answer
                raise Unreadable('%s could not be loaded (%s)' % (args.prequal, type(exc).__name__))
        return module

    def projection(commit):
        try:
            return prequal()['projection'](commit)
        except Unreadable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise Unreadable('the release-control projection of %s is unreadable (%s)'
                             % (commit[:12], type(exc).__name__))

    def control_inputs():
        try:
            return list(prequal()['CONTROL_INPUTS'])
        except (KeyError, TypeError):
            raise Unreadable('CONTROL_INPUTS could not be read')

    def pending_reader(commit):
        # The same O7 read, asked about the fallback's own first-parent line.
        command = [sys.executable, '-B', args.installed_tool, 'refresh-due', '--copy-evidence', '/dev/null',
                   '--control', commit, '--sha', commit, '--wait', '1']
        if args.production:
            command += ['--production', args.production]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.SubprocessError) as exc:
            raise Unreadable('production\'s installed migrations could not be read (%s)' % type(exc).__name__)
        lines = [l for l in result.stdout.splitlines() if l.startswith('pending=')]
        # Unreadable production prints no pending= line: that is "could not tell".
        if result.returncode != 0 or len(lines) != 1:
            raise Unreadable('production\'s installed migrations could not be read for %s' % commit[:12])
        return [v for v in lines[0][len('pending='):].split(',') if v]

    serving = args.serving if HEX.fullmatch(args.serving or '') or args.input_sha else serving_release(args.health_url)
    code, value = decide(sha=args.sha, control=args.control, producer=args.producer, serving=serving,
                         pending=args.pending.split(','), input_sha=args.input_sha, git=real_git,
                         projection=projection, control_inputs=control_inputs, pending_reader=pending_reader)
    print(('fallback=' if code == STEP else 'reason=') + value)
    return code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - any crash is "could not tell"
        print('reason=the step-down reader failed (%s)' % type(exc).__name__)
        sys.exit(UNKNOWN)
