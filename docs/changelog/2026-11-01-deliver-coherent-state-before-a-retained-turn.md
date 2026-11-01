# Coherent state before a new decision after backpressure

The table hub could soft-drop a state DELTA, then deliver a separately sequenced turn event after the socket drained. An older seated client could combine the new decision token with the previous street's wagers and show Call without an opening Bet. A later state gap could recover it, but a quiet decision had no guaranteed later update before its clock expired.

The hub now remembers missed state per room and subscriber. Before that subscriber's next turn event, it queues the current public snapshot on the same ordered adapter. The recovery snapshot and following decision preserve the existing recovery exemption from SOFT; the existing HARD and closed-socket guards still apply before each send. Failed recovery suppresses the dependent event and preserves the missing-state marker. Successful full snapshots, including explicit RESYNC and subscription, clear it. Later DELTAs cannot clear an earlier gap. Already coherent subscribers keep their existing path.

This retains no player input or event history, adds no timer or repair loop, changes no protocol or decision deadline, and preserves private-card delivery, publisher ownership and reveal replay accounting. Synchronous queue acceptance establishes ordering, not a browser acknowledgment.

The original Hub regression fails before the repair. The repaired focused transport suite passes 125 cases, including actual single-table and multiplexed WebSocket adapters, SOFT/HARD boundary crossings, failed sends, resync, reconnect and room isolation. Server compilation passes.

Composed proof feeds the actual Hub output into an unchanged old client build. Both producers encounter the same two SOFT state drops and subsequent buffer drain; the replay adds no downstream drop, reordering or held recovery. The original Hub produces 16 partial decision frames. The patched Hub passes Chromium and WebKit, with coherent opening-Bet controls, one preflop Call and no input replay or fixture errors. Protected delivery and live verification remain separate; this reproduced class does not identify the transport cause of a historical player incident.
