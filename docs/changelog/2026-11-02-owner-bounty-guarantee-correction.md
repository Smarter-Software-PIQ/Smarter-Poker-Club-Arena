# Correct the current combined bounty guarantee without clawing back paid awards

The owner explicitly directed correction of event `6b72abc3-bd16-488c-aea5-54b1eace98d5` to a 5,000 total guarantee. Its 95 entries fund 2,470 place prizes, 950 bounties and 380 rake. The corrected place pool is 4,050 and retained house overlay is 1,580; the existing excess 950 returns to the exact original union bank through the reversal journal and escrow primitive.

The maintained operation locks the settlement lane and event records, preserves all paid awards and immutable payment evidence, and allocates the remaining place pool using the original relative weights. Version 1 stores the resulting award amounts as normalized weights, preserving exact cents in both existing SQL and engine arithmetic. The client must normalize percentage labels before this operation executes. Already-paid lower places can exceed newly repriced higher places; no paid award is clawed back.

The guard migration admits only this event's exact old/new row images bound to its unique 950 reversal receipt and operation context. It preserves trigger enabled states and all unrelated guard behavior. The operation refuses pending place obligations, terminal preparation, incompatible terms or unexplained cached awards. It does not modify player balances or existing payout records.

Native PostgreSQL 17 verification uses the actual guards and payout helpers: paid 15th=136 and 14th=143.50 remain exact; place awards sum to 4,050; bounties remain 950; remaining place escrow is 3,770.50; the source bank receives exactly 950; repeat execution moves nothing. A journal failure rolls back the bank credit and every event/escrow/receipt change. Unreceipted, GUC-only and unrelated contract edits are rejected.

Source and native verification do not establish installation, publication or live correction. Those remain the parent operation owner's delivery steps.
