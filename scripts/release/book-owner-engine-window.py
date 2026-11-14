#!/usr/bin/env python3
"""Book one off-cycle owner engine window in one command.

This performs the booking edit described in
docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md, step 4. It only edits files in a
working tree: it never commits, pushes, dispatches or touches production, and
it changes no guard, reserve or existing window.

    python3 scripts/release/book-owner-engine-window.py \\
        --window-id 2026-11-20-owner-offcycle-engine-0606z \\
        --predecessor <40-hex serving SHA> --contains <40-hex content minimum> \\
        --notice-at 2026-11-20T05:40:00Z --not-before 2026-11-20T06:06:00Z \\
        --not-after 2026-11-20T08:30:00Z \\
        --owner-order-file order.txt --slug owner-off-cycle-engine-cutover \\
        --summary-file summary.md --changelog-file changelog.md

The CURRENT window id, predecessor and expiry are read from the release
controls themselves. Every new file is computed in memory and validated first;
nothing is written unless every check and every expected occurrence count
holds. After writing, the native floor suite runs and its result is printed.

Exit codes: 0 booked and the floor suite passed (or --dry-run plan printed);
1 the floor suite (or --laws) FAILED after writing; 2 refused, nothing written.
"""
import argparse
import ast
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

FLOOR = 'server/release/activation-floor.json'
WINDOWS = 'server/release/owner-maintenance-windows.json'
FLOOR_PY = 'server/scripts/engine-release-activation-floor.py'
SEAL = 'server/scripts/engine-release-seal.py'
TRANSACTION = 'server/scripts/engine-release-transaction.sh'
RECOVERY = 'scripts/ci/read-scoped-release-recovery.py'
NOTICES = 'src/utils/ownerMaintenanceNotices.json'
NOTICE_GENERATOR = 'scripts/generate-owner-maintenance-notices.mjs'
PUBLISHING = 'PUBLISHING.md'
RUNBOOK = 'docs/ENGINE-RELEASE-RUNBOOK.md'
FLOOR_SUITE = 'tests/operations/engine-activation-floor.test.py'
FLOOR_LAW = 'tests/an-engine-activation-floor-precedes-runtime-writes.law.test.ts'
DAILY_LAW = 'tests/daily-engine-maintenance.law.test.ts'
NOTICE_LAW = 'tests/a-booked-window-gives-players-notice.law.test.ts'
LAWS = (FLOOR_LAW, DAILY_LAW, NOTICE_LAW)

CHICAGO = ZoneInfo('America/Chicago')
ISO_Z = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z')
SHA = re.compile(r'[0-9a-f]{40}')
WINDOW_ID = re.compile(r'[a-z0-9][a-z0-9-]{0,78}[a-z0-9]')
SLUG = re.compile(r'[a-z0-9][a-z0-9-]*[a-z0-9]')
MIN_NOTICE_LEAD = 20 * 60
BAND = (330, 2940)          # admitted announcement second-of-hour (:05:30 to :49:00)
MIN_SPAN, MAX_SPAN = 420, 21600
# The booking tests require these in every owner order, plus the predecessor SHA.
STABLE_PHRASES = ('twenty minutes', '1800-second', '285s', 'zero opportunities', 'not extended')
SUITE_TIMEOUT = 900


class Refusal(Exception):
    """A validation or occurrence-count failure. Nothing has been written."""


def refuse(message):
    raise Refusal(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_z(label, value):
    if not isinstance(value, str) or not ISO_Z.fullmatch(value):
        refuse(f'{label} must be UTC ISO like 2026-11-20T06:06:00Z, got {value!r}')
    try:
        return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    except ValueError:
        refuse(f'{label} is not a real instant: {value!r}')


def z(moment):
    return moment.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def offset_form(moment):
    """The form the seal hardcodes: 2026-11-14T07:30:00+00:00."""
    return moment.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')


def next_routine_preparation(after):
    """The first 03:30 America/Chicago strictly after `after` (DST-aware)."""
    local = after.astimezone(CHICAGO)
    day = local.date()
    while True:
        candidate = datetime(day.year, day.month, day.day, 3, 30, tzinfo=CHICAGO)
        if candidate > after:
            return candidate.astimezone(timezone.utc)
        day += timedelta(days=1)


def replace_exact(path, text, old, new, count):
    found = text.count(old)
    if found != count:
        refuse(f'{path}: expected {old!r} exactly {count} time(s), found {found}')
    return text.replace(old, new)


def capture_one(path, text, pattern, what):
    found = re.findall(pattern, text, flags=re.M)
    if len(found) != 1:
        refuse(f'{path}: expected exactly one {what}, found {len(found)}')
    return found[0]


def floor_bytes(window_id, not_before, not_after):
    """Same key order and formatting as every committed floor."""
    doc = {'schema': 'engine-release-activation-floor/v2-owner-window',
           'preparationAt': not_before, 'activationAt': not_before, 'expiresAt': not_after,
           'timeZone': 'America/Chicago', 'ownerWindowId': window_id,
           'clientPublicationAt': not_before}
    return (json.dumps(doc, indent=2) + '\n').encode()


def order_digest(window):
    return sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode())


