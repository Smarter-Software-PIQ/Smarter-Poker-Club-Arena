#!/usr/bin/env python3
"""A Backup copy is judged by the migrations it holds, never by a clock.

WHY (2026-11-08). Backup run 42519319251 restored its copy at 20:38:05Z.
Migration 20261108193515 (merged 20:36:58Z) was installed in production at
20:38:11Z, six seconds later, so the copy lacked it. The refresh-due decision
and the daily selector both asked "is the newest migration COMMIT older than
the restore?", which said yes, so both would have certified and selected the
stale copy. Run 42521781581 then exported while 20261108210509 installed
(21:38:56Z, inside its 21:37:58Z-21:42:51Z export) and lacked it as well; its
smarter_private.weekly_payout_next_round() differed from production's. A
commit time says when a file merged, not when production installed it.

THE CONTENTS SOURCE is the Backup export's own schema evidence (#10113,
server/standby/schema-evidence.py): production's installed migration set
(version, name) and the sha256 of each required function definition, captured
before and after pg_dump (drift refuses the export), bound to the dump's
sha256, compared against the restored copy's function bodies before the copy
is valid, and retained beside the certificate as schema-evidence.json. The
supported export carries no supabase_migrations schema, so the copy's set is
the set its dump was proved to be taken under; nothing here claims more.

This helper only CONSUMES that evidence:

  * refresh-due: the copy on the standby is due unless its evidence is bound
    to it and production's installed set and required definitions, read now,
    equal it. No evidence, or an unreadable production, is due.
  * the daily selector (judge): the certified copy's retained evidence must be
    bound to that copy, its set must EQUAL production's, its required
    definitions must equal production's, and it must hold every migration
    file the exact candidate adds (by version and name).
  * at cutover, after the break admits the release and before the engine
    lock, the host re-reads production's set through
    fn_ca_installed_migration_listing() and refuses if it no longer matches
    the set the certificate names (status). The current engine keeps running.

Timestamps are printed as diagnostics only.

  refresh-due --copy-evidence F --copy-evidence-sha S [--control C --wait N]
  certified-digest --evidence F --certificate C --sha S [--control C]
                                       the set the certificate will name
  certified --sha S                    the set the target's certificate names
  status --env-file F --repo R --sha S --certified D [--control C]
                                       (default C: the generation's control-sha)
                                       exit 0 unchanged, 1 refused, 3 unknown
  candidate-ready --repo R --serving OLD --sha TARGET [--production F]
                                       all ordinary candidate migrations installed

THE COMPARABLE SET. A migration declaring "-- @install-window: daily-
maintenance" installs only inside the 04:00 break, after certification and
before cutover; its doors are re-read separately (engine-release-window-
doors.py). The certificate therefore names the copy's set less the exact
target's own window files, the cutover leaves the same versions out of
production's set, and everything else must be identical.

A FOREIGN MIGRATION IS NOT OURS (2026-11-24, O23). Club Arena and World Hub
(another repository) share one production database and one history table,
supabase_migrations.schema_migrations. During the nightly freeze a World Hub
lane installed 20261124052600, 20261124060500 and 20261124061800 (trivia).
Candidate d749a61e4c94 was certified at 06:29:38Z on a copy taken ~05:30Z;
the daily selector then refused it: "Backup copy lacks installed migration
20261124060500, 20261124061800" (Stage run 45330329311), and the 01:00 Chicago
cutover was lost. None of those versions is a file in Club Arena's
supabase/migrations tree. The engine serving right now already runs against
them, so refusing the candidate protected nothing: whatever they changed is
the database the current engine has and the candidate will have.

So a version that NO Club Arena tree in hand ships - neither the exact
target's nor the control commit's (main) - is left out of the comparable set
on BOTH sides (the copy's and production's), wherever the set is made: the
certificate's digest (certified-digest --sha --control), the selector (judge,
target and control), refresh-due (its --sha and --control; also the O16
mid-soak stale check) and the cutover re-read (status: --control, else the
control-sha manifest of the immutable control generation it runs from, which
engine-release-transaction.sh has already proved equals the request). A Club Arena file merged to main after the target
is in control's tree, so it is still compared and a copy lacking it is still
refused, exactly as before; only versions Club Arena never shipped drop out.
The rule is the version alone: a version a tree ships under a different name
still "differs"; window and SUPERSEDED versions are handled as before; the
'manual' row (training_api_indexes.sql) has no file and is not compared
either. What protects shared objects is unchanged: every required function
definition is still compared over all of the evidence, foreign or not.

FAIL SAFE (CLAUDE.md 10.86). Every tree asked for must be listed: a SHA that
is absent, not given (no --control), not 40 hex, or a tree that git cannot
list or that lists no migration file leaves NOTHING out, so an unreadable
tree never certifies more than before. The certificate names the set left
after its trees; a cutover host that reads fewer trees, or a larger control
tree whose extra versions production holds, sees a different digest and
refuses (the current engine keeps running).

AN ENGINE-INERT MIGRATION DOES NOT STALE A COPY (2026-11-26, O33). The
only candidate certified that day, 13bce958d4c3, was refused at the 13:00
Chicago selection: "Backup copy lacks installed migration 20261126011318,
20261126014018, 20261126014434, 20261126064723" (issue #11599). Those four
merged and installed at about 07:15 Chicago, after the copy was taken, and
each is nothing but BEGIN, SET LOCAL lock_timeout, one or two
public.fn_ca_horse_option_register(...) calls with literal arguments, and
COMMIT. A register call writes one row of public.ca_horse_option_whitelist.
No engine code reads that table; the engine's only runtime reads that reach it
(fn_ca_horse_option_switch_effective and fn_ca_horse_style_switch_effective,
through fn_ca_horse_option_switch_states) use only an option's KIND, which a
register call never changes for an option that already has a switch row (a
switch row requires the option registered first, and the whitelist guard keeps
a kind for ever). A copy lacking such a row certifies the same engine.

So a version whose ONE file in the control tree is engine-inert
(engine_inert(): every statement, after whole-line "--" comments and blank
lines are dropped, is exactly BEGIN;, COMMIT;, SET LOCAL lock_timeout = '<n>s';
or one SELECT of fn_ca_horse_option_register / _allow_shadow / _unlock with
literal arguments of fixed shapes, at least one call, BEGIN first and COMMIT
last), and which the exact target's tree does not ship, is
left out of the comparison on BOTH sides by the selector (judge) and
refresh-due, like a foreign version, and is reported as "left out as
engine-inert: <versions>". The certificate's digest is unchanged (the copy's
set). At cutover, status still accepts production's set when it equals that
digest, and otherwise accepts it only when removing some non-empty subset of
the inert versions production holds gives exactly that digest: production is
the certified copy plus inert versions and nothing else. At most
INERT_SUBSET_LIMIT (10) such versions are tried; with more, nothing is left
out anywhere (bounded_inert), so the selector never accepts a copy the cutover
cannot recognise. "Inert" means only versions the exact target does not ship:
the candidate's own files are still required by version and name. No control,
a tree git cannot list or a file it cannot read leaves nothing out as inert.
tests/an-engine-inert-migration-does-not-stale-a-certificate.law.test.ts
re-checks the premise (no engine reader of the whitelist) on every change.

Read-only: never writes the database, GitHub or the host.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

sys.dont_write_bytecode = True

PROJECT_HOST = 'kuklfnapbkmacvwxktbh.supabase.co'
REPO_API = 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena'
CONTEXT = 'backup-engine/certified'
MIGRATIONS = 'supabase/migrations/'
WINDOW_ANNOTATION = r'^--[[:blank:]]*@install-window:[[:blank:]]*daily-maintenance[[:blank:]]*$'
SUPERSEDED_ANNOTATION = r'^--[[:blank:]]*SUPERSEDED BY[[:blank:]]+[0-9]{14}'
DIGEST = re.compile(r'[0-9a-f]{64}')
CERTIFIED = re.compile(r'; installed migrations ([0-9a-f]{64})$')
FILE = re.compile(r'(\d{14})_([A-Za-z0-9_.-]+)\.sql')
# Any file the history table could name (the CLI's version is the leading
# digits, so 001_club_arena_schema.sql is ours too): wider is stricter here.
TREE_FILE = re.compile(r'(\d+)_[^/]*\.sql')
RECORDINGS = 'scripts/ci/recorded-migrations.manifest.json'
READY, REFUSED, UNKNOWN = 0, 1, 3

# ---- AN ENGINE-INERT MIGRATION (O33) ----
# Literal shapes only: an option name, a migration name; neither can hold a
# quote, a semicolon, a space or an expression.
_OPTION = r"'[A-Za-z][A-Za-z0-9]{0,62}'"
_MIGRATION = r"'[0-9]{14}_[a-z0-9]+(?:_[a-z0-9]+)*'"
INERT_CALLS = (
    re.compile(r"SELECT public\.fn_ca_horse_option_register\(" + _OPTION + r", '(?:plain|style)', (?:true|false), "
               r"'(?:none|on_shadow|shadow)', " + _MIGRATION + r"\);"),
    re.compile(r"SELECT public\.fn_ca_horse_option_allow_shadow\(" + _OPTION + r", '(?:on_shadow|shadow)', "
               + _MIGRATION + r"\);"),
    re.compile(r"SELECT public\.fn_ca_horse_option_unlock\(" + _OPTION + r", ARRAY\[" + _MIGRATION
               + r"(?:, " + _MIGRATION + r")*\], " + _MIGRATION + r"\);"),
)
INERT_FRAME = (re.compile(r'BEGIN;'), re.compile(r"SET LOCAL lock_timeout = '[0-9]{1,3}s';"), re.compile(r'COMMIT;'))
# Narrows the files engine_inert() reads; a file without one of these names cannot be inert.
INERT_HINT = (
    r'fn_ca_horse_option_(register|allow_shadow|unlock)\('
    r'|public\.(training_|social_|ui_|cosmetic_|analytics_|club_announcements\b)'
)

# ---- STRICTLY NON-ENGINE TABLE MIGRATIONS (Wave B-2, fail-closed) ----
# Verified non-engine public tables/views (zero engine readers in server/src/,
# pinned by tests/cutover-release-controls-hardening.law.test.ts).
_NON_ENGINE_TABLE = r'(?:training_[a-z][a-z0-9_]*|social_[a-z][a-z0-9_]*|ui_[a-z][a-z0-9_]*|cosmetic_[a-z][a-z0-9_]*|analytics_[a-z][a-z0-9_]*|club_announcements)'
_NON_ENGINE_TABLE_RE = re.compile(r'^' + _NON_ENGINE_TABLE + r'$')
_ENGINE_DOMAIN_TOKEN_RE = re.compile(
    r'(?:^|_)(?:hands?|tables?|tournaments?|chips?|wallets?|escrows?|ledgers?|seats?|'
    r'horses?|rakes?|settlements?|diamonds?|unions?|lightning|bbj|blinds?|pots?|'
    r'cashouts?|payouts?|buyins?|rebuys?|addons?|maintenance|releases?)(?:_|$)',
    re.IGNORECASE,
)
_FORBIDDEN_SQL_RE = re.compile(
    r'(?:^DO\b|\bDO\s+(?:LANGUAGE\b|__STR__))'
    r'|\b(?:FUNCTION|PROCEDURE|TRIGGER|RULE|EXTENSION|PUBLICATION|SUBSCRIPTION|'
    r'DROP|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|PREPARE|DEALLOCATE|LISTEN|NOTIFY|'
    r'UNLISTEN|LOCK|VACUUM|REINDEX|CLUSTER|PERFORM|CALL)\b'
    r'|\bALTER\s+(?:SYSTEM|DATABASE|ROLE|USER|SCHEMA|DEFAULT\s+PRIVILEGES)\b'
    r'|\bCREATE\s+(?:ROLE|USER|SCHEMA|TYPE|DOMAIN|SEQUENCE|OPERATOR|AGGREGATE|CAST|FOREIGN)\b'
    r'|\bSET\s+(?:ROLE|SESSION|SEARCH_PATH)\b'
    r'|\bSECURITY\s+DEFINER\b',
    re.IGNORECASE,
)
_NON_ENGINE_STMT_PATTERNS = (
    re.compile(r'^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(' + _NON_ENGINE_TABLE + r')\s*\(', re.IGNORECASE),
    re.compile(r'^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.(' + _NON_ENGINE_TABLE + r')\s+', re.IGNORECASE),
    re.compile(
        r'^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?'
        r'[a-z_][a-z0-9_]*\s+ON\s+public\.(' + _NON_ENGINE_TABLE + r')\b',
        re.IGNORECASE,
    ),
    re.compile(
        r'^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.(' + _NON_ENGINE_TABLE + r')\s+AS\s+SELECT\b',
        re.IGNORECASE,
    ),
    re.compile(
        r'^CREATE\s+POLICY\s+[a-z_][a-z0-9_]*\s+ON\s+public\.(' + _NON_ENGINE_TABLE + r')\b',
        re.IGNORECASE,
    ),
    re.compile(
        r'^COMMENT\s+ON\s+(?:TABLE|VIEW|INDEX)\s+public\.(' + _NON_ENGINE_TABLE + r')\s+IS\s+__STR__$',
        re.IGNORECASE,
    ),
    re.compile(
        r'^COMMENT\s+ON\s+COLUMN\s+public\.(' + _NON_ENGINE_TABLE + r')\.[a-z_][a-z0-9_]*\s+IS\s+__STR__$',
        re.IGNORECASE,
    ),
    re.compile(r'^INSERT\s+INTO\s+public\.(' + _NON_ENGINE_TABLE + r')\b', re.IGNORECASE),
    re.compile(r'^UPDATE\s+public\.(' + _NON_ENGINE_TABLE + r')\s+SET\b', re.IGNORECASE),
    re.compile(r'^DELETE\s+FROM\s+public\.(' + _NON_ENGINE_TABLE + r')\b', re.IGNORECASE),
)
_QUALIFIED_REF_RE = re.compile(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b')
_TABLE_CLAUSE_RE = re.compile(r'\b(?:FROM|JOIN|REFERENCES|INTO)\s+([a-zA-Z_][a-zA-Z0-9_.]*)', re.IGNORECASE)
_CUSTOM_FN_CALL_RE = re.compile(r'\b(?:fn|ca|sp|rpc)_[a-zA-Z0-9_]*\s*\(', re.IGNORECASE)
_LOCK_TIMEOUT_RE = re.compile(r"^SET\s+LOCAL\s+lock_timeout\s*=\s*'[0-9]{1,3}s'$", re.IGNORECASE)


def _strip_sql_and_split(text):
    """Strip -- line comments, mask single-quoted strings as __STR__, and split
    into (raw_stmt, masked_stmt) pairs on top-level semicolons. Returns None on
    any block comment, dollar-quote, unterminated string, or trailing junk."""
    if '/*' in text or '*/' in text or '$' in text:
        return None
    raw_buf = []
    masked_buf = []
    stmts = []
    in_str = False
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if in_str:
            raw_buf.append(ch)
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    raw_buf.append("'")
                    i += 2
                    continue
                in_str = False
            i += 1
            continue
        if ch == '-' and i + 1 < n and text[i + 1] == '-':
            while i < n and text[i] != '\n':
                i += 1
            continue
        if ch == "'":
            in_str = True
            raw_buf.append(ch)
            masked_buf.append('__STR__')
            i += 1
            continue
        if ch == ';':
            raw_s = ''.join(raw_buf).strip()
            masked_s = ' '.join(''.join(masked_buf).split())
            raw_buf.clear()
            masked_buf.clear()
            if not masked_s:
                return None
            stmts.append((raw_s, masked_s))
            i += 1
            continue
        raw_buf.append(ch)
        masked_buf.append(ch)
        i += 1
    if in_str or ''.join(masked_buf).strip():
        return None
    return stmts


def _is_horse_option_register_inert(text):
    """O33: horse-option register/allow_shadow/unlock literal-only migrations."""
    lines = []
    for raw in text.split('\n'):
        line = raw.strip()
        if not line or line.startswith('--'):
            continue
        lines.append(line)
    if len(lines) < 3 or lines[0] != 'BEGIN;' or lines[-1] != 'COMMIT;':
        return False
    calls = 0
    for line in lines[1:-1]:
        if any(p.fullmatch(line) for p in INERT_CALLS):
            calls += 1
        elif not INERT_FRAME[1].fullmatch(line):
            return False
    return calls > 0


def _is_non_engine_table_inert(text):
    """Fail-closed verifier for strictly non-engine public table/view/index/policy
    migrations. Returns True ONLY when EVERY statement targets a verified
    non-engine allowlisted table/view, contains zero forbidden DDL/functions/
    triggers/DO-blocks, and makes zero references to any engine or unknown table."""
    if re.search(r'^--\s*(?:@install-window:|SUPERSEDED BY\b)', text, re.MULTILINE | re.IGNORECASE):
        return False
    stmts = _strip_sql_and_split(text)
    if not stmts:
        return False
    # Optional BEGIN ... COMMIT frame must be balanced if present.
    body = list(stmts)
    has_begin = body[0][1].upper() == 'BEGIN'
    has_commit = body[-1][1].upper() == 'COMMIT'
    if has_begin != has_commit:
        return False
    if has_begin:
        body = body[1:-1]
    if not body:
        return False

    non_frame = 0
    for raw_s, masked_s in body:
        upper = masked_s.upper()
        if upper in ('BEGIN', 'COMMIT'):
            return False
        if _LOCK_TIMEOUT_RE.fullmatch(' '.join(raw_s.split())):
            continue
        if _FORBIDDEN_SQL_RE.search(masked_s):
            return False
        if _CUSTOM_FN_CALL_RE.search(masked_s):
            return False
        matched_table = None
        for pat in _NON_ENGINE_STMT_PATTERNS:
            m = pat.match(masked_s)
            if m:
                matched_table = m.group(1)
                break
        if not matched_table or not _NON_ENGINE_TABLE_RE.fullmatch(matched_table):
            return False
        if _ENGINE_DOMAIN_TOKEN_RE.search(matched_table):
            return False
        # CREATE POLICY must never embed a subquery (FROM/JOIN or parenthesized SELECT).
        if upper.startswith('CREATE POLICY ') and re.search(r'\b(?:FROM|JOIN)\b|\(\s*SELECT\b', masked_s, re.IGNORECASE):
            return False
        # Every schema-qualified reference must be public.<allowed_non_engine>,
        # auth.users (FK), auth.uid/role/jwt, or <allowed_non_engine>.<col>.
        for schema, obj in _QUALIFIED_REF_RE.findall(masked_s):
            s_low, o_low = schema.lower(), obj.lower()
            if s_low == 'public':
                if not _NON_ENGINE_TABLE_RE.fullmatch(o_low) or _ENGINE_DOMAIN_TOKEN_RE.search(o_low):
                    return False
            elif s_low == 'auth':
                if o_low not in ('users', 'uid', 'role', 'jwt'):
                    return False
            elif _NON_ENGINE_TABLE_RE.fullmatch(s_low) and not _ENGINE_DOMAIN_TOKEN_RE.search(s_low):
                # Column qualifier on an allowlisted table (e.g. COMMENT ON COLUMN public.t.c)
                continue
            else:
                return False
        # Every FROM/JOIN/REFERENCES/INTO target must be explicitly public.<allowed> or auth.users.
        for target in _TABLE_CLAUSE_RE.findall(masked_s):
            t_low = target.lower()
            if t_low == 'auth.users':
                continue
            if not t_low.startswith('public.'):
                return False
            tbl = t_low[len('public.'):]
            if not _NON_ENGINE_TABLE_RE.fullmatch(tbl) or _ENGINE_DOMAIN_TOKEN_RE.search(tbl):
                return False
        non_frame += 1
    return non_frame > 0


def engine_inert(text):
    """True only when the migration is machine-verified engine-inert: either an
    O33 horse-option whitelist register migration OR a strictly non-engine
    allowlisted table/view/index/policy migration with zero engine references.
    Fail closed on any ambiguity, unknown table/DDL, function, trigger, DO block,
    block comment, dollar-quoting, or non-text byte."""
    if not isinstance(text, str) or '\x00' in text:
        return False
    return _is_horse_option_register_inert(text) or _is_non_engine_table_inert(text)


def _migration_blobs(repo, sha):
    """{version: [(path, blob), ...]} of the tree's migration files."""
    blobs = {}
    for line in git(repo, 'ls-tree', '-r', sha, '--', MIGRATIONS).splitlines():
        meta, _, path = line.partition('\t')
        parts = meta.split()
        match = TREE_FILE.fullmatch(path.rsplit('/', 1)[-1])
        if len(parts) == 3 and parts[1] == 'blob' and match:
            blobs.setdefault(match[1], []).append((path, parts[2]))
    return blobs


