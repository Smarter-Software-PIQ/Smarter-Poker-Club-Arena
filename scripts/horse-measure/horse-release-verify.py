#!/usr/bin/env python3
"""Horse release verification kit (read-only).

Measures every horse upgrade after a release is ADOPTED, SEALED and fully
thawed, against the baselines in README.md. Every rendered statement is exactly
one SELECT (or WITH ... SELECT). Nothing is ever written. Run
each printed statement through the Supabase MCP execute_sql (project
kuklfnapbkmacvwxktbh) or psql inside BEGIN ... ROLLBACK.

Usage:
  horse-release-verify.py sql activation START_DAY              # 2026-11-03
  horse-release-verify.py sql ladder START END                  # 2026-11-03T00:00:00Z (offset required)
  horse-release-verify.py sql seat-jams START END               # <= ~4h per call
  horse-release-verify.py sql v78 START END                     # <= ~1 day per call
  horse-release-verify.py sql v79 START END                     # <= ~1 day per call
  horse-release-verify.py sql four-bet-fold START END           # <= ~12h per call
  horse-release-verify.py sql reshove START END                 # <= ~1 day per call
  horse-release-verify.py sql omaha-calls START END             # <= ~4h per call; then omaha-call-cells.ts
  horse-release-verify.py slices START END HOURS                # print window slices
  horse-release-verify.py combine-v79 FILE [FILE ...]           # v79 slice outputs -> table
  horse-release-verify.py check                                 # read-only self-check
  horse-release-verify.py check-file FILE                       # read-only check of any .sql

Interpretation rules (do not skip):
  * Only measure windows that start AFTER the serving releaseSha contains the
    candidate and the release receipt is SEALED and the thaw complete.
  * Report every number with its sample size; behaviour is not profitability.
  * The v79 combiner gives a hand-clustered 95% CI of the call's decision EV;
    "straddles 0" means the data cannot speak, not that a rule is right.
"""
import math
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SQL = {
    'activation': HERE / 'sql' / 'activation.sql',
    'ladder': HERE / 'sql' / 'ladder.sql',
    'seat-jams': HERE / 'sql' / 'seat-jams.sql',
    'v78': HERE / 'sql' / 'v78-committing-raises.sql',
    'v79': HERE / 'sql' / 'v79-cells.sql',
    'four-bet-fold': HERE / 'sql' / 'four-bet-fold.sql',
    'reshove': HERE / 'sql' / 'reshove-ev.sql',
    'omaha-calls': HERE / 'sql' / 'omaha-calls.sql',
}
WRITE_WORDS = re.compile(
    r'\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|'
    r'refresh|comment|call|do|lock|notify|listen|unlisten|reindex|cluster|merge|into|'
    r'prepare|execute|discard|reset|set|begin|commit|rollback|savepoint|import|load|security)\b',
    re.IGNORECASE,
)
# Functions with side effects (or that leave the database) are refused even
# inside a SELECT.
SIDE_EFFECT_FNS = re.compile(
    r'\b(pg_terminate_backend|pg_cancel_backend|pg_sleep\w*|pg_reload_conf|pg_rotate_logfile|'
    r'pg_advisory\w*|pg_try_advisory\w*|set_config|nextval|setval|dblink\w*|lo_\w+|'
    r'pg_read_\w+|pg_ls_\w+|pg_stat_\w*reset\w*|pg_switch_wal|pg_create_\w+|pg_drop_\w+|'
    r'pg_logical_\w+|pg_notify|txid_current|pg_current_xact_id|http\w*|net\.\w+)\s*\(',
    re.IGNORECASE,
)
# Exact ISO timestamps with an explicit offset: a naive time would be read in
# the database session's zone by SQL and the machine's zone by `slices`.
TS = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$')
DAY = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def strip_comments(sql):
    sql = re.sub(r'/\*.*?\*/', ' ', sql, flags=re.S)
    return '\n'.join(line.split('--', 1)[0] for line in sql.splitlines())


def _blank_strings(sql):
    """Replace each standard '...' literal with '' . Returns None for anything
    that could hide text from the checks: an unterminated literal, or a
    prefixed literal (E'..', U&'..', B'..', X'..') whose quote follows an
    identifier character."""
    out, i, n = [], 0, len(sql)
    while i < n:
        ch = sql[i]
        if ch != "'":
            out.append(ch)
            i += 1
            continue
        if i > 0 and (sql[i - 1].isalnum() or sql[i - 1] in '_&'):
            return None
        j = i + 1
        while True:
            if j >= n:
                return None
            if sql[j] == "'":
                if j + 1 < n and sql[j + 1] == "'":
                    j += 2
                    continue
                break
            j += 1
        out.append("''")
        i = j + 1
    return ''.join(out)


def is_read_only(sql):
    """Exactly one statement, starting SELECT or WITH, no write keyword, no
    side-effect function, no escape-string or dollar-quoted literal that could
    hide either."""
    body = strip_comments(sql)
    no_strings = _blank_strings(body)
    if no_strings is None or '$' in no_strings or '"' in no_strings:
        return False
    if WRITE_WORDS.search(no_strings) or SIDE_EFFECT_FNS.search(no_strings):
        return False
    stmts = [s.strip() for s in no_strings.split(';') if s.strip()]
    return len(stmts) == 1 and stmts[0].split(None, 1)[0].lower() in ('select', 'with')