def render_notices(doc, ship_from):
    """Mirror of projectOwnerMaintenanceNotices + JSON.stringify(_, null, 2)."""
    rows = []
    for kind, key in (('engine', 'windows'), ('database', 'databaseWindows')):
        for window in doc.get(key) or []:
            if parse_z('notAfter', window['notAfter']) <= ship_from:
                continue
            notice = window.get('playerNoticeAt')
            rows.append({'id': window['id'], 'kind': kind,
                         'noticeAt': notice if isinstance(notice, str) else None,
                         'notBefore': window['notBefore'], 'notAfter': window['notAfter']})
    rows.sort(key=lambda row: (row['notBefore'], row['id']))
    return rows


def notices_text(rows, ship_from_text):
    doc = {'source': WINDOWS, 'shipFrom': ship_from_text, 'notices': rows}
    return json.dumps(doc, indent=2, ensure_ascii=False) + '\n'


def test_name_for(window_id):
    return ('test_owner_window_' + re.sub(r'[^a-z0-9]+', '_', window_id).strip('_')
            + '_binds_fresh_authority_to_its_serving_predecessor')


class Booking:
    def __init__(self, args):
        self.args = args
        self.repo = Path(args.repo).resolve()
        self.files = {}      # relative path -> new text
        self.created = None
        self.warnings = []

    def read(self, relative):
        path = self.repo / relative
        if not path.is_file():
            refuse(f'{relative} is missing under {self.repo}')
        return path.read_bytes().decode('utf-8')

    def read_input(self, label, name):
        path = Path(name)
        if not path.is_file():
            refuse(f'{label} {name} is not a readable file')
        return path.read_text(encoding='utf-8')

    # ---- inputs -------------------------------------------------------------
    def validate_inputs(self):
        a = self.args
        if not WINDOW_ID.fullmatch(a.window_id):
            refuse('--window-id must be lowercase letters, digits and hyphens '
                   '(it is written unquoted into the transaction script)')
        for label, value in (('--predecessor', a.predecessor), ('--contains', a.contains)):
            if not SHA.fullmatch(value):
                refuse(f'{label} must be a 40-hex commit SHA, got {value!r}')
        if not SLUG.fullmatch(a.slug):
            refuse('--slug must be lowercase letters, digits and hyphens')
        self.notice = parse_z('--notice-at', a.notice_at)
        self.start = parse_z('--not-before', a.not_before)
        self.end = parse_z('--not-after', a.not_after)
        lead = (self.start - self.notice).total_seconds()
        if lead < MIN_NOTICE_LEAD:
            refuse(f'notice lead is {int(lead)} s; playerNoticeAt must be at least '
                   f'{MIN_NOTICE_LEAD} s (20 minutes) before notBefore')
        second = int(self.start.timestamp()) % 3600
        if not BAND[0] <= second <= BAND[1]:
            refuse(f'notBefore is {second} s past the hour; an announcement is admitted only at '
                   f'{BAND[0]} to {BAND[1]} s (:05:30 to :49:00)')
        span = int((self.end - self.start).total_seconds())
        if span < MIN_SPAN:
            refuse(f'notAfter - notBefore is {span} s; announcement plus {MIN_SPAN} s must fit')
        if span > MAX_SPAN:
            refuse(f'notAfter - notBefore is {span} s; the floor policy bounds a window to {MAX_SPAN} s')
        self.span = span
        self.routine = next_routine_preparation(self.start)
        if not self.end < self.routine:
            refuse(f'notAfter {z(self.end)} is not before the next 03:30 America/Chicago routine '
                   f'preparation after notBefore ({z(self.routine)})')
        order = self.read_input('--owner-order-file', a.owner_order_file).strip()
        if not order or '\n' in order or '\r' in order:
            refuse('the owner order must be one non-empty paragraph on a single line')
        missing = [p for p in STABLE_PHRASES + (a.predecessor,) if p not in order]
        if missing:
            refuse('the owner order lacks required text the booking tests pin: ' + ', '.join(repr(p) for p in missing))
        self.order = order
        summary = self.read_input('--summary-file', a.summary_file).strip()
        if not summary or '\n' in summary or '\r' in summary:
            refuse('the summary must be one non-empty paragraph on a single line')
        if a.window_id not in summary:
            refuse('the summary paragraph must name the window id')
        self.summary = summary
        changelog = self.read_input('--changelog-file', a.changelog_file)
        if not changelog.strip():
            refuse('the changelog body is empty')
        self.changelog = changelog.rstrip('\n') + '\n'
        self.changelog_path = f'docs/changelog/{z(self.start)[:10]}-{a.slug}.md'
        if (self.repo / self.changelog_path).exists():
            refuse(f'{self.changelog_path} already exists; choose another --slug')

    # ---- current state, read from the controls ------------------------------
    def discover(self):
        floor_py = self.read(FLOOR_PY)
        self.old_id = capture_one(FLOOR_PY, floor_py, r"^NOV7_OWNER_ID = '([^']+)'$", 'NOV7_OWNER_ID')
        self.old_manifest = capture_one(FLOOR_PY, floor_py, r"^NOV7_MANIFEST_DIGEST = '([0-9a-f]{64})'$", 'NOV7_MANIFEST_DIGEST')
        self.old_order = capture_one(FLOOR_PY, floor_py, r"^NOV7_ORDER_DIGEST = '([0-9a-f]{64})'$", 'NOV7_ORDER_DIGEST')
        seal = self.read(SEAL)
        self.old_pred = capture_one(SEAL, seal, r"^NOV7_PREDECESSOR = '([0-9a-f]{40})'$", 'NOV7_PREDECESSOR')
        claim = capture_one(SEAL, seal, r"^NOV7_OWNER_CLAIM = 'engine-release-owner-([^']+)\.json'$", 'NOV7_OWNER_CLAIM')
        self.old_expiry = capture_one(
            SEAL, seal, r"^    expiry = int\(datetime\.fromisoformat\('([^']+)'\)\.timestamp\(\)\)$", 'hardcoded seal expiry')
        doc = json.loads(self.read(WINDOWS))
        self.windows_doc = doc
        ids = [w.get('id') for w in doc['windows']] + [w.get('id') for w in doc.get('databaseWindows', [])]
        if self.args.window_id in ids:
            refuse(f'window id {self.args.window_id} is already booked; ids are single-use')
        current = doc['windows'][-1]
        raw_floor = (self.repo / FLOOR).read_bytes()
        floor_doc = json.loads(raw_floor)
        problems = []
        if claim != self.old_id:
            problems.append(f'seal claim names {claim}')
        if current.get('id') != self.old_id:
            problems.append(f"the last booked window is {current.get('id')}")
        if floor_doc.get('ownerWindowId') != self.old_id:
            problems.append(f"the floor names {floor_doc.get('ownerWindowId')}")
        if sha256(raw_floor) != self.old_manifest:
            problems.append('the floor bytes differ from NOV7_MANIFEST_DIGEST')
        if order_digest(current) != self.old_order:
            problems.append('the last window differs from NOV7_ORDER_DIGEST')
        if current.get('notAfter') != self.old_expiry.replace('+00:00', 'Z'):
            problems.append(f'the seal expiry {self.old_expiry} is not the last window notAfter')
        if raw_floor != floor_bytes(self.old_id, current.get('notBefore'), current.get('notAfter')):
            problems.append('the floor bytes are not the canonical floor of the last window')
        if problems:
            refuse(f'the release controls do not agree on the current window {self.old_id}: ' + '; '.join(problems))
        self.old_window = current

    # ---- controls -----------------------------------------------------------
    def plan_controls(self):
        a = self.args
        new_floor = floor_bytes(a.window_id, a.not_before, a.not_after)
        self.manifest = sha256(new_floor)
        self.files[FLOOR] = new_floor.decode()
        self.window = {
            'id': a.window_id, 'ownerOrder': self.order, 'contains': a.contains,
            'playerNoticeAt': a.notice_at, 'notBefore': a.not_before, 'notAfter': a.not_after,
            'announcementPolicy': 'earliest-certified', 'supersedesPhase1Schedule': True,
            'migrations': [],
            'releaseWitness': {'path': FLOOR, 'sha256': self.manifest}}
        self.order_digest = order_digest(self.window)

        text = self.read(WINDOWS)
        anchor = '    }\n  ],\n  "databaseWindows": ['
        block = '\n'.join('    ' + line for line in json.dumps(self.window, indent=2, ensure_ascii=False).split('\n'))
        text = replace_exact(WINDOWS, text, anchor, '    },\n' + block + '\n  ],\n  "databaseWindows": [', 1)
        after = json.loads(text)
        before = self.windows_doc
        if (after['windows'][:-1] != before['windows'] or after['windows'][-1] != self.window
                or {k: v for k, v in after.items() if k != 'windows'} != {k: v for k, v in before.items() if k != 'windows'}):
            refuse(f'{WINDOWS}: the textual append did not produce exactly one new last window')
        self.files[WINDOWS] = text
        self.new_doc = after

        text = self.read(FLOOR_PY)
        text = replace_exact(FLOOR_PY, text, f"NOV7_OWNER_ID = '{self.old_id}'", f"NOV7_OWNER_ID = '{a.window_id}'", 1)
        text = replace_exact(FLOOR_PY, text, f"NOV7_MANIFEST_DIGEST = '{self.old_manifest}'", f"NOV7_MANIFEST_DIGEST = '{self.manifest}'", 1)
        text = replace_exact(FLOOR_PY, text, f"NOV7_ORDER_DIGEST = '{self.old_order}'", f"NOV7_ORDER_DIGEST = '{self.order_digest}'", 1)
        self.files[FLOOR_PY] = text

        old_seal = self.read(SEAL)
        text = replace_exact(SEAL, old_seal, f'engine-release-owner-{self.old_id}.json', f'engine-release-owner-{a.window_id}.json', 1)
        text = replace_exact(SEAL, text, f"NOV7_PREDECESSOR = '{self.old_pred}'", f"NOV7_PREDECESSOR = '{a.predecessor}'", 1)
        self.new_expiry = offset_form(self.end)
        text = replace_exact(SEAL, text, f"datetime.fromisoformat('{self.old_expiry}')", f"datetime.fromisoformat('{self.new_expiry}')", 1)
        if self.old_id in text or (self.old_pred != a.predecessor and self.old_pred in text):
            refuse(f'{SEAL}: the previous window or predecessor is still named after the edit')
        self.files[SEAL] = text

        old_tx = self.read(TRANSACTION)
        if old_tx.count(self.old_pred) != 2:
            refuse(f'{TRANSACTION}: expected the predecessor {self.old_pred} exactly 2 times, found {old_tx.count(self.old_pred)}')
        text = replace_exact(TRANSACTION, old_tx, self.old_id, a.window_id, 4)
        text = text.replace(self.old_pred, a.predecessor)
        if text.count(a.window_id) != 4 or text.count(a.predecessor) != 2:
            refuse(f'{TRANSACTION}: the new id must appear 4 times and the new predecessor 2 times after the edit')
        self.files[TRANSACTION] = text

        pair = "{'engine-release-seal.py': '%s', 'engine-release-transaction.sh': '%s'}"
        old_pair = pair % (sha256(old_seal.encode()), sha256(old_tx.encode()))
        self.new_pair = pair % (sha256(self.files[SEAL].encode()), sha256(self.files[TRANSACTION].encode()))
        text = self.read(RECOVERY)
        text = replace_exact(RECOVERY, text, 'RETAINED_REFUSAL_SOURCES = ' + old_pair + '\n', 'RETAINED_REFUSAL_SOURCES = ' + self.new_pair + '\n', 1)
        prior = capture_one(RECOVERY, text, r'^(RETAINED_REFUSAL_PRIOR_SOURCES = \(.*\})\)$', 'RETAINED_REFUSAL_PRIOR_SOURCES line')
        text = replace_exact(RECOVERY, text, prior + ')\n', prior + ', ' + old_pair + ')\n', 1)
        self.files[RECOVERY] = text

    # ---- player notice ------------------------------------------------------
    def plan_notices(self):
        a = self.args
        generator = self.read(NOTICE_GENERATOR)
        if "export const TARGET = '%s';" % NOTICES not in generator or "export const SOURCE = '%s';" % WINDOWS not in generator:
            refuse(f'{NOTICE_GENERATOR} no longer projects {WINDOWS} into {NOTICES}; update this command')
        ship_text = capture_one(NOTICE_GENERATOR, generator, r"^export const SHIP_FROM = '([^']+)';$", 'SHIP_FROM')
        ship_from = parse_z('SHIP_FROM', ship_text)
        current = self.read(NOTICES)
        if notices_text(render_notices(self.windows_doc, ship_from), ship_text) != current:
            refuse(f'{NOTICES} is not what this command renders for the current registry, so its mirror of '
                   f'{NOTICE_GENERATOR} cannot be trusted; run the generator and investigate first')
        rows = render_notices(self.new_doc, ship_from)
        if sum(1 for row in rows if row['notBefore'] == a.not_before) != 1:
            refuse(f'another shipped notice shares notBefore {a.not_before}; the generator orders ties with '
                   'localeCompare, which this command does not reproduce. Choose another minute.')
        if sum(1 for row in rows if row['id'] == a.window_id) != 1:
            refuse(f'{NOTICES}: the new window is not shipped (notAfter is not after {ship_text})')
        self.files[NOTICES] = notices_text(rows, ship_text)
        # Another promise still shown at or after the new notice instant changes which notice is primary.
        self.notice_overlap = sorted(row['id'] for row in rows if row['id'] != a.window_id
                                     and parse_z('notAfter', row['notAfter']) >= self.notice)
        if self.notice_overlap:
            self.warnings.append(
                'the new notice interval overlaps a shipped notice (' + ', '.join(self.notice_overlap) + '). '
                f'The generated notice case pins only its own fields; existing cases in {NOTICE_LAW} that assert '
                'no notice (or another primary notice) inside the new interval need a hand edit. Run the law.')

    # ---- documents ----------------------------------------------------------
    def plan_documents(self):
        for path in (PUBLISHING, RUNBOOK):
            text = self.read(path)
            if self.args.window_id in text:
                refuse(f'{path} already names {self.args.window_id}')
            self.files[path] = self.summary + '\n\n' + text
        self.created = self.changelog_path
        self.files[self.changelog_path] = self.changelog

    # ---- the native floor suite ---------------------------------------------
    def plan_floor_suite(self):
        a = self.args
        text = self.read(FLOOR_SUITE)
        self.test_name = test_name_for(a.window_id)
        if f'def {self.test_name}(' in text:
            refuse(f'{FLOOR_SUITE} already defines {self.test_name}')
        tree = ast.parse(text)
        suite = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'ActivationFloor']
        if len(suite) != 1:
            refuse(f'{FLOOR_SUITE}: expected exactly one ActivationFloor class')
        functions = [n for n in suite[0].body if isinstance(n, ast.FunctionDef)]
        lines = text.split('\n')
        marker = f"        self.assertEqual(floor.NOV7_OWNER_ID, '{self.old_id}')"
        owners = [f for f in functions if marker in lines[f.lineno - 1:f.end_lineno]]
        if len(owners) != 1:
            refuse(f'{FLOOR_SUITE}: expected exactly one test binding floor.NOV7_OWNER_ID to {self.old_id}, found {len(owners)}')
        self.old_test = owners[0].name

        # The simulated announcement stamp and the id count of the reservation test.
        stamp = self.simulated_stamp()
        stamp_pattern = re.compile(r"stamp = int\(datetime\.fromisoformat\('[^']+'\)\.timestamp\(\)\) \* 1000")
        hits = [i for i, line in enumerate(lines) if stamp_pattern.search(line)]
        if len(hits) != 1:
            refuse(f'{FLOOR_SUITE}: expected exactly one simulated reservation stamp, found {len(hits)}')
        lines[hits[0]] = stamp_pattern.sub(
            f"stamp = int(datetime.fromisoformat('{offset_form(stamp)}').timestamp()) * 1000", lines[hits[0]])
        count_old = f"        self.assertEqual(transaction.count('{self.old_id}'), 4)"
        hits = [i for i, line in enumerate(lines) if line == count_old]
        if len(hits) != 1:
            refuse(f'{FLOOR_SUITE}: expected exactly one transaction.count pin of {self.old_id}, found {len(hits)}')
        lines[hits[0]] = f"        self.assertEqual(transaction.count('{a.window_id}'), 4)"

        # Rewrite function by function, last first, so earlier line numbers stay valid.
        index = re.compile(r"windows\['windows'\]\[-(\d+)\]")
        pop_old = f"        self.assertEqual(windows['windows'].pop()['id'], '{self.old_id}')"
        pop_new = f"        self.assertEqual(windows['windows'].pop()['id'], '{a.window_id}')"
        chains = shifted = 0
        carried_absent = None
        for function in sorted(functions, key=lambda f: f.lineno, reverse=True):
            body = lines[function.lineno - 1:function.end_lineno]
            if function.name == self.old_test:
                body, carried_absent = self.demote(body)
            out, popped = [], False
            for line in body:
                if re.search(r'\bwindows = json\.loads\(', line):
                    popped = False       # a fresh read of the registry: absolute again
                if "windows['windows'].pop()" in line:
                    if not popped:
                        if line != pop_old:
                            refuse(f'{FLOOR_SUITE}: {function.name} starts a pop chain that does not begin '
                                   f'with the current window {self.old_id}')
                        out.append(pop_new)
                        chains += 1
                    popped = True
                elif not popped and index.search(line):
                    # An index after a pop chain counts from the already-shortened list: leave it.
                    line = index.sub(lambda m: "windows['windows'][-%d]" % (int(m.group(1)) + 1), line)
                    shifted += 1
                out.append(line)
            if function.name == self.old_test:
                out += [''] + self.new_test(carried_absent)
            lines[function.lineno - 1:function.end_lineno] = out
        if chains < 1 or shifted < 2:
            refuse(f'{FLOOR_SUITE}: found {chains} pop chain(s) and {shifted} absolute index(es); the suite shape changed')
        self.suite_counts = (chains, shifted)
        new_text = '\n'.join(lines)
        try:
            ast.parse(new_text)
        except SyntaxError as error:
            refuse(f'{FLOOR_SUITE}: the rewritten suite does not parse ({error})')
        self.files[FLOOR_SUITE] = new_text

    def simulated_stamp(self):
        """An admissible announcement inside the new window: :48:00 of the opening hour when it fits."""
        start = int(self.start.timestamp())
        end = int(self.end.timestamp())
        candidate = start - start % 3600 + 2880
        if not (start <= candidate and candidate + 420 <= end):
            candidate = start
        return datetime.fromtimestamp(candidate, timezone.utc)

    def demote(self, body):
        """The previous window's test keeps its assertions against literal digests."""
        name = self.old_test

        def once(old, new):
            hits = [i for i, line in enumerate(body) if line == old]
            if len(hits) != 1:
                refuse(f'{FLOOR_SUITE}: {name} must contain {old.strip()!r} exactly once, found {len(hits)}')
            if new is None:
                del body[hits[0]]
            else:
                body[hits[0]] = new

        body = list(body)
        once('        window, raw = self.historical_floor(floor.NOV7_OWNER_ID)',
             f"        window, raw = self.historical_floor('{self.old_id}')")
        once(f"        self.assertEqual(floor.NOV7_OWNER_ID, '{self.old_id}')", None)
        once('        self.assertEqual(raw, (ROOT / MANIFEST).read_bytes())', None)
        once('        self.assertEqual(hashlib.sha256(raw).hexdigest(), floor.NOV7_MANIFEST_DIGEST)',
             f"        self.assertEqual(hashlib.sha256(raw).hexdigest(), '{self.old_manifest}')")
        once("        self.assertEqual(window['releaseWitness']['sha256'], floor.NOV7_MANIFEST_DIGEST)",
             f"        self.assertEqual(window['releaseWitness']['sha256'], '{self.old_manifest}')")
        once("        self.assertEqual(hashlib.sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), floor.NOV7_ORDER_DIGEST)",
             f"        self.assertEqual(hashlib.sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), '{self.old_order}')")
        once("        self.assertEqual(windows['windows'][-1]['id'], floor.NOV7_OWNER_ID)",
             f"        self.assertEqual(windows['windows'][-1]['id'], '{self.old_id}')")
        # The live seal and transaction pins move to the new window's test.
        tail_start = [i for i, line in enumerate(body) if line.startswith('        seal_source = ')]
        carried = None
        if len(tail_start) > 1:
            refuse(f'{FLOOR_SUITE}: {name} reads the seal source more than once')
        if tail_start:
            tail = body[tail_start[0]:]
            allowed = (r"        seal_source = \(ROOT / 'server/scripts/engine-release-seal\.py'\)\.read_text\(\)",
                       r"        self\.assertIn\(\"NOV7_PREDECESSOR = '[0-9a-f]{40}'\", seal_source\)",
                       r"        self\.assertIn\(\"datetime\.fromisoformat\('[^']+'\)\", seal_source\)",
                       r"        transaction = \(ROOT / 'server/scripts/engine-release-transaction\.sh'\)\.read_text\(\)",
                       r"        self\.assertEqual\(transaction\.count\('[0-9a-f]{40}'\), 2\)",
                       r"        self\.assertNotIn\('([0-9a-f]{40})', transaction\)")
            for line in tail:
                if not any(re.fullmatch(pattern, line) for pattern in allowed):
                    refuse(f'{FLOOR_SUITE}: {name} ends with an assertion this command does not know how to move: {line.strip()!r}')
                absent = re.fullmatch(allowed[-1], line)
                if absent:
                    carried = absent.group(1)
            del body[tail_start[0]:]
        if any('floor.NOV7_' in line or 'seal.NOV7_' in line for line in body):
            refuse(f'{FLOOR_SUITE}: {name} still reads a live NOV7 constant after demotion')
        return body, carried

    def new_test(self, carried_absent):
        a = self.args
        required = (a.predecessor,) + STABLE_PHRASES
        absent = self.old_pred if self.old_pred != a.predecessor else carried_absent
        if absent == a.predecessor:
            absent = None
        lines = [
            f'    def {self.test_name}(self):',
            '        import hashlib',
            '        from datetime import datetime',
            '        window, raw = self.historical_floor(floor.NOV7_OWNER_ID)',
            f"        self.assertEqual(floor.NOV7_OWNER_ID, '{a.window_id}')",
            '        self.assertEqual(raw, (ROOT / MANIFEST).read_bytes())',
            '        self.assertEqual(hashlib.sha256(raw).hexdigest(), floor.NOV7_MANIFEST_DIGEST)',
            "        self.assertEqual(window['releaseWitness']['sha256'], floor.NOV7_MANIFEST_DIGEST)",
            "        self.assertEqual(hashlib.sha256(json.dumps(window, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), floor.NOV7_ORDER_DIGEST)",
            f"        self.assertEqual((window['playerNoticeAt'], window['notBefore'], window['notAfter']), ('{a.notice_at}', '{a.not_before}', '{a.not_after}'))",
            f"        self.assertEqual(window['contains'], '{a.contains}')",
            "        self.assertEqual(window['announcementPolicy'], 'earliest-certified')",
            "        self.assertIs(window['supersedesPhase1Schedule'], True)",
            "        self.assertEqual(window['migrations'], [])",
            '        for required in (' + ', '.join(repr(p) for p in required) + '):',
            "            self.assertIn(required, window['ownerOrder'])",
            "        windows = json.loads((ROOT / 'server/release/owner-maintenance-windows.json').read_text())",
            "        self.assertEqual(windows['windows'][-1]['id'], floor.NOV7_OWNER_ID)",
            f"        self.assertEqual(windows['windows'][-2]['id'], '{self.old_id}')",
            f'        # The admission opens inside the announcement band and ends before the 03:30 America/Chicago routine preparation ({z(self.routine)}).',
            "        start, end = [int(datetime.fromisoformat(window[k].replace('Z', '+00:00')).timestamp()) for k in ('notBefore', 'notAfter')]",
            '        self.assertTrue(330 <= start % 3600 <= 2940)',
            f'        self.assertEqual(end - start, {self.span})',
            f"        self.assertLess(end, int(datetime.fromisoformat('{offset_form(self.routine)}').timestamp()))",
            "        seal_source = (ROOT / 'server/scripts/engine-release-seal.py').read_text()",
            f"""        self.assertIn("NOV7_PREDECESSOR = '{a.predecessor}'", seal_source)""",
            f"""        self.assertIn("datetime.fromisoformat('{self.new_expiry}')", seal_source)""",
            "        transaction = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()",
            f"        self.assertEqual(transaction.count('{a.predecessor}'), 2)",
        ]
        if absent:
            lines.append(f"        self.assertNotIn('{absent}', transaction)")
        return lines

    # ---- the TypeScript laws ------------------------------------------------
    def plan_laws(self):
        a = self.args
        text = self.read(FLOOR_LAW)
        if f"'{self.test_name}'" in text:
            refuse(f'{FLOOR_LAW} already lists {self.test_name}')
        text = replace_exact(FLOOR_LAW, text, f"      '{self.old_test}',\n",
                             f"      '{self.old_test}',\n      '{self.test_name}',\n", 1)
        length = re.findall(r'expect\(selected\)\.toHaveLength\((\d+)\)', text)
        if len(length) != 1:
            refuse(f'{FLOOR_LAW}: expected exactly one selected-case count, found {len(length)}')
        listed = len(re.findall(r"^      'test_[A-Za-z0-9_]+',$", text, flags=re.M))
        if listed != int(length[0]) + 1:
            refuse(f'{FLOOR_LAW}: {listed} listed cases after the edit do not match the pinned count {length[0]} plus one')
        text = text.replace(f'expect(selected).toHaveLength({length[0]})', f'expect(selected).toHaveLength({listed})')
        self.case_count = listed
        self.files[FLOOR_LAW] = text

        text = self.read(DAILY_LAW)
        pop = "  expect(doc.windows.pop().id).toBe('%s');\n"
        self.files[DAILY_LAW] = replace_exact(DAILY_LAW, text, pop % self.old_id, pop % a.window_id + pop % self.old_id, 1)

        text = self.read(NOTICE_LAW)
        title = f'publishes the {a.window_id} engine window promise with its lead and fixed expiry'
        if title in text or f"'{a.window_id}'" in text:
            refuse(f'{NOTICE_LAW} already has a case for {a.window_id}')
        find = f"  const own = BOOKED_MAINTENANCE_NOTICES.find((n) => n.id === '{a.window_id}');"
        if len(find) > 100:          # the repository formatter's print width
            find = ('  const own = BOOKED_MAINTENANCE_NOTICES.find(\n'
                    f"    (n) => n.id === '{a.window_id}'\n  );")
        case = [
            '', f"it('{title}', () => {{", find,
            f"  expect(own?.noticeAtMs).toBe(Date.parse('{a.notice_at}'));",
            f"  expect(own?.notBeforeMs).toBe(Date.parse('{a.not_before}'));",
            f"  expect(own?.notAfterMs).toBe(Date.parse('{a.not_after}'));",
            '  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);']
        if self.notice_overlap:
            case.append('  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === own?.id)).toBe(true);')
        else:
            def before(moment):
                return (moment - timedelta(seconds=1)).strftime('%Y-%m-%dT%H:%M:%S') + '.999Z'
            case += [
                f"  expect(bookedMaintenanceNotice(Date.parse('{before(self.notice)}'))).toBeNull();",
                f"  expect(bookedMaintenanceNotice(Date.parse('{a.notice_at}'))?.id).toBe(own?.id);",
                f"  expect(bookedMaintenanceNotice(Date.parse('{before(self.end)}'))?.id).toBe(own?.id);",
                f"  expect(bookedMaintenanceNotice(Date.parse('{a.not_after}'))).toBeNull();"]
        case += ['});', '']
        self.files[NOTICE_LAW] = text.rstrip('\n') + '\n' + '\n'.join(case)

    # ---- output -------------------------------------------------------------
    def plan(self):
        self.validate_inputs()
        self.discover()
        self.plan_controls()
        self.plan_notices()
        self.plan_documents()
        self.plan_floor_suite()
        self.plan_laws()

    def describe(self):
        a = self.args
        chicago = lambda m: m.astimezone(CHICAGO).strftime('%Y-%m-%d %H:%M %Z')
        lines = [
            f'repository          {self.repo}',
            f'current window      {self.old_id}',
            f'  predecessor       {self.old_pred}',
            f'  seal expiry       {self.old_expiry}',
            f'new window          {a.window_id}',
            f'  predecessor       {a.predecessor}' + ('  (unchanged)' if a.predecessor == self.old_pred else ''),
            f'  contains          {a.contains}',
            f'  notice            {a.notice_at}  ({chicago(self.notice)})',
            f'  notBefore         {a.not_before}  ({chicago(self.start)})',
            f'  notAfter          {a.not_after}  ({chicago(self.end)}), {self.span} s',
            f'  routine 03:30     {z(self.routine)}  (the next preparation; the window ends before it)',
            f'  floor sha256      {self.manifest}',
            f'  order sha256      {self.order_digest}',
            f'  retained sources  {self.new_pair}',
            f'  floor suite test  {self.test_name}',
            f'  previous test     {self.old_test} (now pins literal digests)',
            f'  suite rewrite     {self.suite_counts[0]} pop chain(s) extended, {self.suite_counts[1]} absolute index(es) shifted, {self.case_count} listed cases',
            'files:']
        for path in self.files:
            lines.append(('  create  ' if path == self.created else '  modify  ') + path)
        for warning in self.warnings:
            lines.append('WARNING: ' + warning)
        return '\n'.join(lines)

    def write(self):
        for path, text in self.files.items():
            target = self.repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(text.encode('utf-8'))


