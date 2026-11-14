# Lightning deal, countdown and previous hand

A fresh same-hand snapshot reopens Fast Fold after an uncertain response. The action requires another player press. The client ignores stale and duplicate deal events before they clear cards or controls and animates five rounds for a PLO5 table within the engine's deal interval.

The countdown rereads committed status on settlement, including a replayed notification, and offers a retry if the read is unavailable. Previous Hand stays on the selected deal across subsequent hands and refreshes that deal after reconnect.
