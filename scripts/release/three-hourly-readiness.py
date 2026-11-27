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
import io
import json
import os
import re
import subprocess
import sys
import types
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SCHEMA_VERSION = 1
DEFAULT_REPO = "Smarter-Software-PIQ/Smarter-Poker-Club-Arena"
DEFAULT_HEALTH_URL = "https://engine.smarter.poker/health"
DEFAULT_CONTROL_REF = "refs/remotes/origin/main"
DEFAULT_LIMIT = 10
SELECTABLE_SEARCH_LIMIT = 60

CHICAGO = ZoneInfo("America/Chicago")
THREE_HOURLY_START_HOURS = (1, 4, 7, 10, 13, 16, 19, 22)
DAILY_START_HOURS = (4,)

PREPARATION_LEAD_SECONDS = 30 * 60
RECOMMENDED_HOLD_LEAD_SECONDS = 75 * 60
DRAIN_LEAD_SECONDS = 2 * 60
BREAK_DURATION_SECONDS = 5 * 60
O3_PRE_CUTOFF_DEFER_SECONDS = 150 * 60
O3_POST_SEAL_CLEAR_SECONDS = 10 * 60
NIGHTLY_FREEZE_START_CHICAGO = (23, 45)
NIGHTLY_FREEZE_END_CHICAGO = (4, 15)
CLOSED_STAGE_LOOKBACK_SECONDS = 5 * 60

GATE_NIGHTLY_FREEZE = "NIGHTLY_FREEZE"
GATE_O3_DEFERRAL = "O3_DEFERRAL"
GATE_OPEN = "OPEN"

STAGE_WORKFLOW = "stage-engine-release.yml"
BACKUP_WORKFLOW = "backup-engine.yml"
PREQUAL_WORKFLOW = "engine-release-prequalification.yml"
PREQUAL_PATH = ".github/workflows/" + PREQUAL_WORKFLOW
PREQUAL_HELPER_PATH = "scripts/ci/read-engine-prequalification.py"
APPLY_WORKFLOW = "apply-merged-migration.yml"
WINDOW_INSTALL_JOB = "Install Queued Daily-Maintenance Migrations"
INSTALLED_MIGRATIONS_HELPER_PATH = "server/scripts/engine-release-installed-migrations.py"
# The applier prints "[apply] <file>" before an attempt and "[apply] APPLIED" when it committed it
# (scripts/ci/apply-recorded-migration.mjs); ALREADY-APPLIED, QUEUED and refusals commit nothing.
APPLY_FILE_LINE_RE = re.compile(r"^\[apply\] (\d{14}_[A-Za-z0-9_.-]+\.sql)\s*$")
APPLY_COMMITTED_LINE = "[apply] APPLIED"
LOG_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?")
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


