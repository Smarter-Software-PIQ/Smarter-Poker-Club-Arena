#!/usr/bin/env python3
"""Read the latest protected exact-candidate daytime qualification."""
import argparse
import hashlib
import io
import json
import re
import subprocess
import sys
import zipfile
import tempfile
from pathlib import Path
from zoneinfo import ZoneInfo
from datetime import datetime, timezone

WORKFLOW = "engine-release-prequalification.yml"
PATH = ".github/workflows/" + WORKFLOW
SHA = r"[0-9a-f]{40}"
IMAGE = r"sha256:[0-9a-f]{64}"
CONTROL_INPUTS = [
    ".github/workflows/engine-release-prequalification.yml",
    ".github/workflows/stage-engine-release.yml",
    ".github/workflows/auto-deploy-hetzner.yml",
    ".github/workflows/backup-engine.yml",
    "scripts/ci/read-engine-prequalification.py",
    "scripts/ci/prestage-engine-image.sh",
    "scripts/ci/select-daily-engine.py",
    "scripts/ci/check-engine-doors-exist.mjs",
    "scripts/ci/window-migration-doors.mjs",
    "scripts/ci/recorded-migrations.manifest.json",
    "scripts/ci/record-engine-deploy-attempt.mjs",
    "scripts/ci/record-engine-deploy-exit.mjs",
    "server/scripts",
    "server/src/maintenance",
]
CONTROL_INPUT_TEST_EXCLUDED_DIRS = (
    "server/scripts/",
    "server/src/maintenance/",
)
PURE_TEST_FILE_SUFFIXES = (
    ".law.test.ts",
    ".test.ts",
    ".spec.ts",
    ".test.py",
    ".test.mjs",
    ".test.js",
    ".test.cjs",
)
NON_RELEASE_SERVER_SCRIPT_PREFIXES = (
    "server/scripts/opponent-hud-",
    "server/scripts/horse-",
    "server/scripts/holdem-",
    "server/scripts/audited-",
    "server/scripts/hvh48-",
    "server/scripts/benchmark-",
    "server/scripts/gen-",
    "server/scripts/generate-",
    "server/scripts/measure-",
    "server/scripts/nash-push-fold/",
    "server/scripts/fixtures/",
    # O31 (2026-11-26): Horse strategy research and qualification families. A
    # Horse-only edit to oop-reraise-range/league.ts (#12085) made a certified
    # build unselectable. Each family below is reached by no release workflow,
    # server/Dockerfile, server/standby, release CI helper or release script
    # (tests/the-release-projection-names-only-release-files.law.test.ts).
    # The two directories are excluded whole so a new file beside them does
    # not repeat the incident; legacy-census-*, finite-evaluation-worker*,
    # phase*, qualify-* and every engine-*/install-* script stay hashed.
    "server/scripts/oop-reraise-range/",
    "server/scripts/omaha-reraised-pot-priced/",
    "server/scripts/feature-ablation-",
    "server/scripts/gto-v31-",
    "server/scripts/assemble-public215-",
)
NON_RELEASE_SERVER_SCRIPT_EXACT = (
    "server/scripts/style-shadow-rerun.mjs",
    "server/scripts/river-one-pair-fixture.ts",
    "server/scripts/prepare-public215-feature-request.py",
)


class Unqualified(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Unqualified(reason)


def git(*args):
    return subprocess.check_output(["git", "--no-replace-objects", *args], text=True, timeout=30).strip()


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True, timeout=30))


def protected(sha):
    require(re.fullmatch(SHA, sha), "invalid commit identity")
    git("merge-base", "--is-ancestor", sha, "refs/remotes/origin/main")


