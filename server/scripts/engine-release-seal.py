#!/usr/bin/env python3
"""Durable, fail-closed release authority for the Club Arena engine.

The Docker tags and the repository checkout on the engine host are mutable
caches.  This file keeps the one authoritative release decision in a
root-owned state file outside that checkout.  A normal deploy may only move the
high-water mark forward along ``origin/main``.  A rollback needs its own
explicit, audited mode and never lowers that high-water mark.

Every command which mutates the seal is serialized and atomically replaces the
state file.  ``engine-up.sh`` consumes the one-use token created by ``prepare``
before it stops the serving container; the host supervisor may start only the
sealed desired image without a token.
"""

from __future__ import annotations

import argparse
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import shlex
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any, NoReturn


SCHEMA = 1
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
IMAGE_ID_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
RUN_ID_RE = re.compile(r"^[1-9][0-9]*(?:-[1-9][0-9]*)?$")
RUN_URL_RE = re.compile(r"^https://github\.com/[^/]+/[^/]+/actions/runs/[1-9][0-9]*$")
INSTANCE_ID_RE = re.compile(r"^[1-9][0-9]*-[0-9a-f]{8}$")
CONTAINER_ID_RE = re.compile(r"^[0-9a-f]{64}$")
INVOCATION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
PENDING_TTL_SECONDS = int(os.environ.get("ENGINE_RELEASE_PENDING_TTL_SECONDS", "1800"))
STATE_DIR = Path(os.environ.get("ENGINE_RELEASE_STATE_DIR", "/var/lib/club-arena"))
STATE_FILE = Path(os.environ.get("ENGINE_RELEASE_STATE_FILE", str(STATE_DIR / "engine-release-seal.json")))
AUDIT_FILE = Path(os.environ.get("ENGINE_RELEASE_AUDIT_FILE", str(STATE_DIR / "engine-release-audit.jsonl")))
RESULT_DIR = Path(
    os.environ.get("ENGINE_RELEASE_RESULT_DIR", str(STATE_DIR / "engine-release-results"))
)
LOCK_FILE = Path(os.environ.get("ENGINE_RELEASE_LOCK_FILE", "/var/lock/club-arena-engine-release.lock"))

# One historical permanent refusal, not a generic expired-owner escape hatch.
FAILED_ROUTINE_RUN = '41349091113-1'
FAILED_ROUTINE_SHA = '3e3c6d4752cd587fad0db521ebd262f1b485514c'
FAILED_ROUTINE_START = 1793570400
FAILED_ROUTINE_COMPLETED = 1793569102
FAILED_ROUTINE_DIGEST = '4871c8d6386ea8e91ef00b0601708cb46254ef6117129af9a5a1ed239fff844f'
FAILED_ROUTINE_DESIRED = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
FAILED_ROUTINE_IMAGE = 'sha256:2eb1c5a7279032240c5fff8a6b3ecf5dc6af735cc1227a51430d50dcae1b065b'
FAILED_ROUTINE_LITERAL = '[engine-release-transaction] FATAL: Phase1 requires the full retained-owner checkpoint; an age-only drained boundary is not qualified'
FAILED_ROUTINE_SOURCES = {
    'engine-release-transaction.sh': '3b3c60aef43e521d886a6de04b0e9022e66fc66d6af5822f2b56af0a11214c39',
    'install-engine-supervisor.sh': 'b47aaaca69f749a60e72ef983719b4d18c00b75d7c1d19958508a45930d0fa96',
    'install-engine-intake.sh': '5476d126add86e299728488c97eb0f47c2bdeddb3b0b28d680db6535eea47f1b',
    'engine-release-unit-wrapper.sh': 'e9abdbe2c97c3594b32a920285e78858c1e0497f00a8a7edd21b99ba0491dc9c',
    'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83',
}


def die(message: str) -> NoReturn:
    print(f"[engine-release-seal] FATAL: {message}", file=sys.stderr)
    raise SystemExit(1)


def valid_sha(value: str, label: str = "sha") -> str:
    value = value.lower()
    if not SHA_RE.fullmatch(value):
        die(f"{label} must be one lowercase 40-hex commit")
    return value


def valid_image_id(value: str, label: str = "image id") -> str:
    value = value.lower()
    if not IMAGE_ID_RE.fullmatch(value):
        die(f"{label} must be one full sha256 image id")
    return value


def run(command: list[str]) -> str:
    try:
        result = subprocess.run(
            command,
            check=True,
            text=True,
            capture_output=True,
            env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"},
            timeout=30,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        stderr = getattr(exc, "stderr", "") or ""
        die(f"command failed: {' '.join(command)}: {stderr.strip() or exc}")
    return result.stdout.strip()


def docker_json(kind: str, reference: str) -> dict[str, Any]:
    raw = run(["docker", kind, "inspect", "--format", "{{json .}}", reference])
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        die(f"docker returned malformed {kind} identity for {reference}")
    if not isinstance(value, dict):
        die(f"docker returned non-object {kind} identity for {reference}")
    return value


def image_identity(reference: str, *, require_label: bool) -> tuple[str, str, bool]:
    value = docker_json("image", reference)
    image_id = valid_image_id(str(value.get("Id", "")))
    config = value.get("Config") if isinstance(value.get("Config"), dict) else {}
    labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
    revision = labels.get("org.opencontainers.image.revision")
    if isinstance(revision, str) and SHA_RE.fullmatch(revision.lower()):
        return image_id, revision.lower(), True
    if require_label:
        die(f"image {reference} has no valid org.opencontainers.image.revision label")

    # Legacy bootstrap only: images built before the seal carried the full SHA
    # in image config ENV.  New candidates must carry the immutable OCI label.
    env = config.get("Env") if isinstance(config.get("Env"), list) else []
    matches = [entry.split("=", 1)[1] for entry in env if isinstance(entry, str) and entry.startswith("GIT_COMMIT_SHA=")]
    if len(matches) != 1 or not SHA_RE.fullmatch(matches[0].lower()):
        die(f"legacy image {reference} has no unique full GIT_COMMIT_SHA identity")
    return image_id, matches[0].lower(), False


def container_identity(name: str) -> tuple[str, str]:
    value = docker_json("container", name)
    state = value.get("State") if isinstance(value.get("State"), dict) else {}
    image_id = valid_image_id(str(value.get("Image", "")), "container image id")
    require_alert_journal_mount(value, docker_json("image", image_id))
    return str(state.get("Status", "")), image_id


def require_alert_journal_mount(container: dict[str, Any], image: dict[str, Any]) -> None:
    """New images cannot be sealed on ephemeral alert storage. Old sealed
    images remain recoverable; the schema capability comes from immutable
    image metadata rather than an overridable container label."""
    image_config = image.get("Config") or {}
    schema = (image_config.get("Labels") or {}).get("sp.alert-journal.schema")
    if schema is None:
        return
    if schema != "1":
        die("unsupported engine alert journal schema")
    destination = "/var/lib/club-arena/engine-alerts"
    expected_source = str(Path(os.environ.get("ENGINE_ALERT_JOURNAL_HOST_DIR", destination)).resolve())
    mounts = [m for m in container.get("Mounts", []) if m.get("Destination") == destination]
    if len(mounts) != 1 or mounts[0].get("Type") != "bind" or mounts[0].get("RW") is not True \
            or mounts[0].get("Source") != expected_source:
        die("engine alert journal is not on its durable writable host mount")
    environment = (container.get("Config") or {}).get("Env") or []
    configured = [entry for entry in environment if isinstance(entry, str)
                  and entry.startswith("ENGINE_ALERT_JOURNAL_DIR=")]
    if configured != [f"ENGINE_ALERT_JOURNAL_DIR={destination}"]:
        die("engine alert journal environment does not match its persistent mount")


def require_horse_journal_runtime(container: str, sha: str, image_id: str,
                                  container_id: str, started_at: str) -> None:
    """Qualify this positive result, never predecessor observation or recovery.

    Canonical launches (including rollback) already supply this run-spec. A
    mountless manually launched predecessor remains recoverable, but cannot
    acquire a new positive receipt. Do not move this into container_identity:
    classification treats its refusal as absence and recovery must stay valid.
    """
    if (not CONTAINER_ID_RE.fullmatch(container_id) or not started_at
            or len(started_at) > 80 or any(ord(char) < 32 for char in started_at)):
        die("Horse journal qualification has no valid container generation")
    runtime = docker_json("container", container)
    state = runtime.get("State") if isinstance(runtime.get("State"), dict) else {}
    config = runtime.get("Config") if isinstance(runtime.get("Config"), dict) else {}
    labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
    if (runtime.get("Id") != container_id or runtime.get("Image") != image_id
            or state.get("Status") != "running" or state.get("StartedAt") != started_at
            or labels.get("sp.release.sha") != sha):
        die("Horse journal qualification does not match the exact running generation")
    destination = "/var/lib/club-arena/horse-decisions"
    expected_source = str(Path(os.environ.get("ENGINE_HORSE_JOURNAL_HOST_DIR", destination)).resolve())
    all_mounts = runtime.get("Mounts")
    if not isinstance(all_mounts, list) or any(not isinstance(m, dict) for m in all_mounts):
        die("Horse journal mount metadata is unavailable")
    mounts = [m for m in all_mounts if m.get("Destination") == destination]
    if (len(mounts) != 1 or mounts[0].get("Type") != "bind" or mounts[0].get("RW") is not True
            or mounts[0].get("Source") != expected_source):
        die("Horse journal is not on its durable writable host mount")
    environment = config.get("Env")
    if not isinstance(environment, list) or any(not isinstance(e, str) for e in environment):
        die("Horse journal environment metadata is unavailable")
    configured = [e for e in environment if e.startswith("HORSE_DECISION_JOURNAL_DIR=")]
    if configured != [f"HORSE_DECISION_JOURNAL_DIR={destination}"]:
        die("Horse journal environment does not match its persistent mount")


def ensure_dirs() -> None:
    state_created = not STATE_DIR.exists()
    result_created = not RESULT_DIR.exists()
    lock_parent_created = not LOCK_FILE.parent.exists()
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    RESULT_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        STATE_DIR.chmod(0o700)
        RESULT_DIR.chmod(0o700)
    except PermissionError:
        pass
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    # An atomic file replacement is not durable if the directory containing
    # that file disappears after power loss. Persist every newly-created queue
    # root in its parent before any command can acknowledge a seal/result.
    for directory, created in (
        (RESULT_DIR, result_created),
        (STATE_DIR, state_created or result_created),
        (STATE_DIR.parent, state_created),
        (LOCK_FILE.parent, lock_parent_created),
        (LOCK_FILE.parent.parent, lock_parent_created),
    ):
        if not created:
            continue
        descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


class SealLock:
    def __enter__(self) -> "SealLock":
        ensure_dirs()
        self.handle = LOCK_FILE.open("a+")
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX)
        return self

    def __exit__(self, *_: object) -> None:
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()


def validate_release(value: Any, label: str) -> dict[str, str]:
    if not isinstance(value, dict):
        die(f"seal {label} is missing")
    return {
        "sha": valid_sha(str(value.get("sha", "")), f"{label}.sha"),
        "imageId": valid_image_id(str(value.get("imageId", "")), f"{label}.imageId"),
    }


def load_state() -> dict[str, Any]:
    try:
        value = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die(f"release seal is missing: {STATE_FILE}")
    except (OSError, json.JSONDecodeError) as exc:
        die(f"release seal is unreadable: {exc}")
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        die("release seal schema is invalid")
    raw_desired = value.get("desired")
    value["desired"] = validate_release(raw_desired, "desired")
    legacy_unlabelled = (
        raw_desired.get("legacyUnlabelled", False) if isinstance(raw_desired, dict) else False
    )
    if not isinstance(legacy_unlabelled, bool):
        die("release seal desired legacy marker is invalid")
    value["desired"]["legacyUnlabelled"] = legacy_unlabelled
    value["highWaterSha"] = valid_sha(str(value.get("highWaterSha", "")), "highWaterSha")
    generation = value.get("generation")
    if not isinstance(generation, int) or generation < 1:
        die("release seal generation is invalid")
    committed_runs = value.get("committedRuns", {})
    if not isinstance(committed_runs, dict):
        die("release seal committed-run history is invalid")
    for run_id, receipt in committed_runs.items():
        if not RUN_ID_RE.fullmatch(str(run_id)) or not isinstance(receipt, dict):
            die("release seal contains an invalid committed-run receipt")
        receipt.update(validate_release(receipt, f"committedRuns.{run_id}"))
    value["committedRuns"] = committed_runs
    resolutions = value.get("orphanFinalizationResolutions", {})
    if not isinstance(resolutions, dict):
        die("release seal orphan finalization history is invalid")
    for owner, resolution in resolutions.items():
        if (not RUN_ID_RE.fullmatch(str(owner)) or not isinstance(resolution, dict)
                or resolution.get("schema") != 1 or resolution.get("result") != "already-released"
                or resolution.get("originalCommittedRun") != committed_runs.get(owner)
                or not RUN_ID_RE.fullmatch(str(resolution.get("verifiedByRunId", "")))
                or resolution.get("verifiedByRunId") == owner):
            die("release seal orphan disposition does not preserve original authorship")
    finalization = value.get("finalization")
    if finalization is not None:
        if not isinstance(finalization, dict):
            die("release seal finalization owner is invalid")
        finalization.update(validate_release(finalization, "finalization"))
        if not RUN_ID_RE.fullmatch(str(finalization.get("runId", ""))):
            die("release seal finalization run id is invalid")
        committed_owner = committed_runs.get(str(finalization["runId"]))
        if (
            not isinstance(committed_owner, dict)
            or committed_owner.get("sha") != finalization["sha"]
            or committed_owner.get("imageId") != finalization["imageId"]
            or value["desired"]["sha"] != finalization["sha"]
            or value["desired"]["imageId"] != finalization["imageId"]
        ):
            die("release seal finalization owner is not the exact desired commit")
    value["finalization"] = finalization
    pending = value.get("pending")
    if pending is not None:
        if not isinstance(pending, dict):
            die("release seal pending entry is invalid")
        pending.update(validate_release(pending, "pending"))
        if pending.get("mode") not in {"deploy", "rollback"}:
            die("release seal pending mode is invalid")
        if not isinstance(pending.get("expiresAt"), int) or not isinstance(pending.get("used"), bool):
            die("release seal pending lifecycle is invalid")
        if not re.fullmatch(r"^[0-9a-f]{64}$", str(pending.get("tokenHash", ""))):
            die("release seal pending token hash is invalid")
        if not RUN_ID_RE.fullmatch(str(pending.get("runId", ""))):
            die("release seal pending run id is invalid")
    return value


def write_state(value: dict[str, Any]) -> None:
    ensure_dirs()
    write_json_atomic(STATE_FILE, value)


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        try:
            os.fchmod(fd, 0o600)
            payload = (
                json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n"
            ).encode()
            write_all(fd, payload)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary_path, path)
        directory_fd = os.open(
            path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        )
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        # An exception before replace must never leave a root-owned partial
        # state/result candidate that can accumulate or be mistaken for work.
        temporary_path.unlink(missing_ok=True)


