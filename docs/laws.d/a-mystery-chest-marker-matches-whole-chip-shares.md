# tests/a-mystery-chest-marker-matches-whole-chip-shares.law.test.ts

The October 22 mystery reserve rule splits chests in whole chips, with the
remainder assigned to the first claimant by user ID. The complete marker must
recognize the same allocation. An 11-chip chest shared equally produces 6 and
5 chips; demanding 5.50 each prevents the acknowledgement from settling and
causes the enclosing payment transaction to roll back.

The marker accepts one complete canonical allocation across all claimants:
the current whole-chip cut or the earlier money-unit cut. Retain the earlier
cut because already settled historical receipts used fractional chips. This
compatibility check does not authorize the current producer to create new
fractional-chip allocations. Diamond events retain their whole-Diamond unit.
Exact claimant membership, amounts, total, paid evidence and obligation binding
remain required. The regular and PKO marker branch remains byte-identical.

`scripts/ci/test-mystery-whole-chip-marker.py` runs actual retained marker SQL,
the actual replacement migration, the actual floor helper and acknowledgement
trigger on disposable PostgreSQL 17. It reproduces the old rejection and
asserted transaction rollback, verifies the corrected transition and duplicate
acknowledgement, preserves historical evidence and function permissions, and
rejects incomplete or inconsistent allocations. It also checks cent and
Diamond regular/PKO cases. Its tournament unit lookup is controlled fixture
input. It does not exercise a wallet payer or claim full financial settlement
coverage. Production adoption and actual payment readback are separate proof.
