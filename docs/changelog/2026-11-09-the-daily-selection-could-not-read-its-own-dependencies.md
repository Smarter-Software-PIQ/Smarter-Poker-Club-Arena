# The daily selection could not read its own dependencies

2026-11-09. The 03:30 America/Chicago preparation for today reached its
cutoff, waited the full five hours as designed, and then decided nothing:

```
outcome      blocked
targetSha    null
servingSha   391f7bc0d57c71637bd4af5181f70520661e3593
controlSha   41d4719586e1eb4f7d7e68c6ccf74fd81491fa5e
reason       [Errno 2] No such file or directory:
             '/home/runner/work/Smarter-Poker-Club-Arena/Smarter-Poker-Club-Arena/server/standby/schema-evidence.py'
```

(Stage run 42562159686, job "Record the daily release evidence", step "Freeze
the exact daily candidate and report inclusion", exit code 2 at 09:30:28Z.
Artifact `daily-engine-selection-2026-11-09`.)

No candidate was at fault. A certified candidate existed and carried
everything today's release needed. The selector never got as far as looking
at one.

## The cause

The selection job checks the repository out SPARSELY:

```yaml
sparse-checkout: |
  scripts/ci
  server/scripts
```

`scripts/ci/select-daily-engine.py` loads
`server/scripts/engine-release-installed-migrations.py`, and that module, at
line 84, loads `server/standby/schema-evidence.py` from the FILESYSTEM:

```python
path = Path(__file__).resolve().parents[2] / 'server/standby/schema-evidence.py'
```

`server/standby` is not in the sparse list, so the file was absent from the
runner's workspace even though it is present in every commit involved.

The dependency arrived with #10113 ("bind installed schema evidence to the
certified copy", merged 2026-11-08 19:48 Chicago), which replaced a clock test
with a contents test. That was the right change and this is the trap it left
one level up, CLAUDE.md 10.86 rule 4 exactly: the test became correct and the
job that runs it could no longer see it. The selector's other read of that
directory, `server/standby/standby-owners.sql`, goes through
`git show control:<path>`, which reads the object database rather than the
worktree, so it kept working and hid how exposed the filesystem read was.

## What it cost, and what it did not

It cost one night. The engine was not replaced at 04:00; `391f7bc0` kept
serving. That is the designed outcome of a selection that cannot decide
(CLAUDE.md section 13: a failed or missing certificate leaves the current
engine running), and nothing was dispatched, frozen or rolled back. Queued
window migrations installed normally in the same run.

It would have cost every following night too. The sparse list is static, so
the same selection would have failed at 03:30 tomorrow with the same message.
A re-run cannot recover a night either: the step refuses attempt 2 on purpose,
to retain the original decision.

## The fix

`server/standby` is added to that sparse list, which is the whole correction.

`tests/unit/dailySelectionReadsItsOwnDependencies.test.ts` keeps it true in
general rather than for this one file: it reads the job's actual
sparse-checkout out of the workflow, walks the selection chain for every
repository path the chain opens by filesystem path, and fails naming any that
the sparse set cannot reach. Without the fix it fails with
"cannot read: server/standby/schema-evidence.py". It also pins the
second-attempt refusal, so nobody "fixes" a future blocked night by re-running
the decision.