def load_prequalification_module(repo_root=ROOT, control_sha=None):
    """Import scripts/ci/read-engine-prequalification.py from control_sha blob or repo_root.

    When control_sha (valid 40-hex commit SHA) is provided, reads the exact git
    blob via `git show <control_sha>:scripts/ci/read-engine-prequalification.py`
    into an in-memory module cached by (resolved_root, control_sha) so a stale
    working tree on disk can never skew CONTROL_INPUTS comparisons. When
    control_sha is None, falls back to the local working-tree file for legacy
    callers and tests.
    """
    resolved_root = Path(repo_root).resolve()
    if control_sha is not None:
        if not isinstance(control_sha, str) or not SHA_RE.fullmatch(control_sha):
            raise ReadError(f"invalid control_sha for prequalification reader: {control_sha!r}")
        cache_key = (resolved_root, control_sha)
        cached = _PREQUAL_MODULES.get(cache_key)
        if cached is not None:
            return cached
        source = git_read(resolved_root, "show", f"{control_sha}:{PREQUAL_HELPER_PATH}")
        if not source:
            raise ReadError(
                f"empty prequalification reader blob at {control_sha[:12]}:{PREQUAL_HELPER_PATH}"
            )
        module = types.ModuleType("read_engine_prequalification")
        blob_label = f"{resolved_root}:{control_sha}:{PREQUAL_HELPER_PATH}"
        module.__file__ = blob_label
        try:
            code = compile(source, blob_label, "exec")
            exec(code, module.__dict__)
        except Exception as exc:
            raise ReadError(
                f"failed to load prequalification reader from {control_sha[:12]}:{PREQUAL_HELPER_PATH}: {exc}"
            ) from exc
        if not callable(getattr(module, "projection", None)):
            raise ReadError(
                f"prequalification reader at {control_sha[:12]}:{PREQUAL_HELPER_PATH} missing projection()"
            )
        _PREQUAL_MODULES[cache_key] = module
        return module

    cache_key = (resolved_root, None)
    cached = _PREQUAL_MODULES.get(cache_key)
    if cached is not None:
        return cached
    helper_path = resolved_root / PREQUAL_HELPER_PATH
    if not helper_path.is_file():
        raise ReadError(f"missing prequalification reader: {helper_path}")
    spec = importlib.util.spec_from_file_location("read_engine_prequalification", helper_path)
    if spec is None or spec.loader is None:
        raise ReadError(f"could not load prequalification reader: {helper_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _PREQUAL_MODULES[cache_key] = module
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


def control_projection(sha, repo_root=ROOT, control_sha=None):
    """Compute CONTROL_INPUTS projection via read-engine-prequalification.py."""
    if not isinstance(sha, str) or not SHA_RE.fullmatch(sha):
        raise ReadError(f"invalid SHA for CONTROL_INPUTS projection: {sha!r}")
    module = load_prequalification_module(repo_root, control_sha=control_sha)
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


def _resolve_schedule_slots(frequency, start_hours=None):
    if frequency == "three-hourly":
        slots = tuple(start_hours) if start_hours else THREE_HOURLY_START_HOURS
    elif frequency == "daily":
        slots = tuple(start_hours) if start_hours else DAILY_START_HOURS
    else:
        raise ReadError(f"unsupported schedule frequency for cycle calculation: {frequency!r}")

    if not slots or not all(isinstance(h, int) and not isinstance(h, bool) and 0 <= h <= 23 for h in slots):
        raise ReadError(f"invalid schedule startHours: {slots!r}")
    return slots


def _iter_scheduled_cycles(now_epoch, slots, max_hours=76):
    """Yield (cycle_epoch, cycle_local) for real scheduled America/Chicago hours."""
    base_hour_epoch = (now_epoch // 3600) * 3600
    for offset in range(0, max_hours):
        candidate_epoch = base_hour_epoch + offset * 3600
        local = datetime.fromtimestamp(candidate_epoch, CHICAGO)
        if local.hour not in slots:
            continue
        prev_local = datetime.fromtimestamp(candidate_epoch - 3600, CHICAGO)
        if prev_local.hour == local.hour:
            # Second occurrence of repeated fall-back hour (e.g., 01:00 CST): skip.
            continue
        yield candidate_epoch, local


def _in_nightly_freeze_chicago(dt_utc):
    """True when dt_utc falls inside RELEASE_SCHEMA_FREEZE_CHICAGO (23:45-04:15 Chicago)."""
    local = dt_utc.astimezone(CHICAGO)
    minute_of_day = local.hour * 60 + local.minute
    from_min = NIGHTLY_FREEZE_START_CHICAGO[0] * 60 + NIGHTLY_FREEZE_START_CHICAGO[1]
    until_min = NIGHTLY_FREEZE_END_CHICAGO[0] * 60 + NIGHTLY_FREEZE_END_CHICAGO[1]
    return minute_of_day >= from_min or minute_of_day < until_min


def _nightly_freeze_clear_utc(dt_utc):
    """Return the 04:15 America/Chicago clear instant (UTC) for an instant in nightly freeze."""
    local = dt_utc.astimezone(CHICAGO)
    minute_of_day = local.hour * 60 + local.minute
    from_min = NIGHTLY_FREEZE_START_CHICAGO[0] * 60 + NIGHTLY_FREEZE_START_CHICAGO[1]
    anchor_date = local.date() + timedelta(days=1) if minute_of_day >= from_min else local.date()
    clear_local = datetime(
        anchor_date.year,
        anchor_date.month,
        anchor_date.day,
        NIGHTLY_FREEZE_END_CHICAGO[0],
        NIGHTLY_FREEZE_END_CHICAGO[1],
        tzinfo=CHICAGO,
    )
    return anchor_date, clear_local.astimezone(timezone.utc)


def _nightly_freeze_bounds_for_anchor(anchor_local):
    """Return (start_utc, clear_utc) for the 04:00 anchor's 23:45-04:15 Chicago freeze."""
    prev_date = anchor_local.date() - timedelta(days=1)
    start_local = datetime(
        prev_date.year,
        prev_date.month,
        prev_date.day,
        NIGHTLY_FREEZE_START_CHICAGO[0],
        NIGHTLY_FREEZE_START_CHICAGO[1],
        tzinfo=CHICAGO,
    )
    end_local = datetime(
        anchor_local.year,
        anchor_local.month,
        anchor_local.day,
        NIGHTLY_FREEZE_END_CHICAGO[0],
        NIGHTLY_FREEZE_END_CHICAGO[1],
        tzinfo=CHICAGO,
    )
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _build_cycle_record(now_epoch, selected_epoch, selected_local, frequency, slots):
    cycle_start_utc = datetime.fromtimestamp(selected_epoch, timezone.utc)
    drain_start_utc = datetime.fromtimestamp(selected_epoch - DRAIN_LEAD_SECONDS, timezone.utc)
    break_end_utc = datetime.fromtimestamp(selected_epoch + BREAK_DURATION_SECONDS, timezone.utc)
    cutoff_epoch = selected_epoch - PREPARATION_LEAD_SECONDS
    cutoff_utc = datetime.fromtimestamp(cutoff_epoch, timezone.utc)
    hold_epoch = cutoff_epoch - RECOMMENDED_HOLD_LEAD_SECONDS
    hold_utc = datetime.fromtimestamp(hold_epoch, timezone.utc)

    if selected_local.hour == 4:
        o3_defer_kind = "nightly-freeze"
        defer_start_utc, clear_utc = _nightly_freeze_bounds_for_anchor(selected_local)
        defer_start_epoch = int(defer_start_utc.timestamp())
        clear_epoch = int(clear_utc.timestamp())
    elif frequency == "three-hourly":
        o3_defer_kind = "o3-deferral"
        defer_start_epoch = selected_epoch - O3_PRE_CUTOFF_DEFER_SECONDS
        defer_start_utc = datetime.fromtimestamp(defer_start_epoch, timezone.utc)
        clear_epoch = selected_epoch + O3_POST_SEAL_CLEAR_SECONDS
        clear_utc = datetime.fromtimestamp(clear_epoch, timezone.utc)
    else:
        o3_defer_kind = None
        defer_start_epoch = None
        defer_start_utc = None
        clear_epoch = None
        clear_utc = None

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
        "o3DeferKind": o3_defer_kind,
        "o3DeferStartEpoch": defer_start_epoch,
        "o3DeferStartUtc": format_utc(defer_start_utc) if defer_start_utc else None,
        "o3DeferStartChicago": format_chicago_iso(defer_start_utc) if defer_start_utc else None,
        "o3DeferStartChicagoLabel": format_chicago(defer_start_utc) if defer_start_utc else None,
        "o3ClearEpoch": clear_epoch,
        "o3ClearUtc": format_utc(clear_utc) if clear_utc else None,
        "o3ClearChicago": format_chicago_iso(clear_utc) if clear_utc else None,
        "o3ClearChicagoLabel": format_chicago(clear_utc) if clear_utc else None,
        "minutesToO3Defer": (
            round((defer_start_epoch - now_epoch) / 60.0, 1)
            if defer_start_epoch is not None
            else None
        ),
        "inO3DeferWindow": (
            defer_start_epoch <= now_epoch < clear_epoch
            if defer_start_epoch is not None and clear_epoch is not None
            else False
        ),
        "minutesToHold": round((hold_epoch - now_epoch) / 60.0, 1),
        "minutesToCutoff": round((cutoff_epoch - now_epoch) / 60.0, 1),
        "minutesToCycle": round((selected_epoch - now_epoch) / 60.0, 1),
        "inHoldWindow": now_epoch >= hold_epoch,
        "cutoffPassed": now_epoch >= cutoff_epoch,
    }


def compute_next_cycle(now_utc, frequency, start_hours=None):
    """Compute the next scheduled America/Chicago cycle, cutoff, O3 deferral and hold start.

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
    slots = _resolve_schedule_slots(frequency, start_hours)

    for candidate_epoch, local in _iter_scheduled_cycles(now_epoch, slots, max_hours=52):
        if candidate_epoch <= now_epoch:
            continue
        return _build_cycle_record(now_epoch, candidate_epoch, local, frequency, slots)

    raise ReadError(f"could not resolve next scheduled cycle for frequency={frequency!r}")


def compute_next_open_cycle(now_utc, frequency, start_hours=None):
    """Return the first scheduled cycle whose preparationCutoffEpoch > now_epoch.

    When nextCycle.cutoffPassed is False this equals compute_next_cycle(); once
    the current cycle's :30 cutoff has passed it advances to the following cycle.
    """
    if now_utc.utcoffset() is None:
        raise ReadError("now_utc must be timezone-aware")
    now_utc = now_utc.astimezone(timezone.utc)
    now_epoch = int(now_utc.timestamp())
    slots = _resolve_schedule_slots(frequency, start_hours)

    for candidate_epoch, local in _iter_scheduled_cycles(now_epoch, slots, max_hours=76):
        if candidate_epoch <= now_epoch:
            continue
        if candidate_epoch - PREPARATION_LEAD_SECONDS <= now_epoch:
            continue
        return _build_cycle_record(now_epoch, candidate_epoch, local, frequency, slots)

    raise ReadError(f"could not resolve next open cycle for frequency={frequency!r}")


def compute_migration_gate(now_utc, frequency, start_hours=None):
    """Compute ordinary merged-migration deferral gate matching merged-migration-dispatch.mjs.

    Matches RELEASE_SCHEMA_FREEZE_CHICAGO (23:45-04:15 America/Chicago) and
    Optimization O3 ([cycleStart - 150m, cycleStart + 10m) on three-hourly cadence, O21),
    DST-aware across spring-forward and fall-back transitions.
    """
    if now_utc.utcoffset() is None:
        raise ReadError("now_utc must be timezone-aware")
    now_utc = now_utc.astimezone(timezone.utc)
    now_epoch = int(now_utc.timestamp())
    slots = _resolve_schedule_slots(frequency, start_hours)

    if _in_nightly_freeze_chicago(now_utc):
        anchor_date, clear_utc = _nightly_freeze_clear_utc(now_utc)
        clear_epoch = int(clear_utc.timestamp())
        return {
            "status": GATE_NIGHTLY_FREEZE,
            "reason": "RELEASE_SCHEMA_FREEZE_CHICAGO (23:45-04:15 America/Chicago) holds ordinary merged migrations",
            "cycleId": anchor_date.isoformat(),
            "clearAtEpoch": clear_epoch,
            "clearAtUtc": format_utc(clear_utc),
            "clearAtChicago": format_chicago_iso(clear_utc),
            "clearAtChicagoLabel": format_chicago(clear_utc),
            "minutesToClear": round((clear_epoch - now_epoch) / 60.0, 1),
            "nextDeferKind": None,
            "nextDeferStartEpoch": None,
            "nextDeferStartUtc": None,
            "nextDeferStartChicago": None,
            "nextDeferStartChicagoLabel": None,
            "minutesToNextDefer": None,
        }

    if frequency == "three-hourly":
        # Look as many whole hours ahead as the deferral reaches (offsets 0..3 for
        # 150 minutes, O21 part 2). A fixed 3 (offsets 0..2) only fit 90 minutes and
        # silently reported OPEN for the first hour of a 150-minute deferral.
        look_ahead = -(-O3_PRE_CUTOFF_DEFER_SECONDS // 3600) + 1
        for cycle_epoch, local in _iter_scheduled_cycles(now_epoch, slots, max_hours=look_ahead):
            if local.hour == 4:
                continue
            defer_start = cycle_epoch - O3_PRE_CUTOFF_DEFER_SECONDS
            clear_epoch = cycle_epoch + O3_POST_SEAL_CLEAR_SECONDS
            if defer_start <= now_epoch < clear_epoch:
                cycle_id = local.strftime("%Y-%m-%dT%H")
                raw_clear_utc = datetime.fromtimestamp(clear_epoch, timezone.utc)
                if _in_nightly_freeze_chicago(raw_clear_utc):
                    _, effective_clear_utc = _nightly_freeze_clear_utc(raw_clear_utc)
                    effective_clear_epoch = int(effective_clear_utc.timestamp())
                    reason = (
                        f"O3 pre-cutoff deferral active for {cycle_id} "
                        f"({local.hour:02d}:00 America/Chicago cycle), continuing into "
                        "RELEASE_SCHEMA_FREEZE_CHICAGO until 04:15 America/Chicago"
                    )
                else:
                    effective_clear_utc = raw_clear_utc
                    effective_clear_epoch = clear_epoch
                    defer_local = datetime.fromtimestamp(defer_start, CHICAGO)
                    clear_local = effective_clear_utc.astimezone(CHICAGO)
                    reason = (
                        f"O3 pre-cutoff deferral active for {cycle_id} "
                        f"({defer_local.strftime('%H:%M')}-{clear_local.strftime('%H:%M')} America/Chicago)"
                    )
                return {
                    "status": GATE_O3_DEFERRAL,
                    "reason": reason,
                    "cycleId": cycle_id,
                    "clearAtEpoch": effective_clear_epoch,
                    "clearAtUtc": format_utc(effective_clear_utc),
                    "clearAtChicago": format_chicago_iso(effective_clear_utc),
                    "clearAtChicagoLabel": format_chicago(effective_clear_utc),
                    "minutesToClear": round((effective_clear_epoch - now_epoch) / 60.0, 1),
                    "nextDeferKind": None,
                    "nextDeferStartEpoch": None,
                    "nextDeferStartUtc": None,
                    "nextDeferStartChicago": None,
                    "nextDeferStartChicagoLabel": None,
                    "minutesToNextDefer": None,
                }

    local_now = now_utc.astimezone(CHICAGO)
    freeze_start_local = datetime(
        local_now.year,
        local_now.month,
        local_now.day,
        NIGHTLY_FREEZE_START_CHICAGO[0],
        NIGHTLY_FREEZE_START_CHICAGO[1],
        tzinfo=CHICAGO,
    )
    freeze_start_utc = freeze_start_local.astimezone(timezone.utc)
    if int(freeze_start_utc.timestamp()) <= now_epoch:
        next_day = local_now.date() + timedelta(days=1)
        freeze_start_utc = datetime(
            next_day.year,
            next_day.month,
            next_day.day,
            NIGHTLY_FREEZE_START_CHICAGO[0],
            NIGHTLY_FREEZE_START_CHICAGO[1],
            tzinfo=CHICAGO,
        ).astimezone(timezone.utc)

    best_epoch = int(freeze_start_utc.timestamp())
    best_kind = GATE_NIGHTLY_FREEZE
    best_utc = freeze_start_utc

    if frequency == "three-hourly":
        for cycle_epoch, local in _iter_scheduled_cycles(now_epoch, slots, max_hours=52):
            if local.hour == 4:
                continue
            defer_epoch = cycle_epoch - O3_PRE_CUTOFF_DEFER_SECONDS
            if defer_epoch > now_epoch:
                if defer_epoch < best_epoch:
                    best_epoch = defer_epoch
                    best_kind = GATE_O3_DEFERRAL
                    best_utc = datetime.fromtimestamp(defer_epoch, timezone.utc)
                break

    return {
        "status": GATE_OPEN,
        "reason": "ordinary merged migrations dispatch normally (outside nightly freeze and O3 deferral; :50-:03 UTC DDL guard applies)",
        "cycleId": None,
        "clearAtEpoch": None,
        "clearAtUtc": None,
        "clearAtChicago": None,
        "clearAtChicagoLabel": None,
        "minutesToClear": None,
        "nextDeferKind": best_kind,
        "nextDeferStartEpoch": best_epoch,
        "nextDeferStartUtc": format_utc(best_utc),
        "nextDeferStartChicago": format_chicago_iso(best_utc),
        "nextDeferStartChicagoLabel": format_chicago(best_utc),
        "minutesToNextDefer": round((best_epoch - now_epoch) / 60.0, 1),
    }


def compute_cycle_schedule(now_utc, frequency, start_hours=None):
    """Return next scheduled cycle, next open cycle (cutoff > now), and migration gate."""
    return {
        "nextCycle": compute_next_cycle(now_utc, frequency, start_hours=start_hours),
        "nextOpenCycle": compute_next_open_cycle(now_utc, frequency, start_hours=start_hours),
        "migrationGate": compute_migration_gate(now_utc, frequency, start_hours=start_hours),
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


def gh_api_get_text(path, timeout=60):
    """Read-only GitHub REST GET returning raw text (job logs)."""
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
    return proc.stdout


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


def list_recent_workflow_runs(repo, workflow, gh_get=gh_api_get):
    """Return recent summarized runs on branch main for a workflow."""
    data = gh_get(f"repos/{repo}/actions/workflows/{workflow}/runs?branch=main&per_page=15")
    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        raise ReadError(f"unexpected workflow_runs response for {workflow}")
    return [
        _summarize_workflow_run(r)
        for r in data["workflow_runs"]
        if isinstance(r, dict)
    ]


def list_active_workflow_runs(repo, workflow, gh_get=gh_api_get):
    """Return active (non-completed) runs on branch main for a workflow."""
    return [
        r
        for r in list_recent_workflow_runs(repo, workflow, gh_get=gh_get)
        if r.get("status") != "completed"
    ]


def find_closed_cycle_stage_run(recent_stage_runs, schedule, now_utc, active_stage_runs=()):
    """Find the latest completed stage-engine-release.yml run for an already-closed cycle.

    Reuses the already-fetched recent Stage runs list (zero extra API calls).
    Returns None when the cutoff has not passed, when a Stage run is currently
    active, or when no completed run was updated within [cutoff - 5m, now].
    """
    if not schedule or not schedule.get("cutoffPassed") or active_stage_runs:
        return None
    window_start = schedule["preparationCutoffEpoch"] - CLOSED_STAGE_LOOKBACK_SECONDS
    window_end = int(now_utc.astimezone(timezone.utc).timestamp())
    matches = []
    for run in recent_stage_runs or ():
        if not isinstance(run, dict) or run.get("status") != "completed":
            continue
        ts_raw = run.get("updatedAt") or run.get("createdAt")
        if not ts_raw:
            continue
        try:
            updated_epoch = int(parse_iso_utc(ts_raw).timestamp())
        except ReadError:
            continue
        if window_start <= updated_epoch <= window_end:
            matches.append((updated_epoch, run.get("id") or 0, run))
    if not matches:
        return None
    _, _, latest = max(matches, key=lambda item: (item[0], item[1]))
    return {
        "id": latest.get("id"),
        "status": latest.get("status"),
        "conclusion": latest.get("conclusion"),
        "displayTitle": latest.get("displayTitle") or "",
        "event": latest.get("event") or "",
        "headSha": latest.get("headSha") or "",
        "createdAt": latest.get("createdAt"),
        "updatedAt": latest.get("updatedAt"),
        "htmlUrl": latest.get("htmlUrl") or "",
    }


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


def mark_abandoned_backup_pending(backup_info, sha, recent_backup_runs):
    """Flag a pending certificate whose owning Backup run already completed (O14).

    A Backup run that yields mid-soak (O1 YIELDED_OBSOLETE), stands down or is
    cancelled writes no verdict, so its pending status never advances on its
    own. Only a run visible in the same single recent-runs read is judged, and
    an active Backup run on the same SHA keeps the candidate in flight. An
    owning run that is not visible stays plain pending (CLAUDE.md 10.86).
    """
    if backup_info.get("state") != "pending" or not backup_info.get("runId"):
        return backup_info
    if any(
        r.get("headSha") == sha and r.get("status") != "completed" for r in recent_backup_runs
    ):
        return backup_info
    owner = next((r for r in recent_backup_runs if r.get("id") == backup_info["runId"]), None)
    if owner is None or owner.get("status") != "completed":
        return backup_info
    return {
        **backup_info,
        "abandonedByRun": {"id": owner["id"], "conclusion": owner.get("conclusion")},
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
        active_b_run = next((r["id"] for r in active_backup_runs if _run_heads_candidate(r, sha)), None)
        b_run_id = backup_info.get("runId") or active_b_run
        abandoned = backup_info.get("abandonedByRun")
        if abandoned:
            waiting.append(
                f"backup=pending left by completed run {abandoned['id']} "
                f"({abandoned.get('conclusion') or 'no conclusion'}, no verdict written; needs a new Backup run)"
            )
        else:
            b_label = b_state if b_state != "absent" or not active_b_run else "in_progress"
            waiting.append(f"backup={b_label}" + (f" (run {b_run_id})" if b_run_id else ""))
    if not prequal_green:
        p_run_id = prequal_info.get("runId")
        waiting.append(f"prequal={p_status}" + (f" (run {p_run_id})" if p_run_id else ""))
    return ("PENDING", "awaiting " + ", ".join(waiting))


def walk_candidates_git(
    repo_root, control_ref, serving_sha, limit, git_fn=git_read, max_search_limit=None
):
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
    search_cap = max(limit, max_search_limit or limit)
    selected_shas = all_shas[:limit]
    extra_shas = all_shas[limit:search_cap]

    subjects = {}
    for sha in selected_shas:
        subjects[sha] = git_fn(repo_root, "show", "-s", "--format=%s", sha)

    return {
        "controlRef": control_ref,
        "controlSha": control_sha,
        "servingSha": serving_sha,
        "totalCommitsSinceServing": len(all_shas),
        "limit": limit,
        "searchLimit": search_cap,
        "shas": selected_shas,
        "extraShas": extra_shas,
        "subjects": subjects,
    }


def compute_migration_hold_advisory(
    next_open_cycle, migration_gate, candidates, active_backup, recent_backup
):
    """Recommend holding ordinary migrations from a certifying/certified copy time (O19/W8a).

    O3 deferral starts at cycleStart - 150m (O21), but a Backup run certifying the
    cycle's candidate often exports production earlier. When the migration gate
    is still OPEN and either a selectable candidate or an active non-post-seal
    Backup run started before O3 deferral, ordinary migration installs would
    invalidate that copy and cost the cycle. Reuses already-fetched data with
    zero extra API calls.
    """
    inactive = {
        "active": False,
        "source": "schedule",
        "runId": None,
        "sha": None,
        "sinceUtc": None,
        "sinceChicagoLabel": None,
        "o3DeferStartUtc": next_open_cycle.get("o3DeferStartUtc") if next_open_cycle else None,
        "reason": "no early certifying or certified copy ahead of O3 deferral",
    }
    if not next_open_cycle or not migration_gate:
        return inactive
    if migration_gate.get("status") != GATE_OPEN:
        return inactive

    o3_start_epoch = next_open_cycle.get("o3DeferStartEpoch")
    o3_start_utc = next_open_cycle.get("o3DeferStartUtc")
    cutoff_epoch = next_open_cycle.get("preparationCutoffEpoch")
    cycle_id = next_open_cycle.get("cycleId") or "next cycle"
    if o3_start_epoch is None or not o3_start_utc or cutoff_epoch is None:
        return inactive

    recent_by_id = {
        r.get("id"): r for r in (recent_backup or ()) if isinstance(r, dict) and r.get("id")
    }

    selectable = next((c for c in (candidates or ()) if c.get("status") == "SELECTABLE"), None)
    if selectable is not None:
        backup = selectable.get("backup") or {}
        run_id = backup.get("runId")
        run_obj = recent_by_id.get(run_id) if run_id else None
        ts_raw = (run_obj.get("createdAt") if run_obj else None) or backup.get("updatedAt")
        if ts_raw:
            try:
                since_dt = parse_iso_utc(ts_raw)
                since_epoch = int(since_dt.timestamp())
            except ReadError:
                since_dt = None
                since_epoch = None
            if since_dt is not None and since_epoch < o3_start_epoch:
                since_utc = format_utc(since_dt)
                run_label = f"Backup run {run_id}" if run_id else "certified Backup"
                return {
                    "active": True,
                    "source": "selectable_backup",
                    "runId": run_id,
                    "sha": selectable.get("sha"),
                    "sinceUtc": since_utc,
                    "sinceChicagoLabel": format_chicago(since_dt),
                    "o3DeferStartUtc": o3_start_utc,
                    "reason": (
                        f"hold ordinary migrations now (from {run_label} at {since_utc}; "
                        f"before O3 deferral {o3_start_utc}) so the {cycle_id} copy stays valid"
                    ),
                }

    certifying = [
        r
        for r in (active_backup or ())
        if isinstance(r, dict) and r.get("event") != "repository_dispatch" and r.get("createdAt")
    ]
    if certifying:
        latest = max(certifying, key=lambda r: (r.get("createdAt") or "", r.get("id") or 0))
        try:
            since_dt = parse_iso_utc(latest["createdAt"])
            since_epoch = int(since_dt.timestamp())
        except ReadError:
            since_dt = None
            since_epoch = None
        if since_dt is not None and since_epoch < o3_start_epoch and since_epoch < cutoff_epoch:
            since_utc = format_utc(since_dt)
            run_id = latest.get("id")
            run_label = f"Backup run {run_id}" if run_id else "active Backup"
            return {
                "active": True,
                "source": "active_backup",
                "runId": run_id,
                "sha": latest.get("headSha") or None,
                "sinceUtc": since_utc,
                "sinceChicagoLabel": format_chicago(since_dt),
                "o3DeferStartUtc": o3_start_utc,
                "reason": (
                    f"hold ordinary migrations now (from {run_label} at {since_utc}; "
                    f"before O3 deferral {o3_start_utc}) so the {cycle_id} certifying copy stays valid"
                ),
            }

    return inactive


ACTIVE_RUN_STATUSES = frozenset({"queued", "in_progress", "waiting", "pending", "requested"})


def _run_heads_candidate(run, sha):
    """True when an active Backup run is certifying `sha` judged by its head.

    Only a push run's head is its own target (2026-11-26). A dispatched,
    post-seal or after-install run's head is main at its start while it
    certifies another commit: on 2026-11-26 the readiness post said IN_FLIGHT
    6f062e8f0d1d while manual run 45759269821 (head 6f062e8f0d1d) certified
    c951436a6ead. Such a run is matched by the pending status it writes on its
    real target (backup.runId), never by its head."""
    return run.get("event") == "push" and run.get("headSha") == sha


def _candidate_in_flight(candidate, active_backup):
    b_state = candidate["backup"]["state"]
    p_status = candidate["prequalification"]["status"]
    if b_state == "pending" and not candidate["backup"].get("abandonedByRun"):
        return True
    if p_status in ACTIVE_RUN_STATUSES:
        return True
    return any(_run_heads_candidate(r, candidate["sha"]) for r in active_backup)


def _active_run_targets(candidates, active_backup):
    """'run N certifies <sha>' for each active Backup run whose pending status
    names a candidate, saying plainly when that candidate cannot be selected."""
    notes = []
    for run in active_backup:
        rid = run.get("id")
        target = next((c for c in candidates if rid and c["backup"].get("runId") == rid), None)
        if target is None:
            continue
        if target["status"] == "DISQUALIFIED":
            notes.append(f"run {rid} certifies {target['sha'][:12]}, which cannot be selected ({target['reason']})")
        else:
            notes.append(f"run {rid} certifies {target['sha'][:12]}")
    return notes


def committed_files_in_log(text):
    """Migration files the applier COMMITTED in one job log, in order."""
    committed = []
    current = None
    for raw in (text or "").splitlines():
        line = LOG_TIMESTAMP_RE.sub("", raw.strip())
        m = APPLY_FILE_LINE_RE.match(line)
        if m:
            current = m.group(1)
            continue
        if line == APPLY_COMMITTED_LINE and current:
            committed.append(current)
            current = None
    return committed


def _jobs_of(repo, run_id, gh_get):
    data = gh_get(f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100")
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        raise ReadError(f"unexpected jobs response for run {run_id}")
    return data["jobs"]


def _runs_since(repo, workflow, since_utc, gh_get):
    since = format_utc(since_utc - timedelta(hours=1))
    data = gh_get(
        f"repos/{repo}/actions/workflows/{workflow}/runs?branch=main&per_page=100&created=%3E%3D{since}"
    )
    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        raise ReadError(f"unexpected workflow_runs response for {workflow}")
    if int(data.get("total_count") or 0) > len(data["workflow_runs"]):
        raise ReadError(f"more {workflow} runs since {since} than one page holds")
    return data["workflow_runs"]


def production_installs_after(repo, since_utc, gh_get, gh_text):
    """Migration files production COMMITTED after since_utc, read from the applier's own job logs
    (Apply Merged Migration runs and the daily-maintenance window installer). Raises ReadError when
    any log cannot be read: an unread install is not an absent one (CLAUDE.md 10.86)."""
    installed = []
    for run in _runs_since(repo, APPLY_WORKFLOW, since_utc, gh_get):
        if run.get("status") != "completed":
            continue
        for job in _jobs_of(repo, run["id"], gh_get):
            done = job.get("completed_at")
            if not done or parse_iso_utc(done) < since_utc:
                continue
            for f in committed_files_in_log(gh_text(f"repos/{repo}/actions/jobs/{job['id']}/logs")):
                installed.append({"file": f, "at": done, "runId": run["id"]})
    for run in _runs_since(repo, STAGE_WORKFLOW, since_utc, gh_get):
        if run.get("status") != "completed":
            continue
        for job in _jobs_of(repo, run["id"], gh_get):
            done = job.get("completed_at")
            if job.get("name") != WINDOW_INSTALL_JOB or job.get("conclusion") in ("skipped", None):
                continue
            if not done or parse_iso_utc(done) < since_utc:
                continue
            for f in committed_files_in_log(gh_text(f"repos/{repo}/actions/jobs/{job['id']}/logs")):
                installed.append({"file": f, "at": done, "runId": run["id"]})
    return installed


def gh_api_get_bytes(path, timeout=60):
    """Read-only GitHub REST GET returning raw bytes (artifact archives)."""
    try:
        proc = subprocess.run(["gh", "api", "--method", "GET", path], capture_output=True, timeout=timeout)
    except (subprocess.SubprocessError, OSError) as exc:
        raise ReadError(f"gh api GET {path} failed: {exc}") from exc
    if proc.returncode != 0:
        detail = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        raise ReadError(f"gh api GET {path} failed: {detail[-1] if detail else proc.returncode}")
    return proc.stdout


def certificate_copy_time(repo, sha, backup_info, gh_get, gh_bytes):
    """When the certified copy was restored: database.restoredAt in the run's own certificate.
    A run that reuses a copy certifies data restored earlier than the run itself."""
    run_id = backup_info.get("runId")
    if not run_id:
        raise ReadError("certificate names no Backup run")
    data = gh_get(f"repos/{repo}/actions/runs/{run_id}/artifacts?per_page=100")
    if not isinstance(data, dict) or not isinstance(data.get("artifacts"), list):
        raise ReadError(f"unexpected artifacts response for run {run_id}")
    names = [
        a
        for a in data["artifacts"]
        if str(a.get("name", "")).startswith(f"backup-certificate-{sha}-") and not a.get("expired")
    ]
    if not names:
        raise ReadError(f"Backup run {run_id} kept no certificate for {sha[:12]}")
    archive = gh_bytes(f"repos/{repo}/actions/artifacts/{names[-1]['id']}/zip")
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            cert = json.loads(zf.read("certificate.json"))
        return parse_iso_utc(cert["database"]["restoredAt"])
    except (zipfile.BadZipFile, KeyError, TypeError, ValueError) as exc:
        raise ReadError(f"certificate of run {run_id} names no copy restore time: {exc}") from exc


def load_engine_inert(repo_root):
    """engine_inert() from the installed-migrations helper (O33), or None when unreadable."""
    path = Path(repo_root) / INSTALLED_MIGRATIONS_HELPER_PATH
    try:
        spec = importlib.util.spec_from_file_location("_ca_installed_migrations", path)
        module = importlib.util.module_from_spec(spec)
        with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink):
            spec.loader.exec_module(module)
        return module.engine_inert
    except Exception:  # noqa: BLE001 - unreadable helper means no carve-out
        return None


def judge_copy_freshness(
    candidate, repo, repo_root, control_sha, gh_get, gh_text, git_fn, engine_inert, gh_bytes=None
):
    """O36: a certificate is selectable only while its copy holds every non-inert migration
    production committed. Returns ("fresh"|"stale"|"unread", detail)."""
    try:
        copy_at = certificate_copy_time(
            repo, candidate["sha"], candidate["backup"], gh_get, gh_bytes or gh_api_get_bytes
        )
        installs = production_installs_after(repo, copy_at, gh_get, gh_text)
    except ReadError as exc:
        return ("unread", str(exc))
    missing = []
    for item in installs:
        inert = False
        if engine_inert is not None:
            try:
                text = git_fn(repo_root, "show", f"{control_sha}:supabase/migrations/{item['file']}")
                inert = bool(engine_inert(text + "\n"))
            except ReadError:
                inert = False
        if not inert:
            missing.append(item)
    if not missing:
        return ("fresh", f"copy current as of {format_chicago(copy_at)}")
    versions = sorted({m["file"][:14] for m in missing})
    return (
        "stale",
        f"Backup copy read {format_chicago(copy_at)} lacks migration(s) production installed after it: "
        f"{', '.join(versions)}; needs a fresh-copy Backup run",
    )


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
    if selectable is not None and selectable.get("copyFreshness") == "unread":
        return (
            VERDICT_UNKNOWN,
            None,
            f"{selectable['sha'][:12]} is certified, but whether its Backup copy is current could not be read: "
            f"{selectable.get('copyFreshnessDetail', '')}",
        )
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
    targets = _active_run_targets(candidates, active_backup)
    if in_flight:
        newest = in_flight[0]
        active_ids = ", ".join(str(r["id"]) for r in active_backup if r.get("id"))
        backup_note = f"; active backup run(s): {active_ids}" if active_ids else ""
        if targets:
            backup_note += "; " + "; ".join(targets)
        return (
            VERDICT_IN_FLIGHT,
            None,
            f"no selectable candidate yet; {newest['sha'][:12]} is in flight ({newest['reason']}){backup_note}",
        )

    if active_backup:
        active_ids = ", ".join(str(r["id"]) for r in active_backup if r.get("id"))
        target_note = ("; " + "; ".join(targets)) if targets else ""
        return (
            VERDICT_IN_FLIGHT,
            None,
            f"no selectable candidate yet; active backup-engine.yml run(s): {active_ids}{target_note}",
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
    limit=None,
    health_url=DEFAULT_HEALTH_URL,
    control_ref=DEFAULT_CONTROL_REF,
    repo_root=None,
    repo_dir=None,
    now_utc=None,
    health_fn=None,
    gh_get_fn=None,
    git_fn=None,
    projection_fn=None,
    gh_text_fn=None,
    engine_inert_fn=None,
    gh_bytes_fn=None,
):
    """Collect live readiness state across health, schedule, GitHub workflows and git."""
    explicit_limit = limit is not None
    effective_limit = DEFAULT_LIMIT if limit is None else limit
    if not isinstance(effective_limit, int) or isinstance(effective_limit, bool) or effective_limit <= 0:
        raise ValueError("--limit must be a positive integer")
    search_limit = effective_limit if explicit_limit else max(effective_limit, SELECTABLE_SEARCH_LIMIT)

    checked_at = (now_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
    health_reader = health_fn or (lambda: fetch_health(health_url))
    gh_reader = gh_get_fn or gh_api_get
    gh_text_reader = gh_text_fn or gh_api_get_text
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
        "nextOpenCycle": None,
        "migrationGate": None,
        "migrationHoldAdvisory": None,
        "closedCycleStageRun": None,
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

    try:
        health = health_reader()
        report["health"] = health
        cycle_bundle = compute_cycle_schedule(checked_at, health["frequency"], health["startHours"])
        schedule = cycle_bundle["nextCycle"]
        report["schedule"] = schedule
        report["nextOpenCycle"] = cycle_bundle["nextOpenCycle"]
        report["migrationGate"] = cycle_bundle["migrationGate"]
    except ReadError as exc:
        report["errors"].append(str(exc))
        report["summary"] = str(exc)
        return report

    try:
        recent_stage = list_recent_workflow_runs(repo, STAGE_WORKFLOW, gh_get=gh_reader)
        active_stage = [r for r in recent_stage if r.get("status") != "completed"]
        recent_backup = list_recent_workflow_runs(repo, BACKUP_WORKFLOW, gh_get=gh_reader)
        active_backup = [r for r in recent_backup if r.get("status") != "completed"]
        report["activeRuns"] = {"stage": active_stage, "backup": active_backup}
        report["closedCycleStageRun"] = find_closed_cycle_stage_run(
            recent_stage, schedule, checked_at, active_stage_runs=active_stage
        )

        remote_main_sha = fetch_remote_main_sha(repo, gh_get=gh_reader)
        git_walk = walk_candidates_git(
            resolved_root,
            control_ref,
            health["releaseSha"],
            effective_limit,
            git_fn=git_reader,
            max_search_limit=search_limit,
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
            "limit": effective_limit,
            "searchLimit": git_walk["searchLimit"],
            "extendedSearchUsed": False,
            "extendedSearchInspected": len(git_walk["shas"]),
        }

        proj_reader = projection_fn or (
            lambda sha: control_projection(sha, repo_root=resolved_root, control_sha=control_sha)
        )
        control_proj = proj_reader(control_sha)
        prequal_index = fetch_prequal_index(repo, gh_get=gh_reader)

        def _inspect_candidate(sha, subject=None):
            backup_info = mark_abandoned_backup_pending(
                fetch_backup_status(repo, sha, gh_get=gh_reader), sha, recent_backup
            )
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
            return {
                "sha": sha,
                "shortSha": sha[:12],
                "subject": subject if subject is not None else git_walk["subjects"].get(sha, ""),
                "backup": backup_info,
                "prequalification": prequal_info,
                "controlInputsMatch": ctrl_match,
                "changedControlPaths": changed_paths,
                "status": status,
                "reason": reason,
            }

        inert_fn = engine_inert_fn if engine_inert_fn is not None else load_engine_inert(resolved_root)

        def _judge_freshness(cand):
            """O36: a SELECTABLE certificate whose copy production has moved past is not selectable."""
            if cand["status"] != "SELECTABLE":
                return cand
            verdict, detail = judge_copy_freshness(
                cand, repo, resolved_root, control_sha, gh_reader, gh_text_reader, git_reader, inert_fn,
                gh_bytes_fn,
            )
            cand["copyFreshness"] = verdict
            cand["copyFreshnessDetail"] = detail
            if verdict == "stale":
                cand["status"] = "DISQUALIFIED"
                cand["reason"] = detail
            return cand

        candidates = []
        found_selectable = False
        for sha in git_walk["shas"]:
            cand = _inspect_candidate(sha)
            if not found_selectable:
                cand = _judge_freshness(cand)
                found_selectable = cand["status"] == "SELECTABLE"
            candidates.append(cand)

        # O19 (D1): when the default 10-commit window contains no SELECTABLE
        # candidate, continue walking up to SELECTABLE_SEARCH_LIMIT (60) until
        # the first SELECTABLE commit is found so busy nights never hide an
        # older certified candidate. Check CONTROL_INPUTS locally first so
        # disqualified commits cost zero extra GitHub API calls.
        if not any(c["status"] == "SELECTABLE" for c in candidates) and git_walk["extraShas"]:
            report["git"]["extendedSearchUsed"] = True
            inspected = len(git_walk["shas"])
            for extra_sha in git_walk["extraShas"]:
                inspected += 1
                if proj_reader(extra_sha) != control_proj:
                    continue
                extra_cand = _judge_freshness(_inspect_candidate(extra_sha, subject=""))
                if extra_cand["status"] == "SELECTABLE":
                    extra_cand["subject"] = git_reader(
                        resolved_root, "show", "-s", "--format=%s", extra_sha
                    )
                    candidates.append(extra_cand)
                    break
            report["git"]["extendedSearchInspected"] = inspected

        report["candidates"] = candidates
        report["migrationHoldAdvisory"] = compute_migration_hold_advisory(
            report["nextOpenCycle"],
            report["migrationGate"],
            candidates,
            active_backup,
            recent_backup,
        )

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
    if run_id and backup.get("abandonedByRun"):
        return f"{state} (#{run_id} ended)"
    if run_id:
        return f"{state} (#{run_id})"
    return state


def _format_o3_defer_note(cycle):
    kind = cycle.get("o3DeferKind")
    clear_label = cycle.get("o3ClearChicagoLabel")
    minutes = cycle.get("minutesToO3Defer")
    in_window = bool(cycle.get("inO3DeferWindow"))
    if kind == "nightly-freeze":
        if in_window:
            return f"ACTIVE - nightly freeze until {clear_label}"
        return f"starts {_format_minutes(minutes)}; nightly freeze until {clear_label}"
    if in_window:
        return f"ACTIVE - clears {clear_label}"
    return f"starts {_format_minutes(minutes)}; clears {clear_label}"


def _format_run_state(run):
    """Status plus triggering event (push, schedule, repository_dispatch,
    workflow_dispatch) so a late schedule or post-seal run is told apart
    from a push run at a glance (O14)."""
    event = run.get("event") or ""
    return f"{run.get('status')}, {event}" if event else f"{run.get('status')}"


def _format_closed_stage_run(run):
    conclusion = run.get("conclusion") or "unknown"
    sha = (run.get("headSha") or "")[:12]
    updated = run.get("updatedAt") or ""
    return f"run {run.get('id')} [completed/{conclusion}] {sha} at {updated}"


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
    closed_stage = report.get("closedCycleStageRun")
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
            ]
        )
        if schedule.get("o3DeferStartUtc"):
            lines.append(
                f"  o3DeferStart:  {schedule['o3DeferStartUtc']} | {schedule['o3DeferStartChicagoLabel']} ({_format_o3_defer_note(schedule)})"
            )
        lines.append(
            f"  holdStart:     {schedule['recommendedHoldStartUtc']} | {schedule['recommendedHoldStartChicagoLabel']} ({hold_note})"
        )
        if closed_stage:
            lines.append(f"  closedStage:   {_format_closed_stage_run(closed_stage)}")

    next_open = report.get("nextOpenCycle")
    if next_open:
        lines.append("")
        if schedule and next_open.get("cycleId") == schedule.get("cycleId") and not schedule.get("cutoffPassed"):
            lines.append(f"NEXT OPEN CYCLE ({next_open['cycleId']})")
            lines.append(
                f"  same as next scheduled cycle (prepCutoff {_format_minutes(next_open['minutesToCutoff'])})"
            )
        else:
            open_hold_note = (
                "ACTIVE - hold migrations + release controls"
                if next_open["inHoldWindow"]
                else f"starts {_format_minutes(next_open['minutesToHold'])}"
            )
            lines.extend(
                [
                    f"NEXT OPEN CYCLE ({next_open['cycleId']})",
                    f"  cycleStart:    {next_open['cycleStartUtc']} | {next_open['cycleStartChicagoLabel']} ({_format_minutes(next_open['minutesToCycle'])})",
                    f"  prepCutoff:    {next_open['preparationCutoffUtc']} | {next_open['preparationCutoffChicagoLabel']} ({_format_minutes(next_open['minutesToCutoff'])})",
                ]
            )
            if next_open.get("o3DeferStartUtc"):
                lines.append(
                    f"  o3DeferStart:  {next_open['o3DeferStartUtc']} | {next_open['o3DeferStartChicagoLabel']} ({_format_o3_defer_note(next_open)})"
                )
            lines.append(
                f"  holdStart:     {next_open['recommendedHoldStartUtc']} | {next_open['recommendedHoldStartChicagoLabel']} ({open_hold_note})"
            )

    gate = report.get("migrationGate")
    if gate:
        lines.extend(
            [
                "",
                "MIGRATION GATE",
                f"  status:        {gate['status']}",
                f"  reason:        {gate['reason']}",
            ]
        )
        if gate.get("clearAtUtc"):
            lines.append(
                f"  clearsAt:      {gate['clearAtUtc']} | {gate['clearAtChicagoLabel']} ({_format_minutes(gate['minutesToClear'])})"
            )
        elif gate.get("nextDeferStartUtc"):
            lines.append(
                f"  nextDefer:     {gate['nextDeferStartUtc']} | {gate['nextDeferStartChicagoLabel']} ({_format_minutes(gate['minutesToNextDefer'])}; {gate['nextDeferKind']})"
            )
        hold_adv = report.get("migrationHoldAdvisory")
        if hold_adv and hold_adv.get("active"):
            lines.append(f"  copyHold:      ACTIVE NOW - {hold_adv['reason']}")

    active = report.get("activeRuns") or {}
    stage_runs = active.get("stage") or []
    backup_runs = active.get("backup") or []
    lines.append("")
    lines.append("ACTIVE WORKFLOWS")
    if stage_runs:
        parts = [
            f"run {r['id']} [{_format_run_state(r)}] {(r.get('headSha') or '')[:12]} \"{r.get('displayTitle', '')}\""
            for r in stage_runs
        ]
        lines.append(f"  {STAGE_WORKFLOW}: {len(stage_runs)} active -> " + "; ".join(parts))
    elif closed_stage:
        lines.append(
            f"  {STAGE_WORKFLOW}: none active (closed cycle {_format_closed_stage_run(closed_stage)})"
        )
    else:
        lines.append(f"  {STAGE_WORKFLOW}: none active")

    if backup_runs:
        parts = [
            f"run {r['id']} [{_format_run_state(r)}] {(r.get('headSha') or '')[:12]}"
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
        search_note = ""
        if git_info.get("extendedSearchUsed"):
            inspected = git_info.get("extendedSearchInspected", shown)
            search_note = f"; searched {inspected}"
        lines.append(
            f"CANDIDATES ON {git_info['controlRef']} SINCE {git_info['servingSha'][:12]} "
            f"(showing {shown} of {total}{search_note}; control={git_info['controlSha'][:12]})"
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
        default=None,
        help=(
            f"Maximum first-parent commits since serving SHA to inspect "
            f"(default: {DEFAULT_LIMIT}, extending up to {SELECTABLE_SEARCH_LIMIT} to find a selectable candidate)"
        ),
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
    if args.limit is not None and args.limit <= 0:
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
            "nextOpenCycle": None,
            "migrationGate": None,
            "migrationHoldAdvisory": None,
            "closedCycleStageRun": None,
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