def _is_pure_test_control_path(path):
    """True only for pure unit/law test files inside directory CONTROL_INPUTS.

    Explicit CONTROL_INPUTS files (workflows, recorded-migrations.manifest.json,
    etc.) and all production/release scripts remain hashed.
    """
    if not path.startswith(CONTROL_INPUT_TEST_EXCLUDED_DIRS):
        return False
    name = path.rsplit("/", 1)[-1]
    if any(name.endswith(suffix) and len(name) > len(suffix) for suffix in PURE_TEST_FILE_SUFFIXES):
        return True
    if name.startswith("test_") and name.endswith(".py") and len(name) > len("test_.py"):
        return True
    return False


def _is_non_release_server_script_path(path):
    """True only for verified offline research/HUD/horse/probe/benchmark/generator
    scripts under server/scripts/ that are unreferenced by any release surface.

    Any new or unknown script under server/scripts/ fails closed (remains hashed).
    """
    if not path.startswith("server/scripts/"):
        return False
    if path in NON_RELEASE_SERVER_SCRIPT_EXACT:
        return True
    return any(
        path.startswith(prefix) and len(path) > len(prefix)
        for prefix in NON_RELEASE_SERVER_SCRIPT_PREFIXES
    )


def _filter_projection_tree(tree_output):
    """Drop pure unit/law tests and verified non-release server scripts by exact path field."""
    if not tree_output:
        return ""
    kept = []
    for line in tree_output.splitlines():
        _, sep, path = line.partition("\t")
        if sep and (_is_pure_test_control_path(path) or _is_non_release_server_script_path(path)):
            continue
        kept.append(line)
    return "\n".join(kept)


def projection(sha, *, release_authority=False):
    paths = list(CONTROL_INPUTS)
    if release_authority:
        # Once Stage freezes a control commit, even changes to expired orders
        # must wait for a new selection. The candidate's older expired orders
        # are assessed separately by the daily-compatibility policy.
        paths.extend(("server/release/activation-floor.json", "server/release/owner-maintenance-windows.json"))
    return _filter_projection_tree(git("ls-tree", "-r", sha, "--", *paths))


def backup_projection(sha):
    """Inputs whose change requires a new physical Backup certificate.

    Migration history is included even after a revert: the selector compares
    the latest migration commit time with the actual database restore time.
    Runtime freshness and serving-predecessor checks remain in the selector.
    """
    require(re.fullmatch(SHA, sha), "invalid Backup input identity")
    return "\n".join((projection(sha, release_authority=True),
                      git("ls-tree", "-r", sha, "--", "server/standby", "supabase/migrations"),
                      git("log", "-1", "--format=%H", sha, "--", "supabase/migrations")))


def owner_selection_policy(target, control, owner_id, cutoff):
    """Reuse the exact protected finite admission validator, never a caller's order."""
    protected(target)
    protected(control)
    git("merge-base", "--is-ancestor", target, control)
    require(projection(target, release_authority=True) == projection(control, release_authority=True),
            "owner candidate release controls differ")
    raw = git("show", control + ":server/release/activation-floor.json")
    floor = json.loads(raw)
    require(floor.get("ownerWindowId") == owner_id and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", owner_id),
            "owner selection identity differs")
    start = int(datetime.fromisoformat(floor["activationAt"].replace("Z", "+00:00")).timestamp())
    end = int(datetime.fromisoformat(floor["expiresAt"].replace("Z", "+00:00")).timestamp())
    require(start <= cutoff < end and cutoff <= datetime.now(timezone.utc).timestamp(),
            "owner selection cutoff outside original window")
    # The helper verifies pinned manifest/order digests, protected ancestry,
    # exact helper bytes, control/target authority and current admission time.
    with tempfile.TemporaryDirectory(prefix="owner-selection-") as folder:
        helper = Path(folder) / "engine-release-activation-floor.py"
        helper.write_bytes(subprocess.check_output(["git", "--no-replace-objects", "show",
                            control + ":server/scripts/engine-release-activation-floor.py"], timeout=30))
        subprocess.check_output([sys.executable, "-B", str(helper), "nov7-owner", "--repo", ".",
                                 "--target", target, "--control", control, "--deadline", str(end)], timeout=30)
    return floor


