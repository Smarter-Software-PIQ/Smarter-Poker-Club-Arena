# Owner-paid refunds retain their existing credit evidence

The owner took over the four original-charge credits totaling 8 Chips. Retirement previously required a receipt from the automated Main Bank refund function, which would reject a manually credited player or encourage a second payment.

The exact four charge entitlements can now link to posted KingFish agent or promo credits for the same player and original club, including the player’s verified agent wallet. The recorded allocation cannot exceed the original credit, reuse a credit for another entitlement, substitute a cash-out or award, or precede the original charge. Recognition moves no money and does not rewrite the journal, original charge, or a refund tranche. Partial allocation of a larger owner credit retains its full original amount. Missing evidence remains a refusal.

The old automated bank refund action is superseded. Terminal retirement accepts either its prior valid bank receipt or the immutable manual-credit evidence, retains that evidence in the canonical terminal receipt, and validates it again on receipt reads. The ordinary fee path remains unchanged; only an actual bank-funded refund reserves a bank-funded fee component.

Validation uses the existing isolated PostgreSQL retirement fixture: actual source installation, wrong role/recipient/source/amount, rollback, zero financial movement, replay, immutable evidence, missing-credit refusal, superseded bank payment refusal, and full conserved terminal closure. No additional payment or production retirement is claimed by source delivery.

The first retirement installation rolled back because the live escrow reader had gained promo-funded bounty accounting. The still-uninstalled migration now preserves that exact reader change, its free-buy predicate, and owner retirement outflows together. Its preimage guard and captured fixture reflect the actual concurrent source; unrelated changes remain refused.
