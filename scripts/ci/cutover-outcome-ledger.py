#!/usr/bin/env python3
"""Per-cycle engine cutover outcome record and the same-gate-twice check.

WHY (2026-11-24, incident fix audit, CR1). From 2026-11-18 the scheduled
cutover kept serving cycle after cycle, refused on the same gate (the Backup
copy lacking an installed migration, the serving rollback rehearsal being
unavailable, the hand-gap regression ...). The daily miss was paged
(EngineCutoverMissed), but nothing recorded WHICH gate refused each cycle and
nothing failed when the same gate refused again, so a repeat looked like
weather instead of a defect with an owner.

WHAT. stage-engine-release.yml calls `record` once per admitted scheduled
cycle, inside its existing run (no watcher, no cron). It turns this cycle's
daily-selection.json into one record, appends it to the rolling ledger carried
by the previous run's `cutover-outcome-ledger` artifact (or the committed
Nov 18-24 seed when none exists yet), and writes a verdict:

  exit 0  ok: no refusal, or a refusal on a gate the previous cycle did not
          refuse on (a seal, a selection or a different gate resets it)
  exit 3  the same gate refused this cycle and the previous one: fail loudly
  exit 2  could not tell (unreadable selection or previous ledger); never a pass

Detection only. It never dispatches, retries, re-certifies or advances a
release. The same code builds the backfill (`backfill`).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = 1
LEDGER_LIMIT = 240
SHA40 = re.compile(r"^[0-9a-f]{40}$")

# Normalised refusal gates. Order matters: the first match names the gate.
GATES: list[tuple[str, re.Pattern[str]]] = [
    ("backup-lacks-candidate-migration", re.compile(r"lacks the exact candidate migration", re.I)),
    ("backup-lacks-installed-migration", re.compile(r"lacks installed migration", re.I)),
    ("backup-holds-migration-production-lacks",
     re.compile(r"holds (a )?migration production does not have|holds a different name for", re.I)),
    ("serving-rollback-rehearsal-unavailable", re.compile(r"rollback rehearsal unavailable", re.I)),
    ("prequalification-unavailable", re.compile(r"prequalification unavailable", re.I)),
    ("hand-gap-regression", re.compile(r"hand[- ]gap", re.I)),
]

RESET_OUTCOMES = {"selected", "sealed", "serving-advanced"}


class CouldNotTell(Exception):
    """The input cannot be read well enough to give an answer."""


def classify(reason: str | None) -> str:
    text = (reason or "").strip()
    if not text:
        return "unrecorded-refusal"
    for gate, pattern in GATES:
        if pattern.search(text):
            return gate
    # Unknown gate: a stable slug without migration versions or shas, so the
    # same refusal on different candidates still names the same gate.
    slug = re.sub(r"\b[0-9a-f]{7,40}\b|\b\d{6,}\b", " ", text.lower())
    slug = re.sub(r"[^a-z]+", "-", slug).strip("-")
    return (slug[:60].rstrip("-") or "unrecorded-refusal")


def record_from_selection(selection: dict, cycle: str, run_id: str) -> dict:
    if not isinstance(selection, dict) or selection.get("outcome") not in {"selected", "keep-serving", "blocked"}:
        raise CouldNotTell(f"daily-selection.json has no known outcome: {selection.get('outcome') if isinstance(selection, dict) else selection!r}")
    outcome = selection["outcome"]
    deferred = selection.get("deferredCandidates") or []
    gate = None
    refused_sha = None
    reason = selection.get("reason")
    if outcome == "keep-serving" and deferred:
        newest = deferred[0] if isinstance(deferred[0], dict) else {}
        gate = classify(newest.get("reason"))
        refused_sha = newest.get("sha")
        reason = newest.get("reason")
    elif outcome == "keep-serving" and SHA40.match(str(selection.get("controlSha") or "")) \
            and selection.get("controlSha") != selection.get("servingSha"):
        # Newer protected commits existed, yet not one carried Backup
        # certification evidence by the cutoff (11-20 04:00, 11-22 10:00).
        gate = "no-certified-candidate"
        refused_sha = selection.get("controlSha")
    elif outcome == "blocked":
        gate = "blocked-" + classify(selection.get("reason"))
    return {
        "schema": SCHEMA,
        "cycle": cycle,
        "runId": str(run_id),
        "outcome": outcome,
        "gate": gate,
        "refusedSha": refused_sha,
        "reason": (reason or "").replace("\r", " ").replace("\n", " ")[:500] or None,
        "servingSha": selection.get("servingSha"),
        "targetSha": selection.get("targetSha"),
    }


def reconcile_previous(previous: dict, current: dict) -> None:
    """A selected cycle is only dispatched; the next cycle sees whether it sealed."""
    if previous.get("outcome") != "selected":
        return
    target = previous.get("targetSha")
    serving_now = current.get("servingSha")
    if not (isinstance(serving_now, str) and SHA40.match(serving_now)):
        return  # cannot tell from here; leave it as selected (resets)
    if serving_now == target:
        previous["outcome"] = "sealed"
    elif serving_now != previous.get("servingSha"):
        previous["outcome"] = "serving-advanced"  # another release moved serving
    else:
        previous["outcome"] = "not-sealed"
        previous["gate"] = "receiver-did-not-seal"
        previous["refusedSha"] = target
        previous["reason"] = "selected and dispatched, but serving did not move to the target by the next cycle"


def append(ledger: list[dict], current: dict) -> list[dict]:
    ledger = [dict(r) for r in ledger]
    if ledger and ledger[-1].get("cycle") == current["cycle"]:
        ledger.pop()  # the same cycle recorded again: the newer record replaces it
    if ledger:
        reconcile_previous(ledger[-1], current)
    ledger.append(current)
    return ledger[-LEDGER_LIMIT:]


def streak_at(ledger: list[dict], end: int) -> dict:
    """The run of identical refused gates ending at ledger[end] (inclusive)."""
    gate = ledger[end].get("gate") if ledger else None
    if not gate or ledger[end].get("outcome") in RESET_OUTCOMES:
        return {"repeated": False, "gate": None, "streak": 0}
    run = []
    for record in reversed(ledger[: end + 1]):
        if record.get("gate") == gate and record.get("outcome") not in RESET_OUTCOMES:
            run.append(record)
        else:
            break
    run.reverse()
    return {
        "repeated": len(run) >= 2,
        "gate": gate,
        "streak": len(run),
        "cycles": [r.get("cycle") for r in run],
        "refusedShas": [r.get("refusedSha") for r in run],
    }


def verdict(ledger: list[dict]) -> dict:
    if not ledger:
        return {"repeated": False, "gate": None, "streak": 0}
    result = streak_at(ledger, len(ledger) - 1)
    # A receiver refusal is only known one cycle late, when this run upgraded
    # the previous record to not-sealed; judge the run ending there too.
    if not result["repeated"] and len(ledger) >= 2 and ledger[-2].get("gate") == "receiver-did-not-seal":
        late = streak_at(ledger, len(ledger) - 2)
        if late["repeated"]:
            return late
    return result


def load_json(path: Path, what: str):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise CouldNotTell(f"{what} {path} is unreadable: {exc}") from exc


def load_ledger(path: Path, what: str) -> list[dict]:
    data = load_json(path, what)
    records = data.get("records") if isinstance(data, dict) else None
    if not isinstance(records, list) or not all(isinstance(r, dict) and r.get("cycle") for r in records):
        raise CouldNotTell(f"{what} {path} has no records list")
    return records


def dump_ledger(path: Path, records: list[dict]) -> None:
    path.write_text(json.dumps({
        "schema": SCHEMA,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "records": records,
    }, indent=1) + "\n")


def cmd_record(args) -> int:
    try:
        selection = load_json(Path(args.selection), "this cycle's selection")
        current = record_from_selection(selection, args.cycle, args.run_id)
        if args.previous_ledger:
            previous = load_ledger(Path(args.previous_ledger), "the previous cycle's ledger")
        else:
            previous = load_ledger(Path(args.seed), "the committed seed ledger")
    except CouldNotTell as exc:
        print(f"::error title=Cutover outcome record could not tell::{exc}")
        Path(args.verdict).write_text(json.dumps({"couldNotTell": str(exc)}) + "\n")
        return 2
    ledger = append(previous, current)
    dump_ledger(Path(args.output), ledger)
    result = verdict(ledger)
    result["record"] = ledger[-1]
    if len(ledger) >= 2:
        result["previous"] = ledger[-2]
    Path(args.verdict).write_text(json.dumps(result, indent=1) + "\n")
    rec = ledger[-1]
    print(f"Cycle {rec['cycle']}: {rec['outcome']}" + (f", refused on gate {rec['gate']}" if rec.get("gate") else ""))
    if result["repeated"]:
        print(
            f"::error title=Engine cutover refused twice on the same gate: {result['gate']}::"
            f"The scheduled cutover refused on gate {result['gate']} for {result['streak']} consecutive cycles "
            f"({', '.join(result['cycles'])}). Newest refused candidate "
            f"{((result.get('refusedShas') or [None])[-1] or 'unknown')[:12]}. "
            "Detection only: nothing was dispatched, retried or certified."
        )
        return 3
    return 0


def cycle_of_artifact(name: str) -> str:
    match = re.search(r"(\d{4}-\d{2}-\d{2}(?:T\d{2})?)$", name)
    if not match:
        raise CouldNotTell(f"artifact name {name} carries no cycle")
    return match.group(1)


def cycle_sort_key(cycle: str) -> str:
    return cycle if "T" in cycle else cycle + "T04"  # the daily cycle is 04:00 Chicago


def cmd_backfill(args) -> int:
    entries = []
    for item in args.selection:
        name, run_id, path = item.split("=", 2)
        entries.append((cycle_of_artifact(name), run_id, Path(path)))
    entries.sort(key=lambda e: cycle_sort_key(e[0]))
    ledger: list[dict] = []
    alarms = []
    for cycle, run_id, path in entries:
        ledger = append(ledger, record_from_selection(load_json(path, "selection"), cycle, run_id))
        v = verdict(ledger)
        if v["repeated"]:
            alarms.append(f"{cycle}: {v['gate']} x{v['streak']}")
    dump_ledger(Path(args.output), ledger)
    for r in ledger:
        print(f"{r['cycle']:<14} {r['outcome']:<13} {r.get('gate') or '-'}")
    print("would have failed:", "; ".join(alarms) if alarms else "(none)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    rec = sub.add_parser("record")
    rec.add_argument("--selection", required=True)
    rec.add_argument("--cycle", required=True)
    rec.add_argument("--run-id", required=True)
    rec.add_argument("--previous-ledger", default="")
    rec.add_argument("--seed", required=True)
    rec.add_argument("--output", required=True)
    rec.add_argument("--verdict", required=True)
    back = sub.add_parser("backfill")
    back.add_argument("--selection", action="append", required=True, help="artifact-name=run-id=path")
    back.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    return cmd_record(args) if args.cmd == "record" else cmd_backfill(args)


if __name__ == "__main__":
    sys.exit(main())