def inert_versions(repo, control, *others):
    """Versions whose one file in control's tree is engine_inert() and which
    none of `others` (the exact target) ships. A certified copy holds what its
    target ships (the candidate's own files are required by version and name),
    so only versions merged after the target can be missing from it. Fail safe:
    no control, an invalid SHA or anything git cannot list or show returns an
    empty set, which leaves nothing out."""
    try:
        for sha in (control, *others):
            if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{40}', sha):
                return frozenset()
        if control in others:
            return frozenset()
        mine = _migration_blobs(repo, control)
        theirs = [_migration_blobs(repo, sha) for sha in others]
        if others:
            diff_candidates = [
                (version, entries[0][1])
                for version, entries in mine.items()
                if len(entries) == 1 and not any(version in other for other in theirs)
            ]
            if not diff_candidates:
                return frozenset()
        else:
            diff_candidates = None
        if diff_candidates is not None and len(diff_candidates) <= 64:
            candidates = diff_candidates
        else:
            hits = git(repo, 'grep', '-l', '-E', '-e', INERT_HINT, control, '--', MIGRATIONS, ok=(0, 1))
            candidates = []
            for hit in hits.splitlines():
                path = hit.split(':', 1)[1] if hit.startswith(control + ':') else hit
                match = TREE_FILE.fullmatch(path.rsplit('/', 1)[-1])
                if not match or len(mine.get(match[1], [])) != 1 or mine[match[1]][0][0] != path:
                    continue
                version, blob = match[1], mine[match[1]][0][1]
                if any(version in other for other in theirs):
                    continue
                candidates.append((version, blob))
        if not candidates:
            return frozenset()
        batch_in = ('\n'.join(blob for _, blob in candidates) + '\n').encode('ascii')
        raw = subprocess.run(
            ['git', '-C', repo, 'cat-file', '--batch'],
            input=batch_in,
            capture_output=True,
            timeout=30,
            env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_NO_LAZY_FETCH': '1'},
        )
        if raw.returncode:
            return frozenset()
        buf = raw.stdout
        pos = 0
        found = set()
        for version, expected_blob in candidates:
            nl = buf.find(b'\n', pos)
            if nl < 0:
                return frozenset()
            header = buf[pos:nl].decode('ascii', errors='strict').split()
            pos = nl + 1
            if len(header) != 3 or header[0] != expected_blob or header[1] != 'blob':
                return frozenset()
            size = int(header[2])
            if pos + size + 1 > len(buf) or buf[pos + size:pos + size + 1] != b'\n':
                return frozenset()
            content = buf[pos:pos + size]
            pos += size + 1
            try:
                text = content.decode('utf-8')
            except UnicodeDecodeError:
                continue
            if engine_inert(text):
                found.add(version)
        if pos != len(buf):
            return frozenset()
        return frozenset(found)
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError):
        return frozenset()


