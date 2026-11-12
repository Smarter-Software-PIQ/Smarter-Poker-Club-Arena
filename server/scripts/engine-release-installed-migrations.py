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
  certified-digest --evidence F --certificate C --sha S
                                       the set the certificate will name
  certified --sha S                    the set the target's certificate names
  status --env-file F --repo R --sha S --certified D
                                       exit 0 unchanged, 1 refused, 3 unknown

THE COMPARABLE SET. A migration declaring "-- @install-window: daily-
maintenance" installs only inside the 04:00 break, after certification and
before cutover; its doors are re-read separately (engine-release-window-
doors.py). The certificate therefore names the copy's set less the exact
target's own window files, the cutover leaves the same versions out of
production's set, and everything else must be identical.

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
READY, REFUSED, UNKNOWN = 0, 1, 3


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
                            env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1'})
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


def superseded_versions(repo, sha):
    """Versions of the migration files in the exact tree whose head says
    "-- SUPERSEDED BY <version>" naming another file present in that tree.
    The protected applier refuses such a file ("must never run") and its
    successor installs instead, so production never records it. Same rule as
    supersededBy() in scripts/ci/check-migrations-are-live.mjs and
    engine-release-window-doors.py."""
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('target SHA is invalid')
    present = set()
    for path in git(repo, 'ls-tree', '--name-only', sha, '--', MIGRATIONS).split():
        match = FILE.fullmatch(path.rsplit('/', 1)[-1])
        if match:
            present.add(match[1])
    hits = git(repo, 'grep', '-l', '-E', '-e', SUPERSEDED_ANNOTATION, sha, '--', MIGRATIONS, ok=(0, 1))
    versions = set()
    for hit in hits.splitlines():
        path = hit.split(':', 1)[1] if hit.startswith(sha + ':') else hit
        match = FILE.fullmatch(path.rsplit('/', 1)[-1])
        if not match:
            continue
        mark = re.search(r'^--\s*SUPERSEDED BY\s+(\d{14})\b', git(repo, 'show', sha + ':' + path)[:400], re.M)
        if mark and mark[1] != match[1] and mark[1] in present:
            versions.add(match[1])
    return versions


def required_by(repo, serving, target, skip=frozenset()):
    """{version: name} of the migration files the exact candidate adds or
    changes relative to serving, less `skip` (window files, installed inside
    the break) and less files the candidate marks SUPERSEDED BY a successor
    in its own tree (the applier refuses them; the successor is required in
    their place). The protected applier records a file's version and its name
    (the filename slug)."""
    for sha in (serving, target):
        if not re.fullmatch(r'[0-9a-f]{40}', sha):
            raise ValueError('expected exact commit SHAs')
    skip = set(skip) | superseded_versions(repo, target)
    required = {}
    for path in git(repo, 'diff', '--no-renames', '--name-only', '--diff-filter=AM', serving, target,
                    '--', MIGRATIONS).splitlines():
        match = FILE.fullmatch(path.rsplit('/', 1)[-1])
        if match and match[1] not in skip:
            required[match[1]] = match[2]
    return required


def comparable(rows, windows):
    return {v: n for v, n in rows.items() if v not in windows}


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


def judge(evidence_bytes, database, production, required=None):
    """(ok, reason) for the daily selector. Contents decide; nothing else.
    `required` ({version: name}, or a callable returning it) is read only once
    the copy's set and definitions already equal production's."""
    try:
        if database.get('schemaEvidenceValidated') is not True:
            raise ValueError('the restore did not validate its schema evidence')
        evidence = bound_evidence(evidence_bytes, database.get('schemaEvidenceSha256'), database.get('dumpSha256'))
        copy = rows_of(evidence['migrations'])
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        return False, f'Backup schema evidence is invalid ({error})'
    difference = compare(copy, production['migrations'])
    if any(difference.values()):
        return False, 'Backup copy ' + describe(difference)
    changed = differing_functions(evidence['functions'], production['functions'])
    if changed:
        return False, 'Backup copy does not hold production\'s definition of ' + ', '.join(changed[:5])
    if callable(required):
        required = required()
    lacking = sorted(v for v, name in (required or {}).items() if copy.get(v) not in (name, name[:55]))
    if lacking:
        return False, 'Backup copy lacks the exact candidate migration(s) ' + ', '.join(lacking[:5])
    return True, f'Backup copy holds production\'s installed migrations {digest(copy)[:12]}'


