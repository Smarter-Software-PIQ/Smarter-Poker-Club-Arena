#!/usr/bin/env python3
"""build_attribution.py: attribute hands and observation windows to serving engine builds (M9).

Uses `hand_history.engine_build` (migration 20261118073245, PR #11401) when
populated and falls back to shipped deploy intervals from
`ca_engine_deploy_attempts` for pre-20261118073245 rows. Detects windows that
straddle an engine cutover and renders the build-boundary table for reports.
"""
import collections
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

HEX40 = re.compile(r'^[0-9a-f]{40}$')


def parse_utc(ts: str) -> dt.datetime:
    s = ts.strip()
    if s.endswith('+00:00'):
        s = s[:-6] + 'Z'
    if not s.endswith('Z'):
        raise ValueError(f'expected UTC timestamp ending in Z, got {ts!r}')
    body = s[:-1]
    if '.' in body:
        head, frac = body.split('.', 1)
        if not frac.isdigit():
            raise ValueError(f'bad fractional seconds in {ts!r}')
        base = dt.datetime.strptime(head, '%Y-%m-%dT%H:%M:%S').replace(tzinfo=dt.timezone.utc)
        return base.replace(microsecond=int(frac.ljust(6, '0')[:6]))
    return dt.datetime.strptime(body, '%Y-%m-%dT%H:%M:%S').replace(tzinfo=dt.timezone.utc)


def format_utc(d: dt.datetime) -> str:
    u = d.astimezone(dt.timezone.utc)
    if u.microsecond:
        ms = f'{u.microsecond // 1000:03d}'
        return u.strftime('%Y-%m-%dT%H:%M:%S') + f'.{ms}Z'
    return u.strftime('%Y-%m-%dT%H:%M:%SZ')


def normalize_boundaries(deploy_rows: list[dict]) -> list[dict]:
    """Normalize shipped deploy rows into non-overlapping [activeFromUtc, activeUntilUtc) intervals."""
    cleaned = []
    for row in deploy_rows:
        sha = str(row.get('releaseSha') or row.get('engine_sha') or row.get('target_sha') or '').strip().lower()
        if not HEX40.fullmatch(sha):
            continue
        shipped_raw = row.get('shippedAtUtc') or row.get('completed_at') or row.get('sealed_at') or row.get('started_at')
        if not shipped_raw:
            continue
        started_raw = row.get('cutoverStartUtc') or row.get('started_at') or shipped_raw
        shipped_dt = parse_utc(str(shipped_raw))
        started_dt = parse_utc(str(started_raw))
        if started_dt > shipped_dt:
            started_dt = shipped_dt
        cleaned.append({
            'releaseSha': sha,
            'cutoverStartDt': started_dt,
            'shippedAtDt': shipped_dt,
            'instanceId': row.get('instanceId') or row.get('instance_id'),
        })
    cleaned.sort(key=lambda r: (r['shippedAtDt'], r['releaseSha']))
    deduped = []
    for item in cleaned:
        if deduped and deduped[-1]['releaseSha'] == item['releaseSha']:
            continue
        deduped.append(item)

    intervals = []
    for idx, cur in enumerate(deduped):
        nxt_cutover = deduped[idx + 1]['cutoverStartDt'] if idx + 1 < len(deduped) else None
        nxt_shipped = deduped[idx + 1]['shippedAtDt'] if idx + 1 < len(deduped) else None
        intervals.append({
            'releaseSha': cur['releaseSha'],
            'instanceId': cur['instanceId'],
            'cutoverStartUtc': format_utc(cur['cutoverStartDt']),
            'activeFromUtc': format_utc(cur['shippedAtDt']),
            'nextCutoverStartUtc': format_utc(nxt_cutover) if nxt_cutover else None,
            'activeUntilUtc': format_utc(nxt_shipped) if nxt_shipped else None,
        })
    return intervals


def attribute_hand_build(hand: dict, boundaries: list[dict]) -> tuple[str | None, str]:
    """Return (release_sha_or_none, source) for one hand row."""
    direct = hand.get('engine_build') or hand.get('engineBuild')
    if isinstance(direct, str) and HEX40.fullmatch(direct.strip().lower()):
        return direct.strip().lower(), 'hand_history.engine_build'

    ts_raw = hand.get('started_at') or hand.get('startedAt') or hand.get('ended_at') or hand.get('created_at')
    if not ts_raw:
        return None, 'unattributed'
    ts = parse_utc(str(ts_raw))

    norm = boundaries if (boundaries and 'activeFromUtc' in boundaries[0]) else normalize_boundaries(boundaries)
    for b in norm:
        from_dt = parse_utc(b['activeFromUtc'])
        next_cut_dt = parse_utc(b['nextCutoverStartUtc']) if b.get('nextCutoverStartUtc') else None
        until_dt = parse_utc(b['activeUntilUtc']) if b.get('activeUntilUtc') else None
        if ts < from_dt:
            cut_dt = parse_utc(b['cutoverStartUtc'])
            if cut_dt <= ts < from_dt:
                return None, 'ambiguous_cutover'
            continue
        if next_cut_dt and ts >= next_cut_dt:
            if until_dt and ts < until_dt:
                return None, 'ambiguous_cutover'
            continue
        return b['releaseSha'], 'deploy_boundary'
    return None, 'unattributed'


