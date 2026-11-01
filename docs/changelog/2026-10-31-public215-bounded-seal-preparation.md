# Public215 sealing uses bounded validation receipts

The original R7 qualification finished its models and heldout audits, then the seal exceeded the 125-second transport boundary and rolled back at its unchanged 240-second database limit. After the first optimization, production read-only probes still measured three source validations at 209.973 ms and one model validation at 496.325 ms. Repeating all 6,955 sources and 107 models in one seal request remains unsuitable.

The migration adds explicit per-cell preparation. Each request validates the current complete payload, frozen model and Linux receipt, 65 source contracts, source artifacts, lineage, approved input and eight independent heldout audits. Existing physics, compiled models and Linux audit caches must exist before validation; sealing cannot regenerate them. Preparations store exact NUMERIC sufficient statistics, input bindings and the validation implementation fingerprint in private immutable records.

Input revisions, parent and row locks, complete censuses and the implementation fingerprint prevent reuse after a relevant mutation. Future gold and bundle writes record revisions atomically, including delete/reinsert and older transaction snapshots; existing gold rows are not backfilled. Completed audit rows reject late appends under the existing producer mutex. No financial, seat or gameplay tables participate.

The final transaction requires all 107 current receipts, combines statistics before division and preserves the original coverage, lineage, quality thresholds, checksum and state/evaluation writes. The prior legacy seal body is retained exactly. Numerical implementation checksums and existing function metadata remain pinned. No capture, training, blind selection, audit generation, timeout extension, promotion or loading occurs during installation.

Regression coverage runs in the existing PostgreSQL qualification job: original metric CTE equivalence including numeric scales and NULLs, input revision/concurrency behavior and the complete preparation/seal transaction. Controlled scientific dependencies in transaction fixtures do not replace the existing scientific qualification suite. The rollback restores the prior seal and retains private historical receipt tables.

Source checks, protected merge, exact installation, actual qualification, promotion and live worker loading remain separate delivery states. This change alone does not certify or activate R7.
