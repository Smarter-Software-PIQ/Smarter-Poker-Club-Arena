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
    "scripts/ci/record-engine-deploy-attempt.mjs",
    "scripts/ci/record-engine-deploy-exit.mjs",
    "server/scripts",
    "server/src/maintenance",
]


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


def projection(sha, *, release_authority=False):
    paths = list(CONTROL_INPUTS)
    if release_authority:
        # Once Stage freezes a control commit, even changes to expired orders
        # must wait for a new selection. The candidate's older expired orders
        # are assessed separately by the daily-compatibility policy.
        paths.extend(("server/release/activation-floor.json", "server/release/owner-maintenance-windows.json"))
    return git("ls-tree", "-r", sha, "--", *paths)


def verify_selection(repo, rid, cutoff, qualification):
    """Bind repository_dispatch to the already uploaded, first-attempt selection."""
    require(re.fullmatch(r"[1-9][0-9]{0,19}", rid), "invalid selection run id")
    run = api(f"repos/{repo}/actions/runs/{rid}")
    operator = run["event"] == "repository_dispatch" and run.get("actor", {}).get("type") == "User"
    if operator:
        created = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
        require(created.utcoffset() is not None and cutoff <= created.timestamp() < cutoff + 20 * 60,
                "operator Stage was created outside the preparation window")
    require(run["id"] == int(rid) and run["run_attempt"] == 1
            and (run["event"] in ("push", "schedule") or operator) and run["head_branch"] == "main"
            and run["path"] == ".github/workflows/stage-engine-release.yml"
            and run["repository"]["full_name"].lower() == repo.lower()
            and run["head_repository"]["full_name"].lower() == repo.lower()
            and (run["status"] == "in_progress" or run["conclusion"] == "success"),
            "selection is not a protected original stage run")
    stage = run["head_sha"]
    protected(stage)
    git("merge-base", "--is-ancestor", qualification["controlSha"], stage)
    require(projection(stage, release_authority=True) == projection(qualification["controlSha"], release_authority=True), "stage release controls changed after cutoff")
    jobs = api(f"repos/{repo}/actions/runs/{rid}/attempts/1/jobs?per_page=100")
    require(jobs["total_count"] == len(jobs["jobs"]), "selection jobs incomplete")
    selected = [job for job in jobs["jobs"] if job["name"] == "Record the daily release evidence"]
    require(len(selected) == 1 and selected[0]["run_id"] == int(rid)
            and selected[0]["head_sha"] == stage and selected[0]["run_attempt"] == 1
            and selected[0]["status"] == "completed" and selected[0]["conclusion"] == "success",
            "selection job has not succeeded")
    chicago = datetime.fromtimestamp(cutoff, ZoneInfo("America/Chicago"))
    require((chicago.hour, chicago.minute, chicago.second) == (3, 30, 0), "invalid selection cutoff")
    name = "daily-engine-selection-" + chicago.date().isoformat()
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
    require(receipt["schema"] == 1 and receipt["outcome"] == "selected"
            and receipt["targetSha"] == qualification["targetSha"]
            and receipt["stageSha"] == stage and receipt["controlSha"] == qualification["controlSha"]
            and receipt["cutoffEpoch"] == cutoff and receipt["qualification"] == qualification,
            "stage selection and immutable qualification differ")


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
    require(run["event"] in ("push", "workflow_dispatch") and run["head_branch"] == "main"
            and run["path"] == PATH and run["head_sha"] == target
            and run["repository"]["full_name"].lower() == repo.lower()
            and run["head_repository"]["full_name"].lower() == repo.lower()
            and run["status"] == "completed" and run["conclusion"] == "success",
            "latest qualification is incomplete, unsuccessful or untrusted")
    rid, attempt = run["id"], run["run_attempt"]
    require(type(rid) is int and rid > 0 and type(attempt) is int and attempt > 0, "invalid run coordinates")
    jobs = api(f"repos/{repo}/actions/runs/{rid}/attempts/{attempt}/jobs?per_page=100")
    expected = {f"Qualify exact engine ({n}/4)" for n in range(1, 5)} | {"Stage immutable candidate and rollback images"}
    rows = jobs["jobs"]
    require(jobs["total_count"] == len(rows) == 5 and {j["name"] for j in rows} == expected,
            "incomplete qualification jobs")
    for job in rows:
        require(job["run_id"] == rid and job["run_attempt"] == attempt and job["head_sha"] == target and job["conclusion"] == "success"
                and job["status"] == "completed", "invalid qualification job")
    completed = max(datetime.fromisoformat(j["completed_at"].replace("Z", "+00:00")) for j in rows)
    now = datetime.now(timezone.utc)
    require(completed.timestamp() <= min(args.cutoff, now.timestamp()), "qualification missed cutoff")
    stage = next(j for j in rows if j["name"] == "Stage immutable candidate and rollback images")
    markers = [s["name"] for s in stage["steps"] if s["conclusion"] == "success" and s["name"].startswith("Prepared image ")]
    require(len(markers) == 1, "missing immutable image receipt")
    match = re.fullmatch(fr"Prepared image ({IMAGE}) rollback ({IMAGE}) tree ({SHA})", markers[0])
    require(match and match[3] == git("rev-parse", target + ":server"), "invalid immutable image receipt")
    newest = api(f"repos/{repo}/actions/workflows/{WORKFLOW}/runs?branch=main&head_sha={target}&per_page=1")["workflow_runs"]
    require(newest and newest[0]["id"] == rid and newest[0]["run_attempt"] == attempt
            and newest[0]["status"] == "completed" and newest[0]["conclusion"] == "success",
            "qualification superseded during verification")
    return dict(schema=1, targetSha=target, controlSha=control, qualificationRunId=rid,
                attempt=attempt, completedAt=completed.isoformat(), imageId=match[1],
                rollbackImageId=match[2], serverTree=match[3])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("repo", "target", "control"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--cutoff", required=True, type=int)
    parser.add_argument("--receiver-control")
    parser.add_argument("--selection-run-id")
    try:
        args = parser.parse_args()
        result = read(args)
        if args.receiver_control:
            require(args.selection_run_id, "receiver requires an immutable selection run")
            verify_selection(args.repo, args.selection_run_id, args.cutoff, result)
        print(json.dumps(result))
    except Unqualified as error:
        print(error, file=sys.stderr)
        sys.exit(3)
    except (subprocess.SubprocessError, OSError, KeyError, TypeError, ValueError, zipfile.BadZipFile) as error:
        print(f"Qualification provenance unavailable: {error}", file=sys.stderr)
        sys.exit(2)
