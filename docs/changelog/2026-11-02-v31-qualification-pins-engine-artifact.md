# V31 qualification pins an immutable engine artifact

- The explicit qualification workflow now pins one immutable protected-main engine commit per dataset instead of following whatever engine is serving. Existing replay/league receipts own the pin permanently, so versions are never mixed and nothing is overwritten. A fresh dataset pins the serving engine when it already carries the complete public-hist215 policy contract, and otherwise the dispatched protected-main control commit.
- Evaluation runs entirely on the pinned checkout. Production may advance during an evaluation without changing the pin; nothing is deployed or downgraded from this workflow.
- Promotion requires the serving engine to be on protected main and to hold byte-identical copies of the ten policy-contract files (the encoders, schema, descriptor, model, native kernel and feature builders). Otherwise promotion refuses cleanly and the receipts stay untouched, so the dataset waits for a compatible serving engine instead of being stranded.
- The database rule that all eight receipts share one `evaluation_engine_commit` is unchanged.
