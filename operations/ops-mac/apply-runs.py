#!/usr/bin/env python3
"""Which apply-merged-migration runs belong to one migration file.

usage: gh run list ... --json databaseId,displayTitle,status | apply-runs.py FILE latest|inflight

A run is identified by its run-name, "Apply Merged Migration <file>[ <nonce>]",
which GitHub sets the moment the run is CREATED. The driver used to read the
first job's name instead, and a run has no job while it waits in the per-file
concurrency group behind another run for the same file (the merge dispatcher's
own send). On 2026-11-19 that made the queue report "install rc=3" for
20261118233000, which the merge dispatcher's run installed ten minutes later
(Production Alerts row 444704).

  latest    the newest run id for FILE (runs are listed newest first), or nothing
  inflight  how many runs for FILE have not completed
"""
import json
import sys


def runs_for(runs, file):
    title = f"Apply Merged Migration {file}"
    return [r for r in runs if r.get("displayTitle") == title or str(r.get("displayTitle", "")).startswith(title + " ")]


def main(argv):
    if len(argv) != 3 or argv[2] not in ("latest", "inflight"):
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    try:
        runs = json.load(sys.stdin)
    except ValueError:
        return 3  # an unreadable listing is not "no run": the caller must not act on it
    if not isinstance(runs, list):
        return 3
    mine = runs_for(runs, argv[1])
    if argv[2] == "latest":
        if mine:
            print(mine[0]["databaseId"])
    else:
        print(sum(1 for r in mine if r.get("status") != "completed"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
