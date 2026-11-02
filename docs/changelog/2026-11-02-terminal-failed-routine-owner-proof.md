# A terminal failed routine owner is released only by a recorded proof

The 04:00Z Phase1 cycle on 2026-11-02 (run 41379310363-1) refused cleanly inside the release transaction: the native heap census timed out at 59 s, rollback was proved, the sealed runtime was restored and the break thawed. Its cycle then stayed reserved with its recorded failure. After #9257 removed generic retirement, every later receiver refused on it, so one clean refusal blocked the release lane until a pinned resolution like #9231 was written by hand.

The existing transaction now runs `resolve-terminal-routine-failures` immediately after #9231's pinned disposition, under the actual engine lock and the seal lock. For each foreign routine owner that is still unresolved it records a `terminal-failure-proved` resolution only when every witness is positively observed, twice, against an unchanged seal:

- the cycle is reserved with a failure, its window ended at least a minute ago, and nothing is pending, finalizing or committed for the run;
- the canonical durable failure equals the cycle's copy, names its exact sha and control sha, and the runtime it recovered is the sealed desired runtime;
- the run's request, intent, break deadline, awaiting-certificate, drill, unreleased Lightning hold, intake request and intent, generation pin and image lease are absent;
- its release service, intake service and intake path are loaded or not-found, inactive or failed, PID-free, job-free, not enabled and without wants links;
- the cycle carries a verified durable announcement, and the run entered the legacy checkpoint inside that break with a non-retryable intent bound to this exact container; that engine process has since been replaced: the container started after the failure completed, its PID differs, the old PID is gone or was born after the intent, and the serving instance differs from the checkpointed one (so a timed-out census address space cannot survive);
- activation-entry and both main-inspector retirement custody files are absent; each unit is read with the shared bounded snapshot (exact fragment, no drop-ins, PID-free, job-free, disabled), services also prove an empty cgroup through systemd, neither wants directory links them, and the snapshots are re-read after Docker answers;
- the container runs exactly the desired image, local and public health agree on one idle, unfrozen instance of the desired source, and `engine-release-database-proof --terminal-owned-thaw` reads that window's unique complete v3 thaw (announcement, freeze start, release target, 300 s, generation 1, thawed by the desired source), no later v3 boundary, no maintenance row and that instance as the fresh leader before and after.

The failed invocation's own journal must hold exactly one legacy checkpoint refusal made before the guard call (not ok, no retry, `checkpointInvoked` false, no checkpoint or progress result, inspector request `invoked=no`), so process death is never used to discharge custody of a run that reached the guard. Recorded resolutions must equal their immutable receipt on every read.

A resolved failed source can never reserve another routine cycle or be prepared again.

Docker, health and database reads use the shared bounded command runner (5 s per call inside a 45 s budget). Any error, timeout or unexpected value leaves the owner authoritative and the ordinary owner check that follows keeps its refusal.

An immutable per-invocation receipt (`<owner>.<verifier>.<invocation>.terminal-resolution.json`) is written before the audit event, whose key carries the owner, verifier and invocation; an interrupted invocation resumes with exactly its receipt bytes, and a disagreeing receipt refuses.

Nothing is retired or rewritten: the cycle, its failure, its consumed hour and the audit history stay exactly as recorded, and `retiredRoutineCycles` remains refused. The owner gate stays read-only and never probes host state; it only validates recorded resolutions, which must match their original cycle and failure exactly, be verified by a different run and postdate the window. The pinned 41349091113-1 record keeps its own validator. The read-only recovery observer (`scripts/ci/read-scoped-release-recovery.py`) accepts exactly these records with their private receipt.

Regression: `tests/operations/terminal-failed-routine-owner.py` (law wrapper `tests/a-terminal-failed-routine-owner-is-released-only-by-proof.law.test.ts`): complete proofs (old PID gone, old PID reused later) are recorded without rewriting history; an interrupted invocation resumes from its receipt and a disagreeing receipt refuses; forty-nine missing or unknown witnesses each keep the owner; tampered records refuse; a resolved source can neither reserve nor prepare; the observer reads only exact receipted records and the full canonical routine observation reports the recorded owner.

`scripts/ci/fixtures/rake-calendar/before.sql` carries the qualified fixture correction from 944ffb2944a8 (SHA-256 b2beb2fadc2ae4340ff8a5b7f03ec3326a1a87ef827c3fb9144c924633bf2720), which required accounting shard 2/7 needs on any current branch; no production code changes with it.

## Round four (consolidated review)

- The terminal proof now releases exactly one owner, the 9f census refusal `41379310363-1`, pinned to its cycle, verified window, durable failure digest, completion and invocation. `41349091113-1` keeps its own resolution; any other owner in `routineFailureResolutions` is refused by the seal and by the closed observer.
- The resolver takes `--sha`/`--control-sha`, runs only as root for a non-9f target, and binds the current verifier with `failed_routine_current` before the proof and again under the seal lock before the receipt, audit and compare-and-swap. The record carries `verifiedByControlSha` and `verifiedByTargetSha`.
- The proof requires the checkpoint intent's 9f native census source, the seven original 9f control sources and the three unit templates they installed (`sourceDigests`), every `checkpointInvoked` journal row (exactly one, the pre-guard inspector-cleanup refusal of the queryObjects timeout), and health with `running`, `liveness=ok` and `durableConfirmed=false`.
- The database witness reads the thaw's ownership token privately (valid UUID, never exported), requires the exact v3 shifted ledger shape (fifteen target columns equal to their snapshotted counts, both markers, `complete`) and rechecks that no maintenance row exists at the closing bookend.
