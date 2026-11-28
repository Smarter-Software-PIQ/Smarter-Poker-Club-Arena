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
"Backup after keep-serving <cycle> <nonce>" on a fresh copy (refresh forced).

O27b (2026-11-26), what was not true in O27 and the arithmetic that is:

  * The dispatch is sent with the job token. Backup refused it on every
    secret-holding job, so run 45775146770 skipped refresh and certify and
    still ended green in nine seconds. Stage now records the exact intent
    first (scripts/ci/dispatch-intent.mjs, operation
    backup-after-keep-serving) and Backup proves it, so the run certifies.
  * GitHub creates no workflow_run event for a run the job token started
    (nine of nine job-token Backup runs, 2026-11-24 to 2026-11-26). The
    completion of this Backup therefore does NOT start the next election;
    a push to main, a delivered schedule or a Backup completion a person
    or a push started still does. What this run gives the next cycle is a
    fresh certificate, in time:

      next cutoff            = next start - 30m  = start + 150m
      election window        = [next start - 130m, next start - 30m)
                             = [start + 50m, start + 150m)
      dispatch               = start + 25m (WAIT_AFTER_START_MINUTES)
      certification          = plan 1m + refresh 15m + certify 55m = 71m
      certificate written    = start + 96m, 54m before the cutoff
      latest useful duration = 124m (start + 149m)

    A run that ends in under 25 minutes certified nothing (refused,
    deferred or failed); it is never a certificate that arrived early.
    Should a person start the same titled run by hand, its completion is a
    workflow_run GitHub does create, and it lands inside the election
    window exactly when the run took 25 to 124 minutes, which every real
    certification does.

The estate App starts the next cycle (2026-11-27). Stage now sends that
dispatch as the estate GitHub App (job start-backup-as-estate-app), and a run
the App starts raises workflow_run like a person's, so the completion of a
real certification lands inside the election window above and elects. When no
App token can be had the dispatch goes out with the job token as before, and
then, as O27b says, its completion does NOT start the next election. A run
that ends before the window opens (it planned nothing, or handed the Backup
host back) elects nothing under either identity.

This script only decides. It never dispatches anything itself.

  plan    --cycle YYYY-MM-DD[THH] [--now EPOCH]
          prints wait=<seconds> target=<epoch> (or refuses when the target is
          not ahead within MAX_WAIT_MINUTES and not just past)
  decide  --selected true|false --selection-serving SHA --live-serving SHA|unknown
          prints dispatch=true|false and reason=<text>
  note    --cycle C --selected true|false --selection daily-selection.json
          prints note=<one plain line for the owner's Messenger>, or nothing
          when the cycle had nothing new to ship
"""
import argparse
import json
import re
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

CHICAGO = ZoneInfo('America/Chicago')
WAIT_AFTER_START_MINUTES = 25
# The arithmetic of the docstring, pinned by the law test: a three-hourly
# cycle's next cutoff and election window measured from this cycle's start,
# and what one real certification takes (plan 1, refresh 15, certify 55).
NEXT_CUTOFF_AFTER_START_MINUTES = 150
ELECTION_OPENS_AFTER_START_MINUTES = 50
CERTIFICATION_MINUTES = 71
# Stage claims at most 100 minutes before the cutoff and the cutoff is the
# cycle start minus 30, so an owner is never more than 155 minutes ahead of
# start + 25. This job starts only after the owner's selection, which runs at
# the cutoff (start - 30m), so its real wait is about 55 minutes; the job's
# own timeout (80) bounds the wait plus the five minutes of reads after it.
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


def cycle_label(epoch: int) -> str:
    local = datetime.fromtimestamp(epoch, CHICAGO)
    return local.strftime('%I:%M %p %Z').lstrip('0')


# Plain reasons, most specific first. Matched against the selection's deferred
# and refused candidates plus its reason (scripts/ci/select-daily-engine.py and
# server/scripts/engine-release-installed-migrations.py wording).
PLAIN_REASONS = (
    ('lacks installed migration', 'a database update landed after the new build was tested'),
    ("does not hold production's definition of", 'a database update landed after the new build was tested'),
    ('lacks the exact candidate migration', 'a database update landed after the new build was tested'),
    ('holds migration production does not have', 'a database update landed after the new build was tested'),
    ('holds a different name for', 'a database update landed after the new build was tested'),
    ('rollback rehearsal unavailable', 'the newest build had been tested against an older engine'),
    ('protected release controls differ', 'release controls changed after the newest build was tested'),
    ('backup certificate is pending', 'the newest build was still finishing its test at the cutoff'),
    ('certified after the selection cutoff', 'the newest build finished its test just after the cutoff'),
    ('finished after the selection cutoff', 'the newest build finished its test just after the cutoff'),
    ('backup engine refused', 'the newest build failed its safety test before the cutoff'),
    ('backup certificate is failure', 'the newest build failed its safety test before the cutoff'),
    ('backup certificate is error', 'the test runner hit an error before finishing the safety test'),
    ('prequalification unavailable', 'the newest build did not pass pre-release checks before the cutoff'),
    ('no newer protected candidate has complete current evidence', 'no new build passed its test in time'),
)


def _classify_reason(text: str) -> str | None:
    lower = text.lower()
    return next((plain for needle, plain in PLAIN_REASONS if needle in lower), None)


def note(cycle: str, selected: bool, selection: dict) -> str:
    start = cycle_start(cycle)
    when, nxt = cycle_label(start), cycle_label(start + 3 * 3600)
    deferred = selection.get('deferredCandidates') or []
    refused = selection.get('refusedCandidates') or []
    reason = str(selection.get('reason') or '')
    if selected:
        why = 'the new build was chosen but the swap did not complete'
    else:
        if reason == 'current' and not deferred:
            return ''
        why = None
        # Deferred candidates all passed Backup certification and hold the most
        # specific post-certification cause (schema drift beats rollback rehearsal).
        deferred_text = ' '.join(
            str(entry.get('reason') or '') for entry in deferred if isinstance(entry, dict)
        )
        if deferred_text:
            why = _classify_reason(deferred_text)
        # Refused candidates are newest-first; classify from the newest candidate
        # first so an older orphaned pending cannot hijack a newer failure.
        if why is None:
            for entry in refused:
                if not isinstance(entry, dict):
                    continue
                matched = _classify_reason(str(entry.get('reason') or ''))
                if matched is not None:
                    why = matched
                    break
        if why is None:
            why = _classify_reason(reason) or 'no new build was ready'
    return (f'Engine cutover at {when} did not happen: {why}. The current engine keeps running, '
            f'and the next build is being tested for the {nxt} cutover.')


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
    n = sub.add_parser('note')
    n.add_argument('--cycle', required=True)
    n.add_argument('--selected', choices=['true', 'false'], required=True)
    n.add_argument('--selection', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'plan':
            wait, target = plan(args.cycle, args.now if args.now is not None else int(time.time()))
            print(f'wait={wait}')
            print(f'target={target}')
        elif args.command == 'note':
            try:
                with open(args.selection, encoding='utf-8') as source:
                    selection = json.load(source)
            except (OSError, json.JSONDecodeError):
                selection = {}
            text = note(args.cycle, args.selected == 'true', selection if isinstance(selection, dict) else {})
            if text:
                print(f'note={text}')
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
