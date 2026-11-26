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
  state=claimed    baseline=<sha> is being certified right now by an active
                   run (its pending status names it); plan as before
  state=unselectable  baseline=<sha> has diverged CONTROL_INPUTS from main
                   and can never pass select-daily-engine.py; plan as before
  state=served     baseline=<sha> is already contained in the serving engine
                   (O17); there is nothing to ship, so plan as before
  state=refused    baseline=<sha> was claimed tonight and its own claim run
                   refused it on a copy restored after the freeze began
                   (O22); certifying it again cannot pass, so plan as before

ONE CERTIFICATION PER BASELINE (incident 076ff467, 2026-11-20). `done` used
to be the only answer that stopped a re-certification, so every push merged
while the baseline's own run was still soaking (1-2 hours) planned `due`
again. On 2026-11-20 the baseline 62520794 was certified at 02:18 Chicago;
two duplicates planned at 02:00 and 02:02 queued behind it, one timed out
waiting for the Backup host turn and published `failure` over the success
at 03:18, and the 03:30 selection, which reads the newest status, found no
certified candidate. A run that is certifying the baseline now is a claim;
the plan job writes that claim (a pending status naming its run) the moment
it answers `due`, so the next planner sees it.
  state=unknown    could not tell; plan exactly as before (CLAUDE.md 10.86)

ZERO-MIGRATION ADVANCE AND CONTROL_INPUTS SELECTABILITY (O6, 2026-11-22).
On 2026-11-22, CONTROL_INPUTS changed after the pre-freeze baseline
(0a3a6a5211db) with zero new migrations (#11703/#11702/#11697/#11701), making
0a3a6a5211db permanently unselectable by select-daily-engine.py (RC=3). Yet
backup-freeze-baseline.py still returned state=due for 0a3a6a5211db and
Backup 45000042601 spent 62 minutes certifying an unselectable commit. Before
checking certification status, this reader now (1) advances the baseline across
any zero-migration prefix on main (strictly before the first commit touching
supabase/migrations/) to the newest first-parent commit touching server/ or any
non-test CONTROL_INPUTS path, and (2) verifies that no non-test CONTROL_INPUTS
path diverged between the resulting baseline and main (returning
state=unselectable instead of wasting a Backup soak). Unreadable or truncated
GitHub API answers fail open to existing behavior (CLAUDE.md 10.86).

A BUILD THE ENGINE ALREADY SERVES IS NOT OWED (O17, 2026-11-23). Under the
three-hourly cadence the 01:00 Chicago cycle seals inside the freeze, so the
serving engine can already contain tonight's baseline (or be newer than it).
The 04:00 selector only walks commits after the serving release, so such a
baseline can never be selected, yet the first push or schedule run of the
night would still claim it, force a refresh and spend a full soak on the one
Backup host. The reader now asks /health for the serving releaseSha and
GitHub's compare whether that release contains the baseline (identical or
ahead), and answers `served` before reading any certificate. An unreadable
health or compare answer is not `served`: it plans exactly as before
(CLAUDE.md 10.86).

A MIGRATION INSTALLED BEFORE THE FREEZE DOES NOT STOP THE ADVANCE (O22,
2026-11-24). Tonight's freeze began 05:45Z. The newest server commit before
freeze start - SETTLE was 329332c24c32 (01:09Z), and the O6 advance stopped
at the very next commit, 7ac45e4bb09f (01:36Z), because it carried a
migration. Six migration commits followed before the freeze (7ac45e4bb09f,
8315292e32f4, f3691fbe6097, bf145233e093, 18a4e2476f40, d749a61e4c94) and
every one of their files was INSTALLED in production before 05:45Z (the last,
20261124041800, APPLIED at 05:25:58Z by Apply Merged Migration 45333181931).
So the reader answered due for 329332c24c32: a 20-hour-old build that the
Backup had already refused at 02:07Z (hand_gap_unintended_delay_exceeded, run
45302827099) and that lacks 74d10c32eb6a (05:29:48Z), the hand-gap fix for
incident 1e532243 every Backup soak since 23:34Z had failed without. Backup
45336597819 claimed it and would have spent about an hour of the one Backup
host on it; the lane owner cancelled it by hand. The right baseline was
74d10c32eb6a.

