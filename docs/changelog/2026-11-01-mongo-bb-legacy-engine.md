# Tournament BB display works with the serving engine

Mongo had BB selected in user_table_settings, but the client forced chips because
it treated an absent optional hand_blinds field as an invalid hand denomination.
The serving engine eed06fe5 predates that field; client PR #8827 introduced the
requirement before the engine portion was installed.

The mapper now distinguishes absent legacy data from an invalid supplied
contract. Legacy snapshots use the existing table/level blind metadata; valid
hand-bound snapshots retain priority and malformed or mismatched modern data
still fails closed. Nonfinite/nonpositive metadata never becomes a denominator.
The existing legacy metadata is not a frozen hand snapshot; the stronger
hand-bound guarantee remains conditional on engine support.

Regression tests cover legacy reconnect and startup, level changes, modern
hand/table mismatch, invalid metadata, real pot/action rendering and unchanged
chip action submission. Existing all-seat/pot display tests remain enforced.
No engine restart, migration or balance change is part of this client repair.

A second connected defect was reproduced with two real hook instances: once a control had changed a key, its lifetime touched-key guard rejected subsequent user changes from the other control. The guard now rejects stale database echoes only; newer local gestures synchronize all mounted instances and fence pending hydration. The failing regression was captured before the fix (6 passed, 1 failed).
