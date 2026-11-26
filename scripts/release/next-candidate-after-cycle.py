#!/usr/bin/env python3
"""A cycle that did not seal starts the next one (O27, 2026-11-25).

After a seal the receiver starts "Backup after seal", whose completion is the
next cycle's election trigger (O24/O25). After a kept-serving cycle, or a
selected cycle whose receiver did not seal, nothing did: GitHub delivered 8 of
Stage's 96 scheduled runs a day on 2026-11-24/25, so the next cycle was
prepared only if somebody happened to push inside its window. On 2026-11-25
the 07:00 Chicago cycle kept serving and the 10:00 cycle had no Stage run at
all.

The Stage run that owned the cycle therefore waits ONCE, until the cycle start
plus WAIT_AFTER_START_MINUTES (after the post-cutover migration window opens at
+10 and the nightly freeze releases at 04:15), reads the serving engine and,
when the cycle did not seal, starts one Backup certification of main titled
"Backup after keep-serving <cycle>". It certifies on a fresh copy (refresh
forced) and completes about 60 to 70 minutes later, inside the next cycle's
election window [next - 130m, next - 30m) = [start + 50m, start + 150m), where
its successful completion is admitted exactly like a push Backup.

This script only decides. It never dispatches anything itself.

  plan    --cycle YYYY-MM-DD[THH] [--now EPOCH]
          prints wait=<seconds> target=<epoch> (or refuses when the target is
          not ahead within MAX_WAIT_MINUTES and not just past)
  decide  --selected true|false --selection-serving SHA --live-serving SHA|unknown
          prints dispatch=true|false and reason=<text>
"""
import argparse
import re
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

CHICAGO = ZoneInfo('America/Chicago')
WAIT_AFTER_START_MINUTES = 25
# Stage claims at most 100 minutes before the cutoff and the cutoff is the
# cycle start minus 30, so an owner is never more than 155 minutes ahead of
# start + 25. The job's own timeout bounds what it may sleep.
MAX_WAIT_MINUTES = 70
# A target missed by less than this (a slow runner) still dispatches at once.
LATE_GRACE_MINUTES = 30
SHA = re.compile(r'^[0-9a-f]{40}$')


def cycle_start(cycle: str) -> int:
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2})(?:T(\d{2}))?', cycle)
    if not match:
        raise ValueError(f'cycle must be YYYY-MM-DD or YYYY-MM-DDTHH, got {cycle!r}')
    day, hour = match.group(1), match.group(2)
    local = datetime.strptime(f'{day} {hour or "04"}:00', '%Y-%m-%d %H:%M').replace(tzinfo=CHICAGO)
    return int(local.timestamp())


def plan(cycle: str, now: int) -> tuple[int, int]:
    target = cycle_start(cycle) + WAIT_AFTER_START_MINUTES * 60
    wait = target - now
    if wait > MAX_WAIT_MINUTES * 60:
        raise ValueError(f'target {target} is {wait} s away, more than {MAX_WAIT_MINUTES} minutes')
    if wait < -LATE_GRACE_MINUTES * 60:
        raise ValueError(f'target {target} passed {-wait} s ago; this run no longer starts the next cycle')
    return max(wait, 0), target


def decide(selected: bool, selection_serving: str, live_serving: str) -> tuple[bool, str]:
    if not SHA.fullmatch(selection_serving or ''):
        # The selection always records the serving engine it read; without it
        # this run cannot tell a seal from a kept cycle (CLAUDE.md 10.86).
        if not selected:
            return True, 'kept serving; the selection recorded no serving SHA, so the next cycle is started anyway'
        return False, 'could not tell: the selection recorded no serving SHA'
    if not SHA.fullmatch(live_serving or ''):
        if not selected:
            return True, 'kept serving; live /health was unreadable, the selection already decided no seal'
        return False, 'could not tell: live /health was unreadable after a selected cycle'
    if live_serving != selection_serving:
        return False, f'the cycle sealed {live_serving[:12]}; the post-seal Backup starts the next cycle'
    if selected:
        return True, f'selected but did not seal; {live_serving[:12]} still serves'
    return True, f'kept serving {live_serving[:12]}'


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('plan')
    p.add_argument('--cycle', required=True)
    p.add_argument('--now', type=int)
    d = sub.add_parser('decide')
    d.add_argument('--selected', choices=['true', 'false'], required=True)
    d.add_argument('--selection-serving', default='')
    d.add_argument('--live-serving', default='')
    args = parser.parse_args()
    try:
        if args.command == 'plan':
            wait, target = plan(args.cycle, args.now if args.now is not None else int(time.time()))
            print(f'wait={wait}')
            print(f'target={target}')
        else:
            dispatch, reason = decide(args.selected == 'true', args.selection_serving, args.live_serving)
            print(f'dispatch={"true" if dispatch else "false"}')
            print(f'reason={reason}')
    except ValueError as error:
        print(f'refused: {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