THREE_HOURLY_START_HOURS = (1, 4, 7, 10, 13, 16, 19, 22)


def cycle_identity(cutoff):
    """The selection identity of the cycle 30 minutes after `cutoff`: its Chicago
    date for the 04:00 anchor, `YYYY-MM-DDTHH` for another three-hourly cycle
    (owner order 2026-11-21). The repeated fall-back hour is one cycle, the first."""
    zone = ZoneInfo("America/Chicago")
    start = cutoff + 1800
    chicago = datetime.fromtimestamp(start, zone)
    require(type(cutoff) is int and start % 3600 == 0 and chicago.minute == 0 and chicago.second == 0
            and chicago.hour in THREE_HOURLY_START_HOURS
            and datetime.fromtimestamp(start - 3600, zone).hour != chicago.hour, "invalid selection cutoff")
    return chicago.date().isoformat() if chicago.hour == 4 else chicago.strftime("%Y-%m-%dT%H")


def selection_cutoff(repo, rid):
    require(re.fullmatch(r"[1-9][0-9]{0,19}", rid or ""), "invalid selection run id")
    run = api(f"repos/{repo}/actions/runs/{rid}")
    moment = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
    require(moment.utcoffset() is not None, "selection creation time lacks offset")
    return int(moment.timestamp())


def verify_selection(repo, rid, cutoff, qualification, owner_window=None):
    """Bind repository_dispatch to the already uploaded, first-attempt selection."""
    require(re.fullmatch(r"[1-9][0-9]{0,19}", rid), "invalid selection run id")
    run = api(f"repos/{repo}/actions/runs/{rid}")
    operator = (run["event"] == "repository_dispatch" and run.get("actor", {}).get("type") == "User"
                and run.get("display_title") == "Original operator daily preparation")
    if operator:
        created = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
        require(created.utcoffset() is not None and cutoff <= created.timestamp() < cutoff + 20 * 60,
                "operator Stage was created outside the preparation window")
    require(run["id"] == int(rid) and run["run_attempt"] == 1
            and (run["event"] == "workflow_dispatch" if owner_window else (run["event"] in ("push", "schedule") or operator or (run["event"] == "workflow_run" and run.get("display_title") == "Automatic Backup daily reservation")))
            and run["head_branch"] == "main"
            and run["path"] == ".github/workflows/stage-engine-release.yml"
            and run["repository"]["full_name"].lower() == repo.lower()
            and run["head_repository"]["full_name"].lower() == repo.lower()
            and (run["status"] == "in_progress" or run["conclusion"] == "success"),
            "selection is not a protected original stage run")
    stage = run["head_sha"]
    protected(stage)
    control = qualification["controlSha"]
    protected(control)
    if not owner_window:
        require(git("rev-list", "--first-parent", "-1", "--before=@" + str(cutoff), "refs/remotes/origin/main") == control,
                "selection is not the newest protected cutoff control")
        require(projection(stage, release_authority=True) == projection(control, release_authority=True), "stage release controls changed after cutoff")
        created = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
        require(created.utcoffset() is not None, "reservation time has no offset")
        early = run.get("display_title") in ("Daily engine reservation", "Automatic Backup daily reservation")
        require(cutoff - (18000 if early else 0) <= created.timestamp() < cutoff + 1200,
                "stage run does not own this reservation date")
    jobs = api(f"repos/{repo}/actions/runs/{rid}/attempts/1/jobs?per_page=100")
    require(jobs["total_count"] == len(jobs["jobs"]), "selection jobs incomplete")
    selected = [job for job in jobs["jobs"] if job["name"] == "Record the daily release evidence"]
    require(len(selected) == 1 and selected[0]["run_id"] == int(rid)
            and selected[0]["head_sha"] == stage and selected[0]["run_attempt"] == 1
            and selected[0]["status"] == "completed" and selected[0]["conclusion"] == "success",
            "selection job has not succeeded")
    if owner_window:
        require(stage == qualification["controlSha"], "owner Stage identity differs")
        require(int(datetime.fromisoformat(run["created_at"].replace("Z", "+00:00")).timestamp()) == cutoff,
                "owner cutoff differs from original Stage creation")
        owner_selection_policy(qualification["targetSha"], stage, owner_window, cutoff)
        name = "owner-engine-selection-" + owner_window
    else:
        started = datetime.fromisoformat(selected[0]["started_at"].replace("Z", "+00:00"))
        completed = datetime.fromisoformat(selected[0]["completed_at"].replace("Z", "+00:00"))
        require(started.utcoffset() is not None and completed.utcoffset() is not None
                and cutoff <= started.timestamp() <= completed.timestamp() < cutoff + 1200,
                "selection did not execute inside its reserved preparation window")
        name = "daily-engine-selection-" + cycle_identity(cutoff)
    listing = api(f"repos/{repo}/actions/runs/{rid}/artifacts?name={name}&per_page=2")
    require(listing["total_count"] == len(listing["artifacts"]) == 1, "unique selection artifact absent")
    artifact = listing["artifacts"][0]
    require(artifact["name"] == name and not artifact["expired"]
            and type(artifact["id"]) is int and artifact["id"] > 0
            and 0 < artifact["size_in_bytes"] <= 1024 * 1024
            and re.fullmatch(IMAGE, artifact["digest"]), "invalid selection artifact provenance")
    archive = subprocess.check_output(["gh", "api", f"repos/{repo}/actions/artifacts/{artifact['id']}/zip"], timeout=30)
    require(len(archive) <= 1024 * 1024 and "sha256:" + hashlib.sha256(archive).hexdigest() == artifact["digest"],
            "selection archive digest mismatch")
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        entries = bundle.infolist()
        require(len(entries) == 1 and entries[0].filename == "daily-selection.json"
                and entries[0].file_size <= 1024 * 1024, "invalid selection archive contents")
        receipt = json.loads(bundle.read(entries[0]))
    require(receipt.get("ownerWindowId") == owner_window, "selection owner differs")
    require(receipt["schema"] == 1 and receipt["outcome"] == "selected"
            and receipt["targetSha"] == qualification["targetSha"]
            and receipt["stageSha"] == stage and receipt["controlSha"] == qualification["controlSha"]
            and receipt["cutoffEpoch"] == cutoff and receipt["qualification"] == qualification,
            "stage selection and immutable qualification differ")
    serving = receipt.get("servingSha")
    if serving is not None:
        protected(serving)
    return serving


