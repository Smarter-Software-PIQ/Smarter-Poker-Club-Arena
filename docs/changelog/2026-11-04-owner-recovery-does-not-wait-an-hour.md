# Engine recovery proceeds after the previous window finishes

The release seal applied its historical rolling-hour limit even after an
otherwise eligible engine recovery had completed. The owner clarified on
November 4 that engine resets do not require this additional hour. A completed
failed attempt had delayed the next qualified release for the rest of that hour.

The existing engine reservation now removes that spacing when the previous
reservation's full 420-second notice/window has ended and its matching terminal
result is known. This is a permanent source rule, with no dated exception or
runtime bypass flag. Missing, corrupt, foreign or future receipts do not qualify.
Pending and finalizing owners remain authoritative. Existing emergency cause,
protected source, exclusive ownership, Inspector cleanup, hand-boundary drain,
database freeze, 120-second notice, 300-second window, 285-second proof/rollback
budget and own-window thaw remain in the original transaction. Database-only
reservations and scheduled cycles retain their existing cadence. Business
schedules and previous window/operation records are unchanged.

The native regression first reproduced the unnecessary 50-minute refusal using
the actual seal. Its terminal receipt, unknown-outcome, ownership, duplicate and
database-cadence cases run through the existing engine release seal law test.
A currently running release keeps its immutable control; installing this source
requires the normal protected delivery route.
