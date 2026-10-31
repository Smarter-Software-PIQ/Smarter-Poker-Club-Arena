# Maintenance notice follows the serving engine schedule

The client now validates the schedule returned by its existing maintenance health read before showing a routine heads-up. Old daily engines retain the daily Chicago notice. The identified Phase1 hourly tuple enables hourly notices only after the serving engine reports it; a later desired complete/off source flag cannot prematurely change an engine that still serves hourly. An adopted daily tuple restores the daily notice. Missing or malformed schedules make no routine promise.

The existing 15-second display tick, health refresh triggers, authoritative active-break events, countdown and certified release handling remain intact. No new request, poll, store or release mechanism is added. The client uses a literal protocol identifier cross-pinned against the producer policy by the existing clock test, without importing desired server configuration into the browser runtime.

Focused clock/DST, actual hook reconnect/online ordering and banner transition regressions cover compatibility, malformed tuples, no extra requests and active-break authority. These are source checks; publication, actual serving identity and live schedule transitions remain separate verification.
