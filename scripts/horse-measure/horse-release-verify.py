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

Daily scorecard (Phase 5; every statement read-only, run each through
execute_sql and save its raw result text as DIR/<id>.json):
  horse-release-verify.py sql scorecard-core DAY                # one day: controls, receipts, cells
  horse-release-verify.py scorecard ids DAY                     # the day's statement ids and windows
  horse-release-verify.py scorecard sql DAY ID                  # one statement (core, v79-00, ...)
  horse-release-verify.py scorecard plan DAY                    # all of them as JSON
  horse-release-verify.py scorecard assemble DAY DIR [--omaha-cells FILE] [--out PREFIX]
                                                                # -> PREFIX.json + PREFIX.md
Complaint pipeline (Phase 5):
  horse-release-verify.py sql complaint-extract HAND_ID         # one hand, every horse decision
  horse-release-verify.py sql complaint-extract TABLE_ID AT     # the hand on that table at AT
  then: cd server && npx tsx ../scripts/horse-measure/horse-complaint-replay.ts --extract FILE

Interpretation rules (do not skip):
  * Only measure windows that start AFTER the serving releaseSha contains the
    candidate and the release receipt is SEALED and the thaw complete.
  * Report every number with its sample size; behaviour is not profitability.
  * The v79 combiner gives a hand-clustered 95% CI of the call's decision EV;
    "straddles 0" means the data cannot speak, not that a rule is right.
