#!/usr/bin/env python3
"""Exit 0 if the PLO math-core gate (lane CORE-POOLED-2) is running, 1 if clear, 2 if the inbox is unreadable.

Running = the newest heading FROM a sender containing 'CORE-POOLED-2' whose SUBJECT starts with 'GATE START'
is newer than the newest such heading whose SUBJECT starts with 'GATE DONE'. Other lanes quoting the phrase
never count.

THE REPOSITORY COPY (2026-11-26). This script used to live only in the SSD1 lock folder
(/Volumes/SmarterWork/agent-work/shared-capacity/hs-locks-01UxDLnM4/), and wrappers called it as
`[ -f "$L/core-gate-running.py" ] && python3 ...`: when SSD1 dropped, the file vanished with it and the gate
check silently read as clear. It now ships with every checkout, so losing a drive cannot remove it. The inbox
it reads is on SSD2; when that file cannot be read the answer is exit 2, which every caller treats as busy,
never as clear. The SSD1 copy is left in place for wrappers that still read it.

    python3 scripts/ops/core-gate-running.py [<inbox file>]

The optional argument names another inbox file (tests); the default is the canonical SSD2 file.
"""
import re
import sys

INBOX = "/Volumes/SmarterArchives/agent-evidence/extreme-archive/COORDINATION-INBOX-FALLBACK-20261116.md"


def main(argv):
    inbox = argv[1] if len(argv) > 1 else INBOX
    try:
        with open(inbox, encoding="utf-8", errors="replace") as f:
            t = f.read()
    except OSError:
        print(f"core gate UNKNOWN: cannot read {inbox}")
        return 2
    start = done = ""
    for m in re.finditer(
        r"^## (\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?Z?\s+FROM (.*?) TO .*?SUBJECT: *(.*)$", t, re.M
    ):
        if "CORE-POOLED-2" not in m.group(4).split("(")[0]:
            continue
        ts = f"{m.group(1)}T{m.group(2)}{m.group(3) or ':00'}"
        subj = m.group(5)
        if re.match(r"GATE START\b", subj):
            start = max(start, ts)
        elif re.match(r"GATE DONE\b", subj):
            done = max(done, ts)
    running = bool(start) and start > done
    print(
        f"core gate {'RUNNING' if running else 'clear'} (last GATE START {start or '-'}, last GATE DONE {done or '-'})"
    )
    return 0 if running else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
