#!/usr/bin/env python3
"""Read-only on-demand readiness CLI for the three-hourly engine cutover.

Reports serving engine health, next scheduled America/Chicago cycle timings
(DST-aware, matching server/src/maintenance/maintenanceSchedule.ts), active
Stage and Backup workflow runs, and first-parent candidate readiness on
refs/remotes/origin/main since the serving SHA.

Strictly read-only: zero writes, zero dispatches, zero watchers/crons, and
zero credential sourcing. Any unreadable API, health, git or projection read
yields verdict UNKNOWN (exit code 3), never READY or NO_CANDIDATE
(CLAUDE.md 10.86).
"""
import argparse
import contextlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SCHEMA_VERSION = 1
DEFAULT_REPO = "Smarter-Software-PIQ/Smarter-Poker-Club-Arena"
DEFAULT_HEALTH_URL = "https://engine.smarter.poker/health"
DEFAULT_CONTROL_REF = "refs/remotes/origin/main"
DEFAULT_LIMIT = 10

CHICAGO = ZoneInfo("America/Chicago")
THREE_HOURLY_START_HOURS = (1, 4, 7, 10, 13, 16, 19, 22)
DAILY_START_HOURS = (4,)

PREPARATION_LEAD_SECONDS = 30 * 60
RECOMMENDED_HOLD_LEAD_SECONDS = 75 * 60
DRAIN_LEAD_SECONDS = 2 * 60
BREAK_DURATION_SECONDS = 5 * 60

STAGE_WORKFLOW = "stage-engine-release.yml"
BACKUP_WORKFLOW = "backup-engine.yml"
PREQUAL_WORKFLOW = "engine-release-prequalification.yml"
PREQUAL_PATH = ".github/workflows/" + PREQUAL_WORKFLOW
BACKUP_STATUS_CONTEXT = "backup-engine/certified"

SHA_RE = re.compile(r"[0-9a-f]{40}")
RUN_URL_RE = re.compile(r"/actions/runs/([1-9]\d*)(?:$|[/#?])")

VERDICT_READY = "READY"
VERDICT_IN_FLIGHT = "IN_FLIGHT"
VERDICT_NO_CANDIDATE = "NO_CANDIDATE"
VERDICT_UNKNOWN = "UNKNOWN"

EXIT_CODES = {
    VERDICT_READY: 0,
    VERDICT_IN_FLIGHT: 0,
    VERDICT_NO_CANDIDATE: 0,
    VERDICT_UNKNOWN: 3,
}

ROOT = Path(__file__).resolve().parents[2]
_PREQUAL_MODULES = {}


class ReadError(Exception):
    """Raised when any required live health, git or GitHub read fails."""


def _git_toplevel(path):
    """Return the resolved git repository root for path via read-only git rev-parse, or None."""
    target = Path(path).expanduser()
    if not target.is_dir():
        return None
    try:
        out = git_read(target, "rev-parse", "--show-toplevel")
    except ReadError:
        return None
    return Path(out).resolve() if out else None


def resolve_repo_root(repo_dir=None, script_root=None, cwd=None):
    """Resolve the local git repository root deterministically.

    Order:
      1. Explicit --repo-dir when provided (must exist and be a git repo; never falls back).
      2. Script's repository root (Path(__file__).resolve().parents[2]) if .git exists.
      3. Current working directory if inside a git repository.
    Fails closed with ReadError (-> verdict UNKNOWN, exit 3) if none resolves.
    """
    if repo_dir is not None:
        candidate = Path(repo_dir).expanduser()
        if not candidate.is_dir():
            raise ReadError(f"--repo-dir is not an existing directory: {repo_dir}")
        resolved = candidate.resolve()
        toplevel = _git_toplevel(resolved)
        if toplevel is None:
            raise ReadError(f"--repo-dir is not a git repository: {resolved}")
        return toplevel

    default_root = Path(script_root) if script_root is not None else ROOT
    if default_root.is_dir() and (default_root / ".git").exists():
        return default_root.resolve()

    current = Path(cwd) if cwd is not None else Path.cwd()
    toplevel = _git_toplevel(current)
    if toplevel is not None:
        return toplevel

    raise ReadError(
        "could not locate a git repository from script path or working directory; "
        "pass --repo-dir <path>"
    )