"""
import json
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


# ── Phase 5: the daily horse scorecard and the complaint extract ─────────────

SCORECARD_CORE = HERE / 'sql' / 'scorecard-core.sql'
COMPLAINT_EXTRACT = HERE / 'sql' / 'complaint-extract.sql'
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
# Slice sizes keep every statement well inside the MCP execute_sql wait
# (about 60 s). Measured 2026-11-05: core, one day, ~4 s.
SCORECARD_SLICES = (('v79', 'v79', 6.0), ('reshove', 'reshove', 12.0), ('omaha', 'omaha-calls', 4.0))
RECEIPT_ROW = re.compile(r"\('([a-z0-9_]+)',\s*'([^']*)'\)")


def activation_receipts():
    """The (feature, upgrade) list of sql/activation.sql: one list for both reports."""
    sql = SQL['activation'].read_text(encoding='utf-8')
    m = re.search(r'FROM \(VALUES(.*?)\) AS x\(feature, upgrade\)', sql, re.S | re.I)
    if not m:
        raise SystemExit('activation.sql: VALUES list not found')
    rows = RECEIPT_ROW.findall(m.group(1))
    if not rows:
        raise SystemExit('activation.sql: no receipts found')
    return rows


def day_window(day):
    if not DAY.match(day):
        raise SystemExit('DAY must be YYYY-MM-DD')
    try:
        d = datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    except ValueError:
        raise SystemExit(f'not a calendar day: {day!r}')
    return d.strftime('%Y-%m-%dT%H:%M:%SZ'), (d + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ')


def _checked(out, names):
    if re.search(r':(' + '|'.join(names) + r')\b', out) or not is_read_only(out):
        raise SystemExit('refusing: unresolved placeholder or non-read-only statement')
    return out


def render_scorecard_core(day):
    start, end = day_window(day)
    receipts = ',\n'.join(f"  ('{f}', '{u}')" for f, u in activation_receipts())
    out = (SCORECARD_CORE.read_text(encoding='utf-8')
           .replace(':RECEIPTS', receipts).replace(':DAY', f"'{day}'")
           .replace(':START', f"'{start}'").replace(':END', f"'{end}'"))
    return _checked(out, ['RECEIPTS', 'DAY', 'START', 'END'])


def render_complaint_extract(args):
    sql = COMPLAINT_EXTRACT.read_text(encoding='utf-8')
    if len(args) == 1:
        (hand,) = args
        if not UUID.match(hand):
            raise SystemExit('HAND_ID must be a lower-case uuid')
        ref = f"(select h2.{{}} from public.hand_history h2 where h2.id = '{hand}'::uuid)"
        pick = f"h.id = '{hand}'::uuid"
        near = (f"h.table_id = {ref.format('table_id')} and h.created_at >= {ref.format('created_at')} - interval '15 minutes'"
                f" and h.created_at < {ref.format('created_at')} + interval '15 minutes'")
        order = f"abs(extract(epoch from (h.created_at - {ref.format('created_at')})))"
    elif len(args) == 2:
        table, at = args
        if not UUID.match(table):
            raise SystemExit('TABLE_ID must be a lower-case uuid')
        if not TS.match(at):
            raise SystemExit(f'not an ISO timestamp with an offset: {at!r}')
        t = f"'{at}'::timestamptz"
        pick = near = (f"h.table_id = '{table}'::uuid and h.created_at >= {t} - interval '30 minutes'"
                       f" and h.created_at < {t} + interval '30 minutes'")
        order = (f"case when {t} >= coalesce(h.started_at, h.created_at) and {t} <= coalesce(h.ended_at, h.created_at)"
                 f" then 0 else 1 end, abs(extract(epoch from (h.created_at - {t})))")
    else:
        raise SystemExit('complaint-extract takes HAND_ID, or TABLE_ID AT')
    out = sql.replace(':PICK', pick).replace(':NEAR', near).replace(':ORDER', order)
    return _checked(out, ['PICK', 'NEAR', 'ORDER'])


def _hours(flags):
    hours = {s: h for s, _, h in SCORECARD_SLICES}
    for k, v in flags.items():
        sec = k[:-len('-hours')] if k.endswith('-hours') else None
        if sec not in hours:
            raise SystemExit(f'unknown flag --{k}')
        try:
            hours[sec] = float(v)
        except ValueError:
            raise SystemExit(f'--{k} must be a number')
    return hours


def scorecard_plan(day, flags=None):
    """Every statement of one day's scorecard, in order: one core statement plus
    bounded slices of the V79/V80, reshove and V81 Omaha templates."""
    hours = _hours(flags or {})
    start, end = day_window(day)
    plan = [{'id': 'core', 'section': 'core', 'window': [start, end], 'sql': render_scorecard_core(day)}]
    for section, mode, _ in SCORECARD_SLICES:
        for i, (a, b) in enumerate(slices(start, end, hours[section])):
            plan.append({'id': f'{section}-{i:02d}', 'section': section, 'window': [a, b], 'sql': render(mode, [a, b])})
    return plan


def load_rows(text):
    """Rows from an execute_sql result: a JSON array, or the MCP wrapper text
    (a {"result": "..."} object whose text holds the array)."""
    text = text.strip()
    obj = None
    try:
        obj = json.loads(text)
    except ValueError:
        pass
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict) and isinstance(obj.get('result'), str):
        text = obj['result']
    elif isinstance(obj, dict):
        return [obj]
    m = re.search(r'<untrusted-data-[^>]*>(.*?)</untrusted-data-', text, re.S)
    body = m.group(1) if m else text
    i, j = body.find('['), body.rfind(']')
    if i < 0 or j < i:
        raise ValueError('no JSON rows in the result text')
    rows = json.loads(body[i:j + 1])
    if not isinstance(rows, list):
        raise ValueError('result is not a list of rows')
    return rows


def wilson(k, n, z=1.96):
    if n <= 0:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]


def mean_ci(n, s, ss, scale=1.0):
    """Mean and 95% CI from per-cluster sums (each cluster one hand)."""
    if n <= 0:
        return None, None, 'no data'
    m = s / n
    if n < 2:
        return round(m * scale, 2), None, 'insufficient (fewer than 2 hands)'
    var = max(ss - n * m * m, 0.0) / (n - 1)
    se = math.sqrt(var / n)
    lo, hi = (m - 1.96 * se) * scale, (m + 1.96 * se) * scale
    v = 'below 0' if hi < 0 else ('above 0' if lo > 0 else 'straddles 0')
    return round(m * scale, 2), [round(lo, 2), round(hi, 2)], v


def _num(x):
    return float(x) if x is not None else 0.0


V79_RULE = {('A', 'weak_2_9'): 'V79', ('B', 'weak_2_9'): 'V79', ('A', 'strong_T+'): 'V80'}


def assemble(day, folder, omaha_cells=None, flags=None):
    plan = scorecard_plan(day, flags)
    folder = Path(folder)
    present, missing, unreadable, data = [], [], [], {}
    for item in plan:
        f = folder / f"{item['id']}.json"
        if not f.exists():
            missing.append(item['id'])
            continue
        try:
            data[item['id']] = load_rows(f.read_text(encoding='utf-8'))
            present.append(item['id'])
        except (ValueError, json.JSONDecodeError) as e:
            unreadable.append({'id': item['id'], 'error': str(e)[:200]})
    report = {
        'day': day, 'window': list(day_window(day)),
        'generated_by': 'scripts/horse-measure/horse-release-verify.py scorecard assemble',
        'coverage': {'planned': [p['id'] for p in plan], 'present': present, 'missing': missing,
                     'unreadable': unreadable, 'complete': not missing and not unreadable},
        'notes': [],
    }
    # core: controls, activation, variant x format cells
    core = None
    if 'core' in data and data['core']:
        row = data['core'][0]
        core = row.get('scorecard', row) if isinstance(row, dict) else row
        if isinstance(core, str):
            core = json.loads(core)
    controls = (core or {}).get('controls') or {}
    alive = _num(controls.get('decide_nlh')) > 0
    report['controls'] = controls
    report['liveness'] = 'missing (core not run)' if core is None else (
        'alive' if alive else 'DEAD: decide_nlh is 0, every other zero below is meaningless')
    act = []
    for r in (core or {}).get('activation') or []:
        fires = int(_num(r.get('fires')))
        if 'opt-in' in r.get('upgrade', ''):
            status = 'expected 0' if fires == 0 else 'FIRING (opt-in receipt, unexpected)'
        elif 'expected 0' in r.get('upgrade', ''):
            # A guard counter (V31 empty store, V31 execution mismatch): zero is
            # the healthy reading; any fire is the condition the row watches for.
            status = 'expected 0' if fires == 0 else 'FIRING (guard counter, unexpected)'
        elif not alive:
            status = 'unknown (control silent)'
        else:
            status = 'firing' if fires > 0 else 'SILENT'
        act.append({'feature': r.get('feature'), 'upgrade': r.get('upgrade'), 'fires': fires, 'status': status})
    report['activation'] = act
    cells = []
    for c in (core or {}).get('cells') or []:
        fb, fbf, hh = int(_num(c.get('four_bet_hands'))), int(_num(c.get('four_bet_then_fold_hands'))), int(_num(c.get('human_hands')))
        hm, hci, hv = mean_ci(hh, _num(c.get('horse_net_bb')), _num(c.get('horse_net_bb_sq')), 100.0)
        um, uci, uv = mean_ci(hh, _num(c.get('human_net_bb')), _num(c.get('human_net_bb_sq')), 100.0)
        cells.append({
            'variant': c.get('variant'), 'format': c.get('format'), 'hands': int(_num(c.get('hands'))),
            'horse_seats': int(_num(c.get('horse_seats'))), 'human_seats': int(_num(c.get('human_seats'))),
            'four_bet_hands': fb, 'four_bet_then_fold_hands': fbf,
            'four_bet_then_fold_rate': round(fbf / fb, 4) if fb else None, 'four_bet_then_fold_ci': wilson(fbf, fb),
            'human_hands': hh, 'horse_bb_per_100': hm, 'horse_bb_per_100_ci': hci, 'horse_verdict': hv,
            'human_bb_per_100': um, 'human_bb_per_100_ci': uci, 'human_verdict': uv,
        })
    report['cells'] = cells
    # V79/V80 cells (hand-clustered decision EV of the call)
    lines = []
    for k in data:
        if k.startswith('v79-'):
            for row in data[k]:
                for v in (row.values() if isinstance(row, dict) else [row]):
                    if isinstance(v, str) and v.count('|') == 10:
                        lines.append(v)
    v79 = []
    for label, kc, n, g, m, lo, hi, ch, verdict in (combine_v79(lines) if lines else []):
        v79.append({'cell': label, 'kicker': kc, 'n': n, 'hands': g, 'mean_bb': round(m, 2),
                    'lo': None if math.isnan(lo) else round(lo, 2), 'hi': None if math.isnan(hi) else round(hi, 2),
                    'chops': ch, 'verdict': verdict, 'rule': V79_RULE.get((label, kc))})
    report['v79'] = v79
    # tournament reshoves (one horse reshove per hand, so rows are hands)
    acc = {}
    for k in data:
        if k.startswith('reshove-'):
            for r in data[k]:
                key = (r.get('opener_pos'), r.get('tsize'), r.get('depth'))
                a = acc.setdefault(key, [0, 0, 0.0, 0.0, 0.0])
                a[0] += int(_num(r.get('n'))); a[1] += int(_num(r.get('n_ev')))
                a[2] += _num(r.get('sum_ev_bb')); a[3] += _num(r.get('sum_sq_ev_bb')); a[4] += _num(r.get('sum_net_bb'))
    reshove = []
    for (pos, ts, dp), (n, nev, s, ss, net) in sorted(acc.items(), key=lambda x: tuple(map(str, x[0]))):
        m, ci, v = mean_ci(nev, s, ss)
        reshove.append({'opener_pos': pos, 'tsize': ts, 'depth': dp, 'n': n, 'mean_net_bb': round(net / n, 2) if n else None,
                        'mean_ev_bb': m, 'lo': ci[0] if ci else None, 'hi': ci[1] if ci else None, 'verdict': v})
    report['reshove'] = reshove
    # V81 Omaha cells: classified by the engine's own evaluator (omaha-call-cells.ts --json)
    omaha_files = sorted(folder / f'{k}.json' for k in data if k.startswith('omaha-'))
    if omaha_cells:
        report['v81'] = {'status': 'classified', 'source': str(omaha_cells),
                         'cells': json.loads(Path(omaha_cells).read_text(encoding='utf-8'))}
    elif omaha_files:
        report['v81'] = {'status': 'not classified', 'cells': [],
                         'next': 'cd server && npx tsx ../scripts/horse-measure/omaha-call-cells.ts --json '
                                 + ' '.join(str(f) for f in omaha_files) + ' > OMAHA_CELLS.json, then re-run with --omaha-cells OMAHA_CELLS.json'}
    else:
        report['v81'] = {'status': 'missing', 'cells': []}
    if not report['coverage']['complete']:
        report['notes'].append('PARTIAL: some planned statements are missing or unreadable; sums cover only the slices present.')
    return report


def _ci(ci):
    return '' if not ci else f'[{ci[0]}, {ci[1]}]'


def render_markdown(r):
    L = [f"# Horse daily scorecard, {r['day']} (UTC)", '',
         f"Window {r['window'][0]} to {r['window'][1]}. Read-only. Every number is a count or an estimate with its sample size;",
         'behaviour is not profitability. A confidence interval that straddles 0 means the data cannot speak yet.', '']
    cov = r['coverage']
    L.append('## Coverage')
    L.append(f"{len(cov['present'])} of {len(cov['planned'])} planned statements read"
             + ('.' if cov['complete'] else f"; missing: {', '.join(cov['missing']) or 'none'}; unreadable: {', '.join(u['id'] for u in cov['unreadable']) or 'none'}."))
    for n in r['notes']:
        L.append(f'- {n}')
    L += ['', '## Telemetry controls', f"Liveness: {r['liveness']}.", '', '| control | fires |', '| --- | ---: |']
    L += [f'| {k} | {v} |' for k, v in sorted(r['controls'].items())]
    silent = [a['feature'] for a in r['activation'] if a['status'] == 'SILENT']
    L += ['', '## Upgrade receipts', f"Silent receipts: {', '.join(silent) if silent else 'none'}.", '',
          '| receipt | upgrade | fires | status |', '| --- | --- | ---: | --- |']
    L += [f"| {a['feature']} | {a['upgrade']} | {a['fires']} | {a['status']} |" for a in r['activation']]
    L += ['', '## By variant and format', '',
          '| variant | format | hands | 4-bet hands | 4-bet then fold | rate (95% CI) | hands with a person | horse bb/100 (95% CI) | person bb/100 (95% CI) |',
          '| --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |']
    for c in r['cells']:
        rate = '' if c['four_bet_then_fold_rate'] is None else f"{c['four_bet_then_fold_rate']:.1%} {_ci(c['four_bet_then_fold_ci'])}"
        L.append(f"| {c['variant']} | {c['format']} | {c['hands']} | {c['four_bet_hands']} | {c['four_bet_then_fold_hands']} | {rate} | "
                 f"{c['human_hands']} | {'' if c['horse_bb_per_100'] is None else c['horse_bb_per_100']} {_ci(c['horse_bb_per_100_ci'])} | "
                 f"{'' if c['human_bb_per_100'] is None else c['human_bb_per_100']} {_ci(c['human_bb_per_100_ci'])} |")
    L += ['', '## V79 / V80 top-pair call cells (decision EV of the call, bb, CI clustered by hand)', '',
          '| cell | kicker | rule | calls | hands | mean | 95% CI | verdict |', '| --- | --- | --- | ---: | ---: | ---: | --- | --- |']
    for v in r['v79']:
        ci = '' if v['lo'] is None else f"[{v['lo']}, {v['hi']}]"
        L.append(f"| {v['cell']} | {v['kicker']} | {v['rule'] or ''} | {v['n']} | {v['hands']} | {v['mean_bb']} | {ci} | {v['verdict']} |")
    L += ['', '## V81 Omaha call cells', f"Status: {r['v81']['status']}." + (f" Next: `{r['v81']['next']}`" if r['v81'].get('next') else ''), '']
    if r['v81']['cells']:
        L += ['| cell | calls | hands | mean bb | 95% CI | verdict |', '| --- | ---: | ---: | ---: | --- | --- |']
        for c in r['v81']['cells']:
            if str(c.get('k', '')).endswith('|all'):
                L.append(f"| {c.get('k')} | {c.get('n')} | {c.get('g')} | {c.get('m')} | {_ci([c.get('lo'), c.get('hi')]) if c.get('lo') is not None else ''} | {c.get('verdict')} |")
    L += ['', '## Tournament reshoves over one open, 15-30bb (all-in-adjusted EV, bb; one reshove per hand)', '',
          '| opener | table | depth | n | mean EV | 95% CI | verdict |', '| --- | --- | --- | ---: | ---: | --- | --- |']
    for s in r['reshove']:
        ci = '' if s['lo'] is None else f"[{s['lo']}, {s['hi']}]"
        L.append(f"| {s['opener_pos']} | {s['tsize']} | {s['depth']} | {s['n']} | {s['mean_ev_bb']} | {ci} | {s['verdict']} |")
    return '\n'.join(L) + '\n'


def scorecard_main(argv):
    if len(argv) < 2:
        raise SystemExit('scorecard plan|ids|sql|assemble DAY ...')
    sub, day, rest = argv[0], argv[1], argv[2:]
    flags, pos, i = {}, [], 0
    while i < len(rest):
        if rest[i].startswith('--'):
            if i + 1 >= len(rest):
                raise SystemExit(f'{rest[i]} needs a value')
            flags[rest[i][2:]] = rest[i + 1]
            i += 2
        else:
            pos.append(rest[i])
            i += 1
    if sub in ('plan', 'ids', 'sql'):
        plan = scorecard_plan(day, flags)
        if sub == 'plan':
            print(json.dumps(plan, indent=1))
        elif sub == 'ids':
            for p in plan:
                print(p['id'], p['window'][0], p['window'][1])
        else:
            if len(pos) != 1:
                raise SystemExit('scorecard sql DAY ID')
            hit = [p for p in plan if p['id'] == pos[0]]
            if not hit:
                raise SystemExit(f"unknown statement id {pos[0]!r}; see `scorecard ids {day}`")
            print(hit[0]['sql'])
        return 0
    if sub == 'assemble':
        if len(pos) != 1:
            raise SystemExit('scorecard assemble DAY DIR [--omaha-cells FILE] [--out PREFIX]')
        omaha = flags.pop('omaha-cells', None)
        prefix = flags.pop('out', None) or str(Path(pos[0]) / f'scorecard-{day}')
        report = assemble(day, pos[0], omaha, flags)
        Path(prefix + '.json').write_text(json.dumps(report, indent=1) + '\n', encoding='utf-8')
        Path(prefix + '.md').write_text(render_markdown(report), encoding='utf-8')
        cov = report['coverage']
        print(f"wrote {prefix}.json and {prefix}.md; coverage {len(cov['present'])}/{len(cov['planned'])}"
              + ('' if cov['complete'] else ' (PARTIAL)') + f"; liveness {report['liveness']}")
        return 0
    raise SystemExit(f'unknown scorecard command {sub!r}')


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    mode = argv[1]
    if mode == 'sql':
        if len(argv) < 3:
            print(__doc__)
            return 2
        if argv[2] == 'scorecard-core':
            if len(argv) != 4:
                raise SystemExit('scorecard-core takes DAY')
            print(render_scorecard_core(argv[3]))
            return 0
        if argv[2] == 'complaint-extract':
            print(render_complaint_extract(argv[3:]))
            return 0
        want = 1 if argv[2] == 'activation' else 2
        if len(argv) != 3 + want:
            raise SystemExit(f'{argv[2]} takes {want} argument(s)')
        print(render(argv[2], argv[3:]))
    elif mode == 'scorecard':
        return scorecard_main(argv[2:])
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
        for name, p in (('scorecard-core', SCORECARD_CORE), ('complaint-extract', COMPLAINT_EXTRACT)):
            if not is_read_only(p.read_text(encoding='utf-8')):
                bad.append(name)
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
