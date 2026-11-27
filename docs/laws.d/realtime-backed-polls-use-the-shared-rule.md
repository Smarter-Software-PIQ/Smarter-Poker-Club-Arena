# tests/realtime-backed-polls-use-the-shared-rule.law.test.ts

A client poll that re-reads what a realtime channel delivers runs through src/lib/realtimeAwarePoll.ts (fast while the channel is not SUBSCRIBED, the 30 s safety cadence or nothing while it is, fast again on a drop); every other raw setInterval in a channel-owning src file is counted in the law's inventory with its reason, so a new one fails until it uses the shared rule or is accounted for.
