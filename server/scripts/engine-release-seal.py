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
from datetime import datetime
from zoneinfo import ZoneInfo
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
    failures = value.get("uncommittedCandidateStarts", {})
    if not isinstance(failures, dict):
        die("failed candidate history is invalid")
    for sha, receipt in failures.items():
        if (not SHA_RE.fullmatch(sha) or not isinstance(receipt, dict)
                or not RUN_ID_RE.fullmatch(str(receipt.get("runId", "")))):
            die("failed candidate identity is invalid")
        valid_image_id(str(receipt.get("imageId", "")), "uncommittedCandidateStarts.imageId")
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
DAILY_BOOTSTRAP_SHA = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
DAILY_BOOTSTRAP_SCHEDULE_DIGEST = '37d3e1b4e70668e95123dce068e0a828f8f02d44956b1566510fada02b56ad6b'



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


def daily_bootstrap_schedule(repo: str, sha: str, schedule: Any, starts: int) -> bool:
    # The serving daily predecessor has no Phase1 JSON policy. Its actual
    # 04:00 Chicago source remains valid for the first protected hourly rollout.
    # Do not infer authorization from a reason string or from a missing policy.
    if sha != DAILY_BOOTSTRAP_SHA or not isinstance(schedule, dict): return False
    expected={'timeZone':'America/Chicago','startHour':4,'startMinute':0,
              'durationMs':300000,'hourlyCashFreeze':False}
    if (any(schedule.get(k)!=v for k,v in expected.items())
            or any(type(schedule.get(k)) is not int for k in ('startHour','startMinute','durationMs'))
            or schedule.get('hourlyCashFreeze') is not False
            or schedule.get('frequency') is not None or schedule.get('policyId') is not None): return False
    local=datetime.fromtimestamp(starts/1000,ZoneInfo('America/Chicago'))
    if local.hour!=4 or local.minute!=0: return False
    raw=run(['git','-C',repo,'show',f'{valid_sha(sha)}:server/src/maintenance/maintenanceSchedule.ts'])
    return hashlib.sha256(raw.strip().encode()).hexdigest()==DAILY_BOOTSTRAP_SCHEDULE_DIGEST


def qualified_early_promise(repo: str, h: dict, w: dict, raw: str | None) -> bool:
    """Preserve raw freeze custody; bind only the demonstrated EED 1ms defect.

    The caller obtains this snapshot through the fixed authenticated database
    reader. No health field, tolerance, clock offset or caller-supplied endpoint
    can stand in for the installed authoritative promise contract.
    """
    if not isinstance(raw, str) or len(raw)>16384: return False
    try:
        proof=json.loads(raw); m=h['maintenance']; p=m['presentation']
        row=proof['maintenance']; leader=proof['leader']
        stamp=lambda value: datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()*1000
        now=time.time()*1000
        source=run(['git','-C',repo,'show',f'{DAILY_BOOTSTRAP_SHA}:server/src/maintenance/MaintenanceBreak.ts'])
        if hashlib.sha256((source+'\n').encode()).hexdigest()!='eeb5342d32ea50d5c230dbe955382fa5eee823a1a90c9e5ebb9ab2f227e345c1': return False
        return (h['releaseSha']==DAILY_BOOTSTRAP_SHA and m['phase']=='counting_down'
            and proof['schema']=='maintenance-promise-floor/v1'
            and proof['thawDefinitionMd5']=='cb733d7201725719813ffd1b1e099b1b'
            and 0<=now-stamp(proof['observedAt'])<=10000
            and leader['version']==DAILY_BOOTSTRAP_SHA[:8] and leader['instanceId']==h['instanceId']
            and 0<=now-stamp(leader['heartbeatAt'])<=60000
            and row['id'] is True and row['enforce_freeze'] is True and row['phase']=='counting_down'
            and row['reason']==m['reason'] and isinstance(row['ownership_token'],str)
            and re.fullmatch(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}',row['ownership_token']) is not None
            and stamp(row['announced_at'])==w['announcedAt']
            and stamp(row['break_started_at'])==w['startsAt']-1
            and stamp(row['break_ends_at'])==w['endsAt']-1
            and m['breakEndsAt']==w['endsAt']-1
            and p['break_ends_at']==w['endsAt']-1 and p['scheduled_ends_at']==w['endsAt']-1
            and w['startsAt']<=now<w['endsAt'])
    except (KeyError,TypeError,ValueError,AttributeError,OverflowError): return False


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
        early_promise = False
        if (type(p.get('break_ends_at')) is not int or p['break_ends_at']!=w['endsAt']
                or type(p.get('scheduled_ends_at')) is not int or p['scheduled_ends_at']!=w['endsAt']):
            if not qualified_early_promise(args.repo,h,w,getattr(args,'promise_floor_proof',None)):
                die('routine presentation changed its promised window')
            early_promise = True
        now=int(time.time()*1000)
        if not announced <= now < w['endsAt'] or (m['phase']=='last_hand') != (now<w['startsAt']):
            die('routine announcement is outside its original window/phase')
        if m['reason']=='Scheduled Engine Maintenance':
            s=m.get('schedule')
            expected={'timeZone':'America/Chicago','frequency':'phase1-hourly','policyId':SCHEDULE_POLICY_ID,
                      'startHour':None,'startMinute':0,'durationMs':300000,'hourlyCashFreeze':True}
            hourly=(isinstance(s,dict) and type(s.get('startMinute')) is int and type(s.get('durationMs')) is int
                    and s.get('hourlyCashFreeze') is True and all(s.get(k)==v for k,v in expected.items())
                    and schedule_policy(args.repo,state['desired']['sha'])['phase1Status']=='active')
            if not hourly and not daily_bootstrap_schedule(args.repo,state['desired']['sha'],s,w['startsAt']):
                die('routine serving scheduled source is unproved')
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
        if early_promise:
            witness = json.loads(args.promise_floor_proof)
            audit_once('routine_original_promise_proved', state,
                'routine_original_promise:' + str(args.run_id) + ':' + h['instanceId'] + ':' + witness['maintenance']['ownership_token'],
                runId=str(args.run_id), window=w, rawStart=w['startsAt']-1, rawEnd=w['endsAt']-1,
                ownershipToken=witness['maintenance']['ownership_token'], instanceId=h['instanceId'],
                thawDefinitionMd5=witness['thawDefinitionMd5'])
        if c.get('window') != w:
            c['window']=w; write_state(state)
        print(json.dumps(c,sort_keys=True))


# Written under SealLock before the per-run reservation. An interrupted write
# consumes the exception conservatively. Existing release recovery reads keep
# their original run identity and never request a second announcement.
NOV7_OWNER_CLAIM = 'engine-release-owner-2026-11-14-owner-offcycle-engine-0506z.json'
NOV7_PREDECESSOR = '533608409f2b05e702c9fbd097bcab48b9e59dad'


