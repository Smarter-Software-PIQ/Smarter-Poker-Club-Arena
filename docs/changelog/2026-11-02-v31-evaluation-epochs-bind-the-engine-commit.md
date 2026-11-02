# V31 Evaluation Epochs Bind The Engine Commit (2026-11-02)

## Problem

A sealed V31 dataset's eight replay/league receipts were write-once per (dataset, kind, family) and had to share one engine commit forever. League receipts run the full Horse brain (a 316-file decision closure plus the dependency lock, changing about eleven times a day) while the serving engine advances hourly and an evaluation can take 350 minutes. A dataset whose evaluated engine stopped matching the serving engine was stranded permanently, and promotion bound no engine at all.

## Change

- Migration `20261102151428_v31_evaluation_epochs_bind_the_engine_commit`: `gto_v31_evaluation_epochs` (one audited epoch per dataset and engine commit, opened_at/opened_by/reason, one current epoch, permanent rows). Receipts bind their epoch and commit, are unique per (dataset, kind, family, engine commit) and are immutable. `fn_gto_v31_open_evaluation_epoch` opens a new epoch only for a different, never-evaluated commit with an audited reason, and never after promotion or a loss. Promotion is the new `fn_gto_v31_promote_dataset_epoch(dataset, engine_commit, serving_commit)`: exactly the open epoch's commit and its own eight win/tie receipts; it records both commits. `fn_gto_v31_promote_dataset(uuid)` stays the single overload of its name (same grants) and refuses. Opening an epoch locks only a dataset awaiting evaluation, so it never deadlocks with a promotion holding the release gate. Status exposes `current_epoch` and `evaluation_epochs`.
- Qualification workflow: the epoch owns the pin. Compatibility is byte identity of the full decision closure (`scripts/ci/v31-decision-closure.mjs`) between pin and serving commit. The closure fails closed: literal imports anywhere in the repository, explicit worker/process entries, every repository file a closure file names as a literal (digested sources, evidence, lock files), `server/release-evidence/`, the native kernel and tsconfigs; any unresolved specifier or unacknowledged dynamic path refuses compatibility. A pin must carry the epoch-aware evaluator protocol marker. `promote` is one operation under `/var/lock/club-arena-engine-up.lock` (`scripts/ci/v31-atomic-promotion-host.sh`): refuses near the hourly :50-:10 and daily 03:50-04:06 Chicago boundaries, verifies the serving image revision, bounds every step by one absolute deadline (480 s, `timeout`), promotes, loads all eight workers, re-reads them and proves natural readiness. A partial outcome is explicit and re-runnable without re-promoting.
- Evaluator records only into the open epoch (epoch n>1 results use the matchup suffix `_epoch<n>`); `--promote` is removed.

## Proof

- `scripts/ci/test-v31-evaluation-epochs.py --mutations` (PostgreSQL 17, byte-exact live preimages, 12 mutations).
- `node --test scripts/ci/gto-v31-qualification.test.mjs scripts/ci/v31-decision-closure.test.mjs scripts/ci/v31-atomic-promotion.test.mjs`.
