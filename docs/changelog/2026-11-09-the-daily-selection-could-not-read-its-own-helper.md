# The night the daily selection could not read its own helper

2026-11-09. The 03:30 America/Chicago preparation reached its cutoff, waited
the full five hours as designed, and then decided nothing.

Stage run 42562159686 was the elected reservation owner. Its jobs:

```
Prove Whether The Server Tree Changed        success   04:30:04Z -> 09:30:05Z
Install Queued Daily-Maintenance Migrations  success
Record the daily release evidence            FAILURE   09:30:31Z
Dispatch The Exact Main SHA                  skipped
```

Artifact `daily-engine-selection-2026-11-09`, in full:

```
outcome             blocked
targetSha           null
deferredCandidates  []
servingSha          391f7bc0d57c71637bd4af5181f70520661e3593
stageSha            82f0c17ab281a90e5917a7a6b6316d8096b5a06b
controlSha          41d4719586e1eb4f7d7e68c6ccf74fd81491fa5e
cutoffEpoch         1794216600
reason              [Errno 2] No such file or directory:
                    '.../server/standby/schema-evidence.py'
```

`deferredCandidates` is EMPTY, and that is the part worth keeping. It is the
proof that no candidate was judged and refused: the selector raised before it
looked at one. A certified candidate existed and carried everything the night
needed.

## The cause, and the fix that is already in

The selection job checks the repository out sparsely, `scripts/ci` and
`server/scripts`. `scripts/ci/select-daily-engine.py` loads
`server/scripts/engine-release-installed-migrations.py`, and #10114 ("a Backup
copy is certified by the migrations it holds, never by a clock", squash
`8bd8eef384`) taught that module to load `server/standby/schema-evidence.py`
from the WORKING TREE. That directory was not in the sparse list, so the file
was absent from the runner even though it is present at the stage sha, at the
control sha and on main. #10113 added the evidence script; #10114 created the
dependency on it.

The selector's other read of the same directory, `standby-owners.sql`, goes
through `git show <control>:<path>`, which reads git objects rather than the
working tree, so it kept working and hid how exposed the filesystem read was.

Fixed in #10157, which added `server/standby` to that list and
`tests/a-sparse-checkout-holds-what-its-scripts-load.law.test.ts`. The law
reads every job in the repo that sparse-checks-out, follows what its scripts
load, and asks `git sparse-checkout check-rules` - git's own matcher - whether
each file is in that job's checkout. Its own header makes the sharpest point
in this whole incident: "Every test passed: each test runs from a full
checkout, where every file is present."

## What it cost, and what it did not

One night. The engine was not replaced at 04:00; `391f7bc0` kept serving with
the same `instanceId 1-a22c325d`, confirming it was never even restarted. That
is the designed outcome of a selection that cannot decide (CLAUDE.md section
13: a failed or missing certificate leaves the current engine running).
Nothing was dispatched, frozen or rolled back, the receiver was not invoked,
and the queued window migrations installed normally in the same run.

A re-run cannot recover a night, by design: the step refuses attempt 2
("Daily selection already attempted; retain the original decision"). The
owner-window, urgent and degraded replacement routes were revoked by the owner
on 2026-11-06. So the next activation is the ordinary 04:00 window.

## For whoever is measuring a change across this boundary

Chicago Monday 2026-11-09 ran entirely on the old engine. Any acceptance
number for that day measures the OLD behaviour, whatever merged the night
before. The first complete Chicago day on the replacement engine is the first
full day after an activation that actually happened, which is not the day
after the merge.