INERT_SUBSET_LIMIT = 10


def bounded_inert(inert, production):
    """`inert`, or nothing when production holds more of it than the cutover
    can try (inert_left_out), so a copy the selector accepts is one the cutover
    can recognise."""
    return inert if len([v for v in inert if v in production]) <= INERT_SUBSET_LIMIT else frozenset()


def inert_left_out(production, inert, certified):
    """The engine-inert versions whose removal from production's comparable set
    gives exactly the certified digest, or None. The certificate names only a
    digest of the copy's set, so the cutover tries each non-empty subset of the
    inert versions production holds (at most INERT_SUBSET_LIMIT of them; more
    leaves nothing out). A match means production is the certified copy's set
    plus those versions and nothing else, which is what the selector accepted."""
    held = sorted(v for v in inert if v in production)
    if not held or len(held) > INERT_SUBSET_LIMIT:
        return None
    for mask in range(1, 1 << len(held)):
        drop = [v for i, v in enumerate(held) if mask >> i & 1]
        if digest({v: n for v, n in production.items() if v not in drop}) == certified:
            return drop
    return None


def inert_note(copy, production, inert):
    """The inert versions on which the copy and production actually differ."""
    left = sorted(v for v in inert if copy.get(v, ...) != production.get(v, ...))
    return '; left out as engine-inert: ' + ', '.join(left) if left else ''


