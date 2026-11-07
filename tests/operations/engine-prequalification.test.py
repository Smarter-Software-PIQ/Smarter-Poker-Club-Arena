"""Trust boundaries for reused daytime qualification."""
from datetime import datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
import hashlib
import io
import os
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

root = Path(__file__).resolve().parents[2]
spec = spec_from_file_location("prequal", root / "scripts/ci/read-engine-prequalification.py")
reader = module_from_spec(spec)
spec.loader.exec_module(reader)


class Evidence(unittest.TestCase):
    def setUp(self):
        repo = "Smarter-Software-PIQ/Smarter-Poker-Club-Arena"
        self.args = SimpleNamespace(repo=repo, target="a"*40, control="b"*40,
                                    receiver_control="c"*40, cutoff=1700000000)
        name = {"full_name": repo}
        self.run_row = dict(id=99, run_attempt=1, event="push", head_branch="main",
                            path=reader.PATH, head_sha=self.args.target, repository=name,
                            head_repository=name, status="completed", conclusion="success")
        tree = "e"*40
        image = "sha256:" + "1"*64
        rollback = "sha256:" + "2"*64
        names = [f"Qualify exact engine ({n}/4)" for n in range(1, 5)]
        names.append("Stage immutable candidate and rollback images")
        self.jobs = [dict(name=n, run_id=99, run_attempt=1, head_sha=self.args.target,
                          status="completed", conclusion="success", steps=[],
                          completed_at=datetime.fromtimestamp(1700000000, timezone.utc).isoformat())
                     for n in names]
        self.jobs[-1]["steps"] = [dict(name=f"Prepared image {image} rollback {rollback} tree {tree}", conclusion="success")]
        git = patch.object(reader, "git", side_effect=lambda *a: tree if a[0]=="rev-parse" else "")
        git.start()
        self.addCleanup(git.stop)

    def verify(self, newest=None):
        calls = [{"workflow_runs":[self.run_row]}, {"total_count":len(self.jobs), "jobs":self.jobs},
                 {"workflow_runs":[newest or self.run_row]}]
        with patch.object(reader, "api", side_effect=calls):
            return reader.read(self.args)

    def test_complete_exact_candidate(self):
        self.assertEqual(self.verify()["rollbackImageId"], "sha256:"+"2"*64)

    def test_late_or_superseded_evidence_refuses(self):
        with self.assertRaises(reader.Unqualified):
            self.verify({**self.run_row, "run_attempt":2})
        self.args.cutoff -= 1
        with self.assertRaises(reader.Unqualified):
            self.verify()

    def test_untrusted_runs_refuse(self):
        original = self.run_row
        for k,v in (("head_branch","topic"),("event","pull_request"),("path","wrong"),
                    ("conclusion","failure"),("head_sha","d"*40),("head_repository",{"full_name":"other/repo"})):
            self.run_row = {**original,k:v}
            with self.subTest(k=k), self.assertRaises(reader.Unqualified):
                self.verify()

    def test_missing_or_unsuccessful_shard_refuses(self):
        self.jobs[0]["conclusion"] = "skipped"
        with self.assertRaises(reader.Unqualified):
            self.verify()
        self.jobs.pop(0)
        with self.assertRaises(reader.Unqualified):
            self.verify()

    def test_digest_and_control_must_bind(self):
        self.jobs[-1]["steps"][0]["name"] += " alternate"
        with self.assertRaises(reader.Unqualified):
            self.verify()
        with patch.object(reader, "projection", side_effect=["before","after"]), self.assertRaises(reader.Unqualified):
            self.verify()


class Selection(unittest.TestCase):
    def verify(self, *, altered=False, duplicate=False, late=False, pending=False):
        repo = "Smarter-Software-PIQ/Smarter-Poker-Club-Arena"
        cutoff = int(datetime(2026, 11, 8, 9, 30, tzinfo=timezone.utc).timestamp())
        qualification = {"targetSha":"a"*40, "controlSha":"b"*40, "qualificationRunId":21}
        run = dict(id=22, run_attempt=1, event="schedule", head_branch="main", status="in_progress",
                   path=".github/workflows/stage-engine-release.yml", head_sha="c"*40,
                   repository={"full_name":repo}, head_repository={"full_name":repo})
        receipt = dict(schema=1, outcome="selected", cutoffEpoch=cutoff+int(late),
                       qualification=qualification, stageSha=run["head_sha"],
                       targetSha=qualification["targetSha"], controlSha=qualification["controlSha"])
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as bundle:
            bundle.writestr("daily-selection.json", json.dumps(receipt))
            if duplicate:
                bundle.writestr("other.json", "{}")
        archive = data.getvalue()
        artifact = dict(id=7, name="daily-engine-selection-2026-11-08", expired=False,
                        size_in_bytes=len(archive), digest="sha256:"+hashlib.sha256(archive).hexdigest())
        job = dict(name="Freeze the daily release evidence", run_id=22, run_attempt=1,
                   head_sha=run["head_sha"], status="completed", conclusion="success" if not pending else None)
        with patch.object(reader, "api", side_effect=[run, {"total_count":1, "jobs":[job]}, {"total_count":1,"artifacts":[artifact]}]), \
             patch.object(reader, "git", return_value=""), \
             patch.object(reader.subprocess, "check_output", return_value=archive + (b"x" if altered else b"")):
            reader.verify_selection(repo, "22", cutoff, qualification)

    def test_verifies_stage_artifact_and_rejects_changed_archive_or_cutoff(self):
        self.verify()
        for mismatch in ("altered","duplicate","late","pending"):
            with self.subTest(mismatch=mismatch), self.assertRaises(reader.Unqualified):
                self.verify(**{mismatch: True})


class ControlInputs(unittest.TestCase):
    def test_real_git_projection_preserves_unrelated_changes_and_detects_release_inputs(self):
        with tempfile.TemporaryDirectory() as folder:
            def git(*args):
                return subprocess.check_output(["git","-C",folder,*args], text=True, env={
                    "PATH": os.environ["PATH"], "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM":"1",
                }).strip()
            git("init","-q")
            def edit(path, text):
                file = Path(folder)/path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(text)
                git("add",path)
                git("-c","user.name=fixture","-c","user.email=fixture@example.invalid","commit","-qm","fixture")
                return git("rev-parse","HEAD")
            base = edit(reader.PATH,"first")
            with patch.object(reader, "git", side_effect=git):
                project = reader.projection(base)
                for path in ("scripts/unrelated.py", "infra/unrelated", "deploy/unrelated"):
                    self.assertEqual(project, reader.projection(edit(path,"other")))
                self.assertNotEqual(project, reader.projection(edit(reader.PATH,"changed")))


if __name__ == "__main__":
    unittest.main()
