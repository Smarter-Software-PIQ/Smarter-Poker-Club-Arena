#!/usr/bin/env python3
"""The doors a build's queued window migrations create, re-read inside the break.

WHY (2026-11-07). A migration that declares "-- @install-window: daily-maintenance"
installs only INSIDE the 04:00 America/Chicago freeze. The deploy's door check
runs before the break, so it now admits a door such a queued migration creates
on condition (scripts/ci/window-migration-doors.mjs). This helper is the other
half: the host transaction calls it inside the admitted break, BEFORE the engine
lock, the release seal's prepare and any replacement, and refuses the release
if a door is still missing. A failed or absent install leaves the current engine
running.

  list   --repo R --sha S
      Prints one line: the comma-separated public functions that a
      window-declared migration in the target tree creates AND the target
      engine calls (the same extractor as check-engine-doors-exist.mjs). Empty
      when there are none. Exit 0, or 3 when the tree cannot be read.

  status --env-file F --names a,b
      Reads pg_proc through the read-only fn_schema_manifest() RPC.
        0   READY    every named door exists
        10  PENDING  a door is missing and this break's window install job is
                     still running (the signal: the GitHub job record of the
                     daily stage-engine-release run, created 03:30-03:50
                     America/Chicago today)
        1   REFUSED  a door is missing and the install finished, or the
                     install signal is absent or unreadable (the plain refusal)
        3   UNKNOWN  pg_proc could not be read
      Three outcomes are never folded into one (CLAUDE.md 10.86).

Read-only: never writes the database, GitHub or the host.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

sys.dont_write_bytecode = True

PROJECT_HOST = 'kuklfnapbkmacvwxktbh.supabase.co'
REPO_API = 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena'
STAGE_WORKFLOW = 'stage-engine-release.yml'
INSTALL_JOB = 'Install Queued Daily-Maintenance Migrations'
CHICAGO = ZoneInfo('America/Chicago')
WINDOW_ANNOTATION = r'^--[[:blank:]]*@install-window:[[:blank:]]*daily-maintenance[[:blank:]]*$'
MIGRATIONS = 'supabase/migrations/'
GUARD = 'server/scripts/retained-original-checkpoint-guard.mjs'
ALLOWLIST = 'scripts/ci/engine-doors.allowlist.json'
READY, PENDING, REFUSED, UNKNOWN = 0, 10, 1, 3
NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def git(repo, *args, ok=(0,)):
    result = subprocess.run(['git', '-C', repo, *args], capture_output=True, timeout=30,
                            env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1'})
    if result.returncode not in ok:
        raise RuntimeError('git ' + args[0] + ' failed')
    return result.stdout


# ---- the extractor, ported from check-engine-doors-exist.mjs -------------

def strip_comments(src):
    """Removes // and block comments outside string literals (same as the JS)."""
    out = []
    i = 0
    quote_char = None
    n = len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if quote_char:
            out.append(c)
            if c == '\\':
                out.append(nxt)
                i += 2
                continue
            if c == quote_char:
                quote_char = None
            i += 1
            continue
        if c in ("'", '"', '`'):
            quote_char = c
            out.append(c)
            i += 1
            continue
        if c == '/' and nxt == '/':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if c == '/' and nxt == '*':
            i += 2
            while i < n and not (src[i] == '*' and i + 1 < n and src[i + 1] == '/'):
                if src[i] == '\n':
                    out.append('\n')
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


RPC_CALL = re.compile(r"\.rpc\(\s*(['\"`])([A-Za-z_][A-Za-z0-9_]*)\1")
RPC_NAME_ASSIGNMENT = re.compile(r'\b\w*[Rr]pc[Nn]ame\w*\s*=\s*([^;\n]+)')
QUOTED_IDENT = re.compile(r"(['\"`])([A-Za-z_][A-Za-z0-9_]*)\1")


def doors_in(source):
    src = strip_comments(source)
    names = set(m.group(2) for m in RPC_CALL.finditer(src))
    for assignment in RPC_NAME_ASSIGNMENT.finditer(src):
        value = assignment.group(1)
        for q in QUOTED_IDENT.finditer(value):
            # JS: (?<![=!]==?\s*) - a literal compared against is a condition.
            before = value[:q.start()].rstrip()
            if before.endswith('==') or before.endswith('!='):
                continue
            names.add(q.group(2))
    return names


def strip_sql_comments(sql):
    return re.sub(r'--[^\n]*', ' ', re.sub(r'/\*.*?\*/', ' ', sql, flags=re.S))


CREATE_FUNCTION = re.compile(
    r'\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:("?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\.\s*)?'
    r'("?)([A-Za-z_][A-Za-z0-9_]*)\3\s*\(', re.I)