def write_all(fd: int, payload: bytes) -> None:
    """Write every byte or fail; os.write is allowed to complete partially."""
    remaining = memoryview(payload)
    while remaining:
        written = os.write(fd, remaining)
        if written <= 0:
            raise OSError("write returned no progress")
        remaining = remaining[written:]


def audit(event: str, state: dict[str, Any], **details: Any) -> None:
    record = {
        "at": int(time.time()),
        "event": event,
        "generation": state.get("generation"),
        **details,
    }
    fd = os.open(AUDIT_FILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        write_all(
            fd,
            (json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n").encode(),
        )
        os.fsync(fd)
    finally:
        os.close(fd)
    # The file fsync above persists appended bytes, but the first O_CREAT also
    # adds a directory entry. Persist the parent on every append so a power
    # loss cannot retain a seal/result while losing its corresponding audit
    # stream's first entry.
    directory_fd = os.open(AUDIT_FILE.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def audit_once(
    event: str,
    state: dict[str, Any],
    event_key: str,
    **details: Any,
) -> None:
    """Append one receipt audit exactly once, repairing a lost first append."""
    digest = hashlib.sha256(
        json.dumps(details, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()
    try:
        records = AUDIT_FILE.read_bytes().splitlines(keepends=True)
    except FileNotFoundError:
        records = []
    except OSError as exc:
        die(f"release audit is unreadable: {exc}")
    for raw in records:
        if not raw.endswith(b"\n"):
            die("release audit ends with a partial record")
        try:
            existing = json.loads(raw)
        except json.JSONDecodeError as exc:
            die(f"release audit contains malformed JSON: {exc}")
        if not isinstance(existing, dict) or existing.get("eventKey") != event_key:
            continue
        if existing.get("event") != event or existing.get("eventDigest") != digest:
            die("release audit event key is bound to different receipt bytes")
        return
    audit(event, state, eventKey=event_key, eventDigest=digest, **details)


def metadata(args: argparse.Namespace) -> dict[str, str]:
    run_id = str(args.run_id)
    github_run_id = run_id.split("-", 1)[0]
    run_url = str(args.run_url)
    actor = str(args.actor).strip()
    reason = str(args.reason).strip()
    if not RUN_ID_RE.fullmatch(run_id):
        die("an audited numeric GitHub run id is required")
    if not RUN_URL_RE.fullmatch(run_url) or not run_url.endswith(f"/{github_run_id}"):
        die("run URL must identify the same audited GitHub Actions run")
    if not actor or len(actor) > 128 or any(ord(char) < 32 for char in actor):
        die("an audited actor is required")
    if not reason or len(reason) > 1000 or any(ord(char) < 32 for char in reason):
        die("an audited reason is required")
    return {"runId": run_id, "runUrl": run_url, "actor": actor, "reason": reason}


def pending_is_active(pending: Any) -> bool:
    # expiresAt is the first unauthorized second, not the last authorized one.
    # This also makes a deliberately zero-second test token deterministically
    # unusable without sleeping on the wall clock.
    return isinstance(pending, dict) and int(pending.get("expiresAt", 0)) > int(time.time())


def git_has_commit(repo: str, sha: str) -> None:
    run(["git", "-C", repo, "cat-file", "-e", f"{sha}^{{commit}}"])


def git_is_ancestor(repo: str, older: str, newer: str, explanation: str) -> None:
    try:
        subprocess.run(
            ["git", "-C", repo, "merge-base", "--is-ancestor", older, newer],
            check=True,
            text=True,
            capture_output=True,
            env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"},
            timeout=30,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        die(explanation)


def cmd_bootstrap_running(args: argparse.Namespace) -> None:
    with SealLock():
        if STATE_FILE.exists():
            state = load_state()
            print(state["desired"]["sha"])
            return
        meta = metadata(args)
        status, image_id = container_identity(args.container)
        if status != "running":
            die(f"cannot bootstrap from {args.container}: state is {status or 'unknown'}")
        inspected_id, sha, has_revision_label = image_identity(image_id, require_label=False)
        if inspected_id != image_id:
            die("running container and inspected image identities disagree")
        git_has_commit(args.repo, sha)
        git_is_ancestor(
            args.repo,
            sha,
            "origin/main",
            "running bootstrap image is not contained in fetched protected main",
        )
        state: dict[str, Any] = {
            "schema": SCHEMA,
            "generation": 1,
            "desired": {
                "sha": sha,
                "imageId": image_id,
                # The first rollout has to seal the already-running b4 image,
                # which predates both the OCI revision label and the container
                # sp.release.sha label.  This explicit, one-generation marker
                # lets the supervisor accept only that exact sealed image
                # without restarting it before a maintenance cutover.
                "legacyUnlabelled": not has_revision_label,
            },
            "highWaterSha": sha,
            "committedRuns": {},
            "finalization": None,
            "pending": None,
            "updatedAt": int(time.time()),
            "updatedBy": meta,
        }
        write_state(state)
        audit("bootstrap", state, desired=state["desired"], **meta)
        print(sha)


# Source policy is part of the immutable engine archive. No environment/CLI
# switch grants hourly authority. Completion/off on current protected main
# revokes new cycles even for an older still-contained target.
SCHEDULE_POLICY_PATH = 'server/src/maintenance/maintenanceSchedulePolicy.json'
SCHEDULE_POLICY_ID = 'phase1-hourly-01a1944f'


def schedule_policy(repo: str, sha: str) -> dict[str, Any]:
    raw = run(['git', '-C', repo, 'show', f'{valid_sha(sha)}:{SCHEDULE_POLICY_PATH}'])
    try:
        p = json.loads(raw)
    except ValueError:
        die('maintenance schedule policy is unreadable')
    if (not isinstance(p, dict) or set(p) != {'schema', 'policyId', 'timeZone', 'phase1Status', 'ownerMessageId', 'completionEvidence'}
            or p.get('schema') != 'engine-maintenance-schedule/v1'
            or p.get('policyId') != SCHEDULE_POLICY_ID or p.get('timeZone') != 'America/Chicago'
            or p.get('ownerMessageId') != '01a1944f-7131-7f11-8dcc-873d576e781c'
            or p.get('phase1Status') not in ('active', 'complete', 'off')
            or (p['phase1Status'] != 'active' and (not isinstance(p['completionEvidence'], str) or len(p['completionEvidence'].strip()) < 12))
            or (p['phase1Status'] == 'active' and p['completionEvidence'] is not None)):
        die('maintenance schedule policy is invalid')
    return {**p, 'digest': hashlib.sha256(raw.encode()).hexdigest()}


def current_cycle_policy(repo: str, sha: str, control: str) -> dict[str, Any]:
    main = run(['git', '-C', repo, 'rev-parse', 'origin/main'])
    for candidate in (sha, control):
        git_is_ancestor(repo, valid_sha(candidate), main, 'hourly policy target/control is not protected main')
    target, latest, controller = (schedule_policy(repo, revision) for revision in (sha, main, control))
    if target['digest'] != latest['digest'] or target['digest'] != controller['digest']:
        die('current protected hourly source policy does not authorize this cycle')
    return target


def routine_window(c: dict[str, Any], *, verified: bool = False) -> dict[str, Any] | None:
    w = c.get('window')
    if w is None:
        if verified: die('routine cycle has no verified durable announcement')
        return None
    if (not isinstance(w, dict) or set(w) != {'announcedAt','startsAt','endsAt','verified'}
            or any(type(w.get(k)) is not int for k in ('announcedAt','startsAt','endsAt'))
            or type(w.get('verified')) is not bool or w['startsAt'] != w['announcedAt']+120000
            or w['endsAt'] != w['startsAt']+300000
            or not c['startsAt']*1000 <= w['startsAt'] < (c['startsAt']+60)*1000):
        die('routine cycle window does not preserve its actual120/300second promise')
    if verified and not w['verified']:
        die('routine cycle announcement is not durably observed')
    return w


def cmd_bind_routine_window(args: argparse.Namespace) -> None:
    raw = sys.stdin.read(1048577)
    if len(raw)>1048576: die('routine health binding exceeds its bound')
    try: h=json.loads(raw)
    except ValueError: die('routine health binding is unreadable')
    with SealLock():
        state=load_state(); c=own_routine_cycle(state, str(args.run_id))
        if c is None or c['status']!='reserved' or c.get('failure') is not None:
            die('routine window has no unresolved original owner')
        current_cycle_policy(args.repo,c['sha'],c['controlSha'])
        m=h.get('maintenance') if isinstance(h,dict) else None
        p=m.get('presentation') if isinstance(m,dict) else None
        if (h.get('releaseSha')!=state['desired']['sha'] or h.get('running') is not True
                or 'weeklyPayout' not in h or h['weeklyPayout'] is not None
                or not isinstance(p,dict) or m.get('active') is not True or m.get('durableConfirmed') is not True
                or m.get('phase') not in ('last_hand','counting_down') or p.get('phase')!=m['phase'] or p.get('active') is not True
                or p.get('reason')!=m.get('reason') or type(p.get('break_id')) is not int):
            die('routine durable maintenance identity is unproved')
        announced=p['break_id']; w={'announcedAt':announced,'startsAt':announced+120000,'endsAt':announced+420000,'verified':True}
        probe={**c,'window':w}; routine_window(probe,verified=True)
        if (type(p.get('break_ends_at')) is not int or p['break_ends_at']!=w['endsAt']
                or type(p.get('scheduled_ends_at')) is not int or p['scheduled_ends_at']!=w['endsAt']):
            die('routine presentation changed its promised window')
        now=int(time.time()*1000)
        if not announced <= now < w['endsAt'] or (m['phase']=='last_hand') != (now<w['startsAt']):
            die('routine announcement is outside its original window/phase')
        if m['reason']=='Scheduled Engine Maintenance':
            s=m.get('schedule')
            expected={'timeZone':'America/Chicago','frequency':'phase1-hourly','policyId':SCHEDULE_POLICY_ID,
                      'startHour':None,'startMinute':0,'durationMs':300000,'hourlyCashFreeze':True}
            if (not isinstance(s,dict) or type(s.get('startMinute')) is not int or type(s.get('durationMs')) is not int
                    or s.get('hourlyCashFreeze') is not True or any(s.get(k)!=v for k,v in expected.items())
                    or schedule_policy(args.repo,state['desired']['sha'])['phase1Status']!='active'):
                die('routine serving hourly source is unproved')
        elif m['reason']=='Deployment Recovery':
            path=STATE_DIR/f'engine-recovery-window-{args.run_id}.json'
            try: reservation=json.loads(path.read_text())
            except (OSError,ValueError): die('initial routine recovery owner is unreadable')
            if reservation.get('runId')!=args.run_id or reservation.get('sha')!=c['sha'] or reservation.get('announcedAt')!=announced:
                die('initial routine recovery belongs to a different owner')
        else: die('routine reason is not supported')
        old=routine_window(c)
        if old is not None and any(old[k]!=w[k] for k in ('announcedAt','startsAt','endsAt')):
            die('routine window cannot slide after its first declaration')
        if c.get('window') != w:
            c['window']=w; write_state(state)
        print(json.dumps(c,sort_keys=True))


def routine_cycles(state: dict[str, Any]) -> dict[str, Any]:
    # A removed owner is not evidence of resolved custody. An earlier writer
    # may have recorded the expiry-only retirement shape; never accept that
    # history as authority or reconstruct an original owner by guessing.
    retired = state.get('retiredRoutineCycles', {})
    if not isinstance(retired, dict) or retired:
        die('unverified retiredRoutineCycles history requires original custody reconciliation')
    cycles = state.get('routineMaintenanceCycles', {})
    if not isinstance(cycles, dict):
        die('routine cycle history is unreadable')
    for key, c in cycles.items():
        if (not re.fullmatch(r'[1-9][0-9]*', key) or int(key) % 3600 or not isinstance(c, dict)
                or c.get('startsAt') != int(key) or c.get('endsAt') != int(key) + 300
                or c.get('policyId') != SCHEDULE_POLICY_ID
                or not re.fullmatch(r'[0-9a-f]{64}', str(c.get('policyDigest', '')))
                or not RUN_ID_RE.fullmatch(str(c.get('runId', '')))
                or not SHA_RE.fullmatch(str(c.get('sha', ''))) or not SHA_RE.fullmatch(str(c.get('controlSha', '')))
                or c.get('kind') not in ('hourly-reset', 'daily-restoration')
                or c.get('status') not in ('reserved', 'committed', 'sealed')):
            die('routine cycle history contains an invalid owner')
        routine_window(c)
        if c['status'] in ('committed', 'sealed'): routine_window(c,verified=True)
        if c['status'] in ('committed', 'sealed') and state['committedRuns'].get(c['runId'], {}).get('sha') != c['sha']:
            die('routine cycle has no exact canonical committed owner')
        if c['status'] == 'sealed':
            result = c.get('result')
            if not isinstance(result, dict) or result.get('result') != 'sealed' or result.get('runId') != c['runId'] or result.get('sha') != c['sha']:
                die('routine cycle has no sealed result receipt')
            actual = load_result(c['runId'])
            immutable = ('runId', 'result', 'sha', 'imageId', 'completedAt', 'completionRuntime')
            if (any(result.get(k) != actual.get(k) for k in immutable) or
                    state['committedRuns'][c['runId']].get('imageId') != actual['imageId']):
                die('routine cycle receipt differs from its canonical completion')
    resolutions = state.get('routineFailureResolutions', {})
    if not isinstance(resolutions, dict) or set(resolutions) - {FAILED_ROUTINE_RUN}:
        die('routine failure resolution history is invalid')
    for owner, resolution in resolutions.items():
        original = [c for c in cycles.values() if c['runId'] == owner]
        failed_routine_require(len(original) == 1)
        validate_failed_routine_resolution(resolution, original[0])
    return cycles


def cmd_restoration_needed(args: argparse.Namespace) -> None:
    target = schedule_policy(args.repo, args.sha)
    raw = sys.stdin.read(1048577)
    if target['phase1Status'] == 'active' or len(raw) > 1048576:
        raise SystemExit(1)
    try:
        h = json.loads(raw)
        serving = valid_sha(h.get('releaseSha', ''))
        schedule = h.get('maintenance', {}).get('schedule', {})
    except (ValueError, AttributeError):
        raise SystemExit(1)
    expected = {'timeZone':'America/Chicago', 'frequency':'phase1-hourly', 'policyId':SCHEDULE_POLICY_ID,
                'startHour':None, 'startMinute':0, 'durationMs':300000, 'hourlyCashFreeze':True}
    if (h.get('running') is not True or serving == args.sha or not isinstance(schedule, dict) or
            type(schedule.get('startMinute')) is not int or type(schedule.get('durationMs')) is not int or
            schedule.get('hourlyCashFreeze') is not True or any(schedule.get(k) != v for k,v in expected.items())):
        raise SystemExit(1)
    git_is_ancestor(args.repo, serving, args.sha, 'serving hourly source is not contained in restoration target')
    if schedule_policy(args.repo, serving)['phase1Status'] != 'active':
        raise SystemExit(1)
    print('true')


def routine_owner_unresolved(state: dict[str, Any], cycle: dict[str, Any]) -> bool:
    if cycle['status'] == 'sealed':
        return False
    resolutions = state.get('routineFailureResolutions', {})
    if not isinstance(resolutions, dict) or set(resolutions) - {FAILED_ROUTINE_RUN}:
        die('routine failure resolution history is invalid')
    resolution = resolutions.get(cycle['runId'])
    if resolution is None:
        return True
    validate_failed_routine_resolution(resolution, cycle)
    return False


def cmd_check_routine_owner(args: argparse.Namespace) -> None:
    with SealLock():
        state = load_state()
        owners = [c for c in routine_cycles(state).values() if routine_owner_unresolved(state, c)]
        if any(c['runId'] != args.run_id for c in owners):
            die('foreign pending or unknown routine cycle owner remains authoritative')
        print('owned' if owners else 'none')


def cmd_current_cycle_policy(args: argparse.Namespace) -> None:
    print(json.dumps(current_cycle_policy(args.repo,args.sha,args.control_sha),sort_keys=True))


def cmd_schedule_policy(args: argparse.Namespace) -> None:
    p = schedule_policy(args.repo, args.sha)
    print(json.dumps(p, sort_keys=True))


def cmd_reserve_routine_cycle(args: argparse.Namespace) -> None:
    run_id = str(args.run_id)
    if not RUN_ID_RE.fullmatch(run_id):
        die('routine cycle run id is invalid')
    now = int(time.time())
    with SealLock():
        state = load_state()
        cycles = routine_cycles(state)
        if state.get('routineFailureResolutions') and args.sha == FAILED_ROUTINE_SHA:
            die('resolved failed source may not acquire another routine cycle')
        # A replay belongs to its original cycle, never whichever hour is next.
        own = [c for c in cycles.values() if c['runId'] == run_id]
        if len(own) > 1:
            die('run owns more than one routine cycle')
        if own:
            c = own[0]
            if c['sha'] != args.sha or c['controlSha'] != args.control_sha:
                die('routine cycle replay changed immutable identity')
            if c['status'] in ('committed', 'sealed'):
                print(json.dumps(c, sort_keys=True)); return
            if c.get('failure') is not None:
                die('original routine failure retains unresolved cleanup/custody ownership')
            p = current_cycle_policy(args.repo, args.sha, args.control_sha)
            if c['policyDigest'] != p['digest']:
                die('routine cycle replay changed immutable identity')
            if c['status'] not in ('sealed',) and now*1000 >= (routine_window(c) or {'endsAt':(c['startsAt']+360)*1000})['endsAt']:
                die('original routine cycle expired unresolved; no later cycle is authorized')
            audit_once('routine_cycle_reserved', state, f'routine_cycle:{c["startsAt"]}', cycle=c)
            print(json.dumps(c, sort_keys=True)); return
        if state.get('pending') or state.get('finalization') or any(routine_owner_unresolved(state, c) for c in cycles.values()):
            die('prior pending or unknown routine owner remains authoritative')
        p = current_cycle_policy(args.repo, args.sha, args.control_sha)
        kind = 'hourly-reset'
        if p['phase1Status'] != 'active':
            # Completion is a single changed-image restoration, not permission
            # to restart an already-daily image on every future scheduled tick.
            desired_sha = state['desired']['sha']
            path = run(['git','-C',args.repo,'ls-tree','--name-only',desired_sha,'--',SCHEDULE_POLICY_PATH])
            if (not path or desired_sha == args.sha or schedule_policy(args.repo, desired_sha)['phase1Status'] != 'active'):
                print(json.dumps({'status':'daily'})); return
            kind = 'daily-restoration'
        starts = (now // 3600 + 1) * 3600
        key = str(starts)
        if key in cycles:
            print(json.dumps(cycles[key], sort_keys=True)); return
        c = {'kind': kind, 'policyId': p['policyId'], 'policyDigest': p['digest'], 'startsAt': starts, 'endsAt': starts+300,
             'runId': run_id, 'sha': valid_sha(args.sha), 'controlSha': valid_sha(args.control_sha), 'status': 'reserved'}
        cycles[key] = c
        state['routineMaintenanceCycles'] = cycles
        state['updatedAt'] = now
        write_state(state)
        audit_once('routine_cycle_reserved', state, f'routine_cycle:{starts}', cycle=c)
        print(json.dumps(c, sort_keys=True))


def own_routine_cycle(state: dict[str, Any], run_id: str) -> dict[str, Any] | None:
    return next((c for c in routine_cycles(state).values() if c['runId'] == run_id), None)


def finish_routine_failure(state: dict[str, Any], run_id: str, result: dict[str, Any]) -> None:
    c = own_routine_cycle(state, run_id)
    if c is not None:
        if c['status'] != 'reserved' or c['sha'] != result['sha'] or c['controlSha'] != result['controlSha']:
            die('failure does not match the routine cycle owner')
        if state.get('routineFailureResolutions', {}).get(run_id) is not None and c.get('failure') != result:
            die('resolved routine failure history cannot be replaced')
        # Desired restoration is not proof of native cleanup/custody. Preserve
        # this global owner even after the provider has a terminal failure.
        c['failure'] = result
        write_state(state)


def cmd_prepare(args: argparse.Namespace) -> None:
    meta = metadata(args)
    target_sha = valid_sha(args.sha)
    image_id, image_sha, _ = image_identity(args.image, require_label=True)
    if image_sha != target_sha:
        die(f"image revision {image_sha} does not equal requested commit {target_sha}")

    with SealLock():
        state = load_state()
        if state.get('routineFailureResolutions') and target_sha == FAILED_ROUTINE_SHA:
            die('resolved failed source cannot be prepared by a later run')
        if meta["runId"] in state.get("orphanFinalizationResolutions", {}):
            die("retired orphan owner cannot prepare another cutover")
        if result_path(meta["runId"]).exists():
            die("this audited run already has an immutable terminal result")
        finalization = state.get("finalization")
        if isinstance(finalization, dict):
            die(
                "committed run "
                f"{finalization['runId']} owns durable result finalization"
            )
        git_has_commit(args.repo, target_sha)
        git_has_commit(args.repo, state["highWaterSha"])
        git_is_ancestor(
            args.repo,
            target_sha,
            "origin/main",
            "requested commit is not contained in fetched origin/main",
        )
        if args.mode == "deploy":
            git_is_ancestor(
                args.repo,
                state["highWaterSha"],
                target_sha,
                "normal deploy would move behind or diverge from the sealed high-water commit",
            )
        else:
            git_is_ancestor(
                args.repo,
                target_sha,
                state["highWaterSha"],
                "rollback target is not an ancestor of the sealed high-water commit",
            )
            if target_sha == state["desired"]["sha"]:
                die("rollback target already is the desired release")
            if len(meta["reason"]) < 12:
                die("rollback reason must describe the emergency in at least 12 characters")

        cycle = own_routine_cycle(state, meta['runId'])
        if cycle is not None:
            current_cycle_policy(args.repo, target_sha, cycle['controlSha'])
            window = routine_window(cycle, verified=True)
            if cycle['status'] != 'reserved' or cycle['sha'] != target_sha or not window['startsAt'] <= int(time.time()*1000) < window['endsAt']:
                die('routine reset does not own the current top-of-hour cycle')
        existing = state.get("pending")
        if pending_is_active(existing) and str(existing.get("runId")) != meta["runId"]:
            die(f"another audited cutover is still active (run {existing.get('runId')})")

        token = secrets.token_hex(32)
        state["pending"] = {
            "sha": target_sha,
            "imageId": image_id,
            "mode": args.mode,
            "tokenHash": hashlib.sha256(token.encode()).hexdigest(),
            "expiresAt": int(time.time()) + PENDING_TTL_SECONDS,
            "used": False,
            **meta,
        }
        state["updatedAt"] = int(time.time())
        state["updatedBy"] = meta
        write_state(state)
        audit("prepare", state, target={"sha": target_sha, "imageId": image_id}, mode=args.mode, **meta)
        print(token)


def cmd_authorize(args: argparse.Namespace) -> None:
    image_id, image_sha, _ = image_identity(args.image, require_label=False)
    supplied_token = ""
    if args.token_stdin:
        supplied_token = sys.stdin.read(129).strip()
        if len(supplied_token) > 128:
            die("cutover authorization token input is too long")
    with SealLock():
        state = load_state()
        desired = state["desired"]
        if image_id == desired["imageId"] and image_sha == desired["sha"] and not args.token_stdin:
            audit("desired_start_authorized", state, target=desired)
            # Return the immutable pair. The caller must docker-run imageId,
            # never the mutable tag/reference it asked us to authorize.
            print(f'desired {desired["sha"]} {desired["imageId"]}')
            return

        pending = state.get("pending")
        if not pending_is_active(pending):
            die("requested image is not the sealed desired release and no live cutover authorization exists")
        cycle = own_routine_cycle(state, str(pending.get('runId')))
        if cycle is not None:
            window = routine_window(cycle, verified=True)
            if cycle['status'] != 'reserved' or cycle.get('failure') is not None or not window['startsAt'] <= int(time.time()*1000) < window['endsAt']:
                die('routine token does not own the current top-of-hour cycle')
        if pending.get("used") is True:
            die("the prepared cutover authorization was already consumed")
        if image_id != pending.get("imageId") or image_sha != pending.get("sha"):
            die("requested image does not match the prepared immutable SHA/image-id pair")
        supplied_hash = hashlib.sha256(supplied_token.encode()).hexdigest()
        if not secrets.compare_digest(supplied_hash, str(pending.get("tokenHash"))):
            die("cutover authorization token is missing or invalid")
        pending["used"] = True
        state["updatedAt"] = int(time.time())
        write_state(state)
        audit(
            "candidate_start_authorized",
            state,
            target={"sha": pending["sha"], "imageId": pending["imageId"]},
            mode=pending["mode"],
            runId=pending["runId"],
            runUrl=pending["runUrl"],
            actor=pending["actor"],
        )
        print(f'pending {pending["sha"]} {pending["imageId"]}')


def cmd_classify(args: argparse.Namespace) -> None:
    try:
        status, image_id = container_identity(args.container)
    except SystemExit:
        print("absent")
        return
    with SealLock():
        state = load_state()
        if image_id == state["desired"]["imageId"]:
            suffix = f' {state["desired"]["sha"]}' if args.with_sha else ""
            print(f"desired{suffix}")
            return
        pending = state.get("pending")
        if (
            status == "running"
            and pending_is_active(pending)
            and pending.get("used") is True
            and image_id == pending.get("imageId")
        ):
            suffix = f' {pending["sha"]}' if args.with_sha else ""
            print(f"pending{suffix}")
            return
        print("drift")


def cmd_get(args: argparse.Namespace) -> None:
    with SealLock():
        state = load_state()
        fields = {
            "desired-sha": state["desired"]["sha"],
            "desired-image-id": state["desired"]["imageId"],
            "high-water-sha": state["highWaterSha"],
            "desired-legacy-unlabelled": (
                "true" if state["desired"]["legacyUnlabelled"] else "false"
            ),
        }
        print(fields[args.field])


# One off-cycle "Deployment Recovery" window per rolling hour, across every
# release and every control generation (2026-09-26). Every reservation ever
# made is already a durable file in STATE_DIR carrying its announcedAt, so the
# rolling hour is read from those under the seal lock - no new state, nothing
# per process. On 2026-09-25/26 a busy hour held 4-5 breaks and 29-36 parked
# minutes because each queued release reserved its own window.
RECOVERY_WINDOW_MIN_INTERVAL_MS = 3600 * 1000
RECOVERY_WINDOW_PREFIX = "engine-recovery-window-"
RECOVERY_CAUSE_RE = re.compile(r"^(urgent|engine-degraded)$")


def recovery_window_eligibility(run_id: str, now_ms: int) -> tuple[str, int]:
    """Name the first blocker and the time every blocking reservation expires.

    An unreadable reservation still counts, dated by its file: it can only
    make a release wait for the scheduled break, never add a pause.
    """
    blocker = ""
    eligible_at = 0
    for path in sorted(STATE_DIR.glob(RECOVERY_WINDOW_PREFIX + "*.json")):
        other = path.name[len(RECOVERY_WINDOW_PREFIX):-len(".json")]
        if other == run_id:
            continue
        try:
            announced = json.loads(path.read_text(encoding="utf-8")).get("announcedAt")
        except (OSError, ValueError, AttributeError):
            announced = None
        if type(announced) is not int or announced <= 0:
            try:
                announced = int(path.stat().st_mtime * 1000)
            except OSError:
                continue
        if announced > now_ms - RECOVERY_WINDOW_MIN_INTERVAL_MS:
            if not blocker:
                blocker = other
            eligible_at = max(eligible_at, announced + RECOVERY_WINDOW_MIN_INTERVAL_MS)
    return blocker, eligible_at


def recent_recovery_window(run_id: str, now_ms: int) -> str:
    """Keep the existing reservation reader's named-blocker contract."""
    return recovery_window_eligibility(run_id, now_ms)[0]


def cmd_reserve_recovery_window(args: argparse.Namespace) -> None:
    """Reserve one fixed announcement for this existing release transaction.

    This adds no publisher, scheduler or v1 wire field. A reservation needs a
    NAMED emergency cause (engine-degraded, urgent or deadline) and a free
    rolling hour; with a cause but no free hour the answer is `rate-limited`,
    and with no such cause it is `unavailable`. Either way the release waits
    for the scheduled break. A failed or missed release is not a cause.
    """
    target = valid_sha(args.sha)
    run_id = str(args.run_id)
    if not RUN_ID_RE.fullmatch(run_id):
        die("recovery window run id is invalid")
    if args.cause is not None and not RECOVERY_CAUSE_RE.fullmatch(args.cause):
        die("recovery window cause is invalid")
    with SealLock():
        state = load_state()
        git_is_ancestor(args.repo, target, "origin/main", "recovery target is not protected main")
        git_is_ancestor(args.repo, state["highWaterSha"], target, "recovery target is superseded")
        if state.get("pending") or state["desired"]["sha"] == target:
            print("unavailable")
            return
        path = STATE_DIR / f"engine-recovery-window-{run_id}.json"
        if path.exists():
            value = json.loads(path.read_text(encoding="utf-8"))
            if (value.get("sha") != target or value.get("runId") != run_id
                    or type(value.get("announcedAt")) is not int or value["announcedAt"] <= 0):
                die("recovery window identity is corrupt or belongs to another target")
            # A reservation written before the emergency-only rule (a routine
            # cause, or none) is not honoured on a rerun: it would bring back
            # the off-cycle break that rule removed.
            if not RECOVERY_CAUSE_RE.fullmatch(str(value.get("cause") or "")):
                print("unavailable")
                return
            if getattr(args, 'scheduled_cycle_start', None) is not None:
                # The first HTTP outcome may be unknown. Observe that original
                # announcement; never resend an old timestamp as a new notice.
                print('unavailable')
            else:
                print(value["announcedAt"])
            return

        # ONE SCHEDULED BREAK AN HOUR; A SECOND ONE ONLY FOR AN EMERGENCY
        # (owner, 2026-10-04). "THERE ARE CURRENTLY TWO SCHEDULED MAINTENANCE
        # BREAKS, ONE AT THE :55 AND THE NEXT ONE STARTS AT THE :11 FIGURE OUT
        # WHAT THE 2ND ONE IS FOR, AND REMOVE IT IF ITS NOT NECESSARY."
        #
        # The second one was this reservation. Until that day two ROUTINE
        # causes earned it: a failed release that had not shipped
        # (`failed-release:<run>`), and a release that watched a scheduled
        # break admit nobody (`observed-missed-certificate`). Either parked
        # every table for seven more minutes so that a fix could ship up to an
        # hour sooner - the 14:11Z break on 2026-10-03 followed release run
        # 37128652461 failing at 14:09Z. Nothing about those two is urgent: the
        # same release is admitted by the next :55 break, which the engine
        # takes anyway. They no longer qualify, and such a release waits.
        #
        # What still qualifies is what cannot wait for :55, each named by the
        # release transaction: `engine-degraded` (the serving engine is dead,
        # stalled or wedged), `urgent` (the commit carries the urgent trailer)
        # and `deadline` (no scheduled break can admit this release before its
        # certificate expires). `--missed-window` is still accepted so an older
        # transaction's call is not an error; it is no longer a cause.
        cause = args.cause or ""
        if not cause:
            print("unavailable")
            return
        now_ms = int(time.time() * 1000)
        scheduled_cycle = getattr(args, 'scheduled_cycle_start', None)
        if scheduled_cycle is not None:
            p = current_cycle_policy(args.repo, target, args.control_sha)
            cycle = own_routine_cycle(state, run_id)
            if (cycle is None or cycle['status'] != 'reserved' or cycle['policyDigest'] != p['digest']
                    or cycle['startsAt'] != scheduled_cycle or args.cause != 'urgent' or p['phase1Status'] != 'active'
                    or not scheduled_cycle*1000-120000 <= now_ms < scheduled_cycle*1000-60000):
                die('initial hourly announcement does not own the fixed58 source cycle')
        blocker, eligible_at = recovery_window_eligibility(run_id, now_ms)
        if blocker:
            if getattr(args, "include_eligibility", False):
                print(f"rate-limited:{eligible_at}")
            else:
                print("rate-limited")
            return
        announced_at = now_ms
        if scheduled_cycle is not None:
            old = routine_window(cycle)
            if old is not None:
                print('unavailable'); return
            if old is None:
                cycle['window']={'announcedAt':now_ms,'startsAt':now_ms+120000,'endsAt':now_ms+420000,'verified':False}
                routine_window(cycle)
                write_state(state)
            announced_at=cycle['window']['announcedAt']
        value = {"runId": run_id, "sha": target, "announcedAt": announced_at, "cause": cause}
        write_json_atomic(path, value)
        audit_once("recovery_window_reserved", state, f"recovery_window:{run_id}", window=value)
        print(value["announcedAt"])


def database_container_identity() -> dict[str, Any]:
    # Select immutable fields only; never inspect runtime environment secrets.
    template = '{"imageId":{{json .Image}},"sha":{{json (index .Config.Labels "sp.release.sha")}},"running":{{json .State.Running}}}'
    return json.loads(run(["docker", "container", "inspect", "--format", template, "club-arena-engine"]))


# One fixed owner-authorized operation, not generic multi-file admission.
ATTENTION14_DATABASE_PAIR_ID = "2026-11-01-attention14-two-sql-database-operation"
ATTENTION14_DATABASE_PAIR_ANCHOR = "4e9c32285477176df8e4afcef4e743d5fe961047"
ATTENTION14_DATABASE_PAIR_BOUNDS = ("2026-11-01T23:25:00Z", "2026-11-02T02:25:00Z")
ATTENTION14_DATABASE_PAIR = (
    ("20261101004247_started_tournament_abort_supports_equal_share_settlement.sql",
     "d42ad78995ffb0c626636e10c41b9b350119995e20c7ef71c4578ac99bfca1aa"),
    ("20261101005048_operator_closure_records_a_stopped_unsettled_hand_dispositio.sql",
     "3a292905ddf7daffc696f5cb836255a220060ba0631a126872ad30ecb7908a29"),
)


def reserve_database_window(request: dict[str, Any], repo: str) -> dict[str, Any]:
    """One reviewed DB operation, sharing the release seal's rolling-hour ledger.

    The caller holds the engine mutation lock for the complete operation. This
    never changes desired/highWater/pending or grants an image activation token.
    """
    required = {"runId", "controlSha", "servingSha", "windowId"}
    if set(request) != required or not RUN_ID_RE.fullmatch(str(request.get("runId", ""))):
        die("invalid database maintenance identity")
    control = valid_sha(request["controlSha"])
    serving = valid_sha(request["servingSha"])
    with SealLock():
        state = load_state()
        if state.get("pending") or state.get("finalization"):
            die("engine transaction still owns mutation")
        if state["desired"]["sha"] != serving:
            die("database operation does not name the sealed serving engine")
        git_is_ancestor(repo, control, "origin/main", "database control is not protected main")
        git_is_ancestor(repo, serving, control, "database control predates the serving engine")
        git_is_ancestor(repo, state["highWaterSha"], control, "database control predates the high-water release")
        container = database_container_identity()
        if container.get("running") is not True or container.get("sha") != serving or container.get("imageId") != state["desired"]["imageId"]:
            die("database operation container differs from the sealed immutable image")
        doc = json.loads(run(["git", "-C", repo, "show", control + ":server/release/owner-maintenance-windows.json"]))
        matches = [w for w in doc.get("databaseWindows", []) if w.get("id") == request["windowId"]]
        if doc.get("version") != 1 or len(matches) != 1:
            die("database window must be uniquely reviewed")
        window = matches[0]
        from datetime import datetime
        try:
            start = int(datetime.fromisoformat(window["notBefore"].replace("Z", "+00:00")).timestamp() * 1000)
            end = int(datetime.fromisoformat(window["notAfter"].replace("Z", "+00:00")).timestamp() * 1000)
        except (ValueError, KeyError, TypeError):
            die("database window bounds unreadable")
        now_ms = int(time.time() * 1000)
        if not (0 < end - start <= 6 * 3600000 and start <= now_ms and now_ms + 420000 <= end):
            die("database window cannot contain full notice and maintenance")
        if not isinstance(window.get("ownerOrder"), str) or len(window["ownerOrder"].strip()) < 10:
            die("database window has no owner order")
        git_is_ancestor(repo, valid_sha(window.get("contains", "")), control, "database window anchor is absent")
        files = window.get("migrations")
        if window["id"] == ATTENTION14_DATABASE_PAIR_ID:
            if (window.get("contains") != ATTENTION14_DATABASE_PAIR_ANCHOR
                    or (window.get("notBefore"), window.get("notAfter")) != ATTENTION14_DATABASE_PAIR_BOUNDS
                    or files != [f for f, _ in ATTENTION14_DATABASE_PAIR]):
                die("database pair differs from its exact reviewed authority")
            migrations = []
            for file, expected_hash in ATTENTION14_DATABASE_PAIR:
                sql_bytes = subprocess.run(["git", "-C", repo, "show", control + ":supabase/migrations/" + file],
                                           check=True, capture_output=True, timeout=30).stdout
                actual_hash = hashlib.sha256(sql_bytes).hexdigest()
                if (actual_hash != expected_hash
                        or "-- @install-window: daily-maintenance" not in sql_bytes.decode().splitlines()):
                    die("database pair SQL differs from its exact qualified bytes")
                migrations.append({"migration": file, "migrationSHA256": actual_hash})
            binding = {**request, "type": "database-maintenance-pair/v1",
                       "imageId": state["desired"]["imageId"], "migrations": migrations}
        else:
            if not isinstance(files, list) or len(files) != 1 or not re.fullmatch(r"[0-9]{14}_[a-z0-9_]+\.sql", files[0]):
                die("database operation must name exactly one migration")
            sql_bytes = subprocess.run(["git", "-C", repo, "show", control + ":supabase/migrations/" + files[0]],
                                       check=True, capture_output=True, timeout=30).stdout
            sql = sql_bytes.decode()
            if "-- @install-window: daily-maintenance" not in sql.splitlines():
                die("database operation migration is not a maintenance file")
            binding = {**request, "type": "database-maintenance/v1", "imageId": state["desired"]["imageId"], "migration": files[0],
                       "migrationSHA256": hashlib.sha256(sql_bytes).hexdigest()}
        path = STATE_DIR / (RECOVERY_WINDOW_PREFIX + request["runId"] + ".json")
        if path.exists():
            receipt = json.loads(path.read_text())
            if any(receipt.get(k) != v for k, v in binding.items()):
                die("database operation replay changed its identity")
            if now_ms >= receipt["endsAt"]:
                die("database operation expired; read its original receipt")
            return receipt
        if recent_recovery_window(request["runId"], now_ms):
            die("database window rolling hour is already owned")
        receipt = {**binding, "announcedAt": now_ms, "endsAt": now_ms + 420000}
        write_json_atomic(path, receipt)
        audit_once("database_window_reserved", state, "database_window:" + request["runId"], window=receipt)
        return receipt


def cmd_pending_owner(_args: argparse.Namespace) -> None:
    """Describe only pending ownership/lifecycle, never its authorization hash."""
    with SealLock():
        state = load_state()
        pending = state.get("pending")
        if not isinstance(pending, dict):
            print("none")
            return
        lifecycle = "active" if pending_is_active(pending) else "expired"
        used = "true" if pending.get("used") is True else "false"
        print(f'{lifecycle} {pending["runId"]} {used} {pending["expiresAt"]}')


def result_path(run_id: str) -> Path:
    if not RUN_ID_RE.fullmatch(run_id):
        die("result run id is invalid")
    return RESULT_DIR / f"{run_id}.json"


def load_result(run_id: str) -> dict[str, Any]:
    path = result_path(run_id)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die(f"durable release result is missing for run {run_id}")
    except (OSError, json.JSONDecodeError) as exc:
        die(f"durable release result is unreadable: {exc}")
    if not isinstance(value, dict) or value.get("schema") != 1:
        die("durable release result schema is invalid")
    value["runId"] = str(value.get("runId", ""))
    if value["runId"] != run_id:
        die("durable release result belongs to another run")
    if value.get("result") not in {"sealed", "already-released"}:
        die("durable release result outcome is invalid")
    value["sha"] = valid_sha(str(value.get("sha", "")), "result.sha")
    value["imageId"] = valid_image_id(str(value.get("imageId", "")), "result.imageId")
    if not INSTANCE_ID_RE.fullmatch(str(value.get("instanceId", ""))):
        die("durable release result instance id is invalid")
    if not CONTAINER_ID_RE.fullmatch(str(value.get("containerId", ""))):
        die("durable release result container id is invalid")
    started_at = str(value.get("startedAt", ""))
    if not started_at or len(started_at) > 80 or any(ord(char) < 32 for char in started_at):
        die("durable release result start generation is invalid")
    value["controlSha"] = valid_sha(str(value.get("controlSha", "")), "result.controlSha")
    invocation_ids = value.get("invocationIds")
    if (
        not isinstance(invocation_ids, list)
        or not invocation_ids
        or any(not INVOCATION_ID_RE.fullmatch(str(item)) for item in invocation_ids)
        or len(set(invocation_ids)) != len(invocation_ids)
    ):
        die("durable release result invocation history is invalid")
    if not isinstance(value.get("completedAt"), int) or int(value["completedAt"]) < 1:
        die("durable release result completion time is invalid")
    completion = value.get("completionRuntime")
    if not isinstance(completion, dict):
        die("durable release result completion generation is missing")
    if not INSTANCE_ID_RE.fullmatch(str(completion.get("instanceId", ""))):
        die("durable release result original instance id is invalid")
    if not CONTAINER_ID_RE.fullmatch(str(completion.get("containerId", ""))):
        die("durable release result original container id is invalid")
    if not INVOCATION_ID_RE.fullmatch(str(completion.get("invocationId", ""))):
        die("durable release result original invocation id is invalid")
    original_started = str(completion.get("startedAt", ""))
    if not original_started or len(original_started) > 80 or any(
        ord(char) < 32 for char in original_started
    ):
        die("durable release result original start generation is invalid")
    return value


def load_failure(run_id: str) -> dict[str, Any]:
    path = result_path(run_id)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die(f"durable release failure is missing for run {run_id}")
    except (OSError, json.JSONDecodeError) as exc:
        die(f"durable release failure is unreadable: {exc}")
    if not isinstance(value, dict) or value.get("schema") != 1:
        die("durable release failure schema is invalid")
    if str(value.get("runId", "")) != run_id:
        die("durable release failure belongs to another run")
    value["runId"] = run_id
    value["sha"] = valid_sha(str(value.get("sha", "")), "failure.sha")
    value["controlSha"] = valid_sha(
        str(value.get("controlSha", "")), "failure.controlSha"
    )
    if value.get("result") != "failed":
        die("durable release failure outcome is invalid")
    if not INVOCATION_ID_RE.fullmatch(str(value.get("invocationId", ""))):
        die("durable release failure invocation id is invalid")
    exit_status = value.get("transactionExitStatus")
    if (
        not isinstance(exit_status, int)
        or isinstance(exit_status, bool)
        or exit_status < 1
        or exit_status > 255
        or exit_status == 75
    ):
        die("durable release failure exit status is invalid")
    value["recoveredDesiredSha"] = valid_sha(
        str(value.get("recoveredDesiredSha", "")), "failure.recoveredDesiredSha"
    )
    value["recoveredDesiredImageId"] = valid_image_id(
        str(value.get("recoveredDesiredImageId", "")),
        "failure.recoveredDesiredImageId",
    )
    if not isinstance(value.get("completedAt"), int) or int(value["completedAt"]) < 1:
        die("durable release failure completion time is invalid")
    return value


def cmd_record_failure(args: argparse.Namespace) -> None:
    run_id = str(args.run_id)
    if not RUN_ID_RE.fullmatch(run_id):
        die("failure run id is invalid")
    target_sha = valid_sha(args.sha, "failure.sha")
    control_sha = valid_sha(args.control_sha, "failure.controlSha")
    invocation_id = str(args.invocation_id)
    if not INVOCATION_ID_RE.fullmatch(invocation_id):
        die("failure systemd invocation id is invalid")
    try:
        exit_status = int(str(args.exit_status), 10)
    except ValueError:
        die("failure transaction exit status is invalid")
    if exit_status < 1 or exit_status > 255 or exit_status == 75:
        die("failure transaction exit status is not permanent")

    with SealLock():
        state = load_state()
        committed = state.get("committedRuns", {}).get(run_id)
        if isinstance(committed, dict):
            die("a committed release attempt cannot be recorded as failed")

        # The wrapper invokes this only after recovery returns successfully.
        # Re-prove the strongest identity available at this boundary so the
        # tombstone cannot be written while an unsealed candidate is serving.
        desired = state["desired"]
        status, running_image_id = container_identity(args.container)
        if status != "running" or running_image_id != desired["imageId"]:
            die("failure recovery does not run the sealed desired image")
        inspected_image_id, recovered_sha, _ = image_identity(
            running_image_id, require_label=False
        )
        if inspected_image_id != running_image_id or recovered_sha != desired["sha"]:
            die("failure recovery image identity disagrees with the seal")

        path = result_path(run_id)
        expected = {
            "sha": target_sha,
            "controlSha": control_sha,
            "invocationId": invocation_id,
            "transactionExitStatus": exit_status,
            "recoveredDesiredSha": desired["sha"],
            "recoveredDesiredImageId": desired["imageId"],
        }
        if path.exists():
            value = load_failure(run_id)
            if any(value[key] != expected[key] for key in expected):
                die("an existing failure binds this run to different attempt bytes")
            finish_routine_failure(state, run_id, value)
            audit_once(
                "failure_recorded",
                state,
                f"failure_recorded:{run_id}",
                failure=value,
            )
            print("failed")
            return

        value = {
            "schema": 1,
            "runId": run_id,
            "result": "failed",
            **expected,
            "completedAt": int(time.time()),
        }
        write_json_atomic(path, value)
        finish_routine_failure(state, run_id, value)
        audit_once(
            "failure_recorded",
            state,
            f"failure_recorded:{run_id}",
            failure=value,
        )
        print("failed")


def cmd_attest_failure(args: argparse.Namespace) -> None:
    run_id = str(args.run_id)
    target_sha = valid_sha(args.sha, "failure.sha")
    control_sha = str(args.control_sha or "")
    invocation_id = str(args.invocation_id or "")
    if control_sha:
        control_sha = valid_sha(control_sha, "failure.controlSha")
    if invocation_id and not INVOCATION_ID_RE.fullmatch(invocation_id):
        die("failure systemd invocation id is invalid")
    with SealLock():
        state = load_state()
        value = load_failure(run_id)
        if value["sha"] != target_sha:
            die("durable failure does not attest this exact SHA")
        if control_sha and value["controlSha"] != control_sha:
            die("durable failure does not attest this exact control generation")
        if invocation_id and value["invocationId"] != invocation_id:
            die("durable failure does not attest this exact invocation")
        finish_routine_failure(state, run_id, value)
        # Attestation is also the reboot/uncertain-response convergence edge.
        # A crash can occur after the immutable failure file is fsynced but
        # before its audit append. Repair that exact event idempotently before
        # allowing a wrapper or observer to treat the tombstone as terminal.
        audit_once(
            "failure_recorded",
            state,
            f"failure_recorded:{run_id}",
            failure=value,
        )
        print(
            " ".join(
                str(value[key])
                for key in (
                    "result",
                    "sha",
                    "controlSha",
                    "invocationId",
                    "transactionExitStatus",
                    "recoveredDesiredSha",
                    "recoveredDesiredImageId",
                )
            )
        )


def cmd_attest_terminal(args: argparse.Namespace) -> None:
    """Attest immutable terminal bytes without requiring they remain desired."""
    run_id = str(args.run_id)
    target_sha = valid_sha(args.sha, "terminal.sha")
    control_sha = valid_sha(args.control_sha, "terminal.controlSha")
    with SealLock():
        path = result_path(run_id)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            die(f"durable terminal result is missing for run {run_id}")
        except (OSError, json.JSONDecodeError) as exc:
            die(f"durable terminal result is unreadable: {exc}")
        outcome = raw.get("result") if isinstance(raw, dict) else None
        if outcome == "failed":
            value = load_failure(run_id)
        elif outcome in {"sealed", "already-released"}:
            value = load_result(run_id)
        else:
            die("durable terminal result outcome is invalid")
        if value["sha"] != target_sha or value["controlSha"] != control_sha:
            die("durable terminal result does not match the exact release request")
        if outcome == "failed":
            # Terminal cleanup is the last authority that can delete the
            # durable request. It must repair a failure audit lost in the
            # result-fsync/audit-append crash window before permitting that
            # deletion, even when no separate attest-failure call ran first.
            state = load_state()
            audit_once(
                "failure_recorded",
                state,
                f"failure_recorded:{run_id}",
                failure=value,
            )
        print(str(value["result"]))


def native_unit(unit: str) -> dict[str, str]:
    properties = ("LoadState", "ActiveState", "SubState", "Job", "UnitFileState")
    if unit.endswith(".service"):
        properties += ("MainPID", "ControlPID", "InvocationID", "ControlGroup")
    raw = run(["systemctl", "show", unit, "--no-pager", "--all", "--property=" + ",".join(properties)])
    value = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
    if any(key not in value for key in properties):
        die("orphan finalization native unit state is incomplete")
    return value


def require_engine_lock(descriptor: int) -> None:
    """The inherited open description must already own the real mutation lock."""
    lock = Path(os.environ.get("ENGINE_LOCK_FILE", "/var/lock/club-arena-engine-up.lock"))
    try:
        if not os.path.samestat(os.fstat(descriptor), lock.stat()):
            die("orphan finalization descriptor is not the engine mutation lock")
        with lock.open("a+") as independent:
            try:
                fcntl.flock(independent, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                die("orphan finalization engine mutation lock is not already held")
        # A different holder would make this fail; the inherited open file
        # description of the owning transaction can reassert without unlocking.
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        die(f"orphan finalization engine lock cannot be proved: {exc}")


def durable_lines(path: Path) -> list[str]:
    try:
        info = path.lstat()
        if not path.is_file() or path.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
            die("orphan finalization operation record is not root-owned immutable input")
        return path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        die(f"orphan finalization operation record is unreadable: {exc}")


def require_absent(path: Path) -> None:
    try:
        path.lstat()
    except FileNotFoundError:
        return
    except OSError as exc:
        die(f"orphan finalization ownership evidence is unreadable: {exc}")
    die(f"original finalization owner retains operation evidence: {path}")


def prove_orphan_finalization(args: argparse.Namespace, state: dict[str, Any]) -> dict[str, Any]:
    """Recover only missing *completion*, never claim a foreign cutover as ours."""
    if args.result != "already-released" or state.get("pending") is not None:
        die("orphan finalization requires already-released state without pending work")
    require_engine_lock(args.recover_orphan_finalization_fd)
    original = state["finalization"]
    owner = original["runId"]
    if owner == args.run_id or args.run_id in state["committedRuns"]:
        die("orphan finalization cannot reassign cutover authorship")
    request_root = Path(os.environ.get("ENGINE_RELEASE_REQUEST_ROOT", str(STATE_DIR / "engine-release-requests")))
    pin_root = Path(os.environ.get("ENGINE_RELEASE_PIN_ROOT", str(STATE_DIR / "engine-release-generation-pins")))
    intake_root = Path(os.environ.get("ENGINE_RELEASE_INTAKE_ROOT", str(STATE_DIR / "engine-intake-requests")))
    lease_root = Path(os.environ.get("ENGINE_RELEASE_IMAGE_LEASE_ROOT", str(STATE_DIR / "engine-image-leases")))
    control = Path(__file__).resolve().parent
    request = durable_lines(request_root / f"{args.run_id}.request")
    if (len(request) != 6 or request[0] != args.sha
            or request[1] != f"https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/actions/runs/{args.run_id.split('-')[0]}"
            or not request[2] or request[3] != str(control) or request[4] != args.control_sha
            or not request[5].isdigit() or int(request[5]) <= int(time.time())):
        die("orphan finalization current immutable request does not match")
    if durable_lines(request_root / f"{args.run_id}.intent") != request:
        die("orphan finalization current intent differs from its request")
    if durable_lines(pin_root / f"{args.run_id}.generation") != [str(control), args.control_sha]:
        die("orphan finalization current generation pin does not match")
    if durable_lines(control / "control-sha") != [args.control_sha]:
        die("orphan finalization executing control generation does not match")
    current = native_unit(f"club-arena-engine-release-v1@{args.run_id}.service")
    if (current["LoadState"] != "loaded" or current["ActiveState"] != "activating"
            or current["SubState"] != "start" or not current["MainPID"].isdigit()
            or int(current["MainPID"]) <= 0 or current["InvocationID"] != args.invocation_id
            or os.environ.get("INVOCATION_ID") != args.invocation_id):
        die("orphan finalization current native invocation does not match")
    try:
        groups = [line.split(":", 2)[2] for line in Path("/proc/self/cgroup").read_text().splitlines()]
    except (OSError, IndexError) as exc:
        die(f"orphan finalization process cgroup is unreadable: {exc}")
    if not current["ControlGroup"] or current["ControlGroup"] not in groups:
        die("orphan finalization caller is outside its native release invocation")

    # This narrow recovery is for an owner which never had a resumable native
    # operation. Retained or unreadable evidence is not proof of abandonment.
    def absent_owner() -> dict[str, Any]:
        for root, suffixes in ((request_root, ("request", "intent", "break-deadline")),
                               (intake_root, ("request", "intent")),
                               (pin_root, ("generation",)), (lease_root, ("lease",))):
            for suffix in suffixes:
                require_absent(root / f"{owner}.{suffix}")
        require_absent(result_path(owner))
        units = {}
        for prefix, extension in (("release", "service"), ("intake", "service"), ("intake", "path")):
            unit = f"club-arena-engine-{prefix}-v1@{owner}.{extension}"
            value = native_unit(unit)
            if (value["LoadState"] not in {"loaded", "not-found"}
                    or value["ActiveState"] not in {"inactive", "failed"}
                    or value["SubState"] not in {"dead", "failed"}
                    or (extension == "service" and (value["MainPID"] != "0" or value["ControlPID"] != "0"))
                    or value["Job"] not in {"", "0"}
                    or value["UnitFileState"] not in {"", "disabled", "static"}):
                die("original finalization owner is active, queued, enabled or unknown")
            require_absent(Path("/etc/systemd/system/multi-user.target.wants") / unit)
            units[unit] = value
        return units

    owner_units = absent_owner()
    container_name = os.environ.get("CONTAINER", "club-arena-engine")
    def runtime() -> dict[str, Any]:
        value = docker_json("container", container_name)
        image = docker_json("image", args.image_id)
        require_alert_journal_mount(value, image)
        env = (image.get("Config") or {}).get("Env") or []
        sources = [v.split("=", 1)[1] for v in env if isinstance(v, str) and v.startswith("GIT_COMMIT_SHA=")]
        if (value.get("Id") != args.container_id or value.get("Image") != args.image_id
                or (value.get("State") or {}).get("Status") != "running"
                or (value.get("State") or {}).get("StartedAt") != args.started_at
                or ((value.get("Config") or {}).get("Labels") or {}).get("sp.release.sha") != args.sha
                or image.get("Id") != args.image_id
                or ((image.get("Config") or {}).get("Labels") or {}).get("org.opencontainers.image.revision") != args.sha
                or sources != [args.sha]):
            die("orphan finalization immutable running image or generation changed")
        for url in ("http://127.0.0.1:8080/health", os.environ.get("ENGINE_URL", "https://engine.smarter.poker").rstrip("/") + "/health"):
            try:
                health = json.loads(run(["curl", "--fail", "--silent", "--show-error", "--max-time", "5", url + f"?nocache={time.time_ns()}"]))
            except json.JSONDecodeError:
                die("orphan finalization health is unreadable")
            if (health.get("releaseSha") != args.sha or health.get("instanceId") != args.instance_id
                    or health.get("liveness") != "ok" or health.get("running") is not True):
                die("orphan finalization local/public runtime proof does not match")
        return {"containerId": args.container_id, "startedAt": args.started_at, "instanceId": args.instance_id}

    observed = runtime()
    proof = run([str(control / "engine-release-database-proof.py"), "--env-file",
                 os.environ.get("ENV_FILE", os.environ.get("REPO_DIR", "/opt/club-arena") + "/server/.env"),
                 "--sha", args.sha, "--instance-id", args.instance_id, "--timeout-seconds", "15",
                 "--poll-seconds", "3", "--max-heartbeat-age-seconds", "15"])
    if (runtime() != observed or absent_owner() != owner_units or load_state() != state
            or native_unit(f"club-arena-engine-release-v1@{args.run_id}.service") != current
            or durable_lines(request_root / f"{args.run_id}.request") != request
            or int(request[5]) <= int(time.time())):
        die("orphan finalization evidence changed before compare-and-swap")
    return {"schema": 1, "originalFinalization": original,
            "originalCommittedRun": state["committedRuns"][owner],
            "generation": state["generation"], "verifiedByRunId": args.run_id,
            "controlSha": args.control_sha, "invocationId": args.invocation_id,
            "runtime": observed, "databaseProof": proof, "originalOwnerUnits": owner_units,
            "observedAt": int(time.time()), "result": "already-released"}


def failed_routine_require(value: bool) -> None:
    if not value:
        die('exact failed routine custody is unproved; original owner retained')


def failed_routine_digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def failed_routine_bytes(path: Path, limit: int = 65536) -> bytes:
    """No symlink, writable-parent, device, unbounded or changing file input."""
    failed_routine_require(path.is_absolute())
    try:
        file_info = path.lstat()
        for parent in (path, *path.parents):
            info = parent.lstat()
            failed_routine_require(not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            failed_routine_require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and
                not before.st_mode & 0o022 and before.st_size <= limit and
                (file_info.st_dev, file_info.st_ino) == (before.st_dev, before.st_ino))
            with os.fdopen(fd, 'rb', closefd=False) as stream:
                raw = stream.read(limit + 1)
            after = os.fstat(fd)
            failed_routine_require(len(raw) <= limit and len(raw) == before.st_size and
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns))
            return raw
        finally:
            os.close(fd)
    except OSError:
        die('exact failed routine owned file is unreadable')


def failed_routine_json(path: Path) -> Any:
    def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value = {}
        for key, item in pairs:
            failed_routine_require(key not in value)
            value[key] = item
        return value
    try:
        return json.loads(failed_routine_bytes(path), object_pairs_hook=unique)
    except (ValueError, UnicodeError):
        die('exact failed routine owned JSON is invalid')


def failed_routine_cycle(cycle: dict[str, Any]) -> None:
    failed_routine_require(cycle.get('runId') == FAILED_ROUTINE_RUN and
        cycle.get('sha') == cycle.get('controlSha') == FAILED_ROUTINE_SHA and
        cycle.get('status') == 'reserved' and cycle.get('startsAt') == FAILED_ROUTINE_START and
        cycle.get('endsAt') == FAILED_ROUTINE_START + 300 and cycle.get('window') is None and
        cycle.get('policyId') == SCHEDULE_POLICY_ID and
        cycle.get('policyDigest') == '203626ce907eed185e27fac659cc391b16d6b5814fe446b4c0257207d2ba0578' and
        cycle.get('kind') == 'hourly-reset' and failed_routine_digest(cycle.get('failure')) == FAILED_ROUTINE_DIGEST)


def validate_failed_routine_resolution(resolution: dict[str, Any], cycle: dict[str, Any]) -> None:
    failed_routine_cycle(cycle)
    failed_routine_require(isinstance(resolution, dict) and set(resolution) == {
        'schema', 'result', 'originalCycle', 'failureDigest', 'verifiedByRunId', 'controlSha',
        'targetSha', 'invocationId', 'observedAt', 'proof'} and resolution['schema'] == 1 and
        resolution['result'] == 'failed-custody-resolved' and resolution['originalCycle'] == cycle and
        resolution['failureDigest'] == FAILED_ROUTINE_DIGEST and
        RUN_ID_RE.fullmatch(str(resolution['verifiedByRunId'])) is not None and
        resolution['verifiedByRunId'] != FAILED_ROUTINE_RUN and
        SHA_RE.fullmatch(str(resolution['controlSha'])) is not None and
        SHA_RE.fullmatch(str(resolution['targetSha'])) is not None and
        resolution['targetSha'] != FAILED_ROUTINE_SHA and
        INVOCATION_ID_RE.fullmatch(str(resolution['invocationId'])) is not None and
        type(resolution['observedAt']) is int and resolution['observedAt'] > FAILED_ROUTINE_COMPLETED and
        isinstance(resolution['proof'], dict) and resolution['proof'].get('noAnnouncement') is True and
        resolution['proof'].get('databaseIdle') is True)
    path = RESULT_DIR / (FAILED_ROUTINE_RUN + '.' + resolution['verifiedByRunId'] + '.' +
                         resolution['invocationId'] + '.custody-resolution.json')
    failed_routine_require(failed_routine_json(path) == resolution)


class FailedRoutineProcessLookup(Exception):
    """Bounded failed lookup, never an empty-process certificate."""
    def __init__(self, status: int, stdout: bytes, stderr: bytes):
        super().__init__('Native process lookup failed')
        self.status, self.stdout, self.stderr = status, stdout, stderr


def failed_routine_command(command: list[str], deadline: float, limit: int = 32768) -> str:
    deadline = min(deadline, time.monotonic() + 5)
    failed_routine_require(deadline > time.monotonic())
    child = None
    chunks = {False: bytearray(), True: bytearray()}
    try:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'LC_ALL': 'C', 'LANG': 'C'})
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ, False)
            selector.register(child.stderr, selectors.EVENT_READ, True)
            while selector.get_map():
                left = deadline - time.monotonic()
                failed_routine_require(left > 0)
                for key, _ in selector.select(min(left, 1)):
                    bound = 8192 if key.data else limit
                    part = os.read(key.fileobj.fileno(), min(4096, bound + 1 - len(chunks[key.data])))
                    if not part:
                        selector.unregister(key.fileobj)
                    else:
                        chunks[key.data].extend(part)
                        failed_routine_require(len(chunks[key.data]) <= bound)
        status = child.wait(timeout=max(.001, deadline - time.monotonic()))
        failed_routine_require(time.monotonic() < deadline)
        manager = ['busctl', '--system', '--timeout=1s', 'call', 'org.freedesktop.systemd1',
                   '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager']
        if status > 0 and len(command) == 10 and command[:7] == manager and command[7:9] in (
                ['GetUnit', 's'], ['GetUnitProcesses', 's']):
            raise FailedRoutineProcessLookup(status, bytes(chunks[False]), bytes(chunks[True]))
        failed_routine_require(status == 0)
        return bytes(chunks[False]).decode('utf8').strip()
    except (OSError, UnicodeError, subprocess.SubprocessError):
        die('exact failed routine native proof failed or timed out')
    finally:
        if child is not None:
            if child.poll() is None:
                child.kill()  # Only this owned proof reader, never the serving engine.
            child.wait(timeout=1)
            child.stdout.close()
            child.stderr.close()


def failed_routine_source_proof() -> dict[str, str]:
    parent = Path('/usr/local/lib/club-arena')
    generation = parent / 'engine-control-generations' / FAILED_ROUTINE_SHA
    originals = {name: failed_routine_bytes(generation / name, 512 * 1024) for name in FAILED_ROUTINE_SOURCES}
    failed_routine_require(all(hashlib.sha256(raw).hexdigest() == FAILED_ROUTINE_SOURCES[name]
                               for name, raw in originals.items()))
    failed_routine_require(failed_routine_bytes(parent / 'engine-release-unit-wrapper-v1.sh') ==
                           originals['engine-release-unit-wrapper.sh'])
    for source, marker, template in (
        ('install-engine-supervisor.sh', 'cat > "$UNIT_STAGE/club-arena-engine-release-v1@.service" <<UNIT\n', 'club-arena-engine-release-v1@.service'),
        ('install-engine-intake.sh', 'cat > "$UNIT_STAGE" <<\'UNIT\'\n', 'club-arena-engine-intake-v1@.service'),
        ('install-engine-intake.sh', 'cat > "$PATH_STAGE" <<\'UNIT\'\n', 'club-arena-engine-intake-v1@.path')):
        content = originals[source].decode().split(marker, 1)[1].split('\nUNIT\n', 1)[0] + '\n'
        if source == 'install-engine-supervisor.sh':
            content = content.replace('$UNIT_WRAPPER_V1', '/usr/local/lib/club-arena/engine-release-unit-wrapper-v1.sh').replace('\\$', '$')
        failed_routine_require(failed_routine_bytes(Path('/etc/systemd/system') / template) == content.encode())
    return dict(FAILED_ROUTINE_SOURCES)


def failed_routine_unit_snapshot(unit: str, deadline: float) -> dict[str, str]:
    # The production caller below selects only its three original fixed units.
    # A unique isolated systemd fixture uses this same read-only algorithm.
    failed_routine_require(re.fullmatch(r'[A-Za-z0-9-]+@[1-9][0-9]*(?:-[1-9][0-9]*)?\.(?:service|path)', unit) is not None and len(unit) <= 255)
    prefix, extension = unit.split('@', 1)[0], unit.rsplit('.', 1)[1]
    properties = ['LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'Job', 'FragmentPath', 'DropInPaths']
    if extension == 'service':
        properties += ['MainPID', 'ControlPID', 'ControlGroup', 'Slice']
    raw = failed_routine_command(['systemctl', 'show', unit, '--no-pager', '--all',
                                 '--property=' + ','.join(properties)], deadline)
    pairs = [line.split('=', 1) for line in raw.splitlines()]
    failed_routine_require(all(len(row) == 2 for row in pairs) and len(pairs) == len(properties))
    value = dict(pairs)
    failed_routine_require(set(value) == set(properties) and value['LoadState'] in {'loaded', 'not-found'} and
        value['ActiveState'] in {'inactive', 'failed'} and value['SubState'] in {'dead', 'failed'} and
        value['UnitFileState'] in {'', 'disabled', 'static'} and value['Job'] in {'', '0'} and
        value['DropInPaths'] == '' and value['FragmentPath'] == f'/etc/systemd/system/{prefix}@.{extension}')
    if extension == 'service':
        expected_slice = 'system-' + prefix.replace('-', r'\x2d') + '.slice'
        expected_group = '/system.slice/' + expected_slice + '/' + unit
        failed_routine_require(value['MainPID'] == value['ControlPID'] == '0' and
            value['Slice'] == expected_slice and value['ControlGroup'] in {'', expected_group})
    return value


def failed_routine_service_group(unit: str, before: dict[str, str], deadline: float) -> str:
    failed_routine_require(unit.endswith('.service') and re.fullmatch(r'[A-Za-z0-9-]+', unit.split('@', 1)[0]) is not None)
    # Default template Slice is independently obtained from the native unit;
    # no caller-supplied or guessed cgroup filesystem path is followed.
    expected_slice = 'system-' + unit.split('@', 1)[0].replace('-', r'\x2d') + '.slice'
    failed_routine_require(before['Slice'] == expected_slice)
    root = failed_routine_command(['systemctl', 'show', '--all', '-p', 'ControlGroup', '--', '-.slice'], deadline, 256)
    failed_routine_require(root == 'ControlGroup=/')
    group = '/system.slice/' + expected_slice + '/' + unit
    failed_routine_require(before['ControlGroup'] in {'', group})
    return group


def failed_routine_cgroup_empty(group: str, deadline: float) -> str:
    """Read actual cgroup-v2 evidence via no-follow directory descriptors."""
    failed_routine_require(group.startswith('/system.slice/') and len(group.split('/')) == 4 and
        all(part not in {'.', '..', ''} for part in group.split('/')[1:]))
    descriptors = []
    try:
        current = os.open('/sys/fs/cgroup', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptors.append(current)
        for part in group.split('/')[1:]:
            failed_routine_require(time.monotonic() < deadline)
            info = os.fstat(current)
            failed_routine_require(info.st_uid == 0 and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022)
            try:
                current = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            except FileNotFoundError as error:
                failed_routine_require(error.errno == errno.ENOENT)
                return 'absent'
            descriptors.append(current)
        info = os.fstat(current)
        failed_routine_require(info.st_uid == 0 and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022)
        fd = os.open('cgroup.events', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=current)
        descriptors.append(fd)
        info = os.fstat(fd)
        failed_routine_require(info.st_uid == 0 and stat.S_ISREG(info.st_mode))
        raw = os.read(fd, 1025)
        failed_routine_require(len(raw) <= 1024 and time.monotonic() < deadline)
        rows = [line.split() for line in raw.decode('ascii').splitlines()]
        failed_routine_require(all(len(row) == 2 and row[0] in {'populated', 'frozen'} and row[1] in {'0', '1'} for row in rows))
        value = dict(rows)
        failed_routine_require(len(value) == len(rows) and value.get('populated') == '0')
        return 'populated-zero'
    except (OSError, UnicodeError):
        die('exact failed routine cgroup evidence is unreadable; original owner retained')
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def failed_routine_manager_absent(unit: str, deadline: float) -> None:
    raw = failed_routine_command(['busctl', '--system', '--timeout=1s', 'call', 'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
        'ListUnitsByPatterns', 'asas', '0', '1', unit], deadline, 4096)
    failed_routine_require(raw.split() == ['a(ssssssouso)', '0'])


def failed_routine_service_empty(unit: str, before: dict[str, str], deadline: float) -> str:
    failed_routine_require(unit.endswith('.service') and before['MainPID'] == before['ControlPID'] == '0')
    try:
        resolved = shlex.split(failed_routine_command(['busctl', '--system', '--timeout=1s', 'call',
            'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
            'GetUnit', 's', unit], deadline, 4096))
        failed_routine_require(len(resolved) == 2 and resolved[0] == 'o' and
            re.fullmatch(r'/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+', resolved[1]) is not None)
        identity = ['busctl', '--system', '--timeout=1s', 'get-property', 'org.freedesktop.systemd1',
                    resolved[1], 'org.freedesktop.systemd1.Unit', 'Id']
        failed_routine_require(shlex.split(failed_routine_command(identity, deadline, 4096)) == ['s', unit])
        processes = failed_routine_command(['busctl', '--system', '--timeout=1s', 'call',
            'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
            'GetUnitProcesses', 's', unit], deadline, 4096)
        failed_routine_require(processes.split() == ['a(sus)', '0'])
        failed_routine_require(shlex.split(failed_routine_command(identity, deadline, 4096)) == ['s', unit])
        failed_routine_require(failed_routine_unit_snapshot(unit, deadline) == before)
        return 'loaded-manager-empty'
    except FailedRoutineProcessLookup as error:
        # A known NoSuchUnit diagnostic merely selects an independent proof.
        # Permission errors, failed parsing, bounded-read failures and every
        # other refusal remain unknown. The error itself never proves empty.
        failed_routine_require(error.status > 0 and error.stdout == b'' and
            error.stderr.strip() == ('Call failed: Unit ' + unit + ' not loaded.').encode('ascii'))
        group = failed_routine_service_group(unit, before, deadline)
        failed_routine_manager_absent(unit, deadline)
        failed_routine_cgroup_empty(group, deadline)
        failed_routine_manager_absent(unit, deadline)
        failed_routine_require(failed_routine_unit_snapshot(unit, deadline) == before)
        return 'unloaded-manager-cgroup-empty'


def failed_routine_native_proof(deadline: float) -> dict[str, Any]:
    units = {}
    for prefix, extension in (('release', 'service'), ('intake', 'service'), ('intake', 'path')):
        unit = f'club-arena-engine-{prefix}-v1@{FAILED_ROUTINE_RUN}.{extension}'
        value = failed_routine_unit_snapshot(unit, deadline)
        if extension == 'service':
            failed_routine_service_empty(unit, value, deadline)
        require_absent(Path('/etc/systemd/system/multi-user.target.wants') / unit)
        require_absent(Path('/etc/systemd/system/paths.target.wants') / unit)
        units[unit] = value
    roots = (
        (STATE_DIR / 'engine-release-requests', ('request', 'intent', 'activation-entry',
         'legacy-checkpoint-intent', 'main-inspector-retirement-intent', 'main-inspector-retirement-receipt',
         'lightning-hold.json', 'lightning-hold.json.released', 'break-deadline', 'awaiting-certificate')),
        (STATE_DIR / 'engine-intake-requests', ('request', 'intent')),
        (STATE_DIR / 'engine-release-generation-pins', ('generation',)),
        (STATE_DIR / 'engine-image-leases', ('lease',)))
    for root, suffixes in roots:
        for suffix in suffixes:
            require_absent(root / (FAILED_ROUTINE_RUN + '.' + suffix))
    require_absent(STATE_DIR / ('engine-recovery-window-' + FAILED_ROUTINE_RUN + '.json'))
    return units


def failed_routine_history(failure: dict[str, Any], deadline: float) -> dict[str, Any]:
    failed_routine_require(failed_routine_digest(failure) == FAILED_ROUTINE_DIGEST and
                           failure['completedAt'] == FAILED_ROUTINE_COMPLETED)
    unit = f'club-arena-engine-release-v1@{FAILED_ROUTINE_RUN}.service'
    raw = failed_routine_command(['journalctl', '--unit=' + unit,
        '_SYSTEMD_INVOCATION_ID=' + failure['invocationId'], '--no-pager', '--output=json',
        '--output-fields=MESSAGE,_SYSTEMD_UNIT,_SYSTEMD_INVOCATION_ID,__REALTIME_TIMESTAMP',
        '--lines=2', '--grep=^' + re.escape(FAILED_ROUTINE_LITERAL) + '$'], deadline, 8192)
    try:
        def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            value = {}
            for key, item in pairs:
                failed_routine_require(key not in value)
                value[key] = item
            return value
        rows = [json.loads(line, object_pairs_hook=unique) for line in raw.splitlines() if line.strip()]
        failed_routine_require(len(rows) == 1)
        row = rows[0]
        allowed = {'MESSAGE', '_SYSTEMD_UNIT', '_SYSTEMD_INVOCATION_ID', '__REALTIME_TIMESTAMP',
                   '__CURSOR', '__MONOTONIC_TIMESTAMP', '_BOOT_ID', '__SEQNUM', '__SEQNUM_ID'}
        failed_routine_require(isinstance(row, dict) and set(row) <= allowed and
            all(isinstance(value, str) for value in row.values()) and row.get('MESSAGE') == FAILED_ROUTINE_LITERAL and
            row.get('_SYSTEMD_UNIT') == unit and row.get('_SYSTEMD_INVOCATION_ID') == failure['invocationId'] and
            re.fullmatch('[1-9][0-9]{14,15}', str(row.get('__REALTIME_TIMESTAMP', ''))) is not None)
        stamp = int(row['__REALTIME_TIMESTAMP'])
        failed_routine_require(946684800000000 <= stamp <= FAILED_ROUTINE_COMPLETED * 1000000 + 999999 and
                              stamp < (FAILED_ROUTINE_START - 120) * 1000000)
    except (ValueError, TypeError, KeyError):
        die('exact failed routine native refusal is unreadable')
    # The journal's JSON key order is serialization, not a changed native fact.
    # Preserve every validated metadata field in the canonical recheck digest.
    return {'journalDigest': failed_routine_digest(row), 'atMicros': stamp}


def failed_routine_current(args: argparse.Namespace, deadline: float) -> dict[str, Any]:
    control = Path(__file__).resolve().parent
    request_root = STATE_DIR / 'engine-release-requests'
    request = failed_routine_bytes(request_root / (args.run_id + '.request')).decode().splitlines()
    failed_routine_require(len(request) == 6 and request[0] == args.sha and
        request[1] == 'https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/actions/runs/' + args.run_id.split('-')[0] and
        bool(request[2]) and request[3] == str(control) and request[4] == args.control_sha and
        request[5].isdigit() and int(request[5]) > int(time.time()))
    failed_routine_require(failed_routine_bytes(request_root / (args.run_id + '.intent')).decode().splitlines() == request and
        failed_routine_bytes(STATE_DIR / 'engine-release-generation-pins' / (args.run_id + '.generation')).decode().splitlines() == [str(control), args.control_sha] and
        failed_routine_bytes(control / 'control-sha').decode().splitlines() == [args.control_sha])
    current = native_unit(f'club-arena-engine-release-v1@{args.run_id}.service')
    failed_routine_require(current['LoadState'] == 'loaded' and current['ActiveState'] == 'activating' and
        current['SubState'] == 'start' and current['MainPID'].isdigit() and int(current['MainPID']) > 0 and
        current['InvocationID'] == args.invocation_id == os.environ.get('INVOCATION_ID'))
    groups = [line.split(':', 2)[2] for line in Path('/proc/self/cgroup').read_text().splitlines()]
    failed_routine_require(bool(current['ControlGroup']) and current['ControlGroup'] in groups)
    failed_routine_command([str(control / 'main-inspector-retirement.py'), '--entry-state', args.run_id], deadline)
    return {'requestDigest': failed_routine_digest(request), 'unit': current}


def failed_routine_runtime(deadline: float) -> dict[str, Any]:
    container = os.environ.get('CONTAINER', 'club-arena-engine')
    value = docker_json('container', container)
    image, source, _ = image_identity(FAILED_ROUTINE_IMAGE, require_label=False)
    failed_routine_require(image == FAILED_ROUTINE_IMAGE and source == FAILED_ROUTINE_DESIRED and
        value.get('Image') == image and value.get('State', {}).get('Status') == 'running' and
        CONTAINER_ID_RE.fullmatch(str(value.get('Id', ''))) is not None)
    healths = []
    for url in ('http://127.0.0.1:8080/health', os.environ.get('ENGINE_URL', 'https://engine.smarter.poker').rstrip('/') + '/health'):
        try:
            h = json.loads(failed_routine_command(['curl', '--fail', '--silent', '--show-error', '--max-time', '3',
                                                url + '?nocache=' + str(time.time_ns())], deadline))
            m = h['maintenance']
            failed_routine_require(h.get('releaseSha') == source and h.get('running') is True and
                h.get('liveness') == 'ok' and INSTANCE_ID_RE.fullmatch(str(h.get('instanceId', ''))) is not None and
                m.get('phase') == 'idle' and m.get('active') is False and m.get('durableConfirmed') is False)
            healths.append(h['instanceId'])
        except (ValueError, TypeError, KeyError):
            die('exact failed routine serving maintenance state is unreadable')
    failed_routine_require(healths[0] == healths[1])
    # Observe ECONNREFUSED only. Never attach, evaluate, close or signal Inspector.
    failed_routine_command(['docker', 'exec', container, 'sh', '-c',
        'case "${NODE_OPTIONS-}" in *--inspect*|*--debug*) exit 1 ;; esac; exec env -u NODE_OPTIONS -u NODE_PATH node --no-inspect "$@"',
        'custody-readiness', '-e', 'const s=require("node:net").createConnection({host:"127.0.0.1",port:9229});s.once("connect",()=>{s.destroy();process.exit(1)});s.once("error",e=>{s.destroy();process.exit(e.code==="ECONNREFUSED"?0:2)});s.setTimeout(1000,()=>{s.destroy();process.exit(2)});'], deadline)
    return {'containerId': value['Id'], 'startedAt': value['State']['StartedAt'], 'instanceId': healths[0]}


def failed_routine_database(runtime: dict[str, Any], deadline: float) -> None:
    control = Path(__file__).resolve().parent
    raw = failed_routine_command([str(control / 'engine-release-database-proof.py'), '--env-file',
        os.environ.get('ENV_FILE', os.environ.get('REPO_DIR', '/opt/club-arena') + '/server/.env'),
        '--sha', FAILED_ROUTINE_DESIRED, '--instance-id', runtime['instanceId'], '--failed-routine-idle',
        '--timeout-seconds', '4', '--max-heartbeat-age-seconds', '15'], deadline)
    try:
        proof = json.loads(raw)
    except ValueError:
        die('exact failed routine database idle witness is invalid')
    failed_routine_require(proof == {'schema': 'failed-routine-database-idle/v1', 'sha': FAILED_ROUTINE_DESIRED,
        'instanceId': runtime['instanceId'], 'databaseIdle': True, 'freshLeader': True})


def cmd_resolve_failed_routine(args: argparse.Namespace) -> None:
    """A bounded existing-transaction custody disposition; no runtime/DB mutation."""
    failed_routine_require(RUN_ID_RE.fullmatch(args.run_id) is not None and args.run_id != FAILED_ROUTINE_RUN and
        SHA_RE.fullmatch(args.sha) is not None and args.sha != FAILED_ROUTINE_SHA and
        SHA_RE.fullmatch(args.control_sha) is not None and INVOCATION_ID_RE.fullmatch(args.invocation_id) is not None)
    require_engine_lock(args.engine_lock_fd)
    deadline = time.monotonic() + 45
    with SealLock():
        state = load_state()
        cycles = routine_cycles(state)
        owners = [c for c in cycles.values() if routine_owner_unresolved(state, c)]
        if not owners or all(c['runId'] == args.run_id for c in owners):
            print('not-needed'); return
        if len(owners) != 1 or owners[0]['runId'] != FAILED_ROUTINE_RUN:
            # No authority over another owner. The immediately following
            # ordinary global-owner check retains its original refusal.
            print('not-needed'); return
        failed_routine_require(os.geteuid() == 0 and len(owners) == 1 and owners[0]['runId'] == FAILED_ROUTINE_RUN and
            state.get('pending') is None and state.get('finalization') is None and
            FAILED_ROUTINE_RUN not in state['committedRuns'] and
            state['desired']['sha'] == FAILED_ROUTINE_DESIRED and state['desired']['imageId'] == FAILED_ROUTINE_IMAGE)
        cycle = owners[0]
        failed_routine_cycle(cycle)
        failure = failed_routine_json(result_path(FAILED_ROUTINE_RUN))
        failed_routine_require(load_failure(FAILED_ROUTINE_RUN) == failure == cycle['failure'])
        current = failed_routine_current(args, deadline)
        sources = failed_routine_source_proof()
        historical = failed_routine_history(failure, deadline)
        units = failed_routine_native_proof(deadline)
        runtime = failed_routine_runtime(deadline)
        failed_routine_database(runtime, deadline)
        # Every authority is observed again under both locks immediately before
        # the receipt/audit/CAS. Missing paths alone never establish old no-entry.
        failed_routine_require(failed_routine_current(args, deadline) == current and
            failed_routine_source_proof() == sources and failed_routine_native_proof(deadline) == units and
            failed_routine_history(failure, deadline) == historical and
            failed_routine_json(result_path(FAILED_ROUTINE_RUN)) == failure and
            failed_routine_runtime(deadline) == runtime and load_state() == state)
        failed_routine_database(runtime, deadline)
        resolution = {'schema': 1, 'result': 'failed-custody-resolved', 'originalCycle': cycle,
            'failureDigest': FAILED_ROUTINE_DIGEST, 'verifiedByRunId': args.run_id, 'targetSha': args.sha,
            'controlSha': args.control_sha, 'invocationId': args.invocation_id, 'observedAt': int(time.time()),
            'proof': {'noAnnouncement': True, 'databaseIdle': True, 'sources': sources,
                      'historicalRefusal': historical, 'nativeUnits': units, 'runtime': runtime, 'current': current}}
        path = RESULT_DIR / (FAILED_ROUTINE_RUN + '.' + args.run_id + '.' + args.invocation_id + '.custody-resolution.json')
        try:
            path.lstat()
        except FileNotFoundError:
            write_json_atomic(path, resolution)
        else:
            original = failed_routine_json(path)
            failed_routine_require({k: v for k, v in original.items() if k != 'observedAt'} ==
                                   {k: v for k, v in resolution.items() if k != 'observedAt'})
            resolution = original
        validate_failed_routine_resolution(resolution, cycle)
        audit_once('routine_failure_custody_resolved', state,
                   'routine_failure_custody_resolved:' + FAILED_ROUTINE_RUN + ':' + args.run_id + ':' + args.invocation_id,
                   resolution=resolution)
        failed_routine_require(load_state() == state and time.monotonic() < deadline)
        state.setdefault('routineFailureResolutions', {})[FAILED_ROUTINE_RUN] = resolution
        state['updatedAt'] = int(time.time())
        write_state(state)
        print('failed-custody-resolved')


def cmd_record_result(args: argparse.Namespace) -> None:
    run_id = str(args.run_id)
    if not RUN_ID_RE.fullmatch(run_id):
        die("result run id is invalid")
    target_sha = valid_sha(args.sha, "result.sha")
    image_id = valid_image_id(args.image_id, "result.imageId")
    control_sha = valid_sha(args.control_sha, "result.controlSha")
    instance_id = str(args.instance_id)
    container_id = str(args.container_id)
    started_at = str(args.started_at)
    invocation_id = str(args.invocation_id)
    if not INSTANCE_ID_RE.fullmatch(instance_id):
        die("result instance id is invalid")
    if not CONTAINER_ID_RE.fullmatch(container_id):
        die("result container id is invalid")
    if not started_at or len(started_at) > 80 or any(ord(char) < 32 for char in started_at):
        die("result start generation is invalid")
    if not INVOCATION_ID_RE.fullmatch(invocation_id):
        die("result systemd invocation id is invalid")

    with SealLock():
        state = load_state()
        desired = state["desired"]
        if run_id in state.get("orphanFinalizationResolutions", {}):
            die("retired orphan owner cannot claim a later invocation as its result")
        if desired["sha"] != target_sha or desired["imageId"] != image_id:
            die("durable seal does not identify the result release")
        committed = state.get("committedRuns", {}).get(run_id)
        this_run_sealed = (
            isinstance(committed, dict)
            and committed.get("sha") == target_sha
            and committed.get("imageId") == image_id
        )
        if args.result == "sealed" and not this_run_sealed:
            die("this run did not seal the claimed result")
        # A power loss after the atomic seal commit but before the separate
        # result file cannot erase authorship. The seal's audited run id is the
        # authority on whether this run performed the cutover.
        effective_result = "sealed" if this_run_sealed else "already-released"
        cycle = own_routine_cycle(state, run_id)
        if cycle is not None and not this_run_sealed:
            die('an already-released observation cannot certify a routine reset')

        require_horse_journal_runtime(os.environ.get("CONTAINER", "club-arena-engine"),
                                      target_sha, image_id, container_id, started_at)
        path = result_path(run_id)
        finalization = state.get("finalization")
        exact_finalization = (
            isinstance(finalization, dict)
            and finalization.get("runId") == run_id
            and finalization.get("sha") == target_sha
            and finalization.get("imageId") == image_id
        )
        orphan_resolution = None
        if isinstance(finalization, dict) and not exact_finalization:
            if args.recover_orphan_finalization_fd is None:
                die("another committed run owns durable result finalization")
            fresh_resolution = prove_orphan_finalization(args, state)
            resolution_path = RESULT_DIR / f"{run_id}.{invocation_id}.orphan-finalization.json"
            try:
                orphan_resolution = json.loads(resolution_path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                orphan_resolution = fresh_resolution
                write_json_atomic(resolution_path, orphan_resolution)
            except (OSError, json.JSONDecodeError) as exc:
                die(f"orphan finalization resolution is unreadable: {exc}")
            # Retain the first durable witness across interruption. Fresh proof
            # above still must pass on every replay before the seal can clear.
            identity = ("schema", "originalFinalization", "originalCommittedRun", "generation",
                        "verifiedByRunId", "controlSha", "invocationId", "runtime", "originalOwnerUnits", "result")
            if (not isinstance(orphan_resolution, dict)
                    or any(orphan_resolution.get(k) != fresh_resolution[k] for k in identity)
                    or not isinstance(orphan_resolution.get("observedAt"), int)
                    or not isinstance(orphan_resolution.get("databaseProof"), str)
                    or not orphan_resolution["databaseProof"]):
                die("orphan finalization resolution belongs to different release bytes")
        if args.result == "sealed" and not path.exists() and not exact_finalization:
            die("sealed result has no exclusive durable finalization owner")
        if path.exists():
            value = load_result(run_id)
            if orphan_resolution is not None and value["result"] != "already-released":
                die("orphan finalization cannot upgrade current receipt cutover authorship")
            expected = {
                "sha": target_sha,
                "imageId": image_id,
                "controlSha": control_sha,
            }
            if any(value[key] != expected[key] for key in expected):
                die("an existing result binds this run to different release bytes")
            # A boot replay after an already-fsynced success can restart or
            # recreate the same sealed image, changing the process/container
            # generation. Preserve the original completion below and append a
            # fresh, independently proved observation for this invocation.
            if invocation_id not in value["invocationIds"]:
                value["invocationIds"].append(invocation_id)
            value["instanceId"] = instance_id
            value["containerId"] = container_id
            value["startedAt"] = started_at
            write_json_atomic(path, value)
        else:
            value = {
                "schema": 1,
                "runId": run_id,
                "sha": target_sha,
                "imageId": image_id,
                "result": effective_result,
                "instanceId": instance_id,
                "containerId": container_id,
                "startedAt": started_at,
                "controlSha": control_sha,
                "invocationIds": [invocation_id],
                "completedAt": int(time.time()),
                "completionRuntime": {
                    "instanceId": instance_id,
                    "containerId": container_id,
                    "startedAt": started_at,
                    "invocationId": invocation_id,
                },
            }
            write_json_atomic(path, value)
        audit_once(
            "result_recorded",
            state,
            f"result_recorded:{run_id}:{invocation_id}",
            result={
                "runId": run_id,
                "result": value["result"],
                "sha": target_sha,
                "imageId": image_id,
                "controlSha": control_sha,
                "invocationId": invocation_id,
                "instanceId": instance_id,
                "containerId": container_id,
                "startedAt": started_at,
            },
        )
        if orphan_resolution is not None:
            # The truthful current receipt and its audit are durable first.
            # A crash before this seal replacement simply repeats fresh proof;
            # it never creates success for the missing original invocation.
            audit_once("orphan_finalization_retired", state,
                       f"orphan_finalization_retired:{run_id}:{invocation_id}",
                       resolution=orphan_resolution)
            if load_state() != state:
                die("orphan finalization seal changed before retirement")
            state.setdefault("orphanFinalizationResolutions", {})[finalization["runId"]] = orphan_resolution
        if cycle is not None:
            if cycle['status'] not in ('committed', 'sealed') or value['result'] != 'sealed':
                die('routine cycle completion has no exact sealed commit')
            cycle.update(status='sealed', result=value)
        if exact_finalization or orphan_resolution is not None or cycle is not None:
            state["finalization"] = None
            state["updatedAt"] = int(time.time())
            write_state(state)
        print(value["result"])


def cmd_attest_result(args: argparse.Namespace) -> None:
    run_id = str(args.run_id)
    target_sha = valid_sha(args.sha, "result.sha")
    invocation_id = str(args.invocation_id or "")
    if invocation_id and not INVOCATION_ID_RE.fullmatch(invocation_id):
        die("result systemd invocation id is invalid")
    with SealLock():
        state = load_state()
        value = load_result(run_id)
        if value["sha"] != target_sha:
            die("durable result does not attest this exact SHA")
        if invocation_id and invocation_id not in value["invocationIds"]:
            die("durable result does not attest this exact invocation")
        cycle = own_routine_cycle(state, run_id)
        if cycle is not None and cycle['status'] == 'committed':
            if value['result'] != 'sealed' or state['committedRuns'].get(run_id, {}).get('imageId') != value['imageId']:
                die('routine result cannot resolve the original committed cycle')
            cycle.update(status='sealed', result=value)
            if (state.get('finalization') or {}).get('runId') == run_id:
                state['finalization'] = None
            write_state(state)
        desired = state["desired"]
        if desired["sha"] != value["sha"] or desired["imageId"] != value["imageId"]:
            die("durable result no longer matches the sealed desired release")
        print(
            " ".join(
                str(value[key])
                for key in (
                    "result",
                    "sha",
                    "imageId",
                    "containerId",
                    "startedAt",
                    "instanceId",
                    "controlSha",
                )
            )
        )


def cmd_commit(args: argparse.Namespace) -> None:
    meta = metadata(args)
    target_sha = valid_sha(args.sha)
    image_id, image_sha, _ = image_identity(args.image, require_label=True)
    if image_sha != target_sha:
        die("commit image revision does not match target")
    status, running_image_id = container_identity(args.container)
    if status != "running" or running_image_id != image_id:
        die("compatibility proof cannot seal an image that is not the running container")

    with SealLock():
        state = load_state()
        pending = state.get("pending")
        if meta["runId"] in state.get("orphanFinalizationResolutions", {}):
            die("retired orphan owner cannot recreate committed finalization")
        require_horse_journal_runtime(args.container, target_sha, image_id,
                                      args.container_id, args.started_at)
        # A lost SSH response or an audit-append failure can make the caller
        # uncertain after the fsynced state replacement succeeded. The same
        # audited run may safely retry/attest that exact durable receipt; it may
        # not move or rewrite any other release.
        committed = state.get("committedRuns", {}).get(meta["runId"])
        if (
            pending is None
            and state["desired"]["sha"] == target_sha
            and state["desired"]["imageId"] == image_id
            and isinstance(committed, dict)
            and committed.get("sha") == target_sha
            and committed.get("imageId") == image_id
        ):
            finalization = state.get("finalization")
            expected_finalization = {
                "runId": meta["runId"],
                "sha": target_sha,
                "imageId": image_id,
            }
            if isinstance(finalization, dict) and any(
                finalization.get(key) != value for key, value in expected_finalization.items()
            ):
                die("another committed run owns durable result finalization")
            if finalization is None and not result_path(meta["runId"]).exists():
                state["finalization"] = expected_finalization
                state["updatedAt"] = int(time.time())
                write_state(state)
            audit("commit_attested", state, desired=state["desired"], **meta)
            print(target_sha)
            return
        if not pending_is_active(pending) or pending.get("used") is not True:
            die("no consumed live cutover authorization exists for commit")
        if pending.get("sha") != target_sha or pending.get("imageId") != image_id:
            die("running release does not match the prepared cutover")
        if str(pending.get("runId")) != meta["runId"]:
            die("only the run which prepared the cutover may commit it")

        old_desired = state["desired"]
        state["desired"] = {
            "sha": target_sha,
            "imageId": image_id,
            "legacyUnlabelled": False,
        }
        if pending["mode"] == "deploy":
            state["highWaterSha"] = target_sha
        # An intentional rollback changes what recovery should run, but never
        # turns an older commit into the normal deploy high-water authority.
        state["generation"] += 1
        mode = pending["mode"]
        state["committedRuns"][meta["runId"]] = {
            "sha": target_sha,
            "imageId": image_id,
        }
        cycle = own_routine_cycle(state, meta['runId'])
        if cycle is not None:
            if cycle['status'] != 'reserved' or cycle['sha'] != target_sha:
                die('commit does not match the reserved routine cycle')
            cycle['status'] = 'committed'
        state["finalization"] = {
            "runId": meta["runId"],
            "sha": target_sha,
            "imageId": image_id,
        }
        state["pending"] = None
        state["updatedAt"] = int(time.time())
        state["updatedBy"] = meta
        write_state(state)
        audit(
            "commit",
            state,
            previous=old_desired,
            desired=state["desired"],
            highWaterSha=state["highWaterSha"],
            mode=mode,
            **meta,
        )
        print(target_sha)


def cmd_attest_commit(args: argparse.Namespace) -> None:
    target_sha = valid_sha(args.sha)
    image_id = str(args.image_id)
    if not IMAGE_ID_RE.fullmatch(image_id):
        die("commit attestation image ID is invalid")
    run_id = str(args.run_id)
    if not RUN_ID_RE.fullmatch(run_id):
        die("commit attestation run id is invalid")
    with SealLock():
        state = load_state()
        desired = state["desired"]
        committed = state.get("committedRuns", {}).get(run_id)
        if (
            desired["sha"] != target_sha
            or desired["imageId"] != image_id
            or not isinstance(committed, dict)
            or committed.get("sha") != target_sha
            or committed.get("imageId") != image_id
        ):
            die("durable release state does not attest this run's exact commit")
        print(f'{state["generation"]} {target_sha} {image_id} {run_id}')


def cmd_attest_committed_sha(args: argparse.Namespace) -> None:
    """Read-only: has this host ever sealed this exact commit?

    The engine rollback drill admits an older target only if a run already
    committed it here, so it has served on this host and database before.
    Prints the newest committing run and its image; exits 1 when none did.
    """
    target_sha = valid_sha(args.sha)
    with SealLock():
        state = load_state()
        owners = sorted(
            run_id
            for run_id, receipt in state.get("committedRuns", {}).items()
            if isinstance(receipt, dict) and receipt.get("sha") == target_sha
        )
        if not owners:
            die("this host has never sealed the requested commit")
        newest = max(owners, key=lambda run_id: [int(part) for part in run_id.split("-")])
        print(f'{target_sha} {state["committedRuns"][newest]["imageId"]} {newest}')


def cmd_abort(args: argparse.Namespace) -> None:
    with SealLock():
        state = load_state()
        pending = state.get("pending")
        if not isinstance(pending, dict) or str(pending.get("runId")) != str(args.run_id):
            return
        target = {"sha": pending["sha"], "imageId": pending["imageId"]}
        state["pending"] = None
        state["updatedAt"] = int(time.time())
        write_state(state)
        audit("abort", state, target=target, runId=str(args.run_id))


def add_audit_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-url", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--reason", required=True)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    commands = result.add_subparsers(dest="command", required=True)

    bootstrap = commands.add_parser("bootstrap-running")
    bootstrap.add_argument("--container", default="club-arena-engine")
    bootstrap.add_argument("--repo", default="/opt/club-arena")
    add_audit_arguments(bootstrap)
    bootstrap.set_defaults(handler=cmd_bootstrap_running)

    binding = commands.add_parser('bind-routine-window')
    binding.add_argument('--repo', required=True)
    binding.add_argument('--run-id', required=True)
    binding.set_defaults(handler=cmd_bind_routine_window)
    restoring = commands.add_parser('restoration-needed')
    restoring.add_argument('--repo', required=True)
    restoring.add_argument('--sha', required=True)
    restoring.set_defaults(handler=cmd_restoration_needed)
    owner = commands.add_parser('check-routine-owner')
    owner.add_argument('--run-id', required=True)
    owner.set_defaults(handler=cmd_check_routine_owner)
    resolve_failed = commands.add_parser('resolve-failed-routine')
    resolve_failed.add_argument('--engine-lock-fd', type=int, required=True)
    resolve_failed.add_argument('--run-id', required=True)
    resolve_failed.add_argument('--sha', required=True)
    resolve_failed.add_argument('--control-sha', required=True)
    resolve_failed.add_argument('--invocation-id', required=True)
    resolve_failed.set_defaults(handler=cmd_resolve_failed_routine)
    current = commands.add_parser('current-cycle-policy')
    current.add_argument('--repo', required=True)
    current.add_argument('--sha', required=True)
    current.add_argument('--control-sha', required=True)
    current.set_defaults(handler=cmd_current_cycle_policy)
    schedule = commands.add_parser('schedule-policy')
    schedule.add_argument('--repo', required=True)
    schedule.add_argument('--sha', required=True)
    schedule.set_defaults(handler=cmd_schedule_policy)
    cycle = commands.add_parser('reserve-routine-cycle')
    cycle.add_argument('--repo', required=True)
    cycle.add_argument('--sha', required=True)
    cycle.add_argument('--control-sha', required=True)
    cycle.add_argument('--run-id', required=True)
    cycle.set_defaults(handler=cmd_reserve_routine_cycle)

    prepare = commands.add_parser("prepare")
    prepare.add_argument("--sha", required=True)
    prepare.add_argument("--image", required=True)
    prepare.add_argument("--mode", choices=("deploy", "rollback"), required=True)
    prepare.add_argument("--repo", default="/opt/club-arena")
    add_audit_arguments(prepare)
    prepare.set_defaults(handler=cmd_prepare)

    authorize = commands.add_parser("authorize")
    authorize.add_argument("--image", required=True)
    authorize.add_argument("--token-stdin", action="store_true")
    authorize.set_defaults(handler=cmd_authorize)

    classify = commands.add_parser("classify-running")
    classify.add_argument("--container", default="club-arena-engine")
    classify.add_argument("--with-sha", action="store_true")
    classify.set_defaults(handler=cmd_classify)

    get = commands.add_parser("get")
    get.add_argument(
        "field",
        choices=(
            "desired-sha",
            "desired-image-id",
            "desired-legacy-unlabelled",
            "high-water-sha",
        ),
    )
    get.set_defaults(handler=cmd_get)

    recovery_window = commands.add_parser("reserve-recovery-window")
    recovery_window.add_argument("--sha", required=True)
    recovery_window.add_argument("--run-id", required=True)
    recovery_window.add_argument("--repo", required=True)
    recovery_window.add_argument("--missed-window", action="store_true")
    recovery_window.add_argument("--cause")
    recovery_window.add_argument("--scheduled-cycle-start", type=int)
    recovery_window.add_argument("--control-sha")
    recovery_window.add_argument("--include-eligibility", action="store_true")
    recovery_window.set_defaults(handler=cmd_reserve_recovery_window)

    pending_owner = commands.add_parser("pending-owner")
    pending_owner.set_defaults(handler=cmd_pending_owner)

    record_result = commands.add_parser("record-result")
    record_result.add_argument("--sha", required=True)
    record_result.add_argument("--image-id", required=True)
    record_result.add_argument("--result", choices=("sealed", "already-released"), required=True)
    record_result.add_argument("--instance-id", required=True)
    record_result.add_argument("--container-id", required=True)
    record_result.add_argument("--started-at", required=True)
    record_result.add_argument("--run-id", required=True)
    record_result.add_argument("--control-sha", required=True)
    record_result.add_argument("--invocation-id", required=True)
    record_result.add_argument("--recover-orphan-finalization-fd", type=int)
    record_result.set_defaults(handler=cmd_record_result)

    attest_result = commands.add_parser("attest-result")
    attest_result.add_argument("--sha", required=True)
    attest_result.add_argument("--run-id", required=True)
    attest_result.add_argument("--invocation-id")
    attest_result.set_defaults(handler=cmd_attest_result)

    record_failure = commands.add_parser("record-failure")
    record_failure.add_argument("--sha", required=True)
    record_failure.add_argument("--run-id", required=True)
    record_failure.add_argument("--control-sha", required=True)
    record_failure.add_argument("--invocation-id", required=True)
    record_failure.add_argument("--exit-status", required=True)
    record_failure.add_argument("--container", default="club-arena-engine")
    record_failure.set_defaults(handler=cmd_record_failure)

    attest_failure = commands.add_parser("attest-failure")
    attest_failure.add_argument("--sha", required=True)
    attest_failure.add_argument("--run-id", required=True)
    attest_failure.add_argument("--control-sha")
    attest_failure.add_argument("--invocation-id")
    attest_failure.set_defaults(handler=cmd_attest_failure)

    attest_terminal = commands.add_parser("attest-terminal")
    attest_terminal.add_argument("--sha", required=True)
    attest_terminal.add_argument("--run-id", required=True)
    attest_terminal.add_argument("--control-sha", required=True)
    attest_terminal.set_defaults(handler=cmd_attest_terminal)

    commit = commands.add_parser("commit")
    commit.add_argument("--sha", required=True)
    commit.add_argument("--image", required=True)
    commit.add_argument("--container", default="club-arena-engine")
    commit.add_argument("--container-id", required=True)
    commit.add_argument("--started-at", required=True)
    add_audit_arguments(commit)
    commit.set_defaults(handler=cmd_commit)

    attest = commands.add_parser("attest-commit")
    attest.add_argument("--sha", required=True)
    attest.add_argument("--image-id", required=True)
    attest.add_argument("--run-id", required=True)
    attest.set_defaults(handler=cmd_attest_commit)

    attest_committed_sha = commands.add_parser("attest-committed-sha")
    attest_committed_sha.add_argument("--sha", required=True)
    attest_committed_sha.set_defaults(handler=cmd_attest_committed_sha)

    abort = commands.add_parser("abort")
    abort.add_argument("--run-id", required=True)
    abort.set_defaults(handler=cmd_abort)
    return result


def main() -> None:
    args = parser().parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