def evidence_module():
    """server/standby/schema-evidence.py: the one definition of the evidence."""
    path = Path(__file__).resolve().parents[2] / 'server/standby/schema-evidence.py'
    spec = importlib.util.spec_from_file_location('schema_evidence', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rows_of(migrations):
    """{version: name} from the evidence's [[version, name], ...]."""
    if not isinstance(migrations, list) or not migrations:
        raise ValueError('installed migration set is empty or unreadable')
    rows = {}
    for row in migrations:
        if (not isinstance(row, list) or len(row) != 2 or not isinstance(row[0], str) or not row[0]
                or (row[1] is not None and not isinstance(row[1], str)) or row[0] in rows):
            raise ValueError('installed migration set has a malformed or repeated row')
        rows[row[0]] = row[1]
    return rows


def canonical(rows):
    return json.dumps([[v, rows[v]] for v in sorted(rows)], separators=(',', ':'), ensure_ascii=False)


def digest(rows):
    return hashlib.sha256(canonical(rows).encode()).hexdigest()


def git(repo, *args, ok=(0,)):
    result = subprocess.run(['git', '-C', repo, *args], capture_output=True, timeout=30,
                            env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_NO_LAZY_FETCH': '1'})
    if result.returncode not in ok:
        raise RuntimeError('git ' + args[0] + ' failed')
    return result.stdout.decode()


def window_versions(repo, sha):
    """Versions of the migration files in the exact tree that install in the break."""
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('target SHA is invalid')
    hits = git(repo, 'grep', '-l', '-E', '-e', WINDOW_ANNOTATION, sha, '--', MIGRATIONS, ok=(0, 1))
    versions = set()
    for hit in hits.splitlines():
        path = hit.split(':', 1)[1] if hit.startswith(sha + ':') else hit
        match = FILE.fullmatch(path.rsplit('/', 1)[-1])
        if match:
            versions.add(match[1])
    return versions


def resolve_superseded(marks, present):
    """Versions whose supersession resolves, fail closed.

    `marks` maps a version to the successor its head names; `present` is the
    tree's version set. A file is skipped only when following SUPERSEDED BY
    from it reaches, without revisiting any version, a present file that is
    itself still required: one with no mark, or one whose own successor is
    absent. A cycle, or a chain that only reaches files lacking from the
    tree, leaves every file on it required."""
    skipped = set()
    for version in marks:
        current, seen = version, {version}
        while True:
            successor = marks[current]
            if successor not in present:
                resolved = current != version  # current is the required endpoint
                break
            if successor in seen:
                resolved = False  # a cycle never removes a requirement
                break
            if successor not in marks:
                resolved = True
                break
            seen.add(successor)
            current = successor
        if resolved:
            skipped.add(version)
    return skipped


def superseded_versions(repo, sha):
    """Versions of the migration files in the exact tree whose head says
    "-- SUPERSEDED BY <version>" naming another file present in that tree,
    resolved by resolve_superseded(). The protected applier refuses such a
    file ("must never run") and its successor installs instead, so production
    never records it. Same marker rule as supersededBy() in
    scripts/ci/check-migrations-are-live.mjs and engine-release-window-doors.py."""
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('target SHA is invalid')
    present = set()
    for path in git(repo, 'ls-tree', '--name-only', sha, '--', MIGRATIONS).split():
        match = FILE.fullmatch(path.rsplit('/', 1)[-1])
        if match:
            present.add(match[1])
    hits = git(repo, 'grep', '-l', '-E', '-e', SUPERSEDED_ANNOTATION, sha, '--', MIGRATIONS, ok=(0, 1))
    marks = {}
    for hit in hits.splitlines():
        path = hit.split(':', 1)[1] if hit.startswith(sha + ':') else hit
        match = FILE.fullmatch(path.rsplit('/', 1)[-1])
        if not match:
            continue
        mark = re.search(r'^--\s*SUPERSEDED BY\s+(\d{14})\b', git(repo, 'show', sha + ':' + path)[:400], re.M)
        if mark and mark[1] != match[1]:
            marks[match[1]] = mark[1]
    return resolve_superseded(marks, present)


def recorded_names(repo, target):
    """Read claims from the exact target, not the operator's mutable checkout.

    The working-tree recording-only.mjs guard permits unknown/malformed claims
    to fall back to ordinary SQL review. Release admission cannot use that
    fallback to guess an installed name. Reject ambiguous claims here; require
    the same exact path/version/file-byte MD5 binding before using any name.
    Historical trees without a manifest grant no recorded-name overrides.
    """
    if not git(repo, 'ls-tree', '--name-only', target, '--', RECORDINGS).strip():
        return {}
    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError('recorded migration manifest repeats a JSON field')
            value[key] = item
        return value
    doc = json.loads(git(repo, 'show', target + ':' + RECORDINGS), object_pairs_hook=unique_object)
    if not isinstance(doc, dict) or not isinstance(doc.get('recordings'), list):
        raise ValueError('recorded migration manifest has no recordings array')
    rows, paths = {}, set()
    for row in doc['recordings']:
        if not isinstance(row, dict):
            raise ValueError('recorded migration claim is malformed')
        version, path, name, md5 = (row.get(k) for k in ('version', 'file', 'name', 'md5'))
        match = FILE.fullmatch(path[len(MIGRATIONS):]) if isinstance(path, str) and path.startswith(MIGRATIONS) else None
        if (not isinstance(version, str) or not re.fullmatch(r'[0-9]{14}', version)
                or not match or match[1] != version
                or not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', name)
                or not isinstance(md5, str) or not re.fullmatch(r'[0-9a-f]{32}', md5)):
            raise ValueError('recorded migration claim has an invalid version, path, name or MD5')
        if version in rows or path in paths:
            raise ValueError('recorded migration manifest repeats a version or path')
        rows[version] = row
        paths.add(path)
    return rows


def required_by(repo, serving, target, skip=frozenset()):
    """{version: name} of the migration files the exact candidate adds or
    changes relative to serving, less `skip` (window files, installed inside
    the break) and less files the candidate marks SUPERSEDED BY a successor
    in its own tree (the applier refuses them; the successor is required in
    their place). Ordinary files use their filename slug. A byte-exact recording
    instead names the immutable installed history entry in the target manifest;
    it neither changes production history nor authorizes replaying the SQL."""
    for sha in (serving, target):
        if not re.fullmatch(r'[0-9a-f]{40}', sha):
            raise ValueError('expected exact commit SHAs')
    skip = set(skip) | superseded_versions(repo, target)
    recordings = recorded_names(repo, target)
    paths_by_version = {}
    for path in git(repo, 'ls-tree', '-r', '--name-only', target, '--', MIGRATIONS).splitlines():
        match = FILE.fullmatch(path.rsplit('/', 1)[-1])
        if match:
            paths_by_version.setdefault(match[1], []).append(path)
    required = {}
    for path in git(repo, 'diff', '--no-renames', '--name-only', '--diff-filter=AM', serving, target,
                    '--', MIGRATIONS).splitlines():
        match = FILE.fullmatch(path.rsplit('/', 1)[-1])
        if match and match[1] not in skip:
            version, name = match[1], match[2]
            if paths_by_version.get(version) != [path]:
                raise ValueError('candidate migration version collides: ' + version)
            row = recordings.get(version)
            if row:
                if row['file'] != path:
                    raise ValueError('recorded migration path differs from candidate: ' + version)
                contents = git(repo, 'show', target + ':' + path).encode('utf-8')
                if hashlib.md5(contents).hexdigest() != row['md5']:
                    raise ValueError('recorded migration bytes differ from target manifest: ' + version)
                name = row['name']
            required[version] = name
    return required


def tree_versions(repo, *shas):
    """Versions of every migration file in the union of the exact trees, or
    None unless every SHA is given and its tree lists. None leaves nothing out
    (A FOREIGN MIGRATION IS NOT OURS): an unreadable tree never certifies more
    than before."""
    if not shas:
        return None
    versions = set()
    for sha in shas:
        if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{40}', sha):
            return None
        try:
            listing = git(repo, 'ls-tree', '-r', '--name-only', sha, '--', MIGRATIONS)
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError):
            return None
        found = set()
        for path in listing.splitlines():
            match = TREE_FILE.fullmatch(path.rsplit('/', 1)[-1])
            if match:
                found.add(match[1])
        if not found:
            return None
        versions |= found
    return versions


def ours(rows, tree, inert=frozenset()):
    """The rows whose version the tree ships (every row when tree is None),
    less engine-inert versions (inert_versions(); none when empty)."""
    return {v: n for v, n in rows.items() if (tree is None or v in tree) and v not in inert}


def foreign_note(rows, tree):
    count = len(rows) - len(ours(rows, tree))
    return f'; {count} version(s) Club Arena never shipped left out' if count else ''


def comparable(rows, windows, tree=None, inert=frozenset()):
    return {v: n for v, n in ours(rows, tree, inert).items() if v not in windows}


def lacking_required(required, installed):
    # Preserve the applier's historical 55-character name representation.
    return sorted(v for v, name in required.items() if installed.get(v) not in (name, name[:55]))


def compare(copy, production):
    """What separates the copy's set from production's (all sorted)."""
    return {
        'missing': sorted(v for v in production if v not in copy),
        'extra': sorted(v for v in copy if v not in production),
        'differs': sorted(v for v in copy if v in production and copy[v] != production[v]),
    }


def describe(difference, limit=5):
    parts = []
    for key, words in (('missing', 'lacks installed migration'), ('extra', 'holds migration production does not have'),
                       ('differs', 'holds a different name for')):
        items = difference[key]
        if items:
            shown = ', '.join(items[:limit]) + (f' and {len(items) - limit} more' if len(items) > limit else '')
            parts.append(f'{words} {shown}')
    return '; '.join(parts)


def differing_functions(copy, production):
    return sorted(s for s in set(copy) | set(production) if copy.get(s) != production.get(s))


def read_production_psql(url=None):
    """Production's installed set and required definition hashes, now, through
    the release workflows' read-only DATABASE_URL: the same rows and the same
    hashing as schema-evidence.py capture, so the two compare exactly."""
    url = url or os.environ.get('DATABASE_URL', '')
    if not url:
        raise ValueError('DATABASE_URL is not set; production installed migrations are unreadable')
    se = evidence_module()
    signatures = ','.join("'" + s + "'" for s in se.SIGNATURES)
    sql = ("SELECT json_build_object('migrations', (SELECT json_agg(json_build_array(version,name) "
           "ORDER BY version,name) FROM supabase_migrations.schema_migrations), 'functions', "
           "(SELECT json_object_agg(signature, pg_get_functiondef(to_regprocedure(signature))) "
           f"FROM unnest(ARRAY[{signatures}]) AS signatures(signature)));")
    env = {**os.environ, 'PGOPTIONS': '-c default_transaction_read_only=on -c statement_timeout=30000',
           'PGCONNECT_TIMEOUT': '10'}
    env.pop('LD_LIBRARY_PATH', None)
    result = subprocess.run(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '--dbname', url],
                            input=sql, capture_output=True, text=True, timeout=90, env=env)
    if result.returncode:
        raise ValueError('production installed migrations are unreadable (psql exit %d)' % result.returncode)
    return production_from(json.loads(result.stdout))


