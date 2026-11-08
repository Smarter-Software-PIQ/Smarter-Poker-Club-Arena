"""Trust boundaries for reused daytime qualification."""
from datetime import datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
import hashlib
import io
import os
import json
import subprocess
import tempfile
import tarfile
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
    def verify(self, *, altered=False, duplicate=False, late=False, pending=False, early=False, backup=False, owner=False, wrong_owner=False, wrong_stage=False, wrong_event=False, rerun=False,
               stale=False, controls=False, replay=False, event="schedule", sender="User",
               created="2026-11-08T09:35:00Z", attempt=1, title="Original operator daily preparation"):
        repo = "Smarter-Software-PIQ/Smarter-Poker-Club-Arena"
        cutoff = int(datetime(2026, 11, 8, 9, 30, tzinfo=timezone.utc).timestamp())
        owner_id = "2026-11-08-horse-study-successor-engine-1720z" if owner else None
        if owner:
            cutoff = int(datetime(2026, 11, 8, 17, 20, tzinfo=timezone.utc).timestamp())
        qualification = {"targetSha":"a"*40, "controlSha":"b"*40, "qualificationRunId":21}
        run = dict(id=22, run_attempt=attempt, event=event, actor={"type":sender}, created_at=created, head_branch="main", status="in_progress",
                   path=".github/workflows/stage-engine-release.yml", head_sha="c"*40,
                   repository={"full_name":repo}, head_repository={"full_name":repo}, display_title=title)
        if early:
            run.update(created_at="2026-11-08T04:30:00Z", display_title="Daily engine reservation")
        if backup:
            run.update(event="workflow_run", display_title="Automatic Backup daily reservation")
        if replay:
            run["run_attempt"] = 2
        if owner:
            run.update(event="push" if wrong_event else "workflow_dispatch", head_sha="b"*40,
                       created_at=datetime.fromtimestamp(cutoff, timezone.utc).isoformat(),
                       run_attempt=2 if rerun else 1)
            qualification["controlSha"] = "d"*40 if wrong_stage else "b"*40
        receipt = dict(schema=1, outcome="selected", cutoffEpoch=cutoff+int(late),
                       qualification=qualification, stageSha=run["head_sha"],
                       targetSha=qualification["targetSha"], controlSha=qualification["controlSha"])
        if owner:
            receipt["ownerWindowId"] = "forged" if wrong_owner else owner_id
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as bundle:
            bundle.writestr("daily-selection.json", json.dumps(receipt))
            if duplicate:
                bundle.writestr("other.json", "{}")
        archive = data.getvalue()
        artifact = dict(id=7, name="owner-engine-selection-" + owner_id if owner else "daily-engine-selection-2026-11-08", expired=False,
                        size_in_bytes=len(archive), digest="sha256:"+hashlib.sha256(archive).hexdigest())
        job = dict(name="Record the daily release evidence", run_id=22, run_attempt=1,
                   head_sha=run["head_sha"], status="completed", conclusion="success" if not pending else None,
                   started_at="2026-11-08T09:30:00Z", completed_at="2026-11-08T09:32:00Z")
        with patch.object(reader, "api", side_effect=[run, {"total_count":1, "jobs":[job]}, {"total_count":1,"artifacts":[artifact]}]), \
             patch.object(reader, "git", side_effect=lambda *a: ("d"*40 if stale else qualification["controlSha"]) if a[0] == "rev-list" else ""), \
             patch.object(reader, "projection", side_effect=["old", "new"] if controls else ["same", "same"]), \
             patch.object(reader, "owner_selection_policy") as policy, \
             patch.object(reader.subprocess, "check_output", return_value=archive + (b"x" if altered else b"")):
            reader.verify_selection(repo, "22", cutoff, qualification, owner_id)
            if owner:
                policy.assert_called_once_with(qualification["targetSha"], run["head_sha"], owner_id, cutoff)

    def test_owner_requires_original_protected_exact_stage_and_bound_artifact(self):
        self.verify(owner=True)
        for mismatch in ("altered", "duplicate", "late", "pending", "wrong_owner", "wrong_stage", "wrong_event", "rerun"):
            with self.subTest(mismatch=mismatch), self.assertRaises(reader.Unqualified):
                self.verify(owner=True, **{mismatch: True})

    def test_verifies_original_in_window_operator_only(self):
        self.verify(event="repository_dispatch")
        for changes in ({"sender":"Bot"}, {"attempt":2}, {"title":"forged"}, {"created":"2026-11-08T04:31:00Z"}, {"created":"2026-11-08T09:50:00Z"},
                        {"created":"2026-11-07T09:35:00Z"}):
            with self.subTest(changes=changes), self.assertRaises(reader.Unqualified):
                self.verify(event="repository_dispatch", **changes)

    def test_verifies_stage_artifact_and_rejects_changed_archive_or_cutoff(self):
        self.verify()
        self.verify(early=True)
        self.verify(early=True, backup=True)
        for mismatch in ("altered","duplicate","late","pending","stale","controls","replay"):
            with self.subTest(mismatch=mismatch), self.assertRaises(reader.Unqualified):
                self.verify(**{mismatch: True})


