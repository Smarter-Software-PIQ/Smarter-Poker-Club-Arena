# Original own-card snapshots in the historical study

The private study report can now fill missing fixed-hole own holdings from receipted
original snapshot exports. Exact protected-hand identity, original configuration,
actor seat and valid cards must agree; conflicts and discard games remain withheld.
Source digests and timestamps remain attached to every recovered decision. Only the
DB snapshot-creation/atomic-acceptance clocks are compared; engine wall clocks do
not create an invented rejection tolerance.

This changes offline analysis inputs only. It neither supplies opponent cards nor
activates strategy. Focused tests cover identity/conflict/card refusal, current-board
collision, outcome blindness and the report/store/manifest path.
