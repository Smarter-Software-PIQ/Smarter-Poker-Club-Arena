#!/usr/bin/env python3
"""Unit and CLI tests for scripts/release/draft-revert-bad-commit.py."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "release" / "draft-revert-bad-commit.py"


def load_module():
    spec = importlib.util.spec_from_file_location("draft_revert_bad_commit", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MOD = load_module()


def init_test_repo(repo_dir: Path) -> dict[str, str]:
    def git(*args: str) -> str:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            check=True,
        )
        return proc.stdout.strip()

    git("init", "-b", "main")
    git("config", "user.email", "test@smarter.poker")
    git("config", "user.name", "Test Bot")

    (repo_dir / "server" / "src").mkdir(parents=True, exist_ok=True)
    (repo_dir / "server" / "src" / "a.ts").write_text("export const a = 1;\n", encoding="utf-8")
    git("add", ".")
    git("commit", "-m", "chore: serving baseline")
    serving = git("rev-parse", "HEAD")

    (repo_dir / "server" / "src" / "bad.ts").write_text("export const broken = true;\n", encoding="utf-8")
    git("add", ".")
    git("commit", "-m", "feat: introduce bad commit")
    bad = git("rev-parse", "HEAD")

    (repo_dir / "server" / "src" / "good.ts").write_text("export const good = 42;\n", encoding="utf-8")
    git("add", ".")
    git("commit", "-m", "fix: good commit sitting above bad commit")
    good = git("rev-parse", "HEAD")

    return {"serving": serving, "bad": bad, "good": good}


class DraftRevertBadCommitTest(unittest.TestCase):
    def test_generates_dry_run_plan_and_redacts_secrets_in_bounded_tail(self):
        with tempfile.TemporaryDirectory() as td:
            repo_dir = Path(td) / "repo"
            repo_dir.mkdir()
            shas = init_test_repo(repo_dir)

            prequal_json = Path(td) / "prequal.json"
            prequal_json.write_text(
                json.dumps({
                    "workflow_runs": [
                        {
                            "id": 99887766,
                            "head_sha": shas["bad"],
                            "head_branch": "main",
                            "event": "push",
                            "path": ".github/workflows/engine-release-prequalification.yml",
                            "status": "completed",
                            "conclusion": "failure",
                            "updated_at": "2026-11-28T08:00:00Z",
                            "html_url": "https://github.com/org/repo/actions/runs/99887766",
                        }
                    ]
                }),
                encoding="utf-8",
            )

            log_file = Path(td) / "fail.log"
            lines = [f"step line {i}" for i in range(60)]
            lines.append("ERROR token ghp_1234567890abcdef1234567890 leaked")
            lines.append("ERROR db postgresql://user:secret@db.internal:5432/prod failed")
            lines.append("FAIL server/src/bad.test.ts: assertion failed")
            log_file.write_text("\n".join(lines), encoding="utf-8")

            out_payload = Path(td) / "payload.json"
            out_body = Path(td) / "body.md"

            proc = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(SCRIPT),
                    "--repo-root",
                    str(repo_dir),
                    "--base-ref",
                    "main",
                    "--sha",
                    shas["bad"],
                    "--serving",
                    shas["serving"],
                    "--prequal-runs-json",
                    str(prequal_json),
                    "--failure-log-file",
                    str(log_file),
                    "--max-tail-lines",
                    "10",
                    "--write-payload",
                    str(out_payload),
                    "--write-pr-body",
                    str(out_body),
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            plan = json.loads(proc.stdout)
            self.assertTrue(plan["ok"])
            self.assertTrue(plan["dryRun"])
            self.assertEqual(plan["badCommit"]["sha"], shas["bad"])
            self.assertEqual(plan["badCommit"]["affectedFiles"], ["server/src/bad.ts"])
            self.assertEqual(plan["failureEvidence"]["runId"], 99887766)
            self.assertTrue(plan["failureEvidence"]["tailTruncated"])
            self.assertNotIn("ghp_1234567890abcdef1234567890", plan["prBody"])
            self.assertNotIn("user:secret@db.internal", plan["prBody"])
            self.assertIn("[REDACTED_GH_TOKEN]", plan["prBody"])
            self.assertIn("postgresql://[REDACTED]", plan["prBody"])
            self.assertEqual(len(plan["unblockedCommitsAbove"]), 1)
            self.assertEqual(plan["unblockedCommitsAbove"][0]["sha"], shas["good"])
            self.assertIn("Lane: release-custody", plan["prBody"])
            self.assertIn("99887766", plan["prBody"])
            self.assertNotIn("\u2014", plan["prBody"])
            self.assertTrue(out_payload.exists())
            self.assertTrue(out_body.exists())

    def test_refuses_when_latest_run_passed_or_commit_is_serving(self):
        with tempfile.TemporaryDirectory() as td:
            repo_dir = Path(td) / "repo"
            repo_dir.mkdir()
            shas = init_test_repo(repo_dir)

            # Newest run passed -> refuse (exit 1)
            passing_runs = {
                "workflow_runs": [
                    {
                        "id": 200,
                        "head_sha": shas["bad"],
                        "head_branch": "main",
                        "event": "push",
                        "path": ".github/workflows/engine-release-prequalification.yml",
                        "status": "completed",
                        "conclusion": "success",
                        "updated_at": "2026-11-28T09:00:00Z",
                    },
                    {
                        "id": 100,
                        "head_sha": shas["bad"],
                        "head_branch": "main",
                        "event": "push",
                        "path": ".github/workflows/engine-release-prequalification.yml",
                        "status": "completed",
                        "conclusion": "failure",
                        "updated_at": "2026-11-28T08:00:00Z",
                    },
                ]
            }
            code, payload = MOD.build_draft_revert_plan(
                repo_root=repo_dir,
                sha=shas["bad"],
                base_ref="main",
                prequal_runs=passing_runs,
                failure_log_text="",
            )
            self.assertEqual(code, 1)
            self.assertFalse(payload["ok"])

            # Refuses reverting serving commit itself
            failing_backup = {
                "workflow_runs": [
                    {
                        "id": 300,
                        "head_sha": shas["serving"],
                        "head_branch": "main",
                        "event": "push",
                        "path": ".github/workflows/backup-engine.yml",
                        "status": "completed",
                        "conclusion": "failure",
                        "updated_at": "2026-11-28T08:00:00Z",
                    }
                ]
            }
            code2, payload2 = MOD.build_draft_revert_plan(
                repo_root=repo_dir,
                sha=shas["serving"],
                base_ref="main",
                serving_sha=shas["serving"],
                backup_runs=failing_backup,
                failure_log_text="",
            )
            self.assertEqual(code2, 1)
            self.assertIn("serving build", payload2["reason"])

    def test_accepts_confirmed_backup_engine_failure_and_fails_closed_on_malformed_input(self):
        with tempfile.TemporaryDirectory() as td:
            repo_dir = Path(td) / "repo"
            repo_dir.mkdir()
            shas = init_test_repo(repo_dir)

            backup_runs = {
                "workflow_runs": [
                    {
                        "id": 445566,
                        "head_sha": shas["bad"],
                        "head_branch": "main",
                        "event": "push",
                        "path": ".github/workflows/backup-engine.yml",
                        "status": "completed",
                        "conclusion": "failure",
                        "updated_at": "2026-11-28T08:30:00Z",
                    }
                ]
            }
            code, plan = MOD.build_draft_revert_plan(
                repo_root=repo_dir,
                sha=shas["bad"],
                base_ref="main",
                backup_runs=backup_runs,
                failure_log_text="Backup refused: fatalLogLines=2",
            )
            self.assertEqual(code, 0)
            self.assertEqual(plan["failureEvidence"]["workflow"], "backup-engine.yml")
            self.assertEqual(plan["failureEvidence"]["runId"], 445566)

            # Malformed JSON -> exit 3
            corrupt = Path(td) / "corrupt.json"
            corrupt.write_text('{"workflow_runs": [', encoding="utf-8")
            proc = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(SCRIPT),
                    "--repo-root",
                    str(repo_dir),
                    "--base-ref",
                    "main",
                    "--sha",
                    shas["bad"],
                    "--prequal-runs-json",
                    str(corrupt),
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 3)

    def test_validates_run_ids_min_failures_redacts_modern_tokens_and_quotes_pr_title(self):
        with tempfile.TemporaryDirectory() as td:
            repo_dir = Path(td) / "repo"
            repo_dir.mkdir()
            shas = init_test_repo(repo_dir)

            # Add a commit whose subject contains shell-injection characters
            (repo_dir / "server" / "src" / "inject.ts").write_text("export const x = 1;\n", encoding="utf-8")
            subprocess.run(["git", "add", "."], cwd=str(repo_dir), check=True, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", 'fix: handle "quoted" $(whoami) `id`'],
                cwd=str(repo_dir),
                check=True,
                capture_output=True,
            )
            inject_sha = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(repo_dir),
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            # 1) Non-integer / bool run id fails closed with UnreadableError (exit 3 JSON) before sorting
            for bad_id in ("not-an-int", True, 0, -5, None):
                bad_runs = {
                    "workflow_runs": [
                        {
                            "id": bad_id,
                            "head_sha": shas["bad"],
                            "head_branch": "main",
                            "event": "push",
                            "path": ".github/workflows/engine-release-prequalification.yml",
                            "status": "completed",
                            "conclusion": "failure",
                            "updated_at": "2026-11-28T08:00:00Z",
                        }
                    ]
                }
                with self.subTest(bad_id=bad_id):
                    with self.assertRaises(MOD.UnreadableError):
                        MOD.build_draft_revert_plan(
                            repo_root=repo_dir,
                            sha=shas["bad"],
                            base_ref="main",
                            prequal_runs=bad_runs,
                            failure_log_text="",
                        )

            # 2) min_failures < 1 fails closed with UnreadableError (no IndexError)
            for bad_min in (0, -1):
                with self.subTest(bad_min=bad_min):
                    with self.assertRaises(MOD.UnreadableError):
                        MOD.build_draft_revert_plan(
                            repo_root=repo_dir,
                            sha=shas["bad"],
                            base_ref="main",
                            prequal_runs={"workflow_runs": []},
                            min_failures=bad_min,
                            failure_log_text="",
                        )

            # 3) Fine-grained GitHub PAT, Supabase PAT, and Supabase secret keys are redacted,
            #    and PR title is shell-quoted via shlex.quote
            valid_runs = {
                "workflow_runs": [
                    {
                        "id": 777888,
                        "head_sha": inject_sha,
                        "head_branch": "main",
                        "event": "push",
                        "path": ".github/workflows/engine-release-prequalification.yml",
                        "status": "completed",
                        "conclusion": "failure",
                        "updated_at": "2026-11-28T09:00:00Z",
                    }
                ]
            }
            leaked_log = "\n".join([
                "ERR github_pat_11ABCDEFGH0123456789_xyz9876543210",
                "ERR sbp_abcdef0123456789abcdef0123456789",
                "ERR sb_secret_aBcDeFgHiJkLmNoP_12345",
            ])
            code, plan = MOD.build_draft_revert_plan(
                repo_root=repo_dir,
                sha=inject_sha,
                base_ref="main",
                prequal_runs=valid_runs,
                failure_log_text=leaked_log,
            )
            self.assertEqual(code, 0)
            self.assertNotIn("github_pat_11ABCDEFGH0123456789_xyz9876543210", plan["prBody"])
            self.assertNotIn("sbp_abcdef0123456789abcdef0123456789", plan["prBody"])
            self.assertNotIn("sb_secret_aBcDeFgHiJkLmNoP_12345", plan["prBody"])
            gh_cmd = next(c for c in plan["commands"] if c.startswith("gh pr create"))
            import shlex
            tokens = shlex.split(gh_cmd)
            title_idx = tokens.index("--title") + 1
            self.assertEqual(tokens[title_idx], plan["prTitle"])
            self.assertNotIn(f'--title "{plan["prTitle"]}"', gh_cmd)


if __name__ == "__main__":
    unittest.main()