def created_functions(sql):
    names = set()
    for m in CREATE_FUNCTION.finditer(strip_sql_comments(sql)):
        if m.group(2) and m.group(2).lower() != 'public':
            continue
        names.add(m.group(4))
    return names


def is_engine_source(path):
    if not path.startswith('server/src/'):
        return False
    parts = path.split('/')
    if any(p == 'node_modules' or p.startswith('.') for p in parts):
        return False
    name = parts[-1]
    if not re.search(r'\.[cm]?[jt]s$', name):
        return False
    if re.search(r'\.(test|spec)\.[cm]?[jt]sx?$', name) or '__tests__' in parts:
        return False
    return True


def window_doors(repo, sha):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('target SHA is invalid')
    hits = git(repo, 'grep', '-l', '-E', '-e', WINDOW_ANNOTATION, sha, '--', MIGRATIONS,
               ok=(0, 1)).decode().splitlines()
    versions = None
    created = set()
    for hit in hits:
        path = hit.split(':', 1)[1] if hit.startswith(sha + ':') else hit
        if not re.fullmatch(r'supabase/migrations/\d{14}_[a-z0-9_]+\.sql', path):
            continue
        sql = git(repo, 'show', sha + ':' + path).decode('utf-8', 'replace')
        # Same rule as supersededBy() in check-migrations-are-live.mjs: a file
        # marked SUPERSEDED BY a version present in the tree never installs.
        mark = re.search(r'^--\s*SUPERSEDED BY\s+(\d{14})\b', sql[:400], re.M)
        if mark:
            if versions is None:
                versions = set(n[:14] for n in git(repo, 'ls-tree', '--name-only', sha, '--',
                                                   MIGRATIONS).decode().replace(MIGRATIONS, '').split())
            if mark.group(1) in versions:
                continue
        created |= created_functions(sql)
    # An allowlisted door is one the engine is proved to tolerate while absent
    # (scripts/ci/engine-doors.allowlist.json); its absence never refuses.
    raw = git(repo, 'show', sha + ':' + ALLOWLIST, ok=(0, 128))
    if raw:
        allow = json.loads(raw.decode())
        if not isinstance(allow, dict):
            raise ValueError('engine-doors allowlist is not an object')
        created -= set(allow)
    if not created:
        return []
    args = ['grep', '-l', '-F']
    for name in sorted(created):
        args += ['-e', name]
    args += [sha, '--', 'server/src', GUARD]
    files = git(repo, *args, ok=(0, 1)).decode().splitlines()
    called = set()
    for hit in files:
        path = hit.split(':', 1)[1] if hit.startswith(sha + ':') else hit
        if path != GUARD and not is_engine_source(path):
            continue
        called |= doors_in(git(repo, 'show', sha + ':' + path).decode('utf-8', 'replace'))
    return sorted(created & called)


# ---- the in-break re-check -----------------------------------------------

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


def read_catalog(env_file):
    values = read_env(env_file)
    base = values.get('SUPABASE_URL', '').rstrip('/')
    key = values.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if base != 'https://' + PROJECT_HOST or urlparse(base).netloc != PROJECT_HOST:
        raise ValueError('SUPABASE_URL is not the pinned Club Arena project origin')
    if not key:
        raise ValueError('SUPABASE_SERVICE_ROLE_KEY is absent')
    request = Request(base + '/rest/v1/rpc/fn_schema_manifest', data=b'{}', method='POST',
                      headers={'apikey': key, 'Authorization': 'Bearer ' + key,
                               'Content-Type': 'application/json', 'Accept': 'application/json'})
    with urlopen(request, timeout=12) as response:
        return json.loads(response.read().decode())


def present_functions(env_file):
    """The public function names pg_proc holds, or raises."""
    fixture = os.environ.get('ENGINE_WINDOW_DOORS_CATALOG_FIXTURE')
    if fixture:
        with open(fixture, encoding='utf-8') as handle:
            data = json.load(handle)
        if not isinstance(data, list):
            raise ValueError('catalog fixture is unreadable')
        return set(data)
    body = read_catalog(env_file)
    functions = body.get('functions') if isinstance(body, dict) else None
    if not isinstance(functions, list) or len(functions) < 100:
        raise ValueError('fn_schema_manifest returned no function catalog')
    return set(functions)


def github(url):
    request = Request(url, headers={'Accept': 'application/vnd.github+json',
                                    'User-Agent': 'club-arena-engine-release-window-doors'})
    with urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode())


