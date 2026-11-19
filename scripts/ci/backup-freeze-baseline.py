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
    23:45-04:15 Chicago) carry migrations the freeze holds out of production,
    so "Backup copy lacks the exact candidate migration(s) ...".

Wherever the freeze starts, the right commit must be certified on a copy
taken after the freeze began, and nothing guaranteed it: a push run is SUPERSEDED
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
a run started inside it finishes before the selection reads (the freeze start
from the dispatcher's own source, the 03:30 cutoff from select-daily-engine.py
cutoff(), BACKUP_RUN_WORST_MINUTES measured).

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
SELECTOR_SOURCE = 'scripts/ci/select-daily-engine.py'
# One Backup run (refresh + certify), measured over the 29 most recent
# successful backup-engine.yml runs on 2026-11-19: min 43.2, p50 62.0,
# p90 67.3, max 68.7 minutes.
BACKUP_RUN_WORST_MINUTES = 70


def clock_of(dispatcher_text, selector_text):
    """(freeze start (h, m), certify-by (h, m)): the freeze start from the
    dispatcher's own source, the selection cutoff from select-daily-engine.py
    cutoff(), less one worst Backup run."""
    m = re.search(r'RELEASE_SCHEMA_FREEZE_CHICAGO\s*=\s*\{\s*from:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]', dispatcher_text)
    c = re.search(r'def cutoff\(day\):\s*\n\s*return .*?time\((\d+),\s*(\d+)\)', selector_text, re.S)
    if not (m and c):
        raise ValueError('release clock not found')
    sel = int(c[1]) * 60 + int(c[2]) - BACKUP_RUN_WORST_MINUTES
    return (int(m[1]), int(m[2])), (sel // 60, sel % 60)


def window(now_utc, start_hm, by_hm):
    """(freeze_start_utc, inside) for the night containing now. The freeze may
    start before midnight (23:45) or after it (00:45); the window wraps
    midnight in the first case, and its start is on the previous date."""
    local = now_utc.astimezone(CHICAGO)
    start_t, by_t, t = dtime(*start_hm), dtime(*by_hm), local.time()
    if start_t <= by_t:
        inside, start_day = start_t <= t < by_t, local.date()
    elif t >= start_t:
        inside, start_day = True, local.date()
    else:
        inside, start_day = t < by_t, local.date() - timedelta(days=1)
    if not inside:
        return None, False
    start = datetime.combine(start_day, start_t, CHICAGO)
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
        raw = lambda path: gh('-H', 'Accept: application/vnd.github.raw', f'repos/{a.repo}/contents/{path}?ref=main')
        clock = clock_of(raw(FREEZE_SOURCE), raw(SELECTOR_SOURCE))

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
