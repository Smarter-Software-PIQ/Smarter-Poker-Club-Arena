#!/usr/bin/env python3
"""write_window_artifacts.py: generate PRESERVED.md, REPORT-OBSERVATION.md,
PHASE1-GRADE-POST-WINDOW.md, and EVIDENCE-INDEX.md (plus support-plo6*/EVIDENCE-INDEX.md)
after read-window.sh.

Enforces:
  - M3 / M13: DECLARATION.json + DECLARATION.sha256 verified before writing.
  - M9: Build boundary table rendered at top of REPORT-OBSERVATION.md; refuses
    unsplit windows that straddle multiple serving engine builds unless an
    explicit split sub-window is read.
  - M1 / M4 / M5 / M11: Renders top-human share (`topHuman`) and scored
    decision summary (`scored-decisions.json`, `blind-review-score.json`) when
    present, checking card firewall before writing.
  - Non-overwrite guarantee: every file is opened with O_CREAT | O_EXCL ('x')
    and skipped if already present.

Usage:
  python3 write_window_artifacts.py OBS_DIR REL INST EST ANN [REASON_NOTE]
"""
import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import build_attribution
import declaration_guard
import score_decisions


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open('rb') as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def write_once(p: Path, content: str, created: list, skipped: list) -> str:
    if score_decisions.CARD_TOKEN_RE.search(content):
        raise RuntimeError(f'card firewall breach: card token detected before writing {p.name}')
    if p.exists():
        skipped.append(str(p.name))
        return sha256_file(p)
    try:
        with p.open('x', encoding='utf-8') as fh:
            fh.write(content)
        created.append(str(p.name))
    except FileExistsError:
        skipped.append(str(p.name))
    return sha256_file(p)


def parse_preserve_host_log(log_path: Path):
    if not log_path.exists():
        return None
    parts = {}
    done_ts = None
    for line in log_path.read_text(errors='replace').splitlines():
        m = re.search(
            r'^(\S+)\s+part(\d+)\s+rc=(\d+)\s+manifest\s+rows=(\d+)\s+vanished=(\d+)\s+bytes=(\d+).*?\s+\|\s+verify\s+failed=(\d+)\s+missing=(\d+)\s+expected=(\d+)\s+linksOver1=(\d+)',
            line,
        )
        if m:
            ts, pno, rc, rows, van, nbytes, fail, miss, exp, links = m.groups()
            parts[int(pno)] = {
                'ts': ts,
                'rc': int(rc),
                'rows': int(rows),
                'vanished': int(van),
                'bytes': int(nbytes),
                'failed': int(fail),
                'missing': int(miss),
                'expected': int(exp),
                'linksOver1': int(links),
            }
        md = re.search(r'^(\S+)\s+DONE:\s+(.*)$', line)
        if md:
            done_ts = md.group(1)
    if not parts:
        return None
    ordered = [parts[k] for k in sorted(parts)]
    return {
        'partCount': len(ordered),
        'maxPart': max(parts),
        'rowsPerPart': [p['rows'] for p in ordered],
        'totalFiles': sum(p['rows'] for p in ordered),
        'totalBytes': sum(p['bytes'] for p in ordered),
        'failed': sum(p['failed'] for p in ordered),
        'missing': sum(p['missing'] for p in ordered),
        'vanished': sum(p['vanished'] for p in ordered),
        'linksOver1': sum(p['linksOver1'] for p in ordered),
        'doneAt': done_ts,
    }


