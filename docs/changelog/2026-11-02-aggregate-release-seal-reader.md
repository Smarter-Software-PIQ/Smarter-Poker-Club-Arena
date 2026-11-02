# Aggregate release history has its own bounded reader

Live read-only observation 41469127720 refused at routine_seal_read/file_size.
The observer applied a single receipt 64 KiB limit to the accumulated canonical
release seal. No ownership or production history was changed to fit the reader.

Only the canonical aggregate seal reads now use a separate 16 MiB bound,
derived from the existing 256-cycle shape bound and 64 KiB record budget.
Individual receipts remain limited to 64 KiB. Reads collect bounded chunks in
linear time. Private permissions, no-follow opens, duplicate-key rejection,
complete byte and metadata rechecks, five-second observation budget, cycle and
owner limits, and the sanitized output projection remain enforced.

Regression: a valid aggregate larger than 64 KiB failed before the correction.
Coverage includes exact aggregate limit, one-byte overflow, oversized individual
receipt refusal, unchanged private bytes and no private-history export. The
existing permission, symlink, duplicate-key and racing-file cases still run.
This is observer-only delivery; it cannot advance or certify a release.
