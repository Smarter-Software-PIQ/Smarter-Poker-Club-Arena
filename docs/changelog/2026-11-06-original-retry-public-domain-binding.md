# Original payload retry fixture binds the public domain helpers

The nested VM proof extracts the current settlement and history functions.
It omitted the real public-domain helper imports, so 23 cases failed before
retention or financial submission. The hosted merge and local source agree;
the failure reproduces locally without network or production access.

Bind the maintained helper implementations in the VM. Preserve every existing
retry, rollback, unknown-outcome and custody assertion. Additional cases prove
that the original BB-ante domain survives retry without recapture and that
missing original rules leave the legacy accepted payload unclassified.

No production transaction, retry policy, schema or acceptance safeguard changes.
