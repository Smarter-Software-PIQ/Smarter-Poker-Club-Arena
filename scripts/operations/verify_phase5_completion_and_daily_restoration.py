#!/usr/bin/env python3
"""Phase 5 of 5 verifier: Daily 04:00 America/Chicago schedule policy restoration,
Attention14 metadata closure (14/212/33 + 12 operational targets), and SSD worktree cleanup.

Supports three verification modes:
  1. `schedule-transition`: Verifies that `maintenanceSchedulePolicy.json` transitions cleanly
     from `phase1Status = 'active'` (`completionEvidence = null`) to `phase1Status = 'complete'`
     (or `'off'`) with a non-empty `completionEvidence` (>= 12 chars) only when all live Phase 1–4
     prerequisites (`sealed_non_eed_engine`, `full_v3_thaw`, `all_assigned_events_settled`,
     `attention14_metadata_closed`) are satisfied, and verifies the resulting `daily-restoration`
     -> permanent `04:00` America/Chicago daily schedule contract (`startHour = 4`, `startMinute = 0`,
     `durationMs = 300000`, `hourlyCashFreeze = False`).
  2. `attention14-closure`: Verifies the Attention14 (`2026-10-31`) metadata closure invariants:
     - All 89 `original89` tournaments terminally settled with `0` active leases (`remaining_leases = 0`)
       and `runtime_retired = True`,
     - Global overdue `tournament_abort_targets` (`settled_at IS NULL AND requested_at < now - 30m`) = `0`,
     - All `212` `original212` critical alert events identity-valid (`identity_valid = 212`) and reviewed
       (`reviewed = 212`, `unresolved = []`),
     - All `12` operational target events (`307351`, `312168..312177`, `312178`) verified with exact
       source/alertname/payload MD5, root_cause >= 40 chars, non-empty resolution, valid correction_ref,
       and `312178` preserving `historical_deploy_failures_preserved = 19` (while `312179` remains untouched),
     - All `33` `original33` drift incidents (`32` `financial_alerts:*` + `1` non-financial `e84174e9-8f7c-4eea-b623-40a729b4914a`)
       resolved (`status = 'resolved'`, `closure_basis != 'aged_out_unverified'`, `all_current_sources_resolved = True`
       on all 32 financial incidents, `unproven_events = 0`, `unresolved_events = 0`),
     - `oct31_projection` (`fn_sp_daily_digest('2026-10-31', false)`) preserving historical counts with
       `attention_status = 'reviewed'` (or `'ok'`) and `0` unreviewed critical items.
  3. `worktree-cleanup`: Verifies that a task-owned SSD worktree is eligible for `git worktree remove`
     and scratch/cache deletion only after its branch is merged into `origin/main` (or explicitly
     abandoned), `git status --porcelain` is clean (`0` untracked/modified files), and the target path
     is strictly inside `/Volumes/SmarterWork/agent-work/` (never touching another task's folder).
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any, Mapping, Sequence

SCHEDULE_POLICY_SCHEMA = "engine-maintenance-schedule/v1"
SCHEDULE_POLICY_ID = "phase1-hourly-01a1944f"
SCHEDULE_TIME_ZONE = "America/Chicago"
SCHEDULE_OWNER_MESSAGE_ID = "01a1944f-7131-7f11-8dcc-873d576e781c"
DAILY_BOOTSTRAP_SHA = "eed06fe51dea622069c661a6213d5b031ff3a9e3"
EXPECTED_INCIDENT_ACTION_MD5 = "70eadd497ba5ecbd46e61e4f3bb4e6cb"
NONFINANCIAL_INCIDENT_ID = "e84174e9-8f7c-4eea-b623-40a729b4914a"
UNTOUCHED_PHONE_EVENT_ID = 312179

CORRECTION_REF_RE = re.compile(
    r"^(migration\s+\S|PR\s*#\d|chip_ledger\s+\S|correction:\S|(ruling:|verified:|no-change-needed:)\s*\S)",
    re.IGNORECASE,
)
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA64_RE = re.compile(r"^[0-9a-f]{64}$")
MD5_RE = re.compile(r"^[0-9a-f]{32}$")

ORIGINAL89_IDS: tuple[str, ...] = (
    "095d7449-3282-46c5-8a39-768fe14dce5a",
    "0cb8e80f-4031-4b72-bbd6-f076605f1575",
    "0d98f87e-65bb-483c-b34d-0cc6af4a4e29",
    "0ef3dbfb-c092-4008-b7bd-bde65a474e83",
    "10146b16-aaac-4606-a2aa-7bbc3863b750",
    "112ea67a-3885-4755-84cc-5f8523d3f82c",
    "120ffb44-a3e6-4691-a52c-450768a09056",
    "1294ab27-2191-484c-aa3e-98192de09e44",
    "135b187e-c096-483a-b347-10be69df956b",
    "15202cb0-648c-4583-a6f9-9512a6e678c6",
    "19349646-5d29-4e79-a65d-c01be5c0a7e6",
    "197ed0bd-8fdb-4897-b001-dfe902139f9c",
    "19cf1192-d926-4042-a13c-67eca5ebf9a3",
    "2305ddd2-58af-43fb-9089-567108e4ca77",
    "26ebb662-63bf-4bc5-9ac8-962bc5ad8849",
    "2781bcd7-cc8a-4713-ab3e-0d0a81fdf110",
    "27b49998-863d-44f7-8f11-f38d4de476b8",
    "30bac12f-028e-4d05-841a-9c900c779850",
    "369d46bd-1eba-44bf-a80f-fb19ec980614",
    "3859e739-513e-4ed5-af23-5a190aa40f46",
    "4163a647-780e-4a5e-910f-ccc0fe5cf218",
    "45072749-ed7a-4e27-9891-f21cdd44a20a",
    "46ba2e7c-c9f8-42b6-b416-d7342a676531",
    "4b7f3840-cc55-49b7-acd0-57216a89d044",
    "4d88fc8c-a6d7-4e93-8cb6-ac45acb4e35d",
    "4dfe400c-c942-41df-9e6b-bbd8336c9cf7",
    "4e2cc712-8773-4d00-8927-6319153bddf4",
    "551125c0-4129-4f28-b174-caedb576cd99",
    "5638ff13-7d12-4a54-b784-4f309792db60",
    "5a3e686c-8a9e-4c7c-b2c3-829c6a1ce096",
    "5ef9868a-03d3-4d3b-bc92-41c63bd8b10c",
    "6379b29e-1307-4e8b-91e7-e9a0975cd64d",
    "6429087f-a9d1-49a3-b7cf-85e1ee283ac9",
    "64599cc4-03bb-4f1d-8df7-ef610abe10af",
    "68af0f95-82f5-4047-b424-6780a4236f4d",
    "6acde8fb-5631-4320-965d-bf9dbf01c4d8",
    "6c6724e5-1ee4-40c0-ad21-44e9f9b6d800",
    "6d047305-e5ac-4200-803f-399c83cf76f3",
    "6f25fd3f-b96a-40be-b32b-e9f8a39c22e8",
    "768cb55b-e915-4a01-9c74-f97535f700a3",
    "7850aedc-640b-4905-b9e1-61d75d9543d0",
    "78ed8458-4ffd-416a-a8fd-d0f0c5e3509e",
    "7932d2bb-7cfb-4b0e-ae99-75fcbae82d52",
    "7986217a-0a67-4585-bd43-254356a9cb54",
    "7ab02286-fa29-44a2-a64f-0cb3d60ca572",
    "7de6c45c-ac37-4c32-a22a-4faea11d6cfa",
    "80861496-ee6c-498e-bae4-4d6acd8381c2",
    "8229a0af-3c5a-4672-b9df-3d8523613086",
    "85bec2f4-0aa8-42b8-8799-d9d3acff2275",
    "8855c50e-c4ed-4235-91c1-323627023b15",
    "8aae8210-0444-455f-97f6-19a3a072eda0",
    "8d8a5ecf-29c6-49e7-82fa-3109b6681fb6",
    "90fc40a9-0f76-4835-a1e9-5c487f32b2c8",
    "928dc47d-14b8-4721-9990-a5ccfd57a41e",
    "94beb183-6b2a-4dbf-b1ea-556bf9681124",
    "95760eed-827d-4502-8be6-cfb8ec610e1b",
    "962cb5ce-3255-4ac3-9672-769752b4d169",
    "9b0e7b08-17ad-46ad-be00-9745f788cdd3",
    "9b23a2ec-d514-457f-ac61-fc80722068ad",
    "a3e9d95e-9f0a-4b6b-9652-f6c697baadac",
    "b2870f16-db00-4820-a2d7-b5fc76e627ab",
    "b6435b76-7225-4d40-87fe-52f3a9d4521e",
    "b67b1975-f8cb-417b-87f9-9910c8290178",
    "b8484257-68b3-4961-aad3-4b096bb7c7b5",
    "bab7002d-4e6c-4845-a6e0-af16a35a70cc",
    "be27c5a4-8282-4dd1-8881-fe1145a94b5e",
    "bed32f92-c2e5-485e-aa90-5ff62bdfd325",
    "bf050b4a-afd3-43d4-82f4-5eab0983d490",
    "bfad9be3-52f8-4f08-863b-cb8790ab4b75",
    "c2835ddc-d3b6-4b91-9e1b-895028435b3c",
    "c48b7118-a0e5-4b33-98df-79dcf29f15af",
    "c685ebb7-954d-4a38-a26d-9c23c23600a4",
    "cc73fe07-8ab2-4282-9ba6-633563de2fec",
    "d110fd05-846e-46c1-adca-a2e515e95144",
    "d4fe7c06-14eb-4ded-a2fd-07a57559f2dd",
    "d8b96746-98a8-444f-a779-76904bbca946",
    "dbaca4cd-8959-427d-8b91-2d97310e6fd6",
    "dcffef19-4c19-4c5a-b433-d043d3641bc9",
    "deaa61a7-0553-4c81-a178-e9ba822a1ba2",
    "debf5e04-6f4d-4858-88a0-84b6fe1ba598",
    "e507f99a-fc33-45f7-9f7a-60f2793d3876",
    "e9e505d4-13ed-48ee-b7bf-1bdbb28cc8f2",
    "eb916895-36f9-49e9-a364-486ad4555744",
    "ef75f627-1f29-4729-97cd-9988495b49f1",
    "f55d1faf-380b-4aeb-a0bf-e0151531dab5",
    "fac51189-3bcc-4bd6-b5b5-34316c034edb",
    "fcb7f99f-b43e-4043-88ad-4ed13c17d40a",
    "fdfcadfd-4044-4696-874d-5ec50cf93a48",
    "fe9145bb-acc1-4a51-97d1-e473d3c39c6e",
)

ORIGINAL33_INCIDENTS: tuple[dict[str, str], ...] = (
    {"id": "00f496ba-2a7e-4959-8309-079c5084273e", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 06:58:46.812171+00"},
    {"id": "047fd255-9cdb-4185-9d82-d1f7fc512a3c", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 10:48:53.704883+00"},
    {"id": "16ff284f-ba37-4a3c-a760-133b6fd23cb5", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:02:21.274676+00"},
    {"id": "18d53f01-4e20-42bb-a231-1384be59fca3", "source": "financial_alerts:fn_ca_tournament_dark_while_running", "detected_at": "2026-10-29 10:03:00.237626+00"},
    {"id": "1a672a3d-ab07-457c-a561-adc4698a6ab7", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 21:23:25.401394+00"},
    {"id": "31800ee2-8711-4e54-a01f-041c111c4311", "source": "financial_alerts:Tournament.table_admission_failing", "detected_at": "2026-10-29 09:43:51.789937+00"},
    {"id": "35da295b-24fb-49a8-8cc0-4accb36e930c", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:02:21.71997+00"},
    {"id": "37edc9f2-a9b2-40d7-aa6c-c30441142d80", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:04:12.678125+00"},
    {"id": "40442fe8-f3f2-4ec9-ad97-c1c290fbe027", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:04:23.622733+00"},
    {"id": "4975e4f3-47ff-403d-81da-08f6079573a3", "source": "financial_alerts:Tournament.satellite_qualifiers_refused_repeatedly", "detected_at": "2026-10-31 22:23:49.047089+00"},
    {"id": "4f6fc811-535d-408b-a14e-3052321d7fca", "source": "financial_alerts:fn_ca_tournament_dark_while_running", "detected_at": "2026-10-29 06:23:00.201282+00"},
    {"id": "5567e42c-be41-494f-862c-466d8b8781d1", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 17:47:39.760844+00"},
    {"id": "573c97e2-3822-4c72-8638-751690c18fce", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:04:15.32831+00"},
    {"id": "5e42ef20-e4d8-4426-9b8f-9ed17ab68bfe", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 06:58:47.806331+00"},
    {"id": "5f0f542c-9055-46f1-a9fc-e72c5ba0954c", "source": "financial_alerts:Tournament.table_admission_failing", "detected_at": "2026-10-29 07:09:04.400548+00"},
    {"id": "5f46888f-d92e-460e-ae25-4fcda1ed9468", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:04:24.360599+00"},
    {"id": "6725913d-55dd-490f-adfe-16dbbc4304a4", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 06:58:47.512886+00"},
    {"id": "76bbe308-3ec0-4466-be75-40b4d1711f23", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:02:18.357677+00"},
    {"id": "7cd851e3-3b77-46d9-afc0-995c0cdc9fe8", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:02:23.973921+00"},
    {"id": "7e0d6e0f-955c-4480-b894-4f67e03c7fe6", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 17:47:39.397044+00"},
    {"id": "834b63a8-45c5-4040-a5e0-94bdff2165bb", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 22:48:28.253362+00"},
    {"id": "8593b909-9b94-4006-a067-41dd377327e8", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 21:54:56.44832+00"},
    {"id": "873e834a-16cb-4b7e-b45f-722e12d7c09e", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 06:58:47.217387+00"},
    {"id": "87dd6aee-7da2-4943-b6cd-0d2c2323cdd4", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:04:13.531672+00"},
    {"id": "8f93292b-4409-4e98-a93c-6f9e6e1cc3a5", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-30 00:01:10.562975+00"},
    {"id": "952e9dfe-da36-4fcd-89cb-937caab0ce41", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 10:46:32.855001+00"},
    {"id": "99418680-2bbc-4de8-8c3c-0689c15c2b0b", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 18:17:51.299649+00"},
    {"id": "acee21f0-2eec-451d-83b1-2144e798cd51", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:02:23.066878+00"},
    {"id": "bdc4f700-7e1a-484f-988d-a81f15d4e0a8", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:04:27.815695+00"},
    {"id": "cce638c4-7b96-4726-a2ff-b951413a472c", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:02:27.440349+00"},
    {"id": "d91377ad-0bf6-4d4d-8794-d72cfe087fc0", "source": "financial_alerts:Tournament.table_admission_failing", "detected_at": "2026-10-29 19:58:26.97874+00"},
    {"id": "dfd9166c-e4a7-4128-9853-ffc6837dc14d", "source": "financial_alerts:GameServer.tournament_dark_after_rebuild", "detected_at": "2026-10-29 07:04:19.130283+00"},
    {"id": "e84174e9-8f7c-4eea-b623-40a729b4914a", "source": "fn_ca_settlement_correctness_check:settler_lag", "detected_at": "2026-10-31 02:15:00.282843+00"},
)
ORIGINAL33_BY_ID: dict[str, dict[str, str]] = {row["id"]: row for row in ORIGINAL33_INCIDENTS}

OPERATIONAL_12_TARGETS: tuple[dict[str, Any], ...] = (
    {
        "event_id": 307351,
        "source": "ca-stall-watch",
        "alertname": "TournamentStopNotSettled",
        "payload_md5": "2654c086f04dd7a3c11ee205d506df48",
    },
    {
        "event_id": 312168,
        "tournament_id": "94beb183-6b2a-4dbf-b1ea-556bf9681124",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "42e36162d14a480b1671b73e715690b6",
    },
    {
        "event_id": 312169,
        "tournament_id": "9b0e7b08-17ad-46ad-be00-9745f788cdd3",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "88477d0c048c3044f0f4492dea5213e9",
    },
    {
        "event_id": 312170,
        "tournament_id": "4b7f3840-cc55-49b7-acd0-57216a89d044",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "52d492fd3178a06a4bde65d66c807c2c",
    },
    {
        "event_id": 312171,
        "tournament_id": "6d047305-e5ac-4200-803f-399c83cf76f3",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "16c7777a0a6528563a8f63a92f9625a2",
    },
    {
        "event_id": 312172,
        "tournament_id": "bf050b4a-afd3-43d4-82f4-5eab0983d490",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "79fb439bc732cc17d6fc59d4867318b0",
    },
    {
        "event_id": 312173,
        "tournament_id": "fac51189-3bcc-4bd6-b5b5-34316c034edb",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "1602a58b525a3012e3269c57dbb07a19",
    },
    {
        "event_id": 312174,
        "tournament_id": "4d88fc8c-a6d7-4e93-8cb6-ac45acb4e35d",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "b2ca1f8bb37be05cac1b12fb2f1b35f6",
    },
    {
        "event_id": 312175,
        "tournament_id": "c2835ddc-d3b6-4b91-9e1b-895028435b3c",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "9bae13c8a26bc1bd5ed935164238a2b8",
    },
    {
        "event_id": 312176,
        "tournament_id": "bfad9be3-52f8-4f08-863b-cb8790ab4b75",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "f29f261f7a74bef837070a1df2c00a3c",
    },
    {
        "event_id": 312177,
        "tournament_id": "15202cb0-648c-4583-a6f9-9512a6e678c6",
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.stuck_tournament",
        "payload_md5": "81ac90bdd7f0cc456d871ea16d991128",
    },
    {
        "event_id": 312178,
        "source": "sp-daily-digest",
        "alertname": "DailyDigest.deploy_failed",
        "payload_md5": "462a8b6bddb8f9fc643aaac31aa4b776",
    },
)
OPERATIONAL_12_BY_ID: dict[int, dict[str, Any]] = {int(t["event_id"]): t for t in OPERATIONAL_12_TARGETS}


def build_completed_schedule_policy(completion_evidence: str, status: str = "complete") -> dict[str, Any]:
    """Build the canonical `maintenanceSchedulePolicy.json` payload for restoring daily 04:00 Chicago."""
    if status not in ("complete", "off"):
        raise ValueError(f"Invalid restoration status: {status}")
    if not isinstance(completion_evidence, str) or len(completion_evidence.strip()) < 12:
        raise ValueError("completionEvidence must be a string of at least 12 characters")
    return {
        "schema": SCHEDULE_POLICY_SCHEMA,
        "policyId": SCHEDULE_POLICY_ID,
        "timeZone": SCHEDULE_TIME_ZONE,
        "phase1Status": status,
        "ownerMessageId": SCHEDULE_OWNER_MESSAGE_ID,
        "completionEvidence": completion_evidence.strip(),
    }


def validate_schedule_policy_document(policy: Mapping[str, Any]) -> list[str]:
    """Validate `maintenanceSchedulePolicy.json` against both `maintenanceSchedule.ts` and `engine-release-seal.py`."""
    errors: list[str] = []
    expected_keys = {
        "schema",
        "policyId",
        "timeZone",
        "phase1Status",
        "ownerMessageId",
        "completionEvidence",
    }
    if set(policy.keys()) != expected_keys:
        errors.append(f"Policy keys mismatch: expected {sorted(expected_keys)}, got {sorted(policy.keys())}")
    if policy.get("schema") != SCHEDULE_POLICY_SCHEMA:
        errors.append(f"schema must be {SCHEDULE_POLICY_SCHEMA!r}")
    if policy.get("policyId") != SCHEDULE_POLICY_ID:
        errors.append(f"policyId must be {SCHEDULE_POLICY_ID!r}")
    if policy.get("timeZone") != SCHEDULE_TIME_ZONE:
        errors.append(f"timeZone must be {SCHEDULE_TIME_ZONE!r}")
    if policy.get("ownerMessageId") != SCHEDULE_OWNER_MESSAGE_ID:
        errors.append(f"ownerMessageId must be {SCHEDULE_OWNER_MESSAGE_ID!r}")

    status = policy.get("phase1Status")
    evidence = policy.get("completionEvidence")
    if status not in ("active", "complete", "off"):
        errors.append(f"phase1Status must be 'active', 'complete', or 'off', got {status!r}")
    elif status == "active":
        if evidence is not None:
            errors.append("completionEvidence must be null when phase1Status is 'active'")
    else:
        if not isinstance(evidence, str) or len(evidence.strip()) < 12:
            errors.append("completionEvidence must be a non-empty string >= 12 chars when phase1Status is 'complete' or 'off'")
    return errors


def verify_schedule_transition(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Verify the Phase 5 schedule policy transition and daily 04:00 Chicago restoration contract."""
    errors: list[str] = []

    current_policy = snapshot.get("current_policy")
    candidate_policy = snapshot.get("candidate_policy")
    prereqs = snapshot.get("prerequisites", {})
    restoration_health = snapshot.get("serving_hourly_health", {})
    post_restoration_health = snapshot.get("post_restoration_daily_health", {})

    if not isinstance(current_policy, Mapping):
        errors.append("current_policy must be an object")
    else:
        errors.extend(validate_schedule_policy_document(current_policy))
        if current_policy.get("phase1Status") != "active":
            errors.append("current_policy.phase1Status must be 'active' before transition")

    if not isinstance(candidate_policy, Mapping):
        errors.append("candidate_policy must be an object")
    else:
        errors.extend(validate_schedule_policy_document(candidate_policy))
        if candidate_policy.get("phase1Status") not in ("complete", "off"):
            errors.append("candidate_policy.phase1Status must be 'complete' or 'off' for daily restoration")

    # Verify all Phase 1-4 live prerequisites are met before authorizing transition commit
    required_prereq_flags = (
        "sealed_non_eed_engine",
        "full_v3_thaw",
        "all_140_owner_retirements_completed",
        "attention14_metadata_closed",
    )
    for flag in required_prereq_flags:
        if prereqs.get(flag) is not True:
            errors.append(f"Prerequisite {flag!r} is not satisfied (got {prereqs.get(flag)!r})")
    if prereqs.get("v4_equal_share_receipt_count", 0) != 0:
        errors.append(
            f"Prerequisite 'v4_equal_share_receipt_count' must be 0 (equal-share plan is revoked), got {prereqs.get('v4_equal_share_receipt_count')!r}"
        )

    engine_sha = str(prereqs.get("sealed_engine_sha", ""))
    if not SHA40_RE.fullmatch(engine_sha) or engine_sha == DAILY_BOOTSTRAP_SHA:
        errors.append(f"sealed_engine_sha must be a 40-hex non-eed06fe5 commit, got {engine_sha!r}")

    # Verify cmd_restoration_needed eligibility on serving hourly engine
    if isinstance(restoration_health, Mapping) and restoration_health:
        sched = (restoration_health.get("maintenance") or {}).get("schedule") or {}
        serving_sha = str(restoration_health.get("releaseSha", ""))
        if not SHA40_RE.fullmatch(serving_sha) or serving_sha == DAILY_BOOTSTRAP_SHA:
            errors.append(f"serving_hourly_health.releaseSha must be a 40-hex non-eed06fe5 SHA, got {serving_sha!r}")
        if (
            restoration_health.get("running") is not True
            or sched.get("timeZone") != SCHEDULE_TIME_ZONE
            or sched.get("frequency") != "phase1-hourly"
            or sched.get("policyId") != SCHEDULE_POLICY_ID
            or sched.get("startHour") is not None
            or sched.get("startMinute") != 0
            or sched.get("durationMs") != 300000
            or sched.get("hourlyCashFreeze") is not True
        ):
            errors.append("serving_hourly_health does not satisfy cmd_restoration_needed predicates")

    # Verify post-restoration daily 04:00 Chicago health contract
    if isinstance(post_restoration_health, Mapping) and post_restoration_health:
        sched_after = (post_restoration_health.get("maintenance") or {}).get("schedule") or {}
        post_sha = str(post_restoration_health.get("releaseSha", ""))
        if not SHA40_RE.fullmatch(post_sha) or post_sha == DAILY_BOOTSTRAP_SHA:
            errors.append(f"post_restoration_daily_health.releaseSha must be a 40-hex non-eed06fe5 SHA, got {post_sha!r}")
        if (
            isinstance(restoration_health, Mapping)
            and restoration_health.get("releaseSha")
            and post_sha == str(restoration_health.get("releaseSha"))
        ):
            errors.append("post_restoration_daily_health.releaseSha must differ from serving_hourly_health.releaseSha")
        if (
            post_restoration_health.get("running") is not True
            or sched_after.get("timeZone") != SCHEDULE_TIME_ZONE
            or sched_after.get("frequency") != "daily"
            or sched_after.get("startHour") != 4
            or sched_after.get("startMinute") != 0
            or sched_after.get("durationMs") != 300000
            or sched_after.get("hourlyCashFreeze") is not False
        ):
            errors.append("post_restoration_daily_health does not match permanent 04:00 Chicago daily schedule")

    candidate_digest = (
        hashlib.sha256(json.dumps(candidate_policy, sort_keys=True).encode("utf-8")).hexdigest()
        if isinstance(candidate_policy, Mapping)
        else ""
    )
    return {
        "ok": len(errors) == 0,
        "mode": "schedule-transition",
        "resulting_frequency": "daily" if not errors else "unverified",
        "candidate_policy_sha256": candidate_digest,
        "errors": errors,
    }


