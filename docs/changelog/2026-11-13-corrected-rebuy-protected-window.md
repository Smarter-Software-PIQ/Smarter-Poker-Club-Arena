# Corrected rebuy protected database window

After original run43336881677 rolled back and thawed, the owner explicitly authorized one additional protected window for the corrected migration in PR #10666. The new single-use booking preserves the consumed order and receipt unchanged. It names only migration151009; no SQL, prices or awards change in this booking.

The new primary notice starts03:00UTC November13, after the preceding notice expires. Admission starts03:20UTC and expires06:00UTC, with actual twenty-minute primary notice, rolling-hour spacing, original ownership, drain/freeze, unchanged install budgets, one attempt and verified thaw required. No engine replacement, payment, automatic retry or extension.

Installation and affected live behavior remain separate acceptance gates.

The original unmerged02:00/02:20 draft missed its notice while required CI ran. This same unconsumed booking now declares03:00/03:20, with fixed06:00 expiry and every prior record unchanged. No additional operation is authorized.
