# The install queue sees an apply run that is waiting behind another (2026-11-24)

Production Alerts 444704: the Ops Mac install queue reported `install rc=3` for
20261118233000 because its driver found its own apply-merged-migration run by
job name, and a run queued in the per-file concurrency group behind the merge
dispatcher's run has no job yet. The driver now matches the run-name, waits for
a run already in flight for the file before sending, and the queue fails a job
only when the version is still not recorded. Evidence:
`docs/production-alerts/evidence/444704-install-queue-blind-to-a-queued-apply-run/`.