def verify_attention14_closure(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Verify the Attention14 (`2026-10-31`) metadata closure packet and post-closure readback."""
    errors: list[str] = []

    evidence = snapshot.get("evidence_packet", {})
    readback = snapshot.get("all33_readback", {})

    if evidence.get("ready") is not True:
        errors.append("evidence_packet.ready must be True")

    eng = evidence.get("engine", {})
    eng_sha = str(eng.get("sha", ""))
    if not SHA40_RE.fullmatch(eng_sha) or eng_sha == DAILY_BOOTSTRAP_SHA:
        errors.append(f"evidence_packet.engine.sha must be a 40-hex non-eed06fe5 SHA, got {eng_sha!r}")
    if not SHA64_RE.fullmatch(str(eng.get("sealed_receipt_sha256", ""))):
        errors.append("evidence_packet.engine.sealed_receipt_sha256 must be 64-hex SHA256")
    if not SHA64_RE.fullmatch(str(eng.get("thaw_receipt_sha256", ""))):
        errors.append("evidence_packet.engine.thaw_receipt_sha256 must be 64-hex SHA256")
    if not SHA64_RE.fullmatch(str(evidence.get("funding_acceptance_sha256", ""))):
        errors.append("evidence_packet.funding_acceptance_sha256 must be 64-hex SHA256")

    if str(snapshot.get("incident_action_function_md5", EXPECTED_INCIDENT_ACTION_MD5)) != EXPECTED_INCIDENT_ACTION_MD5:
        errors.append(f"fn_ca_incident_action MD5 mismatch: expected {EXPECTED_INCIDENT_ACTION_MD5}")
    if int(snapshot.get("overdue_unsettled_abort_targets", -1)) != 0:
        errors.append("global overdue_unsettled_abort_targets must be 0")
    if int(snapshot.get("v4_equal_share_receipt_count", 0)) != 0:
        errors.append("v4_equal_share_receipt_count must be 0 (equal-share plan is revoked)")
    if int(snapshot.get("owner_retirement_140_retired_count", 140)) != 140:
        errors.append("owner_retirement_140_retired_count must be 140")

    # 1. Verify all 89 original89 runtime retirements and terminal receipts/absent leases
    retirements = evidence.get("runtime_retirements")
    if not isinstance(retirements, list) or len(retirements) != 89:
        errors.append(f"runtime_retirements must contain 89 entries, got {len(retirements) if isinstance(retirements, list) else 'non-list'}")
    else:
        seen_tids: set[str] = set()
        for r in retirements:
            tid = str(r.get("tournament_id", ""))
            seen_tids.add(tid)
            if tid not in ORIGINAL89_IDS:
                errors.append(f"Unexpected tournament_id in runtime_retirements: {tid}")
            if str(r.get("operation_id", "")) != "d44c4440-2911-430c-8ee7-376611ef3f38":
                errors.append(f"Original89 event {tid} operation_id must be d44c4440-2911-430c-8ee7-376611ef3f38")
            if r.get("runtime_retired") is not True:
                errors.append(f"Original89 event {tid} runtime_retired must be True")
            if not SHA64_RE.fullmatch(str(r.get("artifact_sha256", ""))):
                errors.append(f"Original89 event {tid} missing 64-hex artifact_sha256")
            if not MD5_RE.fullmatch(str(r.get("canonical_receipt_md5", ""))):
                errors.append(f"Original89 event {tid} missing 32-hex canonical_receipt_md5")
            if int(r.get("remaining_leases", 0)) != 0:
                errors.append(f"Original89 event {tid} still has remaining_leases")
        if seen_tids != set(ORIGINAL89_IDS):
            errors.append(f"runtime_retirements tournament_id set mismatch: missing {len(set(ORIGINAL89_IDS) - seen_tids)}")

    # 2. Verify exact 12 operational_alert_events target notes (and untouched 312179)
    orig_events = evidence.get("original_events")
    if not isinstance(orig_events, list) or len(orig_events) != 12:
        errors.append(f"original_events must contain 12 entries, got {len(orig_events) if isinstance(orig_events, list) else 'non-list'}")
    else:
        seen_eids: set[int] = set()
        for note in orig_events:
            eid = int(note.get("event_id", -1))
            seen_eids.add(eid)
            if eid == UNTOUCHED_PHONE_EVENT_ID:
                errors.append("Event 312179 (phone alert) must remain untouched")
            target_spec = OPERATIONAL_12_BY_ID.get(eid)
            if target_spec is None:
                errors.append(f"Unexpected operational event_id in original_events: {eid}")
                continue
            if str(note.get("source", "")) != target_spec["source"]:
                errors.append(f"Operational event {eid} source mismatch: expected {target_spec['source']!r}, got {note.get('source')!r}")
            if str(note.get("alertname", "")) != target_spec["alertname"]:
                errors.append(f"Operational event {eid} alertname mismatch: expected {target_spec['alertname']!r}, got {note.get('alertname')!r}")
            if str(note.get("payload_md5", "")) != target_spec["payload_md5"]:
                errors.append(f"Operational event {eid} payload_md5 mismatch: expected {target_spec['payload_md5']!r}, got {note.get('payload_md5')!r}")
            if "tournament_id" in target_spec and str(note.get("tournament_id", target_spec["tournament_id"])) != target_spec["tournament_id"]:
                errors.append(f"Operational event {eid} tournament_id mismatch: expected {target_spec['tournament_id']!r}")
            if len(str(note.get("root_cause", "")).strip()) < 40:
                errors.append(f"Operational event {eid} root_cause must be >= 40 chars")
            if not str(note.get("resolution", "")).strip():
                errors.append(f"Operational event {eid} resolution must be non-empty")
            if not CORRECTION_REF_RE.match(str(note.get("correction_ref", ""))):
                errors.append(f"Operational event {eid} invalid correction_ref: {note.get('correction_ref')!r}")
            expected_status = "historical" if eid == 312178 else "verified_fixed"
            if str(note.get("investigation_status", expected_status)) != expected_status:
                errors.append(f"Operational event {eid} investigation_status must be {expected_status!r}")
            if eid == 312178 and int(note.get("historical_deploy_failures_preserved", 19)) != 19:
                errors.append("Operational event 312178 must preserve historical_deploy_failures_preserved = 19")
        if seen_eids != set(OPERATIONAL_12_BY_ID.keys()):
            errors.append("original_events did not cover the exact 12 target event IDs")

    # 2b. Verify incident_notes (exact 32 financial-source incident witnesses) if supplied in evidence_packet
    inc_notes = evidence.get("incident_notes")
    inc_notes_by_id: dict[str, Mapping[str, Any]] = {}
    if inc_notes is not None:
        if not isinstance(inc_notes, list) or len(inc_notes) != 32:
            errors.append(f"incident_notes must contain 32 entries, got {len(inc_notes) if isinstance(inc_notes, list) else 'non-list'}")
        else:
            expected_fin_ids = {iid for iid in ORIGINAL33_BY_ID if iid != NONFINANCIAL_INCIDENT_ID}
            for n in inc_notes:
                niid = str(n.get("incident_id", ""))
                inc_notes_by_id[niid] = n
                if niid not in expected_fin_ids:
                    errors.append(f"Unexpected incident_id in incident_notes: {niid}")
                if not MD5_RE.fullmatch(str(n.get("current_member_snapshot_md5", ""))):
                    errors.append(f"Incident note {niid} missing 32-hex current_member_snapshot_md5")
                if len(str(n.get("root_cause", "")).strip()) < 40:
                    errors.append(f"Incident note {niid} root_cause must be >= 40 chars")
                if not str(n.get("resolution", "")).strip():
                    errors.append(f"Incident note {niid} resolution must be non-empty")
                if not CORRECTION_REF_RE.match(str(n.get("correction_ref", ""))):
                    errors.append(f"Incident note {niid} invalid correction_ref: {n.get('correction_ref')!r}")
            if set(inc_notes_by_id.keys()) != expected_fin_ids:
                errors.append("incident_notes did not cover all 32 financial incident IDs")

    # 3. Verify all33_readback: original212, current33_members (32 financial + 1 non-financial e841), and oct31_projection
    orig212 = readback.get("original212", {})
    if (
        int(orig212.get("expected", -1)) != 212
        or int(orig212.get("identity_valid", -1)) != 212
        or int(orig212.get("reviewed", -1)) != 212
        or (orig212.get("unresolved") not in ([], None))
    ):
        errors.append(
            f"original212 readback failed: expected=212, got identity_valid={orig212.get('identity_valid')}, reviewed={orig212.get('reviewed')}, unresolved={orig212.get('unresolved')}"
        )

    if int(readback.get("financial_member_incident_count", -1)) != 32:
        errors.append(f"financial_member_incident_count must be 32, got {readback.get('financial_member_incident_count')}")
    if int(readback.get("current33_count", -1)) != 33:
        errors.append(f"current33_count must be 33, got {readback.get('current33_count')}")

    members33 = readback.get("current33_members")
    if not isinstance(members33, list) or len(members33) != 33:
        errors.append("current33_members must be a list of 33 incident objects")
    else:
        seen_inc_ids: set[str] = set()
        for inc in members33:
            iid = str(inc.get("incident_id", ""))
            seen_inc_ids.add(iid)
            exp_inc = ORIGINAL33_BY_ID.get(iid)
            if exp_inc is None:
                errors.append(f"Unexpected incident_id in current33_members: {iid}")
                continue
            if str(inc.get("source", "")) != exp_inc["source"]:
                errors.append(f"Incident {iid} source mismatch: expected {exp_inc['source']}, got {inc.get('source')}")
            if str(inc.get("status", "")) != "resolved":
                errors.append(f"Incident {iid} status must be 'resolved', got {inc.get('status')}")
            if str(inc.get("closure_basis", "")) == "aged_out_unverified":
                errors.append(f"Incident {iid} closure_basis cannot be 'aged_out_unverified'")
            if len(str(inc.get("root_cause", "")).strip()) < 40:
                errors.append(f"Incident {iid} root_cause must be >= 40 chars")
            if not str(inc.get("resolution", "")).strip():
                errors.append(f"Incident {iid} resolution must be non-empty")
            if not CORRECTION_REF_RE.match(str(inc.get("correction_ref", ""))):
                errors.append(f"Incident {iid} invalid correction_ref: {inc.get('correction_ref')!r}")

            if iid == NONFINANCIAL_INCIDENT_ID:
                if inc.get("financial_membership_applicable") is not False:
                    errors.append(f"Non-financial incident {iid} must have financial_membership_applicable = False")
            else:
                if inc.get("financial_membership_applicable") is not True:
                    errors.append(f"Financial incident {iid} must have financial_membership_applicable = True")
                if inc.get("all_current_sources_resolved") is not True:
                    errors.append(f"Financial incident {iid} all_current_sources_resolved must be True")
                if int(inc.get("unproven_events", -1)) != 0 or int(inc.get("unresolved_events", -1)) != 0:
                    errors.append(f"Financial incident {iid} has unproven or unresolved member events")
                if int(inc.get("current_events", -1)) != int(inc.get("occurrences", -2)) or int(inc.get("current_events", 0)) < 1:
                    errors.append(f"Financial incident {iid} current_events != occurrences")
                if not MD5_RE.fullmatch(str(inc.get("current_member_snapshot_md5", ""))):
                    errors.append(f"Financial incident {iid} missing 32-hex current_member_snapshot_md5")
                elif iid in inc_notes_by_id and str(inc_notes_by_id[iid].get("current_member_snapshot_md5")) != str(inc.get("current_member_snapshot_md5")):
                    errors.append(f"Financial incident {iid} incident_notes.current_member_snapshot_md5 != readback.current_member_snapshot_md5")

        if seen_inc_ids != set(ORIGINAL33_BY_ID.keys()):
            errors.append("current33_members did not cover all 33 original incident IDs")

    oct31 = readback.get("oct31_projection", {})
    if "error" in oct31:
        errors.append(f"oct31_projection error: {oct31.get('error')}")
    else:
        if int(oct31.get("attention", -1)) != 14:
            errors.append(f"oct31_projection.attention must preserve historical 14, got {oct31.get('attention')}")
        if str(oct31.get("attention_status", "")) not in ("reviewed", "ok"):
            errors.append(f"oct31_projection.attention_status must be 'reviewed' or 'ok', got {oct31.get('attention_status')!r}")

    return {
        "ok": len(errors) == 0,
        "mode": "attention14-closure",
        "original89_retired": 89 if not errors else 0,
        "original212_reviewed": int(orig212.get("reviewed", 0)),
        "original33_resolved": len(members33) if isinstance(members33, list) else 0,
        "operational12_verified": len(orig_events) if isinstance(orig_events, list) else 0,
        "errors": errors,
    }


def verify_worktree_cleanup_readiness(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Verify SSD worktree cleanup safety before running `git worktree remove`."""
    errors: list[str] = []

    worktree_path = str(snapshot.get("worktree_path", ""))
    scratch_paths = snapshot.get("scratch_paths", [])
    pr_merged = snapshot.get("pr_merged")
    git_status_clean = snapshot.get("git_status_clean")
    all_phases_verified_live = snapshot.get("all_phases_verified_live")

    allowed_prefix = "/Volumes/SmarterWork/agent-work/"
    if not worktree_path.startswith(allowed_prefix) or worktree_path.rstrip("/") == allowed_prefix.rstrip("/"):
        errors.append(f"worktree_path must be a task-owned directory inside {allowed_prefix}, got {worktree_path!r}")

    if not isinstance(scratch_paths, list):
        errors.append("scratch_paths must be a list")
    else:
        for sp in scratch_paths:
            sp_str = str(sp)
            if not sp_str.startswith(allowed_prefix) or sp_str.rstrip("/") == allowed_prefix.rstrip("/"):
                errors.append(f"scratch_path {sp_str!r} is outside {allowed_prefix}")

    if pr_merged is not True:
        errors.append("pr_merged must be True before removing the owned worktree")
    if git_status_clean is not True:
        errors.append("git_status_clean must be True (0 uncommitted/untracked files) before removing worktree")
    if all_phases_verified_live is not True:
        errors.append("all_phases_verified_live must be True before final worktree removal")

    return {
        "ok": len(errors) == 0,
        "mode": "worktree-cleanup",
        "worktree_path": worktree_path,
        "eligible_for_removal": len(errors) == 0,
        "errors": errors,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("schedule-transition", "attention14-closure", "worktree-cleanup"),
        required=True,
    )
    parser.add_argument("--input", required=True, help="Path to JSON snapshot file (or '-' for stdin)")
    args = parser.parse_args(argv)

    if args.input == "-":
        payload = json.load(sys.stdin)
    else:
        payload = json.loads(Path(args.input).read_text(encoding="utf-8"))

    if args.mode == "schedule-transition":
        result = verify_schedule_transition(payload)
    elif args.mode == "attention14-closure":
        result = verify_attention14_closure(payload)
    else:
        result = verify_worktree_cleanup_readiness(payload)

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
