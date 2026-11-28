#!/usr/bin/env python3
"""Persistent bad-commit draft-revert helper.

Safe, deterministic operator CLI (NOT a watcher, NOT a cron, NEVER pushes,
NEVER auto-merges, NEVER bypasses CI or branch protection).

Inspects a confirmed persistently failing commit SHA on main (verified failed
engine-release-prequalification.yml or refused/failed backup-engine.yml with
run ID and bounded failure tail) and generates an exact draft-revert plan and
PR body payload so healthy commits sitting above the bad commit can be
unblocked cleanly.

Default mode is --dry-run (stdout only, zero repository mutations).

Exit codes (CLAUDE.md 10.86 fail-safe):
  0  Confirmed failing commit; draft-revert plan and PR body emitted
  1  Refused (commit not confirmed failing, not on main, or at/behind serving)
  3  Unreadable or malformed git/GitHub/fixture input
"""
from __future__ import annotations

import argparse
import json
import re
import runpy
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

EXIT_OK = 0
EXIT_REFUSED = 1
EXIT_UNREADABLE = 3

HEX_SHA = re.compile(r"^[0-9a-f]{40}$")
PREQUAL_WORKFLOW = "engine-release-prequalification.yml"
BACKUP_WORKFLOW = "backup-engine.yml"
ALLOWED_WORKFLOWS = {
    PREQUAL_WORKFLOW: ".github/workflows/" + PREQUAL_WORKFLOW,
    BACKUP_WORKFLOW: ".github/workflows/" + BACKUP_WORKFLOW,
}
FAILING_CONCLUSIONS = frozenset({"failure", "timed_out", "action_required"})
TRUSTED_EVENTS = frozenset({"push", "workflow_dispatch"})

DEFAULT_MAX_TAIL_LINES = 40
DEFAULT_MAX_TAIL_CHARS = 4000

SECRET_PATTERNS = (
    (re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b"), "[REDACTED_GH_TOKEN]"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{12,}\b", re.IGNORECASE), "Bearer [REDACTED]"),
    (re.compile(r"postgres(?:ql)?://[^\s'\"`]+", re.IGNORECASE), "postgresql://[REDACTED]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"), "[REDACTED_JWT]"),
)


class UnreadableError(Exception):
    """Raised when required git, GitHub API, or fixture data cannot be read."""


def sanitize_and_bound_tail(
    raw_text: str,
    *,
    max_lines: int = DEFAULT_MAX_TAIL_LINES,
    max_chars: int = DEFAULT_MAX_TAIL_CHARS,
) -> tuple[str, bool]:
    text = raw_text or ""
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    lines = text.splitlines()
    truncated = False
    if len(lines) > max_lines:
        lines = lines[-max_lines:]
        truncated = True
    bounded = "\n".join(lines).strip()
    if len(bounded) > max_chars:
        bounded = bounded[-max_chars:]
        truncated = True
    return bounded, truncated


