#!/usr/bin/env python3
"""Every cycle has an owner or says so (O32, 2026-11-26).

WHY. On 2026-11-26 the 10:00 America/Chicago cycle had no owner: no Stage run
created inside its election window claimed it, so no selection ran, nothing
was posted to the cutover log (issue #11599) and nobody was told. A cycle
without an owner was completely silent.

WHAT. Every Stage run, whatever started it, calls `run` once (job
`cycle-look-back` of stage-engine-release.yml; no trigger, timer or watcher is
added). It looks back over the scheduled cycles of the last 26 hours whose
election window has closed and, for each one that has no result on the cutover
log and no record on the outcome ledger, replays that cycle's election from
the Stage run list:

  NO OWNER    no eligible run created in the election window claimed the
              cycle. Said as soon as the window has closed (start - 10
              minutes, plus a two-minute margin for the run list), because no
              run can claim after that.
  NO OUTCOME  a run held the cycle and no result was recorded for it. Said
              only 30 minutes after the start, once the receiver and the
              owner's own jobs have had their time.
  unknown     a read failed; nothing is posted and nothing is recorded

It posts one line to the cutover log per NO OWNER or NO OUTCOME cycle (that
comment is itself the cycle's result, so a later run posts nothing), and
prints the owner note and the ledger gap for the calling workflow.

REPORTING ONLY. It never selects, dispatches, retries, certifies or advances
a release, and "could not tell" is never folded into yes or no (CLAUDE.md
10.86). Every reader is injected so tests replay real timelines.

THE ELECTION IT REPLAYS is the one in stage-engine-release.yml's admission
step: a run is eligible by event and run title, created inside
[cutoff - lookback, cutoff + 20 minutes) on main; a run that finished green,
first attempt, more than two minutes before the cutoff claimed nothing, and a
later green one claimed nothing only when its detect job skipped the cutoff
step. Any other eligible run held the cycle.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

CHICAGO = ZoneInfo("America/Chicago")
THREE_HOURLY_HOURS = (1, 4, 7, 10, 13, 16, 19, 22)
DAILY_HOURS = (4,)
CUTOFF_BEFORE_START = 1800
WINDOW_AFTER_CUTOFF = 1200
LOOKBACK_THREE_HOURLY = 100 * 60
LOOKBACK_DAILY = 5 * 3600
# An election closes 20 minutes after the cutoff; two more minutes let the run
# list show a run created in the window's last second.
LIST_MARGIN = 120
# A held cycle is judged 30 minutes after its start: the receiver has posted
# its result and the owner's own note (start + 25 minutes) has gone out.
DUE_AFTER_START = 1800
HORIZON = 26 * 3600
STOOD_DOWN_MARGIN = 120
MAX_JOB_QUESTIONS = 12
MAX_COMMENT_PAGES = 5
LOG_ISSUE = "11599"
STAGE_WORKFLOW = "stage-engine-release.yml"
LEDGER_ARTIFACT = "cutover-outcome-ledger"
DETECT_JOB = "Prove Whether The Server Tree Changed"
CUTOFF_STEP = "Wait once for the reserved cutoff and bind protected source"
GAP_OUTCOMES = ("no-owner", "no-outcome")
RESULT_LINE = re.compile(
    r"\ACycle: (\d{4}-\d{2}-\d{2} \d{2}:\d{2} [A-Z]{2,5})[ \t]*\r?\nResult: ([A-Z][A-Z-]*(?: [A-Z][A-Z-]*)*)"
)


class CouldNotTell(Exception):
    """A read failed or returned something that cannot be trusted."""


# ---------------------------------------------------------------- schedule


def hours_for(three_hourly: bool) -> tuple[int, ...]:
    return THREE_HOURLY_HOURS if three_hourly else DAILY_HOURS


def cycle_starts(low: int, high: int, hours: tuple[int, ...]) -> list[int]:
    """Scheduled cycle starts in [low, high], real epoch hours. The repeated
    fall-back hour is one cycle, the first (same rule as the admission)."""
    starts = []
    epoch = low // 3600 * 3600
    if epoch < low:
        epoch += 3600
    while epoch <= high:
        local = datetime.fromtimestamp(epoch, CHICAGO).hour
        if local in hours and datetime.fromtimestamp(epoch - 3600, CHICAGO).hour != local:
            starts.append(epoch)
        epoch += 3600
    return starts


def identity(start: int) -> str:
    local = datetime.fromtimestamp(start, CHICAGO)
    return local.date().isoformat() if local.hour == 4 else local.strftime("%Y-%m-%dT%H")


def label(start: int) -> str:
    return datetime.fromtimestamp(start, CHICAGO).strftime("%Y-%m-%d %H:%M %Z")


def election_window(start: int, three_hourly: bool) -> tuple[int, int, int]:
    cutoff = start - CUTOFF_BEFORE_START
    lookback = LOOKBACK_THREE_HOURLY if three_hourly else LOOKBACK_DAILY
    return cutoff - lookback, cutoff + WINDOW_AFTER_CUTOFF, cutoff


def stamp(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def chicago_clock(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, CHICAGO).strftime("%H:%M %Z")


def when(value) -> float:
    moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if moment.utcoffset() is None:
        raise CouldNotTell("a run time has no timezone")
    return moment.timestamp()


# ---------------------------------------------------------------- election


def eligible(run: dict, low: int, high: int, cutoff: int) -> bool:
    """The admission step's own eligibility rule, by event and run title."""
    try:
        created = when(run["created_at"])
    except (KeyError, TypeError, ValueError) as exc:
        raise CouldNotTell(f"a Stage run has no readable creation time: {exc}") from exc
    if run.get("head_branch") != "main" or not (low <= created < high):
        return False
    original = created >= cutoff
    title = run.get("display_title")
    event = run.get("event")
    backup = event == "workflow_run" and (
        title == "Automatic Backup daily reservation" or (original and title == "Automatic protected Backup finished")
    )
    ordinary = event in ("push", "schedule") and (title == "Daily engine reservation" or original)
    operator = (
        event == "repository_dispatch"
        and original
        and (run.get("actor") or {}).get("type") == "User"
        and title == "Original operator daily preparation"
    )
    return bool(backup or ordinary or operator)


