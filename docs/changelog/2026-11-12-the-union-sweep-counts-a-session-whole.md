# The union sweep counts a session whole (2026-11-12)

Production Alerts fleet, PRIMARY lane, row 377222.

`fn_union_integrity_sweep` raised `agent_roster_winning` for agent `7e616640` on
union `fade0000` with a net of 183.29 against 12.35 rake. 40.00 of that net was a
window-edge artefact: the 136.08 prize of tournament `12ef2263` was counted, but its
40.00 buy-in (2026-11-11 19:16:24) fell 17 minutes before the 24-hour window and was
not. The `net` CTE filtered every wallet row by its own `created_at`, so any session
that straddled the window edge counted its credit without its debit.

Migration `20261112214754_the_union_sweep_counts_a_session_whole.sql` (pinned
preimage `2d206e82...`, postimage `93765162...`) reads the roster's scoped wallet rows
from 24 hours before the window and counts a pre-window debit only when the same
player has an in-window credit on the same cash table or tournament, and, for cash,
only when no cashout at that table closed an earlier session in between. Pre-window
credits are never counted, and an open session without an in-window credit gains
nothing.

Measured read-only on production for the 377222 window: of seven agents with
movement, only `7e616640` changed (155.38 to 115.38, the 40.00 buy-in). The paired net
is still above 10 x rake, so 377222 itself was a real winning day, not an integrity
breach.

Pinned by `tests/the-union-sweep-counts-a-session-whole.law.test.ts`.
