# A Lightning departure belongs to the original room

A player can leave a Lightning room and re-enter another room on the same funded seat and occupancy. The new engine endpoint carries the original pool session through the departure transaction. Pool re-entry and departure lock the same seat, so the old room cannot queue the new room's departure.

The scoped Stop Playing and Keep Playing calls preserve existing hands-owed, responsible-gaming and settlement rules. The existing client and its database calls remain supported during preparation. The client cutover and retirement of the unscoped calls follow after the new engine is serving.