def load_prequalification_module(repo_root=ROOT):
    """Import scripts/ci/read-engine-prequalification.py relative to repo_root."""
    resolved_root = Path(repo_root).resolve()
    cached = _PREQUAL_MODULES.get(resolved_root)
    if cached is not None:
        return cached
    helper_path = resolved_root / "scripts/ci/read-engine-prequalification.py"
    if not helper_path.is_file():
        raise ReadError(f"missing prequalification reader: {helper_path}")
    spec = importlib.util.spec_from_file_location("read_engine_prequalification", helper_path)
    if spec is None or spec.loader is None:
        raise ReadError(f"could not load prequalification reader: {helper_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _PREQUAL_MODULES[resolved_root] = module
    return module


@contextlib.contextmanager
def _in_directory(path):
    previous = os.getcwd()
    target = str(path)
    if os.path.abspath(previous) == os.path.abspath(target):
        yield
        return
    os.chdir(target)
    try:
        yield
    finally:
        os.chdir(previous)


def control_projection(sha, repo_root=ROOT):
    """Compute CONTROL_INPUTS projection via read-engine-prequalification.py."""
    if not isinstance(sha, str) or not SHA_RE.fullmatch(sha):
        raise ReadError(f"invalid SHA for CONTROL_INPUTS projection: {sha!r}")
    module = load_prequalification_module(repo_root)
    try:
        with _in_directory(repo_root):
            return module.projection(sha)
    except (subprocess.SubprocessError, OSError, ValueError) as exc:
        raise ReadError(f"CONTROL_INPUTS projection failed for {sha[:12]}: {exc}") from exc


def _parse_ls_tree(tree_text):
    entries = {}
    for line in (tree_text or "").splitlines():
        if "\t" not in line:
            continue
        meta, path = line.split("\t", 1)
        parts = meta.split()
        oid = parts[2] if len(parts) >= 3 else meta
        entries[path] = oid
    return entries


def diff_projection_paths(candidate_projection, control_projection_text):
    """Return sorted CONTROL_INPUTS paths whose tree blob differs from control."""
    cand_map = _parse_ls_tree(candidate_projection)
    ctrl_map = _parse_ls_tree(control_projection_text)
    all_paths = sorted(set(cand_map) | set(ctrl_map))
    return [path for path in all_paths if cand_map.get(path) != ctrl_map.get(path)]


def parse_iso_utc(value):
    if not isinstance(value, str) or not value.strip():
        raise ReadError(f"invalid timestamp: {value!r}")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReadError(f"unparseable timestamp {value!r}: {exc}") from exc
    if dt.utcoffset() is None:
        raise ReadError(f"timestamp lacks timezone offset: {value!r}")
    return dt.astimezone(timezone.utc)


def format_utc(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def format_chicago(dt):
    local = dt.astimezone(CHICAGO)
    return local.strftime("%Y-%m-%d %H:%M:%S %Z")


def format_chicago_iso(dt):
    return dt.astimezone(CHICAGO).isoformat(timespec="seconds")


def fetch_health(url=DEFAULT_HEALTH_URL, timeout=15):
    """Read live engine /health over HTTP GET and validate required fields."""
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "smarter-poker-three-hourly-readiness/1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200)
            if status != 200:
                raise ReadError(f"/health returned HTTP {status}")
            raw = resp.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ReadError(f"/health request failed ({url}): {exc}") from exc

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReadError(f"/health returned invalid JSON: {exc}") from exc

    return parse_health_payload(payload, url=url)


def parse_health_payload(payload, url=DEFAULT_HEALTH_URL):
    """Validate and extract required readiness fields from a /health JSON dict."""
    if not isinstance(payload, dict):
        raise ReadError("/health payload is not a JSON object")

    release_sha = payload.get("releaseSha")
    if not isinstance(release_sha, str) or not SHA_RE.fullmatch(release_sha):
        raise ReadError(f"/health missing valid 40-hex releaseSha: {release_sha!r}")

    maintenance = payload.get("maintenance")
    if not isinstance(maintenance, dict):
        raise ReadError("/health missing maintenance object")

    schedule = maintenance.get("schedule")
    if not isinstance(schedule, dict):
        raise ReadError("/health missing maintenance.schedule object")

    frequency = schedule.get("frequency")
    if not isinstance(frequency, str) or frequency not in ("three-hourly", "daily", "phase1-hourly"):
        raise ReadError(f"/health invalid maintenance.schedule.frequency: {frequency!r}")

    raw_hours = schedule.get("startHours")
    if raw_hours is None:
        if frequency == "daily":
            start_hours = list(DAILY_START_HOURS)
        elif frequency == "three-hourly":
            start_hours = list(THREE_HOURLY_START_HOURS)
        else:
            start_hours = []
    else:
        if (
            not isinstance(raw_hours, list)
            or not raw_hours
            or not all(isinstance(h, int) and not isinstance(h, bool) and 0 <= h <= 23 for h in raw_hours)
        ):
            raise ReadError(f"/health invalid maintenance.schedule.startHours: {raw_hours!r}")
        start_hours = list(raw_hours)

    phase = maintenance.get("phase")
    if not isinstance(phase, str) or not phase.strip():
        raise ReadError(f"/health missing maintenance.phase: {phase!r}")

    stalled = payload.get("stalledTableCount")
    if not isinstance(stalled, int) or isinstance(stalled, bool) or stalled < 0:
        raise ReadError(f"/health missing valid stalledTableCount: {stalled!r}")

    return {
        "url": url,
        "liveness": payload.get("liveness"),
        "releaseSha": release_sha,
        "frequency": frequency,
        "startHours": start_hours,
        "phase": phase,
        "stalledTables": stalled,
        "deadStalledTables": payload.get("deadStalledCount"),
        "wholeFleetStalled": payload.get("wholeFleetStalled"),
    }


def compute_next_cycle(now_utc, frequency, start_hours=None):
    """Compute the next scheduled America/Chicago cycle, cutoff and hold start.

    Enumerates real epoch hours matching server/src/maintenance/maintenanceSchedule.ts:
    - three-hourly: 1, 4, 7, 10, 13, 16, 19, 22 America/Chicago
    - daily: 4 America/Chicago
    - spring forward: nonexistent 02:00 is never invented; 01:00 CST and 04:00 CDT
      are two real hours apart
    - fall back: repeated 01:00 produces ONE cycle, the first (CDT), never 01:00 CST
    """
    if now_utc.utcoffset() is None:
        raise ReadError("now_utc must be timezone-aware")
    now_utc = now_utc.astimezone(timezone.utc)
    now_epoch = int(now_utc.timestamp())

    if frequency == "three-hourly":
        slots = tuple(start_hours) if start_hours else THREE_HOURLY_START_HOURS
    elif frequency == "daily":
        slots = tuple(start_hours) if start_hours else DAILY_START_HOURS
    else:
        raise ReadError(f"unsupported schedule frequency for cycle calculation: {frequency!r}")

    if not slots or not all(isinstance(h, int) and 0 <= h <= 23 for h in slots):
        raise ReadError(f"invalid schedule startHours: {slots!r}")

    base_hour_epoch = (now_epoch // 3600) * 3600
    selected_epoch = None
    selected_local = None

    for offset in range(0, 52):
        candidate_epoch = base_hour_epoch + offset * 3600
        if candidate_epoch <= now_epoch:
            continue
        local = datetime.fromtimestamp(candidate_epoch, CHICAGO)
        if local.hour not in slots:
            continue
        prev_local = datetime.fromtimestamp(candidate_epoch - 3600, CHICAGO)
        if prev_local.hour == local.hour:
            # Second occurrence of repeated fall-back hour (e.g., 01:00 CST): skip.
            continue
        selected_epoch = candidate_epoch
        selected_local = local
        break

    if selected_epoch is None or selected_local is None:
        raise ReadError(f"could not resolve next scheduled cycle for frequency={frequency!r}")

    cycle_start_utc = datetime.fromtimestamp(selected_epoch, timezone.utc)
    drain_start_utc = datetime.fromtimestamp(selected_epoch - DRAIN_LEAD_SECONDS, timezone.utc)
    break_end_utc = datetime.fromtimestamp(selected_epoch + BREAK_DURATION_SECONDS, timezone.utc)
    cutoff_epoch = selected_epoch - PREPARATION_LEAD_SECONDS
    cutoff_utc = datetime.fromtimestamp(cutoff_epoch, timezone.utc)
    hold_epoch = cutoff_epoch - RECOMMENDED_HOLD_LEAD_SECONDS
    hold_utc = datetime.fromtimestamp(hold_epoch, timezone.utc)

    cycle_id = (
        selected_local.date().isoformat()
        if selected_local.hour == 4
        else selected_local.strftime("%Y-%m-%dT%H")
    )

    return {
        "cycleId": cycle_id,
        "frequency": frequency,
        "startHours": list(slots),
        "cycleStartEpoch": selected_epoch,
        "cycleStartUtc": format_utc(cycle_start_utc),
        "cycleStartChicago": format_chicago_iso(cycle_start_utc),
        "cycleStartChicagoLabel": format_chicago(cycle_start_utc),
        "drainStartUtc": format_utc(drain_start_utc),
        "breakEndUtc": format_utc(break_end_utc),
        "preparationCutoffEpoch": cutoff_epoch,
        "preparationCutoffUtc": format_utc(cutoff_utc),
        "preparationCutoffChicago": format_chicago_iso(cutoff_utc),
        "preparationCutoffChicagoLabel": format_chicago(cutoff_utc),
        "recommendedHoldStartEpoch": hold_epoch,
        "recommendedHoldStartUtc": format_utc(hold_utc),
        "recommendedHoldStartChicago": format_chicago_iso(hold_utc),
        "recommendedHoldStartChicagoLabel": format_chicago(hold_utc),
        "minutesToHold": round((hold_epoch - now_epoch) / 60.0, 1),
        "minutesToCutoff": round((cutoff_epoch - now_epoch) / 60.0, 1),
        "minutesToCycle": round((selected_epoch - now_epoch) / 60.0, 1),
        "inHoldWindow": now_epoch >= hold_epoch,
        "cutoffPassed": now_epoch >= cutoff_epoch,
    }


def gh_api_get(path, timeout=30):
    """Execute a strictly read-only GitHub REST API GET via `gh api --method GET`."""
    try:
        proc = subprocess.run(
            ["gh", "api", "--method", "GET", path],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ReadError(f"gh api GET {path} failed: {exc}") from exc

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        msg = detail[-1] if detail else f"exit code {proc.returncode}"
        raise ReadError(f"gh api GET {path} failed: {msg}")

    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise ReadError(f"gh api GET {path} returned invalid JSON: {exc}") from exc


def git_read(repo_root, *args, timeout=30):
    """Execute a read-only git inspection command."""
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo_root), "--no-replace-objects", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ReadError(f"git {' '.join(args)} failed: {exc}") from exc

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        msg = detail[-1] if detail else f"exit code {proc.returncode}"
        raise ReadError(f"git {' '.join(args)} failed: {msg}")

    return proc.stdout.strip()


def _parse_run_id_from_url(url):
    if not isinstance(url, str):
        return None
    match = RUN_URL_RE.search(url)
    return int(match.group(1)) if match else None


def _summarize_workflow_run(run):
    return {
        "id": run.get("id"),
        "status": run.get("status"),
        "conclusion": run.get("conclusion"),
        "displayTitle": run.get("display_title") or "",
        "event": run.get("event") or "",
        "headSha": run.get("head_sha") or "",
        "attempt": run.get("run_attempt"),
        "createdAt": run.get("created_at"),
        "updatedAt": run.get("updated_at"),
        "htmlUrl": run.get("html_url") or "",
    }


def list_active_workflow_runs(repo, workflow, gh_get=gh_api_get):
    """Return active (non-completed) runs on branch main for a workflow."""
    data = gh_get(f"repos/{repo}/actions/workflows/{workflow}/runs?branch=main&per_page=15")
    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        raise ReadError(f"unexpected workflow_runs response for {workflow}")
    active = [
        _summarize_workflow_run(r)
        for r in data["workflow_runs"]
        if isinstance(r, dict) and r.get("status") != "completed"
    ]
    return active


def fetch_remote_main_sha(repo, gh_get=gh_api_get):
    """Read remote main head SHA via GitHub REST GET."""
    data = gh_get(f"repos/{repo}/git/ref/heads/main")
    obj = data.get("object") if isinstance(data, dict) else None
    sha = obj.get("sha") if isinstance(obj, dict) else None
    if not isinstance(sha, str) or not SHA_RE.fullmatch(sha):
        raise ReadError(f"unexpected remote main ref response: {data!r}")
    return sha


def fetch_backup_status(repo, sha, gh_get=gh_api_get):
    """Read backup-engine/certified commit status for a SHA."""
    data = gh_get(f"repos/{repo}/commits/{sha}/status")
    if not isinstance(data, dict) or not isinstance(data.get("statuses"), list):
        raise ReadError(f"unexpected commit status response for {sha[:12]}")
    matches = [
        s
        for s in data["statuses"]
        if isinstance(s, dict) and s.get("context") == BACKUP_STATUS_CONTEXT
    ]
    if not matches:
        return {
            "state": "absent",
            "runId": None,
            "description": "",
            "targetUrl": "",
            "updatedAt": None,
        }
    latest = max(matches, key=lambda s: s.get("updated_at") or s.get("created_at") or "")
    state = str(latest.get("state") or "unknown").lower()
    target_url = latest.get("target_url") or ""
    return {
        "state": state,
        "runId": _parse_run_id_from_url(target_url),
        "description": latest.get("description") or "",
        "targetUrl": target_url,
        "updatedAt": latest.get("updated_at") or latest.get("created_at"),
    }


def _is_trusted_prequal_run(run):
    if not isinstance(run, dict):
        return False
    if run.get("event") not in ("push", "workflow_dispatch"):
        return False
    if run.get("head_branch") != "main":
        return False
    path = run.get("path")
    if path is not None and path != PREQUAL_PATH:
        return False
    return True


def fetch_prequal_index(repo, gh_get=gh_api_get):
    """Fetch recent engine-release-prequalification.yml runs on main indexed by head_sha."""
    data = gh_get(f"repos/{repo}/actions/workflows/{PREQUAL_WORKFLOW}/runs?branch=main&per_page=50")
    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        raise ReadError(f"unexpected workflow_runs response for {PREQUAL_WORKFLOW}")
    index = {}
    for run in data["workflow_runs"]:
        if not _is_trusted_prequal_run(run):
            continue
        sha = run.get("head_sha")
        if isinstance(sha, str) and SHA_RE.fullmatch(sha) and sha not in index:
            index[sha] = run
    return index


def fetch_prequal_for_sha(repo, sha, index, gh_get=gh_api_get):
    """Return latest engine-release-prequalification.yml status + run ID for sha."""
    run = index.get(sha)
    if run is None:
        data = gh_get(
            f"repos/{repo}/actions/workflows/{PREQUAL_WORKFLOW}/runs?branch=main&head_sha={sha}&per_page=5"
        )
        if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
            raise ReadError(f"unexpected prequalification runs response for {sha[:12]}")
        for row in data["workflow_runs"]:
            if _is_trusted_prequal_run(row) and row.get("head_sha") == sha:
                run = row
                break
    if run is None:
        return {
            "runId": None,
            "status": "absent",
            "conclusion": None,
            "attempt": None,
            "updatedAt": None,
            "htmlUrl": "",
        }
    return {
        "runId": run.get("id"),
        "status": run.get("status") or "unknown",
        "conclusion": run.get("conclusion"),
        "attempt": run.get("run_attempt"),
        "updatedAt": run.get("updated_at") or run.get("created_at"),
        "htmlUrl": run.get("html_url") or "",
    }


def _format_path_summary(paths, max_paths=3):
    if not paths:
        return "CONTROL_INPUTS tree differs"
    shown = paths[:max_paths]
    extra = len(paths) - len(shown)
    suffix = f" (+{extra} more)" if extra > 0 else ""
    return ", ".join(shown) + suffix


def classify_candidate(
    sha,
    backup_info,
    prequal_info,
    control_inputs_match,
    changed_control_paths,
    schedule,
    active_backup_runs=(),
):
    """Classify one candidate as SELECTABLE, PENDING, or DISQUALIFIED with a single-line reason."""
    if not control_inputs_match:
        return (
            "DISQUALIFIED",
            f"CONTROL_INPUTS mismatch vs origin/main (RC=3): {_format_path_summary(changed_control_paths)}",
        )

    b_state = backup_info["state"]
    if b_state in ("failure", "error"):
        run_note = f" (run {backup_info['runId']})" if backup_info.get("runId") else ""
        return ("DISQUALIFIED", f"backup-engine/certified {b_state}{run_note}")

    p_status = prequal_info["status"]
    p_conclusion = prequal_info.get("conclusion")
    if p_status == "completed" and p_conclusion != "success":
        run_note = f" (run {prequal_info['runId']})" if prequal_info.get("runId") else ""
        return (
            "DISQUALIFIED",
            f"prequalification {p_conclusion or 'unsuccessful'}{run_note}; rerun or newer commit required",
        )

    backup_green = b_state == "success"
    prequal_green = p_status == "completed" and p_conclusion == "success"

    if backup_green and prequal_green:
        if schedule.get("cutoffPassed"):
            cutoff_epoch = schedule["preparationCutoffEpoch"]
            late_parts = []
            if backup_info.get("updatedAt"):
                if parse_iso_utc(backup_info["updatedAt"]).timestamp() > cutoff_epoch:
                    late_parts.append("backup")
            if prequal_info.get("updatedAt"):
                if parse_iso_utc(prequal_info["updatedAt"]).timestamp() > cutoff_epoch:
                    late_parts.append("prequalification")
            if late_parts:
                return (
                    "DISQUALIFIED",
                    f"{' + '.join(late_parts)} completed after {schedule['preparationCutoffUtc']} cutoff (rides next cycle)",
                )
        return ("SELECTABLE", "certified + prequalified + CONTROL_INPUTS match")

    waiting = []
    if not backup_green:
        active_b_run = next((r["id"] for r in active_backup_runs if r.get("headSha") == sha), None)
        b_run_id = backup_info.get("runId") or active_b_run
        b_label = b_state if b_state != "absent" or not active_b_run else "in_progress"
        waiting.append(f"backup={b_label}" + (f" (run {b_run_id})" if b_run_id else ""))
    if not prequal_green:
        p_run_id = prequal_info.get("runId")
        waiting.append(f"prequal={p_status}" + (f" (run {p_run_id})" if p_run_id else ""))
    return ("PENDING", "awaiting " + ", ".join(waiting))


def walk_candidates_git(repo_root, control_ref, serving_sha, limit, git_fn=git_read):
    """Read control SHA and first-parent commits since serving_sha from local git."""
    control_sha = git_fn(repo_root, "rev-parse", "--verify", f"{control_ref}^{{commit}}")
    if not SHA_RE.fullmatch(control_sha):
        raise ReadError(f"invalid control SHA resolved from {control_ref}: {control_sha!r}")

    # Verify serving_sha is known locally and an ancestor of control_sha.
    try:
        git_fn(repo_root, "rev-parse", "--verify", f"{serving_sha}^{{commit}}")
    except ReadError as exc:
        raise ReadError(
            f"serving SHA {serving_sha[:12]} not found in local git; run: git fetch origin main"
        ) from exc

    try:
        git_fn(repo_root, "merge-base", "--is-ancestor", serving_sha, control_sha)
    except ReadError as exc:
        raise ReadError(
            f"serving SHA {serving_sha[:12]} is not an ancestor of {control_ref} ({control_sha[:12]}); "
            "run: git fetch origin main"
        ) from exc

    raw_commits = git_fn(repo_root, "rev-list", "--first-parent", f"{serving_sha}..{control_sha}")
    all_shas = [line for line in raw_commits.splitlines() if line]
    selected_shas = all_shas[:limit]

    subjects = {}
    for sha in selected_shas:
        subjects[sha] = git_fn(repo_root, "show", "-s", "--format=%s", sha)

    return {
        "controlRef": control_ref,
        "controlSha": control_sha,
        "servingSha": serving_sha,
        "totalCommitsSinceServing": len(all_shas),
        "limit": limit,
        "shas": selected_shas,
        "subjects": subjects,
    }


ACTIVE_RUN_STATUSES = frozenset({"queued", "in_progress", "waiting", "pending", "requested"})


def _candidate_in_flight(candidate, active_backup):
    b_state = candidate["backup"]["state"]
    p_status = candidate["prequalification"]["status"]
    if b_state == "pending" or p_status in ACTIVE_RUN_STATUSES:
        return True
    return any(r.get("headSha") == candidate["sha"] for r in active_backup)


def determine_verdict(health, candidates, active_backup, git_info):
    """Compute top-level readiness verdict and single-line summary."""
    phase = health["phase"]
    if phase != "idle":
        return (
            VERDICT_IN_FLIGHT,
            None,
            f"engine maintenance phase is {phase} (cutover or break active)",
        )

    selectable = next((c for c in candidates if c["status"] == "SELECTABLE"), None)
    if selectable is not None:
        idx = candidates.index(selectable)
        newer_pending = [c for c in candidates[:idx] if c["status"] == "PENDING"]
        extra = f"; {len(newer_pending)} newer commit(s) still pending" if newer_pending else ""
        return (
            VERDICT_READY,
            selectable["sha"],
            f"selectable candidate {selectable['sha'][:12]} ({selectable['subject'][:60]}){extra}",
        )

    in_flight = [
        c for c in candidates if c["status"] == "PENDING" and _candidate_in_flight(c, active_backup)
    ]
    if in_flight:
        newest = in_flight[0]
        active_ids = ", ".join(str(r["id"]) for r in active_backup if r.get("id"))
        backup_note = f"; active backup run(s): {active_ids}" if active_ids else ""
        return (
            VERDICT_IN_FLIGHT,
            None,
            f"no selectable candidate yet; {newest['sha'][:12]} is in flight ({newest['reason']}){backup_note}",
        )

    if active_backup:
        active_ids = ", ".join(str(r["id"]) for r in active_backup if r.get("id"))
        return (
            VERDICT_IN_FLIGHT,
            None,
            f"no selectable candidate yet; active backup-engine.yml run(s): {active_ids}",
        )

    if git_info["totalCommitsSinceServing"] == 0:
        return (
            VERDICT_NO_CANDIDATE,
            None,
            f"origin/main ({git_info['controlSha'][:12]}) matches serving SHA ({git_info['servingSha'][:12]})",
        )

    newest = candidates[0] if candidates else None
    if newest is not None:
        return (
            VERDICT_NO_CANDIDATE,
            None,
            f"0 selectable of {len(candidates)} candidate(s); newest {newest['sha'][:12]}: {newest['reason']}",
        )

    return (VERDICT_NO_CANDIDATE, None, "no selectable candidates found")


def collect_readiness(
    repo=DEFAULT_REPO,
    limit=DEFAULT_LIMIT,
    health_url=DEFAULT_HEALTH_URL,
    control_ref=DEFAULT_CONTROL_REF,
    repo_root=None,
    repo_dir=None,
    now_utc=None,
    health_fn=None,
    gh_get_fn=None,
    git_fn=None,
    projection_fn=None,
):
    """Collect live readiness state across health, schedule, GitHub workflows and git."""
    if not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0:
        raise ValueError("--limit must be a positive integer")

    checked_at = (now_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
    health_reader = health_fn or (lambda: fetch_health(health_url))
    gh_reader = gh_get_fn or gh_api_get
    git_reader = git_fn or git_read

    report = {
        "schema": SCHEMA_VERSION,
        "verdict": VERDICT_UNKNOWN,
        "summary": "",
        "checkedAtUtc": format_utc(checked_at),
        "checkedAtChicago": format_chicago_iso(checked_at),
        "checkedAtChicagoLabel": format_chicago(checked_at),
        "repo": repo,
        "health": None,
        "schedule": None,
        "git": None,
        "activeRuns": {"stage": [], "backup": []},
        "selectableSha": None,
        "candidates": [],
        "errors": [],
    }

    try:
        if repo_dir is not None:
            resolved_root = resolve_repo_root(repo_dir=repo_dir)
        elif repo_root is not None:
            resolved_root = Path(repo_root)
        else:
            resolved_root = resolve_repo_root()
    except ReadError as exc:
        report["errors"].append(str(exc))
        report["summary"] = str(exc)
        return report

    proj_reader = projection_fn or (lambda sha: control_projection(sha, repo_root=resolved_root))

    try:
        health = health_reader()
        report["health"] = health
        schedule = compute_next_cycle(checked_at, health["frequency"], health["startHours"])
        report["schedule"] = schedule
    except ReadError as exc:
        report["errors"].append(str(exc))
        report["summary"] = str(exc)
        return report

    try:
        active_stage = list_active_workflow_runs(repo, STAGE_WORKFLOW, gh_get=gh_reader)
        active_backup = list_active_workflow_runs(repo, BACKUP_WORKFLOW, gh_get=gh_reader)
        report["activeRuns"] = {"stage": active_stage, "backup": active_backup}

        remote_main_sha = fetch_remote_main_sha(repo, gh_get=gh_reader)
        git_walk = walk_candidates_git(
            resolved_root, control_ref, health["releaseSha"], limit, git_fn=git_reader
        )
        control_sha = git_walk["controlSha"]
        local_ref_stale = remote_main_sha != control_sha
        report["git"] = {
            "repoDir": str(resolved_root),
            "controlRef": control_ref,
            "controlSha": control_sha,
            "remoteMainSha": remote_main_sha,
            "localRefStale": local_ref_stale,
            "servingSha": health["releaseSha"],
            "totalCommitsSinceServing": git_walk["totalCommitsSinceServing"],
            "limit": limit,
        }

        control_proj = proj_reader(control_sha)
        prequal_index = fetch_prequal_index(repo, gh_get=gh_reader)

        candidates = []
        for sha in git_walk["shas"]:
            backup_info = fetch_backup_status(repo, sha, gh_get=gh_reader)
            prequal_info = fetch_prequal_for_sha(repo, sha, prequal_index, gh_get=gh_reader)
            cand_proj = proj_reader(sha)
            ctrl_match = cand_proj == control_proj
            changed_paths = [] if ctrl_match else diff_projection_paths(cand_proj, control_proj)
            status, reason = classify_candidate(
                sha=sha,
                backup_info=backup_info,
                prequal_info=prequal_info,
                control_inputs_match=ctrl_match,
                changed_control_paths=changed_paths,
                schedule=schedule,
                active_backup_runs=active_backup,
            )
            candidates.append(
                {
                    "sha": sha,
                    "shortSha": sha[:12],
                    "subject": git_walk["subjects"].get(sha, ""),
                    "backup": backup_info,
                    "prequalification": prequal_info,
                    "controlInputsMatch": ctrl_match,
                    "changedControlPaths": changed_paths,
                    "status": status,
                    "reason": reason,
                }
            )
        report["candidates"] = candidates

        verdict, selectable_sha, summary = determine_verdict(
            health, candidates, active_backup, report["git"]
        )
        report["verdict"] = verdict
        report["selectableSha"] = selectable_sha
        report["summary"] = summary
    except ReadError as exc:
        report["verdict"] = VERDICT_UNKNOWN
        report["selectableSha"] = None
        report["errors"].append(str(exc))
        report["summary"] = str(exc)

    return report


def _format_minutes(minutes):
    if minutes < 0:
        return f"{abs(minutes):.1f}m ago"
    return f"in {minutes:.1f}m"


def _format_prequal_cell(prequal):
    status = prequal.get("status") or "absent"
    conclusion = prequal.get("conclusion")
    run_id = prequal.get("runId")
    label = conclusion if (status == "completed" and conclusion) else status
    if run_id:
        return f"{label} (#{run_id})"
    return label


def _format_backup_cell(backup):
    state = backup.get("state") or "absent"
    run_id = backup.get("runId")
    if run_id:
        return f"{state} (#{run_id})"
    return state


def render_table(report):
    """Render a concise ASCII readiness report for terminal and chat use."""
    lines = [
        "THREE-HOURLY ENGINE CUTOVER READINESS",
        "=====================================",
        f"Verdict:         {report['verdict']}",
        f"Summary:         {report['summary']}",
        f"Checked At:      {report['checkedAtUtc']} ({report['checkedAtChicagoLabel']})",
    ]

    health = report.get("health")
    if health:
        lines.extend(
            [
                "",
                f"SERVING ENGINE ({health['url']})",
                f"  releaseSha:    {health['releaseSha']}",
                f"  schedule:      {health['frequency']} {health['startHours']}",
                f"  phase:         {health['phase']}",
                f"  stalledTables: {health['stalledTables']}",
            ]
        )

    schedule = report.get("schedule")
    if schedule:
        hold_note = (
            "ACTIVE - hold migrations + release controls"
            if schedule["inHoldWindow"]
            else f"starts {_format_minutes(schedule['minutesToHold'])}"
        )
        cutoff_note = (
            f"PASSED - {_format_minutes(schedule['minutesToCutoff'])}"
            if schedule["cutoffPassed"]
            else _format_minutes(schedule["minutesToCutoff"])
        )
        lines.extend(
            [
                "",
                f"NEXT SCHEDULED CYCLE ({schedule['cycleId']})",
                f"  cycleStart:    {schedule['cycleStartUtc']} | {schedule['cycleStartChicagoLabel']} ({_format_minutes(schedule['minutesToCycle'])})",
                f"  prepCutoff:    {schedule['preparationCutoffUtc']} | {schedule['preparationCutoffChicagoLabel']} ({cutoff_note})",
                f"  holdStart:     {schedule['recommendedHoldStartUtc']} | {schedule['recommendedHoldStartChicagoLabel']} ({hold_note})",
            ]
        )

    active = report.get("activeRuns") or {}
    stage_runs = active.get("stage") or []
    backup_runs = active.get("backup") or []
    lines.append("")
    lines.append("ACTIVE WORKFLOWS")
    if stage_runs:
        parts = [
            f"run {r['id']} [{r['status']}] {(r.get('headSha') or '')[:12]} \"{r.get('displayTitle', '')}\""
            for r in stage_runs
        ]
        lines.append(f"  {STAGE_WORKFLOW}: {len(stage_runs)} active -> " + "; ".join(parts))
    else:
        lines.append(f"  {STAGE_WORKFLOW}: none active")

    if backup_runs:
        parts = [
            f"run {r['id']} [{r['status']}] {(r.get('headSha') or '')[:12]}"
            for r in backup_runs
        ]
        lines.append(f"  {BACKUP_WORKFLOW}: {len(backup_runs)} active -> " + "; ".join(parts))
    else:
        lines.append(f"  {BACKUP_WORKFLOW}: none active")

    git_info = report.get("git")
    if git_info:
        lines.append("")
        if git_info.get("localRefStale"):
            lines.append(
                f"NOTE: local {git_info['controlRef']} ({git_info['controlSha'][:12]}) differs from "
                f"remote main ({git_info['remoteMainSha'][:12]}); run: git fetch origin main"
            )
        shown = len(report.get("candidates") or [])
        total = git_info["totalCommitsSinceServing"]
        lines.append(
            f"CANDIDATES ON {git_info['controlRef']} SINCE {git_info['servingSha'][:12]} "
            f"(showing {shown} of {total}; control={git_info['controlSha'][:12]})"
        )
        candidates = report.get("candidates") or []
        if not candidates:
            lines.append("  (none - origin/main matches serving SHA)")
        else:
            headers = ("SHA", "BACKUP", "PREQUAL", "CTRL", "STATUS", "REASON")
            rows = [
                (
                    c["shortSha"],
                    _format_backup_cell(c["backup"]),
                    _format_prequal_cell(c["prequalification"]),
                    "MATCH" if c["controlInputsMatch"] else "DIFF",
                    c["status"],
                    c["reason"],
                )
                for c in candidates
            ]
            widths = [
                max(len(headers[i]), *(len(r[i]) for r in rows))
                for i in range(len(headers) - 1)
            ]
            fmt = "  ".join(f"{{:<{w}}}" for w in widths) + "  {}"
            lines.append(fmt.format(*headers))
            lines.append(fmt.format(*("-" * w for w in widths), "-" * 40))
            for row in rows:
                lines.append(fmt.format(*row))

    if report.get("errors"):
        lines.append("")
        lines.append("ERRORS")
        for err in report["errors"]:
            lines.append(f"  - {err}")

    return "\n".join(lines)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Read-only readiness check for the next three-hourly engine cutover."
    )
    parser.add_argument(
        "--repo",
        default=DEFAULT_REPO,
        help=f"GitHub repository owner/name (default: {DEFAULT_REPO})",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON instead of the human-readable table",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Maximum first-parent commits since serving SHA to inspect (default: {DEFAULT_LIMIT})",
    )
    parser.add_argument(
        "--health-url",
        default=DEFAULT_HEALTH_URL,
        help=f"Live engine health endpoint (default: {DEFAULT_HEALTH_URL})",
    )
    parser.add_argument(
        "--control-ref",
        default=DEFAULT_CONTROL_REF,
        help=f"Local protected main ref to walk (default: {DEFAULT_CONTROL_REF})",
    )
    parser.add_argument(
        "--repo-dir",
        default=None,
        help="Optional path to a local git checkout (defaults to script repo root if .git exists, else cwd)",
    )
    parser.add_argument(
        "--now",
        help="Optional ISO-8601 UTC timestamp for deterministic schedule evaluation",
    )
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.limit <= 0:
        parser.error("--limit must be a positive integer")

    now_utc = None
    if args.now:
        try:
            now_utc = parse_iso_utc(args.now)
        except ReadError as exc:
            parser.error(str(exc))

    try:
        report = collect_readiness(
            repo=args.repo,
            limit=args.limit,
            health_url=args.health_url,
            control_ref=args.control_ref,
            repo_dir=args.repo_dir,
            now_utc=now_utc,
        )
    except Exception as exc:  # fail closed to UNKNOWN (CLAUDE.md 10.86)
        checked_at = now_utc or datetime.now(timezone.utc)
        report = {
            "schema": SCHEMA_VERSION,
            "verdict": VERDICT_UNKNOWN,
            "summary": f"unexpected readiness error: {exc}",
            "checkedAtUtc": format_utc(checked_at),
            "checkedAtChicago": format_chicago_iso(checked_at),
            "checkedAtChicagoLabel": format_chicago(checked_at),
            "repo": args.repo,
            "health": None,
            "schedule": None,
            "git": None,
            "activeRuns": {"stage": [], "backup": []},
            "selectableSha": None,
            "candidates": [],
            "errors": [str(exc)],
        }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(render_table(report))

    return EXIT_CODES.get(report["verdict"], 3)


if __name__ == "__main__":
    sys.exit(main())
