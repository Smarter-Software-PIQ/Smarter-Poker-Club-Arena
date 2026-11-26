# Spin cancellation readers count the original unwind

Booked, undrawn Spins refund each gross entry on the prize rail and reverse the booked fee in `rake_records`. The escrow shadow excluded that fee reversal, leaving an artificial prize deficit and equal fee surplus. It now nets the cancellation fee only when the immutable cancellation unwind records an undrawn Spin. Ordinary cancellation, unregister and operator-abort refund splits retain their existing treatment.

Conservation previously subtracted contribution and jackpot draw movements but omitted their signed cancellation reversals. It now counts all four event movement kinds, excluding unrelated reserve-owner adjustments. No financial writer, balance, refund, reserve, alert status or game state changes.

A private PostgreSQL 17 proof executes captured production reader bodies and the exact migration. Eight stakes reproduce both wrong readings before the change and read zero afterward. The proof retains ordinary refund-rail and played Spin parity, missing-receipt and drawn-cancellation boundaries, rollback, strict preimage refusal and unchanged function authority. It runs in the existing required accounting shard. Production installation and affected-event readback remain separate delivery gates.

The current whole-window conservation reader explicitly excludes Spins. Its actual captured SQL is executed alongside the scalar; the eligible non-Spin and Diamond population is identical before and after and every batch delta equals its scalar. The existing formula-review guard pins this exact successor, and the CI fingerprint independently pins the additive step before comparing every historical field. Execution projection pins carry a source-only audit; historical financial qualification verdicts are preserved.
