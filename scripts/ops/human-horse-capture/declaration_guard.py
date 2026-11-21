#!/usr/bin/env python3
"""declaration_guard.py: pre-evaluation DECLARATION.json + SHA-256 hard gate (M3, M13).

Enforces that every window read and observation report runs against a frozen
DECLARATION.json whose SHA-256 matches DECLARATION.sha256 before any journal
replay, scoring, or report generation begins.
"""
import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path

HEX40 = re.compile(r'^[0-9a-f]{40}$')
HEX64 = re.compile(r'^[0-9a-f]{64}$')
ISO_UTC = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$')


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_declaration(obs_dir, expected_sha: str | None = None) -> dict:
    obs = Path(obs_dir)
    decl_path = obs / 'DECLARATION.json'
    sha_path = obs / 'DECLARATION.sha256'
    if not decl_path.is_file():
        raise ValueError(f'refused: missing {decl_path} (declare before reading or scoring)')
    if not sha_path.is_file():
        raise ValueError(f'refused: missing {sha_path} (declaration digest required)')

    raw = decl_path.read_bytes()
    actual_digest = sha256_bytes(raw)
    recorded_tokens = sha_path.read_text(encoding='utf-8').strip().split()
    recorded_digest = recorded_tokens[0] if recorded_tokens else ''
    if not HEX64.fullmatch(recorded_digest):
        raise ValueError(f'refused: invalid sha256 token in {sha_path}')
    if actual_digest != recorded_digest:
        raise ValueError(
            f'refused: DECLARATION.json sha256 mismatch (actual {actual_digest[:16]} != recorded {recorded_digest[:16]})'
        )

    try:
        doc = json.loads(raw.decode('utf-8'))
    except Exception as exc:
        raise ValueError(f'refused: DECLARATION.json is not valid JSON: {exc}') from exc

    if not isinstance(doc, dict):
        raise ValueError('refused: DECLARATION.json root must be an object')

    declared_at = doc.get('declaredAt')
    if not isinstance(declared_at, str) or not ISO_UTC.fullmatch(declared_at):
        raise ValueError('refused: DECLARATION.json requires ISO UTC declaredAt')

    win = doc.get('window')
    if not isinstance(win, dict) or not isinstance(win.get('startUtc'), str) or not ISO_UTC.fullmatch(win['startUtc']):
        raise ValueError('refused: DECLARATION.json requires window.startUtc in ISO UTC')
    if win.get('halfOpen') is not True:
        raise ValueError('refused: DECLARATION.json requires window.halfOpen = true')

    rel = doc.get('release')
    if not isinstance(rel, dict) or not isinstance(rel.get('sha'), str) or not HEX40.fullmatch(rel['sha']):
        raise ValueError('refused: DECLARATION.json requires 40-hex lowercase release.sha')
    if not isinstance(rel.get('instanceId'), str) or not rel['instanceId'].strip():
        raise ValueError('refused: DECLARATION.json requires non-empty release.instanceId')

    if expected_sha is not None:
        if not HEX40.fullmatch(expected_sha):
            raise ValueError('refused: expected_sha must be 40 lowercase hex')
        if rel['sha'] != expected_sha:
            raise ValueError(
                f"refused: DECLARATION.json release.sha {rel['sha'][:10]} != requested {expected_sha[:10]}"
            )

    if not isinstance(doc.get('method'), str) or not doc['method'].strip():
        raise ValueError('refused: DECLARATION.json requires non-empty method')
    has_rules = bool(
        (isinstance(doc.get('expectations_before_outcomes'), str) and doc['expectations_before_outcomes'].strip())
        or (isinstance(doc.get('selection'), dict) and doc['selection'])
        or (isinstance(doc.get('bars'), dict) and doc['bars'])
    )
    if not has_rules:
        raise ValueError(
            'refused: DECLARATION.json requires expectations_before_outcomes, selection, or bars'
        )

    return {
        'ok': True,
        'declarationSha256': actual_digest,
        'declaredAt': declared_at,
        'releaseSha': rel['sha'],
        'instanceId': rel['instanceId'],
        'startUtc': win['startUtc'],
        'method': doc['method'],
    }


def write_declaration(obs_dir, payload: dict) -> dict:
    obs = Path(obs_dir)
    obs.mkdir(parents=True, exist_ok=True)
    decl_path = obs / 'DECLARATION.json'
    sha_path = obs / 'DECLARATION.sha256'
    if decl_path.exists() or sha_path.exists():
        raise FileExistsError(f'refused: declaration already exists in {obs}')

    doc = dict(payload)
    if 'declaredAt' not in doc:
        doc['declaredAt'] = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    encoded = (json.dumps(doc, indent=1, sort_keys=False) + '\n').encode('utf-8')
    digest = sha256_bytes(encoded)

    fd = os.open(str(decl_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o444)
    try:
        os.write(fd, encoded)
    finally:
        os.close(fd)

    fd_sha = os.open(str(sha_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o444)
    try:
        os.write(fd_sha, f'{digest}\n'.encode('utf-8'))
    finally:
        os.close(fd_sha)

    return verify_declaration(obs, expected_sha=(doc.get('release') or {}).get('sha'))


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] not in ('verify', 'init'):
        sys.stderr.write(
            'usage:\n'
            '  declaration_guard.py verify OBS_DIR [EXPECTED_SHA40]\n'
            '  declaration_guard.py init   OBS_DIR PAYLOAD_JSON_FILE\n'
        )
        return 2
    mode = argv[1]
    obs_dir = argv[2]
    try:
        if mode == 'verify':
            exp = argv[3] if len(argv) > 3 else os.environ.get('HVH_SHA') or None
            res = verify_declaration(obs_dir, expected_sha=exp)
        else:
            payload = json.loads(Path(argv[3]).read_text(encoding='utf-8'))
            res = write_declaration(obs_dir, payload)
    except (ValueError, FileExistsError, OSError) as exc:
        sys.stderr.write(f'{exc}\n')
        return 1
    sys.stdout.write(json.dumps(res) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
