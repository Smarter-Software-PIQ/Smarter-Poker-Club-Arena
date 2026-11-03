# Locked Leave Folds And Sits Out

A voluntary leave held by the existing cashout stay clock now folds or queues the fold through the current server hand controller and marks the player sitting out. The cash seat and its financial lock remain intact. The wire reply preserves success:false and LEAVE_LOCKED for older clients and explicitly identifies a held sit-out; client services carry it without booking cash credit or starting a cashout watcher. The table keeps its action tab and suppresses further turn attention until the player sits back in.

The browser submits the original occupancy leave even when its cached lock is active, so the authoritative engine owns the fold and cannot apply a delayed client fold to a newer hand. Focused tests cover on-turn and off-turn folds, retained seat/no financial departure, valid and malformed held acknowledgements, and unchanged cashout identity rules.

Accepted leave folds are additionally bound to their original HandController in a weak map. A late ordinary pre-action clear/call or direct non-fold action cannot withdraw that leave. The turn handler reasserts the committed fold and rechecks it after the visible action beat. A different controller inherits no fence, and ordinary Sit Out retains its existing finish-current-hand behavior. Real-engine regression drives leave, late clear/call, turn fold and a fresh-controller clear.
