#!/usr/bin/env python3
"""Unit and regression tests for scripts/operations/verify_phase5_completion_and_daily_restoration.py."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "operations"))

import verify_phase5_completion_and_daily_restoration as verifier  # noqa: E402


def make_schedule_transition_snapshot() -> dict:
    return {
        "current_policy": {
            "schema": "engine-maintenance-schedule/v1",
            "policyId": "phase1-hourly-01a1944f",
            "timeZone": "America/Chicago",
            "phase1Status": "active",
            "ownerMessageId": "01a1944f-7131-7f11-8dcc-873d576e781c",
            "completionEvidence": None,
        },
        "candidate_policy": verifier.build_completed_schedule_policy(
            "Phase 1-4 live engine SEALED, v3 thaw, 140 settlements, and Attention14 closure verified"
        ),
        "prerequisites": {
            "sealed_non_eed_engine": True,
            "sealed_engine_sha": "26aaaa3f350ca063caed717b5fcbbcf34b5ae702",
            "full_v3_thaw": True,
            "all_140_owner_retirements_completed": True,
            "v4_equal_share_receipt_count": 0,
            "attention14_metadata_closed": True,
        },
        "serving_hourly_health": {
            "releaseSha": "26aaaa3f350ca063caed717b5fcbbcf34b5ae702",
            "running": True,
            "maintenance": {
                "schedule": {
                    "timeZone": "America/Chicago",
                    "frequency": "phase1-hourly",
                    "policyId": "phase1-hourly-01a1944f",
                    "startHour": None,
                    "startMinute": 0,
                    "durationMs": 300000,
                    "hourlyCashFreeze": True,
                }
            },
        },
        "post_restoration_daily_health": {
            "releaseSha": "9999999999999999999999999999999999999999",
            "running": True,
            "maintenance": {
                "schedule": {
                    "timeZone": "America/Chicago",
                    "frequency": "daily",
                    "policyId": "phase1-hourly-01a1944f",
                    "startHour": 4,
                    "startMinute": 0,
                    "durationMs": 300000,
                    "hourlyCashFreeze": False,
                }
            },
        },
    }


def make_attention14_closure_snapshot() -> dict:
    root_cause_text = (
        "Retained-hand pause gate and successor drain parked-edge deadlock froze SNG/MTT tables; "
        "fixed in PR #9183 and PR #9226 and terminally settled."
    )
    runtime_retirements = [
        {
            "tournament_id": tid,
            "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
            "runtime_retired": True,
            "artifact_sha256": "a" * 64,
            "canonical_receipt_md5": "b" * 32,
            "remaining_leases": 0,
        }
        for tid in verifier.ORIGINAL89_IDS
    ]
    original_events = []
    for target in verifier.OPERATIONAL_12_TARGETS:
        eid = int(target["event_id"])
        original_events.append({
            "event_id": eid,
            "tournament_id": target.get("tournament_id"),
            "source": target["source"],
            "alertname": target["alertname"],
            "payload_md5": target["payload_md5"],
            "root_cause": root_cause_text,
            "resolution": "Resolved via protected engine release and terminal tournament settlement.",
            "correction_ref": "PR #9183",
            "investigation_status": "historical" if eid == 312178 else "verified_fixed",
            "historical_deploy_failures_preserved": 19 if eid == 312178 else None,
        })

    incident_notes = []
    current33_members = []
    for inc in verifier.ORIGINAL33_INCIDENTS:
        iid = inc["id"]
        is_fin = iid != verifier.NONFINANCIAL_INCIDENT_ID
        if is_fin:
            incident_notes.append({
                "incident_id": iid,
                "current_member_snapshot_md5": "d" * 32,
                "root_cause": root_cause_text,
                "resolution": "All current financial source alerts and terminal tournament states verified.",
                "correction_ref": "PR #9183",
            })
        current33_members.append({
            "incident_id": iid,
            "source": inc["source"],
            "detected_at": inc["detected_at"],
            "financial_membership_applicable": is_fin,
            "status": "resolved",
            "closure_basis": "verified_remeasured" if not is_fin else "operator_resolved",
            "root_cause": root_cause_text,
            "resolution": "All current financial source alerts and terminal tournament states verified.",
            "correction_ref": "PR #9183",
            "occurrences": 5 if is_fin else 1,
            "current_events": 5 if is_fin else 1,
            "unproven_events": 0,
            "unresolved_events": 0,
            "all_current_sources_resolved": True if is_fin else None,
            "current_member_snapshot_md5": "d" * 32 if is_fin else None,
        })

    return {
        "incident_action_function_md5": verifier.EXPECTED_INCIDENT_ACTION_MD5,
        "overdue_unsettled_abort_targets": 0,
        "evidence_packet": {
            "ready": True,
            "engine": {
                "sha": "26aaaa3f350ca063caed717b5fcbbcf34b5ae702",
                "sealed_receipt_sha256": "1" * 64,
                "thaw_receipt_sha256": "2" * 64,
            },
            "funding_acceptance_sha256": "3" * 64,
            "runtime_retirements": runtime_retirements,
            "original_events": original_events,
            "incident_notes": incident_notes,
        },
        "all33_readback": {
            "oct31_projection": {
                "attention": 14,
                "attention_status": "reviewed",
                "generated_at": "2026-11-02T16:30:00Z",
            },
            "original212": {
                "expected": 212,
                "identity_valid": 212,
                "reviewed": 212,
                "unresolved": [],
            },
            "financial_member_incident_count": 32,
            "current33_count": 33,
            "current33_members": current33_members,
        },
    }


def make_worktree_cleanup_snapshot() -> dict:
    return {
        "worktree_path": "/Volumes/SmarterWork/agent-work/shared-capacity/tournament-freeze-and-delay-fix/club-arena",
        "scratch_paths": [
            "/Volumes/SmarterWork/agent-work/shared-capacity/tournament-freeze-and-delay-fix/npm-cache",
            "/Volumes/SmarterWork/agent-work/shared-capacity/tournament-freeze-and-delay-fix/swarm-batches",
        ],
        "pr_merged": True,
        "git_status_clean": True,
        "all_phases_verified_live": True,
    }


class VerifyPhase5CompletionTests(unittest.TestCase):
    def test_schedule_transition_valid_pass(self) -> None:
        snap = make_schedule_transition_snapshot()
        res = verifier.verify_schedule_transition(snap)
        self.assertTrue(res["ok"], res["errors"])
        self.assertEqual(res["resulting_frequency"], "daily")

    def test_schedule_transition_rejects_missing_prerequisites_or_short_evidence(self) -> None:
        snap = make_schedule_transition_snapshot()
        snap["prerequisites"]["all_140_owner_retirements_completed"] = False
        snap["prerequisites"]["v4_equal_share_receipt_count"] = 1
        snap["prerequisites"]["sealed_engine_sha"] = verifier.DAILY_BOOTSTRAP_SHA
        snap["candidate_policy"]["completionEvidence"] = "short"
        res = verifier.verify_schedule_transition(snap)
        self.assertFalse(res["ok"])
        joined = " | ".join(res["errors"])
        self.assertIn("all_140_owner_retirements_completed", joined)
        self.assertIn("v4_equal_share_receipt_count", joined)
        self.assertIn("sealed_engine_sha", joined)
        self.assertIn("completionEvidence", joined)

    def test_attention14_closure_valid_pass(self) -> None:
        snap = make_attention14_closure_snapshot()
        res = verifier.verify_attention14_closure(snap)
        self.assertTrue(res["ok"], res["errors"])
        self.assertEqual(res["original89_retired"], 89)
        self.assertEqual(res["original212_reviewed"], 212)
        self.assertEqual(res["original33_resolved"], 33)
        self.assertEqual(res["operational12_verified"], 12)

    def test_attention14_closure_detects_aged_out_unverified_and_phone_312179_mutation(self) -> None:
        snap = make_attention14_closure_snapshot()
        snap["all33_readback"]["current33_members"][0]["closure_basis"] = "aged_out_unverified"
        snap["all33_readback"]["current33_members"][0]["all_current_sources_resolved"] = False
        snap["evidence_packet"]["incident_notes"][0]["current_member_snapshot_md5"] = "e" * 32
        snap["evidence_packet"]["original_events"][0]["event_id"] = 312179
        snap["all33_readback"]["oct31_projection"]["attention_status"] = "critical"
        snap["overdue_unsettled_abort_targets"] = 2
        res = verifier.verify_attention14_closure(snap)
        self.assertFalse(res["ok"])
        joined = " | ".join(res["errors"])
        self.assertIn("aged_out_unverified", joined)
        self.assertIn("all_current_sources_resolved", joined)
        self.assertIn("incident_notes.current_member_snapshot_md5", joined)
        self.assertIn("312179", joined)
        self.assertIn("attention_status", joined)
        self.assertIn("overdue_unsettled_abort_targets", joined)

    def test_worktree_cleanup_readiness_enforces_ssd_prefix_and_merged_clean_state(self) -> None:
        snap = make_worktree_cleanup_snapshot()
        res = verifier.verify_worktree_cleanup_readiness(snap)
        self.assertTrue(res["ok"], res["errors"])
        self.assertTrue(res["eligible_for_removal"])

        bad = make_worktree_cleanup_snapshot()
        bad["worktree_path"] = "/Users/smarter.poker/Documents/.agent-trees/bad"
        bad["pr_merged"] = False
        bad["all_phases_verified_live"] = False
        res_bad = verifier.verify_worktree_cleanup_readiness(bad)
        self.assertFalse(res_bad["ok"])
        joined = " | ".join(res_bad["errors"])
        self.assertIn("/Volumes/SmarterWork/agent-work/", joined)
        self.assertIn("pr_merged", joined)
        self.assertIn("all_phases_verified_live", joined)

    def test_cli_all_three_modes_exit_zero(self) -> None:
        script_path = REPO_ROOT / "scripts" / "operations" / "verify_phase5_completion_and_daily_restoration.py"
        with tempfile.TemporaryDirectory() as tmpdir:
            for mode, payload in (
                ("schedule-transition", make_schedule_transition_snapshot()),
                ("attention14-closure", make_attention14_closure_snapshot()),
                ("worktree-cleanup", make_worktree_cleanup_snapshot()),
            ):
                p = Path(tmpdir) / f"{mode}.json"
                p.write_text(json.dumps(payload), encoding="utf-8")
                proc = subprocess.run(
                    [sys.executable, "-B", str(script_path), "--mode", mode, "--input", str(p)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(proc.returncode, 0, proc.stderr or proc.stdout)


if __name__ == "__main__":
    unittest.main()