def production_from(doc):
    """{'migrations': {version: name}, 'functions': {signature: sha256}}."""
    se = evidence_module()
    bodies = doc['functions']
    if set(bodies) != set(se.SIGNATURES) or any(not isinstance(b, str) or not b for b in bodies.values()):
        raise ValueError('a required function definition is missing in production')
    return {'migrations': rows_of(doc['migrations']),
            'functions': {s: hashlib.sha256(b.encode()).hexdigest() for s, b in bodies.items()}}


def bound_evidence(evidence_bytes, evidence_sha, dump_sha=None):
    """The copy's evidence, only if it is the file its copy recorded."""
    if not isinstance(evidence_bytes, (bytes, bytearray)) or not evidence_bytes:
        raise ValueError('the copy records no installed schema evidence')
    if not DIGEST.fullmatch(evidence_sha or '') or hashlib.sha256(evidence_bytes).hexdigest() != evidence_sha:
        raise ValueError('schema-evidence.json is not the evidence its copy recorded')
    evidence = evidence_module().validate(json.loads(evidence_bytes.decode()))
    if dump_sha is not None and evidence.get('dumpSha256') != dump_sha:
        raise ValueError('schema evidence is bound to a different dump')
    return evidence


def judge(evidence_bytes, database, production, required=None, tree=None, inert=frozenset()):
    """(ok, reason) for the daily selector. Contents decide; nothing else.
    `required` ({version: name}, or a callable returning it) is read only once
    the copy's set and definitions already equal production's. `tree` is
    tree_versions(target, control): versions outside it are compared on
    neither side; None compares every version. `inert` is
    inert_versions(control, target): compared on neither side (O33)."""
    try:
        if database.get('schemaEvidenceValidated') is not True:
            raise ValueError('the restore did not validate its schema evidence')
        evidence = bound_evidence(evidence_bytes, database.get('schemaEvidenceSha256'), database.get('dumpSha256'))
        copy = rows_of(evidence['migrations'])
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        return False, f'Backup schema evidence is invalid ({error})'
    inert = bounded_inert(inert, production['migrations'])
    difference = compare(ours(copy, tree, inert), ours(production['migrations'], tree, inert))
    note = inert_note(copy, production['migrations'], inert)
    if any(difference.values()):
        return False, 'Backup copy ' + describe(difference) + note
    changed = differing_functions(evidence['functions'], production['functions'])
    if changed:
        return False, 'Backup copy does not hold production\'s definition of ' + ', '.join(changed[:5])
    if callable(required):
        required = required()
    lacking = lacking_required(required or {}, copy)
    if lacking:
        return False, 'Backup copy lacks the exact candidate migration(s) ' + ', '.join(lacking[:5])
    return True, (f'Backup copy holds production\'s installed migrations {digest(ours(copy, tree, inert))[:12]}'
                  + foreign_note(production['migrations'], tree) + note)