def require_nov7_reservation_authority(args, target, stamp):
    # The installed seal and its policy reader belong to the same pinned control generation.
    deadline = getattr(args, 'deadline', None)
    expiry = int(datetime.fromisoformat('2026-11-14T07:30:00+00:00').timestamp())
    if (type(deadline) is not int or stamp + 420000 > min(deadline, expiry) * 1000
            or not 330 <= (stamp // 1000) % 3600 <= 2940):
        die('Nov 7 announcement cannot fit the authorized window')
    helper = Path(__file__).resolve().with_name('engine-release-activation-floor.py')
    result = subprocess.run([sys.executable, '-B', str(helper), 'nov7-owner', '--repo', args.repo,
                             '--target', target, '--control', args.control_sha, '--deadline', str(deadline)],
                            timeout=15, stdout=subprocess.DEVNULL)
    if result.returncode:
        die('Nov 7 protected target and control authority unavailable')


def nov7_claim(run_id, target, control, stamp):
    return {'runId': run_id, 'sha': target, 'controlSha': valid_sha(control), 'announcedAt': stamp}


def cmd_bind_recovery_window(args: argparse.Namespace) -> None:
    """Observe the original reserved recovery promise; never reserve or slide it."""
    raw = sys.stdin.read(1048577)
    if len(raw) > 1048576: die('recovery health binding exceeds its bound')
    try: h = json.loads(raw)
    except ValueError: die('recovery health binding is unreadable')
    run_id, target, control = str(args.run_id), valid_sha(args.sha), valid_sha(args.control_sha)
    if not RUN_ID_RE.fullmatch(run_id): die('recovery binding run is invalid')
    with SealLock():
        state = load_state()
        git_is_ancestor(args.repo, target, 'origin/main', 'recovery binding target is not protected main')
        git_is_ancestor(args.repo, control, 'origin/main', 'recovery binding control is not protected main')
        try: reservation = json.loads((STATE_DIR / f'engine-recovery-window-{run_id}.json').read_text())
        except (OSError, ValueError): die('original recovery reservation is unreadable')
        if (reservation.get('runId') != run_id or reservation.get('sha') != target
                or type(reservation.get('announcedAt')) is not int
                or reservation['announcedAt'] != args.announced_at
                or not RECOVERY_CAUSE_RE.fullmatch(str(reservation.get('cause') or ''))):
            die('recovery promise differs from its original reservation')
        if getattr(args, 'nov7_owner', False):
            claim = json.loads((STATE_DIR / NOV7_OWNER_CLAIM).read_text())
            if (claim != nov7_claim(run_id, target, control, args.announced_at)
                    or state['desired']['sha'] != NOV7_PREDECESSOR
                    or reservation.get('cause') != 'urgent'
                    or (h.get('maintenance') or {}).get('phase') != 'counting_down'):
                die('Nov 7 release does not own the original predecessor and countdown')
        m = h.get('maintenance') if isinstance(h, dict) else None
        p = m.get('presentation') if isinstance(m, dict) else None
        if (not isinstance(h, dict) or h.get('releaseSha') != state['desired']['sha']
                or h.get('running') is not True or 'weeklyPayout' not in h or h['weeklyPayout'] is not None
                or not isinstance(p, dict) or m.get('active') is not True or m.get('durableConfirmed') is not True
                or m.get('phase') not in ('last_hand', 'counting_down') or p.get('phase') != m['phase']
                or p.get('active') is not True or m.get('reason') != 'Deployment Recovery'
                or p.get('reason') != m['reason'] or type(p.get('break_id')) is not int
                or p['break_id'] != args.announced_at):
            die('recovery durable maintenance identity is unproved')
        announced = args.announced_at
        w = {'announcedAt': announced, 'startsAt': announced + 120000,
             'endsAt': announced + 420000, 'verified': True}
        if (type(p.get('break_ends_at')) is not int or p['break_ends_at'] != w['endsAt']
                or type(p.get('scheduled_ends_at')) is not int or p['scheduled_ends_at'] != w['endsAt']):
            if not qualified_early_promise(args.repo, h, w, args.promise_floor_proof):
                die('recovery presentation changed its promised window')
        elif m['phase'] == 'counting_down' and m.get('breakEndsAt') != w['endsAt']:
            die('recovery countdown differs from its original promise')
        now = int(time.time() * 1000)
        if not announced <= now < w['endsAt'] or (m['phase'] == 'last_hand') != (now < w['startsAt']):
            die('recovery announcement is outside its original window/phase')
        print(json.dumps({'window': w}, sort_keys=True))


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
    if not isinstance(resolutions, dict):
        die('routine failure resolution history is invalid')
    for owner, resolution in resolutions.items():
        original = [c for c in cycles.values() if c['runId'] == owner]
        failed_routine_require(len(original) == 1)
        validate_routine_resolution(owner, resolution, original[0])
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
    if not isinstance(resolutions, dict):
        die('routine failure resolution history is invalid')
    resolution = resolutions.get(cycle['runId'])
    if resolution is None:
        return True
    validate_routine_resolution(cycle['runId'], resolution, cycle)
    return False


TERMINAL_OWNER_SETTLE_MS = 60_000
ROUTINE_CYCLE_ADMISSION_LEAD_SECONDS = 180
TERMINAL_RESOLUTION_KEYS = {'schema', 'result', 'originalCycle', 'verifiedByRunId', 'verifiedByControlSha',
                            'verifiedByTargetSha', 'invocationId', 'observedAt', 'proof'}
TERMINAL_PROOF_KEYS = {'failureDigest', 'checkpointIntentDigest', 'checkpointRefusalDigest', 'originalProcess',
                       'sourceDigests', 'runtime', 'database'}

# The terminal proof releases exactly one known owner: the 9f census refusal.
# 41349091113-1 (3e) keeps its own pinned resolution; every other owner stays
# authoritative/UNKNOWN.
NINEF_RUN = '41379310363-1'
NINEF_SHA = '9f8219ae08053f72a7ccc0a903f75219e29e042b'
NINEF_POLICY_DIGEST = '203626ce907eed185e27fac659cc391b16d6b5814fe446b4c0257207d2ba0578'
NINEF_FAILURE = 'eef58f952edf7b0935559e4001e14e59712550988ea80d3079060f132251a4ee'
NINEF_INVOCATION = '3b9945ef4bdf4c5dbb993c6cf8d4be60'
NINEF_COMPLETED_AT = 1793592315
NINEF_WINDOW = {'announcedAt': 1793591884929, 'startsAt': 1793592004929, 'endsAt': 1793592304929,
                'verified': True}
NINEF_CENSUS_SOURCE = '7840d64c30a0c179b50380d9dad9c9bb51027a690d50dc32422856ea56662506'
NINEF_SOURCES = {
    'engine-release-transaction.sh': '40a9a7cb2e72b938e2702cbea3967e1aab018221787a0f51c32231b29304772a',
    'legacy-engine-checkpoint.sh': '32cc0a07bb7f3b5e51f6625969eee68b66c400e51976a9748f6548a40be54758',
    'legacy-engine-checkpoint.mjs': 'ff22153dc600c6a29c4f3471e90c4babdb518e1afdf4748bb03e84e5a8b8c316',
    'engine-release-unit-wrapper.sh': 'e9abdbe2c97c3594b32a920285e78858c1e0497f00a8a7edd21b99ba0491dc9c',
    'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83',
    'install-engine-supervisor.sh': 'b47aaaca69f749a60e72ef983719b4d18c00b75d7c1d19958508a45930d0fa96',
    'install-engine-intake.sh': '5476d126add86e299728488c97eb0f47c2bdeddb3b0b28d680db6535eea47f1b',
}
NINEF_TRANSPORT_PREFIX = 'op=queryObjects,cause=request_timeout,method=Runtime.evaluate,allowanceMs=59000,waitedMs='


def ninef_cycle(cycle: Any) -> None:
    failure = cycle.get('failure') if isinstance(cycle, dict) else None
    failed_routine_require(isinstance(cycle, dict) and cycle.get('runId') == NINEF_RUN and
        cycle.get('sha') == cycle.get('controlSha') == NINEF_SHA and cycle.get('status') == 'reserved' and
        cycle.get('startsAt') == 1793592000 and cycle.get('endsAt') == 1793592300 and
        cycle.get('policyDigest') == NINEF_POLICY_DIGEST and cycle.get('kind') == 'hourly-reset' and
        cycle.get('window') == NINEF_WINDOW and isinstance(failure, dict) and
        failed_routine_digest(failure) == NINEF_FAILURE and failure.get('completedAt') == NINEF_COMPLETED_AT and
        failure.get('invocationId') == NINEF_INVOCATION)


def ninef_sources(deadline: float, control: str = NINEF_SHA, expected: dict[str, str] = NINEF_SOURCES) -> dict[str, str]:
    """The seven original 9f control sources and the three unit templates they installed."""
    parent = Path('/usr/local/lib/club-arena')
    generation = parent / 'engine-control-generations' / control
    originals = {name: failed_routine_bytes(generation / name, 512 * 1024) for name in expected}
    failed_routine_require(all(hashlib.sha256(raw).hexdigest() == expected[name]
                               for name, raw in originals.items()))
    failed_routine_require(failed_routine_bytes(parent / 'engine-release-unit-wrapper-v1.sh', 512 * 1024) ==
                           originals['engine-release-unit-wrapper.sh'])
    for source, marker, template in (
            ('install-engine-supervisor.sh', 'cat > "$UNIT_STAGE/club-arena-engine-release-v1@.service" <<UNIT\n',
             'club-arena-engine-release-v1@.service'),
            ('install-engine-intake.sh', 'cat > "$UNIT_STAGE" <<\'UNIT\'\n', 'club-arena-engine-intake-v1@.service'),
            ('install-engine-intake.sh', 'cat > "$PATH_STAGE" <<\'UNIT\'\n', 'club-arena-engine-intake-v1@.path')):
        content = originals[source].decode().split(marker, 1)[1].split('\nUNIT\n', 1)[0] + '\n'
        if source == 'install-engine-supervisor.sh':
            content = content.replace('$UNIT_WRAPPER_V1', str(parent / 'engine-release-unit-wrapper-v1.sh')) \
                .replace('\\$', '$')
        failed_routine_require(failed_routine_bytes(Path('/etc/systemd/system') / template) == content.encode())
    failed_routine_require(time.monotonic() < deadline)
    return dict(expected)


def terminal_checkpoint_refusal(run_id: str, failure: dict[str, Any], window: dict[str, Any], deadline: float) -> str:
    """The failed invocation's own journal holds exactly one legacy checkpoint
    refusal made before the guard call: not ok, no retry, checkpoint never
    invoked, no checkpoint/progress result, and an inspector request that was
    never invoked. A run that reached the guard (or left no such row) is not
    a terminal owner this proof may release."""
    unit = f'club-arena-engine-release-v1@{run_id}.service'
    raw = failed_routine_command(['journalctl', '--unit=' + unit, '_SYSTEMD_INVOCATION_ID=' + failure['invocationId'],
        '--no-pager', '--output=json',
        '--output-fields=MESSAGE,_SYSTEMD_UNIT,_SYSTEMD_INVOCATION_ID,__REALTIME_TIMESTAMP',
        '--lines=4', '--grep="checkpointInvoked":'], deadline, 65536)
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    failed_routine_require(len(rows) == 1)
    row = rows[0]
    outcome = json.loads(row.get('MESSAGE', ''))
    stamp = str(row.get('__REALTIME_TIMESTAMP', ''))
    failed_routine_require(row.get('_SYSTEMD_UNIT') == unit and
        row.get('_SYSTEMD_INVOCATION_ID') == failure['invocationId'] and stamp.isdigit() and
        window['startsAt'] * 1000 <= int(stamp) <= (failure['completedAt'] + 1) * 1000000 and
        isinstance(outcome, dict) and outcome.get('ok') is False and outcome.get('retryAllowed') is False and
        outcome.get('checkpointInvoked') is False and 'checkpoint' not in outcome and 'progress' not in outcome and
        outcome.get('reason') == 'inspector cleanup not verified' and outcome.get('inspectorClosed') is False and
        outcome.get('cleanupConnections') == 0 and isinstance(outcome.get('transportDetail'), str) and
        outcome['transportDetail'].startswith(NINEF_TRANSPORT_PREFIX) and
        outcome['transportDetail'].endswith(',invoked=no'))
    return failed_routine_digest(row)


def terminal_inspect_container(deadline: float) -> dict[str, Any]:
    raw = failed_routine_command(['docker', 'container', 'inspect', '--format', '{{json .}}',
        os.environ.get('ENGINE_CONTAINER_NAME', 'club-arena-engine')], deadline, 262144)
    value = json.loads(raw)
    failed_routine_require(isinstance(value, dict) and isinstance(value.get('State'), dict))
    return value


def terminal_proc_birth(pid: int) -> float | None:
    """Kernel birth time of a live PID, or None when the PID no longer exists."""
    try:
        raw = (Path('/proc') / str(pid) / 'stat').read_bytes()
    except FileNotFoundError:
        return None
    prefix, sep, tail = raw.rpartition(b')')
    fields = tail.split()
    failed_routine_require(sep and prefix.startswith(str(pid).encode() + b' (') and len(fields) >= 20 and
                           fields[19].isdigit())
    btime = [x.split()[1] for x in Path('/proc/stat').read_text().splitlines() if x.startswith('btime ')]
    failed_routine_require(len(btime) == 1 and btime[0].isdigit())
    return int(btime[0]) + int(fields[19]) / os.sysconf('SC_CLK_TCK')


def terminal_owner_proof(state: dict[str, Any], cycle: dict[str, Any], deadline: float) -> dict[str, Any] | None:
    """Positive proof that an expired failed routine owner left nothing behind.

    The cycle, its failure and the audit stay exactly as recorded. Returns the
    proof only while every one of these is observed now, else None:
      - the cycle is 'reserved' with a recorded failure, its window (or
        startsAt+360s) ended at least a minute ago, and no transaction is
        pending, finalizing or committed for that run;
      - the canonical durable failure equals the cycle's copy, names the exact
        sha/controlSha, and the runtime it recovered is the sealed desired one;
      - the run's request, intent, break deadline, awaiting-certificate, drill,
        unreleased Lightning hold, intake request/intent, generation pin and
        image lease are absent;
      - its release service, intake service and intake path are loaded or
        not-found, inactive or failed, PID-free, job-free, not enabled and
        without wants links;
      - if the run opened a legacy checkpoint, the engine process that intent
        bound has since been replaced: the container started after the intent,
        its PID differs, and the old PID is gone or was born after the intent;
      - the container runs exactly the desired image, and local and public
        health agree on one instance of the desired source, idle and unfrozen;
      - the database shows that instance as the fresh leader with no
        maintenance owner.
    Any error, timeout or unexpected value is an unproved answer.
    """
    try:
        failure = cycle.get('failure')
        run_id = str(cycle.get('runId', ''))
        if cycle.get('status') != 'reserved' or not isinstance(failure, dict) or run_id != NINEF_RUN:
            return None
        ninef_cycle(cycle)
        if state.get('pending') is not None or state.get('finalization') is not None:
            return None
        if run_id in state.get('committedRuns', {}):
            return None
        window = routine_window(cycle, verified=True)
        if time.time() * 1000 < window['endsAt'] + TERMINAL_OWNER_SETTLE_MS:
            return None
        durable = load_failure(run_id)
        desired = state['desired']
        if (durable != failure or durable['sha'] != cycle['sha'] or durable['controlSha'] != cycle['controlSha']
                or durable['recoveredDesiredSha'] != desired['sha']
                or durable['recoveredDesiredImageId'] != desired['imageId']):
            return None
        request_root = Path(os.environ.get('ENGINE_RELEASE_REQUEST_ROOT', str(STATE_DIR / 'engine-release-requests')))
        pin_root = Path(os.environ.get('ENGINE_RELEASE_PIN_ROOT', str(STATE_DIR / 'engine-release-generation-pins')))
        intake_root = Path(os.environ.get('ENGINE_RELEASE_INTAKE_ROOT', str(STATE_DIR / 'engine-intake-requests')))
        lease_root = Path(os.environ.get('ENGINE_RELEASE_IMAGE_LEASE_ROOT', str(STATE_DIR / 'engine-image-leases')))
        for root, suffixes in ((request_root, ('request', 'intent', 'break-deadline', 'awaiting-certificate',
                                               'drill', 'lightning-hold.json', 'activation-entry',
                                               'main-inspector-retirement-intent',
                                               'main-inspector-retirement-receipt')),
                               (intake_root, ('request', 'intent')),
                               (pin_root, ('generation',)), (lease_root, ('lease',))):
            for suffix in suffixes:
                try:
                    (root / f'{run_id}.{suffix}').lstat()
                except FileNotFoundError:
                    continue
                return None
        units = {}
        for prefix, extension in (('release', 'service'), ('intake', 'service'), ('intake', 'path')):
            unit = f'club-arena-engine-{prefix}-v1@{run_id}.{extension}'
            # Shared bounded reader: inactive/failed, disabled, job-free, PID-free,
            # exact fragment, no drop-ins; services also prove an empty cgroup.
            value = failed_routine_unit_snapshot(unit, deadline)
            if extension == 'service':
                failed_routine_service_empty(unit, value, deadline)
            for wants in ('multi-user.target.wants', 'paths.target.wants'):
                if os.path.lexists(Path('/etc/systemd/system') / wants / unit):
                    return None
            units[unit] = value
        container = terminal_inspect_container(deadline)
        live = container['State']
        if (container.get('Image') != desired['imageId'] or live.get('Status') != 'running' or
                type(live.get('Pid')) is not int or live['Pid'] <= 0 or
                CONTAINER_ID_RE.fullmatch(str(container.get('Id', ''))) is None):
            return None
        live_started = datetime.fromisoformat(str(live['StartedAt']).replace('Z', '+00:00')).timestamp()
        # Native units are re-read here so a unit that changed while Docker
        # answered cannot pass.
        for unit, value in units.items():
            if failed_routine_unit_snapshot(unit, deadline) != value:
                return None
        # The run must have entered the legacy checkpoint inside its own break,
        # bound to this exact container; that engine process must be gone.
        intent = failed_routine_json(request_root / f'{run_id}.legacy-checkpoint-intent')
        if not (isinstance(intent, dict) and intent.get('runId') == run_id and
                intent.get('controlSha') == cycle['controlSha'] and intent.get('source') == desired['sha'] and
                intent.get('container') == container['Id'] and intent.get('retryAllowed') is False and
                INSTANCE_ID_RE.fullmatch(str(intent.get('instance', ''))) is not None and
                type(intent.get('hostPid')) is int and intent['hostPid'] > 0 and
                type(intent.get('at')) in (int, float) and isinstance(intent.get('startedAt'), str) and
                window['startsAt'] / 1000 <= intent['at'] < durable['completedAt'] and
                isinstance(intent.get('nativeCensus'), dict) and
                intent['nativeCensus'].get('candidateSHA') == NINEF_SHA and
                intent['nativeCensus'].get('sourceSHA256') == NINEF_CENSUS_SOURCE):
            return None
        intent_started = datetime.fromisoformat(intent['startedAt'].replace('Z', '+00:00')).timestamp()
        if not (intent_started < intent['at'] and live['StartedAt'] != intent['startedAt'] and
                live_started > durable['completedAt'] and live['Pid'] != intent['hostPid']):
            return None
        birth = terminal_proc_birth(intent['hostPid'])
        if birth is not None and birth <= intent['at'] + 1:
            return None
        original = 'kernel-enoent' if birth is None else 'pid-reused-after-intent'
        refusal = terminal_checkpoint_refusal(run_id, durable, window, deadline)
        sources = ninef_sources(deadline)
        instances = []
        for url in ('http://127.0.0.1:8080/health',
                    os.environ.get('ENGINE_URL', 'https://engine.smarter.poker').rstrip('/') + '/health'):
            h = json.loads(failed_routine_command(['curl', '--fail', '--silent', '--show-error', '--max-time', '3',
                url + '?terminal-owner=' + str(time.time_ns())], deadline, 1048576))
            m = h.get('maintenance', {}) if isinstance(h, dict) else {}
            if not (h.get('releaseSha') == desired['sha'] and h.get('status') == 'ok' and
                    h.get('running') is True and h.get('liveness') == 'ok' and
                    INSTANCE_ID_RE.fullmatch(str(h.get('instanceId', ''))) is not None and
                    m.get('active') is False and m.get('phase') == 'idle' and m.get('durableConfirmed') is False):
                return None
            instances.append(h['instanceId'])
        if instances[0] != instances[1] or instances[0] == intent['instance']:
            return None
        control = Path(__file__).resolve().parent
        window_ms = {'announcedAt': window['announcedAt'], 'startsAt': window['startsAt'], 'endsAt': window['endsAt']}
        database = json.loads(failed_routine_command([str(control / 'engine-release-database-proof.py'), '--env-file',
            os.environ.get('ENV_FILE', os.environ.get('REPO_DIR', '/opt/club-arena') + '/server/.env'),
            '--sha', desired['sha'], '--instance-id', instances[0], '--terminal-owned-thaw',
            '--window-announced-ms', str(window_ms['announcedAt']), '--window-starts-ms', str(window_ms['startsAt']),
            '--window-ends-ms', str(window_ms['endsAt']),
            '--timeout-seconds', '4', '--max-heartbeat-age-seconds', '15'], deadline))
        if database != {'schema': 'terminal-owned-thaw/v1', 'sha': desired['sha'], 'instanceId': instances[0],
                        'databaseIdle': True, 'freshLeader': True, 'ownedV3Thaw': True, **window_ms}:
            return None
        return {'failureDigest': failed_routine_digest(durable),
                'checkpointIntentDigest': failed_routine_digest(intent),
                'checkpointRefusalDigest': refusal,
                'originalProcess': original,
                'sourceDigests': sources,
                'runtime': {'containerId': container['Id'], 'startedAt': live['StartedAt'], 'hostPid': live['Pid'],
                            'instanceId': instances[0]},
                'database': database}
    except (SystemExit, Exception):
        return None


def terminal_owner_proved(state: dict[str, Any], cycle: dict[str, Any]) -> bool:
    return terminal_owner_proof(state, cycle, time.monotonic() + 45) is not None


def terminal_started_after_failure(value: Any) -> bool:
    """A timezone-aware ISO timestamp strictly after the 9f failure completed."""
    if not isinstance(value, str) or not value:
        return False
    try:
        started = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return False
    return started.tzinfo is not None and started.timestamp() > NINEF_COMPLETED_AT


def terminal_runtime_and_database(proof: dict[str, Any], cycle: dict[str, Any]) -> bool:
    """Exact typed runtime and database witnesses of a recorded 9f proof."""
    runtime, database = proof.get('runtime'), proof.get('database')
    return (isinstance(runtime, dict) and set(runtime) == {'containerId', 'startedAt', 'hostPid', 'instanceId'} and
            isinstance(runtime['containerId'], str) and re.fullmatch('[0-9a-f]{64}', runtime['containerId']) is not None and
            terminal_started_after_failure(runtime['startedAt']) and
            type(runtime['hostPid']) is int and runtime['hostPid'] > 0 and
            isinstance(runtime['instanceId'], str) and INSTANCE_ID_RE.fullmatch(runtime['instanceId']) is not None and
            isinstance(database, dict) and
            database == {'schema': 'terminal-owned-thaw/v1', 'sha': cycle['failure']['recoveredDesiredSha'],
                         'instanceId': runtime['instanceId'], 'databaseIdle': True, 'freshLeader': True,
                         'ownedV3Thaw': True, 'announcedAt': NINEF_WINDOW['announcedAt'],
                         'startsAt': NINEF_WINDOW['startsAt'], 'endsAt': NINEF_WINDOW['endsAt']} and
            all(type(database[k]) is bool for k in ('databaseIdle', 'freshLeader', 'ownedV3Thaw')) and
            all(type(database[k]) is int for k in ('announcedAt', 'startsAt', 'endsAt')))


def validate_routine_resolution(owner: str, resolution: Any, cycle: dict[str, Any]) -> None:
    """The pinned 41349091113-1 record, or an exact terminal-failure proof record."""
    if owner == FAILED_ROUTINE_RUN:
        validate_failed_routine_resolution(resolution, cycle)
        return
    if owner == PREATTACH_RUN:
        validate_preattach_resolution(resolution, cycle)
        return
    if owner == DAILY_REFUSAL_RUN:
        validate_daily_refusal_resolution(resolution, cycle)
        return
    if owner in {CANCELLED_PHASE1_RUN, SECOND_CANCELLED_PHASE1_RUN, CURRENT26_CANCELLED_RUN}:
        validate_cancelled_phase1_resolution(resolution, cycle)
        return
    if owner not in pinned_routine_owners() and isinstance(resolution, dict) \
            and resolution.get('result') == 'cancelled-announcement-proved':
        validate_generic_cancelled_resolution(resolution, cycle)
        return
    if owner not in pinned_routine_owners() and isinstance(resolution, dict) \
            and resolution.get('result') == 'unentered-cycle-proved':
        validate_generic_unentered_resolution(resolution, cycle)
        return
    if owner not in pinned_routine_owners() and isinstance(resolution, dict) \
            and resolution.get('result') == 'preguard-checkpoint-refusal-proved':
        validate_generic_preguard_checkpoint_resolution(resolution, cycle)
        return
    if owner != NINEF_RUN:
        die('routine failure resolution history is invalid')
    ninef_cycle(cycle)
    proof = resolution.get('proof') if isinstance(resolution, dict) else None
    if not (isinstance(resolution, dict) and set(resolution) == TERMINAL_RESOLUTION_KEYS and
            SHA_RE.fullmatch(str(resolution['verifiedByControlSha'])) is not None and
            SHA_RE.fullmatch(str(resolution['verifiedByTargetSha'])) is not None and
            resolution['verifiedByTargetSha'] != NINEF_SHA and
            resolution['schema'] == 1 and resolution['result'] == 'terminal-failure-proved' and
            resolution['originalCycle'] == cycle and cycle.get('runId') == owner and
            cycle.get('status') == 'reserved' and isinstance(cycle.get('failure'), dict) and
            RUN_ID_RE.fullmatch(str(resolution['verifiedByRunId'])) is not None and
            resolution['verifiedByRunId'] != owner and
            INVOCATION_ID_RE.fullmatch(str(resolution['invocationId'])) is not None and
            type(resolution['observedAt']) is int and
            resolution['observedAt'] * 1000 >= (routine_window(cycle) or
                {'endsAt': (int(cycle['startsAt']) + 360) * 1000})['endsAt'] and
            isinstance(proof, dict) and set(proof) == TERMINAL_PROOF_KEYS and
            proof['failureDigest'] == failed_routine_digest(cycle['failure']) and
            proof['originalProcess'] in {'kernel-enoent', 'pid-reused-after-intent'} and
            proof['sourceDigests'] == NINEF_SOURCES and
            all(isinstance(proof[k], str) and re.fullmatch('[0-9a-f]{64}', proof[k]) is not None
                for k in ('checkpointIntentDigest', 'checkpointRefusalDigest')) and
            terminal_runtime_and_database(proof, cycle)):
        die('routine failure resolution history is invalid')
    try:
        receipt = failed_routine_json(terminal_receipt_path(owner, str(resolution['verifiedByRunId']),
                                                            str(resolution['invocationId'])))
    except (SystemExit, Exception):
        receipt = None
    if receipt != resolution:
        die('routine failure resolution history is invalid')


def resolved_failed_source(state: dict[str, Any], sha: str) -> bool:
    """A source whose failed routine owner was resolved can never be replayed."""
    resolutions = state.get('routineFailureResolutions') or {}
    if not isinstance(resolutions, dict):
        die('routine failure resolution history is invalid')
    if sha in state.get("uncommittedCandidateStarts", {}):
        return True
    if resolutions and sha == FAILED_ROUTINE_SHA:
        return True
    return any(isinstance(r, dict) and isinstance(r.get('originalCycle'), dict) and
               sha in {r['originalCycle'].get('sha'), r['originalCycle'].get('controlSha')}
               for r in resolutions.values())


def terminal_receipt_path(owner: str, verifier: str, invocation: str) -> Path:
    return RESULT_DIR / f'{owner}.{verifier}.{invocation}.terminal-resolution.json'


CANCELLED_PHASE1_SOURCES = {
    'engine-release-database-proof.py': '0d719753338f5e56541a0dfb23f2ecb06ae556df1e4a45215f25523f727c24c6',
    'engine-release-lightning-hold.py': '401a15fa30f663b8614cf962ed4650c7f55927d29705ab9bdef9dac0638ee6e4',
    'engine-release-seal.py': '1c21d9e35b1bf76c72df58bab7adc8c09ce2d2bd8d98d5680f8a0c934386e2bb',
    'engine-release-transaction.sh': 'c4fd7e47f65c76d60b1af2bd4d09893038516c57d335e181f0346dd58faae418',
    'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83',
    'engine-release-activation-floor.py': '62394346e0010c650298775c5e9f32eded44c7935d054dd5017fdad4d088695e',
}

CANCELLED_PHASE1_RUN = '41400905104-1'
CANCELLED_PHASE1_SHA = '197c2b733698b9eb62a90f7c91b42b263a028ef1'
CANCELLED_PHASE1_WINDOW = {'announcedAt': 1793602682415, 'startsAt': 1793602802415,
                          'endsAt': 1793603102415, 'verified': True}
CANCELLED_PHASE1_THAW = {'announcedAtMs': 1793602682415, 'freezeStartedAtMs': 1793602802414,
                       'releasedThroughMs': 1793603102414,
                       'ownershipToken': 'b7fd9bbf-95c0-4ff2-af3c-55c7ec4cd01f', 'generation': 1,
                       'thawRecordedAtMs': 1793603023814}


SECOND_CANCELLED_PHASE1_RUN = '41432783729-1'
SECOND_CANCELLED_PHASE1_SHA = '6d178de0dbb1bdb2d74fb9b478a11768619a0a93'
SECOND_CANCELLED_PHASE1_SOURCES = {'engine-release-database-proof.py': '0d719753338f5e56541a0dfb23f2ecb06ae556df1e4a45215f25523f727c24c6', 'engine-release-lightning-hold.py': '401a15fa30f663b8614cf962ed4650c7f55927d29705ab9bdef9dac0638ee6e4', 'engine-release-seal.py': '0811a7631975ba6a52f682324cb0fd43bb3240e7cb40b261d44490a386cd5d70', 'engine-release-transaction.sh': '2b19a4f63063275eb63d9d7d071b8caf57d8389b7d294f39402c8171cd963652', 'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83', 'engine-release-activation-floor.py': '62394346e0010c650298775c5e9f32eded44c7935d054dd5017fdad4d088695e'}
SECOND_CANCELLED_PHASE1_WINDOW = {'announcedAt':1793620685533,'startsAt':1793620805533,'endsAt':1793621105533,'verified':True}
SECOND_CANCELLED_PHASE1_THAW = {'announcedAtMs':1793620685533,'freezeStartedAtMs':1793620805532,
 'releasedThroughMs':1793621105532,'ownershipToken':'c677673f-f968-4a21-a795-c1bcb175f6d9',
 'generation':1,'thawRecordedAtMs':1793621026339}

CURRENT26_CANCELLED_RUN = '41469215622-1'
CURRENT26_CANCELLED_SHA = 'fffcb62ea1f114322da964f9e580f8be3b3e3383'
CURRENT26_CANCELLED_TARGET = '26aaaa3f350ca063caed717b5fcbbcf34b5ae702'
CURRENT26_CANCELLED_SOURCES = {'engine-release-database-proof.py': 'd5b59033d68b071419a2b06aa34dc95cdc20d6ec2bed950fbeddd1035c113456', 'engine-release-lightning-hold.py': '401a15fa30f663b8614cf962ed4650c7f55927d29705ab9bdef9dac0638ee6e4', 'engine-release-seal.py': '990d562162089464377994decf576892ab9b23d8defca0a18389992842745fff', 'engine-release-transaction.sh': '0a78bdb9e5b3ba761ea1daf4bbec55c42b2ee654a98d71a5850a46ef313a5abe', 'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83', 'engine-release-activation-floor.py': '62394346e0010c650298775c5e9f32eded44c7935d054dd5017fdad4d088695e'}
CURRENT26_CANCELLED_WINDOW = {'announcedAt':1793635085893,'startsAt':1793635205893,'endsAt':1793635505893,'verified':True}
CURRENT26_CANCELLED_THAW = {'announcedAtMs':1793635085893,'freezeStartedAtMs':1793635205893,
 'releasedThroughMs':1793635505893,'ownershipToken':'a993695f-4a6a-4cb3-99af-b88765f21c99',
 'generation':1,'thawRecordedAtMs':1793635427493}


def cancelled_phase1_target(owner):
    return CURRENT26_CANCELLED_TARGET if owner == CURRENT26_CANCELLED_RUN else cancelled_phase1_profile(owner)[1]

def cancelled_phase1_profile(owner):
    if owner == CURRENT26_CANCELLED_RUN:
        return (CURRENT26_CANCELLED_RUN, CURRENT26_CANCELLED_SHA, CURRENT26_CANCELLED_SOURCES,
                CURRENT26_CANCELLED_WINDOW, CURRENT26_CANCELLED_THAW)
    if owner == SECOND_CANCELLED_PHASE1_RUN:
        return (SECOND_CANCELLED_PHASE1_RUN, SECOND_CANCELLED_PHASE1_SHA, SECOND_CANCELLED_PHASE1_SOURCES,
                SECOND_CANCELLED_PHASE1_WINDOW, SECOND_CANCELLED_PHASE1_THAW)
    if owner != CANCELLED_PHASE1_RUN:
        raise ValueError('unqualified cancelled announcement owner')
    return (CANCELLED_PHASE1_RUN, CANCELLED_PHASE1_SHA, CANCELLED_PHASE1_SOURCES,
            CANCELLED_PHASE1_WINDOW, CANCELLED_PHASE1_THAW)


def cancelled_phase1_started_at(value: Any, observed_at: int, owner: str = CANCELLED_PHASE1_RUN) -> bool:
    owner_run, owner_sha, owner_sources, owner_window, owner_thaw = cancelled_phase1_profile(owner)
    if not isinstance(value, str):
        return False
    try:
        started = datetime.fromisoformat(value.replace('Z', '+00:00'))
        # Cancellation preserves the current runtime throughout its own operation.
        # It does not require the preannouncement process to have survived.
        birth = started.timestamp() * 1000
        return (started.tzinfo is not None and 0 < birth < observed_at * 1000
            and (birth < owner_window['announcedAt']
                 or birth > max(owner_window['endsAt'], owner_thaw['thawRecordedAtMs'])))
    except ValueError:
        return False


def cancelled_phase1_cycle(cycle: Any) -> None:
    owner_run, owner_sha, owner_sources, owner_window, owner_thaw = cancelled_phase1_profile(cycle['runId'])
    failed_routine_require(cycle == {'kind': 'hourly-reset', 'policyId': SCHEDULE_POLICY_ID,
        'policyDigest': NINEF_POLICY_DIGEST, 'startsAt': owner_window['startsAt']//3600000*3600, 'endsAt': owner_window['startsAt']//3600000*3600+300,
        'runId': owner_run, 'sha': cancelled_phase1_target(owner_run), 'controlSha': owner_sha,
        'status': 'reserved', 'window': owner_window})


def validate_cancelled_phase1_resolution(resolution: Any, cycle: dict[str, Any], verify_receipt: bool = True) -> None:
    owner_run, owner_sha, owner_sources, owner_window, owner_thaw = cancelled_phase1_profile(cycle['runId'])
    cancelled_phase1_cycle(cycle)
    failed_routine_require(isinstance(resolution, dict) and set(resolution) == TERMINAL_RESOLUTION_KEYS
        and resolution['schema'] == 1 and resolution['result'] == 'cancelled-announcement-proved'
        and resolution['originalCycle'] == cycle and RUN_ID_RE.fullmatch(str(resolution['verifiedByRunId']))
        and resolution['verifiedByRunId'] != owner_run
        and SHA_RE.fullmatch(str(resolution['verifiedByControlSha']))
        and SHA_RE.fullmatch(str(resolution['verifiedByTargetSha']))
        and not ({owner_sha, cancelled_phase1_target(owner_run)} & {resolution['verifiedByControlSha'], resolution['verifiedByTargetSha']})
        and INVOCATION_ID_RE.fullmatch(str(resolution['invocationId']))
        and type(resolution['observedAt']) is int and resolution['observedAt'] * 1000 > owner_window['endsAt'])
    proof = resolution['proof']
    failed_routine_require(isinstance(proof, dict) and set(proof) == {'schema', 'originalCycle', 'recordHashes',
        'retainedHashes', 'sourceHashes', 'thaw', 'container', 'instanceId', 'qualifiedHelperSHA256'}
        and proof['schema'] == 'cancelled-routine-announcement-proof/v1' and proof['originalCycle'] == cycle
        and proof['sourceHashes'] == owner_sources
        and proof['thaw'] == owner_thaw and INSTANCE_ID_RE.fullmatch(str(proof['instanceId']))
        and isinstance(proof['container'], dict) and set(proof['container']) == {'id', 'startedAt', 'image'}
        and CONTAINER_ID_RE.fullmatch(str(proof['container']['id']))
        and cancelled_phase1_started_at(proof['container']['startedAt'], resolution['observedAt'], owner_run)
        and proof['container']['image'] == 'sha256:2eb1c5a7279032240c5fff8a6b3ecf5dc6af735cc1227a51430d50dcae1b065b'
        and re.fullmatch('[0-9a-f]{64}', str(proof['qualifiedHelperSHA256'])))
    for key, names in (('recordHashes', {'receipt','intent','quiescent','stop-issued'}),
                       ('retainedHashes', {'entryHash','reservationHash','releasedHoldHash'})):
        failed_routine_require(isinstance(proof[key], dict) and set(proof[key]) == names
            and all(re.fullmatch('[0-9a-f]{64}', str(v)) for v in proof[key].values()))
    if verify_receipt:
        path = terminal_receipt_path(owner_run, resolution['verifiedByRunId'], resolution['invocationId'])
        failed_routine_require(failed_routine_json(path) == resolution)


def cancelled_phase1_proof(args: argparse.Namespace, state: dict[str, Any], cycle: dict[str, Any],
                           deadline: float) -> dict[str, Any]:
    owner_run, owner_sha, owner_sources, owner_window, owner_thaw = cancelled_phase1_profile(cycle['runId'])
    cancelled_phase1_cycle(cycle)
    failed_routine_require(state.get('pending') is None and state.get('finalization') is None
        and owner_run not in state['committedRuns']
        and time.time() * 1000 > owner_window['endsAt'])
    # Execute only this transaction's immutable protected source, not whatever
    # another checkout or later main currently contains. The helper is read-only
    # in this mode; cancellation must already have its own durable receipt.
    source = failed_routine_command(['git', '-C', args.repo, 'show',
        str(args.control_sha) + ':scripts/ci/withdraw-waiting-engine-release.py'], deadline, 131072)
    proof = json.loads(failed_routine_command([sys.executable, '-B', '-c', source,
        '--phase1-cancellation-proof'] + ([owner_run] if owner_run in {SECOND_CANCELLED_PHASE1_RUN, CURRENT26_CANCELLED_RUN} else []), deadline, 16384, max_seconds=30))
    failed_routine_require(proof.get('originalCycle') == cycle)
    proof['qualifiedHelperSHA256'] = hashlib.sha256(source.encode()).hexdigest()
    return proof



# Any later expired announcement-only owner is resolved by the same proof
# without a per-run code change. Its identity comes from its own immutable
# cycle; its sources from protected-main Git at its own control; its window
# and thaw must agree exactly (no early-timer tolerance); the withdrawal
# receipt, trace absence, unchanged runtime and seal checks are those of the
# pinned owners above. Pinned historical owners keep their exact profiles.
GENERIC_CANCELLED_SOURCE_NAMES = frozenset(CANCELLED_PHASE1_SOURCES)
GENERIC_CANCELLED_CYCLE_KEYS = frozenset({'kind', 'policyId', 'policyDigest', 'startsAt', 'endsAt', 'runId',
                                          'sha', 'controlSha', 'status', 'window'})
UUID_RE = re.compile(r'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$')


def pinned_routine_owners() -> set[str]:
    return {FAILED_ROUTINE_RUN, NINEF_RUN, CANCELLED_PHASE1_RUN, SECOND_CANCELLED_PHASE1_RUN,
            CURRENT26_CANCELLED_RUN, DAILY_REFUSAL_RUN, PREATTACH_RUN}


def generic_cancelled_cycle(cycle: Any) -> dict[str, int]:
    failed_routine_require(generic_cancelled_shape(cycle))
    return cycle['window']


def generic_cancelled_shape(cycle: Any) -> bool:
    w = cycle.get('window') if isinstance(cycle, dict) else None
    ints = lambda *v: all(type(x) is int for x in v)
    return bool(isinstance(cycle, dict) and set(cycle) == GENERIC_CANCELLED_CYCLE_KEYS
        and RUN_ID_RE.fullmatch(str(cycle['runId'])) is not None and cycle['runId'] not in pinned_routine_owners()
        and SHA_RE.fullmatch(str(cycle['sha'])) is not None and SHA_RE.fullmatch(str(cycle['controlSha'])) is not None
        and cycle['kind'] == 'hourly-reset' and cycle['policyId'] == SCHEDULE_POLICY_ID
        and cycle['policyDigest'] == NINEF_POLICY_DIGEST and cycle['status'] == 'reserved'
        and isinstance(w, dict) and set(w) == {'announcedAt', 'startsAt', 'endsAt', 'verified'} and w['verified'] is True
        and ints(w['announcedAt'], w['startsAt'], w['endsAt'], cycle['startsAt'], cycle['endsAt'])
        and w['announcedAt'] > 0 and w['startsAt'] == w['announcedAt'] + 120000 and w['endsAt'] == w['announcedAt'] + 420000
        and cycle['startsAt'] == w['startsAt'] // 3600000 * 3600 and cycle['endsAt'] == cycle['startsAt'] + 300)


def generic_cancelled_candidate(state: dict[str, Any], cycle: dict[str, Any]) -> bool:
    """Only an expired, never-committed announcement-only owner with a withdrawal receipt."""
    if not generic_cancelled_shape(cycle):
        return False
    w = cycle['window']
    return (cycle['runId'] not in state['committedRuns'] and time.time() * 1000 > w['endsAt']
            and os.path.lexists(STATE_DIR / 'engine-release-cancellations' / (cycle['runId'] + '.receipt.json')))


def generic_cancelled_started_at(value: Any, observed_at: int, window: dict[str, int], thaw: dict[str, Any]) -> bool:
    if not isinstance(value, str):
        return False
    try:
        started = datetime.fromisoformat(value.replace('Z', '+00:00'))
        birth = started.timestamp() * 1000
        return (started.tzinfo is not None and 0 < birth < observed_at * 1000
            and (birth < window['announcedAt'] or birth > max(window['endsAt'], thaw['thawRecordedAtMs'])))
    except (ValueError, KeyError, TypeError):
        return False


def validate_generic_cancelled_resolution(resolution: Any, cycle: dict[str, Any], verify_receipt: bool = True) -> None:
    w = generic_cancelled_cycle(cycle)
    owner_run = cycle['runId']
    failed_routine_require(isinstance(resolution, dict) and set(resolution) == TERMINAL_RESOLUTION_KEYS
        and resolution['schema'] == 1 and resolution['result'] == 'cancelled-announcement-proved'
        and resolution['originalCycle'] == cycle and RUN_ID_RE.fullmatch(str(resolution['verifiedByRunId']))
        and resolution['verifiedByRunId'] != owner_run
        and SHA_RE.fullmatch(str(resolution['verifiedByControlSha']))
        and SHA_RE.fullmatch(str(resolution['verifiedByTargetSha']))
        and not {cycle['sha'], cycle['controlSha']} & {resolution['verifiedByControlSha'], resolution['verifiedByTargetSha']}
        and INVOCATION_ID_RE.fullmatch(str(resolution['invocationId']))
        and type(resolution['observedAt']) is int and resolution['observedAt'] * 1000 > w['endsAt'])
    proof = resolution['proof']
    failed_routine_require(isinstance(proof, dict) and set(proof) == {'schema', 'originalCycle', 'recordHashes',
        'retainedHashes', 'sourceHashes', 'thaw', 'container', 'instanceId', 'qualifiedHelperSHA256'}
        and proof['schema'] == 'cancelled-routine-announcement-proof/v1' and proof['originalCycle'] == cycle
        and isinstance(proof['sourceHashes'], dict) and set(proof['sourceHashes']) == GENERIC_CANCELLED_SOURCE_NAMES
        and all(re.fullmatch('[0-9a-f]{64}', str(v)) for v in proof['sourceHashes'].values())
        and INSTANCE_ID_RE.fullmatch(str(proof['instanceId']))
        and isinstance(proof['container'], dict) and set(proof['container']) == {'id', 'startedAt', 'image'}
        and CONTAINER_ID_RE.fullmatch(str(proof['container']['id']))
        and re.fullmatch(r'sha256:[0-9a-f]{64}', str(proof['container']['image']))
        and re.fullmatch('[0-9a-f]{64}', str(proof['qualifiedHelperSHA256'])))
    thaw = proof['thaw']
    failed_routine_require(isinstance(thaw, dict) and set(thaw) == {'announcedAtMs', 'freezeStartedAtMs',
        'releasedThroughMs', 'ownershipToken', 'generation', 'thawRecordedAtMs'}
        and thaw['announcedAtMs'] == w['announcedAt'] and thaw['freezeStartedAtMs'] == w['startsAt']
        and thaw['releasedThroughMs'] == w['endsAt'] and isinstance(thaw['ownershipToken'], str)
        and UUID_RE.fullmatch(thaw['ownershipToken'].lower()) is not None
        and type(thaw['generation']) is int and thaw['generation'] > 0
        and type(thaw['thawRecordedAtMs']) is int
        and w['startsAt'] <= thaw['thawRecordedAtMs'] <= resolution['observedAt'] * 1000
        and generic_cancelled_started_at(proof['container']['startedAt'], resolution['observedAt'], w, thaw))
    for key, names in (('recordHashes', {'receipt','intent','quiescent','stop-issued'}),
                       ('retainedHashes', {'entryHash','reservationHash','releasedHoldHash'})):
        failed_routine_require(isinstance(proof[key], dict) and set(proof[key]) == names
            and all(re.fullmatch('[0-9a-f]{64}', str(v)) for v in proof[key].values()))
    if verify_receipt:
        path = terminal_receipt_path(owner_run, resolution['verifiedByRunId'], resolution['invocationId'])
        failed_routine_require(failed_routine_json(path) == resolution)


def generic_cancelled_sources(repo: str, control: str, deadline: float) -> dict[str, str]:
    """The owner's own protected-main sources, never caller-supplied hashes."""
    failed_routine_require(SHA_RE.fullmatch(control) is not None)
    failed_routine_command(['git', '-C', repo, 'merge-base', '--is-ancestor', control, 'refs/remotes/origin/main'], deadline)
    hashes = {}
    for name in sorted(GENERIC_CANCELLED_SOURCE_NAMES):
        left = deadline - time.monotonic()
        failed_routine_require(left > 0)
        try:
            raw = subprocess.run(['git', '-C', repo, 'show', control + ':server/scripts/' + name],
                                 stdin=subprocess.DEVNULL, capture_output=True, check=True, timeout=min(left, 10),
                                 env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'LC_ALL': 'C'}).stdout
        except (OSError, subprocess.SubprocessError):
            die('exact failed routine native proof failed or timed out')
        failed_routine_require(0 < len(raw) < 262144)
        hashes[name] = hashlib.sha256(raw).hexdigest()
    return hashes


def generic_cancelled_proof(args: argparse.Namespace, state: dict[str, Any], cycle: dict[str, Any],
                            deadline: float) -> dict[str, Any]:
    w = generic_cancelled_cycle(cycle)
    owner_run = cycle['runId']
    failed_routine_require(state.get('pending') is None and state.get('finalization') is None
        and owner_run not in state['committedRuns'] and time.time() * 1000 > w['endsAt'])
    source = failed_routine_command(['git', '-C', args.repo, 'show',
        str(args.control_sha) + ':scripts/ci/withdraw-waiting-engine-release.py'], deadline, 131072)
    proof = json.loads(failed_routine_command([sys.executable, '-B', '-c', source,
        '--phase1-cancellation-proof', owner_run], deadline, 16384, max_seconds=30))
    failed_routine_require(isinstance(proof, dict) and proof.get('originalCycle') == cycle
        and proof.get('sourceHashes') == generic_cancelled_sources(args.repo, cycle['controlSha'], deadline)
        and isinstance(proof.get('container'), dict) and proof['container'].get('image') == state['desired']['imageId'])
    proof['qualifiedHelperSHA256'] = hashlib.sha256(source.encode()).hexdigest()
    return proof


DAILY_REFUSAL_RUN = '41421209814-1'
DAILY_REFUSAL_SHA = 'e64c2a68a211040b645efac90cef44206fc8b4a1'
DAILY_REFUSAL_FAILURE = '98f2ad6cc2a23ea4e8c8c68ab08439d9c95e850e5753d249d065ebfa303964f2'
DAILY_REFUSAL_WINDOW = {'announcedAt':1793613480003,'startsAt':1793613600003,'endsAt':1793613900003}
DAILY_REFUSAL_SOURCES = {
    'engine-release-transaction.sh': 'ba136c0a67c835c9a33b23876b5b02a52309034fc747afa2727d001068a6383d',
    'engine-release-seal.py': '61f2e81984f36cd990e4bbbd9f22bf8721917c2b854bc38706fd22d5c92b41ba',
    'engine-release-activation-floor.py': '62394346e0010c650298775c5e9f32eded44c7935d054dd5017fdad4d088695e',
    'engine-release-database-proof.py': '0d719753338f5e56541a0dfb23f2ecb06ae556df1e4a45215f25523f727c24c6',
    'engine-release-unit-wrapper.sh': 'e9abdbe2c97c3594b32a920285e78858c1e0497f00a8a7edd21b99ba0491dc9c',
    'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83',
    'install-engine-supervisor.sh': 'b47aaaca69f749a60e72ef983719b4d18c00b75d7c1d19958508a45930d0fa96',
    'install-engine-intake.sh': '5476d126add86e299728488c97eb0f47c2bdeddb3b0b28d680db6535eea47f1b',
}

def daily_refusal_cycle(cycle: Any) -> None:
    failed_routine_require(isinstance(cycle,dict) and cycle.get('runId')==DAILY_REFUSAL_RUN
        and cycle.get('sha')==cycle.get('controlSha')==DAILY_REFUSAL_SHA
        and cycle.get('startsAt')==1793613600 and cycle.get('endsAt')==1793613900
        and cycle.get('status')=='reserved' and cycle.get('window') is None
        and cycle.get('kind')=='hourly-reset' and cycle.get('policyId')==SCHEDULE_POLICY_ID
        and cycle.get('policyDigest')==NINEF_POLICY_DIGEST
        and failed_routine_digest(cycle.get('failure'))==DAILY_REFUSAL_FAILURE)


def validate_daily_refusal_resolution(value: Any, cycle: dict[str,Any], verify_receipt: bool = True) -> None:
    daily_refusal_cycle(cycle)
    failed_routine_require(isinstance(value,dict) and set(value)==TERMINAL_RESOLUTION_KEYS
        and value['schema']==1 and value['result']=='unentered-daily-cycle-proved' and value['originalCycle']==cycle
        and RUN_ID_RE.fullmatch(str(value['verifiedByRunId'])) and value['verifiedByRunId']!=DAILY_REFUSAL_RUN
        and all(SHA_RE.fullmatch(str(value[k])) and value[k]!=DAILY_REFUSAL_SHA
                for k in ('verifiedByControlSha','verifiedByTargetSha'))
        and INVOCATION_ID_RE.fullmatch(str(value['invocationId']))
        and type(value['observedAt']) is int and value['observedAt']>1793613966)
    proof=value['proof']
    failed_routine_require(isinstance(proof,dict) and set(proof)=={'failureDigest','sourceDigests','nativeDigest','runtime','database'}
        and proof['failureDigest']==DAILY_REFUSAL_FAILURE and proof['sourceDigests']==DAILY_REFUSAL_SOURCES
        and re.fullmatch('[0-9a-f]{64}',str(proof['nativeDigest'])))
    runtime=proof['runtime']
    failed_routine_require(isinstance(runtime,dict) and set(runtime)=={'containerId','startedAt','instanceId'}
        and CONTAINER_ID_RE.fullmatch(str(runtime['containerId'])) and INSTANCE_ID_RE.fullmatch(str(runtime['instanceId'])))
    birth=datetime.fromisoformat(runtime['startedAt'].replace('Z','+00:00'))
    failed_routine_require(birth.tzinfo is not None and 0<birth.timestamp()<value['observedAt'])
    expected={'schema':'terminal-owned-thaw/v1','sha':FAILED_ROUTINE_DESIRED,'instanceId':runtime['instanceId'],
              'databaseIdle':True,'freshLeader':True,'ownedV3Thaw':True,**DAILY_REFUSAL_WINDOW}
    failed_routine_require(proof['database']==expected
        and all(type(proof['database'][k]) is bool for k in ('databaseIdle','freshLeader','ownedV3Thaw'))
        and all(type(proof['database'][k]) is int for k in DAILY_REFUSAL_WINDOW))
    if verify_receipt:
        failed_routine_require(failed_routine_json(terminal_receipt_path(DAILY_REFUSAL_RUN,value['verifiedByRunId'],value['invocationId']))==value)


def daily_refusal_proof(state: dict[str,Any], cycle: dict[str,Any], deadline: float) -> dict[str,Any] | None:
    # This controller never bound or entered the naturally scheduled daily
    # break. Preserve that fact: do not synthesize an announcement or rewrite
    # the cycle. Full thaw of the actual daily break is additional proof.
    try:
        daily_refusal_cycle(cycle)
        failed_routine_require(state.get('pending') is None and state.get('finalization') is None
            and DAILY_REFUSAL_RUN not in state['committedRuns'] and time.time()>1793613966
            and state['desired']['sha']==FAILED_ROUTINE_DESIRED and state['desired']['imageId']==FAILED_ROUTINE_IMAGE
            and load_failure(DAILY_REFUSAL_RUN)==cycle['failure'])
        sources=ninef_sources(deadline,DAILY_REFUSAL_SHA,DAILY_REFUSAL_SOURCES)
        # Positive native quiescence and absence of every original request,
        # checkpoint/retirement intent, hold, image lease and recovery notice.
        native=failed_routine_native_proof(deadline,DAILY_REFUSAL_RUN)
        runtime=failed_routine_runtime(deadline)  # Includes closed Inspector.
        control=Path(__file__).resolve().parent
        raw=failed_routine_command([str(control/'engine-release-database-proof.py'),'--env-file',
            os.environ.get('ENV_FILE',os.environ.get('REPO_DIR','/opt/club-arena')+'/server/.env'),
            '--sha',FAILED_ROUTINE_DESIRED,'--instance-id',runtime['instanceId'],'--terminal-owned-thaw',
            '--window-announced-ms',str(DAILY_REFUSAL_WINDOW['announcedAt']),
            '--window-starts-ms',str(DAILY_REFUSAL_WINDOW['startsAt']),
            '--window-ends-ms',str(DAILY_REFUSAL_WINDOW['endsAt']),
            '--timeout-seconds','4','--max-heartbeat-age-seconds','15'],deadline)
        return {'failureDigest':DAILY_REFUSAL_FAILURE,'sourceDigests':sources,
                'nativeDigest':failed_routine_digest(native),'runtime':runtime,'database':json.loads(raw)}
    except (SystemExit,Exception):
        return None



# A GENERIC NEVER-ANNOUNCED FAILED OWNER (2026-11-02). A run that reserved its
# hourly cycle and failed before any announcement (no bound window, no
# recovery-window reservation, no checkpoint) owns nothing at runtime, yet its
# 'reserved' cycle stayed authoritative and refused every later release
# (41511864834-1). It resolves only by the same positive witnesses as the
# pinned unentered daily profile: its canonical durable failure, the sealed
# desired runtime it recovered, native quiescence with every request, intent,
# checkpoint, retirement, hold, pin, lease and recovery-window trace absent,
# both health views on one idle unfrozen instance with Inspector closed, and
# the database idle with a fresh leader. Unproved owners stay authoritative.
GENERIC_UNENTERED_CYCLE_KEYS = {'controlSha', 'endsAt', 'failure', 'kind', 'policyDigest', 'policyId', 'runId',
                                'sha', 'startsAt', 'status'}
GENERIC_UNENTERED_FAILURE_KEYS = {'completedAt', 'controlSha', 'invocationId', 'recoveredDesiredImageId',
                                  'recoveredDesiredSha', 'result', 'runId', 'schema', 'sha', 'transactionExitStatus'}
GENERIC_UNENTERED_PROOF_KEYS = {'failureDigest', 'nativeDigest', 'runtime', 'database'}


def generic_unentered_shape(cycle: Any) -> bool:
    f = cycle.get('failure') if isinstance(cycle, dict) else None
    try:
        return bool(isinstance(cycle, dict) and set(cycle) == GENERIC_UNENTERED_CYCLE_KEYS
            and RUN_ID_RE.fullmatch(str(cycle['runId'])) is not None and cycle['runId'] not in pinned_routine_owners()
            and SHA_RE.fullmatch(str(cycle['sha'])) is not None and SHA_RE.fullmatch(str(cycle['controlSha'])) is not None
            and cycle['kind'] == 'hourly-reset' and cycle['policyId'] == SCHEDULE_POLICY_ID
            and cycle['policyDigest'] == NINEF_POLICY_DIGEST and cycle['status'] == 'reserved'
            and type(cycle['startsAt']) is int and type(cycle['endsAt']) is int
            and cycle['startsAt'] > 0 and cycle['startsAt'] % 3600 == 0 and cycle['endsAt'] == cycle['startsAt'] + 300
            and isinstance(f, dict) and set(f) == GENERIC_UNENTERED_FAILURE_KEYS
            and f['schema'] == 1 and f['result'] == 'failed' and f['runId'] == cycle['runId']
            and f['sha'] == cycle['sha'] and f['controlSha'] == cycle['controlSha']
            and type(f['completedAt']) is int and f['completedAt'] > 0
            and type(f['transactionExitStatus']) is int and f['transactionExitStatus'] != 0
            and INVOCATION_ID_RE.fullmatch(str(f['invocationId'])) is not None
            and SHA_RE.fullmatch(str(f['recoveredDesiredSha'])) is not None
            and re.fullmatch('sha256:[0-9a-f]{64}', str(f['recoveredDesiredImageId'])) is not None)
    except (KeyError, TypeError):
        return False


def generic_unentered_candidate(state: dict[str, Any], cycle: dict[str, Any]) -> bool:
    """Only an expired, never-committed, never-announced failed generic owner."""
    return (generic_unentered_shape(cycle) and cycle['runId'] not in state['committedRuns']
            and time.time() * 1000 > cycle['endsAt'] * 1000 + TERMINAL_OWNER_SETTLE_MS)


def validate_generic_unentered_resolution(value: Any, cycle: dict[str, Any], verify_receipt: bool = True) -> None:
    failed_routine_require(generic_unentered_shape(cycle))
    owner = cycle['runId']
    failed_routine_require(isinstance(value, dict) and set(value) == TERMINAL_RESOLUTION_KEYS
        and value['schema'] == 1 and value['result'] == 'unentered-cycle-proved' and value['originalCycle'] == cycle
        and RUN_ID_RE.fullmatch(str(value['verifiedByRunId'])) is not None and value['verifiedByRunId'] != owner
        and all(SHA_RE.fullmatch(str(value[k])) is not None for k in ('verifiedByControlSha', 'verifiedByTargetSha'))
        and not {cycle['sha'], cycle['controlSha']} & {value['verifiedByControlSha'], value['verifiedByTargetSha']}
        and INVOCATION_ID_RE.fullmatch(str(value['invocationId'])) is not None
        and type(value['observedAt']) is int
        and value['observedAt'] * 1000 > cycle['endsAt'] * 1000 + TERMINAL_OWNER_SETTLE_MS)
    proof = value['proof']
    failed_routine_require(isinstance(proof, dict) and set(proof) == GENERIC_UNENTERED_PROOF_KEYS
        and proof['failureDigest'] == failed_routine_digest(cycle['failure'])
        and re.fullmatch('[0-9a-f]{64}', str(proof['nativeDigest'])) is not None)
    runtime = proof['runtime']
    failed_routine_require(isinstance(runtime, dict) and set(runtime) == {'containerId', 'startedAt', 'instanceId'}
        and CONTAINER_ID_RE.fullmatch(str(runtime['containerId'])) is not None
        and INSTANCE_ID_RE.fullmatch(str(runtime['instanceId'])) is not None and isinstance(runtime['startedAt'], str))
    try:
        birth = datetime.fromisoformat(runtime['startedAt'].replace('Z', '+00:00'))
    except ValueError:
        die('exact failed routine custody is unproved')
    failed_routine_require(birth.tzinfo is not None and 0 < birth.timestamp() < value['observedAt'])
    failed_routine_require(proof['database'] == {'schema': 'failed-routine-database-idle/v1',
        'sha': cycle['failure']['recoveredDesiredSha'], 'instanceId': runtime['instanceId'],
        'databaseIdle': True, 'freshLeader': True})
    if verify_receipt:
        failed_routine_require(failed_routine_json(terminal_receipt_path(owner, value['verifiedByRunId'],
                                                                         value['invocationId'])) == value)


def generic_unentered_proof(state: dict[str, Any], cycle: dict[str, Any], deadline: float) -> dict[str, Any] | None:
    # Never synthesize an announcement or rewrite the cycle; the proof only
    # observes that the run left nothing behind and the floor is idle.
    try:
        failed_routine_require(generic_unentered_candidate(state, cycle))
        owner = cycle['runId']
        failure = cycle['failure']
        desired = state['desired']
        failed_routine_require(state.get('pending') is None and state.get('finalization') is None
            and load_failure(owner) == failure
            and desired['sha'] == failure['recoveredDesiredSha'] == FAILED_ROUTINE_DESIRED
            and desired['imageId'] == failure['recoveredDesiredImageId'] == FAILED_ROUTINE_IMAGE)
        native = failed_routine_native_proof(deadline, owner)
        runtime = failed_routine_runtime(deadline)  # Includes closed Inspector.
        failed_routine_database(runtime, deadline)
        return {'failureDigest': failed_routine_digest(failure), 'nativeDigest': failed_routine_digest(native),
                'runtime': runtime,
                'database': {'schema': 'failed-routine-database-idle/v1', 'sha': FAILED_ROUTINE_DESIRED,
                             'instanceId': runtime['instanceId'], 'databaseIdle': True, 'freshLeader': True}}
    except (SystemExit, Exception):
        return None


# A GENERIC PRE-GUARD CHECKPOINT REFUSAL OWNER (2026-11-02). A run that bound a
# routine window, wrote its one-shot legacy checkpoint intent, and refused
# before guardCall with checkpointInvoked:false, inspectorClosed:true and
# cleanupConnections:0 (41535679597-1) never invoked the checkpoint or mutated
# the serving runtime. Once its window has expired, the owned v3 thaw is
# recorded in engine_maintenance_thaws, the serving runtime is idle/unfrozen
# with Inspector closed, and all active release/intake units and request/intent/
# pin/lease/hold artifacts are absent, it resolves by positive proof.
GENERIC_PREGUARD_CYCLE_KEYS = GENERIC_UNENTERED_CYCLE_KEYS | {'window'}
GENERIC_PREGUARD_PROOF_KEYS = {'failureDigest', 'checkpointIntentDigest', 'checkpointRefusalDigest',
                               'nativeDigest', 'runtime', 'database'}


def generic_preguard_checkpoint_shape(cycle: Any) -> bool:
    f = cycle.get('failure') if isinstance(cycle, dict) else None
    w = cycle.get('window') if isinstance(cycle, dict) else None
    try:
        return bool(isinstance(cycle, dict) and set(cycle) == GENERIC_PREGUARD_CYCLE_KEYS
            and RUN_ID_RE.fullmatch(str(cycle['runId'])) is not None and cycle['runId'] not in pinned_routine_owners()
            and SHA_RE.fullmatch(str(cycle['sha'])) is not None and SHA_RE.fullmatch(str(cycle['controlSha'])) is not None
            and cycle['kind'] == 'hourly-reset' and cycle['policyId'] == SCHEDULE_POLICY_ID
            and cycle['policyDigest'] == NINEF_POLICY_DIGEST and cycle['status'] == 'reserved'
            and type(cycle['startsAt']) is int and type(cycle['endsAt']) is int
            and cycle['startsAt'] > 0 and cycle['startsAt'] % 3600 == 0 and cycle['endsAt'] == cycle['startsAt'] + 300
            and isinstance(w, dict) and set(w) == {'announcedAt', 'startsAt', 'endsAt', 'verified'}
            and w['verified'] is True and all(type(w[k]) is int for k in ('announcedAt', 'startsAt', 'endsAt'))
            and w['announcedAt'] > 0 and w['startsAt'] == w['announcedAt'] + 120000
            and w['endsAt'] == w['announcedAt'] + 420000
            and cycle['startsAt'] == w['startsAt'] // 3600000 * 3600
            and isinstance(f, dict) and set(f) == GENERIC_UNENTERED_FAILURE_KEYS
            and f['schema'] == 1 and f['result'] == 'failed' and f['runId'] == cycle['runId']
            and f['sha'] == cycle['sha'] and f['controlSha'] == cycle['controlSha']
            and type(f['completedAt']) is int and f['completedAt'] > 0
            and type(f['transactionExitStatus']) is int and f['transactionExitStatus'] != 0
            and INVOCATION_ID_RE.fullmatch(str(f['invocationId'])) is not None
            and SHA_RE.fullmatch(str(f['recoveredDesiredSha'])) is not None
            and re.fullmatch('sha256:[0-9a-f]{64}', str(f['recoveredDesiredImageId'])) is not None)
    except (KeyError, TypeError):
        return False


def generic_preguard_checkpoint_candidate(state: dict[str, Any], cycle: dict[str, Any]) -> bool:
    """Only an expired, never-committed routine owner with a bound window and legacy checkpoint intent."""
    if not generic_preguard_checkpoint_shape(cycle):
        return False
    w = cycle['window']
    request_root = Path(os.environ.get('ENGINE_RELEASE_REQUEST_ROOT', str(STATE_DIR / 'engine-release-requests')))
    return (cycle['runId'] not in state['committedRuns']
            and time.time() * 1000 > w['endsAt'] + TERMINAL_OWNER_SETTLE_MS
            and os.path.lexists(request_root / (cycle['runId'] + '.legacy-checkpoint-intent')))


def generic_preguard_checkpoint_native_proof(deadline: float, owner: str) -> dict[str, Any]:
    units = {}
    for prefix, extension in (('release', 'service'), ('intake', 'service'), ('intake', 'path')):
        unit = f'club-arena-engine-{prefix}-v1@{owner}.{extension}'
        value = failed_routine_unit_snapshot(unit, deadline)
        if extension == 'service':
            failed_routine_service_empty(unit, value, deadline)
        require_absent(Path('/etc/systemd/system/multi-user.target.wants') / unit)
        require_absent(Path('/etc/systemd/system/paths.target.wants') / unit)
        units[unit] = value
    request_root = Path(os.environ.get('ENGINE_RELEASE_REQUEST_ROOT', str(STATE_DIR / 'engine-release-requests')))
    intake_root = Path(os.environ.get('ENGINE_RELEASE_INTAKE_ROOT', str(STATE_DIR / 'engine-intake-requests')))
    pin_root = Path(os.environ.get('ENGINE_RELEASE_PIN_ROOT', str(STATE_DIR / 'engine-release-generation-pins')))
    lease_root = Path(os.environ.get('ENGINE_RELEASE_IMAGE_LEASE_ROOT', str(STATE_DIR / 'engine-image-leases')))
    roots = (
        (request_root, ('request', 'intent', 'activation-entry', 'drill',
         'main-inspector-retirement-intent', 'main-inspector-retirement-receipt',
         'lightning-hold.json', 'break-deadline', 'awaiting-certificate')),
        (intake_root, ('request', 'intent')),
        (pin_root, ('generation',)),
        (lease_root, ('lease',)))
    for root, suffixes in roots:
        for suffix in suffixes:
            require_absent(root / (owner + '.' + suffix))
    return units


def generic_preguard_checkpoint_refusal(run_id: str, failure: dict[str, Any], window: dict[str, Any],
                                        deadline: float) -> str:
    """The failed invocation's journal holds exactly one pre-guard legacy
    checkpoint refusal with checkpointInvoked:false, inspectorClosed:true and
    cleanupConnections:0."""
    unit = f'club-arena-engine-release-v1@{run_id}.service'
    raw = failed_routine_command(['journalctl', '--unit=' + unit, '_SYSTEMD_INVOCATION_ID=' + failure['invocationId'],
        '--no-pager', '--output=json',
        '--output-fields=MESSAGE,_SYSTEMD_UNIT,_SYSTEMD_INVOCATION_ID,__REALTIME_TIMESTAMP',
        '--lines=4', '--grep="checkpointInvoked":'], deadline, 65536)
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    failed_routine_require(len(rows) == 1)
    row = rows[0]
    outcome = json.loads(row.get('MESSAGE', ''))
    stamp = str(row.get('__REALTIME_TIMESTAMP', ''))
    failed_routine_require(row.get('_SYSTEMD_UNIT') == unit
        and row.get('_SYSTEMD_INVOCATION_ID') == failure['invocationId'] and stamp.isdigit()
        and window['startsAt'] * 1000 <= int(stamp) <= (failure['completedAt'] + 1) * 1000000
        and isinstance(outcome, dict) and outcome.get('ok') is False and outcome.get('retryAllowed') is False
        and outcome.get('checkpointInvoked') is False and outcome.get('inspectorClosed') is True
        and outcome.get('cleanupConnections') == 0 and 'checkpoint' not in outcome and 'progress' not in outcome
        and isinstance(outcome.get('reason'), str) and bool(outcome['reason']))
    return failed_routine_digest(row)


def validate_generic_preguard_checkpoint_resolution(value: Any, cycle: dict[str, Any],
                                                    verify_receipt: bool = True) -> None:
    failed_routine_require(generic_preguard_checkpoint_shape(cycle))
    owner = cycle['runId']
    w = cycle['window']
    failed_routine_require(isinstance(value, dict) and set(value) == TERMINAL_RESOLUTION_KEYS
        and value['schema'] == 1 and value['result'] == 'preguard-checkpoint-refusal-proved'
        and value['originalCycle'] == cycle
        and RUN_ID_RE.fullmatch(str(value['verifiedByRunId'])) is not None and value['verifiedByRunId'] != owner
        and all(SHA_RE.fullmatch(str(value[k])) is not None for k in ('verifiedByControlSha', 'verifiedByTargetSha'))
        and not {cycle['sha'], cycle['controlSha']} & {value['verifiedByControlSha'], value['verifiedByTargetSha']}
        and INVOCATION_ID_RE.fullmatch(str(value['invocationId'])) is not None
        and type(value['observedAt']) is int
        and value['observedAt'] * 1000 > w['endsAt'] + TERMINAL_OWNER_SETTLE_MS)
    proof = value['proof']
    failed_routine_require(isinstance(proof, dict) and set(proof) == GENERIC_PREGUARD_PROOF_KEYS
        and proof['failureDigest'] == failed_routine_digest(cycle['failure'])
        and all(re.fullmatch('[0-9a-f]{64}', str(proof[k])) is not None
                for k in ('checkpointIntentDigest', 'checkpointRefusalDigest', 'nativeDigest')))
    runtime = proof['runtime']
    failed_routine_require(isinstance(runtime, dict) and set(runtime) == {'containerId', 'startedAt', 'instanceId'}
        and CONTAINER_ID_RE.fullmatch(str(runtime['containerId'])) is not None
        and INSTANCE_ID_RE.fullmatch(str(runtime['instanceId'])) is not None and isinstance(runtime['startedAt'], str))
    try:
        birth = datetime.fromisoformat(runtime['startedAt'].replace('Z', '+00:00'))
    except ValueError:
        die('exact failed routine custody is unproved')
    failed_routine_require(birth.tzinfo is not None and 0 < birth.timestamp() < value['observedAt'])
    window_ms = {'announcedAt': w['announcedAt'], 'startsAt': w['startsAt'], 'endsAt': w['endsAt']}
    expected = {'schema': 'terminal-owned-thaw/v1', 'sha': cycle['failure']['recoveredDesiredSha'],
                'instanceId': runtime['instanceId'], 'databaseIdle': True, 'freshLeader': True,
                'ownedV3Thaw': True, **window_ms}
    failed_routine_require(proof['database'] == expected
        and all(type(proof['database'][k]) is bool for k in ('databaseIdle', 'freshLeader', 'ownedV3Thaw'))
        and all(type(proof['database'][k]) is int for k in window_ms))
    if verify_receipt:
        failed_routine_require(failed_routine_json(terminal_receipt_path(owner, value['verifiedByRunId'],
                                                                         value['invocationId'])) == value)


def generic_preguard_checkpoint_proof(state: dict[str, Any], cycle: dict[str, Any],
                                      deadline: float) -> dict[str, Any] | None:
    try:
        failed_routine_require(generic_preguard_checkpoint_candidate(state, cycle))
        owner = cycle['runId']
        failure = cycle['failure']
        window = cycle['window']
        desired = state['desired']
        failed_routine_require(state.get('pending') is None and state.get('finalization') is None
            and load_failure(owner) == failure
            and desired['sha'] == failure['recoveredDesiredSha'] == FAILED_ROUTINE_DESIRED
            and desired['imageId'] == failure['recoveredDesiredImageId'] == FAILED_ROUTINE_IMAGE)
        request_root = Path(os.environ.get('ENGINE_RELEASE_REQUEST_ROOT', str(STATE_DIR / 'engine-release-requests')))
        intent = failed_routine_json(request_root / f'{owner}.legacy-checkpoint-intent')
        failed_routine_require(isinstance(intent, dict) and intent.get('runId') == owner
            and intent.get('controlSha') == cycle['controlSha'] and intent.get('source') == desired['sha']
            and intent.get('retryAllowed') is False
            and CONTAINER_ID_RE.fullmatch(str(intent.get('container', ''))) is not None
            and INSTANCE_ID_RE.fullmatch(str(intent.get('instance', ''))) is not None
            and type(intent.get('hostPid')) is int and intent['hostPid'] > 0
            and type(intent.get('at')) in (int, float) and isinstance(intent.get('startedAt'), str)
            and window['startsAt'] / 1000 <= intent['at'] < failure['completedAt']
            and isinstance(intent.get('nativeCensus'), dict)
            and intent['nativeCensus'].get('candidateSHA') == cycle['sha'])
        refusal = generic_preguard_checkpoint_refusal(owner, failure, window, deadline)
        native = generic_preguard_checkpoint_native_proof(deadline, owner)
        runtime = failed_routine_runtime(deadline)  # Includes closed Inspector.
        control = Path(__file__).resolve().parent
        window_ms = {'announcedAt': window['announcedAt'], 'startsAt': window['startsAt'], 'endsAt': window['endsAt']}
        raw = failed_routine_command([str(control / 'engine-release-database-proof.py'), '--env-file',
            os.environ.get('ENV_FILE', os.environ.get('REPO_DIR', '/opt/club-arena') + '/server/.env'),
            '--sha', desired['sha'], '--instance-id', runtime['instanceId'], '--terminal-owned-thaw',
            '--window-announced-ms', str(window_ms['announcedAt']), '--window-starts-ms', str(window_ms['startsAt']),
            '--window-ends-ms', str(window_ms['endsAt']),
            '--timeout-seconds', '4', '--max-heartbeat-age-seconds', '15'], deadline)
        database = json.loads(raw)
        failed_routine_require(database == {'schema': 'terminal-owned-thaw/v1', 'sha': desired['sha'],
            'instanceId': runtime['instanceId'], 'databaseIdle': True, 'freshLeader': True,
            'ownedV3Thaw': True, **window_ms})
        return {'failureDigest': failed_routine_digest(failure),
                'checkpointIntentDigest': failed_routine_digest(intent),
                'checkpointRefusalDigest': refusal,
                'nativeDigest': failed_routine_digest(native),
                'runtime': runtime,
                'database': database}
    except (SystemExit, Exception):
        return None


# This profile resolves only the original 08e refusal before WebSocket creation.
# It never retries that operation or claims that its native close succeeded.
PREATTACH_RUN = '41452708967-1'
PREATTACH_SHA = '08e3edee7aaa1ca235403e3812504fd6cf88206c'
PREATTACH_INVOCATION = 'ca957c4b8b6c40fe8f47ea2bb6e1ce93'
PREATTACH_PROPOSAL = 'd40c983e9c26be190ca0167f17f0d35b07b9daa4f9984e17d8b339c8bb7b13c0'
PREATTACH_CONTAINER = 'e236a170ab73204b2a0826fdccb9efb36f21043ccd2bf009ce64421b7a1e0a4b'
PREATTACH_SOURCES = {
    'engine-release-transaction.sh': '0a78bdb9e5b3ba761ea1daf4bbec55c42b2ee654a98d71a5850a46ef313a5abe',
    'engine-release-unit-wrapper.sh': 'e9abdbe2c97c3594b32a920285e78858c1e0497f00a8a7edd21b99ba0491dc9c',
    'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83',
    'install-engine-supervisor.sh': 'b47aaaca69f749a60e72ef983719b4d18c00b75d7c1d19958508a45930d0fa96',
    'install-engine-intake.sh': '5476d126add86e299728488c97eb0f47c2bdeddb3b0b28d680db6535eea47f1b',
    'main-inspector-retirement.py': '80cc6afcd4aa40540603132b893e9d0880f08606b9a2aac6494aac1bea8bd7e5',
    'main-inspector-retirement-entry.mjs': 'b1a6141c4f11455f96d55b81acd24ba950f90902b96720467701f5ad0e2fa801',
    'retire-owned-main-inspector.mjs': 'dd91b8fa3e514a032b8b1133b1985988710c07239f692e8aeef65d21427f5d44',
    'main-inspector-socket-qualification.mjs': 'a34c84ab8e1cd0f92b645a02e89a379d863f07da0021a9930643f90eea8a5482',
}
PREATTACH_DIAGNOSTIC = {'schema': 'main-inspector-retirement-failure/v1', 'ok': False,
    'hostStage': 'native_exit', 'reason': 'retirement_outcome_unproved', 'intent': 'durable',
    'ack': 'flushed', 'childExit': 'nonzero', 'retryAllowed': False,
    'native': {'ok': False, 'retryAllowed': False, 'entryStage': 'transport', 'stage': 'attach',
        'reason': 'outcome_unknown', 'closeRequested': False, 'closeAcknowledged': False,
        'connectionClosed': False, 'listenerAbsent': None}}


def preattach_cycle(cycle: Any) -> None:
    failed_routine_require(isinstance(cycle, dict) and cycle.get('runId') == PREATTACH_RUN
        and cycle.get('sha') == cycle.get('controlSha') == PREATTACH_SHA
        and cycle.get('startsAt') == 1793628000 and cycle.get('endsAt') == 1793628300
        and cycle.get('status') == 'reserved' and cycle.get('window') is None
        and cycle.get('kind') == 'hourly-reset' and cycle.get('policyId') == SCHEDULE_POLICY_ID
        and cycle.get('policyDigest') == NINEF_POLICY_DIGEST)
    failure = cycle.get('failure')
    failed_routine_require(isinstance(failure, dict) and set(failure) == {
        'schema', 'runId', 'result', 'sha', 'controlSha', 'invocationId', 'transactionExitStatus',
        'recoveredDesiredSha', 'recoveredDesiredImageId', 'completedAt'}
        and type(failure['schema']) is int and failure['schema'] == 1
        and failure['runId'] == PREATTACH_RUN and failure['sha'] == failure['controlSha'] == PREATTACH_SHA
        and failure['invocationId'] == PREATTACH_INVOCATION and failure['result'] == 'failed'
        and type(failure['transactionExitStatus']) is int and failure['transactionExitStatus'] == 1
        and failure['recoveredDesiredSha'] == FAILED_ROUTINE_DESIRED
        and failure['recoveredDesiredImageId'] == FAILED_ROUTINE_IMAGE
        and type(failure['completedAt']) is int and 1793627880 <= failure['completedAt'] < 1793628000)


def preattach_claim() -> dict[str, Any]:
    claim = failed_routine_json(STATE_DIR / 'engine-release-requests' /
        (PREATTACH_RUN + '.main-inspector-retirement-intent'))
    failed_routine_require(isinstance(claim, dict) and set(claim) == {
        'schema','runId','invocationId','controlSha','requestDeadline','target','requestSha256',
        'nativeUnit','source','instance','containerIdentity','proposal','proposalSha256','deadlineMs','retryAllowed'}
        and claim['schema'] == 'main-inspector-retirement-claim/v1'
        and claim['runId'] == PREATTACH_RUN and claim['controlSha'] == claim['target'] == PREATTACH_SHA
        and claim['invocationId'] == PREATTACH_INVOCATION and claim['source'] == FAILED_ROUTINE_DESIRED
        and claim['instance'] == '1-2790e861' and claim['retryAllowed'] is False
        and type(claim['requestDeadline']) is int and claim['requestDeadline'] == 1793638383
        and type(claim['deadlineMs']) is int and 1793627880000 < claim['deadlineMs'] < 1793628000000
        and re.fullmatch('[0-9a-f]{64}', str(claim['requestSha256']))
        and claim['nativeUnit'] == {'InvocationID':PREATTACH_INVOCATION,'ActiveState':'activating','SubState':'start'}
        and claim['proposalSha256'] == PREATTACH_PROPOSAL
        and isinstance(claim['containerIdentity'], str)
        and hashlib.sha256(claim['containerIdentity'].encode()).hexdigest() == PREATTACH_CONTAINER
        and hashlib.sha256(json.dumps(claim['proposal'], separators=(',', ':')).encode()).hexdigest() == PREATTACH_PROPOSAL)
    return claim


def preattach_journal(cycle: dict[str, Any], deadline: float) -> dict[str, Any]:
    unit = 'club-arena-engine-release-v1@' + PREATTACH_RUN + '.service'
    raw = failed_routine_command(['journalctl', '--unit=' + unit,
        '_SYSTEMD_INVOCATION_ID=' + PREATTACH_INVOCATION, '--no-pager', '--output=json',
        '--output-fields=MESSAGE,_SYSTEMD_UNIT,_SYSTEMD_INVOCATION_ID,__REALTIME_TIMESTAMP',
        '--lines=4', '--grep=main-inspector-retirement-failure/v1'], deadline, 16384)
    def unique(pairs):
        value = {}
        for key, item in pairs:
            failed_routine_require(key not in value)
            value[key] = item
        return value
    rows = [json.loads(line, object_pairs_hook=unique) for line in raw.splitlines() if line.strip()]
    failed_routine_require(len(rows) == 1)
    row = rows[0]
    failed_routine_require(row.get('_SYSTEMD_UNIT') == unit
        and row.get('_SYSTEMD_INVOCATION_ID') == PREATTACH_INVOCATION
        and failed_routine_digest(json.loads(row.get('MESSAGE', ''), object_pairs_hook=unique)) == failed_routine_digest(PREATTACH_DIAGNOSTIC)
        and str(row.get('__REALTIME_TIMESTAMP', '')).isdigit()
        and 1793627880000000 <= int(row['__REALTIME_TIMESTAMP'])
            < (cycle['failure']['completedAt'] + 1) * 1000000)
    return {'journalDigest': failed_routine_digest(row), 'atMicros': int(row['__REALTIME_TIMESTAMP'])}


def preattach_runtime(claim: dict[str, Any], deadline: float) -> dict[str, Any]:
    value = terminal_inspect_container(deadline)
    live = value['State']
    original = claim['containerIdentity'].split()
    failed_routine_require(len(original) == 5 and value.get('Id') == original[0]
        and value.get('Image') == FAILED_ROUTINE_IMAGE and live.get('Running') is True
        and live.get('Status') == 'running' and type(live.get('Pid')) is int and live['Pid'] > 0)
    identity = f"{value['Id']} {value['Image']} true {live['StartedAt']} {live['Pid']}"
    if identity != claim['containerIdentity']:
        # A naturally replaced predecessor is admissible only with positive
        # kernel proof that the original process is gone and the new Inspector
        # is closed. This does not start, stop or signal either process.
        born = datetime.fromisoformat(live['StartedAt'].replace('Z', '+00:00'))
        failed_routine_require(born.tzinfo is not None and born.timestamp()*1000 > claim['deadlineMs']
            and born.timestamp() < time.time() and live['Pid'] != int(original[4]))
        old_birth = terminal_proc_birth(int(original[4]))
        failed_routine_require(old_birth is None or old_birth*1000 > claim['deadlineMs'])
        runtime = failed_routine_runtime(deadline, bounded=True)
        failed_routine_require(runtime['containerId'] == value['Id'] and runtime['startedAt'] == live['StartedAt']
            and runtime['instanceId'] != claim['instance'])
        failed_routine_database(runtime, deadline)
        after = terminal_inspect_container(deadline)
        failed_routine_require(all(after.get(k) == value.get(k) for k in ('Id','Image'))
            and all(after.get('State',{}).get(k) == live.get(k) for k in ('Pid','StartedAt','Running','Status')))
        return {'mode':'successor-inspector-closed', **runtime, 'hostPid':live['Pid'],
            'originalProcess':'kernel-enoent' if old_birth is None else 'pid-reused-after-claim',
            'databaseIdle':True, 'freshLeader':True}
    for url in ('http://127.0.0.1:8080/health', os.environ.get('ENGINE_URL', 'https://engine.smarter.poker').rstrip('/') + '/health'):
        h = json.loads(failed_routine_command(['curl','--fail','--silent','--show-error','--max-time','3',
            url + '?preattach=' + str(time.time_ns())], deadline, 1048576))
        m = h.get('maintenance') or {}
        failed_routine_require(h.get('releaseSha') == FAILED_ROUTINE_DESIRED and h.get('instanceId') == claim['instance']
            and h.get('running') is True and h.get('liveness') == h.get('status') == 'ok'
            and m.get('phase') == 'idle' and m.get('active') is False and m.get('durableConfirmed') is False)
    # Kernel metadata only: no discovery, connection, evaluation or close.
    source = (Path(__file__).resolve().parent / 'main-inspector-socket-qualification.mjs').read_text()
    script = source + '\nconsole.log(JSON.stringify(captureMainInspectorBinding({pid:1,port:9229,deadlineMs:Date.now()+2000,expectedBinding:' + json.dumps(claim['proposal']['binding']) + '})));'
    binding = json.loads(failed_routine_command(['docker','exec',value['Id'],'sh','-c',
        'case "${NODE_OPTIONS-}" in *--inspect*|*--debug*) exit 1;; esac; exec env -u NODE_OPTIONS -u NODE_PATH node --no-inspect "$@"',
        'preattach-proof','--input-type=module','-e',script], deadline, 4096))
    failed_routine_require(binding == claim['proposal']['binding'])
    runtime = {'containerId':value['Id'],'startedAt':live['StartedAt'],'instanceId':claim['instance']}
    failed_routine_database(runtime, deadline)
    return {'mode':'original-clientless-inspector', 'containerIdentitySHA256':PREATTACH_CONTAINER,
            'instanceId':claim['instance'], 'bindingDigest':failed_routine_digest(binding),
            'databaseIdle':True, 'freshLeader':True}


def validate_preattach_runtime(runtime: Any, claim: dict[str, Any], observed: int) -> None:
    failed_routine_require(isinstance(runtime, dict) and runtime.get('databaseIdle') is True
        and runtime.get('freshLeader') is True)
    if runtime.get('mode') == 'original-clientless-inspector':
        failed_routine_require(runtime == {'mode':'original-clientless-inspector',
            'containerIdentitySHA256':PREATTACH_CONTAINER,'instanceId':claim['instance'],
            'bindingDigest':failed_routine_digest(claim['proposal']['binding']), 'databaseIdle':True,'freshLeader':True})
    else:
        original = claim['containerIdentity'].split()
        failed_routine_require(set(runtime) == {'mode','containerId','startedAt','instanceId','hostPid',
            'originalProcess','databaseIdle','freshLeader'} and runtime['mode'] == 'successor-inspector-closed'
            and runtime['containerId'] == original[0] and type(runtime['hostPid']) is int
            and runtime['hostPid'] > 0 and runtime['hostPid'] != int(original[4])
            and INSTANCE_ID_RE.fullmatch(str(runtime['instanceId'])) and runtime['instanceId'] != claim['instance']
            and runtime['originalProcess'] in {'kernel-enoent','pid-reused-after-claim'})
        born = datetime.fromisoformat(runtime['startedAt'].replace('Z','+00:00'))
        failed_routine_require(born.tzinfo is not None and claim['deadlineMs'] < born.timestamp()*1000 <= observed*1000)


def preattach_proof(state: dict[str, Any], cycle: dict[str, Any], deadline: float) -> dict[str, Any]:
    preattach_cycle(cycle)
    failed_routine_require(state.get('pending') is None and state.get('finalization') is None
        and PREATTACH_RUN not in state['committedRuns']
        and state['desired']['sha'] == FAILED_ROUTINE_DESIRED and state['desired']['imageId'] == FAILED_ROUTINE_IMAGE
        and load_failure(PREATTACH_RUN) == cycle['failure'] and time.time() > cycle['failure']['completedAt'])
    claim = preattach_claim()
    sources = ninef_sources(deadline, PREATTACH_SHA, PREATTACH_SOURCES)
    native = failed_routine_native_proof(deadline, PREATTACH_RUN, retained_preattach=True)
    historical = preattach_journal(cycle, deadline)
    runtime = preattach_runtime(claim, deadline)
    return {'failureDigest':failed_routine_digest(cycle['failure']), 'claimDigest':failed_routine_digest(claim),
        'sourceDigests':sources, 'nativeDigest':failed_routine_digest(native), 'historical':historical,
        'runtime':runtime, 'nativeCloseInvoked':False, 'retryAllowed':False}


def validate_preattach_resolution(value: Any, cycle: dict[str, Any], verify_receipt: bool = True) -> None:
    preattach_cycle(cycle)
    failed_routine_require(isinstance(value, dict) and set(value) == TERMINAL_RESOLUTION_KEYS
        and type(value['schema']) is int and value['schema'] == 1 and value['result'] == 'preattach-refusal-proved' and value['originalCycle'] == cycle
        and RUN_ID_RE.fullmatch(str(value['verifiedByRunId'])) and value['verifiedByRunId'] != PREATTACH_RUN
        and all(SHA_RE.fullmatch(str(value[k])) and value[k] != PREATTACH_SHA for k in ('verifiedByControlSha','verifiedByTargetSha'))
        and INVOCATION_ID_RE.fullmatch(str(value['invocationId']))
        and type(value['observedAt']) is int and value['observedAt'] > cycle['failure']['completedAt'])
    proof = value['proof']; claim = preattach_claim()
    failed_routine_require(isinstance(proof, dict) and set(proof) == {
        'failureDigest','claimDigest','sourceDigests','nativeDigest','historical','runtime','nativeCloseInvoked','retryAllowed'}
        and proof['failureDigest'] == failed_routine_digest(cycle['failure'])
        and proof['claimDigest'] == failed_routine_digest(claim) and proof['sourceDigests'] == PREATTACH_SOURCES
        and proof['nativeCloseInvoked'] is False and proof['retryAllowed'] is False
        and re.fullmatch('[0-9a-f]{64}', str(proof['nativeDigest']))
        and isinstance(proof['historical'], dict) and set(proof['historical']) == {'journalDigest','atMicros'}
        and re.fullmatch('[0-9a-f]{64}', str(proof['historical']['journalDigest']))
        and type(proof['historical']['atMicros']) is int
        and 1793627880000000 <= proof['historical']['atMicros'] < (cycle['failure']['completedAt'] + 1)*1000000)
    validate_preattach_runtime(proof['runtime'], claim, value['observedAt'])
    if verify_receipt:
        failed_routine_require(failed_routine_json(terminal_receipt_path(PREATTACH_RUN,
            value['verifiedByRunId'], value['invocationId'])) == value)


def cmd_attest_preattach_resolution(args: argparse.Namespace) -> None:
    failed_routine_require(args.run_id == PREATTACH_RUN and re.fullmatch('[0-9a-f]{64}', args.claim_digest))
    state = load_state()
    cycles = [c for c in routine_cycles(state).values() if c['runId'] == PREATTACH_RUN]
    failed_routine_require(len(cycles) == 1)
    resolution = failed_routine_json(RESULT_DIR / (PREATTACH_RUN + '.preattach-disposition.json'))
    validate_preattach_resolution(resolution, cycles[0])
    failed_routine_require(resolution['proof']['claimDigest'] == args.claim_digest)
    print('preattach-refusal-proved')



def establish_preattach_disposition(args: argparse.Namespace, state: dict[str, Any], cycle: dict[str, Any], deadline: float) -> None:
    # This is a no-runtime-action disposition under the caller's engine/seal
    # locks. Establish it before the unchanged entry-state gate; the gate must
    # still validate every other retained foreign claim before routine release.
    disposition = RESULT_DIR / (PREATTACH_RUN + '.preattach-disposition.json')
    try:
        disposition.lstat()
    except FileNotFoundError:
        pass
    else:
        validate_preattach_resolution(failed_routine_json(disposition), cycle)
        return
    current = failed_routine_current_identity(args, deadline)
    proof = preattach_proof(state, cycle, deadline)
    failed_routine_require(load_state() == state and preattach_proof(state, cycle, deadline) == proof
        and failed_routine_current_identity(args, deadline) == current)
    resolution = {'schema':1, 'result':'preattach-refusal-proved', 'originalCycle':cycle,
        'verifiedByRunId':args.run_id, 'verifiedByControlSha':args.control_sha,
        'verifiedByTargetSha':args.sha, 'invocationId':args.invocation_id,
        'observedAt':int(time.time()), 'proof':proof}
    validate_preattach_resolution(resolution, cycle, verify_receipt=False)
    receipt = terminal_receipt_path(PREATTACH_RUN,args.run_id,args.invocation_id)
    try:
        receipt.lstat()
    except FileNotFoundError:
        write_json_atomic(receipt,resolution)
    else:
        retained = failed_routine_json(receipt)
        validate_preattach_resolution(retained, cycle)
        failed_routine_require(all(retained[k] == resolution[k] for k in
            ('verifiedByRunId','verifiedByControlSha','verifiedByTargetSha','invocationId'))
            and all(retained['proof'][k] == proof[k] for k in
                ('failureDigest','claimDigest','sourceDigests','historical','nativeCloseInvoked','retryAllowed')))
        resolution = retained
    disposition = RESULT_DIR / (PREATTACH_RUN + '.preattach-disposition.json')
    try:
        disposition.lstat()
    except FileNotFoundError:
        write_json_atomic(disposition,resolution)
    else:
        failed_routine_require(failed_routine_json(disposition) == resolution)
    validate_preattach_resolution(resolution,cycle)


def cmd_resolve_terminal_routine_failures(args: argparse.Namespace) -> None:
    """Inside the existing transaction, under the engine and seal locks, record a
    terminal-failure proof for each expired failed foreign routine owner whose
    every native/process/runtime/database trace is positively gone. The cycle,
    its failure and the audit history are never rewritten; an unproved owner
    stays authoritative and the ordinary owner check that follows refuses.

    An immutable per-invocation receipt is written before the audit and the
    state; an interrupted run resumes with exactly those bytes."""
    run_id = str(args.run_id)
    invocation = str(args.invocation_id)
    if (not RUN_ID_RE.fullmatch(run_id) or not INVOCATION_ID_RE.fullmatch(invocation) or run_id in {NINEF_RUN, CANCELLED_PHASE1_RUN, SECOND_CANCELLED_PHASE1_RUN, CURRENT26_CANCELLED_RUN, DAILY_REFUSAL_RUN, PREATTACH_RUN} or
            os.geteuid() != 0):
        die('terminal routine failure proof identity is invalid')
    sha = valid_sha(str(args.sha))
    control_sha = valid_sha(str(args.control_sha))
    if sha in {NINEF_SHA, CANCELLED_PHASE1_SHA, SECOND_CANCELLED_PHASE1_SHA, CURRENT26_CANCELLED_SHA, CURRENT26_CANCELLED_TARGET, DAILY_REFUSAL_SHA, PREATTACH_SHA} or control_sha in {NINEF_SHA, CANCELLED_PHASE1_SHA, SECOND_CANCELLED_PHASE1_SHA, CURRENT26_CANCELLED_SHA, CURRENT26_CANCELLED_TARGET, DAILY_REFUSAL_SHA, PREATTACH_SHA}:
        die('terminal routine failure proof identity is invalid')
    require_engine_lock(args.engine_lock_fd)
    deadline = time.monotonic() + 45
    with SealLock():
        state = load_state()
        proved = []
        for cycle in routine_cycles(state).values():
            owner = cycle['runId']
            generic = owner not in pinned_routine_owners() and generic_cancelled_candidate(state, cycle)
            unentered = (owner not in pinned_routine_owners() and not generic
                         and generic_unentered_candidate(state, cycle))
            preguard = (owner not in pinned_routine_owners() and not generic and not unentered
                        and generic_preguard_checkpoint_candidate(state, cycle))
            if (owner not in {NINEF_RUN, CANCELLED_PHASE1_RUN, SECOND_CANCELLED_PHASE1_RUN, CURRENT26_CANCELLED_RUN, DAILY_REFUSAL_RUN, PREATTACH_RUN}
                    and not generic and not unentered and not preguard) or owner == run_id or not routine_owner_unresolved(state, cycle):
                continue
            if owner == PREATTACH_RUN:
                establish_preattach_disposition(args, state, cycle, deadline)
            current = failed_routine_current(args, deadline)
            prove = (lambda: cancelled_phase1_proof(args, state, cycle, deadline)) if owner in {CANCELLED_PHASE1_RUN, SECOND_CANCELLED_PHASE1_RUN, CURRENT26_CANCELLED_RUN} else (lambda: terminal_owner_proof(state, cycle, deadline))
            if owner == DAILY_REFUSAL_RUN:
                prove = lambda: daily_refusal_proof(state, cycle, deadline)
            if owner == PREATTACH_RUN:
                prove = lambda: preattach_proof(state, cycle, deadline)
            if generic:
                def prove() -> dict[str, Any] | None:
                    # An unproved generic owner simply stays authoritative; the
                    # ordinary owner check that follows still refuses.
                    try:
                        return generic_cancelled_proof(args, state, cycle, deadline)
                    except (SystemExit, ValueError, KeyError, TypeError):
                        return None
            if unentered:
                def prove() -> dict[str, Any] | None:
                    return generic_unentered_proof(state, cycle, deadline)
            if preguard:
                def prove() -> dict[str, Any] | None:
                    return generic_preguard_checkpoint_proof(state, cycle, deadline)
            proof = prove()
            if proof is None:
                continue
            # Every witness, including this verifier's own request, intent,
            # generation pin and live unit, is observed again against an
            # unchanged seal immediately before the receipt, audit and
            # compare-and-swap.
            if (load_state() != state or prove() != proof or
                    failed_routine_current(args, deadline) != current):
                continue
            resolution = {'schema': 1, 'result': 'preguard-checkpoint-refusal-proved' if preguard else 'unentered-cycle-proved' if unentered else 'preattach-refusal-proved' if owner == PREATTACH_RUN else 'unentered-daily-cycle-proved' if owner == DAILY_REFUSAL_RUN else 'cancelled-announcement-proved' if owner in {CANCELLED_PHASE1_RUN, SECOND_CANCELLED_PHASE1_RUN, CURRENT26_CANCELLED_RUN} or generic else 'terminal-failure-proved', 'originalCycle': cycle,
                'verifiedByRunId': run_id, 'verifiedByControlSha': control_sha, 'verifiedByTargetSha': sha,
                'invocationId': invocation, 'observedAt': int(time.time()), 'proof': proof}
            if owner in {CANCELLED_PHASE1_RUN, SECOND_CANCELLED_PHASE1_RUN, CURRENT26_CANCELLED_RUN}:
                validate_cancelled_phase1_resolution(resolution, cycle, verify_receipt=False)
            if generic:
                try:
                    validate_generic_cancelled_resolution(resolution, cycle, verify_receipt=False)
                except SystemExit:
                    continue  # unproved: the owner stays authoritative
            if unentered:
                try:
                    validate_generic_unentered_resolution(resolution, cycle, verify_receipt=False)
                except SystemExit:
                    continue  # unproved: the owner stays authoritative
            if preguard:
                try:
                    validate_generic_preguard_checkpoint_resolution(resolution, cycle, verify_receipt=False)
                except SystemExit:
                    continue  # unproved: the owner stays authoritative
            if owner == DAILY_REFUSAL_RUN:
                validate_daily_refusal_resolution(resolution, cycle, verify_receipt=False)
            if owner == PREATTACH_RUN:
                retained = failed_routine_json(RESULT_DIR / (PREATTACH_RUN + '.preattach-disposition.json'))
                validate_preattach_resolution(retained, cycle)
                failed_routine_require(all(retained['proof'][k] == proof[k] for k in (
                    'failureDigest','claimDigest','sourceDigests','historical','nativeCloseInvoked','retryAllowed')))
                resolution = retained
            receipt = terminal_receipt_path(owner, resolution['verifiedByRunId'], resolution['invocationId'])
            try:
                receipt.lstat()
            except FileNotFoundError:
                write_json_atomic(receipt, resolution)
            else:
                original = failed_routine_json(receipt)
                if {k: v for k, v in original.items() if k != 'observedAt'} != \
                        {k: v for k, v in resolution.items() if k != 'observedAt'}:
                    die('terminal routine failure receipt differs from this invocation')
                resolution = original
            validate_routine_resolution(owner, resolution, cycle)
            audit_once('routine_terminal_failure_proved', state,
                       'routine_terminal_failure_proved:' + owner + ':' + resolution['verifiedByRunId'] + ':' + resolution['invocationId'],
                       resolution=resolution)
            if load_state() != state or time.monotonic() >= deadline:
                die('terminal routine failure proof lost its seal or deadline before compare-and-swap')
            state.setdefault('routineFailureResolutions', {})[owner] = resolution
            state['updatedAt'] = int(time.time())
            write_state(state)
            proved.append(owner)
        print(' '.join(proved) if proved else 'not-needed')


# 2026-11-06 ROOT CAUSE (run 42190145714-1): engine-supervisor.sh read every
# request with st_nlink == 1, but the v1 protocol publishes <run>.request as a
# hard link of <run>.intent. A committed run whose post-commit step failed then
# could never pass its own exact desired recovery, parked failed, and kept its
# committed routine cycle and finalization forever, refusing every later run.
# The fixed supervisor accepts exactly that sibling link. A run pinned to the
# old bytes still cannot finish, so a later run gives its original unit back
# the one shape those bytes read: the identical request with its own inode.
# This never records a result, clears a seal field or claims authorship; the
# original owner re-enters and records its own sealed result.
PARKED_OWNER_SUPERVISOR_DEFECT = "s.st_nlink != 1 or s.st_size > 131072"
ROOT_UID = 0


def parked_owner_private(info: os.stat_result) -> bool:
    return (stat.S_ISREG(info.st_mode) and info.st_uid == ROOT_UID
            and stat.S_IMODE(info.st_mode) == 0o600)


def parked_owner_stamp(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def cmd_restart_parked_committed_owner(args: argparse.Namespace) -> None:
    run_id = str(args.run_id)
    if not RUN_ID_RE.fullmatch(run_id):
        die("parked committed owner caller run id is invalid")
    require_engine_lock(args.engine_lock_fd)
    request_root = Path(os.environ.get("ENGINE_RELEASE_REQUEST_ROOT", str(STATE_DIR / "engine-release-requests")))
    pin_root = Path(os.environ.get("ENGINE_RELEASE_PIN_ROOT", str(STATE_DIR / "engine-release-generation-pins")))
    with SealLock():
        state = load_state()
        finalization = state.get("finalization")
        if state.get("pending") is not None or not isinstance(finalization, dict):
            print("not-needed"); return
        owner = str(finalization["runId"])
        committed = state.get("committedRuns", {}).get(owner)
        exact = {"sha": finalization["sha"], "imageId": finalization["imageId"]}
        cycle = own_routine_cycle(state, owner)
        if (owner == run_id or committed != exact
                or {"sha": state["desired"]["sha"], "imageId": state["desired"]["imageId"]} != exact
                or owner in state.get("orphanFinalizationResolutions", {})
                or result_path(owner).exists()
                or (cycle is not None and (cycle["status"] != "committed" or cycle["sha"] != exact["sha"]))):
            print("not-needed"); return
        unit = f"club-arena-engine-release-v1@{owner}.service"
        def parked() -> bool:
            value = native_unit(unit)
            return (value["LoadState"] == "loaded" and value["ActiveState"] == "failed"
                    and value["SubState"] == "failed" and value["MainPID"] == "0"
                    and value["ControlPID"] == "0" and value["Job"] in {"", "0"})
        if not parked():
            # A live, queued or unknown owner keeps its own recovery.
            print("not-needed"); return
        directory = request_root.lstat()
        if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != ROOT_UID
                or stat.S_IMODE(directory.st_mode) & 0o077):
            die("parked committed owner request root is not private")
        request_path = request_root / f"{owner}.request"
        intent_path = request_root / f"{owner}.intent"
        try:
            request_info = request_path.lstat()
            intent_info = intent_path.lstat()
        except FileNotFoundError:
            print("not-needed"); return
        if not (parked_owner_private(request_info) and parked_owner_private(intent_info)):
            die("parked committed owner request or intent is not private immutable input")
        if (request_info.st_dev, request_info.st_ino) != (intent_info.st_dev, intent_info.st_ino):
            print("not-needed"); return
        if request_info.st_nlink != 2:
            die("parked committed owner request has a foreign hard link")
        payload = request_path.read_bytes()
        request = payload.decode().splitlines()
        if (len(request) != 6 or request[0] != exact["sha"] or not SHA_RE.fullmatch(request[4])
                or payload.decode() != "\n".join(request) + "\n"):
            die("parked committed owner request does not name its committed release")
        generation = Path(request[3])
        pin = pin_root / f"{owner}.generation"
        pin_info = pin.lstat()
        if (not parked_owner_private(pin_info)
                or pin.read_text(encoding="utf-8").splitlines() != [str(generation), request[4]]):
            die("parked committed owner generation pin does not match its request")
        supervisor = generation / "engine-supervisor.sh"
        source = supervisor.read_bytes()
        if (generation.is_symlink() or supervisor.is_symlink()
                or (generation / "control-sha").read_text(encoding="utf-8").splitlines() != [request[4]]):
            die("parked committed owner generation is not its immutable control")
        if PARKED_OWNER_SUPERVISOR_DEFECT.encode() not in source or b"def sibling_intent_link" in source:
            # Owner bytes that can read their own request finish on retry.
            print("not-needed"); return
        temporary = request_root / f".{owner}.intent.{run_id}.{os.getpid()}"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            try:
                os.fchmod(fd, 0o600)
                write_all(fd, payload)
                os.fsync(fd)
            finally:
                os.close(fd)
            if (not parked() or load_state() != state
                    or parked_owner_stamp(request_path.lstat()) != parked_owner_stamp(request_info)
                    or parked_owner_stamp(intent_path.lstat()) != parked_owner_stamp(intent_info)):
                die("parked committed owner evidence changed before its request was unshared")
            os.replace(temporary, intent_path)
        finally:
            temporary.unlink(missing_ok=True)
        directory_fd = os.open(request_root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        after_request, after_intent = request_path.lstat(), intent_path.lstat()
        if (after_request.st_nlink != 1 or after_intent.st_nlink != 1
                or (after_request.st_dev, after_request.st_ino) != (request_info.st_dev, request_info.st_ino)
                or request_path.read_bytes() != payload or intent_path.read_bytes() != payload):
            die("parked committed owner request was not unshared exactly")
        audit_once("parked_committed_owner_restarted", state,
                   f"parked_committed_owner_restarted:{owner}:{run_id}",
                   owner=owner, release=exact, verifiedByRunId=run_id,
                   controlSha=request[4], requestSha256=hashlib.sha256(payload).hexdigest(),
                   supervisorSha256=hashlib.sha256(source).hexdigest())
    run(["systemctl", "reset-failed", unit])
    run(["systemctl", "start", "--no-block", unit])
    print(f"restarted {owner}")


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
        if resolved_failed_source(state, args.sha):
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
        # An hourly cycle can only be announced in its :58 minute
        # (recovery_window_reason admits [start-120, start-60)). Reserving an
        # hour whose announcement minute has passed or is about to pass
        # guarantees an unannounced failed owner that wedges every later
        # release (41511864834-1 reserved 20:00 at 19:59:21). Such a run owns
        # the following hour instead; nothing else about admission changes.
        if starts - now < ROUTINE_CYCLE_ADMISSION_LEAD_SECONDS:
            starts += 3600
        if kind == 'daily-restoration':
            # Retiring the hourly exception never authorizes one last daytime
            # replacement. Bind restoration to today's 04:00 Chicago; a late bounded
            # request must not reserve tomorrow and strand its global ownership.
            local = datetime.fromtimestamp(now, ZoneInfo('America/Chicago'))
            boundary = local.replace(hour=4, minute=0, second=0, microsecond=0)
            preparation = local.replace(hour=3, minute=30, second=0, microsecond=0)
            if now < preparation.timestamp() or boundary.timestamp() - now < ROUTINE_CYCLE_ADMISSION_LEAD_SECONDS:
                die('daily restoration is outside preparation or missed its announcement lead; no future cycle reserved')
            starts = int(boundary.timestamp())
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
        if resolved_failed_source(state, target_sha):
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


# Database-only reservations retain their historical rolling-hour spacing.
# Owner correction, 2026-11-04: an authorized engine recovery does not need
# that extra hour after the prior window and its owning recovery completed.
# This changes spacing only, never emergency cause, custody or admission.
RECOVERY_WINDOW_MIN_INTERVAL_MS = 3600 * 1000
RECOVERY_WINDOW_PREFIX = "engine-recovery-window-"
RECOVERY_CAUSE_RE = re.compile(r"^(urgent|engine-degraded)$")


CERTIFIED_RECOVERY_POLICY = "2026-11-04-tournament-fourfold-certified-recovery"
CERTIFIED_RECOVERY_PROFILE = "eed-240s-certified-release-v1"
CERTIFIED_RECOVERY_PREDECESSOR = "eed06fe51dea622069c661a6213d5b031ff3a9e3"
CERTIFIED_RECOVERY_START_MS = 1793833200000
CERTIFIED_RECOVERY_END_MS = 1793854800000


def recovery_window_ends_at(value: dict[str, Any]) -> int:
    """Read the original duration; malformed certified ownership never falls back."""
    stamp = value.get('announcedAt')
    if type(stamp) is not int or stamp <= 0:
        die('recovery reservation announcement is invalid')
    if 'certifiedRecovery' not in value:
        return stamp + 420000
    certified = value['certifiedRecovery']
    if (set(value) != {'runId', 'sha', 'announcedAt', 'cause', 'certifiedRecovery'}
            or not isinstance(certified, dict)
            or set(certified) != {'policyId', 'profileId', 'controlSha', 'predecessorSha', 'endsAt'}
            or certified['policyId'] != CERTIFIED_RECOVERY_POLICY
            or certified['profileId'] != CERTIFIED_RECOVERY_PROFILE
            or certified['predecessorSha'] != CERTIFIED_RECOVERY_PREDECESSOR
            or not SHA_RE.fullmatch(str(certified['controlSha']))
            or not SHA_RE.fullmatch(str(value['sha'])) or not RUN_ID_RE.fullmatch(str(value['runId']))
            or value['cause'] != 'urgent' or type(certified['endsAt']) is not int
            or certified['endsAt'] != stamp + 900000
            or stamp < CERTIFIED_RECOVERY_START_MS or certified['endsAt'] > CERTIFIED_RECOVERY_END_MS):
        die('certified recovery reservation is invalid')
    return certified['endsAt']


def certified_recovery_request(args: argparse.Namespace, state: dict[str, Any], stamp: int) -> dict[str, Any] | None:
    policy_id = getattr(args, 'certified_policy', None)
    predecessor = getattr(args, 'predecessor_sha', None)
    if policy_id is None:
        if predecessor is not None:
            die('certified predecessor has no policy')
        return None
    if (policy_id != CERTIFIED_RECOVERY_POLICY or predecessor != CERTIFIED_RECOVERY_PREDECESSOR
            or state['desired']['sha'] != predecessor or args.cause != 'urgent'
            or getattr(args, 'scheduled_cycle_start', None) is not None):
        die('certified recovery scope is invalid')
    import importlib.util
    spec = importlib.util.spec_from_file_location('certified_recovery_floor', Path(__file__).with_name('engine-release-activation-floor.py'))
    floor = importlib.util.module_from_spec(spec); spec.loader.exec_module(floor)
    record = floor.policy(args.repo, args.sha, args.control_sha)
    if (record is None or record.get('ownerWindowId') != policy_id
            or record.get('certifiedRecoveryProfile') != CERTIFIED_RECOVERY_PROFILE
            or record.get('cycleDurationSeconds') != 900
            or not record['activationEpoch'] * 1000 <= stamp
            or stamp + 900000 > record['expiresEpoch'] * 1000):
        die('certified recovery does not fit its exact immutable floor')
    return {'policyId': policy_id, 'profileId': CERTIFIED_RECOVERY_PROFILE,
            'controlSha': args.control_sha, 'predecessorSha': predecessor, 'endsAt': stamp + 900000}


def completed_recovery_window(other: str, reservation: Any, now_ms: int) -> bool:
    """A known terminal outcome may remove spacing, never unresolved ownership."""
    if (not isinstance(reservation, dict) or reservation.get('runId') != other
            or not SHA_RE.fullmatch(str(reservation.get('sha', '')))
            or reservation.get('cause') not in ('urgent', 'engine-degraded')
            or type(reservation.get('announcedAt')) is not int):
        return False
    announced = reservation['announcedAt']
    if announced <= 0 or now_ms < recovery_window_ends_at(reservation):
        return False  # Original notice and full freeze must have ended.
    path = result_path(other)
    if not path.exists():
        return False  # No acknowledgement is not a terminal outcome.
    try:
        outcome = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        die(f'prior recovery outcome is unreadable: {exc}')
    if not isinstance(outcome, dict):
        die('prior recovery outcome is invalid')
    result = load_failure(other) if outcome.get('result') == 'failed' else load_result(other)
    if (result['sha'] != reservation['sha'] or type(result['completedAt']) is not int
            or not announced <= result['completedAt'] * 1000 <= now_ms):
        die('prior recovery outcome does not bind its original window')
    return True


def recovery_window_eligibility(run_id: str, now_ms: int, *, after_completed: bool = False) -> tuple[str, int]:
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
        reservation = None
        try:
            reservation = json.loads(path.read_text(encoding="utf-8"))
            announced = reservation.get("announcedAt")
        except (OSError, ValueError, AttributeError):
            announced = None
        if type(announced) is not int or announced <= 0:
            try:
                announced = int(path.stat().st_mtime * 1000)
            except OSError:
                continue
        if announced > now_ms - RECOVERY_WINDOW_MIN_INTERVAL_MS:
            if after_completed and completed_recovery_window(other, reservation, now_ms):
                continue
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
    NAMED emergency cause. A known completed prior engine window needs no
    additional hour of spacing; unknown prior outcomes retain their refusal.
    Scheduled-cycle and database-only cadence are unchanged. A failed or missed
    release alone is not a cause. No timing change supplies a certificate.
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
        if state.get("pending") or state.get("finalization") or state["desired"]["sha"] == target:
            print("unavailable")
            return
        path = STATE_DIR / f"engine-recovery-window-{run_id}.json"
        nov7 = getattr(args, 'nov7_owner', False)
        if nov7:
            valid_sha(args.control_sha)
            if (state['desired']['sha'] != NOV7_PREDECESSOR or args.cause != 'urgent'
                    or args.scheduled_cycle_start is not None or getattr(args, 'certified_policy', None)):
                die('Nov 7 release predecessor or cause differs')
            if os.path.lexists(STATE_DIR / NOV7_OWNER_CLAIM) or os.path.lexists(path):
                # Known or unknown outcome: observe the original reservation.
                print('unavailable')
                return
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
            recovery_window_ends_at(value)
            if 'certifiedRecovery' in value or getattr(args, 'certified_policy', None) is not None:
                expected = certified_recovery_request(args, state, value['announcedAt'])
                if expected is None or value.get('certifiedRecovery') != expected:
                    die('existing recovery reservation cannot be retargeted or extended')
            elif getattr(args, 'predecessor_sha', None) is not None:
                die('certified predecessor has no policy')
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
        blocker, eligible_at = recovery_window_eligibility(
            run_id, now_ms, after_completed=scheduled_cycle is None)
        if blocker:
            if getattr(args, "include_eligibility", False):
                print(f"rate-limited:{eligible_at}")
            else:
                print("rate-limited")
            return
        certified = certified_recovery_request(args, state, now_ms)
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
        if certified is not None:
            value['certifiedRecovery'] = certified
        recovery_window_ends_at(value)
        if nov7:
            require_nov7_reservation_authority(args, target, announced_at)
            write_json_atomic(STATE_DIR / NOV7_OWNER_CLAIM, nov7_claim(run_id, target, args.control_sha, announced_at))
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


def cmd_prove_expired_recovery_announcement(args: argparse.Namespace) -> None:
    """Read only: the original announced owner ended without entering cutover.

    The positive immutable announcement/reservation and native unit are authority;
    absent mutation files alone never authorize retirement. The wrapper still
    records and attests its exact failed outcome before ordinary durable cleanup.
    """
    import importlib.util
    failed_routine_require(os.geteuid() == 0 and RUN_ID_RE.fullmatch(args.run_id) is not None
        and SHA_RE.fullmatch(args.sha) is not None and SHA_RE.fullmatch(args.control_sha) is not None)
    require_engine_lock(args.engine_lock_fd)
    deadline = time.monotonic() + 45
    control = Path(__file__).resolve().parent
    request_root = Path(os.environ.get('ENGINE_RELEASE_REQUEST_ROOT', str(STATE_DIR / 'engine-release-requests')))
    pin_root = Path(os.environ.get('ENGINE_RELEASE_PIN_ROOT', str(STATE_DIR / 'engine-release-generation-pins')))
    spec = importlib.util.spec_from_file_location('original_announcement_floor', control / 'engine-release-activation-floor.py')
    floor = importlib.util.module_from_spec(spec); spec.loader.exec_module(floor)
    hold_spec = importlib.util.spec_from_file_location('original_announcement_hold', control / 'engine-release-lightning-hold.py')
    hold = importlib.util.module_from_spec(hold_spec); hold_spec.loader.exec_module(hold)
    with SealLock():
        state = load_state()
        # 2026-11-05 ROOT CAUSE: this proof used to require the sealed desired
        # release to be the Oct 29 eed06fe5 image. Once production moved past
        # it (67bc0e85 on Nov 5), no expired announcement-only owner could ever
        # be retired, so each one looped in systemd forever and blocked every
        # newer release ("cannot compete with active runtime owner"). The
        # invariant that matters is: nothing is pending or finalizing, this run
        # never committed, and the serving runtime IS the sealed desired
        # release. That is proved below against the live desired identity.
        failed_routine_require(state.get('pending') is None and state.get('finalization') is None,
            'a release is pending or finalizing')
        failed_routine_require(args.run_id not in state['committedRuns'], 'run already committed')
        desired = (valid_sha(state['desired']['sha'], 'desired.sha'), str(state['desired']['imageId']))
        failed_routine_require(desired[1].startswith('sha256:'), 'sealed desired image id is malformed')
        record = floor.policy(args.repo, args.sha, args.control_sha)
        failed_routine_require(isinstance(record, dict) and record['schema'] in
            (floor.OWNER_CAPABILITY, floor.PHASE1_CAPABILITY), 'activation floor record is not an owner record')
        # The actual installed control, not just its recorded SHA, must contain
        # the entry-before-checkpoint/prepare and recovery semantics being used.
        for name in ('engine-release-seal.py', 'engine-release-recover.sh', 'engine-release-transaction.sh',
                     'engine-release-database-proof.py', 'engine-release-lightning-hold.py'):
            expected = failed_routine_command(['git', '-C', args.repo, 'rev-parse',
                args.control_sha + ':server/scripts/' + name], deadline)
            raw = failed_routine_bytes(control / name, 1048576)
            blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
            failed_routine_require(expected == blob)

        def ownership():
            request = failed_routine_bytes(request_root / (args.run_id + '.request')).decode().splitlines()
            failed_routine_require(len(request) == 6 and request[0] == args.sha
                and request[1] == 'https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/actions/runs/' + args.run_id.split('-')[0]
                and bool(request[2]) and request[3] == str(control) and request[4] == args.control_sha
                and request[5].isdigit() and int(request[5]) > 0
                and failed_routine_bytes(control / 'control-sha').decode().splitlines() == [args.control_sha])
            entry = floor.existing_entry(request_root, args.run_id, args.sha, args.control_sha)
            failed_routine_require(entry is not None and entry['schema'] == record['schema']
                and entry['phase'] == 'announcement' and entry['manifestSha256'] == record['manifestSha256'],
                'runtime entry is not this run\'s own announcement')
            stamp = floor.reservation(record, STATE_DIR, args.run_id)
            reservation = json.loads(failed_routine_bytes(STATE_DIR / (RECOVERY_WINDOW_PREFIX + args.run_id + '.json')))
            ends_at = recovery_window_ends_at(reservation)
            failed_routine_require(time.time() * 1000 > ends_at and int(request[5]) * 1000 >= ends_at,
                'recovery window has not expired')
            # A prior terminal cleanup may already have removed its pin/intent.
            # Only the exact durable failed outcome permits that replay edge.
            terminal = None
            if result_path(args.run_id).exists():
                terminal = load_failure(args.run_id)
                failed_routine_require(terminal['sha'] == args.sha and terminal['controlSha'] == args.control_sha
                    and terminal['recoveredDesiredSha'] == state['desired']['sha']
                    and terminal['recoveredDesiredImageId'] == state['desired']['imageId'])
            for path, lines in ((request_root / (args.run_id + '.intent'), request),
                               (pin_root / (args.run_id + '.generation'), [str(control), args.control_sha])):
                if os.path.lexists(path):
                    failed_routine_require(failed_routine_bytes(path).decode().splitlines() == lines)
                else:
                    failed_routine_require(terminal is not None)
            for suffix in ('legacy-checkpoint-intent', 'break-deadline', 'main-inspector-retirement-intent',
                           'main-inspector-retirement-receipt'):
                require_absent(request_root / (args.run_id + '.' + suffix))
            # Pause acquisition precedes certificate admission. An unresolved
            # original Lightning hold cannot be discarded by terminal cleanup.
            hold_path = request_root / (args.run_id + '.lightning-hold.json')
            require_absent(hold_path)
            released = hold.own_record(hold_path.with_name(hold_path.name + '.released'), args.run_id)
            failed_routine_require(released is None or released['phase'] == 'released')
            unit = native_unit('club-arena-engine-release-v1@' + args.run_id + '.service')
            groups = [line.split(':', 2)[2] for line in Path('/proc/self/cgroup').read_text().splitlines()]
            failed_routine_require(unit['LoadState'] == 'loaded' and
                (unit['ActiveState'], unit['SubState']) in (('activating', 'start'), ('deactivating', 'stop-post'))
                and any(str(unit[k]).isdigit() and int(unit[k]) > 0 for k in ('MainPID', 'ControlPID'))
                and INVOCATION_ID_RE.fullmatch(unit['InvocationID']) is not None
                and unit['InvocationID'] == os.environ.get('INVOCATION_ID')
                and bool(unit['ControlGroup']) and unit['ControlGroup'] in groups)
            return {'request': request, 'entry': entry, 'announcedAt': stamp, 'unit': unit, 'releasedHold': released,
                    'endsAt': ends_at, 'certifiedRecovery': reservation.get('certifiedRecovery')}

        owner = ownership()
        runtime = failed_routine_runtime(deadline, bounded=True, desired=desired)
        window = {'announcedAt': owner['announcedAt'], 'startsAt': owner['announcedAt'] + 120000,
                  'endsAt': owner['endsAt']}
        certified_args = (['--certified-mode', 'terminal', '--certified-run-id', args.run_id,
                           '--certified-target-sha', args.sha, '--certified-control-sha', args.control_sha]
                          if owner['certifiedRecovery'] is not None else [])
        raw = failed_routine_command([str(control / 'engine-release-database-proof.py'), '--env-file',
            os.environ.get('ENV_FILE', args.repo + '/server/.env'), '--sha', desired[0],
            '--instance-id', runtime['instanceId'], '--terminal-owned-thaw',
            '--window-announced-ms', str(window['announcedAt']), '--window-starts-ms', str(window['startsAt']),
            '--window-ends-ms', str(window['endsAt']), '--timeout-seconds', '4', '--max-heartbeat-age-seconds', '15'] + certified_args, deadline)
        database = json.loads(raw)
        thawed = {'schema': 'terminal-owned-thaw/v1', 'sha': desired[0],
            'instanceId': runtime['instanceId'], 'databaseIdle': True, 'freshLeader': True, 'ownedV3Thaw': True, **window}
        refused = {**thawed, 'schema': 'terminal-refused-announcement/v1',
            'ownedV3Thaw': False, 'announcementRefused': True}
        failed_routine_require(database == thawed or
            (owner['certifiedRecovery'] is not None and database == refused),
            'database thaw proof does not match the serving release')
        failed_routine_require(runtime == failed_routine_runtime(deadline, bounded=True, desired=desired)
            and owner == ownership() and state == load_state() and time.monotonic() < deadline,
            'evidence changed during the proof')
        print('expired-original-announcement-refused' if database == refused else 'expired-original-announcement-thawed')


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


def failed_routine_require(value: bool, reason: str | None = None) -> None:
    # 2026-11-05: an unnamed refusal cost 2.5 hours of blocked releases (run
    # 42099609162-1 looped 222 times printing only this line). Every caller that
    # can say which invariant failed says so; the custody verdict is unchanged.
    if not value:
        die('exact failed routine custody is unproved; original owner retained'
            + (f' ({reason})' if reason else ''))


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


def failed_routine_command(command: list[str], deadline: float, limit: int = 32768, *, max_seconds: int = 5) -> str:
    deadline = min(deadline, time.monotonic() + max_seconds)
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


def failed_routine_native_proof(deadline: float, owner: str = FAILED_ROUTINE_RUN, retained_preattach: bool = False) -> dict[str, Any]:
    units = {}
    for prefix, extension in (('release', 'service'), ('intake', 'service'), ('intake', 'path')):
        unit = f'club-arena-engine-{prefix}-v1@{owner}.{extension}'
        value = failed_routine_unit_snapshot(unit, deadline)
        if extension == 'service':
            failed_routine_service_empty(unit, value, deadline)
        require_absent(Path('/etc/systemd/system/multi-user.target.wants') / unit)
        require_absent(Path('/etc/systemd/system/paths.target.wants') / unit)
        units[unit] = value
    roots = (
        (STATE_DIR / 'engine-release-requests', ('request', 'intent', 'activation-entry', 'drill',
         'legacy-checkpoint-intent', 'main-inspector-retirement-intent', 'main-inspector-retirement-receipt',
         'lightning-hold.json', 'lightning-hold.json.released', 'break-deadline', 'awaiting-certificate')),
        (STATE_DIR / 'engine-intake-requests', ('request', 'intent')),
        (STATE_DIR / 'engine-release-generation-pins', ('generation',)),
        (STATE_DIR / 'engine-image-leases', ('lease',)))
    if retained_preattach:
        failed_routine_require(owner == PREATTACH_RUN)
        preattach_claim()
    for root, suffixes in roots:
        for suffix in suffixes:
            if retained_preattach and suffix == 'main-inspector-retirement-intent':
                continue
            require_absent(root / (owner + '.' + suffix))
    require_absent(STATE_DIR / ('engine-recovery-window-' + owner + '.json'))
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


def failed_routine_current_identity(args: argparse.Namespace, deadline: float) -> dict[str, Any]:
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
    return {'requestDigest': failed_routine_digest(request), 'unit': current}


def failed_routine_current(args: argparse.Namespace, deadline: float) -> dict[str, Any]:
    current = failed_routine_current_identity(args, deadline)
    control = Path(__file__).resolve().parent
    failed_routine_command([str(control / 'main-inspector-retirement.py'), '--entry-state', args.run_id], deadline)
    return current


def failed_routine_runtime(deadline: float, bounded: bool = False,
                           desired: tuple[str, str] | None = None) -> dict[str, Any]:
    """Prove the serving container is exactly `desired` (sha, imageId) and idle.

    `desired` defaults to the frozen failed-routine identity of run
    41349091113-1 for the failed-routine commands that are bound to it. The
    expired-announcement retirement passes the sealed state's live desired
    identity instead (2026-11-05): an announcement-only owner that missed its
    window proves nothing about WHICH release is serving, only that the serving
    release is still the sealed desired one and was never touched.
    """
    desired_sha, desired_image = desired or (FAILED_ROUTINE_DESIRED, FAILED_ROUTINE_IMAGE)
    container = os.environ.get('CONTAINER', 'club-arena-engine')
    if bounded:
        value = terminal_inspect_container(deadline)
        metadata = json.loads(failed_routine_command(['docker','image','inspect','--format','{{json .}}',
            desired_image], deadline, 262144))
        image = metadata.get('Id')
        config = metadata.get('Config') or {}
        source = (config.get('Labels') or {}).get('org.opencontainers.image.revision')
        if not isinstance(source, str) or not SHA_RE.fullmatch(source.lower()):
            matches = [v.split('=',1)[1] for v in config.get('Env',[]) if isinstance(v,str) and v.startswith('GIT_COMMIT_SHA=')]
            failed_routine_require(len(matches) == 1 and SHA_RE.fullmatch(matches[0].lower()))
            source = matches[0]
        source = source.lower()
    else:
        value = docker_json('container', container)
        image, source, _ = image_identity(desired_image, require_label=False)
    failed_routine_require(image == desired_image and source == desired_sha and
        value.get('Image') == image and value.get('State', {}).get('Status') == 'running' and
        CONTAINER_ID_RE.fullmatch(str(value.get('Id', ''))) is not None,
        f'serving container is not the desired release {desired_sha[:8]} / {desired_image[:19]}')
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
        if getattr(args, "completion_invocation_id", False):
            producer = value["completionRuntime"]["invocationId"]
            if producer not in value["invocationIds"]:
                die("durable result does not attest its completion invocation")
            print(producer)
            return
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
        if pending["mode"] == "deploy" and pending["used"] and target["sha"] != state["desired"]["sha"]:
            # Persist in the same atomic seal write that retires this token.
            # A lost acknowledgment or repeated abort cannot clear the record.
            state.setdefault("uncommittedCandidateStarts", {})[target["sha"]] = {
                "runId": str(args.run_id), "imageId": target["imageId"]}
        state["pending"] = None
        state["updatedAt"] = int(time.time())
        write_state(state)
        audit("abort", state, target=target, runId=str(args.run_id))


def add_audit_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-url", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--reason", required=True)



# Diagnostic evidence never participates in canonical release authority.
def diagnostic_read(path: Path, *, private: bool = True) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_mode & (0o077 if private else 0o022) or info.st_size > 1048576):
            raise ValueError("unsafe diagnostic input")
        data = os.read(fd, 1048577)
        after = os.fstat(fd)
        stamp = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        if len(data) != info.st_size or stamp(info) != stamp(after):
            raise ValueError("diagnostic input changed")
        return data
    finally:
        os.close(fd)


def diagnostic_json(data: bytes) -> Any:
    def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate diagnostic JSON key")
            value[key] = item
        return value
    def nonfinite(value: str) -> NoReturn:
        raise ValueError("nonfinite diagnostic JSON")
    return json.loads(data, object_pairs_hook=unique, parse_constant=nonfinite)


def diagnostic_shell_state(raw: dict[str, Any]) -> dict[str, Any]:
    bounds = {"checkpointRequired": 1, "drainedCutover": 1, "prepared": 1,
              "mutationStarted": 1, "lockHeld": 1, "checkpointBudgetSeconds": 300,
              "checkpointWorkMs": 300000, "certificateExitStatus": 255,
              "breakEndEpoch": 9999999999}
    if raw.get("checkpointProfile") == CERTIFIED_RECOVERY_PROFILE:
        if raw.get("predecessorSha") != CERTIFIED_RECOVERY_PREDECESSOR:
            raise ValueError("certified diagnostic predecessor differs")
        bounds.update(checkpointBudgetSeconds=320, checkpointWorkMs=260000)
    if set(raw) != set(bounds) | {"checkpointProfile", "predecessorSha"}:
        raise ValueError("invalid diagnostic shell state fields")
    result = {}
    for key, bound in bounds.items():
        value = raw[key]
        if value == "UNKNOWN":
            result[key] = value
        elif (type(value) is int or isinstance(value, str) and value.isdecimal()) and 0 <= int(value) <= bound:
            result[key] = int(value)
        else:
            raise ValueError("invalid bounded diagnostic shell state")
    if raw["checkpointProfile"] not in ("UNKNOWN", "legacy-40s-v1", "eed-80s-v1", CERTIFIED_RECOVERY_PROFILE):
        raise ValueError("invalid checkpoint profile")
    if raw["predecessorSha"] != "UNKNOWN" and not SHA_RE.fullmatch(str(raw["predecessorSha"])):
        raise ValueError("invalid diagnostic predecessor")
    return {**result, "checkpointProfile": raw["checkpointProfile"], "predecessorSha": raw["predecessorSha"]}


def diagnostic_validate(existing: Any, value: dict[str, Any]) -> dict[str, Any]:
    if (not isinstance(existing, dict) or set(existing) != set(value)
            or existing.get("schema") != value["schema"]
            or existing.get("diagnosticOnly") is not True
            or existing.get("binding") != value["binding"]):
        raise ValueError("conflicting or unreadable original diagnostic")
    if (not INVOCATION_ID_RE.fullmatch(str(existing.get("invocationId", "")))
            or not isinstance(existing.get("observedAt"), str)):
        raise ValueError("invalid existing diagnostic envelope")
    if datetime.fromisoformat(existing["observedAt"]).utcoffset() is None or datetime.fromisoformat(existing["observedAt"]).utcoffset().total_seconds() != 0:
        raise ValueError("diagnostic timestamp has no zone")
    if value["schema"] == "engine-release-first-refusal/v1":
        if (existing.get("origin") not in ("die", "err", "exit")
                or type(existing.get("exitCode")) is not int or not 1 <= existing["exitCode"] <= 255
                or existing.get("signal") != "UNKNOWN"
                or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}|UNKNOWN", str(existing.get("stage", "")))
                or type(existing.get("sourceLine")) is not int
                or existing["sourceLine"] < 0
                or (existing["sourceLine"] == 0 and existing.get("sourceLineSha256") is not None)
                or (existing["sourceLine"] > 0 and not re.fullmatch(r"[0-9a-f]{64}", str(existing.get("sourceLineSha256", ""))))
                or existing.get("command") != "SOURCE_LINE_ONLY_NOT_ARGV"
                or not isinstance(existing.get("knownStateDigests"), dict)
                or set(existing["knownStateDigests"]) != {"seal", "checkpointIntent", "breakDeadline", "awaitingCertificate"}
                or any(v is not None and v != "UNKNOWN" and not re.fullmatch(r"[0-9a-f]{64}", str(v)) for v in existing["knownStateDigests"].values())
                or existing.get("checkpointPath") != value["checkpointPath"]
                or not isinstance(existing.get("shellState"), dict)
                or not isinstance(existing.get("predecessor"), dict)
                or not isinstance(existing.get("certificate"), dict)):
            raise ValueError("invalid original diagnostic schema")
        shell_state = diagnostic_shell_state(existing["shellState"])
        source = diagnostic_read(Path(value["binding"]["generation"]) / "engine-release-transaction.sh", private=False)
        source_lines = source.splitlines()
        line = existing["sourceLine"]
        if (hashlib.sha256(source).hexdigest() != value["binding"]["transactionSha256"]
                or line > len(source_lines)
                or line > 0 and existing["sourceLineSha256"] != hashlib.sha256(source_lines[line - 1]).hexdigest()
                or existing["shellState"] != shell_state):
            raise ValueError("retained refusal source or state mismatch")
        if (existing["predecessor"] != {"selectedSha": shell_state["predecessorSha"], "sealSha256": existing["knownStateDigests"]["seal"]}
                or existing["certificate"] != {"exitStatus": shell_state["certificateExitStatus"], "breakEndEpoch": shell_state["breakEndEpoch"],
                   "deadlineSha256": existing["knownStateDigests"]["breakDeadline"], "awaitingMarkerSha256": existing["knownStateDigests"]["awaitingCertificate"]}):
            raise ValueError("invalid original diagnostic schema")
    elif (existing.get("terminalObservation") != value["terminalObservation"]
          or existing.get("invocationId") != value["invocationId"]):
        raise ValueError("invalid attempt diagnostic schema")
    return existing