class ReservationDoorOwner(unittest.TestCase):
    def test_early_owner_and_preparation_owner_are_the_same(self):
        spec = spec_from_file_location("window_doors", root / "server/scripts/engine-release-window-doors.py")
        doors = module_from_spec(spec); spec.loader.exec_module(doors)
        early = dict(id=10, event="push", head_branch="main", created_at="2026-11-09T04:31:00Z", display_title="Daily engine reservation")
        legacy_noop = dict(id=9, event="push", head_branch="main", created_at="2026-11-09T04:30:00Z")
        late = dict(id=11, event="schedule", head_branch="main", created_at="2026-11-09T09:31:00Z")
        job = dict(name=doors.INSTALL_JOB, status="in_progress", conclusion=None, html_url="owner-job")
        def read(path):
            if "/workflows/" in path:
                return dict(total_count=3, workflow_runs=[late, early, legacy_noop])
            self.assertIn("/runs/10/jobs", path)
            return dict(jobs=[job])
        with patch.object(doors, "github", side_effect=read):
            self.assertEqual(doors.install_state(datetime(2026,11,9,10,tzinfo=timezone.utc))["url"], "owner-job")
        early.update(event="workflow_run", display_title="Automatic Backup daily reservation")
        with patch.object(doors, "github", side_effect=read):
            self.assertEqual(doors.install_state(datetime(2026,11,9,10,tzinfo=timezone.utc))["url"], "owner-job")
        early.update(event="repository_dispatch", display_title="Original operator daily preparation",
                     actor={"type":"User"}, created_at="2026-11-09T09:30:00Z", run_attempt=1)
        with patch.object(doors, "github", side_effect=read):
            self.assertEqual(doors.install_state(datetime(2026,11,9,10,tzinfo=timezone.utc))["url"], "owner-job")
        early["run_attempt"] = 2
        with patch.object(doors, "github", side_effect=read):
            self.assertIsNone(doors.install_state(datetime(2026,11,9,10,tzinfo=timezone.utc)))

    def test_unreadable_truncated_duplicate_and_naive_reservations_refuse(self):
        spec = spec_from_file_location("window_doors", root / "server/scripts/engine-release-window-doors.py")
        doors = module_from_spec(spec); spec.loader.exec_module(doors)
        run = dict(id=10, event="push", head_branch="main", created_at="2026-11-09T04:31:00Z", display_title="Daily engine reservation")
        for listing in [dict(total_count=1), dict(total_count=1,workflow_runs=[]),
                        dict(total_count=2,workflow_runs=[run,run]),
                        dict(total_count=1,workflow_runs=[{**run,"created_at":"2026-11-09T04:31:00"}])]:
            with self.subTest(listing=listing), patch.object(doors,"github",return_value=listing), self.assertRaises(ValueError):
                doors.install_state(datetime(2026,11,9,10,tzinfo=timezone.utc))