def recently_added(repo, control, hours=26):
    """Versions of ordinary migration files control's first-parent line added
    in the last `hours`. The commit time only chooses which files to wait for;
    whether one is installed is read from production."""
    if not re.fullmatch(r'[0-9a-f]{40}', control):
        raise ValueError('control SHA is invalid')
    names = git(repo, 'log', '--first-parent', f'--since={hours} hours ago', '--diff-filter=A', '--name-only',
                '--format=', control, '--', MIGRATIONS).split()
    windows = window_versions(repo, control)
    # A superseded file never installs, so a refresh never waits for it.
    windows |= superseded_versions(repo, control)
    present = set(git(repo, 'ls-tree', '--name-only', control, '--', MIGRATIONS).split())
    versions = set()
    for path in names:
        match = FILE.fullmatch(path.rsplit('/', 1)[-1])
        if path in present and match and match[1] not in windows:
            versions.add(match[1])
    return versions


def await_installed(versions, read, wait, pause=20, clock=time.time, sleep=time.sleep):
    """Production once every version is installed or `wait` runs out.

    A merged migration installs about a minute after its merge (Apply Merged
    Migration); a copy exported in that minute would lack it, so a refresh
    waits for it first, bounded."""
    deadline = clock() + wait
    while True:
        production = read()
        pending = sorted(v for v in versions if v not in production['migrations'])
        if not pending or clock() >= deadline:
            return production, pending
        sleep(min(pause, max(1, deadline - clock())))


