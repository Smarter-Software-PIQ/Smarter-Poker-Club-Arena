# Corrected rebuy protected database window

After original run43336881677 rolled back and thawed, the owner explicitly authorized one additional protected window for the corrected migration in PR #10666. The new single-use booking preserves the consumed order and receipt unchanged. It names only migration151009; no SQL, prices or awards change in this booking.

The new primary notice starts04:15UTC November13, after the preceding notice expires. Admission starts04:35UTC and expires06:00UTC, with actual twenty-minute primary notice, rolling-hour spacing, original ownership, drain/freeze, unchanged install budgets, one attempt and verified thaw required. No engine replacement, payment, automatic retry or extension.

Installation and affected live behavior remain separate acceptance gates.

The original unmerged02:00/02:20 draft missed its notice while required CI ran. This same unconsumed booking now declares03:00/03:20, with fixed06:00 expiry and every prior record unchanged. No additional operation is authorized.

Integration preserves protected engine booking #10673 byte for byte. This same unmerged database order defers its own notice/admission to04:15/04:35UTC, after the engine notice expiry, while retaining06:00 expiry. Actual rolling-hour spacing may delay dispatch further; no competing operation or engine replacement is authorized here.

The fifteen-minute gap after the engine order leaves time to merge/publish this qualified booking after that original operation is terminal, without changing its pre-cutover certificate inputs. Notice/admission are04:15/04:35UTC; actual publication lead and rolling-hour guard still govern dispatch.
