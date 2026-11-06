# Cash batches admit profile rows before writing hands

The October 26 payout deadlock crossed two current writers: a cash batch retained
profile B from its first hand and requested A, while the tournament Diamond writer
retained A and requested B. Ordered player-stats advisory keys did not prevent this:
the wallet writer does not participate in those keys.

Migration `20261106141636` changes the original batch and existing retry functions. After its existing
ordered advisory admission and before processing any item, it attempts each profile
row without waiting. A busy player defers the whole original item through the
existing caller cursor contract; unrelated items proceed. Under the original hand
key it rechecks source identity and contributors, so a source edited between
admission and processing cannot introduce an unowned profile. Missing profiles keep
the existing stats-only behavior. Amounts, receipts, ownership and existing budgets
are preserved. This is not a new retry service or a payout repair.

Installation asserts exact current function/dependency/immutability-trigger identity,
owner, permissions and configuration; it replaces two functions in one bounded
transaction. Its final definition is checked by the maintained installer live proof.

The connected retry entry point reproduced the same cycle with an aborted wallet
transaction despite returning two successful accounting items. It now admits ordered
player keys and profiles without waiting, preserving the due window, item limit,
original work rows and bounded deferral contract.

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

The complete native before/after runner passes fourteen outcome groups, including
both actual deadlock counterexamples, both corrected paths, preserved original
credits/counters, five installer refusal controls, expanded sources and the retry
window's item limit/untouched work. Initial Mac PostgreSQL WAL-open EINTR failures
and a report-path serialization failure were retained; neither was counted as a
passing run. The final complete run succeeds and removes its stopped cluster.
Five existing actual settler deferral/cursor tests also pass. Required hosted checks
remain mandatory before merge. No production financial probe was performed.
Merge, installation and affected natural production behavior remain separate evidence.
