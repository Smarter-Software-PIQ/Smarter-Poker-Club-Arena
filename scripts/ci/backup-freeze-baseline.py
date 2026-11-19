#!/usr/bin/env python3
"""Name the one engine build the 04:00 cutover can ship tonight, and say
whether the Backup has certified it against tonight's frozen production.

THE 04:00 CUTOVER MISSED FOUR MORNINGS IN A ROW (incident 076ff467,
EngineCutoverMissed, 2026-11-16..19). Every daily-engine-selection artifact
said "keep-serving": each certified candidate was refused by the contents
judge (server/scripts/engine-release-installed-migrations.py judge):

  * candidates certified before the last pre-freeze install carried a Backup
    copy that "lacks installed migration ..." production installed after the
    copy was restored;
  * candidates merged inside the nightly release schema freeze
    (scripts/ci/merged-migration-dispatch.mjs RELEASE_SCHEMA_FREEZE_CHICAGO,
    00:45-04:15 Chicago since #11413) carry migrations the freeze holds out of
    production, so "Backup copy lacks the exact candidate migration(s) ...".

#11413 moved the freeze to 00:45 so a migration merged before it reaches a
certified copy. That still needs the right commit certified on a copy taken
after the freeze began, and nothing guarantees it: a push run is SUPERSEDED
by any newer push and RETARGETED to main's newest server commit, so the first
merge inside the freeze replaces the pre-freeze candidate's run with one for
a commit the freeze makes unshippable. This reader names the pre-freeze
candidate and the plan job certifies it once per night, never superseded.

The one build that passes both is the newest main server commit merged before
the freeze began (every migration it carries is installed, and production
cannot move again until after the cutover), certified against a copy restored
AFTER the freeze began. Nothing produced that certificate: the only run meant
to (the "00:01 Chicago nightly" schedule of backup-engine.yml) was delivered by
GitHub 7 to 10 hours late on every day checked (2026-11-12..19, earliest
12:06 UTC), so it never ran before the 03:30 selection.

This reader only READS (GitHub GETs) and prints for the plan job:

  state=outside    not inside tonight's certification window; plan as before
  state=due        baseline=<sha> must be certified now, refresh forced
  state=done       baseline=<sha> already holds a success certificate written
                   after tonight's freeze began; plan as before
  state=unknown    could not tell; plan exactly as before (CLAUDE.md 10.86)

The certification window is [freeze start, selection - one worst Backup run):
a run started inside it finishes before the 03:30 selection reads
(DAILY_SELECTION_CHICAGO and BACKUP_CERTIFICATE_WORST_MINUTES / 2, read from
the dispatcher's own source).

The baseline is the newest first-parent main commit touching server/ that was
committed at least SETTLE before the freeze began, so a migration merged in
the last minutes before the freeze has been installed before it is relied on
(Apply Merged Migration installs about 2 to 22 minutes after a merge).
Pinned by tests/the-four-am-build-is-certified-against-the-frozen-copy.law.test.ts.
"""
import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, time as dtime
from zoneinfo import ZoneInfo

CHICAGO = ZoneInfo('America/Chicago')
SETTLE = timedelta(minutes=30)
FREEZE_SOURCE = 'scripts/ci/merged-migration-dispatch.mjs'
CONTEXT = 'backup-engine/certified'


def clock_of(text):
    """(freeze start (h, m), certify-by (h, m)) from the dispatcher's own source."""
    m = re.search(r'RELEASE_SCHEMA_FREEZE_CHICAGO\s*=\s*\{\s*from:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]', text)
    s = re.search(r'DAILY_SELECTION_CHICAGO\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]', text)
    w = re.search(r'BACKUP_CERTIFICATE_WORST_MINUTES\s*=\s*(\d+)', text)
    if not (m and s and w):
        raise ValueError('dispatcher release clock not found')
    sel = int(s[1]) * 60 + int(s[2]) - int(w[1]) // 2
    return (int(m[1]), int(m[2])), (sel // 60, sel % 60)


def window(now_utc, start_hm, by_hm):
    """(freeze_start_utc, inside) for the night containing now. The freeze
    starts after midnight (00:45), so the window is one span of one date."""
    local = now_utc.astimezone(CHICAGO)
    start_t, by_t = dtime(*start_hm), dtime(*by_hm)
    if not (start_t <= local.time() < by_t):
        return None, False
    start = datetime.combine(local.date(), start_t, CHICAGO)
    return start.astimezone(ZoneInfo('UTC')), True


def decide(now_utc, clock, baseline_reader, certified_after):
    start, inside = window(now_utc, *clock)
    if not inside:
        return {'state': 'outside'}
    baseline = baseline_reader(start - SETTLE)
    if not baseline or not re.fullmatch(r'[0-9a-f]{40}', baseline):
        return {'state': 'unknown', 'why': 'baseline unreadable'}
    done = certified_after(baseline, start)
    if done is None:
        return {'state': 'unknown', 'why': 'certificate unreadable', 'baseline': baseline}
    return {'state': 'done' if done else 'due', 'baseline': baseline,
            'freezeStart': start.strftime('%Y-%m-%dT%H:%M:%SZ')}


def gh(*args):
    return subprocess.run(['gh', 'api', *args], capture_output=True, text=True, timeout=60, check=True).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    ap.add_argument('--now', help='ISO UTC instant (tests)')
    a = ap.parse_args()
    now = datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now else datetime.now(ZoneInfo('UTC'))
    try:
        src = gh('-H', 'Accept: application/vnd.github.raw', f'repos/{a.repo}/contents/{FREEZE_SOURCE}?ref=main')
        clock = clock_of(src)

        def baseline_reader(until):
            out = gh(f'repos/{a.repo}/commits?sha=main&path=server&per_page=1&until='
                     + until.strftime('%Y-%m-%dT%H:%M:%SZ'), '--jq', '.[0].sha // ""')
            return out.strip()

        def certified_after(sha, start):
            rows = json.loads(gh(f'repos/{a.repo}/commits/{sha}/statuses?per_page=100'))
            for r in rows:
                if r.get('context') == CONTEXT and r.get('state') == 'success':
                    at = datetime.fromisoformat(r['created_at'].replace('Z', '+00:00'))
                    if at >= start:
                        return True
            return False

        verdict = decide(now, clock, baseline_reader, certified_after)
    except Exception as error:  # noqa: BLE001 - every unreadable answer is unknown
        verdict = {'state': 'unknown', 'why': str(error)[:200]}
    for k, v in verdict.items():
        print(f'{k}={v}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