def _run_git(cwd: str | Path, *args: str) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            ["git", "--no-replace-objects", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=30,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except (OSError, subprocess.SubprocessError) as exc:
        raise UnreadableError(f"git {' '.join(args[:2])} failed: {exc}") from exc


def _load_json_file(path: str | Path, label: str) -> Any:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise UnreadableError(f"{label} unreadable: {exc}") from exc
    if not raw.strip():
        raise UnreadableError(f"{label} is empty")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise UnreadableError(f"{label} invalid JSON: {exc.msg}") from exc


def _fetch_workflow_runs_gh(repo: str, workflow: str, sha: str) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            [
                "gh",
                "api",
                f"repos/{repo}/actions/workflows/{workflow}/runs?branch=main&head_sha={sha}&per_page=10",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise UnreadableError(f"gh api failed for {workflow}: {exc}") from exc
    if proc.returncode != 0:
        raise UnreadableError(f"gh api returned rc={proc.returncode} for {workflow}")
    if not proc.stdout.strip():
        raise UnreadableError(f"gh api returned empty stdout for {workflow}")
    try:
        parsed = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise UnreadableError(f"gh api returned malformed JSON for {workflow}: {exc.msg}") from exc
    if not isinstance(parsed, dict) or not isinstance(parsed.get("workflow_runs"), list):
        raise UnreadableError(f"gh api payload missing workflow_runs list for {workflow}")
    return parsed


def _fetch_failed_log_gh(repo: str, run_id: int) -> str:
    try:
        proc = subprocess.run(
            ["gh", "run", "view", str(run_id), "--repo", repo, "--log-failed"],
            capture_output=True,
            text=True,
            timeout=45,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise UnreadableError(f"gh run view failed for run {run_id}: {exc}") from exc
    if proc.returncode != 0:
        raise UnreadableError(f"gh run view returned rc={proc.returncode} for run {run_id}")
    return proc.stdout


def select_verified_failure(
    *,
    sha: str,
    repo: str,
    workflow: str,
    runs_payload: dict[str, Any],
    min_failures: int = 1,
) -> dict[str, Any] | None:
    """Validate workflow runs for exact sha on main and return latest confirmed failure.

    Returns None if the latest trusted completed run passed or no confirmed
    failure meets min_failures. Raises UnreadableError on malformed payloads.
    """
    if workflow not in ALLOWED_WORKFLOWS:
        raise UnreadableError(f"unsupported workflow {workflow!r}")
    if not isinstance(runs_payload, dict) or not isinstance(runs_payload.get("workflow_runs"), list):
        raise UnreadableError(f"{workflow} payload missing workflow_runs list")

    expected_path = ALLOWED_WORKFLOWS[workflow]
    trusted: list[dict[str, Any]] = []
    for run in runs_payload["workflow_runs"]:
        if not isinstance(run, dict):
            raise UnreadableError(f"{workflow} contains non-object run entry")
        if run.get("head_sha") != sha:
            continue
        if "head_branch" in run and run.get("head_branch") != "main":
            continue
        if "event" in run and run.get("event") not in TRUSTED_EVENTS:
            continue
        if "path" in run and run.get("path") != expected_path:
            continue
        if repo:
            for key in ("repository", "head_repository"):
                repo_obj = run.get(key)
                if isinstance(repo_obj, dict) and repo_obj.get("full_name"):
                    if str(repo_obj["full_name"]).lower() != repo.lower():
                        raise UnreadableError(f"{workflow} run repository mismatch")
        trusted.append(run)

    if not trusted:
        return None

    # Sort newest first by created_at/updated_at or id
    trusted.sort(
        key=lambda r: (str(r.get("updated_at") or r.get("created_at") or ""), int(r.get("id") or 0)),
        reverse=True,
    )

    # If the newest completed run succeeded, the commit is NOT persistently failing.
    completed = [r for r in trusted if r.get("status") == "completed"]
    if not completed:
        return None
    newest = completed[0]
    if newest.get("conclusion") == "success":
        return None

    failures = [r for r in completed if r.get("conclusion") in FAILING_CONCLUSIONS]
    if len(failures) < min_failures:
        return None

    chosen = failures[0]
    run_id = chosen.get("id")
    if not isinstance(run_id, int) or isinstance(run_id, bool) or run_id <= 0:
        raise UnreadableError(f"{workflow} failing run missing positive integer id")

    html_url = chosen.get("html_url")
    if not isinstance(html_url, str) or not html_url:
        html_url = f"https://github.com/{repo}/actions/runs/{run_id}" if repo else f"run:{run_id}"

    return {
        "workflow": workflow,
        "workflowPath": expected_path,
        "runId": run_id,
        "runUrl": html_url,
        "conclusion": str(chosen.get("conclusion")),
        "failedRunCount": len(failures),
        "updatedAt": chosen.get("updated_at") or chosen.get("created_at") or "",
    }


def load_control_inputs(repo_root: Path) -> list[str]:
    prequal_path = repo_root / "scripts" / "ci" / "read-engine-prequalification.py"
    if not prequal_path.exists():
        return []
    try:
        ns = runpy.run_path(str(prequal_path))
        inputs = ns.get("CONTROL_INPUTS")
        return [str(x) for x in inputs] if isinstance(inputs, list) else []
    except BaseException:
        return []


def classify_control_paths(files: list[str], control_inputs: list[str]) -> list[str]:
    matched = []
    for path in files:
        if any(path == item or path.startswith(item + "/") for item in control_inputs):
            matched.append(path)
    return sorted(matched)


def format_pr_body(plan: dict[str, Any]) -> str:
    bad = plan["badCommit"]
    ev = plan["failureEvidence"]
    above = plan["unblockedCommitsAbove"]
    lines = [
        "Lane: release-custody",
        "",
        "## Summary",
        "",
        f"Isolate persistently failing commit `{bad['shortSha']}` (`{bad['subject']}`) on `main` via a clean revert PR so healthy commits above it can certify and cut over.",
        "",
        "## Verified Failure Evidence",
        "",
        f"- Bad commit: `{bad['sha']}`",
        f"- Failing workflow: `{ev['workflow']}` (`{ev['workflowPath']}`)",
        f"- Run ID: `{ev['runId']}`",
        f"- Run URL: {ev['runUrl']}",
        f"- Conclusion: `{ev['conclusion']}` (confirmed failed runs: `{ev['failedRunCount']}`)",
        "",
        "### Bounded Failure Log Tail",
        "",
        "```text",
        ev["boundedLogTail"] or "(no failure log tail supplied)",
        "```",
    ]
    if ev["tailTruncated"]:
        lines.append("")
        lines.append("Note: failure log tail was truncated to bounded line/character limits.")

    lines.extend(["", "## Affected Files", ""])
    if bad["affectedFiles"]:
        for path in bad["affectedFiles"]:
            lines.append(f"- `{path}`")
    else:
        lines.append("- (no changed file paths recorded)")

    if bad["touchesReleaseControls"]:
        lines.extend([
            "",
            "## Release-Control Merge Window Notice",
            "",
            "This revert touches release-control path(s) in `CONTROL_INPUTS`:",
            "",
        ])
        for path in bad["controlPathsTouched"]:
            lines.append(f"- `{path}`")
        lines.append("")
        lines.append("Merge only inside the post-cycle release-control window unless an explicit outage override applies.")

    lines.extend(["", "## Commits Above Unblocked By This Revert", ""])
    if above:
        for commit in above:
            lines.append(f"- `{commit['shortSha']}` {commit['subject']}")
    else:
        lines.append("- (bad commit is currently at tip of base ref)")

    lines.extend([
        "",
        "## Operator Execution Plan (Dry-Run Generated)",
        "",
        "This helper never pushes, merges, or bypasses CI. Run from a fresh external SSD worktree:",
        "",
        "```bash",
        *plan["commands"],
        "```",
        "",
        "## Safety Checklist",
        "",
        "- [ ] Required CI checks pass on the draft revert PR",
        "- [ ] Protected squash merge used (no force-push, no auto-merge bypass)",
        "- [ ] Post-merge Backup certification verified on the resulting main commit",
    ])
    return "\n".join(lines) + "\n"


def build_draft_revert_plan(
    *,
    repo_root: str | Path,
    sha: str,
    repo: str = "",
    base_ref: str = "origin/main",
    serving_sha: str = "",
    prequal_runs: dict[str, Any] | None = None,
    backup_runs: dict[str, Any] | None = None,
    failure_log_text: str | None = None,
    min_failures: int = 1,
    max_tail_lines: int = DEFAULT_MAX_TAIL_LINES,
    max_tail_chars: int = DEFAULT_MAX_TAIL_CHARS,
    dry_run: bool = True,
) -> tuple[int, dict[str, Any]]:
    root = Path(repo_root)
    if not HEX_SHA.fullmatch(sha or ""):
        raise UnreadableError("bad commit --sha must be an exact 40-char lowercase hex SHA")

    # Verify commit exists
    rc, _, _ = _run_git(root, "cat-file", "-e", f"{sha}^{{commit}}")
    if rc != 0:
        return EXIT_REFUSED, {
            "schemaVersion": 1,
            "ok": False,
            "exitCode": EXIT_REFUSED,
            "dryRun": dry_run,
            "reason": f"commit {sha[:12]} does not exist in repository",
        }

    # Verify base_ref exists and sha is an ancestor of base_ref
    rc, base_sha_out, _ = _run_git(root, "rev-parse", "--verify", f"{base_ref}^{{commit}}")
    if rc != 0:
        raise UnreadableError(f"base ref {base_ref!r} could not be resolved")
    base_sha = base_sha_out.strip()

    rc, _, _ = _run_git(root, "merge-base", "--is-ancestor", sha, base_sha)
    if rc == 1:
        return EXIT_REFUSED, {
            "schemaVersion": 1,
            "ok": False,
            "exitCode": EXIT_REFUSED,
            "dryRun": dry_run,
            "reason": f"commit {sha[:12]} is not an ancestor of {base_ref} ({base_sha[:12]})",
        }
    if rc != 0:
        raise UnreadableError(f"git merge-base failed comparing {sha[:12]} and {base_ref}")

    # Optional serving build safety guard: never draft-revert a commit already serving or behind serving
    if serving_sha:
        if not HEX_SHA.fullmatch(serving_sha):
            raise UnreadableError("--serving must be an exact 40-char lowercase hex SHA")
        rc, _, _ = _run_git(root, "merge-base", "--is-ancestor", sha, serving_sha)
        if rc == 0:
            return EXIT_REFUSED, {
                "schemaVersion": 1,
                "ok": False,
                "exitCode": EXIT_REFUSED,
                "dryRun": dry_run,
                "reason": f"commit {sha[:12]} is at or behind the live serving build {serving_sha[:12]}; refusing revert plan",
            }
        if rc != 1:
            raise UnreadableError(f"git merge-base failed comparing {sha[:12]} and serving {serving_sha[:12]}")

    # Gather failure evidence from prequal and/or backup-engine
    evidence = None
    if prequal_runs is not None:
        evidence = select_verified_failure(
            sha=sha,
            repo=repo,
            workflow=PREQUAL_WORKFLOW,
            runs_payload=prequal_runs,
            min_failures=min_failures,
        )
    if evidence is None and backup_runs is not None:
        evidence = select_verified_failure(
            sha=sha,
            repo=repo,
            workflow=BACKUP_WORKFLOW,
            runs_payload=backup_runs,
            min_failures=min_failures,
        )
    if evidence is None and prequal_runs is None and backup_runs is None:
        if not repo:
            raise UnreadableError(
                "must provide --repo (for gh api) or --prequal-runs-json / --backup-runs-json"
            )
        pq_payload = _fetch_workflow_runs_gh(repo, PREQUAL_WORKFLOW, sha)
        evidence = select_verified_failure(
            sha=sha,
            repo=repo,
            workflow=PREQUAL_WORKFLOW,
            runs_payload=pq_payload,
            min_failures=min_failures,
        )
        if evidence is None:
            bk_payload = _fetch_workflow_runs_gh(repo, BACKUP_WORKFLOW, sha)
            evidence = select_verified_failure(
                sha=sha,
                repo=repo,
                workflow=BACKUP_WORKFLOW,
                runs_payload=bk_payload,
                min_failures=min_failures,
            )

    if evidence is None:
        return EXIT_REFUSED, {
            "schemaVersion": 1,
            "ok": False,
            "exitCode": EXIT_REFUSED,
            "dryRun": dry_run,
            "reason": (
                f"commit {sha[:12]} has no confirmed persistent failure in "
                f"{PREQUAL_WORKFLOW} or {BACKUP_WORKFLOW}"
            ),
        }

    if failure_log_text is None:
        if repo:
            failure_log_text = _fetch_failed_log_gh(repo, int(evidence["runId"]))
        else:
            failure_log_text = ""

    bounded_tail, tail_truncated = sanitize_and_bound_tail(
        failure_log_text,
        max_lines=max_tail_lines,
        max_chars=max_tail_chars,
    )
    evidence["boundedLogTail"] = bounded_tail
    evidence["tailTruncated"] = tail_truncated

    # Commit metadata and affected files
    rc, meta_out, _ = _run_git(root, "show", "-s", "--format=%s%x00%cI", sha)
    if rc != 0:
        raise UnreadableError(f"git show failed for {sha[:12]}")
    subject, _, author_date = meta_out.strip().partition("\x00")

    rc, files_out, _ = _run_git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--first-parent", sha)
    if rc != 0:
        raise UnreadableError(f"git diff-tree failed for {sha[:12]}")
    affected_files = sorted({line.strip() for line in files_out.splitlines() if line.strip()})

    control_inputs = load_control_inputs(root)
    control_paths = classify_control_paths(affected_files, control_inputs)

    # Commits sitting above the bad commit on base_ref
    rc, above_out, _ = _run_git(root, "log", "--first-parent", "--format=%H%x09%s", f"{sha}..{base_sha}")
    if rc != 0:
        raise UnreadableError(f"git log failed for {sha[:12]}..{base_ref}")
    unblocked: list[dict[str, str]] = []
    for line in above_out.splitlines():
        if not line.strip():
            continue
        c_sha, _, c_subj = line.partition("\t")
        if HEX_SHA.fullmatch(c_sha):
            unblocked.append({"sha": c_sha, "shortSha": c_sha[:12], "subject": c_subj})

    short_sha = sha[:12]
    branch_name = f"revert/bad-commit-{short_sha}"
    clean_subject = subject.replace("\u2014", "-").replace("\u2013", "-")
    pr_title = f"revert: isolate failing commit {short_sha} ({clean_subject[:60]})"

    commands = [
        f"git worktree add -b {branch_name} <SSD2_WORKTREE_DIR> {base_ref}",
        "cd <SSD2_WORKTREE_DIR>",
        f"git revert --no-edit {sha}",
        "bash scripts/agent-push.sh",
        f'gh pr create --draft --base main --head {branch_name} --title "{pr_title}" --body-file <PR_BODY_FILE>',
    ]

    plan: dict[str, Any] = {
        "schemaVersion": 1,
        "ok": True,
        "exitCode": EXIT_OK,
        "dryRun": dry_run,
        "baseRef": base_ref,
        "baseSha": base_sha,
        "badCommit": {
            "sha": sha,
            "shortSha": short_sha,
            "subject": clean_subject,
            "committedAt": author_date,
            "affectedFiles": affected_files,
            "touchesReleaseControls": len(control_paths) > 0,
            "controlPathsTouched": control_paths,
        },
        "failureEvidence": evidence,
        "unblockedCommitsAbove": unblocked,
        "draftRevertBranch": branch_name,
        "prTitle": pr_title,
        "commands": commands,
    }
    plan["prBody"] = format_pr_body(plan)
    return EXIT_OK, plan


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a safe dry-run draft-revert plan and PR body for a confirmed failing commit on main."
    )
    parser.add_argument("--sha", required=True, help="Exact 40-char hex SHA of the persistently failing commit")
    parser.add_argument("--repo", default="", help="GitHub owner/repo (for live gh api queries)")
    parser.add_argument("--repo-root", default=".", help="Git repository root path (default: .)")
    parser.add_argument("--base-ref", default="origin/main", help="Protected base ref (default: origin/main)")
    parser.add_argument("--serving", default="", help="Optional live serving SHA guard")
    parser.add_argument("--prequal-runs-json", default="", help="Optional local prequalification runs JSON")
    parser.add_argument("--backup-runs-json", default="", help="Optional local backup-engine runs JSON")
    parser.add_argument("--failure-log-file", default="", help="Optional local failure log file")
    parser.add_argument("--min-failures", type=int, default=1, help="Minimum confirmed failed runs required (default: 1)")
    parser.add_argument("--max-tail-lines", type=int, default=DEFAULT_MAX_TAIL_LINES)
    parser.add_argument("--max-tail-chars", type=int, default=DEFAULT_MAX_TAIL_CHARS)
    parser.add_argument("--dry-run", action="store_true", default=True, help="Emit plan only without mutating git (always default)")
    parser.add_argument("--write-payload", default="", help="Optional output path to save JSON draft payload")
    parser.add_argument("--write-pr-body", default="", help="Optional output path to save Markdown PR body")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        prequal_runs = (
            _load_json_file(args.prequal_runs_json, "prequal-runs-json")
            if args.prequal_runs_json
            else None
        )
        backup_runs = (
            _load_json_file(args.backup_runs_json, "backup-runs-json")
            if args.backup_runs_json
            else None
        )
        failure_log_text = None
        if args.failure_log_file:
            try:
                failure_log_text = Path(args.failure_log_file).read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                raise UnreadableError(f"failure-log-file unreadable: {exc}") from exc

        code, payload = build_draft_revert_plan(
            repo_root=args.repo_root,
            sha=args.sha,
            repo=args.repo,
            base_ref=args.base_ref,
            serving_sha=args.serving,
            prequal_runs=prequal_runs,
            backup_runs=backup_runs,
            failure_log_text=failure_log_text,
            min_failures=args.min_failures,
            max_tail_lines=args.max_tail_lines,
            max_tail_chars=args.max_tail_chars,
            dry_run=bool(args.dry_run),
        )
    except UnreadableError as exc:
        err = {
            "schemaVersion": 1,
            "ok": False,
            "exitCode": EXIT_UNREADABLE,
            "dryRun": True,
            "error": str(exc),
        }
        print(json.dumps(err, indent=2))
        return EXIT_UNREADABLE

    if code == EXIT_OK:
        if args.write_payload:
            Path(args.write_payload).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        if args.write_pr_body:
            Path(args.write_pr_body).write_text(payload["prBody"], encoding="utf-8")

    print(json.dumps(payload, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
