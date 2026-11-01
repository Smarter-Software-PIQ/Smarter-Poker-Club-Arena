# Tournament Break Last-Hour VPIP

The break and add-on card shows the signed-in player's VPIP for settled, dealt
hands in that tournament during the preceding 60 minutes, with its hand count.
It reads the existing private hand facts, never session or career totals.

The shared tournament event feed refreshes on committed changes, reconnect and
visibility recovery. Hands expire at their rolling-hour boundary even during a
break. Missing identity, failed reads and truncated samples remain unavailable;
an empty sample says No Recorded Hands rather than presenting a fabricated 0%.

Focused regression coverage checks identity, scope, eligibility, exact time
boundaries, incomplete reads, expiry and recovery. No engine, schema or financial
mutation is required for this client change.