def install_state(now):
    """This break's window install job: dict(status, conclusion, url), None if absent.

    Raises when GitHub cannot be read. The daily run is the first push or
    schedule run of stage-engine-release.yml on main created inside today's
    03:30-03:50 America/Chicago preparation window (CLAUDE.md section 13)."""
    fixture = os.environ.get('ENGINE_WINDOW_DOORS_INSTALL_FIXTURE')
    if fixture:
        with open(fixture, encoding='utf-8') as handle:
            data = json.load(handle)
        if data == 'unreadable':
            raise ValueError('install signal fixture is unreadable')
        return data
    local = now.astimezone(CHICAGO)
    start = local.replace(hour=3, minute=30, second=0, microsecond=0)
    end = start + timedelta(minutes=20)
    stamp = lambda t: t.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    runs = github(REPO_API + '/actions/workflows/' + STAGE_WORKFLOW + '/runs?branch=main&per_page=50&created='
                  + quote(stamp(start) + '..' + stamp(end)))
    rows = [r for r in runs.get('workflow_runs', [])
            if r.get('event') in ('push', 'schedule') and r.get('head_branch') == 'main']
    rows.sort(key=lambda r: r.get('created_at', ''))
    for run in rows[:6]:
        jobs = github(REPO_API + '/actions/runs/' + str(int(run['id'])) + '/jobs?per_page=100')
        for job in jobs.get('jobs', []):
            if job.get('name') != INSTALL_JOB:
                continue
            if job.get('conclusion') == 'skipped':
                break
            return {'status': job.get('status'), 'conclusion': job.get('conclusion'),
                    'url': job.get('html_url', '')}
    return None


def status(env_file, names):
    try:
        missing = sorted(set(names) - present_functions(env_file))
    except (OSError, HTTPError, URLError, ValueError, TypeError, KeyError, AttributeError) as exc:
        print('UNKNOWN - pg_proc could not be read for ' + ', '.join(names) + ': ' + str(exc)[:200])
        return UNKNOWN
    if not missing:
        print('READY - every window-migration door this build calls exists in pg_proc: '
              + ', '.join(names))
        return READY
    listed = ', '.join(n + '()' for n in missing)
    try:
        state = install_state(datetime.now(timezone.utc))
    except (OSError, HTTPError, URLError, ValueError, TypeError, KeyError, AttributeError) as exc:
        print('REFUSED - ' + listed + ' still missing from pg_proc and this break\'s window '
              'install signal is unreadable (' + str(exc)[:160] + ')')
        return REFUSED
    if not isinstance(state, dict):
        print('REFUSED - ' + listed + ' still missing from pg_proc and no window install job '
              'exists for this break')
        return REFUSED
    if state.get('status') != 'completed':
        print('PENDING - ' + listed + ' not yet in pg_proc; this break\'s window install job is '
              + str(state.get('status')) + ' ' + str(state.get('url', '')))
        return PENDING
    # The install finished: read pg_proc once more, so a commit that landed
    # between the first read and the job's completion is not refused.
    try:
        missing = sorted(set(names) - present_functions(env_file))
    except (OSError, HTTPError, URLError, ValueError, TypeError, KeyError, AttributeError) as exc:
        print('UNKNOWN - pg_proc could not be re-read for ' + ', '.join(names) + ': ' + str(exc)[:200])
        return UNKNOWN
    if not missing:
        print('READY - every window-migration door this build calls exists in pg_proc: '
              + ', '.join(names))
        return READY
    print('REFUSED - this break\'s window install finished (' + str(state.get('conclusion'))
          + ' ' + str(state.get('url', '')) + ') and ' + ', '.join(n + '()' for n in missing)
          + ' are still missing from pg_proc')
    return REFUSED


def main(argv):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='mode', required=True)
    lister = sub.add_parser('list')
    lister.add_argument('--repo', required=True)
    lister.add_argument('--sha', required=True)
    sub.add_parser('horse-fold-provenance').add_argument('--env-file', required=True)
    checker = sub.add_parser('status')
    checker.add_argument('--env-file', required=True)
    checker.add_argument('--names', required=True)
    args = parser.parse_args(argv)
    if args.mode == 'horse-fold-provenance':
        try:
            tables = read_catalog(args.env_file)['tables']
            if not isinstance(tables, list):
                raise ValueError('invalid table catalog')
            if 'horse_memory_before_fold_provenance' in tables:
                return READY
        except (OSError, ValueError, KeyError, TypeError):
            return UNKNOWN
        return REFUSED
    if args.mode == 'list':
        try:
            print(','.join(window_doors(args.repo, args.sha)))
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as exc:
            print('window doors unreadable: ' + str(exc)[:200], file=sys.stderr)
            return UNKNOWN
        return 0
    names = [n for n in args.names.split(',') if n]
    if not names or not all(NAME.fullmatch(n) for n in names):
        print('UNKNOWN - the window-migration door names are invalid')
        return UNKNOWN
    return status(args.env_file, names)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