def run_floor_suite(repo):
    try:
        result = subprocess.run([sys.executable, '-B', FLOOR_SUITE], cwd=repo, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=SUITE_TIMEOUT)
    except subprocess.TimeoutExpired as error:
        return False, f'{error.output or ""}\n{FLOOR_SUITE} did not finish in {SUITE_TIMEOUT} s'
    return result.returncode == 0, result.stdout


def run_laws(repo):
    try:
        result = subprocess.run(['npx', 'vitest', 'run', *LAWS], cwd=repo, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=3600)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, f'could not run the laws: {error}'
    return result.returncode == 0, result.stdout


def main(argv=None):
    parser = argparse.ArgumentParser(description='Book one off-cycle owner engine window (edits the working tree only).')
    parser.add_argument('--window-id', required=True)
    parser.add_argument('--predecessor', required=True, help='40-hex SHA the engine is serving')
    parser.add_argument('--contains', required=True, help='40-hex content minimum')
    parser.add_argument('--notice-at', required=True, help='player notice, UTC ISO Z')
    parser.add_argument('--not-before', required=True, help='admission opens, UTC ISO Z')
    parser.add_argument('--not-after', required=True, help='fixed expiry, UTC ISO Z')
    parser.add_argument('--owner-order-file', required=True, help='text file holding the verbatim ownerOrder paragraph')
    parser.add_argument('--slug', required=True, help='changelog file slug')
    parser.add_argument('--summary-file', required=True, help='dated paragraph for PUBLISHING.md and the runbook')
    parser.add_argument('--changelog-file', required=True, help='body of the new changelog file')
    parser.add_argument('--dry-run', action='store_true', help='print the plan and change nothing')
    parser.add_argument('--laws', action='store_true', help='after writing, also run the three TypeScript laws with npx vitest')
    parser.add_argument('--repo', default=str(Path(__file__).resolve().parents[2]))
    args = parser.parse_args(argv)

    booking = Booking(args)
    try:
        booking.plan()
    except Refusal as refusal:
        print(f'REFUSED, nothing written: {refusal}', file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        print(f'REFUSED, nothing written: could not read the release controls ({type(error).__name__}: {error})', file=sys.stderr)
        return 2
    print(booking.describe())
    if args.dry_run:
        print('DRY RUN: nothing written.')
        return 0
    booking.write()
    print(f'written. Running {FLOOR_SUITE} ...', flush=True)
    passed, output = run_floor_suite(booking.repo)
    print('\n'.join(output.rstrip('\n').split('\n')[-12 if passed else -200:]))
    print(f'{FLOOR_SUITE}: ' + ('PASS' if passed else 'FAIL'))
    status = 0 if passed else 1
    if args.laws:
        laws_passed, output = run_laws(booking.repo)
        print('\n'.join(output.rstrip('\n').split('\n')[-12 if laws_passed else -200:]))
        print('TypeScript laws: ' + ('PASS' if laws_passed else 'FAIL'))
        status = status or (0 if laws_passed else 1)
    if status:
        print('The booking was WRITTEN and a check FAILED. Fix it or discard the edit; do not merge it as it is.', file=sys.stderr)
    return status


if __name__ == '__main__':
    sys.exit(main())
