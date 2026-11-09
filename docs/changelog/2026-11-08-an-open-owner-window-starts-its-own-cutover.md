# An open owner window starts its own cutover

On November 7 a booked owner window expired unused. On November 8 window
`2026-11-08-horse-study-successor-engine-1820z` sat idle for about seventy
minutes, and each retry after new evidence landed waited for a person to
dispatch the explicit owner selection again.

Stage now decides on events it already receives (protected pushes, the existing
schedule, and successful push Backup and engine prequalification completions).
When the booked window is ready, it dispatches the existing owner selection with
`owner_window_id`, `request_engine_release=true` and `request_database_break=false`.
The decision (`scripts/ci/select-daily-engine.py --owner-start`) only reads. It
requires all of the following: the window is open; the served client has carried
the booked notice for its twenty-minute lead; the moment is in the :05:30-:49:00
band with 420 s left before the window closes; the pinned protected owner
admission passes; a candidate has complete current evidence; no release of the
window is serving; and no owner selection or receiver is running. A later attempt
needs evidence that completed after the previous attempt. Every gate after the
dispatch (protected owner admission, selection, receiver, single-use host claim,
freeze, proof, rollback, thaw) is unchanged. No timer was added. Prequalification
completions never enter the daily election.

Tests: `tests/operations/owner-window-autostart.test.py`,
`tests/an-open-owner-window-starts-its-own-cutover.law.test.ts`.
