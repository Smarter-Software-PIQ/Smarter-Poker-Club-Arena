#!/usr/bin/env python3
"""Tell a Backup push run where its commit stands against a booked owner window.

THE BOOKED CANDIDATE GOES FIRST (2026-11-14). The Backup host certifies one
commit at a time and a certificate takes about 55 minutes. On the November 14
off-cycle cutover the booked release candidate waited behind an unrelated push,
and the release owner dispatched a manual run of the booking commit as insurance
because a later ordinary push would have SUPERSEDED its own push run.

This reader only READS (GitHub GETs and the public engine /health) and prints
one verdict for the `plan` job of .github/workflows/backup-engine.yml:

  priority=none       no owner engine window is booked on main, or it has
                      closed, or its release is already serving (consumed)
  priority=booking    the window is live and this commit is the first main
                      commit carrying main's release controls (the booking)
  priority=candidate  the window is live and this commit carries main's release
                      controls after the booking commit
  priority=predates   the window is live and this commit's release controls
                      differ from main's, so Stage can never select it while
                      the window is open ("control owner authorization differs")
  priority=unknown    could not tell; the plan job behaves exactly as before

The rules are the ones the release route already applies, not new ones:
  open/closed  scripts/ci/owner-window-ready.py decide(): the floor's
               ownerWindowId names exactly one entry of "windows", and the
               window closes at min(window.notAfter, floor.expiresAt);
  consumed     the same function: the serving release contains window.contains;
  controls     server/scripts/engine-release-activation-floor.py policy(): the
               target's activation-floor.json and owner-maintenance-windows.json
               must equal the control's byte for byte.
An equal pair is necessary for selection, not sufficient; a commit this reader
calls a candidate is simply certified as before.

CLAUDE.md 10.86: every unreadable or malformed answer is `unknown`, never
`none` and never `predates`.
"""
import argparse
from datetime import datetime
import json
import re
import subprocess
import sys
import time

OWNER_SCHEMA = 'engine-release-activation-floor/v2-owner-window'
RELEASE_DIR = 'server/release'
CONTROLS = ('activation-floor.json', 'owner-maintenance-windows.json')
ENGINE_HEALTH = 'https://engine.smarter.poker/health'
SHA = re.compile(r'[0-9a-f]{40}')
STAMP = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z')


class Unknown(Exception):
    """The state could not be read; never folded into a decision."""


def epoch(value):
    if not isinstance(value, str) or not STAMP.fullmatch(value):
        raise Unknown('a window timestamp is not an exact UTC second')
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp())


def gh(path, raw=False):
    """One GitHub GET. Any failure is Unknown."""
    accept = 'application/vnd.github.raw' if raw else 'application/vnd.github+json'
    try:
        out = subprocess.run(['gh', 'api', '-H', 'Accept: ' + accept, path], check=True,
                             capture_output=True, timeout=30).stdout
        return json.loads(out)
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise Unknown(f'GitHub read failed for {path.split("?")[0]}') from error


def health():
    try:
        out = subprocess.run(['curl', '-fsS', '--max-time', '15', ENGINE_HEALTH], check=True,
                             capture_output=True, timeout=30).stdout
        return json.loads(out)
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise Unknown('the live engine release is unreadable') from error


def controls(repo, sha, api):
    """Blob identities of the two release-control files at one commit."""
    listing = api(f'repos/{repo}/contents/{RELEASE_DIR}?ref={sha}')
    if not isinstance(listing, list):
        raise Unknown('the release-control listing is not a directory')
    blobs = {row.get('name'): row.get('sha') for row in listing
             if isinstance(row, dict) and row.get('type') == 'file'}
    pair = tuple(blobs.get(name) for name in CONTROLS)
    if not all(isinstance(blob, str) and SHA.fullmatch(blob) for blob in pair):
        raise Unknown('a release-control file is missing')
    return pair


def decide(repo, sha, now, api=gh, serving=health):
    """Return (priority, window id or '', reason). Raises nothing."""
    try:
        if not SHA.fullmatch(sha or ''):
            raise Unknown('not an exact commit')
        main = api(f'repos/{repo}/commits/main')
        main = main.get('sha') if isinstance(main, dict) else None
        if not isinstance(main, str) or not SHA.fullmatch(main):
            raise Unknown('main is unreadable')
        floor = api(f'repos/{repo}/contents/{RELEASE_DIR}/{CONTROLS[0]}?ref={main}', raw=True)
        if not isinstance(floor, dict):
            raise Unknown('the activation floor is not an object')
        owner = floor.get('ownerWindowId')
        if floor.get('schema') != OWNER_SCHEMA or not owner:
            return 'none', '', 'no owner engine window is booked on main'
        if not isinstance(owner, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', owner):
            raise Unknown('owner window identity is invalid')
        expires = epoch(floor.get('expiresAt'))
        if now >= expires:
            return 'none', owner, 'the owner window has closed'
        orders = api(f'repos/{repo}/contents/{RELEASE_DIR}/{CONTROLS[1]}?ref={main}', raw=True)
        windows = orders.get('windows') if isinstance(orders, dict) else None
        if not isinstance(windows, list):
            raise Unknown('the owner orders are unreadable')
        matches = [w for w in windows if isinstance(w, dict) and w.get('id') == owner]
        if len(matches) != 1:
            raise Unknown('the owner order for this window is unavailable')
        window = matches[0]
        if now >= min(epoch(window.get('notAfter')), expires):
            return 'none', owner, 'the owner window has closed'
        contains = window.get('contains')
        if not isinstance(contains, str) or not SHA.fullmatch(contains):
            raise Unknown('the owner order names no content commit')
        live = serving()
        live = live.get('releaseSha') if isinstance(live, dict) else None
        if not isinstance(live, str) or not SHA.fullmatch(live):
            raise Unknown('the live engine release is unreadable')
        relation = api(f'repos/{repo}/compare/{contains}...{live}')
        relation = relation.get('status') if isinstance(relation, dict) else None
        if relation in ('identical', 'ahead'):
            return 'none', owner, 'this window already has its release serving'
        if relation not in ('behind', 'diverged'):
            raise Unknown('cannot compare the serving release with the owner order')
        wanted = controls(repo, main, api)
        if controls(repo, sha, api) != wanted:
            return 'predates', owner, 'release controls differ from main'
        commit = api(f'repos/{repo}/commits/{sha}')
        parents = commit.get('parents') if isinstance(commit, dict) else None
        if not isinstance(parents, list) or not parents or not isinstance(parents[0], dict):
            raise Unknown('the commit has no readable first parent')
        if controls(repo, parents[0].get('sha') or '', api) != wanted:
            return 'booking', owner, 'first main commit carrying the booked release controls'
        return 'candidate', owner, 'carries the booked release controls after the booking commit'
    except Unknown as error:
        return 'unknown', '', str(error)
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        return 'unknown', '', f'owner window state is unreadable: {error}'


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--repo', required=True)
    parser.add_argument('--sha', required=True)
    args = parser.parse_args()
    priority, window, reason = decide(args.repo, args.sha, int(time.time()))
    print(f'priority={priority}')
    print(f'window={window}')
    print(f'reason={reason}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