def held(run: dict, cutoff: int, jobs_reader, budget: list[int]) -> bool:
    """True when this eligible run held the cycle, False when it stood down."""
    if run.get("status") != "completed" or run.get("conclusion") != "success" or run.get("run_attempt") != 1:
        return True
    try:
        finished = when(run["updated_at"])
    except (KeyError, TypeError, ValueError) as exc:
        raise CouldNotTell(f"run {run.get('id')} has no readable finish time: {exc}") from exc
    if finished <= cutoff - STOOD_DOWN_MARGIN:
        return False
    if budget[0] <= 0:
        raise CouldNotTell("too many runs finished near the cutoff to ask each one")
    budget[0] -= 1
    document = jobs_reader(run["id"])
    try:
        jobs = document["jobs"]
        if type(document.get("total_count")) is not int or document["total_count"] != len(jobs):
            raise CouldNotTell(f"the job list of run {run['id']} is incomplete")
        detect = [job for job in jobs if job.get("name") == DETECT_JOB]
        if len(detect) != 1 or detect[0].get("status") != "completed":
            raise CouldNotTell(f"run {run['id']} has no single finished detect job")
        waits = [step for step in detect[0]["steps"] if step.get("name") == CUTOFF_STEP]
        if len(waits) != 1:
            raise CouldNotTell(f"run {run['id']} has no single cutoff step")
    except (KeyError, TypeError) as exc:
        raise CouldNotTell(f"the job record of run {run['id']} is unreadable: {exc}") from exc
    return not (waits[0].get("status") == "completed" and waits[0].get("conclusion") == "skipped")


def replay_election(start: int, three_hourly: bool, runs_reader, jobs_reader) -> dict:
    low, high, cutoff = election_window(start, three_hourly)
    runs = runs_reader(stamp(low), stamp(high))
    if not isinstance(runs, list):
        raise CouldNotTell("the Stage run list is unreadable")
    ids = [run.get("id") for run in runs if isinstance(run, dict)]
    if len(ids) != len(runs) or any(type(rid) is not int or rid <= 0 for rid in ids) or len(ids) != len(set(ids)):
        raise CouldNotTell("the Stage run identities are incomplete")
    candidates = sorted((run for run in runs if eligible(run, low, high, cutoff)), key=lambda run: run["id"])
    budget = [MAX_JOB_QUESTIONS]
    for run in candidates:
        if held(run, cutoff, jobs_reader, budget):
            return {"verdict": "no-outcome", "ownerRunId": run["id"], "eligible": len(candidates),
                    "windowStart": low, "windowEnd": high}
    return {"verdict": "no-owner", "ownerRunId": None, "eligible": len(candidates),
            "windowStart": low, "windowEnd": high}


