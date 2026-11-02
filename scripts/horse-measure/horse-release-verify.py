#!/usr/bin/env python3
"""Horse release verification kit (read-only).

Measures every horse upgrade after a release is ADOPTED, SEALED and fully
thawed, against the baselines in README.md. Every statement is one SELECT
(the ladder adds a transaction-local SET LOCAL). Nothing is ever written. Run
each printed statement through the Supabase MCP execute_sql (project
kuklfnapbkmacvwxktbh) or psql inside BEGIN ... ROLLBACK.

Usage:
  horse-release-verify.py sql activation START_DAY              # 2026-11-03
  horse-release-verify.py sql ladder START END                  # ISO timestamps (UTC)
  horse-release-verify.py sql seat-jams START END               # <= ~4h per call
  horse-release-verify.py sql v78 START END                     # <= ~1 day per call
  horse-release-verify.py sql v79 START END                     # <= ~1 day per call
  horse-release-verify.py slices START END HOURS                # print window slices
  horse-release-verify.py combine-v79 FILE [FILE ...]           # v79 slice outputs -> table
  horse-release-verify.py check                                 # read-only self-check

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
}
WRITE_WORDS = re.compile(
    r'\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|'
    r'refresh|comment|call|do|lock|notify|reindex|cluster|merge)\b',
    re.IGNORECASE,
)
TS = re.compile(r'^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?(Z|[+-]\d{2}:?\d{2})?$')
DAY = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def strip_comments(sql):
    return '\n'.join(line.split('--', 1)[0] for line in sql.splitlines())


def is_read_only(sql):
    body = strip_comments(sql)
    # DO/CALL/LOCK etc. as keywords; ignore words inside string literals.
    no_strings = re.sub(r"'(?:[^']|'')*'", "''", body)
    if WRITE_WORDS.search(no_strings):
        return False
    stmts = [s.strip() for s in no_strings.split(';') if s.strip()]
    for s in stmts:
        head = s.split(None, 1)[0].lower()
        if head not in ('select', 'with', 'set'):
            return False
        if head == 'set' and not s.lower().startswith('set local'):
            return False
    return True


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
    a = datetime.fromisoformat(start.replace('Z', '+00:00')).astimezone(timezone.utc)
    b = datetime.fromisoformat(end.replace('Z', '+00:00')).astimezone(timezone.utc)
    step = timedelta(hours=float(hours))
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
        key = (p[0], p[1])
        a = acc.setdefault(key, [0, 0, 0.0, 0.0, 0.0, 0, 0, 0.0, [0] * len(GRID)])
        a[0] += int(p[2]); a[1] += int(p[3]); a[2] += float(p[4]); a[3] += float(p[5])
        a[4] += float(p[6]); a[5] += int(p[7]); a[6] += int(p[8]); a[7] += float(p[9])
        a[8] = [x + y for x, y in zip(a[8], map(int, p[10].split(',')))]
    rows = []
    for (label, kc), (n, g, s, s2, sn, n2, ch, chs, _grid) in sorted(acc.items()):
        m = s / n
        ss = s2 - 2 * m * sn + m * m * n2  # sum over hands of (S_h - m n_h)^2
        se = math.sqrt(max(ss, 0.0) * g / max(g - 1, 1)) / n
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
        print(render(argv[2], argv[3:]))
    elif mode == 'slices':
        for a, b in slices(*argv[2:5]):
            print(a, b)
    elif mode == 'combine-v79':
        lines = []
        for fn in argv[2:]:
            lines += Path(fn).read_text(encoding='utf-8').splitlines()
        print(f"{'cell':34} {'kicker':9} {'n':>5} {'hands':>5} {'mean_bb':>8} {'95% CI (hand-clustered)':>24} {'chops':>5} verdict")
        for label, kc, n, g, m, lo, hi, ch, v in combine_v79(lines):
            print(f'{label:34} {kc:9} {n:5d} {g:5d} {m:8.2f} [{lo:9.2f}, {hi:9.2f}] {ch:5d} {v}')
    elif mode == 'check':
        bad = [k for k, p in SQL.items() if not is_read_only(p.read_text(encoding='utf-8'))]
        if bad:
            print('NOT read-only:', bad)
            return 1
        print('ok: every template is read-only')
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