def recently_added(repo, control, hours=26):
    """Versions of ordinary migration files control's first-parent line added
    in the last `hours`. The commit time only chooses which files to wait for;
    whether one is installed is read from production."""
    if not re.fullmatch(r'[0-9a-f]{40}', control):
        raise ValueError('control SHA is invalid')
    names = git(repo, 'log', '--first-parent', f'--since={hours} hours ago', '--diff-filter=A', '--name-only',
                '--format=', control, '--', MIGRATIONS).split()
    windows = window_versions(repo, control)
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


def refresh_due(evidence_bytes, evidence_sha, production):
    """(due, reason). Absent, unbound or different evidence is always due."""
    now = digest(production['migrations'])
    try:
        evidence = bound_evidence(evidence_bytes, evidence_sha)
        copy = rows_of(evidence['migrations'])
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        return True, f'{error}; production holds {len(production["migrations"])} migrations ({now[:12]})'
    difference = compare(copy, production['migrations'])
    if any(difference.values()):
        return True, f'the copy ({digest(copy)[:12]}) {describe(difference)}; production holds {now[:12]}'
    changed = differing_functions(evidence['functions'], production['functions'])
    if changed:
        return True, 'the copy does not hold production\'s definition of ' + ', '.join(changed[:5])
    return False, f'the copy holds production\'s installed set {now[:12]} and its required definitions'


def certified_digest(evidence_bytes, certificate, repo, sha):
    """The comparable set the certificate names, from evidence bound to the
    certified copy (its file digest and its dump)."""
    database = certificate['database']
    if certificate.get('sha') != sha or database.get('schemaEvidenceValidated') is not True:
        raise ValueError('the certificate is not a validated copy of this SHA')
    evidence = bound_evidence(evidence_bytes, database.get('schemaEvidenceSha256'), database.get('dumpSha256'))
    rows = rows_of(evidence['migrations'])
    return digest(comparable(rows, window_versions(repo, sha))), len(rows)


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


def status(env_file, repo, sha, certified, attempts=2, pause=1):
    """Has production's installed set moved since the copy was certified?

    `certified` is the set the target's newest certificate names, less the
    exact target's own window-declared versions (installed only inside the
    break; their doors are re-read by engine-release-window-doors.py). The
    same versions are left out of production's set here; everything else must
    be identical. Any other migration installed after certification refuses:
    the current engine keeps running."""
    if not DIGEST.fullmatch(certified or ''):
        print('REFUSED - no certified installed migration set was supplied')
        return REFUSED
    windows = window_versions(repo, sha)
    last = None
    for attempt in range(attempts):
        try:
            production = comparable(rows_of(read_production_rest(env_file)), windows)
            break
        except (OSError, HTTPError, URLError, ValueError, TypeError, KeyError) as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(pause)
    else:
        print(f'UNKNOWN - production\'s installed migrations could not be compared: {str(last)[:200]}')
        return UNKNOWN
    now = digest(production)
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
    r.add_argument('--wait', type=int, default=0)
    d = sub.add_parser('certified-digest')
    d.add_argument('--evidence', required=True)
    d.add_argument('--certificate', required=True)
    d.add_argument('--repo', default='.')
    d.add_argument('--sha', required=True)
    c = sub.add_parser('certified')
    c.add_argument('--sha', required=True)
    s = sub.add_parser('status')
    s.add_argument('--env-file', required=True)
    s.add_argument('--repo', required=True)
    s.add_argument('--sha', required=True)
    s.add_argument('--certified', required=True)
    args = parser.parse_args(argv)
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
            return status(args.env_file, args.repo, args.sha, args.certified)
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as exc:
            print(f'UNKNOWN - {str(exc)[:200]}')
            return UNKNOWN
    if args.mode == 'certified-digest':
        try:
            with open(args.evidence, 'rb') as handle:
                evidence = handle.read()
            with open(args.certificate, encoding='utf-8') as handle:
                certificate = json.load(handle)
            value, count = certified_digest(evidence, certificate, args.repo, args.sha)
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
        due, why = refresh_due(evidence, args.copy_evidence_sha, production)
        if pending:
            why += f'; still not installed after {args.wait}s: {", ".join(pending[:5])}'
        print(f'due={"true" if due else "false"}')
        print(f'production={digest(production["migrations"])}')
        print(f'reason={why}', file=sys.stderr)
        return 0
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
