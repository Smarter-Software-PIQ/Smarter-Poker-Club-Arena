# Cash batches admit profile rows before writing hands

The October 26 payout deadlock crossed two current writers: a cash batch retained
profile B from its first hand and requested A, while the tournament Diamond writer
retained A and requested B. Ordered player-stats advisory keys did not prevent this:
the wallet writer does not participate in those keys.

Migration `20261106141636` changes the original batch function. After its existing
ordered advisory admission and before processing any item, it attempts each profile
row without waiting. A busy player defers the whole original item through the
existing caller cursor contract; unrelated items proceed. Under the original hand
key it rechecks source identity and contributors, so a source edited between
admission and processing cannot introduce an unowned profile. Missing profiles keep
the existing stats-only behavior. Amounts, receipts, ownership and existing budgets
are preserved. This is not a new retry service or a payout repair.

Installation asserts exact current function/dependency/immutability-trigger identity,
owner, permissions and configuration; it replaces one function in one bounded
transaction. Its final definition is checked by the maintained installer live proof.

## Qualification

The maintained replay/profile native qualification now executes the new current
batch test in the same required accounting job and retains its result in the same
artifact. Changed harness/capture inputs select that existing required route.

The isolated fixture uses captured actual batch, source processor, stats/profile
writers, source-immutability triggers and Diamond credit function. It reproduces
the opposite-order deadlock, then checks both original credits and counters once,
busy-player isolation, whole shared-hand deferral, original resubmission/replay,
concurrent source expansion, missing profiles and rejected installer drift.
Accrual readers and wallet storage are controlled: this is profile-lock admission
proof, not full tournament settlement or production-ledger qualification.

Local candidate concurrency cases and expanded-source/installer controls pass.
The old-image deadlock was observed in PostgreSQL logs; the complete local
before/after run was interrupted by the Mac PostgreSQL WAL-open EINTR panic.
The required Linux native before/after verdict remains mandatory before merge.
No production financial probe was performed. Merge, installation and affected
natural production behavior remain separate evidence.