def render(mode, args):
    if mode not in SQL:
        raise SystemExit(f'unknown mode {mode!r}; one of {sorted(SQL)}')
    sql = SQL[mode].read_text(encoding='utf-8')
    if mode == 'activation':
        (day,) = args
        if not DAY.match(day):
            raise SystemExit('START_DAY must be YYYY-MM-DD')
        out = sql.replace(':START_DAY', f"'{day}'")
    else:
        start, end = args
        for v in (start, end):
            if not TS.match(v):
                raise SystemExit(f'not an ISO timestamp: {v!r}')
        out = sql.replace(':START', f"'{start}'").replace(':END', f"'{end}'")
    if re.search(r':(START|END)\b', out) or not is_read_only(out):
        raise SystemExit('refusing: unresolved placeholder or non-read-only statement')
    return out


def slices(start, end, hours):
    for v in (start, end):
        if not TS.match(v):
            raise SystemExit(f'not an ISO timestamp with an offset: {v!r}')
    try:
        h = float(hours)
    except ValueError:
        raise SystemExit(f'HOURS must be a number: {hours!r}')
    if not (h > 0 and math.isfinite(h)):
        raise SystemExit('HOURS must be greater than 0')
    a = datetime.fromisoformat(start.replace('Z', '+00:00')).astimezone(timezone.utc)
    b = datetime.fromisoformat(end.replace('Z', '+00:00')).astimezone(timezone.utc)
    if b <= a:
        raise SystemExit('END must be after START')
    step = timedelta(hours=h)
    out = []
    while a < b:
        c = min(a + step, b)
        out.append((a.strftime('%Y-%m-%dT%H:%M:%SZ'), c.strftime('%Y-%m-%dT%H:%M:%SZ')))
        a = c
    return out


GRID = [-100, -75, -50, -40, -30, -25, -20, -15, -10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10, 15, 20, 30, 50, 100]


def combine_v79(lines):
    acc = {}
    for line in lines:
        line = line.strip().strip('"')
        if not line or '|' not in line:
            continue
        p = line.split('|')
        if len(p) != 11 or len(p[10].split(',')) != len(GRID):
            raise SystemExit(f'malformed v79 slice line: {line[:80]!r}')
        key = (p[0], p[1])
        a = acc.setdefault(key, [0, 0, 0.0, 0.0, 0.0, 0, 0, 0.0, [0] * len(GRID)])
        a[0] += int(p[2]); a[1] += int(p[3]); a[2] += float(p[4]); a[3] += float(p[5])
        a[4] += float(p[6]); a[5] += int(p[7]); a[6] += int(p[8]); a[7] += float(p[9])
        a[8] = [x + y for x, y in zip(a[8], map(int, p[10].split(',')))]
    rows = []
    for (label, kc), (n, g, s, s2, sn, n2, ch, chs, _grid) in sorted(acc.items()):
        m = s / n
        ss = s2 - 2 * m * sn + m * m * n2  # sum over hands of (S_h - m n_h)^2
        if g < 2:
            # One hand has no between-hand variance: no interval, no verdict.
            lo = hi = float('nan')
            verdict = 'insufficient (fewer than 2 hands)'
        else:
            se = math.sqrt(max(ss, 0.0) * g / (g - 1)) / n
            lo, hi = m - 1.96 * se, m + 1.96 * se
            verdict = 'below 0' if hi < 0 else ('above 0' if lo > 0 else 'straddles 0')
        rows.append((label, kc, n, g, m, lo, hi, ch, verdict))
    return rows


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    mode = argv[1]
    if mode == 'sql':
        if len(argv) < 3:
            print(__doc__)
            return 2
        want = 1 if argv[2] == 'activation' else 2
        if len(argv) != 3 + want:
            raise SystemExit(f'{argv[2]} takes {want} argument(s)')
        print(render(argv[2], argv[3:]))
    elif mode == 'slices':
        if len(argv) != 5:
            raise SystemExit('slices takes START END HOURS')
        for a, b in slices(*argv[2:5]):
            print(a, b)
    elif mode == 'combine-v79':
        lines = []
        for fn in argv[2:]:
            lines += Path(fn).read_text(encoding='utf-8').splitlines()
        print(f"{'cell':34} {'kicker':9} {'n':>5} {'hands':>5} {'mean_bb':>8} {'95% CI (hand-clustered)':>24} {'chops':>5} verdict")
        for label, kc, n, g, m, lo, hi, ch, v in combine_v79(lines):
            ci = '[      n/a,       n/a]' if math.isnan(lo) else f'[{lo:9.2f}, {hi:9.2f}]'
            print(f'{label:34} {kc:9} {n:5d} {g:5d} {m:8.2f} {ci} {ch:5d} {v}')
    elif mode == 'check':
        bad = [k for k, p in SQL.items() if not is_read_only(p.read_text(encoding='utf-8'))]
        if bad:
            print('NOT read-only:', bad)
            return 1
        print('ok: every template is read-only')
    elif mode == 'check-file':
        if len(argv) != 3:
            print(__doc__)
            return 2
        if not is_read_only(Path(argv[2]).read_text(encoding='utf-8')):
            print('NOT read-only:', argv[2])
            return 1
        print('ok: read-only')
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
