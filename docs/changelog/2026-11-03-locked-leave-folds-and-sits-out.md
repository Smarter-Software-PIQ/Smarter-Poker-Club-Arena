# Locked Leave Folds And Sits Out

A voluntary leave held by the existing cashout stay clock now folds or queues the fold through the current server hand controller and marks the player sitting out. The cash seat and its financial lock remain intact. The wire reply preserves success:false and LEAVE_LOCKED for older clients and explicitly identifies a held sit-out; client services carry it without booking cash credit or starting a cashout watcher. The table keeps its action tab and suppresses further turn attention until the player sits back in.

The browser submits the original occupancy leave even when its cached lock is active, so the authoritative engine owns the fold and cannot apply a delayed client fold to a newer hand. Focused tests cover on-turn and off-turn folds, retained seat/no financial departure, valid and malformed held acknowledgements, and unchanged cashout identity rules.