class OwnerPolicy(unittest.TestCase):
    def test_reuses_pinned_validator_and_rejects_wrong_identity_or_interval(self):
        now = int(datetime.now(timezone.utc).timestamp())
        owner = "finite-owner"
        floor = dict(ownerWindowId=owner,
                     activationAt=datetime.fromtimestamp(now-60, timezone.utc).isoformat(),
                     expiresAt=datetime.fromtimestamp(now+600, timezone.utc).isoformat())
        with patch.object(reader, "protected"), patch.object(reader, "git", return_value=json.dumps(floor)), \
             patch.object(reader.subprocess, "check_output", return_value=b"# original protected helper") as command:
            self.assertEqual(reader.owner_selection_policy("a"*40, "a"*40, owner, now), floor)
            call = command.call_args.args[0]
            self.assertEqual(call[3:], ["nov7-owner", "--repo", ".", "--target", "a"*40,
                                       "--control", "a"*40, "--deadline", str(now+600)])
            for target, identity, cutoff in (("a"*40,"forged",now),
                                             ("a"*40,owner,now-61),("a"*40,owner,now+601)):
                with self.assertRaises(reader.Unqualified):
                    reader.owner_selection_policy(target,"a"*40,identity,cutoff)
            # An unrelated protected commit is allowed only with identical controls.
            reader.owner_selection_policy("b"*40, "a"*40, owner, now)
            with patch.object(reader, "projection", side_effect=["old", "changed"]), self.assertRaises(reader.Unqualified):
                reader.owner_selection_policy("b"*40, "a"*40, owner, now)
            command.side_effect = subprocess.CalledProcessError(1, "pinned-validator")
            with self.assertRaises(subprocess.CalledProcessError):
                reader.owner_selection_policy("a"*40,"a"*40,owner,now)


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
                strict = reader.projection(base, release_authority=True)
                for path in ("server/release/activation-floor.json", "server/release/owner-maintenance-windows.json"):
                    changed = edit(path, "different protected owner authority")
                    self.assertEqual(project, reader.projection(changed))
                    next_strict = reader.projection(changed, release_authority=True)
                    self.assertNotEqual(strict, next_strict)
                    strict = next_strict
                self.assertNotEqual(project, reader.projection(edit(reader.PATH,"changed")))


class ArchiveTransport(unittest.TestCase):
    tag = "club-arena-prestage:42421366750-1"

    def setUp(self):
        spec = spec_from_file_location("transport", root / "server/scripts/engine-prestage-config-proof.py")
        self.transport = module_from_spec(spec)
        spec.loader.exec_module(self.transport)

    def graph(self, *, classic=False, wrong_config=False, extra_tag=False):
        config = json.dumps({"rootfs":{"type":"layers","diff_ids":["sha256:"+"3"*64]}}).encode()
        cid = self.transport.sha256(config)
        blob = "blobs/sha256/"
        path = cid[7:]+".json" if classic else blob+cid[7:]
        manifest = json.dumps({"schemaVersion":2, "config":{"digest":"sha256:"+"9"*64 if wrong_config else cid},
                               "layers":[{"digest":"sha256:"+"4"*64}]}).encode()
        mid = self.transport.sha256(manifest)
        records = [{"Config":path, "Layers":[blob+"4"*64], "RepoTags":[self.tag]+(["club-arena-engine:current"] if extra_tag else [])}]
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w") as bundle:
            bodies = [(path,config),("manifest.json",json.dumps(records).encode())]
            if not classic:
                bodies.append((blob+mid[7:],manifest))
            for name, data in bodies:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                bundle.addfile(member, io.BytesIO(data))
        output.seek(0)
        return output, cid, mid

    def test_containerd_manifest_and_classic_image_bind_identical_config(self):
        classic, expected, _ = self.graph(classic=True)
        native, _, manifest = self.graph()
        self.assertNotEqual(manifest, expected)
        self.assertEqual(self.transport.config_identity(classic, self.tag, expected), expected)
        self.assertEqual(self.transport.config_identity(native, self.tag, manifest), expected)

    def test_wrong_native_config_or_mutable_release_tag_refuses(self):
        for change in ("wrong_config", "extra_tag"):
            native, _, manifest = self.graph(**{change:True})
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.transport.config_identity(native, self.tag, manifest)



class OperatorInstallationEvidence(unittest.TestCase):
    def test_original_operator_install_is_visible_and_replays_are_excluded(self):
        spec = spec_from_file_location("window_doors", root / "server/scripts/engine-release-window-doors.py")
        doors = module_from_spec(spec)
        spec.loader.exec_module(doors)
        original = dict(id=7, event="repository_dispatch", actor={"type": "User"},
                        run_attempt=1, head_branch="main", created_at="2026-11-09T09:35:00Z",
                        display_title="Original operator daily preparation")
        job = dict(name=doors.INSTALL_JOB, status="completed", conclusion="success", html_url="receipt")
        for actor, attempt, visible in (("User", 1, True), ("Bot", 1, False), ("User", 2, False)):
            row = dict(original, actor={"type": actor}, run_attempt=attempt)
            with self.subTest(actor=actor, attempt=attempt), patch.dict(os.environ, {}, clear=True), patch.object(
                doors, "github", side_effect=[{"total_count":1, "workflow_runs": [row]}, {"jobs": [job]}]
            ):
                result = doors.install_state(datetime(2026, 11, 9, 10, tzinfo=timezone.utc))
                self.assertEqual(result is not None, visible)

if __name__ == "__main__":
    unittest.main()