What makes a migration commit unshippable is a migration production does not
hold when the freeze begins, not the migration itself. The advance now
crosses a commit whose every migration file it ADDED is proven installed
before the freeze start, and stops, exactly as before, at the first commit
with any migration that is not proven (a modified, removed or renamed file,
an unreadable or truncated run list, no proof, or a proof that completed at
or after the freeze start; CLAUDE.md 10.86). The proof is one GitHub GET: the
successful Apply Merged Migration runs (.github/workflows/apply-merged-
migration.yml) created between the first crossed commit and the freeze start.
A file is proven installed by a run whose display title names exactly that
file and an intent nonce, sent by the merge dispatcher (repository_dispatch
from github-actions[bot], attempt 1: its intent proof step requires
dry_run=false, scripts/ci/dispatch-intent.mjs), created no earlier than the
commit that added the file, and completed success (APPLIED or
ALREADY-APPLIED, the applier's code 0) before the freeze start. A listing of
more runs than one page holds proves nothing. Commit reads are bounded at
MAX_ADVANCE_COMMIT_READS; past the bound the advance keeps what it has.

SETTLE still names the starting point (a server commit merged in the last
minutes before the freeze is not relied on unchecked); the advance then
proves each later migration installed directly, so a migration merged too
recently to have installed still stops it, because its run completed after
the freeze start or not at all.

A REFUSED BASELINE IS NOT CLAIMED AGAIN (O22). A failure written after the
freeze began read as `due`, so every later push claimed the same baseline
again and spent another soak on a build the frozen copy had just refused.
When the newest status written after the freeze began is a `failure` that
names its refusal reasons and comes from the very run that wrote tonight's
claim (the claim run forces a refresh, so its copy was restored after the
freeze began), the answer is `refused`. A refusal made before the freeze
began (an older copy), an `error` (no verdict, no Backup turn), a cancelled
claim, or a failure with no named reasons stays `due`, as before.

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
import ast
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
PREQUAL_SOURCE = 'scripts/ci/read-engine-prequalification.py'
MIGRATIONS_PREFIX = 'supabase/migrations/'
SERVER_PREFIX = 'server/'
COMPARE_MAX_COMMITS = 250
COMPARE_MAX_FILES = 300
# O22: crossing a migration needs proof it was installed before the freeze.
INSTALL_WORKFLOW = 'apply-merged-migration.yml'
INSTALL_RUNS_MAX = 100
INSTALLER_BOT = 'github-actions[bot]'
MAX_ADVANCE_COMMIT_READS = 60
MIGRATION_FILE_RE = re.compile(r'supabase/migrations/(\d{14}_[A-Za-z0-9_-]+\.sql)')
CLAIM_RE = re.compile(r"Backup Engine claimed tonight's freeze baseline \(run (\d+)\)")
REFUSED_PREFIX = 'Backup Engine refused: '
# One Backup run (refresh + certify), measured over the 29 most recent
# successful backup-engine.yml runs on 2026-11-19: min 43.2, p50 62.0,
# p90 67.3, max 68.7 minutes.
BACKUP_RUN_WORST_MINUTES = 70


def parse_control_spec(prequal_text):
    """Parse CONTROL_INPUTS and O4/O9 exclusion constants from
    scripts/ci/read-engine-prequalification.py via AST (zero code execution)."""
    tree = ast.parse(prequal_text)
    found = {}
    wanted = {
        'CONTROL_INPUTS',
        'CONTROL_INPUT_TEST_EXCLUDED_DIRS',
        'PURE_TEST_FILE_SUFFIXES',
        'DOCUMENTATION_FILE_SUFFIXES',
        'NON_RELEASE_SERVER_SCRIPT_PREFIXES',
        'NON_RELEASE_SERVER_SCRIPT_EXACT',
    }
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in wanted:
                    found[target.id] = ast.literal_eval(node.value)
    inputs = found.get('CONTROL_INPUTS')
    if not isinstance(inputs, (list, tuple)) or not inputs or not all(isinstance(x, str) for x in inputs):
        raise ValueError('CONTROL_INPUTS not found or invalid')
    excluded_dirs = found.get('CONTROL_INPUT_TEST_EXCLUDED_DIRS', ())
    suffixes = found.get('PURE_TEST_FILE_SUFFIXES', ())
    docs = found.get('DOCUMENTATION_FILE_SUFFIXES', ())
    non_release_prefixes = found.get('NON_RELEASE_SERVER_SCRIPT_PREFIXES', ())
    non_release_exact = found.get('NON_RELEASE_SERVER_SCRIPT_EXACT', ())
    for name, val in (
        ('CONTROL_INPUT_TEST_EXCLUDED_DIRS', excluded_dirs),
        ('PURE_TEST_FILE_SUFFIXES', suffixes),
        ('DOCUMENTATION_FILE_SUFFIXES', docs),
        ('NON_RELEASE_SERVER_SCRIPT_PREFIXES', non_release_prefixes),
        ('NON_RELEASE_SERVER_SCRIPT_EXACT', non_release_exact),
    ):
        if not isinstance(val, (list, tuple)) or not all(isinstance(x, str) for x in val):
            raise ValueError(f'{name} invalid')
    return {
        'inputs': tuple(inputs),
        'excluded_dirs': tuple(excluded_dirs),
        'suffixes': tuple(suffixes),
        'docs': tuple(docs),
        'non_release_prefixes': tuple(non_release_prefixes),
        'non_release_exact': frozenset(non_release_exact),
    }


def _is_pure_test_control_path(path, control_spec):
    excluded_dirs = control_spec['excluded_dirs']
    if not excluded_dirs or not path.startswith(excluded_dirs):
        return False
    name = path.rsplit('/', 1)[-1]
    if any(name.endswith(suffix) and len(name) > len(suffix) for suffix in control_spec['suffixes']):
        return True
    if any(name.lower().endswith(suffix) and len(name) > len(suffix) for suffix in control_spec.get('docs', ())):
        return True
    if name.startswith('test_') and name.endswith('.py') and len(name) > len('test_.py'):
        return True
    return False


def _is_non_release_server_script_path(path, control_spec):
    if path in control_spec.get('non_release_exact', ()):
        return True
    prefixes = control_spec.get('non_release_prefixes', ())
    return bool(prefixes and path.startswith(prefixes))


def is_non_test_control_path(path, control_spec):
    if not isinstance(path, str) or not path or not control_spec:
        return False
    matched = any(
        path == entry or path.startswith(entry.rstrip('/') + '/')
        for entry in control_spec['inputs']
    )
    if not matched:
        return False
    if _is_pure_test_control_path(path, control_spec):
        return False
    if _is_non_release_server_script_path(path, control_spec):
        return False
    return True


def _file_paths_of(files):
    paths = []
    for entry in files:
        if not isinstance(entry, dict):
            continue
        for key in ('filename', 'previous_filename'):
            val = entry.get(key)
            if isinstance(val, str) and val:
                paths.append(val)
    return paths


def _instant(value):
    if not isinstance(value, str):
        return None
    try:
        at = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return at if at.tzinfo is not None else None


def migration_install_proven(runs, filename, not_before, freeze_start):
    """O22: True when one of runs (apply-merged-migration.yml workflow runs)
    proves filename was installed before freeze_start: the merge dispatcher's
    run for exactly that file (repository_dispatch from github-actions[bot],
    attempt 1, title 'Apply Merged Migration <file> <nonce>'), created no
    earlier than not_before (the commit that added the file) and completed
    success before freeze_start. False when no run proves it; None when runs
    is unreadable (CLAUDE.md 10.86)."""
    if not isinstance(runs, list) or not_before is None or freeze_start is None:
        return None
    title = re.compile(r'Apply Merged Migration ' + re.escape(filename) + r' [0-9a-f]{32}')
    for run in runs:
        if not isinstance(run, dict):
            continue
        if (run.get('event') != 'repository_dispatch' or run.get('status') != 'completed'
                or run.get('conclusion') != 'success' or run.get('run_attempt') != 1):
            continue
        actor = run.get('actor') if isinstance(run.get('actor'), dict) else {}
        trigger = run.get('triggering_actor') if isinstance(run.get('triggering_actor'), dict) else {}
        if actor.get('login') != INSTALLER_BOT or trigger.get('login') != INSTALLER_BOT:
            continue
        shown = run.get('display_title')
        if not isinstance(shown, str) or not title.fullmatch(shown):
            continue
        created, completed = _instant(run.get('created_at')), _instant(run.get('updated_at'))
        if created is None or completed is None:
            continue
        if created >= not_before and completed < freeze_start:
            return True
    return False


def _migrations_installed(files, commit, migration_installed):
    """O22: True only when every supabase/migrations/ entry of this commit is
    an ADDED migration file proven installed before the freeze began."""
    inner = commit.get('commit') if isinstance(commit, dict) else None
    committer = inner.get('committer') if isinstance(inner, dict) else None
    committed = _instant(committer.get('date')) if isinstance(committer, dict) else None
    if committed is None:
        return False
    for entry in files:
        if not isinstance(entry, dict):
            continue
        paths = [entry.get(k) for k in ('filename', 'previous_filename') if isinstance(entry.get(k), str)]
        if not any(p.startswith(MIGRATIONS_PREFIX) for p in paths):
            continue
        name = MIGRATION_FILE_RE.fullmatch(entry.get('filename') or '')
        if entry.get('status') != 'added' or entry.get('previous_filename') or not name:
            return False
        if migration_installed(name[1], committed) is not True:
            return False
    return True


def find_zero_migration_advance(pre_freeze, compare_doc, commit_files_reader, control_spec,
                                migration_installed=None):
    """Return the newest first-parent commit after pre_freeze, strictly before
    the first commit touching supabase/migrations/, that touched server/ or any
    non-test CONTROL_INPUTS path. Fail-open to pre_freeze when truncated or
    unreadable (CLAUDE.md 10.86).

    O22: with migration_installed(filename, not_before) -> True/False/None,
    a commit whose every migration file it added is proven installed before
    the freeze start is crossed; the first one that is not proven stops the
    advance exactly as before. At most MAX_ADVANCE_COMMIT_READS commits are
    read."""
    if not isinstance(compare_doc, dict) or not control_spec:
        return pre_freeze
    status = compare_doc.get('status')
    if status == 'identical' or status != 'ahead':
        return pre_freeze
    commits = compare_doc.get('commits')
    total = compare_doc.get('total_commits')
    if (not isinstance(commits, list) or not commits
            or not isinstance(total, int) or total <= 0
            or total > COMPARE_MAX_COMMITS or total != len(commits)):
        return pre_freeze
    by_sha = {}
    for c in commits:
        sha = c.get('sha') if isinstance(c, dict) else None
        if isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{40}', sha):
            by_sha[sha] = c
    head_sha = commits[-1].get('sha') if isinstance(commits[-1], dict) else None
    if not head_sha or head_sha not in by_sha:
        return pre_freeze
    chain_rev = []
    seen = set()
    cur = head_sha
    while cur != pre_freeze:
        if cur in seen or cur not in by_sha:
            return pre_freeze
        seen.add(cur)
        chain_rev.append(cur)
        parents = by_sha[cur].get('parents')
        if not isinstance(parents, list) or not parents or not isinstance(parents[0], dict):
            return pre_freeze
        parent_sha = parents[0].get('sha')
        if not isinstance(parent_sha, str) or not re.fullmatch(r'[0-9a-f]{40}', parent_sha):
            return pre_freeze
        cur = parent_sha
    best = pre_freeze
    for reads, sha in enumerate(reversed(chain_rev)):
        if reads >= MAX_ADVANCE_COMMIT_READS:
            break
        files = commit_files_reader(sha)
        if not isinstance(files, list) or len(files) >= COMPARE_MAX_FILES:
            break
        paths = _file_paths_of(files)
        if any(p.startswith(MIGRATIONS_PREFIX) for p in paths):
            if migration_installed is None or not _migrations_installed(files, by_sha[sha], migration_installed):
                break
        if any(p.startswith(SERVER_PREFIX) or is_non_test_control_path(p, control_spec) for p in paths):
            best = sha
    return best


def is_control_selectable(compare_doc, control_spec):
    """True when no non-test CONTROL_INPUTS path changed between baseline and
    main; False when one did; None when unreadable/truncated (CLAUDE.md 10.86)."""
    if not isinstance(compare_doc, dict) or not control_spec:
        return None
    status = compare_doc.get('status')
    if status == 'identical':
        return True
    if status != 'ahead':
        return None
    files = compare_doc.get('files')
    if not isinstance(files, list):
        return None
    paths = _file_paths_of(files)
    if any(is_non_test_control_path(p, control_spec) for p in paths):
        return False
    if len(files) >= COMPARE_MAX_FILES:
        return None
    return True


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


def decide(now_utc, clock, baseline_reader, certified_after,
           advance_zero_migration=None, control_selectable=None, served_contains=None):
    start, inside = window(now_utc, *clock)
    if not inside:
        return {'state': 'outside'}
    baseline = baseline_reader(start - SETTLE)
    if not baseline or not re.fullmatch(r'[0-9a-f]{40}', baseline):
        return {'state': 'unknown', 'why': 'baseline unreadable'}
    if advance_zero_migration is not None:
        advanced = advance_zero_migration(baseline)
        if isinstance(advanced, str) and re.fullmatch(r'[0-9a-f]{40}', advanced):
            baseline = advanced
    if served_contains is not None and served_contains(baseline) is True:
        return {'state': 'served', 'baseline': baseline,
                'freezeStart': start.strftime('%Y-%m-%dT%H:%M:%SZ')}
    if control_selectable is not None:
        selectable = control_selectable(baseline)
        if selectable is False:
            return {'state': 'unselectable', 'baseline': baseline,
                    'why': 'control_inputs_diverged',
                    'freezeStart': start.strftime('%Y-%m-%dT%H:%M:%SZ')}
    done = certified_after(baseline, start)
    if done is None:
        return {'state': 'unknown', 'why': 'certificate unreadable', 'baseline': baseline}
    state = done if done in ('done', 'claimed', 'due', 'refused') else ('done' if done else 'due')
    return {'state': state, 'baseline': baseline,
            'freezeStart': start.strftime('%Y-%m-%dT%H:%M:%SZ')}


ACTIVE_RUN = ('queued', 'in_progress', 'waiting', 'requested', 'pending')


def _run_of(row):
    m = re.search(r'/actions/runs/(\d+)$', row.get('target_url') or '')
    return m[1] if m else None


def certification_state(rows, start, run_status):
    """'done', 'claimed', 'refused' or 'due' for one commit's statuses (newest
    first, as GitHub returns them). A success written after the freeze began is
    done. Otherwise the newest status written after the freeze began decides: a
    pending one whose run is still active is a claim; a failure naming its
    refusal reasons, written by the run that claimed tonight's baseline (its
    copy was restored after the freeze began), is refused (O22); anything else
    (no status, another failure, an error, a pending left by a run that ended)
    is due. run_status(run_id) -> the run's status, or None if unreadable."""
    after = []
    for r in rows:
        if r.get('context') != CONTEXT:
            continue
        at = datetime.fromisoformat(r['created_at'].replace('Z', '+00:00'))
        if at >= start:
            after.append(r)
    if any(r.get('state') == 'success' for r in after):
        return 'done'
    if after and after[0].get('state') == 'failure':
        refusing = _run_of(after[0])
        reasons = after[0].get('description') or ''
        named = reasons[len(REFUSED_PREFIX):].strip() if reasons.startswith(REFUSED_PREFIX) else ''
        if refusing and named and named != 'see run':
            for r in after[1:]:
                claim = CLAIM_RE.fullmatch(r.get('description') or '')
                if r.get('state') == 'pending' and claim and claim[1] == refusing and _run_of(r) == refusing:
                    return 'refused'
    if after and after[0].get('state') == 'pending':
        m = re.search(r'/actions/runs/(\d+)', after[0].get('target_url') or '')
        if m:
            status = run_status(m[1])
            if status is None:
                return None
            if status in ACTIVE_RUN:
                return 'claimed'
    return 'due'


def gh(*args):
    return subprocess.run(['gh', 'api', *args], capture_output=True, text=True, timeout=60, check=True).stdout


HEALTH_URL = 'https://engine.smarter.poker/health'


def serving_release(url=HEALTH_URL, timeout=15):
    """The serving engine's exact releaseSha, or None when unreadable (O17)."""
    import urllib.request
    try:
        request = urllib.request.Request(url, method='GET', headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            value = json.loads(response.read().decode('utf-8')).get('releaseSha')
    except Exception:  # noqa: BLE001 - unreadable health is unknown, never served
        return None
    return value if isinstance(value, str) and re.fullmatch(r'[0-9a-f]{40}', value) else None


def contains(baseline, serving, compare_status):
    """True when the serving release contains baseline, False when it does not,
    None when it cannot be told. compare_status(base, head) returns GitHub's
    compare status of base...head (identical, ahead, behind, diverged)."""
    if not serving or not re.fullmatch(r'[0-9a-f]{40}', baseline or ''):
        return None
    if serving == baseline:
        return True
    try:
        status = compare_status(baseline, serving)
    except Exception:  # noqa: BLE001 - unreadable compare is unknown
        return None
    if status in ('identical', 'ahead'):
        return True
    if status in ('behind', 'diverged'):
        return False
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    ap.add_argument('--now', help='ISO UTC instant (tests)')
    a = ap.parse_args()
    now = datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now else datetime.now(ZoneInfo('UTC'))
    try:
        raw = lambda path: gh('-H', 'Accept: application/vnd.github.raw', f'repos/{a.repo}/contents/{path}?ref=main')
        clock = clock_of(raw(FREEZE_SOURCE), raw(SELECTOR_SOURCE))
        freeze_start, _inside = window(now, *clock)

        def baseline_reader(until):
            out = gh(f'repos/{a.repo}/commits?sha=main&path=server&per_page=1&until='
                     + until.strftime('%Y-%m-%dT%H:%M:%SZ'), '--jq', '.[0].sha // ""')
            return out.strip()

        def run_status(run_id):
            try:
                return gh(f'repos/{a.repo}/actions/runs/{run_id}', '--jq', '.status').strip()
            except Exception:  # noqa: BLE001 - unreadable is unknown, never due
                return None

        def certified_after(sha, start):
            rows = json.loads(gh(f'repos/{a.repo}/commits/{sha}/statuses?per_page=100'))
            return certification_state(rows, start, run_status)

        spec_cache = {'loaded': False, 'value': None}

        def get_control_spec():
            if not spec_cache['loaded']:
                spec_cache['loaded'] = True
                try:
                    spec_cache['value'] = parse_control_spec(raw(PREQUAL_SOURCE))
                except Exception:  # noqa: BLE001 - unreadable control spec fails open (CLAUDE.md 10.86)
                    spec_cache['value'] = None
            return spec_cache['value']

        compare_cache = {}

        def compare_to_main(sha):
            if sha not in compare_cache:
                try:
                    compare_cache[sha] = json.loads(gh(f'repos/{a.repo}/compare/{sha}...main'))
                except Exception:  # noqa: BLE001 - unreadable compare fails open (CLAUDE.md 10.86)
                    compare_cache[sha] = None
            return compare_cache[sha]

        def commit_files(sha):
            try:
                doc = json.loads(gh(f'repos/{a.repo}/commits/{sha}'))
                return doc.get('files') if isinstance(doc, dict) else None
            except Exception:  # noqa: BLE001 - unreadable commit fails open (CLAUDE.md 10.86)
                return None

        runs_cache = {}

        def install_runs(not_before):
            # O22: one GET, the first time a migration commit is met; a list
            # longer than one page, or unreadable, proves nothing.
            if 'runs' not in runs_cache:
                runs_cache['runs'] = None
                try:
                    stamp = lambda t: t.astimezone(ZoneInfo('UTC')).strftime('%Y-%m-%dT%H:%M:%SZ')
                    doc = json.loads(gh(
                        f'repos/{a.repo}/actions/workflows/{INSTALL_WORKFLOW}/runs?event=repository_dispatch'
                        f'&status=success&exclude_pull_requests=true&per_page={INSTALL_RUNS_MAX}'
                        f'&created={stamp(not_before)}..{stamp(freeze_start)}'))
                    runs, total = doc.get('workflow_runs'), doc.get('total_count')
                    if isinstance(runs, list) and isinstance(total, int) and total == len(runs):
                        runs_cache['runs'] = runs
                except Exception:  # noqa: BLE001 - unreadable proves nothing (CLAUDE.md 10.86)
                    runs_cache['runs'] = None
            return runs_cache['runs']

        def migration_installed(filename, not_before):
            if freeze_start is None:
                return None
            return migration_install_proven(install_runs(not_before), filename, not_before, freeze_start)

        def advance_zero_migration(pre_freeze):
            control_spec = get_control_spec()
            if control_spec is None:
                return pre_freeze
            return find_zero_migration_advance(
                pre_freeze, compare_to_main(pre_freeze), commit_files, control_spec,
                migration_installed=migration_installed,
            )

        def control_selectable(sha):
            control_spec = get_control_spec()
            if control_spec is None:
                return None
            return is_control_selectable(compare_to_main(sha), control_spec)

        def served_contains(sha):
            return contains(
                sha, serving_release(),
                lambda base, head: gh(f'repos/{a.repo}/compare/{base}...{head}', '--jq', '.status').strip(),
            )

        verdict = decide(
            now,
            clock,
            baseline_reader,
            certified_after,
            advance_zero_migration=advance_zero_migration,
            control_selectable=control_selectable,
            served_contains=served_contains,
        )
    except Exception as error:  # noqa: BLE001 - every unreadable answer is unknown
        verdict = {'state': 'unknown', 'why': str(error)[:200]}
    for k, v in verdict.items():
        print(f'{k}={v}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
