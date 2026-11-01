# Break Card Uses Committed Blinds

The add-on notice can open without an hourly-break payload. Previously the card displayed that payload unconditionally, including its fabricated 0 / 0 default or stale previous-hour amounts, while labelling the current tournament level.

The card now reads current_level, blind_level_state and blind_structure together with its existing facts read. It uses the exact committed snapshot, or the validated exact schedule index for older engines without a snapshot. Both pauses resume the committed level. Missing, invalid or mismatched data never falls back to an old hourly payload, a clamped ladder or a fabricated BB denominator. Shared committed-event/reconnect updates and pause-ownership changes refresh the same owned read. Explicit standalone callers retain validated props.

Regression: actual-component tests failed before the fix (50 / 100 instead of committed150 / 300 and scheduled100 / 200). Coverage includes event recovery, legacy JSON schedules, mismatched snapshots, overflow, failed reads and truthful loading/unavailable amounts. Existing break/VPIP tests remain in the targeted validation.