def refresh_due(evidence_bytes, evidence_sha, production, tree=None, inert=frozenset()):
    """(due, reason). Absent, unbound or different evidence is always due.
    Versions outside `tree` (tree_versions() of --control and --sha) are
    compared on neither side; None compares every version."""
    now = digest(production['migrations'])
    try:
        evidence = bound_evidence(evidence_bytes, evidence_sha)
        copy = rows_of(evidence['migrations'])
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        return True, f'{error}; production holds {len(production["migrations"])} migrations ({now[:12]})'
    inert = bounded_inert(inert, production['migrations'])
    difference = compare(ours(copy, tree, inert), ours(production['migrations'], tree, inert))
    note = inert_note(copy, production['migrations'], inert)
    if any(difference.values()):
        return True, f'the copy ({digest(copy)[:12]}) {describe(difference)}; production holds {now[:12]}{note}'
    changed = differing_functions(evidence['functions'], production['functions'])
    if changed:
        return True, 'the copy does not hold production\'s definition of ' + ', '.join(changed[:5])
    return False, (f'the copy holds production\'s installed set {now[:12]} and its required definitions'
                   + foreign_note(production['migrations'], tree) + note)


def certified_digest(evidence_bytes, certificate, repo, sha, control=None):
    """The comparable set the certificate names, from evidence bound to the
    certified copy (its file digest and its dump). Versions neither the
    target's nor control's tree ships are left out; no control, none are."""
    database = certificate['database']
    if certificate.get('sha') != sha or database.get('schemaEvidenceValidated') is not True:
        raise ValueError('the certificate is not a validated copy of this SHA')
    evidence = bound_evidence(evidence_bytes, database.get('schemaEvidenceSha256'), database.get('dumpSha256'))
    rows = rows_of(evidence['migrations'])
    tree = tree_versions(repo, sha, control) if control else None
    return digest(comparable(rows, window_versions(repo, sha), tree)), len(rows)


# ---- the release host: production through the engine's REST credential ----

def read_env(path):
    values = {}
    with open(path, encoding='utf-8') as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[7:].lstrip()
            if '=' not in line:
                continue
            key, value = line.split('=', 1)
            key = key.strip()
            if key not in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'):
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            values[key] = value
    return values


def read_production_rest(env_file):
    """[[version, name], ...] through fn_ca_installed_migration_listing()."""
    fixture = os.environ.get('ENGINE_INSTALLED_MIGRATIONS_PRODUCTION_FIXTURE')
    if fixture:
        with open(fixture, encoding='utf-8') as handle:
            text = handle.read()
        if text == 'unreadable':
            raise ValueError('production listing fixture is unreadable')
        return json.loads(text)
    values = read_env(env_file)
    base = values.get('SUPABASE_URL', '').rstrip('/')
    key = values.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if base != 'https://' + PROJECT_HOST or urlparse(base).netloc != PROJECT_HOST:
        raise ValueError('SUPABASE_URL is not the pinned Club Arena project origin')
    if not key:
        raise ValueError('SUPABASE_SERVICE_ROLE_KEY is absent')
    request = Request(base + '/rest/v1/rpc/fn_ca_installed_migration_listing', data=b'{}', method='POST',
                      headers={'apikey': key, 'Authorization': 'Bearer ' + key,
                               'Content-Type': 'application/json', 'Accept': 'application/json'})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode())


def certified_set(sha):
    """The installed set the newest backup-engine/certified success names."""
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('target SHA is invalid')
    fixture = os.environ.get('ENGINE_INSTALLED_MIGRATIONS_STATUS_FIXTURE')
    if fixture:
        with open(fixture, encoding='utf-8') as handle:
            rows = json.load(handle)
    else:
        request = Request(f'{REPO_API}/commits/{sha}/statuses?per_page=100',
                          headers={'Accept': 'application/vnd.github+json',
                                   'User-Agent': 'club-arena-engine-release-installed-migrations'})
        with urlopen(request, timeout=10) as response:
            rows = json.loads(response.read().decode())
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError('certificate statuses are unreadable')
    latest = next((row for row in rows if row.get('context') == CONTEXT), None)
    if not latest or latest.get('state') != 'success':
        raise LookupError('the newest Backup certificate of the target is not a success')
    match = CERTIFIED.search(latest.get('description') or '')
    if not match:
        raise LookupError('the newest Backup certificate names no installed migration set')
    return match[1]


def generation_control(path=None):
    """The control SHA of the immutable release generation this helper was
    installed into (its control-sha manifest), or '' when there is none, as
    in a source checkout: then status leaves nothing out."""
    path = Path(path) if path else Path(__file__).resolve().parent / 'control-sha'
    try:
        value = path.read_text(encoding='utf-8').strip()
    except (OSError, UnicodeDecodeError):
        return ''
    return value if re.fullmatch(r'[0-9a-f]{40}', value) else ''