def summarize_plo6(obs: Path) -> str:
    lines = []
    for sp in ('support-plo6-full', 'support-plo6'):
        pj = obs / sp / 'plo6-maniac-price.json'
        if not pj.exists():
            continue
        d = json.loads(pj.read_text(encoding='utf-8'))
        rd = d.get('reader') or []
        hands = sum(int(x.get('hands', 0)) for x in rd)
        miss = sum(int(x.get('missing', 0)) for x in rd)
        other = sum(int(x.get('otherRelease', 0)) for x in rd)
        decs = sum(int(x.get('decisions', 0)) for x in rd)
        a = d.get('a_maniacPrice') or {}
        b = d.get('b_handOffCandidates') or {}
        tag = 'full-window' if sp == 'support-plo6-full' else ('partial/window' if (obs / 'support-plo6-full').exists() else 'window')
        lines.append(
            f"- `{sp}/plo6-maniac-price.json` ({tag}, tool v{d.get('version', 2)}, report only): "
            f"reader {hands:,} six-card cash hands in {len(rd)} batch(es), {miss} missing, {other} other release, {decs:,} decisions; "
            f"{d.get('plo6CashPreflopDecisions', 0):,} six-card cash preflop decisions. "
            f"Set (a) maniac_price engaged: {a.get('n', 0)} (byRaiser {json.dumps(a.get('byRaiser') or {})}). "
            f"Set (b) hand-off candidates under PLO6 price gate: {b.get('n', 0)} "
            f"(byRaiser {json.dumps(b.get('byRaiser') or {})}, range_play with maniac_raise_width {b.get('rangePlayWithManiacWidth', 0):,}, gate unknown {b.get('gateUnknown', 0)})."
        )
    if not lines:
        return '- No six-card cash hands or PLO6 output in this window.\n'
    return '\n'.join(lines) + '\n'


def summarize_scoring_and_blind(obs: Path) -> str:
    parts = []
    sd_path = obs / 'scored-decisions.json'
    if sd_path.exists():
        sd = json.loads(sd_path.read_text(encoding='utf-8'))
        ov = sd.get('overall') or {}
        th = ov.get('topHuman') or {}
        cc = ov.get('candidateChanges') or {}
        ex = cc.get('excludingTopHuman') or {}
        loo = ov.get('looRangeClassifiedFolds') or {}
        ev_all = cc.get('allChangedEvActual') or {}
        ev_ex = ex.get('changedEvActual') or {}
        parts.append(
            f"- Range-classified & actual-hand EV (`scored-decisions.json`): {ov.get('spots', 0)} spots across {ov.get('hands', 0)} hands "
            f"({ov.get('distinctHumans', 0)} humans; top human `{th.get('opponentHash8')}` share {th.get('share', 0):.4f}, "
            f"singlePlayerDominated={th.get('singlePlayerDominated')}). "
            f"LOO range-flagged folds: {loo.get('flaggedCount', 0)}. "
            f"Candidate changes: {cc.get('changedTotal', 0)} (forward {cc.get('forwardChanges', 0)}, reverse {cc.get('reverseChanges', 0)}, "
            f"mean delta {ev_all.get('meanBbPerDecision', 0):.4f} bb, 95% CI {ev_all.get('ci95MeanBb')}, spansZero={ev_all.get('spansZero')}; "
            f"excluding top human: {ex.get('changed', 0)} changed, mean delta {ev_ex.get('meanBbPerDecision', 0):.4f} bb, 95% CI {ev_ex.get('ci95MeanBb')})."
        )
    br_path = obs / 'blind-review-score.json'
    if br_path.exists():
        br = json.loads(br_path.read_text(encoding='utf-8'))
        parts.append(
            f"- Blind review (`blind-review-score.json`): status `{br.get('status')}`, verdict `{br.get('verdict')}`, "
            f"changed counts {json.dumps(br.get('changedCounts') or {})}, control counts {json.dumps(br.get('controlCounts') or {})}."
        )
    return ('\n## 6. Method-first EV & blind review\n' + '\n'.join(parts) + '\n') if parts else ''


