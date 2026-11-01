# Spectator watches keep the selected player

A tournament own-seat INSERT used the first same-event tab as a fallback when no confirmed played source existed. An observer tab could therefore be replaced, lose its selected player, and receive the personal moved-seat message. The INSERT path now requires a confirmed seated source without an explicit player watch; otherwise the normal seat reconciliation opens the actual played seat independently.

Explicit player watching also disables the account's seat-move navigation, including retained events and in-flight validation, and suppresses the personal moved-seat banner. On reconnect, a watched tab whose own seat has departed becomes an observer with its follow identity intact. The existing target assignment feed remains the only automatic destination authority for that watch. Ordinary table watching stays fixed. No engine, game, admission, schema or financial behavior changes.

The real MultiTablePage regression fails before the fix because Felt A disappears on an own-seat INSERT, then passes with the same input after the fix. Focused coverage includes own-seat moves, delayed replay validation, Stop Following, target moves, background focus, destination deduplication, reconnect, played-seat retention and no-auto-switch rules. Initial final focused run: 8 files, 111 tests passed. Compiler, normal hooks, protected checks, publication and live verification are tracked in CHECKPOINT-spectator-follow-01a19949.md.

Real-time law: existing SEAT_MOVED discrete WS events and tournament assignment feed; no snapshot diff or polling added.

Global own-seat move announcements are scoped to the visible source/destination and suppressed during player following. The gate is rechecked after an asynchronous table-name read, so switching to a spectator before that read finishes cannot show a late personal move toast. A second real MultiTablePage before-fix regression fails on the unwanted background toast and pins this boundary while preserving the actual background seat move.