def read(args):
    repo, target, control = args.repo, args.target, args.control
    require(repo.lower() == "smarter-software-piq/smarter-poker-club-arena", "unexpected repository")
    protected(target)
    protected(control)
    runtime = args.receiver_control or control
    protected(runtime)
    require(projection(control, release_authority=True) == projection(runtime, release_authority=True), "release control inputs changed after selection")
    # Candidate and producer run use the same immutable server and repository fixtures.
    require(projection(target) == projection(control), "qualification inputs differ from selected control")
    runs = api(f"repos/{repo}/actions/workflows/{WORKFLOW}/runs?branch=main&head_sha={target}&per_page=1")
    rows = runs["workflow_runs"]
    require(rows, "no exact qualification")
    run = rows[0]
    raw_rid = run.get("id")
    run_state_note = ""
    if type(raw_rid) is int and raw_rid > 0:
        parts = [f"run {raw_rid}"]
        if isinstance(run.get("status"), str) and run["status"]:
            parts.append(f"status={run['status']}")
        if isinstance(run.get("conclusion"), str) and run["conclusion"]:
            parts.append(f"conclusion={run['conclusion']}")
        run_state_note = " (" + ", ".join(parts) + ")"
    require(run["event"] in ("push", "workflow_dispatch") and run["head_branch"] == "main"
            and run["path"] == PATH and run["head_sha"] == target
            and run["repository"]["full_name"].lower() == repo.lower()
            and run["head_repository"]["full_name"].lower() == repo.lower()
            and run["status"] == "completed" and run["conclusion"] == "success",
            f"latest qualification is incomplete, unsuccessful or untrusted{run_state_note}")
    rid, attempt = run["id"], run["run_attempt"]
    require(type(rid) is int and rid > 0 and type(attempt) is int and attempt > 0, "invalid run coordinates")
    jobs = api(f"repos/{repo}/actions/runs/{rid}/attempts/{attempt}/jobs?per_page=100")
    expected = (
        {f"Qualify exact engine ({n}/8)" for n in range(1, 9)}
        | {
            "Stage immutable candidate and rollback images",
            "Retire superseded prequalification runs",
        }
    )
    rows = jobs["jobs"]
    require(jobs["total_count"] == len(rows) == len(expected) and {j["name"] for j in rows} == expected,
            f"incomplete qualification jobs (run {rid})")
    for job in rows:
        require(job["run_id"] == rid and job["run_attempt"] == attempt and job["head_sha"] == target and job["conclusion"] == "success"
                and job["status"] == "completed", f"invalid qualification job (run {rid})")
    completed = max(datetime.fromisoformat(j["completed_at"].replace("Z", "+00:00")) for j in rows)
    now = datetime.now(timezone.utc)
    require(completed.timestamp() <= min(args.cutoff, now.timestamp()), f"qualification missed cutoff (run {rid})")
    stage = next(j for j in rows if j["name"] == "Stage immutable candidate and rollback images")
    markers = [s["name"] for s in stage["steps"] if s["conclusion"] == "success" and s["name"].startswith("Prepared image ")]
    require(len(markers) == 1, f"missing immutable image receipt (run {rid})")
    match = re.fullmatch(fr"Prepared image ({IMAGE}) rollback ({IMAGE}) tree ({SHA})", markers[0])
    require(match and match[3] == git("rev-parse", target + ":server"), f"invalid immutable image receipt (run {rid})")
    newest = api(f"repos/{repo}/actions/workflows/{WORKFLOW}/runs?branch=main&head_sha={target}&per_page=1")["workflow_runs"]
    require(newest and newest[0]["id"] == rid and newest[0]["run_attempt"] == attempt
            and newest[0]["status"] == "completed" and newest[0]["conclusion"] == "success",
            f"qualification superseded during verification (run {rid})")
    return dict(schema=1, targetSha=target, controlSha=control, qualificationRunId=rid,
                attempt=attempt, completedAt=completed.isoformat(), imageId=match[1],
                rollbackImageId=match[2], serverTree=match[3])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("repo", "target", "control"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--cutoff", type=int)
    parser.add_argument("--owner-window")
    parser.add_argument("--receiver-control")
    parser.add_argument("--selection-run-id")
    try:
        args = parser.parse_args()
        if args.owner_window:
            require(args.receiver_control and args.selection_run_id, "owner receiver requires original Stage run")
            require(args.cutoff is None, "owner cutoff must come from original Stage")
            args.cutoff = selection_cutoff(args.repo, args.selection_run_id)
            owner_selection_policy(args.target, args.control, args.owner_window, args.cutoff)
        require(type(args.cutoff) is int, "qualification cutoff required")
        result = read(args)
        if args.receiver_control:
            require(args.selection_run_id, "receiver requires an immutable selection run")
            selected_serving = verify_selection(args.repo, args.selection_run_id, args.cutoff, result, args.owner_window)
            if selected_serving:
                result["servingSha"] = selected_serving
        print(json.dumps(result))
    except Unqualified as error:
        print(error, file=sys.stderr)
        sys.exit(3)
    except (subprocess.SubprocessError, OSError, KeyError, TypeError, ValueError, zipfile.BadZipFile) as error:
        print(f"Qualification provenance unavailable: {error}", file=sys.stderr)
        sys.exit(2)
