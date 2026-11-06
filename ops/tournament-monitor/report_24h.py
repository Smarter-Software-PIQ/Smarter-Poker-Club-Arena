#!/usr/bin/env python3
"""Write the tournament monitor's observation-window report from its own state.

Read-only over state/cycles.jsonl, window.json and incidents/*.json; writes one
Markdown report (default reports/observation-<window start>.md). It never
touches an incident record, the timer or the window.
Usage: python3 -I report_24h.py [/opt/tournament-monitor] [output.md]
"""
import collections
import datetime as dt
import glob
import json
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/opt/tournament-monitor"
CLEARED = "Cleared, no fix recorded"


def ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def main():
    cycles = []
    with open(os.path.join(ROOT, "state/cycles.jsonl")) as fh:
        for line in fh:
            line = line.strip()
            if line:
                row = json.loads(line)
                if row.get("type") == "cycle":
                    cycles.append(row)
    window = json.load(open(os.path.join(ROOT, "window.json")))
    incidents = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(ROOT, "incidents/*.json")))]
    start, end = ts(window["started_utc"]), ts(window["ends_utc"])
    inside = [c for c in cycles if start <= ts(c["started_utc"]) <= end]
    gaps = []
    for a, b in zip(inside, inside[1:]):
        secs = (ts(b["started_utc"]) - ts(a["started_utc"])).total_seconds()
        if secs > 240:
            gaps.append((a["started_chicago"], b["started_chicago"], int(secs)))
    short = [c["cycle"] for c in inside if c.get("checked") != c.get("expected")]
    errors = [c["cycle"] for c in inside if c.get("source_errors")]
    releases = collections.OrderedDict()
    for c in inside:
        span = releases.setdefault(c.get("releaseSha"), [c["started_chicago"], c["started_chicago"]])
        span[1] = c["started_chicago"]
    durations = [float(c.get("duration_s") or 0) for c in inside]
    owned = [i for i in incidents if i.get("owner")]
    def cleared_while_owned(i):
        # A claim is the first history entry written by anyone other than the
        # checker; the rule must never clear a record after that point.
        claimed = False
        for h in i.get("stage_history", []):
            if h.get("by") and h.get("by") != "tournament_monitor":
                claimed = True
            elif claimed and h.get("stage") == CLEARED:
                return True
        return False
    owned_cleared = [i["fingerprint"] for i in owned if cleared_while_owned(i)]
    by_stage = collections.Counter((i["stage"], i["symptom"], i.get("severity")) for i in incidents)
    expected = int((end - start).total_seconds() // 180)

    out = []
    out.append("# Tournament monitor observation report")
    out.append("")
    out.append(f"- Window: {window['started_chicago']} to {window['ends_chicago']} America/Chicago "
               f"({window.get('duration_hours')} h), status `{window.get('status')}`, "
               f"authorized by {window.get('authorized')}.")
    out.append(f"- Cycles inside the window: {len(inside)} of about {expected} at 180 s "
               f"(cycle {inside[0]['cycle']} at {inside[0]['started_chicago']} to "
               f"cycle {inside[-1]['cycle']} at {inside[-1]['started_chicago']}).")
    out.append(f"- Gaps over 240 s: {len(gaps)}.")
    for a, b, secs in gaps:
        out.append(f"  - {a} to {b}: {secs} s")
    out.append(f"- Cycles that checked fewer events than the database listed: {len(short)}"
               + (f" (cycles {short[:30]})" if short else "") + ".")
    out.append(f"- Cycles with a source error: {len(errors)}" + (f" (cycles {errors[:30]})" if errors else "") + ".")
    out.append(f"- Cycle duration: mean {sum(durations) / len(durations):.1f} s, max {max(durations):.1f} s.")
    out.append(f"- Events checked per cycle: {min(c['checked'] for c in inside)} to {max(c['checked'] for c in inside)}.")
    out.append("- Engine releases observed:")
    for sha, (a, b) in releases.items():
        out.append(f"  - `{sha}` from {a} to {b}")
    out.append(f"- Incident records: {len(incidents)}. Owned: {len(owned)}. "
               f"Records the quiet-clear rule changed after someone claimed them: {len(owned_cleared)}"
               + (f" {owned_cleared}" if owned_cleared else "") + ".")
    out.append("")
    out.append("| Stage | Symptom | Severity | Records |")
    out.append("|---|---|---|---|")
    for (stage, symptom, sev), n in sorted(by_stage.items()):
        out.append(f"| {stage} | {symptom} | {sev} | {n} |")
    for title, stage in (("Cleared with no fix recorded (root cause not established)", CLEARED),
                         ("Still Detected when the report was written", "Detected")):
        rows = [i for i in incidents if i["stage"] == stage]
        out.append("")
        out.append(f"## {title}: {len(rows)}")
        out.append("")
        for i in rows:
            out.append(f"- `{i['fingerprint']}` {i.get('severity')} {i['symptom']}: "
                       f"{i.get('tournament_name') or '-'} ({(i.get('tournament_id') or '')[:8]}), "
                       f"seen {i.get('times_seen')}x, {i.get('first_seen_chicago')} to {i.get('last_seen_chicago')}, "
                       f"release `{(i.get('release_sha_first_seen') or '')[:12]}`")
    target = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        ROOT, "reports", f"observation-{window['started_utc'][:10]}.md")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as fh:
        fh.write("\n".join(out) + "\n")
    print(target)
    print("\n".join(out))


if __name__ == "__main__":
    main()
