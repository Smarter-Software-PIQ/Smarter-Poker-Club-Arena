# A Dead Realtime Socket Is Found On Resume

Measured on production, 2026-10-30 to 2026-11-06: 1,218 "Realtime transport lost (socket closed)" rows, all filed while the page was visible, led by iOS Safari on table and club routes. Danimal (iPhone) lost the socket six times during the November 5 Afternoon Free Buy PKO, and knockout broadcasts sent while it was dead never reached the felt.

Cause: a frozen phone page (locked screen, app switch) thaws with realtime-js still believing the socket is connected. The SDK noticed only on its second unanswered heartbeat, up to 50 seconds at the 25 second default, before its stepped reconnect. Background desktop tabs hit the same gap because the browser throttles the page timers that drive the heartbeat.

Fix:
- The heartbeat runs in a Web Worker (realtime-js `worker`) at 12 seconds (`src/lib/supabase.ts`).
- `src/lib/realtimeLiveness.ts` (loaded lazily, outside the entry chunk) probes the socket the moment the page is shown, comes back online, is restored from the back-forward cache or regains focus: a closed socket connects at once, and a probe beat unanswered after 3 seconds triggers the SDK's own heartbeat timeout, which reconnects and rejoins every channel.
- The table's tournament channel rejoin now re-reads the bounty heads and any open mystery chest beside the break, level and completion it already re-read.
- `Realtime.resume_revived` (at most once per 10 minutes per client) proves each forced revival live.

Proof: `tests/unit/realtimeLiveness.test.ts`.