def diagnostic_create(path: Path, value: dict[str, Any]) -> dict[str, Any]:
    data = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    fd, temporary = tempfile.mkstemp(prefix=".diagnostic-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            existing = diagnostic_json(diagnostic_read(path))
            return diagnostic_validate(existing, value)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return value
    finally:
        os.unlink(temporary)


def cmd_diagnostic_read(args: argparse.Namespace) -> None:
    """Read retained evidence after cleanup, never reconstruct release authority."""
    try:
        if not RUN_ID_RE.fullmatch(args.run_id):
            raise ValueError("invalid run identity")
        target, control = valid_sha(args.sha), valid_sha(args.control_sha)
        generation = Path(args.generation)
        if (not generation.is_absolute() or generation.resolve() != generation or generation.is_symlink()
                or STATE_DIR.resolve() != STATE_DIR or STATE_DIR.is_symlink()):
            raise ValueError("unsafe diagnostic binding")
        root = STATE_DIR / "engine-release-diagnostics"
        info = root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError("unsafe diagnostic directory")
        source_digests = {
            "transactionSha256": hashlib.sha256(diagnostic_read(generation / "engine-release-transaction.sh", private=False)).hexdigest(),
            "producerSha256": hashlib.sha256(diagnostic_read(generation / "engine-release-seal.py", private=False)).hexdigest()}
        def read_record(path: Path, schema: str) -> dict[str, Any] | None:
            try:
                record = diagnostic_json(diagnostic_read(path))
            except FileNotFoundError:
                return None
            if not isinstance(record, dict) or not isinstance(record.get("binding"), dict):
                raise ValueError("unreadable retained diagnostic")
            binding = record["binding"]
            expected = {"runId": args.run_id, "targetSha": target, "controlSha": control,
                        "generation": str(generation), **source_digests}
            if (set(binding) != set(expected) | {"requestSha256", "pinSha256"}
                    or any(binding.get(k) != v for k, v in expected.items())
                    or any(not re.fullmatch(r"[0-9a-f]{64}", str(binding.get(k, ""))) for k in ("requestSha256", "pinSha256"))):
                raise ValueError("retained source identity mismatch")
            if schema == "engine-release-first-refusal/v1":
                keys = {"schema", "diagnosticOnly", "binding", "invocationId", "observedAt", "origin", "stage", "exitCode", "signal",
                        "sourceLine", "sourceLineSha256", "command", "knownStateDigests", "checkpointPath", "shellState", "predecessor", "certificate"}
                expected_checkpoint = str(Path(os.environ.get("ENGINE_RELEASE_REQUEST_ROOT", str(STATE_DIR / "engine-release-requests"))) / f"{args.run_id}.legacy-checkpoint-intent")
                if set(record) != keys or record.get("checkpointPath") != expected_checkpoint:
                    raise ValueError("invalid retained refusal fields")
            else:
                if set(record) != {"schema", "diagnosticOnly", "binding", "invocationId", "observedAt", "terminalObservation"}:
                    raise ValueError("invalid retained attempt fields")
            expected_record = {**record, "schema": schema, "diagnosticOnly": True, "binding": expected | {k: binding[k] for k in ("requestSha256", "pinSha256")}}
            if schema == "engine-release-attempt/v1":
                expected_record["terminalObservation"] = "UNKNOWN_UNTIL_FIRST_REFUSAL_OR_CANONICAL_RESULT"
            return diagnostic_validate(record, expected_record)
        first = read_record(root / f"{args.run_id}.first-refusal.json", "engine-release-first-refusal/v1")
        invocation = args.invocation_id or (first["invocationId"] if first else None)
        if invocation is not None and not INVOCATION_ID_RE.fullmatch(invocation):
            raise ValueError("invalid diagnostic invocation")
        attempt = read_record(root / f"{args.run_id}.attempt-{invocation}.json", "engine-release-attempt/v1") if invocation else None
        if first and not read_record(root / f"{args.run_id}.attempt-{first['invocationId']}.json", "engine-release-attempt/v1"):
            raise ValueError("original attempt evidence missing")
        print(json.dumps({"schema": "engine-release-diagnostic-read/v1", "diagnosticOnly": True,
                          "observation": "FIRST_REFUSAL_RECORDED" if first else "UNKNOWN_NO_REFUSAL_RECORDED",
                          "firstRefusal": first, "attempt": attempt}, sort_keys=True))
    except (OSError, ValueError, UnicodeError):
        print("[engine-release-diagnostic] UNKNOWN: retained evidence unreadable or source identity mismatched", file=sys.stderr)
        raise SystemExit(1)


def cmd_diagnostic(args: argparse.Namespace) -> None:
    try:
        if not RUN_ID_RE.fullmatch(args.run_id) or not INVOCATION_ID_RE.fullmatch(args.invocation_id):
            raise ValueError("invalid diagnostic identity")
        target, control = valid_sha(args.sha), valid_sha(args.control_sha)
        generation = Path(args.generation)
        if not generation.is_absolute() or generation.resolve() != generation or generation.is_symlink():
            raise ValueError("unsafe diagnostic generation")
        request_path = Path(os.environ.get("ENGINE_RELEASE_REQUEST_ROOT", str(STATE_DIR / "engine-release-requests"))) / f"{args.run_id}.request"
        pin_path = Path(os.environ.get("ENGINE_RELEASE_PIN_ROOT", str(STATE_DIR / "engine-release-generation-pins"))) / f"{args.run_id}.generation"
        if (Path(args.request) != request_path or Path(args.pin) != pin_path
                or request_path.parent.resolve() != request_path.parent
                or pin_path.parent.resolve() != pin_path.parent):
            raise ValueError("unbound diagnostic paths")
        if STATE_DIR.is_symlink() or STATE_DIR.resolve() != STATE_DIR:
            raise ValueError("unsafe diagnostic state root")
        source = generation / "engine-release-transaction.sh"
        source_bytes = diagnostic_read(source, private=False)
        if source.is_symlink() or not source.is_file() or len(source_bytes) > 1048576:
            raise ValueError("unsafe transaction source")
        request = diagnostic_read(Path(args.request))
        pin = diagnostic_read(Path(args.pin))
        fields = request.decode().splitlines()
        pin_fields = pin.decode().splitlines()
        if (len(fields) != 6 or fields[0] != target or fields[3] != str(generation)
                or fields[4] != control
                or fields[1] != args.run_url or not RUN_URL_RE.fullmatch(args.run_url)
                or args.run_url.rsplit("/", 1)[-1] != args.run_id.split("-")[0]
                or not fields[5].isdigit() or len(pin_fields) != 2
                or pin_fields != [str(generation), control]):
            raise ValueError("diagnostic request/pin identity mismatch")
        binding = {"runId": args.run_id, "targetSha": target, "controlSha": control,
                   "generation": str(generation), "requestSha256": hashlib.sha256(request).hexdigest(),
                   "pinSha256": hashlib.sha256(pin).hexdigest(),
                   "transactionSha256": hashlib.sha256(source_bytes).hexdigest(),
                   "producerSha256": hashlib.sha256(diagnostic_read(Path(__file__).resolve(), private=False)).hexdigest()}
        root = STATE_DIR / "engine-release-diagnostics"
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError("unsafe retained diagnostic directory")
        parent_fd = os.open(root.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        now = datetime.fromtimestamp(time.time(), ZoneInfo("UTC")).isoformat()
        attempt = {"schema": "engine-release-attempt/v1", "diagnosticOnly": True,
                   "binding": binding, "invocationId": args.invocation_id, "observedAt": now,
                   "terminalObservation": "UNKNOWN_UNTIL_FIRST_REFUSAL_OR_CANONICAL_RESULT"}
        diagnostic_create(root / f"{args.run_id}.attempt-{args.invocation_id}.json", attempt)
        if args.command == "diagnostic-attempt-begin":
            return
        if (not 1 <= args.exit_code <= 255 or not 0 <= args.source_line <= len(source_bytes.splitlines())
                or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}|UNKNOWN", args.stage)):
            raise ValueError("invalid refusal diagnostic")
        lines = source_bytes.splitlines()
        line_hash = hashlib.sha256(lines[args.source_line-1]).hexdigest() if args.source_line else None
        digests = {}
        for label, path in (("seal", STATE_FILE), ("checkpointIntent", Path(args.request).with_suffix(".legacy-checkpoint-intent")),
                            ("breakDeadline", Path(args.request).with_suffix(".break-deadline")),
                            ("awaitingCertificate", Path(args.request).with_suffix(".awaiting-certificate"))):
            try:
                digests[label] = hashlib.sha256(diagnostic_read(path)).hexdigest()
            except FileNotFoundError:
                digests[label] = None
            except (OSError, ValueError):
                digests[label] = "UNKNOWN"
        shell_state = diagnostic_shell_state({
            "checkpointRequired": args.checkpoint_required, "drainedCutover": args.drained_cutover,
            "prepared": args.prepared, "mutationStarted": args.mutation_started, "lockHeld": args.lock_held,
            "checkpointBudgetSeconds": args.checkpoint_budget_seconds, "checkpointWorkMs": args.checkpoint_work_ms,
            "checkpointProfile": args.checkpoint_profile, "predecessorSha": args.predecessor_sha,
            "certificateExitStatus": args.certificate_exit_status, "breakEndEpoch": args.break_end_epoch})
        value = {"schema": "engine-release-first-refusal/v1", "diagnosticOnly": True,
                 "binding": binding, "invocationId": args.invocation_id, "observedAt": now,
                 "origin": args.origin, "stage": args.stage, "exitCode": args.exit_code,
                 "signal": "UNKNOWN", "sourceLine": args.source_line, "sourceLineSha256": line_hash,
                 "command": "SOURCE_LINE_ONLY_NOT_ARGV", "knownStateDigests": digests,
                 "checkpointPath": str(Path(args.request).with_suffix(".legacy-checkpoint-intent")),
                 "shellState": shell_state,
                 "predecessor": {"selectedSha": shell_state["predecessorSha"], "sealSha256": digests["seal"]},
                 "certificate": {"exitStatus": shell_state["certificateExitStatus"], "breakEndEpoch": shell_state["breakEndEpoch"],
                                 "deadlineSha256": digests["breakDeadline"], "awaitingMarkerSha256": digests["awaitingCertificate"]}}
        diagnostic_create(root / f"{args.run_id}.first-refusal.json", value)
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError):
        print("[engine-release-diagnostic] UNKNOWN: original evidence unavailable/conflicting; release outcome unchanged", file=sys.stderr)
        raise SystemExit(1)


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
    binding.add_argument('--promise-floor-proof')
    binding.set_defaults(handler=cmd_bind_routine_window)
    recovery_binding = commands.add_parser('bind-recovery-window')
    recovery_binding.add_argument('--repo', required=True)
    recovery_binding.add_argument('--run-id', required=True)
    recovery_binding.add_argument('--sha', required=True)
    recovery_binding.add_argument('--control-sha', required=True)
    recovery_binding.add_argument('--announced-at', type=int, required=True)
    recovery_binding.add_argument('--promise-floor-proof')
    recovery_binding.add_argument('--nov7-owner', action='store_true')
    recovery_binding.set_defaults(handler=cmd_bind_recovery_window)
    restoring = commands.add_parser('restoration-needed')
    restoring.add_argument('--repo', required=True)
    restoring.add_argument('--sha', required=True)
    restoring.set_defaults(handler=cmd_restoration_needed)
    parked_owner = commands.add_parser('restart-parked-committed-owner')
    parked_owner.add_argument('--engine-lock-fd', type=int, required=True)
    parked_owner.add_argument('--run-id', required=True)
    parked_owner.set_defaults(handler=cmd_restart_parked_committed_owner)
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
    preattach = commands.add_parser('attest-preattach-resolution')
    preattach.add_argument('--run-id', required=True)
    preattach.add_argument('--claim-digest', required=True)
    preattach.set_defaults(handler=cmd_attest_preattach_resolution)
    resolve_terminal = commands.add_parser('resolve-terminal-routine-failures')
    resolve_terminal.add_argument('--repo', default='/opt/club-arena')
    resolve_terminal.add_argument('--engine-lock-fd', type=int, required=True)
    resolve_terminal.add_argument('--run-id', required=True)
    resolve_terminal.add_argument('--sha', required=True)
    resolve_terminal.add_argument('--control-sha', required=True)
    resolve_terminal.add_argument('--invocation-id', required=True)
    resolve_terminal.set_defaults(handler=cmd_resolve_terminal_routine_failures)
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
    recovery_window.add_argument("--certified-policy")
    recovery_window.add_argument("--predecessor-sha")
    recovery_window.add_argument("--deadline", type=int)
    recovery_window.add_argument("--nov7-owner", action="store_true")
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
    attest_result.add_argument("--completion-invocation-id", action="store_true")
    attest_result.set_defaults(handler=cmd_attest_result)

    diagnostic_read_command = commands.add_parser("diagnostic-read")
    for name in ("run-id", "sha", "control-sha", "generation"):
        diagnostic_read_command.add_argument("--" + name, required=True)
    diagnostic_read_command.add_argument("--invocation-id")
    diagnostic_read_command.set_defaults(handler=cmd_diagnostic_read)

    for diagnostic_name in ("diagnostic-attempt-begin", "diagnostic-first-refusal"):
        diagnostic = commands.add_parser(diagnostic_name)
        for name in ("run-id", "sha", "control-sha", "invocation-id", "generation", "request", "pin", "run-url"):
            diagnostic.add_argument("--" + name, required=True)
        diagnostic.add_argument("--origin", choices=("die", "err", "exit"), default="exit")
        diagnostic.add_argument("--stage", default="UNKNOWN")
        for name in ("checkpoint-required", "drained-cutover", "prepared", "mutation-started", "lock-held",
                     "checkpoint-budget-seconds", "checkpoint-work-ms", "checkpoint-profile", "predecessor-sha",
                     "certificate-exit-status", "break-end-epoch"):
            diagnostic.add_argument("--" + name, default="UNKNOWN")
        diagnostic.add_argument("--source-line", type=int, default=0)
        diagnostic.add_argument("--exit-code", type=int, default=1)
        diagnostic.set_defaults(handler=cmd_diagnostic)

    expired_announcement = commands.add_parser("prove-expired-recovery-announcement")
    for name in ("repo", "run-id", "sha", "control-sha"):
        expired_announcement.add_argument("--" + name, required=True)
    expired_announcement.add_argument("--engine-lock-fd", type=int, required=True)
    expired_announcement.set_defaults(handler=cmd_prove_expired_recovery_announcement)

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