# ---------------------------------------------------------------- records


def results_on_log(comments) -> dict[str, str]:
    """Cycle label -> the newest result word(s) the cutover log holds for it."""
    if not isinstance(comments, list):
        raise CouldNotTell("the cutover log comments are unreadable")
    found: dict[str, str] = {}
    for comment in comments:
        if not isinstance(comment, dict) or not isinstance(comment.get("body"), str):
            raise CouldNotTell("a cutover log comment is unreadable")
        match = RESULT_LINE.match(comment["body"])
        if match:
            found[match.group(1)] = match.group(2)
    return found


def cycles_on_ledger(records) -> set[str]:
    if not isinstance(records, list) or not all(isinstance(r, dict) and r.get("cycle") for r in records):
        raise CouldNotTell("the outcome ledger has no records list")
    return {r["cycle"] for r in records if r.get("outcome") not in GAP_OUTCOMES}


def owner_note(start: int, verdict: str, owner_run, now: int) -> str:
    local = datetime.fromtimestamp(start, CHICAGO)
    clock = f"{local.hour % 12 or 12}:{local.minute:02d} {'AM' if local.hour < 12 else 'PM'}"
    day = f"{local.strftime('%B')} {local.day}"
    if verdict == "no-owner":
        if now < start:
            return (f"The {clock} engine cutover on {day} will not run: nothing started it. "
                    "The engine keeps running the current version.")
        return (f"The {clock} engine cutover on {day} did not run: nothing started it. "
                "The engine kept running the current version.")
    return (f"The {clock} engine cutover on {day} was started (run {owner_run}) but left no result on record. "
            "Assume the engine kept running the current version until the cutover log says otherwise.")


def log_comment(start: int, finding: dict, run_url: str) -> str:
    window = f"{chicago_clock(finding['windowStart'])} to {chicago_clock(finding['windowEnd'])}"
    if finding["verdict"] == "no-owner":
        result = "NO OWNER (the serving engine keeps running)"
        reason = (f"no Stage run claimed this cycle. Election window {window}: "
                  f"{finding['eligible']} eligible run(s) created in it, none held the cycle.")
    else:
        result = "NO OUTCOME (no result was recorded for this cycle)"
        reason = (f"Stage run {finding['ownerRunId']} held this cycle (election window {window}) and neither "
                  "the cutover log nor the outcome ledger has a result for it.")
    return f"Cycle: {label(start)}\nResult: {result}\nReason: {reason}\nFound by: {run_url or 'a Stage run'}\n"


# ---------------------------------------------------------------- look back


def look_back(now: int, three_hourly_policy: bool, readers: dict) -> dict:
    """Judge every due cycle in the horizon. Readers raise CouldNotTell."""
    out = {"announce": [], "gaps": [], "unknown": [], "accounted": [], "notScheduled": [], "pending": []}
    serving_three_hourly = None
    serving_error = "not read"
    if three_hourly_policy:
        try:
            serving_three_hourly = bool(readers["serving_three_hourly"]())
        except CouldNotTell as exc:
            serving_error = str(exc)
    closed = now - LIST_MARGIN - WINDOW_AFTER_CUTOFF + CUTOFF_BEFORE_START
    starts = cycle_starts(now - HORIZON, closed, hours_for(three_hourly_policy))
    if not starts:
        return out
    try:
        low, _, _ = election_window(starts[0], three_hourly_policy)
        on_log = results_on_log(readers["comments"](stamp(low)))
    except CouldNotTell as exc:
        # Without the log nothing can be called missing, and nothing could be
        # posted once only: every cycle is unknown.
        out["unknown"] = [{"cycle": identity(s), "label": label(s), "why": f"cutover log: {exc}"} for s in starts]
        return out
    ledger_error = None
    on_ledger: set[str] = set()
    try:
        on_ledger = cycles_on_ledger(readers["ledger"]())
    except CouldNotTell as exc:
        ledger_error = str(exc)
    for start in starts:
        cycle, name = identity(start), label(start)
        anchor = datetime.fromtimestamp(start, CHICAGO).hour == 4
        word = on_log.get(name)
        if word in ("NO OWNER", "NO OUTCOME"):
            # Already announced; the ledger still learns of it from the owner's run.
            if cycle not in on_ledger and ledger_error is None:
                out["gaps"].append({"cycle": cycle, "outcome": "no-owner" if word == "NO OWNER" else "no-outcome",
                                    "ownerRunId": None})
            out["accounted"].append(cycle)
            continue
        if word or cycle in on_ledger:
            out["accounted"].append(cycle)
            continue
        if ledger_error is not None:
            out["unknown"].append({"cycle": cycle, "label": name, "why": f"outcome ledger: {ledger_error}"})
            continue
        if three_hourly_policy and not anchor:
            # A cycle other than the 04:00 anchor exists only while the serving
            # engine breaks on it (the admission prepares nothing otherwise).
            if serving_three_hourly is None:
                out["unknown"].append({"cycle": cycle, "label": name, "why": f"serving schedule: {serving_error}"})
                continue
            if not serving_three_hourly:
                out["notScheduled"].append(cycle)
                continue
        try:
            finding = replay_election(start, three_hourly_policy, readers["runs"], readers["jobs"])
        except CouldNotTell as exc:
            out["unknown"].append({"cycle": cycle, "label": name, "why": f"election: {exc}"})
            continue
        if finding["verdict"] == "no-outcome" and now < start + DUE_AFTER_START:
            # Its owner is still at work; a later run judges it.
            out["pending"].append(cycle)
            continue
        finding.update({"cycle": cycle, "label": name, "start": start,
                        "note": owner_note(start, finding["verdict"], finding["ownerRunId"], now)})
        out["announce"].append(finding)
        out["gaps"].append({"cycle": cycle, "outcome": finding["verdict"], "ownerRunId": finding["ownerRunId"]})
    return out