def split_window_by_builds(start_utc: str, end_utc: str, boundaries: list[dict]) -> list[dict]:
    """Split [start_utc, end_utc) into clean build-specific sub-windows across any cutover."""
    w_start = parse_utc(start_utc)
    w_end = parse_utc(end_utc)
    if not w_start < w_end:
        raise ValueError('refused: end_utc must be after start_utc')

    norm = boundaries if (boundaries and 'activeFromUtc' in boundaries[0]) else normalize_boundaries(boundaries)
    slices = []
    for b in norm:
        seg_start = max(w_start, parse_utc(b['activeFromUtc']))
        bound_end_raw = b.get('nextCutoverStartUtc') or b.get('activeUntilUtc')
        seg_end = min(w_end, parse_utc(bound_end_raw)) if bound_end_raw else w_end
        if seg_start < seg_end:
            slices.append({
                'releaseSha': b['releaseSha'],
                'release8': b['releaseSha'][:8],
                'instanceId': b.get('instanceId'),
                'startUtc': format_utc(seg_start),
                'endUtc': format_utc(seg_end),
                'activeFromUtc': b['activeFromUtc'],
                'nextCutoverStartUtc': b.get('nextCutoverStartUtc'),
            })
    return slices


def summarize_hand_builds(hands: list[dict], boundaries: list[dict]) -> dict:
    norm = boundaries if (boundaries and 'activeFromUtc' in boundaries[0]) else normalize_boundaries(boundaries)
    by_build = collections.Counter()
    by_source = collections.Counter()
    by_build_source = collections.Counter()
    for h in hands:
        sha, src = attribute_hand_build(h, norm)
        key = sha or 'unattributed'
        by_build[key] += 1
        by_source[src] += 1
        by_build_source[f'{key[:8] if sha else key}:{src}'] += 1
    distinct_builds = sorted(k for k in by_build if HEX40.fullmatch(k))
    return {
        'totalHands': len(hands),
        'distinctServingBuilds': distinct_builds,
        'straddlesMultipleBuilds': len(distinct_builds) > 1,
        'byBuild': dict(sorted(by_build.items())),
        'bySource': dict(sorted(by_source.items())),
        'byBuildAndSource': dict(sorted(by_build_source.items())),
    }


def format_boundary_markdown(
    start_utc: str,
    end_utc: str,
    boundaries: list[dict],
    hand_summary: dict | None = None,
) -> str:
    slices = split_window_by_builds(start_utc, end_utc, boundaries) if boundaries else []
    lines = [
        '### Build boundary table (M9)',
        '| Build | Sub-window (UTC) | Active from (shipped) | Next cutover start | Attribution |',
        '|---|---|---|---|---|',
    ]
    if slices:
        by_b = (hand_summary or {}).get('byBuild') or {}
        by_src = (hand_summary or {}).get('bySource') or {}
        src_note = (
            ', '.join(f'{k}={v}' for k, v in sorted(by_src.items()))
            if by_src
            else 'deploy_boundary + hand_history.engine_build'
        )
        for s in slices:
            cnt = by_b.get(s['releaseSha'])
            cnt_txt = f"{cnt:,} hands ({src_note})" if cnt is not None else src_note
            lines.append(
                f"| `{s['release8']}` (`{s['releaseSha'][:12]}`) | `[{s['startUtc']}, {s['endUtc']})` | "
                f"`{s['activeFromUtc']}` | `{s.get('nextCutoverStartUtc') or 'serving'}` | {cnt_txt} |"
            )
    else:
        lines.append(f'| `declared` | `[{start_utc}, {end_utc})` | `DECLARATION.json` | `BOUNDARY.json` | `journal.sourceRelease` |')
    return '\n'.join(lines) + '\n'


def query_live_boundaries_and_hands(start_utc: str, end_utc: str) -> dict:
    import pg

    parse_utc(start_utc)
    parse_utc(end_utc)
    dep_sql = (
        "SELECT row_to_json(q) FROM ("
        "SELECT target_sha AS engine_sha, started_at, completed_at "
        "FROM public.ca_engine_deploy_attempts "
        "WHERE completed_at IS NOT NULL "
        "  AND coalesce(exit_status, result, status, '') IN ('sealed', 'shipped', 'success', '0') "
        f"  AND completed_at <= ('{end_utc}'::timestamptz + interval '1 hour') "
        "ORDER BY completed_at DESC LIMIT 20"
        ") q;"
    )
    dep_rows, dep_err = pg.rows(dep_sql, 20000)
    boundaries = normalize_boundaries(dep_rows or [])

    hh_sql = (
        "SELECT row_to_json(q) FROM ("
        "SELECT id, engine_build, started_at, created_at "
        "FROM public.hand_history "
        f"WHERE created_at >= '{start_utc}'::timestamptz AND created_at < '{end_utc}'::timestamptz"
        ") q;"
    )
    hh_rows, hh_err = pg.rows(hh_sql, 45000)
    summary = summarize_hand_builds(hh_rows or [], boundaries)
    slices = split_window_by_builds(start_utc, end_utc, boundaries) if boundaries else []
    return {
        'startUtc': start_utc,
        'endUtc': end_utc,
        'deployQueryError': dep_err,
        'handQueryError': hh_err,
        'boundaries': boundaries,
        'subWindows': slices,
        'handSummary': summary,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 5 or argv[1] != 'check':
        sys.stderr.write('usage: build_attribution.py check START_UTC END_UTC OUT_JSON\n')
        return 2
    start_utc, end_utc, out_file = argv[2:5]
    out_path = Path(out_file)
    if out_path.exists():
        sys.stderr.write(f'refused: {out_path} exists\n')
        return 1
    payload = query_live_boundaries_and_hands(start_utc, end_utc)
    fd = os.open(str(out_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(fd, (json.dumps(payload, indent=1) + '\n').encode('utf-8'))
    finally:
        os.close(fd)
    sys.stdout.write(json.dumps({
        'subWindows': len(payload['subWindows']),
        'totalHands': payload['handSummary']['totalHands'],
        'distinctServingBuilds': payload['handSummary']['distinctServingBuilds'],
        'straddlesMultipleBuilds': payload['handSummary']['straddlesMultipleBuilds'],
    }) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