def status(env_file, repo, sha, certified, attempts=2, pause=1, control=None):
    """Has production's installed set moved since the copy was certified?

    `certified` is the set the target's newest certificate names, less the
    exact target's own window-declared versions (installed only inside the
    break; their doors are re-read by engine-release-window-doors.py). The
    same versions are left out of production's set here; everything else must
    be identical. Versions neither the target's nor `control`'s tree ships
    are left out, as certified-digest left them out of `certified`; no
    control, or an unreadable tree, leaves none out.
    Any other migration installed after certification refuses: the current
    engine keeps running."""
    if not DIGEST.fullmatch(certified or ''):
        print('REFUSED - no certified installed migration set was supplied')
        return REFUSED
    windows = window_versions(repo, sha)
    tree = tree_versions(repo, sha, control) if control else None
    inert = inert_versions(repo, control, sha) if control else frozenset()
    last = None
    for attempt in range(attempts):
        try:
            production = comparable(rows_of(read_production_rest(env_file)), windows, tree)
            break
        except (OSError, HTTPError, URLError, ValueError, TypeError, KeyError) as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(pause)
    else:
        print(f'UNKNOWN - production\'s installed migrations could not be compared: {str(last)[:200]}')
        return UNKNOWN
    now = digest(production)
    left = inert_left_out(production, inert, certified) if now != certified else None
    if left:
        print(f'READY - production holds the certified installed migration set {certified[:12]} plus '
              f'{len(left)} engine-inert migration(s) installed after certification; left out as engine-inert: '
              + ', '.join(left)
              + (f' (this target\'s {len(windows)} break-window file(s) are left to the door check)' if windows else ''))
        return READY
    if now != certified:
        print(f'REFUSED - production\'s installed migrations ({now[:12]}, {len(production)} rows) are not the '
              f'set the Backup copy was certified with ({certified[:12]}): a migration installed or changed '
              f'after certification')
        return REFUSED
    print(f'READY - production still holds the certified installed migration set {now[:12]}'
          + (f' (this target\'s {len(windows)} break-window file(s) are left to the door check)' if windows else ''))
    return READY


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    sub = parser.add_subparsers(dest='mode', required=True)
    r = sub.add_parser('refresh-due')
    r.add_argument('--copy-evidence', default='')
    r.add_argument('--copy-evidence-sha', default='')
    r.add_argument('--production', help='a production JSON file (tests); default: DATABASE_URL')
    r.add_argument('--repo', default='.')
    r.add_argument('--control')
    r.add_argument('--sha', help='exact candidate SHA for comparable production digest')
    r.add_argument('--wait', type=int, default=0)
    d = sub.add_parser('certified-digest')
    d.add_argument('--evidence', required=True)
    d.add_argument('--certificate', required=True)
    d.add_argument('--repo', default='.')
    d.add_argument('--sha', required=True)
    d.add_argument('--control', default='', help='the certifying control SHA; its tree is Club Arena\'s too')
    c = sub.add_parser('certified')
    c.add_argument('--sha', required=True)
    s = sub.add_parser('status')
    s.add_argument('--env-file', required=True)
    s.add_argument('--repo', required=True)
    s.add_argument('--sha', required=True)
    s.add_argument('--certified', required=True)
    s.add_argument('--control', default='',
                   help='the release control SHA (default: this generation\'s control-sha manifest)')
    p = sub.add_parser('candidate-ready')
    p.add_argument('--repo', default='.')
    p.add_argument('--serving', required=True)
    p.add_argument('--sha', required=True)
    p.add_argument('--production', help='saved installed rows or schema evidence; default: DATABASE_URL')
    args = parser.parse_args(argv)
    if args.mode == 'candidate-ready':
        try:
            required = required_by(args.repo, args.serving, args.sha, window_versions(args.repo, args.sha))
            if args.production:
                with open(args.production, encoding='utf-8') as handle:
                    saved = json.load(handle)
                installed = rows_of(saved['migrations'] if isinstance(saved, dict) else saved)
            else:
                installed = read_production_psql()['migrations']
            lacking = lacking_required(required, installed)
        except (OSError, RuntimeError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
            print(f'UNKNOWN - candidate migration requirements could not be proved: {str(exc)[:200]}')
            return UNKNOWN
        if lacking:
            print('REFUSED - production lacks the exact candidate migration(s) ' + ', '.join(lacking[:5]))
            return REFUSED
        print(f'READY - production holds all {len(required)} ordinary candidate migrations by version and name')
        return READY
    if args.mode == 'certified':
        try:
            print(certified_set(args.sha))
            return READY
        except LookupError as exc:
            print(f'REFUSED - {exc}', file=sys.stderr)
            return REFUSED
        except (OSError, HTTPError, URLError, ValueError, TypeError, KeyError) as exc:
            print(f'UNKNOWN - the target certificate could not be read: {str(exc)[:200]}', file=sys.stderr)
            return UNKNOWN
    if args.mode == 'status':
        try:
            return status(args.env_file, args.repo, args.sha, args.certified,
                          control=args.control or generation_control())
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as exc:
            print(f'UNKNOWN - {str(exc)[:200]}')
            return UNKNOWN
    if args.mode == 'certified-digest':
        try:
            with open(args.evidence, 'rb') as handle:
                evidence = handle.read()
            with open(args.certificate, encoding='utf-8') as handle:
                certificate = json.load(handle)
            value, count = certified_digest(evidence, certificate, args.repo, args.sha, args.control)
        except (OSError, RuntimeError, ValueError, KeyError, TypeError, AttributeError) as exc:
            print(f'installed migrations: {str(exc)[:300]}', file=sys.stderr)
            return REFUSED
        print(value)
        print(f'certified copy holds {count} installed migrations; comparable at cutover: {value}', file=sys.stderr)
        return READY
    if args.mode == 'refresh-due':
        def read():
            if args.production:
                with open(args.production, encoding='utf-8') as handle:
                    return production_from(json.load(handle))
            return read_production_psql()
        try:
            waiting = recently_added(args.repo, args.control) if args.control and args.wait > 0 else set()
            production, pending = await_installed(waiting, read, args.wait)
        except (OSError, RuntimeError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
            print('due=true')
            print(f'reason=production\'s installed migrations are unreadable ({str(exc)[:120]}); refreshing',
                  file=sys.stderr)
            return 0
        try:
            with open(args.copy_evidence, 'rb') as handle:
                evidence = handle.read()
        except OSError:
            evidence = b''
        # Club Arena's versions are those its given trees ship (control, --sha).
        given = [s for s in (args.control, args.sha) if s]
        due_tree = tree_versions(args.repo, *given) if given else None
        # Engine-inert versions are read from control's tree (O33); no control, none.
        due_inert = inert_versions(args.repo, args.control, *([args.sha] if args.sha else [])) \
            if args.control else frozenset()
        due, why = refresh_due(evidence, args.copy_evidence_sha, production, due_tree, due_inert)
        if pending:
            why += f'; still not installed after {args.wait}s: {", ".join(pending[:5])}'
        comparable_sha = args.sha or args.control
        comparable_digest = ''
        if comparable_sha and re.fullmatch(r'[0-9a-f]{40}', comparable_sha):
            try:
                # The same trees certified-digest reads (--sha and --control), else none.
                tree = tree_versions(args.repo, args.sha, args.control) if args.sha and args.control else None
                comparable_digest = digest(comparable(production['migrations'],
                                                      window_versions(args.repo, comparable_sha), tree))
            except (OSError, RuntimeError, ValueError, subprocess.SubprocessError):
                comparable_digest = ''
        print(f'due={"true" if due else "false"}')
        print(f'production={digest(production["migrations"])}')
        print(f'pending={",".join(pending)}')
        if comparable_digest:
            print(f'comparable={comparable_digest}')
        print(f'reason={why}', file=sys.stderr)
        return 0
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
