#!/usr/bin/env python3
"""blind_review.py: M6 blind-review batch generator and canonical label scorer (E-PRIME-METHOD).

- Pairs each changed decision 1:1 with a deterministic seeded control drawn from
  unchanged decisions that have the EXACT SAME recorded action (`actionTaken`),
  preventing the action from leaking group membership.
- Strips outcomes, opponent hole cards, replay results, option outputs, and
  group tags; writes shuffled batches of 10 (`batches/batch-XX.json`) and keeps
  the group mapping in `private/key.json` (`0600` inside `0700` dir).
- Scores reviewer labels with canonical normalization (`acceptable-close`,
  `acceptable close` -> `acceptable_close`) and checks Bar e' (i) `edge > 2 SE`
  and (ii) `meanActualEvBb >= -2 SE` on changed reviewer-`correct` decisions.
"""
import collections
import hashlib
import json
import math
import os
import random
import re
import sys
from pathlib import Path

import score_decisions

ALLOWED_PACKET_FIELDS = (
    'game',
    'rake',
    'heroCards',
    'board',
    'seats',
    'actionLog',
    'pot',
    'price',
    'effectiveStack',
    'spr',
    'legalActions',
    'actionTaken',
    'journaledReadFrame',
    'computedLayer',
)

FORBIDDEN_SUBSTRINGS = (
    'result',
    'netbb',
    'wonbb',
    'opponentcard',
    'othercard',
    'otherplayercard',
    'showdown',
    'replay',
    'optionoutput',
    'candidateaction',
    'testaction',
    'counterfactual',
    'iscontrol',
    'group',
)

CANONICAL_LABELS = {
    'correct': 'correct',
    'acceptable_close': 'acceptable_close',
    'questionable': 'questionable',
    'wrong': 'wrong',
}


def normalize_label(raw: str) -> str:
    cleaned = re.sub(r'[\s\-]+', '_', str(raw).strip().lower())
    if cleaned not in CANONICAL_LABELS:
        raise ValueError(f'unknown reviewer label {raw!r}; expected one of {sorted(CANONICAL_LABELS)}')
    return CANONICAL_LABELS[cleaned]


def _action_key(rec: dict) -> str:
    act = rec.get('actionTaken')
    if isinstance(act, dict):
        return str(act.get('action') or '').strip().lower()
    return str(act or '').strip().lower()


def _sanitize_packet(packet_id: str, rec: dict) -> dict:
    for k in rec:
        low = k.lower()
        if any(bad in low for bad in FORBIDDEN_SUBSTRINGS) and k not in ('changed', 'sourceId', 'hand'):
            pass
    pkt = {'packetId': packet_id}
    for field in ALLOWED_PACKET_FIELDS:
        if field in rec:
            val = rec[field]
            if isinstance(val, dict):
                bad_nested = [nk for nk in val if any(b in nk.lower() for b in FORBIDDEN_SUBSTRINGS)]
                if bad_nested:
                    raise ValueError(f'forbidden nested key(s) {bad_nested} in {field}')
            pkt[field] = val
    missing = [f for f in ('game', 'heroCards', 'board', 'actionTaken', 'journaledReadFrame') if f not in pkt]
    if missing:
        raise ValueError(f'packet {rec.get("sourceId")} missing required fields: {missing}')
    return pkt


