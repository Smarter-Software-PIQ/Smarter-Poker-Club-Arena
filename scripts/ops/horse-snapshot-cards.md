# Original own-card recovery for the private Horse study

Place receipted `snapshot-own-originals-*.jsonl.gz` batches alongside the existing
study source inputs and run the maintained `horse-study-report.py --source SOURCE
--output NEW_PRIVATE_OUTPUT` route. Existing reports remain immutable. The normal
receipt SHA and row-count checks apply; snapshot receipts also require `readOnly:
true` and the original query SHA. No runtime strategy is activated.

The acquisition query must bind a protected hand_atomic_commits receipt to exact
hand ID and expected table, then match original history/snapshot table and hand
number and select only the named actor's own cards. Retain that query and its native
receipt with the acquisition. File hashes establish byte provenance, not independent
DB authentication. A fabricated receipt is not authoritative evidence.

The adapter validates hand/table/number/actor/seat/variant and original configuration,
requires valid unique fixed-hole cards, and withholds every conflicting snapshot
rather than selecting one. Pineapple is unsupported without original discard
chronology. The decision parser rejects collisions with its currently visible board
and mismatched captured variants. No later board, outcome, opponent holding or
snapshot stack enters the decision information set. Existing original card sources
retain precedence; snapshots fill missing holdings only.

Clock semantics: snapshot `created_at` is DB NOW() (base snapshot migration), while
atomic `committed_at` is DB clock_timestamp(). Require creation not after acceptance.
The engine's history start/end timestamps come from Date.now(); without calibration
they cannot impose DB lower/upper bounds. No arbitrary grace is used. Completion can
advance `updated_at` after acceptance. All original timestamps are retained in the
per-decision provenance. Fixed-hole controller cards originate at deal and do not
change across streets; Pineapple's explicit discard paths are excluded.

Summary records source/query/receipt digests and accepted/withheld decision counts.
Decision records retain exact snapshot IDs, original timestamps, source row ordinals
and identity. Missing/invalid records remain gaps; recovered own cards do not recover
missing public nodes, historical runtime policy, opponent ranges or tournament utility.

Focused cases live in `test_horse_snapshot_cards.py`, discovered by the maintained
`tests/unit/horseHumanStudy.test.ts` Python test route.