def announce(report: dict, readers: dict, post, run_url: str) -> list[dict]:
    """Post one log line per finding, unless the log gained a result meanwhile.
    Returns the findings whose owner note is still owed."""
    notes = []
    for finding in report["announce"]:
        try:
            if finding["label"] in results_on_log(readers["comments"](stamp(finding["windowStart"]))):
                print(f"Cycle {finding['label']}: the cutover log gained a result meanwhile; nothing posted.")
                continue
        except CouldNotTell as exc:
            print(f"::warning title=CYCLE LOOK-BACK UNKNOWN::Cycle {finding['label']}: the cutover log could not be "
                  f"read again before posting ({exc}); nothing posted for it by this run.")
            continue
        try:
            post(log_comment(finding["start"], finding, run_url))
            print(f"Cycle {finding['label']}: posted {finding['verdict'].upper().replace('-', ' ')} to issue #{LOG_ISSUE}.")
        except CouldNotTell as exc:
            # The owner is still told; the next run finds no result and posts again.
            print(f"::warning title=CYCLE LOOK-BACK::Cycle {finding['label']} is {finding['verdict']} but the cutover "
                  f"log post failed ({exc}).")
        notes.append({"cycle": finding["cycle"], "note": finding["note"]})
    return notes


# ---------------------------------------------------------------- live readers


def gh(*args: str, binary: bool = False):
    try:
        raw = subprocess.check_output(["gh", "api", *args], timeout=40, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError) as exc:
        raise CouldNotTell(f"gh api {args[0][:80]} failed: {type(exc).__name__}") from exc
    if binary:
        return raw
    try:
        return json.loads(raw.decode() or "null")
    except ValueError as exc:
        raise CouldNotTell(f"gh api {args[0][:80]} returned no JSON") from exc