def build_blind_batches(
    records: list[dict],
    out_dir,
    seed: int = 20261118,
    batch_size: int = 10,
) -> dict:
    if batch_size < 1:
        raise ValueError('batch_size must be >= 1')
    out = Path(out_dir)
    batches_dir = out / 'batches'
    priv_dir = out / 'private'
    if batches_dir.exists() or priv_dir.exists():
        raise FileExistsError(f'refused: blind review output already exists at {out}')

    changed_by_act = collections.defaultdict(list)
    unchanged_by_act = collections.defaultdict(list)
    for idx, r in enumerate(records):
        act = _action_key(r)
        if not act:
            raise ValueError(f'record {idx} missing actionTaken')
        sid = str(r.get('sourceId') or f'{r.get("hand", "h")}:{idx}')
        entry = {**r, 'sourceId': sid, '_act': act}
        if bool(r.get('changed')):
            changed_by_act[act].append(entry)
        else:
            unchanged_by_act[act].append(entry)

    total_changed = sum(len(v) for v in changed_by_act.values())
    if total_changed == 0:
        raise ValueError('refused: zero changed decisions supplied')

    rng = random.Random(int(seed))
    selected = []
    for act in sorted(changed_by_act):
        ch = sorted(changed_by_act[act], key=lambda x: x['sourceId'])
        pool = sorted(unchanged_by_act[act], key=lambda x: x['sourceId'])
        if len(pool) < len(ch):
            raise ValueError(
                f'insufficient matched unchanged controls with recorded action {act!r}: '
                f'need {len(ch)}, have {len(pool)}'
            )
        ctrls = rng.sample(pool, len(ch))
        for item in ch:
            selected.append(('changed', item))
        for item in ctrls:
            selected.append(('control', item))

    rng.shuffle(selected)

    packets = []
    key_entries = {}
    used_ids = set()
    for pos, (grp, item) in enumerate(selected):
        nonce = f'{seed}:{pos}:{item["sourceId"]}:{rng.getrandbits(64):016x}'
        pid = 'rev_' + hashlib.sha256(nonce.encode('utf-8')).hexdigest()[:12]
        while pid in used_ids:
            pid = 'rev_' + hashlib.sha256((nonce + 'x').encode('utf-8')).hexdigest()[:12]
        used_ids.add(pid)
        packets.append(_sanitize_packet(pid, item))
        key_entries[pid] = {
            'group': grp,
            'sourceId': item['sourceId'],
            'hand': str(item.get('hand') or item['sourceId'].split(':')[0]),
            'recordedAction': item['_act'],
            'edgeBb': item.get('edgeBb'),
            'samplingSeBb': item.get('samplingSeBb'),
            'ratesSeBb': item.get('ratesSeBb'),
            'realizationSeBb': item.get('realizationSeBb'),
            'deltaEvActualBb': item.get('deltaEvActualBb'),
        }

    batches_dir.mkdir(parents=True, exist_ok=False)
    os.mkdir(priv_dir, 0o700)
    os.chmod(priv_dir, 0o700)

    batch_files = []
    for b_idx in range(0, len(packets), batch_size):
        chunk = packets[b_idx : b_idx + batch_size]
        b_num = (b_idx // batch_size) + 1
        b_path = batches_dir / f'batch-{b_num:02d}.json'
        payload = {
            'batchNumber': b_num,
            'packetCount': len(chunk),
            'allowedVerdicts': list(CANONICAL_LABELS.keys()),
            'instructions': (
                'Judge the recorded actionTaken using only the decision-time state and '
                'journaled read frame shown. Return one verdict per packetId.'
            ),
            'packets': chunk,
        }
        fd = os.open(str(b_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            os.write(fd, (json.dumps(payload, indent=1) + '\n').encode('utf-8'))
        finally:
            os.close(fd)
        batch_files.append(b_path.name)

    key_path = priv_dir / 'key.json'
    key_payload = {
        'seed': int(seed),
        'batchSize': int(batch_size),
        'changedCount': total_changed,
        'controlCount': total_changed,
        'totalPackets': len(packets),
        'packets': key_entries,
    }
    fd_k = os.open(str(key_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(fd_k, (json.dumps(key_payload, indent=1) + '\n').encode('utf-8'))
    finally:
        os.close(fd_k)

    return {
        'seed': int(seed),
        'totalPackets': len(packets),
        'changedCount': total_changed,
        'controlCount': total_changed,
        'batches': batch_files,
        'keySha256': hashlib.sha256(key_path.read_bytes()).hexdigest(),
    }


def score_blind_labels(
    labels_input: dict[str, str] | list[dict],
    key_payload: dict,
    seed: int = 20261118,
) -> dict:
    key_map: dict = key_payload['packets']
    raw_labels: dict[str, str] = {}
    if isinstance(labels_input, dict):
        raw_labels = {str(k): str(v) for k, v in labels_input.items()}
    elif isinstance(labels_input, list):
        for item in labels_input:
            pid = str(item['packetId'])
            if pid in raw_labels:
                raise ValueError(f'duplicate label for {pid}')
            raw_labels[pid] = str(item['verdict'])
    else:
        raise ValueError('labels_input must be dict or list of {packetId, verdict}')

    missing = sorted(set(key_map) - set(raw_labels))
    extra = sorted(set(raw_labels) - set(key_map))
    if extra:
        raise ValueError(f'unknown packetId(s) in labels: {extra[:5]}')
    if missing:
        return {
            'status': 'INSUFFICIENT',
            'verdict': 'INSUFFICIENT',
            'missingCount': len(missing),
            'missingPacketIds': missing,
        }

    counts = {'changed': collections.Counter(), 'control': collections.Counter()}
    changed_correct = []
    for pid, meta in sorted(key_map.items()):
        norm = normalize_label(raw_labels[pid])
        counts[meta['group']][norm] += 1
        if meta['group'] == 'changed' and norm == 'correct':
            s_se = float(meta.get('samplingSeBb') or 0.0)
            r_se = float(meta.get('ratesSeBb') or 0.0)
            z_se = float(meta.get('realizationSeBb') or 0.0)
            tot_se = math.sqrt((s_se ** 2) + (r_se ** 2) + (z_se ** 2))
            edge = float(meta['edgeBb']) if meta.get('edgeBb') is not None else None
            passes_edge = bool(edge is not None and edge > 2.0 * tot_se)
            changed_correct.append({
                'packetId': pid,
                'hand': meta['hand'],
                'edgeBb': edge,
                'totalSeBb': round(tot_se, 4),
                'passes2Se': passes_edge,
                'deltaEvActualBb': meta.get('deltaEvActualBb'),
            })

    bar_i_pass = all(x['passes2Se'] for x in changed_correct)
    if not changed_correct:
        bar_ii_pass = True
        ev_stats = {'vacuous': True, 'nDecisions': 0}
    elif any(x['deltaEvActualBb'] is None for x in changed_correct):
        bar_ii_pass = False
        ev_stats = {'vacuous': False, 'missingActualEv': True}
    else:
        boot = score_decisions.bootstrap_hand_mean_ci(
            [(x['hand'], float(x['deltaEvActualBb'])) for x in changed_correct],
            seed=seed,
            n_boot=2000,
        )
        approx_se = (boot['ci95MeanBb'][1] - boot['ci95MeanBb'][0]) / 3.92 if boot['nHands'] > 1 else 0.0
        bar_ii_pass = bool(boot['meanBbPerDecision'] >= -2.0 * approx_se)
        ev_stats = {**boot, 'approxSeBb': round(approx_se, 4)}

    passed = bool(bar_i_pass and bar_ii_pass)
    return {
        'status': 'COMPLETE',
        'verdict': 'PASS' if passed else 'FAIL',
        'changedCounts': dict(counts['changed']),
        'controlCounts': dict(counts['control']),
        'changedCorrectOrAcceptableClose': counts['changed']['correct'] + counts['changed']['acceptable_close'],
        'controlCorrectOrAcceptableClose': counts['control']['correct'] + counts['control']['acceptable_close'],
        'barEPrimeI_edgeGt2Se': {
            'pass': bar_i_pass,
            'changedLabelledCorrect': len(changed_correct),
            'passingEdgeBar': sum(1 for x in changed_correct if x['passes2Se']),
            'decisions': changed_correct,
        },
        'barEPrimeII_meanActualEv': {
            'pass': bar_ii_pass,
            'stats': ev_stats,
        },
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in ('build', 'score'):
        sys.stderr.write(
            'usage:\n'
            '  blind_review.py build CANDIDATES_JSONL OUT_DIR [SEED] [BATCH_SIZE]\n'
            '  blind_review.py score LABELS_JSON KEY_JSON OUT_JSON [SEED]\n'
        )
        return 2
    mode = argv[1]
    if mode == 'build':
        in_path, out_dir = Path(argv[2]), Path(argv[3])
        seed = int(argv[4]) if len(argv) > 4 else 20261118
        bsize = int(argv[5]) if len(argv) > 5 else 10
        recs = [
            json.loads(l)
            for l in in_path.read_text(encoding='utf-8').splitlines()
            if l.strip().startswith('{')
        ]
        res = build_blind_batches(recs, out_dir, seed=seed, batch_size=bsize)
        sys.stdout.write(json.dumps(res) + '\n')
        return 0
    else:
        labels_path, key_path, out_path = Path(argv[2]), Path(argv[3]), Path(argv[4])
        seed = int(argv[5]) if len(argv) > 5 else 20261118
        if out_path.exists():
            sys.stderr.write(f'refused: {out_path} exists\n')
            return 1
        labels_obj = json.loads(labels_path.read_text(encoding='utf-8'))
        key_obj = json.loads(key_path.read_text(encoding='utf-8'))
        res = score_blind_labels(labels_obj, key_obj, seed=seed)
        fd = os.open(str(out_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            os.write(fd, (json.dumps(res, indent=1) + '\n').encode('utf-8'))
        finally:
            os.close(fd)
        sys.stdout.write(json.dumps({'status': res['status'], 'verdict': res['verdict']}) + '\n')
        return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
