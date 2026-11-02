# Routine ownership history remains readable

The seal admits 256 immutable cycle records, but its read-only observer refused a ninth nonsealed record. Resolved records intentionally keep their original reserved status, so keeping their history eventually made every fresh observation fail.

The observer now uses the same 256-record aggregate bound for reading and validating its closed projection. The exported 32 KiB transport limit, per-receipt limits, unique owner identities, private-file checks and complete resolution proof requirements remain enforced. This changes observation only; it never clears custody, retries a release or writes production state.

A real private-file regression reproduces the ninth-row refusal on the previous source, validates all nine original rows after the change, rejects duplicate projected identities and confirms the seal bytes are unchanged. Existing source-owner PR #9399 separately owns unentered-cycle recovery and late admission; this follow-up does not replace its production operation.