def live_readers(repo: str, seed: Path, this_run: str) -> dict:
    def runs(low: str, high: str):
        pages = gh("--paginate", "--slurp",
                   f"repos/{repo}/actions/workflows/{STAGE_WORKFLOW}/runs?created={low}..{high}&per_page=100")
        pages = pages if isinstance(pages, list) else [pages]
        if not pages or any(not isinstance(p, dict) or not isinstance(p.get("workflow_runs"), list) for p in pages):
            raise CouldNotTell("the Stage run list is unreadable")
        rows = [run for page in pages for run in page["workflow_runs"]]
        if not all(type(p.get("total_count")) is int and p["total_count"] <= len(rows) for p in pages):
            raise CouldNotTell("the Stage run list is incomplete")
        return rows

    def jobs(run_id: int):
        return gh(f"repos/{repo}/actions/runs/{int(run_id)}/jobs?per_page=100")

    def comments(since: str):
        rows = []
        for page in range(1, MAX_COMMENT_PAGES + 1):
            batch = gh(f"repos/{repo}/issues/{LOG_ISSUE}/comments?since={since}&per_page=100&page={page}")
            if not isinstance(batch, list):
                raise CouldNotTell("the cutover log comments are unreadable")
            rows.extend(batch)
            if len(batch) < 100:
                return rows
        raise CouldNotTell("the cutover log holds more comments than the bounded read")

    def ledger():
        listing = gh(f"repos/{repo}/actions/artifacts?name={LEDGER_ARTIFACT}&per_page=30")
        if not isinstance(listing, dict) or not isinstance(listing.get("artifacts"), list):
            raise CouldNotTell("the ledger artifact listing is unreadable")
        live = [a for a in listing["artifacts"] if isinstance(a, dict) and not a.get("expired")
                and str((a.get("workflow_run") or {}).get("id")) != str(this_run)]
        if not live:
            data = json.loads(seed.read_text())
        else:
            newest = sorted(live, key=lambda a: str(a.get("created_at")))[-1]
            archive = gh(f"repos/{repo}/actions/artifacts/{int(newest['id'])}/zip", binary=True)
            try:
                with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                    data = json.loads(bundle.read("cutover-outcome-ledger.json"))
            except (zipfile.BadZipFile, KeyError, ValueError) as exc:
                raise CouldNotTell(f"ledger artifact {newest.get('id')} is unreadable: {exc}") from exc
        return data.get("records") if isinstance(data, dict) else None

    def serving_three_hourly():
        last = "no answer"
        fixture = os.environ.get("CYCLE_LOOK_BACK_HEALTH_FILE")
        for _ in range(3):
            try:
                if fixture:
                    health = json.loads(Path(fixture).read_text())
                else:
                    request = Request("https://engine.smarter.poker/health", headers={"Cache-Control": "no-cache"})
                    with urlopen(request, timeout=15) as response:
                        health = json.loads(response.read().decode())
                schedule = (health.get("maintenance") or {}).get("schedule") or {}
                return schedule.get("frequency") == "three-hourly" and schedule.get("startHours") == list(THREE_HOURLY_HOURS)
            except Exception as exc:  # noqa: BLE001 - any failed read is "could not tell"
                last = type(exc).__name__
        raise CouldNotTell(f"/health could not be read ({last})")

    return {"runs": runs, "jobs": jobs, "comments": comments, "ledger": ledger,
            "serving_three_hourly": serving_three_hourly}


def cmd_run(args) -> int:
    try:
        policy = json.loads(Path(args.policy).read_text())
        three_hourly = policy.get("frequency") == "three-hourly"
    except (OSError, ValueError, AttributeError) as exc:
        print(f"::warning title=CYCLE LOOK-BACK UNKNOWN::The schedule policy could not be read ({exc}); nothing judged.")
        return 0
    now = int(args.now) if args.now else int(datetime.now(timezone.utc).timestamp())
    readers = live_readers(args.repo, Path(args.seed), args.run_id)
    report = look_back(now, three_hourly, readers)

    def post(body: str) -> None:
        gh("--method", "POST", f"repos/{args.repo}/issues/{LOG_ISSUE}/comments", "-f", f"body={body}")

    notes = announce(report, readers, post, args.run_url) if args.post else []
    for item in report["unknown"]:
        print(f"::warning title=CYCLE LOOK-BACK UNKNOWN::Cycle {item['label']}: could not tell whether it has an "
              f"outcome ({item['why']}). Nothing posted, nothing recorded.")
    print(f"Looked back: {len(report['accounted'])} cycle(s) with a result, {len(report['announce'])} without, "
          f"{len(report['pending'])} still with their owner, {len(report['unknown'])} unknown, "
          f"{len(report['notScheduled'])} not a serving break.")
    Path(args.out).write_text(json.dumps({**report, "notes": notes}, indent=1) + "\n")
    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as handle:
            handle.write("notes=" + (json.dumps(notes, separators=(",", ":")) if notes else "") + "\n")
            handle.write("gaps=" + (json.dumps(report["gaps"], separators=(",", ":")) if report["gaps"] else "") + "\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--repo", required=True)
    run.add_argument("--policy", required=True)
    run.add_argument("--seed", required=True)
    run.add_argument("--out", required=True)
    run.add_argument("--run-id", default="")
    run.add_argument("--run-url", default="")
    run.add_argument("--now", default="")
    run.add_argument("--post", action="store_true")
    args = parser.parse_args(argv)
    return cmd_run(args)


if __name__ == "__main__":
    sys.exit(main())