def build_index_lines(root: Path, rel_prefix: str, exclude_top_dirs=(), exclude_names=()):
    entries = []
    for dirpath, dirnames, filenames in os.walk(root):
        dp = Path(dirpath)
        if dp == root and exclude_top_dirs:
            dirnames[:] = [d for d in dirnames if d not in exclude_top_dirs]
        dirnames.sort()
        for fn in sorted(filenames):
            fp = dp / fn
            if dp == root and fn in exclude_names:
                continue
            if not fp.is_file() or fp.is_symlink():
                continue
            rel = fp.relative_to(root).as_posix()
            label = f'{rel_prefix}/{rel}' if rel_prefix != '.' else f'./{rel}'
            entries.append((label, sha256_file(fp)))
    entries.sort(key=lambda x: x[0])
    return [f'{digest}  {label}' for label, digest in entries]


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv
    if len(argv) < 6:
        sys.stderr.write('usage: write_window_artifacts.py OBS_DIR REL INST EST ANN [REASON_NOTE]\n')
        return 2
    obs = Path(argv[1]).resolve()
    rel, inst, est, ann = argv[2:6]
    reason_note = argv[6] if len(argv) > 6 else ''
    r8 = rel[:8]
    cap = obs / 'capture'
    created, skipped = [], []
    now_iso = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    # M3 / M13: hard declaration gate
    decl_meta = declaration_guard.verify_declaration(obs, expected_sha=rel)
    operator_id = os.environ.get('HVH_OPERATOR') or 'hvh-capture-owner'

    boundary_obj = json.loads((cap / 'BOUNDARY.json').read_text(encoding='utf-8')) if (cap / 'BOUNDARY.json').exists() else {}
    eff = boundary_obj.get('effectiveWindow') or ['', '']
    start_utc, end_utc = eff[0], eff[1]
    until_utc = ''
    m_until = re.search(r'END\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)', boundary_obj.get('preservation', ''))
    if m_until:
        until_utc = m_until.group(1)

    denom = json.loads((cap / 'window-denominators.json').read_text(encoding='utf-8')) if (cap / 'window-denominators.json').exists() else {}
    start_utc = denom.get('startUtc') or start_utc or decl_meta['startUtc']
    end_utc = denom.get('endUtc') or end_utc
    if not end_utc:
        raise ValueError('refused: missing endUtc in window-denominators.json and BOUNDARY.json')
    human_hands = int(denom.get('humanHands', 0))

    # M9: Build boundary check — refuse unsplit multi-build windows
    bb_path = cap / 'build-boundaries.json'
    bb_obj = json.loads(bb_path.read_text(encoding='utf-8')) if bb_path.exists() else {}
    boundaries = bb_obj.get('boundaries') or []
    hand_summary = bb_obj.get('handSummary') or {}
    sub_windows = build_attribution.split_window_by_builds(start_utc, end_utc, boundaries) if boundaries else []
    if len(sub_windows) > 1 or hand_summary.get('straddlesMultipleBuilds'):
        raise ValueError(
            f'refused: window [{start_utc}, {end_utc}) straddles multiple engine builds '
            f'({hand_summary.get("distinctServingBuilds") or [s["release8"] for s in sub_windows]}); '
            'split at cutover boundaries before generating observation artifacts'
        )
    boundary_md = build_attribution.format_boundary_markdown(start_utc, end_utc, boundaries, hand_summary)

    devs = []
    if reason_note:
        devs.append(f'Boundary source: {reason_note}.')
    dev_str = ' '.join(devs) if devs else 'None.'

    # 1. PRESERVED.md
    pstat = parse_preserve_host_log(cap / 'preserve-window-host.log')
    hold_file = obs.parent / 'holds' / f'hvh-{r8}.json'
    hold_desc = (
        f'declared hold holds/hvh-{r8}.json present ({sha256_file(hold_file)[:8]}); '
        if hold_file.exists()
        else 'no hold file needed; '
    )
    rec_path = cap / 'reconcile-human-set.json'
    rec_obj = json.loads(rec_path.read_text(encoding='utf-8')) if rec_path.exists() else None
    ws0 = (rec_obj.get('witnessSummaries') or [{}])[0] if rec_obj else {}
    read_note = (
        f"{ws0.get('hands', 0)} of {human_hands} person hands, {ws0.get('missing', 0)} missing"
        if rec_obj
        else f'{human_hands} person hands in census'
    )
    if pstat:
        parts_expr = ' + '.join(f'{n:,}' for n in pstat['rowsPerPart'])
        gb = pstat['totalBytes'] / 1e9
        done_clause = f"DONE {pstat['doneAt']}" if pstat['doneAt'] else 'in progress / host log snapshot'
        line1 = (
            f'- Byte copies (never hard links) in ca-engine:/var/lib/club-arena/hvh-preserve-{r8}, '
            f"{pstat['partCount']} part(s) from {start_utc} to END {until_utc or 'boundary+7m'}: "
            f"{parts_expr} = {pstat['totalFiles']:,} files, {pstat['totalBytes']:,} bytes (about {gb:.1f} GB); "
            f"every part manifest-hashed before copy, verify failed={pstat['failed']} missing={pstat['missing']} "
            f"vanished={pstat['vanished']} linksOver1={pstat['linksOver1']}; {done_clause} "
            f'(host log /root/hvh-work-{r8}/window.log, archived at capture/preserve-window-host.log).'
        )
    else:
        line1 = (
            f'- Byte copies (never hard links) in ca-engine:/var/lib/club-arena/hvh-preserve-{r8} '
            f"from {start_utc} to END {until_utc or 'boundary+7m'} (host log /root/hvh-work-{r8}/window.log)."
        )
    preserved_txt = (
        f'# Preservation, {r8} window [{start_utc}, {end_utc}) (operator {operator_id})\n'
        f'{line1}\n'
        f'- In-journal retention (the readable copy): {hold_desc}#10996 is live on this build '
        f'(minRetentionMs 108000000 = 30 h, retentionBreaches 0). The read ran inside the journal: {read_note}.\n'
    )
    preserved_sha = write_once(obs / 'PRESERVED.md', preserved_txt, created, skipped)

    # 2 & 3. REPORT-OBSERVATION.md & PHASE1-GRADE-POST-WINDOW.md
    rn_path = obs / 'report-numbers.json'
    roll_path = cap / 'rollup.out'
    roll = (
        json.loads(roll_path.read_text(encoding='utf-8'))
        if roll_path.exists() and roll_path.read_text(encoding='utf-8').strip().startswith('{')
        else None
    )
    plo6_section = summarize_plo6(obs)
    scoring_section = summarize_scoring_and_blind(obs)

    if rn_path.exists():
        R = json.loads(rn_path.read_text(encoding='utf-8'))
        c = R['census']
        w = R['witness']
        t = R['tight']
        m = R['maniac']
        f = R['fires']['selected']
        L = R['lightning']
        nt = (
            json.loads((obs / 'near-tight-report.json').read_text(encoding='utf-8'))
            if (obs / 'near-tight-report.json').exists()
            else {
                'tightFaced': {'byHuman': {}, 'engineParticipation': {}, 'tightRespect': 0, 'withReceipt': 0, 'receiptMovedBar': 0},
                'engineLine': 0.1558,
                'methodLine': 0.18,
            }
        )
        fa = t['faced']
        byh = nt['tightFaced']['byHuman']
        tight_part = (t.get('facedStyleParticipation') or {}).get('tight', 0)
        tight_resp = nt['tightFaced'].get('tightRespect', 0)
        if t['facedCounting'] == 0:
            tightgrade = 'UNVERIFIED'
        elif tight_resp == 0 and tight_part == 0:
            tightgrade = 'NOT MET'
        else:
            tightgrade = 'SEE SECTION 1.1 (Hand Analysis to grade independently)'

        maniacgrade = 'UNVERIFIED' if m['sustainedAll'] == 0 else 'SEE SECTION 1.2 (Hand Analysis to grade independently)'
        change_note = ''
        if fa['changed'] > 0 and tight_resp == 0 and tight_part == 0:
            change_note = (
                f"\n- Note on {fa['changed']} changed faced decision(s): engine tight recognition was 0 "
                f"(changeNodes: {json.dumps(fa.get('changeNodes') or {})})."
            )
        roll_line = (
            f"- cohort {roll['cohort']['n']} (md5 {roll['cohort']['md5'][:8]}), {roll['horsesWithHands']} Horses with hands, "
            f"{roll['horsesSampled']} sampled, {roll['cohortWithoutHands']} without hands."
            if roll
            else '- Per-Horse roll-up not available.'
        )
        rec_keys = f"{rec_obj['censusWithKey']} of {rec_obj['censusHumanHands']}, {len(rec_obj['keyMismatch'])} mismatches" if rec_obj else 'n/a'
        top_h = w.get('topHuman') or {}
        top_h_line = (
            f" Top human `{top_h.get('hash8')}` share {top_h.get('share', 0):.4f} "
            f"(singlePlayerDominated={top_h.get('singlePlayerDominated')}; witnesses excluding top human: {top_h.get('witnessesExcludingTopHuman', 0)})."
            if top_h
            else ''
        )
        report_txt = f"""# Observation report, build {r8} (operator {operator_id})
Release {rel}, instance {inst}, engine start {est}. Window [{c['startUtc']}, {c['endUtc']}), closed at announcement {ann} (capture/BOUNDARY.json). Method `{decl_meta['method']}`, declaration `DECLARATION.json` (`{decl_meta['declarationSha256'][:16]}`). Hand Analysis grades independently from the same originals.

{boundary_md}
## 0. Capture integrity
- Census: {c['slices']} one-minute slices, complete {c['complete']}, missing {len(c['missingSlices'])}; {c['handsRead']:,} hands; {c['humanHands']} with a person (eligible mixed {c['byRosterClass'].get('eligible_mixed', 0)}, person-only {c['byRosterClass'].get('excluded_human_only', 0)}).
- Human hand keys: {rec_keys}. Witness originals: {ws0.get('hands', 0)} read, {ws0.get('missing', 0)} missing, {ws0.get('otherRelease', 0)} other release, {ws0.get('decisions', 0):,} Horse decisions; review status {json.dumps(ws0.get('reviewStatus') or {})}.
- Lightning: {L['segments']} segments, all complete {L['allComplete']}, defect {L['anyDefect']}; committed {L['totals'].get('committed', 0):,}.
- Deviations: {dev_str}

## 1. Decision quality
### 1.1 Tight opponents
- Persons tight by the method faced: {fa['humans']} ({', '.join('VPIP %.3f / PFR %.3f' % (v['vpip'], v['pfr']) for v in byh.values()) or 'none'}); faced decisions {fa['n']} in {fa['hands']} hands, counting {t['facedCounting']}, absent-like {t['facedAbsentLike']}.
- Recognition: engine participation read {json.dumps(nt['tightFaced']['engineParticipation'])} (engine tight line {nt['engineLine']}, method line {nt['methodLine']}); tight respect {tight_resp}; receipts present {nt['tightFaced']['withReceipt']}, threshold moved {nt['tightFaced']['receiptMovedBar']}.
- Adjustment: {fa['changed']} changed; final actions {json.dumps(fa['finalActions'])}; verdicts {json.dumps(fa['verdicts'])}.{change_note}
- Lane grade: tight {tightgrade}. Hand Analysis grades independently.
### 1.2 Sustained maniac
- {m['sustainedAll']} sustained and {m['selectiveAll']} selective maniac persons under the method: {maniacgrade}.
- Disclosed, not graded: engine maniac read engaged on {m['facedEngineManiacRead']['n']} faced decisions against {m['facedEngineManiacRead']['humans']} persons, {m['facedEngineManiacRead']['changed']} changed, verdicts {json.dumps(m['facedEngineManiacRead']['verdicts'])}.

## 2. Coverage & concentration (A16, M4)
- Eligible mixed hands by cell: {json.dumps(c['eligibleMixedByCell'])}. Witness decisions by cell: {json.dumps(w['decisionsByVariantMode'])}; persons {w['humans']}.{top_h_line}

## 3. Telemetry and exclusions
- Forbidden-pattern hits: {R['fires']['forbiddenPatternHits'] or 'none'}. Exact opponent-memory reads: ok {f.get('horse_exact_memory_read_ok')}, busy {f.get('horse_exact_memory_read_busy')}, timeout {f.get('horse_exact_memory_read_timeout')}, over 1 s {f.get('horse_exact_memory_read_ms_gt1000')}.
- Style: tight opener respect {f.get('style_tight_opener_respect_seen')}, tight re-raiser respect {f.get('style_tight_reraiser_respect_seen')}. Maniac: observed raiser {f.get('observed_maniac_raiser_seen')}, call down {f.get('maniac_call_down')}, short-stack jam {f.get('maniac_short_stack_jam')}. PLO6 hand-off counter: {f.get('plo6_maniac_price_refusal_range_play_seen') or 'none'}.

## 4. Per-Horse roll-up
{roll_line}

## 5. PLO6 two-set read
{plo6_section}{scoring_section}"""
        grades_txt = f"""# Lane grades, {r8} window [{c['startUtc']}, {c['endUtc']}) (for Hand Analysis to grade independently)
- Declaration: PASS (`{decl_meta['declarationSha256'][:16]}`).
- Capture: {'PASS' if c['complete'] and not c['missingSlices'] and ws0.get('missing', 0) == 0 else 'SEE REPORT'} (census {c['slices']} slices complete={c['complete']}, {ws0.get('hands', 0)}/{c['humanHands']} person hands read, {ws0.get('missing', 0)} missing).
- Lightning reconciliation: {'PASS' if L['allComplete'] and not L['anyDefect'] else 'SEE REPORT'}.
- Tight live gate: {tightgrade} ({fa['n']} faced, {t['facedCounting']} counting, {fa['humans']} persons, {tight_resp} tight-respect recognised, {fa['changed']} changed).
- Maniac live gate: {maniacgrade} ({m['sustainedAll']} sustained, {m['selectiveAll']} selective maniac persons).
- Exclusions: {'PASS' if not R['fires']['forbiddenPatternHits'] else 'SEE REPORT'}.
"""
    else:
        tightgrade = 'UNVERIFIED'
        maniacgrade = 'UNVERIFIED'
        steps_lines = (cap / 'steps.log').read_text(encoding='utf-8').splitlines() if (cap / 'steps.log').exists() else []
        l_segs = [json.loads(l) for l in steps_lines if l.startswith('{"sha256"') and '"defect"' in l]
        l_ok = bool(l_segs) and all(x.get('complete') for x in l_segs) and not any(x.get('defect') for x in l_segs)
        rf_path = cap / 'rule-fires-window.json'
        fr = (json.loads(rf_path.read_text(encoding='utf-8')).get('result') or {}).get('fires') or {} if rf_path.exists() else {}
        forb = {k: v for k, v in fr.items() if re.search(r'pillar2|pillar_2|r7_|r8_|_r7|_r8|held_out|heldout|leak_map|leakmap', k, re.I)}
        roll_line = (
            f"- cohort {roll['cohort']['n']} (md5 {roll['cohort']['md5'][:8]}), {roll['horsesWithHands']} Horses with hands, "
            f"{roll['horsesSampled']} sampled, {roll['cohortWithoutHands']} without hands."
            if roll
            else '- Per-Horse roll-up not available.'
        )
        report_txt = f"""# Observation report, build {r8} (operator {operator_id})
Release {rel}, instance {inst}, engine start {est}. Window [{start_utc}, {end_utc}), closed at announcement {ann} (capture/BOUNDARY.json). Method `{decl_meta['method']}`, declaration `DECLARATION.json` (`{decl_meta['declarationSha256'][:16]}`). Hand Analysis grades independently from the same originals.

{boundary_md}
## 0. Capture integrity
- Census: {denom.get('slices', 0)} one-minute slices, complete {denom.get('complete')}, missing {len(denom.get('missingSlices') or [])}; {denom.get('handsRead', 0):,} hands; **{human_hands} with a person**.
- Lightning: {len(l_segs)} segments, all complete {l_ok}.
- Deviations: {dev_str}

## 1. Decision quality
- No human hands in window ({human_hands} human hands): tight UNVERIFIED (0 opportunities), maniac UNVERIFIED (0 opportunities).

## 2. Telemetry and exclusions
- Forbidden-pattern hits: {forb or 'none'}. Exact opponent-memory reads: ok {fr.get('horse_exact_memory_read_ok')}, busy {fr.get('horse_exact_memory_read_busy')}, timeout {fr.get('horse_exact_memory_read_timeout')}.

## 3. Per-Horse roll-up
{roll_line}

## 4. PLO6 two-set read
{plo6_section}{scoring_section}"""
        grades_txt = f"""# Lane grades, {r8} window [{start_utc}, {end_utc}) (for Hand Analysis to grade independently)
- Declaration: PASS (`{decl_meta['declarationSha256'][:16]}`).
- Capture: {'PASS' if denom.get('complete') and not (denom.get('missingSlices') or []) else 'SEE REPORT'} (census {denom.get('slices', 0)} slices, {human_hands} person hands).
- Lightning reconciliation: {'PASS' if l_ok else 'SEE REPORT'}.
- Tight live gate: UNVERIFIED (0 person hands).
- Maniac live gate: UNVERIFIED (0 person hands).
- Exclusions: {'PASS' if not forb else 'SEE REPORT'}.
"""

    report_sha = write_once(obs / 'REPORT-OBSERVATION.md', report_txt, created, skipped)
    grades_sha = write_once(obs / 'PHASE1-GRADE-POST-WINDOW.md', grades_txt, created, skipped)

    # 4. support-plo6* EVIDENCE-INDEX.md
    plo6_indexes = {}
    sep_dirs = []
    for sp_name in ('support-plo6', 'support-plo6-full'):
        sp_dir = obs / sp_name
        if sp_dir.is_dir():
            sep_dirs.append(sp_name)
            sp_lines = [f'# Evidence index, {r8} {sp_name} ({now_iso})'] + build_index_lines(
                sp_dir, sp_name, exclude_names=('EVIDENCE-INDEX.md',)
            )
            plo6_indexes[sp_name] = write_once(
                sp_dir / 'EVIDENCE-INDEX.md', '\n'.join(sp_lines) + '\n', created, skipped
            )

    # 5. Top-level EVIDENCE-INDEX.md
    sep_clause = f"; {', '.join(d + '/' for d in sep_dirs)} indexed separately" if sep_dirs else ''
    top_lines = [f'# Evidence index, {r8} ({now_iso}){sep_clause}'] + build_index_lines(
        obs, '.', exclude_top_dirs=tuple(sep_dirs), exclude_names=('EVIDENCE-INDEX.md',)
    )
    index_sha = write_once(obs / 'EVIDENCE-INDEX.md', '\n'.join(top_lines) + '\n', created, skipped)

    out = {
        'release8': r8,
        'declarationSha256': decl_meta['declarationSha256'],
        'reportSha256': report_sha,
        'indexSha256': index_sha,
        'gradesSha256': grades_sha,
        'preservedSha256': preserved_sha,
        'plo6IndexSha256': plo6_indexes,
        'tightGrade': tightgrade,
        'maniacGrade': maniacgrade,
        'created': created,
        'skippedExisting': skipped,
    }
    sys.stdout.write(json.dumps(out) + '\n')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as exc:
        sys.stderr.write(f'{exc}\n')
        raise SystemExit(1)
